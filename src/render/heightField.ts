/**
 * The ground and water surface of a map as plain numbers: no Three.js here,
 * so the terrain mesh, piece placement, picking and the tests all share one
 * source of heights.
 *
 * Heights are world units on the scene's `y` axis. Metres are scaled by
 * {@link unitsPerMetre}, which applies the vertical exaggeration.
 */

import { hexIndex, hexNeighbor, hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
import type { Offset } from '../shared/hex.ts';
import { Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData, WorldRect } from '../shared/mapData.ts';

/** How much taller relief is drawn than it really is. */
export const VERTICAL_EXAGGERATION = 10;

/** Sea level in world units. */
export const SEA_LEVEL = 0;

const SQRT3 = Math.sqrt(3);

/** World units of height per metre of elevation, exaggeration included. */
export function unitsPerMetre(map: MapData): number {
  return VERTICAL_EXAGGERATION / (map.projection.kmPerWorldUnit * 1000);
}

/** The rectangle that contains every hex of the map. */
export function mapWorldRect(map: MapData): WorldRect {
  const { size, originX, originZ } = map.projection.hexLayout;
  const hexWidth = SQRT3 * size;
  return {
    minX: originX - hexWidth / 2,
    minZ: originZ - size,
    // odd rows are shifted half a hex to the east
    maxX: originX + hexWidth * (map.width - 0.5) + (map.height > 1 ? hexWidth / 2 : 0),
    maxZ: originZ + 1.5 * size * (map.height - 1) + size,
  };
}

/** A regular grid of ground heights over a world rectangle. */
export interface HeightField {
  /** Samples per row (west to east). */
  readonly cols: number;
  /** Number of rows (north to south). */
  readonly rows: number;
  /** The rectangle covered, from the first to the last sample. */
  readonly rect: WorldRect;
  /** Ground height in world units, row by row. */
  readonly heights: Float32Array;
  /** Lowest and highest value in `heights`. */
  readonly minY: number;
  readonly maxY: number;
}

/** A map's ground plus its water. */
export interface Surface {
  readonly map: MapData;
  readonly field: HeightField;
  /** Per hex: world height of the water surface, or `NaN` on land. */
  readonly waterLevel: Float32Array;
}

function inGrid(map: MapData, hex: Offset): boolean {
  return hex.col >= 0 && hex.col < map.width && hex.row >= 0 && hex.row < map.height;
}

/**
 * Per hex: the world height of the water surface, or `NaN` on land. The sea
 * is at {@link SEA_LEVEL}. Every connected group of lake hexes shares one
 * level, the lowest elevation among them.
 *
 * @param keepBelowShore also keep a lake below the lowest land hex next to
 *   it. Needed when the ground is built from hex elevations, which do not
 *   promise that a lake lies lower than its shore.
 */
export function computeWaterLevels(map: MapData, keepBelowShore: boolean): Float32Array {
  const count = map.width * map.height;
  const scale = unitsPerMetre(map);
  const levels = new Float32Array(count).fill(Number.NaN);
  const seen = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const terrain = map.terrain[i] as number;
    if (terrain === Terrain.Ocean || terrain === Terrain.Coast) levels[i] = SEA_LEVEL;
    if (terrain !== Terrain.Lake || seen[i] === 1) continue;
    // flood-fill one lake
    const lake = [i];
    seen[i] = 1;
    let metres = Infinity;
    for (let n = 0; n < lake.length; n++) {
      const index = lake[n] as number;
      metres = Math.min(metres, map.elevation[index] as number);
      const hex = indexToOffset(index, map.width);
      for (let d = 0; d < 6; d++) {
        const neighbor = hexNeighbor(hex, d);
        if (!inGrid(map, neighbor)) continue;
        const ni = hexIndex(neighbor.col, neighbor.row, map.width);
        const nt = map.terrain[ni] as number;
        if (nt === Terrain.Lake) {
          if (seen[ni] === 0) {
            seen[ni] = 1;
            lake.push(ni);
          }
        } else if (keepBelowShore && !isWaterTerrain(nt)) {
          metres = Math.min(metres, (map.elevation[ni] as number) - SHORE_MARGIN_METRES);
        }
      }
    }
    for (const index of lake) levels[index] = metres * scale;
  }
  return levels;
}

