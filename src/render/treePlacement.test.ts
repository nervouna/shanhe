import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
import { Feature, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import { latitudeAt, latitudeTerms, sinLatitudeAt, snowLineMetres } from './climate.ts';
import { createFlatMap } from './testMaps.ts';
import { FOREST_TREES, JUNGLE_TREES, TreeFamily, createTreePlacer, hexGrowth } from './treePlacement.ts';
import { buildTreeShape } from './treeShapes.ts';

const share = (growth: ReturnType<typeof hexGrowth>, family: number): number => growth.shares[family] as number;

describe('hexGrowth', () => {
  it('grows nothing on water, mountains, volcanoes, desert, tundra and snow without a feature', () => {
    for (const terrain of [Terrain.Ocean, Terrain.Coast, Terrain.Lake, Terrain.Mountain]) {
      expect(hexGrowth(terrain, Feature.Forest, 30, 100, 0.1).count).toBe(0);
    }
    expect(hexGrowth(Terrain.Plains, Feature.Volcano, 30, 100, 0.1).count).toBe(0);
    for (const terrain of [Terrain.Desert, Terrain.Tundra, Terrain.Snow]) {
      expect(hexGrowth(terrain, Feature.None, 30, 100, 0.1).count).toBe(0);
    }
  });

  it('makes a tropical jungle a rainforest canopy with palms, and a northern one broadleaf and bamboo', () => {
    const tropical = hexGrowth(Terrain.Grassland, Feature.Jungle, 5, 100, 0.5);
    expect(tropical.count).toBe(JUNGLE_TREES);
    expect(share(tropical, TreeFamily.Rainforest)).toBeGreaterThan(0.5);
    expect(share(tropical, TreeFamily.Palm)).toBeGreaterThan(0);
    expect(share(tropical, TreeFamily.Conifer)).toBe(0);
    const northern = hexGrowth(Terrain.Grassland, Feature.Jungle, 27, 100, 0.5);
    expect(share(northern, TreeFamily.Broadleaf)).toBeGreaterThan(share(northern, TreeFamily.Rainforest));
    expect(share(northern, TreeFamily.Bamboo)).toBeGreaterThan(0);
    expect(share(northern, TreeFamily.Palm)).toBe(0);
  });

  it('turns forest from broadleaf with bamboo in the south to conifer in the north', () => {
    const south = hexGrowth(Terrain.Grassland, Feature.Forest, 28, 300, 0.5);
    expect(south.count).toBe(FOREST_TREES);
    expect(share(south, TreeFamily.Conifer)).toBe(0);
    expect(share(south, TreeFamily.Bamboo)).toBeGreaterThan(0.2);
    const temperate = hexGrowth(Terrain.Plains, Feature.Forest, 42, 300, 0.5);
    expect(share(temperate, TreeFamily.Conifer)).toBeGreaterThan(0.2);
    expect(share(temperate, TreeFamily.Broadleaf)).toBeGreaterThan(0.2);
    expect(share(temperate, TreeFamily.Bamboo)).toBe(0);
    const north = hexGrowth(Terrain.Plains, Feature.Forest, 58, 300, 0.5);
    expect(share(north, TreeFamily.Conifer)).toBe(1);
  });

  it('makes forest conifer on high ground and on tundra, whatever the latitude', () => {
    expect(share(hexGrowth(Terrain.Grassland, Feature.Forest, 28, 3400, 0.5), TreeFamily.Conifer)).toBe(1);
    expect(share(hexGrowth(Terrain.Tundra, Feature.Forest, 30, 200, 0.5), TreeFamily.Conifer)).toBe(1);
  });

  it('puts palms in tropical forest and around an oasis, and a few trees in a marsh', () => {
    expect(share(hexGrowth(Terrain.Grassland, Feature.Forest, 10, 100, 0.5), TreeFamily.Palm)).toBeGreaterThan(0);
    const oasis = hexGrowth(Terrain.Desert, Feature.Oasis, 40, 900, 0.5);
    expect(oasis.count).toBeGreaterThan(0);
    expect(share(oasis, TreeFamily.Palm)).toBe(1);
    const marsh = hexGrowth(Terrain.Grassland, Feature.Marsh, 30, 10, 0.5);
    expect(marsh.count).toBeGreaterThan(0);
    expect(marsh.count).toBeLessThan(FOREST_TREES / 4);
  });

  it('scatters a stray tree or two over about a third of open grassland and plains', () => {
    let grown = 0;
    for (let i = 0; i < 100; i++) {
      const growth = hexGrowth(Terrain.Plains, Feature.None, 35, 100, (i + 0.5) / 100);
      expect(growth.count).toBeLessThanOrEqual(3);
      if (growth.count > 0) grown++;
    }
    expect(grown).toBeGreaterThan(20);
    expect(grown).toBeLessThan(45);
  });

  it('gives shares that sum to one wherever anything grows', () => {
    for (const feature of [Feature.None, Feature.Forest, Feature.Jungle, Feature.Marsh, Feature.Oasis]) {
      for (const latitude of [0, 20, 30, 40, 50, 65]) {
        const growth = hexGrowth(Terrain.Grassland, feature, latitude, 500, 0.1);
        if (growth.count === 0) continue;
        expect(growth.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      }
    }
  });
});

describe('createTreePlacer', () => {
  const map = createFixtureMap();
  const placer = createTreePlacer(map);
  const layout = map.projection.hexLayout;
  const count = map.width * map.height;

  it('grows the same trees on every call', () => {
    const forest = Array.from({ length: count }, (_, i) => i).find((i) => map.feature[i] === Feature.Forest);
    expect(forest).toBeDefined();
    expect(placer.trees(forest!)).toEqual(placer.trees(forest!));
    expect(createTreePlacer(map).trees(forest!)).toEqual(placer.trees(forest!));
    expect(placer.trees(forest!).length).toBeGreaterThan(FOREST_TREES * 0.7);
  });

  it('keeps every tree inside its hex and off the water', () => {
    let total = 0;
    for (let i = 0; i < count; i++) {
      const trees = placer.trees(i);
      if (isWaterTerrain(map.terrain[i] as number) || map.terrain[i] === Terrain.Mountain) {
        expect(trees).toEqual([]);
        continue;
      }
      expect(trees.length).toBeLessThanOrEqual(placer.growth(i).count);
      for (const tree of trees) {
        const hex = worldToHex({ x: tree.x, z: tree.z }, layout);
        expect(hex.row * map.width + hex.col).toBe(i);
        expect(tree.height).toBeGreaterThan(0.1 * layout.size);
        expect(tree.height).toBeLessThan(0.3 * layout.size);
        total++;
      }
    }
    expect(total).toBeGreaterThan(100);
  });

  it('leaves the middle of a city site clear', () => {
    const forested = createFlatMap({ width: 6, height: 5, metres: 100 });
    forested.feature.fill(Feature.Forest);
    const site = 14;
    const withSite = { ...forested, zones: [{ id: 'z', polity: 0, siteHex: site, capital: true, cityNameZh: '城', cityNameEn: 'City' }] };
    const centre = hexToWorld(indexToOffset(site, forested.width), forested.projection.hexLayout);
    const nearest = (trees: readonly { x: number; z: number }[]): number =>
      Math.min(...trees.map((tree) => Math.hypot(tree.x - centre.x, tree.z - centre.z)));
    expect(nearest(createTreePlacer(withSite).trees(site))).toBeGreaterThanOrEqual(0.45);
    expect(nearest(createTreePlacer(forested).trees(site))).toBeLessThan(0.3);
  });

  it('mixes the families a hex grows in about their shares', () => {
    const jungle = createFlatMap({ width: 12, height: 12, metres: 100 });
    jungle.feature.fill(Feature.Jungle);
    // the flat map lies at 35 degrees north: north of the tropic, so mostly broadleaf
    const families = new Map<number, number>();
    const flatPlacer = createTreePlacer(jungle);
    for (let i = 0; i < 144; i++) for (const tree of flatPlacer.trees(i)) families.set(tree.family, (families.get(tree.family) ?? 0) + 1);
    const total = [...families.values()].reduce((a, b) => a + b, 0);
    expect((families.get(TreeFamily.Broadleaf) ?? 0) / total).toBeGreaterThan(0.5);
    expect((families.get(TreeFamily.Bamboo) ?? 0) / total).toBeGreaterThan(0.2);
    expect(families.get(TreeFamily.Conifer)).toBeUndefined();
  });
});

describe('tree shapes', () => {
  it('builds every family in two versions, the coarse one with fewer triangles', () => {
    for (const family of Object.values(TreeFamily)) {
      const fine = buildTreeShape(family, true);
      const coarse = buildTreeShape(family, false);
      expect(coarse.triangleCount).toBeGreaterThan(0);
      expect(coarse.triangleCount).toBeLessThan(fine.triangleCount);
      expect(fine.triangleCount).toBeLessThanOrEqual(130);
      // one unit tall, standing on the origin
      const ys = fine.positions.filter((_, i) => i % 3 === 1);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...ys)).toBeGreaterThan(0.9);
      expect(Math.max(...ys)).toBeLessThanOrEqual(1.05);
      for (const index of fine.indices) expect(index).toBeLessThan(fine.vertexCount);
      for (let v = 0; v < fine.vertexCount; v++) {
        const length = Math.hypot(fine.normals[v * 3]!, fine.normals[v * 3 + 1]!, fine.normals[v * 3 + 2]!);
        expect(length).toBeCloseTo(1, 4);
      }
    }
  });
});

