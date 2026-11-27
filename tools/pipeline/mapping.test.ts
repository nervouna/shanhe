import { describe, expect, it } from 'vitest';
import { hexToWorld } from '../../src/shared/hex.ts';
import { wrapDegrees } from './albers.ts';
import { LAYOUT_KM, LENSES } from './config.ts';
import { createMapping } from './mapping.ts';
import { warpMinDeterminant } from './warp.ts';

const mapping = createMapping();

describe('the enlargement warp', () => {
  it('has lenses', () => {
    expect(LENSES.length).toBeGreaterThan(0);
  });

  it('does not fold: it is one-to-one inside every lens', () => {
    // the smallest value is 1 / (gain x gainAcross) of the strongest lens
    expect(warpMinDeterminant(mapping.warp)).toBeGreaterThan(0.005);
  });

  it('round-trips points inside and outside the lenses', () => {
    const p = { x: 0, z: 0 };
    const q = { x: 0, z: 0 };
    let inside = 0;
    for (const lens of mapping.warp.lenses) {
      for (const [fx, fz] of [
        [0, 0],
        [0.3, 0.1],
        [-0.5, 0.4],
        [0.1, -0.8],
        [0.69, 0.69],
        [-1.2, 0.3],
      ] as const) {
        const x = lens.centre.x + fx * lens.radiusKm;
        const z = lens.centre.z + fz * lens.radiusKm;
        mapping.warp.toSource(x, z, p);
        mapping.warp.toMap(p.x, p.z, q);
        expect(Math.hypot(q.x - x, q.z - z)).toBeLessThan(1e-5);
        if (Math.hypot(p.x - x, p.z - z) > 1) inside++;
      }
    }
    // the samples really were moved by the warp
    expect(inside).toBeGreaterThan(mapping.warp.lenses.length);
  });

  it('leaves the map alone outside every lens', () => {
    // central Siberia, far from any lens
    const m = mapping.lonLatToMap(100, 62);
    const a = mapping.albers.forward(100, 62);
    expect(m.x).toBe(a.x);
    expect(m.z).toBe(a.z);
  });

  it('puts the focus of every snapped lens on the centre of a hex', () => {
    LENSES.forEach((spec, k) => {
      if (spec.snap !== true) return;
      const info = mapping.warp.lenses[k]!;
      const hex = mapping.lonLatToHex(spec.lon, spec.lat);
      const centre = hexToWorld(hex, LAYOUT_KM);
      expect(Math.hypot(centre.x - info.centre.x, centre.z - info.centre.z)).toBeLessThan(1e-6);
      const shown = mapping.hexToLonLat(hex);
      expect(wrapDegrees(shown.lon - spec.lon)).toBeCloseTo(0, 6);
      expect(shown.lat).toBeCloseTo(spec.lat, 6);
    });
  });
});

describe('longitude and latitude to hex and back', () => {
  it('round-trips through the centre of the hex', () => {
    for (const [lon, lat] of [
      [104.07, 30.57],
      [114.17, 22.32],
      [127.68, 26.21],
      [103.82, 1.35],
      [-169.7, 66.1],
      [60.61, 56.84],
    ] as const) {
      const hex = mapping.lonLatToHex(lon, lat);
      const centre = mapping.hexToLonLat(hex);
      const again = mapping.lonLatToHex(centre.lon, centre.lat);
      expect(again).toEqual(hex);
    }
  });
});
