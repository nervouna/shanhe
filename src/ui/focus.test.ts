import { describe, expect, it } from 'vitest';
import { focusMove, trapIndex } from './focus.ts';

describe('trapIndex', () => {
  it('moves to the next control and wraps from the last to the first', () => {
    expect(trapIndex(3, 0, false)).toBe(1);
    expect(trapIndex(3, 1, false)).toBe(2);
    expect(trapIndex(3, 2, false)).toBe(0);
  });

  it('moves backwards with Shift and wraps from the first to the last', () => {
    expect(trapIndex(3, 2, true)).toBe(1);
    expect(trapIndex(3, 0, true)).toBe(2);
  });

  it('brings a focus that is outside the layer into it', () => {
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
    expect(trapIndex(3, 7, false)).toBe(0);
  });

  it('never leaves the layer however often Tab is pressed', () => {
    for (const backwards of [false, true]) {
      let at = -1;
      const seen = new Set<number>();
      for (let press = 0; press < 20; press++) {
        at = trapIndex(5, at, backwards);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThan(5);
        seen.add(at);
      }
      // and every control of the layer can be reached
      expect(seen.size).toBe(5);
    }
  });

  it('stays on the only control, and has nowhere to go in an empty layer', () => {
    expect(trapIndex(1, 0, false)).toBe(0);
    expect(trapIndex(1, 0, true)).toBe(0);
    expect(trapIndex(0, -1, false)).toBe(-1);
  });
});

describe('focusMove', () => {
  it('puts a keyboard player into a layer that opened, and leaves the mouse alone', () => {
    expect(focusMove({ was: null, now: 'tech', keyboard: true })).toBe('into');
    expect(focusMove({ was: null, now: 'tech', keyboard: false })).toBe('stay');
    expect(focusMove({ was: 'tech', now: 'policy', keyboard: true })).toBe('into');
  });

  it('gives the focus back to what opened the layer when it closes', () => {
    expect(focusMove({ was: 'tech', now: null, keyboard: true })).toBe('back');
    expect(focusMove({ was: 'tech', now: null, keyboard: false })).toBe('back');
  });

  it('does nothing while the layer is the same', () => {
    expect(focusMove({ was: 'tech', now: 'tech', keyboard: true })).toBe('stay');
    expect(focusMove({ was: null, now: null, keyboard: true })).toBe('stay');
  });
});
