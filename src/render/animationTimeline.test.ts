import { describe, expect, it } from 'vitest';
import {
  MELEE_IMPACT,
  MOVE_DROP_SECONDS,
  MOVE_LIFT_SECONDS,
  MOVE_STEP_SECONDS,
  arcHeight,
  createTimeline,
  destroyPose,
  eventSeconds,
  meleeReach,
  movePose,
  promoteFlash,
} from './animationTimeline.ts';
import type { VisualEvent } from './scene.ts';

const EVENTS: readonly VisualEvent[] = [
  { type: 'move', unit: 1, path: [0, 1, 2, 3] },
  { type: 'melee', unit: 1, targetHex: 4 },
  { type: 'ranged', unit: 1, targetHex: 4 },
  { type: 'siege', unit: 1, targetHex: 4 },
  { type: 'cityStrike', cityHex: 9, targetHex: 4 },
  { type: 'destroy', unit: 2 },
  { type: 'promote', unit: 1 },
  { type: 'capture', cityHex: 9, hexes: [9, 10], polity: 0 },
];

describe('eventSeconds', () => {
  it('gives every event in view a duration', () => {
    for (const event of EVENTS) {
      const seconds = eventSeconds(event, true);
      expect(seconds, event.type).toBeGreaterThan(0.3);
      expect(seconds, event.type).toBeLessThan(2);
    }
  });

  it('makes a move longer with every hex of its path', () => {
    const move = (path: number[]): number => eventSeconds({ type: 'move', unit: 1, path }, true);
    expect(move([0, 1])).toBeCloseTo(MOVE_LIFT_SECONDS + MOVE_STEP_SECONDS + MOVE_DROP_SECONDS);
    expect(move([0, 1, 2, 3]) - move([0, 1])).toBeCloseTo(2 * MOVE_STEP_SECONDS);
    expect(move([0])).toBe(0);
    expect(move([])).toBe(0);
  });

  it('takes no time outside the view', () => {
    for (const event of EVENTS) expect(eventSeconds(event, false)).toBe(0);
  });
});

describe('createTimeline', () => {
  it('plays clips in order, one after the other', () => {
    const timeline = createTimeline([1, 2, 0.5], 1000);
    expect(timeline.count).toBe(3);
    expect(timeline.at(1000)).toEqual({ completed: 0, active: 0, progress: 0 });
    expect(timeline.at(1500)).toEqual({ completed: 0, active: 0, progress: 0.5 });
    expect(timeline.at(2000)).toEqual({ completed: 1, active: 1, progress: 0 });
    expect(timeline.at(3000)).toEqual({ completed: 1, active: 1, progress: 0.5 });
    expect(timeline.at(4250)).toEqual({ completed: 2, active: 2, progress: 0.5 });
    expect(timeline.at(4500)).toEqual({ completed: 3, active: -1, progress: 1 });
    expect(timeline.at(99_999)).toEqual({ completed: 3, active: -1, progress: 1 });
    expect(timeline.remainingMs(1000)).toBeCloseTo(3500);
    expect(timeline.remainingMs(4000)).toBeCloseTo(500);
    expect(timeline.remainingMs(9000)).toBe(0);
  });

  it('never runs backwards before its start', () => {
    const timeline = createTimeline([1], 1000);
    expect(timeline.at(0)).toEqual({ completed: 0, active: 0, progress: 0 });
  });

  it('passes clips without duration at once', () => {
    const timeline = createTimeline([0, 0, 1, 0], 0);
    expect(timeline.at(0)).toEqual({ completed: 2, active: 2, progress: 0 });
    expect(timeline.at(1000)).toEqual({ completed: 4, active: -1, progress: 1 });
    expect(createTimeline([0, 0], 0).at(0).active).toBe(-1);
    expect(createTimeline([], 0).at(0)).toEqual({ completed: 0, active: -1, progress: 1 });
  });

  it('plays faster with a higher speed', () => {
    const timeline = createTimeline([1, 1], 0, 2);
    expect(timeline.at(250)).toEqual({ completed: 0, active: 0, progress: 0.5 });
    expect(timeline.at(1000).active).toBe(-1);
    expect(timeline.remainingMs(0)).toBeCloseTo(1000);
  });

  it('keeps what has played when the speed changes', () => {
    const timeline = createTimeline([2], 0);
    timeline.setSpeed(4, 1000);
    expect(timeline.at(1000)).toEqual({ completed: 0, active: 0, progress: 0.5 });
    expect(timeline.at(1125).progress).toBeCloseTo(0.75);
    expect(timeline.remainingMs(1000)).toBeCloseTo(250);
    timeline.setSpeed(0, 1125);
    // a speed that makes no sense plays at normal speed
    expect(timeline.remainingMs(1125)).toBeCloseTo(500);
  });

  it('skips to the end', () => {
    const timeline = createTimeline([1, 2, 3], 0);
    timeline.skip();
    expect(timeline.at(0)).toEqual({ completed: 3, active: -1, progress: 1 });
    expect(timeline.remainingMs(0)).toBe(0);
  });

  it('starts appended clips when they are added, also after it had ended', () => {
    const timeline = createTimeline([1], 0);
    timeline.append([1], 500);
    expect(timeline.at(1500)).toEqual({ completed: 1, active: 1, progress: 0.5 });
    expect(timeline.at(2000).active).toBe(-1);
    timeline.append([2], 10_000);
    expect(timeline.count).toBe(3);
    expect(timeline.at(11_000)).toEqual({ completed: 2, active: 2, progress: 0.5 });
  });
});

