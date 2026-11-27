/**
 * The map pipeline: `npm run pipeline`.
 *
 * Downloads the public datasets into `data/raw/` (once), builds the game's
 * map from them and writes it to `public/data/`. See `README.md` in this
 * folder for the method and `DATA.md` for the datasets.
 *
 * Flags: `--offline` fails instead of downloading; `--dry` builds and checks
 * without writing; `--debug` also writes pictures of the result into
 * `data/raw/debug/` (never committed).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hexDistance,
  hexNeighbor,
  hexToWorld,
  indexToOffset,
  oppositeDirection,
  worldToHex,
} from '../../src/shared/hex.ts';
import type { Offset } from '../../src/shared/hex.ts';
import {
  Feature,
  MAP_FORMAT_VERSION,
  NO_RESOURCE,
  NO_ZONE,
  OWNER_OFF_MAP,
  OWNER_SEA,
  OWNER_UNOWNED,
  Terrain,
  serializeMapData,
} from '../../src/shared/mapData.ts';
import type {
  MapData,
  MapOffMapPort,
  MapPolity,
  MapResource,
  MapZone,
} from '../../src/shared/mapData.ts';
import {
  HEIGHTMAP_BASE_METRES,
  HEIGHTMAP_METRES_PER_UNIT,
  HEIGHTMAP_WIDTH,
  HEX_ACROSS_KM,
  HEX_SIZE_KM,
  KM_PER_WORLD_UNIT,
  LAYOUT_KM,
  LENSES,
} from './config.ts';
import { writeDebugImages } from './debugImage.ts';
import { ensureEtopo, loadEtopo, sampleElevation } from './etopo.ts';
import { PORTS, STRATEGIC_RESOURCES, VOLCANOES } from './features.ts';
import { ensureFile } from './fetch.ts';
import { cornerKey, cornerNeighbours, edgeCorners, edgeKey } from './hexEdges.ts';
import { Koppen, readKoppenTiff, sampleClimate } from './koppen.ts';
import { createMapping } from './mapping.ts';
import { POLITIES, resourceId, zoneCountFor } from './polities.ts';
import { CELL_FOREIGN, CELL_KM, CELL_NONE, buildSourceRasters, loadRivers } from './sources.ts';
import { RULES, formatReport, reachableInZone, validateMap } from './validate.ts';
import { warpMaxDisplacement, warpMinDeterminant } from './warp.ts';
import { readZipEntries } from './zip.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW_DIR = join(ROOT, 'data', 'raw');
const OUT_DIR = join(ROOT, 'public', 'data');

const KOPPEN_URL = 'https://ndownloader.figshare.com/files/12407516';
const KOPPEN_ZIP = 'Beck_KG_V1.zip';
const KOPPEN_TIFF = 'Beck_KG_V1_present_0p083.tif';

/** Rivers of Natural Earth up to this `scalerank` become river edges. */
const RIVER_MAX_SCALERANK = 6;
/** Standard deviation of the elevation inside a hex, metres, from which it is hilly. */
const HILLS_RELIEF = 180;
/** The same for an impassable mountain hex. */
const MOUNTAIN_RELIEF = 600;
/** High ground counts as mountain at a lower relief. */
const HIGH_MOUNTAIN_ELEVATION = 3500;
const HIGH_MOUNTAIN_RELIEF = 450;
/** Water bodies this small that do not reach the edge of the map are lakes. */
const ENCLOSED_SEA_MAX_HEXES = 8;
/** City sites of one polity are at least this many hexes apart where there is room. */
const SITE_SPACING = 2;
/** A detached piece of a polity up to this size that touches other polities is given to one of them. */
const ENCLAVE_MAX_HEXES = 3;

