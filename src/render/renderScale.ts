/**
 * The adaptive render scale: a controller that lowers the internal
 * resolution when frames cost too much and restores it when they do not.
 * Pure arithmetic on what is measured per frame, no Three.js.
 *
 * Frame times on a display are multiples of its refresh interval, so a
 * frame time at the target says nothing about how much headroom is left.
 * The controller therefore works from one of two things:
 *
 * - **The GPU's own time for a frame**, where the browser reports it
 *   (`gpuTimer.ts`). It says how much of the budget a frame uses, and what a
 *   higher scale would cost, so the scale goes straight to the highest step
 *   that fits and never has to be tried out. A frame that came late while
 *   the GPU had time to spare was held up by the main thread (terrain coming
 *   in, a turn being drawn), which a lower scale would not help: such frames
 *   are measured like any other and lower nothing.
 * - **The time between frames**, where it does not. Then a higher scale can
 *   only be tried: after a long calm stretch the scale steps up; if frames
 *   then run long it steps back within a few frames and waits twice as long
 *   before the next try.
 */

export interface ScaleControllerOptions {
  /** The frame time to hold, in milliseconds. */
  readonly targetMs: number;
  /** The scales to choose from, highest first. */
  readonly steps?: readonly number[];
}

/** What is known about the frame that just ended, besides how long it took to come. */
export interface FrameLoad {
  /** The GPU's time for a recent frame at the current scale, in milliseconds; `null` or absent if it is not measured. */
  readonly gpuMs?: number | null;
  /**
   * Time the frame spent in the page's own frame callback, in milliseconds.
   * A frame that came late because its callback ran long (terrain or trees
   * being built) says nothing about the scale.
   */
  readonly cpuMs?: number;
}

export interface ScaleController {
  /** The scale in use, from the list of steps. */
  readonly scale: number;
  /**
   * Feeds the time from one frame to the next, and what is known about the frame.
   *
   * @returns the scale to draw the next frame with.
   */
  sample(frameMs: number, load?: FrameLoad): number;
  /** Back to the highest scale, forgetting what was measured. */
  reset(): void;
}

export const DEFAULT_SCALE_STEPS: readonly number[] = [1, 0.85, 0.7, 0.6, 0.5];

/** Frames judged together: a third of a second at 60 frames per second. */
export const SCALE_WINDOW = 20;
/** A frame this much over the target counts as long. */
const LONG_FACTOR = 1.25;
/**
 * Where only the time between frames is known: a window with more than
 * `DROP_SHARE` of long frames drops the scale at once, and so do two
 * windows in a row with more than `HITCH_SHARE`. A scale that is too high
 * makes every other frame long or more; a turn being drawn or a busy page
 * makes a few frames long, now and then.
 */
const DROP_SHARE = 0.5;
const HITCH_SHARE = 0.3;
/** Share of long frames in a window up to which the window counts as calm. */
const CALM_SHARE = 0.15;
/**
 * Where frames are not locked to a display's refresh they all run a little
 * long instead of some running twice as long: a window that is this
 * much over the target in the mean of its middle half drops the scale too.
 */
const SLOW_MEAN = 1.04;
/** A frame whose own callback took this share of the target came late by the page's doing, not the GPU's. */
const BUSY_SHARE = 0.6;
/** Frames after which a step up that makes most frames long is given up, without waiting for the window. */
export const PROBE_FRAMES = 5;
/** Calm windows before the first probe upward: seven seconds at 60 frames per second. */
export const FIRST_HOLD = 21;
const MAX_HOLD = 336;
/** Frames ignored after a change of scale, while buffers are reallocated and the GPU's time is still of the old scale. */
export const SETTLE_FRAMES = 8;
/** Longer gaps are pauses (a hidden tab, a stall), not slow frames. */
const PAUSE_MS = 250;

