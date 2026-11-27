/**
 * A small, deterministic `MapData` for tests and for render and UI work until
 * the real map exists. It is not geography: it only exercises every part of
 * the contract.
 *
 * Layout of the 28 x 18 grid:
 * - columns 0–2 are an off-map strip (land, with sea at its southern end)
 *   with one land port on its eastern edge;
 * - columns 3–23, rows 0–15 are the play area's land: four nations of 3, 2,
 *   2 and 1 zones, one coastal city-state of 3 hexes and one wasteland region
 *   in the north-east;
 * - columns 24–27 and rows 16–17 are sea;
 * - there is a mountain ridge in the north, a lake in the middle, and a
 *   river from the lake east to the sea.
 *
 * The heightmap entry describes a file that is not shipped: the fixture has
 * no relief.
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
  isWaterTerrain,
} from './mapData.ts';
import type { MapData, MapPolity, MapResource, MapZone, PolityKind } from './mapData.ts';

const WIDTH = 28;
const HEIGHT = 18;
/** Columns below this are off-map. */
const PLAY_MIN_COL = 3;
/** Columns above this are sea. */
const LAND_MAX_COL = 23;
/** Rows above this are sea. */
const LAND_MAX_ROW = 15;

const LAKE: Offset = { col: 13, row: 9 };
const RIDGE_COL = 13;
const RIDGE_MAX_ROW = 5;
const RIVER_ROW = 9;
const RIVER_FROM_COL = 14;

interface PolitySpec {
  readonly id: string;
  readonly kind: PolityKind;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly color: number;
  /** City sites; the first one is the capital. */
  readonly sites: readonly (readonly [col: number, row: number, zh: string, en: string])[];
}

const POLITIES: readonly PolitySpec[] = [
  {
    id: 'jia',
    kind: 'nation',
    nameZh: '甲国',
    nameEn: 'Jia',
    color: 0xc0504d,
    sites: [
      [6, 3, '甲都', 'Jiadu'],
      [11, 2, '甲北', 'Jiabei'],
      [8, 7, '甲南', 'Jianan'],
    ],
  },
  {
    id: 'yi',
    kind: 'nation',
    nameZh: '乙国',
    nameEn: 'Yi',
    color: 0x4f81bd,
    sites: [
      [17, 4, '乙都', 'Yidu'],
      [20, 8, '乙东', 'Yidong'],
    ],
  },
  {
    id: 'bing',
    kind: 'nation',
    nameZh: '丙国',
    nameEn: 'Bing',
    color: 0x9bbb59,
    sites: [
      [6, 12, '丙都', 'Bingdu'],
      [11, 12, '丙东', 'Bingdong'],
    ],
  },
  {
    id: 'ding',
    kind: 'nation',
    nameZh: '丁国',
    nameEn: 'Ding',
    color: 0x8064a2,
    sites: [[16, 12, '丁都', 'Dingdu']],
  },
  {
    id: 'wucheng',
    kind: 'cityState',
    nameZh: '戊城',
    nameEn: 'Wucheng',
    color: 0xf2c14e,
    sites: [[23, 13, '戊城', 'Wucheng']],
  },
  {
    id: 'huangyuan',
    kind: 'wastelandRegion',
    nameZh: '荒原',
    nameEn: 'Huangyuan',
    color: 0x9c8f7a,
    sites: [[21, 1, '荒原集', 'Huangyuanji']],
  },
];

const RESOURCES: readonly MapResource[] = [
  { id: 'horses', nameZh: '马', nameEn: 'Horses' },
  { id: 'jade', nameZh: '玉', nameEn: 'Jade' },
];

const RESOURCE_HEXES: readonly (readonly [col: number, row: number, resource: number])[] = [
  [9, 4, 0],
  [18, 6, 0],
  [7, 13, 0],
  [22, 1, 1],
];

/** A fixed pseudo-random number per hex, used to vary terrain. */
function hash(col: number, row: number): number {
  let h = Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return h >>> 0;
}

function inGrid(hex: Offset): boolean {
  return hex.col >= 0 && hex.col < WIDTH && hex.row >= 0 && hex.row < HEIGHT;
}

