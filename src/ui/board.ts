/** What the renderer draws for a game state. */

import { BUILDINGS, IMPROVEMENTS, UNITS, baseBuilding } from '../core/data.ts';
import type { ImprovementId } from '../core/data.ts';
import { NO_POLITY, hexOwner } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { kitOfNation } from '../core/kits.ts';
import type { Family } from '../core/kits.ts';
import { activeRoadUpgrade, eraOfPolity } from '../core/query.ts';
import { topologyOf } from '../core/topology.ts';
import { CityFamily, Improvement, familyOfPolity } from '../render/scene.ts';
import type {
  CityFamilyId,
  ImprovementId as ImprovementLook,
  PieceEraId,
  RenderCity,
  RenderRoute,
  RenderScene,
  RenderUnit,
} from '../render/scene.ts';
import type { Language } from '../shared/i18n.ts';
import { NO_ZONE, OWNER_UNOWNED } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { isHidden } from './sight.ts';
import type { Sight } from './sight.ts';

/** A scene with every optional part of the board filled in. */
export interface BoardScene extends RenderScene {
  readonly improvements: ReadonlyMap<number, ImprovementLook>;
  readonly roads: ReadonlyMap<number, 1 | 2>;
  readonly routes: readonly RenderRoute[];
}

/** The character engraved on each generic unit type's piece (doc 04, "Generic unit roster"). */
export const UNIT_CHARACTERS: Readonly<Record<string, string>> = {
  warrior: '兵',
  swordsman: '剑',
  heavyInfantry: '戟',
  musketeer: '枪',
  rifleman: '步',
  mechInfantry: '装',
  archer: '弓',
  crossbowman: '弩',
  rocketArcher: '火',
  fieldGun: '野',
  machineGun: '机',
  rocketArtillery: '箭',
  chariot: '车',
  horseman: '骑',
  heavyCavalry: '重',
  dragoon: '龙',
  mountedRifleman: '骠',
  tank: '坦',
  batteringRam: '冲',
  catapult: '石',
  trebuchet: '砲',
  heavyCannon: '炮',
  howitzer: '榴',
  missileLauncher: '弹',
  galley: '舟',
  warJunk: '斗',
  junk: '帆',
  shipOfTheLine: '舰',
  ironclad: '铁',
  destroyer: '驱',
  settler: '民',
  tribe: '部',
};

/**
 * What the renderer draws for each improvement of the rules. It has four
 * looks; an improvement takes the one nearest to what it is, and the ice
 * road none: it is drawn as the road it lays.
 */
export const IMPROVEMENT_LOOK: Readonly<Record<ImprovementId, ImprovementLook | null>> = {
  farm: Improvement.Farm,
  mine: Improvement.Mine,
  pasture: Improvement.Pasture,
  fishery: Improvement.Fishery,
  irrigationCanal: Improvement.Farm,
  canal: Improvement.Farm,
  greatWallPass: Improvement.Mine,
  yellowRiverCanal: Improvement.Farm,
  dujiangyan: Improvement.Farm,
  seawall: Improvement.Farm,
  lingquCanal: Improvement.Farm,
  ginsengFarm: Improvement.Farm,
  forestry: Improvement.Mine,
  salmonFishery: Improvement.Fishery,
  iceRoad: null,
  baray: Improvement.Farm,
  riceTerrace: Improvement.Farm,
  spiceGarden: Improvement.Farm,
};

const FAMILY_OF_KIT: Readonly<Record<Family, CityFamilyId>> = {
  centralPlains: CityFamily.CentralPlains,
  jiangnan: CityFamily.Jiangnan,
  tibetan: CityFamily.Tibetan,
  steppe: CityFamily.Steppe,
  japanese: CityFamily.Japanese,
  southeastAsian: CityFamily.SoutheastAsian,
  siberian: CityFamily.Siberian,
};

/**
 * The architectural family of a polity (by `MapPolity.id`): the one its kit
 * names (doc 02), or the renderer's own table for a polity without a kit.
 */
export function familyOf(polityId: string): CityFamilyId {
  const kit = kitOfNation(polityId);
  return kit === null ? familyOfPolity(polityId) : FAMILY_OF_KIT[kit.family];
}

/** The piece of a unit type: its character, whether it is engraved in gold, and its era's material. */
export function pieceOf(type: string): Pick<RenderUnit, 'character' | 'unique' | 'era'> {
  const def = UNITS[type];
  return {
    character: def?.piece ?? UNIT_CHARACTERS[type] ?? '？',
    unique: def !== undefined && def.nation !== null,
    era: Math.max(0, Math.min(5, def?.era ?? 0)) as PieceEraId,
  };
}

