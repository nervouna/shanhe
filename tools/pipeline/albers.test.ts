import { describe, expect, it } from 'vitest';
import { createAlbers, wrapDegrees } from './albers.ts';
import { PROJECTION } from './config.ts';

const albers = createAlbers(PROJECTION);

describe('Albers projection', () => {
  it('puts the origin at (0, 0)', () => {
    const p = albers.forward(PROJECTION.lon0, PROJECTION.lat0);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('has x growing to the east and z to the south', () => {
    expect(albers.forward(110, 35).x).toBeGreaterThan(0);
    expect(albers.forward(100, 35).x).toBeLessThan(0);
    expect(albers.forward(105, 40).z).toBeLessThan(0);
    expect(albers.forward(105, 30).z).toBeGreaterThan(0);
  });

  it('matches the formulas of the MapProjection contract', () => {
    const rad = Math.PI / 180;
    const n = (Math.sin(15 * rad) + Math.sin(55 * rad)) / 2;
    const C = Math.cos(15 * rad) ** 2 + 2 * n * Math.sin(15 * rad);
    const rho = (lat: number): number => (6371 * Math.sqrt(C - 2 * n * Math.sin(lat * rad))) / n;
    const theta = n * (139.69 - 105) * rad;
    const p = albers.forward(139.69, 35.69);
    expect(p.x).toBeCloseTo(rho(35.69) * Math.sin(theta), 6);
    expect(p.z).toBeCloseTo(-(rho(35) - rho(35.69) * Math.cos(theta)), 6);
  });

  it('round-trips places across the frame, also beyond 180°', () => {
    const places: [number, number][] = [
      [104.07, 30.57], // Chengdu
      [139.69, 35.69], // Tokyo
      [103.82, 1.35], // Singapore
      [106.85, -6.21], // Jakarta
      [60.61, 56.84], // Yekaterinburg
      [177.51, 64.73], // Anadyr
      [-169.7, 66.1], // Cape Dezhnev
      [95.0, 81.0], // Severnaya Zemlya
      [125.57, -8.56], // Dili
    ];
    for (const [lon, lat] of places) {
      const p = albers.forward(lon, lat);
      const back = albers.inverse(p.x, p.z);
      expect(wrapDegrees(back.lon - lon)).toBeCloseTo(0, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  it('keeps a ring that crosses 180° in one piece', () => {
    const west = albers.forward(179.9, 66);
    const east = albers.forward(-179.9, 66);
    expect(Math.hypot(west.x - east.x, west.z - east.z)).toBeLessThan(15);
  });

  it('is equal-area: one-degree cells have the area they have on the sphere', () => {
    const rad = Math.PI / 180;
    for (const [lon, lat] of [
      [105, 0],
      [80, 30],
      [140, 60],
      [170, 70],
    ] as const) {
      const a = albers.forward(lon, lat);
      const b = albers.forward(lon + 1, lat);
      const c = albers.forward(lon + 1, lat + 1);
      const d = albers.forward(lon, lat + 1);
      const planeArea =
        Math.abs(
          a.x * b.z - b.x * a.z + b.x * c.z - c.x * b.z + c.x * d.z - d.x * c.z + d.x * a.z - a.x * d.z,
        ) / 2;
      const sphereArea = 6371 ** 2 * rad * (Math.sin((lat + 1) * rad) - Math.sin(lat * rad));
      expect(planeArea / sphereArea).toBeCloseTo(1, 3);
    }
  });

  it('returns latitude 90 beyond the pole', () => {
    const pole = albers.forward(105, 90);
    expect(albers.inverse(0, pole.z - 500).lat).toBe(90);
  });
});
