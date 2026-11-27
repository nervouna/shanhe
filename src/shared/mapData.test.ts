import { describe, expect, it } from 'vitest';
import { createFixtureMap } from './fixtureMap.ts';
import { MAP_FORMAT_VERSION, parseMapData, serializeMapData } from './mapData.ts';

describe('MapData serialization', () => {
  it('round-trips through one JSON string plus binary buffers', () => {
    const map = createFixtureMap();
    const { json, buffers } = serializeMapData(map, 'fixture');

    expect(typeof json).toBe('string');
    const names = Object.keys(buffers);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^fixture\.[a-zA-Z]+\.bin$/);
      expect(buffers[name]).toBeInstanceOf(Uint8Array);
    }

    const parsed = parseMapData(json, buffers);
    expect(parsed).toEqual(map);
    expect(parsed.version).toBe(MAP_FORMAT_VERSION);
    expect(parsed.elevation).toBeInstanceOf(Int16Array);
    expect(parsed.owner).toBeInstanceOf(Int16Array);
    expect(parsed.terrain).toBeInstanceOf(Uint8Array);
  });

  it('stores multi-byte layers little-endian', () => {
    const map = createFixtureMap();
    const { buffers } = serializeMapData(map, 'm');
    const bytes = buffers['m.elevation.bin'];
    expect(bytes).toBeDefined();
    const view = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength);
    for (let i = 0; i < map.elevation.length; i++) {
      expect(view.getInt16(i * 2, true)).toBe(map.elevation[i]);
    }
  });

  it('does not alias the source arrays', () => {
    const map = createFixtureMap();
    const { json, buffers } = serializeMapData(map);
    const parsed = parseMapData(json, buffers);
    parsed.owner[0] = 12345;
    expect(map.owner[0]).not.toBe(12345);
  });

  it('rejects a missing buffer, a wrong length and an unknown version', () => {
    const map = createFixtureMap();
    const { json, buffers } = serializeMapData(map, 'm');

    const missing = { ...buffers };
    delete missing['m.owner.bin'];
    expect(() => parseMapData(json, missing)).toThrow(/m\.owner\.bin/);

    const short = { ...buffers, 'm.terrain.bin': new Uint8Array(3) };
    expect(() => parseMapData(json, short)).toThrow(/terrain/);

    const header = JSON.parse(json) as { version: number };
    header.version = 999;
    expect(() => parseMapData(JSON.stringify(header), buffers)).toThrow(/version/);
  });
});
