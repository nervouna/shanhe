/**
 * Fixed numbers of the map: projection, frame, hex size, heightmap size and
 * the enlargement lenses. Nothing here depends on downloaded data, so the
 * whole longitude/latitude to hex mapping can be rebuilt from this file.
 */

import type { HexLayout } from '../../src/shared/hex.ts';
import type { AlbersParams } from './albers.ts';
import type { LensSpec } from './warp.ts';

export const PROJECTION: AlbersParams = {
  lon0: 105,
  lat0: 35,
  parallel1: 15,
  parallel2: 55,
  radiusKm: 6371,
};

/** Width of a hex, flat side to flat side, km. */
export const HEX_ACROSS_KM = 70;
/** Centre-to-corner distance of a hex, km. One world unit. */
export const HEX_SIZE_KM = HEX_ACROSS_KM / Math.sqrt(3);
/** `MapProjection.kmPerWorldUnit`: a hex has size 1 in world units. */
export const KM_PER_WORLD_UNIT = HEX_SIZE_KM;

/**
 * The visible frame on the map plane, km from the projection origin
 * (105°E, 35°N): from the Urals and the Pamirs to the Bering Strait, and
 * from the Arctic coast to Java and Timor.
 */
export const FRAME_KM = { minX: -3050, maxX: 4450, minZ: -5450, maxZ: 5000 } as const;

export const GRID_WIDTH = Math.floor((FRAME_KM.maxX - FRAME_KM.minX - HEX_ACROSS_KM / 2) / HEX_ACROSS_KM);
export const GRID_HEIGHT =
  Math.floor((FRAME_KM.maxZ - FRAME_KM.minZ - 2 * HEX_SIZE_KM) / (1.5 * HEX_SIZE_KM)) + 1;

/** The hex grid on the map plane, in kilometres. */
export const LAYOUT_KM: HexLayout = {
  size: HEX_SIZE_KM,
  originX: FRAME_KM.minX + HEX_ACROSS_KM / 2,
  originZ: FRAME_KM.minZ + HEX_SIZE_KM,
};

/** Samples per row of the heightmap. The number of rows follows from the frame. */
export const HEIGHTMAP_WIDTH = 2048;
export const HEIGHTMAP_BASE_METRES = -11000;
export const HEIGHTMAP_METRES_PER_UNIT = 0.5;

/**
 * The lenses, in the order they are built (see `warp.ts` and the README).
 * A lens with `snap` guarantees its focus a hex of its own; the focus must
 * then be a point on land inside the polity it is meant for.
 */
export const LENSES: readonly LensSpec[] = [
  // Moderate enlargement of islands and small coastal units.
  { id: 'hainan', lon: 109.75, lat: 19.2, radiusKm: 350, gain: 1.3 },
  { id: 'taiwan', lon: 121.0, lat: 23.7, radiusKm: 380, gain: 1.3 },
  { id: 'kyushu', lon: 131.0, lat: 32.6, radiusKm: 300, gain: 1.3 },
  { id: 'pearl-river-mouth', lon: 113.85, lat: 22.3, radiusKm: 260, gain: 2.6 },
  // Straits narrower than a hex, widened across so that the islands stay islands.
  { id: 'qiongzhou-strait', lon: 110.2, lat: 20.17, radiusKm: 160, gain: 1, gainAcross: 3.5, axisDeg: 0, power: 2 },
  { id: 'sunda-strait', lon: 105.85, lat: -5.95, radiusKm: 160, gain: 1, gainAcross: 3.2, axisDeg: 90, power: 2 },
  // Places that need a hex of their own: the focus is put on a hex centre.
  { id: 'hong-kong', lon: 114.17, lat: 22.38, radiusKm: 110, gain: 1, snap: true, polity: 'xiangjiang' },
  { id: 'macau', lon: 113.55, lat: 22.16, radiusKm: 110, gain: 1, snap: true, polity: 'haojing' },
  { id: 'singapore', lon: 103.82, lat: 1.36, radiusKm: 150, gain: 2.2, snap: true, polity: 'temasek' },
  { id: 'jeju', lon: 126.55, lat: 33.38, radiusKm: 160, gain: 1.6, snap: true, polity: 'tamna' },
  { id: 'tsushima', lon: 129.29, lat: 34.21, radiusKm: 120, gain: 2, snap: true, polity: 'tsushima' },
  // Capitals on a coast whose hex centre would fall into the sea.
  { id: 'seoul', lon: 126.98, lat: 37.57, radiusKm: 120, gain: 1, snap: true, polity: 'goryeo' },
  { id: 'vladivostok', lon: 131.89, lat: 43.12, radiusKm: 120, gain: 1, snap: true, polity: 'shuaibin' },
  { id: 'hue', lon: 107.59, lat: 16.46, radiusKm: 120, gain: 1, snap: true, polity: 'champa' },
  { id: 'bangkok', lon: 100.5, lat: 13.75, radiusKm: 120, gain: 1, snap: true, polity: 'siam' },
  { id: 'zamboanga', lon: 122.08, lat: 6.91, radiusKm: 120, gain: 1, snap: true, polity: 'sulu' },
  { id: 'makassar', lon: 119.43, lat: -5.14, radiusKm: 120, gain: 1, snap: true, polity: 'maluku' },
  // Vientiane lies on the Mekong, the border: its hex centre would fall on the far bank.
  { id: 'vientiane', lon: 102.63, lat: 17.99, radiusKm: 120, gain: 1, snap: true, polity: 'lanxang' },
  { id: 'bandar-seri-begawan', lon: 114.94, lat: 4.89, radiusKm: 120, gain: 1, snap: true, polity: 'wenlai' },
  // Lakes the design names that would otherwise fall between hex centres.
  { id: 'dongting-lake', lon: 112.852, lat: 29.217, radiusKm: 110, gain: 1.5, snap: true, lake: true },
  { id: 'poyang-lake', lon: 116.3, lat: 29.1, radiusKm: 110, gain: 1.5, snap: true, lake: true },
  // The Kei islands: the stepping stone between Tanimbar and Aru.
  { id: 'kei', lon: 132.745, lat: -5.625, radiusKm: 120, gain: 2, snap: true, polity: 'maluku' },
  // Okinawa is a thin island: it is widened more than it is lengthened.
  {
    id: 'okinawa',
    lon: 127.72,
    lat: 26.22,
    radiusKm: 600,
    gain: 8,
    gainAcross: 9,
    axisDeg: 54,
    power: 3,
    snap: true,
    polity: 'ryukyu',
  },
];
