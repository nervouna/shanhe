/**
 * Sea and lakes: one flat mesh at the water level of every water hex,
 * reaching a little way under the neighbouring land so that the shoreline
 * is where the ground rises through it. The shader reads the ground height
 * from a texture, so depth colour, the surf and the foam follow the real
 * shore at every pixel; ripples drift over it and it mirrors the sky.
 */

import {
  cameraPosition,
  color,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  vec2,
  vec3,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  RedFormat,
} from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { hexNeighbor, worldToHex } from '../shared/hex.ts';
import { mapWorldRect, sampleHeight } from './heightField.ts';
import type { Surface } from './heightField.ts';
import { cloudShade, mapUv, noiseTile, withFogOfWar, withGrid } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface Water {
  readonly object: Mesh;
  dispose(): void;
}

/** Mesh cells across the width of one hex. */
const CELLS_PER_HEX = 3;

function buildGeometry(surface: Surface): BufferGeometry {
  const { map, field, waterLevel } = surface;
  const layout = map.projection.hexLayout;
  const rect = mapWorldRect(map);
  const cell = (Math.sqrt(3) * layout.size) / CELLS_PER_HEX;
  const cols = Math.ceil((rect.maxX - rect.minX) / cell) + 1;
  const rows = Math.ceil((rect.maxZ - rect.minZ) / cell) + 1;

  /** Water level at a point: that of its hex, or of a water hex next to it. */
  const levelAt = (x: number, z: number): number => {
    const hex = worldToHex({ x, z }, layout);
    let found = Number.NaN;
    for (let d = -1; d < 6; d++) {
      const h = d < 0 ? hex : hexNeighbor(hex, d);
      if (h.col < 0 || h.col >= map.width || h.row < 0 || h.row >= map.height) continue;
      const level = waterLevel[h.row * map.width + h.col] as number;
      if (Number.isNaN(level)) continue;
      if (d < 0) return level;
      // next to both a lake and the sea, the higher water wins
      found = Number.isNaN(found) ? level : Math.max(found, level);
    }
    return found;
  };

  const levels = new Float32Array(cols * rows);
  const depths = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const z = rect.minZ + ((rect.maxZ - rect.minZ) * j) / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const x = rect.minX + ((rect.maxX - rect.minX) * i) / (cols - 1);
      const level = levelAt(x, z);
      levels[j * cols + i] = level;
      depths[j * cols + i] = level - sampleHeight(field, x, z);
    }
  }

  // only the cells that hold water become triangles
  const vertexOf = new Int32Array(cols * rows).fill(-1);
  const positions: number[] = [];
  const depth: number[] = [];
  const indices: number[] = [];
  const vertex = (i: number, j: number): number => {
    const k = j * cols + i;
    let v = vertexOf[k] as number;
    if (v < 0) {
      v = positions.length / 3;
      vertexOf[k] = v;
      positions.push(
        rect.minX + ((rect.maxX - rect.minX) * i) / (cols - 1),
        levels[k] as number,
        rect.minZ + ((rect.maxZ - rect.minZ) * j) / (rows - 1),
      );
      depth.push(depths[k] as number);
    }
    return v;
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const corners = [j * cols + i, j * cols + i + 1, (j + 1) * cols + i, (j + 1) * cols + i + 1];
      if (corners.some((k) => Number.isNaN(levels[k] as number))) continue;
      if (corners.every((k) => (depths[k] as number) <= 0)) continue;
      const a = vertex(i, j);
      const b = vertex(i + 1, j);
      const c = vertex(i, j + 1);
      const d = vertex(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('depth', new BufferAttribute(new Float32Array(depth), 1));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Samples across the ground-height texture at most; the heightmap is finer than the water needs. */
const DEPTH_TEXTURE_WIDTH = 1024;

/** The ground heights as a texture, so that the water knows its depth at every pixel. */
function createGroundTexture(surface: Surface): DataTexture {
  const { field } = surface;
  const step = Math.max(1, Math.ceil(field.cols / DEPTH_TEXTURE_WIDTH));
  const width = Math.floor((field.cols - 1) / step) + 1;
  const height = Math.floor((field.rows - 1) / step) + 1;
  const data = new Uint16Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      data[j * width + i] = DataUtils.toHalfFloat(field.heights[j * step * field.cols + i * step] as number);
    }
  }
  const ground = new DataTexture(data, width, height, RedFormat, HalfFloatType);
  ground.magFilter = LinearFilter;
  ground.minFilter = LinearFilter;
  ground.wrapS = ClampToEdgeWrapping;
  ground.wrapT = ClampToEdgeWrapping;
  ground.generateMipmaps = false;
  ground.flipY = false;
  ground.needsUpdate = true;
  ground.userData = { step };
  return ground;
}