/** A fixed pseudo-random number in [0, 1) per hex and purpose. */
function chance(index: number, salt: number): number {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface ClimateLook {
  readonly terrain: number;
  /** Share of hexes with forest, on flat ground and on hills. */
  readonly forest: readonly [flat: number, hilly: number];
  readonly jungle: number;
}

/** Base terrain and vegetation of a Köppen-Geiger class. */
function climateLook(climate: number, lat: number): ClimateLook {
  const K = Koppen;
  switch (climate) {
    case K.Af:
      return { terrain: Terrain.Grassland, forest: [0, 0], jungle: 0.85 };
    case K.Am:
      return { terrain: Terrain.Grassland, forest: [0, 0], jungle: 0.65 };
    case K.Aw:
      return { terrain: Terrain.Plains, forest: [0.1, 0.2], jungle: 0.3 };
    case K.BWh:
    case K.BWk:
      return { terrain: Terrain.Desert, forest: [0, 0], jungle: 0 };
    case K.BSh:
      return { terrain: Terrain.Plains, forest: [0, 0.05], jungle: 0 };
    case K.BSk:
      return { terrain: Terrain.Grassland, forest: [0, 0.05], jungle: 0 };
    case K.Csa:
    case K.Csb:
    case K.Csc:
      return { terrain: Terrain.Plains, forest: [0.15, 0.4], jungle: 0 };
    case K.Cwa:
    case K.Cfa:
      return { terrain: Terrain.Grassland, forest: [0.2, 0.6], jungle: 0 };
    case K.Cwb:
    case K.Cwc:
    case K.Cfb:
    case K.Cfc:
      return { terrain: Terrain.Grassland, forest: [0.35, 0.65], jungle: 0 };
    case K.Dsa:
    case K.Dwa:
    case K.Dfa:
      return { terrain: Terrain.Plains, forest: [0.1, 0.45], jungle: 0 };
    case K.Dsb:
    case K.Dwb:
    case K.Dfb:
      return { terrain: Terrain.Plains, forest: [0.45, 0.7], jungle: 0 };
    case K.Dsc:
    case K.Dsd:
    case K.Dwc:
    case K.Dwd:
    case K.Dfc:
    case K.Dfd:
      // taiga, thinning out towards the Arctic
      return { terrain: Terrain.Tundra, forest: lat > 68 ? [0.25, 0.25] : [0.7, 0.7], jungle: 0 };
    case K.ET:
      return { terrain: lat > 74 ? Terrain.Snow : Terrain.Tundra, forest: [0, 0], jungle: 0 };
    case K.EF:
      return { terrain: Terrain.Snow, forest: [0, 0], jungle: 0 };
    default:
      // no climate data: a guess from the latitude
      if (lat > 66) return { terrain: Terrain.Tundra, forest: [0, 0], jungle: 0 };
      if (lat > 45) return { terrain: Terrain.Plains, forest: [0.4, 0.6], jungle: 0 };
      if (lat > 23) return { terrain: Terrain.Grassland, forest: [0.2, 0.5], jungle: 0 };
      return { terrain: Terrain.Grassland, forest: [0, 0], jungle: 0.7 };
  }
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const debug = process.argv.includes('--debug');
  const started = performance.now();
  const step = (text: string): void => {
    console.log(`[${((performance.now() - started) / 1000).toFixed(1).padStart(5)}s] ${text}`);
  };

  step('datasets');
  if (await ensureFile(KOPPEN_URL, join(RAW_DIR, KOPPEN_ZIP))) console.log(`  fetched ${KOPPEN_ZIP}`);
  await ensureEtopo(join(RAW_DIR, 'etopo'));

  const mapping = createMapping(LENSES);
  const { width, height } = mapping;
  const count = width * height;
  const minDeterminant = warpMinDeterminant(mapping.warp);
  if (!(minDeterminant > 0.005)) throw new Error(`the warp folds: determinant ${minDeterminant}`);

  step('borders, coast and lakes');
  const rasters = await buildSourceRasters(RAW_DIR, mapping.albers);
  step('climate and elevation');
  const climate = readKoppenTiff(
    readZipEntries(join(RAW_DIR, KOPPEN_ZIP), [KOPPEN_TIFF]).get(KOPPEN_TIFF) as Buffer,
  );
  const etopo = loadEtopo(join(RAW_DIR, 'etopo'));

  const at = (hex: Offset): number => hex.row * width + hex.col;
  const inGrid = (hex: Offset): boolean =>
    hex.col >= 0 && hex.col < width && hex.row >= 0 && hex.row < height;
  const neighboursOf = (index: number): number[] => {
    const hex = indexToOffset(index, width);
    const out: number[] = [];
    for (let d = 0; d < 6; d++) {
      const n = hexNeighbor(hex, d);
      if (inGrid(n)) out.push(at(n));
    }
    return out;
  };
  const polityIndex = new Map(POLITIES.map((p, i) => [p.id, i]));

  // ---- Sampling: every hex looks at the datasets through the warp. ----
  step('sampling hexes');
  const terrain = new Uint8Array(count);
  const hills = new Uint8Array(count);
  const feature = new Uint8Array(count);
  const elevation = new Int16Array(count);
  const owner = new Int16Array(count).fill(OWNER_OFF_MAP);
  const zone = new Int16Array(count).fill(NO_ZONE);
  const riverEdges = new Uint8Array(count);
  const resource = new Int16Array(count).fill(NO_RESOURCE);
  /** Per hex: index into POLITIES of the polity holding its centre, or -1. */
  const polityOf = new Int16Array(count).fill(-1);
  const isLand = new Uint8Array(count);
  const isLake = new Uint8Array(count);
  const relief = new Float32Array(count);
  const climateOf = new Uint8Array(count);
  const latitudeOf = new Float32Array(count);

  // sample points inside a hex: a square lattice cut to the hexagon
  const sampleOffsets: [number, number][] = [];
  for (let j = -4; j <= 4; j++) {
    for (let i = -4; i <= 4; i++) {
      const x = (i / 4.5) * (HEX_ACROSS_KM / 2);
      const z = (j / 4.5) * HEX_SIZE_KM;
      if (Math.abs(z) <= HEX_SIZE_KM - Math.abs(x) / Math.sqrt(3)) sampleOffsets.push([x, z]);
    }
  }
  const source = { x: 0, z: 0 };
  const lonLat = { lon: 0, lat: 0 };
  for (let i = 0; i < count; i++) {
    const centre = hexToWorld(indexToOffset(i, width), LAYOUT_KM);
    mapping.warp.toSource(centre.x, centre.z, source);
    const cell = rasters.cellAt(source.x, source.z);
    mapping.albers.inverse(source.x, source.z, lonLat);
    latitudeOf[i] = lonLat.lat;
    if (cell >= 0 && rasters.lake[cell] === 1) isLake[i] = 1;
    else if (cell >= 0 && rasters.land[cell] === 1) isLand[i] = 1;
    if (isLand[i] === 1) {
      const cellOwner = rasters.owner[cell] as number;
      if (cellOwner !== CELL_NONE && cellOwner !== CELL_FOREIGN) polityOf[i] = cellOwner;
      climateOf[i] = sampleClimate(climate, lonLat.lon, lonLat.lat);
    }
    // elevation: mean and spread over the samples of the hex's own kind
    let sum = 0;
    let sumSquares = 0;
    let used = 0;
    for (const [dx, dz] of sampleOffsets) {
      mapping.warp.toSource(centre.x + dx, centre.z + dz, source);
      const c = rasters.cellAt(source.x, source.z);
      const land = c >= 0 && rasters.land[c] === 1 && rasters.lake[c] === 0;
      if (land !== (isLand[i] === 1)) continue;
      mapping.albers.inverse(source.x, source.z, lonLat);
      const metres = sampleElevation(etopo, lonLat.lon, lonLat.lat);
      sum += metres;
      sumSquares += metres * metres;
      used++;
    }
    const mean = sum / used;
    relief[i] = Math.sqrt(Math.max(0, sumSquares / used - mean * mean));
    if (isLand[i] === 1) elevation[i] = Math.max(1, Math.round(mean));
    else if (isLake[i] === 1) elevation[i] = Math.round(mean);
    else elevation[i] = Math.min(-1, Math.round(mean));
  }

  // ---- Water: lakes, enclosed bays, coast and open sea. ----
  const onBorder = (index: number): boolean => {
    const hex = indexToOffset(index, width);
    return hex.col === 0 || hex.row === 0 || hex.col === width - 1 || hex.row === height - 1;
  };
  /** Connected groups of hexes that satisfy `member`. */
  const components = (member: (index: number) => boolean): number[][] => {
    const seen = new Uint8Array(count);
    const groups: number[][] = [];
    for (let i = 0; i < count; i++) {
      if (seen[i] === 1 || !member(i)) continue;
      const group = [i];
      seen[i] = 1;
      for (let head = 0; head < group.length; head++) {
        for (const n of neighboursOf(group[head] as number)) {
          if (seen[n] === 0 && member(n)) {
            seen[n] = 1;
            group.push(n);
          }
        }
      }
      groups.push(group);
    }
    return groups;
  };
  for (const group of components((i) => isLand[i] === 0 && isLake[i] === 0)) {
    if (group.length <= ENCLOSED_SEA_MAX_HEXES && !group.some(onBorder)) {
      for (const i of group) isLake[i] = 1;
    }
  }
  for (let i = 0; i < count; i++) {
    if (isLand[i] === 1) continue;
    if (isLake[i] === 1) terrain[i] = Terrain.Lake;
    else terrain[i] = neighboursOf(i).some((n) => isLand[n] === 1) ? Terrain.Coast : Terrain.Ocean;
  }

  // ---- Land: terrain from climate, hills and mountains from relief. ----
  for (let i = 0; i < count; i++) {
    if (isLand[i] === 0) continue;
    const look = climateLook(climateOf[i] as number, latitudeOf[i] as number);
    const metres = elevation[i] as number;
    const spread = relief[i] as number;
    if (spread >= MOUNTAIN_RELIEF || (metres >= HIGH_MOUNTAIN_ELEVATION && spread >= HIGH_MOUNTAIN_RELIEF)) {
      terrain[i] = Terrain.Mountain;
    } else {
      terrain[i] = metres >= 5300 ? Terrain.Snow : look.terrain;
      hills[i] = spread >= HILLS_RELIEF ? 1 : 0;
    }
  }

  // ---- Polities, city sites and zones. ----
  step('polities and zones');
  const landOf: number[][] = POLITIES.map(() => []);
  for (let i = 0; i < count; i++) {
    if (isLand[i] === 1 && polityOf[i] !== -1) (landOf[polityOf[i] as number] as number[]).push(i);
  }
  // Enclaves: where a border runs through a narrow neck, sampling can leave a
  // hex or two of a polity cut off behind a neighbour's land. Such a piece,
  // if it cannot be reached from the rest of the polity over land or a short
  // stretch of sea, goes to the neighbour it shares the most edges with.
  POLITIES.forEach((spec, p) => {
    const hexes = landOf[p] as number[];
    const group = new Map<number, number>();
    const groups: number[][] = [];
    for (const start of hexes) {
      if (group.has(start)) continue;
      const members = [start];
      group.set(start, groups.length);
      const seaDepth = new Map<number, number>();
      const queue: [number, number][] = [[start, 0]];
      for (let head = 0; head < queue.length; head++) {
        const [i, depth] = queue[head] as [number, number];
        for (const n of neighboursOf(i)) {
          if (polityOf[n] === p && isLand[n] === 1) {
            if (!group.has(n)) {
              group.set(n, groups.length);
              members.push(n);
              queue.push([n, 0]);
            }
          } else if (isLand[n] === 0 && !onBorder(n) && depth < RULES.maxSeaGap) {
            const known = seaDepth.get(n);
            if (known === undefined || known > depth + 1) {
              seaDepth.set(n, depth + 1);
              queue.push([n, depth + 1]);
            }
          }
        }
      }
      groups.push(members);
    }
    const largest = Math.max(...groups.map((g) => g.length));
    for (const members of groups) {
      if (members.length === largest || members.length > ENCLAVE_MAX_HEXES) continue;
      const shared = new Map<number, number>();
      for (const i of members) {
        for (const n of neighboursOf(i)) {
          const other = polityOf[n] as number;
          if (isLand[n] === 1 && other !== -1 && other !== p) shared.set(other, (shared.get(other) ?? 0) + 1);
        }
      }
      if (shared.size === 0) continue;
      const taker = [...shared].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] as [number, number];
      for (const i of members) {
        const place = mapping.hexToLonLat(indexToOffset(i, width));
        console.log(
          `  note: enclave of ${spec.id} at ${place.lon.toFixed(2)}, ${place.lat.toFixed(2)} goes to ${(POLITIES[taker[0]] as (typeof POLITIES)[number]).id}`,
        );
        polityOf[i] = taker[0];
      }
    }
  });
  for (const list of landOf) list.length = 0;
  for (let i = 0; i < count; i++) {
    if (isLand[i] === 1 && polityOf[i] !== -1) (landOf[polityOf[i] as number] as number[]).push(i);
  }

  const polities: MapPolity[] = [];
  const zones: MapZone[] = [];
  const siteHexes = new Set<number>();
  POLITIES.forEach((spec, p) => {
    const hexes = landOf[p] as number[];
    if (hexes.length === 0) {
      // reported by the checks below, together with everything else
      polities.push({
        id: spec.id,
        kind: spec.kind,
        nameZh: spec.nameZh,
        nameEn: spec.nameEn,
        color: spec.color,
        capitalZone: NO_ZONE,
      });
      return;
    }
    const zoneCount =
      spec.kind === 'nation'
        ? (spec.zones ?? zoneCountFor(hexes.length))
        : spec.kind === 'cityState'
          ? 1
          : spec.cities.length;
    if (spec.cities.length < zoneCount) {
      throw new Error(`polity ${spec.id} needs ${zoneCount} city sites, the table has ${spec.cities.length}`);
    }
    const firstZone = zones.length;
    const sites: number[] = [];
    for (let k = 0; k < zoneCount; k++) {
      const [cityNameZh, cityNameEn, lon, lat] = spec.cities[k] as (typeof spec.cities)[number];
      const target = mapping.lonLatToHex(lon, lat);
      let bestSite = -1;
      let bestCost = Infinity;
      for (const spacing of [SITE_SPACING, 1]) {
        for (const i of hexes) {
          if (siteHexes.has(i)) continue;
          const hex = indexToOffset(i, width);
          if (sites.some((s) => hexDistance(indexToOffset(s, width), hex) < spacing)) continue;
          // the true place first; a city is not put where mountains shut it in
          const around = neighboursOf(i).filter((n) => isLand[n] === 1);
          const open = around.filter((n) => terrain[n] !== Terrain.Mountain).length;
          const cost = hexDistance(target, hex) + (around.length >= 1 && open < 1 ? 100 : 0);
          if (cost < bestCost) {
            bestSite = i;
            bestCost = cost;
          }
        }
        if (bestSite !== -1) break;
      }
      if (bestSite === -1) throw new Error(`polity ${spec.id} has no room for the site of ${cityNameEn}`);
      if (bestCost >= 2) console.log(`  note: ${cityNameEn} (${spec.id}) sits ${bestCost} hexes from its true place`);
      sites.push(bestSite);
      siteHexes.add(bestSite);
      zones.push({
        id: `${spec.id}-${k + 1}`,
        polity: p,
        siteHex: bestSite,
        capital: k === 0 && spec.kind !== 'wastelandRegion',
        cityNameZh,
        cityNameEn,
      });
    }
    polities.push({
      id: spec.id,
      kind: spec.kind,
      nameZh: spec.nameZh,
      nameEn: spec.nameEn,
      color: spec.color,
      capitalZone: spec.kind === 'wastelandRegion' ? NO_ZONE : firstZone,
    });

    // Each hex goes to the site it is nearest to, travelling over the
    // polity's own land. A sea hex costs more than any way over land, so
    // only hexes that cannot be reached over land (islands) are reached
    // across short stretches of sea. The shortest way to a hex runs through
    // hexes of the same zone, so every zone stays in one piece.
    const SEA_STEP = 10000;
    const best = new Map<number, number>();
    const state = (i: number, depth: number): number => i * 4 + depth;
    // entries: cost, zone, hex, sea hexes behind it; kept sorted by a simple heap
    const heap: [number, number, number, number][] = [];
    const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
      a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] !== b[2] ? a[2] < b[2] : a[3] < b[3];
    const pushHeap = (entry: [number, number, number, number]): void => {
      heap.push(entry);
      let k = heap.length - 1;
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (!less(heap[k] as [number, number, number, number], heap[parent] as [number, number, number, number])) break;
        [heap[k], heap[parent]] = [heap[parent] as [number, number, number, number], heap[k] as [number, number, number, number]];
        k = parent;
      }
    };
    const popHeap = (): [number, number, number, number] => {
      const top = heap[0] as [number, number, number, number];
      const last = heap.pop() as [number, number, number, number];
      if (heap.length > 0) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          let smallest = k;
          for (const child of [2 * k + 1, 2 * k + 2]) {
            if (
              child < heap.length &&
              less(heap[child] as [number, number, number, number], heap[smallest] as [number, number, number, number])
            ) {
              smallest = child;
            }
          }
          if (smallest === k) break;
          [heap[k], heap[smallest]] = [heap[smallest] as [number, number, number, number], heap[k] as [number, number, number, number]];
          k = smallest;
        }
      }
      return top;
    };
    sites.forEach((s, k) => pushHeap([0, firstZone + k, s, 0]));
    while (heap.length > 0) {
      const [cost, z, i, depth] = popHeap();
      if (best.has(state(i, depth))) continue;
      best.set(state(i, depth), cost);
      if (depth === 0) {
        if (zone[i] !== NO_ZONE) continue;
        zone[i] = z;
      }
      for (const n of neighboursOf(i)) {
        if (polityOf[n] === p && isLand[n] === 1) {
          if (zone[n] === NO_ZONE) pushHeap([cost + 1, z, n, 0]);
        } else if (isLand[n] === 0 && !onBorder(n) && depth < RULES.maxSeaGap) {
          if (!best.has(state(n, depth + 1))) pushHeap([cost + SEA_STEP, z, n, depth + 1]);
        }
      }
    }
    // Pieces farther out than that join the zone nearest to them; the checks
    // below then report them.
    for (;;) {
      const pieces = components((i) => polityOf[i] === p && isLand[i] === 1 && zone[i] === NO_ZONE);
      if (pieces.length === 0) break;
      const placed = hexes.filter((i) => zone[i] !== NO_ZONE);
      let bestPiece: number[] = [];
      let bestZone = NO_ZONE;
      let bestDistance = Infinity;
      for (const piece of pieces) {
        for (const i of piece) {
          const hex = indexToOffset(i, width);
          for (const j of placed) {
            const d = hexDistance(hex, indexToOffset(j, width));
            if (d < bestDistance) {
              bestDistance = d;
              bestPiece = piece;
              bestZone = zone[j] as number;
            }
          }
        }
      }
      for (const i of bestPiece) zone[i] = bestZone;
    }
    for (const i of hexes) owner[i] = spec.kind === 'wastelandRegion' ? OWNER_UNOWNED : p;
  });

  // Water of the play area: every body of water that touches playable land,
  // except the outermost ring of the map, which is the way off the map.
  for (const group of components((i) => isLand[i] === 0)) {
    const inPlay = group.some((i) => neighboursOf(i).some((n) => zone[n] !== NO_ZONE));
    for (const i of group) owner[i] = inPlay && !onBorder(i) ? OWNER_SEA : OWNER_OFF_MAP;
  }

  // City sites stand on open, flat ground.
  for (const z of zones) {
    if (terrain[z.siteHex] === Terrain.Mountain || terrain[z.siteHex] === Terrain.Snow) {
      terrain[z.siteHex] = Terrain.Tundra;
    }
    hills[z.siteHex] = 0;
  }

  // ---- Rivers: real courses snapped to hex edges. ----
  step('rivers');
  const edgeHex = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const hex = indexToOffset(i, width);
    for (let d = 0; d < 6; d++) {
      const [a, b] = edgeCorners(hex, d);
      const key = edgeKey(a, b);
      if (!edgeHex.has(key)) edgeHex.set(key, i * 8 + d);
    }
  }
  const cornerOffsets: [number, number][] = [];
  for (let c = 0; c < 6; c++) {
    const angle = (Math.PI / 180) * (60 * c + 30);
    cornerOffsets.push([HEX_SIZE_KM * Math.cos(angle), -HEX_SIZE_KM * Math.sin(angle)]);
  }
  /** Shortest chain of corners from `from` to `to`, without `from`; null if far apart. */
  const cornerRoute = (from: number, to: number): number[] | null => {
    const previous = new Map<number, number>([[from, from]]);
    let frontier = [from];
    for (let depth = 0; depth < 8 && !previous.has(to); depth++) {
      const next: number[] = [];
      for (const corner of frontier) {
        for (const n of cornerNeighbours(corner)) {
          if (!previous.has(n)) {
            previous.set(n, corner);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    if (!previous.has(to)) return null;
    const route: number[] = [];
    for (let corner = to; corner !== from; corner = previous.get(corner) as number) route.push(corner);
    return route.reverse();
  };
  /** Edge key to the name of the first river drawn on it. */
  const riverOfEdge = new Map<number, string>();
  const mapPoint = { x: 0, z: 0 };
  const rivers = (await loadRivers(RAW_DIR)).filter((r) => {
    const kind = r.attributes['featurecla'];
    return (
      (kind === 'River' || kind === 'Lake Centerline') &&
      Number(r.attributes['scalerank']) <= RIVER_MAX_SCALERANK
    );
  });
  for (const record of rivers) {
    const name = record.attributes['name'] === '' ? `#${record.attributes['ne_id']}` : (record.attributes['name'] as string);
    for (const part of record.parts) {
      let path: number[] = [];
      const flush = (): void => {
        for (let k = 0; k + 1 < path.length; k++) {
          const key = edgeKey(path[k] as number, path[k + 1] as number);
          if (!riverOfEdge.has(key)) riverOfEdge.set(key, name);
        }
        path = [];
      };
      const push = (corner: number): void => {
        if (path[path.length - 1] === corner) return;
        // a step back along the last edge is a spur: drop it
        if (path.length >= 2 && path[path.length - 2] === corner) path.pop();
        else path.push(corner);
      };
      for (let v = 0; v + 1 < part.length / 2; v++) {
        const lon0 = part[v * 2] as number;
        const lat0 = part[v * 2 + 1] as number;
        let dLon = (part[v * 2 + 2] as number) - lon0;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const dLat = (part[v * 2 + 3] as number) - lat0;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dLon), Math.abs(dLat)) / 0.05));
        for (let s = 0; s <= steps; s++) {
          const lat = lat0 + (dLat * s) / steps;
          if (lat < -30) continue;
          mapping.lonLatToMap(lon0 + (dLon * s) / steps, lat, mapPoint);
          const hex = worldToHex(mapPoint, LAYOUT_KM);
          if (!inGrid(hex)) {
            flush();
            continue;
          }
          const centre = hexToWorld(hex, LAYOUT_KM);
          let nearest = 0;
          let nearestDistance = Infinity;
          cornerOffsets.forEach(([dx, dz], c) => {
            const d = Math.hypot(mapPoint.x - centre.x - dx, mapPoint.z - centre.z - dz);
            if (d < nearestDistance) {
              nearest = c;
              nearestDistance = d;
            }
          });
          const corner = cornerKey(hex, nearest);
          const last = path[path.length - 1];
          if (last === undefined || last === corner) {
            push(corner);
            continue;
          }
          const route = cornerRoute(last, corner);
          if (route === null) {
            flush();
            push(corner);
          } else for (const c of route) push(c);
        }
      }
      flush();
    }
  }
  const riverNames = new Map<string, number>();
  for (const [key, name] of riverOfEdge) {
    const packed = edgeHex.get(key);
    if (packed === undefined) continue;
    const i = Math.floor(packed / 8);
    const d = packed % 8;
    const n = hexNeighbor(indexToOffset(i, width), d);
    // a river runs between two land hexes; at a shore it has reached the water
    if (!inGrid(n) || isLand[i] === 0 || isLand[at(n)] === 0) continue;
    riverEdges[i] = (riverEdges[i] as number) | (1 << d);
    riverEdges[at(n)] = (riverEdges[at(n)] as number) | (1 << oppositeDirection(d));
    riverNames.set(name, (riverNames.get(name) ?? 0) + 1);
  }
  const namedRivers = [...riverNames].filter(([name, edges]) => !name.startsWith('#') && edges >= 3);
  console.log(
    `  ${namedRivers.length} named rivers with three or more edges; the longest: ` +
      namedRivers
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 16)
        .map(([name, edges]) => `${name} ${edges}`)
        .join(', '),
  );

  // ---- Features. ----
  step('features and resources');
  for (let i = 0; i < count; i++) {
    if (isLand[i] === 0 || terrain[i] === Terrain.Mountain || siteHexes.has(i)) continue;
    const look = climateLook(climateOf[i] as number, latitudeOf[i] as number);
    const t = terrain[i] as number;
    const flat = hills[i] === 0;
    const lowAndFlat = flat && (elevation[i] as number) < 150 && (relief[i] as number) < 25;
    const wet = riverEdges[i] !== 0 || neighboursOf(i).some((n) => terrain[n] === Terrain.Lake);
    if (t === Terrain.Desert) {
      if (flat && wet && chance(i, 1) < 0.5) feature[i] = Feature.Oasis;
    } else if (t === Terrain.Snow) {
      // bare
    } else if (lowAndFlat && wet && t !== Terrain.Plains && chance(i, 2) < 0.45) {
      feature[i] = Feature.Marsh;
    } else if (chance(i, 3) < look.jungle) {
      feature[i] = Feature.Jungle;
    } else if (chance(i, 4) < look.forest[flat ? 0 : 1]) {
      feature[i] = Feature.Forest;
    }
  }
  for (const [lon, lat, name] of VOLCANOES) {
    const hex = mapping.lonLatToHex(lon, lat);
    if (!inGrid(hex) || isLand[at(hex)] === 0) {
      console.log(`  note: volcano ${name} falls on water and is left out`);
      continue;
    }
    if (siteHexes.has(at(hex))) continue;
    feature[at(hex)] = Feature.Volcano;
    if (terrain[at(hex)] !== Terrain.Mountain) hills[at(hex)] = 1;
  }

  // ---- Resources. ----
  const resources: MapResource[] = STRATEGIC_RESOURCES.map(({ id, nameZh, nameEn }) => ({ id, nameZh, nameEn }));
  const free = (i: number): boolean =>
    zone[i] !== NO_ZONE &&
    terrain[i] !== Terrain.Mountain &&
    feature[i] !== Feature.Volcano &&
    resource[i] === NO_RESOURCE &&
    !siteHexes.has(i);
  STRATEGIC_RESOURCES.forEach((spec, r) => {
    for (const [lon, lat, note] of spec.places) {
      const target = mapping.lonLatToHex(lon, lat);
      const home = inGrid(target) ? polityOf[at(target)] : -1;
      let best = -1;
      let bestCost = Infinity;
      for (let i = 0; i < count; i++) {
        if (!free(i)) continue;
        const d = hexDistance(target, indexToOffset(i, width));
        // stay inside the polity the place belongs to where possible
        const cost = d + (polityOf[i] === home ? 0 : 2);
        if (d <= 3 && cost < bestCost) {
          best = i;
          bestCost = cost;
        }
      }
      if (best === -1) console.log(`  note: no hex for ${spec.nameEn} at ${note}`);
      else resource[best] = r;
    }
  });
  POLITIES.forEach((spec, p) => {
    if (spec.luxury === undefined) return;
    const index = resources.length;
    resources.push({ id: resourceId(spec.luxury[1]), nameZh: spec.luxury[0], nameEn: spec.luxury[1] });
    const hexes = landOf[p] as number[];
    const wanted = hexes.length < 15 ? 1 : hexes.length < 60 ? 2 : hexes.length < 200 ? 3 : 4;
    const candidates = hexes.filter(free).sort((a, b) => chance(a, 7 + p) - chance(b, 7 + p));
    const placed: number[] = [];
    for (const spacing of [4, 2, 1]) {
      for (const i of candidates) {
        if (placed.length >= wanted) break;
        if (placed.includes(i)) continue;
        const hex = indexToOffset(i, width);
        if (placed.every((j) => hexDistance(hex, indexToOffset(j, width)) >= spacing)) placed.push(i);
      }
    }
    // a polity this small already fails the size check below
    if (placed.length === 0 && hexes.length >= 7) throw new Error(`no hex for the specialty of ${spec.id}`);
    for (const i of placed) resource[i] = index;
  });

  // ---- Off-map ports. ----
  const usedPorts = new Set<number>();
  const offMapPorts: MapOffMapPort[] = PORTS.map((spec) => {
    const target = mapping.lonLatToHex(spec.lon, spec.lat);
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < count; i++) {
      if (owner[i] !== OWNER_OFF_MAP || usedPorts.has(i)) continue;
      const water = isLand[i] === 0;
      if (water !== (spec.kind === 'sea')) continue;
      const bordersPlay = neighboursOf(i).some((n) =>
        water ? owner[n] === OWNER_SEA : zone[n] !== NO_ZONE,
      );
      if (!bordersPlay) continue;
      const d = hexDistance(target, indexToOffset(i, width));
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    if (best === -1) throw new Error(`no hex for the port ${spec.nameEn}`);
    if (bestDistance > 4) console.log(`  note: port ${spec.nameEn} sits ${bestDistance} hexes from its place`);
    usedPorts.add(best);
    return { hex: best, kind: spec.kind, nameZh: spec.nameZh, nameEn: spec.nameEn };
  });

  // ---- Heightmap: the elevation grid seen through the same warp. ----
  step('heightmap');
  const world = {
    minX: (LAYOUT_KM.originX - HEX_ACROSS_KM / 2) / KM_PER_WORLD_UNIT,
    minZ: (LAYOUT_KM.originZ - HEX_SIZE_KM) / KM_PER_WORLD_UNIT,
    maxX: (LAYOUT_KM.originX + HEX_ACROSS_KM * width) / KM_PER_WORLD_UNIT,
    maxZ: (LAYOUT_KM.originZ + 1.5 * HEX_SIZE_KM * (height - 1) + HEX_SIZE_KM) / KM_PER_WORLD_UNIT,
  };
  const heightWidth = HEIGHTMAP_WIDTH;
  const heightRows = Math.round(
    ((world.maxZ - world.minZ) / (world.maxX - world.minX)) * (heightWidth - 1) + 1,
  );
  const heights = new Uint8Array(heightWidth * heightRows * 2);
  const heightView = new DataView(heights.buffer);
  for (let j = 0; j < heightRows; j++) {
    const z = (world.minZ + (j / (heightRows - 1)) * (world.maxZ - world.minZ)) * KM_PER_WORLD_UNIT;
    for (let i = 0; i < heightWidth; i++) {
      const x = (world.minX + (i / (heightWidth - 1)) * (world.maxX - world.minX)) * KM_PER_WORLD_UNIT;
      mapping.mapToLonLat(x, z, lonLat);
      const metres = sampleElevation(etopo, lonLat.lon, lonLat.lat);
      const value = Math.round((metres - HEIGHTMAP_BASE_METRES) / HEIGHTMAP_METRES_PER_UNIT);
      heightView.setUint16((j * heightWidth + i) * 2, Math.max(0, Math.min(65535, value)), true);
    }
  }

  // ---- The map. ----
  const map: MapData = {
    version: MAP_FORMAT_VERSION,
    width,
    height,
    terrain,
    hills,
    feature,
    elevation,
    owner,
    zone,
    riverEdges,
    resource,
    polities,
    zones,
    resources,
    offMapPorts,
    heightmap: {
      file: 'map.height.bin',
      width: heightWidth,
      height: heightRows,
      metresPerUnit: HEIGHTMAP_METRES_PER_UNIT,
      baseMetres: HEIGHTMAP_BASE_METRES,
      world,
    },
    projection: mapping.projection,
  };

  step('checking');
  // every lens that promises a place a hex must deliver it
  for (const [k, lens] of LENSES.entries()) {
    if (lens.polity === undefined && lens.lake !== true) continue;
    const info = mapping.warp.lenses[k] as (typeof mapping.warp.lenses)[number];
    const hex = worldToHex(info.centre, LAYOUT_KM);
    const wanted = lens.polity === undefined ? -1 : (polityIndex.get(lens.polity) as number);
    const delivered =
      inGrid(hex) && (lens.lake === true ? terrain[at(hex)] === Terrain.Lake : polityOf[at(hex)] === wanted);
    if (delivered) continue;
    // name the nearest place that would do, to put into the lens list
    const focus = mapping.albers.forward(lens.lon, lens.lat);
    let hint = 'none nearby';
    let nearest = Infinity;
    for (let dv = -40; dv <= 40; dv++) {
      for (let du = -40; du <= 40; du++) {
        const x = focus.x + du * CELL_KM;
        const z = focus.z + dv * CELL_KM;
        const c = rasters.cellAt(x, z);
        if (c < 0) continue;
        const fits =
          lens.lake === true
            ? rasters.lake[c] === 1
            : rasters.owner[c] === wanted && rasters.land[c] === 1 && rasters.lake[c] === 0;
        if (fits && Math.hypot(du, dv) < nearest) {
          nearest = Math.hypot(du, dv);
          const place = mapping.albers.inverse(x, z);
          hint = `${place.lon.toFixed(3)}, ${place.lat.toFixed(3)}`;
        }
      }
    }
    throw new Error(
      `lens ${lens.id}: its focus is not ${lens.lake === true ? 'in a lake' : `on land of ${lens.polity}`}; nearest such place: ${hint}`,
    );
  }
  const report = validateMap(map);
  console.log(formatReport(report));
  const land = [...isLand].filter((v) => v === 1).length;
  const share = (t: number): string =>
    `${((100 * terrain.filter((v, i) => v === t && isLand[i] === 1).length) / land).toFixed(1)}%`;
  console.log(
    `land terrain: plains ${share(Terrain.Plains)}, grassland ${share(Terrain.Grassland)}, desert ${share(Terrain.Desert)}, ` +
      `tundra ${share(Terrain.Tundra)}, snow ${share(Terrain.Snow)}, mountain ${share(Terrain.Mountain)}; ` +
      `hills ${((100 * hills.filter((v) => v === 1).length) / land).toFixed(1)}%`,
  );
  console.log(
    `grid ${width} x ${height}, heightmap ${heightWidth} x ${heightRows}, ` +
      `warp: determinant at least ${minDeterminant.toFixed(3)}, largest displacement ${warpMaxDisplacement(mapping.warp).toFixed(0)} km`,
  );
  if (debug) {
    writeDebugImages(join(RAW_DIR, 'debug'), map);
    console.log(`debug pictures written to ${join(RAW_DIR, 'debug')}`);
  }
  if (report.errors.length > 0) {
    zones.forEach((z, zi) => {
      const linked = reachableInZone(map, zi, z.siteHex, RULES.maxSeaGap);
      for (let i = 0; i < count; i++) {
        if (zone[i] !== zi || linked.has(i)) continue;
        const place = mapping.hexToLonLat(indexToOffset(i, width));
        console.error(`  cut off from ${z.id}: hex ${i} at ${place.lon.toFixed(2)}, ${place.lat.toFixed(2)}`);
      }
    });
    for (const error of report.errors.slice(0, 40)) console.error(`  error: ${error}`);
    throw new Error(`the map fails ${report.errors.length} check(s)`);
  }

  if (dry) {
    step('dry run: nothing written');
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const { json, buffers } = serializeMapData(map, 'map');
  writeFileSync(join(OUT_DIR, 'map.json'), `${json}\n`);
  for (const [file, bytes] of Object.entries(buffers)) writeFileSync(join(OUT_DIR, file), bytes);
  writeFileSync(join(OUT_DIR, map.heightmap.file), heights);
  step(`wrote ${Object.keys(buffers).length + 2} files to public/data`);
}

await main();
