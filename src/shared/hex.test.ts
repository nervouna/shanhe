import { describe, expect, it } from 'vitest';
import {
  HEX_DIRECTIONS,
  axialToCube,
  axialToOffset,
  cubeToAxial,
  cubeToOffset,
  hexCorners,
  hexDistance,
  hexIndex,
  hexLine,
  hexNeighbor,
  hexNeighbors,
  hexRange,
  hexRing,
  hexToWorld,
  indexToOffset,
  offsetToAxial,
  offsetToCube,
  oppositeDirection,
  worldToHex,
} from './hex.ts';
import type { HexLayout, Offset } from './hex.ts';

const layout: HexLayout = { size: 2, originX: 10, originZ: -4 };
const key = (h: Offset): string => `${h.col},${h.row}`;

describe('coordinate conversions', () => {
  it('maps odd-r offset to axial', () => {
    expect(offsetToAxial({ col: 0, row: 0 })).toEqual({ q: 0, r: 0 });
    expect(offsetToAxial({ col: 2, row: 1 })).toEqual({ q: 2, r: 1 });
    expect(offsetToAxial({ col: 2, row: 2 })).toEqual({ q: 1, r: 2 });
    expect(offsetToAxial({ col: 0, row: 3 })).toEqual({ q: -1, r: 3 });
    expect(offsetToAxial({ col: 1, row: -1 })).toEqual({ q: 2, r: -1 });
  });

  it('round-trips offset, axial and cube', () => {
    for (let row = -4; row <= 4; row++) {
      for (let col = -4; col <= 4; col++) {
        const o = { col, row };
        expect(axialToOffset(offsetToAxial(o))).toEqual(o);
        expect(cubeToOffset(offsetToCube(o))).toEqual(o);
        const cube = axialToCube(offsetToAxial(o));
        expect(cube.q + cube.r + cube.s).toBe(0);
        expect(cubeToAxial(cube)).toEqual(offsetToAxial(o));
      }
    }
  });

  it('converts between hex index and offset', () => {
    expect(hexIndex(3, 2, 28)).toBe(59);
    expect(indexToOffset(59, 28)).toEqual({ col: 3, row: 2 });
  });
});

describe('neighbours', () => {
  it('lists directions as E, NE, NW, W, SW, SE', () => {
    expect(HEX_DIRECTIONS).toHaveLength(6);
    // even row
    expect(hexNeighbors({ col: 3, row: 2 })).toEqual([
      { col: 4, row: 2 },
      { col: 3, row: 1 },
      { col: 2, row: 1 },
      { col: 2, row: 2 },
      { col: 2, row: 3 },
      { col: 3, row: 3 },
    ]);
    // odd row
    expect(hexNeighbors({ col: 3, row: 3 })).toEqual([
      { col: 4, row: 3 },
      { col: 4, row: 2 },
      { col: 3, row: 2 },
      { col: 2, row: 3 },
      { col: 3, row: 4 },
      { col: 4, row: 4 },
    ]);
  });

  it('has opposite directions that lead back', () => {
    const start = { col: 5, row: 7 };
    for (let d = 0; d < 6; d++) {
      expect(hexNeighbor(hexNeighbor(start, d), oppositeDirection(d))).toEqual(start);
    }
  });
});

describe('distance, line, ring, range', () => {
  it('measures distance in hex steps', () => {
    expect(hexDistance({ col: 0, row: 0 }, { col: 0, row: 0 })).toBe(0);
    expect(hexDistance({ col: 0, row: 0 }, { col: 3, row: 0 })).toBe(3);
    expect(hexDistance({ col: 0, row: 0 }, { col: 0, row: 2 })).toBe(2);
    expect(hexDistance({ col: 0, row: 0 }, { col: 1, row: 2 })).toBe(2);
    expect(hexDistance({ col: 0, row: 0 }, { col: 2, row: 2 })).toBe(3);
    for (const n of hexNeighbors({ col: 4, row: 5 })) {
      expect(hexDistance({ col: 4, row: 5 }, n)).toBe(1);
    }
  });

  it('draws a line of adjacent hexes between two hexes', () => {
    const a = { col: 1, row: 1 };
    const b = { col: 6, row: 5 };
    const path = hexLine(a, b);
    expect(path).toHaveLength(hexDistance(a, b) + 1);
    expect(path[0]).toEqual(a);
    expect(path.at(-1)).toEqual(b);
    for (let i = 1; i < path.length; i++) {
      expect(hexDistance(path[i - 1] as Offset, path[i] as Offset)).toBe(1);
    }
    expect(hexLine(a, a)).toEqual([a]);
  });

  it('builds rings', () => {
    const c = { col: 5, row: 5 };
    expect(hexRing(c, 0)).toEqual([c]);
    for (const radius of [1, 2, 3]) {
      const ring = hexRing(c, radius);
      expect(ring).toHaveLength(6 * radius);
      expect(new Set(ring.map(key)).size).toBe(6 * radius);
      for (const h of ring) expect(hexDistance(c, h)).toBe(radius);
    }
  });

  it('builds ranges', () => {
    const c = { col: 5, row: 4 };
    expect(hexRange(c, 0)).toEqual([c]);
    const range = hexRange(c, 2);
    expect(range).toHaveLength(19);
    expect(new Set(range.map(key)).size).toBe(19);
    for (const h of range) expect(hexDistance(c, h)).toBeLessThanOrEqual(2);
  });
});

describe('world mapping', () => {
  it('places pointy-top hexes with odd rows shifted east and rows going south (+z)', () => {
    const w = Math.sqrt(3) * layout.size;
    expect(hexToWorld({ col: 0, row: 0 }, layout)).toEqual({ x: 10, z: -4 });
    const east = hexToWorld({ col: 1, row: 0 }, layout);
    expect(east.x).toBeCloseTo(10 + w);
    expect(east.z).toBeCloseTo(-4);
    const south = hexToWorld({ col: 0, row: 1 }, layout);
    expect(south.x).toBeCloseTo(10 + w / 2);
    expect(south.z).toBeCloseTo(-4 + 1.5 * layout.size);
    const south2 = hexToWorld({ col: 0, row: 2 }, layout);
    expect(south2.x).toBeCloseTo(10);
    expect(south2.z).toBeCloseTo(-4 + 3 * layout.size);
  });

  it('round-trips hex centres and nearby points through worldToHex', () => {
    for (let row = -3; row <= 6; row++) {
      for (let col = -3; col <= 6; col++) {
        const centre = hexToWorld({ col, row }, layout);
        expect(worldToHex(centre, layout)).toEqual({ col, row });
        expect(worldToHex({ x: centre.x + 0.6, z: centre.z - 0.5 }, layout)).toEqual({ col, row });
      }
    }
  });

  it('puts six corners at one size from the centre, corner 0 between E and NE', () => {
    const h = { col: 2, row: 3 };
    const centre = hexToWorld(h, layout);
    const corners = hexCorners(h, layout);
    expect(corners).toHaveLength(6);
    for (const c of corners) {
      expect(Math.hypot(c.x - centre.x, c.z - centre.z)).toBeCloseTo(layout.size);
    }
    const first = corners[0];
    expect(first?.x).toBeCloseTo(centre.x + (Math.sqrt(3) / 2) * layout.size);
    expect(first?.z).toBeCloseTo(centre.z - layout.size / 2);
  });
});
