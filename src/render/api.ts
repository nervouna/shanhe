/**
 * The renderer's public API. Everything outside `src/render` talks to the
 * renderer through this file; it does not depend on the rules core.
 *
 * Hexes are named by their index in the per-hex arrays of `MapData`
 * (`row * width + col`), polities by their index in `MapData.polities`.
 */

import {
  Mesh,
  MeshStandardNodeMaterial,
  PCFShadowMap,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
import { getLanguage } from '../shared/i18n.ts';
import type { Language } from '../shared/i18n.ts';
import { Feature, NO_ZONE } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import type { RenderBackend } from '../shared/types.ts';
import { createAnimator } from './animator.ts';
import {
  CAMERA_FOV,
  DEFAULT_ZOOM,
  cameraLimits,
  cameraPose,
  distanceAtZoom,
  politicalShare,
  screenRay,
  zoomFraction,
} from './cameraRig.ts';
import type { CameraPose, CameraState } from './cameraRig.ts';
import { createCities } from './cities.ts';
import { createClouds } from './clouds.ts';
import type { Part } from './cityGen.ts';
import { latitudeTerms } from './climate.ts';
import { createCameraController } from './controls.ts';
import { createEffects } from './effects.ts';
import { createSurface, mapWorldRect, surfaceHeightAt, unitsPerMetre } from './heightField.ts';
import { createGroundLines } from './groundLines.ts';
import { createHexRaster } from './hexRaster.ts';
import { POLITICAL_NAMES_FROM, createLabels } from './labels.ts';
import { createLighting } from './lighting.ts';
import { createMapTextures } from './mapTextures.ts';
import { createOverlays } from './overlays.ts';
import { createPartBatch } from './partBatch.ts';
import { pickHexOnRay } from './picking.ts';
import { createPieces } from './pieces.ts';
import { placePoliticalNames } from './politicalNames.ts';
import { improvementParts, volcanoParts } from './props.ts';
import { resolveEffects } from './postEffects.ts';
import type { PostEffect } from './postEffects.ts';
import { createPostFx } from './postfx.ts';
import { QUALITY_SETTINGS, createScaleController, renderPixelRatio } from './renderScale.ts';
import type { Quality } from './renderScale.ts';
import type { FrameStats, Renderer, RendererOptions } from './scene.ts';
import { createMapUniforms } from './shaderLib.ts';
import { createTerrain } from './terrain.ts';
import { createTerrainMaterial } from './terrainMaterial.ts';
import { createVegetation } from './vegetation.ts';
import { createWater } from './water.ts';

export type { CameraState } from './cameraRig.ts';
export * from './scene.ts';

/** The table the map stands on. */
const TABLE_COLOR = 0x2b2622;

/** The camera stays this far above the ground under it, in hex sizes. */
const CAMERA_CLEARANCE = 0.5;

/** How high the clouds float over the ground, in hex sizes. */
const CLOUD_HEIGHT = 5;

/** Weight of the newest frame in the running averages of the statistics. */
const STATS_BLEND = 0.1;

/** The frame time the adaptive render scale holds: 60 frames per second. */
const TARGET_FRAME_MS = 1000 / 60;
/** Territory borders are at least this wide on screen, in CSS pixels. */
const MIN_BORDER_PIXELS = 1.7;
/** Width of a border on the ground as a fraction of the hex size, as built in `overlays.ts`. */
const BORDER_WIDTH = 0.085;
/** City houses smaller than this on screen are not drawn, in CSS pixels. */
const MIN_HOUSE_PIXELS = 0.8;

const NO_IMPROVEMENTS: ReadonlyMap<number, number> = new Map();

/** A string that changes when the entries of a map do. */
function keyOfMap(map: ReadonlyMap<number, number>): string {
  if (map.size === 0) return '';
  let key = '';
  for (const [hex, value] of map) key += `${hex}:${value},`;
  return key;
}

/**
 * Starts drawing `mapData` on `canvas`. Resolves once the renderer has
 * picked its backend: WebGPU where the browser has it, WebGL 2 otherwise.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  mapData: MapData,
  options: RendererOptions = {},
): Promise<Renderer> {
  // edges are smoothed by the finish (`postfx.ts`), not by multisampling
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  const backend: RenderBackend =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? 'webgpu'
      : 'webgl';
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMappingExposure = 1;
  // a frame is several passes: the counters are reset once per frame by hand
  renderer.info.autoReset = false;

  const layout = mapData.projection.hexLayout;
  const surface = createSurface(mapData, options.heightmap);
  const rect = mapWorldRect(mapData);
  const span = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
  const limits = cameraLimits(rect, layout.size);

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  const lighting = createLighting(scene, renderer, span, surface.field.maxY - surface.field.minY);

  const textures = createMapTextures(mapData, createHexRaster(mapData));
  const uniforms = createMapUniforms(rect, layout, unitsPerMetre(mapData), textures, latitudeTerms(mapData.projection));
  const terrainMaterial = createTerrainMaterial(uniforms);
  // the table the map stands on, a little below its lowest point
  const tableY = surface.field.minY - 0.35 * layout.size;
  const terrain = createTerrain(surface.field, terrainMaterial, tableY);
  const water = createWater(surface, uniforms, lighting.environment);
  const overlays = createOverlays(surface, uniforms);
  const tableGeometry = new PlaneGeometry(span * 40, span * 40).rotateX(-Math.PI / 2);
  const tableMaterial = new MeshStandardNodeMaterial({ color: TABLE_COLOR, roughness: 0.9 });
  const table = new Mesh(tableGeometry, tableMaterial);
  table.position.set((rect.minX + rect.maxX) / 2, tableY, (rect.minZ + rect.maxZ) / 2);
  table.receiveShadow = true;
  const clouds = createClouds(uniforms, rect, surface.field.maxY + CLOUD_HEIGHT * layout.size);
  const groundLines = createGroundLines(surface, uniforms);
  const vegetation = createVegetation(surface, uniforms);
  const pieces = createPieces(surface, lighting.environment);
  const cities = createCities(surface, uniforms);
  const props = createPartBatch(uniforms, layout.size, 'props');
  const labels = createLabels();
  const effects = createEffects();
  scene.add(terrain.object, water.object, groundLines.object, overlays.object, table, vegetation.object, pieces.shadows, pieces.object, cities.object, props.object, effects.object, clouds.object);
  // with the finish, labels are drawn on their own and laid over the picture
  const labelScene = new Scene();
  renderer.setClearColor(0x000000, 0);
  const postfx = createPostFx(renderer, scene, labelScene, camera);

  const hexCount = mapData.width * mapData.height;

  /** Draws what stands on hexes besides cities: volcano cones and the buildings of improvements. */
  const showProps = (improvements: ReadonlyMap<number, number>): void => {
    const parts: Part[] = [];
    const place = (hex: number, local: readonly Part[]): void => {
      const centre = hexToWorld(indexToOffset(hex, mapData.width), layout);
      for (const part of local) {
        const x = centre.x + part.x * layout.size;
        const z = centre.z + part.z * layout.size;
        parts.push({
          ...part,
          x,
          y: surfaceHeightAt(surface, x, z) + part.y * layout.size,
          z,
          w: part.w * layout.size,
          h: part.h * layout.size,
          d: part.d * layout.size,
        });
      }
    };
    for (let hex = 0; hex < hexCount; hex++) {
      if (mapData.feature[hex] === Feature.Volcano) place(hex, volcanoParts(hex));
    }
    for (const [hex, kind] of improvements) {
      if (Number.isInteger(hex) && hex >= 0 && hex < hexCount) place(hex, improvementParts(kind, hex));
    }
    props.set(parts);
  };
  showProps(NO_IMPROVEMENTS);
  const validHex = (hex: number): boolean => Number.isInteger(hex) && hex >= 0 && hex < hexCount;

  // the owner of every hex as drawn: the map's, the scene's overrides, and what animations changed
  let owners = mapData.owner.slice();
  let language: Language = options.language ?? getLanguage();
  const showNames = (): void => {
    labels.setNames(
      placePoliticalNames(mapData.width, mapData.height, owners, layout).flatMap((placement) => {
        const polity = mapData.polities[placement.polity];
        if (polity === undefined) return [];
        return [
          {
            name: language === 'zh' ? polity.nameZh : polity.nameEn,
            placement,
            y: surfaceHeightAt(surface, placement.x, placement.z),
            // a region nobody rules is named, but quietly
            muted: polity.kind === 'wastelandRegion',
          },
        ];
      }),
    );
  };
  showNames();

  let quality: Quality = options.quality ?? 'auto';
  let effectOverrides: Readonly<Partial<Record<PostEffect, boolean>>> = {};
  const applyEffects = (): void => {
    postfx.setState(resolveEffects(quality, backend, effectOverrides));
    (postfx.active ? labelScene : scene).add(labels.object);
    lighting.setToneMapped(postfx.state.toneMapping);
  };
  applyEffects();
  let settings = QUALITY_SETTINGS[quality];
  const scaleController = createScaleController({ targetMs: TARGET_FRAME_MS });
  let renderScale = settings.scale ?? 1;
  let pixelRatio = 1;
  terrain.setEdgeFraction(settings.edgeFraction);

  const groundY = (x: number, z: number): number => surfaceHeightAt(surface, x, z);
  const controller = createCameraController(
    canvas,
    limits,
    {
      x: (rect.minX + rect.maxX) / 2,
      z: (rect.minZ + rect.maxZ) / 2,
      // whole provinces in view, and the ground still as terrain
      distance: distanceAtZoom(DEFAULT_ZOOM, limits),
      yaw: 0,
    },
    groundY,
  );

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    // the render scale lives here, so that a change of size does not undo it
    pixelRatio = renderPixelRatio(window.devicePixelRatio, settings, renderScale);
    renderer.setPixelRatio(pixelRatio);
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
  const probe = new Vector3();
  const viewHeight = 2 * Math.tan((CAMERA_FOV * Math.PI) / 360);
  /** Anything that casts a shadow changed: the shadow map is drawn again. */
  let shadowDirty = true;
  /** Only pieces in motion changed what casts shadows. */
  let shadowMoving = false;
  /** Drawn time in seconds: what the drifting light and the clouds follow. */
  let seconds = 0;
  let political = 0;
  let shownLabels = 0;
  let terrainBuilds = 0;
  let shownTrees = 0;
  let cloudLayer = 0;
  const applyCamera = (state: CameraState, firstFrame: boolean): void => {
    const pose = poseOf(state);
    camera.position.set(...pose.position);
    target.set(...pose.target);
    camera.lookAt(target);
    camera.near = state.distance * 0.08;
    camera.far = state.distance * 12 + span * 0.5;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const height = Math.max(1, canvas.clientHeight);
    const zoom = zoomFraction(state.distance, limits);
    // near, the terrain's own colours carry the picture and the tint is faint;
    // from far away the ground turns into the political map
    political = politicalShare(zoom);
    uniforms.tintStrength.value = 0.07 + 0.07 * zoom;
    uniforms.political.value = political;
    // world units per CSS pixel at the point the camera looks at
    const perPixel = (state.distance * viewHeight) / height;
    uniforms.borderExtra.value = Math.min(
      Math.max(MIN_BORDER_PIXELS * perPixel - BORDER_WIDTH * layout.size, 0),
      0.42 * layout.size,
    );
    cities.object.visible = (0.12 * layout.size) / perPixel >= MIN_HOUSE_PIXELS;
    props.object.visible = cities.object.visible;
    const update = terrain.update(camera.position, viewHeight, firstFrame ? Infinity : undefined);
    terrainBuilds = update.builds;
    const grown = vegetation.update(camera.position, firstFrame ? 64 : undefined);
    shownTrees = grown.trees;
    if (grown.changed) shadowDirty = true;
    lighting.update(
      target,
      state.distance,
      pose.tilt,
      shadowDirty || update.changed ? true : shadowMoving ? 'moving' : false,
      seconds,
    );
    shadowDirty = false;
    shadowMoving = false;
    uniforms.clock.value = seconds;
    // the cloud that shades a point floats between it and the sun
    const sunward = (surface.field.maxY * 0.5 + CLOUD_HEIGHT * layout.size) / lighting.sunDirection.y;
    uniforms.cloudOffset.value.set(lighting.sunDirection.x * sunward, lighting.sunDirection.z * sunward);
    shownLabels = labels.update(camera, Math.max(1, canvas.clientWidth), height, zoom, political);
    postfx.update(state.distance, zoom);
    cloudLayer = clouds.update(zoom);
  };

  /** Whether the centre of any of the hexes is in the view, with a margin of one hex. */
  const inView = (hexes: readonly number[]): boolean => {
    for (const hex of hexes) {
      if (!validHex(hex)) continue;
      const p = hexToWorld(indexToOffset(hex, mapData.width), layout);
      probe.set(p.x, surfaceHeightAt(surface, p.x, p.z), p.z).applyMatrix4(camera.matrixWorldInverse);
      const depth = -probe.z;
      if (depth <= camera.near) continue;
      const margin = 1 + (layout.size / depth) * 1.5;
      probe.applyMatrix4(camera.projectionMatrix);
      if (Math.abs(probe.x) <= margin && Math.abs(probe.y) <= margin) return true;
    }
    return false;
  };

  const animator = createAnimator(mapData, {
    surface,
    pieces,
    effects,
    overlays,
    inView,
    owners: () => owners,
    paintOwners(final) {
      textures.setOwners(owners);
      if (!final) return;
      overlays.setOwners(owners);
      showNames();
    },
  });
  let animationSpeed = 1;
  let wasMoving = false;

  let stats: FrameStats = {
    frames: 0,
    frameMs: 0,
    cpuMs: 0,
    drawCalls: 0,
    triangles: 0,
    renderScale,
    pixelRatio,
    political: 0,
    politicalMap: false,
    labels: 0,
    animating: false,
    shadowDraws: 0,
    trees: 0,
    cloudLayer: 0,
  };
  const listeners = new Set<(stats: FrameStats) => void>();
  let lastTime: number | null = null;
  let disposed = false;
  let paused = options.paused === true;
  // a little slack, so that a cap at the display's own rate does not drop every other frame
  const minFrameMs = options.maxFps === undefined ? 0 : 1000 / options.maxFps - 2;
  let ownersKey = '';
  let fogged = false;
  let improvementsKey = '';
  let roadsKey = '';
  let routesKey = '';

  const frame = (): void => {
    if (disposed) return;
    if (paused) {
      // time does not pass for the camera while nothing is drawn
      lastTime = null;
      return;
    }
    const start = performance.now();
    if (lastTime !== null && start - lastTime < minFrameMs) return;
    const elapsed = lastTime === null ? 0 : start - lastTime;
    lastTime = start;

    // the adaptive scale follows the time between frames. A capped frame
    // rate says nothing about the load, and building terrain is a passing cost.
    if (settings.scale === null && options.maxFps === undefined && stats.frames > 2 && terrainBuilds === 0) {
      const next = scaleController.sample(elapsed);
      if (next !== renderScale) {
        renderScale = next;
        resize();
      }
    }

    const moving = animator.frame(start);
    // pieces in motion cast moving shadows, and one more frame settles them
    if (animator.playing || wasMoving) shadowMoving = true;
    seconds += Math.min(elapsed, 250) / 1000;
    wasMoving = animator.playing;
    applyCamera(controller.update(elapsed / 1000), stats.frames === 0);
    if (moving) effects.update((elapsed / 1000) * animationSpeed, camera);
    renderer.info.reset();
    if (postfx.active) postfx.render();
    else renderer.render(scene, camera);
    const cpu = performance.now() - start;
    const info = renderer.info.render;
    const first = stats.frames < 2;
    stats = {
      frames: stats.frames + 1,
      frameMs: first ? elapsed : stats.frameMs + (elapsed - stats.frameMs) * STATS_BLEND,
      cpuMs: first ? cpu : stats.cpuMs + (cpu - stats.cpuMs) * STATS_BLEND,
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      renderScale,
      pixelRatio,
      political,
      politicalMap: political >= POLITICAL_NAMES_FROM,
      labels: shownLabels,
      animating: animator.playing,
      shadowDraws: lighting.shadowDraws,
      trees: shownTrees,
      cloudLayer,
    };
    for (const listener of listeners) listener(stats);
  };
  await renderer.setAnimationLoop(frame);

  /** Greatest distance from a hex to a hex of its zone, per hex asked for. */
  const zoneReach = (hex: number): number | null => {
    const zone = mapData.zone[hex] as number;
    if (zone === NO_ZONE) return null;
    const centre = hexToWorld(indexToOffset(hex, mapData.width), layout);
    let reach = 0;
    for (let i = 0; i < hexCount; i++) {
      if (mapData.zone[i] !== zone) continue;
      const p = hexToWorld(indexToOffset(i, mapData.width), layout);
      reach = Math.max(reach, Math.hypot(p.x - centre.x, p.z - centre.z));
    }
    return reach + layout.size;
  };

  return {
    backend,
    setScene(next) {
      const valid = validHex;
      for (const unit of next.units) {
        if (!valid(unit.hex)) throw new RangeError(`setScene: unit ${unit.id} is on hex ${unit.hex}`);
      }
      for (const city of next.cities) {
        if (!valid(city.hex)) throw new RangeError(`setScene: city ${city.name} is on hex ${city.hex}`);
      }
      // the new scene is drawn exactly: whatever animations left behind goes
      const repaint = animator.reset();
      pieces.setUnits(next.units);
      const cityLabels = cities.setCities(next.cities);
      if (cityLabels !== null) labels.setCities(cityLabels);
      shadowDirty = true;

      // territory is redrawn only when an owner changed
      const overrides = [...next.ownerOverrides].filter(([hex]) => valid(hex));
      const key = overrides.map(([hex, owner]) => `${hex}:${owner}`).join(',');
      if (key !== ownersKey || repaint) {
        ownersKey = key;
        owners = mapData.owner.slice();
        for (const [hex, value] of overrides) owners[hex] = value;
        textures.setOwners(owners);
        overlays.setOwners(owners);
        showNames();
      }
      if (next.fog !== null || fogged) textures.setFog(next.fog);
      fogged = next.fog !== null;

      const improvements = next.improvements ?? NO_IMPROVEMENTS;
      const improvementKey = keyOfMap(improvements);
      if (improvementKey !== improvementsKey) {
        improvementsKey = improvementKey;
        textures.setImprovements(improvements);
        showProps(improvements);
        shadowDirty = true;
      }
      const roads = next.roads ?? NO_IMPROVEMENTS;
      const roadKey = keyOfMap(roads);
      if (roadKey !== roadsKey) {
        roadsKey = roadKey;
        groundLines.setRoads(roads);
      }
      const routes = next.routes ?? [];
      const routeKey = routes.length === 0 ? '' : JSON.stringify(routes.map((r) => [r.polity, r.sea, r.path]));
      if (routeKey !== routesKey) {
        routesKey = routeKey;
        groundLines.setRoutes(routes);
      }
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
      let distance = focus.distance;
      if (distance === undefined && focus.frame === 'zone') {
        const reach = zoneReach(hex);
        if (reach !== null) {
          // the zone fits into the shorter side of the view, with some air around it
          const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
          distance = (2 * reach * 1.25) / (viewHeight * Math.min(1, aspect));
        }
      }
      const to = distance === undefined ? { x: p.x, z: p.z } : { x: p.x, z: p.z, distance };
      controller.moveTo(to, focus.immediate === true);
    },
    setHighlights(highlights) {
      overlays.setHighlights(highlights);
    },
    setSelectionAids(aids) {
      labels.setMarkers(overlays.setAids(aids));
    },
    setQuality(next) {
      quality = next;
      settings = QUALITY_SETTINGS[next];
      terrain.setEdgeFraction(settings.edgeFraction);
      scaleController.reset();
      renderScale = settings.scale ?? 1;
      resize();
      // choosing a tier means its effects: switches set by hand are dropped
      effectOverrides = {};
      applyEffects();
      shadowDirty = true;
    },
    get quality() {
      return quality;
    },
    setEffects(overrides) {
      effectOverrides = overrides === null ? {} : { ...effectOverrides, ...overrides };
      applyEffects();
    },
    getEffects() {
      return postfx.state;
    },
    setLanguage(next) {
      if (next === language) return;
      language = next;
      showNames();
    },
    play(events, playOptions = {}) {
      // nothing is shown while no frame is drawn: the events are applied at once
      return animator.play(events, playOptions.speed ?? 1, paused || disposed);
    },
    setAnimationSpeed(factor) {
      animationSpeed = Number.isFinite(factor) && factor > 0 ? factor : 1;
      animator.setSpeed(animationSpeed);
    },
    skip() {
      animator.skip();
      shadowDirty = true;
    },
    getAnimationCounts() {
      return animator.counts();
    },
    getUnitHex(unit) {
      const pose = animator.standing(unit);
      if (pose === null) return null;
      const hex = worldToHex({ x: pose.x, z: pose.z }, layout);
      if (hex.col < 0 || hex.col >= mapData.width || hex.row < 0 || hex.row >= mapData.height) return null;
      return hex.row * mapData.width + hex.col;
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
      // an animation can start and end between two frames
      return stats.animating === animator.playing ? stats : { ...stats, animating: animator.playing };
    },
    setPaused(value) {
      paused = value;
      // no frame would show the rest of a running animation
      if (value) animator.skip();
    },
    get paused() {
      return paused;
    },
    onFrame(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      animator.dispose();
      void renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      listeners.clear();
      controller.dispose();
      terrain.dispose();
      vegetation.dispose();
      groundLines.dispose();
      water.dispose();
      pieces.dispose();
      cities.dispose();
      props.dispose();
      clouds.dispose();
      labels.dispose();
      effects.dispose();
      overlays.dispose();
      tableGeometry.dispose();
      tableMaterial.dispose();
      terrainMaterial.dispose();
      postfx.dispose();
      textures.dispose();
      lighting.dispose();
      renderer.dispose();
    },
  };
}
