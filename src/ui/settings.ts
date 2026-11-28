/**
 * The player's settings and where they are kept. The interface size and the
 * language keep the storage keys they had before there was a settings
 * panel; the rest is one JSON value. Stored text is data: anything that is
 * not a known value falls back to the default.
 */

import { DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n.ts';
import type { Language } from '../shared/i18n.ts';
import { DEFAULT_SCALE_SETTING, isScaleSetting } from './scale.ts';
import type { ScaleSetting } from './scale.ts';

/** The renderer's quality tiers, in the order the menu shows them. */
export const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
export type QualityOption = (typeof QUALITY_OPTIONS)[number];

/** What the board's animations are multiplied by. */
export const ANIMATION_SPEEDS = [0.5, 1, 2, 4] as const;
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number];

/** The master volume moves in these steps, from 0 to 1. */
export const VOLUME_STEP = 0.05;

export interface Settings {
  readonly quality: QualityOption;
  readonly scale: ScaleSetting;
  readonly language: Language;
  readonly animationSpeed: AnimationSpeed;
  /** Master volume of the sound, from 0 to 1. */
  readonly volume: number;
  readonly muted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  scale: DEFAULT_SCALE_SETTING,
  language: DEFAULT_LANGUAGE,
  animationSpeed: 1,
  volume: 0.6,
  muted: false,
};

/** The part of `Storage` the settings need. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEYS = { scale: 'shanhe.uiScale', language: 'shanhe.language', rest: 'shanhe.settings' } as const;

function isQuality(value: unknown): value is QualityOption {
  return (QUALITY_OPTIONS as readonly unknown[]).includes(value);
}

function isSpeed(value: unknown): value is AnimationSpeed {
  return (ANIMATION_SPEEDS as readonly unknown[]).includes(value);
}

/** A volume within 0 to 1 on the steps of the slider, or null for anything that is not a number. */
export function normaliseVolume(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const stepped = Math.round(Math.max(0, Math.min(1, value)) / VOLUME_STEP) * VOLUME_STEP;
  return Math.round(stepped * 100) / 100;
}

/** The settings in the JSON value: the known fields with valid values, nothing else. */
export function parseStored(text: string | null): Partial<Pick<Settings, 'quality' | 'animationSpeed' | 'volume' | 'muted'>> {
  if (text === null) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const fields = data as Record<string, unknown>;
  const volume = Object.hasOwn(fields, 'volume') ? normaliseVolume(fields.volume) : null;
  return {
    ...(Object.hasOwn(fields, 'quality') && isQuality(fields.quality) ? { quality: fields.quality } : {}),
    ...(Object.hasOwn(fields, 'animationSpeed') && isSpeed(fields.animationSpeed) ? { animationSpeed: fields.animationSpeed } : {}),
    ...(volume === null ? {} : { volume }),
    ...(Object.hasOwn(fields, 'muted') && typeof fields.muted === 'boolean' ? { muted: fields.muted } : {}),
  };
}

export interface SettingsStore {
  /** The settings in force. */
  readonly current: Settings;
  /** Changes some settings and stores them. Invalid values are ignored. Returns the settings in force. */
  set(change: Partial<Settings>): Settings;
}

/**
 * The settings, read from `storage` once and written back on every change.
 *
 * @param storage `window.localStorage`, or null where there is none. Storage that throws (blocked, full) is
 *   treated as absent: the settings then last for the visit.
 */
export function createSettingsStore(storage: SettingsStorage | null): SettingsStore {
  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string): void => {
    try {
      storage?.setItem(key, value);
    } catch {
      // the choice lasts for this visit only
    }
  };

  const scale = read(SETTINGS_KEYS.scale);
  const language = read(SETTINGS_KEYS.language);
  let current: Settings = {
    ...DEFAULT_SETTINGS,
    ...parseStored(read(SETTINGS_KEYS.rest)),
    ...(isScaleSetting(scale) ? { scale } : {}),
    ...(isLanguage(language) ? { language } : {}),
  };

  return {
    get current() {
      return current;
    },
    set(change) {
      const volume = change.volume === undefined ? null : normaliseVolume(change.volume);
      const next: Settings = {
        quality: isQuality(change.quality) ? change.quality : current.quality,
        scale: isScaleSetting(change.scale) ? change.scale : current.scale,
        language: isLanguage(change.language) ? change.language : current.language,
        animationSpeed: isSpeed(change.animationSpeed) ? change.animationSpeed : current.animationSpeed,
        volume: volume ?? current.volume,
        muted: typeof change.muted === 'boolean' ? change.muted : current.muted,
      };
      if (next.scale !== current.scale) write(SETTINGS_KEYS.scale, next.scale);
      if (next.language !== current.language) write(SETTINGS_KEYS.language, next.language);
      if (
        next.quality !== current.quality ||
        next.animationSpeed !== current.animationSpeed ||
        next.volume !== current.volume ||
        next.muted !== current.muted
      ) {
        write(
          SETTINGS_KEYS.rest,
          JSON.stringify({ quality: next.quality, animationSpeed: next.animationSpeed, volume: next.volume, muted: next.muted }),
        );
      }
      current = next;
      return current;
    },
  };
}

/** `window.localStorage`, or null where reading it throws. */
export function browserStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
