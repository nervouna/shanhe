/**
 * Procedural cities, as lists of simple parts: boxes, roofs, cylinders,
 * cones and domes with a place, a size and a colour. A city grows with its
 * population and its era (a few houses, a walled town, industrial works,
 * modern towers) and is built in the style of one of seven architectural
 * families. The same specification always gives the same city. No Three.js:
 * `partBatch.ts` draws the parts.
 */

/** The shapes a part can have. All are one unit wide, deep and high and stand on `y = 0`. */
export const PartShape = {
  Box: 0,
  /** A four-sided pyramid: a hipped roof. */
  Hip: 1,
  /** A triangular prism with its ridge along `x`: a gabled roof. */
  Gable: 2,
  Cylinder: 3,
  Cone: 4,
  /** A half sphere; make it taller or flatter through its height. */
  Dome: 5,
} as const;
export type PartShapeId = (typeof PartShape)[keyof typeof PartShape];
export const PART_SHAPE_COUNT = 6;

/** One block of a building. Lengths are fractions of the hex size, relative to the middle of the city. */
export interface Part {
  readonly shape: PartShapeId;
  /** Middle of the underside; `y` is the height above the ground under the part. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Width (along the part's own `x`), height and depth. */
  readonly w: number;
  readonly h: number;
  readonly d: number;
  /** Turn about the vertical axis, in radians. */
  readonly yaw: number;
  /** Colour as `0xRRGGBB`. */
  readonly color: number;
  /** How strongly the part glows by itself, 0 if omitted: lit windows, fire. */
  readonly glow?: number;
}

/** The seven architectural families. */
export const CityFamily = {
  /** Grey brick courtyards under grey tiles, on a north-south grid. */
  CentralPlains: 0,
  /** White walls and black tiles along a canal. */
  Jiangnan: 1,
  /** Whitewashed, tapering blocks with flat roofs and a dark red band. */
  Tibetan: 2,
  /** Felt yurts, loosely scattered. */
  Steppe: 3,
  /** Dark timber under broad grey-blue roofs. */
  Japanese: 4,
  /** Stilt houses with steep roofs, and gilded spires. */
  SoutheastAsian: 5,
  /** Log houses with steep roofs. */
  Siberian: 6,
} as const;
export type CityFamilyId = (typeof CityFamily)[keyof typeof CityFamily];
export const CITY_FAMILY_COUNT = 7;

const F = CityFamily;
/** The family each polity builds in, by the id of the polity. */
const FAMILY_OF: Readonly<Record<string, CityFamilyId>> = {
  wu: F.Jiangnan, yue: F.Jiangnan, min: F.Jiangnan, dongning: F.Jiangnan, lingnan: F.Jiangnan,
  luoyue: F.Jiangnan, qiongya: F.Jiangnan, yuzhang: F.Jiangnan, huainan: F.Jiangnan,
  xiangjiang: F.Jiangnan, haojing: F.Jiangnan, shen: F.Jiangnan,
  tubo: F.Tibetan, qingtang: F.Tibetan,
  mobei: F.Steppe, monan: F.Steppe, xiyu: F.Steppe,
  togoku: F.Japanese, yamato: F.Japanese, tsukushi: F.Japanese, ryukyu: F.Japanese, tsushima: F.Japanese,
  jiaozhi: F.SoutheastAsian, champa: F.SoutheastAsian, lanxang: F.SoutheastAsian, chenla: F.SoutheastAsian,
  siam: F.SoutheastAsian, pagan: F.SoutheastAsian, malacca: F.SoutheastAsian, srivijaya: F.SoutheastAsian,
  shepo: F.SoutheastAsian, boni: F.SoutheastAsian, luzon: F.SoutheastAsian, sulu: F.SoutheastAsian,
  maluku: F.SoutheastAsian, temasek: F.SoutheastAsian, wenlai: F.SoutheastAsian, dimen: F.SoutheastAsian,
  heishui: F.Siberian, beihai: F.Siberian, shuaibin: F.Siberian, ezo: F.Siberian, jiankun: F.Siberian, jibei: F.Siberian, liugui: F.Siberian,
};

/**
 * The architectural family of a polity's cities, for `RenderCity.family`.
 *
 * @param id the polity's id in the map's polity list (`yan`, `wu`, ...).
 * @returns its family; Central Plains for an id that is not in the table.
 */
export function familyOfPolity(id: string): CityFamilyId {
  return (Object.hasOwn(FAMILY_OF, id) ? FAMILY_OF[id] : undefined) ?? CityFamily.CentralPlains;
}