describe('climate', () => {
  const terms = latitudeTerms(createFixtureMap().projection);

  it('finds the latitude of the origin of the projection and of points north and south of it', () => {
    const projection = createFixtureMap().projection;
    expect(latitudeAt(terms, 0, 0)).toBeCloseTo(projection.lat0, 6);
    // 1,000 km to the north is about 9 degrees of latitude
    const north = latitudeAt(terms, 0, -1000 / projection.kmPerWorldUnit);
    expect(north - projection.lat0).toBeGreaterThan(8);
    expect(north - projection.lat0).toBeLessThan(10);
    expect(latitudeAt(terms, 0, 1000 / projection.kmPerWorldUnit)).toBeLessThan(projection.lat0 - 8);
    expect(sinLatitudeAt(terms, 0, 0)).toBeCloseTo(Math.sin((projection.lat0 * Math.PI) / 180), 6);
  });

  it('lowers the snow line towards the north', () => {
    const at = (degrees: number): number => snowLineMetres(Math.sin((degrees * Math.PI) / 180));
    expect(at(10)).toBe(at(20));
    expect(at(28)).toBeGreaterThan(5000);
    expect(at(45)).toBeGreaterThan(2500);
    expect(at(45)).toBeLessThan(4000);
    expect(at(70)).toBeLessThan(1500);
    expect(at(70)).toBeGreaterThan(0);
    expect(at(30)).toBeGreaterThan(at(40));
    expect(at(40)).toBeGreaterThan(at(60));
  });
});
