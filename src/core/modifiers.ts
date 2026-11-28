/**
 * The modifier engine: which modifiers apply to a polity, a city or a unit,
 * and the tests of their conditions. The rules call one function here per
 * number they compute; nothing else reads policy cards, traits, leader buffs
 * or unit abilities.
 *
 * To add a modifier: add its shape to `Modifier` in `mods.ts`, read it at the
 * rule it changes with {@link modsOf} (polity), {@link cityMods} (polity and
 * the city's buildings) or {@link unitMods} (polity and the unit type), and
 * put it in a table (`POLICIES`, `KITS`, `UNIQUE_*`).
 */

import {
  BUILDINGS,
  COMBAT,
  DIFFICULTY,
  FIREARM_UNITS,
  IMPROVEMENTS,
  MODERN_LAND_ERA,
  POLICIES,
  baseBuilding,
  baseImprovement,
  unitDef,
} from './data.ts';
import type { DifficultyBonus, PolicyDef, PolicyId, UnitDef, Yields } from './data.ts';
import { at, atWar, ownerOf, polityOf, warCount } from './context.ts';
import type { Ctx } from './context.ts';
import { KIT, kitOfNation } from './kits.ts';
import type { Kit } from './kits.ts';
import type { CityWhen, FightWhen, HexWhen, Modifier, ModifierOf, ModifierType, Per, RouteWhen, UnitWhen } from './mods.ts';
import { alliesOf, favourOf, hasAgreement, isNation } from './relations.ts';
import { NO_POLITY } from './types.ts';
import type { City, TradeRoute, Unit } from './types.ts';
import { ROAD_UPGRADES } from './uniques.ts';
import type { RoadUpgradeSpec } from './uniques.ts';

export type ModIndex = Partial<Record<ModifierType, Modifier[]>>;

const NONE: readonly never[] = [];

// ----------------------------------------------------------------- sources

const policyCache = new Map<PolicyId, readonly Modifier[]>();

/** A policy card as modifiers. */
export function policyModifiers(id: PolicyId): readonly Modifier[] {
  const cached = policyCache.get(id);
  if (cached !== undefined) return cached;
  const def: PolicyDef = POLICIES[id];
  const list: Modifier[] = [];
  for (const [improvement, yields] of Object.entries(def.improvementYields ?? {})) {
    list.push({ type: 'hexYield', yields, hex: { improvement: [improvement] } });
  }
  for (const [building, yields] of Object.entries(def.buildingYields ?? {})) {
    list.push({ type: 'cityYield', yields, per: { building } });
  }
  for (const [building, percent] of Object.entries(def.buildingPercent ?? {})) {
    list.push({ type: 'cityPercent', percent, building });
  }
  if (def.capitalYields !== undefined) list.push({ type: 'cityYield', yields: def.capitalYields, city: { capital: true } });
  if (def.cityPercent !== undefined) list.push({ type: 'cityPercent', percent: def.cityPercent });
  if (def.nonCapitalPercent !== undefined) {
    list.push({ type: 'cityPercent', percent: def.nonCapitalPercent, city: { capital: false } });
  }
  if (def.popPerScience !== undefined) {
    list.push({ type: 'cityYield', yields: { science: 1 }, per: { pop: def.popPerScience } });
  }
  if (def.unitProductionPercent !== undefined) {
    list.push({ type: 'production', percent: def.unitProductionPercent, item: 'unit' });
  }
  if (def.modernLandUnitProductionPercent !== undefined) {
    list.push({
      type: 'production',
      percent: def.modernLandUnitProductionPercent,
      item: 'unit',
      unit: { domain: 'land', military: true, minEra: MODERN_LAND_ERA },
    });
  }
  if (def.buildingProductionPercent !== undefined) {
    list.push({ type: 'production', percent: def.buildingProductionPercent, item: 'building' });
  }
  if (def.unitUpkeepPercent !== undefined) list.push({ type: 'unitUpkeep', percent: def.unitUpkeepPercent });
  if (def.cultureOnKill !== undefined) list.push({ type: 'cultureOnKill', culture: def.cultureOnKill });
  if (def.allyStrengthPercent !== undefined) {
    list.push({ type: 'strength', percent: def.allyStrengthPercent, when: { allyAtWar: true } });
  }
  if (def.firearmStrengthPercent !== undefined) {
    list.push({ type: 'strength', percent: def.firearmStrengthPercent, when: { unit: { types: FIREARM_UNITS } } });
  }
  if (def.homeStrengthPercent !== undefined) {
    list.push({ type: 'strength', percent: def.homeStrengthPercent, when: { territory: 'own' } });
  }
  if (def.influencePercent !== undefined) list.push({ type: 'influence', percent: def.influencePercent });
  if (def.tributePercent !== undefined) list.push({ type: 'tribute', percent: def.tributePercent });
  if (def.seaRouteGold !== undefined) list.push({ type: 'routeGold', gold: def.seaRouteGold, route: { sea: true } });
  if (def.tradePactGoldPercent !== undefined) list.push({ type: 'tradePactGold', percent: def.tradePactGoldPercent });
  if (def.allyRouteMultiplier !== undefined) {
    list.push({ type: 'routeGold', multiplier: def.allyRouteMultiplier, route: { toAlly: true } });
  }
  policyCache.set(id, list);
  return list;
}

