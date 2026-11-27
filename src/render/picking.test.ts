import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexIndex, hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
import { Terrain } from '../shared/mapData.ts';
import { CAMERA_FOV, cameraLimits, cameraPose, rayAtHeight, screenRay } from './cameraRig.ts';
import type { Ray } from './cameraRig.ts';
import {
  createSurface,
  mapWorldRect,
  surfaceHeightAt,
  surfaceHeightAtHex,
  unitsPerMetre,
} from './heightField.ts';
import { pickHexOnRay, pickSurface } from './picking.ts';
import { createFlatMap } from './testMaps.ts';

describe('pickHexOnRay on a flat map', () => {
  for (const options of [
    { width: 12, height: 9, metres: 800 },
    { width: 40, height: 6, metres: -300, size: 3, originX: 50, originZ: -20 },
  ]) {
    const map = createFlatMap(options);
    const surface = createSurface(map);
    const layout = map.projection.hexLayout;
    const rect = mapWorldRect(map);
    const limits = cameraLimits(rect, layout.size);
    const y = options.metres * unitsPerMetre(map);
    const label = `${options.width} x ${options.height}`;

    it(`picks the hex the camera looks at (${label})`, () => {
      for (let i = 0; i < map.width * map.height; i++) {
        const centre = hexToWorld(indexToOffset(i, map.width), layout);
        for (const [distance, yaw] of [
          [limits.minDistance, 0],
          [limits.minDistance * 3, 2.1],
          [limits.maxDistance, -1],
        ] as const) {
          const pose = cameraPose({ x: centre.x, z: centre.z, distance, yaw }, limits, y);
          expect(pickHexOnRay(surface, screenRay(pose, CAMERA_FOV, 1.6, 0, 0))).toBe(i);
        }
      }
    });

    it(`agrees with the plane intersection all over the view (${label})`, () => {
      // off the exact centre of the map, which can lie on an edge between two
      // hexes, where the last bit of rounding decides the hex
      const state = {
        x: (rect.minX + rect.maxX) / 2 + 0.37 * layout.size,
        z: (rect.minZ + rect.maxZ) / 2 + 0.21 * layout.size,
        distance: limits.minDistance * 4,
        yaw: 0.6,
      };
      const pose = cameraPose(state, limits, y);
      let hits = 0;
      for (let sx = -1; sx <= 1; sx += 0.125) {
        for (let sy = -1; sy <= 1; sy += 0.125) {
          const ray = screenRay(pose, CAMERA_FOV, 1.6, sx, sy);
          const flat = rayAtHeight(ray, y);
          let expected: number | null = null;
          if (
            flat !== null &&
            flat.x >= rect.minX &&
            flat.x <= rect.maxX &&
            flat.z >= rect.minZ &&
            flat.z <= rect.maxZ
          ) {
            const hex = worldToHex(flat, layout);
            if (hex.col >= 0 && hex.col < map.width && hex.row >= 0 && hex.row < map.height) {
              expected = hexIndex(hex.col, hex.row, map.width);
            }
          }
          expect(pickHexOnRay(surface, ray)).toBe(expected);
          if (expected !== null) hits++;
        }
      }
      expect(hits).toBeGreaterThan(20);
    });

    it(`misses when the ray points at the sky or falls outside the map (${label})`, () => {
      const up: Ray = { origin: [layout.originX, y + 5, layout.originZ], direction: [0, 1, 0] };
      expect(pickHexOnRay(surface, up)).toBeNull();
      const outside: Ray = {
        origin: [layout.originX - 1000, y + 5, layout.originZ],
        direction: [0, -1, 0],
      };
      expect(pickHexOnRay(surface, outside)).toBeNull();
    });
  }
});

describe('pickSurface on relief', () => {
  const map = createFixtureMap();
  const surface = createSurface(map);
  const layout = map.projection.hexLayout;
  const limits = cameraLimits(mapWorldRect(map), layout.size);

  it('hits the surface, not the plane under it', () => {
    const mountain = map.terrain.indexOf(Terrain.Mountain);
    const centre = hexToWorld(indexToOffset(mountain, map.width), layout);
    const state = { x: centre.x, z: centre.z, distance: limits.minDistance, yaw: 0.4 };
    const pose = cameraPose(state, limits, surfaceHeightAtHex(surface, mountain));
    const hit = pickSurface(surface, screenRay(pose, CAMERA_FOV, 1.6, 0, 0));
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(surfaceHeightAt(surface, hit!.x, hit!.z), 6);
    expect(hit!.y).toBeGreaterThan(0.3);
  });

  it('stops at the first slope a low ray meets', () => {
    // a nearly level ray from the west towards the mountain ridge
    const ridge = hexToWorld({ col: 13, row: 2 }, layout);
    const origin = [ridge.x - 6, 0.25, ridge.z] as const;
    const ray: Ray = { origin, direction: [Math.cos(0.01), -Math.sin(0.01), 0] };
    const hit = pickSurface(surface, ray);
    expect(hit).not.toBeNull();
    // everything on the ray before the hit is above the surface
    const reach = hit!.x - origin[0];
    for (let t = 0; t < reach - 0.01; t += 0.05) {
      const x = origin[0] + ray.direction[0] * t;
      const yRay = origin[1] + ray.direction[1] * t;
      expect(yRay).toBeGreaterThan(surfaceHeightAt(surface, x, origin[2]));
    }
    expect(hit!.x).toBeLessThan(ridge.x);
    expect(hit!.y).toBeGreaterThan(0.1);
  });

  it('picks water hexes at the water surface', () => {
    const ocean = map.terrain.indexOf(Terrain.Ocean);
    const centre = hexToWorld(indexToOffset(ocean, map.width), layout);
    const ray: Ray = { origin: [centre.x, 10, centre.z], direction: [0, -1, 0] };
    expect(pickSurface(surface, ray)?.y).toBe(0);
    expect(pickHexOnRay(surface, ray)).toBe(ocean);
  });
});
