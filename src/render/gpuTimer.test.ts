import { describe, expect, it } from 'vitest';
import { lastFrameSpanMs } from './gpuTimer.ts';

const ms = (value: number): bigint => BigInt(Math.round(value * 1e6));

describe('lastFrameSpanMs', () => {
  it('spans from the first start to the last end, not the sum of passes that overlap', () => {
    // three passes of one frame, overlapping as on a tile-based GPU: the sum is 21 ms, the span 9 ms
    const passes = [
      ['1:f7', 8],
      ['2:f7', 7],
      ['3:f7', 6],
    ] as const;
    const times = [ms(100), ms(108), ms(101), ms(108), ms(103), ms(109)];
    expect(lastFrameSpanMs(passes, times)).toBeCloseTo(9, 6);
  });

  it('takes the last frame of a resolve that holds several', () => {
    const passes = [
      ['1:f7', 4],
      ['2:f7', 4],
      ['1:f8', 5],
      ['2:f8', 2],
    ] as const;
    const times = [ms(0), ms(4), ms(1), ms(5), ms(20), ms(25), ms(24), ms(26)];
    expect(lastFrameSpanMs(passes, times)).toBeCloseTo(6, 6);
  });

  it('reads a typed array as it comes from the GPU', () => {
    const times = new BigUint64Array([ms(10), ms(13), ms(12), ms(18)]);
    expect(lastFrameSpanMs([['a:f1', 3], ['b:f1', 6]], times)).toBeCloseTo(8, 6);
  });

  it('reports nothing when the times do not give the durations: the order is not what it is taken for', () => {
    const times = [ms(0), ms(4), ms(1), ms(5)];
    expect(lastFrameSpanMs([['1:f7', 4], ['2:f7', 9]], times)).toBeNull();
    // an end before its start
    expect(lastFrameSpanMs([['1:f7', 4]], [ms(4), ms(0)])).toBeNull();
  });

  it('reports nothing without passes, without enough times or without a frame in the id', () => {
    expect(lastFrameSpanMs([], [])).toBeNull();
    expect(lastFrameSpanMs([['1:f7', 4]], [ms(0)])).toBeNull();
    expect(lastFrameSpanMs([['pass', 4]], [ms(0), ms(4)])).toBeNull();
  });
});
