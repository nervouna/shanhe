/**
 * Read-only planning on top of the rules: the path of a move that may take
 * several turns, the hexes within this turn's reach, and the expected outcome
 * of an attack. Legality and costs come from the rules' own functions.
 */

import { unitDef } from '../core/data.ts';
import type { GameState, Unit } from '../core/game.ts';
import { attackOutcome, hexDistance, stepCheck, stepCostOf, unitEmbarked, unitWithId } from '../core/query.ts';
import type { AttackOutcome } from '../core/query.ts';
import { topologyOf } from '../core/topology.ts';

export interface Path {
  /** The hexes to step on, in order, without the hex the unit stands on. */
  readonly hexes: number[];
  /** Per hex of `hexes`: the turn in which the unit gets there, 1 being the current turn. */
  readonly turns: number[];
  /** Turns the whole move takes; 0 if the unit is already there. */
  readonly total: number;
}

/** A binary heap of hexes ordered by a numeric key. */
class Heap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((keys[parent] as number) <= key) break;
      keys[i] = keys[parent] as number;
      values[i] = values[parent] as number;
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }

  pop(): [key: number, value: number] {
    const { keys, values } = this;
    const top: [number, number] = [keys[0] as number, values[0] as number];
    const key = keys.pop() as number;
    const value = values.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && (keys[child + 1] as number) < (keys[child] as number)) child++;
        if ((keys[child] as number) >= key) break;
        keys[i] = keys[child] as number;
        values[i] = values[child] as number;
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
}

/** Keys of the search are `turn * TURN_KEY + movement points used in that turn`. */
const TURN_KEY = 64;

interface Search {
  /** Per hex: the best key found, or -1. */
  readonly key: Float64Array;
  /** Per hex: the hex it was reached from. */
  readonly from: Int32Array;
  /** The hex the search stopped on, or -1. */
  readonly end: number;
}

/**
 * Cheapest way from the unit's hex, by turn of arrival and then by movement
 * points left: embarking, landing and crossing a river use up the rest of a
 * turn, so plain summed costs would be wrong.
 *
 * @param done stops the search on the first hex for which it is true.
 * @param maxTurn hexes that would be reached after this turn (0 is the current one) are not explored.
 */
function search(state: GameState, unit: Readonly<Unit>, done: (hex: number) => boolean, maxTurn: number): Search {
  const topo = topologyOf(state.map);
  const count = topo.count;
  // Movement points come in fractions on roads and railways, so the keys are not whole numbers.
  const key = new Float64Array(count).fill(-1);
  const from = new Int32Array(count).fill(-1);
  const full = unitDef(unit.type).moves;
  const probe: Unit = { ...unit };
  const heap = new Heap();
  key[unit.hex] = full - unit.moves;
  heap.push(key[unit.hex] as number, unit.hex);
  let end = -1;
  while (heap.size > 0) {
    const [k, hex] = heap.pop();
    if (k !== key[hex]) continue;
    if (done(hex)) {
      end = hex;
      break;
    }
    if (full <= 0) continue;
    let turn = Math.floor(k / TURN_KEY);
    let left = full - (k % TURN_KEY);
    if (left <= 0) {
      turn++;
      left = full;
    }
    if (turn > maxTurn) continue;
    probe.hex = hex;
    probe.moves = left;
    for (let d = 0; d < 6; d++) {
      const next = topo.neighbors[hex * 6 + d] as number;
      if (next < 0 || stepCheck(state, probe, next) !== null) continue;
      const after = Math.max(0, left - stepCostOf(state, probe, next));
      const nextKey = turn * TURN_KEY + (full - after);
      if (key[next] === -1 || nextKey < (key[next] as number)) {
        key[next] = nextKey;
        from[next] = hex;
        heap.push(nextKey, next);
      }
    }
  }
  return { key, from, end };
}

function isHex(state: GameState, hex: number): boolean {
  return Number.isInteger(hex) && hex >= 0 && hex < topologyOf(state.map).count;
}

/**
 * The quickest path of a unit to `target`, or null if it cannot get there
 * (or the unit does not exist). Hexes that are occupied now count as blocked.
 *
 * @param within stop as soon as the unit is this close to `target` (in
 *   hexes) instead of on it: 1 to walk up to something, a range to get it in
 *   reach. Default 0.
 */
export function findPath(state: GameState, unitId: number, target: number, within = 0): Path | null {
  const unit = unitWithId(state, unitId);
  if (unit === null || !isHex(state, target)) return null;
  const found = search(
    state,
    unit,
    within <= 0 ? (hex) => hex === target : (hex) => hexDistance(state, hex, target) <= within,
    Infinity,
  );
  if (found.end < 0) return null;
  const hexes: number[] = [];
  const turns: number[] = [];
  for (let hex = found.end; hex !== unit.hex; hex = found.from[hex] as number) {
    const k = found.key[hex] as number;
    hexes.push(hex);
    turns.push(Math.floor(k / TURN_KEY) + 1);
  }
  hexes.reverse();
  turns.reverse();
  return { hexes, turns, total: turns.at(-1) ?? 0 };
}

/** The steps of {@link findPath} that the unit can take in the current turn. */
export function stepsThisTurn(state: GameState, unitId: number, target: number, within = 0): number[] {
  const path = findPath(state, unitId, target, within);
  return path === null ? [] : path.hexes.filter((_, index) => path.turns[index] === 1);
}

/** Every hex the unit can move to in the current turn, ascending. */
export function reachableHexes(state: GameState, unitId: number): number[] {
  const unit = unitWithId(state, unitId);
  if (unit === null || unit.moves <= 0) return [];
  const found = search(state, unit, () => false, 0);
  const out: number[] = [];
  for (let hex = 0; hex < found.key.length; hex++) {
    const k = found.key[hex] as number;
    if (k >= 0 && k < TURN_KEY && hex !== unit.hex) out.push(hex);
  }
  return out;
}

/** What an attack would do on average. */
export type AttackPreview = AttackOutcome;

/**
 * What an attack of the unit on `target` would do on average (the rules add
 * a random factor of ±20%), with every modifier of both sides and the
 * penalty for attacking from the water counted in, or null if there is no
 * enemy of the unit on that hex. Distance and movement points are not
 * checked.
 *
 * @param from the hex the unit would attack from. Default: where it stands.
 */
export function previewAttack(state: GameState, unitId: number, target: number, from?: number): AttackPreview | null {
  return attackOutcome(state, unitId, target, from);
}

/** How close the unit has to be to attack: its range, or 1 for melee. */
export function attackReach(state: GameState, unitId: number): number {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  return unit === undefined ? 0 : Math.max(1, unitDef(unit.type).range);
}

/** True for a land unit standing on water. */
export function embarked(state: GameState, unitId: number): boolean {
  const unit = unitWithId(state, unitId);
  return unit !== null && unitEmbarked(state, unit);
}
