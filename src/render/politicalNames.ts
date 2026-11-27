/**
 * Where the name of each polity goes on the political map: inside the
 * largest connected piece of its territory, along the direction the piece
 * is stretched in, and as large as fits. Pure hex and plane geometry.
 */

import { hexNeighbor, hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
import type { HexLayout } from '../shared/hex.ts';

/** A straight strip of ground inside a territory that a name can be written on. */
export interface NamePlacement {
  readonly polity: number;
  /** Middle of the strip. */
  readonly x: number;
  readonly z: number;
  /**
   * Direction of the writing in the ground plane, in radians: 0 runs east,
   * positive turns towards the south. Between -MAX_NAME_ANGLE and MAX_NAME_ANGLE.
   */
  readonly angle: number;
  /** Length of the strip along the writing, inside the territory. */
  readonly length: number;
  /** Room across the writing, inside the territory. */
  readonly height: number;
  /** Hexes of the piece the name stands in. */
  readonly hexes: number;
}

/** Names are never tilted more than this, so they stay easy to read. */
export const MAX_NAME_ANGLE = (50 * Math.PI) / 180;
/** A piece must be at least this much longer than wide for its name to be tilted. */
const MIN_ELONGATION = 1.5;

/**
 * One placement per polity that owns at least one hex, in polity order.
 *
 * @param owner per hex, as `MapData.owner`: a polity index, or negative.
 */
export function placePoliticalNames(
  width: number,
  height: number,
  owner: Int16Array,
  layout: HexLayout,
): NamePlacement[] {
  const count = width * height;
  const inside = (col: number, row: number): boolean => col >= 0 && col < width && row >= 0 && row < height;

  // connected pieces, the largest per polity
  const piece = new Int32Array(count).fill(-1);
  const largest = new Map<number, { id: number; hexes: number[] }>();
  let pieces = 0;
  for (let start = 0; start < count; start++) {
    const polity = owner[start] as number;
    if (polity < 0 || piece[start] !== -1) continue;
    const id = pieces++;
    const hexes = [start];
    piece[start] = id;
    for (let k = 0; k < hexes.length; k++) {
      const hex = indexToOffset(hexes[k] as number, width);
      for (let d = 0; d < 6; d++) {
        const n = hexNeighbor(hex, d);
        if (!inside(n.col, n.row)) continue;
        const index = n.row * width + n.col;
        if (piece[index] !== -1 || owner[index] !== polity) continue;
        piece[index] = id;
        hexes.push(index);
      }
    }
    const best = largest.get(polity);
    if (best === undefined || hexes.length > best.hexes.length) largest.set(polity, { id, hexes });
  }

  const memberAt = (id: number, x: number, z: number): boolean => {
    const hex = worldToHex({ x, z }, layout);
    return inside(hex.col, hex.row) && piece[hex.row * width + hex.col] === id;
  };
  /** How far one can go from a point in a direction without leaving the piece. */
  const reach = (id: number, x: number, z: number, dx: number, dz: number, limit: number): number => {
    const step = layout.size * 0.25;
    let distance = 0;
    while (distance < limit && memberAt(id, x + dx * (distance + step), z + dz * (distance + step))) distance += step;
    return distance;
  };

  const depth = new Int32Array(count);
  const placements: NamePlacement[] = [];
  for (const [polity, { id, hexes }] of [...largest].sort((a, b) => a[0] - b[0])) {
    // depth: hexes from the edge of the piece, 1 on the edge itself
    let frontier: number[] = [];
    for (const index of hexes) {
      const hex = indexToOffset(index, width);
      let edge = false;
      for (let d = 0; d < 6 && !edge; d++) {
        const n = hexNeighbor(hex, d);
        edge = !inside(n.col, n.row) || piece[n.row * width + n.col] !== id;
      }
      depth[index] = edge ? 1 : 0;
      if (edge) frontier.push(index);
    }
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const index of frontier) {
        const hex = indexToOffset(index, width);
        for (let d = 0; d < 6; d++) {
          const n = hexNeighbor(hex, d);
          if (!inside(n.col, n.row)) continue;
          const other = n.row * width + n.col;
          if (piece[other] !== id || depth[other] !== 0) continue;
          depth[other] = (depth[index] as number) + 1;
          next.push(other);
        }
      }
      frontier = next;
    }

    // centroid and the direction of the largest spread
    let cx = 0;
    let cz = 0;
    const points = hexes.map((index) => hexToWorld(indexToOffset(index, width), layout));
    for (const p of points) {
      cx += p.x;
      cz += p.z;
    }
    cx /= points.length;
    cz /= points.length;
    let xx = 0;
    let zz = 0;
    let xz = 0;
    for (const p of points) {
      xx += (p.x - cx) ** 2;
      zz += (p.z - cz) ** 2;
      xz += (p.x - cx) * (p.z - cz);
    }
    const spread = Math.hypot(xx - zz, 2 * xz);
    const major = (xx + zz + spread) / 2;
    const minor = Math.max((xx + zz - spread) / 2, 1e-9);
    let angle = 0;
    if (Math.sqrt(major / minor) >= MIN_ELONGATION) {
      angle = 0.5 * Math.atan2(2 * xz, xx - zz);
      angle = Math.min(Math.max(angle, -MAX_NAME_ANGLE), MAX_NAME_ANGLE);
    }
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);

    // the anchor: the deepest hex, the nearest to the centroid among equals
    let anchor = hexes[0] as number;
    let anchorDepth = -1;
    let anchorDistance = Infinity;
    hexes.forEach((index, k) => {
      const p = points[k] as { x: number; z: number };
      const d = depth[index] as number;
      const distance = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (d > anchorDepth || (d === anchorDepth && distance < anchorDistance)) {
        anchor = index;
        anchorDepth = d;
        anchorDistance = distance;
      }
    });
    const at = hexToWorld(indexToOffset(anchor, width), layout);
    const limit = (width + height) * layout.size * 2;

    // the strip through the anchor, re-centred on its middle
    const forward = reach(id, at.x, at.z, dx, dz, limit);
    const backward = reach(id, at.x, at.z, -dx, -dz, limit);
    const length = Math.max(forward + backward, layout.size);
    const x = at.x + (dx * (forward - backward)) / 2;
    const z = at.z + (dz * (forward - backward)) / 2;

    // room across the writing, at the middle and towards both ends
    let room = Infinity;
    for (const along of [-0.3, 0, 0.3]) {
      const px = x + dx * along * length;
      const pz = z + dz * along * length;
      if (!memberAt(id, px, pz)) {
        room = 0;
        continue;
      }
      room = Math.min(room, reach(id, px, pz, -dz, dx, limit), reach(id, px, pz, dz, -dx, limit));
    }
    placements.push({
      polity,
      x,
      z,
      angle,
      length,
      height: Math.max(room * 2, layout.size),
      hexes: hexes.length,
    });
  }
  return placements;
}

/**
 * The size of a name written on a placement.
 *
 * @param aspect width of the written name divided by its height.
 * @returns the width and height on the ground.
 */
export function fitName(placement: NamePlacement, aspect: number): { width: number; height: number } {
  const height = Math.min(placement.height * 0.7, (placement.length * 0.82) / aspect);
  return { width: height * aspect, height };
}
