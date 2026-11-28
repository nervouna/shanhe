/**
 * Where the keyboard's focus goes while a layer holds it: a full-screen
 * overlay or the end screen. Tab moves through the controls of that layer
 * and wraps at its ends; it never reaches what lies behind. No DOM here.
 */

/**
 * The control Tab moves to, as an index into the layer's controls, or -1 if
 * the layer has none.
 *
 * @param count how many controls the layer has, in the order of the page.
 * @param current the index of the control in focus, or -1 if the focus is outside the layer.
 * @param backwards true for Shift+Tab.
 */
export function trapIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}

/** What the page knows about the layer that holds the focus, before and after a redraw. */
export interface FocusChange {
  /** The layer that held the focus before the redraw, or null. */
  readonly was: string | null;
  /** The layer that holds it now, or null. */
  readonly now: string | null;
  /** True if the player is moving through the controls with the keyboard. */
  readonly keyboard: boolean;
}

/**
 * Where the focus goes when the layer that holds it changes: into a layer
 * that opened (for a keyboard player, who must find themselves inside it),
 * back to the control that opened a layer that closed, and nowhere else.
 */
export function focusMove(change: FocusChange): 'into' | 'back' | 'stay' {
  if (change.now === change.was) return 'stay';
  if (change.now !== null) return change.keyboard ? 'into' : 'stay';
  return 'back';
}
