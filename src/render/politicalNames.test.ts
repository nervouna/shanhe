import { describe, expect, it } from 'vitest';
import { worldToHex } from '../shared/hex.ts';
import type { HexLayout } from '../shared/hex.ts';
import { MAX_NAME_ANGLE, fitName, placePoliticalNames } from './politicalNames.ts';
import type { NamePlacement } from './politicalNames.ts';

const layout: HexLayout = { size: 1, originX: 0, originZ: 0 };
const WIDTH = 30;
const HEIGHT = 24;

/** A map where `paint(col, row)` gives the owner of each hex, -1 for none. */
function owners(paint: (col: number, row: number) => number): Int16Array {
  const owner = new Int16Array(WIDTH * HEIGHT);
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) owner[row * WIDTH + col] = paint(col, row);
  }
  return owner;
}

function ownerAt(owner: Int16Array, x: number, z: number): number {
  const hex = worldToHex({ x, z }, layout);
  if (hex.col < 0 || hex.col >= WIDTH || hex.row < 0 || hex.row >= HEIGHT) return -1;
  return owner[hex.row * WIDTH + hex.col] as number;
}

/** Checks that the written name lies on the polity's own ground. */
function expectInside(owner: Int16Array, placement: NamePlacement, aspect: number): void {
  const { width, height } = fitName(placement, aspect);
  const dx = Math.cos(placement.angle);
  const dz = Math.sin(placement.angle);
  for (const along of [-0.5, -0.25, 0, 0.25, 0.5]) {
    for (const across of [-0.5, 0, 0.5]) {
      const x = placement.x + dx * along * width - dz * across * height;
      const z = placement.z + dz * along * width + dx * across * height;
      expect(ownerAt(owner, x, z), `point ${along}, ${across}`).toBe(placement.polity);
    }
  }
}

describe('placePoliticalNames', () => {
  it('writes along a wide territory, level and centred', () => {
    const owner = owners((col, row) => (col >= 4 && col < 24 && row >= 8 && row < 13 ? 0 : -1));
    const [placement] = placePoliticalNames(WIDTH, HEIGHT, owner, layout);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.polity).toBe(0);
    expect(placement.hexes).toBe(20 * 5);
    expect(Math.abs(placement.angle)).toBeLessThan(0.1);
    // 20 hexes of width sqrt(3): the strip takes most of it
    expect(placement.length).toBeGreaterThan(20 * Math.sqrt(3) * 0.8);
    expect(placement.length).toBeLessThanOrEqual(20 * Math.sqrt(3) + 0.01);
    expect(placement.x).toBeCloseTo(((4 + 23) / 2) * Math.sqrt(3), -1);
    expectInside(owner, placement, 3);
    expectInside(owner, placement, 8);
    const fitted = fitName(placement, 3);
    expect(fitted.width / fitted.height).toBeCloseTo(3);
    expect(fitted.height).toBeGreaterThan(2);
  });

  it('tilts the name along a diagonal territory', () => {
    // a band running from the north-west to the south-east
    const owner = owners((col, row) => (Math.abs(col * Math.sqrt(3) - row * 1.5 * 1.2 - 4) < 5 ? 3 : -1));
    const [placement] = placePoliticalNames(WIDTH, HEIGHT, owner, layout);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.polity).toBe(3);
    expect(placement.angle).toBeGreaterThan(0.3);
    expect(placement.angle).toBeLessThanOrEqual(MAX_NAME_ANGLE);
    expectInside(owner, placement, 4);
  });

  it('never tilts past the limit, even for a territory that runs north to south', () => {
    const owner = owners((col, row) => (col >= 10 && col < 14 && row >= 2 && row < 22 ? 1 : -1));
    const [placement] = placePoliticalNames(WIDTH, HEIGHT, owner, layout);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(Math.abs(placement.angle)).toBeLessThanOrEqual(MAX_NAME_ANGLE + 1e-9);
    expectInside(owner, placement, 2);
  });

  it('keeps the name inside an L-shaped territory, whose centroid is outside it', () => {
    const owner = owners((col, row) => {
      const upright = col >= 3 && col < 7 && row >= 2 && row < 20;
      const foot = col >= 3 && col < 26 && row >= 16 && row < 20;
      return upright || foot ? 2 : -1;
    });
    const [placement] = placePoliticalNames(WIDTH, HEIGHT, owner, layout);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(ownerAt(owner, placement.x, placement.z)).toBe(2);
    expectInside(owner, placement, 3);
  });

  it('uses the largest piece of a territory in several pieces', () => {
    const owner = owners((col, row) => {
      if (col >= 1 && col < 4 && row >= 1 && row < 4) return 5; // an exclave of 9
      if (col >= 12 && col < 24 && row >= 10 && row < 18) return 5; // the mainland
      return -1;
    });
    const [placement] = placePoliticalNames(WIDTH, HEIGHT, owner, layout);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.hexes).toBe(12 * 8);
    expect(placement.x).toBeGreaterThan(12 * Math.sqrt(3));
    expectInside(owner, placement, 3);
  });

  it('gives one placement per polity that owns land, in polity order, and none for the others', () => {
    const owner = owners((col) => (col < 10 ? 4 : col < 20 ? 1 : -2));
    const placements = placePoliticalNames(WIDTH, HEIGHT, owner, layout);
    expect(placements.map((p) => p.polity)).toEqual([1, 4]);
    for (const placement of placements) expectInside(owner, placement, 2);
    expect(placePoliticalNames(WIDTH, HEIGHT, owners(() => -1), layout)).toEqual([]);
  });

  it('copes with a territory of one hex', () => {
    const owner = owners((col, row) => (col === 5 && row === 5 ? 0 : -1));
    const [placement] = placePoliticalNames(WIDTH, HEIGHT, owner, layout);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.hexes).toBe(1);
    expect(ownerAt(owner, placement.x, placement.z)).toBe(0);
    expect(placement.length).toBeGreaterThan(0);
    expect(placement.height).toBeGreaterThan(0);
  });
});
