/**
 * Cached downloads for the map pipeline. A file that is already in
 * `data/raw/` is never fetched again, so a second run works offline.
 */

import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ATTEMPTS = 5;
/** `npm run pipeline -- --offline`: fail instead of downloading. */
const OFFLINE = process.argv.includes('--offline');
const TIMEOUT_MS = 10 * 60 * 1000;

/** True if `path` exists and is not empty. */
export function isCached(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}

/** True if the bytes start like a ZIP archive. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Makes sure `path` holds the content of `url`. Downloads into `path.part`
 * and renames, so an interrupted download never looks complete.
 *
 * @param isValid called with a fresh download; a body it rejects (an error
 *   page served with status 200, say) is not cached.
 * @returns true if the file was downloaded now, false if it was cached.
 */
export async function ensureFile(
  url: string,
  path: string,
  isValid: (bytes: Uint8Array) => boolean = () => true,
): Promise<boolean> {
  if (isCached(path)) return false;
  if (OFFLINE) throw new Error(`offline, and ${path} is not in the cache`);
  mkdirSync(dirname(path), { recursive: true });
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'map-pipeline (node fetch)' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error('empty response');
      if (!isValid(bytes)) throw new Error('the response is not the expected file');
      writeFileSync(`${path}.part`, bytes);
      renameSync(`${path}.part`, path);
      return true;
    } catch (error) {
      lastError = error;
      console.warn(`  download failed (attempt ${attempt}/${ATTEMPTS}): ${url}: ${String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new Error(`could not download ${url}: ${String(lastError)}`);
}
