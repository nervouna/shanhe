/**
 * A deterministic `MapData` of any size, for tests and timing runs of the
 * rules on a map as large as the real one. Like the fixture it is not
 * geography: it only has the same kinds of things in realistic numbers.
 *
 * Layout: two off-map columns in the west, a sea margin all around, and the
 * land in between cut into a grid of cells, one per polity. A nation fills
 * its cell with 2–4 city zones. A wasteland region fills its cell with 2
 * zones. A city-state is a 3-hex island in a cell of sea. Cells left over are
 * sea. Hills, forests, a few mountains and lakes are scattered, and rivers
 * run along some rows.
 */

import { hexDistance, hexIndex, hexNeighbor, hexNeighbors, oppositeDirection } from './hex.ts';
import type { Offset } from './hex.ts';
import {
  Feature,
  MAP_FORMAT_VERSION,
  NO_RESOURCE,
  NO_ZONE,
  OWNER_OFF_MAP,
  OWNER_SEA,
  OWNER_UNOWNED,
  Terrain,
} from './mapData.ts';
import type { MapData, MapPolity, MapResource, MapZone, PolityKind } from './mapData.ts';

export interface SyntheticMapOptions {
  /** Hexes per row. Default 160. */
  readonly width?: number;
  /** Number of rows. Default 110. */
  readonly height?: number;
  /** Number of polities of all kinds. Default 64. */
  readonly polities?: number;
  /** Varies the terrain. Default 1. */
  readonly seed?: number;
}

const OFF_MAP_COLS = 2;
const SEA_MARGIN = 3;
const RIVER_EVERY_ROWS = 17;

/** Site offsets inside a cell, as fractions of the cell's size from its centre; the first is the capital. */
const SITE_SPOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.3, -0.3],
  [0.3, 0.3],
  [0.3, -0.3],
];

const RESOURCES: readonly MapResource[] = [
  { id: 'horses', nameZh: '马', nameEn: 'Horses' },
  { id: 'iron', nameZh: '铁', nameEn: 'Iron' },
  { id: 'jade', nameZh: '玉', nameEn: 'Jade' },
];

