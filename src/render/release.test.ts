import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
import type { Material, Object3D } from 'three/webgpu';
// the renderer's own registry of render objects, as installed: the bookkeeping is checked against it, not against a copy
import RenderObjects from 'three/src/renderers/common/RenderObjects.js';
import { liveCounts, releaseMesh, replaceGeometry } from './release.ts';

/**
 * The registry of Three.js with the collaborators it needs to make and free
 * render objects without a GPU: every mesh "drawn" gets a render object per
 * pass, exactly as in the renderer.
 */
function createRegistry() {
  const freed = { vertexState: 0, pipelines: 0, bindings: 0, nodes: 0 };
  const renderer = { _currentSourceMaterial: null, contextNode: { id: 0, version: 0 } };
  const nodes = {
    getCacheKey: () => 0,
    getCustomProgramCacheKey: () => '',
    delete: () => {
      freed.nodes++;
    },
  };
  const geometries = {
    deleteVertexState: () => {
      freed.vertexState++;
    },
    deleteNodeAttributes: () => undefined,
  };
  const pipelines = {
    delete: () => {
      freed.pipelines++;
    },
  };
  const bindings = {
    deleteForRender: () => {
      freed.bindings++;
    },
  };
  const Registry = RenderObjects as unknown as new (...parts: unknown[]) => {
    get(...keys: unknown[]): { readonly object: Object3D };
    readonly _renderObjects: Set<unknown>;
  };
  const registry = new Registry(renderer, nodes, geometries, pipelines, bindings, {});
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  // stand-ins for the lights and the two passes a mesh is drawn in
  const lights = new Group();
  const view = { id: 1 };
  const shadow = { id: 2 };
  const clipping = { cacheKey: '' };
  return {
    freed,
    scene,
    /** Draws a mesh as the renderer does: in the view and into a shadow map. */
    draw(mesh: Mesh): void {
      const material = mesh.material as Material;
      registry.get(mesh, material, scene, camera, lights, view, clipping, 'default');
      registry.get(mesh, material, scene, camera, lights, shadow, clipping, 'shadow');
    },
    get live(): number {
      return liveCounts({ _objects: registry, info: { memory: { geometries: 0, textures: 0 } } } as never).renderObjects;
    },
  };
}

function chunkGeometry(vertices: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

describe('releaseMesh', () => {
  it('returns the registry of render objects to where it started after N chunks are made and freed', () => {
    const registry = createRegistry();
    const material = new MeshBasicMaterial();
    const parent = new Group();
    registry.scene.add(parent);
    const standing = new Mesh(chunkGeometry(3), material);
    parent.add(standing);
    registry.draw(standing);
    const start = registry.live;
    expect(start).toBe(2);

    for (let round = 0; round < 3; round++) {
      const chunks: Mesh[] = [];
      for (let i = 0; i < 40; i++) {
        const mesh = new Mesh(chunkGeometry(300), material);
        parent.add(mesh);
        registry.draw(mesh);
        chunks.push(mesh);
      }
      expect(registry.live).toBe(start + 80);
      for (const mesh of chunks) releaseMesh(mesh);
      expect(registry.live).toBe(start);
      expect(parent.children).toEqual([standing]);
    }
    // the shared material is alive and holds no listener of a freed chunk
    const listeners = (material as unknown as { _listeners: { dispose: unknown[] } })._listeners.dispose;
    expect(listeners).toHaveLength(2);
    expect(registry.freed.pipelines).toBe(240);
  });

  it('shows the leak it prevents: removing a mesh and disposing of its geometry leaves the render objects', () => {
    const registry = createRegistry();
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(chunkGeometry(300), material);
    registry.scene.add(mesh);
    registry.draw(mesh);
    registry.scene.remove(mesh);
    mesh.geometry.dispose();
    expect(registry.live).toBe(2);
    releaseMesh(mesh);
    expect(registry.live).toBe(0);
  });

  it('fires dispose on the mesh and on its geometry, and leaves a shared geometry alone', () => {
    const events: string[] = [];
    const shared = chunkGeometry(3);
    shared.addEventListener('dispose', () => events.push('shared'));
    const own = chunkGeometry(3);
    own.addEventListener('dispose', () => events.push('own'));
    const material = new MeshBasicMaterial();
    const a = new InstancedMesh(shared, material, 4);
    a.addEventListener('dispose', () => events.push('a'));
    const b = new Mesh(own, material);
    b.addEventListener('dispose', () => events.push('b'));
    const parent = new Group().add(a, b);

    releaseMesh(a, false);
    releaseMesh(b);
    expect(events).toEqual(['a', 'own', 'b']);
    expect(parent.children).toHaveLength(0);
  });
});

describe('replaceGeometry', () => {
  it('keeps the render objects of a mesh that stays and disposes of the old geometry', () => {
    const registry = createRegistry();
    const mesh = new Mesh(chunkGeometry(3), new MeshBasicMaterial());
    registry.scene.add(mesh);
    registry.draw(mesh);
    let disposed = 0;
    for (let i = 0; i < 20; i++) {
      const next = chunkGeometry(30 + i);
      mesh.geometry.addEventListener('dispose', () => disposed++);
      replaceGeometry(mesh, next);
      registry.draw(mesh);
      expect(mesh.geometry).toBe(next);
    }
    expect(disposed).toBe(20);
    expect(registry.live).toBe(2);
    // the same geometry again is not disposed of
    replaceGeometry(mesh, mesh.geometry);
    expect(disposed).toBe(20);
  });
});
