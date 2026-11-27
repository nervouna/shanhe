/**
 * Cities on the board: each is generated from its population, era,
 * architectural family, walls, buildings and landmark (`cityGen.ts`,
 * `landmarks.ts`) and drawn as parts (`partBatch.ts`). The names are drawn
 * by the label batch (`labels.ts`); this module says where they stand.
 */

import type { Group } from 'three/webgpu';
import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import { CityFamily, cityRadius, generateCity, partsHeight } from './cityGen.ts';
import type { CityFamilyId, Part } from './cityGen.ts';
import { surfaceHeightAt, surfaceHeightAtHex } from './heightField.ts';
import type { Surface } from './heightField.ts';
import { cityTier } from './labelLayout.ts';
import type { CityLabel } from './labels.ts';
import { generateLandmark, placeParts } from './landmarks.ts';
import { createPartBatch } from './partBatch.ts';
import type { RenderCity } from './scene.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface Cities {
  readonly object: Group;
  /**
   * Replaces the cities.
   *
   * @returns where the name of each city stands, or `null` if the cities
   *   are the same as before.
   */
  setCities(cities: readonly RenderCity[]): CityLabel[] | null;
  /** Parts now drawn, landmarks included. */
  readonly parts: number;
  dispose(): void;
}

const F = CityFamily;
/** The family a polity builds in when its cities do not say: by the id of the polity. */
const FAMILY_OF: Readonly<Record<string, CityFamilyId>> = {
  wu: F.Jiangnan, yue: F.Jiangnan, min: F.Jiangnan, dongning: F.Jiangnan, lingnan: F.Jiangnan,
  luoyue: F.Jiangnan, qiongya: F.Jiangnan, yuzhang: F.Jiangnan, huainan: F.Jiangnan,
  xiangjiang: F.Jiangnan, haojing: F.Jiangnan, shen: F.Jiangnan,
  tubo: F.Tibetan, qingtang: F.Tibetan,
  mobei: F.Steppe, monan: F.Steppe, xiyu: F.Steppe,
  togoku: F.Japanese, yamato: F.Japanese, tsukushi: F.Japanese, ryukyu: F.Japanese, tsushima: F.Japanese,
  jiaozhi: F.SoutheastAsian, champa: F.SoutheastAsian, lanxang: F.SoutheastAsian, chenla: F.SoutheastAsian,
  siam: F.SoutheastAsian, pagan: F.SoutheastAsian, malacca: F.SoutheastAsian, srivijaya: F.SoutheastAsian,
  shepo: F.SoutheastAsian, boni: F.SoutheastAsian, luzon: F.SoutheastAsian, sulu: F.SoutheastAsian,
  maluku: F.SoutheastAsian, temasek: F.SoutheastAsian, wenlai: F.SoutheastAsian, dimen: F.SoutheastAsian,
  heishui: F.Siberian, beihai: F.Siberian, shuaibin: F.Siberian, ezo: F.Siberian, jiankun: F.Siberian, jibei: F.Siberian, liugui: F.Siberian,
};

/** The architectural family of a polity's cities: by its id, Central Plains for any other. */
export function familyOfPolity(map: MapData, polity: number): CityFamilyId {
  return FAMILY_OF[map.polities[polity]?.id ?? ''] ?? CityFamily.CentralPlains;
}

/** A landmark is drawn at this share of its size, beside the houses. */
const LANDMARK_SCALE = 0.72;

export function createCities(surface: Surface, u: MapUniforms): Cities {
  const { map } = surface;
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const batch = createPartBatch(u, size, 'cities');
  let shownKey = '';
  const capitalSites = new Set(map.zones.filter((zone) => zone.capital).map((zone) => zone.siteHex));

  return {
    object: batch.object,
    get parts() {
      return batch.count;
    },
    setCities(cities) {
      const key = JSON.stringify(
        cities.map((c) => [c.hex, c.polity, c.population, c.name, c.capital, c.family, c.era, c.walls, c.buildings, c.landmark]),
      );
      if (key === shownKey) return null;
      shownKey = key;

      const world: Part[] = [];
      const labels: CityLabel[] = [];
      for (const city of cities) {
        if (city.hex < 0 || city.hex >= map.width * map.height) continue;
        const centre = hexToWorld(indexToOffset(city.hex, map.width), layout);
        const polityColor = map.polities[city.polity]?.color ?? 0x888888;
        const family = city.family ?? familyOfPolity(map, city.polity);
        let parts = generateCity({
          seed: city.hex,
          population: city.population,
          era: city.era ?? 0,
          family,
          walls: city.walls ?? false,
          buildings: city.buildings ?? 0,
          polityColor,
        });
        if (city.landmark !== undefined) {
          const landmark = generateLandmark(city.landmark);
          if (landmark.length > 0) {
            // beside the houses, on the side the city's hash picks; houses in its way make room
            const angle = ((city.hex * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
            const reach = Math.min(0.5, cityRadius(city.population, family) * 1.15 + 0.2);
            const lx = Math.cos(angle) * reach;
            const lz = Math.sin(angle) * reach;
            const room = 0.34 * LANDMARK_SCALE;
            parts = parts.filter((part) => Math.hypot(part.x - lx, part.z - lz) > room);
            parts = parts.concat(placeParts(landmark, lx, lz, 0, LANDMARK_SCALE));
          }
        }
        for (const part of parts) {
          const x = centre.x + part.x * size;
          const z = centre.z + part.z * size;
          world.push({
            ...part,
            x,
            y: surfaceHeightAt(surface, x, z) + part.y * size,
            z,
            w: part.w * size,
            h: part.h * size,
            d: part.d * size,
          });
        }
        labels.push({
          name: city.name,
          color: polityColor,
          x: centre.x,
          y: surfaceHeightAtHex(surface, city.hex) + (partsHeight(parts) + 0.06) * size,
          z: centre.z,
          tier: cityTier(city.capital ?? capitalSites.has(city.hex), city.population),
          population: city.population,
        });
      }
      batch.set(world);
      return labels;
    },
    dispose() {
      batch.dispose();
    },
  };
}
