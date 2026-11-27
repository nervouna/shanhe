/**
 * The nation kits against the committed map in `public/data/`: every nation
 * of the map has its kit, every specialty of the kits is a resource of the
 * map under the same names, and every trait that depends on the land has
 * land of that kind in its nation.
 */

import { describe, expect, it } from 'vitest';
import { cloneState, createCtx } from '../src/core/context.ts';
import { createGame } from '../src/core/game.ts';
import { KITS, KIT_NATIONS, WASTELAND_LUXURIES } from '../src/core/kits.ts';
import { cityMatches, hexMatches } from '../src/core/modifiers.ts';
import type { CityWhen, HexWhen } from '../src/core/mods.ts';
import { dictionaries } from '../src/shared/i18n.ts';
import { Terrain } from '../src/shared/mapData.ts';
import { loadMap } from './pipeline/loadMap.ts';

const { map } = loadMap();
const state = createGame(map, { seed: 1 });
const ctx = createCtx(cloneState(state));
const text = (language: 'zh' | 'en', key: string): string | undefined =>
  (dictionaries[language] as Record<string, string>)[key];

/** The 50 nations of doc 02, in its order: id, Chinese name, English name. */
const NATIONS: readonly (readonly [id: string, zh: string, en: string])[] = [
  ['yan', '燕', 'Yan'], ['jin', '晋', 'Jin'], ['qi', '齐', 'Qi'], ['zhongzhou', '中州', 'Zhongzhou'], ['qin', '秦', 'Qin'],
  ['longyou', '陇右', 'Longyou'], ['xixia', '西夏', 'Xixia'], ['qingtang', '青唐', 'Qingtang'], ['shu', '蜀', 'Shu'],
  ['ba', '巴', 'Ba'], ['dian', '滇', 'Dian'], ['yelang', '夜郎', 'Yelang'], ['tubo', '吐蕃', 'Tubo'], ['chu', '楚', 'Chu'],
  ['xiaoxiang', '潇湘', 'Xiaoxiang'], ['yuzhang', '豫章', 'Yuzhang'], ['huainan', '淮南', 'Huainan'], ['wu', '吴', 'Wu'],
  ['yue', '越', 'Yue'], ['min', '闽', 'Min'], ['dongning', '东宁', 'Dongning'], ['lingnan', '岭南', 'Lingnan'],
  ['luoyue', '骆越', 'Luoyue'], ['qiongya', '琼崖', 'Qiongya'], ['liaodong', '辽东', 'Liaodong'], ['fuyu', '扶余', 'Fuyu'],
  ['heishui', '黑水', 'Heishui'], ['monan', '漠南', 'Monan'], ['mobei', '漠北', 'Mobei'], ['goryeo', '高丽', 'Goryeo'],
  ['ezo', '虾夷', 'Ezo'], ['togoku', '东国', 'Togoku'], ['yamato', '大和', 'Yamato'], ['tsukushi', '筑紫', 'Tsukushi'],
  ['ryukyu', '琉球', 'Ryukyu'], ['beihai', '北海', 'Beihai'], ['shuaibin', '率宾', 'Shuaibin'], ['jiaozhi', '交趾', 'Jiaozhi'],
  ['champa', '占城', 'Champa'], ['lanxang', '澜沧', 'Lan Xang'], ['chenla', '真腊', 'Chenla'], ['siam', '暹罗', 'Siam'],
  ['pagan', '蒲甘', 'Pagan'], ['malacca', '满剌加', 'Malacca'], ['srivijaya', '三佛齐', 'Srivijaya'], ['shepo', '阇婆', 'Shepo'],
  ['boni', '渤泥', 'Boni'], ['luzon', '吕宋', 'Luzon'], ['sulu', '苏禄', 'Sulu'], ['maluku', '美洛居', 'Maluku'],
];

