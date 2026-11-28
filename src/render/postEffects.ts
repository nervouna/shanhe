/**
 * Which effects of the finish run: what each quality tier asks for, what
 * the backend carries and what was switched by hand. Plain data and
 * arithmetic; `postfx.ts` builds the passes. No Three.js.
 */

import type { RenderBackend } from '../shared/types.ts';
import type { Quality } from './renderScale.ts';

/** The effects of the finish, in the order they are applied. */
export const POST_EFFECTS = ['ambientOcclusion', 'tiltShift', 'bloom', 'toneMapping', 'antialiasing'] as const;
export type PostEffect = (typeof POST_EFFECTS)[number];
export type PostEffectState = Readonly<Record<PostEffect, boolean>>;

/** No effect at all. */
export const NO_EFFECTS: PostEffectState = {
  ambientOcclusion: false,
  tiltShift: false,
  bloom: false,
  toneMapping: false,
  antialiasing: false,
};
const LIGHT: PostEffectState = { ...NO_EFFECTS, tiltShift: true, toneMapping: true, antialiasing: true };
const FULL: PostEffectState = { ...LIGHT, ambientOcclusion: true, bloom: true };

/** What each quality tier asks for. `low` draws without any finish. */
export const TIER_EFFECTS: Readonly<Record<Quality, PostEffectState>> = {
  low: NO_EFFECTS,
  medium: LIGHT,
  high: FULL,
  auto: FULL,
};

/**
 * The effects that run: what the tier asks for, changed by the switches set
 * by hand, minus what the backend does not carry. Pure.
 *
 * On the WebGL 2 fallback ambient occlusion and bloom stay off: they need
 * several full-screen passes over float targets, which is where the
 * devices that fall back to WebGL are weakest.
 */
export function resolveEffects(
  quality: Quality,
  backend: RenderBackend,
  overrides: Readonly<Partial<Record<PostEffect, boolean>>> = {},
): PostEffectState {
  const state = { ...TIER_EFFECTS[quality] };
  for (const effect of POST_EFFECTS) {
    const override = overrides[effect];
    if (override !== undefined) state[effect] = override;
  }
  if (backend === 'webgl') {
    state.ambientOcclusion = false;
    state.bloom = false;
  }
  return state;
}

/**
 * Ambient occlusion and bloom are soft: they are computed at a share of the
 * picture's resolution and stretched over it. The share is at most
 * `most`, and less on a large picture: at full render scale an effect has
 * no more than `pixelBudget` pixels to compute, however large the window.
 * The share is the same at every render scale, so that the cost of the
 * effect follows the scale like the rest of the frame.
 *
 * @param fullPixels pixels of the picture at render scale 1.
 */
export function effectResolution(fullPixels: number, most: number, pixelBudget: number): number {
  if (!(fullPixels > 0)) return most;
  return Math.min(most, Math.sqrt(pixelBudget / fullPixels));
}

/** Ambient occlusion: half the picture's resolution, and a million pixels at most. */
export const OCCLUSION_RESOLUTION = 0.5;
export const OCCLUSION_PIXELS = 1_000_000;
/** Bloom starts from half the picture's resolution, and from half a million pixels at most. */
export const BLOOM_RESOLUTION = 0.5;
export const BLOOM_PIXELS = 500_000;

/**
 * How strong the tilt-shift blur is at a zoom fraction (0 nearest, 1
 * farthest): strongest close to the ground, gone before the political map.
 */
export function tiltShiftStrength(zoom: number): number {
  const t = Math.min(Math.max((0.62 - zoom) / 0.62, 0), 1);
  return t * t * (3 - 2 * t);
}
