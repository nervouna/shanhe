import { describe, expect, it } from 'vitest';
import {
  CASCADE_COUNT,
  SUN_STEP,
  angleBetween,
  cascadeHalf,
  cascadeNeedsFit,
  cloudLayerOpacity,
  sunDirectionAt,
} from './lightMath.ts';
import { blurLayer } from './hexRaster.ts';
import { NOISE_CHANNELS, buildNoiseTile } from './noiseTile.ts';
import {
  BLOOM_PIXELS,
  BLOOM_RESOLUTION,
  NO_EFFECTS,
  OCCLUSION_PIXELS,
  OCCLUSION_RESOLUTION,
  POST_EFFECTS,
  TIER_EFFECTS,
  effectResolution,
  resolveEffects,
  tiltShiftStrength,
} from './postEffects.ts';
import { QUALITY_TIERS } from './renderScale.ts';
import { ShapeBuilder, rgb } from './shapes.ts';

describe('resolveEffects', () => {
  it('runs nothing at the low tier', () => {
    expect(resolveEffects('low', 'webgpu')).toEqual(NO_EFFECTS);
    expect(resolveEffects('low', 'webgl')).toEqual(NO_EFFECTS);
    expect(Object.values(NO_EFFECTS).some(Boolean)).toBe(false);
  });

  it('ties every effect to the tiers: more at each step up', () => {
    const count = (tier: (typeof QUALITY_TIERS)[number]): number => Object.values(TIER_EFFECTS[tier]).filter(Boolean).length;
    expect(count('low')).toBe(0);
    expect(count('medium')).toBeGreaterThan(count('low'));
    expect(count('high')).toBeGreaterThan(count('medium'));
    expect(count('high')).toBe(POST_EFFECTS.length);
    expect(TIER_EFFECTS.auto).toEqual(TIER_EFFECTS.high);
    // every effect runs at some tier
    for (const effect of POST_EFFECTS) expect(QUALITY_TIERS.some((tier) => TIER_EFFECTS[tier][effect])).toBe(true);
  });

  it('keeps ambient occlusion and bloom off on the WebGL fallback, whatever is asked', () => {
    for (const tier of QUALITY_TIERS) {
      const state = resolveEffects(tier, 'webgl', { ambientOcclusion: true, bloom: true });
      expect(state.ambientOcclusion).toBe(false);
      expect(state.bloom).toBe(false);
    }
    expect(resolveEffects('high', 'webgl').tiltShift).toBe(true);
    expect(resolveEffects('high', 'webgpu').ambientOcclusion).toBe(true);
  });

  it('lets a switch set by hand win over the tier, in both directions', () => {
    expect(resolveEffects('high', 'webgpu', { bloom: false }).bloom).toBe(false);
    expect(resolveEffects('high', 'webgpu', { bloom: false }).tiltShift).toBe(true);
    expect(resolveEffects('low', 'webgpu', { antialiasing: true })).toEqual({ ...NO_EFFECTS, antialiasing: true });
    for (const effect of POST_EFFECTS) {
      expect(resolveEffects('high', 'webgpu', { [effect]: false })[effect]).toBe(false);
      expect(resolveEffects('low', 'webgpu', { [effect]: true })[effect]).toBe(true);
    }
    // the tier's own table is not changed by it
    expect(TIER_EFFECTS.low).toEqual(NO_EFFECTS);
  });
});

describe('effectResolution', () => {
  it('is the full share on a small picture and less on a large one', () => {
    // a window of 1280 x 720 at pixel ratio 1: half the resolution, as ever
    expect(effectResolution(1280 * 720, OCCLUSION_RESOLUTION, OCCLUSION_PIXELS)).toBe(0.5);
    // 2472 x 1200 at pixel ratio 2: the effect has its budget of pixels and no more
    const large = 2472 * 1200 * 4;
    const share = effectResolution(large, OCCLUSION_RESOLUTION, OCCLUSION_PIXELS);
    expect(share).toBeLessThan(0.5);
    expect(share * share * large).toBeCloseTo(OCCLUSION_PIXELS, 0);
    expect(effectResolution(large, BLOOM_RESOLUTION, BLOOM_PIXELS) ** 2 * large).toBeCloseTo(BLOOM_PIXELS, 0);
  });

  it('never grows with the picture and never exceeds its share', () => {
    let previous = Infinity;
    for (let pixels = 100_000; pixels < 40_000_000; pixels *= 1.7) {
      const share = effectResolution(pixels, 0.5, 1_000_000);
      expect(share).toBeLessThanOrEqual(0.5);
      expect(share).toBeLessThanOrEqual(previous);
      expect(share).toBeGreaterThan(0);
      previous = share;
    }
  });

  it('takes the full share for a picture without size', () => {
    expect(effectResolution(0, 0.5, 1_000_000)).toBe(0.5);
    expect(effectResolution(Number.NaN, 0.5, 1_000_000)).toBe(0.5);
  });
});