function isFixtureWater(col: number, row: number): boolean {
  return col > LAND_MAX_COL || row > LAND_MAX_ROW || (col === LAKE.col && row === LAKE.row);
}

/** Builds the fixture map. Every call returns a new, identical map. */
export function createFixtureMap(): MapData {
  const count = WIDTH * HEIGHT;
  const terrain = new Uint8Array(count);
  const hills = new Uint8Array(count);
  const feature = new Uint8Array(count);
  const elevation = new Int16Array(count);
  const owner = new Int16Array(count);
  const zone = new Int16Array(count).fill(NO_ZONE);
  const riverEdges = new Uint8Array(count);
  const resource = new Int16Array(count).fill(NO_RESOURCE);
  const at = (hex: Offset): number => hexIndex(hex.col, hex.row, WIDTH);

  // Polities and zones.
  const polities: MapPolity[] = [];
  const zones: MapZone[] = [];
  POLITIES.forEach((spec, p) => {
    const firstZone = zones.length;
    spec.sites.forEach(([col, row, cityNameZh, cityNameEn], s) => {
      zones.push({
        id: `${spec.id}-${s + 1}`,
        polity: p,
        siteHex: hexIndex(col, row, WIDTH),
        capital: s === 0 && spec.kind !== 'wastelandRegion',
        cityNameZh,
        cityNameEn,
      });
    });
    polities.push({
      id: spec.id,
      kind: spec.kind,
      nameZh: spec.nameZh,
      nameEn: spec.nameEn,
      color: spec.color,
      capitalZone: spec.kind === 'wastelandRegion' ? NO_ZONE : firstZone,
    });
  });
  const kindOfZone = (z: number): PolityKind =>
    (polities[(zones[z] as MapZone).polity] as MapPolity).kind;
  const siteOf = (z: number): Offset => {
    const index = (zones[z] as MapZone).siteHex;
    return { col: index % WIDTH, row: Math.floor(index / WIDTH) };
  };

  // Water and land.
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const i = hexIndex(col, row, WIDTH);
      if (!isFixtureWater(col, row)) {
        terrain[i] = Terrain.Plains; // refined below
        continue;
      }
      if (col === LAKE.col && row === LAKE.row) {
        terrain[i] = Terrain.Lake;
        continue;
      }
      const nearLand = hexNeighbors({ col, row }).some(
        (n) => inGrid(n) && !isFixtureWater(n.col, n.row),
      );
      terrain[i] = nearLand ? Terrain.Coast : Terrain.Ocean;
    }
  }

  // Zones: the city-state takes its site and the first two land neighbours;
  // every other land hex of the play area goes to the nearest remaining site.
  zones.forEach((_, z) => {
    if (kindOfZone(z) !== 'cityState') return;
    const site = siteOf(z);
    zone[at(site)] = z;
    let taken = 0;
    for (let d = 0; d < 6 && taken < 2; d++) {
      const n = hexNeighbor(site, d);
      if (!inGrid(n) || n.col < PLAY_MIN_COL || isFixtureWater(n.col, n.row)) continue;
      zone[at(n)] = z;
      taken++;
    }
  });
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = PLAY_MIN_COL; col < WIDTH; col++) {
      const i = hexIndex(col, row, WIDTH);
      if (isFixtureWater(col, row) || zone[i] !== NO_ZONE) continue;
      let best = NO_ZONE;
      let bestDistance = Infinity;
      zones.forEach((_, z) => {
        if (kindOfZone(z) === 'cityState') return;
        const d = hexDistance({ col, row }, siteOf(z));
        if (d < bestDistance) {
          best = z;
          bestDistance = d;
        }
      });
      zone[i] = best;
    }
  }

  // Owners.
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const i = hexIndex(col, row, WIDTH);
      if (col < PLAY_MIN_COL) owner[i] = OWNER_OFF_MAP;
      else if (isWaterTerrain(terrain[i] as number)) owner[i] = OWNER_SEA;
      else {
        const z = zone[i] as number;
        owner[i] = kindOfZone(z) === 'wastelandRegion' ? OWNER_UNOWNED : (zones[z] as MapZone).polity;
      }
    }
  }

  // Land terrain, hills, features and elevation.
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const i = hexIndex(col, row, WIDTH);
      const h = hash(col, row);
      if (isWaterTerrain(terrain[i] as number)) {
        elevation[i] =
          terrain[i] === Terrain.Lake ? 120 : terrain[i] === Terrain.Coast ? -50 : -2000;
        continue;
      }
      const offMap = col < PLAY_MIN_COL;
      const onRidge = offMap
        ? col === 1 && row >= 3 && row <= 12
        : col === RIDGE_COL && row <= RIDGE_MAX_ROW;
      if (onRidge) {
        terrain[i] = Terrain.Mountain;
        elevation[i] = 2800 + (h % 1500);
        continue;
      }
      if (offMap && row === 0) terrain[i] = Terrain.Snow;
      else if (row === 0) terrain[i] = Terrain.Tundra;
      else if (owner[i] === OWNER_UNOWNED) terrain[i] = Terrain.Desert;
      else terrain[i] = h % 2 === 0 ? Terrain.Plains : Terrain.Grassland;

      const green = terrain[i] === Terrain.Plains || terrain[i] === Terrain.Grassland;
      if (green && row >= 13 && h % 3 === 0) feature[i] = Feature.Jungle;
      else if ((green || terrain[i] === Terrain.Tundra) && h % 7 === 1) feature[i] = Feature.Forest;

      hills[i] = h % 5 === 0 ? 1 : 0;
      elevation[i] = 40 + (h % 300) + (hills[i] === 1 ? 400 : 0);
    }
  }
  // One of each remaining feature, at fixed places.
  const volcano = hexIndex(RIDGE_COL, 2, WIDTH);
  feature[volcano] = Feature.Volcano;
  const marsh = hexIndex(12, 9, WIDTH);
  feature[marsh] = Feature.Marsh;
  hills[marsh] = 0;
  const oasis = hexIndex(22, 2, WIDTH);
  feature[oasis] = Feature.Oasis;
  hills[oasis] = 0;

  // City sites are on open, flat ground.
  for (const z of zones) {
    feature[z.siteHex] = Feature.None;
    hills[z.siteHex] = 0;
  }

  // River: from the lake eastwards along the southern edges of one row, to
  // the sea. Each edge is marked on both hexes that share it.
  for (let col = RIVER_FROM_COL; col <= LAND_MAX_COL; col++) {
    const here = { col, row: RIVER_ROW };
    for (const d of [4, 5]) {
      const n = hexNeighbor(here, d);
      if (isFixtureWater(n.col, n.row)) continue; // the river has reached the sea
      riverEdges[at(here)] = (riverEdges[at(here)] as number) | (1 << d);
      riverEdges[at(n)] = (riverEdges[at(n)] as number) | (1 << oppositeDirection(d));
    }
  }

  for (const [col, row, r] of RESOURCE_HEXES) resource[hexIndex(col, row, WIDTH)] = r;

  const size = 1;
  const hexWidth = Math.sqrt(3) * size;
  return {
    version: MAP_FORMAT_VERSION,
    width: WIDTH,
    height: HEIGHT,
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
      { hex: hexIndex(PLAY_MIN_COL - 1, 9, WIDTH), kind: 'land', nameZh: '西口', nameEn: 'West Gate' },
    ],
    heightmap: {
      file: 'fixture.height.bin',
      width: WIDTH * 4 + 1,
      height: HEIGHT * 4 + 1,
      metresPerUnit: 0.25,
      baseMetres: -8192,
      world: {
        minX: -hexWidth / 2,
        minZ: -size,
        maxX: hexWidth * WIDTH,
        maxZ: 1.5 * size * (HEIGHT - 1) + size,
      },
    },
    projection: {
      kind: 'albersEqualArea',
      lon0: 105,
      lat0: 35,
      parallel1: 15,
      parallel2: 55,
      radiusKm: 6371,
      // one hex is about 80 km across
      kmPerWorldUnit: 80 / hexWidth,
      hexLayout: { size, originX: 0, originZ: 0 },
    },
  };
}
