/**
 * Corners and edges of the hex grid as integers, for river tracing.
 *
 * In units of (√3/2 · size, 1/2 · size) the centre of hex (col, row) is at
 * (2·col + (row & 1), 3·row) and its corners sit at fixed integer offsets, so
 * a corner shared by three hexes has one integer position.
 */

import type { Offset } from '../../src/shared/hex.ts';

/** Offsets of corner 0–5 from the hex centre, in the order of `hexCorners`. */
const CORNER_OFFSETS: readonly (readonly [number, number])[] = [
  [1, -1],
  [0, -2],
  [-1, -1],
  [-1, 1],
  [0, 2],
  [1, 1],
];

/** Corners per row of keys; larger than any grid the pipeline builds. */
const KEY_STRIDE = 4096;

/** A corner as one number. */
export function cornerKey(hex: Offset, corner: number): number {
  const offset = CORNER_OFFSETS[corner] as readonly [number, number];
  const x = 2 * hex.col + (hex.row & 1) + offset[0] + 2;
  const z = 3 * hex.row + offset[1] + 2;
  return z * KEY_STRIDE + x;
}

/** The two corners of edge `direction` of a hex: corner `(d + 5) % 6` and corner `d`. */
export function edgeCorners(hex: Offset, direction: number): [number, number] {
  return [cornerKey(hex, (direction + 5) % 6), cornerKey(hex, direction)];
}

/** An undirected pair of corners as one number. */
export function edgeKey(a: number, b: number): number {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return low * KEY_STRIDE * KEY_STRIDE * 4 + high;
}

/**
 * The three corners joined to a corner by a hex edge. A corner is either the
 * top of the hex below it or the bottom of the hex above it.
 */
export function cornerNeighbours(corner: number): [number, number, number] {
  const z = Math.floor(corner / KEY_STRIDE) - 2;
  const isTop = (((z % 3) + 3) % 3) === 1;
  return isTop
    ? [corner + KEY_STRIDE - 1, corner + KEY_STRIDE + 1, corner - 2 * KEY_STRIDE]
    : [corner - KEY_STRIDE - 1, corner - KEY_STRIDE + 1, corner + 2 * KEY_STRIDE];
}
