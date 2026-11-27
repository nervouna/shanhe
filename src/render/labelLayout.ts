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
