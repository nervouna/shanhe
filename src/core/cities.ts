/** Cities: yields, citizens, growth, the build queue and founding. */

import {
  BUILDINGS,
  CITY,
  CITY_CENTRE_YIELD,
  FOCUS_WEIGHTS,
  IMPROVEMENTS,
  SETTLER,
  SETTLER_COST_STEP_PERCENT,
  UNITS,
  noYields,
  unitDef,
} from './data.ts';
import type { BuildingDef, Focus, ImprovementDef, UnitDef, Yields } from './data.ts';
import {
  addUnit,
  at,
  bordersOpen,
  cityAtHex,
  enforceBorders,
  polityOf,
  terrainAllows,
} from './context.ts';
import type { Ctx } from './context.ts';
import type { BuildItem, City, RejectReason, Unit } from './types.ts';

export function buildingDef(id: string): BuildingDef | undefined {
  return (BUILDINGS as Record<string, BuildingDef>)[id];
}

export function improvementDef(id: string): ImprovementDef | undefined {
  return (IMPROVEMENTS as Record<string, ImprovementDef>)[id];
}

export function hasBuilding(city: City, predicate: (def: BuildingDef) => boolean): boolean {
  return city.buildings.some((id) => predicate(BUILDINGS[id]));
}

export function maxCityHp(city: City): number {
  let hp: number = CITY.hp;
  for (const id of city.buildings) hp += BUILDINGS[id].cityHp;
  return hp;
}

// ---------------------------------------------------------------- yields

interface HexScore {
  hex: number;
  food: number;
  production: number;
  gold: number;
  score: number;
}

/** The yields of every hex the city could work, best first under the focus. */
function scoreHexes(ctx: Ctx, city: City, focus: Focus): HexScore[] {
  const { topo, state } = ctx;
  const weights = FOCUS_WEIGHTS[focus];
  let waterFood = 0;
  let waterProduction = 0;
  let waterGold = 0;
  for (const id of city.buildings) {
    const bonus: Partial<Yields> = BUILDINGS[id].waterYields;
    waterFood += bonus.food ?? 0;
    waterProduction += bonus.production ?? 0;
    waterGold += bonus.gold ?? 0;
  }
  const scores: HexScore[] = [];
  for (const hex of at(topo.workHexes, city.zone)) {
    let food = topo.baseFood[hex] as number;
    let production = topo.baseProduction[hex] as number;
    let gold = topo.baseGold[hex] as number;
    const improvement = state.improvements[hex];
    if (improvement !== undefined) {
      const bonus = IMPROVEMENTS[improvement].yields;
      food += bonus.food;
      production += bonus.production;
      gold += bonus.gold;
    }
    if (topo.water[hex] === 1) {
      food += waterFood;
      production += waterProduction;
      gold += waterGold;
    }
    scores.push({
      hex,
      food,
      production,
      gold,
      score: food * weights.food + production * weights.production + gold * weights.gold,
    });
  }
  return scores.sort((x, y) => y.score - x.score || x.hex - y.hex);
}

/**
 * The hexes the citizens work: the best under the focus, then, while the
 * city would starve, the leanest of them swapped for the richest in food
 * that is still free. Nobody starves for the sake of a focus.
 */
function pickHexes(ctx: Ctx, city: City): HexScore[] {
  const scores = scoreHexes(ctx, city, city.focus);
  const picked = scores.slice(0, city.pop);
  const spare = scores.slice(city.pop).sort((x, y) => y.food - x.food || y.score - x.score || x.hex - y.hex);
  let food = picked.reduce((sum, entry) => sum + entry.food, CITY_CENTRE_YIELD.food);
  const need = city.pop * CITY.foodPerCitizen;
  while (food < need && spare.length > 0) {
    let leanest = 0;
    picked.forEach((entry, index) => {
      const current = at(picked, leanest);
      if (entry.food < current.food || (entry.food === current.food && entry.score < current.score)) leanest = index;
    });
    const richest = at(spare, 0);
    if (richest.food <= at(picked, leanest).food) break;
    food += richest.food - at(picked, leanest).food;
    picked[leanest] = richest;
    spare.shift();
  }
  return picked;
}

/** Morale of a city: 100, less its polity's war weariness, less unrest. */
function cityMorale(ctx: Ctx, city: City): number {
  const morale = 100 - polityOf(ctx, city.owner).warWeariness - (city.unrest > 0 ? CITY.unrestMorale : 0);
  return Math.max(0, Math.min(100, morale));
}

