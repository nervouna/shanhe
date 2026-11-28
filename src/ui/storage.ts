/** The autosave in `localStorage`, one per map. Reading it goes through the same validation as an imported file. */

import type { GameState } from '../core/game.ts';
import type { MapData } from '../shared/mapData.ts';
import { decodeMemory, encodeMemory } from './board.ts';
import type { BoardMemory } from './board.ts';
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
    window.localStorage.removeItem(memoryKey(source));
  } catch {
    // nothing to clear
  }
}

function memoryKey(source: MapSource): string {
  return `shanhe.memory.${source}`;
}

/** The game and turn a stored memory belongs to. */
function stampOf(state: GameState): string {
  return `${state.seed}:${state.player}:${state.turn}`;
}

/**
 * Stores what the player remembers of the board next to the autosave. The
 * save itself holds only which hexes were seen, not what stood on them.
 */
export function writeMemory(source: MapSource, state: GameState, memory: BoardMemory): void {
  try {
    window.localStorage.setItem(memoryKey(source), JSON.stringify({ stamp: stampOf(state), memory: encodeMemory(memory) }));
  } catch {
    // the game goes on without it
  }
}

/** The stored memory if it was written for this game on this turn and passes validation, or null. */
export function readMemory(source: MapSource, state: GameState): BoardMemory | null {
  try {
    const text = window.localStorage.getItem(memoryKey(source));
    if (text === null) return null;
    const data = JSON.parse(text) as { stamp?: unknown; memory?: unknown } | null;
    if (typeof data !== 'object' || data === null || data.stamp !== stampOf(state)) return null;
    return decodeMemory(data.memory, state.map);
  } catch {
    return null;
  }
}
