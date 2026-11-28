import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE_STEPS,
  FIRST_HOLD,
  GPU_CALM_WINDOWS,
  GPU_FITS,
  GPU_OVER,
  PROBE_FRAMES,
  QUALITY_SETTINGS,
  SCALE_WINDOW,
  SETTLE_FRAMES,
  STUCK_WINDOWS,
  createScaleController,
  renderPixelRatio,
} from './renderScale.ts';
import type { FrameLoad, ScaleController } from './renderScale.ts';
import { WEBGL_TRACES, WEBGPU_TRACES } from './renderScale.traces.ts';
import type { TraceFrame, TraceScenario } from './renderScale.traces.ts';

const TARGET = 1000 / 60;
const LONG = TARGET * 1.25;

function feed(controller: ScaleController, frameMs: number, frames: number, load?: FrameLoad): number {
  let scale = controller.scale;
  for (let i = 0; i < frames; i++) scale = controller.sample(frameMs, load);
  return scale;
}

describe('createScaleController, from the time between frames alone', () => {
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

  it('steps down fast: every bad window costs a step, a third of a second each', () => {
    const controller = createScaleController({ targetMs: TARGET });
    expect(feed(controller, 33.3, SCALE_WINDOW)).toBe(0.85);
    expect(feed(controller, 33.3, SETTLE_FRAMES + SCALE_WINDOW)).toBe(0.7);
    // from full resolution to the floor in under two seconds of 30 fps frames
    const fresh = createScaleController({ targetMs: TARGET });
    let frames = 0;
    while (fresh.scale > 0.5) {
      fresh.sample(33.3);
      frames++;
    }
    expect(frames * 33.3).toBeLessThan(4000);
    expect(frames).toBeLessThanOrEqual(4 * (SCALE_WINDOW + SETTLE_FRAMES));
  });

  it('needs a window of frames before it reacts, so one long frame changes nothing', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 16.7, 10);
    controller.sample(80);
    expect(feed(controller, 16.7, 200)).toBe(1);
    const fresh = createScaleController({ targetMs: TARGET });
    expect(feed(fresh, 33.3, SCALE_WINDOW - 1)).toBe(1);
  });

  it('restores the scale after a calm stretch, and not before', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 33.3, SCALE_WINDOW + (SCALE_WINDOW + SETTLE_FRAMES));
    const lowered = controller.scale;
    expect(lowered).toBe(0.7);
    expect(feed(controller, 16.7, SETTLE_FRAMES + SCALE_WINDOW * (FIRST_HOLD - 1))).toBe(lowered);
    feed(controller, 16.7, SCALE_WINDOW * FIRST_HOLD * 3);
    expect(controller.scale).toBe(1);
  });

  it('probes rarely: seven seconds of calm before the first try, and twice the wait after each failure', () => {
    expect(FIRST_HOLD * SCALE_WINDOW * TARGET).toBeGreaterThanOrEqual(6900);
    const controller = createScaleController({ targetMs: TARGET, steps: [1, 0.5] });
    feed(controller, 33.3, 60);
    expect(controller.scale).toBe(0.5);
    /** Frames at 0.5 until the controller probes 1, which then runs long and fails. */
    const calmFramesUntilProbe = (): number => {
      let frames = 0;
      while (controller.scale === 0.5) {
        controller.sample(16.7);
        frames++;
        if (frames > 1_000_000) throw new Error('never probed');
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

  it('probes cheaply: a step up that does not hold is given up after a handful of frames', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 33.3, SCALE_WINDOW);
    expect(controller.scale).toBe(0.85);
    while (controller.scale === 0.85) controller.sample(16.7);
    expect(controller.scale).toBe(1);
    let frames = 0;
    while (controller.scale === 1) {
      controller.sample(33.3);
      frames++;
    }
    // the frames ignored while the buffers settle, and a few to see that it does not hold
    expect(frames).toBeLessThanOrEqual(SETTLE_FRAMES + PROBE_FRAMES);
    expect(frames).toBeLessThan(SCALE_WINDOW);
  });

  it('lowers the scale when every frame runs a little long, as without a display refresh to wait for', () => {
    const controller = createScaleController({ targetMs: TARGET });
    expect(feed(controller, 18.5, 3 * SCALE_WINDOW)).toBeLessThan(1);
    // jitter around the target is not slow
    const steady = createScaleController({ targetMs: TARGET });
    for (let i = 0; i < 600; i++) steady.sample(i % 2 === 0 ? 16.2 : 17.2);
    expect(steady.scale).toBe(1);
  });

  it('samples while terrain and trees come in: frames held up by the page itself lower nothing', () => {
    const controller = createScaleController({ targetMs: TARGET });
    // every third frame is late because its predecessor built terrain for 14 ms
    for (let i = 0; i < 900; i++) {
      if (i % 3 === 0) controller.sample(33.3, { cpuMs: 14 });
      else controller.sample(16.7, { cpuMs: 2 });
    }
    expect(controller.scale).toBe(1);
    // the same frames without the page's work to explain them do lower it
    const unexplained = createScaleController({ targetMs: TARGET });
    for (let i = 0; i < 900; i++) unexplained.sample(i % 3 === 0 ? 33.3 : 16.7, { cpuMs: 2 });
    expect(unexplained.scale).toBeLessThan(1);
    // and a scale that is too high is still found while streaming: the other frames are long as well
    const loaded = createScaleController({ targetMs: TARGET });
    for (let i = 0; i < 300; i++) loaded.sample(33.3, { cpuMs: i % 3 === 0 ? 14 : 2 });
    expect(loaded.scale).toBeLessThan(1);
  });

  it('ignores pauses and nonsense', () => {
    const controller = createScaleController({ targetMs: TARGET });
    for (let i = 0; i < 300; i++) controller.sample(i % 2 === 0 ? 900 : 16.7);
    feed(controller, 0, 100);
    feed(controller, Number.NaN, 100);
    expect(controller.scale).toBe(1);
  });

  it('resets to the highest scale', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 33.3, 200);
    expect(controller.scale).toBeLessThan(1);
    controller.reset();
    expect(controller.scale).toBe(1);
  });

  it('rejects an empty list of steps', () => {
    expect(() => createScaleController({ targetMs: TARGET, steps: [] })).toThrow(RangeError);
  });
});

