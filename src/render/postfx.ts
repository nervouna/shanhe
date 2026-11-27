/**
 * The finish laid over the drawn scene: tilt-shift depth of field, ambient
 * occlusion, tone mapping, a slight bloom and anti-aliasing. Which of them
 * run follows the quality tier, the backend and the demo's switches; with
 * none of them the scene is drawn straight to the canvas.
 *
 * Labels are not part of it: they are drawn on their own and laid over the
 * finished picture, so that no effect blurs or darkens them.
 */

import { abs, float, max, mix, pass, renderOutput, saturate, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { ACESFilmicToneMapping, NoToneMapping, RenderPipeline, SRGBColorSpace } from 'three/webgpu';
import type { Camera, Node, Scene, WebGPURenderer } from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import GTAONode from 'three/addons/tsl/display/GTAONode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import type { RenderBackend } from '../shared/types.ts';
import type { Quality } from './renderScale.ts';

/** The effects of the finish, in the order they are applied. */
export const POST_EFFECTS = ['ambientOcclusion', 'tiltShift', 'bloom', 'toneMapping', 'antialiasing'] as const;
export type PostEffect = (typeof POST_EFFECTS)[number];
export type PostEffectState = Readonly<Record<PostEffect, boolean>>;

const NONE: PostEffectState = {
  ambientOcclusion: false,
  tiltShift: false,
  bloom: false,
  toneMapping: false,
  antialiasing: false,
};
const LIGHT: PostEffectState = { ...NONE, tiltShift: true, toneMapping: true, antialiasing: true };
const FULL: PostEffectState = { ...LIGHT, ambientOcclusion: true, bloom: true };

/** What each quality tier asks for. `low` draws without any finish. */
export const TIER_EFFECTS: Readonly<Record<Quality, PostEffectState>> = {
  low: NONE,
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
 * How strong the tilt-shift blur is at a zoom fraction (0 nearest, 1
 * farthest): strongest close to the ground, gone before the political map.
 */
export function tiltShiftStrength(zoom: number): number {
  const t = Math.min(Math.max((0.62 - zoom) / 0.62, 0), 1);
  return t * t * (3 - 2 * t);
}

export interface PostFx {
  /** The effects in use. */
  readonly state: PostEffectState;
  /** Whether the scene goes through the pipeline; false when no effect needs it. */
  readonly active: boolean;
  /** Sets which effects run. The pipeline is rebuilt only when the set changes. */
  setState(state: PostEffectState): void;
  /**
   * Fits the depth of field to the view.
   *
   * @param focusDistance from the camera to the point it looks at.
   * @param zoom the zoom fraction, 0 nearest.
   */
  update(focusDistance: number, zoom: number): void;
  /** Draws the scene with the effects. Call only while `active`. */
  render(): void;
  dispose(): void;
}

type Vec3 = Node<'vec3'>;

/**
 * @param labelScene what is drawn over the finished picture, untouched by the effects.
 */
export function createPostFx(renderer: WebGPURenderer, scene: Scene, labelScene: Scene, camera: Camera): PostFx {
  const focus = uniform(1);
  const strength = uniform(0);
  let state: PostEffectState = NONE;
  let pipeline: RenderPipeline | null = null;
  let built = false;

  const needsPipeline = (s: PostEffectState): boolean =>
    s.ambientOcclusion || s.tiltShift || s.bloom || s.antialiasing;

  const build = (): void => {
    pipeline?.dispose();
    pipeline = null;
    renderer.toneMapping = state.toneMapping ? ACESFilmicToneMapping : NoToneMapping;
    if (!needsPipeline(state)) return;

    // the scene is drawn once, without multisampling: the last pass smooths the edges
    const scenePass = pass(scene, camera, { samples: 0 });
    const sceneColor = scenePass.getTextureNode('output');
    let lit: Vec3 = sceneColor.rgb;

    if (state.ambientOcclusion) {
      // normals are rebuilt from the depth, so that the scene needs no second target
      const ao = new GTAONode(scenePass.getTextureNode('depth'), null as never, camera);
      ao.resolutionScale = 0.5;
      ao.radius.value = 0.3;
      ao.thickness.value = 1.2;
      ao.samples.value = 8;
      const occlusion = ao.getTextureNode().r;
      lit = vec3(lit.mul(mix(float(1), occlusion, 0.85)));
    }
    if (state.tiltShift) {
      // a model photographed from close by: sharp only around the distance in focus
      const blurred = gaussianBlur(sceneColor, null, 3, { resolutionScale: 0.25 });
      const distance = scenePass.getViewZNode().negate();
      const off = abs(distance.sub(focus)).div(focus);
      const circle = saturate(smoothstep(0.1, 0.75, off).mul(strength));
      lit = vec3(mix(lit, blurred.rgb, circle));
    }
    if (state.bloom) {
      lit = vec3(lit.add(bloom(sceneColor, 0.14, 0.35, 1.05).rgb));
    }
    let output: Node = renderOutput(
      vec4(lit, 1),
      state.toneMapping ? ACESFilmicToneMapping : NoToneMapping,
      SRGBColorSpace,
    );
    if (state.antialiasing) output = fxaa(output);

    // the labels, drawn on their own and laid over the finished picture
    const labelPass = pass(labelScene, camera, { samples: 0 });
    const label = labelPass.getTextureNode('output');
    const labelColor = renderOutput(vec4(label.rgb.div(max(label.a, 0.0001)), 1), NoToneMapping, SRGBColorSpace);
    output = vec4(mix((output as Node<'vec4'>).rgb, labelColor.rgb, saturate(label.a)), 1);

    pipeline = new RenderPipeline(renderer, output);
    // tone mapping and the colour space are applied above, before the anti-aliasing
    pipeline.outputColorTransform = false;
  };

  return {
    get state() {
      return state;
    },
    get active() {
      return pipeline !== null;
    },
    setState(next) {
      if (built && POST_EFFECTS.every((effect) => next[effect] === state[effect])) return;
      built = true;
      state = { ...next };
      build();
    },
    update(focusDistance, zoom) {
      focus.value = focusDistance;
      strength.value = tiltShiftStrength(zoom);
    },
    render() {
      pipeline?.render();
    },
    dispose() {
      pipeline?.dispose();
      pipeline = null;
    },
  };
}