function hash(col: number, row: number, seed: number): number {
  let h = Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ Math.imul(seed + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 16;
  return h >>> 0;
}

function kindOf(index: number): PolityKind {
  if (index % 16 === 5) return 'wastelandRegion';
  if (index % 11 === 3) return 'cityState';
  return 'nation';
}

/** Builds a synthetic map. The same options always give the same map. */
export function createSyntheticMap(options: SyntheticMapOptions = {}): MapData {
  const width = options.width ?? 160;
  const height = options.height ?? 110;
  const polityCount = options.polities ?? 64;
  const seed = options.seed ?? 1;
  const count = width * height;

  const landMinCol = OFF_MAP_COLS + SEA_MARGIN;
  const landMaxCol = width - 1 - SEA_MARGIN;
  const landMinRow = SEA_MARGIN;
  const landMaxRow = height - 1 - SEA_MARGIN;
  const landWidth = landMaxCol - landMinCol + 1;
  const landHeight = landMaxRow - landMinRow + 1;
  const gridCols = Math.max(1, Math.ceil(Math.sqrt((polityCount * landWidth) / landHeight)));
  const gridRows = Math.max(1, Math.ceil(polityCount / gridCols));
  const cellWidth = landWidth / gridCols;
  const cellHeight = landHeight / gridRows;
  if (cellWidth < 6 || cellHeight < 6) throw new Error('synthetic map: too many polities for this size');

  const terrain = new Uint8Array(count).fill(Terrain.Ocean);
  const hills = new Uint8Array(count);
  const feature = new Uint8Array(count);
  const elevation = new Int16Array(count);
  const owner = new Int16Array(count).fill(OWNER_SEA);
  const zone = new Int16Array(count).fill(NO_ZONE);
  const riverEdges = new Uint8Array(count);
  const resource = new Int16Array(count).fill(NO_RESOURCE);
  const at = (hex: Offset): number => hexIndex(hex.col, hex.row, width);
  const inGrid = (hex: Offset): boolean => hex.col >= 0 && hex.col < width && hex.row >= 0 && hex.row < height;

  // Polities, zones and sites.
  const polities: MapPolity[] = [];
  const zones: MapZone[] = [];
  const sites: Offset[] = [];
  const firstZone: number[] = [];
  const zoneCounts: number[] = [];
  for (let p = 0; p < polityCount; p++) {
    const kind = kindOf(p);
    const zoneCount = kind === 'cityState' ? 1 : kind === 'wastelandRegion' ? 2 : 2 + (p % 3);
    const centre: Offset = {
      col: Math.floor(landMinCol + ((p % gridCols) + 0.5) * cellWidth),
      row: Math.floor(landMinRow + (Math.floor(p / gridCols) + 0.5) * cellHeight),
    };
    firstZone.push(zones.length);
    zoneCounts.push(zoneCount);
    for (let s = 0; s < zoneCount; s++) {
      const spot = SITE_SPOTS[s] as readonly [number, number];
      const site: Offset = {
        col: centre.col + Math.round(spot[0] * cellWidth),
        row: centre.row + Math.round(spot[1] * cellHeight),
      };
      sites.push(site);
      zones.push({
        id: `p${p}-${s + 1}`,
        polity: p,
        siteHex: at(site),
        capital: s === 0 && kind !== 'wastelandRegion',
        cityNameZh: `城${p}-${s + 1}`,
        cityNameEn: `City ${p}-${s + 1}`,
      });
    }
    polities.push({
      id: `p${p}`,
      kind,
      nameZh: `国${p}`,
      nameEn: `Polity ${p}`,
      color: hash(p, 7, seed) & 0xffffff,
      capitalZone: kind === 'wastelandRegion' ? NO_ZONE : (firstZone[p] as number),
    });
  }

  // Land, zones and owners.
  const cellOf = (col: number, row: number): number => {
    const cx = Math.min(gridCols - 1, Math.floor((col - landMinCol) / cellWidth));
    const cy = Math.min(gridRows - 1, Math.floor((row - landMinRow) / cellHeight));
    return cy * gridCols + cx;
  };
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = hexIndex(col, row, width);
      if (col < OFF_MAP_COLS) {
        terrain[i] = Terrain.Plains;
        owner[i] = OWNER_OFF_MAP;
        continue;
      }
      if (col < landMinCol || col > landMaxCol || row < landMinRow || row > landMaxRow) continue;
      const p = cellOf(col, row);
      if (p >= polityCount) continue;
      const kind = (polities[p] as MapPolity).kind;
      const first = firstZone[p] as number;
      let best = first;
      let bestDistance = Infinity;
      for (let z = first; z < first + (zoneCounts[p] as number); z++) {
        const d = hexDistance({ col, row }, sites[z] as Offset);
        if (d < bestDistance) {
          best = z;
          bestDistance = d;
        }
      }
      if (kind === 'cityState') {
        // The site and its eastern and western neighbours; the rest of the cell is sea.
        if (row !== (sites[first] as Offset).row || bestDistance > 1) continue;
      }
      terrain[i] = Terrain.Plains;
      zone[i] = best;
      owner[i] = kind === 'wastelandRegion' ? OWNER_UNOWNED : p;
    }
  }

  const siteSet = new Set(zones.map((z) => z.siteHex));
  const nearSite = (hex: Offset): boolean =>
    siteSet.has(at(hex)) || hexNeighbors(hex).some((n) => inGrid(n) && siteSet.has(at(n)));

  // Terrain detail.
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = hexIndex(col, row, width);
      const h = hash(col, row, seed);
      if (owner[i] === OWNER_SEA) continue;
      const offMap = owner[i] === OWNER_OFF_MAP;
      const here = { col, row };
      const cityState = !offMap && (polities[(zones[zone[i] as number] as MapZone).polity] as MapPolity).kind === 'cityState';
      if (!offMap && !cityState && !nearSite(here)) {
        if (h % 31 === 0) {
          terrain[i] = Terrain.Mountain;
          elevation[i] = 3000 + (h % 1200);
          continue;
        }
        if (h % 89 === 1) {
          terrain[i] = Terrain.Lake;
          owner[i] = OWNER_SEA;
          zone[i] = NO_ZONE;
          elevation[i] = 100;
          continue;
        }
      }
      const north = row / height;
      if (north < 0.08) terrain[i] = Terrain.Snow;
      else if (north < 0.2) terrain[i] = Terrain.Tundra;
      else if (owner[i] === OWNER_UNOWNED && h % 3 !== 0) terrain[i] = Terrain.Desert;
      else terrain[i] = h % 2 === 0 ? Terrain.Plains : Terrain.Grassland;

      const green = terrain[i] === Terrain.Plains || terrain[i] === Terrain.Grassland;
      if (green && north > 0.7 && h % 5 === 2) feature[i] = Feature.Jungle;
      else if ((green || terrain[i] === Terrain.Tundra) && h % 6 === 1) feature[i] = Feature.Forest;
      else if (green && h % 41 === 3) feature[i] = Feature.Marsh;
      else if (terrain[i] === Terrain.Desert && h % 23 === 4) feature[i] = Feature.Oasis;
      hills[i] = h % 5 === 0 && feature[i] !== Feature.Marsh && feature[i] !== Feature.Oasis ? 1 : 0;
      if (siteSet.has(i)) {
        feature[i] = Feature.None;
        hills[i] = 0;
        if (terrain[i] === Terrain.Snow) terrain[i] = Terrain.Tundra;
      }
      elevation[i] = 40 + (h % 300) + (hills[i] === 1 ? 400 : 0);
      if (!offMap && !siteSet.has(i) && h % 53 === 7) resource[i] = h % RESOURCES.length;
    }
  }

  // Coast and sea depth.
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = hexIndex(col, row, width);
      if (terrain[i] !== Terrain.Ocean) continue;
      const nearLand = hexNeighbors({ col, row }).some((n) => {
        if (!inGrid(n)) return false;
        const t = terrain[at(n)];
        return t !== Terrain.Ocean && t !== Terrain.Coast && t !== Terrain.Lake;
      });
      terrain[i] = nearLand ? Terrain.Coast : Terrain.Ocean;
      elevation[i] = nearLand ? -50 : -2000;
    }
  }

  // Rivers along the southern edges of some rows, between land hexes only.
  const isLand = (hex: Offset): boolean => {
    if (!inGrid(hex)) return false;
    const t = terrain[at(hex)] as number;
    return t >= Terrain.Plains && owner[at(hex)] !== OWNER_OFF_MAP;
  };
  for (let row = landMinRow + 5; row < landMaxRow; row += RIVER_EVERY_ROWS) {
    for (let col = landMinCol; col <= landMaxCol; col++) {
      const here = { col, row };
      if (!isLand(here)) continue;
      for (const d of [4, 5]) {
        const n = hexNeighbor(here, d);
        if (!isLand(n)) continue;
        riverEdges[at(here)] = (riverEdges[at(here)] as number) | (1 << d);
        riverEdges[at(n)] = (riverEdges[at(n)] as number) | (1 << oppositeDirection(d));
      }
    }
  }

  const size = 1;
  const hexWidth = Math.sqrt(3) * size;
  return {
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
    resources: RESOURCES,
    offMapPorts: [
      { hex: hexIndex(OFF_MAP_COLS - 1, Math.floor(height / 2), width), kind: 'land', nameZh: '西口', nameEn: 'West Gate' },
    ],
    heightmap: {
      file: 'synthetic.height.bin',
      width: width * 4 + 1,
      height: height * 4 + 1,
      metresPerUnit: 0.25,
      baseMetres: -8192,
      world: {
        minX: -hexWidth / 2,
        minZ: -size,
        maxX: hexWidth * width,
        maxZ: 1.5 * size * (height - 1) + size,
      },
    },
    projection: {
      kind: 'albersEqualArea',
      lon0: 105,
      lat0: 35,
      parallel1: 15,
      parallel2: 55,
      radiusKm: 6371,
      kmPerWorldUnit: 80 / hexWidth,
      hexLayout: { size, originX: 0, originZ: 0 },
    },
  };
}
