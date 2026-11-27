/** Actions: the one validator and the one executor that players and the AI both go through. */

import { hexRange, indexToOffset } from '../shared/hex.ts';
import {
  AI,
  BUILDING_IDS,
  FOCUSES,
  IMPROVEMENT_IDS,
  SETTLER,
  UNIT_IDS,
  UPGRADE_GOLD_PER_COST,
  WAR,
  unitDef,
  upgradeTarget,
} from './data.ts';
import { assignCitizens, checkItem, foundCity, improvementFits, improvementDef } from './cities.ts';
import { hexesApart, resolveAttack, unitPower } from './combat.ts';
import {
  at,
  atWar,
  bordersOpen,
  cityAtHex,
  enforceBorders,
  isEmbarked,
  ownerOf,
  placeUnit,
  polityOf,
  relationKey,
  relationOf,
  removeUnit,
  setWarFlag,
  terrainAllows,
} from './context.ts';
import type { Ctx } from './context.ts';
import { NO_POLITY } from './types.ts';
import type { Action, BuildItem, City, RejectReason, Unit } from './types.ts';

// ---------------------------------------------------------------- helpers

function isPolity(ctx: Ctx, polity: unknown): polity is number {
  return (
    typeof polity === 'number' &&
    Number.isInteger(polity) &&
    polity >= 0 &&
    polity < ctx.n &&
    polityOf(ctx, polity).alive
  );
}

function isHex(ctx: Ctx, hex: unknown): hex is number {
  return typeof hex === 'number' && Number.isInteger(hex) && hex >= 0 && hex < ctx.topo.count;
}

function ownCity(ctx: Ctx, polity: number, zone: unknown): City | RejectReason {
  if (typeof zone !== 'number' || !Number.isInteger(zone)) return 'noSuchCity';
  const city = ctx.state.cities[zone];
  if (city === undefined || city === null) return 'noSuchCity';
  return city.owner === polity ? city : 'notYourCity';
}

function ownUnit(ctx: Ctx, polity: number, id: unknown): Unit | RejectReason {
  const unit = typeof id === 'number' ? ctx.unitById.get(id) : undefined;
  if (unit === undefined) return 'noSuchUnit';
  return unit.owner === polity ? unit : 'notYourUnit';
}

function isAdjacent(ctx: Ctx, from: number, to: number): boolean {
  for (let d = 0; d < 6; d++) if (ctx.topo.neighbors[from * 6 + d] === to) return true;
  return false;
}

/** Movement points it costs `unit` to step onto the adjacent hex `to`. */
export function stepCost(ctx: Ctx, unit: Unit, to: number): number {
  const { topo, map } = ctx;
  const fromWater = topo.water[unit.hex] === 1;
  const toWater = topo.water[to] === 1;
  if (fromWater && toWater) return 1;
  // Embarking, landing and fording a river take the rest of the turn.
  if (fromWater !== toWater) return unit.moves;
  for (let d = 0; d < 6; d++) {
    if (topo.neighbors[unit.hex * 6 + d] === to && ((map.riverEdges[unit.hex] as number) & (1 << d)) !== 0) {
      return unit.moves;
    }
  }
  return topo.moveCost[to] as number;
}

/** Why `unit` cannot step onto `to`, or null. Movement points are not checked. */
export function checkStep(ctx: Ctx, unit: Unit, to: number): RejectReason | null {
  if (!isAdjacent(ctx, unit.hex, to)) return 'notAdjacent';
  if (!terrainAllows(ctx, unitDef(unit.type), to)) return 'impassable';
  if (!bordersOpen(ctx, unit.owner, to)) return 'closedBorders';
  if (ctx.unitAt.has(to)) return 'hexOccupied';
  const city = cityAtHex(ctx, to);
  if (city !== null && city.owner !== unit.owner) return 'hexOccupied';
  return null;
}

/** True if the unit counts as inside its owner's borders: on its land, or afloat next to it. */
function inOwnBorders(ctx: Ctx, unit: Unit): boolean {
  if (ownerOf(ctx, unit.hex) === unit.owner) return true;
  if (ctx.topo.water[unit.hex] !== 1) return false;
  for (let d = 0; d < 6; d++) {
    const hex = ctx.topo.neighbors[unit.hex * 6 + d] as number;
    if (hex >= 0 && ownerOf(ctx, hex) === unit.owner) return true;
  }
  return false;
}

