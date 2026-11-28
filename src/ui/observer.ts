/** Observer mode: where its camera goes by itself. No DOM here. */

import type { GameEvent } from '../core/game.ts';

/** Milliseconds the observer's camera stays on an event before it goes back to where it was. */
export const FOLLOW_MS = 3500;

/**
 * The hex the observer's camera goes to for a turn's events: where a city
 * fell, or else the capital of the polity a war was declared on. -1 if the
 * turn has neither.
 *
 * @param siteOf the site hex of a zone, or -1.
 * @param capitalHex the hex of a polity's capital, or -1.
 */
export function followTarget(
  events: readonly GameEvent[],
  siteOf: (zone: number) => number,
  capitalHex: (polity: number) => number,
): number {
  let hex = -1;
  for (const event of events) {
    if (event.type === 'cityCaptured') return siteOf(event.city);
    if (event.type === 'warDeclared' && hex < 0) hex = capitalHex(event.on);
  }
  return hex;
}

/** What the observer's watch needs of the camera. `T` is a view: whatever the camera can be sent back to. */
export interface WatchCamera<T> {
  /** The view being drawn now. */
  view(): T;
  /** True while that view is changing: the camera is in flight, or a drag has not come to rest. */
  moving(): boolean;
  /** Flies to a hex, close enough to show its city and land. */
  goTo(hex: number): void;
  /** Flies back to a view. */
  restore(view: T): void;
}

/** The timers the watch runs on: the window's, or a test's. */
export interface WatchTimers {
  set(callback: () => void, ms: number): number;
  clear(id: number): void;
}

/** Observer mode's camera going to events by itself and coming back. */
export interface Watcher {
  /** The hex the camera went to and has not come back from, or null. */
  readonly watching: number | null;
  /** The times it went back to the view it had left. */
  readonly returns: number;
  /**
   * Sends the camera to an event at `hex`, to stay {@link FOLLOW_MS} and go
   * back. Returns false if it does not go: the observer is moving the camera
   * themselves just now, and it is theirs.
   */
  follow(hex: number): boolean;
  /** The observer has taken the camera: it is not brought back, and the view it left is forgotten. */
  take(): void;
}

/**
 * The observer's own view is the home the camera returns to. It is recorded
 * when the camera leaves for an event, and only from a camera at rest: never
 * from one in flight, whose view is nobody's choice. From then on it is kept
 * (through the stay, through the flight back and after it) until the observer
 * moves the camera themselves. An event that comes while the camera is away,
 * or on its way back, therefore returns to the same home, however many chain.
 */
export function createWatcher<T>(camera: WatchCamera<T>, timers: WatchTimers, stay: number = FOLLOW_MS): Watcher {
  let home: T | null = null;
  let hex: number | null = null;
  let timer: number | null = null;
  let returns = 0;
  const stop = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  return {
    get watching() {
      return hex;
    },
    get returns() {
      return returns;
    },
    follow(target) {
      if (home === null) {
        if (camera.moving()) return false;
        home = camera.view();
      }
      stop();
      hex = target;
      camera.goTo(target);
      const back = home;
      timer = timers.set(() => {
        timer = null;
        hex = null;
        returns++;
        camera.restore(back);
      }, stay);
      return true;
    },
    take() {
      stop();
      hex = null;
      home = null;
    },
  };
}
