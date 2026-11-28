/**
 * How long the GPU works on a frame, from its own clock.
 *
 * Under a display's refresh the time between frames is a multiple of the
 * refresh interval and says nothing about how much of the budget a frame
 * uses. The WebGPU backend of Three.js can stamp the start and the end of
 * every render pass on the GPU (`trackTimestamp`), but it reports the sum of
 * the passes' durations, and on a tile-based GPU the passes of a frame
 * overlap: the sum comes out many times the real time. What is measured
 * here is the span from the first pass's start to the last pass's end,
 * read from the same query set.
 *
 * It relies on these internals of Three.js 0.187 (checked against
 * `WebGPUTimestampQueryPool.js`): the pool of the render passes at
 * `backend.timestampQueryPool.render`, whose `resolveBuffer` holds, after a
 * resolve, a begin and an end time in nanoseconds for each pass it
 * resolved, in the order of `timestamps`, a map from a pass's id (which
 * ends in `:f<frame>`) to its duration in milliseconds. Every pass read
 * here is checked against that duration; where anything is missing or does
 * not match, the timer reports nothing.
 */

import type { WebGPURenderer } from 'three/webgpu';

export interface GpuTimer {
  /** Whether the backend can time its passes at all. */
  readonly available: boolean;
  /**
   * The GPU's time for a recent frame in milliseconds; `null` before the
   * first answer and when the last answer is more than half a second of
   * frames old.
   */
  readonly ms: number | null;
  /** Call once after every frame is drawn. The answer arrives a few frames later. */
  frameDone(): void;
  dispose(): void;
}

interface GpuBufferLike {
  mapAsync(mode: number, offset: number, size: number): Promise<undefined>;
  getMappedRange(offset: number, size: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface DeviceLike {
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  createCommandEncoder(): {
    copyBufferToBuffer(source: unknown, sourceOffset: number, target: GpuBufferLike, targetOffset: number, size: number): void;
    finish(): unknown;
  };
  readonly queue: { submit(buffers: unknown[]): void };
}

interface PoolLike {
  readonly resolveBuffer?: unknown;
  readonly timestamps?: ReadonlyMap<string, number>;
  readonly maxQueries?: number;
}

interface BackendLike {
  readonly trackTimestamp?: boolean;
  readonly device?: DeviceLike;
  readonly timestampQueryPool?: { readonly render?: PoolLike | null };
}

/** `GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST` and `GPUMapMode.READ`. */
const READ_BACK_USAGE = 0x0001 | 0x0008;
const MAP_READ = 0x0001;
/** An answer older than this many frames is not reported any more. */
const STALE_FRAMES = 30;

/**
 * The span of the passes of the last frame in a resolve: from the start of
 * its first pass to the end of its last, in milliseconds.
 *
 * @param passes id and duration (in milliseconds) of each pass, in the order of `times`.
 * @param times begin and end of each pass, in nanoseconds: `[begin0, end0, begin1, end1, ...]`.
 * @returns `null` if there is no pass, an id names no frame, or a pass's
 *   times do not give its duration (the order is not what it is taken for).
 */
export function lastFrameSpanMs(
  passes: readonly (readonly [id: string, durationMs: number])[],
  times: BigUint64Array | readonly bigint[],
): number | null {
  if (passes.length === 0 || times.length < passes.length * 2) return null;
  let frame: string | null = null;
  let first: bigint | null = null;
  let last: bigint | null = null;
  // from the end: the passes of the last frame come last
  for (let k = passes.length - 1; k >= 0; k--) {
    const [id, duration] = passes[k] as readonly [string, number];
    const match = /:f(\d+)$/.exec(id);
    if (match === null) return null;
    if (frame === null) frame = match[1] as string;
    else if (match[1] !== frame) break;
    const begin = times[k * 2] as bigint;
    const end = times[k * 2 + 1] as bigint;
    if (end < begin || Math.abs(Number(end - begin) / 1e6 - duration) > 0.001) return null;
    if (first === null || begin < first) first = begin;
    if (last === null || end > last) last = end;
  }
  if (first === null || last === null) return null;
  return Number(last - first) / 1e6;
}

export function createGpuTimer(renderer: WebGPURenderer): GpuTimer {
  const backend = renderer.backend as unknown as BackendLike;
  const device = backend.device;
  const available = backend.trackTimestamp === true && device !== undefined && typeof device.createBuffer === 'function';
  let ms: number | null = null;
  /** Frames drawn, and the count at the last answer. */
  let frames = 0;
  let answered = 0;
  let busy = false;
  let disposed = false;
  let readBuffer: GpuBufferLike | null = null;

  const read = async (): Promise<void> => {
    await renderer.resolveTimestampsAsync('render');
    const pool = backend.timestampQueryPool?.render;
    if (disposed || device === undefined || pool === undefined || pool === null) return;
    const passes = [...(pool.timestamps ?? [])];
    if (pool.resolveBuffer === undefined || passes.length === 0) return;
    const bytes = passes.length * 16;
    if (bytes > (pool.maxQueries ?? 2048) * 8) return;
    readBuffer ??= device.createBuffer({ size: (pool.maxQueries ?? 2048) * 8, usage: READ_BACK_USAGE });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(pool.resolveBuffer, 0, readBuffer, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(MAP_READ, 0, bytes);
    if (disposed) return;
    const span = lastFrameSpanMs(passes, new BigUint64Array(readBuffer.getMappedRange(0, bytes)));
    readBuffer.unmap();
    if (span !== null) {
      ms = span;
      answered = frames;
    }
  };

  return {
    available,
    get ms() {
      return frames - answered > STALE_FRAMES ? null : ms;
    },
    frameDone() {
      frames++;
      if (!available || busy || disposed) return;
      busy = true;
      read()
        .catch(() => {
          // a lost device or a changed internal: the timer stays silent
        })
        .finally(() => {
          busy = false;
        });
    },
    dispose() {
      disposed = true;
      try {
        readBuffer?.destroy();
      } catch {
        // already gone with the device
      }
      readBuffer = null;
    },
  };
}
