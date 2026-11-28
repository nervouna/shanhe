import { describe, expect, it } from 'vitest';
import { loadRealMap } from './realMapForTests.ts';

describe('the committed map', () => {
  it('loads with its heightmap', async () => {
    const { map, heightmap } = await loadRealMap();
    expect(map.width * map.height).toBe(map.terrain.length);
    expect(heightmap.length).toBe(map.heightmap.width * map.heightmap.height);
  });
});
