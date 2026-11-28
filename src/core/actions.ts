/** Actions: the one validator and the one executor that players and the AI both go through. */

import { hexRange, indexToOffset } from '../shared/hex.ts';
import {
  AGREEMENT_KINDS,
  AI,
  AIR_STRIKE,
  BUILDING_IDS,
  BUY,
  CITY_STATE,
  DIPLOMACY,
  FAVOUR,
  FOCUSES,
  IMPROVEMENT_IDS,
  MOVE_COST,
  PROJECT,
  ROUGH_FEATURES,
  SETTLER,
  TRADE,
  UNIQUE_UNIT_IDS,
  UNIT_IDS,
  UPGRADE_GOLD_PER_COST,
  WAR,
  unitDef,
  unitFor,
} from './data.ts';
import type { UnitDef } from './data.ts';
import {
  assignCitizens,
  canImprove,
  cityProjectOf,
  checkItem,
  deliverItem,
  foundCity,
  hasBuilding,
  improvableHexes,
  itemCost,
  spawnHex,
} from './cities.ts';
import { addInfluence } from './cityStates.ts';
import {
  checkDemandVassalage,
  demandVassalage,
  hexesApart,
  militaryStrength,
  resolveAirStrike,
  resolveAttack,
} from './combat.ts';
import {
  at,
  atWar,
  bordersOpen,
  cityAtHex,
  isEmbarked,
  ownerOf,
  placeUnit,
  polityOf,
  relationOf,
  removeUnit,
  terrainAllows,
} from './context.ts';
import type { Ctx } from './context.ts';
import {
  acceptsAgreement,
  acceptsDeal,
  answerOffer,
  beginWar,
  checkAgreement,
  checkDeal,
  dealPriceFrom,
  endAgreement,
  endDeal,
  endWar,
  isAgreementKind,
  makeOffer,
  makeVassal,
  offerPending,
  signAgreement,
  signDeal,
  submits,
} from './diplomacy.ts';
import { canSee, knowsCity, lookAround } from './fog.ts';
import { KIT, ambitionOf } from './kits.ts';
import { inHomeWaters, nationOf, percentOf, unitMatches, unitMods, visionRange } from './modifiers.ts';
import { checkSlot, checkUnlock, openPolicies, slotPolicy, unlockPolicy } from './policies.ts';
import { addFavour, findAgreement, hasAgreement, isCityState, vassalsOf } from './relations.ts';
import { checkResearch, openTechs, ownsResource, upgradeTargetFor } from './tech.ts';
import {
  checkPillage,
  checkRoute,
  endRoute,
  establishRoute,
  pillage,
  roadStepCost,
  routeSlots,
  routesOf,
} from './trade.ts';
import { capitalsHeld } from './turn.ts';
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
  // What the unit's owner and its type change about moving.
  let fordRivers = false;
  let ignoreHills = false;
  let ignoreRough = false;
  let ownRoad = Infinity;
  if (unit.owner !== NO_POLITY) {
    const def = unitDef(unit.type);
    for (const modifier of unitMods(ctx, unit.owner, def, 'movement')) {
      if (!unitMatches(modifier.unit, def)) continue;
      fordRivers ||= modifier.fordRivers === true;
      ignoreHills ||= modifier.ignoreHills === true;
      ignoreRough ||= modifier.ignoreRough === true;
      if (modifier.roadCost !== undefined) ownRoad = Math.min(ownRoad, modifier.roadCost);
    }
  }
  // A road carries a unit over rivers and rough ground alike.
  const road = roadStepCost(ctx, unit.hex, to);
  if (road !== null) {
    const home = ownerOf(ctx, unit.hex) === unit.owner && ownerOf(ctx, to) === unit.owner;
    return home ? Math.min(road, ownRoad) : road;
  }
  if (!fordRivers) {
    for (let d = 0; d < 6; d++) {
      if (topo.neighbors[unit.hex * 6 + d] === to && ((map.riverEdges[unit.hex] as number) & (1 << d)) !== 0) {
        return unit.moves;
      }
    }
  }
  let cost = topo.moveCost[to] as number;
  if (ignoreHills && map.hills[to] === 1) cost -= MOVE_COST.hills;
  if (ignoreRough && ROUGH_FEATURES.includes(map.feature[to] as number)) cost -= MOVE_COST.roughFeature;
  return cost;
}

