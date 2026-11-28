import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/game.ts';
import { FOLLOW_MS, createWatcher, followTarget } from './observer.ts';
import type { WatchCamera, WatchTimers } from './observer.ts';

const siteOf = (zone: number): number => 100 + zone;
const capitalHex = (polity: number): number => 200 + polity;
const war = (on: number): GameEvent => ({ type: 'warDeclared', by: 0, on }) as GameEvent;
const fall = (city: number): GameEvent => ({ type: 'cityCaptured', city, from: 1, to: 0 }) as GameEvent;

describe('followTarget', () => {
  it('goes nowhere on a quiet turn', () => {
    expect(followTarget([], siteOf, capitalHex)).toBe(-1);
    expect(followTarget([{ type: 'roadsBuilt', hexes: [1], level: 1 }], siteOf, capitalHex)).toBe(-1);
  });

  it('goes to the capital of the polity a war was declared on, the first of several', () => {
    expect(followTarget([war(3), war(5)], siteOf, capitalHex)).toBe(203);
  });

  it('goes to a fallen city before any declaration of war', () => {
    expect(followTarget([war(3), fall(7), fall(8)], siteOf, capitalHex)).toBe(107);
  });
});

/** A camera that eases to where it is sent, as the renderer's does, and timers that run when the test says so. */
function rig(start: View) {
  let drawn = start;
  let goal = start;
  let last = start;
  let moving = false;
  const due: { id: number; at: number; run: () => void }[] = [];
  let now = 0;
  let ids = 0;
  const sites = new Map<number, View>([
    [107, { x: 40, z: 12, distance: 14 }],
    [203, { x: -30, z: 55, distance: 11 }],
    [305, { x: 8, z: -70, distance: 19 }],
  ]);
  const close = (a: View, b: View): boolean => Math.abs(a.x - b.x) + Math.abs(a.z - b.z) + Math.abs(a.distance - b.distance) < 1e-6;
  /** One frame: the drawn view closes in on the goal, and reaches it once it is near. */
  const frame = (): void => {
    const k = 0.4;
    const next = { x: drawn.x + (goal.x - drawn.x) * k, z: drawn.z + (goal.z - drawn.z) * k, distance: drawn.distance * (goal.distance / drawn.distance) ** k };
    drawn = close(next, goal) ? goal : next;
    moving = !close(drawn, last);
    last = drawn;
  };
  const camera: WatchCamera<View> = {
    view: () => drawn,
    moving: () => moving,
    goTo(hex) {
      goal = sites.get(hex) ?? goal;
    },
    restore(view) {
      goal = view;
    },
  };
  const timers: WatchTimers = {
    set(run, ms) {
      due.push({ id: ++ids, at: now + ms, run });
      return ids;
    },
    clear(id) {
      const at = due.findIndex((entry) => entry.id === id);
      if (at >= 0) due.splice(at, 1);
    },
  };
  return {
    camera,
    watcher: createWatcher(camera, timers),
    get drawn() {
      return drawn;
    },
    /** Lets `ms` pass, a frame every 50 of them, and runs the timers that come due. */
    pass(ms: number): void {
      for (const end = now + ms; now < end; ) {
        now += 50;
        frame();
        for (const entry of due.filter((item) => item.at <= now)) {
          due.splice(due.indexOf(entry), 1);
          entry.run();
        }
      }
    },
    /** The observer sends the camera somewhere themselves: a flight of their own. */
    fly(to: View): void {
      goal = to;
      moving = true;
    },
  };
}

interface View {
  readonly x: number;
  readonly z: number;
  readonly distance: number;
}

describe('createWatcher', () => {
  const whole: View = { x: 0, z: 0, distance: 90 };

  it('goes to an event, stays, and comes back to the view it left', () => {
    const { watcher, pass, ...at } = rig(whole);
    expect(watcher.follow(107)).toBe(true);
    expect(watcher.watching).toBe(107);
    pass(FOLLOW_MS - 50);
    expect(at.camera.view()).toEqual({ x: 40, z: 12, distance: 14 });
    expect(watcher).toMatchObject({ watching: 107, returns: 0 });
    pass(50);
    expect(watcher).toMatchObject({ watching: null, returns: 1 });
    pass(3000);
    expect(at.camera.view()).toEqual(whole);
  });

  it('goes on to another event while it is away, and still returns to the first view', () => {
    const { watcher, pass, camera } = rig(whole);
    watcher.follow(107);
    pass(1000);
    watcher.follow(203);
    expect(watcher.watching).toBe(203);
    // the stay starts again with the second event
    pass(FOLLOW_MS - 50);
    expect(watcher.returns).toBe(0);
    pass(3050);
    expect(watcher).toMatchObject({ watching: null, returns: 1 });
    expect(camera.view()).toEqual(whole);
  });

  it('comes home after three events that chain, each arriving while the camera flies back from the one before', () => {
    const { watcher, pass, camera } = rig(whole);
    const first = camera.view();
    watcher.follow(107);
    pass(FOLLOW_MS + 100);
    // on its way home, and nowhere near it yet
    expect(watcher).toMatchObject({ watching: null, returns: 1 });
    expect(camera.moving()).toBe(true);
    expect(camera.view().distance).toBeLessThan(whole.distance * 0.8);
    watcher.follow(203);
    pass(FOLLOW_MS + 100);
    expect(camera.moving()).toBe(true);
    watcher.follow(305);
    pass(FOLLOW_MS + 100);
    expect(camera.moving()).toBe(true);
    expect(watcher).toMatchObject({ watching: null, returns: 3 });
    pass(4000);
    expect(camera.moving()).toBe(false);
    expect(camera.view()).toEqual(first);
    // and an event long after that still has the same home
    watcher.follow(107);
    pass(FOLLOW_MS + 4000);
    expect(camera.view()).toEqual(first);
    expect(watcher.returns).toBe(4);
  });

  it('never takes a camera in flight for the home: while the observer moves it, it is theirs and does not leave', () => {
    const { watcher, pass, fly, camera } = rig(whole);
    const chosen: View = { x: 25, z: 25, distance: 30 };
    fly(chosen);
    pass(100);
    expect(camera.moving()).toBe(true);
    expect(watcher.follow(107)).toBe(false);
    expect(watcher.watching).toBeNull();
    pass(4000);
    expect(camera.view()).toEqual(chosen);
    // at rest it is a home like any other
    expect(watcher.follow(107)).toBe(true);
    pass(FOLLOW_MS + 4000);
    expect(camera.view()).toEqual(chosen);
  });

  it('is not brought back once the observer has taken the camera, and then leaves from the new view', () => {
    const { watcher, pass, fly, camera } = rig(whole);
    watcher.follow(107);
    pass(1000);
    watcher.take();
    expect(watcher.watching).toBeNull();
    pass(FOLLOW_MS + 4000);
    expect(watcher.returns).toBe(0);
    expect(camera.view()).toEqual({ x: 40, z: 12, distance: 14 });
    // taken on the way home as well: the old home is forgotten
    watcher.follow(203);
    pass(FOLLOW_MS + 100);
    watcher.take();
    const chosen: View = { x: -5, z: 9, distance: 40 };
    fly(chosen);
    pass(4000);
    watcher.follow(305);
    pass(FOLLOW_MS + 4000);
    expect(camera.view()).toEqual(chosen);
  });
});
