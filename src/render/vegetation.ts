/**
 * Trees. The map is cut into chunks of a few hexes; the trees of a chunk
 * are merged into one mesh when the camera first comes near it, in a
 * detailed version close by and a coarse one farther off. Beyond a range
 * they sink into the ground, where the ground shader's forest colour and
 * relief take over, and chunks out of range are not drawn at all.
 */

import { attribute, float, positionLocal, smoothstep, texture, uniform, vec3 } from 'three/tsl';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu';
import { hexToWorld } from '../shared/hex.ts';
import { latitudeTerms, sinLatitudeAt, snowLineMetres } from './climate.ts';
import { sampleHeight, unitsPerMetre } from './heightField.ts';
import type { Surface } from './heightField.ts';
import { cloudShade, mapUv, withFogOfWar } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';
import { castGroundShadow } from './shadowLayers.ts';
import { TREE_FAMILY_COUNT, createTreePlacer } from './treePlacement.ts';
import type { TreeFamilyId } from './treePlacement.ts';
import { buildTreeShape } from './treeShapes.ts';
import type { ShapeBuilder } from './shapes.ts';

export interface Vegetation {
  readonly object: Group;
  /**
   * Shows the chunks in range of the camera and builds the ones that are new.
   *
   * @returns `changed`: whether trees that stand tall enough to cast a shadow
   *   appeared or disappeared (a chunk at the edge of the range, whose trees
   *   are still sunk into the ground, does not count, nor does a change of
   *   detail); `builds`: the meshes built in this call; `trees`: the trees now drawn.
   */
  update(
    cameraPosition: Vector3,
    maxBuilds?: number,
  ): { readonly changed: boolean; readonly builds: number; readonly trees: number };
  dispose(): void;
}

/** Hexes along each side of a chunk. */
const CHUNK_HEXES = 6;
/** Trees stand up to this far from the camera, in hex sizes; they sink into the ground over the last third. */
export const TREE_RANGE = 40;
/** Within this distance a chunk gets the detailed trees. */
const DETAIL_RANGE = 15;
/** A chunk's meshes are freed once it is this far out of range, as a multiple of the range. */
const KEEP_RANGE = 2.2;
const BUILDS_PER_FRAME = 2;
/** Ground steeper than this (rise over run, as drawn) is bare rock. */
const MAX_SLOPE = 2.4;

interface Chunk {
  readonly hexes: readonly number[];
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  detailed: Mesh | null;
  coarse: Mesh | null;
  /** Trees in each version; 0 until it is built. */
  detailedTrees: number;
  coarseTrees: number;
}

