import { describe, expect, it } from 'vitest';
import { hexIndex, hexNeighbor, indexToOffset, oppositeDirection } from './hex.ts';
import { NO_ZONE, OWNER_OFF_MAP, OWNER_SEA, OWNER_UNOWNED, Terrain, isWaterTerrain, parseMapData, serializeMapData } from './mapData.ts';
import { createSyntheticMap } from './syntheticMap.ts';

describe('synthetic map', () => {
  const map = createSyntheticMap();
  const count = map.width * map.height;

  it('is deterministic and varies with the seed', () => {
    const again = createSyntheticMap();
    expect(again.terrain).toEqual(map.terrain);
    expect(again.zone).toEqual(map.zone);
    expect(again.zones).toEqual(map.zones);
    expect(createSyntheticMap({ seed: 2 }).terrain).not.toEqual(map.terrain);
  });

  it('is 160 x 110 with 64 polities of every kind by default', () => {
    expect(map.width).toBe(160);
    expect(map.height).toBe(110);
    for (const layer of [map.terrain, map.hills, map.feature, map.elevation, map.owner, map.zone, map.riverEdges, map.resource]) {
      expect(layer).toHaveLength(count);
    }
    expect(map.polities).toHaveLength(64);
    const kinds = map.polities.map((polity) => polity.kind);
    expect(kinds.filter((kind) => kind === 'nation').length).toBeGreaterThanOrEqual(50);
    expect(kinds.filter((kind) => kind === 'cityState').length).toBeGreaterThanOrEqual(4);
    expect(kinds.filter((kind) => kind === 'wastelandRegion').length).toBeGreaterThanOrEqual(3);
    expect(new Set(map.polities.map((polity) => polity.id)).size).toBe(64);
  });

  it('gives every land hex inside the play area an owner and a zone, and no zone to the rest', () => {
    for (let i = 0; i < count; i++) {
      const owner = map.owner[i]!;
      const zone = map.zone[i]!;
      const water = isWaterTerrain(map.terrain[i]!);
      if (owner === OWNER_OFF_MAP || water) {
        if (zone !== NO_ZONE) throw new Error(`hex ${i} is water or off-map but has a zone`);
        if (water && owner !== OWNER_OFF_MAP && owner !== OWNER_SEA) throw new Error(`water hex ${i} has an owner`);
        continue;
      }
      if (zone < 0) throw new Error(`land hex ${i} has no zone`);
      const polity = map.zones[zone]!.polity;
      const expected = map.polities[polity]!.kind === 'wastelandRegion' ? OWNER_UNOWNED : polity;
      if (owner !== expected) throw new Error(`hex ${i}: owner ${owner}, expected ${expected}`);
    }
  });

  it('gives every zone a flat, open site inside itself, and every polity the right zones', () => {
    map.zones.forEach((zone, z) => {
      expect(map.zone[zone.siteHex]).toBe(z);
      expect(map.hills[zone.siteHex]).toBe(0);
      expect(map.feature[zone.siteHex]).toBe(0);
      expect(map.terrain[zone.siteHex]).not.toBe(Terrain.Mountain);
    });
    expect(new Set(map.zones.map((zone) => zone.siteHex)).size).toBe(map.zones.length);
    map.polities.forEach((polity, p) => {
      const zones = map.zones.filter((zone) => zone.polity === p);
      const capitals = zones.filter((zone) => zone.capital);
      if (polity.kind === 'wastelandRegion') {
        expect(polity.capitalZone).toBe(NO_ZONE);
        expect(capitals).toHaveLength(0);
      } else {
        expect(capitals).toHaveLength(1);
        expect(map.zones[polity.capitalZone]).toBe(capitals[0]);
      }
      if (polity.kind === 'nation') {
        expect(zones.length).toBeGreaterThanOrEqual(1);
        expect(zones.length).toBeLessThanOrEqual(4);
      }
      if (polity.kind === 'cityState') expect(zones).toHaveLength(1);
    });
  });

  it('respects the size rules: nations at least 7 hexes, city-states 1-3', () => {
    const hexes = map.polities.map(() => 0);
    for (let i = 0; i < count; i++) {
      const zone = map.zone[i]!;
      if (zone !== NO_ZONE) hexes[map.zones[zone]!.polity]!++;
    }
    map.polities.forEach((polity, p) => {
      if (polity.kind === 'nation') expect(hexes[p]).toBeGreaterThanOrEqual(7);
      if (polity.kind === 'cityState') {
        expect(hexes[p]).toBeGreaterThanOrEqual(1);
        expect(hexes[p]).toBeLessThanOrEqual(3);
      }
    });
  });

  it('marks river edges on both sides and has sea, coast, lakes and mountains', () => {
    let rivers = 0;
    for (let i = 0; i < count; i++) {
      const edges = map.riverEdges[i]!;
      if (edges === 0) continue;
      rivers++;
      for (let d = 0; d < 6; d++) {
        if ((edges & (1 << d)) === 0) continue;
        const n = hexNeighbor(indexToOffset(i, map.width), d);
        expect(map.riverEdges[hexIndex(n.col, n.row, map.width)]! & (1 << oppositeDirection(d))).not.toBe(0);
      }
    }
    expect(rivers).toBeGreaterThan(100);
    for (const terrain of [Terrain.Ocean, Terrain.Coast, Terrain.Lake, Terrain.Mountain, Terrain.Plains, Terrain.Tundra]) {
      expect(map.terrain).toContain(terrain);
    }
  });

  it('survives the map file format', () => {
    const { json, buffers } = serializeMapData(map);
    const parsed = parseMapData(json, buffers);
    expect(parsed.owner).toEqual(map.owner);
    expect(parsed.zones).toEqual(map.zones);
  });

  it('can be made smaller', () => {
    const small = createSyntheticMap({ width: 60, height: 40, polities: 8 });
    expect(small.width).toBe(60);
    expect(small.polities).toHaveLength(8);
    expect(() => createSyntheticMap({ width: 20, height: 20, polities: 64 })).toThrow();
  });
});
