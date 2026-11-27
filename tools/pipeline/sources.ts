/**
 * Downloads the vector datasets and draws them onto rasters of the source
 * plane (the true Albers projection): who holds each cell, where land is and
 * where lakes are. Hexes are later sampled from these rasters through the
 * warp.
 */

import { join } from 'node:path';
import type { Albers } from './albers.ts';
import { wrapDegrees } from './albers.ts';
import { FRAME_KM } from './config.ts';
import { ensureFile } from './fetch.ts';
import { FULL_COVERAGE, POLITIES } from './polities.ts';
import type { Box, Source } from './polities.ts';
import { readShapefile } from './shapefile.ts';
import type { ShapeRecord } from './shapefile.ts';
import { readZipEntries } from './zip.ts';

const NATURAL_EARTH = 'https://naciscdn.org/naturalearth/10m';
const LAYERS = {
  admin0: 'cultural/ne_10m_admin_0_countries',
  admin1: 'cultural/ne_10m_admin_1_states_provinces',
  land: 'physical/ne_10m_land',
  lakes: 'physical/ne_10m_lakes',
  rivers: 'physical/ne_10m_rivers_lake_centerlines',
} as const;
type LayerName = keyof typeof LAYERS;

/** Size of a raster cell, km. */
export const CELL_KM = 2.5;
/** The rasters reach this far beyond the frame, so lenses near the edge find data. */
const MARGIN_KM = 400;
/** Land cells this close to an owned cell take its owner if no polygon covers them. */
const SLIVER_CELLS = 6;

/** `owner` value of a cell no polygon covers. */
export const CELL_NONE = -1;
/** `owner` value of a cell in a country or unit that is no polity. */
export const CELL_FOREIGN = -2;

export interface SourceRasters {
  readonly width: number;
  readonly height: number;
  /** Source-plane position of the outer corner of cell (0, 0), km. */
  readonly originX: number;
  readonly originZ: number;
  /** Per cell: index into `POLITIES`, `CELL_NONE` or `CELL_FOREIGN`. */
  readonly owner: Int16Array;
  /** Per cell: 1 on land (lakes included). */
  readonly land: Uint8Array;
  /** Per cell: 1 inside a lake. */
  readonly lake: Uint8Array;
  /** Index of the cell holding a source-plane point, or -1 outside the rasters. */
  cellAt(x: number, z: number): number;
}

async function loadLayer(rawDir: string, layer: LayerName): Promise<ShapeRecord[]> {
  const path = LAYERS[layer];
  const name = path.slice(path.lastIndexOf('/') + 1);
  const zipPath = join(rawDir, `${name}.zip`);
  if (await ensureFile(`${NATURAL_EARTH}/${path}.zip`, zipPath)) console.log(`  fetched ${name}.zip`);
  const files = readZipEntries(zipPath, [`${name}.shp`, `${name}.dbf`]);
  return readShapefile(files.get(`${name}.shp`) as Buffer, files.get(`${name}.dbf`) as Buffer);
}

/** The river and lake centre lines of Natural Earth. */
export function loadRivers(rawDir: string): Promise<ShapeRecord[]> {
  return loadLayer(rawDir, 'rivers');
}

function inBox(lon: number, lat: number, box: Box): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

function ringBoxCentre(ring: Float64Array): [number, number] {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    west = Math.min(west, ring[i] as number);
    east = Math.max(east, ring[i] as number);
    south = Math.min(south, ring[i + 1] as number);
    north = Math.max(north, ring[i + 1] as number);
  }
  return [(west + east) / 2, (south + north) / 2];
}