/** True if the improvement on the hex yields nothing now: it was pillaged. */
function isPillaged(state: GameState, hex: number): boolean {
  return (state.pillaged[hex] ?? 0) >= state.turn;
}

/**
 * The nation whose landmark stands in each city, by zone: where its unique
 * building was built, where its unique improvement lies on the land a city
 * works, and, for a nation whose unique building is a road upgrade, in its
 * capital once it knows the tech. The landmark follows what was built, not
 * who holds the city.
 */
function landmarks(state: GameState): Map<number, string> {
  const { map } = state;
  const topo = topologyOf(map);
  const found = new Map<number, string>();
  state.polities.forEach((polity, index) => {
    const id = map.polities[index]?.id;
    if (polity.alive && polity.capital >= 0 && id !== undefined && activeRoadUpgrade(state, index) !== null) {
      found.set(polity.capital, id);
    }
  });
  for (const [key, id] of Object.entries(state.improvements)) {
    const hex = Number(key);
    const nation = IMPROVEMENTS[id].nation;
    const zone = topo.workZone[hex] ?? -1;
    if (nation !== undefined && zone >= 0 && !isPillaged(state, hex)) found.set(zone, nation);
  }
  for (const city of state.cities) {
    if (city === null) continue;
    for (const id of city.buildings) {
      const nation = BUILDINGS[id].nation;
      if (nation !== null) found.set(city.zone, nation);
    }
  }
  return found;
}

/** A city as the board draws it, without its place and its name. */
export interface CityRecord {
  readonly owner: number;
  readonly population: number;
  readonly family: CityFamilyId;
  readonly era: PieceEraId;
  readonly walls: boolean;
  readonly buildings: number;
  /** The nation whose landmark stands in it, if any. */
  readonly landmark?: string;
}

/**
 * What the player has seen of the board outside their own land, kept by the
 * interface: the rules remember which hexes were seen, not what stood there.
 */
export interface BoardMemory {
  /** By zone: the city as last seen, or null for a site last seen empty. A zone that is missing was never seen. */
  readonly cities: ReadonlyMap<number, CityRecord | null>;
  /** By hex: the improvement last seen there. */
  readonly improvements: ReadonlyMap<number, ImprovementLook>;
  /** By hex: the road last seen there. */
  readonly roads: ReadonlyMap<number, 1 | 2>;
}

/** The player's sight and what they remember: what a scene under fog is derived from. */
export interface BoardView {
  readonly sight: Sight;
  readonly memory: BoardMemory;
}

/** Every city of the state as the board draws it, by zone. */
function cityRecords(state: GameState): Map<number, CityRecord> {
  const { map } = state;
  const marks = landmarks(state);
  const records = new Map<number, CityRecord>();
  for (const city of state.cities) {
    if (city === null) continue;
    const zone = map.zones[city.zone];
    if (zone === undefined) continue;
    // the houses are those of the people who built the city: the nation the map gives the site to, or else its owner
    const founder = map.polities[map.owner[zone.siteHex] ?? -1] ?? map.polities[city.owner];
    const landmark = marks.get(city.zone);
    records.set(city.zone, {
      owner: city.owner,
      population: city.pop,
      family: founder === undefined ? CityFamily.CentralPlains : familyOf(founder.id),
      era: Math.max(0, Math.min(5, eraOfPolity(state, city.owner))) as PieceEraId,
      walls: city.buildings.some((id) => baseBuilding(id) === 'walls'),
      buildings: city.buildings.length,
      ...(landmark === undefined ? {} : { landmark }),
    });
  }
  return records;
}

function liveImprovements(state: GameState): Map<number, ImprovementLook> {
  const improvements = new Map<number, ImprovementLook>();
  for (const [key, id] of Object.entries(state.improvements)) {
    const hex = Number(key);
    const look = IMPROVEMENT_LOOK[id];
    if (look !== null && !isPillaged(state, hex)) improvements.set(hex, look);
  }
  return improvements;
}

function liveRoads(state: GameState): Map<number, 1 | 2> {
  const roads = new Map<number, 1 | 2>();
  for (const [hex, level] of Object.entries(state.roads)) roads.set(Number(hex), level >= 2 ? 2 : 1);
  return roads;
}

/**
 * What everybody knows before they have seen anything: the capitals the
 * polities start with stand where the map puts them (doc 03, "Fog of war"),
 * as they are on the first turn.
 */
