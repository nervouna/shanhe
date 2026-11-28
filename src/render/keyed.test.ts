import { describe, expect, it } from 'vitest';
import { PartShape } from './cityGen.ts';
import type { Part } from './cityGen.ts';
import { createKeyedCache, createPartRegions } from './keyed.ts';

interface Item {
  readonly id: number;
  readonly size: number;
}

describe('createKeyedCache', () => {
  const make = () => {
    const built: number[] = [];
    const cache = createKeyedCache<Item, string>(
      (item) => item.id,
      (item) => String(item.size),
      (item) => {
        built.push(item.id);
        return `${item.id}x${item.size}`;
      },
    );
    return { cache, built };
  };

  it('builds every item the first time and nothing when the same items come again', () => {
    const { cache, built } = make();
    const items = [1, 2, 3].map((id) => ({ id, size: 5 }));
    expect(cache.update(items)).toEqual({ built: [1, 2, 3], removed: [] });
    expect(cache.update(items.map((item) => ({ ...item })))).toEqual({ built: [], removed: [] });
    expect(built).toEqual([1, 2, 3]);
    expect(cache.builds).toBe(3);
    expect(cache.get(2)).toBe('2x5');
  });

  it('builds only the item whose key changed', () => {
    const { cache, built } = make();
    cache.update([1, 2, 3].map((id) => ({ id, size: 5 })));
    built.length = 0;
    expect(cache.update([{ id: 1, size: 5 }, { id: 2, size: 6 }, { id: 3, size: 5 }])).toEqual({ built: [2], removed: [] });
    expect(built).toEqual([2]);
    expect(cache.get(2)).toBe('2x6');
    expect(cache.get(1)).toBe('1x5');
  });

  it('reports what went, and builds an item again when it comes back', () => {
    const { cache } = make();
    cache.update([1, 2, 3].map((id) => ({ id, size: 5 })));
    expect(cache.update([{ id: 1, size: 5 }])).toEqual({ built: [], removed: [2, 3] });
    expect(cache.get(2)).toBeUndefined();
    expect(cache.size).toBe(1);
    expect(cache.update([{ id: 1, size: 5 }, { id: 2, size: 5 }])).toEqual({ built: [2], removed: [] });
    expect(cache.builds).toBe(4);
  });

  it('takes the later of two items with one id, and string ids', () => {
    const cache = createKeyedCache<string, number, string>(
      (name) => name,
      () => '',
      (name) => name.length,
    );
    expect(cache.update(['road', 'rail', 'road'])).toEqual({ built: ['road', 'rail'], removed: [] });
    expect(cache.update(['rail'])).toEqual({ built: [], removed: ['road'] });
    expect(cache.get('rail')).toBe(4);
  });
});

function part(x: number, z: number, shape: Part['shape'] = PartShape.Box): Part {
  return { shape, x, y: 0, z, w: 1, h: 1, d: 1, yaw: 0, color: 0xffffff };
}

describe('createPartRegions', () => {
  it('names the region of a changed item and leaves the others alone', () => {
    const regions = createPartRegions(10);
    // three items in three regions
    expect(regions.apply([[1, [part(1, 1), part(2, 2, PartShape.Hip)]], [2, [part(15, 1)]], [3, [part(1, 25)]]]).sort()).toEqual(
      ['0:0', '0:2', '1:0'],
    );
    expect(regions.count).toBe(4);
    expect(regions.regions).toBe(3);
    // nothing changes: nothing is dirty
    expect(regions.apply([])).toEqual([]);
    // one item changes: its region only
    expect(regions.apply([[2, [part(15, 1), part(16, 1)]]])).toEqual(['1:0']);
    expect(regions.count).toBe(5);
    expect(regions.byShape('1:0')[PartShape.Box]).toHaveLength(2);
    expect(regions.byShape('0:0')[PartShape.Hip]).toHaveLength(1);
  });

  it('keeps an item whole in the region of its first part, and shares a region between items', () => {
    const regions = createPartRegions(10);
    regions.apply([[1, [part(9, 9), part(11, 9)]], [2, [part(3, 3)]]]);
    expect(regions.regions).toBe(1);
    expect(regions.byShape('0:0')[PartShape.Box]).toHaveLength(3);
    // taking one away dirties the region both stand in, and the other stays
    expect(regions.apply([[1, null]])).toEqual(['0:0']);
    expect(regions.byShape('0:0')[PartShape.Box]).toHaveLength(1);
    expect(regions.count).toBe(1);
  });

  it('dirties both regions when an item moves, and forgets an empty region', () => {
    const regions = createPartRegions(10);
    regions.apply([[1, [part(1, 1)]]]);
    expect(regions.apply([[1, [part(31, 1)]]]).sort()).toEqual(['0:0', '3:0']);
    expect(regions.regions).toBe(1);
    expect(regions.byShape('0:0').every((list) => list.length === 0)).toBe(true);
    // an item without parts is gone
    expect(regions.apply([[1, []]])).toEqual(['3:0']);
    expect(regions.count).toBe(0);
    expect(regions.regions).toBe(0);
  });
});
