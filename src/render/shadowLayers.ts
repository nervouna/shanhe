/**
 * What casts shadows is sorted into two Three.js layers, each drawn into
 * shadow maps of its own (see `lighting.ts`): the ground layer is cached for
 * as long as nothing on the ground changes, the piece layer is drawn again
 * whenever a piece moves.
 *
 * An object that casts a shadow has to be on one of the two layers: the
 * shadow cameras see nothing else.
 */

import type { Object3D } from 'three/webgpu';

/** Terrain, trees, cities and the buildings of improvements: everything that stands still. */
export const GROUND_SHADOW_LAYER = 1;
/** The discs that cast the shadows of the unit pieces. */
export const PIECE_SHADOW_LAYER = 2;

/** Makes an object that is drawn in the view cast a shadow as part of the ground. */
export function castGroundShadow(object: Object3D): void {
  object.castShadow = true;
  object.layers.enable(GROUND_SHADOW_LAYER);
}
