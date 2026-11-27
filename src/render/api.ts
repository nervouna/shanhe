/**
 * The renderer's public API. Everything outside `src/render` talks to the
 * renderer through this file; it does not depend on the rules core.
 *
 * Hexes are named by their index in the per-hex arrays of `MapData`
 * (`row * width + col`), polities by their index in `MapData.polities`.
 */

import {
  ACESFilmicToneMapping,
  Mesh,
  MeshStandardNodeMaterial,
  PCFShadowMap,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import type { RenderBackend } from '../shared/types.ts';
import { CAMERA_FOV, cameraLimits, cameraPose, screenRay, zoomFraction } from './cameraRig.ts';
import type { CameraPose, CameraState } from './cameraRig.ts';
import { createCities } from './cities.ts';
import { createCameraController } from './controls.ts';
import { createSurface, mapWorldRect, surfaceHeightAt, unitsPerMetre } from './heightField.ts';
import { createHexRaster } from './hexRaster.ts';
import { createLighting } from './lighting.ts';
import { createMapTextures } from './mapTextures.ts';
import { createOverlays } from './overlays.ts';
import { pickHexOnRay } from './picking.ts';
import { createPieces } from './pieces.ts';
import type { FrameStats, Renderer, RendererOptions } from './scene.ts';
import { createMapUniforms } from './shaderLib.ts';
import { createTerrain } from './terrain.ts';
import { createTerrainMaterial } from './terrainMaterial.ts';
import { createWater } from './water.ts';

export type { CameraState } from './cameraRig.ts';
export * from './scene.ts';

/** The table the map stands on. */
const TABLE_COLOR = 0x2b2622;

/** The camera stays this far above the ground under it, in hex sizes. */
const CAMERA_CLEARANCE = 0.5;

/** Weight of the newest frame in the running averages of the statistics. */
const STATS_BLEND = 0.1;

/**
 * Starts drawing `mapData` on `canvas`. Resolves once the renderer has
 * picked its backend: WebGPU where the browser has it, WebGL 2 otherwise.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  mapData: MapData,
  options: RendererOptions = {},
): Promise<Renderer> {
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  const backend: RenderBackend =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? 'webgpu'
      : 'webgl';
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const layout = mapData.projection.hexLayout;
  const surface = createSurface(mapData, options.heightmap);
  const rect = mapWorldRect(mapData);
  const span = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
  const limits = cameraLimits(rect, layout.size);

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  const lighting = createLighting(scene, span);

  const textures = createMapTextures(mapData, createHexRaster(mapData));
  const uniforms = createMapUniforms(rect, layout, unitsPerMetre(mapData), textures);
  const terrainMaterial = createTerrainMaterial(uniforms);
  // the table the map stands on, a little below its lowest point
  const tableY = surface.field.minY - 0.35 * layout.size;
  const terrain = createTerrain(surface.field, terrainMaterial, tableY);
  const water = createWater(surface, uniforms);
  const overlays = createOverlays(surface, uniforms);
  const tableGeometry = new PlaneGeometry(span * 40, span * 40).rotateX(-Math.PI / 2);
  const tableMaterial = new MeshStandardNodeMaterial({ color: TABLE_COLOR, roughness: 0.9 });
  const table = new Mesh(tableGeometry, tableMaterial);
  table.position.set((rect.minX + rect.maxX) / 2, tableY, (rect.minZ + rect.maxZ) / 2);
  table.receiveShadow = true;
  const pieces = createPieces(surface);
  const cities = createCities(surface);
  scene.add(terrain.object, water.object, overlays.object, table, pieces.object, cities.object);

  const groundY = (x: number, z: number): number => surfaceHeightAt(surface, x, z);
  const controller = createCameraController(
    canvas,
    limits,
    {
      x: (rect.minX + rect.maxX) / 2,
      z: (rect.minZ + rect.maxZ) / 2,
      distance: limits.maxDistance,
      yaw: 0,
    },
    groundY,
  );

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  // the canvas can change size without the window doing so
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resize);

  /**
   * The pose for a camera state: the same numbers drive the camera and
   * picking. A camera that would end up inside a mountain is lifted over it.
   */
  const poseOf = (state: CameraState): CameraPose => {
    const pose = cameraPose(state, limits, groundY(state.x, state.z));
    const [x, y, z] = pose.position;
    const floor = groundY(x, z) + CAMERA_CLEARANCE * layout.size;
    return y >= floor ? pose : { ...pose, position: [x, floor, z] };
  };

  const target = new Vector3();
  const viewHeight = 2 * Math.tan((CAMERA_FOV * Math.PI) / 360);
  const applyCamera = (state: CameraState, firstFrame: boolean): void => {
    const pose = poseOf(state);
    camera.position.set(...pose.position);
    target.set(...pose.target);
    camera.lookAt(target);
    camera.near = state.distance * 0.08;
    camera.far = state.distance * 12 + span * 0.5;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // from far away the map reads as a political map
    uniforms.tintStrength.value = 0.12 + 0.16 * zoomFraction(state.distance, limits);
    cities.update(camera, Math.max(1, canvas.clientHeight));
    lighting.update(target, state.distance, pose.tilt);
    terrain.update(camera.position, viewHeight, firstFrame ? Infinity : undefined);
  };

  let stats: FrameStats = { frames: 0, frameMs: 0, cpuMs: 0, drawCalls: 0, triangles: 0 };
  const listeners = new Set<(stats: FrameStats) => void>();
  let lastTime: number | null = null;
  let disposed = false;
  let ownersKey = '';
  let fogged = false;

  const frame = (): void => {
    if (disposed) return;
    const start = performance.now();
    const elapsed = lastTime === null ? 0 : start - lastTime;
    lastTime = start;
    applyCamera(controller.update(elapsed / 1000), stats.frames === 0);
    renderer.render(scene, camera);
    const cpu = performance.now() - start;
    const info = renderer.info.render;
    const first = stats.frames < 2;
    stats = {
      frames: stats.frames + 1,
      frameMs: first ? elapsed : stats.frameMs + (elapsed - stats.frameMs) * STATS_BLEND,
      cpuMs: first ? cpu : stats.cpuMs + (cpu - stats.cpuMs) * STATS_BLEND,
      drawCalls: info.drawCalls,
      triangles: info.triangles,
    };
    for (const listener of listeners) listener(stats);
  };
  await renderer.setAnimationLoop(frame);

  return {
    backend,
    setScene(next) {
      const hexCount = mapData.width * mapData.height;
      const valid = (hex: number): boolean => Number.isInteger(hex) && hex >= 0 && hex < hexCount;
      for (const unit of next.units) {
        if (!valid(unit.hex)) throw new RangeError(`setScene: unit ${unit.id} is on hex ${unit.hex}`);
      }
      for (const city of next.cities) {
        if (!valid(city.hex)) throw new RangeError(`setScene: city ${city.name} is on hex ${city.hex}`);
      }
      pieces.setUnits(next.units);
      cities.setCities(next.cities);

      // territory is redrawn only when an owner changed
      const overrides = [...next.ownerOverrides].filter(([hex]) => valid(hex));
      const key = overrides.map(([hex, owner]) => `${hex}:${owner}`).join(',');
      if (key !== ownersKey) {
        ownersKey = key;
        const owner = mapData.owner.slice();
        for (const [hex, value] of overrides) owner[hex] = value;
        textures.setOwners(owner);
        overlays.setOwners(owner);
      }
      if (next.fog !== null || fogged) textures.setFog(next.fog);
      fogged = next.fog !== null;
    },
    pickHex(clientX, clientY) {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return null;
      const u = (clientX - bounds.left) / bounds.width;
      const v = (clientY - bounds.top) / bounds.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      const ray = screenRay(poseOf(controller.state), CAMERA_FOV, bounds.width / bounds.height, u * 2 - 1, 1 - v * 2);
      return pickHexOnRay(surface, ray);
    },
    focusHex(hex, focus = {}) {
      if (!Number.isInteger(hex) || hex < 0 || hex >= mapData.width * mapData.height) {
        throw new RangeError(`focusHex: hex index out of range: ${hex}`);
      }
      const p = hexToWorld(indexToOffset(hex, mapData.width), layout);
      const to = focus.distance === undefined ? { x: p.x, z: p.z } : { x: p.x, z: p.z, distance: focus.distance };
      controller.moveTo(to, focus.immediate === true);
    },
    setHighlights(highlights) {
      overlays.setHighlights(highlights);
    },
    setGridVisible(visible) {
      uniforms.gridOpacity.value = visible ? 1 : 0;
    },
    getCamera() {
      return controller.state;
    },
    setCamera(state, immediate = false) {
      controller.moveTo(state, immediate);
    },
    getStats() {
      return stats;
    },
    onFrame(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      void renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      listeners.clear();
      controller.dispose();
      terrain.dispose();
      water.dispose();
      pieces.dispose();
      cities.dispose();
      overlays.dispose();
      tableGeometry.dispose();
      tableMaterial.dispose();
      terrainMaterial.dispose();
      textures.dispose();
      lighting.dispose();
      renderer.dispose();
    },
  };
}
