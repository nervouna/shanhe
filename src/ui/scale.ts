/**
 * The size of the interface. The HUD is laid out for a 1280 × 720 window;
 * `auto` scales it with the window, the other settings hold a fixed size.
 */

export const SCALE_SETTINGS = ['auto', 'small', 'normal', 'large'] as const;
export type ScaleSetting = (typeof SCALE_SETTINGS)[number];

export const DEFAULT_SCALE_SETTING: ScaleSetting = 'auto';

/** The window the layout is drawn for at scale 1. */
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;
/** `auto` stays within these: below, text is too small to read; above, panels crowd the map. */
const MIN_AUTO = 0.8;
const MAX_AUTO = 2;
const STEP = 0.05;

const FIXED: Readonly<Record<Exclude<ScaleSetting, 'auto'>, number>> = { small: 0.85, normal: 1, large: 1.3 };

export function isScaleSetting(value: unknown): value is ScaleSetting {
  return (SCALE_SETTINGS as readonly unknown[]).includes(value);
}

/**
 * The factor everything in the interface is multiplied by.
 *
 * @param width inner width of the window in CSS pixels.
 * @param height inner height of the window in CSS pixels.
 */
export function uiScale(setting: ScaleSetting, width: number, height: number): number {
  if (setting !== 'auto') return FIXED[setting];
  if (!(width > 0) || !(height > 0)) return 1;
  const fit = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  const stepped = Math.round(Math.max(MIN_AUTO, Math.min(MAX_AUTO, fit)) / STEP) * STEP;
  return Math.round(stepped * 100) / 100;
}

const STORAGE_KEY = 'shanhe.uiScale';

/** The stored setting, or the default if none is stored or storage is unavailable. */
export function loadScaleSetting(): ScaleSetting {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isScaleSetting(stored) ? stored : DEFAULT_SCALE_SETTING;
  } catch {
    return DEFAULT_SCALE_SETTING;
  }
}

export function saveScaleSetting(setting: ScaleSetting): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // storage can be blocked; the choice then lasts for this visit only
  }
}
