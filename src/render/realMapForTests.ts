/**
 * The committed map of `public/data`, read from disk for the renderer's
 * tests. Only tests import this file; it runs in Node and nowhere else.
 */

import { parseMapData } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';

/** The part of Node's `fs` this file uses: the app's type-check knows no Node types. */
interface FileSystem {
  readFileSync(path: URL): Uint8Array;
  readdirSync(path: URL): string[];
}

export interface RealMap {
  readonly map: MapData;
  readonly heightmap: Uint16Array;
}

let loaded: Promise<RealMap> | null = null;

/** The real map and the samples of its heightmap file. Read once per test run. */
export function loadRealMap(): Promise<RealMap> {
  loaded ??= (async () => {
    // a computed name, so that neither the bundler nor the type-check resolves it
    const moduleName = ['node', 'fs'].join(':');
    const fs = (await import(/* @vite-ignore */ moduleName)) as FileSystem;
    const dir = new URL('../../public/data/', import.meta.url);
    const buffers: Record<string, Uint8Array> = {};
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.bin') && file !== 'map.height.bin') buffers[file] = fs.readFileSync(new URL(file, dir));
    }
    const map = parseMapData(new TextDecoder().decode(fs.readFileSync(new URL('map.json', dir))), buffers);
    const bytes = fs.readFileSync(new URL(map.heightmap.file, dir));
    const heightmap = new Uint16Array(map.heightmap.width * map.heightmap.height);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < heightmap.length; i++) heightmap[i] = view.getUint16(i * 2, true);
    return { map, heightmap };
  })();
  return loaded;
}