/** The GPU's time is over budget above this share of the target: the frame would miss the display's refresh. */
export const GPU_OVER = 0.9;
/** A higher scale is taken when the GPU's time, as it would be there, stays below this share of the target. */
export const GPU_FITS = 0.82;
/** Windows in a row whose GPU time fits a higher scale before the step up: two thirds of a second. */
export const GPU_CALM_WINDOWS = 2;
/**
 * A step up that the GPU's time allowed and that is over budget within this
 * many windows was a misjudgement: the next one waits twice as many windows.
 */
export const GPU_CONFIRM_WINDOWS = 30;
const MAX_GPU_CALM_WINDOWS = 128;
/**
 * Windows in a row of mostly long frames, with the GPU reporting room to
 * spare and the page's callback short, after which the scale drops a step
 * all the same: something the GPU's clock does not show is in the way.
 */
export const STUCK_WINDOWS = 6;

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] as number;
}

export function createScaleController(options: ScaleControllerOptions): ScaleController {
  const steps = options.steps ?? DEFAULT_SCALE_STEPS;
  if (steps.length === 0) throw new RangeError('createScaleController: no steps');
  const target = options.targetMs;
  const longMs = target * LONG_FACTOR;
  const slowMs = target * SLOW_MEAN;

  const window: number[] = [];
  const gpuWindow: number[] = [];

  let index = 0;
  let frames = 0;
  let long = 0;
  let settle = 0;
  let calmWindows = 0;
  /** Calm windows required before the next probe. */
  let hold = FIRST_HOLD;
  /** True from a step up until one calm window confirms it. */
  let probing = false;
  /** Whether the window before had more than `HITCH_SHARE` of long frames. */
  let hitched = false;
  /** Windows in a row in which the GPU's time would fit a higher scale. */
  let fitWindows = 0;
  /** Windows in a row of mostly long frames that the GPU's time does not explain. */
  let stuckWindows = 0;
  /** Windows that have to fit before a step up by the GPU's time, and windows since the last such step. */
  let fitHold = GPU_CALM_WINDOWS;
  let sinceUp = Infinity;

  const scaleAt = (i: number): number => steps[i] as number;

  const change = (next: number): void => {
    index = next;
    frames = 0;
    long = 0;
    window.length = 0;
    gpuWindow.length = 0;
    calmWindows = 0;
    fitWindows = 0;
    stuckWindows = 0;
    settle = SETTLE_FRAMES;
  };

  /** The GPU's time at step `to`, from its time at the current step: the cost of a frame follows its pixels. */
  const gpuAt = (gpuMs: number, to: number): number => gpuMs * (scaleAt(to) / scaleAt(index)) ** 2;

  /** One window with the GPU's time known. */
  const judgeByGpu = (gpuMs: number, share: number): void => {
    if (gpuMs > target * GPU_OVER) {
      // a step up that did not hold: the estimate was too kind, so the next one is asked for longer
      if (sinceUp < GPU_CONFIRM_WINDOWS) fitHold = Math.min(fitHold * 2, MAX_GPU_CALM_WINDOWS);
      sinceUp = Infinity;
      // straight to the highest step that fits, and at least one step down
      let next = index + 1;
      while (next < steps.length - 1 && gpuAt(gpuMs, next) > target * GPU_FITS) next++;
      probing = false;
      if (index < steps.length - 1) change(Math.min(next, steps.length - 1));
      return;
    }
    if (share > 0.5) {
      // long frames the GPU's time does not explain: the page was busy, or something outside its view is
      stuckWindows++;
      fitWindows = 0;
      if (stuckWindows >= STUCK_WINDOWS && index < steps.length - 1) {
        hold = Math.min(hold * 2, MAX_HOLD);
        change(index + 1);
        // the way back up is earned like a probe's: by a long calm stretch
        calmWindows = -hold;
      }
      return;
    }
    stuckWindows = 0;
    sinceUp++;
    if (sinceUp === GPU_CONFIRM_WINDOWS) fitHold = GPU_CALM_WINDOWS;
    if (index === 0) return;
    if (calmWindows < 0) {
      // after a drop the GPU did not explain, calm windows are counted before its time is trusted again
      if (share <= CALM_SHARE) calmWindows++;
      return;
    }
    if (gpuAt(gpuMs, index - 1) <= target * GPU_FITS) {
      fitWindows++;
      if (fitWindows >= fitHold) {
        let next = index - 1;
        while (next > 0 && gpuAt(gpuMs, next - 1) <= target * GPU_FITS) next--;
        change(next);
        sinceUp = 0;
      }
    } else {
      fitWindows = 0;
    }
  };

  /** One window with only the time between frames known. */
  const judgeByInterval = (share: number, slow: boolean): void => {
    if (share > DROP_SHARE || slow || (share > HITCH_SHARE && (hitched || probing))) {
      if (probing) hold = Math.min(hold * 2, MAX_HOLD);
      probing = false;
      hitched = false;
      if (index < steps.length - 1) change(index + 1);
      else calmWindows = 0;
    } else if (share > HITCH_SHARE) {
      // one such window may be a passing hitch: the next one decides
      hitched = true;
      calmWindows = 0;
    } else if (share <= CALM_SHARE) {
      hitched = false;
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
      // neither calm nor bad: the count of calm windows waits
      hitched = false;
    }
  };

  return {
    get scale() {
      return scaleAt(index);
    },
    sample(frameMs, load = {}) {
      if (!(frameMs > 0) || frameMs > PAUSE_MS) return scaleAt(index);
      if (settle > 0) {
        settle--;
        return scaleAt(index);
      }
      const gpuMs = load.gpuMs ?? null;
      const timed = gpuMs !== null && gpuMs > 0;
      // a frame held up by the page's own work is no evidence against the scale
      const busy = (load.cpuMs ?? 0) > target * BUSY_SHARE;
      frames++;
      if (timed) gpuWindow.push(gpuMs);
      if (!busy || timed) {
        window.push(frameMs);
        if (frameMs > longMs && !busy) long++;
      }
      // a step up that does not hold shows at once: do not stutter through a whole window
      const failedProbe = probing && !timed && frames >= PROBE_FRAMES && long / frames > 0.5;
      if (frames < SCALE_WINDOW && !failedProbe) return scaleAt(index);

      if (!timed && window.length * 2 < frames) {
        // nearly every frame was held up by the page: the window says nothing either way
        frames = 0;
        long = 0;
        window.length = 0;
        gpuWindow.length = 0;
        return scaleAt(index);
      }
      const share = long / Math.max(window.length, 1);
      window.sort((a, b) => a - b);
      // the mean of the middle half: neither a hitch nor jitter around the target moves it
      const quarter = Math.floor(window.length / 4);
      let middle = 0;
      for (let i = quarter; i < window.length - quarter; i++) middle += window[i] as number;
      const slow = window.length >= 4 && middle / (window.length - 2 * quarter) > slowMs;
      // the GPU's time counts when most of the window has it
      const gpu = gpuWindow.length * 2 >= frames ? median(gpuWindow) : null;
      frames = 0;
      long = 0;
      window.length = 0;
      gpuWindow.length = 0;
      if (gpu !== null) judgeByGpu(gpu, share);
      else judgeByInterval(share, slow);
      return scaleAt(index);
    },
    reset() {
      change(0);
      settle = 0;
      hold = FIRST_HOLD;
      probing = false;
      hitched = false;
      fitHold = GPU_CALM_WINDOWS;
      sinceUp = Infinity;
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
}

export const QUALITY_TIERS = ['low', 'medium', 'high', 'auto'] as const;
export type Quality = (typeof QUALITY_TIERS)[number];

export const QUALITY_SETTINGS: Readonly<Record<Quality, QualitySettings>> = {
  low: { maxPixelRatio: 1, scale: 0.85, edgeFraction: 0.028 },
  medium: { maxPixelRatio: 1.5, scale: 1, edgeFraction: 0.02 },
  high: { maxPixelRatio: 2, scale: 1, edgeFraction: 0.013 },
  auto: { maxPixelRatio: 2, scale: null, edgeFraction: 0.018 },
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
