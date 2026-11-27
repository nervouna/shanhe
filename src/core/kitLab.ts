/**
 * A laboratory for the kit tests: a flat, featureless version of the fixture
 * map on which one polity is given a nation's kit, and `measure`, which
 * builds the situation a modifier is about and reads the number it changes.
 * Two measurements that differ in one thing (the kit, a unit type, a
 * building) show that the thing has an effect.
 *
 * The lab map: every land hex is flat plains; a channel of coast runs along
 * row 4 from the western edge to polity 1's capital, so that the capitals of
 * polities 0 and 1 are coastal; two sea exits lie at its western end.
 */

import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexDistance, hexNeighbors, indexToOffset } from '../shared/hex.ts';
import { Feature, NO_ZONE, OWNER_OFF_MAP, OWNER_SEA, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData, MapOffMapPort, MapPolity, MapResource } from '../shared/mapData.ts';
import { stepCost, upgradePrice } from './actions.ts';
import { canImprove, cityMorale, cityYieldParts, deliverItem, growthNeed, hexYields, productionPercent } from './cities.ts';
import { amphibiousFactor, cityStrength } from './combat.ts';
import { cloneState, createCtx } from './context.ts';
import type { Ctx } from './context.ts';
import { ROSTER, UNITS, UNIT_IDS, buildingFor, improvementFor, unitDef } from './data.ts';
import type { BuildingId, ImprovementId, TechId, Yields } from './data.ts';
import { checkAgreement, dealPriceFrom, favourShift } from './diplomacy.ts';
import { applyAction, createGame, endTurn } from './game.ts';
import { fightPercent, unitMatches, visionRange } from './modifiers.ts';
import type { CityWhen, HexWhen, Modifier, Per, RouteWhen, UnitWhen } from './mods.ts';
import { swapCooldown } from './policies.ts';
import { learnTech, ownsResource, techCost } from './tech.ts';
import { edit, learn, put, withCity } from './testUtil.ts';
import { checkRouteTarget, landRange, processRoutes, routeIncome } from './trade.ts';
import { attritionOn, healAmount, unitUpkeep } from './turn.ts';
import type { BuildItem, City, GameState, MutableGameState, TradeRoute, Unit } from './types.ts';

const fixture = createFixtureMap();
const WIDTH = fixture.width;

/** The value, which the lab knows to be there. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('the lab expected a value');
  return value;
}

export function hexAt(col: number, row: number): number {
  return row * WIDTH + col;
}

/** The polity that carries the kit, and its rival. */
export const SELF = 0;
export const FOE = 1;
/** The capital zones of the two, and their sites. */
export const HOME_ZONE = must(fixture.polities[SELF]).capitalZone;
export const FOE_ZONE = must(fixture.polities[FOE]).capitalZone;
export const SITE = must(fixture.zones[HOME_ZONE]).siteHex;
export const FOE_SITE = must(fixture.zones[FOE_ZONE]).siteHex;
/** A land hex next to the home site and to the channel, and its eastern neighbour. */
export const LAND = hexAt(7, 3);
export const LAND2 = hexAt(8, 3);
/** A channel hex the home city works. */
export const WATER = hexAt(6, 4);
export const WATER2 = hexAt(5, 4);
/** A land hex next to the rival's capital, another one in its zone, and a channel hex it works. */
export const FOE_LAND = hexAt(18, 4);
export const FOE_LAND2 = hexAt(19, 5);
export const FOE_WATER = hexAt(16, 4);
/** A second city site of polity 0, and one of polity 2. */
const SECOND_ZONE = 2;
const THIRD_NATION_ZONE = must(fixture.polities[2]).capitalZone;

const CHANNEL_ROW = 4;
const CHANNEL_FROM = 3;
const CHANNEL_TO = 16;
const LAND_PATH = [SITE, LAND, LAND2, hexAt(9, 3), hexAt(10, 3)];
const SEA_PATH = Array.from({ length: CHANNEL_TO - 5 }, (_, i) => hexAt(6 + i, CHANNEL_ROW));

