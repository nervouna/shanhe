/** Small synthetic maps for the renderer's tests. */

import { MAP_FORMAT_VERSION, NO_RESOURCE, NO_ZONE, OWNER_UNOWNED, Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';

export interface FlatMapOptions {
  readonly width: number;
  readonly height: number;
  /** Elevation of every hex in metres. */
  readonly metres: number;
  readonly size?: number;
  readonly originX?: number;
  readonly originZ?: number;
}

/** A map of plains at one elevation, with no polities and no heightmap file. */
export function createFlatMap(options: FlatMapOptions): MapData {
  const { width, height, metres } = options;
  const size = options.size ?? 1;
  const originX = options.originX ?? 0;
  const originZ = options.originZ ?? 0;
  const count = width * height;
  const hexWidth = Math.sqrt(3) * size;
  return {
    version: MAP_FORMAT_VERSION,
    width,
    height,
    terrain: new Uint8Array(count).fill(Terrain.Plains),
    hills: new Uint8Array(count),
    feature: new Uint8Array(count),
    elevation: new Int16Array(count).fill(metres),
    owner: new Int16Array(count).fill(OWNER_UNOWNED),
    zone: new Int16Array(count).fill(NO_ZONE),
    riverEdges: new Uint8Array(count),
    resource: new Int16Array(count).fill(NO_RESOURCE),
    polities: [],
    zones: [],
    resources: [],
    offMapPorts: [],
    heightmap: {
      file: 'flat.height.bin',
      width: 5,
      height: 4,
      metresPerUnit: 0.5,
      baseMetres: -1000,
      world: {
        minX: originX - hexWidth / 2,
        minZ: originZ - size,
        maxX: originX + hexWidth * width,
        maxZ: originZ + 1.5 * size * (height - 1) + size,
      },
    },
    projection: {
      kind: 'albersEqualArea',
      lon0: 105,
      lat0: 35,
      parallel1: 15,
      parallel2: 55,
      radiusKm: 6371,
      kmPerWorldUnit: 80 / hexWidth,
      hexLayout: { size, originX, originZ },
    },
  };
}