export function upgradeCost(unit: Unit): number {
  const target = upgradeTarget(unit.type);
  if (target === null) return 0;
  return Math.max(0, target.cost - unitDef(unit.type).cost) * UPGRADE_GOLD_PER_COST;
}

/** Military strength of a polity: the sum of its units' power. */
export function militaryStrength(ctx: Ctx, polity: number): number {
  let total = 0;
  for (const unit of ctx.state.units) if (unit.owner === polity) total += unitPower(unit);
  return total;
}

/** True if an AI-run `polity` agrees to end its war with `proposer`. */
export function acceptsPeace(ctx: Ctx, polity: number, proposer: number): boolean {
  const relation = relationOf(ctx, polity, proposer);
  if (relation === undefined || !relation.atWar) return false;
  if ((relation.a === polity ? relation.offerA : relation.offerB) > 0) return true;
  // Only a major nation fights on; everybody else is glad of peace.
  if (!ctx.state.majors.includes(polity)) return true;
  const self = polityOf(ctx, polity);
  if (self.warWeariness >= AI.peaceWeariness) return true;
  if (ctx.state.turn - relation.since >= AI.stalemateTurns) return true;
  return militaryStrength(ctx, polity) < militaryStrength(ctx, proposer) * AI.warStrengthRatio;
}

// --------------------------------------------------------------- validate

function checkAttack(ctx: Ctx, unit: Unit, target: unknown): RejectReason | null {
  const def = unitDef(unit.type);
  if (!isHex(ctx, target)) return 'badHex';
  if (unit.moves <= 0) return 'noMovesLeft';
  if (def.strength <= 0 || isEmbarked(ctx, unit)) return 'cannotAttack';
  const city = cityAtHex(ctx, target);
  const enemyCity = city !== null && city.owner !== unit.owner ? city : null;
  const defender = ctx.unitAt.get(target);
  const victim = enemyCity !== null ? enemyCity.owner : defender !== undefined ? defender.owner : unit.owner;
  if (victim === unit.owner) return 'noTarget';
  if (!atWar(ctx, unit.owner, victim)) return 'atPeace';
  if (def.range > 0) return hexesApart(ctx, unit.hex, target) <= def.range ? null : 'outOfRange';
  if (!isAdjacent(ctx, unit.hex, target)) return 'notAdjacent';
  // Melee land units fight on land; ships reach anything next to them.
  if (def.domain === 'land' && ctx.topo.water[target] === 1) return 'cannotAttack';
  return null;
}

