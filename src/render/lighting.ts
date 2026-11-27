/**
 * The light of the scene: one afternoon sun with a shadow map that follows
 * the view, sky light, a sky-coloured background and distance fog for
 * aerial perspective.
 */

import { Color, DirectionalLight, Fog, HemisphereLight, Vector3 } from 'three/webgpu';
import type { Scene } from 'three/webgpu';

export interface Lighting {
  /** Unit vector from the ground towards the sun. */
  readonly sunDirection: Vector3;
  /**
   * Fits the shadow map and the fog to the view.
   *
   * @param target the point the camera looks at.
   * @param distance from the camera to the target.
   * @param tilt of the view above the horizon, in radians.
   * @param dirty whether anything that casts a shadow changed since the last
   *   call. The shadow map is drawn again only then, or when the view has
   *   left the ground it covers.
   * @returns whether the shadow map is drawn again in the next frame.
   */
  update(target: Vector3, distance: number, tilt: number, dirty: boolean): boolean;
  dispose(): void;
}

/** Haze near the horizon; also the colour distant ground fades to. */
export const HAZE_COLOR = 0xa9bfd0;
const SUN_COLOR = 0xfff1dc;
const SKY_LIGHT = 0xbfd4ee;
const GROUND_LIGHT = 0x6f6654;
const SHADOW_MAP_SIZE = 2048;

export function createLighting(scene: Scene, mapSpan: number): Lighting {
  // afternoon: the sun stands in the south-west (x east, z south)
  const sunDirection = new Vector3(-0.62, 0.66, 0.42).normalize();

  const sun = new DirectionalLight(SUN_COLOR, 2.6);
  sun.castShadow = true;
  // drawn on request only, see `update`
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  /** The view the shadow map was last fitted to. */
  const fitted = new Vector3(Infinity, 0, 0);
  let fittedDistance = 0;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  scene.add(sun, sun.target);

  const sky = new HemisphereLight(SKY_LIGHT, GROUND_LIGHT, 1.25);
  scene.add(sky);

  const fog = new Fog(HAZE_COLOR, 1, 2);
  scene.fog = fog;
  scene.background = new Color(HAZE_COLOR);

  return {
    sunDirection,
    update(target, distance, tilt, dirty) {
      // the shadow map covers the ground in view and a margin around it; it
      // is fitted again when the view has used up a part of that margin
      const ratio = distance / (fittedDistance || 1);
      const moved = Math.hypot(target.x - fitted.x, target.z - fitted.z);
      const refit = ratio > 1.2 || ratio < 0.7 || moved > fittedDistance * 0.3;
      if (refit) {
        fitted.copy(target);
        fittedDistance = distance;
        const half = Math.min(Math.max(distance * 1.7, 3), mapSpan);
        sun.target.position.copy(target);
        sun.position.copy(target).addScaledVector(sunDirection, half * 3);
        sun.target.updateMatrixWorld();
        const camera = sun.shadow.camera;
        camera.left = -half;
        camera.right = half;
        camera.top = half;
        camera.bottom = -half;
        camera.near = half * 0.5;
        camera.far = half * 6;
        camera.updateProjectionMatrix();
        const texel = (2 * half) / SHADOW_MAP_SIZE;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = texel * 2;
      }
      const redraw = refit || dirty;
      if (redraw) sun.shadow.needsUpdate = true;

      // looking down, everything is about `distance` away and stays clear;
      // looking across, the far ground fades into the haze
      const oblique = Math.cos(tilt);
      fog.near = distance * (1.1 + 0.6 * (1 - oblique));
      fog.far = distance * (4.5 + 14 * (1 - oblique));
      return redraw;
    },
    dispose() {
      scene.remove(sun, sun.target, sky);
      sun.dispose();
      sky.dispose();
      scene.fog = null;
    },
  };
}
