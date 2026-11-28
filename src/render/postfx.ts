/**
 * The finish laid over the drawn scene: tilt-shift depth of field, ambient
 * occlusion, tone mapping, a slight bloom and anti-aliasing. Which of them
 * run follows the quality tier, the backend and the demo's switches; with
 * none of them the scene is drawn straight to the canvas.
 *
 * Labels are not part of it: they are drawn on their own and laid over the
 * finished picture, so that no effect blurs or darkens them.
 */

import { abs, convertToTexture, float, max, mix, pass, renderOutput, saturate, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { ACESFilmicToneMapping, NoToneMapping, RenderPipeline, SRGBColorSpace } from 'three/webgpu';
import type { Camera, Node, Scene, WebGPURenderer } from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import GTAONode from 'three/addons/tsl/display/GTAONode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { NO_EFFECTS, POST_EFFECTS, tiltShiftStrength } from './postEffects.ts';
import type { PostEffectState } from './postEffects.ts';

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
  let state: PostEffectState = NO_EFFECTS;
  let pipeline: RenderPipeline | null = null;
  let built = false;
  /** The passes of the pipeline in use, to free with it. */
  let passes: { dispose(): void }[] = [];
  const free = (): void => {
    for (const node of passes) node.dispose();
    passes = [];
    pipeline?.dispose();
    pipeline = null;
  };

  const needsPipeline = (s: PostEffectState): boolean =>
    s.ambientOcclusion || s.tiltShift || s.bloom || s.antialiasing;

  const build = (): void => {
    free();
    renderer.toneMapping = state.toneMapping ? ACESFilmicToneMapping : NoToneMapping;
    if (!needsPipeline(state)) return;

    // the scene is drawn once, without multisampling: the last pass smooths the edges
    const scenePass = pass(scene, camera, { samples: 0 });
    passes.push(scenePass);
    const sceneColor = scenePass.getTextureNode('output');
    let lit: Vec3 = sceneColor.rgb;

    if (state.ambientOcclusion) {
      // normals are rebuilt from the depth, so that the scene needs no second target
      const ao = new GTAONode(scenePass.getTextureNode('depth'), null as never, camera);
      passes.push(ao);
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
      passes.push(blurred);
      const distance = scenePass.getViewZNode().negate();
      const off = abs(distance.sub(focus)).div(focus);
      const circle = saturate(smoothstep(0.1, 0.75, off).mul(strength));
      lit = vec3(mix(lit, blurred.rgb, circle));
    }
    if (state.bloom) {
      const glow = bloom(sceneColor, 0.14, 0.35, 1.05);
      passes.push(glow);
      lit = vec3(lit.add(glow.rgb));
    }
    let output: Node = renderOutput(
      vec4(lit, 1),
      state.toneMapping ? ACESFilmicToneMapping : NoToneMapping,
      SRGBColorSpace,
    );
    if (state.antialiasing) {
      // the anti-aliasing reads the picture as a texture: the target it is drawn into is ours to free
      const flat = convertToTexture(output);
      passes.push(flat);
      const smoothed = fxaa(flat);
      passes.push(smoothed);
      output = smoothed;
    }

    // the labels, drawn on their own and laid over the finished picture
    const labelPass = pass(labelScene, camera, { samples: 0 });
    passes.push(labelPass);
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
      free();
    },
  };
}
