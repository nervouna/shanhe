import { describe, expect, it } from 'vitest';
import { PIECE_AROUND, PIECE_BEVEL, PIECE_HEIGHT, PIECE_RADIUS, pieceCasterMesh, pieceOutline } from './pieceShape.ts';

describe('pieceCasterMesh', () => {
  const mesh = pieceCasterMesh();
  const point = (i: number): [number, number, number] => [
    mesh.positions[i * 3] as number,
    mesh.positions[i * 3 + 1] as number,
    mesh.positions[i * 3 + 2] as number,
  ];

  it('is a small fraction of the piece that is drawn', () => {
    const drawn = PIECE_AROUND * (pieceOutline().length - 1) * 2;
    const triangles = mesh.indices.length / 3;
    expect(Number.isInteger(triangles)).toBe(true);
    expect(triangles).toBeGreaterThan(20);
    expect(triangles).toBeLessThanOrEqual(drawn / 8);
  });

  it('stays inside the drawn piece, so that a piece does not shade its own face', () => {
    const margin = 0.02;
    let widest = 0;
    let highest = 0;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const [x, y, z] = point(i);
      const r = Math.hypot(x, z);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(PIECE_HEIGHT - margin);
      expect(r).toBeLessThanOrEqual(PIECE_RADIUS - margin);
      // the corner stays inside the rounded edge
      if (y > PIECE_HEIGHT - PIECE_BEVEL && r > PIECE_RADIUS - PIECE_BEVEL) {
        expect(Math.hypot(r - (PIECE_RADIUS - PIECE_BEVEL), y - (PIECE_HEIGHT - PIECE_BEVEL))).toBeLessThan(PIECE_BEVEL - margin);
      }
      widest = Math.max(widest, r);
      highest = Math.max(highest, y);
    }
    // and is nearly as large: its shadow is the piece's shadow
    expect(widest).toBeGreaterThan(PIECE_RADIUS * 0.9);
    expect(highest).toBeGreaterThan(PIECE_HEIGHT * 0.8);
  });

  it('has every face turned outwards: the side away from the axis, the top up', () => {
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = point(mesh.indices[t] as number);
      const b = point(mesh.indices[t + 1] as number);
      const c = point(mesh.indices[t + 2] as number);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] as const;
      expect(Math.hypot(...n)).toBeGreaterThan(1e-6);
      const mid = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3] as const;
      const flat = Math.abs(n[1]) > Math.hypot(n[0], n[2]);
      if (flat) expect(n[1]).toBeGreaterThan(0);
      else expect(n[0] * mid[0] + n[2] * mid[1]).toBeGreaterThan(0);
    }
  });

  it('uses every vertex and no index out of range', () => {
    const count = mesh.positions.length / 3;
    const used = new Set(mesh.indices);
    expect(used.size).toBe(count);
    for (const index of mesh.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(count);
    }
  });
});

describe('pieceOutline', () => {
  it('runs from the middle of the top over the rounded edges down to the rim of the open underside', () => {
    const outline = pieceOutline();
    expect(outline[0]).toEqual([0, PIECE_HEIGHT, 0, 1]);
    const last = outline[outline.length - 1] as readonly number[];
    expect(last[1]).toBeCloseTo(0, 9);
    for (const [r, y, nr, ny] of outline) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(PIECE_RADIUS + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(PIECE_HEIGHT + 1e-9);
      expect(Math.hypot(nr, ny)).toBeCloseTo(1, 9);
    }
  });
});
