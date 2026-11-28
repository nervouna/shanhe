/**
 * Where a city stands in its hex and how large it is drawn, without
 * Three.js. The city is built in the northern part of the hex, wider than
 * it is deep; the piece on the hex, its garrison, stands south of it before
 * the gate (`GARRISON_OFFSET` in `pieceLayout.ts`). From far away, where
 * the houses would be specks, a square marker in the owner's colour takes
 * the city's place.
 */

import { cityRadius } from './cityGen.ts';
import type { CityFamilyId, Part } from './cityGen.ts';
import { worldPerPixel } from './pieceLayout.ts';

/** The middle of the city lies this far north of the middle of its hex, as a fraction of the hex size. */
export const CITY_NORTH = 0.34;
/** The city is stretched from east to west and pressed from north to south by these factors. */
export const CITY_WIDE = 1.22;
export const CITY_DEEP = 0.9;
/** The wall of a town stands at this multiple of the radius of its houses (`generateCity`). */
const WALL_REACH = 1.12;

/** Radius the built-up area of a city is drawn with, walls included, before the stretch: fractions of the hex size. */
export function cityDrawnRadius(population: number): number {
  return Math.min(0.64, 0.47 + 0.045 * Math.sqrt(Math.max(1, population)));
}

/**
 * The factor by which the parts of a generated city are enlarged, so that
 * a village is not lost beside a piece and a metropolis still fits its hex.
 */
export function cityScale(population: number, family: CityFamilyId): number {
  return cityDrawnRadius(population) / (cityRadius(population, family) * WALL_REACH);
}

/** The ground a city covers: an ellipse around a point north of the middle of the hex, in hex sizes. */
export interface CityFootprint {
  /** Offset of its middle from the middle of the hex; `z` is negative, north. */
  readonly z: number;
  /** Half its width (east to west) and half its depth. */
  readonly halfWidth: number;
  readonly halfDepth: number;
}

export function cityFootprint(population: number): CityFootprint {
  const radius = cityDrawnRadius(population);
  return { z: -CITY_NORTH, halfWidth: radius * CITY_WIDE, halfDepth: radius * CITY_DEEP };
}

/** Moves the parts of a generated city (around the origin) to where the city is drawn in its hex, at its drawn size. */
export function layOutCity(parts: readonly Part[], scale: number): Part[] {
  return parts.map((part) => ({
    ...part,
    x: part.x * scale * CITY_WIDE,
    y: part.y * scale,
    z: part.z * scale * CITY_DEEP - CITY_NORTH,
    w: part.w * scale,
    h: part.h * scale,
    d: part.d * scale,
  }));
}

/** A city's marker is never smaller than this across on screen, in CSS pixels; a capital's is larger. */
export const MIN_CITY_MARKER_PIXELS = 18;
/** On the political map, where the names of the polities need the room, it is this small. */
export const MIN_CITY_MARKER_PIXELS_POLITICAL = 13;
export const CAPITAL_MARKER_FACTOR = 1.25;
/** The marker fades in while the city is between these sizes across on screen, in CSS pixels. */
const MARKER_FROM_PIXELS = 34;
const MARKER_FULL_PIXELS = 24;
/** The size of a middling city across, in hex sizes: what the fade is measured on. */
const TYPICAL_CITY = 1.25;

/**
 * How far the cities have turned from models (0) into markers (1) at a
 * camera distance.
 */
export function cityMarkerShare(distance: number, viewportHeight: number, hexSize: number): number {
  const pixels = (TYPICAL_CITY * hexSize) / worldPerPixel(distance, viewportHeight);
  const t = Math.min(Math.max((MARKER_FROM_PIXELS - pixels) / (MARKER_FROM_PIXELS - MARKER_FULL_PIXELS), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Half the side of a city's marker in world units: the size of the city on
 * the board, or the least size on screen where that is larger.
 */
export function cityMarkerHalf(distance: number, viewportHeight: number, hexSize: number, political = 0): number {
  const t = Math.min(Math.max(political, 0), 1);
  const pixels = MIN_CITY_MARKER_PIXELS + (MIN_CITY_MARKER_PIXELS_POLITICAL - MIN_CITY_MARKER_PIXELS) * t;
  const least = (pixels / 2) * worldPerPixel(distance, viewportHeight);
  return Math.max(0.5 * hexSize, least);
}
