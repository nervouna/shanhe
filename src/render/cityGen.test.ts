import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import {
  CITY_FAMILY_COUNT,
  CityFamily,
  MAX_HOUSES,
  PART_SHAPE_COUNT,
  PartShape,
  cityRadius,
  familyOfPolity,
  generateCity,
  houseCount,
  partsHeight,
} from './cityGen.ts';
import type { CityFamilyId, CitySpec, Part } from './cityGen.ts';
import { createDemoGallery } from './demoGallery.ts';
import { LANDMARK_IDS, generateLandmark, isLandmark, placeParts } from './landmarks.ts';
import { improvementParts, volcanoParts } from './props.ts';
import { Improvement } from './scene.ts';
import { createFlatMap } from './testMaps.ts';

const spec = (over: Partial<CitySpec> = {}): CitySpec => ({
  seed: 1234,
  population: 6,
  era: 0,
  family: CityFamily.CentralPlains,
  walls: false,
  buildings: 0,
  polityColor: 0x3366cc,
  ...over,
});

const FAMILIES = Object.values(CityFamily) as CityFamilyId[];

function expectSound(parts: readonly Part[]): void {
  for (const part of parts) {
    expect(part.shape).toBeGreaterThanOrEqual(0);
    expect(part.shape).toBeLessThan(PART_SHAPE_COUNT);
    for (const value of [part.x, part.y, part.z, part.w, part.h, part.d, part.yaw]) expect(Number.isFinite(value)).toBe(true);
    expect(part.w).toBeGreaterThan(0);
    expect(part.h).toBeGreaterThan(0);
    expect(part.d).toBeGreaterThan(0);
    expect(part.y).toBeGreaterThanOrEqual(0);
    expect(part.color).toBeGreaterThanOrEqual(0);
    expect(part.color).toBeLessThanOrEqual(0xffffff);
  }
}

