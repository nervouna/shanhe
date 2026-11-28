/**
 * Orders by touch. A finger has no right button and cannot hover, so an
 * order takes two taps: the first on a target shows the preview and leaves
 * the target pending, the second on the same hex gives the order. Lifting
 * the finger changes nothing. No DOM here.
 */

export type TapEffect =
  /** The hex is now the pending target and its preview is shown. */
  | 'preview'
  /** The second tap on the pending target: the order is given. */
  | 'confirm'
  /** Nothing can be ordered there: the pending target is dropped, the piece stays selected. */
  | 'clear'
  /** Nothing can be ordered there and nothing was pending: the piece is no longer selected. */
  | 'deselect';

export interface TapResult {
  readonly effect: TapEffect;
  /** The target that is pending after the tap, or null. */
  readonly pending: number | null;
}

/**
 * What a tap on `hex` does while a piece of the player is selected. Taps on
 * the player's own pieces and cities select them and do not come here.
 *
 * @param pending the target the last tap left pending, or null.
 * @param orderable says whether the selected piece can be ordered onto `hex` (a move with a path, or an attack).
 *   Asked only when the tap is not the confirming one.
 */
export function tapTarget(pending: number | null, hex: number, orderable: () => boolean): TapResult {
  if (pending === hex) return { effect: 'confirm', pending: null };
  if (orderable()) return { effect: 'preview', pending: hex };
  return pending === null ? { effect: 'deselect', pending: null } : { effect: 'clear', pending: null };
}

/** Milliseconds a finger must rest for a long press. */
export const LONG_PRESS_MS = 500;

export interface Press {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  /** True once the press has lasted long enough to show the details: its release is then no tap. */
  readonly long: boolean;
}

/**
 * What the release of a press is: a tap, or nothing, when the finger moved
 * (a drag of the map), when another pointer ended, or when the press was a
 * long one, which has already shown the details of the hex.
 *
 * @param slop pointer travel, in pixels, below which a press is a tap.
 */
export function isTap(press: Press | null, pointer: number, x: number, y: number, slop: number): boolean {
  if (press === null || press.pointer !== pointer || press.long) return false;
  return Math.hypot(x - press.x, y - press.y) <= slop;
}