/** `MapPolity.id` of a polity. */
export function nationOf(ctx: Ctx, polity: number): string {
  return polity === NO_POLITY ? '' : at(ctx.map.polities, polity).id;
}

/** The kit of a polity: that of the nation whose id it has, or null. */
export function kitOf(ctx: Ctx, polity: number): Kit | null {
  if (polity === NO_POLITY) return null;
  const entry = at(ctx.map.polities, polity);
  return entry.kind === 'nation' ? kitOfNation(entry.id) : null;
}

/** The road upgrade the polity's roads have: its nation's, once it knows the tech. */
export function roadUpgradeOf(ctx: Ctx, polity: number): RoadUpgradeSpec | null {
  const kit = kitOf(ctx, polity);
  if (kit === null || kit.buildingKind !== 'road') return null;
  const spec = (ROAD_UPGRADES as Record<string, RoadUpgradeSpec>)[kit.building];
  return spec !== undefined && polityOf(ctx, polity).techs.includes(spec.tech) ? spec : null;
}

/**
 * What the difficulty level gives `polity`, or null: the player's bonus for
 * the player, the AI's for every other major nation.
 */
export function difficultyBonus(ctx: Ctx, polity: number): DifficultyBonus | null {
  const { state } = ctx;
  const level = DIFFICULTY[state.difficulty];
  const bonus = polity === state.player ? level.player : state.majors.includes(polity) ? level.ai : null;
  return bonus === null || (bonus.yieldPercent === 0 && bonus.strengthPercent === 0) ? null : bonus;
}

const difficultyCache = new Map<DifficultyBonus, readonly Modifier[]>();

/** A difficulty bonus as modifiers: every city yield, and the strength of units and cities. */
function difficultyModifiers(bonus: DifficultyBonus): readonly Modifier[] {
  let list = difficultyCache.get(bonus);
  if (list === undefined) {
    const each = bonus.yieldPercent;
    list = [
      { type: 'cityPercent', percent: { food: each, production: each, gold: each, science: each, culture: each } },
      { type: 'strength', percent: bonus.strengthPercent },
      { type: 'cityStrength', percent: bonus.strengthPercent },
    ];
    difficultyCache.set(bonus, list);
  }
  return list;
}

function buildIndex(ctx: Ctx, polity: number): ModIndex {
  const index: ModIndex = {};
  const add = (list: readonly Modifier[]): void => {
    for (const modifier of list) (index[modifier.type] ??= []).push(modifier);
  };
  for (const id of polityOf(ctx, polity).slots) if (id !== null) add(policyModifiers(id));
  const kit = kitOf(ctx, polity);
  if (kit !== null) {
    add(kit.trait);
    add(kit.leader);
    const road = roadUpgradeOf(ctx, polity);
    if (road !== null) add(road.modifiers);
  }
  const bonus = difficultyBonus(ctx, polity);
  if (bonus !== null) add(difficultyModifiers(bonus));
  return index;
}

/**
 * The polity's modifiers of one type: those of its slotted cards, its trait,
 * its leader and its road upgrade. The list is kept per context; whatever
 * changes its sources calls {@link forgetMods}.
 */