/** The parts of a map a test may change before the game starts. */
export interface Lab {
  terrain: Uint8Array;
  hills: Uint8Array;
  feature: Uint8Array;
  elevation: Int16Array;
  owner: Int16Array;
  zone: Int16Array;
  riverEdges: Uint8Array;
  resource: Int16Array;
  polities: MapPolity[];
  resources: MapResource[];
  offMapPorts: MapOffMapPort[];
}

/** Index of the resource in the lab's list; it is added if it is new. */
export function resourceIndex(m: Lab, id: string): number {
  let index = m.resources.findIndex((entry) => entry.id === id);
  if (index < 0) index = m.resources.push({ id, nameZh: id, nameEn: id }) - 1;
  return index;
}

/** Turns a hex into coast. */
function flood(m: Lab, hex: number): void {
  m.terrain[hex] = Terrain.Coast;
  m.owner[hex] = OWNER_SEA;
  m.zone[hex] = NO_ZONE;
}

/**
 * The lab map.
 *
 * @param nation the `MapPolity.id` polity 0 gets, with the kit that goes with it; null leaves it without one.
 */
export function labMap(nation: string | null, tweak?: (m: Lab) => void): MapData {
  const m: Lab = {
    terrain: Uint8Array.from(fixture.terrain),
    hills: new Uint8Array(fixture.hills.length),
    feature: new Uint8Array(fixture.feature.length),
    elevation: Int16Array.from(fixture.elevation),
    owner: Int16Array.from(fixture.owner),
    zone: Int16Array.from(fixture.zone),
    riverEdges: new Uint8Array(fixture.riverEdges.length),
    resource: new Int16Array(fixture.resource.length).fill(-1),
    polities: fixture.polities.map((polity) => ({ ...polity })),
    resources: [...fixture.resources],
    offMapPorts: [
      ...fixture.offMapPorts,
      { hex: hexAt(2, CHANNEL_ROW), kind: 'sea', nameZh: '西洋', nameEn: 'Western Ocean' },
      { hex: hexAt(2, CHANNEL_ROW + 1), kind: 'sea', nameZh: '大东洋', nameEn: 'Great Eastern Ocean' },
    ],
  };
  for (let hex = 0; hex < m.terrain.length; hex++) {
    if (m.owner[hex] === OWNER_OFF_MAP || isWaterTerrain(m.terrain[hex] as number)) continue;
    m.terrain[hex] = Terrain.Plains;
    m.elevation[hex] = 100;
  }
  for (let col = CHANNEL_FROM; col <= CHANNEL_TO; col++) flood(m, hexAt(col, CHANNEL_ROW));
  if (nation !== null) (m.polities[SELF] as { id: string }).id = nation;
  tweak?.(m);
  return { ...fixture, ...m };
}

export interface Subject {
  /** The kit polity 0 has, or null. */
  readonly nation: string | null;
  /** The unit type to measure with, where the modifier is about a unit. */
  readonly unit?: string;
  /** Buildings the home city has. */
  readonly buildings?: readonly BuildingId[];
  /** The improvement on the hex that is measured. */
  readonly improvement?: ImprovementId;
}

interface World {
  state: GameState;
  ctx: Ctx;
  city: City;
}

interface Plan {
  tweaks: ((m: Lab) => void)[];
  prepares: ((draft: MutableGameState) => void)[];
  /** False: nobody knows any tech. */
  techs: boolean;
  /** Zones polity 0 gets a city in besides its capital. */
  cities: number[];
}

function plan(): Plan {
  return { tweaks: [], prepares: [], techs: true, cities: [] };
}

