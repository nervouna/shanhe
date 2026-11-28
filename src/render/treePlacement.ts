/**
 * Which trees stand where: the family of every tree follows the terrain,
 * the feature, the altitude and the latitude of its hex, and its place in
 * the hex comes from a hash, so that the same map always grows the same
 * forest. No Three.js.
 */

import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import { Feature, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { latitudeAt, latitudeTerms } from './climate.ts';
import type { LatitudeTerms } from './climate.ts';

/** The five families of trees. */
export const TreeFamily = {
  Conifer: 0,
  Broadleaf: 1,
  Bamboo: 2,
  Palm: 3,
  /** The wide, flat crowns of a rainforest canopy. */
  Rainforest: 4,
} as const;
export type TreeFamilyId = (typeof TreeFamily)[keyof typeof TreeFamily];
export const TREE_FAMILY_COUNT = 5;

export interface Tree {
  readonly family: TreeFamilyId;
  /** World position of the foot of the trunk. */
  readonly x: number;
  readonly z: number;
  /** Height in world units. */
  readonly height: number;
  /** Turn about the vertical axis, in radians. */
  readonly yaw: number;
  /** Brightness of the crown, around 1. */
  readonly tint: number;
}

/** Trees per hex. */
export const FOREST_TREES = 46;
export const JUNGLE_TREES = 58;
const OASIS_TREES = 6;
const MARSH_TREES = 3;
/** A city site keeps this much of its hex clear, as a fraction of the hex size. */
const SITE_CLEARING = 0.95;
/** Tree heights as fractions of the hex size, per family. */
const HEIGHTS: readonly number[] = [0.2, 0.16, 0.19, 0.2, 0.22];

function hash(a: number, b: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 0x165667b1);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** What a hex grows: how many trees, and the share of each family among them. */
export interface HexGrowth {
  readonly count: number;
  /** Per family, in the order of {@link TreeFamily}; sums to 1 when `count > 0`. */
  readonly shares: readonly [number, number, number, number, number];
}

const NOTHING: HexGrowth = { count: 0, shares: [0, 0, 0, 0, 0] };

/**
 * The rule that turns a hex into trees.
 *
 * - Jungle is rainforest canopy with palms in the tropics; north of the
 *   tropic it thins into broadleaf and bamboo.
 * - Forest is conifer in the north, on high ground and on tundra and snow,
 *   mixed in the temperate belt, broadleaf with bamboo in the warm south
 *   and broadleaf with palms in the tropics.
 * - An oasis is a ring of palms; a marsh has a few broadleaf trees.
 * - Open grassland and plains carry a stray tree or two; desert, tundra,
 *   snow, mountains and water carry none.
 *
 * @param latitude in degrees north.
 * @param elevation in metres.
 * @param seed any number that differs from hex to hex.
 */
export function hexGrowth(terrain: number, feature: number, latitude: number, elevation: number, seed: number): HexGrowth {
  if (isWaterTerrain(terrain) || terrain === Terrain.Mountain) return NOTHING;
  if (feature === Feature.Volcano) return NOTHING;
  if (feature === Feature.Oasis) return { count: OASIS_TREES, shares: [0, 0, 0, 1, 0] };
  if (feature === Feature.Marsh) return { count: MARSH_TREES, shares: [0, 1, 0, 0, 0] };
  const cold = terrain === Terrain.Tundra || terrain === Terrain.Snow;
  if (feature === Feature.Jungle) {
    if (latitude < 23.5) return { count: JUNGLE_TREES, shares: [0, 0.12, 0.06, 0.12, 0.7] };
    return { count: JUNGLE_TREES, shares: [0, 0.6, 0.3, 0, 0.1] };
  }
  if (feature === Feature.Forest) {
    // conifers take over towards the north and with altitude
    const northern = Math.min(1, Math.max(0, (latitude - 36) / 12));
    const high = Math.min(1, Math.max(0, (elevation - 1800) / 1200));
    const conifer = cold ? 1 : Math.max(northern, high);
    const rest = 1 - conifer;
    if (latitude < 23.5) return { count: FOREST_TREES, shares: [conifer, rest * 0.7, rest * 0.1, rest * 0.2, 0] };
    const bamboo = latitude < 33 && elevation < 1500 ? 0.28 : 0;
    return { count: FOREST_TREES, shares: [conifer, rest * (1 - bamboo), rest * bamboo, 0, 0] };
  }
  if (terrain === Terrain.Grassland || terrain === Terrain.Plains) {
    // a stray tree or two on about every third hex
    const count = seed < 0.34 ? 1 + Math.floor(seed * 6) : 0;
    if (count === 0) return NOTHING;
    if (latitude < 23.5) return { count, shares: [0, 0.5, 0, 0.5, 0] };
    return latitude > 46 ? { count, shares: [1, 0, 0, 0, 0] } : { count, shares: [0, 1, 0, 0, 0] };
  }
  return NOTHING;
}

/** The family at position `pick` (0 to 1) along the shares. */
function familyAt(shares: readonly number[], pick: number): TreeFamilyId {
  let sum = 0;
  for (let family = 0; family < TREE_FAMILY_COUNT; family++) {
    sum += shares[family] as number;
    if (pick < sum) return family as TreeFamilyId;
  }
  return TreeFamily.Broadleaf;
}

export interface TreePlacer {
  /** What hex `index` grows. */
  growth(index: number): HexGrowth;
  /**
   * The trees of hex `index`, the same on every call. They stand inside the
   * hex, a little short of its edge; the hex of a city site keeps its
   * middle clear.
   */
  trees(index: number): Tree[];
}

export function createTreePlacer(map: MapData, terms: LatitudeTerms = latitudeTerms(map.projection)): TreePlacer {
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const sites = new Set(map.zones.map((zone) => zone.siteHex));
  const halfWidth = (Math.sqrt(3) / 2) * size;

  const growth = (index: number): HexGrowth => {
    const centre = hexToWorld(indexToOffset(index, map.width), layout);
    return hexGrowth(
      map.terrain[index] as number,
      map.feature[index] as number,
      latitudeAt(terms, centre.x, centre.z),
      map.elevation[index] as number,
      hash(index, 11),
    );
  };

  return {
    growth,
    trees(index) {
      const grown = growth(index);
      if (grown.count === 0) return [];
      const centre = hexToWorld(indexToOffset(index, map.width), layout);
      const oasis = map.feature[index] === Feature.Oasis;
      const clearing = sites.has(index) ? SITE_CLEARING * size : 0;
      const out: Tree[] = [];
      // more tries than trees: points outside the hexagon or in a clearing are dropped
      for (let attempt = 0; out.length < grown.count && attempt < grown.count * 4; attempt++) {
        let dx = (hash(index, attempt * 7 + 1) * 2 - 1) * halfWidth;
        let dz = (hash(index, attempt * 7 + 2) * 2 - 1) * size;
        if (oasis) {
          // around the pond in the middle
          const angle = hash(index, attempt * 7 + 1) * Math.PI * 2;
          const reach = (0.36 + 0.22 * hash(index, attempt * 7 + 2)) * size;
          dx = Math.cos(angle) * reach;
          dz = Math.sin(angle) * reach;
        }
        if (Math.abs(dx) > halfWidth * 0.97 || Math.abs(dz) > (size - Math.abs(dx) / Math.sqrt(3)) * 0.97) continue;
        if (Math.hypot(dx, dz) < clearing) continue;
        const family = familyAt(grown.shares, hash(index, attempt * 7 + 3));
        const vary = hash(index, attempt * 7 + 4);
        out.push({
          family,
          x: centre.x + dx,
          z: centre.z + dz,
          height: (HEIGHTS[family] as number) * size * (0.75 + 0.5 * vary),
          yaw: hash(index, attempt * 7 + 5) * Math.PI * 2,
          tint: 0.85 + 0.3 * hash(index, attempt * 7 + 6),
        });
      }
      return out;
    },
  };
}