/** Why `unit` cannot step onto `to`, or null. Movement points are not checked. */
export function checkStep(ctx: Ctx, unit: Unit, to: number): RejectReason | null {
  if (!isAdjacent(ctx, unit.hex, to)) return 'notAdjacent';
  if (!terrainAllows(ctx, unitDef(unit.type), to, unit.owner)) return 'impassable';
  if (!bordersOpen(ctx, unit.owner, to)) return 'closedBorders';
  if (ctx.unitAt.has(to)) return 'hexOccupied';
  const city = cityAtHex(ctx, to);
  if (city !== null && city.owner !== unit.owner) return 'hexOccupied';
  return null;
}

/** True if the unit counts as inside its owner's borders: on its land, or afloat next to it. */
function inOwnBorders(ctx: Ctx, unit: Unit): boolean {
  return inHomeWaters(ctx, unit.owner, unit.hex);
}

/** Gold it costs to upgrade `unit` to `target`, before what its owner's modifiers change. */
export function upgradeCost(unit: Unit, target: UnitDef): number {
  return Math.max(0, target.cost - unitDef(unit.type).cost) * UPGRADE_GOLD_PER_COST;
}

/** Gold it costs its owner to upgrade `unit` to `target`. */
export function upgradePrice(ctx: Ctx, unit: Unit, target: UnitDef): number {
  const percent = percentOf(ctx, unit.owner, 'upgradeCost');
  return Math.max(0, Math.floor((upgradeCost(unit, target) * (100 + percent)) / 100));
}

/** Why the city cannot make its air strike on `target`, or null. */
function checkAirStrike(ctx: Ctx, city: City, target: unknown): RejectReason | null {
  if (!hasBuilding(city, (building) => building.airStrike)) return 'noAirfield';
  if (city.airStruck) return 'alreadyStruck';
  if (!isHex(ctx, target)) return 'badHex';
  if (hexesApart(ctx, at(ctx.map.zones, city.zone).siteHex, target) > AIR_STRIKE.range) return 'outOfRange';
  const enemyCity = cityAtHex(ctx, target);
  const defender = ctx.unitAt.get(target);
  const victim =
    enemyCity !== null && enemyCity.owner !== city.owner
      ? enemyCity.owner
      : defender !== undefined
        ? defender.owner
        : city.owner;
  if (victim === city.owner) return 'noTarget';
  // Fog of war: a city it does not know of and a unit it cannot see are no targets.
  if (!(enemyCity !== null ? knowsCity(ctx, city.owner, enemyCity) : canSee(ctx, city.owner, target))) return 'noTarget';
  return atWar(ctx, city.owner, victim) ? null : 'atPeace';
}

export { militaryStrength } from './combat.ts';

/** Gold it costs a city to buy the item outright. */
export function buyCost(ctx: Ctx, city: City, item: BuildItem): number {
  return itemCost(ctx, city, item) * BUY.goldPerProduction;
}

/** Why the city cannot buy the item, or null. */
function checkBuy(ctx: Ctx, city: City, item: BuildItem): RejectReason | null {
  if (item.kind !== 'unit' && item.kind !== 'building') return 'cannotBuy';
  if (cityProjectOf(item) !== null) return 'cannotBuy';
  if (city.unrest > 0) return 'inUnrest';
  const reason = checkItem(ctx, city, item, true);
  if (reason !== null) return reason;
  if (item.kind === 'unit' && spawnHex(ctx, city, unitDef(item.unit)) < 0) return 'noRoom';
  return polityOf(ctx, city.owner).gold >= buyCost(ctx, city, item) ? null : 'notEnoughGold';
}