function build(subject: Subject, p: Plan): World {
  const map = labMap(subject.nation, (m) => {
    for (const tweak of p.tweaks) tweak(m);
  });
  let state = createGame(map, { seed: 1, player: must(map.polities[SELF]).id, majors: [] });
  if (p.techs) state = learn(state, 'all');
  for (const zone of p.cities) state = withCity(state, zone, SELF);
  state = edit(state, (draft) => {
    const city = must(draft.cities[HOME_ZONE]);
    city.pop = 12;
    for (const id of subject.buildings ?? []) if (!city.buildings.includes(id)) city.buildings.push(id);
    for (const prepare of p.prepares) prepare(draft);
  });
  const ctx = createCtx(cloneState(state));
  return { state, ctx, city: must(ctx.state.cities[HOME_ZONE]) };
}

function total(yields: Yields): number {
  return yields.food + yields.production + yields.gold + yields.science + yields.culture;
}

const WATER_TERRAINS: readonly number[] = [Terrain.Ocean, Terrain.Coast, Terrain.Lake];

/** True if the condition is about a water hex. */
function wantsWater(when: HexWhen | undefined): boolean {
  if (when === undefined) return false;
  if (when.water === true) return true;
  return when.terrain !== undefined && when.terrain.every((terrain) => WATER_TERRAINS.includes(terrain));
}

/** Makes `hex` (and its neighbour `beside`) what the condition asks for. */
function shapeHex(p: Plan, when: HexWhen | undefined, hex: number, beside: number, nation: string | null): void {
  if (when === undefined) return;
  p.tweaks.push((m) => {
    const terrain = when.terrain?.[0];
    if (terrain !== undefined) m.terrain[hex] = terrain;
    const feature = when.feature?.[0];
    if (feature !== undefined) m.feature[hex] = feature;
    if (when.hills !== undefined) m.hills[hex] = when.hills ? 1 : 0;
    if (when.river === true) {
      m.riverEdges[hex] = (m.riverEdges[hex] as number) | 1;
      m.riverEdges[beside] = (m.riverEdges[beside] as number) | 8;
    }
    if (when.plateau === true) m.elevation[hex] = 4200;
    if (when.resource === true) m.resource[hex] = resourceIndex(m, 'jade');
    else if (typeof when.resource === 'string') m.resource[hex] = resourceIndex(m, when.resource);
    const nextTerrain = when.nextToTerrain?.[0];
    if (nextTerrain !== undefined) m.terrain[beside] = nextTerrain;
    const nextFeature = when.nextToFeature?.[0];
    if (nextFeature !== undefined) m.feature[beside] = nextFeature;
  });
  const improvement = when.improvement;
  if (improvement !== undefined && improvement !== 'none') {
    const kind = improvement === 'any' ? 'mine' : (improvement[0] as string);
    p.prepares.push((draft) => {
      draft.improvements[hex] = improvementFor(nation ?? '', kind as ImprovementId);
    });
  }
}

/** The first generic unit the condition matches; a unique unit if only one of those does. */
export function pickUnit(when: UnitWhen | undefined, fallback = 'warrior'): string {
  if (when === undefined) return fallback;
  const fits = (id: string): boolean => {
    const def = unitDef(id);
    return def.strength > 0 && def.buildable && unitMatches(when, def);
  };
  const found = UNIT_IDS.find(fits) ?? Object.keys(UNITS).find(fits);
  if (found === undefined) throw new Error('no unit matches the condition');
  return found;
}

/** The land hexes at distance 2 of the home site that no test uses for anything else. */
function ring(): number[] {
  const site = indexToOffset(SITE, WIDTH);
  const out: number[] = [];
  for (let hex = 0; hex < fixture.terrain.length; hex++) {
    if (hexDistance(indexToOffset(hex, WIDTH), site) !== 2) continue;
    if (fixture.zone[hex] !== HOME_ZONE || hex === LAND2 || Math.floor(hex / WIDTH) === CHANNEL_ROW) continue;
    out.push(hex);
  }
  return out;
}

