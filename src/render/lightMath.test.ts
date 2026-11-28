import { describe, expect, it } from 'vitest';
import { GROUND_STREAM_FRAMES, shadowRedraw, streamedGroundDue } from './lightMath.ts';

describe('shadowRedraw', () => {
  const still = { ground: false, pieces: false };

  it('draws nothing while nothing changes and the view stays on the cascade', () => {
    expect(shadowRedraw(false, still)).toEqual({ ground: false, pieces: false });
  });

  it('draws only the piece map when pieces move, however long they do', () => {
    for (let frame = 0; frame < 600; frame++) {
      expect(shadowRedraw(false, { ground: false, pieces: true })).toEqual({ ground: false, pieces: true });
    }
  });

  it('draws only the ground map when the ground changes', () => {
    expect(shadowRedraw(false, { ground: true, pieces: false })).toEqual({ ground: true, pieces: false });
  });

  it('draws both maps of a cascade that is fitted again: they share one fit', () => {
    expect(shadowRedraw(true, still)).toEqual({ ground: true, pieces: true });
    expect(shadowRedraw(true, { ground: false, pieces: true })).toEqual({ ground: true, pieces: true });
  });

  it('draws both when both changed', () => {
    expect(shadowRedraw(false, { ground: true, pieces: true })).toEqual({ ground: true, pieces: true });
  });
});

describe('streamedGroundDue', () => {
  it('asks for nothing while nothing came in', () => {
    expect(streamedGroundDue(false, false, 0)).toBe(false);
    expect(streamedGroundDue(false, false, 1000)).toBe(false);
  });

  it('draws the ground at once when what came in has settled', () => {
    expect(streamedGroundDue(true, false, 1)).toBe(true);
  });

  it('draws the very first frame, which builds everything in one go', () => {
    expect(streamedGroundDue(true, true, Infinity)).toBe(true);
  });

  it('draws the ground once in a while, not in every frame, while the view moves', () => {
    // a camera in flight changes terrain patches and forests in every frame
    let since = 0;
    let draws = 0;
    const frames = 600;
    for (let frame = 0; frame < frames; frame++) {
      since++;
      if (streamedGroundDue(true, true, since)) {
        draws++;
        since = 0;
      }
    }
    expect(draws).toBe(frames / GROUND_STREAM_FRAMES);
    // yet the shadows are never far behind: several times a second
    expect(GROUND_STREAM_FRAMES).toBeGreaterThanOrEqual(6);
    expect(GROUND_STREAM_FRAMES).toBeLessThanOrEqual(15);
  });

  it('catches up in the frame after the view comes to rest', () => {
    let since = 0;
    let pending = false;
    const drawn: number[] = [];
    // 20 frames of flight, then rest
    for (let frame = 0; frame < 30; frame++) {
      const now = frame < 20;
      if (now) pending = true;
      since++;
      if (streamedGroundDue(pending, now, since)) {
        drawn.push(frame);
        pending = false;
        since = 0;
      }
    }
    expect(drawn).toEqual([GROUND_STREAM_FRAMES - 1, 20]);
  });
});
