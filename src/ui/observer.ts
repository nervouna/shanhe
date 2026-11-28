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

/** A view of the camera, as far as coming back to it goes. */
export interface CameraView {
  readonly x: number;
  readonly z: number;
  readonly distance: number;
}

/** The observer's camera away at an event: `hex` is where it went, `home` the view it left and goes back to. */
export interface Away<T extends CameraView = CameraView> {
  readonly hex: number;
  readonly home: T;
}

/**
 * The camera goes to an event. If it is already away at another one it has
 * not been home since: the view to come back to stays the one it first left.
 */
export function goTo<T extends CameraView>(away: Away<T> | null, hex: number, current: T): Away<T> {
  return { hex, home: away?.home ?? current };
}