/** A lake stays this far below the lowest land hex next to it. */
const SHORE_MARGIN_METRES = 5;
/** Depth given to a lake bed, whose real depth the map does not record. */
const LAKE_DEPTH_METRES = 100;
/** Depth given to water whose heightmap value is not below the water surface. */
const MIN_WATER_DEPTH_METRES = 30;
/** Roughness added to mountains and hills when relief is built from hexes. */
const MOUNTAIN_RELIEF_METRES = 1100;
const HILL_RELIEF_METRES = 260;

function hash2(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Ridged fractal noise in 0..1, peaking along thin ridges. */
function ridgedNoise(x: number, y: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave++) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency) * 2 - 1);
    sum += n * n * amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum / 0.9375;
}

function fieldFromHeights(
  cols: number,
  rows: number,
  rect: WorldRect,
  heights: Float32Array,
): HeightField {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const h of heights) {
    if (h < minY) minY = h;
    if (h > maxY) maxY = h;
  }
  return { cols, rows, rect, heights, minY, maxY };
}

/**
 * Builds the ground from hex elevations, for maps that have no heightmap
 * file: every sample blends the elevations of the hexes around it, so the
 * surface is continuous, and mountains and hills get procedural ridges.
 *
 * @param waterLevel from {@link computeWaterLevels}.
 * @param samplesPerHex samples across the width of one hex.
 */
export function heightFieldFromHexes(
  map: MapData,
  waterLevel: Float32Array,
  samplesPerHex = 6,
): HeightField {
  const layout = map.projection.hexLayout;
  const rect = mapWorldRect(map);
  const scale = unitsPerMetre(map);
  const hexWidth = SQRT3 * layout.size;
  // keep very large maps within a few million samples
  const budget = 3_000_000;
  const hexArea = map.width * map.height * 0.87;
  const perHex = Math.max(2, Math.min(samplesPerHex, Math.floor(Math.sqrt(budget / hexArea))));
  const cell = hexWidth / perHex;
  const cols = Math.ceil((rect.maxX - rect.minX) / cell) + 1;
  const rows = Math.ceil((rect.maxZ - rect.minZ) / cell) + 1;
  const heights = new Float32Array(cols * rows);

  // what each hex contributes: its ground height and how rough it is
  const count = map.width * map.height;
  const ground = new Float32Array(count);
  const relief = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const terrain = map.terrain[i] as number;
    const metres = map.elevation[i] as number;
    if (terrain === Terrain.Lake) {
      ground[i] = (waterLevel[i] as number) - LAKE_DEPTH_METRES * scale;
    } else if (isWaterTerrain(terrain)) {
      ground[i] = Math.min(metres, -MIN_WATER_DEPTH_METRES) * scale;
    } else {
      ground[i] = metres * scale;
      if (terrain === Terrain.Mountain) relief[i] = MOUNTAIN_RELIEF_METRES * scale;
      else if (map.hills[i] === 1) relief[i] = HILL_RELIEF_METRES * scale;
    }
  }

  const reach = 1.8 * layout.size;
  const noiseScale = 1.7 / hexWidth;
  for (let j = 0; j < rows; j++) {
    const z = rect.minZ + ((rect.maxZ - rect.minZ) * j) / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const x = rect.minX + ((rect.maxX - rect.minX) * i) / (cols - 1);
      const centre = worldToHex({ x, z }, layout);
      let weightSum = 0;
      let heightSum = 0;
      let reliefSum = 0;
      for (let d = -1; d < 6; d++) {
        const hex = d < 0 ? centre : hexNeighbor(centre, d);
        if (!inGrid(map, hex)) continue;
        const p = hexToWorld(hex, layout);
        const distance = Math.hypot(p.x - x, p.z - z);
        if (distance >= reach) continue;
        const falloff = 1 - distance / reach;
        const weight = falloff * falloff;
        const index = hexIndex(hex.col, hex.row, map.width);
        weightSum += weight;
        heightSum += weight * (ground[index] as number);
        reliefSum += weight * (relief[index] as number);
      }
      let height = weightSum > 0 ? heightSum / weightSum : 0;
      if (reliefSum > 0) {
        const amount = reliefSum / weightSum;
        height += amount * (ridgedNoise(x * noiseScale, z * noiseScale) - 0.35);
      }
      heights[j * cols + i] = height;
    }
  }
  return fieldFromHeights(cols, rows, rect, heights);
}

/**
 * Builds the ground from the samples of the map's heightmap file (see
 * `MapHeightmap` for the layout). Water hexes whose samples are not below
 * the water surface, as in a heightmap without sea floor, are lowered so
 * that the water has something to cover.
 *
 * @throws if `samples` does not have `heightmap.width * heightmap.height` entries.
 */