describe('createScaleController, with the GPU time known', () => {
  /** A display at 60 Hz: the frame comes at the next refresh after the GPU is done. */
  const interval = (gpuMs: number): number => Math.max(1, Math.ceil((gpuMs + 1.5) / TARGET)) * TARGET;
  /** A GPU whose time follows the pixels: `full` at scale 1. */
  const run = (controller: ScaleController, full: number, frames: number, cpuMs = 2): number[] => {
    const scales: number[] = [];
    for (let i = 0; i < frames; i++) {
      const gpuMs = full * controller.scale ** 2;
      scales.push(controller.sample(interval(gpuMs), { gpuMs, cpuMs }));
    }
    return scales;
  };

  it('goes straight to the highest step that fits the budget, in one window', () => {
    const controller = createScaleController({ targetMs: TARGET });
    // 30 ms at full resolution: 0.7 takes 14.7 ms, over what counts as fitting; 0.6 takes 10.8 ms
    const scales = run(controller, 30, SCALE_WINDOW);
    expect(scales.at(-1)).toBe(0.6);
    expect(new Set(scales)).toEqual(new Set([1, 0.6]));
    expect(new Set(run(controller, 30, 3000))).toEqual(new Set([0.6]));
  });

  it('holds 60 frames per second at the scale it rests at, and never tries a scale that does not', () => {
    for (const full of [12, 17, 20, 24, 28, 34, 45, 60]) {
      const controller = createScaleController({ targetMs: TARGET });
      run(controller, full, 10 * SCALE_WINDOW);
      const rest = controller.scale;
      const later = run(controller, full, 6000);
      expect(new Set(later), `${full} ms at full resolution`).toEqual(new Set([rest]));
      const gpuMs = full * rest ** 2;
      if (rest > 0.5) expect(gpuMs).toBeLessThanOrEqual(TARGET * GPU_OVER);
      // no step above it would fit
      const above = DEFAULT_SCALE_STEPS[DEFAULT_SCALE_STEPS.indexOf(rest) - 1];
      if (above !== undefined) expect(full * above ** 2).toBeGreaterThan(TARGET * GPU_FITS);
    }
  });

  it('does not sit at its floor when the budget is met at a higher scale', () => {
    const controller = createScaleController({ targetMs: TARGET });
    // a heavy stretch pushes it to the floor
    run(controller, 90, 5 * SCALE_WINDOW);
    expect(controller.scale).toBe(0.5);
    // the load goes: back to full resolution within two seconds, without a failed try
    const scales = run(controller, 9, 120);
    expect(scales.at(-1)).toBe(1);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1] as number);
  });

  it('steps up only after the GPU time has fitted for a few windows', () => {
    const controller = createScaleController({ targetMs: TARGET });
    run(controller, 30, 2 * SCALE_WINDOW);
    expect(controller.scale).toBe(0.6);
    const scales = run(controller, 12, SETTLE_FRAMES + GPU_CALM_WINDOWS * SCALE_WINDOW - 1);
    expect(new Set(scales)).toEqual(new Set([0.6]));
    expect(run(controller, 12, 1).at(-1)).toBe(1);
  });

  it('does not lower the scale for frames the main thread held up', () => {
    const controller = createScaleController({ targetMs: TARGET });
    // the GPU needs 6 ms; every other frame comes late because a turn was drawn or terrain built
    for (let i = 0; i < 3000; i++) {
      const stalled = i % 2 === 0;
      controller.sample(stalled ? 50 : 16.7, { gpuMs: 6, cpuMs: stalled ? 30 : 2 });
    }
    expect(controller.scale).toBe(1);
    // nor for long frames nothing explains, as long as they are passing
    for (let i = 0; i < (STUCK_WINDOWS - 1) * SCALE_WINDOW; i++) controller.sample(33.3, { gpuMs: 6, cpuMs: 2 });
    expect(controller.scale).toBe(1);
    feed(controller, 16.7, 100, { gpuMs: 6, cpuMs: 2 });
    expect(controller.scale).toBe(1);
  });

  it('gives a step when frames stay long though the GPU reports room, and comes back after a long calm', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 33.3, STUCK_WINDOWS * SCALE_WINDOW, { gpuMs: 6, cpuMs: 2 });
    expect(controller.scale).toBe(0.85);
    // calm frames: not at once, though the GPU's time would fit
    feed(controller, 16.7, SETTLE_FRAMES + 10 * SCALE_WINDOW, { gpuMs: 5, cpuMs: 2 });
    expect(controller.scale).toBe(0.85);
    feed(controller, 16.7, 4 * FIRST_HOLD * SCALE_WINDOW, { gpuMs: 5, cpuMs: 2 });
    expect(controller.scale).toBe(1);
  });

  it('asks for longer before the next step up when one did not hold', () => {
    // a GPU that is dearer at the higher scale than its pixels say
    const controller = createScaleController({ targetMs: TARGET, steps: [1, 0.7] });
    const gpuAt = (scale: number): number => (scale === 1 ? 20 : 5);
    const stays: number[] = [];
    let at07 = 0;
    for (let i = 0; i < 40_000; i++) {
      const before = controller.scale;
      const gpuMs = gpuAt(before);
      const after = controller.sample(interval(gpuMs), { gpuMs, cpuMs: 2 });
      if (before === 0.7) at07++;
      if (before === 0.7 && after === 1) {
        stays.push(at07);
        at07 = 0;
      }
    }
    expect(stays.length).toBeGreaterThan(3);
    // every stay at the lower scale is about twice as long as the one before, up to a limit
    expect(stays[2]).toBeGreaterThan((stays[1] as number) * 1.5);
    expect(stays[3]).toBeGreaterThan((stays[2] as number) * 1.5);
    // up to a limit of most of a minute: the time spent in failed tries shrinks to almost nothing
    expect(stays.at(-1)).toBeGreaterThan(100 * SCALE_WINDOW);
    expect(stays.length).toBeLessThan(24);
  });

  it('falls back to the time between frames when the GPU time stops coming', () => {
    const controller = createScaleController({ targetMs: TARGET });
    feed(controller, 33.3, SCALE_WINDOW, { gpuMs: null });
    expect(controller.scale).toBe(0.85);
  });
});