/** Why the action is illegal in the current state, or null if it is legal. Read-only. */
export function validate(ctx: Ctx, action: Action): RejectReason | null {
  const { state } = ctx;
  if (state.result !== null) return 'gameOver';
  if (!isPolity(ctx, action.polity)) return 'badPolity';
  const polity = action.polity;

  switch (action.type) {
    case 'move': {
      const unit = ownUnit(ctx, polity, action.unit);
      if (typeof unit === 'string') return unit;
      if (!isHex(ctx, action.to)) return 'badHex';
      if (unit.moves <= 0) return 'noMovesLeft';
      return checkStep(ctx, unit, action.to);
    }
    case 'attack': {
      const unit = ownUnit(ctx, polity, action.unit);
      if (typeof unit === 'string') return unit;
      return checkAttack(ctx, unit, action.target);
    }
    case 'fortify':
    case 'sleep': {
      const unit = ownUnit(ctx, polity, action.unit);
      if (typeof unit === 'string') return unit;
      const wanted = action.type === 'fortify' ? 'fortified' : 'asleep';
      if (unit.status === wanted) return 'alreadyFortified';
      if (action.type === 'fortify' && (unitDef(unit.type).strength <= 0 || isEmbarked(ctx, unit))) {
        return 'cannotAttack';
      }
      return null;
    }
    case 'upgrade': {
      const unit = ownUnit(ctx, polity, action.unit);
      if (typeof unit === 'string') return unit;
      const target = upgradeTarget(unit.type);
      if (target === null || target.era > ctx.era) return 'noUpgrade';
      if (unit.moves <= 0) return 'noMovesLeft';
      if (!inOwnBorders(ctx, unit)) return 'notInOwnBorders';
      return polityOf(ctx, polity).gold >= upgradeCost(unit) ? null : 'notEnoughGold';
    }
    case 'settle': {
      const unit = ownUnit(ctx, polity, action.unit);
      if (typeof unit === 'string') return unit;
      if (unit.type !== SETTLER) return 'notASettler';
      return isSettleSite(ctx, unit.hex) ? null : 'notASettleSite';
    }
    case 'setFocus': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      return FOCUSES.includes(action.focus) ? null : 'badItem';
    }
    case 'queueBuild': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      if (typeof action.item !== 'object' || action.item === null) return 'badItem';
      return checkItem(ctx, city, action.item);
    }
    case 'unqueueBuild': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      return Number.isInteger(action.index) && action.index >= 0 && action.index < city.queue.length
        ? null
        : 'badIndex';
    }
    case 'declareWar': {
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      if (atWar(ctx, polity, action.target)) return 'alreadyAtWar';
      const relation = relationOf(ctx, polity, action.target);
      if (relation !== undefined && state.turn - relation.since < WAR.truceTurns) return 'truce';
      return null;
    }
    case 'makePeace': {
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      const relation = relationOf(ctx, polity, action.target);
      if (relation === undefined || !relation.atWar) return 'notAtWar';
      if (state.turn - relation.since < WAR.minTurns) return 'warTooYoung';
      if (action.target === state.player) return null;
      return acceptsPeace(ctx, action.target, polity) ? null : 'refused';
    }
    default:
      return 'badAction';
  }
}

/** True if a settler on `hex` could found a city there: an empty site of unsettled wasteland. */
export function isSettleSite(ctx: Ctx, hex: number): boolean {
  const zone = ctx.topo.siteZone[hex] as number;
  return zone >= 0 && ctx.state.zoneOwner[zone] === NO_POLITY && ctx.state.cities[zone] === null;
}

// ---------------------------------------------------------------- execute

/** Carries out an action that {@link validate} has passed. Appends to `ctx.events`. */
export function execute(ctx: Ctx, action: Action): void {
  const { state } = ctx;
  switch (action.type) {
    case 'move': {
      const unit = ctx.unitById.get(action.unit) as Unit;
      const from = unit.hex;
      unit.moves = Math.max(0, unit.moves - stepCost(ctx, unit, action.to));
      unit.acted = true;
      unit.status = 'ready';
      placeUnit(ctx, unit, action.to);
      ctx.events.push({ type: 'unitMoved', unit: unit.id, owner: unit.owner, from, to: action.to });
      return;
    }
    case 'attack':
      resolveAttack(ctx, ctx.unitById.get(action.unit) as Unit, action.target);
      return;
    case 'fortify':
    case 'sleep': {
      const unit = ctx.unitById.get(action.unit) as Unit;
      unit.status = action.type === 'fortify' ? 'fortified' : 'asleep';
      unit.moves = 0;
      return;
    }
    case 'upgrade': {
      const unit = ctx.unitById.get(action.unit) as Unit;
      const target = upgradeTarget(unit.type);
      if (target === null) return;
      polityOf(ctx, action.polity).gold -= upgradeCost(unit);
      ctx.events.push({ type: 'unitUpgraded', unit: unit.id, from: unit.type, to: target.id });
      unit.type = target.id;
      unit.moves = 0;
      return;
    }
    case 'settle': {
      const unit = ctx.unitById.get(action.unit) as Unit;
      const zone = ctx.topo.siteZone[unit.hex] as number;
      removeUnit(ctx, unit);
      foundCity(ctx, zone, action.polity);
      return;
    }
    case 'setFocus': {
      const city = state.cities[action.city] as City;
      city.focus = action.focus;
      assignCitizens(ctx, city);
      return;
    }
    case 'queueBuild':
      (state.cities[action.city] as City).queue.push({ ...action.item });
      return;
    case 'unqueueBuild': {
      const city = state.cities[action.city] as City;
      city.queue.splice(action.index, 1);
      if (action.index === 0) city.progress = 0;
      return;
    }
    case 'declareWar': {
      const a = Math.min(action.polity, action.target);
      const b = Math.max(action.polity, action.target);
      state.relations[relationKey(a, b)] = { a, b, atWar: true, since: state.turn, offerA: 0, offerB: 0 };
      setWarFlag(ctx, a, b, true);
      state.stats.warsDeclared++;
      ctx.events.push({ type: 'warDeclared', by: action.polity, on: action.target });
      return;
    }
    case 'makePeace': {
      const relation = relationOf(ctx, action.polity, action.target);
      if (relation === undefined) return;
      const theirOffer = relation.a === action.target ? relation.offerA : relation.offerB;
      if (action.target === state.player && theirOffer === 0) {
        // A human decides for themselves: leave an offer they can take up.
        if (relation.a === action.polity) relation.offerA = state.turn;
        else relation.offerB = state.turn;
        ctx.events.push({ type: 'peaceOffered', from: action.polity, to: action.target });
        return;
      }
      relation.atWar = false;
      relation.since = state.turn;
      relation.offerA = 0;
      relation.offerB = 0;
      setWarFlag(ctx, relation.a, relation.b, false);
      polityOf(ctx, relation.a).aiTarget = -1;
      polityOf(ctx, relation.b).aiTarget = -1;
      ctx.events.push({ type: 'peaceMade', a: relation.a, b: relation.b });
      enforceBorders(ctx);
      return;
    }
  }
}