function shapeCity(p: Plan, when: CityWhen | undefined, per: Per | undefined, nation: string | null): void {
  if (when?.capital === false) throw new Error('the lab measures the capital only');
  if (when?.hillSite === true) p.tweaks.push((m) => (m.hills[SITE] = 1));
  const mountains = Math.max(when?.mountainsNear ?? 0, per === 'zoneMountains' ? 1 : 0);
  if (mountains > 0) {
    p.tweaks.push((m) => {
      for (const hex of ring().slice(0, mountains)) m.terrain[hex] = Terrain.Mountain;
    });
  }
  if (when?.waterway === true) p.tweaks.push((m) => (m.riverEdges[SITE] = 1));
  if (when?.afterCityLoss === true) p.prepares.push((draft) => (must(draft.polities[SELF]).cityLostOn = draft.turn));
  if (per === 'friends') p.prepares.push((draft) => (draft.favour[`${SELF}:${FOE}`] = 50));
  if (per === 'routes') p.prepares.push((draft) => draft.routes.push(routeFor(p, undefined, nation)));
  if (per === 'islands') {
    // The second city of polity 0 stands on an island of its own.
    const site = must(fixture.zones[SECOND_ZONE]).siteHex;
    p.tweaks.push((m) => {
      for (const n of hexNeighbors(indexToOffset(site, WIDTH))) flood(m, n.row * WIDTH + n.col);
    });
    p.cities.push(SECOND_ZONE);
  }
  if (per !== undefined && typeof per === 'object' && 'building' in per) {
    const id = buildingFor(nation ?? '', per.building as BuildingId);
    p.prepares.push((draft) => {
      const city = must(draft.cities[HOME_ZONE]);
      if (!city.buildings.includes(id)) city.buildings.push(id);
    });
  }
}

/** A route of polity 0 from its capital that the condition matches. */
function routeFor(p: Plan, when: RouteWhen | undefined, nation: string | null): TradeRoute {
  void nation;
  const sea = when?.sea ?? false;
  const route: TradeRoute = {
    id: 900,
    owner: SELF,
    from: HOME_ZONE,
    toCity: FOE_ZONE,
    toPort: -1,
    sea,
    path: sea ? [...SEA_PATH] : [...LAND_PATH],
    income: 0,
    pillagedUntil: 0,
  };
  if (when?.to === 'port' || when?.port !== undefined) {
    route.toCity = -1;
    const name = when.port ?? 'Western Ocean';
    route.toPort = labMap(null).offMapPorts.findIndex((port) => port.nameEn === name);
  }
  const polities = when?.toPolities;
  if (polities !== undefined) p.tweaks.push((m) => ((m.polities[FOE] as { id: string }).id = polities[0] as string));
  if (when?.crossesHills === true) p.tweaks.push((m) => (m.hills[LAND] = 1));
  return route;
}

const AT_WAR = (draft: MutableGameState): void => {
  draft.relations[`${SELF}:${FOE}`] = { a: SELF, b: FOE, atWar: true, since: 1, offerA: 0, offerB: 0 };
};

/** A route of the rival with a path through `through`, rich enough for a share of it to show. */
function foeRoute(sea: boolean, through: number): (draft: MutableGameState) => void {
  return (draft) => {
    must(draft.cities[FOE_ZONE]).pop = 20;
    must(draft.cities[THIRD_NATION_ZONE]).pop = 20;
    draft.routes.push({
      id: 901,
      owner: FOE,
      from: FOE_ZONE,
      toCity: THIRD_NATION_ZONE,
      toPort: -1,
      sea,
      path: [FOE_SITE, through, ...(sea ? SEA_PATH : LAND_PATH)],
      income: 0,
      pillagedUntil: 0,
    });
  };
}

/**
 * The number the modifier changes, in a situation built so that it applies.
 * What is measured depends only on the modifier's type; the subject says who
 * has it.
 */
