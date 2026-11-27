/**
 * The enlargement warp: a chain of lenses between the map plane (what the
 * game shows) and the source plane (the true Albers projection). Both are in
 * kilometres, `x` east and `z` south.
 *
 * A lens changes the plane only inside a disc of radius `R` around its
 * centre `c` on the map side. For a map point `m` with `d = m - c` and
 * `t = |d| / R < 1`:
 *
 *     L(m) = m + (1 - t^p) * (A - I) * d + (1 - t²)² * shift
 *
 * `A` shrinks `d` by the gains along the lens axes, so the neighbourhood of
 * the focus is drawn `gain` times larger; the effect fades to nothing at the
 * rim, where `L` is the identity. `shift` moves the focus onto the centre of
 * a hex, so that the hex is sampled exactly at the focus.
 *
 * The whole warp is `toSource = L1 ∘ L2 ∘ … ∘ Ln`, the last lens applied to
 * the map point first. Every dataset is sampled through `toSource`.
 */

import { hexToWorld, worldToHex } from '../../src/shared/hex.ts';
import type { HexLayout } from '../../src/shared/hex.ts';
import type { Albers, PlanePoint } from './albers.ts';

/** A lens as written in the configuration. */
export interface LensSpec {
  readonly id: string;
  /** The focus: the place that is enlarged. */
  readonly lon: number;
  readonly lat: number;
  /** Radius of the affected disc on the map, km. */
  readonly radiusKm: number;
  /** Linear enlargement at the focus along the lens axis. Below 1 shrinks. */
  readonly gain: number;
  /** Enlargement across the axis; `gain` if omitted. */
  readonly gainAcross?: number;
  /** Direction of the axis on the map, degrees anticlockwise from east. */
  readonly axisDeg?: number;
  /** How flat the enlargement stays around the focus (`p` above), 1 by default. */
  readonly power?: number;
  /** Put the focus on the centre of the nearest hex. */
  readonly snap?: boolean;
  /**
   * Id of the polity the snapped focus belongs to: the pipeline fails if the
   * focus hex does not come out as land of that polity.
   */
  readonly polity?: string;
  /** The snapped focus is a lake: the pipeline fails if the focus hex is not one. */
  readonly lake?: boolean;
}

interface Lens {
  readonly id: string;
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
  readonly shiftX: number;
  readonly shiftZ: number;
  /** A - I, row-major. */
  readonly b11: number;
  readonly b12: number;
  readonly b21: number;
  readonly b22: number;
  readonly power: number;
}

export interface WarpLensInfo {
  readonly id: string;
  /** Centre of the disc on the map plane. */
  readonly centre: PlanePoint;
  readonly radiusKm: number;
  /** Length of the focus shift, km. */
  readonly shiftKm: number;
}

export interface Warp {
  /** Map plane to source plane. */
  toSource(x: number, z: number, out?: PlanePoint): PlanePoint;
  /** Source plane to map plane: the inverse of `toSource`. */
  toMap(x: number, z: number, out?: PlanePoint): PlanePoint;
  readonly lenses: readonly WarpLensInfo[];
}

function applyLens(l: Lens, x: number, z: number, out: PlanePoint): PlanePoint {
  const dx = x - l.cx;
  const dz = z - l.cz;
  const t2 = (dx * dx + dz * dz) / (l.radius * l.radius);
  if (t2 >= 1) {
    out.x = x;
    out.z = z;
    return out;
  }
  const w = 1 - Math.sqrt(t2) ** l.power;
  const bump = (1 - t2) * (1 - t2);
  out.x = x + w * (l.b11 * dx + l.b12 * dz) + bump * l.shiftX;
  out.z = z + w * (l.b21 * dx + l.b22 * dz) + bump * l.shiftZ;
  return out;
}

/** Solves `L(m) = (x, z)` for `m` with a damped Newton iteration. */
function invertLens(l: Lens, x: number, z: number, out: PlanePoint): PlanePoint {
  const ox = x - l.cx;
  const oz = z - l.cz;
  if (ox * ox + oz * oz >= l.radius * l.radius) {
    out.x = x;
    out.z = z;
    return out;
  }
  const p: PlanePoint = { x: 0, z: 0 };
  const residual = (mx: number, mz: number): number => {
    applyLens(l, mx, mz, p);
    return Math.hypot(p.x - x, p.z - z);
  };
  let mx = x;
  let mz = z;
  let err = residual(mx, mz);
  const h = 1e-4;
  for (let i = 0; i < 100 && err > 1e-9; i++) {
    applyLens(l, mx, mz, p);
    const fx = p.x - x;
    const fz = p.z - z;
    applyLens(l, mx + h, mz, p);
    const j11 = (p.x - x - fx) / h;
    const j21 = (p.z - z - fz) / h;
    applyLens(l, mx, mz + h, p);
    const j12 = (p.x - x - fx) / h;
    const j22 = (p.z - z - fz) / h;
    const det = j11 * j22 - j12 * j21;
    if (!(Math.abs(det) > 1e-12)) throw new Error(`warp: lens ${l.id} is singular`);
    const stepX = -(j22 * fx - j12 * fz) / det;
    const stepZ = -(-j21 * fx + j11 * fz) / det;
    let scale = 1;
    for (;;) {
      const nx = mx + scale * stepX;
      const nz = mz + scale * stepZ;
      const next = residual(nx, nz);
      if (next < err || scale < 1e-6) {
        mx = nx;
        mz = nz;
        err = next;
        break;
      }
      scale /= 2;
    }
  }
  if (err > 1e-6) throw new Error(`warp: lens ${l.id} could not be inverted at (${x}, ${z})`);
  out.x = mx;
  out.z = mz;
  return out;
}