export interface CitySpec {
  /** Any integer; cities with different seeds differ in their layout. */
  readonly seed: number;
  readonly population: number;
  /** 0 (ancient) to 5 (modern). */
  readonly era: number;
  readonly family: CityFamilyId;
  readonly walls: boolean;
  /** How many buildings the city has built: each adds a public building or, late, a works. */
  readonly buildings: number;
  /** The owner's colour as `0xRRGGBB`: the roof of the hall in the middle. */
  readonly polityColor: number;
}

/** Most houses a city is drawn with. */
export const MAX_HOUSES = 34;

function hash(value: number): number {
  let h = Math.imul(value + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A deterministic sequence of numbers in 0..1 for a seed. */
export function randomFrom(seed: number): () => number {
  let state = hash(seed);
  return () => {
    state = hash(state);
    return state / 4294967296;
  };
}

interface Style {
  readonly walls: readonly number[];
  readonly roofs: readonly number[];
  readonly roofShape: PartShapeId;
  /** Height of the roof as a share of the walls' height, and how far it overhangs. */
  readonly roofRise: number;
  readonly overhang: number;
  /** How regular the street grid is: 1 a strict grid, 0 no order at all. */
  readonly order: number;
  /** Houses stand this much farther apart than in the densest style. */
  readonly sprawl: number;
  /** Colour of the town wall. */
  readonly rampart: number;
}

const STYLES: readonly Style[] = [
  { walls: [0xb8ad9a, 0xa89c88, 0xc4b8a4], roofs: [0x4b4a48, 0x56544f], roofShape: PartShape.Gable, roofRise: 0.55, overhang: 1.12, order: 1, sprawl: 1, rampart: 0x8d8676 },
  { walls: [0xeeeae0, 0xe4dfd2, 0xf4f1e8], roofs: [0x2b2b2e, 0x35353a], roofShape: PartShape.Gable, roofRise: 0.5, overhang: 1.1, order: 0.6, sprawl: 0.95, rampart: 0x9a958a },
  { walls: [0xf1ece0, 0xe7dcc6, 0xd9b98a], roofs: [0x6e2a22, 0x7a3128], roofShape: PartShape.Box, roofRise: 0.14, overhang: 1.06, order: 0.4, sprawl: 1.05, rampart: 0xcfc6b2 },
  { walls: [0xece7da, 0xe2dccb, 0xf3efe4], roofs: [0xd8d0bd, 0xcbc2ad], roofShape: PartShape.Cone, roofRise: 0.6, overhang: 1.04, order: 0, sprawl: 1.45, rampart: 0x7b6548 },
  { walls: [0x5a4636, 0x6b5442, 0xd9d2c0], roofs: [0x3d4650, 0x343c45], roofShape: PartShape.Hip, roofRise: 0.8, overhang: 1.3, order: 0.85, sprawl: 1, rampart: 0x8a8d8c },
  { walls: [0x8a6a45, 0x9a7850, 0x7a5c3c], roofs: [0x7a3b24, 0x8c4a2c, 0x6b5a34], roofShape: PartShape.Gable, roofRise: 1.25, overhang: 1.2, order: 0.3, sprawl: 1.15, rampart: 0x9c5a40 },
  { walls: [0x6b4a2e, 0x7a5636, 0x5c3f27], roofs: [0x39424a, 0x4a4038], roofShape: PartShape.Gable, roofRise: 0.95, overhang: 1.1, order: 0.5, sprawl: 1.3, rampart: 0x5c452e },
];

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

/** One house of a family, standing on (`x`, `z`). */
function house(parts: Part[], family: CityFamilyId, style: Style, x: number, z: number, w: number, d: number, h: number, yaw: number, random: () => number, roof?: number): void {
  const wall = pick(style.walls, random);
  const roofColor = roof ?? pick(style.roofs, random);
  let base = 0;
  if (family === CityFamily.SoutheastAsian) {
    // on stilts: a narrow dark block under the floor
    base = h * 0.45;
    parts.push({ shape: PartShape.Box, x, y: 0, z, w: w * 0.7, h: base, d: d * 0.7, yaw, color: 0x3c2e22 });
  }
  if (family === CityFamily.Steppe) {
    const r = Math.max(w, d);
    parts.push({ shape: PartShape.Cylinder, x, y: 0, z, w: r, h: h * 0.62, d: r, yaw, color: wall });
    parts.push({ shape: PartShape.Cone, x, y: h * 0.62, z, w: r * style.overhang, h: h * 0.5, d: r * style.overhang, yaw, color: roofColor });
    return;
  }
  parts.push({ shape: PartShape.Box, x, y: base, z, w, h, d, yaw, color: wall });
  parts.push({
    shape: style.roofShape,
    x,
    y: base + h,
    z,
    w: w * style.overhang,
    h: h * style.roofRise,
    d: d * style.overhang,
    yaw,
    color: roofColor,
  });
}

/** A public building in the family's style: what the `buildings` of a city add. */
function monument(parts: Part[], family: CityFamilyId, x: number, z: number, s: number, yaw: number): void {
  switch (family) {
    case CityFamily.CentralPlains:
    case CityFamily.Jiangnan:
    case CityFamily.Japanese: {
      // a pagoda: storeys of shrinking size, each under its own roof
      const dark = family === CityFamily.Japanese;
      let y = 0;
      for (let tier = 0; tier < 3; tier++) {
        const w = s * (1 - tier * 0.22);
        parts.push({ shape: PartShape.Box, x, y, z, w: w * 0.7, h: s * 0.5, d: w * 0.7, yaw, color: dark ? 0x7a2a22 : 0xb5463a });
        y += s * 0.5;
        parts.push({ shape: PartShape.Hip, x, y, z, w: w * 1.25, h: s * 0.3, d: w * 1.25, yaw, color: dark ? 0x343c45 : 0x4b4a48 });
        y += s * 0.14;
      }
      break;
    }
    case CityFamily.Tibetan: {
      // a chorten: a white dome on steps under a gilded spire
      parts.push({ shape: PartShape.Box, x, y: 0, z, w: s, h: s * 0.3, d: s, yaw, color: 0xf1ece0 });
      parts.push({ shape: PartShape.Dome, x, y: s * 0.3, z, w: s * 0.8, h: s * 0.5, d: s * 0.8, yaw, color: 0xf6f2e8 });
      parts.push({ shape: PartShape.Cone, x, y: s * 0.75, z, w: s * 0.22, h: s * 0.7, d: s * 0.22, yaw, color: 0xd9a93a });
      break;
    }
    case CityFamily.Steppe: {
      // the khan's great tent, with a banner pole
      parts.push({ shape: PartShape.Cylinder, x, y: 0, z, w: s * 1.5, h: s * 0.5, d: s * 1.5, yaw, color: 0xf3efe4 });
      parts.push({ shape: PartShape.Cone, x, y: s * 0.5, z, w: s * 1.6, h: s * 0.5, d: s * 1.6, yaw, color: 0xc9a44a });
      parts.push({ shape: PartShape.Cylinder, x: x + s, y: 0, z, w: s * 0.06, h: s * 1.6, d: s * 0.06, yaw, color: 0x4a3a2a });
      break;
    }
    case CityFamily.SoutheastAsian: {
      // a gilded stupa on a square base
      parts.push({ shape: PartShape.Box, x, y: 0, z, w: s, h: s * 0.25, d: s, yaw, color: 0xe6dcc0 });
      parts.push({ shape: PartShape.Dome, x, y: s * 0.25, z, w: s * 0.75, h: s * 0.45, d: s * 0.75, yaw, color: 0xe0b23c });
      parts.push({ shape: PartShape.Cone, x, y: s * 0.6, z, w: s * 0.3, h: s * 1.1, d: s * 0.3, yaw, color: 0xe8bf4a });
      break;
    }
    default: {
      // a wooden church: a nave, a tower and an onion dome
      parts.push({ shape: PartShape.Box, x, y: 0, z, w: s, h: s * 0.55, d: s * 0.6, yaw, color: 0x6b4a2e });
      parts.push({ shape: PartShape.Gable, x, y: s * 0.55, z, w: s * 1.08, h: s * 0.45, d: s * 0.68, yaw, color: 0x39424a });
      parts.push({ shape: PartShape.Box, x, y: 0, z, w: s * 0.36, h: s * 1.1, d: s * 0.36, yaw, color: 0x7a5636 });
      parts.push({ shape: PartShape.Dome, x, y: s * 1.1, z, w: s * 0.42, h: s * 0.3, d: s * 0.42, yaw, color: 0x3f6a8a });
      parts.push({ shape: PartShape.Cone, x, y: s * 1.32, z, w: s * 0.14, h: s * 0.3, d: s * 0.14, yaw, color: 0xd9a93a });
    }
  }
}

/** Radius of the built-up area of a city, as a fraction of the hex size. */
export function cityRadius(population: number, family: CityFamilyId): number {
  const sprawl = (STYLES[family] as Style).sprawl;
  return Math.min(0.62, (0.17 + 0.075 * Math.sqrt(Math.max(1, population))) * Math.sqrt(sprawl));
}

/** Number of houses of a city. */
export function houseCount(population: number, era: number): number {
  return Math.min(MAX_HOUSES, Math.round(3 + Math.max(1, population) * 1.5 + era * 1.2));
}

/**
 * The parts of a city.
 *
 * - Houses fill a disc that grows with the population; later eras add a few.
 * - The hall in the middle carries the owner's colour.
 * - With `walls` a rampart with four gates surrounds the town.
 * - Every third of the `buildings` is a public building in the family's style.
 * - From the industrial era on, works with chimneys stand at the edge; in
 *   the modern era towers rise in the middle, with lit windows.
 */
export function generateCity(spec: CitySpec): Part[] {
  const parts: Part[] = [];
  const random = randomFrom(spec.seed);
  const style = STYLES[spec.family] ?? (STYLES[0] as Style);
  const family = spec.family;
  const population = Math.max(1, spec.population);
  const era = Math.min(5, Math.max(0, Math.round(spec.era)));
  const radius = cityRadius(population, family);
  const count = houseCount(population, era);
  // a strict grid looks north; a loose one anywhere
  const grid = (1 - style.order) * random() * Math.PI;
  const modern = era >= 5;

  // Jiangnan towns lie along a canal
  if (family === CityFamily.Jiangnan) {
    parts.push({ shape: PartShape.Box, x: 0, y: 0.002, z: radius * 0.22, w: radius * 2.1, h: 0.004, d: 0.035, yaw: -grid, color: 0x3f8fa8 });
  }

  for (let i = 0; i < count; i++) {
    // a sunflower spiral fills the disc evenly; the first house is the hall in the middle
    const r = radius * Math.sqrt(i / count);
    const a = i * 2.39996 + grid;
    let x = Math.cos(a) * r;
    let z = Math.sin(a) * r;
    if (style.order > 0.5 && i > 0) {
      // pulled onto the nearest street of the grid
      const cell = 0.085 * style.sprawl;
      const gx = Math.cos(grid) * x + Math.sin(grid) * z;
      const gz = -Math.sin(grid) * x + Math.cos(grid) * z;
      const sx = gx + (Math.round(gx / cell) * cell - gx) * style.order * 0.8;
      const sz = gz + (Math.round(gz / cell) * cell - gz) * style.order * 0.8;
      x = Math.cos(grid) * sx - Math.sin(grid) * sz;
      z = Math.sin(grid) * sx + Math.cos(grid) * sz;
    }
    const inner = 1 - r / radius;
    const big = i === 0 ? 1.5 : 1;
    const w = (0.07 + 0.045 * random()) * big;
    const d = (0.055 + 0.035 * random()) * big;
    let h = (0.04 + 0.014 * Math.sqrt(population) * inner + 0.022 * random()) * (i === 0 ? 1.5 : 1);
    if (family === CityFamily.Tibetan) h *= 1.5;
    // a house stays well below a piece, whatever the population
    h = Math.min(h, 0.11);
    const yaw = style.order > 0 ? -grid + (random() < 0.5 ? 0 : Math.PI / 2) : random() * Math.PI;
    if (modern && i > 0 && inner > 0.55 && random() < 0.75) {
      // the middle of a modern city: towers of glass and concrete
      const tall = 0.2 + 0.32 * inner * random() + 0.012 * Math.sqrt(population);
      const glass = pick([0x8fa9bd, 0xa9b9c4, 0x6f8ea6, 0xd0d4d6], random);
      parts.push({ shape: PartShape.Box, x, y: 0, z, w: w * 0.9, h: tall, d: w * 0.9, yaw, color: glass, glow: 0.35 });
      parts.push({ shape: PartShape.Box, x, y: tall, z, w: w * 0.5, h: 0.015, d: w * 0.5, yaw, color: 0x5a6068 });
      continue;
    }
    if (era >= 4 && i > 0 && random() < 0.3) {
      // brick terraces of the industrial town
      parts.push({ shape: PartShape.Box, x, y: 0, z, w: w * 1.3, h: h * 1.4, d, yaw, color: modern ? 0xc9c4b8 : 0x8a4f3c });
      parts.push({ shape: PartShape.Gable, x, y: h * 1.4, z, w: w * 1.34, h: h * 0.4, d: d * 1.05, yaw, color: 0x45433f });
      continue;
    }
    house(parts, family, style, x, z, w, d, h, yaw, random, i === 0 ? spec.polityColor : undefined);
  }

  // public buildings, around the hall
  const monuments = Math.min(4, Math.floor(spec.buildings / 3));
  for (let m = 0; m < monuments; m++) {
    const a = grid + (m / Math.max(1, monuments)) * Math.PI * 2 + 0.6;
    const r = radius * 0.42;
    monument(parts, family, Math.cos(a) * r, Math.sin(a) * r, 0.095 + 0.012 * m, -grid);
  }

  if (spec.walls) {
    const reach = radius * 1.12;
    const height = 0.05 + (era >= 2 ? 0.012 : 0);
    const round = style.order < 0.5;
    const segments = round ? 16 : 4;
    for (let s = 0; s < segments; s++) {
      const a = grid + ((s + 0.5) / segments) * Math.PI * 2;
      const length = round ? 2 * reach * Math.tan(Math.PI / segments) : 2 * reach;
      // a square wall stands `reach` from the middle on each side; its gate is a gap in the middle
      const pieces = round ? 1 : 2;
      for (let p = 0; p < pieces; p++) {
        const along = round ? 0 : (p === 0 ? -1 : 1) * (length * 0.27);
        const pieceLength = round ? length * 1.04 : length * 0.46;
        parts.push({
          shape: PartShape.Box,
          x: Math.cos(a) * reach - Math.sin(a) * along,
          y: 0,
          z: Math.sin(a) * reach + Math.cos(a) * along,
          w: pieceLength,
          h: height,
          d: 0.022,
          yaw: -(a + Math.PI / 2),
          color: style.rampart,
        });
      }
      if (!round) {
        // the gate tower over the gap, and a tower on the corner
        const gx = Math.cos(a) * reach;
        const gz = Math.sin(a) * reach;
        parts.push({ shape: PartShape.Box, x: gx, y: 0, z: gz, w: 0.07, h: height * 1.5, d: 0.04, yaw: -(a + Math.PI / 2), color: style.rampart });
        parts.push({ shape: PartShape.Hip, x: gx, y: height * 1.5, z: gz, w: 0.09, h: 0.03, d: 0.055, yaw: -(a + Math.PI / 2), color: pick(style.roofs, random) });
        const ca = a + Math.PI / 4;
        const corner = reach * Math.SQRT2;
        parts.push({ shape: PartShape.Box, x: Math.cos(ca) * corner, y: 0, z: Math.sin(ca) * corner, w: 0.036, h: height * 1.3, d: 0.036, yaw: -(a + Math.PI / 2), color: style.rampart });
      }
    }
  }

  if (era >= 4) {
    // works at the edge of town: sheds and chimneys
    const works = Math.min(3, 1 + Math.floor(spec.buildings / 4) + (modern ? 1 : 0));
    for (let k = 0; k < works; k++) {
      const a = grid + 2.2 + k * 1.35;
      const r = radius * (spec.walls ? 1.42 : 1.2);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const yaw = -a;
      parts.push({ shape: PartShape.Box, x, y: 0, z, w: 0.17, h: 0.05, d: 0.085, yaw, color: modern ? 0xb9bcc0 : 0x7d4a3a });
      parts.push({ shape: PartShape.Gable, x, y: 0.05, z, w: 0.175, h: 0.022, d: 0.09, yaw, color: 0x4f4c48 });
      const chimneys = modern ? 1 : 2;
      for (let c = 0; c < chimneys; c++) {
        const off = (c - (chimneys - 1) / 2) * 0.07;
        parts.push({
          shape: PartShape.Cylinder,
          x: x + Math.cos(-yaw) * off - Math.sin(-yaw) * 0.06,
          y: 0,
          z: z + Math.sin(-yaw) * off + Math.cos(-yaw) * 0.06,
          w: modern ? 0.03 : 0.024,
          h: modern ? 0.2 : 0.16,
          d: modern ? 0.03 : 0.024,
          yaw: 0,
          color: modern ? 0xd8d8d6 : 0x6a3d30,
        });
      }
    }
  }
  return parts;
}

/** The height of the tallest part, for placing the city's label over it. */
export function partsHeight(parts: readonly Part[]): number {
  let top = 0;
  for (const part of parts) top = Math.max(top, part.y + part.h);
  return top;
}
