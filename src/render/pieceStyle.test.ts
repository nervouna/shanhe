import { describe, expect, it } from 'vitest';
import {
  ERA_MATERIALS,
  FACE,
  GOLD,
  GOLD_FIELD,
  KEYLINE_DARK,
  KEYLINE_PALE,
  contrast,
  glyphContrast,
  keylineFor,
  luminance,
} from './pieceStyle.ts';
import { loadRealMap } from './realMapForTests.ts';

describe('contrast', () => {
  it('follows the WCAG definition', () => {
    expect(luminance(0x000000)).toBe(0);
    expect(luminance(0xffffff)).toBeCloseTo(1, 6);
    expect(contrast(0x000000, 0xffffff)).toBeCloseTo(21, 6);
    expect(contrast(0x777777, 0x777777)).toBe(1);
    // the usual reference pair: #767676 on white is just over 4.5
    expect(contrast(0x767676, 0xffffff)).toBeGreaterThan(4.5);
    expect(contrast(0x777777, 0xffffff)).toBeLessThan(4.5);
  });
});

describe('the character of a piece', () => {
  it('has a contrast of at least 4.5 with every era material, at the darkest and the brightest grain', () => {
    expect(ERA_MATERIALS).toHaveLength(6);
    ERA_MATERIALS.forEach((_, era) => {
      expect(glyphContrast(era, false), `era ${era}`).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('has a contrast of at least 4.5 when it is gold, on every material', () => {
    // gold on bare pottery, bronze, jade, brass or steel would fail: that is what the dark field is for
    expect(contrast(GOLD, ERA_MATERIALS[0]!.body)).toBeLessThan(4.5);
    ERA_MATERIALS.forEach((_, era) => {
      expect(glyphContrast(era, true), `era ${era}`).toBeGreaterThanOrEqual(4.5);
    });
    expect(contrast(GOLD, GOLD_FIELD)).toBeGreaterThanOrEqual(7);
  });

  it('fits into its field, inside the owner’s ring', () => {
    // the corners of the square stay inside the circle of the field
    expect(FACE.glyphHalf * Math.SQRT2).toBeLessThan(FACE.ringInner);
    expect(FACE.fieldEdge).toBeLessThan(FACE.ringInner);
    expect(FACE.ringInner).toBeLessThan(FACE.ringOuter);
    expect(FACE.ringOuter + FACE.outerLine).toBeLessThanOrEqual(FACE.ticksInner);
    expect(FACE.ringOuterMarker + FACE.outerLineMarker).toBeLessThanOrEqual(0.9);
    // the ring is broad: a seventh of the radius near, a fifth as a marker
    expect(FACE.ringOuter - FACE.ringInner).toBeGreaterThanOrEqual(0.15);
    expect(FACE.ringOuterMarker - FACE.ringInner).toBeGreaterThanOrEqual(0.2);
  });
});

describe('the owner’s ring', () => {
  it('is set off by lines with a contrast of at least 3 against the colour of every polity of the real map', async () => {
    const { map } = await loadRealMap();
    expect(map.polities.length).toBeGreaterThan(50);
    for (const polity of map.polities) {
      const line = keylineFor(polity.color);
      expect([KEYLINE_DARK, KEYLINE_PALE]).toContain(line);
      // the ring against the line beside it: also the line between a piece and ground filled with its own colour
      expect(contrast(polity.color, line), polity.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('is set off against any colour at all', () => {
    for (let grey = 0; grey <= 255; grey += 5) {
      const color = (grey << 16) | (grey << 8) | grey;
      expect(contrast(color, keylineFor(color))).toBeGreaterThanOrEqual(3);
    }
    for (const color of [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff, 0x101060, 0x602010]) {
      expect(contrast(color, keylineFor(color))).toBeGreaterThanOrEqual(3);
    }
  });
});