export function modsOf<T extends ModifierType>(ctx: Ctx, polity: number, type: T): readonly ModifierOf<T>[] {
  if (polity === NO_POLITY) return NONE;
  let index = ctx.mods.get(polity);
  if (index === undefined) {
    index = buildIndex(ctx, polity);
    ctx.mods.set(polity, index);
  }
  return (index[type] ?? NONE) as readonly ModifierOf<T>[];
}

/** Drops the kept list of a polity whose cards or techs changed. */
export function forgetMods(ctx: Ctx, polity: number): void {
  ctx.mods.delete(polity);
}

/** The modifiers of one type that apply to a city: its owner's, and those of its buildings. */
export function cityMods<T extends ModifierType>(ctx: Ctx, city: City, type: T): readonly ModifierOf<T>[] {
  const own = modsOf(ctx, city.owner, type);
  let out: ModifierOf<T>[] | null = null;
  for (const id of city.buildings) {
    for (const modifier of BUILDINGS[id].modifiers) {
      if (modifier.type === type) (out ??= [...own]).push(modifier as ModifierOf<T>);
    }
  }
  return out ?? own;
}

/** The modifiers of one type that apply to a unit: its owner's, and the abilities of its type. */
export function unitMods<T extends ModifierType>(ctx: Ctx, owner: number, def: UnitDef, type: T): readonly ModifierOf<T>[] {
  const own = modsOf(ctx, owner, type);
  let out: ModifierOf<T>[] | null = null;
  for (const modifier of def.abilities) {
    if (modifier.type === type) (out ??= [...own]).push(modifier as ModifierOf<T>);
  }
  return out ?? own;
}

// -------------------------------------------------------------- conditions

/** The improvement that works on the hex, by its generic kind; undefined for none or a pillaged one. */
export function liveImprovement(ctx: Ctx, hex: number): string | undefined {
  const id = ctx.state.improvements[hex];
  if (id === undefined || (ctx.state.pillaged[hex] ?? 0) >= ctx.state.turn) return undefined;
  return baseImprovement(id);
}

function anyNeighbour(ctx: Ctx, hex: number, test: (neighbour: number) => boolean): boolean {
  for (let d = 0; d < 6; d++) {
    const next = ctx.topo.neighbors[hex * 6 + d] as number;
    if (next >= 0 && test(next)) return true;
  }
  return false;
}

export function hexMatches(ctx: Ctx, when: HexWhen | undefined, hex: number): boolean {
  if (when === undefined) return true;
  const { map, topo } = ctx;
  if (when.terrain !== undefined && !when.terrain.includes(map.terrain[hex] as number)) return false;
  if (when.feature !== undefined && !when.feature.includes(map.feature[hex] as number)) return false;
  if (when.hills !== undefined && (map.hills[hex] === 1) !== when.hills) return false;
  if (when.river !== undefined && (map.riverEdges[hex] !== 0) !== when.river) return false;
  if (when.water !== undefined && (topo.water[hex] === 1) !== when.water) return false;
  if (when.plateau !== undefined && ((map.elevation[hex] as number) >= KIT.plateauMetres) !== when.plateau) return false;
  if (when.resource !== undefined) {
    const index = map.resource[hex] as number;
    if (typeof when.resource === 'boolean') {
      if (index >= 0 !== when.resource) return false;
    } else if (index < 0 || map.resources[index]?.id !== when.resource) return false;
  }
  if (when.improvement !== undefined) {
    const live = liveImprovement(ctx, hex);
    if (when.improvement === 'any') {
      if (live === undefined) return false;
    } else if (when.improvement === 'none') {
      if (live !== undefined) return false;
    } else if (live === undefined || !when.improvement.includes(live)) return false;
  }
  if (when.shore !== undefined) {
    const shore = topo.water[hex] !== 1 && anyNeighbour(ctx, hex, (next) => topo.water[next] === 1);
    if (shore !== when.shore) return false;
  }
  const terrains = when.nextToTerrain;
  if (terrains !== undefined && !anyNeighbour(ctx, hex, (next) => terrains.includes(map.terrain[next] as number))) {
    return false;
  }
  const features = when.nextToFeature;
  if (features !== undefined && !anyNeighbour(ctx, hex, (next) => features.includes(map.feature[next] as number))) {
    return false;
  }
  return true;
}

