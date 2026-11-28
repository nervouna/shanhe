/**
 * How the pieces are laid out for a zoom, without Three.js: how large a
 * piece is drawn so that it never falls below a readable size on screen,
 * which pieces merge into a stack once they would overlap, how the markers
 * of different owners make room for each other, and where the garrison of
 * a city stands.
 */

import { CAMERA_FOV } from './cameraRig.ts';
import { PIECE_RADIUS } from './pieceShape.ts';

/** Height of the view at distance 1. */
const VIEW_HEIGHT = 2 * Math.tan((CAMERA_FOV * Math.PI) / 360);

/**
 * A piece is never drawn smaller than this across, in CSS pixels, at the
 * point the camera looks at: its character is then about 15 pixels high.
 */
export const MIN_PIECE_PIXELS = 34;
/**
 * On the political map, where a piece is a marker among the names of the
 * polities, the least size is this: the lower bound at any zoom.
 */
export const MIN_MARKER_PIXELS = 26;

/** World units per CSS pixel at the point the camera looks at. */
export function worldPerPixel(distance: number, viewportHeight: number): number {
  return (distance * VIEW_HEIGHT) / Math.max(1, viewportHeight);
}

/** The least size of a piece across, in CSS pixels, for a share of the political map (0 terrain, 1 political map). */
export function leastPiecePixels(political = 0): number {
  const t = Math.min(Math.max(political, 0), 1);
  return MIN_PIECE_PIXELS + (MIN_MARKER_PIXELS - MIN_PIECE_PIXELS) * t;
}

/**
 * The least size on screen divided by the size a piece has on the board:
 * below 1 a piece is large enough as it stands, above 1 it has to be drawn
 * that much larger.
 *
 * @param distance of the camera from the point it looks at.
 * @param viewportHeight height of the canvas in CSS pixels.
 * @param political how far the view has turned into the political map, 0 to 1.
 */
export function pieceFit(distance: number, viewportHeight: number, hexSize: number, political = 0): number {
  const natural = (2 * PIECE_RADIUS * hexSize) / worldPerPixel(distance, viewportHeight);
  return leastPiecePixels(political) / natural;
}

/**
 * The factor by which pieces are drawn larger than their size on the board:
 * 1 while that size is readable, growing in proportion to the distance
 * beyond it, so that the size on screen stays at the least size.
 */
export function pieceZoomScale(distance: number, viewportHeight: number, hexSize: number, political = 0): number {
  return Math.max(1, pieceFit(distance, viewportHeight, hexSize, political));
}

/**
 * The piece before a city's gate is drawn at this share of the size of a
 * piece in the field, so that the city behind it stays in view.
 */
export const GARRISON_SCALE = 0.78;

/** The factor a garrison is drawn with: smaller than a piece in the field while that is readable. */
export function garrisonZoomScale(fit: number): number {
  return Math.max(GARRISON_SCALE, fit);
}

/**
 * The diameter of a piece on screen, in CSS pixels, at the point the camera looks at.
 *
 * @param garrison whether it is the piece before a city's gate.
 */
export function pieceScreenDiameter(distance: number, viewportHeight: number, hexSize: number, political = 0, garrison = false): number {
  const fit = pieceFit(distance, viewportHeight, hexSize, political);
  const scale = garrison ? garrisonZoomScale(fit) : Math.max(1, fit);
  return (2 * PIECE_RADIUS * hexSize * scale) / worldPerPixel(distance, viewportHeight);
}

/** Ratio between two steps of the fit as it is applied. */
const SCALE_STEP = 1.03;

/**
 * A fit ({@link pieceFit}) in steps of three percent, so that the layout
 * is computed again a few dozen times over the whole zoom range and not in
 * every frame of a zoom. Never below the fit asked for, so the least size
 * holds; and not below the garrison's scale, under which nothing changes.
 */
export function steppedScale(fit: number): number {
  if (!(fit > GARRISON_SCALE)) return GARRISON_SCALE;
  return SCALE_STEP ** Math.ceil(Math.log(fit) / Math.log(SCALE_STEP) - 1e-9);
}

/**
 * How far a piece has turned from a piece on the board (0) into a marker
 * (1): as a marker its ring is broader and the hit-point ticks are gone.
 */
