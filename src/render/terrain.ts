/**
 * The ground as one continuous height mesh, cut into square chunks. Every
 * chunk is drawn at a level of detail chosen by its distance from the
 * camera: level `n` uses every `2^n`-th height sample. Geometry is built
 * when a level is first needed, a few chunks per frame, and a skirt around
 * each chunk hides the cracks between neighbouring levels.
 */

import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three/webgpu';
import type { Material, Vector3 } from 'three/webgpu';
import type { HeightField } from './heightField.ts';

export interface Terrain {
  readonly object: Group;
  /**
   * Picks the level of detail of every chunk for a camera position.
   *
   * @param viewHeight height of the view at distance 1: `2 * tan(fov / 2)`.
   * @param maxBuilds finer geometries built in this call at most.
   */
  update(cameraPosition: Vector3, viewHeight: number, maxBuilds?: number): void;
  dispose(): void;
}

/** Target size of a triangle edge on screen, as a fraction of the view height. */
const EDGE_FRACTION = 0.012;
/** Finer geometry built per frame at most, so that zooming never stalls. */
const BUILDS_PER_FRAME = 2;
const MAX_CHUNKS = 400;

interface Chunk {
  readonly i0: number;
  readonly j0: number;
  readonly i1: number;
  readonly j1: number;
  readonly mesh: Mesh;
  readonly coarse: BufferGeometry;
  level: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** `from`, `from + step`, ... and always `to`. */
function steps(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i += step) out.push(i);
  out.push(to);
  return out;
}