describe('generateCity', () => {
  it('gives the same city for the same specification, and another for another seed', () => {
    for (const family of FAMILIES) {
      const a = generateCity(spec({ family, era: 3, walls: true, buildings: 6 }));
      expect(generateCity(spec({ family, era: 3, walls: true, buildings: 6 }))).toEqual(a);
      expect(generateCity(spec({ family, era: 3, walls: true, buildings: 6, seed: 99 }))).not.toEqual(a);
      expectSound(a);
    }
  });

  it('grows with the population', () => {
    for (const family of FAMILIES) {
      let previous = 0;
      let previousRadius = 0;
      for (const population of [1, 4, 9, 16]) {
        const parts = generateCity(spec({ family, population }));
        expect(parts.length).toBeGreaterThan(previous);
        previous = parts.length;
        const radius = cityRadius(population, family);
        expect(radius).toBeGreaterThan(previousRadius);
        previousRadius = radius;
        // everything stands within the town's radius, give or take a house
        for (const part of parts) expect(Math.hypot(part.x, part.z)).toBeLessThan(radius * 1.4 + 0.1);
      }
    }
    expect(houseCount(1, 0)).toBeLessThan(houseCount(8, 0));
    expect(houseCount(500, 5)).toBe(MAX_HOUSES);
  });

  it('carries the owner colour on the hall in the middle', () => {
    for (const family of FAMILIES) {
      const parts = generateCity(spec({ family, polityColor: 0x12ab34 }));
      const hall = parts.filter((part) => part.color === 0x12ab34);
      expect(hall).toHaveLength(1);
      expect(Math.hypot(hall[0]!.x, hall[0]!.z)).toBeLessThan(0.02);
    }
  });

  it('adds a wall around the houses when the city has one', () => {
    for (const family of FAMILIES) {
      const open = generateCity(spec({ family, era: 1 }));
      const walled = generateCity(spec({ family, era: 1, walls: true }));
      expect(walled.length).toBeGreaterThanOrEqual(open.length + 8);
      // the wall stands outside the houses
      const reach = Math.max(...open.map((part) => Math.hypot(part.x, part.z)));
      const outer = Math.max(...walled.map((part) => Math.hypot(part.x, part.z)));
      expect(outer).toBeGreaterThan(reach);
    }
  });

  it('adds public buildings with the number of buildings built', () => {
    for (const family of FAMILIES) {
      const none = generateCity(spec({ family, buildings: 0 }));
      const some = generateCity(spec({ family, buildings: 6 }));
      const many = generateCity(spec({ family, buildings: 12 }));
      expect(some.length).toBeGreaterThan(none.length);
      expect(many.length).toBeGreaterThan(some.length);
    }
  });

  it('goes from houses to works with chimneys to towers with lit windows as the eras pass', () => {
    for (const family of FAMILIES) {
      const eras = [0, 1, 2, 3, 4, 5].map((era) => generateCity(spec({ family, era, population: 12, buildings: 6 })));
      const chimneys = (parts: readonly Part[]): number =>
        parts.filter((part) => part.shape === PartShape.Cylinder && part.h > 0.12 && part.w >= 0.02 && part.w < 0.04).length;
      const lit = (parts: readonly Part[]): number => parts.filter((part) => (part.glow ?? 0) > 0).length;
      for (const early of eras.slice(0, 4)) {
        expect(chimneys(early)).toBe(0);
        expect(lit(early)).toBe(0);
      }
      expect(chimneys(eras[4]!)).toBeGreaterThan(0);
      expect(lit(eras[4]!)).toBe(0);
      expect(chimneys(eras[5]!)).toBeGreaterThan(0);
      expect(lit(eras[5]!)).toBeGreaterThan(2);
      // a modern city stands taller than an ancient one
      expect(partsHeight(eras[5]!)).toBeGreaterThan(partsHeight(eras[0]!));
      expect(eras[5]!.length).toBeGreaterThan(eras[0]!.length);
      for (const parts of eras) expectSound(parts);
    }
  });

  it('builds each family in its own way', () => {
    const cities = FAMILIES.map((family) => generateCity(spec({ family, population: 8 })));
    for (let a = 0; a < cities.length; a++) {
      for (let b = a + 1; b < cities.length; b++) expect(cities[a]).not.toEqual(cities[b]);
    }
    const shapes = (parts: readonly Part[], shape: number): number => parts.filter((part) => part.shape === shape).length;
    const colors = (parts: readonly Part[]): Set<number> => new Set(parts.map((part) => part.color));
    // yurts on the steppe: round walls under conical roofs, and no gables
    const steppe = cities[CityFamily.Steppe]!;
    expect(shapes(steppe, PartShape.Cylinder)).toBeGreaterThan(5);
    expect(shapes(steppe, PartShape.Cone)).toBeGreaterThan(5);
    expect(shapes(steppe, PartShape.Gable)).toBe(0);
    // flat roofs in Tibet
    const tibetan = cities[CityFamily.Tibetan]!;
    expect(shapes(tibetan, PartShape.Gable) + shapes(tibetan, PartShape.Hip)).toBe(0);
    // hipped roofs in Japan, gables in the Central Plains
    expect(shapes(cities[CityFamily.Japanese]!, PartShape.Hip)).toBeGreaterThan(5);
    expect(shapes(cities[CityFamily.CentralPlains]!, PartShape.Gable)).toBeGreaterThan(5);
    // stilts in Southeast Asia: three parts to a house
    expect(cities[CityFamily.SoutheastAsian]!.length).toBeGreaterThan(cities[CityFamily.CentralPlains]!.length * 1.3);
    // a canal in Jiangnan
    expect(colors(cities[CityFamily.Jiangnan]!).has(0x3f8fa8)).toBe(true);
    // no two families share their palette
    for (let a = 0; a < cities.length; a++) {
      for (let b = a + 1; b < cities.length; b++) {
        const shared = [...colors(cities[a]!)].filter((color) => colors(cities[b]!).has(color) && color !== 0x3366cc);
        expect(shared.length).toBeLessThan(colors(cities[a]!).size - 1);
      }
    }
    expect(FAMILIES).toHaveLength(CITY_FAMILY_COUNT);
  });

  it('knows the family of every polity, and falls back to the Central Plains', () => {
    expect(familyOfPolity('yan')).toBe(CityFamily.CentralPlains);
    expect(familyOfPolity('wu')).toBe(CityFamily.Jiangnan);
    expect(familyOfPolity('tubo')).toBe(CityFamily.Tibetan);
    expect(familyOfPolity('mobei')).toBe(CityFamily.Steppe);
    expect(familyOfPolity('yamato')).toBe(CityFamily.Japanese);
    expect(familyOfPolity('siam')).toBe(CityFamily.SoutheastAsian);
    expect(familyOfPolity('beihai')).toBe(CityFamily.Siberian);
    expect(familyOfPolity('nowhere')).toBe(CityFamily.CentralPlains);
    expect(familyOfPolity('constructor')).toBe(CityFamily.CentralPlains);
    // every family has its nations
    expect(new Set(LANDMARK_IDS.map(familyOfPolity)).size).toBe(CITY_FAMILY_COUNT);
  });

  it('copes with nonsense', () => {
    expectSound(generateCity(spec({ population: 0, era: -3 })));
    expectSound(generateCity(spec({ population: 1e6, era: 99, buildings: 1e6, walls: true })));
    expect(generateCity(spec({ population: 1e6, era: 99, buildings: 1e6, walls: true })).length).toBeLessThan(400);
  });
});

