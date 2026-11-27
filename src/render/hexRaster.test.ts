import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import { createHexRaster } from './hexRaster.ts';
import { createFlatMap } from './testMaps.ts';

describe('createHexRaster', () => {
  it('maps the pixel under every hex centre to that hex', () => {
    for (const map of [
      createFixtureMap(),
      createFlatMap({ width: 7, height: 11, metres: 0, size: 3, originX: -5, originZ: 40 }),
    ]) {
      const raster = createHexRaster(map);
      const { rect } = raster;
      for (let i = 0; i < map.width * map.height; i++) {
        const p = hexToWorld(indexToOffset(i, map.width), map.projection.hexLayout);
        const px = Math.floor(((p.x - rect.minX) / (rect.maxX - rect.minX)) * raster.width);
        const pz = Math.floor(((p.z - rect.minZ) / (rect.maxZ - rect.minZ)) * raster.height);
        expect(raster.hexAt[pz * raster.width + px]).toBe(i);
      }
    }
  });

  it('marks pixels outside the grid', () => {
    const map = createFlatMap({ width: 7, height: 11, metres: 0 });
    const raster = createHexRaster(map);
    // the first row is not shifted east, so the north-east corner of the
    // rectangle lies beyond its last hex
    expect(raster.hexAt[raster.width - 1]).toBe(-1);
    expect(raster.hexAt[0]).toBe(-1);
    expect(raster.hexAt.every((hex) => hex >= -1 && hex < 7 * 11)).toBe(true);
  });

  it('respects the size limit on large maps', () => {
    const map = createFlatMap({ width: 300, height: 200, metres: 0 });
    const raster = createHexRaster(map, 4, 256);
    expect(raster.width).toBeLessThanOrEqual(256);
    expect(raster.height).toBeLessThanOrEqual(256);
    expect(raster.hexAt.every((hex) => hex >= -1 && hex < 300 * 200)).toBe(true);
  });
});
