/**
 * Minimal ZIP reader: stored and deflated entries, no ZIP64, no encryption.
 * Enough for the dataset archives the pipeline downloads.
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** Reads the entries of `zipPath` whose names are listed in `names`. */
export function readZipEntries(zipPath: string, names: readonly string[]): Map<string, Buffer> {
  const zip = readFileSync(zipPath);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`zip: ${zipPath} has no end-of-central-directory record`);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const wanted = new Set(names);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`zip: ${zipPath} is corrupt`);
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted.has(name)) continue;
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`zip: ${zipPath} is corrupt`);
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`zip: ${name} uses unsupported compression method ${method}`);
    if (data.length !== size) throw new Error(`zip: ${name} has the wrong size`);
    out.set(name, data);
  }
  for (const name of names) {
    if (!out.has(name)) throw new Error(`zip: ${zipPath} has no entry ${name}`);
  }
  return out;
}
