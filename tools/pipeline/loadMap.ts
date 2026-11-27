/** Reads the committed map from `public/data/`. */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapData } from '../../src/shared/mapData.ts';
import type { MapData } from '../../src/shared/mapData.ts';

export const MAP_DIR = join(import.meta.dirname, '..', '..', 'public', 'data');

export interface LoadedMap {
  readonly map: MapData;
  /** Size of the heightmap file in bytes. */
  readonly heightmapBytes: number;
  /** Size of everything in `public/data`, in bytes. */
  readonly totalBytes: number;
}

export function loadMap(dir: string = MAP_DIR): LoadedMap {
  const json = readFileSync(join(dir, 'map.json'), 'utf8');
  const buffers: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  for (const file of readdirSync(dir)) {
    totalBytes += statSync(join(dir, file)).size;
    if (file.endsWith('.bin') && file !== 'map.height.bin') {
      buffers[file] = new Uint8Array(readFileSync(join(dir, file)));
    }
  }
  const map = parseMapData(json, buffers);
  return { map, heightmapBytes: statSync(join(dir, map.heightmap.file)).size, totalBytes };
}
