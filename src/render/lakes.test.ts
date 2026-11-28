import { beforeAll, describe, expect, it } from 'vitest';
import { hexNeighbors, hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
import { Feature, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { LAKE_BANK, createSurface, sampleHeight, surfaceHeightAt, unitsPerMetre, waterLevelAt } from './heightField.ts';
import type { Surface } from './heightField.ts';
import { createLakeField } from './lakes.ts';
import { loadRealMap } from './realMapForTests.ts';
import { createFlatMap } from './testMaps.ts';

describe('createLakeField', () => {
  function mapWithLakes(lakes: readonly (readonly [col: number, row: number])[]): MapData {
    const map = createFlatMap({ width: 12, height: 12, metres: 50 });
    for (const [col, row] of lakes) map.terrain[row * map.width + col] = Terrain.Lake;
    return map;
  }

  it('makes one lake of neighbouring lake hexes, and one of two groups that only a corner of land keeps apart', () => {
    expect(createLakeField(mapWithLakes([[3, 3], [4, 3], [8, 8]])).bodies.map((b) => b.hexes.length).sort()).toEqual([1, 2]);
    // (5, 5) and (4, 6): two steps apart, with the land hexes (4, 5) and (5, 6) between them
    const field = createLakeField(mapWithLakes([[5, 5], [4, 6]]));
    expect(field.bodies).toHaveLength(1);
    expect(field.bodies[0]!.groups).toBe(2);
    // (3, 3) and (5, 3): two steps apart in one direction, a whole hex between them
    expect(createLakeField(mapWithLakes([[3, 3], [5, 3]])).bodies).toHaveLength(2);
  });

  it('has its shore near the edge of its hexes, and a channel that misses the middle of the land hexes it passes', () => {
    const map = mapWithLakes([[5, 5], [4, 6]]);
    const layout = map.projection.hexLayout;
    const field = createLakeField(map);
    const at = (col: number, row: number): number => {
      const p = hexToWorld({ col, row }, layout);
      return field.at(p.x, p.z)?.distance ?? Infinity;
    };
    expect(at(5, 5)).toBeLessThan(-0.4);
    expect(at(4, 6)).toBeLessThan(-0.4);
    // the middles of the two land hexes between them stay dry, with room for a piece
    expect(at(4, 5)).toBeGreaterThan(0);
    expect(at(5, 6)).toBeGreaterThan(0);
    // the middle of the edge those two share is in the channel
    const a = hexToWorld({ col: 5, row: 5 }, layout);
    const b = hexToWorld({ col: 4, row: 6 }, layout);
    expect(field.at((a.x + b.x) / 2, (a.z + b.z) / 2)!.distance).toBeLessThan(0);
    // far from any lake there is none
    expect(field.at(hexToWorld({ col: 11, row: 0 }, layout).x, hexToWorld({ col: 11, row: 0 }, layout).z)).toBeNull();
  });
});

describe('the lakes of the real map', () => {
  let map: MapData;
  let surface: Surface;
  beforeAll(async () => {
    const real = await loadRealMap();
    map = real.map;
    surface = createSurface(map, real.heightmap);
  }, 120_000);

  /** The lake nearest to a city, by the city's Chinese name. */
  function lakeNear(city: string): number {
    const zone = map.zones.find((z) => z.cityNameZh === city);
    if (zone === undefined) throw new Error(`no city ${city}`);
    const site = hexToWorld(indexToOffset(zone.siteHex, map.width), map.projection.hexLayout);
    let best = -1;
    let nearest = Infinity;
    surface.lakes!.bodies.forEach((body, b) => {
      for (const index of body.hexes) {
        const p = hexToWorld(indexToOffset(index, map.width), map.projection.hexLayout);
        const distance = Math.hypot(p.x - site.x, p.z - site.z);
        if (distance < nearest) {
          nearest = distance;
          best = b;
        }
      }
    });
    expect(nearest, city).toBeLessThan(6);
    return best;
  }

  /**
   * Walks the water of a lake on a fine grid from the middle of its first
   * hex: a sample is wet if it lies inside the shore and the ground there
   * is under the lake's level.
   */
  function flood(body: number): { wet: number; dryInside: number; reached: Set<number>; step: number } {
    const lakes = surface.lakes!;
    const size = map.projection.hexLayout.size;
    const step = size / 10;
    const level = lakes.levels[body]!;
    const hexes = lakes.bodies[body]!.hexes;
    const centres = hexes.map((index) => hexToWorld(indexToOffset(index, map.width), map.projection.hexLayout));
    const minX = Math.min(...centres.map((p) => p.x)) - 2 * size;
    const minZ = Math.min(...centres.map((p) => p.z)) - 2 * size;
    const cols = Math.ceil((Math.max(...centres.map((p) => p.x)) + 2 * size - minX) / step);
    const rows = Math.ceil((Math.max(...centres.map((p) => p.z)) + 2 * size - minZ) / step);
    const wetAt = (i: number, j: number): boolean => {
      const x = minX + i * step;
      const z = minZ + j * step;
      const sample = lakes.at(x, z);
      return sample !== null && sample.body === body && sample.distance < 0 && sampleHeight(surface.field, x, z) < level;
    };
    let dryInside = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = minX + i * step;
        const z = minZ + j * step;
        const sample = lakes.at(x, z);
        // well inside the shore the bed is under water everywhere: no island, no land bridge
        // (a sample of the ground next to the shore is still blended with the bank)
        if (sample !== null && sample.body === body && sample.distance < -0.15 * size && sampleHeight(surface.field, x, z) >= level) dryInside++;
      }
    }
    const seen = new Uint8Array(cols * rows);
    const start = centres[0]!;
    const si = Math.round((start.x - minX) / step);
    const sj = Math.round((start.z - minZ) / step);
    const queue = [sj * cols + si];
    seen[sj * cols + si] = 1;
    let wet = 0;
    for (let n = 0; n < queue.length; n++) {
      const k = queue[n]!;
      const i = k % cols;
      const j = Math.floor(k / cols);
      if (!wetAt(i, j)) continue;
      wet++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || ni >= cols || nj < 0 || nj >= rows || seen[nj * cols + ni] === 1) continue;
        seen[nj * cols + ni] = 1;
        queue.push(nj * cols + ni);
      }
    }
    const reached = new Set<number>();
    hexes.forEach((index, h) => {
      const p = centres[h]!;
      const k = Math.round((p.z - minZ) / step) * cols + Math.round((p.x - minX) / step);
      if (seen[k] === 1 && wetAt(k % cols, Math.floor(k / cols))) reached.add(index);
    });
    return { wet, dryInside, reached, step };
  }

  it('makes Baikal one lake of the hexes that the data holds as separate groups', () => {
    const baikal = surface.lakes!.bodies[lakeNear('伊尔库茨克')]!;
    expect(baikal.hexes.length).toBeGreaterThanOrEqual(7);
    expect(baikal.groups).toBeGreaterThanOrEqual(2);
    expect(lakeNear('乌兰乌德')).toBe(lakeNear('伊尔库茨克'));
  });

  it('draws Baikal as one sheet of water from end to end, with no land bridge', () => {
    const body = lakeNear('伊尔库茨克');
    const { wet, dryInside, reached, step } = flood(body);
    const hexes = surface.lakes!.bodies[body]!.hexes;
    // the water that starts in one hex reaches the middle of every other
    expect([...reached].sort()).toEqual([...hexes].sort());
    expect(dryInside).toBe(0);
    // about as much water as its hexes hold (a hex is 2.6 hex sizes squared)
    const area = wet * step * step;
    expect(area).toBeGreaterThan(hexes.length * 2.6 * 0.7);
    expect(area).toBeLessThan(hexes.length * 2.6 * 1.6);
    // a crescent: much longer than wide
    const centres = hexes.map((index) => hexToWorld(indexToOffset(index, map.width), map.projection.hexLayout));
    const span = Math.max(...centres.flatMap((a) => centres.map((b) => Math.hypot(a.x - b.x, a.z - b.z))));
    expect(span).toBeGreaterThan(8);
  });

  it('gives Baikal the level of its shore, not of its bed', () => {
    const body = lakeNear('伊尔库茨克');
    const metres = surface.lakes!.levels[body]! / unitsPerMetre(map);
    // the hexes hold the bed, hundreds of metres under the sea; the surface is 455 m above it
    expect(Math.min(...surface.lakes!.bodies[body]!.hexes.map((index) => map.elevation[index]!))).toBeLessThan(-500);
    expect(metres).toBeGreaterThan(380);
    expect(metres).toBeLessThan(560);
  });

  it('draws Taihu, Dongting, Poyang, Qinghai Lake and Tonlé Sap as water over their whole hex', () => {
    const named: readonly (readonly [lake: string, city: string])[] = [
      ['Taihu', '上海'],
      ['Dongting', '长沙'],
      ['Poyang', '南昌'],
      ['Qinghai Lake', '西宁'],
      ['Tonlé Sap', '暹粒'],
    ];
    const bodies = named.map(([, city]) => lakeNear(city));
    expect(new Set(bodies).size).toBe(named.length);
    named.forEach(([lake], n) => {
      const body = bodies[n]!;
      const { wet, dryInside, reached, step } = flood(body);
      const hexes = surface.lakes!.bodies[body]!.hexes;
      expect(reached.size, lake).toBe(hexes.length);
      expect(dryInside, lake).toBe(0);
      // most of a hex of open water per hex of lake
      expect(wet * step * step, lake).toBeGreaterThan(hexes.length * 2.6 * 0.6);
      // and the surface is where the hex says, within the relief around it
      const metres = surface.lakes!.levels[body]! / unitsPerMetre(map);
      expect(Math.abs(metres - map.elevation[hexes[0]!]!), lake).toBeLessThan(120);
    });
  });

  it('keeps every lake inside a bank, and its hexes afloat', () => {
    let banked = 0;
    const lakes = surface.lakes!;
    const size = map.projection.hexLayout.size;
    lakes.bodies.forEach((body, b) => {
      const level = lakes.levels[b]!;
      expect(Number.isFinite(level)).toBe(true);
      for (const index of body.hexes) {
        const p = hexToWorld(indexToOffset(index, map.width), map.projection.hexLayout);
        expect(surface.waterLevel[index]).toBe(level);
        expect(waterLevelAt(surface, p.x, p.z)).toBe(level);
        expect(surfaceHeightAt(surface, p.x, p.z)).toBe(level);
        // around the hex: wherever the shore is passed, the ground is above the water
        for (let k = 0; k < 24; k++) {
          const angle = (k / 24) * Math.PI * 2;
          for (const reach of [0.8, 1, 1.2, 1.4]) {
            const x = p.x + Math.cos(angle) * reach * size;
            const z = p.z + Math.sin(angle) * reach * size;
            const sample = lakes.at(x, z);
            if (sample === null || sample.body !== b) continue;
            // (a lake by the sea ends where the sea's hexes begin: no bank is raised in them)
            const hex = worldToHex({ x, z }, map.projection.hexLayout);
            const terrain = map.terrain[hex.row * map.width + hex.col];
            if (terrain === Terrain.Ocean || terrain === Terrain.Coast) continue;
            if (sample.distance > 0.15 * size && sample.distance < (LAKE_BANK - 0.15) * size) {
              const ground = sampleHeight(surface.field, x, z);
              expect(ground).toBeGreaterThan(level);
              banked++;
            }
          }
        }
      }
    });
    expect(banked).toBeGreaterThan(1000);
  });

  it('keeps land away from the sea above sea level: no pools of sea in a delta', () => {
    const layout = map.projection.hexLayout;
    const inland = (index: number): boolean => {
      if (isWaterTerrain(map.terrain[index]!)) return false;
      return hexNeighbors(indexToOffset(index, map.width)).every((n) => {
        if (n.col < 0 || n.col >= map.width || n.row < 0 || n.row >= map.height) return true;
        const terrain = map.terrain[n.row * map.width + n.col]!;
        return terrain !== Terrain.Ocean && terrain !== Terrain.Coast;
      });
    };
    let checked = 0;
    let marsh = 0;
    for (let index = 0; index < map.width * map.height; index++) {
      if (!inland(index)) continue;
      const p = hexToWorld(indexToOffset(index, map.width), layout);
      // all over the hex, the ground is above the sea or under a lake
      for (let k = 0; k < 7; k++) {
        const angle = (k / 6) * Math.PI * 2;
        const reach = k === 6 ? 0 : 0.8 * layout.size;
        const x = p.x + Math.cos(angle) * reach;
        const z = p.z + Math.sin(angle) * reach;
        const lake = surface.lakes!.at(x, z);
        if (lake !== null && lake.distance < 0.15 * layout.size) continue;
        expect(sampleHeight(surface.field, x, z), `hex ${index}`).toBeGreaterThan(0);
      }
      checked++;
      if (map.feature[index] === Feature.Marsh) marsh++;
    }
    expect(checked).toBeGreaterThan(4000);
    // marshes among them: wet ground, not open water
    expect(marsh).toBeGreaterThan(20);
  });
});
