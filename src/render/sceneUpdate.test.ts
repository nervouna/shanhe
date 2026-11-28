import { describe, expect, it } from 'vitest';
import type { InstancedMesh, Object3D } from 'three/webgpu';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { createCities } from './cities.ts';
import { latitudeTerms } from './climate.ts';
import { createGroundLines } from './groundLines.ts';
import { createSurface, mapWorldRect, unitsPerMetre } from './heightField.ts';
import { createHexRaster } from './hexRaster.ts';
import { cascadeSeesAny } from './lightMath.ts';
import { createMapTextures } from './mapTextures.ts';
import type { RenderCity, RenderRoute } from './scene.ts';
import { createMapUniforms } from './shaderLib.ts';

/** The layers `setScene` feeds, built as the renderer builds them, without a GPU. */
function createLayers() {
  const map = createFixtureMap();
  const surface = createSurface(map);
  const uniforms = createMapUniforms(
    mapWorldRect(map),
    map.projection.hexLayout,
    unitsPerMetre(map),
    createMapTextures(map, createHexRaster(map)),
    latitudeTerms(map.projection),
  );
  return { map, cities: createCities(surface, uniforms), lines: createGroundLines(surface, uniforms) };
}

/** The instanced meshes of the houses, by identity. */
function houseMeshes(root: Object3D): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  root.traverse((child) => {
    if ((child as InstancedMesh).isInstancedMesh && child.name !== 'cityMarkers') meshes.push(child as InstancedMesh);
  });
  return meshes;
}

describe('the incremental scene: cities', () => {
  const { map, cities } = createLayers();
  // cities far apart, so that they stand in different regions of the batch
  const sites = map.zones.map((zone) => zone.siteHex).slice(0, 6);
  const scene: RenderCity[] = sites.map((hex, i) => ({ hex, polity: i % map.polities.length, population: 4 + i, name: `City ${i}` }));

  it('builds every city once', () => {
    const update = cities.setCities(scene);
    expect(update?.built).toBe(sites.length);
    expect(update?.labels.map((label) => label.hex)).toEqual(sites);
    expect(cities.builds).toBe(sites.length);
    expect(cities.parts).toBeGreaterThan(sites.length * 5);
  });

  it('rebuilds nothing for an unchanged scene', () => {
    const meshes = houseMeshes(cities.object);
    const versions = meshes.map((mesh) => mesh.instanceMatrix.version);
    const builds = cities.builds;
    const meshBuilds = cities.meshBuilds;
    // the same cities as new objects, as the interface hands them over every turn
    expect(cities.setCities(scene.map((city) => ({ ...city })))).toBeNull();
    expect(cities.builds).toBe(builds);
    expect(cities.meshBuilds).toBe(meshBuilds);
    expect(houseMeshes(cities.object)).toEqual(meshes);
    expect(meshes.map((mesh) => mesh.instanceMatrix.version)).toEqual(versions);
  });

  it('rebuilds one city when one changed, in the meshes of its region only', () => {
    const meshes = houseMeshes(cities.object);
    const versions = meshes.map((mesh) => mesh.instanceMatrix.version);
    const builds = cities.builds;
    const partsBefore = cities.parts;
    const changed = scene.map((city, i) => (i === 2 ? { ...city, population: city.population + 6, walls: true } : city));
    const update = cities.setCities(changed);
    expect(update?.built).toBe(1);
    expect(update?.removed).toBe(0);
    expect(cities.builds).toBe(builds + 1);
    expect(cities.parts).toBeGreaterThan(partsBefore);
    // the labels are those of all cities, the changed one with its new size
    expect(update?.labels).toHaveLength(sites.length);
    expect(update?.labels[2]?.population).toBe(changed[2]?.population);

    // every mesh that was there is still there (a region that outgrew its mesh got a larger one besides)
    const after = houseMeshes(cities.object);
    const written = meshes.filter((mesh, i) => mesh.instanceMatrix.version !== versions[i] || !after.includes(mesh));
    expect(written.length).toBeGreaterThan(0);
    expect(written.length).toBeLessThanOrEqual(6);
    expect(meshes.length - written.length).toBeGreaterThan(0);

    // the ground whose shadows changed is the changed city's, and only the cascades over it see it
    const areas = update?.areas ?? [];
    expect(areas.length).toBeGreaterThan(0);
    const label = update?.labels[2];
    const other = update?.labels[5];
    if (label === undefined || other === undefined) throw new Error('labels are missing');
    const size = map.projection.hexLayout.size;
    for (const area of areas) expect(Math.hypot(area.x - label.x, area.z - label.z)).toBeLessThan(area.radius + 2 * size);
    const over = { x: label.x, z: label.z, distance: 10, half: 3 * size };
    const away = { x: other.x, z: other.z, distance: 10, half: 0.5 * size };
    expect(cascadeSeesAny(over, areas, 0.7)).toBe(true);
    expect(Math.hypot(other.x - label.x, other.z - label.z)).toBeGreaterThan(6 * size);
    expect(cascadeSeesAny(away, areas, 0.7)).toBe(false);
  });

  it('takes a city off the board without touching the others', () => {
    const builds = cities.builds;
    const update = cities.setCities(scene.slice(0, 5).map((city, i) => (i === 2 ? { ...city, population: city.population + 6, walls: true } : city)));
    expect(update?.built).toBe(0);
    expect(update?.removed).toBe(1);
    expect(update?.labels).toHaveLength(5);
    expect(cities.builds).toBe(builds);
  });
});

