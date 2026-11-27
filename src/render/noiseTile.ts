/**
 * A square of fractal noise that repeats without a seam, as bytes. The
 * shaders read it as a texture instead of computing noise per pixel, which
 * is several times cheaper and, with mipmaps, does not shimmer far away.
 * No Three.js.
 */

function hash3(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise with `period` cells per side, repeating. `x` and `y` in cells. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wrap = (v: number): number => ((v % period) + period) % period;
  const a = hash3(wrap(x0), wrap(y0), seed);
  const b = hash3(wrap(x0 + 1), wrap(y0), seed);
  const c = hash3(wrap(x0), wrap(y0 + 1), seed);
  const d = hash3(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export interface NoiseChannel {
  /** Cells per side of the first octave. */
  readonly cells: number;
  readonly octaves: number;
  readonly seed: number;
}

/** What the four channels of the renderer's noise texture hold. */
export const NOISE_CHANNELS: readonly NoiseChannel[] = [
  { cells: 8, octaves: 4, seed: 1 },
  { cells: 8, octaves: 4, seed: 2 },
  { cells: 16, octaves: 3, seed: 3 },
  // soft and broad: clouds
  { cells: 4, octaves: 5, seed: 4 },
];

/**
 * `size * size` RGBA pixels, one fractal noise per channel, each stretched
 * to the full range of a byte. The right edge continues at the left one and
 * the bottom at the top.
 */
export function buildNoiseTile(size: number, channels: readonly NoiseChannel[] = NOISE_CHANNELS): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const values = new Float32Array(size * size);
  channels.slice(0, 4).forEach((channel, k) => {
    let min = Infinity;
    let max = -Infinity;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let sum = 0;
        let amplitude = 0.5;
        let cells = channel.cells;
        for (let octave = 0; octave < channel.octaves; octave++) {
          sum += amplitude * periodicNoise((i / size) * cells, (j / size) * cells, cells, channel.seed * 131 + octave);
          amplitude *= 0.5;
          cells *= 2;
        }
        values[j * size + i] = sum;
        if (sum < min) min = sum;
        if (sum > max) max = sum;
      }
    }
    const range = max - min || 1;
    for (let p = 0; p < size * size; p++) {
      out[p * 4 + k] = Math.round((((values[p] as number) - min) / range) * 255);
    }
  });
  return out;
}
