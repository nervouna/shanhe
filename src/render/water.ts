/**
 * Sea and lakes: one flat mesh at the water level of every water hex,
 * reaching a little way under the neighbouring land so that the shoreline
 * is where the ground rises through it. Colour follows the depth of the
 * ground below; waves are animated in the shader.
 */

import {
  attribute,
  cameraPosition,
  color,
  dot,
  exp,
  float,
  mix,
  mx_noise_vec3,
  normalize,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  texture,
  time,
  transformNormalToView,
  vec3,
} from 'three/tsl';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardNodeMaterial } from 'three/webgpu';
import { hexNeighbor, worldToHex } from '../shared/hex.ts';
import { mapWorldRect, sampleHeight } from './heightField.ts';
import type { Surface } from './heightField.ts';
import { mapUv, noise, withFogOfWar, withGrid } from './shaderLib.ts';
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

function createMaterial(u: MapUniforms): MeshStandardNodeMaterial {
  const xz = positionWorld.xz;
  const p = xz.div(u.hexSize);
  const depthMetres = attribute('depth', 'float').div(u.unitsPerMetre);

  // two layers of drifting ripples tilt the normal
  const slow = mx_noise_vec3(vec3(p.mul(4.5), time.mul(0.3)));
  const fast = mx_noise_vec3(vec3(p.mul(12).add(5.3), time.mul(0.55)));
  const tilt = slow.xy.mul(0.1).add(fast.xy.mul(0.05));
  const normal = normalize(vec3(tilt.x, 1, tilt.y));

  const deep = float(1).sub(exp(depthMetres.max(0).div(-650)));
  let water = mix(color(0x3a9aa3), color(0x0a2e55), deep);

  // the sky mirrored at grazing angles
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1).sub(saturate(dot(toCamera, normal))), 3);
  water = mix(water, color(0xc3d8ea), fresnel.mul(0.55));

  // foam where the water runs out against the shore
  const surf = sin(depthMetres.mul(0.5).sub(time.mul(1.4))).mul(0.25);
  const breakup = noise(vec3(p.mul(8), time.mul(0.25))).mul(0.5).add(0.5);
  const foam = float(1)
    .sub(smoothstep(0, 16, depthMetres))
    .mul(smoothstep(0.35, 0.8, breakup.add(surf)));
  water = mix(water, vec3(0.93, 0.96, 0.97), foam.mul(0.8));

  let surface = withGrid(u, vec3(water), xz);
  surface = withFogOfWar(surface, texture(u.textures.fog, mapUv(u, xz)).r);

  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(surface);
  material.opacityNode = saturate(
    smoothstep(0, 5, depthMetres).mul(mix(float(0.62), float(0.97), deep)).add(foam.mul(0.5)),
  );
  material.normalNode = transformNormalToView(normal);
  material.roughness = 0.16;
  material.metalness = 0;
  material.transparent = true;
  material.depthWrite = false;
  return material;
}

export function createWater(surface: Surface, uniforms: MapUniforms): Water {
  const geometry = buildGeometry(surface);
  const material = createMaterial(uniforms);
  const object = new Mesh(geometry, material);
  object.name = 'water';
  object.receiveShadow = true;
  object.renderOrder = 1;
  return {
    object,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
