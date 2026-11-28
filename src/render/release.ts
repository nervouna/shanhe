/**
 * Freeing what the renderer creates at run time, and counting what is alive.
 *
 * Three.js keeps a render object for every mesh it has drawn, one per pass
 * (the view, each shadow map), in a registry of the renderer and as a
 * listener on the mesh's material. A render object goes when its mesh, its
 * material or its lights fire `dispose`; disposing of the geometry alone
 * frees the GPU buffers and leaves the render object, and with it the mesh
 * and the arrays of its geometry, alive for as long as the material lives.
 * So a mesh that leaves the scene for good is released here, never just
 * removed.
 */

import type { BufferGeometry, Mesh, WebGPURenderer } from 'three/webgpu';

/**
 * Takes a mesh out of the scene for good: removes it from its parent and
 * fires its `dispose` event, which frees the renderer's render objects for
 * it (and, for an instanced mesh, its instance buffers).
 *
 * @param geometry also disposes of the mesh's geometry; pass `false` for a
 *   geometry that other meshes share.
 */
export function releaseMesh(mesh: Mesh, geometry = true): void {
  mesh.removeFromParent();
  if (geometry) mesh.geometry.dispose();
  mesh.dispose();
}

/**
 * Gives a mesh that stays in the scene another geometry and disposes of the
 * old one. The renderer's render objects for the mesh follow by themselves.
 */
export function replaceGeometry(mesh: Mesh, geometry: BufferGeometry): void {
  const old = mesh.geometry;
  if (old === geometry) return;
  mesh.geometry = geometry;
  old.dispose();
}

/** What the renderer holds, as Three.js counts it. */
export interface LiveCounts {
  /** Render objects in the renderer's registry: one per drawn mesh and pass. */
  readonly renderObjects: number;
  /** Geometries with buffers on the GPU. */
  readonly geometries: number;
  /** Textures on the GPU, render targets and shadow maps included. */
  readonly textures: number;
}

/** The parts of the renderer's internals the counts are read from. */
interface RendererInternals {
  readonly _objects?: { readonly _renderObjects?: { readonly size: number } } | null;
  readonly info: { readonly memory: { readonly geometries: number; readonly textures: number } };
}

/**
 * Reads the live counts from the renderer itself: its registry of render
 * objects and its memory statistics. `renderObjects` is -1 if the registry
 * is not where Three.js 0.187 keeps it.
 */
export function liveCounts(renderer: WebGPURenderer): LiveCounts {
  const internals = renderer as unknown as RendererInternals;
  return {
    renderObjects: internals._objects?._renderObjects?.size ?? -1,
    geometries: internals.info.memory.geometries,
    textures: internals.info.memory.textures,
  };
}