describe('the incremental scene: roads and routes', () => {
  const { map, lines } = createLayers();
  const hex = (col: number, row: number): number => row * map.width + col;
  // two stretches of road that do not touch
  const west = [hex(2, 2), hex(3, 2), hex(4, 2)];
  const east = [hex(10, 6), hex(11, 6), hex(12, 6)];
  const roads = new Map<number, number>([...west, ...east].map((h) => [h, 1]));

  it('lays every stretch once and nothing for the same roads', () => {
    expect(lines.setRoads(roads)).toBeGreaterThanOrEqual(2);
    const builds = lines.builds;
    const triangles = lines.counts.roads;
    expect(triangles).toBeGreaterThan(0);
    const geometry = lines.object.getObjectByName('roads');
    const before = (geometry as unknown as { geometry: unknown }).geometry;
    expect(lines.setRoads(new Map(roads))).toBe(0);
    expect(lines.builds).toBe(builds);
    expect((geometry as unknown as { geometry: unknown }).geometry).toBe(before);
  });

  it('lays only the stretch that grew', () => {
    const builds = lines.builds;
    const triangles = lines.counts.roads;
    const longer = new Map(roads).set(hex(13, 6), 1);
    expect(lines.setRoads(longer)).toBe(1);
    expect(lines.builds).toBe(builds + 1);
    expect(lines.counts.roads).toBeGreaterThan(triangles);
  });

  it('lays only the route that is new', () => {
    const routes: RenderRoute[] = [{ path: west, polity: 0, sea: false }];
    expect(lines.setRoutes(routes)).toBe(1);
    expect(lines.setRoutes(routes.map((route) => ({ ...route, path: [...route.path] })))).toBe(0);
    expect(lines.setRoutes([...routes, { path: east, polity: 1, sea: false }])).toBe(1);
    expect(lines.setRoutes([])).toBe(0);
    expect(lines.counts.routes).toBe(0);
  });
});

describe('cascadeSeesAny', () => {
  const fit = { x: 0, z: 0, distance: 20, half: 10 };
  it('sees nothing when nothing changed, and everything when it was never drawn', () => {
    expect(cascadeSeesAny(fit, [], 0.7)).toBe(false);
    expect(cascadeSeesAny(null, [{ x: 1000, z: 0, radius: 1 }], 0.7)).toBe(true);
  });
  it('sees a change inside its square and not one far outside', () => {
    expect(cascadeSeesAny(fit, [{ x: 5, z: -5, radius: 1 }], 0.7)).toBe(true);
    expect(cascadeSeesAny(fit, [{ x: 60, z: 0, radius: 1 }], 0.7)).toBe(false);
    expect(cascadeSeesAny(fit, [{ x: 60, z: 0, radius: 1 }, { x: 0, z: 9, radius: 0.5 }], 0.7)).toBe(true);
  });
  it('reaches farther under a low sun, whose shadows are long', () => {
    const area = [{ x: 30, z: 0, radius: 1 }];
    expect(cascadeSeesAny(fit, area, 0.9)).toBe(false);
    expect(cascadeSeesAny(fit, area, 0.3)).toBe(true);
  });
});
