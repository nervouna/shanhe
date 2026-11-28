import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOV,
  MAX_VOID_SHARE,
  cameraLimits,
  cameraPose,
  clampCamera,
  rayAtHeight,
  screenRay,
  viewMargins,
} from './cameraRig.ts';
import type { CameraLimits, CameraState } from './cameraRig.ts';

// the size of the real map, and a wide desktop view
const RECT = { minX: -75.5, minZ: -134.9, maxX: 109, maxZ: 123.6 };
const LIMITS: CameraLimits = cameraLimits(RECT, 1);
const ASPECT = 2472 / 1200;

/** The ground point seen at a point of the view (`-1..1` both ways). */
function seen(state: CameraState, ndcX: number, ndcY: number): { x: number; z: number } {
  const hit = rayAtHeight(screenRay(cameraPose(state, LIMITS, 0), CAMERA_FOV, ASPECT, ndcX, ndcY), 0);
  if (hit === null) throw new Error('the view misses the ground');
  return hit;
}

function onMap(p: { x: number; z: number }, slack = 1e-6): boolean {
  return p.x >= RECT.minX - slack && p.x <= RECT.maxX + slack && p.z >= RECT.minZ - slack && p.z <= RECT.maxZ + slack;
}

describe('clampCamera with a view', () => {
  const inner = 1 - 2 * MAX_VOID_SHARE;

  it('keeps all but a tenth of the view on the map at every edge, where the map is larger than the view', () => {
    expect(MAX_VOID_SHARE).toBeLessThanOrEqual(0.1);
    for (const distance of [5, 14, 45, 90]) {
      // pushed as far as it goes towards each edge and each corner
      for (const [x, z] of [[-1e6, 0], [1e6, 0], [0, -1e6], [0, 1e6], [1e6, 1e6], [-1e6, -1e6]] as const) {
        const state = clampCamera({ x, z, distance, yaw: 0 }, LIMITS, ASPECT);
        // the middle of each side of the frame a tenth inside the view shows the map
        for (const [u, v] of [[-inner, 0], [inner, 0], [0, -inner], [0, inner]] as const) {
          expect(onMap(seen(state, u, v)), `distance ${distance}, towards ${x}, ${z}, at ${u}, ${v}`).toBe(true);
        }
        expect(onMap({ x: state.x, z: state.z })).toBe(true);
      }
    }
  });

  it('lets the view reach the edge: the target is not held back farther than that', () => {
    const state = clampCamera({ x: 0, z: 1e6, distance: 45, yaw: 0 }, LIMITS, ASPECT);
    // the bottom of that frame is on the south edge, not short of it
    expect(seen(state, 0, -inner).z).toBeCloseTo(RECT.maxZ, 6);
    const west = clampCamera({ x: -1e6, z: 0, distance: 45, yaw: 0 }, LIMITS, ASPECT);
    expect(seen(west, -inner, 0).x).toBeCloseTo(RECT.minX, 6);
  });

  it('follows the turn of the view', () => {
    for (const yaw of [0.7, Math.PI / 2, -2.1, Math.PI]) {
      for (const [x, z] of [[-1e6, 0], [1e6, 0], [0, -1e6], [0, 1e6]] as const) {
        const state = clampCamera({ x, z, distance: 30, yaw }, LIMITS, ASPECT);
        for (const [u, v] of [[-inner, 0], [inner, 0], [0, -inner], [0, inner]] as const) {
          expect(onMap(seen(state, u, v), 1e-4), `yaw ${yaw}`).toBe(true);
        }
      }
    }
  });

  it('centres the map where the view is wider than the map, and still shows the whole of it', () => {
    const state = clampCamera({ x: 1e6, z: -1e6, distance: Infinity, yaw: 0 }, LIMITS, ASPECT);
    expect(state.distance).toBe(LIMITS.maxDistance);
    expect(state.x).toBeCloseTo((RECT.minX + RECT.maxX) / 2, 6);
    // the map's north and south edges are in the view
    const top = seen(state, 0, 1);
    const bottom = seen(state, 0, -1);
    expect(top.z).toBeLessThan(RECT.minZ);
    expect(bottom.z).toBeGreaterThan(RECT.maxZ);
    // and it sits in the middle of it
    expect(Math.abs(RECT.minZ - top.z - (bottom.z - RECT.maxZ))).toBeLessThan(0.12 * (RECT.maxZ - RECT.minZ));
  });

  it('leaves a target in the middle of the map alone, and does nothing more than before without a view', () => {
    const middle = { x: 10, z: -5, distance: 45, yaw: 0.3 };
    expect(clampCamera(middle, LIMITS, ASPECT)).toEqual(middle);
    expect(clampCamera({ x: 1e6, z: 1e6, distance: 45, yaw: 0 }, LIMITS)).toEqual({ x: RECT.maxX, z: RECT.maxZ, distance: 45, yaw: 0 });
  });

  it('gives margins that grow with the distance', () => {
    const near = viewMargins(10, 0, LIMITS, ASPECT);
    const far = viewMargins(60, 0, LIMITS, ASPECT);
    for (const side of ['west', 'east', 'north', 'south'] as const) {
      expect(near[side]).toBeGreaterThan(0);
      expect(far[side]).toBeGreaterThan(near[side]);
    }
    expect(near.west).toBeCloseTo(near.east, 9);
    // the view reaches farther towards the top of the screen
    expect(near.north).toBeGreaterThan(near.south);
  });
});
