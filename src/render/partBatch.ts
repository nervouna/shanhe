/**
 * Draws lists of parts (`cityGen.ts`): every part is an instance of one of
 * six shapes. The parts are sorted into square regions of the map, each
 * with one instanced mesh per shape, so that what is out of view is not
 * drawn and a whole region of cities costs six draw calls.
 *
 * The parts belong to items (a city, the buildings of a hex). When an item
 * changes, the instances of its region are written again into the meshes
 * the region already has; a mesh is made only when a region gets a shape
 * for the first time or outgrows the room its mesh has.
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
import { createPartRegions } from './keyed.ts';
import type { GroundArea } from './keyed.ts';
import { releaseMesh } from './release.ts';
import { cloudShade, mapUv, noiseTile, withFogOfWar } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';
import { castGroundShadow } from './shadowLayers.ts';
import { ShapeBuilder } from './shapes.ts';

/** What one call of {@link PartBatch.update} did. */
export interface PartBatchUpdate {
  /** Regions whose meshes were written again. */
  readonly regions: number;
  /** The ground that the parts that went and the parts that came stand on: their shadows changed. */
  readonly areas: readonly GroundArea[];
}

export interface PartBatch {
  readonly object: Group;
  /**
   * Gives items their parts, in world coordinates and world units, or takes
   * them away with `null`. Items that are not named stay as they are, and so
   * do the meshes of the regions none of the named items stands in.
   */
  update(changes: Iterable<readonly [id: number, parts: readonly Part[] | null]>): PartBatchUpdate;
  /** Parts now drawn. */
  readonly count: number;
  /** Instanced meshes made since the start: a mesh is made when a region first has a shape or outgrows its mesh. */
  readonly meshBuilds: number;
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
/** The least number of instances a mesh is made for; it doubles from there. */
const MIN_CAPACITY = 16;

/** One shape in one region: an instanced mesh with room for `capacity` parts. */
interface Slot {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  readonly colors: InstancedBufferAttribute;
  readonly glows: InstancedBufferAttribute;
}

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

  const regions = createPartRegions(REGION * hexSize);
  /** The meshes of each region, by shape; `null` where the region has no part of that shape yet. */
  const slots = new Map<string, (Slot | null)[]>();
  let meshBuilds = 0;

  const allocate = (shape: number, capacity: number): Slot => {
    const geometry = (shapes[shape] as BufferGeometry).clone();
    const colors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const glows = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('blockColor', colors);
    geometry.setAttribute('blockGlow', glows);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.boundingSphere = new Sphere();
    geometry.boundingSphere = new Sphere();
    castGroundShadow(mesh);
    mesh.receiveShadow = true;
    object.add(mesh);
    meshBuilds++;
    return { mesh, capacity, colors, glows };
  };

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const euler = new Euler();
  const position = new Vector3();
  const scale = new Vector3();
  const tint = new Color();

  /** Writes a region's parts of one shape into its mesh, which is made or enlarged if it has to be. */
  const fill = (list: readonly Part[], shape: number, old: Slot | null): Slot | null => {
    if (list.length === 0) {
      // an empty mesh stays, hidden: the region may fill again
      if (old !== null) {
        old.mesh.count = 0;
        old.mesh.visible = false;
      }
      return old;
    }
    let slot = old;
    if (slot === null || slot.capacity < list.length) {
      if (slot !== null) releaseMesh(slot.mesh);
      let capacity = MIN_CAPACITY;
      while (capacity < list.length) capacity *= 2;
      slot = allocate(shape, capacity);
    }
    const { mesh, colors, glows } = slot;
    const tints = colors.array as Float32Array;
    const lights = glows.array as Float32Array;
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
      tints[i * 3] = tint.r;
      tints[i * 3 + 1] = tint.g;
      tints[i * 3 + 2] = tint.b;
      lights[i] = part.glow ?? 0;
      const reach = Math.max(part.w, part.d);
      minX = Math.min(minX, part.x - reach);
      maxX = Math.max(maxX, part.x + reach);
      minZ = Math.min(minZ, part.z - reach);
      maxZ = Math.max(maxZ, part.z + reach);
      minY = Math.min(minY, part.y);
      maxY = Math.max(maxY, part.y + part.h);
    });
    mesh.count = list.length;
    mesh.visible = true;
    // the instances' own bounds, so that a region out of view is skipped
    const sphere = mesh.boundingSphere as Sphere;
    sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    sphere.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    mesh.geometry.boundingSphere?.copy(sphere);
    mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    glows.needsUpdate = true;
    return slot;
  };

  /** The ground a region's meshes stand on. */
  const areasOf = (list: readonly (Slot | null)[], into: GroundArea[]): void => {
    for (const slot of list) {
      if (slot === null || slot.mesh.count === 0) continue;
      const sphere = slot.mesh.boundingSphere as Sphere;
      into.push({ x: sphere.center.x, z: sphere.center.z, radius: sphere.radius });
    }
  };

  return {
    object,
    get count() {
      return regions.count;
    },
    get meshBuilds() {
      return meshBuilds;
    },
    update(changes) {
      const areas: GroundArea[] = [];
      const dirty = regions.apply(changes);
      for (const region of dirty) {
        let list = slots.get(region);
        if (list === undefined) {
          list = new Array<Slot | null>(PART_SHAPE_COUNT).fill(null);
          slots.set(region, list);
        }
        // what stood there casts no shadow any more, what stands there now does
        areasOf(list, areas);
        const byShape = regions.byShape(region);
        for (let shape = 0; shape < PART_SHAPE_COUNT; shape++) {
          list[shape] = fill(byShape[shape] as Part[], shape, list[shape] as Slot | null);
        }
        areasOf(list, areas);
      }
      return { regions: dirty.length, areas };
    },
    dispose() {
      for (const list of slots.values()) {
        for (const slot of list) if (slot !== null) releaseMesh(slot.mesh);
      }
      slots.clear();
      for (const geometry of shapes) geometry.dispose();
      material.dispose();
    },
  };
}