export function startingMemory(map: MapData): BoardMemory {
  const cities = new Map<number, CityRecord | null>();
  map.polities.forEach((polity, index) => {
    if (polity.kind === 'wastelandRegion' || polity.capitalZone === NO_ZONE) return;
    const cityState = polity.kind === 'cityState';
    cities.set(polity.capitalZone, {
      owner: index,
      population: 1,
      family: familyOf(polity.id),
      era: 0,
      walls: cityState,
      buildings: cityState ? 1 : 0,
    });
  });
  return { cities, improvements: new Map(), roads: new Map() };
}

/**
 * The memory after the player has looked at `state`: every city site,
 * improvement and road in sight is recorded as it is now, and what is out of
 * sight stays as it was last seen.
 *
 * @param previous the memory so far, or null at the start: then it begins with {@link startingMemory}.
 */
export function remember(previous: BoardMemory | null, state: GameState, sight: Sight): BoardMemory {
  const { map } = state;
  const base = previous ?? startingMemory(map);
  const cities = new Map(base.cities);
  const improvements = new Map(base.improvements);
  const roads = new Map(base.roads);
  const records = cityRecords(state);
  map.zones.forEach((zone, index) => {
    const live = records.get(index) ?? null;
    // a city the player held and holds no more: they know who took it, in sight or not
    const lost = cities.get(index)?.owner === sight.viewer && live?.owner !== sight.viewer;
    if (sight.visible[zone.siteHex] === 1 || live?.owner === sight.viewer || lost) cities.set(index, live);
  });
  const nowImprovements = liveImprovements(state);
  const nowRoads = liveRoads(state);
  const sync = <T>(memory: Map<number, T>, now: Map<number, T>, hex: number): void => {
    const value = now.get(hex);
    if (value === undefined) memory.delete(hex);
    else memory.set(hex, value);
  };
  for (let hex = 0; hex < sight.visible.length; hex++) {
    if (sight.visible[hex] !== 1) continue;
    sync(improvements, nowImprovements, hex);
    sync(roads, nowRoads, hex);
  }
  return { cities, improvements, roads };
}

/** The parts of a path that lie on hexes for which `shown` is true, each at least two hexes long. */
function shownRuns(path: readonly number[], shown: (hex: number) => boolean): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  for (const hex of path) {
    if (shown(hex)) run.push(hex);
    else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/**
 * The board of a game: units and cities, the hexes whose owner is no longer
 * the map's, the improvements, the roads and the trade routes.
 *
 * Without a `view` (observer mode) everything is on it and there is no fog.
 * With one it is the board as the player knows it (doc 03, "Fog of war"):
 *
 * - their own units, cities and land as they are;
 * - foreign units only on hexes in sight;
 * - a foreign city in sight as it is, one out of sight as the memory has it
 *   (its owner and size when last seen), and none where no city is known;
 * - improvements and roads out of sight as last seen; of a foreign trade
 *   route the parts in sight;
 * - borders as they are: they are always known.
 */
export function sceneOf(state: GameState, language: Language, view: BoardView | null = null): BoardScene {
  const { map } = state;
  const topo = topologyOf(map);
  const sight = view?.sight ?? null;
  const viewer = sight?.viewer ?? NO_POLITY;
  const seen = (hex: number): boolean => sight === null || sight.visible[hex] === 1;

  const units: RenderUnit[] = [];
  for (const unit of state.units) {
    if (isHidden(sight, unit)) continue;
    units.push({
      id: unit.id,
      hex: unit.hex,
      polity: unit.owner,
      ...pieceOf(unit.type),
      hp: Math.max(0, Math.min(1, unit.hp / 100)),
    });
  }

  const records = cityRecords(state);
  const cities: RenderCity[] = [];
  map.zones.forEach((zone, index) => {
    const live = records.get(index);
    const asItIs = view === null || seen(zone.siteHex) || live?.owner === viewer;
    const record = asItIs ? live : view.memory.cities.get(index);
    if (record === undefined || record === null) return;
    const { owner, population, ...look } = record;
    cities.push({
      hex: zone.siteHex,
      polity: owner,
      population,
      name: language === 'zh' ? zone.cityNameZh : zone.cityNameEn,
      ...look,
    });
  });

  const ownerOverrides = new Map<number, number>();
  state.zoneOwner.forEach((owner, zone) => {
    // `NO_POLITY` is also the map's value for sea: unsettled land has its own
    const value = owner === NO_POLITY ? OWNER_UNOWNED : owner;
    for (const hex of topo.zoneHexes[zone] ?? []) {
      if (map.owner[hex] !== value) ownerOverrides.set(hex, value);
    }
  });

  // the player's own land is known as it is, wherever their sight ends
  const current = (hex: number): boolean => seen(hex) || hexOwner(state, hex) === viewer;
  const merged = <T>(now: Map<number, T>, memory: ReadonlyMap<number, T> | undefined): Map<number, T> => {
    if (memory === undefined) return now;
    const out = new Map<number, T>();
    for (const [hex, value] of now) if (current(hex)) out.set(hex, value);
    for (const [hex, value] of memory) if (!current(hex)) out.set(hex, value);
    return out;
  };
  const improvements = merged(liveImprovements(state), view?.memory.improvements);
  const roads = merged(liveRoads(state), view?.memory.roads);
  const routes: RenderRoute[] = [];
  for (const route of state.routes) {
    if (sight === null || route.owner === viewer) routes.push({ path: route.path, polity: route.owner, sea: route.sea });
    else for (const path of shownRuns(route.path, seen)) routes.push({ path, polity: route.owner, sea: route.sea });
  }

  return { units, cities, ownerOverrides, fog: sight?.fog ?? null, improvements, roads, routes };
}

// ------------------------------------------------------- memory in storage

/** The memory as plain JSON data. */
export function encodeMemory(memory: BoardMemory): unknown {
  return {
    cities: [...memory.cities],
    improvements: [...memory.improvements],
    roads: [...memory.roads],
  };
}

function isIndex(value: unknown, count: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count;
}

function decodeCity(value: unknown, map: MapData): CityRecord | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const { owner, population, family, era, walls, buildings, landmark } = value as Record<string, unknown>;
  if (!isIndex(owner, map.polities.length) || !isIndex(population, 1000) || !isIndex(buildings, 1000)) return undefined;
  if (!isIndex(era, 6) || typeof walls !== 'boolean') return undefined;
  if (!(Object.values(CityFamily) as unknown[]).includes(family)) return undefined;
  if (landmark !== undefined && !map.polities.some((polity) => polity.id === landmark)) return undefined;
  return {
    owner,
    population,
    family: family as CityFamilyId,
    era: era as PieceEraId,
    walls,
    buildings,
    ...(landmark === undefined ? {} : { landmark: landmark as string }),
  };
}

