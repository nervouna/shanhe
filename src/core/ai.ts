/**
 * AI v1. Deterministic: it reads only the state, breaks ties by index and
 * keeps its one piece of memory (`PolityState.aiTarget`) in the state. Every
 * decision is issued as an action through the same validator a player uses.
 *
 * - Major nations develop, found their cities, keep an army their income can
 *   pay for, declare war on a weaker neighbour, march on one city at a time
 *   and make peace when the war goes badly.
 * - Other nations and city-states develop and defend.
 */

import { hexRange, indexToOffset } from '../shared/hex.ts';
import {
  AI,
  BUILDINGS,
  BUILDING_IDS,
  CITY,
  FOCUS_WEIGHTS,
  FREE_UNITS_PER_CITY,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  ROSTER,
  SETTLER,
  UNIT_UPKEEP,
  WAR,
  unitDef,
  upgradeTarget,
} from './data.ts';
import type { BuildingId } from './data.ts';
import { checkStep, isSettleSite, militaryStrength, upgradeCost, validate } from './actions.ts';
import { checkItem, improvementFits } from './cities.ts';
import {
  attackStrength,
  cityStrength,
  combatDamage,
  defenceStrength,
  hexesApart,
} from './combat.ts';
import { at, atWar, bordersOpen, cityAtHex, polityOf, relationOf, terrainAllows } from './context.ts';
import type { Ctx } from './context.ts';
import { NO_POLITY } from './types.ts';
import type { Action, BuildItem, City, Unit } from './types.ts';

/** Applies an action if it is legal and says whether it was. */
export type Act = (action: Action) => boolean;

const UNREACHABLE = 32767;
/** Path costs beyond this are not explored. */
const PATH_LIMIT = 60;
/** Cost of a water hex on a land unit's path: crossing is possible but not preferred. */
const WATER_PATH_COST = 3;

/** The order in which the AI adds buildings to a city. */
const BUILDING_ORDER: readonly BuildingId[] = ['granary', 'walls', 'workshop', 'market', 'academy', 'temple', 'harbour'];
/** Field army mix: the class furthest below its share is built next. */
const ARMY_MIX = [
  ['infantry', 3],
  ['ranged', 2],
  ['siege', 2],
  ['cavalry', 1],
] as const;

function isMilitary(unit: Unit): boolean {
  const def = unitDef(unit.type);
  return def.strength > 0 && def.domain === 'land';
}

/** Runs one polity's whole turn. */
export function runAi(ctx: Ctx, polity: number, act: Act): void {
  const { state, map } = ctx;
  const cities = state.cities.filter((city): city is City => city !== null && city.owner === polity);
  if (cities.length === 0) return;
  const kind = at(map.polities, polity).kind;
  const major = kind === 'nation' && state.majors.includes(polity);

  diplomacy(ctx, polity, major, cities, act);
  manageCities(ctx, polity, major, cities, act);
  commandUnits(ctx, polity, major, cities, act);
}

// -------------------------------------------------------------- diplomacy

function enemiesOf(ctx: Ctx, polity: number): number[] {
  const list: number[] = [];
  for (let other = 0; other < ctx.n; other++) if (other !== polity && atWar(ctx, polity, other)) list.push(other);
  return list;
}

function diplomacy(ctx: Ctx, polity: number, major: boolean, cities: City[], act: Act): void {
  const { state, topo } = ctx;
  const self = polityOf(ctx, polity);
  const strength = militaryStrength(ctx, polity);
  const enemies = enemiesOf(ctx, polity);

  for (const enemy of enemies) {
    const relation = relationOf(ctx, polity, enemy);
    if (relation === undefined || state.turn - relation.since < WAR.minTurns) continue;
    const losing =
      self.warWeariness >= AI.peaceWeariness ||
      state.turn - relation.since >= AI.stalemateTurns ||
      strength < militaryStrength(ctx, enemy) * AI.peaceStrengthRatio;
    if (major && !losing) continue;
    const offered = relation.a === polity ? relation.offerA : relation.offerB;
    if (enemy === state.player && offered > 0) continue;
    act({ type: 'makePeace', polity, target: enemy });
  }

  if (!major || state.turn < AI.firstWarTurn || enemiesOf(ctx, polity).length > 0) return;
  if (self.warWeariness > 0) return;
  let field = -cities.length;
  for (const unit of state.units) if (unit.owner === polity && isMilitary(unit)) field++;
  if (field < AI.minFieldUnits) return;

  const neighbours = new Set<number>();
  for (const city of cities) {
    for (const zone of at(topo.zoneNeighbors, city.zone)) {
      const owner = at(state.zoneOwner, zone);
      if (owner !== NO_POLITY && owner !== polity) neighbours.add(owner);
    }
  }
  let target = -1;
  let weakest = Infinity;
  for (const other of [...neighbours].sort((a, b) => a - b)) {
    if (validate(ctx, { type: 'declareWar', polity, target: other }) !== null) continue;
    let defence = militaryStrength(ctx, other);
    for (const city of state.cities) if (city !== null && city.owner === other) defence += cityStrength(ctx, city) / 2;
    if (defence < weakest) {
      weakest = defence;
      target = other;
    }
  }
  if (target >= 0 && strength >= weakest * AI.warStrengthRatio) act({ type: 'declareWar', polity, target });
}

