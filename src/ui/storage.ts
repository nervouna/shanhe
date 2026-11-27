/** The autosave in `localStorage`, one per map. Reading it goes through the same validation as an imported file. */

import type { GameState } from '../core/game.ts';
import type { MapData } from '../shared/mapData.ts';
import { exportSave, importSave } from './saves.ts';

/** `file` for the generated map, `fixture` for the built-in one. */
export type MapSource = 'file' | 'fixture';

function key(source: MapSource): string {
  return `shanhe.autosave.${source}`;
}

/** Stores the game. Storage can be blocked or full; the game then simply has no autosave. */
export function writeAutosave(source: MapSource, state: GameState): void {
  try {
    window.localStorage.setItem(key(source), exportSave(state));
  } catch {
    // no autosave this turn
  }
}

/** The stored game for this map, or null if there is none or it does not pass validation. */
export function readAutosave(source: MapSource, map: MapData): GameState | null {
  try {
    const text = window.localStorage.getItem(key(source));
    if (text === null) return null;
    const result = importSave(text, map);
    return result.ok ? result.state : null;
  } catch {
    return null;
  }
}

export function clearAutosave(source: MapSource): void {
  try {
    window.localStorage.removeItem(key(source));
  } catch {
    // nothing to clear
  }
}
