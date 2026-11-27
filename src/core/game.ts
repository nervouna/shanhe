/**
 * The rules core. Pure functions on plain data: no DOM, no Three.js, so it
 * runs in Node for tests and simulations.
 */

import type { MapData } from '../shared/mapData.ts';

/** Everything that defines a game in progress. Treated as immutable. */
export interface GameState {
  /** The map the game is played on. Never modified by the rules. */
  readonly map: MapData;
  /** The current turn, starting at 1. */
  readonly turn: number;
}

/** The state of a new game on `map`, at turn 1. */
export function createGame(map: MapData): GameState {
  return { map, turn: 1 };
}

/** The state after the current turn ends. Does not modify `state`. */
export function advanceTurn(state: GameState): GameState {
  return { ...state, turn: state.turn + 1 };
}