describe('landmarks', () => {
  /** The 50 nations, in the order of docs/design/02-nations.md. */
  const NATIONS = [
    'yan', 'jin', 'qi', 'zhongzhou', 'qin', 'longyou', 'xixia', 'qingtang', 'shu', 'ba', 'dian', 'yelang', 'tubo',
    'chu', 'xiaoxiang', 'yuzhang', 'huainan', 'wu', 'yue', 'min', 'dongning', 'lingnan', 'luoyue', 'qiongya',
    'liaodong', 'fuyu', 'heishui', 'monan', 'mobei', 'goryeo', 'ezo', 'togoku', 'yamato', 'tsukushi', 'ryukyu',
    'beihai', 'shuaibin', 'jiaozhi', 'champa', 'lanxang', 'chenla', 'siam', 'pagan', 'malacca', 'srivijaya',
    'shepo', 'boni', 'luzon', 'sulu', 'maluku',
  ];

  it('has one landmark for each of the 50 nations', () => {
    expect(NATIONS).toHaveLength(50);
    expect([...LANDMARK_IDS].sort()).toEqual([...NATIONS].sort());
  });

  it('generates a model for every id: sound parts, not too many, within reach', () => {
    for (const id of LANDMARK_IDS) {
      const parts = generateLandmark(id);
      expect(parts.length, id).toBeGreaterThanOrEqual(4);
      expect(parts.length, id).toBeLessThanOrEqual(48);
      expectSound(parts);
      for (const part of parts) {
        expect(Math.hypot(part.x, part.z), id).toBeLessThanOrEqual(0.36);
        expect(part.y + part.h, id).toBeLessThanOrEqual(0.5);
      }
      // a model, not one block: several shapes or colours
      expect(new Set(parts.map((part) => `${part.shape}:${part.color}`)).size, id).toBeGreaterThanOrEqual(3);
      expect(generateLandmark(id)).toEqual(parts);
    }
  });

  it('makes every landmark its own model', () => {
    const models = LANDMARK_IDS.map((id) => JSON.stringify(generateLandmark(id)));
    expect(new Set(models).size).toBe(50);
    // and not by a hair: no two share their list of shapes
    const outlines = LANDMARK_IDS.map((id) => generateLandmark(id).map((part) => `${part.shape}:${part.w.toFixed(2)}:${part.h.toFixed(2)}`).join(','));
    expect(new Set(outlines).size).toBe(50);
  });

  it('draws them all from the same six shapes, so that they cost no draw calls of their own', () => {
    const shapes = new Set(LANDMARK_IDS.flatMap((id) => generateLandmark(id).map((part) => part.shape)));
    expect(shapes.size).toBe(PART_SHAPE_COUNT);
    const total = LANDMARK_IDS.reduce((sum, id) => sum + generateLandmark(id).length, 0);
    expect(total).toBeLessThan(50 * 30);
  });

  it('gives nothing for an id that names no landmark', () => {
    expect(generateLandmark('atlantis')).toEqual([]);
    expect(generateLandmark('toString')).toEqual([]);
    expect(isLandmark('yan')).toBe(true);
    expect(isLandmark('constructor')).toBe(false);
  });

  it('moves, turns and scales parts as a whole', () => {
    const parts = generateLandmark('yan');
    const placed = placeParts(parts, 2, -1, Math.PI / 2, 0.5);
    expect(placed).toHaveLength(parts.length);
    parts.forEach((part, i) => {
      const moved = placed[i]!;
      // a quarter turn about the vertical axis takes x to -z and z to x
      expect(moved.x).toBeCloseTo(2 + part.z * 0.5, 9);
      expect(moved.z).toBeCloseTo(-1 - part.x * 0.5, 9);
      expect(moved.y).toBeCloseTo(part.y * 0.5, 9);
      expect(moved.w).toBeCloseTo(part.w * 0.5, 9);
      expect(moved.yaw).toBeCloseTo(part.yaw + Math.PI / 2, 9);
    });
  });
});

