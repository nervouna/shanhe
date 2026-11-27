/** Cities: yields, citizens, growth, the build queue and founding. */

import {
  BUILDINGS,
  CITY,
  CITY_CENTRE_YIELD,
  CITY_STATE,
  COMBAT,
  FOCUS_WEIGHTS,
  IMPROVEMENTS,
  MODERN_LAND_ERA,
  PROJECT,
  SETTLER,
  SETTLER_COST_STEP_PERCENT,
  SPECIALTY,
  UNITS,
  noYields,
  unitDef,
} from './data.ts';
import { suzerainCount } from './cityStates.ts';
import { policySum, slotted } from './policies.ts';
import { partnersIn } from './relations.ts';
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
import { checkUnit, knows, researches, specialtiesOf } from './tech.ts';
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
  const cards = slotted(ctx, city.owner);
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
    // A pillaged improvement yields nothing until it is repaired.
    if (improvement !== undefined && (state.pillaged[hex] ?? 0) < state.turn) {
      const bonus = IMPROVEMENTS[improvement].yields;
      food += bonus.food;
      production += bonus.production;
      gold += bonus.gold;
      for (const card of cards) {
        const extra = card.improvementYields?.[improvement];
        if (extra === undefined) continue;
        food += extra.food ?? 0;
        production += extra.production ?? 0;
        gold += extra.gold ?? 0;
      }
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

  // Policy cards.
  const owner = city.owner;
  const capital = polityOf(ctx, owner).capital === city.zone;
  for (const card of slotted(ctx, owner)) {
    if (card.popPerScience !== undefined) yields.science += Math.floor(city.pop / card.popPerScience);
    for (const key of YIELD_KEYS) {
      if (capital) yields[key] += card.capitalYields?.[key] ?? 0;
      else percent[key] += card.nonCapitalPercent?.[key] ?? 0;
      percent[key] += card.cityPercent?.[key] ?? 0;
      for (const id of city.buildings) {
        yields[key] += card.buildingYields?.[id]?.[key] ?? 0;
        percent[key] += card.buildingPercent?.[id]?.[key] ?? 0;
      }
    }
  }
  // Specialties, trade pacts and the city-states the owner is suzerain of.
  yields.gold += SPECIALTY.goldPerCity * Math.min(SPECIALTY.max, specialtiesOf(ctx, owner).length);
  percent.gold += tradePactGoldPercent(ctx, owner);
  percent.gold += CITY_STATE.financeGoldPercent * suzerainCount(ctx, owner, 'finance');
  if (capital) {
    yields.culture += CITY_STATE.cultureInCapital * suzerainCount(ctx, owner, 'culture');
    percent.production += CITY_STATE.industryCapitalProductionPercent * suzerainCount(ctx, owner, 'industry');
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

/**
 * Percentage of city gold the polity gets from the Treaty ports card: its
 * own card when it has a trade pact, or that of a trade-pact partner. The
 * bonus counts once however many pacts carry it.
 */
export function tradePactGoldPercent(ctx: Ctx, polity: number): number {
  const partners = partnersIn(ctx, 'tradePact', polity);
  if (partners.length === 0) return 0;
  let percent = policySum(ctx, polity, 'tradePactGoldPercent');
  for (const partner of partners) percent = Math.max(percent, policySum(ctx, partner, 'tradePactGoldPercent'));
  return percent;
}

/** Production the city puts into `item` this turn: its production, plus what its owner's cards add for the kind of item. */
export function productionTowards(ctx: Ctx, city: City, item: BuildItem): number {
  let percent = 0;
  if (item.kind === 'unit') {
    const def = UNITS[item.unit];
    percent += policySum(ctx, city.owner, 'unitProductionPercent');
    if (def !== undefined && def.domain === 'land' && def.strength > 0 && def.era >= MODERN_LAND_ERA) {
      percent += policySum(ctx, city.owner, 'modernLandUnitProductionPercent');
    }
  } else if (item.kind === 'building') {
    percent += policySum(ctx, city.owner, 'buildingProductionPercent');
  }
  return Math.floor((city.yields.production * (100 + percent)) / 100);
}

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
    case 'project':
      return PROJECT.stages[polityOf(ctx, city.owner).projectStage]?.cost ?? 0;
  }
}

