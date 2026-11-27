/**
 * The one mapping between the globe and the hex grid:
 *
 *     longitude, latitude --Albers--> source plane --warp--> map plane --> hex
 *
 * Borders, coast, lakes, climate, elevation, rivers and the heightmap are all
 * sampled through it, so they stay aligned.
 */

import { hexToWorld, worldToHex } from '../../src/shared/hex.ts';
import type { HexLayout, Offset } from '../../src/shared/hex.ts';
import type { MapProjection } from '../../src/shared/mapData.ts';
import { createAlbers } from './albers.ts';
import type { Albers, LonLat, PlanePoint } from './albers.ts';
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  KM_PER_WORLD_UNIT,
  LAYOUT_KM,
  LENSES,
  PROJECTION,
} from './config.ts';
import { buildWarp } from './warp.ts';
import type { LensSpec, Warp } from './warp.ts';

export interface Mapping {
  readonly albers: Albers;
  readonly warp: Warp;
  /** The hex grid on the map plane, km. */
  readonly layoutKm: HexLayout;
  readonly width: number;
  readonly height: number;
  /** Position on the map plane, km, of a place on the globe. */
  lonLatToMap(lon: number, lat: number, out?: PlanePoint): PlanePoint;
  /** The place on the globe shown at a point of the map plane, km. */
  mapToLonLat(x: number, z: number, out?: LonLat): LonLat;
  /** The hex that shows a place on the globe. It may lie outside the grid. */
  lonLatToHex(lon: number, lat: number): Offset;
  /** The place on the globe shown at the centre of a hex. */
  hexToLonLat(hex: Offset): LonLat;
  /** The `projection` entry of the map file. */
  readonly projection: MapProjection;
}

export function createMapping(lenses: readonly LensSpec[] = LENSES): Mapping {
  const albers = createAlbers(PROJECTION);
  const warp = buildWarp(lenses, albers, LAYOUT_KM);
  const scratch: PlanePoint = { x: 0, z: 0 };
  const lonLatToMap = (lon: number, lat: number, out: PlanePoint = { x: 0, z: 0 }): PlanePoint => {
    albers.forward(lon, lat, out);
    return warp.toMap(out.x, out.z, out);
  };
  const mapToLonLat = (x: number, z: number, out: LonLat = { lon: 0, lat: 0 }): LonLat => {
    warp.toSource(x, z, scratch);
    return albers.inverse(scratch.x, scratch.z, out);
  };
  return {
    albers,
    warp,
    layoutKm: LAYOUT_KM,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    lonLatToMap,
    mapToLonLat,
    lonLatToHex: (lon, lat) => worldToHex(lonLatToMap(lon, lat), LAYOUT_KM),
    hexToLonLat: (hex) => {
      const c = hexToWorld(hex, LAYOUT_KM);
      return mapToLonLat(c.x, c.z);
    },
    projection: {
      kind: 'albersEqualArea',
      ...PROJECTION,
      kmPerWorldUnit: KM_PER_WORLD_UNIT,
      hexLayout: {
        size: 1,
        originX: LAYOUT_KM.originX / KM_PER_WORLD_UNIT,
        originZ: LAYOUT_KM.originZ / KM_PER_WORLD_UNIT,
      },
    },
  };
}
