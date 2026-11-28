/** Cities: yields, citizens, growth, the build queue and founding. */

import { Terrain } from '../shared/mapData.ts';
import {
  BUILDINGS,
  CITY,
  CAPITAL_PERCENT,
  CITY_CENTRE_YIELD,
  CITY_STATE,
  COMBAT,
  FOCUS_WEIGHTS,
  IMPROVEMENTS,
  PROJECT,
  SETTLER,
  SETTLER_COST_STEP_PERCENT,
  SPECIALTY,
  UNITS,
  baseBuilding,
  baseImprovement,
  buildingFor,
  improvementFor,
  noYields,
  unitDef,
  unitFor,
} from './data.ts';
import { suzerainCount } from './cityStates.ts';
import {
  addYields,
  cityMatches,
  cityMods,
  hasBuildingKind,
  hexMatches,
  modsOf,
  nationOf,
  perCount,
  percentOf,
  routeMatches,
  unitMatches,
} from './modifiers.ts';
import { isNation, partnersIn } from './relations.ts';
import type { BuildingDef, Focus, ImprovementDef, ImprovementId, UnitDef, Yields } from './data.ts';
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
import { NO_POLITY } from './types.ts';
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
  science: number;
  culture: number;
  score: number;
}

/**
 * The hexes the city's citizens may work: those of its zone and the water in
 * reach, and any mountain hex of the zone that carries an improvement.
 */
export function workableHexes(ctx: Ctx, city: City): readonly number[] {
  const hexes = at(ctx.topo.workHexes, city.zone);
  const improved = at(ctx.topo.zoneMountains, city.zone).filter((hex) => ctx.state.improvements[hex] !== undefined);
  return improved.length === 0 ? hexes : [...hexes, ...improved];
}