describe('tiltShiftStrength', () => {
  it('is strongest at the nearest zoom, falls steadily and is gone before the political map', () => {
    expect(tiltShiftStrength(0)).toBe(1);
    let previous = 1;
    for (let zoom = 0.05; zoom <= 0.6; zoom += 0.05) {
      const strength = tiltShiftStrength(zoom);
      expect(strength).toBeLessThan(previous);
      previous = strength;
    }
    expect(tiltShiftStrength(0.62)).toBe(0);
    expect(tiltShiftStrength(0.7)).toBe(0);
    expect(tiltShiftStrength(1)).toBe(0);
    expect(tiltShiftStrength(-1)).toBe(1);
  });
});

describe('the light', () => {
  it('keeps the sun an afternoon sun in the south-west while it drifts', () => {
    const rest = sunDirectionAt(0);
    let widest = 0;
    for (let seconds = 0; seconds < 3600; seconds += 7) {
      const sun = sunDirectionAt(seconds);
      expect(Math.hypot(...sun)).toBeCloseTo(1, 9);
      // from the west (x < 0) and the south (z > 0), between 35 and 47 degrees up
      expect(sun[0]).toBeLessThan(-0.4);
      expect(sun[2]).toBeGreaterThan(0.2);
      expect(sun[1]).toBeGreaterThan(Math.sin((35 * Math.PI) / 180));
      expect(sun[1]).toBeLessThan(Math.sin((47 * Math.PI) / 180));
      widest = Math.max(widest, angleBetween(sun, rest));
    }
    // it does move, by several steps of the shadow map
    expect(widest).toBeGreaterThan(SUN_STEP * 5);
    expect(widest).toBeLessThan(0.3);
  });

  it('drifts slowly: many seconds pass between two steps of the sun', () => {
    let steps = 0;
    let shown = sunDirectionAt(0);
    for (let seconds = 0; seconds < 600; seconds += 0.1) {
      const wanted = sunDirectionAt(seconds);
      if (angleBetween(wanted, shown) > SUN_STEP) {
        shown = wanted;
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(5);
    expect(steps).toBeLessThan(200);
  });

  it('nests the cascades: each covers more ground than the one before, all within the map', () => {
    expect(CASCADE_COUNT).toBeGreaterThanOrEqual(2);
    for (const distance of [5, 40, 400]) {
      for (let i = 1; i < CASCADE_COUNT; i++) {
        expect(cascadeHalf(i, distance, 1000)).toBeGreaterThan(cascadeHalf(i - 1, distance, 1000) * 2);
      }
      expect(cascadeHalf(CASCADE_COUNT - 1, distance, 30)).toBeLessThanOrEqual(30);
    }
    // the last cascade holds everything the lowest view can see: about 1.3 distances ahead of the target
    expect(cascadeHalf(CASCADE_COUNT - 1, 10, 1000)).toBeGreaterThan(13 / 0.93);
  });

  it('fits a cascade again only when the view leaves it', () => {
    expect(cascadeNeedsFit(null, 0, 0, 10)).toBe(true);
    const fit = { x: 0, z: 0, distance: 10, half: 6 };
    expect(cascadeNeedsFit(fit, 0, 0, 10)).toBe(false);
    expect(cascadeNeedsFit(fit, 1, 0.5, 10.5)).toBe(false);
    expect(cascadeNeedsFit(fit, 2, 0, 10)).toBe(true);
    expect(cascadeNeedsFit(fit, 0, 0, 12.5)).toBe(true);
    expect(cascadeNeedsFit(fit, 0, 0, 6)).toBe(true);
  });

  it('shows the cloud layer only from far above', () => {
    expect(cloudLayerOpacity(0)).toBe(0);
    expect(cloudLayerOpacity(0.4)).toBe(0);
    expect(cloudLayerOpacity(0.55)).toBeGreaterThan(0);
    expect(cloudLayerOpacity(0.55)).toBeLessThan(cloudLayerOpacity(0.7));
    expect(cloudLayerOpacity(1)).toBe(cloudLayerOpacity(0.7));
    expect(cloudLayerOpacity(1)).toBeLessThanOrEqual(0.6);
  });
});

describe('buildNoiseTile', () => {
  const size = 64;
  const tile = buildNoiseTile(size);

  it('fills four channels over the whole range of a byte', () => {
    expect(tile).toHaveLength(size * size * 4);
    for (let c = 0; c < NOISE_CHANNELS.length; c++) {
      let min = 255;
      let max = 0;
      for (let p = 0; p < size * size; p++) {
        min = Math.min(min, tile[p * 4 + c]!);
        max = Math.max(max, tile[p * 4 + c]!);
      }
      expect(min).toBe(0);
      expect(max).toBe(255);
    }
    expect(buildNoiseTile(size)).toEqual(tile);
  });

  it('repeats without a seam: the step over the edge is no larger than the steps inside', () => {
    for (let c = 0; c < 4; c++) {
      let inside = 0;
      let across = 0;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size - 1; i++) inside = Math.max(inside, Math.abs(tile[(j * size + i) * 4 + c]! - tile[(j * size + i + 1) * 4 + c]!));
        across = Math.max(across, Math.abs(tile[(j * size + size - 1) * 4 + c]! - tile[j * size * 4 + c]!));
        across = Math.max(across, Math.abs(tile[((size - 1) * size + j) * 4 + c]! - tile[j * 4 + c]!));
      }
      expect(across).toBeLessThanOrEqual(inside);
    }
  });
});

