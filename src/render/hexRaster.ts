/**
 * A regular pixel grid over the map in which every pixel knows its hex.
 * The renderer paints per-hex data (land cover, territory, fog) into small
 * textures through it. No Three.js.
 */

import { worldToHex } from '../shared/hex.ts';
import type { MapData, WorldRect } from '../shared/mapData.ts';
import { mapWorldRect } from './heightField.ts';

export interface HexRaster {
  /** Pixels per row. */
  readonly width: number;
  /** Number of rows, north to south. */
  readonly height: number;
  /** The rectangle the pixels cover, edge to edge. */
  readonly rect: WorldRect;
  /** Per pixel, row by row: the hex index under the pixel centre, or -1 outside the grid. */
  readonly hexAt: Int32Array;
}

/**
 * @param pixelsPerHex pixels across the width of one hex.
 * @param maxSize upper bound for both sides; large maps get fewer pixels per hex.
 */
export function createHexRaster(map: MapData, pixelsPerHex = 4, maxSize = 2048): HexRaster {
  const layout = map.projection.hexLayout;
  const rect = mapWorldRect(map);
  const spanX = rect.maxX - rect.minX;
  const spanZ = rect.maxZ - rect.minZ;
  const pixel = Math.max(
    (Math.sqrt(3) * layout.size) / pixelsPerHex,
    spanX / maxSize,
    spanZ / maxSize,
  );
  const width = Math.max(1, Math.round(spanX / pixel));
  const height = Math.max(1, Math.round(spanZ / pixel));
  const hexAt = new Int32Array(width * height);
  for (let j = 0; j < height; j++) {
    const z = rect.minZ + ((j + 0.5) / height) * spanZ;
    for (let i = 0; i < width; i++) {
      const x = rect.minX + ((i + 0.5) / width) * spanX;
      const hex = worldToHex({ x, z }, layout);
      const inside = hex.col >= 0 && hex.col < map.width && hex.row >= 0 && hex.row < map.height;
      hexAt[j * width + i] = inside ? hex.row * map.width + hex.col : -1;
    }
  }
  return { width, height, rect, hexAt };
}
