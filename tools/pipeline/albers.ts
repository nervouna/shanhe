/**
 * Albers equal-area conic projection on a sphere, exactly as documented on
 * `MapProjection` in `src/shared/mapData.ts`, in kilometres on the plane:
 * `x` grows to the east and `z` to the south, the origin maps to (0, 0).
 */

export interface AlbersParams {
  readonly lon0: number;
  readonly lat0: number;
  readonly parallel1: number;
  readonly parallel2: number;
  readonly radiusKm: number;
}

/** A point on a plane, kilometres: `x` east, `z` south. */
export interface PlanePoint {
  x: number;
  z: number;
}

export interface LonLat {
  lon: number;
  lat: number;
}

export interface Albers {
  readonly params: AlbersParams;
  /** Longitude and latitude in degrees to the plane. */
  forward(lon: number, lat: number, out?: PlanePoint): PlanePoint;
  /**
   * Like `forward`, but takes the longitude as an offset from `lon0` that is
   * not wrapped, so a ring that crosses 180° stays in one piece.
   */
  forwardOffset(dLon: number, lat: number, out?: PlanePoint): PlanePoint;
  /**
   * The plane to longitude and latitude. Points beyond the pole, which the
   * projection does not reach, come back with latitude 90.
   */
  inverse(x: number, z: number, out?: LonLat): LonLat;
}

const RAD = Math.PI / 180;

/** Wraps a longitude difference into [-180, 180). */
export function wrapDegrees(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

export function createAlbers(params: AlbersParams): Albers {
  const R = params.radiusKm;
  const n = (Math.sin(params.parallel1 * RAD) + Math.sin(params.parallel2 * RAD)) / 2;
  const C = Math.cos(params.parallel1 * RAD) ** 2 + 2 * n * Math.sin(params.parallel1 * RAD);
  const rho = (lat: number): number => (R * Math.sqrt(Math.max(0, C - 2 * n * Math.sin(lat * RAD)))) / n;
  const rho0 = rho(params.lat0);

  const forwardOffset = (dLon: number, lat: number, out: PlanePoint = { x: 0, z: 0 }): PlanePoint => {
    const r = rho(lat);
    const theta = n * dLon * RAD;
    out.x = r * Math.sin(theta);
    out.z = -(rho0 - r * Math.cos(theta));
    return out;
  };

  return {
    params,
    forwardOffset,
    forward: (lon, lat, out) => forwardOffset(wrapDegrees(lon - params.lon0), lat, out),
    inverse: (x, z, out = { lon: 0, lat: 0 }) => {
      const north = -z;
      const r = Math.hypot(x, rho0 - north);
      const theta = Math.atan2(x, rho0 - north);
      const s = (C - ((r * n) / R) ** 2) / (2 * n);
      out.lat = Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
      out.lon = wrapDegrees(params.lon0 + theta / n / RAD);
      return out;
    },
  };
}
