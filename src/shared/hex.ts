/**
 * Hex maths for the map grid.
 *
 * The grid is made of **pointy-top** hexes stored in **odd-r offset**
 * coordinates: `row` counts rows from north to south, `col` counts hexes from
 * west to east inside a row, and odd rows are shifted half a hex to the east.
 *
 * World coordinates are the ground plane of the 3D scene: `x` grows to the
 * east and `z` grows to the south (so `-z` is north); the scene's `y` axis is
 * up and is not handled here.
 */

/** Odd-r offset coordinates: the storage coordinates of the map. */
export interface Offset {
  readonly col: number;
  readonly row: number;
}

/** Axial coordinates: `q` along the east axis, `r` along the south-east axis. */
export interface Axial {
  readonly q: number;
  readonly r: number;
}

/** Cube coordinates, with `q + r + s === 0`. */
export interface Cube {
  readonly q: number;
  readonly r: number;
  readonly s: number;
}

/** A point on the ground plane: `x` east, `z` south. */
export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * Where the grid sits in the world: the centre of hex (col 0, row 0) is at
 * (`originX`, `originZ`) and `size` is the distance from a hex centre to any
 * of its corners. A hex is `sqrt(3) * size` wide and `2 * size` tall; rows are
 * `1.5 * size` apart.
 */
export interface HexLayout {
  readonly size: number;
  readonly originX: number;
  readonly originZ: number;
}

const SQRT3 = Math.sqrt(3);

/**
 * The six neighbour directions as axial steps, in this fixed order:
 * 0 east, 1 north-east, 2 north-west, 3 west, 4 south-west, 5 south-east.
 *
 * The same numbering names a hex's edges: edge `d` is the edge shared with
 * the neighbour in direction `d`. `MapData.riverEdges` uses bit `d` for it.
 */
export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** The direction pointing the other way: the same edge seen from the neighbour. */
export function oppositeDirection(direction: number): number {
  return (direction + 3) % 6;
}

export function offsetToAxial(hex: Offset): Axial {
  return { q: hex.col - (hex.row - (hex.row & 1)) / 2, r: hex.row };
}

export function axialToOffset(hex: Axial): Offset {
  return { col: hex.q + (hex.r - (hex.r & 1)) / 2, row: hex.r };
}

export function axialToCube(hex: Axial): Cube {
  // `0 - x` instead of `-x` so that s is never negative zero
  return { q: hex.q, r: hex.r, s: 0 - hex.q - hex.r };
}

export function cubeToAxial(hex: Cube): Axial {
  return { q: hex.q, r: hex.r };
}

export function offsetToCube(hex: Offset): Cube {
  return axialToCube(offsetToAxial(hex));
}

export function cubeToOffset(hex: Cube): Offset {
  return axialToOffset(hex);
}

/** Index of a hex in the per-hex arrays of a map: `row * width + col`. */
export function hexIndex(col: number, row: number, width: number): number {
  return row * width + col;
}

/** Inverse of {@link hexIndex}. */
export function indexToOffset(index: number, width: number): Offset {
  return { col: index % width, row: Math.floor(index / width) };
}

/** The neighbour of `hex` in direction `direction` (0–5, see {@link HEX_DIRECTIONS}). */
export function hexNeighbor(hex: Offset, direction: number): Offset {
  const step = HEX_DIRECTIONS[direction];
  if (step === undefined) throw new RangeError(`hex direction out of range: ${direction}`);
  const a = offsetToAxial(hex);
  return axialToOffset({ q: a.q + step.q, r: a.r + step.r });
}

/** All six neighbours, in direction order. Does not check map bounds. */
export function hexNeighbors(hex: Offset): Offset[] {
  return HEX_DIRECTIONS.map((_, direction) => hexNeighbor(hex, direction));
}

/** Number of hex steps between two hexes. */
export function hexDistance(a: Offset, b: Offset): number {
  const ca = offsetToCube(a);
  const cb = offsetToCube(b);
  return Math.max(Math.abs(ca.q - cb.q), Math.abs(ca.r - cb.r), Math.abs(ca.s - cb.s));
}

