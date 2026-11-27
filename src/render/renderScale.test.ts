import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE_STEPS,
  FIRST_HOLD,
  QUALITY_SETTINGS,
  SCALE_WINDOW,
  createScaleController,
  renderPixelRatio,
} from './renderScale.ts';
import type { ScaleController } from './renderScale.ts';

const TARGET = 1000 / 60;

function feed(controller: ScaleController, frameMs: number, frames: number): number {
  let scale = controller.scale;
  for (let i = 0; i < frames; i++) scale = controller.sample(frameMs);
  return scale;
}

describe('createScaleController', () => {
  it('starts at full resolution and stays there while frames are on time', () => {
    const controller = createScaleController({ targetMs: TARGET });
    expect(controller.scale).toBe(1);
    expect(feed(controller, 16.7, 2000)).toBe(1);
  });

  it('lowers the scale step by step while frames run long, down to the lowest step', () => {
    const controller = createScaleController({ targetMs: TARGET });
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(controller.sample(33.3));
    expect([...seen]).toEqual([...DEFAULT_SCALE_STEPS]);
    expect(feed(controller, 33.3, 500)).toBe(0.5);
  });

  it('needs a window of frames before it reacts, so one long frame changes nothing', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 16.7, 10);
    controller.sample(80);
    expect(feed(controller, 16.7, 200)).toBe(1);
    const fresh = createScaleController({ targetMs: TARGET });
    expect(feed(fresh, 33.3, SCALE_WINDOW - 1)).toBe(1);
  });

  it('restores the scale after a calm stretch', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 33.3, 80);
    const lowered = controller.scale;
    expect(lowered).toBeLessThan(1);
    // not before the hold has passed
    expect(feed(controller, 16.7, SCALE_WINDOW * (FIRST_HOLD - 1))).toBe(lowered);
    feed(controller, 16.7, SCALE_WINDOW * 40);
    expect(controller.scale).toBe(1);
  });

  it('backs off: a failed step up is tried again only after twice the wait', () => {
    const controller = createScaleController({ targetMs: TARGET, steps: [1, 0.5] });
    feed(controller, 33.3, 60);
    expect(controller.scale).toBe(0.5);
    /** Frames at 0.5 until the controller probes 1, which then runs long and fails. */
    const calmFramesUntilProbe = (): number => {
      let frames = 0;
      while (controller.scale === 0.5) {
        controller.sample(16.7);
        frames++;
        if (frames > 100_000) throw new Error('never probed');
      }
      while (controller.scale === 1) controller.sample(33.3);
      return frames;
    };
    const first = calmFramesUntilProbe();
    const second = calmFramesUntilProbe();
    const third = calmFramesUntilProbe();
    expect(second).toBeGreaterThan(first * 1.6);
    expect(third).toBeGreaterThan(second * 1.6);
  });

  it('ignores pauses and nonsense', () => {
    const controller = createScaleController({ targetMs: TARGET });
    expect(feed(controller, 5000, 500)).toBe(1);
    expect(feed(controller, 0, 500)).toBe(1);
    expect(feed(controller, Number.NaN, 500)).toBe(1);
  });

  it('resets to full resolution', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 40, 200);
    expect(controller.scale).toBeLessThan(1);
    controller.reset();
    expect(controller.scale).toBe(1);
  });
});

describe('renderPixelRatio', () => {
  it('caps the device pixel ratio per tier and applies the scale', () => {
    expect(renderPixelRatio(3, QUALITY_SETTINGS.high, 1)).toBe(2);
    expect(renderPixelRatio(2, QUALITY_SETTINGS.medium, 1)).toBe(1.5);
    expect(renderPixelRatio(2, QUALITY_SETTINGS.low, 1)).toBe(1);
    expect(renderPixelRatio(1, QUALITY_SETTINGS.high, 1)).toBe(1);
    expect(renderPixelRatio(2, QUALITY_SETTINGS.auto, 0.7)).toBeCloseTo(1.4);
  });

  it('only the auto tier adapts', () => {
    expect(QUALITY_SETTINGS.auto.scale).toBeNull();
    for (const tier of ['low', 'medium', 'high'] as const) expect(QUALITY_SETTINGS[tier].scale).not.toBeNull();
  });
});