export function heightFieldFromHeightmap(
  map: MapData,
  samples: Uint16Array,
  waterLevel: Float32Array,
): HeightField {
  const { width: cols, height: rows, metresPerUnit, baseMetres, world } = map.heightmap;
  if (samples.length !== cols * rows) {
    throw new Error(`heightmap: ${samples.length} samples, expected ${cols * rows}`);
  }
  const layout = map.projection.hexLayout;
  const scale = unitsPerMetre(map);
  const shallow = MIN_WATER_DEPTH_METRES * scale;
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const z = world.minZ + ((world.maxZ - world.minZ) * j) / Math.max(1, rows - 1);
    for (let i = 0; i < cols; i++) {
      const x = world.minX + ((world.maxX - world.minX) * i) / Math.max(1, cols - 1);
      let height = (baseMetres + (samples[j * cols + i] as number) * metresPerUnit) * scale;
      const hex = worldToHex({ x, z }, layout);
      if (inGrid(map, hex)) {
        const level = waterLevel[hexIndex(hex.col, hex.row, map.width)] as number;
        // a water hex may still hold real land; only flat water is lowered
        if (!Number.isNaN(level) && height >= level - shallow && height <= level + scale) {
          height = level - shallow;
        }
      }
      heights[j * cols + i] = height;
    }
  }
  return fieldFromHeights(cols, rows, world, heights);
}

/** Ground height at a world point, bilinear between samples and clamped at the edges. */
export function sampleHeight(field: HeightField, x: number, z: number): number {
  const { cols, rows, rect, heights } = field;
  const u = ((x - rect.minX) / (rect.maxX - rect.minX)) * (cols - 1);
  const v = ((z - rect.minZ) / (rect.maxZ - rect.minZ)) * (rows - 1);
  const cu = Math.min(Math.max(u, 0), cols - 1);
  const cv = Math.min(Math.max(v, 0), rows - 1);
  const i0 = Math.min(Math.floor(cu), Math.max(cols - 2, 0));
  const j0 = Math.min(Math.floor(cv), Math.max(rows - 2, 0));
  const i1 = Math.min(i0 + 1, cols - 1);
  const j1 = Math.min(j0 + 1, rows - 1);
  const fx = cu - i0;
  const fz = cv - j0;
  const a = heights[j0 * cols + i0] as number;
  const b = heights[j0 * cols + i1] as number;
  const c = heights[j1 * cols + i0] as number;
  const d = heights[j1 * cols + i1] as number;
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

/**
 * The surface of `map`: ground plus water.
 *
 * @param heightmapSamples content of the map's heightmap file. Without it
 *   the ground is built from the hex elevations.
 */
export function createSurface(map: MapData, heightmapSamples?: Uint16Array): Surface {
  if (heightmapSamples !== undefined) {
    const waterLevel = computeWaterLevels(map, false);
    return { map, waterLevel, field: heightFieldFromHeightmap(map, heightmapSamples, waterLevel) };
  }
  const waterLevel = computeWaterLevels(map, true);
  return { map, waterLevel, field: heightFieldFromHexes(map, waterLevel) };
}

/** Water level of the hex that contains a world point, or `NaN` on land and outside the map. */
export function waterLevelAt(surface: Surface, x: number, z: number): number {
  const { map } = surface;
  const hex = worldToHex({ x, z }, map.projection.hexLayout);
  if (!inGrid(map, hex)) return Number.NaN;
  return surface.waterLevel[hexIndex(hex.col, hex.row, map.width)] as number;
}

/** Height of whatever is on top at a world point: the ground, or the water over it. */
export function surfaceHeightAt(surface: Surface, x: number, z: number): number {
  const ground = sampleHeight(surface.field, x, z);
  const water = waterLevelAt(surface, x, z);
  return Number.isNaN(water) ? ground : Math.max(ground, water);
}

/** Height on which a piece or a city stands at the centre of hex `index`. */
export function surfaceHeightAtHex(surface: Surface, index: number): number {
  const { map } = surface;
  const p = hexToWorld(indexToOffset(index, map.width), map.projection.hexLayout);
  const ground = sampleHeight(surface.field, p.x, p.z);
  const water = surface.waterLevel[index] as number;
  return Number.isNaN(water) ? ground : Math.max(ground, water);
}
