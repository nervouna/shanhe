/**
 * Camera maths without Three.js: where the camera may be, how it tilts as it
 * zooms, where it stands for a given state, and the ray through a screen
 * point. The renderer copies the pose onto its camera; picking and the tests
 * use the same numbers.
 */

import type { WorldRect } from '../shared/mapData.ts';

/** What the player controls. */
export interface CameraState {
  /** The point on the ground the camera looks at. */
  readonly x: number;
  readonly z: number;
  /** Distance from that point to the camera: the zoom. */
  readonly distance: number;
  /** Rotation around the vertical axis in radians. 0 looks north. */
  readonly yaw: number;
}

export interface CameraLimits {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

export type Vec3 = readonly [x: number, y: number, z: number];

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Angle of the view above the horizon in radians: `PI / 2` is straight down. */
  readonly tilt: number;
}

export interface Ray {
  readonly origin: Vec3;
  /** Unit length. */
  readonly direction: Vec3;
}

/** Vertical field of view of the game camera, in degrees. */
export const CAMERA_FOV = 38;
/** Tilt at the nearest zoom: low and oblique. */
export const NEAR_TILT = (34 * Math.PI) / 180;
/** Tilt at the farthest zoom: almost straight down. */
export const FAR_TILT = (86 * Math.PI) / 180;

/**
 * Limits for a map that covers `rect`: the target stays on the map, the
 * nearest zoom shows a few hexes and the farthest shows the whole map.
 */
export function cameraLimits(rect: WorldRect, hexSize: number): CameraLimits {
  // a landscape view is about 1.6 times wider than it is high
  const span = Math.max((rect.maxX - rect.minX) / 1.6, rect.maxZ - rect.minZ);
  const minDistance = hexSize * 5;
  const whole = (0.56 * span) / Math.tan((CAMERA_FOV * Math.PI) / 360);
  return {
    minX: rect.minX,
    maxX: rect.maxX,
    minZ: rect.minZ,
    maxZ: rect.maxZ,
    minDistance,
    maxDistance: Math.max(whole, minDistance * 2),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Where `distance` lies between the nearest (0) and the farthest (1) zoom, on a log scale. */
export function zoomFraction(distance: number, limits: CameraLimits): number {
  const d = clamp(distance, limits.minDistance, limits.maxDistance);
  return Math.log(d / limits.minDistance) / Math.log(limits.maxDistance / limits.minDistance);
}

/** The distance at a zoom fraction: the inverse of {@link zoomFraction}. */
export function distanceAtZoom(fraction: number, limits: CameraLimits): number {
  const t = clamp(fraction, 0, 1);
  return limits.minDistance * (limits.maxDistance / limits.minDistance) ** t;
}

/** The zoom fraction the camera starts at: whole provinces in view, the ground still drawn as terrain. */
export const DEFAULT_ZOOM = 0.62;
/** Zoom fractions between which the ground crossfades into the political map. */
export const POLITICAL_FROM = 0.7;
export const POLITICAL_FULL = 0.8;

/** How far the view has turned into the political map at a zoom fraction, 0 to 1. */
export function politicalShare(zoom: number): number {
  const t = clamp((zoom - POLITICAL_FROM) / (POLITICAL_FULL - POLITICAL_FROM), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The tilt that goes with a zoom: {@link NEAR_TILT} at the nearest zoom,
 * rising smoothly and monotonically to {@link FAR_TILT} at the farthest.
 */
export function tiltForDistance(distance: number, limits: CameraLimits): number {
  const t = zoomFraction(distance, limits);
  const eased = t * t * (3 - 2 * t);
  return NEAR_TILT + (FAR_TILT - NEAR_TILT) * eased;
}

/** `state` with the target moved onto the map, the zoom into range and the yaw into -PI..PI. */
export function clampCamera(state: CameraState, limits: CameraLimits): CameraState {
  let yaw = state.yaw % (2 * Math.PI);
  if (yaw > Math.PI) yaw -= 2 * Math.PI;
  if (yaw < -Math.PI) yaw += 2 * Math.PI;
  return {
    x: clamp(state.x, limits.minX, limits.maxX),
    z: clamp(state.z, limits.minZ, limits.maxZ),
    distance: clamp(state.distance, limits.minDistance, limits.maxDistance),
    yaw,
  };
}

/**
 * Where the camera stands and what it looks at.
 *
 * @param targetY height of the ground under the target.
 */
export function cameraPose(state: CameraState, limits: CameraLimits, targetY: number): CameraPose {
  const tilt = tiltForDistance(state.distance, limits);
  const horizontal = state.distance * Math.cos(tilt);
  return {
    position: [
      state.x + Math.sin(state.yaw) * horizontal,
      targetY + state.distance * Math.sin(tilt),
      state.z + Math.cos(state.yaw) * horizontal,
    ],
    target: [state.x, targetY, state.z],
    tilt,
  };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The ray from the camera through a point of the view.
 *
 * @param fovDegrees vertical field of view.
 * @param aspect width of the view divided by its height.
 * @param ndcX -1 at the left edge, 1 at the right edge.
 * @param ndcY -1 at the bottom edge, 1 at the top edge.
 */
export function screenRay(
  pose: CameraPose,
  fovDegrees: number,
  aspect: number,
  ndcX: number,
  ndcY: number,
): Ray {
  const forward = normalize([
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ]);
  // the same basis as a look-at with the y axis up
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const halfHeight = Math.tan((fovDegrees * Math.PI) / 360);
  const sx = ndcX * halfHeight * aspect;
  const sy = ndcY * halfHeight;
  return {
    origin: pose.position,
    direction: normalize([
      forward[0] + right[0] * sx + up[0] * sy,
      forward[1] + right[1] * sx + up[1] * sy,
      forward[2] + right[2] * sx + up[2] * sy,
    ]),
  };
}

/** The point where a ray meets the horizontal plane at height `y`, or `null` if it never does. */
export function rayAtHeight(ray: Ray, y: number): { x: number; z: number } | null {
  const dy = ray.direction[1];
  if (Math.abs(dy) < 1e-9) return null;
  const t = (y - ray.origin[1]) / dy;
  if (t <= 0) return null;
  return { x: ray.origin[0] + ray.direction[0] * t, z: ray.origin[2] + ray.direction[2] * t };
}

/**
 * Where a world point appears in a view: the inverse of {@link screenRay}.
 *
 * @param width of the view in pixels.
 * @param height of the view in pixels.
 * @returns the point in pixels from the top left corner and its distance in front of the camera, or `null` behind it.
 */
export function screenPoint(
  pose: CameraPose,
  fovDegrees: number,
  width: number,
  height: number,
  point: Vec3,
): { x: number; y: number; depth: number } | null {
  const forward = normalize([
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const d: Vec3 = [point[0] - pose.position[0], point[1] - pose.position[1], point[2] - pose.position[2]];
  const depth = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
  if (depth <= 1e-9) return null;
  const halfHeight = Math.tan((fovDegrees * Math.PI) / 360);
  const sx = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / depth / (halfHeight * (width / height));
  const sy = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / depth / halfHeight;
  return { x: (sx * 0.5 + 0.5) * width, y: (0.5 - sy * 0.5) * height, depth };
}