/** True if an AI-run `polity` agrees to end its war with `proposer`. */
export function acceptsPeace(ctx: Ctx, polity: number, proposer: number): boolean {
  const relation = relationOf(ctx, polity, proposer);
  if (relation === undefined || !relation.atWar) return false;
  if ((relation.a === polity ? relation.offerA : relation.offerB) > 0) return true;
  // Only a major nation fights on; everybody else is glad of peace.
  if (!ctx.state.majors.includes(polity)) return true;
  const self = polityOf(ctx, polity);
  // A peace that makes the other its vassal is a victory: it takes it while it has room for vassals,
  // and a leader out for conquest always takes a holder of a major nation's capital.
  if (submits(ctx, proposer, polity)) {
    const conquering = ambitionOf(ctx.state.seed, polity, nationOf(ctx, polity)) === 'conquest';
    if (conquering && capitalsHeld(ctx, proposer) > 0) return true;
    // A leader out for conquest keeps its last place for a holder of a capital.
    const room = (DIPLOMACY.vassalsByEra[self.era] ?? 0) - vassalsOf(ctx, polity).length;
    if (vassalsOf(ctx, polity).length < AI.maxVassals && room > (conquering ? 1 : 0)) return true;
  }
  // A leader out for conquest holds out longer, and a war in which the enemy keeps losing cities is no stalemate.
  const conquering = ambitionOf(ctx.state.seed, polity, nationOf(ctx, polity)) === 'conquest';
  if (self.warWeariness >= (conquering ? AI.conquestPeaceWeariness : AI.peaceWeariness)) return true;
  const progress = Math.max(relation.since, polityOf(ctx, proposer).cityLostOn);
  if (ctx.state.turn - progress >= (conquering ? AI.conquestStalemateTurns : AI.stalemateTurns)) return true;
  return militaryStrength(ctx, polity) < militaryStrength(ctx, proposer) * AI.warStrengthRatio;
}

// --------------------------------------------------------------- validate

