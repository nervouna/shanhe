/**
 * The arithmetic of the light, without Three.js: where the afternoon sun
 * stands as it slowly drifts, and how the cascades of the shadow map are
 * fitted to the view.
 */

export type Direction = readonly [x: number, y: number, z: number];

/** Azimuth of the sun at rest, clockwise from north, in radians: the south-west. */
const SUN_AZIMUTH = (236 * Math.PI) / 180;
/** Height of the sun above the horizon at rest, in radians. */
const SUN_ELEVATION = (41 * Math.PI) / 180;
/** How far the sun wanders to either side, in radians, and how long one swing takes, in seconds. */
const AZIMUTH_SWING = 0.16;
const AZIMUTH_PERIOD = 260;
const ELEVATION_SWING = 0.06;
const ELEVATION_PERIOD = 190;

/**
 * Unit vector from the ground towards the sun (`x` east, `y` up, `z`
 * south) after `seconds` of drawn time. It stays an afternoon sun: the
 * drift is a slow swing around one place in the sky, never a day.
 */
export function sunDirectionAt(seconds: number): Direction {
  const azimuth = SUN_AZIMUTH + AZIMUTH_SWING * Math.sin((2 * Math.PI * seconds) / AZIMUTH_PERIOD);
  const elevation = SUN_ELEVATION + ELEVATION_SWING * Math.sin((2 * Math.PI * seconds) / ELEVATION_PERIOD + 1);
  const flat = Math.cos(elevation);
  return [Math.sin(azimuth) * flat, Math.sin(elevation), -Math.cos(azimuth) * flat];
}

/** Angle between two unit vectors, in radians. */
export function angleBetween(a: Direction, b: Direction): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

/** The sun is moved, and the shadows drawn again, once it has drifted this far, in radians. */
export const SUN_STEP = 0.012;

/** Number of cascades of the shadow map. */
export const CASCADE_COUNT = 2;
/**
 * Half the side of each cascade's square on the ground, as a multiple of
 * the camera distance: the first holds the middle of the view in fine
 * texels, the last everything the lowest view can see.
 */
const CASCADE_REACH: readonly number[] = [0.62, 2.1];

/** One cascade as it was last drawn. */
export interface CascadeFit {
  /** The ground point in its middle. */
  readonly x: number;
  readonly z: number;
  /** The camera distance it was fitted to. */
  readonly distance: number;
  /** Half the side of its square. */
  readonly half: number;
}

/** Half the side of cascade `index` for a camera distance. */
export function cascadeHalf(index: number, distance: number, mapSpan: number): number {
  const reach = CASCADE_REACH[Math.min(index, CASCADE_REACH.length - 1)] as number;
  return Math.min(Math.max(distance * reach, 2), mapSpan);
}

/**
 * Whether a cascade has to be fitted to the view again: the zoom changed
 * by more than its margin, or the view moved a good part of its size.
 * `null` is a cascade that was never drawn.
 */
export function cascadeNeedsFit(fit: CascadeFit | null, x: number, z: number, distance: number): boolean {
  if (fit === null) return true;
  const ratio = distance / fit.distance;
  if (ratio > 1.2 || ratio < 0.7) return true;
  return Math.hypot(x - fit.x, z - fit.z) > fit.half * 0.22;
}