describe('the kits on the real map', () => {
  it('cover the 50 nations of the map, in its order', () => {
    const nations = map.polities.filter((polity) => polity.kind === 'nation').map((polity) => polity.id);
    expect(nations).toEqual(KIT_NATIONS);
  });

  it('find every nation of doc 02 on the map under its Chinese and its English name', () => {
    expect(NATIONS).toHaveLength(50);
    expect(NATIONS.map((row) => row[0])).toEqual(KIT_NATIONS);
    for (const [id, zh, en] of NATIONS) {
      const polity = map.polities.find((entry) => entry.id === id);
      expect(polity?.kind, id).toBe('nation');
      expect(polity?.nameZh, id).toBe(zh);
      expect(polity?.nameEn, id).toBe(en);
    }
  });

  it('find all 54 specialties on the map, named alike in both languages', () => {
    const specialties = [...KIT_NATIONS.map((nation) => KITS[nation]!.specialty), ...Object.values(WASTELAND_LUXURIES)];
    expect(new Set(specialties).size).toBe(54);
    for (const id of specialties) {
      const index = map.resources.findIndex((resource) => resource.id === id);
      expect(index, id).toBeGreaterThanOrEqual(0);
      expect(text('zh', `specialty.${id}`), id).toBe(map.resources[index]!.nameZh);
      expect(text('en', `specialty.${id}`), id).toBe(map.resources[index]!.nameEn);
      expect(ctx.topo.resourceHexes[index]!.length, id).toBeGreaterThan(0);
    }
    // Each lies in its own nation or region, where the rules for luxuries find it.
    map.polities.forEach((polity, index) => {
      const id = KITS[polity.id]?.specialty ?? WASTELAND_LUXURIES[polity.id];
      if (id === undefined) return;
      const resource = map.resources.findIndex((entry) => entry.id === id);
      const inside = ctx.topo.resourceHexes[resource]!.some((hex) => {
        const zone = map.zone[hex]! >= 0 ? map.zone[hex]! : ctx.topo.workZone[hex]!;
        return zone >= 0 && map.zones[zone]!.polity === index;
      });
      expect(inside, `${id} in ${polity.id}`).toBe(true);
    });
  });

  it('give every trait that depends on the land some land of that kind at home', () => {
    map.polities.forEach((polity, index) => {
      const kit = KITS[polity.id];
      if (kit === undefined) return;
      const zones = map.zones.flatMap((zone, z) => (zone.polity === index ? [z] : []));
      const hexes = zones.flatMap((zone) => [...ctx.topo.workHexes[zone]!, ...ctx.topo.zoneMountains[zone]!]);
      const land = (when: HexWhen | undefined): boolean => {
        // Improvements come later: only the ground is asked for.
        const ground: HexWhen = { ...when, improvement: undefined };
        return hexes.some((hex) => hexMatches(ctx, ground, hex));
      };
      const city = (when: CityWhen | undefined): boolean =>
        zones.some((zone) => {
          const found = state.cities[zone] ?? { ...state.cities[polity.capitalZone]!, zone };
          const site: CityWhen = {
            hillSite: when?.hillSite,
            mountainsNear: when?.mountainsNear,
            waterway: when?.waterway,
            coastal: when?.coastal,
          };
          return cityMatches(ctx, site, found);
        });
      let sites = 0;
      let fitting = 0;
      for (const modifier of kit.trait) {
        const what = `${polity.id}: ${JSON.stringify(modifier)}`;
        // 夜郎 starts without a mountain: its mountain yields wait for land it takes, its hill farms do not.
        if (modifier.type === 'hexYield' && modifier.hex.terrain?.includes(Terrain.Mountain) === true) continue;
        if (modifier.type === 'hexYield' || modifier.type === 'attrition') expect(land(modifier.hex), what).toBe(true);
        if (modifier.type === 'cityYield' || modifier.type === 'cityStrength') expect(city(modifier.city), what).toBe(true);
        if (modifier.type === 'improvementSite') {
          sites++;
          const terrains = modifier.terrains;
          if (modifier.hills === true ? land({ hills: true }) : land({ terrain: terrains })) fitting++;
        }
      }
      // A nation whose trait opens new ground to improvements has some of that ground.
      if (sites > 0) expect(fitting, polity.id).toBeGreaterThan(0);
    });
  });
});