/** The memory {@link encodeMemory} wrote, for `map`, or null if the data is not one. Checked as data, entry by entry. */
export function decodeMemory(data: unknown, map: MapData): BoardMemory | null {
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Record<string, unknown>;
  const count = map.width * map.height;
  const pairs = (value: unknown): [unknown, unknown][] | null =>
    Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2) ? (value as [unknown, unknown][]) : null;
  const cityPairs = pairs(fields.cities);
  const improvementPairs = pairs(fields.improvements);
  const roadPairs = pairs(fields.roads);
  if (cityPairs === null || improvementPairs === null || roadPairs === null) return null;
  const cities = new Map<number, CityRecord | null>();
  for (const [zone, value] of cityPairs) {
    const record = decodeCity(value, map);
    if (!isIndex(zone, map.zones.length) || record === undefined) return null;
    cities.set(zone, record);
  }
  const looks = Object.values(Improvement) as unknown[];
  const improvements = new Map<number, ImprovementLook>();
  for (const [hex, look] of improvementPairs) {
    if (!isIndex(hex, count) || !looks.includes(look)) return null;
    improvements.set(hex, look as ImprovementLook);
  }
  const roads = new Map<number, 1 | 2>();
  for (const [hex, level] of roadPairs) {
    if (!isIndex(hex, count) || (level !== 1 && level !== 2)) return null;
    roads.set(hex, level);
  }
  return { cities, improvements, roads };
}

/** The lens the renderer looks through, in degrees: what a distance shows depends on it. */
const VIEW_ANGLE = 38;
/** A landscape window is about this much wider than it is high. */
const VIEW_ASPECT = 1.6;
/** Air around the map when the whole of it is in view. */
const WHOLE_MAP_MARGIN = 1.12;

/**
 * Where the camera stands to show the whole map: above its middle, at the
 * distance at which its larger side fits the view. Computed from the map
 * alone; the renderer keeps the distance within its own limits.
 */
export function wholeMapView(map: MapData): { readonly x: number; readonly z: number; readonly distance: number } {
  const { size, originX, originZ } = map.projection.hexLayout;
  const hexWidth = Math.sqrt(3) * size;
  const minX = originX - hexWidth / 2;
  const maxX = originX + hexWidth * map.width;
  const minZ = originZ - size;
  const maxZ = originZ + 1.5 * size * (map.height - 1) + size;
  const span = Math.max((maxX - minX) / VIEW_ASPECT, maxZ - minZ);
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    distance: (WHOLE_MAP_MARGIN * span) / (2 * Math.tan((VIEW_ANGLE * Math.PI) / 360)),
  };
}