describe('props', () => {
  it('builds something for every improvement, the same every time, clear of the middle of the hex', () => {
    for (const kind of Object.values(Improvement)) {
      const parts = improvementParts(kind, 77);
      expect(parts.length).toBeGreaterThan(1);
      expect(improvementParts(kind, 77)).toEqual(parts);
      expect(improvementParts(kind, 78)).not.toEqual(parts);
      expectSound(parts);
      for (const part of parts) expect(Math.hypot(part.x, part.z)).toBeLessThan(0.87);
      // the main building keeps off the place where a piece stands
      expect(Math.hypot(parts[parts.length > 4 ? 1 : 0]!.x, parts[parts.length > 4 ? 1 : 0]!.z)).toBeGreaterThan(0.25);
    }
    expect(improvementParts(0, 1)).toEqual([]);
  });

  it('gives a volcano a cone with a glowing crater', () => {
    const parts = volcanoParts(5);
    expectSound(parts);
    expect(parts.some((part) => part.shape === PartShape.Cone && part.w > 0.5)).toBe(true);
    expect(parts.some((part) => (part.glow ?? 0) > 1)).toBe(true);
  });
});

describe('createDemoGallery', () => {
  const map = createFixtureMap();
  const gallery = createDemoGallery(map, new Set([10, 11]), (family, era) => `${family}/${era}`, 200);

  it('shows a city of every family in every era, each with a landmark', () => {
    expect(gallery.cities).toHaveLength(CITY_FAMILY_COUNT * 6);
    const seen = new Set(gallery.cities.map((city) => `${city.family}/${city.era}`));
    expect(seen.size).toBe(CITY_FAMILY_COUNT * 6);
    for (const city of gallery.cities) {
      expect(city.name).toBe(`${city.family}/${city.era}`);
      expect(isLandmark(city.landmark ?? '')).toBe(true);
      expect(map.terrain[city.hex]).toBeGreaterThan(2);
      expect(map.polities[city.polity]).toBeDefined();
    }
    expect(new Set(gallery.cities.map((city) => city.hex)).size).toBe(gallery.cities.length);
  });

  it('shows a piece of every material, plain and unique', () => {
    expect(gallery.units).toHaveLength(12);
    for (const unique of [false, true]) {
      expect(new Set(gallery.units.filter((unit) => unit.unique === unique).map((unit) => unit.era)).size).toBe(6);
    }
    expect(new Set(gallery.units.map((unit) => unit.id)).size).toBe(12);
    for (const unit of gallery.units) expect([...unit.character]).toHaveLength(1);
  });

  it('shows every improvement, roads of both kinds and routes on land and at sea', () => {
    expect(new Set(gallery.improvements.values())).toEqual(new Set(Object.values(Improvement)));
    for (const [hex, kind] of gallery.improvements) {
      expect((map.terrain[hex] as number) <= 2).toBe(kind === Improvement.Fishery);
    }
    expect(new Set(gallery.roads.values())).toEqual(new Set([1, 2]));
    expect(gallery.routes.some((route) => route.sea)).toBe(true);
    expect(gallery.routes.some((route) => !route.sea)).toBe(true);
    for (const route of gallery.routes) expect(route.path.length).toBeGreaterThanOrEqual(2);
  });

  it('uses no hex twice and none that was taken', () => {
    const hexes = [...gallery.cities.map((city) => city.hex), ...gallery.units.map((unit) => unit.hex), ...gallery.improvements.keys()];
    expect(new Set(hexes).size).toBe(hexes.length);
    expect(hexes).not.toContain(10);
    expect(hexes).not.toContain(11);
  });

  it('is empty on a map without polities', () => {
    const empty = createDemoGallery(createFlatMap({ width: 5, height: 4, metres: 10 }), new Set(), () => '');
    expect(empty.cities).toEqual([]);
    expect(empty.units).toEqual([]);
  });
});
