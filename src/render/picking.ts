/** Finds what a ray hits on the relief. No Three.js. */

import { hexIndex, worldToHex } from '../shared/hex.ts';
import type { Ray } from './cameraRig.ts';
import { surfaceHeightAt } from './heightField.ts';
import type { Surface } from './heightField.ts';

export interface SurfaceHit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The first point where `ray` meets the surface (ground or water) inside
 * the height field's rectangle, or `null`. The ray is walked in steps of
 * half a height sample, then the crossing is refined by bisection.
 */
export function pickSurface(surface: Surface, ray: Ray): SurfaceHit | null {
  const { field } = surface;
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;

  // the part of the ray inside the box around the surface
  const top = Math.max(field.maxY, 0) + 1e-3;
  const bottom = field.minY - 1e-3;
  let tMin = 0;
  let tMax = Infinity;
  const slabs: readonly (readonly [number, number, number, number])[] = [
    [ox, dx, field.rect.minX, field.rect.maxX],
    [oy, dy, bottom, top],
    [oz, dz, field.rect.minZ, field.rect.maxZ],
  ];
  for (const [origin, direction, min, max] of slabs) {
    if (Math.abs(direction) < 1e-12) {
      if (origin < min || origin > max) return null;
      continue;
    }
    const a = (min - origin) / direction;
    const b = (max - origin) / direction;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
  }
  if (tMin > tMax) return null;

  const above = (t: number): number =>
    oy + dy * t - surfaceHeightAt(surface, ox + dx * t, oz + dz * t);

  const cellX = (field.rect.maxX - field.rect.minX) / Math.max(1, field.cols - 1);
  const cellZ = (field.rect.maxZ - field.rect.minZ) / Math.max(1, field.rows - 1);
  const step = Math.min(cellX, cellZ) * 0.5;
  let previous = tMin;
  if (above(previous) <= 0) return hitAt(previous);
  for (let t = tMin + step; ; t += step) {
    const current = Math.min(t, tMax);
    if (above(current) <= 0) {
      let low = previous;
      let high = current;
      for (let i = 0; i < 24; i++) {
        const middle = (low + high) / 2;
        if (above(middle) > 0) low = middle;
        else high = middle;
      }
      return hitAt(high);
    }
    if (current >= tMax) return null;
    previous = current;
  }

  function hitAt(t: number): SurfaceHit {
    const x = ox + dx * t;
    const z = oz + dz * t;
    return { x, y: surfaceHeightAt(surface, x, z), z };
  }
}

/** Index of the hex that `ray` hits, or `null` if it misses the map. */
export function pickHexOnRay(surface: Surface, ray: Ray): number | null {
  const hit = pickSurface(surface, ray);
  if (hit === null) return null;
  const { map } = surface;
  const hex = worldToHex(hit, map.projection.hexLayout);
  if (hex.col < 0 || hex.col >= map.width || hex.row < 0 || hex.row >= map.height) return null;
  return hexIndex(hex.col, hex.row, map.width);
}

/** A disc that lies level: the top face of a piece. */
export interface LevelDisc {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * The disc `ray` goes through first, or `null`.
 *
 * @param eligible which discs count; all if omitted.
 */
export function pickMarkerOnRay<T extends LevelDisc>(discs: readonly T[], ray: Ray, eligible: (disc: T) => boolean = () => true): T | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  if (Math.abs(dy) < 1e-9) return null;
  let best: T | null = null;
  let nearest = Infinity;
  for (const disc of discs) {
    const t = (disc.y - oy) / dy;
    if (t <= 0 || t >= nearest) continue;
    if (Math.hypot(ox + dx * t - disc.x, oz + dz * t - disc.z) > disc.radius) continue;
    if (!eligible(disc)) continue;
    nearest = t;
    best = disc;
  }
  return best;
}
