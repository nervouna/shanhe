/**
 * Pictures of a map for the eyes of whoever tunes the pipeline:
 * `npm run pipeline -- --debug`. They go to `data/raw/debug/`, which git
 * ignores; the project commits no image.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Feature, OWNER_OFF_MAP, Terrain, isWaterTerrain } from '../../src/shared/mapData.ts';
import type { MapData } from '../../src/shared/mapData.ts';

const HEX_W = 8;
const HEX_H = 7;

function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TERRAIN_COLOURS: Record<number, number> = {
  [Terrain.Ocean]: 0x1d3f6e,
  [Terrain.Coast]: 0x3f78a8,
  [Terrain.Lake]: 0x6fb7d6,
  [Terrain.Plains]: 0xc9b86a,
  [Terrain.Grassland]: 0x86b356,
  [Terrain.Desert]: 0xe6d6a0,
  [Terrain.Tundra]: 0x9aa58f,
  [Terrain.Snow]: 0xf2f4f6,
  [Terrain.Mountain]: 0x5b5148,
};

function shade(colour: number, factor: number): number {
  const part = (shift: number): number =>
    Math.max(0, Math.min(255, Math.round(((colour >> shift) & 255) * factor)));
  return (part(16) << 16) | (part(8) << 8) | part(0);
}

export function writeDebugImages(dir: string, map: MapData): void {
  mkdirSync(dir, { recursive: true });
  const width = map.width * HEX_W + HEX_W / 2;
  const height = map.height * HEX_H;
  const draw = (name: string, colourOf: (index: number) => number): void => {
    const rgb = new Uint8Array(width * height * 3);
    const sites = new Set(map.zones.map((z) => z.siteHex));
    const ports = new Set(map.offMapPorts.map((p) => p.hex));
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const index = row * map.width + col;
        const colour = colourOf(index);
        const x0 = col * HEX_W + (row & 1) * (HEX_W / 2);
        for (let y = 0; y < HEX_H; y++) {
          for (let x = 0; x < HEX_W; x++) {
            let c = colour;
            const middle = x >= 3 && x <= 4 && y >= 2 && y <= 4;
            if (middle && sites.has(index)) c = 0x000000;
            else if (middle && ports.has(index)) c = 0xff0000;
            else if (x === 0 && y === 0 && map.riverEdges[index] !== 0) c = 0x0030ff;
            else if (x === HEX_W - 1 && y === 0 && map.resource[index] !== -1) c = 0xff00ff;
            const at = ((row * HEX_H + y) * width + x0 + x) * 3;
            rgb[at] = c >> 16;
            rgb[at + 1] = (c >> 8) & 255;
            rgb[at + 2] = c & 255;
          }
        }
      }
    }
    writeFileSync(join(dir, name), png(width, height, rgb));
  };

  draw('political.png', (i) => {
    const terrain = map.terrain[i] as number;
    if (isWaterTerrain(terrain)) {
      return map.owner[i] === OWNER_OFF_MAP ? 0x10203a : (TERRAIN_COLOURS[terrain] as number);
    }
    if (map.owner[i] === OWNER_OFF_MAP) return 0x8a8a8a;
    const zone = map.zones[map.zone[i] as number];
    if (zone === undefined) return 0xff00ff;
    const colour = (map.polities[zone.polity] as (typeof map.polities)[number]).color;
    // zones of one polity alternate in brightness
    return shade(colour, 0.85 + 0.1 * ((map.zone[i] as number) % 3));
  });
  draw('terrain.png', (i) => {
    let colour = TERRAIN_COLOURS[map.terrain[i] as number] as number;
    const f = map.feature[i];
    if (f === Feature.Forest) colour = 0x3f7a3a;
    else if (f === Feature.Jungle) colour = 0x1f5c2c;
    else if (f === Feature.Marsh) colour = 0x5f8f8a;
    else if (f === Feature.Oasis) colour = 0x30c080;
    else if (f === Feature.Volcano) colour = 0xd03010;
    if (map.hills[i] === 1) colour = shade(colour, 0.8);
    return colour;
  });
}