function buildChunkGeometry(
  field: HeightField,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  step: number,
  floorY: number,
): BufferGeometry {
  const { cols, rows, rect, heights } = field;
  const cellX = (rect.maxX - rect.minX) / (cols - 1);
  const cellZ = (rect.maxZ - rect.minZ) / (rows - 1);
  const is = steps(i0, i1, step);
  const js = steps(j0, j1, step);
  const nx = is.length;
  const nz = js.length;
  const ring = 2 * (nx + nz) - 4;
  const vertexCount = nx * nz + ring;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  // the height of the surface, which the skirt keeps: the material colours
  // by it, so a skirt looks like the ground it hangs from
  const altitudes = new Float32Array(vertexCount);
  const height = (i: number, j: number): number =>
    heights[Math.min(Math.max(j, 0), rows - 1) * cols + Math.min(Math.max(i, 0), cols - 1)] as number;

  let v = 0;
  for (const j of js) {
    for (const i of is) {
      positions[v] = rect.minX + i * cellX;
      positions[v + 1] = height(i, j);
      positions[v + 2] = rect.minZ + j * cellZ;
      // slope over the spacing of this level, so coarse levels do not alias
      const sx = (height(i + step, j) - height(i - step, j)) / (2 * step * cellX);
      const sz = (height(i, j + step) - height(i, j - step)) / (2 * step * cellZ);
      const length = Math.hypot(sx, 1, sz);
      normals[v] = -sx / length;
      normals[v + 1] = 1 / length;
      normals[v + 2] = -sz / length;
      altitudes[v / 3] = positions[v + 1] as number;
      v += 3;
    }
  }

  // the skirt: the border vertices again, lowered and pushed outwards a
  // little, so that it also closes the pixel gaps where a fine chunk meets a
  // coarse one when seen from straight above. On the edge of the map it
  // goes down to the table the map stands on.
  const border: number[] = [];
  for (let a = 0; a < nx; a++) border.push(a);
  for (let b = 1; b < nz; b++) border.push(b * nx + nx - 1);
  for (let a = nx - 2; a >= 0; a--) border.push((nz - 1) * nx + a);
  for (let b = 1; b < nz - 1; b++) border.push((nz - 1 - b) * nx);
  const drop = step * Math.max(cellX, cellZ) * 1.5;
  const flare = step * Math.min(cellX, cellZ) * 0.2;
  for (const source of border) {
    const a = source % nx;
    const b = Math.floor(source / nx);
    const i = is[a] as number;
    const j = js[b] as number;
    const onMapEdge = i === 0 || i === cols - 1 || j === 0 || j === rows - 1;
    const outX = a === 0 ? -1 : a === nx - 1 ? 1 : 0;
    const outZ = b === 0 ? -1 : b === nz - 1 ? 1 : 0;
    positions[v] = (positions[source * 3] as number) + (onMapEdge ? 0 : outX * flare);
    positions[v + 1] = onMapEdge ? floorY : (positions[source * 3 + 1] as number) - drop;
    positions[v + 2] = (positions[source * 3 + 2] as number) + (onMapEdge ? 0 : outZ * flare);
    normals[v] = normals[source * 3] as number;
    normals[v + 1] = normals[source * 3 + 1] as number;
    normals[v + 2] = normals[source * 3 + 2] as number;
    altitudes[v / 3] = altitudes[source] as number;
    v += 3;
  }

  const indexCount = ((nx - 1) * (nz - 1) + ring) * 6;
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let n = 0;
  for (let b = 0; b < nz - 1; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const p = b * nx + a;
      indices[n++] = p;
      indices[n++] = p + nx;
      indices[n++] = p + 1;
      indices[n++] = p + 1;
      indices[n++] = p + nx;
      indices[n++] = p + nx + 1;
    }
  }
  const skirt = nx * nz;
  for (let k = 0; k < ring; k++) {
    const next = (k + 1) % ring;
    const top0 = border[k] as number;
    const top1 = border[next] as number;
    indices[n++] = top0;
    indices[n++] = top1;
    indices[n++] = skirt + k;
    indices[n++] = top1;
    indices[n++] = skirt + next;
    indices[n++] = skirt + k;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('altitude', new BufferAttribute(altitudes, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * @param floorY height of the table the map stands on; the sides of the map
 *   go down to it.
 */
export function createTerrain(field: HeightField, material: Material, floorY: number): Terrain {
  const { cols, rows, rect } = field;
  const cellX = (rect.maxX - rect.minX) / (cols - 1);
  const cellZ = (rect.maxZ - rect.minZ) / (rows - 1);
  const cell = Math.min(cellX, cellZ);

  let chunkCells = 64;
  while (Math.ceil((cols - 1) / chunkCells) * Math.ceil((rows - 1) / chunkCells) > MAX_CHUNKS) {
    chunkCells *= 2;
  }
  const maxLevel = Math.max(0, Math.floor(Math.log2(chunkCells / 4)));

  const object = new Group();
  object.name = 'terrain';
  const chunks: Chunk[] = [];
  for (let j0 = 0; j0 < rows - 1; j0 += chunkCells) {
    for (let i0 = 0; i0 < cols - 1; i0 += chunkCells) {
      const i1 = Math.min(i0 + chunkCells, cols - 1);
      const j1 = Math.min(j0 + chunkCells, rows - 1);
      const coarse = buildChunkGeometry(field, i0, j0, i1, j1, 2 ** maxLevel, floorY);
      const mesh = new Mesh(coarse, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      object.add(mesh);
      chunks.push({
        i0,
        j0,
        i1,
        j1,
        mesh,
        coarse,
        level: maxLevel,
        minX: rect.minX + i0 * cellX,
        maxX: rect.minX + i1 * cellX,
        minZ: rect.minZ + j0 * cellZ,
        maxZ: rect.minZ + j1 * cellZ,
      });
    }
  }

  return {
    object,
    update(cameraPosition, viewHeight, maxBuilds = BUILDS_PER_FRAME) {
      let builds = 0;
      for (const chunk of chunks) {
        const dx = Math.max(chunk.minX - cameraPosition.x, 0, cameraPosition.x - chunk.maxX);
        const dz = Math.max(chunk.minZ - cameraPosition.z, 0, cameraPosition.z - chunk.maxZ);
        const distance = Math.hypot(dx, dz, Math.max(0, cameraPosition.y - field.maxY));
        // the sample spacing that keeps triangle edges near the target size
        const spacing = distance * viewHeight * EDGE_FRACTION;
        const wanted = Math.min(maxLevel, Math.max(0, Math.floor(Math.log2(Math.max(spacing / cell, 1)))));
        if (wanted === chunk.level) continue;
        if (wanted === maxLevel) {
          swap(chunk, chunk.coarse, wanted);
        } else if (builds < maxBuilds) {
          builds++;
          swap(chunk, buildChunkGeometry(field, chunk.i0, chunk.j0, chunk.i1, chunk.j1, 2 ** wanted, floorY), wanted);
        }
      }
    },
    dispose() {
      for (const chunk of chunks) {
        if (chunk.mesh.geometry !== chunk.coarse) chunk.mesh.geometry.dispose();
        chunk.coarse.dispose();
      }
    },
  };

  function swap(chunk: Chunk, geometry: BufferGeometry, level: number): void {
    const old = chunk.mesh.geometry;
    chunk.mesh.geometry = geometry;
    chunk.level = level;
    if (old !== chunk.coarse) old.dispose();
  }
}
