/**
 * Draws a `MapData` as flat hexes coloured by owner, with pan and zoom.
 *
 * Three.js is imported from `three/webgpu`: its `WebGPURenderer` uses WebGPU
 * where the browser has it and switches to its WebGL 2 backend by itself
 * while `init()` runs. Which one it chose is only known after `init()`.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from 'three/webgpu';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { hexCorners, hexToWorld, indexToOffset } from '../shared/hex.ts';
import type { WorldPoint } from '../shared/hex.ts';
import { OWNER_OFF_MAP, OWNER_SEA, OWNER_UNOWNED, Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import type { RenderBackend } from '../shared/types.ts';

export interface MapView {
  readonly backend: RenderBackend;
  /** Stops rendering and frees the GPU resources. */
  dispose(): void;
}

const BACKGROUND = 0x10151c;
const OCEAN = 0x24506e;
const COAST = 0x3f7f9f;
const LAKE = 0x5c9fc0;
const UNOWNED = 0xb9a888;
const OFF_MAP = 0x6b6b66;
/** Hexes are drawn slightly smaller than their cell so the grid shows. */
const HEX_INSET = 0.94;

function ownerColor(map: MapData, index: number): number {
  const owner = map.owner[index] as number;
  if (owner >= 0) return map.polities[owner]?.color ?? OFF_MAP;
  const terrain = map.terrain[index];
  if (terrain === Terrain.Lake) return LAKE;
  if (terrain === Terrain.Ocean) return OCEAN;
  if (terrain === Terrain.Coast) return COAST;
  if (owner === OWNER_UNOWNED) return UNOWNED;
  if (owner === OWNER_SEA) return OCEAN;
  if (owner === OWNER_OFF_MAP) return OFF_MAP;
  return OFF_MAP;
}

/** One flat mesh for the whole map: four triangles per hex, coloured per vertex. */
function buildHexGeometry(map: MapData): BufferGeometry {
  const count = map.width * map.height;
  const layout = map.projection.hexLayout;
  const positions = new Float32Array(count * 12 * 3);
  const colors = new Float32Array(count * 12 * 3);
  const color = new Color();
  // a fan over the six corners
  const triangles = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  let v = 0;
  for (let i = 0; i < count; i++) {
    const hex = indexToOffset(i, map.width);
    const centre = hexToWorld(hex, layout);
    const corners = hexCorners(hex, layout);
    color.setHex(ownerColor(map, i));
    for (const c of triangles) {
      const corner = corners[c] as WorldPoint;
      positions[v] = centre.x + (corner.x - centre.x) * HEX_INSET;
      positions[v + 1] = 0;
      positions[v + 2] = centre.z + (corner.z - centre.z) * HEX_INSET;
      colors[v] = color.r;
      colors[v + 1] = color.g;
      colors[v + 2] = color.b;
      v += 3;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Starts rendering `map` on `canvas`. Resolves once the renderer has picked
 * its backend.
 */
export async function createMapView(canvas: HTMLCanvasElement, map: MapData): Promise<MapView> {
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  const backend: RenderBackend =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? 'webgpu'
      : 'webgl';

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);

  const geometry = buildHexGeometry(map);
  const material = new MeshBasicNodeMaterial({ vertexColors: true, side: DoubleSide });
  scene.add(new Mesh(geometry, material));

  const layout = map.projection.hexLayout;
  const first = hexToWorld({ col: 0, row: 0 }, layout);
  const last = hexToWorld({ col: map.width - 1, row: map.height - 1 }, layout);
  const centreX = (first.x + last.x) / 2;
  const centreZ = (first.z + last.z) / 2;
  const span = Math.max(last.x - first.x, last.z - first.z) + 2 * layout.size;

  const camera = new PerspectiveCamera(45, 1, span / 1000, span * 20);
  camera.position.set(centreX, span * 0.9, centreZ + span * 0.45);

  // MapControls: drag to pan over the ground, wheel or pinch to zoom,
  // right-drag or two-finger rotate to orbit.
  const controls = new MapControls(camera, canvas);
  controls.target.set(centreX, 0, centreZ);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  controls.minDistance = layout.size * 3;
  controls.maxDistance = span * 3;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.update();

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  await renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    backend,
    dispose(): void {
      void renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
