/**
 * ETOPO 2022 (60 arc-second surface elevation with bathymetry), read as
 * subsets from NOAA's OPeNDAP server. Only the window the map needs is
 * downloaded, at every `STRIDE`-th sample, in latitude bands that are cached
 * as raw `.dods` responses in `data/raw/etopo/`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFile } from './fetch.ts';

const BASE_URL =
  'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc.dods';

/** Samples per degree of the source grid. */
const PER_DEGREE = 60;
/** Every second sample is taken: 120 arc-seconds, about 3.7 km. */
const STRIDE = 2;
/** Southern and northern limit of the window, degrees. */
const LAT_SOUTH = -22;
const LAT_NORTH = 90;
/** The window runs from `LON_WEST` east across 180° to `LON_EAST_WRAPPED`. */
const LON_WEST = 36;
const LON_EAST_WRAPPED = -158;
/** Source rows per download. */
const BAND_ROWS = 560;

/** Elevation grid over the window, rows from south to north, columns from west to east. */
export interface ElevationGrid {
  readonly width: number;
  readonly height: number;
  /** Longitude of column 0, degrees east. Columns continue east across 180°. */
  readonly lon0: number;
  /** Latitude of row 0. */
  readonly lat0: number;
  /** Degrees between neighbouring samples. */
  readonly step: number;
  /** Metres, `height * width` values. */
  readonly data: Int16Array;
}

interface Chunk {
  readonly row0: number;
  readonly row1: number;
  readonly col0: number;
  readonly col1: number;
}

function chunks(): { east: Chunk[]; west: Chunk[] } {
  const rowStart = (LAT_SOUTH + 90) * PER_DEGREE;
  const rowEnd = (LAT_NORTH + 90) * PER_DEGREE - STRIDE;
  const eastCols: [number, number] = [(LON_WEST + 180) * PER_DEGREE, 360 * PER_DEGREE - STRIDE];
  const westCols: [number, number] = [0, (LON_EAST_WRAPPED + 180) * PER_DEGREE - STRIDE];
  const east: Chunk[] = [];
  const west: Chunk[] = [];
  for (let row0 = rowStart; row0 <= rowEnd; row0 += BAND_ROWS) {
    const row1 = Math.min(row0 + BAND_ROWS - STRIDE, rowEnd);
    east.push({ row0, row1, col0: eastCols[0], col1: eastCols[1] });
    west.push({ row0, row1, col0: westCols[0], col1: westCols[1] });
  }
  return { east, west };
}

function chunkFile(dir: string, c: Chunk): string {
  return join(dir, `z_${c.row0}_${c.row1}_${c.col0}_${c.col1}_s${STRIDE}.dods`);
}

function chunkUrl(c: Chunk): string {
  const query = `z.z[${c.row0}:${STRIDE}:${c.row1}][${c.col0}:${STRIDE}:${c.col1}]`;
  return `${BASE_URL}?${encodeURIComponent(query).replace(/%3A/g, ':')}`;
}

/** Downloads every band that is not cached yet. */
export async function ensureEtopo(dir: string): Promise<void> {
  const { east, west } = chunks();
  for (const c of [...east, ...west]) {
    const fresh = await ensureFile(chunkUrl(c), chunkFile(dir, c));
    if (fresh) console.log(`  fetched ${chunkFile(dir, c)}`);
  }
}

/**
 * Decodes one DODS response holding a single Float32 array: a text header
 * that ends with `Data:\n`, the element count twice as big-endian Uint32,
 * then the values as big-endian Float32.
 */
function decodeChunk(path: string, rows: number, cols: number): Float32Array {
  const bytes = readFileSync(path);
  const marker = Buffer.from('\nData:\n', 'latin1');
  const at = bytes.indexOf(marker);
  if (at < 0) throw new Error(`etopo: ${path} is not a DODS response`);
  let offset = at + marker.length;
  const count = bytes.readUInt32BE(offset);
  if (count !== rows * cols || bytes.readUInt32BE(offset + 4) !== count) {
    throw new Error(`etopo: ${path} holds ${count} values, expected ${rows * cols}`);
  }
  offset += 8;
  if (bytes.byteLength < offset + count * 4) throw new Error(`etopo: ${path} is truncated`);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes.readFloatBE(offset + i * 4);
  return out;
}

/** Reads the cached bands into one grid. */
export function loadEtopo(dir: string): ElevationGrid {
  const { east, west } = chunks();
  const firstEast = east[0] as Chunk;
  const firstWest = west[0] as Chunk;
  const eastCols = (firstEast.col1 - firstEast.col0) / STRIDE + 1;
  const westCols = (firstWest.col1 - firstWest.col0) / STRIDE + 1;
  const width = eastCols + westCols;
  const lastEast = east[east.length - 1] as Chunk;
  const height = (lastEast.row1 - firstEast.row0) / STRIDE + 1;
  const data = new Int16Array(width * height);
  for (const [list, colOffset, cols] of [
    [east, 0, eastCols],
    [west, eastCols, westCols],
  ] as const) {
    for (const c of list) {
      const rows = (c.row1 - c.row0) / STRIDE + 1;
      const values = decodeChunk(chunkFile(dir, c), rows, cols);
      const rowOffset = (c.row0 - firstEast.row0) / STRIDE;
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          const v = values[r * cols + k] as number;
          data[(rowOffset + r) * width + colOffset + k] = Math.max(-32768, Math.min(32767, Math.round(v)));
        }
      }
    }
  }
  return {
    width,
    height,
    // samples are cell centres
    lon0: -180 + (firstEast.col0 + 0.5) / PER_DEGREE,
    lat0: -90 + (firstEast.row0 + 0.5) / PER_DEGREE,
    step: STRIDE / PER_DEGREE,
    data,
  };
}

/** Bilinear elevation in metres at a position; outside the window the edge value is used. */
export function sampleElevation(grid: ElevationGrid, lon: number, lat: number): number {
  let dLon = lon - grid.lon0;
  if (dLon < -1) dLon += 360;
  const fx = Math.max(0, Math.min(grid.width - 1, dLon / grid.step));
  const fy = Math.max(0, Math.min(grid.height - 1, (lat - grid.lat0) / grid.step));
  const x0 = Math.min(grid.width - 2, Math.floor(fx));
  const y0 = Math.min(grid.height - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const d = grid.data;
  const i = y0 * grid.width + x0;
  const top = (d[i] as number) * (1 - tx) + (d[i + 1] as number) * tx;
  const bottom = (d[i + grid.width] as number) * (1 - tx) + (d[i + grid.width + 1] as number) * tx;
  return top * (1 - ty) + bottom * ty;
}
