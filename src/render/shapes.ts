/**
 * Low-polygon shapes as plain arrays: the stock from which trees, houses
 * and landmarks are generated. No Three.js; the callers turn the arrays
 * into buffer geometries.
 */

export type Rgb = readonly [r: number, g: number, b: number];

/** `0xRRGGBB` as linear-light components, the space vertex colours are in. */
export function rgb(hex: number): Rgb {
  const linear = (byte: number): number => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [linear((hex >> 16) & 255), linear((hex >> 8) & 255), linear(hex & 255)];
}

export function shade(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

/** A triangle mesh under construction. Faces are flat-shaded unless a shape says otherwise. */
export class ShapeBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Rgb): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(color[0], color[1], color[2]);
    return this.vertexCount - 1;
  }

  /** A flat triangle, counter-clockwise seen from outside. */
  triangle(a: readonly number[], b: readonly number[], c: readonly number[], color: Rgb, colorC: Rgb = color): void {
    const ux = (b[0] as number) - (a[0] as number);
    const uy = (b[1] as number) - (a[1] as number);
    const uz = (b[2] as number) - (a[2] as number);
    const vx = (c[0] as number) - (a[0] as number);
    const vy = (c[1] as number) - (a[1] as number);
    const vz = (c[2] as number) - (a[2] as number);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const i = this.vertex(a[0] as number, a[1] as number, a[2] as number, nx, ny, nz, color);
    this.vertex(b[0] as number, b[1] as number, b[2] as number, nx, ny, nz, color);
    this.vertex(c[0] as number, c[1] as number, c[2] as number, nx, ny, nz, colorC);
    this.indices.push(i, i + 1, i + 2);
  }

  /**
   * A cone, a cylinder or anything between: `sides` faces around the `y`
   * axis from radius `r0` at `y0` to `r1` at `y1`, smooth around, closed at
   * the top when `r1 > 0`. The underside is left open.
   *
   * @param cx centre of the axis.
   * @param bottom colour at `y0`; `top` at `y1`.
   */
  frustum(
    cx: number,
    cz: number,
    y0: number,
    y1: number,
    r0: number,
    r1: number,
    sides: number,
    bottom: Rgb,
    top: Rgb = bottom,
    turn = 0,
  ): void {
    const slant = Math.atan2(r0 - r1, y1 - y0);
    const ny = Math.sin(slant);
    const nr = Math.cos(slant);
    const first = this.vertexCount;
    for (let s = 0; s <= sides; s++) {
      const a = turn + (s / sides) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      this.vertex(cx + cos * r0, y0, cz + sin * r0, cos * nr, ny, sin * nr, bottom);
      this.vertex(cx + cos * r1, y1, cz + sin * r1, cos * nr, ny, sin * nr, top);
    }
    for (let s = 0; s < sides; s++) {
      const a = first + s * 2;
      this.indices.push(a, a + 1, a + 2);
      if (r1 > 0) this.indices.push(a + 2, a + 1, a + 3);
    }
    if (r1 > 0) {
      const centre = this.vertex(cx, y1, cz, 0, 1, 0, top);
      const rim = this.vertexCount;
      for (let s = 0; s <= sides; s++) {
        const a = turn + (s / sides) * Math.PI * 2;
        this.vertex(cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, 0, 1, 0, top);
      }
      for (let s = 0; s < sides; s++) this.indices.push(centre, rim + s + 1, rim + s);
    }
  }

  /**
   * A rounded lump: an ellipsoid of `sides` segments around and `rings`
   * bands from bottom to top, smooth, darker underneath.
   */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, sides: number, rings: number, bottom: Rgb, top: Rgb, from = 0): void {
    const first = this.vertexCount;
    for (let r = 0; r <= rings; r++) {
      // `from` cuts the lower part off: 0 is a whole ellipsoid, 0.5 a dome
      const t = from + (1 - from) * (r / rings);
      const polar = Math.PI * (1 - t);
      const y = Math.cos(polar);
      const ring = Math.sin(polar);
      const color: Rgb = [
        bottom[0] + (top[0] - bottom[0]) * t,
        bottom[1] + (top[1] - bottom[1]) * t,
        bottom[2] + (top[2] - bottom[2]) * t,
      ];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const nx = Math.cos(a) * ring;
        const nz = Math.sin(a) * ring;
        // the normal of an ellipsoid leans towards its short axis
        const ex = nx / rx;
        const ey = y / ry;
        const ez = nz / rx;
        const length = Math.hypot(ex, ey, ez) || 1;
        this.vertex(cx + nx * rx, cy + y * ry, cz + nz * rx, ex / length, ey / length, ez / length, color);
      }
    }
    const row = sides + 1;
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < sides; s++) {
        const a = first + r * row + s;
        this.indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
  }

  /** A box from (`x0`, `y0`, `z0`) to (`x1`, `y1`, `z1`), flat faces, without its underside. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: Rgb, top: Rgb = color): void {
    const quad = (a: number[], b: number[], c: number[], d: number[], ca: Rgb, cc: Rgb): void => {
      this.triangle(a, b, c, ca, cc);
      this.triangle(a, c, d, ca, cc);
    };
    // sides: bottom two corners first, so that the colour runs from bottom to top
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, top);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, top);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, top);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, top);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, top);
  }
}