/** The yields of every hex the city could work, best first under the focus. */
function scoreHexes(ctx: Ctx, city: City, focus: Focus): HexScore[] {
  const { topo, state } = ctx;
  const weights = FOCUS_WEIGHTS[focus];
  const bonuses = cityMods(ctx, city, 'hexYield');
  const extra = noYields();
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
  for (const hex of workableHexes(ctx, city)) {
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
    }
    if (topo.water[hex] === 1) {
      food += waterFood;
      production += waterProduction;
      gold += waterGold;
    }
    let science = 0;
    let culture = 0;
    if (bonuses.length > 0) {
      extra.food = extra.production = extra.gold = extra.science = extra.culture = 0;
      for (const bonus of bonuses) if (hexMatches(ctx, bonus.hex, hex)) addYields(extra, bonus.yields);
      food += extra.food;
      production += extra.production;
      gold += extra.gold;
      science = extra.science;
      culture = extra.culture;
    }
    scores.push({
      hex,
      food,
      production,
      gold,
      science,
      culture,
      // Science and culture of a hex count like gold when the citizens choose.
      score: food * weights.food + production * weights.production + (gold + science + culture) * weights.gold,
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

/** Morale of a city: 100, less its polity's war weariness, less unrest, plus what modifiers add. */
export function cityMorale(ctx: Ctx, city: City): number {
  let morale = 100 - polityOf(ctx, city.owner).warWeariness - (city.unrest > 0 ? CITY.unrestMorale : 0);
  for (const modifier of cityMods(ctx, city, 'morale')) {
    if (cityMatches(ctx, modifier.city, city)) morale += modifier.morale;
  }
  return Math.max(0, Math.min(100, morale));
}

/**
 * What the city yields before percentages and morale are applied, and the
 * percentages: the hexes its citizens work, its centre, its population, its
 * buildings and every modifier.
 */
export function cityYieldParts(ctx: Ctx, city: City): { flat: Yields; percent: Yields } {
  return yieldParts(ctx, city, pickHexes(ctx, city));
}

/** The yields of one hex for the city that works it, improvements, buildings and modifiers included. */
export function hexYields(ctx: Ctx, city: City, hex: number): Yields {
  const out = noYields();
  const { topo, state } = ctx;
  out.food = topo.baseFood[hex] as number;
  out.production = topo.baseProduction[hex] as number;
  out.gold = topo.baseGold[hex] as number;
  const improvement = state.improvements[hex];
  if (improvement !== undefined && (state.pillaged[hex] ?? 0) < state.turn) addYields(out, IMPROVEMENTS[improvement].yields);
  if (topo.water[hex] === 1) for (const id of city.buildings) addYields(out, BUILDINGS[id].waterYields);
  for (const bonus of cityMods(ctx, city, 'hexYield')) if (hexMatches(ctx, bonus.hex, hex)) addYields(out, bonus.yields);
  return out;
}

/** Puts the citizens on hexes according to the focus and recomputes morale and yields. */
export function assignCitizens(ctx: Ctx, city: City): void {
  const picked = pickHexes(ctx, city);
  const { flat: yields, percent } = yieldParts(ctx, city, picked);
  for (const key of YIELD_KEYS) yields[key] = Math.floor((yields[key] * (100 + percent[key])) / 100);

  city.morale = cityMorale(ctx, city);
  const factor = CITY.moraleFloor + ((1 - CITY.moraleFloor) * city.morale) / 100;
  yields.production = city.unrest > 0 ? 0 : Math.floor(yields.production * factor);
  yields.gold = Math.floor(yields.gold * factor);

  city.worked = picked.map((entry) => entry.hex).sort((a, b) => a - b);
  city.yields = yields;
}

function yieldParts(ctx: Ctx, city: City, picked: readonly HexScore[]): { flat: Yields; percent: Yields } {
  const yields: Yields = { ...CITY_CENTRE_YIELD };
  for (const entry of picked) {
    yields.food += entry.food;
    yields.production += entry.production;
    yields.gold += entry.gold;
    yields.science += entry.science;
    yields.culture += entry.culture;
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

  // Modifiers: policy cards, the trait, the leader and the city's own buildings.
  const owner = city.owner;
  const capital = polityOf(ctx, owner).capital === city.zone;
  for (const modifier of cityMods(ctx, city, 'cityYield')) {
    if (!cityMatches(ctx, modifier.city, city)) continue;
    const count = perCount(ctx, modifier.per, city);
    if (count !== 0) addYields(yields, modifier.yields, count);
  }
  for (const modifier of cityMods(ctx, city, 'cityPercent')) {
    if (modifier.building !== undefined && !hasBuildingKind(city, modifier.building)) continue;
    if (cityMatches(ctx, modifier.city, city)) addYields(percent, modifier.percent);
  }
  const routeYields = cityMods(ctx, city, 'routeYield');
  if (routeYields.length > 0) {
    for (const route of ctx.state.routes) {
      if (route.owner !== owner || route.from !== city.zone || route.pillagedUntil >= ctx.state.turn) continue;
      for (const modifier of routeYields) if (routeMatches(ctx, modifier.route, route)) addYields(yields, modifier.yields);
    }
  }
  // Specialties, trade pacts and the city-states the owner is suzerain of.
  yields.gold += Math.floor(
    (SPECIALTY.goldPerCity * Math.min(SPECIALTY.max, specialtiesOf(ctx, owner).length) *
      (100 + percentOf(ctx, owner, 'specialtyGold'))) /
      100,
  );
  percent.gold += tradePactGoldPercent(ctx, owner);
  percent.gold += CITY_STATE.financeGoldPercent * suzerainCount(ctx, owner, 'finance');
  if (capital) {
    // The seat of government.
    if (isNation(ctx, owner)) for (const key of YIELD_KEYS) percent[key] += CAPITAL_PERCENT[key] ?? 0;
    yields.culture += CITY_STATE.cultureInCapital * suzerainCount(ctx, owner, 'culture');
    percent.production += CITY_STATE.industryCapitalProductionPercent * suzerainCount(ctx, owner, 'industry');
  }
  return { flat: yields, percent };
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
  const own = (who: number): number => {
    let total = 0;
    for (const modifier of modsOf(ctx, who, 'tradePactGold')) total += modifier.percent;
    return total;
  };
  let percent = own(polity);
  for (const partner of partners) percent = Math.max(percent, own(partner));
  return percent;
}

/** Production the city puts into `item` this turn: its production, plus what modifiers add for the kind of item. */
export function productionTowards(ctx: Ctx, city: City, item: BuildItem): number {
  return Math.floor((city.yields.production * (100 + productionPercent(ctx, city, item))) / 100);
}

/** Percentage modifiers add to the city's production while it builds `item`. */
export function productionPercent(ctx: Ctx, city: City, item: BuildItem): number {
  let percent = 0;
  for (const modifier of cityMods(ctx, city, 'production')) {
    if (modifier.item !== item.kind) continue;
    if (item.kind === 'unit') {
      const def = UNITS[unitFor(nationOf(ctx, city.owner), item.unit)];
      if (modifier.unit !== undefined && (def === undefined || !unitMatches(modifier.unit, def))) continue;
    } else if (item.kind === 'building') {
      if (modifier.building !== undefined && baseBuilding(item.building) !== modifier.building) continue;
      if (modifier.firstBuilding === true && city.buildings.length > 0) continue;
    }
    percent += modifier.percent;
  }
  return percent;
}

// ----------------------------------------------------------- build items

/** Production cost of an item for this city. */
export function itemCost(ctx: Ctx, city: City, item: BuildItem): number {
  switch (item.kind) {
    case 'unit': {
      const def = UNITS[unitFor(nationOf(ctx, city.owner), item.unit)];
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
 * True if a city of `polity` may put the improvement on the hex as far as
 * the ground goes: its terrain, feature, river, shore and hills, with what
 * the polity's techs and modifiers allow beyond the improvement's own rules.
 */
export function canImprove(ctx: Ctx, polity: number, id: ImprovementId, hex: number): boolean {
  const { map, topo } = ctx;
  const def: ImprovementDef = IMPROVEMENTS[id];
  const kind = baseImprovement(id);
  const terrain = map.terrain[hex] as number;
  let terrainFits = def.terrains.includes(terrain);
  let hillsFree = improvesHills(ctx, def, polity);
  let granted = false;
  for (const modifier of modsOf(ctx, polity, 'improvementSite')) {
    if (!modifier.improvements.includes(kind)) continue;
    if (modifier.terrains?.includes(terrain) === true) {
      terrainFits = true;
      granted = true;
    }
    if (modifier.hills === true) hillsFree = true;
  }
  if (!terrainFits) return false;
  if (!def.features.includes(map.feature[hex] as number)) return false;
  if (def.river === true && map.riverEdges[hex] === 0) return false;
  if (def.shore === true) {
    let shore = false;
    for (let d = 0; d < 6 && !shore; d++) {
      const next = topo.neighbors[hex * 6 + d] as number;
      shore = next >= 0 && topo.water[next] === 1;
    }
    if (!shore) return false;
  }
  // A mountain is neither hilly nor flat: where a modifier allows it, the hills rule does not apply.
  if (terrain === Terrain.Mountain) return granted;
  const hilly = map.hills[hex] === 1;
  if (hilly && hillsFree) return true;
  return def.hills === 'any' || (def.hills === 'yes') === hilly;
}

/** True if the hex is one the city may improve: one its citizens work, or a mountain of its zone. */
export function inImprovementReach(ctx: Ctx, city: City, hex: number): boolean {
  if (ctx.topo.workZone[hex] === city.zone) return true;
  return ctx.map.zone[hex] === city.zone && ctx.map.terrain[hex] === Terrain.Mountain;
}

/** The hexes the city could improve: those its citizens work and the mountains of its zone. */
export function improvableHexes(ctx: Ctx, city: City): readonly number[] {
  const mountains = at(ctx.topo.zoneMountains, city.zone);
  const hexes = at(ctx.topo.workHexes, city.zone);
  return mountains.length === 0 ? hexes : [...hexes, ...mountains];
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
  const nation = nationOf(ctx, city.owner);
  switch (item.kind) {
    case 'unit': {
      // A nation builds its unique unit where the others build the generic one; the generic id stands for it.
      const def = UNITS[unitFor(nation, item.unit)];
      if (def === undefined || !def.buildable) return 'badItem';
      if (def.nation !== null && def.nation !== nation) return 'badItem';
      if (def.id === SETTLER && kind !== 'nation') return 'badItem';
      const reason = checkUnit(ctx, city.owner, def);
      if (reason !== null) return reason;
      if (def.domain === 'sea' && topo.coastal[city.zone] !== true) return 'needsCoast';
      return null;
    }
    case 'building': {
      const def = buildingDef(item.building);
      if (def === undefined) return 'badItem';
      // A unique building belongs to its nation, which builds it instead of the one it replaces.
      if (def.nation !== null && def.nation !== nation) return 'badItem';
      if (buildingFor(nation, item.building) !== item.building) return 'badItem';
      if (!knows(ctx, city.owner, def.tech)) return 'needsTech';
      if (hasBuildingKind(city, baseBuilding(item.building))) return 'alreadyBuilt';
      if (def.coastal && topo.coastal[city.zone] !== true) return 'needsCoast';
      if (def.capitalOnly && polityOf(ctx, city.owner).capital !== city.zone) return 'notCapital';
      break;
    }
    case 'improvement': {
      const def = improvementDef(item.improvement);
      if (def === undefined) return 'badItem';
      if (def.nation !== undefined && def.nation !== nation) return 'badItem';
      if (improvementFor(nation, item.improvement) !== item.improvement) return 'badItem';
      if (!Number.isInteger(item.hex) || item.hex < 0 || item.hex >= topo.count) return 'badHex';
      if (!inImprovementReach(ctx, city, item.hex)) return 'badHex';
      if (!knows(ctx, city.owner, def.tech)) return 'needsTech';
      if (!canImprove(ctx, city.owner, item.improvement, item.hex)) return 'badHex';
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

/**
 * The hex a new unit of the city appears on, or -1 if there is no room: the
 * city's own hex for a land unit, else the nearest free hex the unit may
 * stand on within `CITY.musterRadius` of it.
 */
export function spawnHex(ctx: Ctx, city: City, def: UnitDef): number {
  const { topo, map } = ctx;
  const site = at(map.zones, city.zone).siteHex;
  if (def.domain === 'land' && !ctx.unitAt.has(site)) return site;
  const fits = (hex: number): boolean => {
    if (ctx.unitAt.has(hex) || !terrainAllows(ctx, def, hex, city.owner)) return false;
    if ((topo.water[hex] === 1) !== (def.domain === 'sea')) return false;
    return bordersOpen(ctx, city.owner, hex) && cityAtHex(ctx, hex) === null;
  };
  // Ring by ring, in the order of the six directions.
  const seen = new Set<number>([site]);
  let ring = [site];
  for (let radius = 1; radius <= CITY.musterRadius; radius++) {
    const next: number[] = [];
    for (const from of ring) {
      for (let d = 0; d < 6; d++) {
        const hex = topo.neighbors[from * 6 + d] as number;
        if (hex < 0 || seen.has(hex)) continue;
        seen.add(hex);
        next.push(hex);
      }
    }
    for (const hex of next) if (fits(hex)) return hex;
    ring = next;
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
      const def = unitDef(unitFor(nationOf(ctx, city.owner), item.unit));
      const hex = spawnHex(ctx, city, def);
      if (hex < 0) return false;
      const unit = addUnit(ctx, def.id, city.owner, hex);
      if (def.id === SETTLER) polityOf(ctx, city.owner).settlersBuilt++;
      // Ships of the suzerain of a naval city-state start with experience, and so do the units modifiers name.
      if (def.domain === 'sea') unit.xp = CITY_STATE.navalXp * suzerainCount(ctx, city.owner, 'naval');
      for (const modifier of cityMods(ctx, city, 'startXp')) if (unitMatches(modifier.unit, def)) unit.xp += modifier.xp;
      for (const ability of def.abilities) if (ability.type === 'startXp') unit.xp += ability.xp;
      while (unit.level < COMBAT.levelXp.length && unit.xp >= at(COMBAT.levelXp, unit.level)) unit.level++;
      return true;
    }
    case 'building':
      city.buildings.push(item.building);
      return true;
    case 'improvement':
      ctx.state.improvements[item.hex] = item.improvement;
      if (IMPROVEMENTS[item.improvement].road === true && ctx.state.roads[item.hex] === undefined) {
        ctx.state.roads[item.hex] = 1;
        ctx.events.push({ type: 'roadsBuilt', hexes: [item.hex], level: 1 });
      }
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

/** Food the city needs to gain a citizen. */
export function growthNeed(ctx: Ctx, city: City): number {
  const base = CITY.growthBase + CITY.growthPerPop * city.pop;
  const percent = city.owner === NO_POLITY ? 0 : percentOf(ctx, city.owner, 'growth');
  return percent === 0 ? base : Math.max(1, Math.floor((base * (100 + percent)) / 100));
}

/** One turn of a city: citizens, growth, production, repairs. */
export function processCity(ctx: Ctx, city: City): void {
  const { state } = ctx;
  assignCitizens(ctx, city);

  // Growth.
  city.food += city.yields.food - city.pop * CITY.foodPerCitizen;
  const need = growthNeed(ctx, city);
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