function sameItem(a: BuildItem, b: BuildItem): boolean {
  if (a.kind === 'building' && b.kind === 'building') return a.building === b.building;
  if (a.kind === 'improvement' && b.kind === 'improvement') return a.hex === b.hex;
  if (a.kind === 'city' && b.kind === 'city') return a.zone === b.zone;
  if (a.kind === 'project' && b.kind === 'project') return a.project === b.project;
  return false;
}

/**
 * True if `improvement` may stand on `hex` as far as terrain goes, for a
 * polity that knows the tech which lets it stand on hills (`onHills`).
 */
export function improvementFits(ctx: Ctx, def: ImprovementDef, hex: number, onHills = false): boolean {
  const { map } = ctx;
  if (!def.terrains.includes(map.terrain[hex] as number)) return false;
  if (!def.features.includes(map.feature[hex] as number)) return false;
  if (def.river === true && map.riverEdges[hex] === 0) return false;
  const hilly = map.hills[hex] === 1;
  if (hilly && onHills && def.hillsTech !== undefined) return true;
  return def.hills === 'any' || (def.hills === 'yes') === hilly;
}

/** True if `polity` knows the tech that lets the improvement stand on hills. */
export function improvesHills(ctx: Ctx, def: ImprovementDef, polity: number): boolean {
  return def.hillsTech !== undefined && knows(ctx, polity, def.hillsTech);
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
      const reason = checkUnit(ctx, city.owner, def);
      if (reason !== null) return reason;
      if (def.domain === 'sea' && topo.coastal[city.zone] !== true) return 'needsCoast';
      return null;
    }
    case 'building': {
      const def = buildingDef(item.building);
      if (def === undefined) return 'badItem';
      if (!knows(ctx, city.owner, def.tech)) return 'needsTech';
      if (city.buildings.includes(item.building)) return 'alreadyBuilt';
      if (def.coastal && topo.coastal[city.zone] !== true) return 'needsCoast';
      break;
    }
    case 'improvement': {
      const def = improvementDef(item.improvement);
      if (def === undefined) return 'badItem';
      if (!Number.isInteger(item.hex) || item.hex < 0 || item.hex >= topo.count) return 'badHex';
      if (topo.workZone[item.hex] !== city.zone) return 'badHex';
      if (!knows(ctx, city.owner, def.tech)) return 'needsTech';
      if (!improvementFits(ctx, def, item.hex, improvesHills(ctx, def, city.owner))) return 'badHex';
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
    case 'project': {
      if (item.project !== PROJECT.id) return 'badItem';
      // Only those who can win build it: the major nations and the player.
      if (kind !== 'nation' || !researches(state, city.owner)) return 'badItem';
      const polity = polityOf(ctx, city.owner);
      if (polity.capital !== city.zone) return 'notCapital';
      const stage = PROJECT.stages[polity.projectStage];
      if (stage === undefined) return 'alreadyBuilt';
      if (!knows(ctx, city.owner, stage.tech)) return 'needsTech';
      break;
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
    airStruck: false,
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
    if (hex < 0 || ctx.unitAt.has(hex) || !terrainAllows(ctx, def, hex, city.owner)) continue;
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

/**
 * Finishes the item, built or bought. Returns false if it has to wait (no
 * room for the unit, site occupied).
 */
export function deliverItem(ctx: Ctx, city: City, item: BuildItem): boolean {
  switch (item.kind) {
    case 'unit': {
      const def = unitDef(item.unit);
      const hex = spawnHex(ctx, city, def);
      if (hex < 0) return false;
      const unit = addUnit(ctx, def.id, city.owner, hex);
      if (def.id === SETTLER) polityOf(ctx, city.owner).settlersBuilt++;
      if (def.domain === 'sea') {
        // Ships of the suzerain of a naval city-state start with experience.
        unit.xp = CITY_STATE.navalXp * suzerainCount(ctx, city.owner, 'naval');
        while (unit.level < COMBAT.levelXp.length && unit.xp >= at(COMBAT.levelXp, unit.level)) unit.level++;
      }
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
    case 'project': {
      const polity = polityOf(ctx, city.owner);
      polity.projectStage++;
      ctx.events.push({ type: 'projectStageFinished', polity: city.owner, city: city.zone, stage: polity.projectStage });
      return true;
    }
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
    city.progress += productionTowards(ctx, city, item);
    const cost = itemCost(ctx, city, item);
    if (city.progress >= cost && deliverItem(ctx, city, item)) {
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
  city.airStruck = false;
  if (city.unrest > 0) city.unrest--;
}
