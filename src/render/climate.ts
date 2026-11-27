/**
 * Where on the globe a point of the map lies, and what follows from it for
 * the picture: the height of the snow line. Plain arithmetic on the map's
 * projection, shared by the shaders (through uniforms) and by the placement
 * of trees. No Three.js.
 */

import type { MapProjection } from '../shared/mapData.ts';

/** The numbers a shader needs to turn a ground point into the sine of its latitude. */
export interface LatitudeTerms {
  /** World `z` of the apex of the projection's cone (its `x` is 0). */
  readonly apexZ: number;
  /** `(n * kmPerWorldUnit / radius)^2`: scales a squared world distance from the apex. */
  readonly scale: number;
  /** The projection's constants `C` and `n`, see `MapProjection`. */
  readonly c: number;
  readonly n: number;
}

export function latitudeTerms(projection: MapProjection): LatitudeTerms {
  const rad = Math.PI / 180;
  const s1 = Math.sin(projection.parallel1 * rad);
  const s2 = Math.sin(projection.parallel2 * rad);
  const n = (s1 + s2) / 2;
  const c = Math.cos(projection.parallel1 * rad) ** 2 + 2 * n * s1;
  const rho0 = (projection.radiusKm * Math.sqrt(c - 2 * n * Math.sin(projection.lat0 * rad))) / n;
  return {
    apexZ: -rho0 / projection.kmPerWorldUnit,
    scale: ((n * projection.kmPerWorldUnit) / projection.radiusKm) ** 2,
    c,
    n,
  };
}

/** Sine of the latitude of a ground point: the inverse of the equal-area conic projection. */
export function sinLatitudeAt(terms: LatitudeTerms, x: number, z: number): number {
  const dz = z - terms.apexZ;
  const sine = (terms.c - terms.scale * (x * x + dz * dz)) / (2 * terms.n);
  return Math.min(1, Math.max(-1, sine));
}

/** Latitude of a ground point in degrees north. */
export function latitudeAt(terms: LatitudeTerms, x: number, z: number): number {
  return (Math.asin(sinLatitudeAt(terms, x, z)) * 180) / Math.PI;
}

/** The snow line in the tropics and how fast it sinks towards the pole, in metres. */
export const SNOW_LINE_TOP = 5600;
export const SNOW_LINE_DROP = 9500;
/** Sine of the latitude from which the snow line sinks (about 27 degrees north). */
export const SNOW_LINE_FROM = 0.45;

/**
 * Altitude above which bare ground is under snow, for the sine of a
 * latitude: about 5,400 m over the Himalaya, 3,200 m at 45 degrees north
 * and under 1,000 m on the Arctic coast. The terrain shader uses the same
 * three constants.
 */
export function snowLineMetres(sinLatitude: number): number {
  return SNOW_LINE_TOP - SNOW_LINE_DROP * Math.max(0, sinLatitude - SNOW_LINE_FROM);
}