describe('blurLayer', () => {
  it('turns a hard edge into a ramp and keeps flat areas as they are', () => {
    const width = 12;
    const height = 4;
    const data = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j++) for (let i = 6; i < width; i++) data[(j * width + i) * 4] = 255;
    blurLayer(data, width, height, 2);
    const row = Array.from({ length: width }, (_, i) => data[(width + i) * 4]!);
    expect(row[0]).toBe(0);
    expect(row[width - 1]).toBe(255);
    for (let i = 1; i < width; i++) expect(row[i]!).toBeGreaterThanOrEqual(row[i - 1]!);
    // the edge is spread over several pixels
    expect(row.filter((value) => value > 0 && value < 255).length).toBeGreaterThanOrEqual(3);
    // the other channels stay empty
    expect(data[(width + 6) * 4 + 1]).toBe(0);
  });
});

describe('ShapeBuilder', () => {
  it('builds closed, outward-facing sides for a box, a cone and a lump', () => {
    const cases: [string, (b: ShapeBuilder) => void, number][] = [
      ['box', (b) => b.box(-1, 0, -1, 1, 2, 1, [1, 1, 1]), 10],
      ['cone', (b) => b.frustum(0, 0, 0, 2, 1, 0, 8, [1, 1, 1]), 8],
      ['cylinder', (b) => b.frustum(0, 0, 0, 2, 1, 1, 8, [1, 1, 1]), 24],
      ['lump', (b) => b.blob(0, 1, 0, 1, 1, 8, 4, [0, 0, 0], [1, 1, 1]), 64],
    ];
    for (const [name, build, triangles] of cases) {
      const shape = new ShapeBuilder();
      build(shape);
      expect(shape.triangleCount, name).toBe(triangles);
      for (let t = 0; t < shape.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => shape.indices[t + k]!) as [number, number, number];
        const p = (v: number): [number, number, number] => [shape.positions[v * 3]!, shape.positions[v * 3 + 1]!, shape.positions[v * 3 + 2]!];
        const [pa, pb, pc] = [p(a), p(b), p(c)];
        const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]] as const;
        const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]] as const;
        const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]] as const;
        if (Math.hypot(...normal) < 1e-9) continue;
        // seen from outside the triangle is counter-clockwise: its normal points away from the axis or up
        const centre = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3 - 1, (pa[2] + pb[2] + pc[2]) / 3] as const;
        expect(normal[0] * centre[0] + normal[1] * centre[1] + normal[2] * centre[2], name).toBeGreaterThan(-1e-9);
      }
    }
  });

  it('converts colours to linear light', () => {
    expect(rgb(0x000000)).toEqual([0, 0, 0]);
    expect(rgb(0xffffff)[0]).toBeCloseTo(1, 9);
    expect(rgb(0x808080)[1]).toBeCloseTo(0.2158, 3);
  });
});
