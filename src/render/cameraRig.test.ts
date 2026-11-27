import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOV,
  FAR_TILT,
  NEAR_TILT,
  cameraLimits,
  cameraPose,
  clampCamera,
  rayAtHeight,
  screenRay,
  tiltForDistance,
  zoomFraction,
} from './cameraRig.ts';

const rect = { minX: -10, minZ: 5, maxX: 90, maxZ: 65 };
const limits = cameraLimits(rect, 1);

describe('cameraLimits', () => {
  it('keeps the target on the map and scales the zoom range with the map', () => {
    expect(limits).toMatchObject({ minX: -10, maxX: 90, minZ: 5, maxZ: 65 });
    expect(limits.minDistance).toBeGreaterThan(0);
    expect(limits.maxDistance).toBeGreaterThan(100);
    const larger = cameraLimits({ minX: 0, minZ: 0, maxX: 1000, maxZ: 400 }, 1);
    expect(larger.maxDistance).toBeCloseTo(limits.maxDistance * 10, 6);
  });

  it('leaves a zoom range on a map of a single hex', () => {
    const tiny = cameraLimits({ minX: 0, minZ: 0, maxX: 1.7, maxZ: 2 }, 1);
    expect(tiny.maxDistance).toBeGreaterThan(tiny.minDistance);
  });
});

describe('clampCamera', () => {
  it('leaves a state inside the limits unchanged', () => {
    const state = { x: 20, z: 30, distance: 40, yaw: 1 };
    expect(clampCamera(state, limits)).toEqual(state);
  });

  it('moves the target back onto the map', () => {
    const northWest = clampCamera({ x: -500, z: -500, distance: 40, yaw: 0 }, limits);
    expect(northWest).toMatchObject({ x: -10, z: 5 });
    const southEast = clampCamera({ x: 500, z: 500, distance: 40, yaw: 0 }, limits);
    expect(southEast).toMatchObject({ x: 90, z: 65 });
  });

  it('keeps the zoom in range', () => {
    const near = clampCamera({ x: 0, z: 10, distance: 0.001, yaw: 0 }, limits);
    expect(near.distance).toBe(limits.minDistance);
    const far = clampCamera({ x: 0, z: 10, distance: 1e9, yaw: 0 }, limits);
    expect(far.distance).toBe(limits.maxDistance);
  });

  it('wraps the yaw into -PI..PI', () => {
    const over = clampCamera({ x: 0, z: 10, distance: 40, yaw: 2 * Math.PI + 0.25 }, limits);
    expect(over.yaw).toBeCloseTo(0.25, 9);
    const under = clampCamera({ x: 0, z: 10, distance: 40, yaw: -3.5 }, limits);
    expect(under.yaw).toBeCloseTo(-3.5 + 2 * Math.PI, 9);
  });
});

describe('tiltForDistance', () => {
  it('is low and oblique at the nearest zoom and top-down at the farthest', () => {
    expect(tiltForDistance(limits.minDistance, limits)).toBeCloseTo(NEAR_TILT, 9);
    expect(tiltForDistance(limits.maxDistance, limits)).toBeCloseTo(FAR_TILT, 9);
    expect(NEAR_TILT).toBeLessThan(Math.PI / 4);
    expect(FAR_TILT).toBeGreaterThan((80 * Math.PI) / 180);
    expect(FAR_TILT).toBeLessThan(Math.PI / 2);
  });

  it('rises monotonically with the distance', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const d = limits.minDistance * (limits.maxDistance / limits.minDistance) ** (i / 200);
      const tilt = tiltForDistance(d, limits);
      expect(tilt).toBeGreaterThanOrEqual(previous);
      previous = tilt;
    }
  });

  it('does not go past its ends outside the zoom range', () => {
    expect(tiltForDistance(limits.minDistance / 10, limits)).toBeCloseTo(NEAR_TILT, 9);
    expect(tiltForDistance(limits.maxDistance * 10, limits)).toBeCloseTo(FAR_TILT, 9);
    expect(zoomFraction(limits.minDistance, limits)).toBe(0);
    expect(zoomFraction(limits.maxDistance, limits)).toBeCloseTo(1, 12);
  });
});

describe('cameraPose', () => {
  it('stands at the zoom distance from the target, south of it for yaw 0', () => {
    const state = { x: 20, z: 30, distance: 25, yaw: 0 };
    const pose = cameraPose(state, limits, 1.5);
    expect(pose.target).toEqual([20, 1.5, 30]);
    const [px, py, pz] = pose.position;
    expect(Math.hypot(px - 20, py - 1.5, pz - 30)).toBeCloseTo(25, 9);
    expect(px).toBeCloseTo(20, 9);
    expect(pz).toBeGreaterThan(30);
    expect(py - 1.5).toBeCloseTo(25 * Math.sin(pose.tilt), 9);
  });

  it('turns around the target with the yaw', () => {
    const pose = cameraPose({ x: 20, z: 30, distance: 25, yaw: Math.PI / 2 }, limits, 0);
    expect(pose.position[0]).toBeGreaterThan(20);
    expect(pose.position[2]).toBeCloseTo(30, 9);
  });
});

describe('screenRay', () => {
  const pose = cameraPose({ x: 20, z: 30, distance: 25, yaw: 0.7 }, limits, 2);

  it('goes through the target at the centre of the view', () => {
    const ray = screenRay(pose, CAMERA_FOV, 16 / 9, 0, 0);
    const hit = rayAtHeight(ray, 2);
    expect(hit?.x).toBeCloseTo(20, 9);
    expect(hit?.z).toBeCloseTo(30, 9);
    expect(Math.hypot(...ray.direction)).toBeCloseTo(1, 12);
  });

  it('spreads by the field of view', () => {
    const top = screenRay(pose, CAMERA_FOV, 2, 0, 1).direction;
    const centre = screenRay(pose, CAMERA_FOV, 2, 0, 0).direction;
    const dot = top[0] * centre[0] + top[1] * centre[1] + top[2] * centre[2];
    expect(Math.acos(dot)).toBeCloseTo((CAMERA_FOV * Math.PI) / 360, 9);
  });

  it('never meets a plane behind it', () => {
    const ray = screenRay(pose, CAMERA_FOV, 2, 0, 0);
    expect(rayAtHeight(ray, 1000)).toBeNull();
  });
});