// ----------------------------------------------------------------- cities

interface Plans {
  /** Military land units, alive or queued. */
  military: number;
  /** Units the polity wants. */
  wanted: number;
  /** Units per class, alive or queued. */
  byClass: Record<string, number>;
  settler: boolean;
  atWar: boolean;
  /** One per city. */
  garrisons: number;
  /** Cities busy with a unit. At most half of them are, so that the others develop. */
  barracks: number;
  maxBarracks: number;
}

function armyTarget(ctx: Ctx, polity: number, major: boolean, cities: City[]): number {
  const kind = at(ctx.map.polities, polity).kind;
  if (kind === 'cityState') return 1;
  const free = FREE_UNITS_PER_CITY * cities.length;
  if (!major) return free;
  let buildingUpkeep = 0;
  for (const city of cities) for (const id of city.buildings) buildingUpkeep += BUILDINGS[id].upkeep;
  const spare = Math.max(0, polityOf(ctx, polity).yields.gold - buildingUpkeep);
  return free + Math.floor((spare * AI.armyIncomeShare) / UNIT_UPKEEP);
}

function manageCities(ctx: Ctx, polity: number, major: boolean, cities: City[], act: Act): void {
  const plans: Plans = {
    military: 0,
    wanted: armyTarget(ctx, polity, major, cities),
    byClass: {},
    settler: false,
    atWar: enemiesOf(ctx, polity).length > 0,
    garrisons: cities.length,
    barracks: 0,
    maxBarracks: Math.ceil(cities.length / 2),
  };
  const count = (type: string): void => {
    const def = unitDef(type);
    if (def.id === SETTLER) plans.settler = true;
    if (def.strength <= 0 || def.domain !== 'land') return;
    plans.military++;
    plans.byClass[def.unitClass] = (plans.byClass[def.unitClass] ?? 0) + 1;
  };
  for (const unit of ctx.state.units) if (unit.owner === polity) count(unit.type);
  for (const city of cities) {
    for (const item of city.queue) if (item.kind === 'unit') count(item.unit);
    if (city.queue[0]?.kind === 'unit') plans.barracks++;
  }

  // The most productive cities get the first pick, so they are the ones that recruit.
  const byProduction = [...cities].sort((a, b) => b.yields.production - a.yields.production || a.zone - b.zone);
  for (const city of byProduction) {
    manageFocus(polity, city, act);
    if (city.queue.length > 0) continue;
    const item = chooseBuild(ctx, polity, city, cities, plans);
    if (item === null) continue;
    if (act({ type: 'queueBuild', polity, city: city.zone, item }) && item.kind === 'unit') {
      count(item.unit);
      plans.barracks++;
    }
  }
}

/** A city with food to spare turns to production; one that has stopped growing turns back. */
function manageFocus(polity: number, city: City, act: Act): void {
  const surplus = city.yields.food - city.pop * CITY.foodPerCitizen;
  if (city.focus === 'balanced' && surplus >= AI.productionFocusSurplus) {
    act({ type: 'setFocus', polity, city: city.zone, focus: 'production' });
  } else if (city.focus === 'production' && surplus < AI.balancedFocusSurplus && city.pop < CITY.maxPop) {
    act({ type: 'setFocus', polity, city: city.zone, focus: 'balanced' });
  }
}

function fieldUnit(ctx: Ctx, plans: Plans): BuildItem {
  let best: string = ARMY_MIX[0][0];
  let lowest = Infinity;
  for (const [unitClass, share] of ARMY_MIX) {
    // The garrisons are infantry that never take the field.
    const serving = (plans.byClass[unitClass] ?? 0) - (unitClass === 'infantry' ? plans.garrisons : 0);
    const filled = Math.max(0, serving) / share;
    if (filled < lowest) {
      lowest = filled;
      best = unitClass;
    }
  }
  const roster = ROSTER[best as keyof typeof ROSTER];
  return { kind: 'unit', unit: at(roster, ctx.era) };
}

