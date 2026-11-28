/**
 * Draws lists of parts (`cityGen.ts`): every part is an instance of one of
 * six shapes. The parts are sorted into square regions of the map, each
 * with one instanced mesh per shape, so that what is out of view is not
 * drawn and a whole region of cities costs six draw calls.
 */

import { attribute, float, mix, positionGeometry, positionWorld, texture, vec3 } from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Sphere,
  Vector3,
} from 'three/webgpu';
import { PART_SHAPE_COUNT, PartShape } from './cityGen.ts';
import type { Part, PartShapeId } from './cityGen.ts';
import { cloudShade, mapUv, noiseTile, withFogOfWar } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';
import { ShapeBuilder } from './shapes.ts';

export interface PartBatch {
  readonly object: Group;
  /** Replaces what is drawn. The parts are in world coordinates and world units. */
  set(parts: readonly Part[]): void;
  /** Parts now drawn. */
  readonly count: number;
  dispose(): void;
}

const WHITE = [1, 1, 1] as const;

/** The six shapes, one unit wide, deep and high, standing on `y = 0`. */
export function buildPartShape(shape: PartShapeId): ShapeBuilder {
  const b = new ShapeBuilder();
  switch (shape) {
    case PartShape.Box:
      b.box(-0.5, 0, -0.5, 0.5, 1, 0.5, WHITE);
      break;
    case PartShape.Hip: {
      const apex = [0, 1, 0];
      const corners = [
        [-0.5, 0, 0.5],
        [0.5, 0, 0.5],
        [0.5, 0, -0.5],
        [-0.5, 0, -0.5],
      ];
      for (let i = 0; i < 4; i++) b.triangle(corners[i] as number[], corners[(i + 1) % 4] as number[], apex, WHITE);
      break;
    }
    case PartShape.Gable: {
      const a = [-0.5, 1, 0];
      const c = [0.5, 1, 0];
      b.triangle([-0.5, 0, 0.5], [0.5, 0, 0.5], c, WHITE);
      b.triangle([-0.5, 0, 0.5], c, a, WHITE);
      b.triangle([0.5, 0, -0.5], [-0.5, 0, -0.5], a, WHITE);
      b.triangle([0.5, 0, -0.5], a, c, WHITE);
      b.triangle([0.5, 0, 0.5], [0.5, 0, -0.5], c, WHITE);
      b.triangle([-0.5, 0, -0.5], [-0.5, 0, 0.5], a, WHITE);
      break;
    }
    case PartShape.Cylinder:
      b.frustum(0, 0, 0, 1, 0.5, 0.5, 10, WHITE);
      break;
    case PartShape.Cone:
      b.frustum(0, 0, 0, 1, 0.5, 0, 10, WHITE);
      break;
    case PartShape.Dome:
      b.blob(0, 0, 0, 0.5, 1, 10, 3, WHITE, WHITE, 0.5);
      break;
  }
  return b;
}

function toGeometry(shape: ShapeBuilder): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(shape.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(shape.normals), 3));
  geometry.setIndex(shape.indices);
  return geometry;
}

/** Side of a region, in hex sizes. */
const REGION = 14;

export function createPartBatch(u: MapUniforms, hexSize: number, name: string): PartBatch {
  const object = new Group();
  object.name = name;
  const shapes: BufferGeometry[] = [];
  for (let shape = 0; shape < PART_SHAPE_COUNT; shape++) shapes.push(toGeometry(buildPartShape(shape as PartShapeId)));

  const material = new MeshStandardNodeMaterial();
  const block = attribute('blockColor', 'vec3');
  const glow = attribute('blockGlow', 'float');
  // darker at the foot, weathered, and lit windows as a speckle
  const weathering = noiseTile(u, positionWorld.xz.div(u.hexSize).mul(3.1).add(positionWorld.y.div(u.hexSize).mul(5.3))).r;
  const body = block.mul(mix(float(0.8), float(1.04), positionGeometry.y)).mul(weathering.mul(0.16).add(0.92));
  const xz = positionWorld.xz;
  material.colorNode = withFogOfWar(vec3(body.mul(cloudShade(u, xz))), texture(u.textures.fog, mapUv(u, xz)).r);
  const windows = noiseTile(u, vec3(positionWorld).xy.add(positionWorld.zz).div(u.hexSize).mul(9)).g;
  material.emissiveNode = vec3(block.mul(glow).mul(windows.mul(1.4).add(0.1)));
  material.roughness = 0.82;
  material.metalness = 0;

  let meshes: InstancedMesh[] = [];
  let count = 0;
  const clear = (): void => {
    for (const mesh of meshes) {
      object.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    meshes = [];
  };

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const euler = new Euler();
  const position = new Vector3();
  const scale = new Vector3();
  const tint = new Color();

  return {
    object,
    get count() {
      return count;
    },
    set(parts) {
      clear();
      count = parts.length;
      // by region and shape
      const groups = new Map<string, Part[]>();
      const side = REGION * hexSize;
      for (const part of parts) {
        const key = `${Math.floor(part.x / side)}:${Math.floor(part.z / side)}:${part.shape}`;
        const list = groups.get(key);
        if (list === undefined) groups.set(key, [part]);
        else list.push(part);
      }
      for (const list of groups.values()) {
        const first = list[0] as Part;
        const geometry = (shapes[first.shape] as BufferGeometry).clone();
        const colors = new Float32Array(list.length * 3);
        const glows = new Float32Array(list.length);
        const mesh = new InstancedMesh(geometry, material, list.length);
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        list.forEach((part, i) => {
          rotation.setFromEuler(euler.set(0, part.yaw, 0));
          matrix.compose(position.set(part.x, part.y, part.z), rotation, scale.set(part.w, part.h, part.d));
          mesh.setMatrixAt(i, matrix);
          tint.setHex(part.color);
          colors[i * 3] = tint.r;
          colors[i * 3 + 1] = tint.g;
          colors[i * 3 + 2] = tint.b;
          glows[i] = part.glow ?? 0;
          const reach = Math.max(part.w, part.d);
          minX = Math.min(minX, part.x - reach);
          maxX = Math.max(maxX, part.x + reach);
          minZ = Math.min(minZ, part.z - reach);
          maxZ = Math.max(maxZ, part.z + reach);
          minY = Math.min(minY, part.y);
          maxY = Math.max(maxY, part.y + part.h);
        });
        geometry.setAttribute('blockColor', new InstancedBufferAttribute(colors, 3));
        geometry.setAttribute('blockGlow', new InstancedBufferAttribute(glows, 1));
        // the instances' own bounds, so that a region out of view is skipped
        const centre = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        mesh.boundingSphere = new Sphere(centre, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
        geometry.boundingSphere = mesh.boundingSphere.clone();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        meshes.push(mesh);
        object.add(mesh);
      }
    },
    dispose() {
      clear();
      for (const geometry of shapes) geometry.dispose();
      material.dispose();
    },
  };
}
