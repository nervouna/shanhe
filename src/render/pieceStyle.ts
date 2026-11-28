/**
 * The colours of a unit piece and the layout of its top face, as plain
 * numbers: what the shader in `pieces.ts` draws and what the tests check for
 * contrast. No Three.js.
 */

/** A piece's material: body colour, roughness, metalness, and the colour its character is engraved in. */
export interface EraMaterial {
  readonly body: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly ink: number;
}

/** One material per era, in the order of `PieceEra`. */
export const ERA_MATERIALS: readonly EraMaterial[] = [
  { body: 0xb9875a, roughness: 0.85, metalness: 0.0, ink: 0x22140c }, // pottery and wood
  { body: 0xba8d47, roughness: 0.42, metalness: 0.6, ink: 0x10170f }, // bronze
  { body: 0x5e1014, roughness: 0.18, metalness: 0.0, ink: 0xe9dcc0 }, // lacquer
  { body: 0x7fbf9d, roughness: 0.22, metalness: 0.0, ink: 0x173024 }, // jade
  { body: 0xd0aa4e, roughness: 0.3, metalness: 0.65, ink: 0x2b2010 }, // brass
  { body: 0x8f99a3, roughness: 0.36, metalness: 0.55, ink: 0x11151a }, // steel
];

/** The grain of a material darkens and brightens its body between these factors. */
export const GRAIN_DARKEST = 0.86;
export const GRAIN_BRIGHTEST = 1.08;

/** The character of a unique unit: gold, inlaid in a field of dark lacquer so that it reads on every material. */
export const GOLD = 0xf0bf45;
export const GOLD_FIELD = 0x1b1410;

/** The lines that set the owner's ring off against the material inside it and the ground outside it. */
export const KEYLINE_DARK = 0x14110e;
export const KEYLINE_PALE = 0xf4ecd8;
/** A ring darker than this (relative luminance) gets the pale lines, a brighter one the dark lines. */
export const KEYLINE_SWITCH = 0.18;

/**
 * The top face from the middle outwards, as fractions of the piece's
 * radius: the character in its square, a line, the owner's ring, a line,
 * and the ring of hit-point ticks on the rim. From far away, where a piece
 * is a marker, the ring takes the room of the ticks.
 */
export const FACE = {
  /** Half the side of the square the character is drawn in. */
  glyphHalf: 0.45,
  /** Inner edge of the inner line: the field of a gold character ends here. */
  fieldEdge: 0.615,
  ringInner: 0.645,
  /** Outer edge of the owner's ring, near and as a marker. */
  ringOuter: 0.8,
  ringOuterMarker: 0.85,
  /** Width of the line outside the ring, near and as a marker. */
  outerLine: 0.018,
  outerLineMarker: 0.05,
  ticksInner: 0.83,
  ticksOuter: 0.93,
} as const;

/** The side band in the owner's colour, as fractions of the piece's height. */
export const BAND_FROM = 0.14;
export const BAND_TO = 0.86;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of an sRGB colour `0xRRGGBB`, as WCAG defines it. */
export function luminance(color: number): number {
  return 0.2126 * channel((color >> 16) & 255) + 0.7152 * channel((color >> 8) & 255) + 0.0722 * channel(color & 255);
}

/** WCAG contrast ratio of two relative luminances, 1 to 21. */
export function contrastOf(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG contrast ratio of two sRGB colours. */
export function contrast(a: number, b: number): number {
  return contrastOf(luminance(a), luminance(b));
}

/**
 * The least contrast between a character and what it is engraved in.
 *
 * @param era index into {@link ERA_MATERIALS}.
 * @param unique whether the character is the gold one of a unique unit.
 */
export function glyphContrast(era: number, unique: boolean): number {
  if (unique) return contrast(GOLD, GOLD_FIELD);
  const material = ERA_MATERIALS[era] as EraMaterial;
  const body = luminance(material.body);
  const ink = luminance(material.ink);
  // the grain scales the linear colour, and with it the luminance
  return Math.min(contrastOf(body * GRAIN_DARKEST, ink), contrastOf(body * GRAIN_BRIGHTEST, ink));
}

/** The colour of the lines beside an owner's ring of colour `ring`. */
export function keylineFor(ring: number): number {
  return luminance(ring) < KEYLINE_SWITCH ? KEYLINE_PALE : KEYLINE_DARK;
}
