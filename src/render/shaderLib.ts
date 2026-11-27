/**
 * Shader building blocks shared by the materials, written in TSL so that
 * they compile for both WebGPU and the WebGL fallback.
 */

import {
  abs,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  fwidth,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalView,
  normalize,
  positionView,
  select,
  sign,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node, UniformNode } from 'three/webgpu';
import { Vector2, Vector4 } from 'three/webgpu';
import type { HexLayout } from '../shared/hex.ts';
import type { WorldRect } from '../shared/mapData.ts';
import type { MapTextures } from './mapTextures.ts';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;

/** Uniforms every map material reads. One set is shared, so one write updates all. */
export interface MapUniforms {
  /** `minX`, `minZ`, `1 / spanX`, `1 / spanZ` of the rectangle the map textures cover. */
  readonly mapRect: UniformNode<'vec4'>;
  /** Origin of the hex grid. */
  readonly hexOrigin: UniformNode<'vec2'>;
  /** Hex size: centre to corner. */
  readonly hexSize: UniformNode<'float'>;
  /** 1 when the hex grid overlay is shown, else 0. */
  readonly gridOpacity: UniformNode<'float'>;
  /** How strongly territory tints the ground, 0 to 1. */
  readonly tintStrength: UniformNode<'float'>;
  /** How far the ground has turned into the political map, 0 to 1. */
  readonly political: UniformNode<'float'>;
  /** Width added to the territory borders so that they stay visible from far away, in world units. */
  readonly borderExtra: UniformNode<'float'>;
  /** World units of height per metre. */
  readonly unitsPerMetre: UniformNode<'float'>;
  readonly textures: MapTextures;
}

export function createMapUniforms(
  rect: WorldRect,
  layout: HexLayout,
  unitsPerMetre: number,
  textures: MapTextures,
): MapUniforms {
  return {
    mapRect: uniform(
      new Vector4(rect.minX, rect.minZ, 1 / (rect.maxX - rect.minX), 1 / (rect.maxZ - rect.minZ)),
    ),
    hexOrigin: uniform(new Vector2(layout.originX, layout.originZ)),
    hexSize: uniform(layout.size),
    gridOpacity: uniform(0),
    tintStrength: uniform(0.2),
    political: uniform(0),
    borderExtra: uniform(0),
    unitsPerMetre: uniform(unitsPerMetre),
    textures,
  };
}

/** Texture coordinates of a ground point in the map textures. */
export function mapUv(u: MapUniforms, xz: Vec2): Vec2 {
  return vec2(xz.sub(u.mapRect.xy).mul(u.mapRect.zw));
}

/** Smooth noise in -1..1. */
export function noise(p: Vec2 | Vec3): Float {
  return mx_noise_float(p);
}

/** Fractal noise, roughly in -1..1. */
export function fbm(p: Vec2 | Vec3, octaves = 4): Float {
  return mx_fractal_noise_float(p, octaves, 2.03, 0.5);
}

/** `a - b * floor(a / b)`: the same on both backends for negative `a`. */
function wrap(a: Vec2, b: Vec2): Vec2 {
  return a.sub(b.mul(floor(a.div(b))));
}

/**
 * Distance from a ground point to the centre of its hex across the nearest
 * edge, as a fraction of the way: 0 at the centre, 1 on the edge.
 */
export function hexEdgeDistance(u: MapUniforms, xz: Vec2): Float {
  const SQRT3 = Math.sqrt(3);
  // in units of the hex size; pointy-top centres form two rectangular lattices
  const p = xz.sub(u.hexOrigin).div(u.hexSize);
  const period = vec2(SQRT3, 3);
  const half = period.mul(0.5);
  const a = wrap(p.add(half), period).sub(half);
  const b = wrap(p, period).sub(half);
  const useA = dot(a, a).lessThan(dot(b, b));
  const local = abs(vec2(select(useA, a.x, b.x), select(useA, a.y, b.y)));
  const reach = max(local.x, local.x.mul(0.5).add(local.y.mul(SQRT3 / 2)));
  return float(reach.div(SQRT3 / 2));
}

/** Opacity of the hex grid overlay at a ground point, anti-aliased at any zoom. */
export function hexGridLine(u: MapUniforms, xz: Vec2): Float {
  const d = hexEdgeDistance(u, xz);
  const width = max(float(0.035), fwidth(d).mul(1.25));
  return smoothstep(float(1).sub(width), float(1).sub(width.mul(0.35)), d).mul(u.gridOpacity);
}

/** Lays the hex grid overlay over a colour. */
export function withGrid(u: MapUniforms, color: Vec3, xz: Vec2): Vec3 {
  return mix(color, vec3(0.04, 0.05, 0.06), hexGridLine(u, xz).mul(0.42));
}

/** Desaturates and dims a colour where the fog of war says the hex is not in view. */
export function withFogOfWar(color: Vec3, visibility: Float): Vec3 {
  const grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
  const dimmed = mix(vec3(grey), color, 0.35).mul(0.78);
  return mix(dimmed, color, visibility);
}

/**
 * The view-space normal of a surface whose height is raised by `height`
 * (in world units) over the mesh: relief without geometry.
 */
export function bumpedNormal(height: Float): Vec3 {
  const dpdx = dFdx(positionView);
  const dpdy = dFdy(positionView);
  const r1 = cross(dpdy, normalView);
  const r2 = cross(normalView, dpdx);
  const det = dot(dpdx, r1);
  const gradient = sign(det).mul(dFdx(height).mul(r1).add(dFdy(height).mul(r2)));
  return vec3(normalize(abs(det).mul(normalView).sub(gradient)));
}