/**
 * Builds the warp from the lens list.
 *
 * @param layoutKm the hex grid on the map plane, in kilometres.
 */
export function buildWarp(specs: readonly LensSpec[], albers: Albers, layoutKm: HexLayout): Warp {
  const lenses: Lens[] = [];
  const info: WarpLensInfo[] = [];

  const toMap = (x: number, z: number, out: PlanePoint = { x: 0, z: 0 }): PlanePoint => {
    out.x = x;
    out.z = z;
    for (const l of lenses) invertLens(l, out.x, out.z, out);
    return out;
  };
  const toSource = (x: number, z: number, out: PlanePoint = { x: 0, z: 0 }): PlanePoint => {
    out.x = x;
    out.z = z;
    for (let i = lenses.length - 1; i >= 0; i--) applyLens(lenses[i] as Lens, out.x, out.z, out);
    return out;
  };

  for (const spec of specs) {
    // Where the focus sits on the map under the lenses built so far.
    const focus = albers.forward(spec.lon, spec.lat);
    const q = toMap(focus.x, focus.z);
    let cx = q.x;
    let cz = q.z;
    if (spec.snap === true) {
      const centre = hexToWorld(worldToHex({ x: q.x, z: q.z }, layoutKm), layoutKm);
      cx = centre.x;
      cz = centre.z;
    }
    const along = 1 / spec.gain - 1;
    const across = 1 / (spec.gainAcross ?? spec.gain) - 1;
    const angle = ((spec.axisDeg ?? 0) * Math.PI) / 180;
    // axis direction on the map: east is +x, north is -z
    const ax = Math.cos(angle);
    const az = -Math.sin(angle);
    lenses.push({
      id: spec.id,
      cx,
      cz,
      radius: spec.radiusKm,
      shiftX: q.x - cx,
      shiftZ: q.z - cz,
      b11: along * ax * ax + across * az * az,
      b12: (along - across) * ax * az,
      b21: (along - across) * ax * az,
      b22: along * az * az + across * ax * ax,
      power: spec.power ?? 1,
    });
    info.push({
      id: spec.id,
      centre: { x: cx, z: cz },
      radiusKm: spec.radiusKm,
      shiftKm: Math.hypot(q.x - cx, q.z - cz),
    });
  }

  return { toSource, toMap, lenses: info };
}

/**
 * The smallest Jacobian determinant of `toSource` over a polar lattice of
 * points inside every lens. It is positive exactly when the warp does not
 * fold the plane there, which is what makes it a one-to-one mapping.
 */
export function warpMinDeterminant(warp: Warp): number {
  const h = 0.05;
  const p: PlanePoint = { x: 0, z: 0 };
  let min = 1;
  for (const lens of warp.lenses) {
    for (let ring = 0; ring <= 40; ring++) {
      const radius = (ring / 40) * lens.radiusKm * 0.999;
      for (let k = 0; k < 48; k++) {
        const angle = (k / 48) * 2 * Math.PI;
        const x = lens.centre.x + radius * Math.cos(angle);
        const z = lens.centre.z + radius * Math.sin(angle);
        warp.toSource(x, z, p);
        const fx = p.x;
        const fz = p.z;
        warp.toSource(x + h, z, p);
        const j11 = (p.x - fx) / h;
        const j21 = (p.z - fz) / h;
        warp.toSource(x, z + h, p);
        const j12 = (p.x - fx) / h;
        const j22 = (p.z - fz) / h;
        min = Math.min(min, j11 * j22 - j12 * j21);
      }
    }
  }
  return min;
}

/** The farthest the warp moves any point, km, over the same lattice. */
export function warpMaxDisplacement(warp: Warp): number {
  const p: PlanePoint = { x: 0, z: 0 };
  let max = 0;
  for (const lens of warp.lenses) {
    for (let ring = 0; ring <= 40; ring++) {
      const radius = (ring / 40) * lens.radiusKm;
      for (let k = 0; k < 48; k++) {
        const angle = (k / 48) * 2 * Math.PI;
        const x = lens.centre.x + radius * Math.cos(angle);
        const z = lens.centre.z + radius * Math.sin(angle);
        warp.toSource(x, z, p);
        max = Math.max(max, Math.hypot(p.x - x, p.z - z));
      }
    }
  }
  return max;
}
