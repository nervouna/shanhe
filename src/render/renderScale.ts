/**
 * The adaptive render scale: a controller that lowers the internal
 * resolution when frames run long and restores it when they do not. Pure
 * arithmetic on frame times, no Three.js.
 *
 * Frame times on a display are quantised to its refresh interval, so a frame
 * time at the target says nothing about how much headroom is left. The
 * controller therefore restores by probing: after a calm stretch it steps
 * up; if frames then run long it steps back down and waits twice as long
 * before the next try.
 */

export interface ScaleControllerOptions {
  /** The frame time to hold, in milliseconds. */
  readonly targetMs: number;
  /** The scales to choose from, highest first. */
  readonly steps?: readonly number[];
}

export interface ScaleController {
  /** The scale in use, from the list of steps. */
  readonly scale: number;
  /**
   * Feeds the time from one frame to the next.
   *
   * @returns the scale to draw the next frame with.
   */
  sample(frameMs: number): number;
  /** Back to the highest scale, forgetting what was measured. */
  reset(): void;
}

export const DEFAULT_SCALE_STEPS: readonly number[] = [1, 0.85, 0.7, 0.6, 0.5];

/** Frames judged together. */
export const SCALE_WINDOW = 30;
/** A frame this much over the target counts as long. */
const LONG_FACTOR = 1.25;
/** Share of long frames in a window above which the scale drops. */
const DROP_SHARE = 0.3;
/** Share of long frames in a window below which the window counts as calm. */
const CALM_SHARE = 0.07;
/** Calm windows before the first probe upward. */
export const FIRST_HOLD = 4;
const MAX_HOLD = 64;
/** Frames ignored after a change of scale, while buffers are reallocated. */
const SETTLE_FRAMES = 6;
/** Longer gaps are pauses (a hidden tab, a stall), not slow frames. */
const PAUSE_MS = 250;

export function createScaleController(options: ScaleControllerOptions): ScaleController {
  const steps = options.steps ?? DEFAULT_SCALE_STEPS;
  if (steps.length === 0) throw new RangeError('createScaleController: no steps');
  const longMs = options.targetMs * LONG_FACTOR;

  let index = 0;
  let frames = 0;
  let long = 0;
  let settle = 0;
  let calmWindows = 0;
  /** Calm windows required before the next probe. */
  let hold = FIRST_HOLD;
  /** True from a step up until one calm window confirms it. */
  let probing = false;

  const change = (next: number): void => {
    index = next;
    frames = 0;
    long = 0;
    calmWindows = 0;
    settle = SETTLE_FRAMES;
  };

  return {
    get scale() {
      return steps[index] as number;
    },
    sample(frameMs) {
      if (!(frameMs > 0) || frameMs > PAUSE_MS) return steps[index] as number;
      if (settle > 0) {
        settle--;
        return steps[index] as number;
      }
      frames++;
      if (frameMs > longMs) long++;
      if (frames < SCALE_WINDOW) return steps[index] as number;

      const share = long / frames;
      frames = 0;
      long = 0;
      if (share > DROP_SHARE) {
        if (probing) hold = Math.min(hold * 2, MAX_HOLD);
        probing = false;
        if (index < steps.length - 1) change(index + 1);
        else calmWindows = 0;
      } else if (share <= CALM_SHARE) {
        if (probing) {
          // the higher scale holds: the next probe may come as soon as the first did
          probing = false;
          hold = FIRST_HOLD;
        }
        calmWindows++;
        if (index > 0 && calmWindows >= hold) {
          change(index - 1);
          probing = true;
        }
      } else {
        calmWindows = 0;
      }
      return steps[index] as number;
    },
    reset() {
      change(0);
      settle = 0;
      hold = FIRST_HOLD;
      probing = false;
    },
  };
}

/** What a quality tier fixes. `auto` adapts the scale; the others hold it. */
export interface QualitySettings {
  /** Upper bound of the device pixel ratio used. */
  readonly maxPixelRatio: number;
  /** Fixed render scale, or `null` for the adaptive one. */
  readonly scale: number | null;
  /** Target size of a terrain triangle edge, as a fraction of the view height. */
  readonly edgeFraction: number;
  /** Side of the shadow map in texels. */
  readonly shadowMapSize: number;
}

export const QUALITY_TIERS = ['low', 'medium', 'high', 'auto'] as const;
export type Quality = (typeof QUALITY_TIERS)[number];

export const QUALITY_SETTINGS: Readonly<Record<Quality, QualitySettings>> = {
  low: { maxPixelRatio: 1, scale: 0.85, edgeFraction: 0.028, shadowMapSize: 1024 },
  medium: { maxPixelRatio: 1.5, scale: 1, edgeFraction: 0.02, shadowMapSize: 2048 },
  high: { maxPixelRatio: 2, scale: 1, edgeFraction: 0.013, shadowMapSize: 2048 },
  auto: { maxPixelRatio: 2, scale: null, edgeFraction: 0.018, shadowMapSize: 2048 },
};

/**
 * The pixel ratio to render with.
 *
 * @param devicePixelRatio of the display.
 * @param scale the render scale, 1 for full resolution.
 */
export function renderPixelRatio(devicePixelRatio: number, settings: QualitySettings, scale: number): number {
  return Math.min(Math.max(devicePixelRatio, 0.5), settings.maxPixelRatio) * scale;
}
