/**
 * Remembers the player's language in `localStorage`. This is the only place
 * in the project that touches `localStorage` for the language.
 */

import { DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n.ts';
import type { Language } from '../shared/i18n.ts';

const STORAGE_KEY = 'shanhe.language';

/** The stored language, or the default if none is stored or storage is unavailable. */
export function loadLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function saveLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // storage can be blocked; the choice then lasts for this visit only
  }
}