// ------------------------------------------------------------ enumeration

/** Every action `polity` may take right now. */
export function legalActions(ctx: Ctx, polity: number): Action[] {
  const { state, topo, map } = ctx;
  const out: Action[] = [];
  if (state.result !== null || !isPolity(ctx, polity)) return out;
  const offer = (action: Action): void => {
    if (validate(ctx, action) === null) out.push(action);
  };

  for (const unit of state.units) {
    if (unit.owner !== polity) continue;
    const def = unitDef(unit.type);
    for (let d = 0; d < 6; d++) {
      const hex = topo.neighbors[unit.hex * 6 + d] as number;
      if (hex >= 0) offer({ type: 'move', polity, unit: unit.id, to: hex });
    }
    if (def.strength > 0 && unit.moves > 0) {
      const reach = Math.max(1, def.range);
      for (const offset of hexRange(indexToOffset(unit.hex, map.width), reach)) {
        if (offset.col < 0 || offset.col >= map.width || offset.row < 0 || offset.row >= map.height) continue;
        const hex = offset.row * map.width + offset.col;
        if (hex !== unit.hex) offer({ type: 'attack', polity, unit: unit.id, target: hex });
      }
    }
    offer({ type: 'fortify', polity, unit: unit.id });
    offer({ type: 'sleep', polity, unit: unit.id });
    offer({ type: 'upgrade', polity, unit: unit.id });
    offer({ type: 'settle', polity, unit: unit.id });
  }

  for (const city of state.cities) {
    if (city === null || city.owner !== polity) continue;
    for (const focus of FOCUSES) {
      if (focus !== city.focus) out.push({ type: 'setFocus', polity, city: city.zone, focus });
    }
    const items: BuildItem[] = [];
    for (const unit of UNIT_IDS) items.push({ kind: 'unit', unit });
    for (const building of BUILDING_IDS) items.push({ kind: 'building', building });
    for (const improvement of IMPROVEMENT_IDS) {
      const def = improvementDef(improvement);
      if (def === undefined) continue;
      for (const hex of at(topo.workHexes, city.zone)) {
        if (improvementFits(ctx, def, hex)) items.push({ kind: 'improvement', improvement, hex });
      }
    }
    state.zoneOwner.forEach((owner, zone) => {
      if (owner === polity && state.cities[zone] === null) items.push({ kind: 'city', zone });
    });
    for (const item of items) offer({ type: 'queueBuild', polity, city: city.zone, item });
    city.queue.forEach((_, index) => out.push({ type: 'unqueueBuild', polity, city: city.zone, index }));
  }

  for (let target = 0; target < ctx.n; target++) {
    offer({ type: 'declareWar', polity, target });
    offer({ type: 'makePeace', polity, target });
  }
  return out;
}
