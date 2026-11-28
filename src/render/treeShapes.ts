/**
 * The shape of one tree of each family, generated: a trunk and a crown of
 * a few dozen triangles, one unit tall, standing on the origin. A second,
 * coarser version of each is used farther from the camera. No Three.js.
 */

import { ShapeBuilder, rgb, shade } from './shapes.ts';
import type { Rgb } from './shapes.ts';
import { TreeFamily } from './treePlacement.ts';
import type { TreeFamilyId } from './treePlacement.ts';

const BARK: Rgb = rgb(0x4a3a2a);
/** Crown colours per family: underside and top. They sit close to the forest colours of the ground shader. */
const CROWNS: readonly (readonly [Rgb, Rgb])[] = [
  [rgb(0x12301f), rgb(0x2b5a3a)], // conifer: dark, bluish
  [rgb(0x1f4a22), rgb(0x4d8235)], // broadleaf
  [rgb(0x4f7a2a), rgb(0x9bb84a)], // bamboo: light, yellowish
  [rgb(0x2a5a25), rgb(0x6fa53c)], // palm
  [rgb(0x0f3a1c), rgb(0x2f7030)], // rainforest canopy: deep green
];

/**
 * @param detailed the version for trees near the camera; otherwise a crown of a handful of triangles.
 */
export function buildTreeShape(family: TreeFamilyId, detailed: boolean): ShapeBuilder {
  const shape = new ShapeBuilder();
  const [under, top] = CROWNS[family] as readonly [Rgb, Rgb];
  switch (family) {
    case TreeFamily.Conifer: {
      if (!detailed) {
        // from the middle distances: a broad cone that closes ranks with its neighbours
        shape.frustum(0, 0, 0.06, 1, 0.25, 0, 5, under, top);
        break;
      }
      shape.frustum(0, 0, 0, 0.3, 0.035, 0.03, 4, BARK);
      // three tiers of branches, each narrower than the one below
      shape.frustum(0, 0, 0.16, 0.56, 0.23, 0.04, 6, under, shade(top, 0.85));
      shape.frustum(0, 0, 0.4, 0.8, 0.17, 0.03, 6, under, top, 0.5);
      shape.frustum(0, 0, 0.64, 1, 0.11, 0, 6, shade(top, 0.8), top);
      break;
    }
    case TreeFamily.Broadleaf: {
      if (!detailed) {
        // from the middle distances: a wide, low crown without a trunk, which
        // runs into the crowns around it, so that a forest is a canopy and not a field of balls
        shape.blob(0, 0.48, 0, 0.42, 0.4, 5, 2, under, top);
        break;
      }
      // a short trunk under a crown of three lumps of different size: broad, uneven, never a ball on a stick
      shape.frustum(0, 0, 0, 0.36, 0.05, 0.032, 3, BARK);
      shape.blob(-0.05, 0.6, 0.02, 0.3, 0.26, 6, 2, under, top);
      shape.blob(0.19, 0.5, 0.1, 0.21, 0.18, 5, 2, under, shade(top, 0.9));
      shape.blob(0.06, 0.8, -0.08, 0.2, 0.17, 5, 2, shade(under, 1.1), shade(top, 1.06));
      break;
    }
    case TreeFamily.Bamboo: {
      // a clump of thin canes, each with a tuft of leaves
      const canes = detailed ? 4 : 2;
      for (let i = 0; i < canes; i++) {
        const angle = (i / canes) * Math.PI * 2 + 0.4;
        const lean = 0.07 + 0.03 * (i % 2);
        const x = Math.cos(angle) * lean;
        const z = Math.sin(angle) * lean;
        const height = 0.78 + 0.22 * ((i * 7) % 4) / 3;
        if (detailed) shape.frustum(x, z, 0, height * 0.72, 0.014, 0.01, 3, shade(top, 0.75));
        shape.frustum(x * 1.5, z * 1.5, height * 0.45, height, 0.085, 0, detailed ? 5 : 4, under, top, angle);
      }
      break;
    }
    case TreeFamily.Palm: {
      shape.frustum(0, 0, 0, 0.84, 0.035, 0.022, detailed ? 5 : 3, BARK, shade(BARK, 1.3));
      // fronds: flat blades that arch out from the top and droop
      const fronds = detailed ? 7 : 4;
      for (let i = 0; i < fronds; i++) {
        const angle = (i / fronds) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const side = 0.07;
        const mid = [cos * 0.2, 0.96, sin * 0.2];
        const tip = [cos * 0.42, 0.72, sin * 0.42];
        const left = [cos * 0.2 - sin * side, 0.93, sin * 0.2 + cos * side];
        const right = [cos * 0.2 + sin * side, 0.93, sin * 0.2 - cos * side];
        const root = [0, 0.84, 0];
        shape.triangle(root, left, mid, under, top);
        shape.triangle(root, mid, right, under, top);
        shape.triangle(left, tip, mid, top, shade(top, 0.8));
        shape.triangle(mid, tip, right, top, shade(top, 0.8));
        // the same blades seen from below
        shape.triangle(root, mid, left, under);
        shape.triangle(root, right, mid, under);
        shape.triangle(left, mid, tip, under);
        shape.triangle(mid, right, tip, under);
      }
      break;
    }
    case TreeFamily.Rainforest: {
      if (!detailed) {
        // from the middle distances: the closed roof of the rainforest
        shape.blob(0, 0.64, 0, 0.5, 0.28, 6, 2, under, top);
        break;
      }
      shape.frustum(0, 0, 0, 0.6, 0.05, 0.03, 3, BARK);
      // a wide, flat-topped crown in two tiers over a ragged understorey
      shape.blob(0.04, 0.76, 0, 0.44, 0.2, 7, 2, under, top);
      shape.blob(-0.2, 0.9, 0.12, 0.24, 0.13, 5, 2, shade(under, 1.1), shade(top, 1.05));
      shape.blob(-0.14, 0.42, 0.1, 0.2, 0.16, 5, 2, shade(under, 0.9), shade(top, 0.8));
      break;
    }
  }
  return shape;
}
