/**
 * `MapData`: the contract shared by the map pipeline (which writes it), the
 * rules core (which plays on it) and the renderer (which draws it).
 *
 * A map is a `width` x `height` grid of pointy-top hexes in odd-r offset
 * coordinates (see `hex.ts`). Every per-hex array has `width * height`
 * entries and is indexed by `row * width + col` (`hexIndex` in `hex.ts`).
 * Wherever this file says "hex index" it means that index.
 *
 * On disk a map is one JSON file plus one `.bin` file per per-hex array, see
 * {@link serializeMapData}. The heightmap is a separate file that the JSON
 * only describes.
 */

import type { HexLayout } from './hex.ts';

/** Version of the serialized format. `parseMapData` rejects any other. */
export const MAP_FORMAT_VERSION = 1;

/** Base terrain of a hex. Stored in `MapData.terrain`. */
export const Terrain = {
  /** Deep sea. */
  Ocean: 0,
  /** Sea next to land. */
  Coast: 1,
  /** Inland water. */
  Lake: 2,
  Plains: 3,
  Grassland: 4,
  Desert: 5,
  Tundra: 6,
  Snow: 7,
  /** Impassable high mountain. Lower relief is the `hills` flag. */
  Mountain: 8,
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

/** True for ocean, coast and lake. */
export function isWaterTerrain(terrain: number): boolean {
  return terrain === Terrain.Ocean || terrain === Terrain.Coast || terrain === Terrain.Lake;
}

/** Feature on top of the terrain. Stored in `MapData.feature`. */
export const Feature = {
  None: 0,
  Forest: 1,
  Jungle: 2,
  Marsh: 3,
  Oasis: 4,
  Volcano: 5,
} as const;
export type FeatureId = (typeof Feature)[keyof typeof Feature];

/** `owner` value of a water hex (ocean, coast or lake) inside the play area. */
export const OWNER_SEA = -1;
/**
 * `owner` value of a land hex inside the play area that nobody owns at the
 * start: wasteland. Its `zone` still names the zone, and through it the
 * wasteland region, that the hex belongs to.
 */
export const OWNER_UNOWNED = -2;
/**
 * `owner` value of a hex outside the play area, land or water: it is drawn
 * like any other hex but can never be owned or entered.
 */
export const OWNER_OFF_MAP = -3;

/** `zone` value of a hex that is in no city zone (water and off-map hexes). */
export const NO_ZONE = -1;
/** `resource` value of a hex without a resource. */
export const NO_RESOURCE = -1;

export type PolityKind = 'nation' | 'cityState' | 'wastelandRegion';

/**
 * A nation, a city-state or a wasteland region. Wasteland regions are listed
 * here so that their zones have a polity, but they own nothing: their hexes
 * carry {@link OWNER_UNOWNED}.
 */
export interface MapPolity {
  /** Stable identifier, unique among polities. */
  readonly id: string;
  readonly kind: PolityKind;
  readonly nameZh: string;
  readonly nameEn: string;
  /** Map colour as `0xRRGGBB`. */
  readonly color: number;
  /**
   * Index into `MapData.zones` of the zone holding the capital, or
   * {@link NO_ZONE} for a wasteland region.
   */
  readonly capitalZone: number;
}

/** A city zone: the hexes that belong to one preset city site. */
export interface MapZone {
  /** Stable identifier, unique among zones. */
  readonly id: string;
  /** Index into `MapData.polities`. */
  readonly polity: number;
  /** Hex index of the city site. The site hex lies inside this zone. */
  readonly siteHex: number;
  /** True if this zone holds its polity's capital. */
  readonly capital: boolean;
  readonly cityNameZh: string;
  readonly cityNameEn: string;
}

/** A kind of resource that `MapData.resource` can place on a hex. */
export interface MapResource {
  /** Stable identifier, unique among resources. */
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
}

/** A trade port on the edge of the off-map land or sea. */
export interface MapOffMapPort {
  /** Hex index of the port. The hex is off-map and borders the play area. */
  readonly hex: number;
  /** `land`: reached over land. `sea`: reached by sea. */
  readonly kind: 'land' | 'sea';
  readonly nameZh: string;
  readonly nameEn: string;
}

/** A rectangle on the ground plane, in world coordinates (`x` east, `z` south). */
export interface WorldRect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/**
 * Description of the terrain heightmap, which is finer than the hex grid.
 *
 * The file holds `width * height` unsigned 16-bit integers, little-endian,
 * row by row from north to south and from west to east inside a row. Sample
 * (`i`, `j`) (column, row) sits at
 *
 *     x = world.minX + i / (width - 1) * (world.maxX - world.minX)
 *     z = world.minZ + j / (height - 1) * (world.maxZ - world.minZ)
 *
 * and its elevation in metres is `baseMetres + value * metresPerUnit`.
 */
export interface MapHeightmap {
  /** File name inside `public/data`. */
  readonly file: string;
  /** Samples per row. */
  readonly width: number;
  /** Number of rows. */
  readonly height: number;
  readonly metresPerUnit: number;
  /** Elevation in metres of the stored value 0 (negative when the sea floor is included). */
  readonly baseMetres: number;
  /** The world rectangle covered, from the first to the last sample. */
  readonly world: WorldRect;
}

/**
 * How longitude and latitude map to world coordinates, and where the hex grid
 * sits in the world.
 *
 * The projection is the Albers equal-area conic on a sphere. With angles in
 * radians, `φ1`/`φ2` the standard parallels, `(λ0, φ0)` the origin and `R` =
 * `radiusKm`:
 *
 *     n  = (sin φ1 + sin φ2) / 2
 *     C  = cos²φ1 + 2 n sin φ1
 *     ρ(φ) = R * sqrt(C - 2 n sin φ) / n
 *     θ  = n (λ - λ0)
 *     east  = ρ(φ) sin θ                  (km)
 *     north = ρ(φ0) - ρ(φ) cos θ          (km)
 *     x =  east  / kmPerWorldUnit
 *     z = -north / kmPerWorldUnit
 *
 * So the origin `(lon0, lat0)` is world `(0, 0)`, `x` grows to the east and
 * `z` to the south.
 *
 * Hex to world: the centre of hex (`col`, `row`) is
 * `hexToWorld({ col, row }, projection.hexLayout)` from `hex.ts`:
 *
 *     x = originX + sqrt(3) * size * (col + 0.5 * (row & 1))
 *     z = originZ + 1.5 * size * row
 */
export interface MapProjection {
  readonly kind: 'albersEqualArea';
  /** Longitude of the origin, degrees east. */
  readonly lon0: number;
  /** Latitude of the origin, degrees north. */
  readonly lat0: number;
  /** First standard parallel, degrees north. */
  readonly parallel1: number;
  /** Second standard parallel, degrees north. */
  readonly parallel2: number;
  /** Radius of the sphere in kilometres. */
  readonly radiusKm: number;
  /** Kilometres on the projected plane per world unit. */
  readonly kmPerWorldUnit: number;
  /** Position and size of the hex grid in world coordinates. */
  readonly hexLayout: HexLayout;
}

/** The whole map. See the file comment for the indexing rules. */
export interface MapData {
  /** Always {@link MAP_FORMAT_VERSION}. */
  readonly version: number;
  /** Hexes per row. */
  readonly width: number;
  /** Number of rows. */
  readonly height: number;

  /** Per hex: a {@link Terrain} value. */
  readonly terrain: Uint8Array;
  /** Per hex: 1 if the hex is hilly, else 0. Always 0 on water and mountains. */
  readonly hills: Uint8Array;
  /** Per hex: a {@link Feature} value. */
  readonly feature: Uint8Array;
  /** Per hex: representative elevation in metres above sea level (negative below). */
  readonly elevation: Int16Array;
  /**
   * Per hex: who owns the hex at the start. An index into `polities`, or one
   * of {@link OWNER_SEA}, {@link OWNER_UNOWNED} and {@link OWNER_OFF_MAP}.
   * Where it is an index, it equals `zones[zone].polity`.
   */
  readonly owner: Int16Array;
  /**
   * Per hex: index into `zones`, or {@link NO_ZONE}. Every land hex inside
   * the play area is in a zone, wasteland included.
   */
  readonly zone: Int16Array;
  /**
   * Per hex: which of the six edges carry a river. Bit `d` (value `1 << d`)
   * is the edge shared with the neighbour in direction `d` of
   * `HEX_DIRECTIONS` (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE). A river edge is set
   * on both hexes that share it: bit `d` here and bit `(d + 3) % 6` there.
   */
  readonly riverEdges: Uint8Array;
  /** Per hex: index into `resources`, or {@link NO_RESOURCE}. */
  readonly resource: Int16Array;

  readonly polities: readonly MapPolity[];
  readonly zones: readonly MapZone[];
  readonly resources: readonly MapResource[];
  readonly offMapPorts: readonly MapOffMapPort[];
  readonly heightmap: MapHeightmap;
  readonly projection: MapProjection;
}

/** A map ready to be written to disk. */
export interface SerializedMapData {
  /** Content of the JSON file: everything except the per-hex arrays. */
  readonly json: string;
  /**
   * Content of the binary files, keyed by file name
   * (`<baseName>.<layer>.bin`). Multi-byte values are little-endian.
   */
  readonly buffers: Record<string, Uint8Array>;
}

type LayerType = 'u8' | 'i16';

const LAYERS = [
  ['terrain', 'u8'],
  ['hills', 'u8'],
  ['feature', 'u8'],
  ['elevation', 'i16'],
  ['owner', 'i16'],
  ['zone', 'i16'],
  ['riverEdges', 'u8'],
  ['resource', 'i16'],
] as const satisfies readonly (readonly [keyof MapData, LayerType])[];

type LayerName = (typeof LAYERS)[number][0];

interface LayerHeader {
  readonly file: string;
  readonly type: LayerType;
}

/** Shape of the JSON file. */
interface MapHeader {
  readonly format: 'shanhe-map';
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly layers: Record<LayerName, LayerHeader>;
  readonly polities: readonly MapPolity[];
  readonly zones: readonly MapZone[];
  readonly resources: readonly MapResource[];
  readonly offMapPorts: readonly MapOffMapPort[];
  readonly heightmap: MapHeightmap;
  readonly projection: MapProjection;
}

function encodeLayer(data: Uint8Array | Int16Array): Uint8Array {
  if (data instanceof Uint8Array) return data.slice();
  const bytes = new Uint8Array(data.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < data.length; i++) view.setInt16(i * 2, data[i] as number, true);
  return bytes;
}

function decodeLayer(bytes: Uint8Array, type: LayerType): Uint8Array | Int16Array {
  if (type === 'u8') return bytes.slice();
  const out = new Int16Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/**
 * Turns a map into one JSON string and one byte buffer per per-hex array.
 * The JSON lists the buffer file names, so the files only have to be stored
 * side by side under those names. The heightmap file is not produced here.
 *
 * @param baseName prefix of the buffer file names, `map` by default.
 */
export function serializeMapData(map: MapData, baseName = 'map'): SerializedMapData {
  const buffers: Record<string, Uint8Array> = {};
  const layers = {} as Record<LayerName, LayerHeader>;
  for (const [name, type] of LAYERS) {
    const file = `${baseName}.${name}.bin`;
    layers[name] = { file, type };
    buffers[file] = encodeLayer(map[name]);
  }
  const header: MapHeader = {
    format: 'shanhe-map',
    version: map.version,
    width: map.width,
    height: map.height,
    layers,
    polities: map.polities,
    zones: map.zones,
    resources: map.resources,
    offMapPorts: map.offMapPorts,
    heightmap: map.heightmap,
    projection: map.projection,
  };
  return { json: JSON.stringify(header), buffers };
}

/**
 * Rebuilds a map from the output of {@link serializeMapData}.
 *
 * @param json content of the JSON file.
 * @param buffers content of the binary files, keyed by the file names the
 *   JSON lists. Extra entries are ignored.
 * @throws if the format or version is not supported, or a buffer is missing
 *   or has the wrong size.
 */
export function parseMapData(
  json: string,
  buffers: Readonly<Record<string, Uint8Array | ArrayBuffer>>,
): MapData {
  const header = JSON.parse(json) as Partial<MapHeader>;
  if (header.format !== 'shanhe-map') {
    throw new Error('map data: not a shanhe-map file');
  }
  if (header.version !== MAP_FORMAT_VERSION) {
    throw new Error(
      `map data: unsupported version ${String(header.version)}, expected ${MAP_FORMAT_VERSION}`,
    );
  }
  const { width, height, layers } = header;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('map data: invalid width or height');
  }
  if (
    layers === undefined ||
    header.polities === undefined ||
    header.zones === undefined ||
    header.resources === undefined ||
    header.offMapPorts === undefined ||
    header.heightmap === undefined ||
    header.projection === undefined
  ) {
    throw new Error('map data: incomplete header');
  }

  const count = width * height;
  const decoded = {} as Record<LayerName, Uint8Array | Int16Array>;
  for (const [name, type] of LAYERS) {
    const layer = layers[name] as LayerHeader | undefined;
    if (layer === undefined) throw new Error(`map data: layer ${name} is not listed`);
    if (layer.type !== type) {
      throw new Error(`map data: layer ${name} has type ${layer.type}, expected ${type}`);
    }
    const source = buffers[layer.file];
    if (source === undefined) throw new Error(`map data: buffer ${layer.file} is missing`);
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const expected = count * (type === 'u8' ? 1 : 2);
    if (bytes.byteLength !== expected) {
      throw new Error(
        `map data: layer ${name} has ${bytes.byteLength} bytes, expected ${expected}`,
      );
    }
    decoded[name] = decodeLayer(bytes, type);
  }

  return {
    version: header.version,
    width,
    height,
    terrain: decoded.terrain as Uint8Array,
    hills: decoded.hills as Uint8Array,
    feature: decoded.feature as Uint8Array,
    elevation: decoded.elevation as Int16Array,
    owner: decoded.owner as Int16Array,
    zone: decoded.zone as Int16Array,
    riverEdges: decoded.riverEdges as Uint8Array,
    resource: decoded.resource as Int16Array,
    polities: header.polities,
    zones: header.zones,
    resources: header.resources,
    offMapPorts: header.offMapPorts,
    heightmap: header.heightmap,
    projection: header.projection,
  };
}