function checkAttack(ctx: Ctx, unit: Unit, target: unknown): RejectReason | null {
  const def = unitDef(unit.type);
  if (!isHex(ctx, target)) return 'badHex';
  if (unit.moves <= 0) return 'noMovesLeft';
  if (def.strength <= 0) return 'cannotAttack';
  // From the water a land unit can only storm the shore: a melee onto the land next to it.
  if (isEmbarked(ctx, unit) && def.range > 0) return 'cannotAttack';
  const city = cityAtHex(ctx, target);
  const enemyCity = city !== null && city.owner !== unit.owner ? city : null;
  const defender = ctx.unitAt.get(target);
  const victim = enemyCity !== null ? enemyCity.owner : defender !== undefined ? defender.owner : unit.owner;
  if (victim === unit.owner) return 'noTarget';
  if (!atWar(ctx, unit.owner, victim)) return 'atPeace';
  if (def.range > 0) {
    if (hexesApart(ctx, unit.hex, target) > def.range) return 'outOfRange';
    // Fog of war: a shot needs a city its owner knows of or a unit it can see.
    const known = enemyCity !== null ? knowsCity(ctx, unit.owner, enemyCity) : canSee(ctx, unit.owner, target);
    return known ? null : 'noTarget';
  }
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
      const target = upgradeTargetFor(ctx, unit);
      if (target === null) return 'noUpgrade';
      if (unit.moves <= 0) return 'noMovesLeft';
      if (!inOwnBorders(ctx, unit)) return 'notInOwnBorders';
      return polityOf(ctx, polity).gold >= upgradePrice(ctx, unit, target) ? null : 'notEnoughGold';
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
    case 'setRepeat': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      if (typeof action.repeat !== 'boolean') return 'badAction';
      return city.repeat === action.repeat ? 'alreadySet' : null;
    }
    case 'unqueueBuild': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      return Number.isInteger(action.index) && action.index >= 0 && action.index < city.queue.length
        ? null
        : 'badIndex';
    }
    case 'setResearch':
      return checkResearch(ctx, polity, action.tech);
    case 'airStrike': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      return checkAirStrike(ctx, city, action.target);
    }
    case 'declareWar': {
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      if (atWar(ctx, polity, action.target)) return 'alreadyAtWar';
      // A vassal's wars are its overlord's, and war on a vassal is declared on its overlord.
      if (polityOf(ctx, polity).overlord !== NO_POLITY || polityOf(ctx, action.target).overlord !== NO_POLITY) {
        return 'vassal';
      }
      if (hasAgreement(ctx, 'alliance', polity, action.target)) return 'allied';
      const relation = relationOf(ctx, polity, action.target);
      if (relation !== undefined && state.turn - relation.since < WAR.truceTurns) return 'truce';
      return null;
    }
    case 'makePeace': {
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      const relation = relationOf(ctx, polity, action.target);
      if (relation === undefined || !relation.atWar) return 'notAtWar';
      if (polityOf(ctx, polity).overlord !== NO_POLITY || polityOf(ctx, action.target).overlord !== NO_POLITY) {
        return 'vassal';
      }
      if (state.turn - relation.since < WAR.minTurns) return 'warTooYoung';
      if (action.target === state.player) return null;
      return acceptsPeace(ctx, action.target, polity) ? null : 'refused';
    }
    case 'unlockPolicy':
      return checkUnlock(ctx, polity, action.policy);
    case 'slotPolicy':
      return checkSlot(ctx, polity, action.policy, action.slot);
    case 'propose': {
      if (!isAgreementKind(action.agreement)) return 'badItem';
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      if (action.agreement === 'truce') return validate(ctx, { type: 'makePeace', polity, target: action.target });
      const reason = checkAgreement(ctx, polity, action.target, action.agreement);
      if (reason !== null) return reason;
      if (action.target === state.player) {
        return offerPending(ctx, polity, action.target, action.agreement) ? 'alreadyOffered' : null;
      }
      return acceptsAgreement(ctx, action.target, polity, action.agreement) ? null : 'refused';
    }
    case 'respond': {
      if (typeof action.accept !== 'boolean') return 'badAction';
      return state.offers.some((offer) => offer.id === action.offer && offer.to === polity) ? null : 'noSuchOffer';
    }
    case 'cancelAgreement': {
      if (!isAgreementKind(action.agreement) || action.agreement === 'truce') return 'badItem';
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      const agreement = findAgreement(ctx, action.agreement, polity, action.target);
      if (agreement === undefined) return 'noSuchAgreement';
      // Only the overlord ends a vassalage: it lets its vassal go.
      if (agreement.kind === 'vassalage') return agreement.a === polity ? null : 'vassal';
      return state.turn - agreement.since < DIPLOMACY.minTurns ? 'agreementTooYoung' : null;
    }
    case 'demandVassalage': {
      const unit = ownUnit(ctx, polity, action.unit);
      if (typeof unit === 'string') return unit;
      if (!isHex(ctx, action.target)) return 'badHex';
      return checkDemandVassalage(ctx, unit, action.target);
    }
    case 'proposeDeal': {
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      const reason = checkDeal(ctx, polity, action.target, action.seller, action.resource, action.goldPerTurn);
      if (reason !== null) return reason;
      if (action.target === state.player) {
        return offerPending(ctx, polity, action.target, action.resource) ? 'alreadyOffered' : null;
      }
      return acceptsDeal(ctx, action.target, polity, action.seller, action.resource, action.goldPerTurn)
        ? null
        : 'refused';
    }
    case 'cancelDeal':
      return state.deals.some((deal) => deal.id === action.deal && (deal.seller === polity || deal.buyer === polity))
        ? null
        : 'noSuchDeal';
    case 'establishRoute': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      return checkRoute(ctx, polity, city.zone, action.to);
    }
    case 'cancelRoute':
      return state.routes.some((route) => route.id === action.route && route.owner === polity) ? null : 'noSuchRoute';
    case 'pillage': {
      const unit = ownUnit(ctx, polity, action.unit);
      if (typeof unit === 'string') return unit;
      return checkPillage(ctx, unit);
    }
    case 'buy': {
      const city = ownCity(ctx, polity, action.city);
      if (typeof city === 'string') return city;
      if (typeof action.item !== 'object' || action.item === null) return 'badItem';
      return checkBuy(ctx, city, action.item);
    }
    case 'gift': {
      if (!isPolity(ctx, action.target) || action.target === polity) return 'badTarget';
      if (!Number.isInteger(action.amount) || action.amount < 1) return 'badAmount';
      if (atWar(ctx, polity, action.target)) return 'atWar';
      return polityOf(ctx, polity).gold >= action.amount ? null : 'notEnoughGold';
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
  perform(ctx, action);
  // Fog of war: a unit that has acted looks around from where it now stands.
  if ('unit' in action && typeof action.unit === 'number') {
    const unit = ctx.unitById.get(action.unit);
    if (unit !== undefined) lookAround(ctx, unit.owner, unit.hex, visionRange(ctx, unit));
  }
}

