/**
 * What the player sees: the fog of war as the interface applies it. The
 * rules say which hexes a polity sees and remembers; everything the
 * interface draws, plans or reports for a player goes through here, so that
 * nothing outside the player's sight is given away. No DOM here.
 *
 * The observer (`NO_POLITY`) has no sight: for them nothing is hidden.
 */

import { NO_POLITY, rememberedBy, visibleTo } from '../core/game.ts';
import type { GameState, Unit } from '../core/game.ts';
import { airStrikeTargets } from '../core/query.ts';
import { FogState } from '../render/scene.ts';

export interface Sight {
  /** The player's polity. */
  readonly viewer: number;
  /** 1 for every hex the player sees right now. */
  readonly visible: Uint8Array;
  /** Per hex a `FogState` value: unseen, remembered or visible. What the renderer takes as `RenderScene.fog`. */
  readonly fog: Uint8Array;
}

const sights = new WeakMap<GameState, Sight | null>();

/** The player's sight in `state`, or null in observer mode. Worked out once per state. */
export function sightOf(state: GameState): Sight | null {
  const kept = sights.get(state);
  if (kept !== undefined) return kept;
  let sight: Sight | null = null;
  if (state.player !== NO_POLITY) {
    const visible = visibleTo(state, state.player);
    const fog = rememberedBy(state, state.player);
    for (let hex = 0; hex < fog.length; hex++) {
      fog[hex] = visible[hex] === 1 ? FogState.Visible : fog[hex] === 1 ? FogState.Remembered : FogState.Unseen;
    }
    sight = { viewer: state.player, visible, fog };
  }
  sights.set(state, sight);
  return sight;
}

/** True if the player sees the hex. Always true without a sight (observer mode). */
export function inSight(sight: Sight | null, hex: number): boolean {
  return sight === null || sight.visible[hex] === 1;
}

/** True for a unit the fog hides: somebody else's, on a hex the player does not see. */
export function isHidden(sight: Sight | null, unit: Readonly<Unit>): boolean {
  return sight !== null && unit.owner !== sight.viewer && sight.visible[unit.hex] !== 1;
}

const known = new WeakMap<GameState, GameState>();

/**
 * The state as the player knows it: the same game without the units the fog
 * hides. Paths, reach, previews and clicks are worked out on it, so that a
 * hidden unit neither blocks a planned path nor answers a click. The rules
 * still decide on the real state: a step onto a hidden unit is refused when
 * it is taken.
 */
export function knownState(state: GameState): GameState {
  const sight = sightOf(state);
  if (sight === null) return state;
  let view = known.get(state);
  if (view === undefined) {
    const units = state.units.filter((unit) => !isHidden(sight, unit));
    view = units.length === state.units.length ? state : { ...state, units };
    known.set(state, view);
  }
  return view;
}

/** How many units of `state` the fog hides from the player. */
export function hiddenUnits(state: GameState): number {
  return state.units.length - knownState(state).units.length;
}

export interface StrikeTargets {
  /** The hexes the city's air strike is offered: the rules' targets on hexes the player sees. */
  readonly hexes: readonly number[];
  /** True if the rules have a target the player does not see: a city they know of, out of sight. */
  readonly unseen: boolean;
}

/** The targets of the air strike of the city in `zone`, as the interface offers them. */
export function strikeTargets(state: GameState, zone: number): StrikeTargets {
  const sight = sightOf(state);
  const all = airStrikeTargets(state, zone);
  const hexes = all.filter((hex) => inSight(sight, hex));
  return { hexes, unseen: hexes.length < all.length };
}