/** Puts the citizens on hexes according to the focus and recomputes morale and yields. */
export function assignCitizens(ctx: Ctx, city: City): void {
  const picked = pickHexes(ctx, city);

  const yields: Yields = { ...CITY_CENTRE_YIELD };
  for (const entry of picked) {
    yields.food += entry.food;
    yields.production += entry.production;
    yields.gold += entry.gold;
  }
  yields.science += Math.floor(city.pop / CITY.popPerScience);
  yields.gold += Math.floor(city.pop / CITY.popPerGold);
  const percent = noYields();
  for (const id of city.buildings) {
    const def: BuildingDef = BUILDINGS[id];
    for (const key of YIELD_KEYS) {
      yields[key] += def.yields[key] ?? 0;
      percent[key] += def.percent[key] ?? 0;
    }
  }
  for (const key of YIELD_KEYS) yields[key] = Math.floor((yields[key] * (100 + percent[key])) / 100);

  city.morale = cityMorale(ctx, city);
  const factor = CITY.moraleFloor + ((1 - CITY.moraleFloor) * city.morale) / 100;
  yields.production = city.unrest > 0 ? 0 : Math.floor(yields.production * factor);
  yields.gold = Math.floor(yields.gold * factor);

  city.worked = picked.map((entry) => entry.hex).sort((a, b) => a - b);
  city.yields = yields;
}

export const YIELD_KEYS = ['food', 'production', 'gold', 'science', 'culture'] as const;

// ----------------------------------------------------------- build items

/** Production cost of an item for this city. */
export function itemCost(ctx: Ctx, city: City, item: BuildItem): number {
  switch (item.kind) {
    case 'unit': {
      const def = UNITS[item.unit];
      if (def === undefined) return 0;
      if (def.id !== SETTLER) return def.cost;
      const built = polityOf(ctx, city.owner).settlersBuilt;
      return Math.round((def.cost * (100 + SETTLER_COST_STEP_PERCENT * built)) / 100);
    }
    case 'building':
      return buildingDef(item.building)?.cost ?? 0;
    case 'improvement':
      return improvementDef(item.improvement)?.cost ?? 0;
    case 'city':
      return CITY.foundCost;
  }
}

function sameItem(a: BuildItem, b: BuildItem): boolean {
  if (a.kind === 'building' && b.kind === 'building') return a.building === b.building;
  if (a.kind === 'improvement' && b.kind === 'improvement') return a.hex === b.hex;
  if (a.kind === 'city' && b.kind === 'city') return a.zone === b.zone;
  return false;
}

/** True if `improvement` may stand on `hex` as far as terrain goes. */
export function improvementFits(ctx: Ctx, def: ImprovementDef, hex: number): boolean {
  const { map } = ctx;
  if (!def.terrains.includes(map.terrain[hex] as number)) return false;
  if (!def.features.includes(map.feature[hex] as number)) return false;
  const hilly = map.hills[hex] === 1;
  return def.hills === 'any' || (def.hills === 'yes') === hilly;
}

/**
 * Why the city cannot build the item, or null if it can.
 *
 * @param queued true when the item already sits in the queue, so that being
 *   queued is not itself a reason.
 */
export function checkItem(ctx: Ctx, city: City, item: BuildItem, queued = false): RejectReason | null {
  const { state, map, topo } = ctx;
  const kind = at(map.polities, city.owner).kind;
  switch (item.kind) {
    case 'unit': {
      const def = UNITS[item.unit];
      if (def === undefined || !def.buildable) return 'badItem';
      if (def.id === SETTLER && kind !== 'nation') return 'badItem';
      if (def.era > ctx.era) return 'eraTooEarly';
      if (def.domain === 'sea' && topo.coastal[city.zone] !== true) return 'needsCoast';
      return null;
    }
    case 'building': {
      const def = buildingDef(item.building);
      if (def === undefined) return 'badItem';
      if (def.era > ctx.era) return 'eraTooEarly';
      if (city.buildings.includes(item.building)) return 'alreadyBuilt';
      if (def.coastal && topo.coastal[city.zone] !== true) return 'needsCoast';
      break;
    }
    case 'improvement': {
      const def = improvementDef(item.improvement);
      if (def === undefined) return 'badItem';
      if (!Number.isInteger(item.hex) || item.hex < 0 || item.hex >= topo.count) return 'badHex';
      if (topo.workZone[item.hex] !== city.zone) return 'badHex';
      if (!improvementFits(ctx, def, item.hex)) return 'badHex';
      if (state.improvements[item.hex] !== undefined) return 'alreadyBuilt';
      break;
    }
    case 'city': {
      if (kind !== 'nation') return 'badItem';
      if (!Number.isInteger(item.zone) || item.zone < 0 || item.zone >= state.cities.length) return 'badItem';
      if (state.zoneOwner[item.zone] !== city.owner) return 'badItem';
      if (state.cities[item.zone] !== null) return 'alreadyBuilt';
      if (!queued) {
        for (const other of state.cities) {
          if (other !== null && other.owner === city.owner && other.queue.some((q) => sameItem(q, item))) {
            return 'alreadyQueued';
          }
        }
      }
      return null;
    }
    default:
      return 'badItem';
  }
  if (!queued && city.queue.some((q) => sameItem(q, item))) return 'alreadyQueued';
  return null;
}

