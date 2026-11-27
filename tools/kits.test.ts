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

describe('the kits on the real map', () => {
  it('cover the 50 nations of the map, in its order', () => {
    const nations = map.polities.filter((polity) => polity.kind === 'nation').map((polity) => polity.id);
    expect(nations).toEqual(KIT_NATIONS);
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
