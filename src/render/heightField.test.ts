import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexNeighbors, hexToWorld, indexToOffset } from '../shared/hex.ts';
import { Feature, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import {
  SEA_LEVEL,
  VOLCANO_CRATER,
  VOLCANO_HEIGHT,
  VOLCANO_RADIUS,
  VERTICAL_EXAGGERATION,
  createSurface,
  mapWorldRect,
  sampleHeight,
  surfaceHeightAt,
  surfaceHeightAtHex,
  unitsPerMetre,
  volcanoRise,
} from './heightField.ts';
import type { HeightField } from './heightField.ts';
import { loadRealMap } from './realMapForTests.ts';
import { createFlatMap } from './testMaps.ts';

describe('unitsPerMetre', () => {
  it('applies the vertical exaggeration to the map scale', () => {
    const map = createFlatMap({ width: 4, height: 4, metres: 0 });
    expect(VERTICAL_EXAGGERATION).toBe(10);
    expect(unitsPerMetre(map)).toBeCloseTo(10 / (map.projection.kmPerWorldUnit * 1000), 12);
  });
});

describe('sampleHeight', () => {
  const field: HeightField = {
    cols: 3,
    rows: 2,
    rect: { minX: 10, minZ: -4, maxX: 14, maxZ: -2 },
    heights: new Float32Array([0, 2, 4, 10, 12, 14]),
    minY: 0,
    maxY: 14,
  };

  it('returns the samples at the sample points', () => {
    expect(sampleHeight(field, 10, -4)).toBe(0);
    expect(sampleHeight(field, 12, -4)).toBe(2);
    expect(sampleHeight(field, 14, -2)).toBe(14);
  });

  it('interpolates bilinearly between samples', () => {
    expect(sampleHeight(field, 11, -4)).toBeCloseTo(1, 6);
    expect(sampleHeight(field, 10, -3)).toBeCloseTo(5, 6);
    expect(sampleHeight(field, 13, -3.5)).toBeCloseTo(3 + 2.5, 6);
  });

  it('clamps outside the rectangle', () => {
    expect(sampleHeight(field, -100, -100)).toBe(0);
    expect(sampleHeight(field, 100, 100)).toBe(14);
  });
});

describe('surface of a flat map', () => {
  for (const options of [
    { width: 9, height: 7, metres: 500 },
    { width: 31, height: 5, metres: -120, size: 2.5, originX: -40, originZ: 12 },
  ]) {
    it(`is flat at the scaled elevation (${options.width} x ${options.height})`, () => {
      const map = createFlatMap(options);
      const surface = createSurface(map);
      const expected = options.metres * unitsPerMetre(map);
      for (let i = 0; i < map.width * map.height; i++) {
        expect(surfaceHeightAtHex(surface, i)).toBeCloseTo(expected, 5);
      }
      const rect = mapWorldRect(map);
      expect(surfaceHeightAt(surface, (rect.minX + rect.maxX) / 2, rect.minZ)).toBeCloseTo(expected, 5);
    });
  }

  it('covers every hex with the height field', () => {
    const map = createFlatMap({ width: 6, height: 5, metres: 0, size: 2, originX: 3, originZ: -7 });
    const rect = mapWorldRect(map);
    const layout = map.projection.hexLayout;
    for (let i = 0; i < map.width * map.height; i++) {
      const p = hexToWorld(indexToOffset(i, map.width), layout);
      expect(p.x - (Math.sqrt(3) * layout.size) / 2).toBeGreaterThanOrEqual(rect.minX - 1e-9);
      expect(p.x + (Math.sqrt(3) * layout.size) / 2).toBeLessThanOrEqual(rect.maxX + 1e-9);
      expect(p.z - layout.size).toBeGreaterThanOrEqual(rect.minZ - 1e-9);
      expect(p.z + layout.size).toBeLessThanOrEqual(rect.maxZ + 1e-9);
    }
  });
});

describe('surface from a heightmap', () => {
  it('converts the stored values to world heights', () => {
    const map = createFlatMap({ width: 6, height: 5, metres: 0 });
    const { width, height, baseMetres, metresPerUnit } = map.heightmap;
    const samples = new Uint16Array(width * height).fill(5000);
    const surface = createSurface(map, samples);
    const expected = (baseMetres + 5000 * metresPerUnit) * unitsPerMetre(map);
    expect(surface.field.cols).toBe(width);
    expect(surface.field.rows).toBe(height);
    for (let i = 0; i < map.width * map.height; i++) {
      expect(surfaceHeightAtHex(surface, i)).toBeCloseTo(expected, 5);
    }
  });

  it('rejects a heightmap of the wrong size', () => {
    const map = createFlatMap({ width: 6, height: 5, metres: 0 });
    expect(() => createSurface(map, new Uint16Array(7))).toThrow(/heightmap/);
  });
});

describe('surface of the fixture map', () => {
  const map = createFixtureMap();
  const surface = createSurface(map);
  const scale = unitsPerMetre(map);
  const count = map.width * map.height;

  it('follows the hex elevations on open land', () => {
    let checked = 0;
    for (let i = 0; i < count; i++) {
      const terrain = map.terrain[i] as number;
      if (isWaterTerrain(terrain) || terrain === Terrain.Mountain || map.hills[i] === 1) continue;
      const expected = (map.elevation[i] as number) * scale;
      expect(Math.abs(surfaceHeightAtHex(surface, i) - expected)).toBeLessThan(0.02);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('raises mountains well above the plains', () => {
    for (let i = 0; i < count; i++) {
      if (map.terrain[i] !== Terrain.Mountain) continue;
      expect(surfaceHeightAtHex(surface, i)).toBeGreaterThan(2000 * scale);
    }
  });

  it('puts the sea surface at sea level over a lower sea floor', () => {
    for (let i = 0; i < count; i++) {
      const terrain = map.terrain[i] as number;
      if (terrain !== Terrain.Ocean && terrain !== Terrain.Coast) continue;
      expect(surfaceHeightAtHex(surface, i)).toBe(SEA_LEVEL);
      const p = hexToWorld(indexToOffset(i, map.width), map.projection.hexLayout);
      expect(sampleHeight(surface.field, p.x, p.z)).toBeLessThan(SEA_LEVEL);
    }
  });

  it('gives the lake a surface above its bed and below its shore', () => {
    const lake = map.terrain.indexOf(Terrain.Lake);
    expect(lake).toBeGreaterThanOrEqual(0);
    const level = surface.waterLevel[lake] as number;
    const layout = map.projection.hexLayout;
    const centre = hexToWorld(indexToOffset(lake, map.width), layout);
    expect(surfaceHeightAtHex(surface, lake)).toBe(level);
    expect(sampleHeight(surface.field, centre.x, centre.z)).toBeLessThan(level);
    for (const n of hexNeighbors(indexToOffset(lake, map.width))) {
      const p = hexToWorld(n, layout);
      expect(sampleHeight(surface.field, p.x, p.z)).toBeGreaterThan(level);
    }
  });

  it('marks land with no water level', () => {
    for (let i = 0; i < count; i++) {
      const water = isWaterTerrain(map.terrain[i] as number);
      expect(Number.isNaN(surface.waterLevel[i] as number)).toBe(!water);
    }
  });
});

describe('volcanoRise', () => {
  it('is a cone that runs out into the ground at its foot', () => {
    expect(volcanoRise(VOLCANO_RADIUS, 0)).toBe(0);
    expect(volcanoRise(2, 1)).toBe(0);
    expect(volcanoRise(VOLCANO_RADIUS * 0.99, 0)).toBeLessThan(0.01);
    // higher towards the middle along every bearing, up to the rim
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2;
      let previous = 0;
      for (let r = VOLCANO_RADIUS; r >= VOLCANO_CRATER; r -= 0.03) {
        const rise = volcanoRise(Math.cos(angle) * r, Math.sin(angle) * r);
        expect(rise).toBeGreaterThanOrEqual(previous - 0.012);
        previous = Math.max(previous, rise);
      }
      expect(previous).toBeGreaterThan(VOLCANO_HEIGHT * 0.8);
      expect(previous).toBeLessThanOrEqual(VOLCANO_HEIGHT + 1e-9);
    }
  });

  it('has a crater inside its rim', () => {
    const rim = volcanoRise(VOLCANO_CRATER, 0);
    const floor = volcanoRise(0, 0);
    expect(rim).toBeCloseTo(VOLCANO_HEIGHT, 6);
    expect(floor).toBeLessThan(rim - 0.08);
    expect(floor).toBeGreaterThan(VOLCANO_HEIGHT * 0.5);
    // no step at the rim
    expect(Math.abs(volcanoRise(VOLCANO_CRATER - 0.001, 0) - volcanoRise(VOLCANO_CRATER + 0.001, 0))).toBeLessThan(0.01);
  });

  it('stands on the volcano hex of the fixture map', () => {
    const map = createFixtureMap();
    const volcano = map.feature.indexOf(Feature.Volcano);
    expect(volcano).toBeGreaterThanOrEqual(0);
    const surface = createSurface(map);
    const centre = hexToWorld(indexToOffset(volcano, map.width), map.projection.hexLayout);
    const size = map.projection.hexLayout.size;
    let top = -Infinity;
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2;
      top = Math.max(top, sampleHeight(surface.field, centre.x + Math.cos(angle) * 0.25 * size, centre.z + Math.sin(angle) * 0.25 * size));
    }
    const foot = sampleHeight(surface.field, centre.x + VOLCANO_RADIUS * size, centre.z);
    expect(top).toBeGreaterThan(foot + 0.15 * size);
  });

  it('gives every volcano of the real map a rim higher than its crater', async () => {
    const { map, heightmap } = await loadRealMap();
    const surface = createSurface(map, heightmap);
    const size = map.projection.hexLayout.size;
    let volcanoes = 0;
    for (let index = 0; index < map.width * map.height; index++) {
      if (map.feature[index] !== Feature.Volcano) continue;
      volcanoes++;
      const centre = hexToWorld(indexToOffset(index, map.width), map.projection.hexLayout);
      const floor = sampleHeight(surface.field, centre.x, centre.z);
      let rim = Infinity;
      let foot = -Infinity;
      for (let k = 0; k < 12; k++) {
        const angle = (k / 12) * Math.PI * 2;
        rim = Math.min(rim, sampleHeight(surface.field, centre.x + Math.cos(angle) * VOLCANO_CRATER * size, centre.z + Math.sin(angle) * VOLCANO_CRATER * size));
        foot = Math.max(foot, sampleHeight(surface.field, centre.x + Math.cos(angle) * VOLCANO_RADIUS * size, centre.z + Math.sin(angle) * VOLCANO_RADIUS * size));
      }
      // the whole rim stands over the crater floor
      expect(rim, `volcano ${index}`).toBeGreaterThan(floor + 0.03 * size);
    }
    expect(volcanoes).toBeGreaterThan(10);
  });
});
