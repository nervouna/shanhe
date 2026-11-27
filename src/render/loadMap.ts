/**
 * Loads the generated map from `data/map.json` next to the page, or falls
 * back to the fixture map when the pipeline has not produced one.
 */

import { createFixtureMap } from '../shared/fixtureMap.ts';
import { parseMapData } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';

export interface LoadedMap {
  readonly map: MapData;
  /** Samples of the heightmap file, if the map has one that could be read. */
  readonly heightmap?: Uint16Array;
  /** `file` for the generated map, `fixture` for the built-in one. */
  readonly source: 'file' | 'fixture';
}

const MAP_FILE = 'data/map.json';

interface MapFileHeader {
  readonly format?: unknown;
  readonly layers?: Readonly<Record<string, { readonly file?: unknown } | undefined>>;
}

async function fetchBytes(url: URL): Promise<Uint8Array | null> {
  const response = await fetch(url);
  // a development server answers a missing file with the page itself
  if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return null;
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * @throws if `data/map.json` is a map file but it or one of its buffers
 *   cannot be read. A missing heightmap file is not an error: the relief is
 *   then built from the hex elevations.
 */
export async function loadMap(): Promise<LoadedMap> {
  const base = new URL(MAP_FILE, document.baseURI);
  const response = await fetch(base);
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('json')) return { map: createFixtureMap(), source: 'fixture' };

  const json = await response.text();
  const header = JSON.parse(json) as MapFileHeader;
  if (header.format !== 'shanhe-map') throw new Error(`${MAP_FILE} is not a shanhe-map file`);

  const buffers: Record<string, Uint8Array> = {};
  await Promise.all(
    Object.values(header.layers ?? {}).map(async (layer) => {
      const file = layer?.file;
      if (typeof file !== 'string') return;
      const bytes = await fetchBytes(new URL(file, base));
      if (bytes !== null) buffers[file] = bytes;
    }),
  );
  const map = parseMapData(json, buffers);

  const { file, width, height } = map.heightmap;
  const bytes = await fetchBytes(new URL(file, base));
  if (bytes === null || bytes.byteLength !== width * height * 2) return { map, source: 'file' };
  const heightmap = new Uint16Array(width * height);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < heightmap.length; i++) heightmap[i] = view.getUint16(i * 2, true);
  return { map, heightmap, source: 'file' };
}