/** Replays recorded traces: every frame is the recorded one for the scale the controller is at. */
function replay(
  controller: ScaleController,
  traces: ReadonlyMap<number, Readonly<Record<TraceScenario, readonly TraceFrame[]>>>,
  scenario: TraceScenario,
  frames: number,
): { readonly scales: number[]; readonly intervals: number[] } {
  const scales: number[] = [];
  const intervals: number[] = [];
  for (let i = 0; i < frames; i++) {
    const trace = traces.get(controller.scale)?.[scenario];
    if (trace === undefined) throw new Error(`no trace for scale ${controller.scale}`);
    const frame = trace[i % trace.length] as TraceFrame;
    intervals.push(frame.frameMs);
    scales.push(controller.sample(frame.frameMs, { gpuMs: frame.gpuMs, cpuMs: frame.cpuMs }));
  }
  return { scales, intervals };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function changes(scales: readonly number[]): number {
  let count = 0;
  for (let i = 1; i < scales.length; i++) if (scales[i] !== scales[i - 1]) count++;
  return count;
}

const longShare = (frames: readonly TraceFrame[]): number => frames.filter((f) => f.frameMs > LONG).length / frames.length;
const gpuMedian = (frames: readonly TraceFrame[]): number => median(frames.flatMap((f) => (f.gpuMs === null ? [] : [f.gpuMs])));

describe('createScaleController on recorded traces, WebGPU under a 60 Hz cap', () => {
  const MINUTE = 3600;

  it('the traces are what they are taken for', () => {
    expect([...WEBGPU_TRACES.keys()]).toEqual([...DEFAULT_SCALE_STEPS]);
    const half = WEBGPU_TRACES.get(0.5);
    // at the lowest scale frames come at the display's rate and the GPU reports its time
    expect(median(half?.restNear.map((f) => f.frameMs) ?? [])).toBeCloseTo(TARGET, 0);
    expect(half?.restNear.every((f) => f.gpuMs !== null)).toBe(true);
    // the pan streams terrain and trees in: some frames spend long in their callback
    expect(Math.max(...(half?.streamingPan.map((f) => f.cpuMs) ?? []))).toBeGreaterThan(8);
  });

  for (const scenario of ['restNear', 'restMiddle', 'streamingPan'] as const) {
    it(`${scenario}: settles within two seconds on a scale that holds the budget, and stays`, () => {
      const controller = createScaleController({ targetMs: TARGET });
      const start = replay(controller, WEBGPU_TRACES, scenario, 120);
      const rest = controller.scale;
      const later = replay(controller, WEBGPU_TRACES, scenario, MINUTE);
      // no change of scale in a minute: no probe, no burst of long frames from one
      expect(changes(later.scales), `scales ${[...new Set(later.scales)].join(', ')}`).toBe(0);
      expect(changes(start.scales)).toBeLessThanOrEqual(2);
      const trace = WEBGPU_TRACES.get(rest)?.[scenario] ?? [];
      // the GPU's recorded time at that scale is within the budget
      expect(gpuMedian(trace)).toBeLessThanOrEqual(TARGET * GPU_OVER);
      // and the scale is not lower than it has to be: the step above would not fit by the estimate
      const above = DEFAULT_SCALE_STEPS[DEFAULT_SCALE_STEPS.indexOf(rest) - 1];
      if (above !== undefined) expect(gpuMedian(trace) * (above / rest) ** 2).toBeGreaterThan(TARGET * GPU_FITS);
      // every long frame of that minute is one the recording has at that scale: the controller added none
      const longFrames = later.intervals.filter((ms) => ms > LONG).length;
      expect(longFrames / MINUTE).toBeLessThanOrEqual(longShare(trace) + 0.001);
    });
  }

  it('play: the GPU is at the edge of the budget in bursts; the scale gives a step and tries again ever more rarely', () => {
    const controller = createScaleController({ targetMs: TARGET });
    const first = replay(controller, WEBGPU_TRACES, 'play', MINUTE);
    const later = replay(controller, WEBGPU_TRACES, 'play', 4 * MINUTE);
    // never the floor, and never more than a step under where it started out
    const start = first.scales[119] as number;
    expect(Math.min(...first.scales, ...later.scales)).toBeGreaterThan(0.5);
    expect(Math.min(...later.scales)).toBeGreaterThanOrEqual(DEFAULT_SCALE_STEPS[DEFAULT_SCALE_STEPS.indexOf(start) + 1] as number);
    // the changes thin out: after the first minute at most one in forty seconds
    expect(changes(first.scales)).toBeLessThanOrEqual(12);
    expect(changes(later.scales)).toBeLessThanOrEqual(6);
  });

  it('at rest there is no burst of 30 fps frames', () => {
    const controller = createScaleController({ targetMs: TARGET });
    replay(controller, WEBGPU_TRACES, 'restNear', 120);
    const { intervals } = replay(controller, WEBGPU_TRACES, 'restNear', MINUTE);
    let run = 0;
    let longest = 0;
    for (const ms of intervals) {
      run = ms > LONG ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(1);
  });

  it('streaming does not push the scale below what the view at rest holds: late frames the page caused lower nothing', () => {
    const rest = createScaleController({ targetMs: TARGET });
    replay(rest, WEBGPU_TRACES, 'restNear', 600);
    const controller = createScaleController({ targetMs: TARGET });
    replay(controller, WEBGPU_TRACES, 'restNear', 600);
    const { scales } = replay(controller, WEBGPU_TRACES, 'streamingPan', MINUTE);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(rest.scale);
    // the recording does have late frames at that scale
    expect(longShare(WEBGPU_TRACES.get(rest.scale)?.streamingPan ?? [])).toBeGreaterThan(0.02);
  });
});

describe('createScaleController on recorded traces, WebGL without a GPU clock', () => {
  const MINUTE = 3600;

  it('the traces carry no GPU time', () => {
    expect([...WEBGL_TRACES.values()].every((t) => t.restNear.every((f) => f.gpuMs === null))).toBe(true);
  });

  for (const scenario of ['restNear', 'restMiddle', 'streamingPan', 'play'] as const) {
    it(`${scenario}: finds a scale that holds within three seconds and probes rarely and cheaply from there`, () => {
      const controller = createScaleController({ targetMs: TARGET });
      replay(controller, WEBGL_TRACES, scenario, 180);
      const rest = controller.scale;
      expect(longShare(WEBGL_TRACES.get(rest)?.[scenario] ?? [])).toBeLessThanOrEqual(0.3);
      const { scales } = replay(controller, WEBGL_TRACES, scenario, 3 * MINUTE);
      // in three minutes: a handful of tries upward at most, each a few frames long
      const above = scales.filter((scale) => scale > rest).length;
      const probes = scales.filter((scale, i) => scale > rest && (scales[i - 1] ?? rest) <= rest).length;
      expect(probes).toBeLessThanOrEqual(5);
      expect(above).toBeLessThanOrEqual(probes * (SETTLE_FRAMES + SCALE_WINDOW));
      expect(above / scales.length).toBeLessThan(0.02);
      // it may give a step for a while when hitches come thick, but it does not sink to the floor and stay
      expect(scales.filter((scale) => scale < rest).length / scales.length).toBeLessThan(0.4);
      if (rest > 0.6) expect(Math.min(...scales)).toBeGreaterThan(0.5);
    });
  }
});

describe('renderPixelRatio', () => {
  it('caps the device pixel ratio by the tier and multiplies by the scale', () => {
    expect(renderPixelRatio(3, QUALITY_SETTINGS.high, 1)).toBe(2);
    expect(renderPixelRatio(2, QUALITY_SETTINGS.low, 0.85)).toBeCloseTo(0.85);
    expect(renderPixelRatio(1, QUALITY_SETTINGS.auto, 0.5)).toBe(0.5);
    expect(renderPixelRatio(0, QUALITY_SETTINGS.medium, 1)).toBe(0.5);
  });
});
