/**
 * The game loop host: it owns the `GameState`, sends the player's actions to
 * the rules, lets a {@link TurnRunner} play everybody else's turns, carries
 * out moves that take several turns, and tells its listeners what happened.
 * It never changes a state itself, and it has no DOM.
 */

import { applyAction, createGame, endTurn, NO_POLITY } from '../core/game.ts';
import type { Action, ActionResult, GameEvent, GameResult, GameSetup, GameState, RejectReason } from '../core/game.ts';
import type { MapData } from '../shared/mapData.ts';
import { attackReach, findPath, previewAttack } from './path.ts';
import { pendingItems } from './pending.ts';
import type { PendingItem } from './pending.ts';

/** One finished turn. */
export interface TurnReport {
  /** The state after the turn, on the host's own map object. */
  readonly state: GameState;
  readonly events: GameEvent[];
  /** Time the rules took for the turn, in milliseconds. */
  readonly ms: number;
}

/** Plays the turns of everybody but the player, without blocking the page. */
export interface TurnRunner {
  /**
   * Ends up to `turns` turns starting from `state`, calling `onTurn` after
   * each, and stops early once the game has a result.
   */
  run(state: GameState, turns: number, onTurn: (report: TurnReport) => void): Promise<void>;
  dispose(): void;
}