describe('piece curves', () => {
  it('a move starts and ends standing, is lifted in between and only goes forward', () => {
    expect(movePose(3, 0)).toEqual({ along: 0, lift: 0 });
    const end = movePose(3, 1);
    expect(end.along).toBeCloseTo(3);
    expect(end.lift).toBeCloseTo(0);
    expect(movePose(3, 0.5).lift).toBeCloseTo(1);
    let last = 0;
    for (let i = 0; i <= 100; i++) {
      const pose = movePose(3, i / 100);
      expect(pose.along).toBeGreaterThanOrEqual(last);
      expect(pose.lift).toBeGreaterThanOrEqual(0);
      expect(pose.lift).toBeLessThanOrEqual(1);
      last = pose.along;
    }
  });

  it('a melee attack reaches the target at the impact and comes home', () => {
    expect(meleeReach(0)).toBe(0);
    expect(meleeReach(MELEE_IMPACT)).toBeCloseTo(1);
    expect(meleeReach(1)).toBeCloseTo(0);
    expect(meleeReach(MELEE_IMPACT / 2)).toBeLessThan(0.5);
    for (let i = 0; i <= 50; i++) expect(meleeReach(i / 50)).toBeLessThanOrEqual(1.0001);
  });

  it('a destroyed piece cracks first, then falls, then goes', () => {
    expect(destroyPose(0)).toEqual({ crack: 0, fall: 0, scale: 1 });
    const middle = destroyPose(0.36);
    expect(middle.crack).toBeCloseTo(1);
    expect(middle.fall).toBeLessThan(0.1);
    expect(middle.scale).toBe(1);
    const late = destroyPose(0.71);
    expect(late.fall).toBeCloseTo(1);
    expect(late.scale).toBe(1);
    expect(destroyPose(1).scale).toBeCloseTo(0);
  });

  it('the promotion flash and the projectile arc start and end at zero', () => {
    expect(promoteFlash(0)).toBeCloseTo(0);
    expect(promoteFlash(1)).toBeCloseTo(0);
    expect(promoteFlash(0.25)).toBeCloseTo(1);
    expect(arcHeight(0, 2)).toBe(0);
    expect(arcHeight(1, 2)).toBe(0);
    expect(arcHeight(0.5, 2)).toBe(2);
  });
});