function chooseImprovement(ctx: Ctx, city: City, hexes: readonly number[]): BuildItem | null {
  const weights = FOCUS_WEIGHTS.balanced;
  let best: BuildItem | null = null;
  let bestGain = 0;
  for (const hex of hexes) {
    if (ctx.state.improvements[hex] !== undefined) continue;
    for (const improvement of IMPROVEMENT_IDS) {
      const def = IMPROVEMENTS[improvement];
      if (!improvementFits(ctx, def, hex)) continue;
      const gain =
        def.yields.food * weights.food + def.yields.production * weights.production + def.yields.gold * weights.gold;
      if (gain > bestGain) {
        bestGain = gain;
        best = { kind: 'improvement', improvement, hex };
      }
    }
  }
  return best !== null && checkItem(ctx, city, best) === null ? best : null;
}

function settleTargetNear(ctx: Ctx, from: number): number {
  const { state, map } = ctx;
  let best = -1;
  let bestDistance = AI.settleRange + 1;
  for (let zone = 0; zone < state.cities.length; zone++) {
    if (state.zoneOwner[zone] !== NO_POLITY || state.cities[zone] !== null) continue;
    const site = at(map.zones, zone).siteHex;
    if (ctx.unitAt.get(site)?.owner === NO_POLITY) continue;
    const distance = hexesApart(ctx, from, site);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = zone;
    }
  }
  return best;
}

function chooseBuild(ctx: Ctx, polity: number, city: City, cities: City[], plans: Plans): BuildItem | null {
  const { state, map } = ctx;
  const nation = at(map.polities, polity).kind === 'nation';
  const can = (item: BuildItem): boolean => checkItem(ctx, city, item) === null;

  // A garrison for every city comes first.
  if (plans.military < Math.min(plans.wanted, cities.length)) {
    return { kind: 'unit', unit: at(ROSTER.infantry, ctx.era) };
  }
  if (nation && city.pop >= AI.expandPop) {
    for (let zone = 0; zone < state.cities.length; zone++) {
      const item: BuildItem = { kind: 'city', zone };
      if (state.zoneOwner[zone] === polity && state.cities[zone] === null && can(item)) return item;
    }
  }
  const recruiting = plans.military < plans.wanted && plans.barracks < plans.maxBarracks;
  if (recruiting && (plans.atWar || plans.military * 2 < plans.wanted)) return fieldUnit(ctx, plans);
  const worked = chooseImprovement(ctx, city, city.worked);
  if (worked !== null) return worked;
  for (const building of BUILDING_ORDER.slice(0, AI.coreBuildings)) {
    const item: BuildItem = { kind: 'building', building };
    if (can(item)) return item;
  }
  if (recruiting) return fieldUnit(ctx, plans);
  if (nation && !plans.settler && city.pop >= AI.expandPop && can({ kind: 'unit', unit: SETTLER })) {
    if (settleTargetNear(ctx, at(map.zones, city.zone).siteHex) >= 0) {
      plans.settler = true;
      return { kind: 'unit', unit: SETTLER };
    }
  }
  for (const building of BUILDING_ORDER) {
    const item: BuildItem = { kind: 'building', building };
    if (can(item)) return item;
  }
  for (const building of BUILDING_IDS) {
    const item: BuildItem = { kind: 'building', building };
    if (can(item)) return item;
  }
  return chooseImprovement(ctx, city, at(ctx.topo.workHexes, city.zone));
}

// ------------------------------------------------------------------ units

/**
 * Cost for one of `polity`'s land units to walk to `goal` from every hex in
 * reach, ignoring other units. `UNREACHABLE` where there is no way within
 * `limit`.
 */
function pathField(ctx: Ctx, polity: number, goal: number, limit = PATH_LIMIT): Int16Array {
  const { topo } = ctx;
  const walker = unitDef(at(ROSTER.infantry, 0));
  const cost = new Int16Array(topo.count).fill(UNREACHABLE);
  // Costs are small integers, so one bucket per cost keeps the frontier in order.
  const buckets: number[][] = [[goal]];
  cost[goal] = 0;
  for (let here = 0; here < buckets.length && here < limit; here++) {
    const bucket = buckets[here];
    if (bucket === undefined) continue;
    for (const hex of bucket) {
      if (cost[hex] !== here) continue; // reached more cheaply since it was queued
      const total = here + (topo.water[hex] === 1 ? WATER_PATH_COST : (topo.moveCost[hex] as number));
      for (let d = 0; d < 6; d++) {
        const next = topo.neighbors[hex * 6 + d] as number;
        if (next < 0 || total >= (cost[next] as number)) continue;
        if (!terrainAllows(ctx, walker, next) || !bordersOpen(ctx, polity, next)) continue;
        cost[next] = total;
        let target = buckets[total];
        if (target === undefined) {
          target = [];
          buckets[total] = target;
        }
        target.push(next);
      }
    }
  }
  return cost;
}

