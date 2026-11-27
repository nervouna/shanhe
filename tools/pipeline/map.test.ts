/**
 * Tests on the committed map in `public/data/`, and on the checks that guard
 * it. They need no downloaded data.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../../src/shared/fixtureMap.ts';
import { hexDistance, hexNeighbor, hexToWorld, indexToOffset } from '../../src/shared/hex.ts';
import { NO_ZONE, OWNER_SEA, OWNER_UNOWNED, Terrain, isWaterTerrain } from '../../src/shared/mapData.ts';
import type { MapData } from '../../src/shared/mapData.ts';
import { GRID_HEIGHT, GRID_WIDTH } from './config.ts';
import { MAP_DIR, loadMap } from './loadMap.ts';
import { createMapping } from './mapping.ts';
import { POLITIES } from './polities.ts';
import { RULES, countRivers, reachableInZone, validateMap } from './validate.ts';

const { map, heightmapBytes, totalBytes } = loadMap();
const mapping = createMapping();

/** The polity id of the hex that shows a place, or a word for what else is there. */
function polityAt(lon: number, lat: number): string {
  const hex = mapping.lonLatToHex(lon, lat);
  if (hex.col < 0 || hex.col >= map.width || hex.row < 0 || hex.row >= map.height) return 'outside the frame';
  const index = hex.row * map.width + hex.col;
  const zone = map.zones[map.zone[index] as number];
  if (zone === undefined) return isWaterTerrain(map.terrain[index] as number) ? 'water' : 'off-map';
  return map.polities[zone.polity]!.id;
}

