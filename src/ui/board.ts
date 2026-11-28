/** What the renderer draws for a game state. */

import { unitDef } from '../core/data.ts';
import { NO_POLITY } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { topologyOf } from '../core/topology.ts';
import type { PieceEraId, RenderCity, RenderScene, RenderUnit } from '../render/scene.ts';
import type { Language } from '../shared/i18n.ts';
import { OWNER_UNOWNED } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';

/**
 * The roads and trade routes of a scene. The renderer's `RenderScene` gets
 * these two optional fields with the renderer issue; until then the scene
 * carries them as extra data that a renderer without them ignores.
 */
export interface SceneLinks {
  /** Roads by hex index: 1 for a road, 2 for a railway. */
  readonly roads: ReadonlyMap<number, 1 | 2>;
  /** The trade routes in force, each along its hexes. */
  readonly routes: readonly { readonly path: readonly number[]; readonly polity: number; readonly sea: boolean }[];
}

export type BoardScene = RenderScene & SceneLinks;

/** The character engraved on each unit type's piece (doc 04, "Generic unit roster"). */
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
 * The board of a game: every unit and city, the hexes whose owner is no
 * longer the map's, the roads and the trade routes. The rules have no vision yet, so nothing is hidden and
 * there is no fog.
 */
export function sceneOf(state: GameState, language: Language): BoardScene {
  const { map } = state;
  const topo = topologyOf(map);

  const units: RenderUnit[] = state.units.map((unit) => ({
    id: unit.id,
    hex: unit.hex,
    polity: unit.owner,
    character: UNIT_CHARACTERS[unit.type] ?? '？',
    unique: false,
    era: unitDef(unit.type).era as PieceEraId,
    hp: Math.max(0, Math.min(1, unit.hp / 100)),
  }));

  const cities: RenderCity[] = [];
  for (const city of state.cities) {
    if (city === null) continue;
    const zone = map.zones[city.zone];
    if (zone === undefined) continue;
    cities.push({
      hex: zone.siteHex,
      polity: city.owner,
      population: city.pop,
      name: language === 'zh' ? zone.cityNameZh : zone.cityNameEn,
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

  const roads = new Map<number, 1 | 2>();
  for (const [hex, level] of Object.entries(state.roads)) roads.set(Number(hex), level >= 2 ? 2 : 1);
  const routes = state.routes.map((route) => ({ path: route.path, polity: route.owner, sea: route.sea }));

  return { units, cities, ownerOverrides, fog: null, roads, routes };
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