export function markerShare(scale: number): number {
  const t = Math.min(Math.max((scale - 1.05) / 0.6, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * A piece grows less in height than across: seen from far above, height
 * only makes it stick through hills.
 */
export function pieceHeightScale(scale: number): number {
  return Math.sqrt(Math.max(1, scale));
}

/**
 * Where the piece on a city's hex stands: this far south of the middle of
 * the hex, as a fraction of the hex size. The city is built in the northern
 * part of its hex, its gate looks south, and the garrison stands before it.
 * The spot is inside the hex, so the piece still belongs to it.
 */
export const GARRISON_OFFSET = 0.56;

/** Which of several pieces gives a stack its character. */
export function pieceStrength(unit: { readonly era: number; readonly unique: boolean; readonly hp: number; readonly strength?: number }): number {
  // without a strength from the caller: the later era, then the unique unit, then the healthier one
  return unit.strength ?? unit.era * 100 + (unit.unique ? 50 : 0) + unit.hp * 10;
}

/** A piece as the layout sees it. */
export interface Standing {
  readonly id: number;
  readonly polity: number;
  /** Where it stands on the board. */
  readonly x: number;
  readonly z: number;
  readonly strength: number;
}

/** What is drawn for one or several pieces. */
export interface StackMarker {
  /** The piece that is drawn: the strongest of the stack. */
  readonly id: number;
  readonly polity: number;
  /** Where it is drawn. */
  readonly x: number;
  readonly z: number;
  /** Pieces in the stack, the drawn one included: 1 for a piece that stands alone. */
  readonly count: number;
  /** The ids of all of them, the drawn one first. */
  readonly members: readonly number[];
}

/**
 * Two pieces of one owner merge once their discs overlap by more than a
 * tenth of their diameter.
 */
const MERGE_AT = 0.9;

/**
 * Merges pieces of one owner that would overlap into stacks. The strongest
 * piece that is not yet in a stack takes in every piece of its owner whose
 * disc would overlap its own, and so on down the list: no two markers of
 * one owner overlap by more than a tenth afterwards, and nothing merges
 * while pieces are small enough to stand side by side.
 *
 * @param radius of a piece as drawn, in world units.
 */
export function stackPieces(pieces: readonly Standing[], radius: number): StackMarker[] {
  const reach = 2 * radius * MERGE_AT;
  const order = pieces.slice().sort((a, b) => b.strength - a.strength || a.id - b.id);
  // a grid of cells as wide as the reach: a piece's partners are in its cell or the eight around it
  const cellOf = (v: number): number => Math.floor(v / reach);
  const cells = new Map<string, Standing[]>();
  for (const piece of order) {
    const key = `${cellOf(piece.x)}:${cellOf(piece.z)}`;
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [piece]);
    else list.push(piece);
  }
  const taken = new Set<number>();
  const markers: StackMarker[] = [];
  for (const seed of order) {
    if (taken.has(seed.id)) continue;
    taken.add(seed.id);
    const members = [seed.id];
    const cx = cellOf(seed.x);
    const cz = cellOf(seed.z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const other of cells.get(`${cx + dx}:${cz + dz}`) ?? []) {
          if (taken.has(other.id) || other.polity !== seed.polity) continue;
          if (Math.hypot(other.x - seed.x, other.z - seed.z) >= reach) continue;
          taken.add(other.id);
          members.push(other.id);
        }
      }
    }
    markers.push({ id: seed.id, polity: seed.polity, x: seed.x, z: seed.z, count: members.length, members });
  }
  return markers;
}

/** Markers of different owners keep their middles this far apart, in radii: neither covers the other's character. */
const SPREAD_APART = 1.7;
/** A marker is drawn at most this far from where its piece stands, in radii. */
const SPREAD_LIMIT = 0.95;
const SPREAD_ROUNDS = 5;

/**
 * Moves markers apart that would cover each other's characters: what is
 * left after {@link stackPieces} are markers of different owners side by
 * side, on a front for example. Each stays within a radius of its place.
 *
 * @returns the markers, in the same order, where they are drawn.
 */
export function spreadMarkers(markers: readonly StackMarker[], radius: number): StackMarker[] {
  const apart = SPREAD_APART * radius;
  const limit = SPREAD_LIMIT * radius;
  const x = markers.map((marker) => marker.x);
  const z = markers.map((marker) => marker.z);
  const cellOf = (v: number): number => Math.floor(v / (apart + 2 * limit));
  // partners are found once, from where the pieces stand: nothing moves farther than the limit
  const cells = new Map<string, number[]>();
  markers.forEach((marker, i) => {
    const key = `${cellOf(marker.x)}:${cellOf(marker.z)}`;
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [i]);
    else list.push(i);
  });
  const pairs: [number, number][] = [];
  markers.forEach((marker, i) => {
    const cx = cellOf(marker.x);
    const cz = cellOf(marker.z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of cells.get(`${cx + dx}:${cz + dz}`) ?? []) {
          if (j <= i) continue;
          const other = markers[j] as StackMarker;
          if (Math.hypot(other.x - marker.x, other.z - marker.z) < apart + 2 * limit) pairs.push([i, j]);
        }
      }
    }
  });
  if (pairs.length === 0) return markers.slice();
  for (let round = 0; round < SPREAD_ROUNDS; round++) {
    let moved = false;
    for (const [i, j] of pairs) {
      let dx = (x[j] as number) - (x[i] as number);
      let dz = (z[j] as number) - (z[i] as number);
      let distance = Math.hypot(dx, dz);
      if (distance >= apart) continue;
      if (distance < 1e-6) {
        // on one spot: apart along a direction that depends on the pair only
        const angle = (((markers[i] as StackMarker).id * 31 + (markers[j] as StackMarker).id * 17) % 360) * (Math.PI / 180);
        dx = Math.cos(angle);
        dz = Math.sin(angle);
        distance = 1;
      }
      const push = (apart - distance) / 2 / distance;
      x[i] = (x[i] as number) - dx * push;
      z[i] = (z[i] as number) - dz * push;
      x[j] = (x[j] as number) + dx * push;
      z[j] = (z[j] as number) + dz * push;
      moved = true;
    }
    // back within reach of its own place
    markers.forEach((marker, i) => {
      const dx = (x[i] as number) - marker.x;
      const dz = (z[i] as number) - marker.z;
      const off = Math.hypot(dx, dz);
      if (off > limit) {
        x[i] = marker.x + (dx / off) * limit;
        z[i] = marker.z + (dz / off) * limit;
      }
    });
    if (!moved) break;
  }
  return markers.map((marker, i) => ({ ...marker, x: x[i] as number, z: z[i] as number }));
}

/** The text of the count on a stack: at most two digits. */
export function stackCountText(count: number): string {
  return String(Math.min(Math.max(Math.round(count), 1), 99));
}