/** Steps the unit down the field while it has movement. Returns true if it moved at all. */
function advanceAlong(ctx: Ctx, unit: Unit, field: Int16Array, act: Act, stopAt: number): boolean {
  let moved = false;
  while (ctx.unitById.has(unit.id) && unit.moves > 0 && (field[unit.hex] as number) > stopAt) {
    let best = -1;
    let bestCost = field[unit.hex] as number;
    for (let d = 0; d < 6; d++) {
      const next = ctx.topo.neighbors[unit.hex * 6 + d] as number;
      if (next < 0 || (field[next] as number) >= bestCost) continue;
      if (checkStep(ctx, unit, next) !== null) continue;
      best = next;
      bestCost = field[next] as number;
    }
    if (best < 0 || !act({ type: 'move', polity: unit.owner, unit: unit.id, to: best })) break;
    moved = true;
  }
  return moved;
}

/**
 * The best target for the unit from where it stands, as a hex, or -1.
 *
 * @param resting the unit is badly hurt: it only shoots, or walks into a fallen city.
 */
function chooseTarget(ctx: Ctx, unit: Unit, focus: number, resting: boolean): number {
  const { map } = ctx;
  const def = unitDef(unit.type);
  const ranged = def.range > 0;
  let best = -1;
  let bestScore = 0;
  for (const offset of hexRange(indexToOffset(unit.hex, map.width), Math.max(1, def.range))) {
    if (offset.col < 0 || offset.col >= map.width || offset.row < 0 || offset.row >= map.height) continue;
    const hex = offset.row * map.width + offset.col;
    if (hex === unit.hex) continue;
    if (validate(ctx, { type: 'attack', polity: unit.owner, unit: unit.id, target: hex }) !== null) continue;
    let score: number;
    const city = cityAtHex(ctx, hex);
    if (city !== null && city.owner !== unit.owner) {
      if (!ranged && city.hp <= 0) {
        score = def.domain === 'land' ? 1000 : 0;
      } else if (ranged) {
        score = 150 + def.cityAttackPercent;
      } else {
        const taken = combatDamage(cityStrength(ctx, city), attackStrength(unit, false, false, false), 1);
        score = taken >= unit.hp ? 0 : 100;
      }
      if (score > 0 && city.zone === focus) score += 20;
    } else {
      const defender = ctx.unitAt.get(hex);
      if (defender === undefined) continue;
      if (defender.owner === NO_POLITY && !ranged) continue; // tribes are left alone
      const defence = defenceStrength(ctx, defender);
      if (unitDef(defender.type).strength === 0) {
        score = 300;
      } else {
        const attack = attackStrength(unit, ranged, false, false);
        const dealt = combatDamage(attack, defence, 1);
        const taken = ranged ? 0 : combatDamage(defence, attack, 1);
        const kills = dealt >= defender.hp;
        if (taken >= unit.hp && !kills) score = 0;
        else if (!kills && taken > dealt * 1.5) score = 0;
        else score = 120 + (kills ? 200 : 0) + dealt - taken / 2;
      }
    }
    if (resting && !ranged && score < 1000) continue;
    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }
  return best;
}

/** The enemy city the army marches on: the one already chosen, or the nearest to one of its own cities. */
function chooseFocus(ctx: Ctx, polity: number, cities: City[]): number {
  const { state, map } = ctx;
  const self = polityOf(ctx, polity);
  const current = self.aiTarget >= 0 ? state.cities[self.aiTarget] : null;
  if (current !== undefined && current !== null && atWar(ctx, polity, current.owner)) return self.aiTarget;
  let best = -1;
  let bestDistance = Infinity;
  for (const city of state.cities) {
    if (city === null || !atWar(ctx, polity, city.owner)) continue;
    const site = at(map.zones, city.zone).siteHex;
    for (const own of cities) {
      const distance = hexesApart(ctx, site, at(map.zones, own.zone).siteHex);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = city.zone;
      }
    }
  }
  self.aiTarget = best;
  return best;
}

