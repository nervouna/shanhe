import { describe, expect, it } from 'vitest';
import {
  CityTier,
  LARGE_LABEL_ZOOM,
  PRIORITY_MARKER,
  PRIORITY_POLITICAL,
  TOWN_LABEL_ZOOM,
  cityLabelPriority,
  cityLabelShown,
  cityTier,
  declutter,
} from './labelLayout.ts';
import type { LabelBox } from './labelLayout.ts';

function box(x: number, y: number, priority: number, width = 60, height = 20): LabelBox {
  return { minX: x, minY: y, maxX: x + width, maxY: y + height, priority };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

describe('declutter', () => {
  it('shows every label when none overlap', () => {
    expect(declutter([box(0, 0, 1), box(100, 0, 1), box(0, 50, 1)])).toEqual([true, true, true]);
  });

  it('hides the lower-priority one of two overlapping labels, whatever the order', () => {
    expect(declutter([box(0, 0, 1), box(30, 5, 9)])).toEqual([false, true]);
    expect(declutter([box(30, 5, 9), box(0, 0, 1)])).toEqual([true, false]);
  });

  it('lets the earlier label win between equal priorities', () => {
    expect(declutter([box(0, 0, 5), box(10, 0, 5)])).toEqual([true, false]);
  });

  it('does not let a hidden label hide another', () => {
    // b overlaps a and c; a and c do not overlap; b loses to a, so c shows
    const a = box(0, 0, 9);
    const b = box(50, 0, 5);
    const c = box(100, 0, 1);
    expect(declutter([a, b, c], 0)).toEqual([true, false, true]);
  });

  it('keeps the padding free', () => {
    expect(declutter([box(0, 0, 2), box(62, 0, 1)], 3)).toEqual([true, false]);
    expect(declutter([box(0, 0, 2), box(62, 0, 1)], 1)).toEqual([true, true]);
  });

  it('never shows two overlapping labels in a crowd', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const boxes = Array.from({ length: 300 }, () =>
      box(random() * 800, random() * 500, Math.floor(random() * 50), 30 + random() * 80, 18),
    );
    const shown = declutter(boxes, 0);
    const kept = boxes.filter((_, i) => shown[i]);
    expect(kept.length).toBeGreaterThan(10);
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        expect(overlaps(kept[i] as LabelBox, kept[j] as LabelBox)).toBe(false);
      }
    }
    // every hidden label is blocked by a shown one that matters at least as much
    boxes.forEach((hidden, i) => {
      if (shown[i]) return;
      expect(kept.some((other) => overlaps(hidden, other) && other.priority >= hidden.priority)).toBe(true);
    });
  });

  it('skips empty rectangles', () => {
    expect(declutter([box(0, 0, 9, 0, 0), box(0, 0, 1)])).toEqual([false, true]);
  });
});

describe('city labels by distance', () => {
  it('ranks capitals above large cities above towns', () => {
    expect(cityTier(true, 1)).toBe(CityTier.Capital);
    expect(cityTier(false, 12)).toBe(CityTier.Large);
    expect(cityTier(false, 3)).toBe(CityTier.Town);
    const capital = cityLabelPriority(CityTier.Capital, 1);
    const large = cityLabelPriority(CityTier.Large, 500);
    const town = cityLabelPriority(CityTier.Town, 7);
    expect(capital).toBeGreaterThan(large);
    expect(large).toBeGreaterThan(town);
    expect(cityLabelPriority(CityTier.Town, 7)).toBeGreaterThan(cityLabelPriority(CityTier.Town, 2));
    expect(PRIORITY_POLITICAL).toBeGreaterThan(capital);
    expect(PRIORITY_MARKER).toBeGreaterThan(PRIORITY_POLITICAL);
  });

  it('thins out with distance: towns go first, then large cities, capitals last', () => {
    expect(cityLabelShown(CityTier.Town, 0.2, false)).toBe(true);
    expect(cityLabelShown(CityTier.Town, TOWN_LABEL_ZOOM + 0.01, false)).toBe(false);
    expect(cityLabelShown(CityTier.Large, TOWN_LABEL_ZOOM + 0.01, false)).toBe(true);
    expect(cityLabelShown(CityTier.Large, LARGE_LABEL_ZOOM + 0.01, false)).toBe(false);
    expect(cityLabelShown(CityTier.Capital, LARGE_LABEL_ZOOM + 0.01, false)).toBe(true);
    expect(cityLabelShown(CityTier.Capital, 1, false)).toBe(true);
  });

  it('shows no city label once the political names are shown', () => {
    for (const tier of [CityTier.Town, CityTier.Large, CityTier.Capital]) {
      expect(cityLabelShown(tier, 0.1, true)).toBe(false);
    }
  });
});
