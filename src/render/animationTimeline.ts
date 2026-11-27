/**
 * The timing of the board animations: how long each visual event takes, the
 * timeline that plays events one after the other against a clock, and the
 * curves the pieces follow. Pure arithmetic, no Three.js.
 *
 * The timeline is driven by clock times, not by frames, so it also ends when
 * no frame is drawn.
 */

import type { VisualEvent } from './scene.ts';

/** Seconds, at speed 1. */
export const MOVE_LIFT_SECONDS = 0.16;
export const MOVE_STEP_SECONDS = 0.2;
export const MOVE_DROP_SECONDS = 0.14;
const FIXED_SECONDS = {
  melee: 0.55,
  ranged: 0.85,
  siege: 1.05,
  cityStrike: 0.95,
  destroy: 0.9,
  promote: 0.7,
  capture: 1.1,
} as const;

/**
 * How long an event plays, in seconds at speed 1.
 *
 * @param inView whether any hex of the event is in the view; an event that
 *   is not takes no time.
 */
export function eventSeconds(event: VisualEvent, inView: boolean): number {
  if (!inView) return 0;
  if (event.type === 'move') {
    const steps = event.path.length - 1;
    return steps < 1 ? 0 : MOVE_LIFT_SECONDS + steps * MOVE_STEP_SECONDS + MOVE_DROP_SECONDS;
  }
  return FIXED_SECONDS[event.type];
}

export interface TimelineState {
  /** Clips that have run to their end; they are the first ones of the list. */
  readonly completed: number;
  /** The clip that is running, or -1 when all are complete. */
  readonly active: number;
  /** How far the running clip is, from 0 to 1. */
  readonly progress: number;
}

export interface Timeline {
  /** Number of clips. */
  readonly count: number;
  /** Adds clips behind the ones already there. */
  append(seconds: readonly number[], now: number): void;
  /** Where the timeline is at clock time `now`, in milliseconds. */
  at(now: number): TimelineState;
  /** Changes the speed from `now` on; what has played stays played. */
  setSpeed(speed: number, now: number): void;
  /** Jumps to the end. */
  skip(): void;
  /** Milliseconds from `now` until the last clip ends, at the current speed. */
  remainingMs(now: number): number;
}

/**
 * Clips of the given lengths, played one after the other.
 *
 * @param seconds length of each clip at speed 1; 0 for a clip that takes no time.
 * @param now clock time in milliseconds at which the first clip starts.
 * @param speed 2 plays twice as fast.
 */
export function createTimeline(seconds: readonly number[], now: number, speed = 1): Timeline {
  /** End of each clip, in seconds of animation. */
  const ends: number[] = [];
  let total = 0;
  const add = (lengths: readonly number[]): void => {
    for (const length of lengths) {
      total += Math.max(0, Number.isFinite(length) ? length : 0);
      ends.push(total);
    }
  };
  add(seconds);
  let rate = sanitizeSpeed(speed);
  /** Animation seconds played at clock time `since`. */
  let played = 0;
  let since = now;

  const position = (clock: number): number =>
    Math.min(total, played + (Math.max(0, clock - since) / 1000) * rate);

  return {
    get count() {
      return ends.length;
    },
    append(lengths, clock) {
      // a timeline that had ended starts the new clips now, not in the past
      played = position(clock);
      since = clock;
      add(lengths);
    },
    at(clock) {
      const p = position(clock);
      let completed = 0;
      while (completed < ends.length && (ends[completed] as number) <= p) completed++;
      if (completed === ends.length) return { completed, active: -1, progress: 1 };
      const start = completed === 0 ? 0 : (ends[completed - 1] as number);
      const end = ends[completed] as number;
      return { completed, active: completed, progress: (p - start) / (end - start) };
    },
    setSpeed(next, clock) {
      played = position(clock);
      since = clock;
      rate = sanitizeSpeed(next);
    },
    skip() {
      played = total;
    },
    remainingMs(clock) {
      return ((total - position(clock)) / rate) * 1000;
    },
  };
}

function sanitizeSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? Math.min(Math.max(speed, 0.05), 50) : 1;
}

function smooth(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/** Where a moving piece is. */
export interface MovePose {
  /** Position along the path: 0 is the first hex, `steps` the last. */
  readonly along: number;
  /** How far the piece is lifted, from 0 (standing) to 1. */
  readonly lift: number;
}

/**
 * A move: lifted, slid along the path, set down.
 *
 * @param steps hexes moved, `path.length - 1`.
 * @param progress of the clip, from 0 to 1.
 */
export function movePose(steps: number, progress: number): MovePose {
  const slide = steps * MOVE_STEP_SECONDS;
  const total = MOVE_LIFT_SECONDS + slide + MOVE_DROP_SECONDS;
  const time = Math.min(Math.max(progress, 0), 1) * total;
  const up = smooth(time / MOVE_LIFT_SECONDS);
  // set down faster than lifted: the piece knocks on the table
  const down = Math.min(Math.max((time - MOVE_LIFT_SECONDS - slide) / MOVE_DROP_SECONDS, 0), 1) ** 2;
  // the slide starts while the piece is still rising
  const slid = smooth((time - MOVE_LIFT_SECONDS * 0.5) / (slide + MOVE_LIFT_SECONDS * 0.5));
  return { along: steps * slid, lift: up * (1 - down) };
}

/** The moment of a melee clip at which the attacker hits. */
export const MELEE_IMPACT = 0.36;

/**
 * A melee attack: how far the attacker is on its way to the target, from 0
 * (at home) to 1 (touching the other piece). It strikes fast and bounces back.
 */
export function meleeReach(progress: number): number {
  const t = Math.min(Math.max(progress, 0), 1);
  if (t <= MELEE_IMPACT) return (t / MELEE_IMPACT) ** 3;
  const back = (t - MELEE_IMPACT) / (1 - MELEE_IMPACT);
  // the way back overshoots a little and settles
  const eased = 1 - (1 - back) ** 2;
  return (1 - eased) * (1 + 0.25 * Math.sin(back * Math.PI));
}

/** A piece being destroyed. */
export interface DestroyPose {
  /** How far the cracks have spread, 0 to 1. */
  readonly crack: number;
  /** How far the piece has fallen over, 0 (upright) to 1 (flat on its side). */
  readonly fall: number;
  /** Size of the piece, 1 to 0. */
  readonly scale: number;
}

export function destroyPose(progress: number): DestroyPose {
  const t = Math.min(Math.max(progress, 0), 1);
  return {
    crack: smooth(t / 0.35),
    fall: Math.min(Math.max((t - 0.3) / 0.4, 0), 1) ** 2,
    scale: 1 - smooth((t - 0.72) / 0.28),
  };
}

/** Brightness of the promotion flash, 0 to 1 and back to 0. */
export function promoteFlash(progress: number): number {
  const t = Math.min(Math.max(progress, 0), 1);
  return Math.sin(Math.PI * Math.sqrt(t)) ** 2;
}

/**
 * Height of a projectile over the straight line from its start to its end.
 *
 * @param t position along the flight, 0 to 1.
 * @param apex greatest height.
 */
export function arcHeight(t: number, apex: number): number {
  return 4 * apex * t * (1 - t);
}