function cubeRound(q: number, r: number, s: number): Axial {
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // `+ 0` turns a negative zero into zero
  return { q: rq + 0, r: rr + 0 };
}

/**
 * The hexes on the straight line from `a` to `b`, both included. Consecutive
 * hexes are adjacent, and the result has `hexDistance(a, b) + 1` entries.
 */
export function hexLine(a: Offset, b: Offset): Offset[] {
  const ca = offsetToCube(a);
  const cb = offsetToCube(b);
  const steps = hexDistance(a, b);
  const result: Offset[] = [];
  // A tiny nudge keeps points that fall exactly on an edge on one side of it.
  const eq = 1e-6;
  const er = 2e-6;
  const es = -3e-6;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    result.push(
      axialToOffset(
        cubeRound(
          ca.q + eq + (cb.q - ca.q) * t,
          ca.r + er + (cb.r - ca.r) * t,
          ca.s + es + (cb.s - ca.s) * t,
        ),
      ),
    );
  }
  return result;
}

/**
 * The hexes at exactly `radius` steps from `center`: `6 * radius` hexes, or
 * just the centre for radius 0. Does not check map bounds.
 */
export function hexRing(center: Offset, radius: number): Offset[] {
  if (radius <= 0) return [center];
  const result: Offset[] = [];
  const c = offsetToAxial(center);
  const start = HEX_DIRECTIONS[4] as Axial;
  let q = c.q + start.q * radius;
  let r = c.r + start.r * radius;
  for (const step of HEX_DIRECTIONS) {
    for (let i = 0; i < radius; i++) {
      result.push(axialToOffset({ q, r }));
      q += step.q;
      r += step.r;
    }
  }
  return result;
}

/**
 * The hexes within `radius` steps of `center`, the centre included:
 * `1 + 3 * radius * (radius + 1)` hexes. Does not check map bounds.
 */
export function hexRange(center: Offset, radius: number): Offset[] {
  const result: Offset[] = [];
  const c = offsetToAxial(center);
  for (let dq = -radius; dq <= radius; dq++) {
    const from = Math.max(-radius, -dq - radius);
    const to = Math.min(radius, -dq + radius);
    for (let dr = from; dr <= to; dr++) {
      result.push(axialToOffset({ q: c.q + dq, r: c.r + dr }));
    }
  }
  return result;
}

/**
 * World position of the centre of a hex. This is the one hex-to-world mapping
 * of the project; `MapData.projection.hexLayout` supplies the layout.
 *
 *     x = originX + sqrt(3) * size * (col + 0.5 * (row & 1))
 *     z = originZ + 1.5 * size * row
 */
export function hexToWorld(hex: Offset, layout: HexLayout): WorldPoint {
  return {
    x: layout.originX + SQRT3 * layout.size * (hex.col + 0.5 * (hex.row & 1)),
    z: layout.originZ + 1.5 * layout.size * hex.row,
  };
}

/** The hex that contains a world point. Inverse of {@link hexToWorld}. */
export function worldToHex(point: WorldPoint, layout: HexLayout): Offset {
  const x = (point.x - layout.originX) / layout.size;
  const z = (point.z - layout.originZ) / layout.size;
  const q = (SQRT3 / 3) * x - z / 3;
  const r = (2 / 3) * z;
  return axialToOffset(cubeRound(q, r, -q - r));
}

/**
 * The six corners of a hex in world coordinates. Corner 0 is the corner
 * between the east and north-east edges; the corners then go around through
 * north, west and south. Edge `d` (see {@link HEX_DIRECTIONS}) runs between
 * corner `(d + 5) % 6` and corner `d`.
 */
export function hexCorners(hex: Offset, layout: HexLayout): WorldPoint[] {
  const centre = hexToWorld(hex, layout);
  const corners: WorldPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i + 30);
    corners.push({
      x: centre.x + layout.size * Math.cos(angle),
      z: centre.z - layout.size * Math.sin(angle),
    });
  }
  return corners;
}