function commandUnits(ctx: Ctx, polity: number, major: boolean, cities: City[], act: Act): void {
  const { state, map } = ctx;
  const self = polityOf(ctx, polity);
  const units = state.units.filter((unit) => unit.owner === polity);
  const alive = (unit: Unit): boolean => ctx.unitById.has(unit.id);

  // One garrison per city: the unit on the site, or the nearest free one walks there.
  const garrison = new Set<number>();
  const reinforcing = new Map<number, number>();
  for (const city of cities) {
    const site = at(map.zones, city.zone).siteHex;
    const holder = ctx.unitAt.get(site);
    if (holder !== undefined && holder.owner === polity && isMilitary(holder)) {
      garrison.add(holder.id);
      continue;
    }
    let nearest: Unit | null = null;
    let nearestDistance = Infinity;
    for (const unit of units) {
      if (!isMilitary(unit) || garrison.has(unit.id) || reinforcing.has(unit.id)) continue;
      if (ctx.topo.water[unit.hex] === 1) continue;
      const distance = hexesApart(ctx, unit.hex, site);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = unit;
      }
    }
    if (nearest !== null) reinforcing.set(nearest.id, site);
  }

  const focus = major && enemiesOf(ctx, polity).length > 0 ? chooseFocus(ctx, polity, cities) : -1;
  if (focus < 0) self.aiTarget = -1;
  const field = focus >= 0 ? pathField(ctx, polity, at(map.zones, focus).siteHex) : null;
  if (field !== null) units.sort((a, b) => (field[a.hex] as number) - (field[b.hex] as number) || a.id - b.id);

  for (const unit of units) {
    if (!alive(unit)) continue;
    const def = unitDef(unit.type);

    if (def.id === SETTLER) {
      commandSettler(ctx, unit, act);
      continue;
    }
    if (def.strength <= 0 || def.domain !== 'land') {
      if (unit.status === 'ready') act({ type: 'sleep', polity, unit: unit.id });
      continue;
    }

    const upgrade = upgradeTarget(unit.type);
    if (
      upgrade !== null &&
      upgrade.era <= ctx.era &&
      self.gold >= upgradeCost(unit) + AI.upgradeReserve &&
      act({ type: 'upgrade', polity, unit: unit.id })
    ) {
      continue;
    }

    const site = reinforcing.get(unit.id);
    if (site !== undefined) {
      const home = pathField(ctx, polity, site, 2 * hexesApart(ctx, unit.hex, site) + 8);
      advanceAlong(ctx, unit, home, act, 0);
      continue;
    }

    const holding = garrison.has(unit.id);
    const resting = unit.hp < AI.restHp;
    // A garrison never leaves its city, so it only strikes from a distance.
    for (let step = 0; step < 8 && alive(unit) && unit.moves > 0; step++) {
      const target = holding && def.range === 0 ? -1 : chooseTarget(ctx, unit, focus, resting);
      if (target >= 0) {
        act({ type: 'attack', polity, unit: unit.id, target });
        break;
      }
      if (holding || resting || field === null) break;
      if (!advanceOneStep(ctx, unit, field, act)) break;
    }
    if (alive(unit) && !unit.acted && unit.status !== 'fortified') act({ type: 'fortify', polity, unit: unit.id });
  }
}

/** One step towards the focus, stopping short of the city itself. */
function advanceOneStep(ctx: Ctx, unit: Unit, field: Int16Array, act: Act): boolean {
  const here = field[unit.hex] as number;
  if (here === UNREACHABLE) return false;
  let best = -1;
  let bestCost = here;
  for (let d = 0; d < 6; d++) {
    const next = ctx.topo.neighbors[unit.hex * 6 + d] as number;
    if (next < 0 || (field[next] as number) >= bestCost) continue;
    if (checkStep(ctx, unit, next) !== null) continue;
    best = next;
    bestCost = field[next] as number;
  }
  return best >= 0 && act({ type: 'move', polity: unit.owner, unit: unit.id, to: best });
}

function commandSettler(ctx: Ctx, unit: Unit, act: Act): void {
  const polity = unit.owner;
  if (isSettleSite(ctx, unit.hex)) {
    act({ type: 'settle', polity, unit: unit.id });
    return;
  }
  const zone = settleTargetNear(ctx, unit.hex);
  if (zone < 0) {
    if (unit.status === 'ready') act({ type: 'sleep', polity, unit: unit.id });
    return;
  }
  const field = pathField(ctx, polity, at(ctx.map.zones, zone).siteHex);
  advanceAlong(ctx, unit, field, act, 0);
  if (ctx.unitById.has(unit.id) && isSettleSite(ctx, unit.hex)) act({ type: 'settle', polity, unit: unit.id });
}
