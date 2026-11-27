/** Helpers for the rules tests: editing a state directly and finding hexes on a map. */

import { hexNeighbors, indexToOffset } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import { cloneState } from './context.ts';
import { unitDef } from './data.ts';
import { applyAction } from './game.ts';
import { topologyOf } from './topology.ts';
import type { Action, GameEvent, GameState, MutableGameState, Unit } from './types.ts';

/** A copy of `state` after `change` has edited it by hand. */
export function edit(state: GameState, change: (draft: MutableGameState) => void): GameState {
  const draft = cloneState(state);
  change(draft);
  return draft;
}

/** Adds a fresh unit to a draft state. */
export function put(draft: MutableGameState, type: string, owner: number, hex: number, extra: Partial<Unit> = {}): Unit {
  const unit: Unit = {
    id: draft.nextUnitId++,
    type,
    owner,
    hex,
    hp: 100,
    moves: unitDef(type).moves,
    xp: 0,
    level: 0,
    status: 'ready',
    acted: false,
    ...extra,
  };
  draft.units.push(unit);
  return unit;
}

/** Applies an action that must be legal. */
export function apply(state: GameState, action: Action): GameState {
  return applyWithEvents(state, action).state;
}

export function applyWithEvents(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action ${action.type} rejected: ${result.reason}`);
  return result;
}

/** The hexes next to `hex` that lie inside the grid. */
export function around(map: MapData, hex: number): number[] {
  return hexNeighbors(indexToOffset(hex, map.width))
    .filter((n) => n.col >= 0 && n.col < map.width && n.row >= 0 && n.row < map.height)
    .map((n) => n.row * map.width + n.col);
}

/** True for flat, open land without a river, city site or resource: ground with no combat or movement modifier. */
export function isPlainGround(map: MapData, hex: number): boolean {
  const topo = topologyOf(map);
  return (
    topo.enterable[hex] === 1 &&
    topo.water[hex] === 0 &&
    topo.moveCost[hex] === 1 &&
    map.riverEdges[hex] === 0 &&
    topo.siteZone[hex] === -1
  );
}

/** The first pair of adjacent hexes, in index order, for which `test` holds. */
export function findPair(map: MapData, test: (a: number, b: number) => boolean): [number, number] {
  for (let a = 0; a < map.width * map.height; a++) {
    for (const b of around(map, a)) if (test(a, b)) return [a, b];
  }
  throw new Error('no such pair of hexes on this map');
}

/** True if no two units share a hex. */
export function oneUnitPerHex(state: GameState): boolean {
  return new Set(state.units.map((unit) => unit.hex)).size === state.units.length;
}
