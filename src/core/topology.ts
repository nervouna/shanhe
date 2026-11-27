/**
 * Indexes derived from a map once and shared by every game on it. They are
 * kept outside the game state, in a cache keyed by the `MapData` object.
 */

import { hexDistance, hexNeighbors, hexRange, indexToOffset } from '../shared/hex.ts';
import type { Offset } from '../shared/hex.ts';
import { NO_ZONE, OWNER_OFF_MAP, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import {
  CITY,
  FEATURE_YIELDS,
  HILLS_YIELD,
  MOVE_COST,
  RESOURCE_YIELD,
  RIVER_YIELD,
  ROUGH_FEATURES,
  TERRAIN_YIELDS,
} from './data.ts';

export interface Topology {
  readonly count: number;
  /** `count * 6` hex indices: neighbour of hex `h` in direction `d` at `h * 6 + d`, or -1 outside the grid. */
  readonly neighbors: Int32Array;
  /** Per hex: 1 if a unit could ever stand on it (inside the play area, not a mountain). */
  readonly enterable: Uint8Array;
  /** Per hex: 1 for ocean, coast and lake. */
  readonly water: Uint8Array;
  /** Per hex: movement points a land unit pays to enter it. */
  readonly moveCost: Uint8Array;
  /** Per hex: the zone whose city site it is, or -1. */
  readonly siteZone: Int16Array;
  /**
   * Per hex: the zone whose citizens may work it and whose city may improve
   * it, or -1. A land hex belongs to its own zone; a water hex goes to the
   * nearest site in reach.
   */
  readonly workZone: Int16Array;
  /** Per hex: base food, production and gold, before improvements and buildings. */
  readonly baseFood: Uint8Array;
  readonly baseProduction: Uint8Array;
  readonly baseGold: Uint8Array;
  /** Per zone: all its hexes, ascending. */
  readonly zoneHexes: readonly (readonly number[])[];
  /** Per zone: the hexes its citizens may work (the site excluded), ascending. */
  readonly workHexes: readonly (readonly number[])[];
  /** Per zone: zones it touches, over land or across one hex of water, ascending. */
  readonly zoneNeighbors: readonly (readonly number[])[];
  /** Per zone: true if the site is next to coast or ocean. */
  readonly coastal: readonly boolean[];
  /** Per resource (index into `map.resources`): the hexes that carry it, ascending. */
  readonly resourceHexes: readonly (readonly number[])[];
  /** Per zone: the resources (indices into `map.resources`) on its land and on the water its city works, ascending. */
  readonly zoneResources: readonly (readonly number[])[];
}

const cache = new WeakMap<MapData, Topology>();

/** The indexes of `map`, built on first use. */
export function topologyOf(map: MapData): Topology {
  let topo = cache.get(map);
  if (topo === undefined) {
    topo = buildTopology(map);
    cache.set(map, topo);
  }
  return topo;
}

function buildTopology(map: MapData): Topology {
  const { width, height } = map;
  const count = width * height;
  const inGrid = (hex: Offset): boolean =>
    hex.col >= 0 && hex.col < width && hex.row >= 0 && hex.row < height;

  const neighbors = new Int32Array(count * 6).fill(-1);
  const enterable = new Uint8Array(count);
  const water = new Uint8Array(count);
  const moveCost = new Uint8Array(count);
  const baseFood = new Uint8Array(count);
  const baseProduction = new Uint8Array(count);
  const baseGold = new Uint8Array(count);

  for (let h = 0; h < count; h++) {
    const terrain = map.terrain[h] as number;
    const feature = map.feature[h] as number;
    const hilly = map.hills[h] === 1;
    hexNeighbors(indexToOffset(h, width)).forEach((n, d) => {
      if (inGrid(n)) neighbors[h * 6 + d] = n.row * width + n.col;
    });
    water[h] = isWaterTerrain(terrain) ? 1 : 0;
    enterable[h] = map.owner[h] !== OWNER_OFF_MAP && terrain !== Terrain.Mountain ? 1 : 0;
    moveCost[h] =
      MOVE_COST.base +
      (hilly ? MOVE_COST.hills : 0) +
      (ROUGH_FEATURES.includes(feature) ? MOVE_COST.roughFeature : 0);

    const t = TERRAIN_YIELDS[terrain] ?? { food: 0, production: 0, gold: 0 };
    const f = FEATURE_YIELDS[feature] ?? { food: 0, production: 0, gold: 0 };
    let food = t.food + f.food;
    let production = t.production + f.production;
    let gold = t.gold + f.gold;
    if (hilly) {
      food += HILLS_YIELD.food;
      production += HILLS_YIELD.production;
      gold += HILLS_YIELD.gold;
    }
    if (map.riverEdges[h] !== 0) {
      food += RIVER_YIELD.food;
      production += RIVER_YIELD.production;
      gold += RIVER_YIELD.gold;
    }
    if ((map.resource[h] as number) >= 0) {
      food += RESOURCE_YIELD.food;
      production += RESOURCE_YIELD.production;
      gold += RESOURCE_YIELD.gold;
    }
    baseFood[h] = Math.max(0, food);
    baseProduction[h] = Math.max(0, production);
    baseGold[h] = Math.max(0, gold);
  }

  const zoneCount = map.zones.length;
  const siteZone = new Int16Array(count).fill(-1);
  const workZone = new Int16Array(count).fill(-1);
  const zoneHexes: number[][] = map.zones.map(() => []);
  const workHexes: number[][] = map.zones.map(() => []);
  const coastal: boolean[] = [];
  const sites = map.zones.map((zone) => indexToOffset(zone.siteHex, width));
  map.zones.forEach((zone, z) => {
    siteZone[zone.siteHex] = z;
  });

  for (let h = 0; h < count; h++) {
    const z = map.zone[h] as number;
    if (z === NO_ZONE || z >= zoneCount) continue;
    (zoneHexes[z] as number[]).push(h);
    if (enterable[h] === 1 && water[h] === 0 && siteZone[h] === -1) workZone[h] = z;
  }

  // Water goes to the nearest site within reach; the lower zone wins a tie.
  const waterDistance = new Uint8Array(count).fill(255);
  for (let z = 0; z < zoneCount; z++) {
    const site = sites[z] as Offset;
    let nextToSea = false;
    for (const n of hexNeighbors(site)) {
      if (!inGrid(n)) continue;
      const terrain = map.terrain[n.row * width + n.col];
      if (terrain === Terrain.Coast || terrain === Terrain.Ocean) nextToSea = true;
    }
    coastal.push(nextToSea);
    for (const n of hexRange(site, CITY.waterRadius)) {
      if (!inGrid(n)) continue;
      const h = n.row * width + n.col;
      const terrain = map.terrain[h];
      if (terrain !== Terrain.Coast && terrain !== Terrain.Lake) continue;
      if (map.owner[h] === OWNER_OFF_MAP) continue;
      const d = hexDistance(n, site);
      if (d < (waterDistance[h] as number)) {
        waterDistance[h] = d;
        workZone[h] = z;
      }
    }
  }
  for (let h = 0; h < count; h++) {
    const z = workZone[h] as number;
    if (z >= 0) (workHexes[z] as number[]).push(h);
  }

  // Zone adjacency: over a shared land edge, or through one water hex.
  const adjacent: Set<number>[] = map.zones.map(() => new Set<number>());
  const link = (a: number, b: number): void => {
    if (a === b || a < 0 || b < 0) return;
    (adjacent[a] as Set<number>).add(b);
    (adjacent[b] as Set<number>).add(a);
  };
  for (let h = 0; h < count; h++) {
    if (map.owner[h] === OWNER_OFF_MAP) continue;
    if (water[h] === 1) {
      const around: number[] = [];
      for (let d = 0; d < 6; d++) {
        const n = neighbors[h * 6 + d] as number;
        if (n >= 0 && map.zone[n] !== NO_ZONE) around.push(map.zone[n] as number);
      }
      for (const a of around) for (const b of around) link(a, b);
      continue;
    }
    const z = map.zone[h] as number;
    if (z === NO_ZONE) continue;
    for (let d = 0; d < 6; d++) {
      const n = neighbors[h * 6 + d] as number;
      if (n >= 0 && map.zone[n] !== NO_ZONE) link(z, map.zone[n] as number);
    }
  }
  const zoneNeighbors = adjacent.map((set) => [...set].sort((a, b) => a - b));

  const resourceHexes: number[][] = map.resources.map(() => []);
  const zoneResourceSets: Set<number>[] = map.zones.map(() => new Set<number>());
  for (let h = 0; h < count; h++) {
    if (map.owner[h] === OWNER_OFF_MAP) continue;
    const resource = map.resource[h] as number;
    if (resource < 0 || resource >= map.resources.length) continue;
    (resourceHexes[resource] as number[]).push(h);
    const z = (map.zone[h] as number) >= 0 ? (map.zone[h] as number) : (workZone[h] as number);
    if (z >= 0 && z < zoneCount) (zoneResourceSets[z] as Set<number>).add(resource);
  }
  const zoneResources = zoneResourceSets.map((set) => [...set].sort((a, b) => a - b));

  return {
    count,
    neighbors,
    enterable,
    water,
    moveCost,
    siteZone,
    workZone,
    baseFood,
    baseProduction,
    baseGold,
    zoneHexes,
    workHexes,
    zoneNeighbors,
    coastal,
    resourceHexes,
    zoneResources,
  };
}