export function measure(modifier: Modifier, subject: Subject): number {
  const p = plan();
  const nation = subject.nation;
  switch (modifier.type) {
    case 'hexYield': {
      const hex = wantsWater(modifier.hex) ? WATER : LAND;
      shapeHex(p, modifier.hex, hex, hex === WATER ? WATER2 : LAND2, nation);
      const w = build(subject, p);
      return total(hexYields(w.ctx, w.city, hex));
    }
    case 'cityYield':
    case 'cityPercent': {
      shapeCity(p, modifier.city, modifier.type === 'cityYield' ? modifier.per : undefined, nation);
      if (modifier.type === 'cityPercent' && modifier.building !== undefined) {
        shapeCity(p, undefined, { building: modifier.building }, nation);
      }
      const w = build(subject, p);
      const parts = cityYieldParts(w.ctx, w.city);
      return total(parts.flat) * 1000 + total(parts.percent);
    }
    case 'routeYield': {
      const route = routeFor(p, modifier.route, nation);
      p.prepares.push((draft) => draft.routes.push(route));
      const w = build(subject, p);
      return total(cityYieldParts(w.ctx, w.city).flat);
    }
    case 'specialtyGold': {
      p.tweaks.push((m) => (m.resource[LAND] = resourceIndex(m, 'jade')));
      const w = build(subject, p);
      return cityYieldParts(w.ctx, w.city).flat.gold;
    }
    case 'growth':
      return ((w) => growthNeed(w.ctx, w.city))(build(subject, p));
    case 'morale': {
      shapeCity(p, modifier.city, undefined, nation);
      // Below the cap, so that an addition shows.
      p.prepares.push((draft) => (must(draft.cities[HOME_ZONE]).unrest = 3));
      const w = build(subject, p);
      return cityMorale(w.ctx, w.city);
    }
    case 'production': {
      let item: BuildItem;
      if (modifier.item === 'unit') item = { kind: 'unit', unit: subject.unit ?? pickUnit(modifier.unit) };
      else if (modifier.item === 'improvement') item = { kind: 'improvement', improvement: 'farm', hex: LAND };
      else item = { kind: 'building', building: buildingFor(nation ?? '', (modifier.building ?? 'granary') as BuildingId) };
      const w = build(subject, p);
      return productionPercent(w.ctx, w.city, item);
    }
    case 'unitUpkeep': {
      let id = 0;
      const type = subject.unit ?? pickUnit(modifier.unit);
      p.prepares.push((draft) => (id = put(draft, type, SELF, unitDef(type).domain === 'sea' ? WATER : LAND).id));
      const w = build(subject, p);
      return unitUpkeep(w.ctx, w.ctx.unitById.get(id) as Unit);
    }
    case 'buildingUpkeep': {
      p.prepares.push((draft) => must(draft.cities[HOME_ZONE]).buildings.push('granary', 'temple', 'academy'));
      return must(endTurn(build(subject, p).state).state.polities[SELF]).upkeep;
    }
    case 'upgradeCost': {
      let id = 0;
      p.prepares.push((draft) => (id = put(draft, 'warrior', SELF, LAND).id));
      const w = build(subject, p);
      return upgradePrice(w.ctx, w.ctx.unitById.get(id) as Unit, unitDef('swordsman'));
    }
    case 'techCost': {
      p.techs = false;
      const tech: TechId = 'rocketry';
      if (modifier.knownByOther === true) p.prepares.push((draft) => must(draft.polities[FOE]).techs.push(tech));
      return techCost(build(subject, p).state, SELF, tech);
    }
    case 'strength': {
      const when = modifier.when ?? {};
      const type = subject.unit ?? pickUnit(when.unit);
      const sea = unitDef(type).domain === 'sea';
      const foreign = when.territory === 'foreign';
      const hex = sea ? (foreign ? FOE_WATER : WATER) : foreign ? FOE_LAND : LAND;
      const beside = sea ? WATER2 : foreign ? FOE_LAND2 : LAND2;
      shapeHex(p, when.hex, hex, beside, nation);
      let id = 0;
      let enemy = 0;
      p.prepares.push(AT_WAR, (draft) => {
        id = put(draft, type, SELF, hex, when.fortified === true ? { status: 'fortified' } : {}).id;
        if (subject.improvement !== undefined) draft.improvements[hex] = subject.improvement;
        if (when.perAdjacentFriend === true) put(draft, sea ? 'galley' : 'warrior', SELF, beside);
        const rival = when.vsClasses === undefined ? 'warrior' : (ROSTER[when.vsClasses[0] as keyof typeof ROSTER][0] as string);
        enemy = put(draft, rival, FOE, hexAt(20, 6)).id;
      });
      const w = build(subject, p);
      const role = when.role ?? 'attack';
      const againstCity = when.vsCity === true || when.vsCoastalCity === true;
      return fightPercent(w.ctx, w.ctx.unitById.get(id) as Unit, {
        role,
        ranged: when.rangedAttack ?? (role === 'attack' && unitDef(type).range > 0),
        acrossRiver: when.acrossRiver ?? false,
        enemy: FOE,
        enemyUnit: againstCity ? null : (w.ctx.unitById.get(enemy) as Unit),
        enemyCity: againstCity ? (w.ctx.state.cities[FOE_ZONE] as City) : null,
      });
    }
    case 'enemyStrength': {
      let id = 0;
      p.prepares.push(AT_WAR, (draft) => (id = put(draft, 'warrior', FOE, LAND).id));
      const w = build(subject, p);
      return fightPercent(w.ctx, w.ctx.unitById.get(id) as Unit, {
        role: 'attack', ranged: false, acrossRiver: false, enemy: SELF, enemyUnit: null, enemyCity: w.city,
      });
    }
    case 'cityStrength': {
      shapeCity(p, modifier.city, undefined, nation);
      const w = build(subject, p);
      return cityStrength(w.ctx, w.city);
    }
    case 'attrition': {
      shapeHex(p, modifier.hex, LAND, LAND2, nation);
      let id = 0;
      p.prepares.push(AT_WAR, (draft) => (id = put(draft, 'warrior', FOE, LAND).id));
      const w = build(subject, p);
      return attritionOn(w.ctx, w.ctx.unitById.get(id) as Unit);
    }
    case 'heal': {
      const type = subject.unit ?? pickUnit(modifier.unit);
      const sea = unitDef(type).domain === 'sea';
      const hex = sea ? WATER : modifier.territory === 'foreign' ? FOE_LAND : LAND;
      let id = 0;
      p.prepares.push(AT_WAR, (draft) => (id = put(draft, type, SELF, hex).id));
      const w = build(subject, p);
      return healAmount(w.ctx, w.ctx.unitById.get(id) as Unit);
    }
    case 'startXp': {
      const type = subject.unit ?? pickUnit(modifier.unit);
      const w = build(subject, p);
      if (!deliverItem(w.ctx, w.city, { kind: 'unit', unit: type })) throw new Error('no room for the unit');
      return (w.ctx.state.units[w.ctx.state.units.length - 1] as Unit).xp;
    }
    case 'cultureOnKill': {
      let id = 0;
      const type = subject.unit ?? 'warrior';
      p.prepares.push(AT_WAR, (draft) => {
        id = put(draft, type, SELF, LAND).id;
        put(draft, 'settler', FOE, LAND2);
      });
      const w = build(subject, p);
      const result = applyAction(w.state, { type: 'attack', polity: SELF, unit: id, target: LAND2 });
      if (!result.ok) throw new Error(`attack rejected: ${result.reason}`);
      return must(result.state.polities[SELF]).culture - must(w.state.polities[SELF]).culture;
    }
    case 'amphibious': {
      let id = 0;
      p.prepares.push((draft) => (id = put(draft, subject.unit ?? 'warrior', SELF, WATER).id));
      const w = build(subject, p);
      return amphibiousFactor(w.ctx, w.ctx.unitById.get(id) as Unit);
    }
    case 'vision': {
      const type = subject.unit ?? pickUnit(modifier.unit);
      const sea = unitDef(type).domain === 'sea';
      const hex = sea ? WATER : LAND;
      shapeHex(p, modifier.hex, hex, sea ? WATER2 : LAND2, nation);
      let id = 0;
      p.prepares.push((draft) => (id = put(draft, type, SELF, hex).id));
      const w = build(subject, p);
      return visionRange(w.ctx, w.ctx.unitById.get(id) as Unit);
    }
    case 'movement': {
      const type = subject.unit ?? pickUnit(modifier.unit);
      p.tweaks.push((m) => {
        if (modifier.fordRivers === true) {
          m.riverEdges[LAND] = 1;
          m.riverEdges[LAND2] = 8;
        }
        if (modifier.ignoreHills === true) m.hills[LAND2] = 1;
        if (modifier.ignoreRough === true) m.feature[LAND2] = Feature.Forest;
      });
      let id = 0;
      p.prepares.push((draft) => {
        id = put(draft, type, SELF, LAND).id;
        if (modifier.roadCost !== undefined) draft.roads[LAND] = draft.roads[LAND2] = 1;
      });
      const w = build(subject, p);
      return stepCost(w.ctx, w.ctx.unitById.get(id) as Unit, LAND2);
    }
    case 'routeGold': {
      const route = routeFor(p, modifier.route, nation);
      if (modifier.perRiverHexes !== undefined) {
        p.tweaks.push((m) => {
          for (const hex of route.path) m.riverEdges[hex] = 1;
        });
      }
      const w = build(subject, p);
      return routeIncome(w.ctx, route);
    }
    case 'routeRange':
      return landRange(build(subject, p).ctx, SELF);
    case 'routeToll': {
      p.prepares.push(foeRoute(true, FOE_WATER));
      return processRoutes(build(subject, p).ctx)[SELF] as number;
    }
    case 'pillage': {
      const type = subject.unit ?? pickUnit(modifier.unit);
      const sea = unitDef(type).domain === 'sea';
      const routes = sea || modifier.what === 'route';
      const hex = sea ? FOE_WATER : FOE_LAND;
      let id = 0;
      p.prepares.push(AT_WAR, (draft) => {
        id = put(draft, type, SELF, hex).id;
        if (!routes) draft.improvements[hex] = 'farm';
      });
      if (routes) p.prepares.push(foeRoute(sea, hex));
      const w = build(subject, p);
      const result = applyAction(w.state, { type: 'pillage', polity: SELF, unit: id });
      if (!result.ok) throw new Error(`pillage rejected: ${result.reason}`);
      return must(result.state.polities[SELF]).gold - must(w.state.polities[SELF]).gold;
    }
    case 'specialtySale':
      return dealPriceFrom(build(subject, p).ctx, SELF, 'jade');
    case 'dealGold': {
      p.tweaks.push((m) => (m.resource[LAND] = resourceIndex(m, modifier.resource)));
      p.prepares.push((draft) => {
        must(draft.polities[FOE]).gold = 100;
        draft.deals.push({ id: 902, seller: SELF, buyer: FOE, resource: modifier.resource, goldPerTurn: 4, since: 1, until: 20 });
        draft.nextId = 1000;
      });
      return must(endTurn(build(subject, p).state).state.polities[SELF]).dealIncome;
    }
    case 'exclusivePort': {
      const w = build(subject, p);
      const port = w.state.map.offMapPorts.findIndex((entry) => entry.nameEn === modifier.port);
      // The port is closed to everybody but the nation that has it: can polity 0 use it?
      return checkRouteTarget(w.ctx, SELF, HOME_ZONE, { kind: 'port', port }) === null ? 1 : 0;
    }
    case 'tributeTrade': {
      p.prepares.push((draft) => put(draft, subject.unit ?? 'galley', SELF, FOE_WATER));
      return must(endTurn(build(subject, p).state).state.polities[SELF]).grossIncome;
    }
    case 'favourNeeded': {
      if (modifier.vsStronger === true) {
        p.prepares.push((draft) => {
          for (const hex of [FOE_LAND, FOE_LAND2, hexAt(20, 6)]) put(draft, 'warrior', FOE, hex);
        });
      }
      return favourShift(build(subject, p).ctx, SELF, FOE, modifier.agreements[0] as (typeof modifier.agreements)[number]);
    }
    case 'noVassal':
      return checkAgreement(build(subject, p).ctx, FOE, SELF, 'vassalage') === 'refused' ? 1 : 0;
    case 'policySlots':
      return must(build(subject, p).state.polities[SELF]).slots.length;
    case 'swapCooldown':
      return swapCooldown(build(subject, p).ctx, SELF);
    case 'unrest':
    case 'cultureOn': {
      if (modifier.type === 'cultureOn' && modifier.event === 'era') {
        p.techs = false;
        const w = build(subject, p);
        for (const tech of ['farming', 'mining', 'ritual', 'boats'] as const) learnTech(w.ctx, SELF, tech);
        return must(w.ctx.state.polities[SELF]).culture;
      }
      // Polity 0 takes the rival's fallen capital.
      let id = 0;
      p.prepares.push(AT_WAR, (draft) => {
        must(draft.cities[FOE_ZONE]).hp = 0;
        id = put(draft, 'warrior', SELF, FOE_LAND).id;
      });
      const w = build(subject, p);
      const result = applyAction(w.state, { type: 'attack', polity: SELF, unit: id, target: FOE_SITE });
      if (!result.ok) throw new Error(`attack rejected: ${result.reason}`);
      if (modifier.type === 'unrest') return must(result.state.cities[FOE_ZONE]).unrest;
      return must(result.state.polities[SELF]).culture - must(w.state.polities[SELF]).culture;
    }
    case 'improvementSite': {
      const kind = modifier.improvements[modifier.improvements.length - 1] as ImprovementId;
      p.tweaks.push((m) => {
        const terrain = modifier.terrains?.[0];
        if (terrain !== undefined) m.terrain[LAND] = terrain;
        if (modifier.hills === true) m.hills[LAND] = 1;
      });
      const w = build(subject, p);
      return canImprove(w.ctx, SELF, improvementFor(nation ?? '', kind), LAND) ? 1 : 0;
    }
    case 'reveal': {
      p.techs = false;
      p.tweaks.push((m) => (m.resource[LAND] = resourceIndex(m, modifier.resource)));
      p.prepares.push((draft) => (must(draft.polities[SELF]).era = modifier.era));
      return ownsResource(build(subject, p).ctx, SELF, modifier.resource) ? 1 : 0;
    }
    case 'tradePactGold':
    case 'influence':
    case 'tribute':
      throw new Error(`the lab does not measure ${modifier.type}: only policy cards have it`);
  }
}

/** A lab game in which polity 0 has the nation's kit; every polity knows every tech unless `techs` says otherwise. */
export function labGame(
  nation: string | null,
  options: { tweak?: (m: Lab) => void; techs?: readonly TechId[] | 'all'; prepare?: (draft: MutableGameState) => void } = {},
): World {
  const p = plan();
  if (options.tweak !== undefined) p.tweaks.push(options.tweak);
  if (options.prepare !== undefined) p.prepares.push(options.prepare);
  const techs = options.techs ?? 'all';
  p.techs = techs === 'all';
  if (techs !== 'all') {
    const list = techs;
    const w = build({ nation }, p);
    const state = learn(w.state, SELF, list);
    const ctx = createCtx(cloneState(state));
    return { state, ctx, city: must(ctx.state.cities[HOME_ZONE]) };
  }
  return build({ nation }, p);
}