// --------------------------------------------------------------- founding

/** Creates a city on the zone's site for `owner` and gives the zone to it. */
export function foundCity(ctx: Ctx, zone: number, owner: number): City {
  const { state, map } = ctx;
  const original = at(map.polities, at(map.zones, zone).polity);
  const city: City = {
    zone,
    owner,
    originalOwner: original.kind === 'wastelandRegion' ? -1 : at(map.zones, zone).polity,
    pop: 1,
    food: 0,
    hp: CITY.hp,
    focus: 'balanced',
    buildings: [],
    queue: [],
    progress: 0,
    unrest: 0,
    morale: 100,
    struck: false,
    attackedOn: 0,
    worked: [],
    yields: noYields(),
  };
  state.cities[zone] = city;
  const settled = state.zoneOwner[zone] !== owner;
  state.zoneOwner[zone] = owner;
  const polity = polityOf(ctx, owner);
  if (polity.capital < 0) polity.capital = zone;
  assignCitizens(ctx, city);
  state.stats.citiesFounded++;
  ctx.events.push({ type: 'cityFounded', city: zone, owner });
  if (settled) enforceBorders(ctx);
  return city;
}

/** The hex a new unit of the city appears on, or -1 if there is no room. */
export function spawnHex(ctx: Ctx, city: City, def: UnitDef): number {
  const { topo, map } = ctx;
  const site = at(map.zones, city.zone).siteHex;
  if (def.domain === 'land' && !ctx.unitAt.has(site)) return site;
  for (let d = 0; d < 6; d++) {
    const hex = topo.neighbors[site * 6 + d] as number;
    if (hex < 0 || ctx.unitAt.has(hex) || !terrainAllows(ctx, def, hex)) continue;
    if ((topo.water[hex] === 1) !== (def.domain === 'sea')) continue;
    if (!bordersOpen(ctx, city.owner, hex) || cityAtHex(ctx, hex) !== null) continue;
    return hex;
  }
  return -1;
}

/** True if the site of `zone` is free for its owner to found a city on. */
function siteFree(ctx: Ctx, zone: number, owner: number): boolean {
  const unit: Unit | undefined = ctx.unitAt.get(at(ctx.map.zones, zone).siteHex);
  return unit === undefined || unit.owner === owner;
}

/** Finishes the item. Returns false if it has to wait (no room for the unit, site occupied). */
function completeItem(ctx: Ctx, city: City, item: BuildItem): boolean {
  switch (item.kind) {
    case 'unit': {
      const def = unitDef(item.unit);
      const hex = spawnHex(ctx, city, def);
      if (hex < 0) return false;
      addUnit(ctx, def.id, city.owner, hex);
      if (def.id === SETTLER) polityOf(ctx, city.owner).settlersBuilt++;
      return true;
    }
    case 'building':
      city.buildings.push(item.building);
      return true;
    case 'improvement':
      ctx.state.improvements[item.hex] = item.improvement;
      return true;
    case 'city':
      if (!siteFree(ctx, item.zone, city.owner)) return false;
      foundCity(ctx, item.zone, city.owner);
      return true;
  }
}

// --------------------------------------------------------- turn processing

/** One turn of a city: citizens, growth, production, repairs. */
export function processCity(ctx: Ctx, city: City): void {
  const { state } = ctx;
  assignCitizens(ctx, city);

  // Growth.
  city.food += city.yields.food - city.pop * CITY.foodPerCitizen;
  const need = CITY.growthBase + CITY.growthPerPop * city.pop;
  if (city.food >= need && city.pop < CITY.maxPop) {
    city.food -= need;
    city.pop++;
    ctx.events.push({ type: 'cityPopulation', city: city.zone, pop: city.pop });
  } else if (city.food < 0) {
    city.food = 0;
    if (city.pop > 1) {
      city.pop--;
      ctx.events.push({ type: 'cityPopulation', city: city.zone, pop: city.pop });
    }
  }
  city.food = Math.min(city.food, need);

  // Production: at most one item is finished per turn.
  while (city.queue.length > 0 && checkItem(ctx, city, at(city.queue, 0), true) !== null) city.queue.shift();
  const item = city.queue[0];
  if (item !== undefined) {
    city.progress += city.yields.production;
    const cost = itemCost(ctx, city, item);
    if (city.progress >= cost && completeItem(ctx, city, item)) {
      city.progress -= cost;
      city.queue.shift();
      ctx.events.push({ type: 'cityBuilt', city: city.zone, item });
    }
  }

  // Repairs, unless the city was attacked this turn.
  const maxHp = maxCityHp(city);
  if (city.attackedOn < state.turn) city.hp = Math.min(maxHp, city.hp + CITY.heal);
  city.hp = Math.min(city.hp, maxHp);
  city.struck = false;
  if (city.unrest > 0) city.unrest--;
}
