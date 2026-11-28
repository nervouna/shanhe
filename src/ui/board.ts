/** What the renderer draws for a game state. */

import { BUILDINGS, IMPROVEMENTS, UNITS, baseBuilding } from '../core/data.ts';
import type { ImprovementId } from '../core/data.ts';
import { NO_POLITY } from '../core/game.ts';
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
import { OWNER_UNOWNED } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';

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

/**
 * The board of a game: every unit and city, the hexes whose owner is no
 * longer the map's, the improvements, the roads and the trade routes. The
 * rules have no vision yet, so nothing is hidden and there is no fog.
 */
export function sceneOf(state: GameState, language: Language): BoardScene {
  const { map } = state;
  const topo = topologyOf(map);

  const units: RenderUnit[] = state.units.map((unit) => ({
    id: unit.id,
    hex: unit.hex,
    polity: unit.owner,
    ...pieceOf(unit.type),
    hp: Math.max(0, Math.min(1, unit.hp / 100)),
  }));

  const marks = landmarks(state);
  const cities: RenderCity[] = [];
  for (const city of state.cities) {
    if (city === null) continue;
    const zone = map.zones[city.zone];
    if (zone === undefined) continue;
    // the houses are those of the people who built the city: the nation the map gives the site to, or else its owner
    const founder = map.polities[map.owner[zone.siteHex] ?? -1] ?? map.polities[city.owner];
    const landmark = marks.get(city.zone);
    cities.push({
      hex: zone.siteHex,
      polity: city.owner,
      population: city.pop,
      name: language === 'zh' ? zone.cityNameZh : zone.cityNameEn,
      family: founder === undefined ? CityFamily.CentralPlains : familyOf(founder.id),
      era: Math.max(0, Math.min(5, eraOfPolity(state, city.owner))) as PieceEraId,
      walls: city.buildings.some((id) => baseBuilding(id) === 'walls'),
      buildings: city.buildings.length,
      ...(landmark === undefined ? {} : { landmark }),
    });
  }

  const ownerOverrides = new Map<number, number>();
  state.zoneOwner.forEach((owner, zone) => {
    // `NO_POLITY` is also the map's value for sea: unsettled land has its own
    const value = owner === NO_POLITY ? OWNER_UNOWNED : owner;
    for (const hex of topo.zoneHexes[zone] ?? []) {
      if (map.owner[hex] !== value) ownerOverrides.set(hex, value);
    }
  });

  const improvements = new Map<number, ImprovementLook>();
  for (const [key, id] of Object.entries(state.improvements)) {
    const hex = Number(key);
    const look = IMPROVEMENT_LOOK[id];
    if (look !== null && !isPillaged(state, hex)) improvements.set(hex, look);
  }
  const roads = new Map<number, 1 | 2>();
  for (const [hex, level] of Object.entries(state.roads)) roads.set(Number(hex), level >= 2 ? 2 : 1);
  const routes = state.routes.map((route) => ({ path: route.path, polity: route.owner, sea: route.sea }));

  return { units, cities, ownerOverrides, fog: null, improvements, roads, routes };
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