function perform(ctx: Ctx, action: Action): void {
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
      const target = upgradeTargetFor(ctx, unit);
      if (target === null) return;
      polityOf(ctx, action.polity).gold -= upgradePrice(ctx, unit, target);
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
      lookAround(ctx, action.polity, at(ctx.map.zones, zone).siteHex, KIT.cityVision);
      return;
    }
    case 'setFocus': {
      const city = state.cities[action.city] as City;
      city.focus = action.focus;
      assignCitizens(ctx, city);
      return;
    }
    case 'queueBuild': {
      // A generic unit a nation replaces is queued as its unique unit.
      const item =
        action.item.kind === 'unit'
          ? { ...action.item, unit: unitFor(nationOf(ctx, action.polity), action.item.unit) }
          : { ...action.item };
      (state.cities[action.city] as City).queue.push(item);
      return;
    }
    case 'setRepeat':
      (state.cities[action.city] as City).repeat = action.repeat;
      return;
    case 'unqueueBuild': {
      const city = state.cities[action.city] as City;
      city.queue.splice(action.index, 1);
      if (action.index === 0) city.progress = 0;
      return;
    }
    case 'setResearch':
      polityOf(ctx, action.polity).research = action.tech;
      return;
    case 'airStrike':
      resolveAirStrike(ctx, state.cities[action.city] as City, action.target);
      return;
    case 'declareWar':
      beginWar(ctx, action.polity, action.target);
      return;
    case 'makePeace': {
      const relation = relationOf(ctx, action.polity, action.target);
      if (relation === undefined) return;
      const theirOffer = relation.a === action.target ? relation.offerA : relation.offerB;
      if (action.target === state.player && theirOffer <= 0) {
        // A human decides for themselves: leave an offer they can take up.
        if (relation.a === action.polity) relation.offerA = state.turn;
        else relation.offerB = state.turn;
        ctx.events.push({ type: 'peaceOffered', from: action.polity, to: action.target });
        return;
      }
      // Whoever asked for the peace may have to pay for it with its freedom.
      const asker = theirOffer > 0 ? action.target : action.polity;
      const other = asker === action.polity ? action.target : action.polity;
      if (submits(ctx, asker, other)) makeVassal(ctx, asker, other, true);
      else endWar(ctx, action.polity, action.target);
      return;
    }
    case 'unlockPolicy':
      unlockPolicy(ctx, action.polity, action.policy);
      return;
    case 'slotPolicy':
      slotPolicy(ctx, action.polity, action.policy, action.slot);
      return;
    case 'propose': {
      if (action.agreement === 'truce') {
        perform(ctx, { type: 'makePeace', polity: action.polity, target: action.target });
      } else if (action.target === state.player) {
        makeOffer(ctx, {
          id: state.nextId++,
          type: 'agreement',
          from: action.polity,
          to: action.target,
          turn: state.turn,
          agreement: action.agreement,
        });
      } else if (action.agreement === 'vassalage') {
        makeVassal(ctx, action.target, action.polity, false);
      } else {
        signAgreement(ctx, action.agreement, action.polity, action.target);
      }
      return;
    }
    case 'respond': {
      const offer = state.offers.find((entry) => entry.id === action.offer);
      if (offer !== undefined) answerOffer(ctx, offer, action.accept);
      return;
    }
    case 'cancelAgreement': {
      const agreement = findAgreement(ctx, action.agreement, action.polity, action.target);
      if (agreement !== undefined) endAgreement(ctx, agreement, 'cancelled');
      return;
    }
    case 'demandVassalage':
      demandVassalage(ctx, ctx.unitById.get(action.unit) as Unit, action.target);
      return;
    case 'proposeDeal': {
      if (action.target === state.player) {
        makeOffer(ctx, {
          id: state.nextId++,
          type: 'deal',
          from: action.polity,
          to: action.target,
          turn: state.turn,
          seller: action.seller,
          resource: action.resource,
          goldPerTurn: action.goldPerTurn,
        });
      } else {
        const buyer = action.seller === action.polity ? action.target : action.polity;
        signDeal(ctx, action.seller, buyer, action.resource, action.goldPerTurn);
      }
      return;
    }
    case 'cancelDeal': {
      const deal = state.deals.find((entry) => entry.id === action.deal);
      if (deal !== undefined) endDeal(ctx, deal, 'cancelled');
      return;
    }
    case 'establishRoute':
      establishRoute(ctx, action.polity, action.city, action.to);
      return;
    case 'cancelRoute': {
      const route = state.routes.find((entry) => entry.id === action.route);
      if (route !== undefined) endRoute(ctx, route, 'cancelled');
      return;
    }
    case 'pillage':
      pillage(ctx, ctx.unitById.get(action.unit) as Unit);
      return;
    case 'buy': {
      const city = state.cities[action.city] as City;
      const gold = buyCost(ctx, city, action.item);
      if (!deliverItem(ctx, city, action.item)) return;
      polityOf(ctx, action.polity).gold -= gold;
      // What was bought is no longer built: the queue drops it, and work on it is lost.
      if (action.item.kind === 'building') {
        const bought = action.item.building;
        const index = city.queue.findIndex((item) => item.kind === 'building' && item.building === bought);
        if (index === 0) city.progress = 0;
        if (index >= 0) city.queue.splice(index, 1);
      }
      assignCitizens(ctx, city);
      ctx.events.push({ type: 'itemBought', city: city.zone, item: action.item, gold });
      return;
    }
    case 'gift': {
      polityOf(ctx, action.polity).gold -= action.amount;
      polityOf(ctx, action.target).gold += action.amount;
      ctx.events.push({ type: 'goldGifted', from: action.polity, to: action.target, amount: action.amount });
      if (isCityState(ctx, action.target)) {
        addInfluence(ctx, action.target, action.polity, Math.floor(action.amount / CITY_STATE.goldPerInfluence));
      } else {
        addFavour(ctx, action.polity, action.target, Math.floor(action.amount / FAVOUR.goldPerPoint));
      }
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
    offer({ type: 'pillage', polity, unit: unit.id });
    if (def.strength > 0 && def.range === 0 && unit.moves > 0) {
      for (let d = 0; d < 6; d++) {
        const hex = topo.neighbors[unit.hex * 6 + d] as number;
        if (hex >= 0 && cityAtHex(ctx, hex) !== null) {
          offer({ type: 'demandVassalage', polity, unit: unit.id, target: hex });
        }
      }
    }
  }

  for (const city of state.cities) {
    if (city === null || city.owner !== polity) continue;
    for (const focus of FOCUSES) {
      if (focus !== city.focus) out.push({ type: 'setFocus', polity, city: city.zone, focus });
    }
    const items: BuildItem[] = [];
    for (const unit of UNIT_IDS) items.push({ kind: 'unit', unit });
    for (const unit of UNIQUE_UNIT_IDS) items.push({ kind: 'unit', unit });
    for (const building of BUILDING_IDS) items.push({ kind: 'building', building });
    for (const improvement of IMPROVEMENT_IDS) {
      for (const hex of improvableHexes(ctx, city)) {
        if (canImprove(ctx, polity, improvement, hex)) items.push({ kind: 'improvement', improvement, hex });
      }
    }
    items.push({ kind: 'project', project: PROJECT.id });
    state.zoneOwner.forEach((owner, zone) => {
      if (owner === polity && state.cities[zone] === null) items.push({ kind: 'city', zone });
    });
    for (const item of items) offer({ type: 'queueBuild', polity, city: city.zone, item });
    for (const item of items) {
      if (item.kind === 'unit' || item.kind === 'building') offer({ type: 'buy', polity, city: city.zone, item });
    }
    city.queue.forEach((_, index) => out.push({ type: 'unqueueBuild', polity, city: city.zone, index }));
    out.push({ type: 'setRepeat', polity, city: city.zone, repeat: !city.repeat });
    if (hasBuilding(city, (building) => building.airStrike) && !city.airStruck) {
      for (const offset of hexRange(indexToOffset(at(map.zones, city.zone).siteHex, map.width), AIR_STRIKE.range)) {
        if (offset.col < 0 || offset.col >= map.width || offset.row < 0 || offset.row >= map.height) continue;
        offer({ type: 'airStrike', polity, city: city.zone, target: offset.row * map.width + offset.col });
      }
    }
  }

  for (const tech of openTechs(ctx, polity)) {
    if (polityOf(ctx, polity).research !== tech) out.push({ type: 'setResearch', polity, tech });
  }

  for (const policy of openPolicies(ctx, polity)) out.push({ type: 'unlockPolicy', polity, policy });
  const self = polityOf(ctx, polity);
  self.slots.forEach((_, slot) => {
    offer({ type: 'slotPolicy', polity, policy: null, slot });
    for (const policy of self.policies) offer({ type: 'slotPolicy', polity, policy, slot });
  });

  for (let target = 0; target < ctx.n; target++) {
    offer({ type: 'declareWar', polity, target });
    offer({ type: 'makePeace', polity, target });
    offer({ type: 'gift', polity, target, amount: 10 });
    for (const agreement of AGREEMENT_KINDS) {
      // A truce is proposed with `makePeace`.
      if (agreement === 'truce') continue;
      offer({ type: 'propose', polity, target, agreement });
      offer({ type: 'cancelAgreement', polity, target, agreement });
    }
    if (target === polity || !polityOf(ctx, target).alive) continue;
    for (const resource of map.resources) {
      for (const seller of [polity, target]) {
        if (!ownsResource(ctx, seller, resource.id)) continue;
        offer({
          type: 'proposeDeal', polity, target, seller, resource: resource.id,
          goldPerTurn: dealPriceFrom(ctx, seller, resource.id),
        });
      }
    }
  }
  for (const pending of state.offers) {
    if (pending.to !== polity) continue;
    out.push({ type: 'respond', polity, offer: pending.id, accept: true });
    out.push({ type: 'respond', polity, offer: pending.id, accept: false });
  }
  for (const deal of state.deals) {
    if (deal.seller === polity || deal.buyer === polity) out.push({ type: 'cancelDeal', polity, deal: deal.id });
  }

  // Trade routes: every destination in reach of one of its cities, while a slot is free.
  const routes = routesOf(ctx, polity);
  for (const route of routes) out.push({ type: 'cancelRoute', polity, route: route.id });
  if (routes.length < routeSlots(ctx, polity)) {
    const reach = Math.max(TRADE.landRange, TRADE.seaRange);
    for (const city of state.cities) {
      if (city === null || city.owner !== polity) continue;
      const site = at(map.zones, city.zone).siteHex;
      for (const other of state.cities) {
        if (other === null || other === city) continue;
        if (hexesApart(ctx, site, at(map.zones, other.zone).siteHex) > reach) continue;
        offer({ type: 'establishRoute', polity, city: city.zone, to: { kind: 'city', zone: other.zone } });
      }
      map.offMapPorts.forEach((_, port) => {
        offer({ type: 'establishRoute', polity, city: city.zone, to: { kind: 'port', port } });
      });
    }
  }
  return out;
}
