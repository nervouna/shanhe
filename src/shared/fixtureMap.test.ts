import { describe, expect, it } from 'vitest';
import { createFixtureMap } from './fixtureMap.ts';
import { hexNeighbor, hexNeighbors, indexToOffset, oppositeDirection, hexIndex } from './hex.ts';
import {
  Feature,
  NO_RESOURCE,
  NO_ZONE,
  OWNER_OFF_MAP,
  OWNER_SEA,
  OWNER_UNOWNED,
  Terrain,
  isWaterTerrain,
} from './mapData.ts';
import type { MapData } from './mapData.ts';

const map = createFixtureMap();
const count = map.width * map.height;

function inPlayArea(m: MapData, i: number): boolean {
  return m.owner[i] !== OWNER_OFF_MAP;
}
function isLand(m: MapData, i: number): boolean {
  return !isWaterTerrain(m.terrain[i] as number);
}

describe('fixture map', () => {
  it('is deterministic', () => {
    expect(createFixtureMap()).toEqual(map);
  });

  it('is about 28 x 18 with all per-hex arrays sized width * height', () => {
    expect(map.width).toBe(28);
    expect(map.height).toBe(18);
    for (const layer of [
      map.terrain,
      map.hills,
      map.feature,
      map.elevation,
      map.owner,
      map.zone,
      map.riverEdges,
      map.resource,
    ]) {
      expect(layer.length).toBe(count);
    }
  });

  it('has 4 nations of 1-3 zones, 1 city-state and 1 wasteland region', () => {
    const kinds = map.polities.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'nation')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'cityState')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'wastelandRegion')).toHaveLength(1);

    map.polities.forEach((polity, p) => {
      const zones = map.zones.filter((z) => z.polity === p);
      if (polity.kind === 'nation') {
        expect(zones.length).toBeGreaterThanOrEqual(1);
        expect(zones.length).toBeLessThanOrEqual(3);
      } else {
        expect(zones.length).toBe(1);
      }
      if (polity.kind === 'wastelandRegion') {
        expect(polity.capitalZone).toBe(NO_ZONE);
        expect(zones.every((z) => !z.capital)).toBe(true);
      } else {
        // exactly one capital zone, and it is the one the polity names
        expect(zones.filter((z) => z.capital)).toHaveLength(1);
        expect(map.zones[polity.capitalZone]?.polity).toBe(p);
        expect(map.zones[polity.capitalZone]?.capital).toBe(true);
      }
    });
    expect(new Set(map.polities.map((p) => p.id)).size).toBe(map.polities.length);
    expect(new Set(map.zones.map((z) => z.id)).size).toBe(map.zones.length);
    expect(new Set(map.zones.map((z) => z.polity)).size).toBeGreaterThan(1);
  });

  it('gives every land hex inside the play area an owner and a zone', () => {
    let landInPlay = 0;
    for (let i = 0; i < count; i++) {
      if (!inPlayArea(map, i) || !isLand(map, i)) continue;
      landInPlay++;
      const zone = map.zone[i] as number;
      const owner = map.owner[i] as number;
      expect(zone).toBeGreaterThanOrEqual(0);
      expect(zone).toBeLessThan(map.zones.length);
      const polityIndex = map.zones[zone]!.polity;
      const polity = map.polities[polityIndex]!;
      if (polity.kind === 'wastelandRegion') {
        // wasteland starts without an owner; the zone names the region
        expect(owner).toBe(OWNER_UNOWNED);
      } else {
        expect(owner).toBe(polityIndex);
      }
    }
    expect(landInPlay).toBeGreaterThan(200);
  });

  it('gives water and off-map hexes no zone and the right sentinel', () => {
    let sea = 0;
    let offMap = 0;
    for (let i = 0; i < count; i++) {
      const owner = map.owner[i] as number;
      if (owner === OWNER_OFF_MAP) {
        offMap++;
        expect(map.zone[i]).toBe(NO_ZONE);
      } else if (!isLand(map, i)) {
        sea++;
        expect(owner).toBe(OWNER_SEA);
        expect(map.zone[i]).toBe(NO_ZONE);
      } else {
        expect(owner).not.toBe(OWNER_SEA);
      }
    }
    expect(sea).toBeGreaterThan(20);
    expect(offMap).toBeGreaterThan(20);
  });

  it('gives every zone a site hex it owns', () => {
    const sites = new Set<number>();
    map.zones.forEach((zone, z) => {
      expect(zone.siteHex).toBeGreaterThanOrEqual(0);
      expect(zone.siteHex).toBeLessThan(count);
      expect(map.zone[zone.siteHex]).toBe(z);
      expect(isLand(map, zone.siteHex)).toBe(true);
      expect(map.terrain[zone.siteHex]).not.toBe(Terrain.Mountain);
      const polity = map.polities[zone.polity]!;
      expect(map.owner[zone.siteHex]).toBe(
        polity.kind === 'wastelandRegion' ? OWNER_UNOWNED : zone.polity,
      );
      sites.add(zone.siteHex);
    });
    expect(sites.size).toBe(map.zones.length);
  });

  it('respects the size rules: nations at least 7 hexes, city-states 1-3', () => {
    const size = new Array<number>(map.polities.length).fill(0);
    for (let i = 0; i < count; i++) {
      const zone = map.zone[i] as number;
      if (zone >= 0) size[map.zones[zone]!.polity]!++;
    }
    map.polities.forEach((polity, p) => {
      if (polity.kind === 'nation') expect(size[p]).toBeGreaterThanOrEqual(7);
      if (polity.kind === 'cityState') {
        expect(size[p]).toBeGreaterThanOrEqual(1);
        expect(size[p]).toBeLessThanOrEqual(3);
      }
    });
  });

  it('has an off-map strip with exactly one land port on its edge', () => {
    expect(map.offMapPorts).toHaveLength(1);
    const port = map.offMapPorts[0]!;
    expect(port.kind).toBe('land');
    expect(map.owner[port.hex]).toBe(OWNER_OFF_MAP);
    expect(isLand(map, port.hex)).toBe(true);
    const touchesPlayArea = hexNeighbors(indexToOffset(port.hex, map.width)).some(
      (n) =>
        n.col >= 0 &&
        n.col < map.width &&
        n.row >= 0 &&
        n.row < map.height &&
        inPlayArea(map, hexIndex(n.col, n.row, map.width)),
    );
    expect(touchesPlayArea).toBe(true);
  });

  it('has a river whose edges are marked on both sides', () => {
    let edges = 0;
    for (let i = 0; i < count; i++) {
      const mask = map.riverEdges[i] as number;
      expect(mask & ~0b111111).toBe(0);
      if (mask === 0) continue;
      const here = indexToOffset(i, map.width);
      for (let d = 0; d < 6; d++) {
        if ((mask & (1 << d)) === 0) continue;
        edges++;
        const n = hexNeighbor(here, d);
        expect(n.col >= 0 && n.col < map.width && n.row >= 0 && n.row < map.height).toBe(true);
        const other = map.riverEdges[hexIndex(n.col, n.row, map.width)] as number;
        expect(other & (1 << oppositeDirection(d))).not.toBe(0);
      }
    }
    expect(edges).toBeGreaterThanOrEqual(8);
  });

  it('uses valid terrain, feature and resource codes', () => {
    const terrains = new Set<number>(Object.values(Terrain));
    const features = new Set<number>(Object.values(Feature));
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) {
      expect(terrains.has(map.terrain[i] as number)).toBe(true);
      expect(features.has(map.feature[i] as number)).toBe(true);
      expect([0, 1]).toContain(map.hills[i]);
      const resource = map.resource[i] as number;
      expect(resource === NO_RESOURCE || (resource >= 0 && resource < map.resources.length)).toBe(true);
      if (!isLand(map, i)) {
        expect(map.hills[i]).toBe(0);
        expect(map.elevation[i]).toBeLessThanOrEqual(map.terrain[i] === Terrain.Lake ? 32767 : 0);
      }
      seen.add(map.terrain[i] as number);
    }
    expect(seen.has(Terrain.Ocean)).toBe(true);
    expect(seen.has(Terrain.Coast)).toBe(true);
  });
});
