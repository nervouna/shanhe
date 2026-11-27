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
   */
  update(target: Vector3, distance: number, tilt: number): void;
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
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  scene.add(sun, sun.target);

  const sky = new HemisphereLight(SKY_LIGHT, GROUND_LIGHT, 1.25);
  scene.add(sky);

  const fog = new Fog(HAZE_COLOR, 1, 2);
  scene.fog = fog;
  scene.background = new Color(HAZE_COLOR);

  return {
    sunDirection,
    update(target, distance, tilt) {
      // the shadow map covers the ground in view and a margin around it
      const half = Math.min(Math.max(distance * 1.15, 3), mapSpan);
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(sunDirection, half * 3);
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

      // looking down, everything is about `distance` away and stays clear;
      // looking across, the far ground fades into the haze
      const oblique = Math.cos(tilt);
      fog.near = distance * (1.1 + 0.6 * (1 - oblique));
      fog.far = distance * (4.5 + 14 * (1 - oblique));
    },
    dispose() {
      scene.remove(sun, sun.target, sky);
      sun.dispose();
      sky.dispose();
      scene.fog = null;
    },
  };
}
