/**
 * The balance of power: how far each nation in the race for victory stands
 * above the others, and how much the rest of the world fears it for that.
 *
 * A nation is measured on three tracks, one per victory: the gold it has
 * earned (what the Economic victory ranks), the science it has gathered, and
 * the strength of its army. On each its figure is set against the average of
 * all the nations in the race. A figure far enough above the average is a
 * lead (`BALANCE.tracks`), and the largest of a nation's leads is what it is
 * feared for. The fear counts for little early in the game and in full from
 * turn `BALANCE.fullTurn` on: nobody minds who is ahead in the first age.
 *
 * Nothing here is kept in the state: it is worked out from what the state
 * already holds, and all of it is public knowledge (the victory screen shows
 * the same figures).
 */

import { BALANCE } from './data.ts';
import { unitPower } from './combat.ts';
import { at, polityOf } from './context.ts';
import type { Ctx } from './context.ts';
import { hasAgreement, isNation } from './relations.ts';
import { NO_POLITY } from './types.ts';
import type { GameState } from './types.ts';

export type Track = keyof typeof BALANCE.tracks;
export const TRACKS = Object.keys(BALANCE.tracks) as readonly Track[];

export interface Balance {
  /** Per polity and track: its figure over the average of the nations in the race. All 0 for everybody else. */
  readonly ratios: readonly Readonly<Record<Track, number>>[];
  /** Per polity: the favour it loses with every nation it is feared by. 0 for a nation nobody fears. */
  readonly fear: readonly number[];
  /** Per polity: the track on which it is feared most, or null. */
  readonly lead: readonly (Track | null)[];
}

/** The polities whose standing is measured: the living major nations and the player. */
export function ratedIn(state: GameState): number[] {
  const list = [...state.majors];
  if (state.player !== NO_POLITY && !list.includes(state.player)) list.push(state.player);
  return list.filter((polity) => state.polities[polity]?.alive === true).sort((a, b) => a - b);
}

/** {@link ratedIn} of the context's state. */
export function ratedPolities(ctx: Ctx): number[] {
  return ratedIn(ctx.state);
}

/**
 * The fear a figure of `ratio` times the average brings on `track` in
 * `turn`: nothing up to where a lead begins, all of `BALANCE.maxFear` where
 * it is complete, in proportion in between, and less early in the game.
 */
export function fearFor(track: Track, ratio: number, turn: number): number {
  const { from, full } = BALANCE.tracks[track];
  const share = Math.max(0, Math.min(1, (ratio - from) / (full - from)));
  const season = turn < BALANCE.fromTurn ? 0 : Math.min(1, turn / BALANCE.fullTurn);
  return Math.floor(BALANCE.maxFear * share * season);
}

/** Where every nation in the race stands and the fear that brings, as things are now. */
export function balanceOfPower(ctx: Ctx): Balance {
  return balanceIn(ctx.state);
}

/** {@link balanceOfPower} from the state alone. */
export function balanceIn(state: GameState): Balance {
  const ratios: Record<Track, number>[] = state.polities.map(() => ({ income: 0, science: 0, army: 0 }));
  const fear: number[] = state.polities.map(() => 0);
  const lead: (Track | null)[] = state.polities.map(() => null);
  const rated = ratedIn(state);
  // The first turns say little, and with two in the race there is no "rest of the world".
  if (state.turn < BALANCE.fromTurn || rated.length < BALANCE.minRated) return { ratios, fear, lead };

  const strength: number[] = state.polities.map(() => 0);
  for (const unit of state.units) {
    if (unit.owner !== NO_POLITY) strength[unit.owner] = at(strength, unit.owner) + unitPower(unit);
  }
  const figures: Record<Track, (polity: number) => number> = {
    income: (polity) => at(state.polities, polity).grossIncome,
    science: (polity) => at(state.polities, polity).science,
    army: (polity) => at(strength, polity),
  };
  for (const track of TRACKS) {
    const figure = figures[track];
    let total = 0;
    for (const polity of rated) total += figure(polity);
    const average = total / rated.length;
    for (const polity of rated) {
      const ratio = average > 0 ? figure(polity) / average : 1;
      at(ratios, polity)[track] = ratio;
      // Every stage of the endgame project that stands is there for all to see.
      const stages = track === 'science' ? BALANCE.fearPerStage * at(state.polities, polity).projectStage : 0;
      const feared = Math.min(BALANCE.maxFear, fearFor(track, ratio, state.turn) + stages);
      if (feared > at(fear, polity)) {
        fear[polity] = feared;
        lead[polity] = track;
      }
    }
  }
  return { ratios, fear, lead };
}

/**
 * What `polity` saves on a tech, in percent, because a nation it fears
 * already knows it: `BALANCE.learnPercentPerFear` for every point of the
 * fear of the most feared such nation. What a leader knows does not stay
 * its own for long.
 */
export function leakPercent(state: GameState, polity: number, knowers: readonly number[]): number {
  if (knowers.length === 0 || state.turn < BALANCE.fromTurn) return 0;
  const balance = balanceIn(state);
  const own = at(balance.fear, polity);
  let most = 0;
  for (const other of knowers) if (at(balance.fear, other) > own) most = Math.max(most, at(balance.fear, other));
  return most * BALANCE.learnPercentPerFear;
}

/**
 * The one of the two that the other fears, and how much: the more feared of
 * the two. Null if neither is feared, or both alike.
 */
export function fearedOf(balance: Balance, a: number, b: number): { leader: number; fear: number } | null {
  const fearA = at(balance.fear, a);
  const fearB = at(balance.fear, b);
  if (fearA === fearB) return null;
  return fearA > fearB ? { leader: a, fear: fearA } : { leader: b, fear: fearB };
}

/** True if `polity` is bound to `leader` as its ally, its vassal or its overlord: it does not stand against it. */
export function boundTo(ctx: Ctx, polity: number, leader: number): boolean {
  return (
    polityOf(ctx, polity).overlord === leader ||
    polityOf(ctx, leader).overlord === polity ||
    hasAgreement(ctx, 'alliance', polity, leader)
  );
}

/**
 * The nations feared enough to draw the others together
 * (`BALANCE.commonThreatAt`), the most feared first.
 */
export function commonThreats(ctx: Ctx, balance: Balance): number[] {
  const list: number[] = [];
  balance.fear.forEach((fear, polity) => {
    if (fear >= BALANCE.commonThreatAt && isNation(ctx, polity)) list.push(polity);
  });
  return list.sort((x, y) => at(balance.fear, y) - at(balance.fear, x) || x - y);
}

/**
 * True if `polity` stands against `leader`: it is feared less, is not bound
 * to it, and is either in the race itself or shares a border with it
 * (`borders` says whether two polities do).
 */
export function standsAgainst(
  ctx: Ctx,
  balance: Balance,
  polity: number,
  leader: number,
  borders: (a: number, b: number) => boolean,
): boolean {
  if (polity === leader || at(balance.fear, polity) >= at(balance.fear, leader)) return false;
  if (boundTo(ctx, polity, leader)) return false;
  return ratedPolities(ctx).includes(polity) || borders(polity, leader);
}