export function createVegetation(surface: Surface, u: MapUniforms): Vegetation {
  const { map, field } = surface;
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const terms = latitudeTerms(map.projection);
  const placer = createTreePlacer(map, terms);
  const perMetre = unitsPerMetre(map);
  const object = new Group();
  object.name = 'vegetation';

  const shapes: ShapeBuilder[][] = [];
  for (let family = 0; family < TREE_FAMILY_COUNT; family++) {
    shapes.push([buildTreeShape(family as TreeFamilyId, false), buildTreeShape(family as TreeFamilyId, true)]);
  }

  // the camera of the picture, also while the shadow map is drawn
  const viewPosition = uniform(new Vector3());
  const lift = attribute('lift', 'float');
  const away = positionLocal.sub(viewPosition).length().div(u.hexSize);
  const sunk = smoothstep(TREE_RANGE * 0.66, TREE_RANGE * 0.97, away);
  const material = new MeshStandardNodeMaterial();
  material.positionNode = positionLocal.sub(vec3(0, lift.mul(sunk), 0));
  const xz = positionLocal.xz;
  const lit = vec3(attribute('color', 'vec3')).mul(cloudShade(u, xz));
  material.colorNode = withFogOfWar(lit, texture(u.textures.fog, mapUv(u, xz)).r);
  material.roughnessNode = float(0.86);
  material.metalness = 0;

  // which hexes grow anything, by chunk
  const chunks: Chunk[] = [];
  for (let row0 = 0; row0 < map.height; row0 += CHUNK_HEXES) {
    for (let col0 = 0; col0 < map.width; col0 += CHUNK_HEXES) {
      const hexes: number[] = [];
      for (let row = row0; row < Math.min(row0 + CHUNK_HEXES, map.height); row++) {
        for (let col = col0; col < Math.min(col0 + CHUNK_HEXES, map.width); col++) {
          const index = row * map.width + col;
          if (placer.growth(index).count > 0) hexes.push(index);
        }
      }
      if (hexes.length === 0) continue;
      const a = hexToWorld({ col: col0, row: row0 }, layout);
      const b = hexToWorld(
        { col: Math.min(col0 + CHUNK_HEXES, map.width) - 1, row: Math.min(row0 + CHUNK_HEXES, map.height) - 1 },
        layout,
      );
      chunks.push({
        hexes,
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2,
        radius: Math.hypot(b.x - a.x, b.z - a.z) / 2 + 1.5 * size,
        detailed: null,
        coarse: null,
        detailedTrees: 0,
        coarseTrees: 0,
      });
    }
  }

  const build = (chunk: Chunk, detailed: boolean): Mesh => {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const lifts: number[] = [];
    const indices: number[] = [];
    let trees = 0;
    const step = 0.08 * size;
    for (const hex of chunk.hexes) {
      const all = placer.trees(hex);
      for (let t = 0; t < all.length; t++) {
        // the coarse version keeps every other tree and makes it a little larger
        if (!detailed && t % 2 === 1) continue;
        const tree = all[t];
        if (tree === undefined) continue;
        const y = sampleHeight(field, tree.x, tree.z);
        // no trees in the water, on cliffs or above the snow line
        if (y <= 0) continue;
        const slope =
          Math.hypot(
            sampleHeight(field, tree.x + step, tree.z) - sampleHeight(field, tree.x - step, tree.z),
            sampleHeight(field, tree.x, tree.z + step) - sampleHeight(field, tree.x, tree.z - step),
          ) /
          (2 * step);
        if (slope > MAX_SLOPE) continue;
        if (y / perMetre > snowLineMetres(sinLatitudeAt(terms, tree.x, tree.z)) + 200) continue;

        const shape = (shapes[tree.family] as ShapeBuilder[])[detailed ? 1 : 0] as ShapeBuilder;
        const scale = tree.height * (detailed ? 1 : 1.3);
        const cos = Math.cos(tree.yaw);
        const sin = Math.sin(tree.yaw);
        const base = positions.length / 3;
        for (let v = 0; v < shape.vertexCount; v++) {
          const px = shape.positions[v * 3] as number;
          const py = shape.positions[v * 3 + 1] as number;
          const pz = shape.positions[v * 3 + 2] as number;
          positions.push(tree.x + (px * cos + pz * sin) * scale, y + py * scale, tree.z + (pz * cos - px * sin) * scale);
          const nx = shape.normals[v * 3] as number;
          const nz = shape.normals[v * 3 + 2] as number;
          normals.push(nx * cos + nz * sin, shape.normals[v * 3 + 1] as number, nz * cos - nx * sin);
          colors.push(
            (shape.colors[v * 3] as number) * tree.tint,
            (shape.colors[v * 3 + 1] as number) * tree.tint,
            (shape.colors[v * 3 + 2] as number) * tree.tint,
          );
          lifts.push(py * scale);
        }
        for (const i of shape.indices) indices.push(base + i);
        trees++;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute('lift', new BufferAttribute(new Float32Array(lifts), 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    castGroundShadow(mesh);
    mesh.receiveShadow = true;
    mesh.visible = false;
    object.add(mesh);
    if (detailed) chunk.detailedTrees = trees;
    else chunk.coarseTrees = trees;
    return mesh;
  };

  const free = (mesh: Mesh | null): void => {
    if (mesh === null) return;
    object.remove(mesh);
    mesh.geometry.dispose();
  };

  const show = (mesh: Mesh | null, wanted: boolean): boolean => {
    // a chunk whose trees all fell to water, cliffs or snow has nothing to draw
    const visible = wanted && mesh !== null && mesh.geometry.getAttribute('position').count > 0;
    if (mesh === null || mesh.visible === visible) return false;
    mesh.visible = visible;
    return true;
  };

  return {
    object,
    update(cameraPosition, maxBuilds = BUILDS_PER_FRAME) {
      viewPosition.value.copy(cameraPosition);
      const range = TREE_RANGE * size;
      let changed = false;
      let builds = 0;
      let trees = 0;
      for (const chunk of chunks) {
        const flat = Math.hypot(chunk.x - cameraPosition.x, chunk.z - cameraPosition.z);
        // the camera's height counts: from high up nothing is in range
        const distance = Math.hypot(Math.max(flat - chunk.radius, 0), cameraPosition.y);
        // inside this distance the trees stand: what happens farther out casts no shadow
        const standing = distance < range * 0.7;
        if (distance > range) {
          show(chunk.detailed, false);
          show(chunk.coarse, false);
          if (distance > range * KEEP_RANGE && (chunk.detailed !== null || chunk.coarse !== null)) {
            free(chunk.detailed);
            free(chunk.coarse);
            chunk.detailed = null;
            chunk.coarse = null;
          }
          continue;
        }
        const wantDetailed = Math.hypot(flat, cameraPosition.y) < DETAIL_RANGE * size + chunk.radius;
        let wanted = wantDetailed ? chunk.detailed : chunk.coarse;
        if (wanted === null && builds < maxBuilds) {
          wanted = build(chunk, wantDetailed);
          if (wantDetailed) chunk.detailed = wanted;
          else chunk.coarse = wanted;
          builds++;
        }
        // until the wanted version is built, the other one stays
        const other = wantDetailed ? chunk.coarse : chunk.detailed;
        if (wanted !== null) {
          const wasShown = other?.visible === true;
          if (show(wanted, true) && standing && !wasShown) changed = true;
          show(other, false);
          trees += wantDetailed ? chunk.detailedTrees : chunk.coarseTrees;
        } else if (other?.visible === true) {
          trees += wantDetailed ? chunk.coarseTrees : chunk.detailedTrees;
        }
      }
      return { changed, builds, trees };
    },
    dispose() {
      for (const chunk of chunks) {
        free(chunk.detailed);
        free(chunk.coarse);
      }
      material.dispose();
    },
  };
}
