/**
 * The cloud layer: seen from far above, the clouds whose shadows drift over
 * the ground (`cloudCover` in `shaderLib.ts`) are themselves in view, as a
 * sheet over the map. Close to the ground the camera is below them and only
 * their shadows show.
 */

import { float, mix, positionWorld, smoothstep, vec2, vec3 } from 'three/tsl';
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import type { WorldRect } from '../shared/mapData.ts';
import { CLOUD_LAYER_EDGES, cloudLayerOpacity, cloudShadowEdges } from './lightMath.ts';
import { cloudCover, noiseTile } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface Clouds {
  readonly object: Mesh;
  /**
   * @param zoom the zoom fraction, 0 nearest and 1 farthest.
   * @returns how opaque the layer is now, 0 to 1.
   */
  update(zoom: number): number;
  dispose(): void;
}

/**
 * @param rect the ground the layer floats over.
 * @param height of the layer, in world units.
 */
export function createClouds(u: MapUniforms, rect: WorldRect, height: number): Clouds {
  const geometry = new PlaneGeometry(rect.maxX - rect.minX, rect.maxZ - rect.minZ).rotateX(-Math.PI / 2);
  const material = new MeshBasicNodeMaterial();
  const xz = positionWorld.xz;
  // only the thick middles of the clouds whose shadows drift over the ground: about a sixth of the land
  const cover = cloudCover(u, xz, vec2(CLOUD_LAYER_EDGES[0], CLOUD_LAYER_EDGES[1]));
  // thicker cloud is brighter in the middle and grey at its thin edge; never the blue-white of snow
  const billow = noiseTile(u, xz.div(u.hexSize).div(7).add(u.clock.mul(0.004))).g;
  material.colorNode = vec3(mix(vec3(0.66, 0.68, 0.73), vec3(1, 0.985, 0.95), smoothstep(0.1, 0.9, cover.mul(0.7).add(billow.mul(0.3)))));
  // thin over the political map, which has to stay readable
  material.opacityNode = cover.mul(mix(float(0.7), float(1), billow)).mul(u.cloudLayer).mul(mix(float(1), float(0.4), u.political));
  material.transparent = true;
  material.depthWrite = false;
  material.fog = false;
  const object = new Mesh(geometry, material);
  object.name = 'clouds';
  object.position.set((rect.minX + rect.maxX) / 2, height, (rect.minZ + rect.maxZ) / 2);
  object.renderOrder = 8;
  object.visible = false;
  return {
    object,
    update(zoom) {
      const opacity = cloudLayerOpacity(zoom);
      u.cloudLayer.value = opacity;
      const edges = cloudShadowEdges(zoom);
      u.cloudEdges.value.set(edges[0], edges[1]);
      object.visible = opacity > 0.002;
      return opacity;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