describe('the committed map', () => {
  it('was built with the configuration in this repository', () => {
    expect(map.width).toBe(GRID_WIDTH);
    expect(map.height).toBe(GRID_HEIGHT);
    expect(map.projection).toEqual(mapping.projection);
    expect(map.polities.map((p) => p.id)).toEqual(POLITIES.map((p) => p.id));
  });

  it('passes every check of pipeline:check', () => {
    expect(validateMap(map).errors).toEqual([]);
  });

  it('has 50 nations, 10 city-states and 4 wasteland regions with the names of the design docs', () => {
    const names = (kind: string): string[] =>
      map.polities.filter((p) => p.kind === kind).map((p) => p.nameZh);
    expect(names('nation')).toHaveLength(50);
    expect(names('cityState')).toEqual(['香江', '濠镜', '申', '津门', '淡马锡', '汶莱', '底门', '耽罗', '对马', '沙州']);
    expect(names('wastelandRegion')).toEqual(['西域', '坚昆', '极北', '流鬼']);
    for (const zh of ['燕', '蜀', '吐蕃', '漠北', '高丽', '大和', '暹罗', '阇婆', '琉球', '美洛居']) {
      expect(names('nation')).toContain(zh);
    }
  });

  it('shows known cities in the right polity', () => {
    const cases: [string, number, number, string][] = [
      ['Chengdu', 104.07, 30.57, 'shu'],
      ['Tokyo', 139.69, 35.69, 'togoku'],
      ['Singapore', 103.82, 1.35, 'temasek'],
      ['Lhasa', 91.13, 29.65, 'tubo'],
      ['Jakarta', 106.85, -6.21, 'shepo'],
      ['Beijing', 116.4, 39.9, 'yan'],
      ['Hong Kong', 114.17, 22.32, 'xiangjiang'],
      ['Macau', 113.55, 22.16, 'haojing'],
      ['Shanghai', 121.47, 31.23, 'shen'],
      ['Urumqi', 87.62, 43.83, 'xiyu'],
      ['Yakutsk', 129.73, 62.03, 'jibei'],
      ['Ulaanbaatar', 106.92, 47.92, 'mobei'],
      ['Pyongyang', 125.75, 39.03, 'goryeo'],
      ['Kyoto', 135.77, 35.01, 'yamato'],
      ['Hanoi', 105.85, 21.03, 'jiaozhi'],
      ['Taipei', 121.56, 25.03, 'dongning'],
      ['Irkutsk', 104.28, 52.29, 'beihai'],
      ['Chiang Mai', 98.98, 18.79, 'siam'],
      ['Manila', 120.98, 14.6, 'luzon'],
      ['Naha', 127.68, 26.21, 'ryukyu'],
      ['Dunhuang', 94.66, 40.14, 'shazhou'],
      ['Delhi', 77.2, 28.6, 'off-map'],
      ['Almaty', 76.9, 43.25, 'off-map'],
      ['Sorong', 131.25, -0.88, 'off-map'],
      ['Kathmandu', 85.3, 27.7, 'off-map'],
      ['Port Moresby', 147.15, -9.45, 'outside the frame'],
    ];
    for (const [name, lon, lat, polity] of cases) {
      expect(`${name}: ${polityAt(lon, lat)}`).toBe(`${name}: ${polity}`);
    }
  });

  it('puts every city site on the hex of the real city or on the next one', () => {
    // a coastal city can lie in a hex whose centre is at sea; its site is then the nearest land
    let zone = 0;
    POLITIES.forEach((spec, p) => {
      const sites = map.zones.filter((z) => z.polity === p);
      sites.forEach((site, k) => {
        expect(map.zones[zone++]).toBe(site);
        const [zh, en, lon, lat] = spec.cities[k]!;
        expect(site.cityNameZh).toBe(zh);
        expect(site.cityNameEn).toBe(en);
        const steps = hexDistance(mapping.lonLatToHex(lon, lat), indexToOffset(site.siteHex, map.width));
        expect(`${en} ${steps <= 1}`).toBe(`${en} true`);
      });
    });
    expect(zone).toBe(map.zones.length);
  });

  it('keeps every zone in one piece around a site it owns', () => {
    map.zones.forEach((zone, z) => {
      const polity = map.polities[zone.polity]!;
      expect(map.zone[zone.siteHex]).toBe(z);
      expect(map.owner[zone.siteHex]).toBe(polity.kind === 'wastelandRegion' ? OWNER_UNOWNED : zone.polity);
      const size = map.zone.filter((v) => v === z).length;
      expect(`${zone.id} ${reachableInZone(map, z, zone.siteHex, RULES.maxSeaGap).size}`).toBe(
        `${zone.id} ${size}`,
      );
    });
  });

  it('joins zones over land, except in the polities that own islands', () => {
    // archipelagos, and Siberian regions with Arctic or Pacific islands
    const insular = new Set([
      'ezo', 'ryukyu', 'srivijaya', 'shepo', 'boni', 'luzon', 'sulu', 'maluku', 'jibei', 'liugui',
    ]);
    map.zones.forEach((zone, z) => {
      const id = map.polities[zone.polity]!.id;
      if (insular.has(id)) return;
      const size = map.zone.filter((v) => v === z).length;
      expect(`${zone.id} ${reachableInZone(map, z, zone.siteHex, 0).size}`).toBe(`${zone.id} ${size}`);
    });
  });

  it('has a heightmap file of the described size, and stays under 25 MB', () => {
    expect(heightmapBytes).toBe(map.heightmap.width * map.heightmap.height * 2);
    expect(map.heightmap.width).toBeLessThanOrEqual(4096);
    expect(totalBytes).toBeLessThanOrEqual(25 * 1024 * 1024);
  });

  it('has a heightmap that covers the grid and shows places at their height, through the warp', () => {
    const h = map.heightmap;
    const layout = map.projection.hexLayout;
    const last = hexToWorld({ col: map.width - 1, row: map.height - 1 }, layout);
    expect(h.world.minX).toBeLessThanOrEqual(layout.originX - Math.sqrt(3) / 2 + 1e-9);
    expect(h.world.minZ).toBeLessThanOrEqual(layout.originZ - 1 + 1e-9);
    expect(h.world.maxX).toBeGreaterThanOrEqual(last.x + Math.sqrt(3) / 2 - 1e-9);
    expect(h.world.maxZ).toBeGreaterThanOrEqual(last.z + 1 - 1e-9);

    const heights = new DataView(readFileSync(join(MAP_DIR, h.file)).buffer);
    const metresAt = (lon: number, lat: number): number => {
      const km = mapping.lonLatToMap(lon, lat);
      const x = km.x / map.projection.kmPerWorldUnit;
      const z = km.z / map.projection.kmPerWorldUnit;
      const i = Math.round(((x - h.world.minX) / (h.world.maxX - h.world.minX)) * (h.width - 1));
      const j = Math.round(((z - h.world.minZ) / (h.world.maxZ - h.world.minZ)) * (h.height - 1));
      return h.baseMetres + heights.getUint16((j * h.width + i) * 2, true) * h.metresPerUnit;
    };
    expect(metresAt(86.93, 27.99)).toBeGreaterThan(6000); // Everest
    expect(metresAt(90.0, 33.0)).toBeGreaterThan(4500); // Changtang plateau
    expect(metresAt(89.3, 42.6)).toBeLessThan(100); // Turpan depression
    expect(metresAt(105.0, 30.5)).toBeLessThan(700); // Sichuan basin
    expect(metresAt(105.0, 30.5)).toBeGreaterThan(200);
    expect(metresAt(142.4, 11.35)).toBeLessThan(-8000); // Mariana Trench
    expect(metresAt(127.9, 26.45)).toBeGreaterThan(0); // Okinawa, inside the strongest lens
    expect(metresAt(125.0, 22.0)).toBeLessThan(-3000); // Philippine Sea
  });

  it('gives hexes the elevation the heightmap shows at their centre', () => {
    const h = map.heightmap;
    const heights = new DataView(readFileSync(join(MAP_DIR, h.file)).buffer);
    let compared = 0;
    let close = 0;
    for (let i = 0; i < map.terrain.length; i += 7) {
      if (isWaterTerrain(map.terrain[i]!) || map.hills[i] === 1 || map.terrain[i] === Terrain.Mountain) continue;
      const c = hexToWorld(indexToOffset(i, map.width), map.projection.hexLayout);
      const col = Math.round(((c.x - h.world.minX) / (h.world.maxX - h.world.minX)) * (h.width - 1));
      const row = Math.round(((c.z - h.world.minZ) / (h.world.maxZ - h.world.minZ)) * (h.height - 1));
      const metres = h.baseMetres + heights.getUint16((row * h.width + col) * 2, true) * h.metresPerUnit;
      compared++;
      if (Math.abs(metres - map.elevation[i]!) < 250) close++;
    }
    expect(compared).toBeGreaterThan(500);
    // flat hexes: the mean of the hex and the sample at its centre agree
    expect(close / compared).toBeGreaterThan(0.95);
  });

  it('has the resources of the design docs', () => {
    const ids = map.resources.map((r) => r.id);
    expect(ids.slice(0, 5)).toEqual(['horses', 'iron', 'coal', 'oil', 'rare-earths']);
    expect(ids).toHaveLength(5 + 50 + 4);
    expect(new Set(ids).size).toBe(ids.length);
    // each specialty lies inside its nation, each luxury inside its region
    let next = 5;
    POLITIES.forEach((spec, p) => {
      if (spec.luxury === undefined) return;
      const r = next++;
      expect(map.resources[r]!.nameZh).toBe(spec.luxury[0]);
      const hexes = [...map.resource.keys()].filter((i) => map.resource[i] === r);
      expect(hexes.length).toBeGreaterThan(0);
      for (const i of hexes) expect(map.zones[map.zone[i]!]!.polity).toBe(p);
    });
    for (let r = 0; r < 5; r++) {
      expect(map.resource.filter((v) => v === r).length).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('zone contiguity check', () => {
  const zoneOfSite = (m: MapData, id: string): number => m.zones.findIndex((z) => z.id === id);

  it('accepts the fixture map', () => {
    const fixture = createFixtureMap();
    fixture.zones.forEach((zone, z) => {
      const size = fixture.zone.filter((v) => v === z).length;
      expect(reachableInZone(fixture, z, zone.siteHex, 0).size).toBe(size);
    });
  });

  it('finds a piece cut off by another zone', () => {
    const fixture = createFixtureMap();
    const z = zoneOfSite(fixture, 'jia-1');
    const other = zoneOfSite(fixture, 'bing-1');
    // an exclave of jia-1 deep inside bing-1
    const exclave = fixture.zones[other]!.siteHex + 2;
    expect(fixture.zone[exclave]).toBe(other);
    fixture.zone[exclave] = z;
    const size = fixture.zone.filter((v) => v === z).length;
    expect(reachableInZone(fixture, z, fixture.zones[z]!.siteHex, RULES.maxSeaGap).size).toBe(size - 1);
  });

  it('joins an island across a few sea hexes, but not across more', () => {
    const fixture = createFixtureMap();
    const z = zoneOfSite(fixture, 'wucheng-1');
    const site = indexToOffset(fixture.zones[z]!.siteHex, fixture.width);
    // walk east from the city-state over the sea and raise an island there
    const islandAt = (steps: number): number => {
      let hex = site;
      for (let s = 0; s < steps; s++) hex = hexNeighbor(hex, 0);
      return hex.row * fixture.width + hex.col;
    };
    const near = islandAt(3);
    expect(fixture.owner[near]).toBe(OWNER_SEA);
    fixture.terrain[near] = Terrain.Plains;
    fixture.owner[near] = fixture.zones[z]!.polity;
    fixture.zone[near] = z;
    const size = fixture.zone.filter((v) => v === z).length;
    expect(reachableInZone(fixture, z, fixture.zones[z]!.siteHex, 2).size).toBe(size);
    expect(reachableInZone(fixture, z, fixture.zones[z]!.siteHex, 1).size).toBe(size - 1);
    expect(reachableInZone(fixture, z, fixture.zones[z]!.siteHex, 0).size).toBe(size - 1);
    expect(fixture.zone[islandAt(1)]).toBe(NO_ZONE);
  });
});

describe('river count', () => {
  it('counts the single river of the fixture map', () => {
    expect(countRivers(createFixtureMap()).rivers).toBe(1);
  });

  it('finds at least 40 rivers on the committed map', () => {
    expect(countRivers(map).rivers).toBeGreaterThanOrEqual(RULES.minRivers);
  });
});
