/**
 * The lakes of a map as shapes on the ground, without Three.js. The hexes
 * say which ground is lake; this module turns each group of lake hexes into
 * one body of water with a natural shore: rounded, wider than the necks
 * between hex centres, and broken up by noise. Two groups that only a
 * corner of land keeps apart are one lake (Baikal is such a pair), joined
 * by a channel that runs between the two land hexes in the way and misses
 * the middle of both.
 *
 * `heightField.ts` gives every lake its level from the ground around it,
 * digs the bed inside the shore and raises the bank outside it.
 */

import { hexIndex, hexNeighbor, hexRange, hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
import type { Offset } from '../shared/hex.ts';
import { Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';

/** One lake: its hexes, and the groups of neighbouring lake hexes it was put together from. */
export interface LakeBody {
  readonly hexes: readonly number[];
  /** How many groups of lake hexes that touch each other it is made of: more than 1 where channels join them. */
  readonly groups: number;
}

/** A point's place relative to the nearest lake. */
export interface LakeSample {
  /** Index into `LakeField.bodies`. */
  readonly body: number;
  /** Distance to that lake's shore in world units: negative inside the lake. */
  readonly distance: number;
}

export interface LakeField {
  readonly bodies: readonly LakeBody[];
  /** World height of each lake's surface; filled in by whoever builds the ground. */
  readonly levels: Float32Array;
  /**
   * The nearest lake to a point, or `null` if none is within about a hex of it.
   *
   * @param hex the index of the hex the point lies in, if the caller knows it.
   */
  at(x: number, z: number, hex?: number): LakeSample | null;
  /** The water level at a point inside a lake's shore, `NaN` elsewhere. */
  levelAt(x: number, z: number): number;
}

/** A disc (`a` equals `b`) or a capsule of water around a line. */
interface Shape {
  readonly body: number;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly radius: number;
}

/** Radii of the shapes a lake is made of, as fractions of the hex size. */
const HEX_DISC = 0.9;
const NECK = 0.74;
const CHANNEL = 0.42;
/** How far the noise moves the shore in and out, as fractions of the hex size. */
const SHORE_WANDER = 0.34;
const SHORE_RIPPLE = 0.1;

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

/**
 * The lakes of a map. Lake hexes that are neighbours belong to one lake;
 * so do two lake hexes with exactly one pair of land hexes between them
 * (two steps apart in neighbouring directions), which a channel joins.
 */
export function createLakeField(map: MapData): LakeField {
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const count = map.width * map.height;
  const inGrid = (hex: Offset): boolean => hex.col >= 0 && hex.col < map.width && hex.row >= 0 && hex.row < map.height;
  const isLake = (hex: Offset): boolean => inGrid(hex) && map.terrain[hexIndex(hex.col, hex.row, map.width)] === Terrain.Lake;

  // groups of neighbouring lake hexes
  const group = new Int32Array(count).fill(-1);
  let groups = 0;
  for (let i = 0; i < count; i++) {
    if (map.terrain[i] !== Terrain.Lake || group[i] !== -1) continue;
    const queue = [i];
    group[i] = groups;
    for (let n = 0; n < queue.length; n++) {
      const hex = indexToOffset(queue[n] as number, map.width);
      for (let d = 0; d < 6; d++) {
        const next = hexNeighbor(hex, d);
        if (!isLake(next)) continue;
        const ni = hexIndex(next.col, next.row, map.width);
        if (group[ni] === -1) {
          group[ni] = groups;
          queue.push(ni);
        }
      }
    }
    groups++;
  }

  // groups joined by a channel become one lake
  const parent = Array.from({ length: groups }, (_, g) => g);
  const find = (g: number): number => {
    let root = g;
    while (parent[root] !== root) root = parent[root] as number;
    parent[g] = root;
    return root;
  };
  const channels: [from: number, to: number][] = [];
  for (let i = 0; i < count; i++) {
    if (group[i] === -1) continue;
    const hex = indexToOffset(i, map.width);
    for (let d = 0; d < 6; d++) {
      const first = hexNeighbor(hex, d);
      const second = hexNeighbor(hex, (d + 1) % 6);
      // two steps on, in the direction between the two: across the edge those two share
      const far = hexNeighbor(first, (d + 1) % 6);
      if (!isLake(far) || !inGrid(first) || !inGrid(second)) continue;
      const fi = hexIndex(far.col, far.row, map.width);
      if (fi <= i) continue;
      const between = [first, second].map((h) => map.terrain[hexIndex(h.col, h.row, map.width)] as number);
      if (between.some((terrain) => isWaterTerrain(terrain))) continue;
      channels.push([i, fi]);
      parent[find(group[i] as number)] = find(group[fi] as number);
    }
  }
  const bodyOf = new Map<number, number>();
  const bodies: { hexes: number[]; groups: Set<number> }[] = [];
  for (let i = 0; i < count; i++) {
    if (group[i] === -1) continue;
    const root = find(group[i] as number);
    let body = bodyOf.get(root);
    if (body === undefined) {
      body = bodies.length;
      bodyOf.set(root, body);
      bodies.push({ hexes: [], groups: new Set() });
    }
    (bodies[body] as { hexes: number[]; groups: Set<number> }).hexes.push(i);
    (bodies[body] as { hexes: number[]; groups: Set<number> }).groups.add(group[i] as number);
  }

  // the shapes, each filed under every hex it can reach
  const shapesAt = new Map<number, Shape[]>();
  const file = (shape: Shape, ends: readonly number[]): void => {
    const seen = new Set<number>();
    for (const end of ends) {
      for (const hex of hexRange(indexToOffset(end, map.width), 2)) {
        if (!inGrid(hex)) continue;
        const key = hexIndex(hex.col, hex.row, map.width);
        if (seen.has(key)) continue;
        seen.add(key);
        const list = shapesAt.get(key);
        if (list === undefined) shapesAt.set(key, [shape]);
        else list.push(shape);
      }
    }
  };
  const centre = (index: number): { x: number; z: number } => hexToWorld(indexToOffset(index, map.width), layout);
  bodies.forEach((body, b) => {
    for (const i of body.hexes) {
      const p = centre(i);
      file({ body: b, ax: p.x, az: p.z, bx: p.x, bz: p.z, radius: HEX_DISC * size }, [i]);
      const hex = indexToOffset(i, map.width);
      for (let d = 0; d < 6; d++) {
        const next = hexNeighbor(hex, d);
        if (!isLake(next)) continue;
        const ni = hexIndex(next.col, next.row, map.width);
        if (ni <= i) continue;
        const q = centre(ni);
        file({ body: b, ax: p.x, az: p.z, bx: q.x, bz: q.z, radius: NECK * size }, [i, ni]);
      }
    }
  });
  for (const [from, to] of channels) {
    const p = centre(from);
    const q = centre(to);
    const body = bodyOf.get(find(group[from] as number)) as number;
    file({ body, ax: p.x, az: p.z, bx: q.x, bz: q.z, radius: CHANNEL * size }, [from, to]);
  }

  const levels = new Float32Array(bodies.length).fill(Number.NaN);
  const at = (x: number, z: number, known?: number): LakeSample | null => {
    let index = known;
    if (index === undefined) {
      const hex = worldToHex({ x, z }, layout);
      if (!inGrid(hex)) return null;
      index = hexIndex(hex.col, hex.row, map.width);
    }
    const shapes = shapesAt.get(index);
    if (shapes === undefined) return null;
    let nearest = Infinity;
    let body = -1;
    for (const shape of shapes) {
      const dx = shape.bx - shape.ax;
      const dz = shape.bz - shape.az;
      const length2 = dx * dx + dz * dz;
      const t = length2 === 0 ? 0 : Math.min(Math.max(((x - shape.ax) * dx + (z - shape.az) * dz) / length2, 0), 1);
      const distance = Math.hypot(x - shape.ax - dx * t, z - shape.az - dz * t) - shape.radius;
      if (distance < nearest) {
        nearest = distance;
        body = shape.body;
      }
    }
    // the shore wanders: bays and headlands a good part of a hex across, with ripples on them
    const u = x / size;
    const v = z / size;
    const wander = (valueNoise(u * 0.9 + 17.3, v * 0.9 - 4.1) - 0.5) * 2 * SHORE_WANDER + (valueNoise(u * 3.1 - 9.2, v * 3.1 + 2.7) - 0.5) * 2 * SHORE_RIPPLE;
    return { body, distance: nearest + wander * size };
  };

  return {
    bodies: bodies.map((body) => ({ hexes: body.hexes, groups: body.groups.size })),
    levels,
    at,
    levelAt(x, z) {
      const sample = at(x, z);
      return sample !== null && sample.distance < 0 ? (levels[sample.body] as number) : Number.NaN;
    },
  };
}