/** True if the city has the building, or the building that replaces it. */
export function hasBuildingKind(city: City, kind: string): boolean {
  return city.buildings.some((id) => baseBuilding(id) === kind);
}

/** True if the hex is on the polity's land, or is water next to it. */
export function inHomeWaters(ctx: Ctx, polity: number, hex: number): boolean {
  if (ownerOf(ctx, hex) === polity) return true;
  if (ctx.topo.water[hex] !== 1) return false;
  return anyNeighbour(ctx, hex, (next) => ownerOf(ctx, next) === polity);
}

export function cityMatches(ctx: Ctx, when: CityWhen | undefined, city: City): boolean {
  if (when === undefined) return true;
  const { topo, map, state } = ctx;
  const owner = polityOf(ctx, city.owner);
  if (when.capital !== undefined && (owner.capital === city.zone) !== when.capital) return false;
  if (when.coastal !== undefined && (topo.coastal[city.zone] === true) !== when.coastal) return false;
  if (when.hillSite !== undefined) {
    const site = at(map.zones, city.zone).siteHex;
    const hilly = map.hills[site] === 1 || at(topo.siteRough, city.zone) >= KIT.hillCityHills;
    if (hilly !== when.hillSite) return false;
  }
  if (when.mountainsNear !== undefined && at(topo.mountainsNear, city.zone) < when.mountainsNear) return false;
  if (when.waterway !== undefined) {
    const site = at(map.zones, city.zone).siteHex;
    const linked =
      map.riverEdges[site] !== 0 ||
      at(topo.workHexes, city.zone).some((hex) => {
        const id = state.improvements[hex];
        return id !== undefined && baseImprovement(id) === 'canal';
      });
    if (linked !== when.waterway) return false;
  }
  if (when.garrisoned !== undefined) {
    const holder = ctx.unitAt.get(at(map.zones, city.zone).siteHex);
    const held = holder !== undefined && holder.owner === city.owner && unitDef(holder.type).strength > 0;
    if (held !== when.garrisoned) return false;
  }
  if (when.minPop !== undefined && city.pop < when.minPop) return false;
  if (when.atPeace !== undefined && (warCount(ctx, city.owner) === 0) !== when.atPeace) return false;
  if (when.minEra !== undefined && owner.era < when.minEra) return false;
  if (when.afterCityLoss !== undefined) {
    const surging = owner.cityLostOn > 0 && state.turn - owner.cityLostOn < KIT.surgeTurns;
    if (surging !== when.afterCityLoss) return false;
  }
  return true;
}

export function unitMatches(when: UnitWhen | undefined, def: UnitDef): boolean {
  if (when === undefined) return true;
  if (when.classes !== undefined && !when.classes.includes(def.unitClass)) return false;
  if (when.domain !== undefined && def.domain !== when.domain) return false;
  if (when.types !== undefined && !when.types.includes(def.id) && !when.types.includes(def.replaces ?? '')) return false;
  if (when.minEra !== undefined && def.era < when.minEra) return false;
  if (when.military !== undefined && def.strength > 0 !== when.military) return false;
  return true;
}

/** Nations at `KIT.friendlyFavour` or more with `polity`, at most `KIT.maxFriends`. */
export function friendCount(ctx: Ctx, polity: number): number {
  if (!isNation(ctx, polity)) return 0;
  let friends = 0;
  for (let other = 0; other < ctx.n && friends < KIT.maxFriends; other++) {
    if (other === polity || !isNation(ctx, other) || !polityOf(ctx, other).alive) continue;
    if (favourOf(ctx, polity, other) >= KIT.friendlyFavour) friends++;
  }
  return friends;
}

/** Islands (landmasses other than the largest) on which `polity` has a city, at most `KIT.maxIslands`. */
export function islandCount(ctx: Ctx, polity: number): number {
  const islands = new Set<number>();
  for (const city of ctx.state.cities) {
    if (city === null || city.owner !== polity) continue;
    const mass = ctx.topo.landmass[at(ctx.map.zones, city.zone).siteHex] as number;
    if (mass >= 0 && mass !== ctx.topo.mainland) islands.add(mass);
  }
  return Math.min(KIT.maxIslands, islands.size);
}