function createMaterial(u: MapUniforms, surface: Surface, ground: DataTexture, environment: Texture): MeshStandardNodeMaterial {
  const { field } = surface;
  const xz = positionWorld.xz;
  const p = xz.div(u.hexSize);
  // the texture holds every `step`-th sample: its last one may lie short of the field's edge
  const step = (ground.userData as { step: number }).step;
  const spanX = ((field.rect.maxX - field.rect.minX) * (ground.image.width - 1) * step) / (field.cols - 1);
  const spanZ = ((field.rect.maxZ - field.rect.minZ) * (ground.image.height - 1) * step) / (field.rows - 1);
  const groundUv = vec2(
    xz.x.sub(field.rect.minX).div(spanX).mul((ground.image.width - 1) / ground.image.width).add(0.5 / ground.image.width),
    xz.y.sub(field.rect.minZ).div(spanZ).mul((ground.image.height - 1) / ground.image.height).add(0.5 / ground.image.height),
  );
  const depthMetres = positionWorld.y.sub(texture(ground, groundUv).r).div(u.unitsPerMetre);

  // two layers of ripples drifting across each other tilt the normal
  const slow = noiseTile(u, p.div(3.1).add(vec2(u.clock.mul(0.011), u.clock.mul(0.006))));
  const fast = noiseTile(u, p.div(0.9).sub(vec2(u.clock.mul(0.03), u.clock.mul(-0.017))));
  const tilt = vec2(slow.r, slow.g).sub(0.5).mul(0.2).add(vec2(fast.g, fast.b).sub(0.5).mul(0.11));
  const normal = normalize(vec3(tilt.x, 1, tilt.y));

  // colour by depth: pale over the shelf, turquoise in the shallows, navy in the deep
  const deep = float(1).sub(exp(depthMetres.max(0).div(-650)));
  const shelf = float(1).sub(exp(depthMetres.max(0).div(-45)));
  let water = mix(color(0x4aa6a8), color(0x27798f), shelf);
  water = mix(water, color(0x0a2e55), deep);

  // the sky mirrored at grazing angles
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1).sub(saturate(dot(toCamera, normal))), 3);
  water = mix(water, color(0xc3d8ea), fresnel.mul(0.4));

  // waves run up the shore one after the other and break into foam
  const breakup = slow.b.mul(0.5).add(fast.r.mul(0.5));
  const surf = sin(depthMetres.mul(0.42).add(u.clock.mul(1.1)).add(breakup.mul(5))).mul(0.5).add(0.5);
  const nearShore = float(1).sub(smoothstep(0, 22, depthMetres));
  const swash = float(1).sub(smoothstep(0, 3.5, depthMetres));
  const foam = saturate(
    nearShore.mul(smoothstep(0.62, 0.9, surf.mul(0.7).add(breakup.mul(0.45)))).add(swash.mul(breakup.mul(0.6).add(0.4))),
  );
  water = mix(water, vec3(0.93, 0.96, 0.97), foam.mul(0.85));
  // whitecaps far out, where the swell is highest
  const caps = smoothstep(0.8, 0.92, slow.r.mul(0.55).add(fast.b.mul(0.45))).mul(deep).mul(0.35);
  water = mix(water, vec3(0.9, 0.94, 0.97), caps);

  let shaded = vec3(water).mul(cloudShade(u, xz));
  shaded = withGrid(u, shaded, xz);
  shaded = withFogOfWar(shaded, texture(u.textures.fog, mapUv(u, xz)).r);

  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(shaded);
  material.opacityNode = saturate(
    smoothstep(0, 4, depthMetres).mul(mix(float(0.55), float(0.97), max(deep, shelf.mul(0.6)))).add(foam.mul(0.6)),
  );
  material.normalNode = transformNormalToView(normal);
  material.roughnessNode = mix(float(0.1), float(0.55), saturate(foam.add(caps)));
  material.metalness = 0;
  material.envMap = environment;
  material.envMapIntensity = 0.3;
  material.transparent = true;
  material.depthWrite = false;
  return material;
}

/**
 * @param environment the sky, which the water mirrors.
 */
export function createWater(surface: Surface, uniforms: MapUniforms, environment: Texture): Water {
  const geometry = buildGeometry(surface);
  const ground = createGroundTexture(surface);
  const material = createMaterial(uniforms, surface, ground, environment);
  const object = new Mesh(geometry, material);
  object.name = 'water';
  object.receiveShadow = true;
  object.renderOrder = 1;
  return {
    object,
    dispose() {
      geometry.dispose();
      material.dispose();
      ground.dispose();
    },
  };
}
