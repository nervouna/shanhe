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

/**
 * What casts shadows, in two layers with a shadow map each per cascade.
 * `ground` is everything that stands still: terrain, trees, cities and the
 * buildings of improvements. `pieces` are the unit pieces, which move.
 */
export interface ShadowLayers {
  readonly ground: boolean;
  readonly pieces: boolean;
}

/**
 * Which shadow maps of one cascade are drawn again in a frame.
 *
 * The ground map is by far the dearer one (every terrain patch, forest and
 * city the cascade covers), so a piece in motion never draws it: only a
 * change of the ground itself does, or a new fit of the cascade, which moves
 * both maps.
 *
 * @param refit whether the cascade is fitted to the view again in this frame.
 * @param changed the layers in which something changed since the last frame.
 */
export function shadowRedraw(refit: boolean, changed: ShadowLayers): ShadowLayers {
  return { ground: refit || changed.ground, pieces: refit || changed.pieces };
}

/** A circle on the ground in which something that casts a shadow changed. */
export interface ShadowArea {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Whether a cascade's ground map shows any of `areas`: a change of the
 * ground outside the square a cascade covers needs no new map of it.
 *
 * The square lies across the light, so on the ground it is stretched along
 * the sun's bearing by `1 / sunHeight`; the test takes the circle around
 * that stretched square, which errs on the side of drawing.
 *
 * @param fit the cascade as it is drawn; `null` is a cascade that was never drawn, which sees everything.
 * @param sunHeight the vertical part of the unit vector towards the sun, 0 to 1.
 */
export function cascadeSeesAny(fit: CascadeFit | null, areas: readonly ShadowArea[], sunHeight: number): boolean {
  if (areas.length === 0) return false;
  if (fit === null) return true;
  const reach = (fit.half * Math.SQRT2) / Math.max(sunHeight, 0.1);
  for (const area of areas) {
    if (Math.hypot(area.x - fit.x, area.z - fit.z) <= reach + area.radius) return true;
  }
  return false;
}

/**
 * While the view moves, terrain patches change their detail and forests come
 * in, a few in every frame: the ground's shadow maps follow them at this
 * interval of frames, not in each one.
 */
export const GROUND_STREAM_FRAMES = 12;

/**
 * Whether the ground's shadow maps are drawn again for terrain and trees
 * that came in.
 *
 * @param pending whether any came in since the maps were last drawn for them.
 * @param now whether any came in in this frame.
 * @param framesSince frames since the maps were last drawn for them.
 */
export function streamedGroundDue(pending: boolean, now: boolean, framesSince: number): boolean {
  // settled, or overdue while more keeps coming
  return pending && (!now || framesSince >= GROUND_STREAM_FRAMES);
}

/** The layer starts to show at this zoom fraction and is at its fullest at the next one. */
const SHOW_FROM = 0.42;
const SHOW_FULL = 0.7;
/** Opacity of the thickest cloud at the farthest zoom. */
const MAX_OPACITY = 0.5;

/** How far the cloud layer has come into view at a zoom fraction, 0 to 1. */
export function cloudLayerShare(zoom: number): number {
  const t = Math.min(Math.max((zoom - SHOW_FROM) / (SHOW_FULL - SHOW_FROM), 0), 1);
  return t * t * (3 - 2 * t);
}

/** How opaque the cloud layer is at a zoom fraction. */
export function cloudLayerOpacity(zoom: number): number {
  return cloudLayerShare(zoom) * MAX_OPACITY;
}

/**
 * The cloud pattern is two layers of the noise texture's fourth channel,
 * read at these scales in hex sizes and mixed in these shares
 * (`cloudCover` in `shaderLib.ts`).
 */
export const CLOUD_SCALES: readonly [large: number, small: number] = [58, 23];
export const CLOUD_WEIGHTS: readonly [large: number, small: number] = [0.65, 0.35];
export const CLOUD_SMALL_OFFSET: readonly [u: number, v: number] = [0.37, 0.11];

/** Between which values of the pattern cloud thickens from none to full: `[from, to]`. */
export type CloudEdges = readonly [from: number, to: number];
/**
 * Near the ground, where only the shadows of the clouds show: broad, soft
 * shadows over two thirds of the land.
 */
export const CLOUD_SHADOW_EDGES: CloudEdges = [0.5, 0.72];
/**
 * The cloud layer seen from above: only the thick middles of those clouds,
 * about a sixth of the land, so that the board under it stays in view.
 */
export const CLOUD_LAYER_EDGES: CloudEdges = [0.665, 0.83];

/** How much cloud a value of the pattern makes, 0 to 1. */
export function cloudDensity(pattern: number, edges: CloudEdges): number {
  const t = Math.min(Math.max((pattern - edges[0]) / (edges[1] - edges[0]), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The edges the shadows of the clouds are cut with at a zoom fraction: the
 * broad ones near the ground, the layer's own once the layer is in view, so
 * that every shadow then lies under a cloud.
 */
export function cloudShadowEdges(zoom: number): CloudEdges {
  const t = cloudLayerShare(zoom);
  return [
    CLOUD_SHADOW_EDGES[0] + (CLOUD_LAYER_EDGES[0] - CLOUD_SHADOW_EDGES[0]) * t,
    CLOUD_SHADOW_EDGES[1] + (CLOUD_LAYER_EDGES[1] - CLOUD_SHADOW_EDGES[1]) * t,
  ];
}

/**
 * The share of the ground under any cloud of the layer, measured on the
 * noise the shader reads.
 *
 * @param tile the noise texture as `buildNoiseTile` makes it, `size` pixels a side.
 */
export function cloudCoverage(tile: Uint8Array, size: number, edges: CloudEdges = CLOUD_LAYER_EDGES): number {
  const at = (u: number, v: number): number => {
    const i = ((Math.floor(u * size) % size) + size) % size;
    const j = ((Math.floor(v * size) % size) + size) % size;
    return (tile[(j * size + i) * 4 + 3] as number) / 255;
  };
  let covered = 0;
  let total = 0;
  // an area many repeats of both layers wide, in hex sizes
  for (let z = 0; z < 700; z += 1.7) {
    for (let x = 0; x < 700; x += 1.7) {
      const pattern =
        CLOUD_WEIGHTS[0] * at(x / CLOUD_SCALES[0], z / CLOUD_SCALES[0]) +
        CLOUD_WEIGHTS[1] * at(x / CLOUD_SCALES[1] + CLOUD_SMALL_OFFSET[0], z / CLOUD_SCALES[1] + CLOUD_SMALL_OFFSET[1]);
      if (cloudDensity(pattern, edges) > 0) covered++;
      total++;
    }
  }
  return covered / total;
}