/** A runner on the calling thread that lets other tasks in between turns. */
export function createInlineRunner(): TurnRunner {
  return {
    async run(start, turns, onTurn) {
      let state = start;
      for (let i = 0; i < turns && state.result === null; i++) {
        const before = performance.now();
        const next = endTurn(state);
        state = next.state;
        onTurn({ state, events: next.events, ms: performance.now() - before });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    },
    dispose() {
      // nothing to release
    },
  };
}

/** A unit's standing order to travel. */
export interface MoveOrder {
  readonly target: number;
  /** The unit stops once it is this close to the target; 0 to stand on it. */
  readonly within: number;
}

export type OrderResult =
  | { readonly ok: true; readonly events: GameEvent[] }
  /** `noPath`: the unit cannot get there. */
  | { readonly ok: false; readonly reason: RejectReason | 'noPath' };

export type HostChange =
  /** A new or loaded game replaced the state. */
  | { readonly kind: 'started' }
  /** The player did something. */
  | { readonly kind: 'action'; readonly events: readonly GameEvent[] }
  /** A turn ended. `burst` is true inside {@link Host.runTurns}. */
  | { readonly kind: 'turn'; readonly events: readonly GameEvent[]; readonly burst: boolean }
  /** `busy` changed. */
  | { readonly kind: 'busy' }
  /** Orders or skips changed without the state changing. */
  | { readonly kind: 'attention' };

export interface RunReport {
  /** Turns that were played. */
  readonly turns: number;
  /** The turn the game is in afterwards. */
  readonly turn: number;
  readonly result: GameResult | null;
  /** Wall-clock time of the whole run, in milliseconds. */
  readonly ms: number;
  /** The rules' time for the slowest turn, in milliseconds. */
  readonly longestTurnMs: number;
}

export interface Host {
  readonly map: MapData;
  readonly state: GameState;
  /** False until a game is started or loaded: the state is then only a backdrop. */
  readonly playing: boolean;
  /** True while turns are being played. */
  readonly busy: boolean;
  readonly orders: ReadonlyMap<number, MoveOrder>;
  start(setup: GameSetup): void;
  /** Continues a saved game. The state must be on this host's map. */
  resume(state: GameState): void;
  /** Drops the game and goes back to the backdrop. */
  reset(): void;
  /** Applies one action of the player. A unit that is given an action loses its travel order. */
  act(action: Action): ActionResult;
  /**
   * Orders a unit of the player towards a hex: it attacks an enemy there if
   * it can reach it, otherwise it moves as far as it gets this turn and keeps
   * going on later turns.
   */
  order(unit: number, target: number): OrderResult;
  /** Leaves a unit alone for the rest of the turn. */
  skip(unit: number): void;
  /** Turns down the peace offer of `polity` for this turn: it stops waiting for an answer. */
  declinePeace(polity: number): void;
  /** What is waiting for the player. */
  pending(): PendingItem[];
  /** Ends the turn. Resolves to false if that was not possible (busy, no game, game over). */
  endTurn(): Promise<boolean>;
  /** Ends up to `turns` turns one after the other; stops at a result. */
  runTurns(turns: number): Promise<RunReport>;
  subscribe(listener: (change: HostChange) => void): () => void;
}

export function createHost(map: MapData, runner: TurnRunner): Host {
  let state = createGame(map);
  let playing = false;
  let busy = false;
  /** Bumped whenever the game is replaced, so that turns of the old game are dropped. */
  let generation = 0;
  const orders = new Map<number, MoveOrder>();
  const skipped = new Set<number>();
  const declined = new Set<number>();
  /** Policy cards the player took out of a slot: they wait for no slot until the player puts them back. */
  const shelved = new Set<string>();
  const listeners = new Set<(change: HostChange) => void>();

  const emit = (change: HostChange): void => {
    for (const listener of [...listeners]) listener(change);
  };

  const replace = (next: GameState, isPlaying: boolean): void => {
    generation++;
    state = next;
    playing = isPlaying;
    busy = false;
    orders.clear();
    skipped.clear();
    declined.clear();
    shelved.clear();
    emit({ kind: 'started' });
  };

  const unitOf = (id: number) => state.units.find((unit) => unit.id === id);

  /** Moves a unit along this turn's part of its order. */
  const advance = (id: number, events: GameEvent[]): void => {
    const order = orders.get(id);
    const unit = unitOf(id);
    if (order === undefined) return;
    if (unit === undefined || unit.owner !== state.player) {
      orders.delete(id);
      return;
    }
    const path = findPath(state, id, order.target, order.within);
    if (path === null) {
      orders.delete(id);
      return;
    }
    for (let i = 0; i < path.hexes.length && path.turns[i] === 1; i++) {
      const result = applyAction(state, { type: 'move', polity: state.player, unit: id, to: path.hexes[i] as number });
      if (!result.ok) break;
      state = result.state;
      events.push(...result.events);
    }
    if (unitOf(id)?.hex === path.hexes.at(-1) || path.hexes.length === 0) orders.delete(id);
  };

  const afterTurn = (report: TurnReport, burst: boolean): void => {
    state = report.state;
    skipped.clear();
    declined.clear();
    const events = [...report.events];
    if (state.result === null) for (const id of [...orders.keys()]) advance(id, events);
    else orders.clear();
    emit({ kind: 'turn', events, burst });
  };

  const setBusy = (value: boolean): void => {
    if (busy === value) return;
    busy = value;
    emit({ kind: 'busy' });
  };

  const run = async (turns: number, burst: boolean): Promise<RunReport> => {
    const started = performance.now();
    const report = (played: number, longest: number): RunReport => ({
      turns: played,
      turn: state.turn,
      result: state.result,
      ms: performance.now() - started,
      longestTurnMs: longest,
    });
    if (busy || !playing || state.result !== null || turns < 1) return report(0, 0);
    const mine = generation;
    let played = 0;
    let longest = 0;
    const onTurn = (turn: TurnReport): void => {
      if (mine !== generation) return;
      played++;
      longest = Math.max(longest, turn.ms);
      afterTurn(turn, burst);
    };
    setBusy(true);
    try {
      if (state.player === NO_POLITY) {
        // nobody to wait for: the runner plays the whole stretch in one go
        await runner.run(state, turns, onTurn);
      } else {
        // the player's travelling units move between the turns
        while (played < turns && mine === generation && state.result === null) {
          const before = played;
          await runner.run(state, 1, onTurn);
          if (played === before) break;
        }
      }
    } finally {
      if (mine === generation) setBusy(false);
    }
    return report(played, longest);
  };

  return {
    map,
    get state() {
      return state;
    },
    get playing() {
      return playing;
    },
    get busy() {
      return busy;
    },
    orders,
    start(setup) {
      replace(createGame(map, setup), true);
    },
    resume(saved) {
      replace(saved.map === map ? saved : { ...saved, map }, true);
    },
    reset() {
      replace(createGame(map), false);
    },
    act(action) {
      if (busy || !playing) return { ok: false, reason: 'badAction', state, events: [] };
      const result = applyAction(state, action);
      if (!result.ok) return result;
      if (action.type === 'slotPolicy') {
        const out = state.polities[action.polity]?.slots[action.slot] ?? null;
        if (action.policy === null && out !== null) shelved.add(out);
        else if (action.policy !== null) shelved.delete(action.policy);
      }
      state = result.state;
      if ('unit' in action) {
        orders.delete(action.unit);
        skipped.delete(action.unit);
      }
      emit({ kind: 'action', events: result.events });
      return result;
    },
    order(id, target) {
      if (busy || !playing) return { ok: false, reason: 'badAction' };
      const unit = unitOf(id);
      if (unit === undefined) return { ok: false, reason: 'noSuchUnit' };
      if (unit.owner !== state.player) return { ok: false, reason: 'notYourUnit' };
      const polity = state.player;
      const events: GameEvent[] = [];
      const done = (result: OrderResult): OrderResult => {
        skipped.delete(id);
        emit({ kind: 'action', events });
        return result;
      };

      if (previewAttack(state, id, target) !== null) {
        const attack: Action = { type: 'attack', polity, unit: id, target };
        let result = applyAction(state, attack);
        if (!result.ok && !['notAdjacent', 'outOfRange', 'noMovesLeft'].includes(result.reason)) {
          return { ok: false, reason: result.reason };
        }
        if (!result.ok) {
          // walk up to it, strike if there is movement left, otherwise keep walking next turn
          const within = attackReach(state, id);
          if (findPath(state, id, target, within) === null) return { ok: false, reason: 'noPath' };
          orders.set(id, { target, within });
          advance(id, events);
          result = applyAction(state, attack);
        }
        if (result.ok) {
          orders.delete(id);
          state = result.state;
          events.push(...result.events);
        }
        return done({ ok: true, events });
      }

      if (target === unit.hex) {
        orders.delete(id);
        return done({ ok: true, events });
      }
      if (findPath(state, id, target) === null) return { ok: false, reason: 'noPath' };
      orders.set(id, { target, within: 0 });
      advance(id, events);
      return done({ ok: true, events });
    },
    skip(id) {
      if (unitOf(id)?.owner !== state.player) return;
      skipped.add(id);
      orders.delete(id);
      emit({ kind: 'attention' });
    },
    declinePeace(polity) {
      declined.add(polity);
      emit({ kind: 'attention' });
    },
    pending() {
      return playing && !busy ? pendingItems(state, { orders, skipped, declined, shelved }) : [];
    },
    async endTurn() {
      return (await run(1, false)).turns === 1;
    },
    runTurns(turns) {
      return run(turns, true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