/** How many times a flat city yield counts. */
export function perCount(ctx: Ctx, per: Per | undefined, city: City): number {
  if (per === undefined) return 1;
  if (per === 'friends') return friendCount(ctx, city.owner);
  if (per === 'islands') return islandCount(ctx, city.owner);
  if (per === 'routes') {
    let routes = 0;
    for (const route of ctx.state.routes) if (route.owner === city.owner) routes++;
    return Math.min(KIT.maxRoutesCounted, routes);
  }
  if (per === 'zoneMountains') return Math.min(KIT.maxMountainsCounted, at(ctx.topo.zoneMountains, city.zone).length);
  if ('building' in per) return hasBuildingKind(city, per.building) ? 1 : 0;
  return Math.floor(city.pop / per.pop);
}

/** True if the land of the two polities touches (over land or across one hex of water). */
export function areNeighbours(ctx: Ctx, a: number, b: number): boolean {
  const { topo, state } = ctx;
  for (let zone = 0; zone < state.zoneOwner.length; zone++) {
    if (state.zoneOwner[zone] !== a) continue;
    for (const other of at(topo.zoneNeighbors, zone)) if (state.zoneOwner[other] === b) return true;
  }
  return false;
}

export function routeMatches(ctx: Ctx, when: RouteWhen | undefined, route: TradeRoute): boolean {
  if (when === undefined) return true;
  const { state, map } = ctx;
  if (when.sea !== undefined && route.sea !== when.sea) return false;
  const to = route.toCity < 0 ? null : (state.cities[route.toCity] ?? null);
  if (when.to === 'port' && route.toPort < 0) return false;
  if (when.to === 'foreign' && (to === null || to.owner === route.owner)) return false;
  if (when.to === 'neighbour') {
    if (to === null || to.owner === route.owner || !isNation(ctx, to.owner)) return false;
    if (!areNeighbours(ctx, route.owner, to.owner)) return false;
  }
  if (when.port !== undefined && map.offMapPorts[route.toPort]?.nameEn !== when.port) return false;
  if (when.toPolities !== undefined) {
    if (to === null || to.owner === route.owner || !when.toPolities.includes(nationOf(ctx, to.owner))) return false;
  }
  if (when.crossesHills !== undefined && route.path.some((hex) => map.hills[hex] === 1) !== when.crossesHills) return false;
  if (when.toAlly !== undefined) {
    const allied = to !== null && to.owner !== route.owner && hasAgreement(ctx, 'alliance', route.owner, to.owner);
    if (allied !== when.toAlly) return false;
  }
  return true;
}

// ------------------------------------------------------------------ combat

/** One side of a fight, as the conditions of a strength modifier see it. */
export interface Fight {
  readonly role: 'attack' | 'defend';
  /** The attack is ranged. */
  readonly ranged: boolean;
  /** A melee across a river edge. */
  readonly acrossRiver: boolean;
  /** The polity on the other side. */
  readonly enemy: number;
  readonly enemyUnit: Unit | null;
  readonly enemyCity: City | null;
}

function adjacentFriends(ctx: Ctx, unit: Unit): number {
  let friends = 0;
  for (let d = 0; d < 6; d++) {
    const next = ctx.topo.neighbors[unit.hex * 6 + d] as number;
    if (next >= 0 && ctx.unitAt.get(next)?.owner === unit.owner) friends++;
  }
  return friends;
}

