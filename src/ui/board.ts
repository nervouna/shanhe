/** What the renderer draws for a game state. */

import { unitDef } from '../core/data.ts';
import { NO_POLITY } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { topologyOf } from '../core/topology.ts';
import type { PieceEraId, RenderCity, RenderScene, RenderUnit } from '../render/scene.ts';
import type { Language } from '../shared/i18n.ts';
import { OWNER_UNOWNED } from '../shared/mapData.ts';

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
 * The board of a game: every unit and city, and the hexes whose owner is no
 * longer the map's. The rules have no vision yet, so nothing is hidden and
 * there is no fog.
 */
export function sceneOf(state: GameState, language: Language): RenderScene {
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

  return { units, cities, ownerOverrides, fog: null };
}
