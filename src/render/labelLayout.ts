/**
 * Which labels are shown: priorities, the thinning of city labels with
 * distance, and the rule that no two labels overlap. Pure geometry on screen
 * rectangles, no Three.js.
 */

/** A label's rectangle on screen, in CSS pixels, and how much it matters. */
export interface LabelBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** The higher value wins where two labels would overlap. */
  readonly priority: number;
}

/**
 * Decides which labels are shown so that no two shown labels overlap: of two
 * overlapping labels the one with the lower priority hides. Between equal
 * priorities the earlier one in the list wins.
 *
 * @param padding free space kept around every shown label, in pixels.
 * @returns per label, whether it is shown.
 */
export function declutter(boxes: readonly LabelBox[], padding = 3): boolean[] {
  const order = boxes.map((_, i) => i).sort((a, b) => {
    const byPriority = (boxes[b] as LabelBox).priority - (boxes[a] as LabelBox).priority;
    return byPriority !== 0 ? byPriority : a - b;
  });
  const shown: boolean[] = new Array<boolean>(boxes.length).fill(false);
  const kept: LabelBox[] = [];
  for (const i of order) {
    const box = boxes[i] as LabelBox;
    if (!(box.maxX > box.minX) || !(box.maxY > box.minY)) continue;
    let free = true;
    for (const other of kept) {
      if (
        box.minX < other.maxX + padding &&
        box.maxX > other.minX - padding &&
        box.minY < other.maxY + padding &&
        box.maxY > other.minY - padding
      ) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    shown[i] = true;
    kept.push(box);
  }
  return shown;
}

/** How far out a city's label stays. */
export const CityTier = {
  /** Shown only near. */
  Town: 0,
  /** A large city: shown up to the middle distances. */
  Large: 1,
  /** A capital: shown until the political names take over. */
  Capital: 2,
} as const;
export type CityTierId = (typeof CityTier)[keyof typeof CityTier];

/** Population from which a city counts as large. */
export const LARGE_CITY_POPULATION = 8;

/** Zoom fraction (0 nearest, 1 farthest) up to which every city is labelled. */
export const TOWN_LABEL_ZOOM = 0.5;
/** Zoom fraction up to which large cities are labelled. */
export const LARGE_LABEL_ZOOM = 0.64;

export function cityTier(capital: boolean, population: number): CityTierId {
  if (capital) return CityTier.Capital;
  return population >= LARGE_CITY_POPULATION ? CityTier.Large : CityTier.Town;
}

/**
 * Whether a city of a tier is labelled at a zoom: capitals stay longest,
 * then large cities, and none once the political names are shown.
 *
 * @param zoom zoom fraction, 0 nearest and 1 farthest.
 * @param politicalNames whether the political map shows its names.
 */
export function cityLabelShown(tier: CityTierId, zoom: number, politicalNames: boolean): boolean {
  if (politicalNames) return false;
  if (tier === CityTier.Capital) return true;
  return zoom <= (tier === CityTier.Large ? LARGE_LABEL_ZOOM : TOWN_LABEL_ZOOM);
}

/** Priority bands: a higher band always beats a lower one. */
export const PRIORITY_MARKER = 3000;
export const PRIORITY_POLITICAL = 2000;

/** Priority of a city label: capitals above the rest, then by population. */
export function cityLabelPriority(tier: CityTierId, population: number): number {
  return tier * 200 + Math.min(Math.max(population, 0), 199);
}

/** A rectangle on screen, in CSS pixels. */
export interface ScreenRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** Where a city's label may sit relative to the city, in the order in which the places are tried. */
export const LABEL_SIDES = ['below', 'right', 'left', 'above'] as const;
export type LabelSide = (typeof LABEL_SIDES)[number];

/** The rectangle of a label of a size on one side of what it names, `gap` pixels off it. */
export function labelRectAt(around: ScreenRect, width: number, height: number, side: LabelSide, gap: number): ScreenRect {
  const midX = (around.minX + around.maxX) / 2;
  const midY = (around.minY + around.maxY) / 2;
  switch (side) {
    case 'below':
      return { minX: midX - width / 2, maxX: midX + width / 2, minY: around.maxY + gap, maxY: around.maxY + gap + height };
    case 'right':
      return { minX: around.maxX + gap, maxX: around.maxX + gap + width, minY: midY - height / 2, maxY: midY + height / 2 };
    case 'left':
      return { minX: around.minX - gap - width, maxX: around.minX - gap, minY: midY - height / 2, maxY: midY + height / 2 };
    case 'above':
      return { minX: midX - width / 2, maxX: midX + width / 2, minY: around.minY - gap - height, maxY: around.minY - gap };
  }
}

/**
 * Finds the place of a city's label: below the city and its garrison, else
 * beside them, else above, never on them and never on the character of any
 * piece. Where every place would cover a character the city goes without a
 * label.
 *
 * @param around what the label names, on screen: the city together with the piece before its gate.
 * @param characters the squares that hold the characters of the pieces in view.
 * @returns the label's rectangle and its side, or `null`.
 */
export function placeCityLabel(
  around: ScreenRect,
  width: number,
  height: number,
  characters: readonly ScreenRect[],
  gap = 3,
): { readonly rect: ScreenRect; readonly side: LabelSide } | null {
  for (const side of LABEL_SIDES) {
    const rect = labelRectAt(around, width, height, side, gap);
    let free = true;
    for (const character of characters) {
      if (rectsOverlap(rect, character)) {
        free = false;
        break;
      }
    }
    if (free) return { rect, side };
  }
  return null;
}

/** A world point on screen, in CSS pixels, with its distance in front of the camera; `null` behind the camera. */
export type ProjectPoint = (x: number, y: number, z: number) => { readonly x: number; readonly y: number; readonly depth: number } | null;

/** The share of a piece's radius within which its character lies, with a little air: the label keeps off this square. */
export const CHARACTER_REACH = 0.52;

/**
 * The square on screen that holds the character of a piece.
 *
 * @param top the middle of the piece's top face and its radius as drawn, in world units.
 * @param pixelsPerUnit CSS pixels per world unit at distance 1 from the camera.
 */
export function characterRect(
  project: ProjectPoint,
  pixelsPerUnit: number,
  top: { readonly x: number; readonly y: number; readonly z: number; readonly radius: number },
): ScreenRect | null {
  const at = project(top.x, top.y, top.z);
  if (at === null) return null;
  // the face lies flat and is seen at an angle: its square on screen is at most this large
  const half = (top.radius * CHARACTER_REACH * pixelsPerUnit) / at.depth;
  return { minX: at.x - half, maxX: at.x + half, minY: at.y - half, maxY: at.y + half };
}

/**
 * The rectangle on screen around a disc that lies on the ground or floats
 * level, and around a point above its middle: a city with its tallest
 * roof, or a piece.
 *
 * @param height of the point above the disc; 0 for a flat disc.
 */
export function discRect(
  project: ProjectPoint,
  disc: { readonly x: number; readonly y: number; readonly z: number; readonly radius: number; /** Its radius from north to south, if that differs. */ readonly radiusZ?: number },
  height = 0,
): ScreenRect | null {
  const radiusZ = disc.radiusZ ?? disc.radius;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number, z: number): boolean => {
    const at = project(x, y, z);
    if (at === null) return false;
    minX = Math.min(minX, at.x);
    maxX = Math.max(maxX, at.x);
    minY = Math.min(minY, at.y);
    maxY = Math.max(maxY, at.y);
    return true;
  };
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI * 2;
    if (!take(disc.x + Math.cos(angle) * disc.radius, disc.y, disc.z + Math.sin(angle) * radiusZ)) return null;
  }
  if (height > 0 && !take(disc.x, disc.y + height, disc.z)) return null;
  return { minX, minY, maxX, maxY };
}

/** The smallest rectangle around two. */
export function unionRect(a: ScreenRect, b: ScreenRect | null): ScreenRect {
  if (b === null) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