function fightMatches(ctx: Ctx, when: FightWhen | undefined, unit: Unit, def: UnitDef, fight: Fight): boolean {
  if (when === undefined) return true;
  if (when.role !== undefined && when.role !== fight.role) return false;
  if (!unitMatches(when.unit, def) || !hexMatches(ctx, when.hex, unit.hex)) return false;
  if (when.territory !== undefined) {
    const own = ownerOf(ctx, unit.hex) === unit.owner;
    if (when.territory === 'own' && !own) return false;
    if (when.territory === 'foreign' && own) return false;
    if (when.territory === 'home' && !inHomeWaters(ctx, unit.owner, unit.hex)) return false;
  }
  if (when.vsClasses !== undefined) {
    if (fight.enemyUnit === null || !when.vsClasses.includes(unitDef(fight.enemyUnit.type).unitClass)) return false;
  }
  if (when.vsCity !== undefined && (fight.enemyCity !== null) !== when.vsCity) return false;
  if (when.vsCoastalCity !== undefined) {
    const coastal = fight.enemyCity !== null && ctx.topo.coastal[fight.enemyCity.zone] === true;
    if (coastal !== when.vsCoastalCity) return false;
  }
  if (when.rangedAttack !== undefined && fight.ranged !== when.rangedAttack) return false;
  if (when.acrossRiver !== undefined && fight.acrossRiver !== when.acrossRiver) return false;
  if (when.fortified !== undefined && (unit.status === 'fortified') !== when.fortified) return false;
  if (when.vsFullHp !== undefined) {
    const full = fight.enemyUnit !== null && fight.enemyUnit.hp >= COMBAT.maxHp;
    if (full !== when.vsFullHp) return false;
  }
  if (when.allyAtWar !== undefined) {
    const shared = fight.enemy !== NO_POLITY && alliesOf(ctx, unit.owner).some((ally) => atWar(ctx, ally, fight.enemy));
    if (shared !== when.allyAtWar) return false;
  }
  return true;
}

/**
 * Percentage every modifier together adds to a unit's strength in a fight:
 * its owner's cards, trait and leader, the abilities of its type, the
 * improvement it stands on, and what the owner of the land does to foreign
 * units.
 */
export function fightPercent(ctx: Ctx, unit: Unit, fight: Fight): number {
  if (unit.owner === NO_POLITY) return 0;
  const def = unitDef(unit.type);
  let percent = 0;
  const count = (modifier: ModifierOf<'strength'>): void => {
    if (!fightMatches(ctx, modifier.when, unit, def, fight)) return;
    percent += modifier.percent * (modifier.when?.perAdjacentFriend === true ? adjacentFriends(ctx, unit) : 1);
  };
  for (const modifier of unitMods(ctx, unit.owner, def, 'strength')) count(modifier);
  const holder = ownerOf(ctx, unit.hex);
  if (holder === unit.owner) {
    const improvement = ctx.state.improvements[unit.hex];
    if (improvement !== undefined && (ctx.state.pillaged[unit.hex] ?? 0) < ctx.state.turn) {
      for (const modifier of IMPROVEMENTS[improvement].modifiers ?? []) if (modifier.type === 'strength') count(modifier);
    }
  } else if (holder !== NO_POLITY) {
    for (const modifier of modsOf(ctx, holder, 'enemyStrength')) percent += modifier.percent;
  }
  return percent;
}

// ------------------------------------------------------------------ vision

/**
 * How many hexes away a unit sees: the base range, plus what its owner's
 * modifiers and the abilities of its type add where it stands. Nothing in
 * the rules is hidden yet; this is what a fog of war will read.
 */
export function visionRange(ctx: Ctx, unit: Unit): number {
  let range: number = KIT.unitVision;
  if (unit.owner === NO_POLITY) return range;
  const def = unitDef(unit.type);
  for (const modifier of unitMods(ctx, unit.owner, def, 'vision')) {
    if (unitMatches(modifier.unit, def) && hexMatches(ctx, modifier.hex, unit.hex)) range += modifier.range;
  }
  return range;
}

// ------------------------------------------------------------------- sums

/** Sum of `percent` over the polity's modifiers of a type that carry only that. */
export function percentOf(
  ctx: Ctx,
  polity: number,
  type: 'influence' | 'tribute' | 'buildingUpkeep' | 'upgradeCost' | 'growth' | 'specialtyGold' | 'specialtySale' | 'routeRange' | 'amphibious',
): number {
  let total = 0;
  for (const modifier of modsOf(ctx, polity, type)) total += modifier.percent;
  return total;
}

/** Adds `count` times the yields to `into`. */
export function addYields(into: Yields, yields: Partial<Yields>, count = 1): void {
  into.food += (yields.food ?? 0) * count;
  into.production += (yields.production ?? 0) * count;
  into.gold += (yields.gold ?? 0) * count;
  into.science += (yields.science ?? 0) * count;
  into.culture += (yields.culture ?? 0) * count;
}