export async function buildSourceRasters(rawDir: string, albers: Albers): Promise<SourceRasters> {
  const originX = FRAME_KM.minX - MARGIN_KM;
  const originZ = FRAME_KM.minZ - MARGIN_KM;
  const width = Math.ceil((FRAME_KM.maxX + MARGIN_KM - originX) / CELL_KM);
  const height = Math.ceil((FRAME_KM.maxZ + MARGIN_KM - originZ) / CELL_KM);
  const owner = new Int16Array(width * height).fill(CELL_NONE);
  const land = new Uint8Array(width * height);
  const lake = new Uint8Array(width * height);
  const point = { x: 0, z: 0 };

  /**
   * A ring in raster coordinates, or null if it cannot be in the frame.
   * Longitudes are unwrapped along the ring, so a ring that crosses 180°
   * stays whole; the ring is then placed on the side of the map it mostly
   * lies on.
   */
  const projectRing = (ring: Float64Array): Float64Array | null => {
    const n = ring.length / 2;
    const offsets = new Float64Array(n);
    let previous = wrapDegrees((ring[0] as number) - albers.params.lon0);
    let low = previous;
    let high = previous;
    let north = -Infinity;
    for (let i = 0; i < n; i++) {
      let d = wrapDegrees((ring[i * 2] as number) - albers.params.lon0);
      while (d - previous > 180) d -= 360;
      while (d - previous < -180) d += 360;
      offsets[i] = d;
      previous = d;
      low = Math.min(low, d);
      high = Math.max(high, d);
      north = Math.max(north, ring[i * 2 + 1] as number);
    }
    // entirely far south, or a ring around a pole (Antarctica)
    if (north < -35 || Math.abs((offsets[n - 1] as number) - (offsets[0] as number)) > 180) return null;
    const middle = (low + high) / 2;
    const turn = middle <= -160 ? 360 : middle > 200 ? -360 : 0;
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      albers.forwardOffset((offsets[i] as number) + turn, ring[i * 2 + 1] as number, point);
      out[i * 2] = (point.x - originX) / CELL_KM;
      out[i * 2 + 1] = (point.z - originZ) / CELL_KM;
    }
    return out;
  };

  /** Even-odd scanline fill of a set of rings; `paint` gets each covered cell index. */
  const fill = (rings: readonly Float64Array[], paint: (cell: number) => void): void => {
    const keys: number[] = [];
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const u0 = ring[i * 2] as number;
        const v0 = ring[i * 2 + 1] as number;
        const u1 = ring[j * 2] as number;
        const v1 = ring[j * 2 + 1] as number;
        if (v0 === v1) continue;
        const from = Math.max(0, Math.ceil(Math.min(v0, v1) - 0.5));
        const to = Math.min(height - 1, Math.ceil(Math.max(v0, v1) - 0.5) - 1);
        for (let row = from; row <= to; row++) {
          const u = u0 + ((row + 0.5 - v0) * (u1 - u0)) / (v1 - v0);
          keys.push(row * 16384 + Math.max(0, Math.min(width, u)) + 1);
        }
      }
    }
    const sorted = Float64Array.from(keys).sort();
    for (let k = 0; k + 1 < sorted.length; k += 2) {
      const a = sorted[k] as number;
      const b = sorted[k + 1] as number;
      const row = Math.floor(a / 16384);
      if (Math.floor(b / 16384) !== row) throw new Error('sources: an open ring cannot be filled');
      const from = Math.max(0, Math.ceil(a - row * 16384 - 1 - 0.5));
      const to = Math.min(width - 1, Math.ceil(b - row * 16384 - 1 - 0.5) - 1);
      for (let col = from; col <= to; col++) paint(row * width + col);
    }
  };

  const fillRecord = (record: ShapeRecord, paint: (cell: number) => void, box?: Box): void => {
    const rings: Float64Array[] = [];
    for (const part of record.parts) {
      if (box !== undefined) {
        const [lon, lat] = ringBoxCentre(part);
        if (!inBox(lon, lat, box)) continue;
      }
      const projected = projectRing(part);
      if (projected !== null) rings.push(projected);
    }
    if (rings.length > 0) fill(rings, paint);
  };

  // Land and lakes.
  for (const record of await loadLayer(rawDir, 'land')) fillRecord(record, (c) => (land[c] = 1));
  for (const record of await loadLayer(rawDir, 'lakes')) fillRecord(record, (c) => (lake[c] = 1));

  // Every country first, as foreign ground; the polities are drawn over it.
  const admin0 = await loadLayer(rawDir, 'admin0');
  const admin1 = await loadLayer(rawDir, 'admin1');
  for (const record of admin0) fillRecord(record, (c) => (owner[c] = CELL_FOREIGN));

  const usedUnits = new Map<ShapeRecord, string>();
  const coveredUnits = new Set<ShapeRecord>();
  const drawSource = (source: Source, polity: number, polityId: string): void => {
    const paint = (c: number): void => {
      owner[c] = polity;
    };
    if (source.layer === 'circle') {
      const centre = albers.forward(source.lon, source.lat);
      const reach = Math.ceil(source.radiusKm / CELL_KM) + 1;
      const cu = Math.floor((centre.x - originX) / CELL_KM);
      const cv = Math.floor((centre.z - originZ) / CELL_KM);
      for (let v = cv - reach; v <= cv + reach; v++) {
        for (let u = cu - reach; u <= cu + reach; u++) {
          const dx = originX + (u + 0.5) * CELL_KM - centre.x;
          const dz = originZ + (v + 0.5) * CELL_KM - centre.z;
          if (u >= 0 && u < width && v >= 0 && v < height && Math.hypot(dx, dz) <= source.radiusKm) {
            paint(v * width + u);
          }
        }
      }
      return;
    }
    if (source.layer === 'admin0') {
      const records = admin0.filter((r) => r.attributes['ADM0_A3'] === source.adm0);
      if (records.length === 0) throw new Error(`sources: no country ${source.adm0} (${polityId})`);
      for (const record of records) fillRecord(record, paint);
      return;
    }
    const records = admin1.filter((r) => {
      const a = r.attributes;
      if (a['adm0_a3'] !== source.adm0) return false;
      const iso = a['iso_3166_2'] as string;
      if (source.iso !== undefined && !source.iso.includes(iso)) return false;
      if (source.exceptIso !== undefined && source.exceptIso.includes(iso)) return false;
      const latitude = Number(a['latitude']);
      if (source.latMin !== undefined && !(latitude >= source.latMin)) return false;
      if (source.latMax !== undefined && !(latitude < source.latMax)) return false;
      return true;
    });
    if (source.iso !== undefined) {
      for (const iso of source.iso) {
        if (!records.some((r) => r.attributes['iso_3166_2'] === iso)) {
          throw new Error(`sources: no unit ${iso} in ${source.adm0} (${polityId})`);
        }
      }
    }
    if (records.length === 0) throw new Error(`sources: a source of ${polityId} selects nothing`);
    for (const record of records) {
      if (source.carve !== true && source.partsIn === undefined) {
        const other = usedUnits.get(record);
        if (other !== undefined) {
          throw new Error(
            `sources: unit ${record.attributes['iso_3166_2']} ${record.attributes['name']} is in ${other} and ${polityId}`,
          );
        }
        usedUnits.set(record, polityId);
      }
      if (source.partsIn === undefined) coveredUnits.add(record);
      fillRecord(record, paint, source.partsIn);
    }
  };
  for (const carved of [false, true]) {
    POLITIES.forEach((polity, index) => {
      for (const source of polity.sources) {
        if ((source.carve === true) === carved) drawSource(source, index, polity.id);
      }
    });
  }

  // No unit of a play country may be left without a polity.
  for (const rule of FULL_COVERAGE) {
    for (const record of admin1) {
      const a = record.attributes;
      if (a['adm0_a3'] !== rule.adm0) continue;
      if (rule.exceptIso?.includes(a['iso_3166_2'] as string) === true) continue;
      if (rule.regions !== undefined && !rule.regions.includes(a['region'] as string)) continue;
      if (!coveredUnits.has(record)) {
        throw new Error(
          `sources: unit ${a['iso_3166_2']} ${a['name']} (${a['adm1_code']}) of ${rule.adm0} belongs to no polity`,
        );
      }
    }
  }

  // Slivers between the coastline and the border polygons take the nearest owner.
  for (let pass = 0; pass < SLIVER_CELLS; pass++) {
    const changes: [cell: number, value: number][] = [];
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        const c = v * width + u;
        if (land[c] === 0 || owner[c] !== CELL_NONE) continue;
        const candidates = [
          v > 0 ? c - width : -1,
          u > 0 ? c - 1 : -1,
          u + 1 < width ? c + 1 : -1,
          v + 1 < height ? c + width : -1,
        ];
        for (const n of candidates) {
          if (n >= 0 && owner[n] !== CELL_NONE) {
            changes.push([c, owner[n] as number]);
            break;
          }
        }
      }
    }
    if (changes.length === 0) break;
    for (const [c, value] of changes) owner[c] = value;
  }

  return {
    width,
    height,
    originX,
    originZ,
    owner,
    land,
    lake,
    cellAt: (x, z) => {
      const u = Math.floor((x - originX) / CELL_KM);
      const v = Math.floor((z - originZ) / CELL_KM);
      return u >= 0 && u < width && v >= 0 && v < height ? v * width + u : -1;
    },
  };
}
