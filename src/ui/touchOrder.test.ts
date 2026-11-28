import { describe, expect, it } from 'vitest';
import { isTap, tapTarget } from './touchOrder.ts';
import type { TapEffect } from './touchOrder.ts';

const yes = (): boolean => true;
const no = (): boolean => false;

/** Plays taps one after the other, as the interface does: each starts from what the last one left pending. */
function play(taps: readonly (readonly [hex: number, orderable: boolean])[]): { effects: TapEffect[]; pending: number | null } {
  let pending: number | null = null;
  const effects: TapEffect[] = [];
  for (const [hex, orderable] of taps) {
    const result = tapTarget(pending, hex, () => orderable);
    effects.push(result.effect);
    pending = result.pending;
  }
  return { effects, pending };
}

describe('tapTarget', () => {
  it('previews on the first tap and orders on the second tap on the same hex', () => {
    const first = tapTarget(null, 118, yes);
    expect(first).toEqual({ effect: 'preview', pending: 118 });
    // nothing happens between the taps: the finger lifts, the target stays pending
    expect(tapTarget(first.pending, 118, yes)).toEqual({ effect: 'confirm', pending: null });
  });

  it('confirms without asking again whether the hex can be ordered onto', () => {
    expect(tapTarget(118, 118, () => {
      throw new Error('asked');
    })).toEqual({ effect: 'confirm', pending: null });
  });

  it('moves the pending target when another hex is tapped', () => {
    expect(play([[118, true], [63, true]])).toEqual({ effects: ['preview', 'preview'], pending: 63 });
    // back on the first hex is a first tap again; the next one there confirms
    expect(play([[118, true], [63, true], [118, true], [118, true]])).toEqual({
      effects: ['preview', 'preview', 'preview', 'confirm'],
      pending: null,
    });
  });

  it('cancels with two taps on ground nothing can be ordered onto: the target first, then the selection', () => {
    expect(play([[118, true], [5, false]])).toEqual({ effects: ['preview', 'clear'], pending: null });
    expect(play([[118, true], [5, false], [5, false]])).toEqual({ effects: ['preview', 'clear', 'deselect'], pending: null });
    expect(tapTarget(null, 5, no)).toEqual({ effect: 'deselect', pending: null });
  });

  it('starts over after a confirmed order', () => {
    expect(play([[118, true], [118, true], [118, true]])).toEqual({ effects: ['preview', 'confirm', 'preview'], pending: 118 });
  });
});

describe('isTap', () => {
  const press = { pointer: 1, x: 100, y: 100, long: false };

  it('takes a short press that stayed in place for a tap', () => {
    expect(isTap(press, 1, 103, 98, 6)).toBe(true);
  });

  it('takes a press that travelled for a drag, and another pointer for none of its business', () => {
    expect(isTap(press, 1, 120, 100, 6)).toBe(false);
    expect(isTap(press, 2, 100, 100, 6)).toBe(false);
    expect(isTap(null, 1, 100, 100, 6)).toBe(false);
  });

  it('does not take the release of a long press for a tap', () => {
    expect(isTap({ ...press, long: true }, 1, 100, 100, 6)).toBe(false);
  });
});
