/**
 * The light of the scene: an afternoon sun that drifts slowly, with a
 * cascaded shadow map fitted to the view, sky light, a physically based sky
 * that the glossy materials mirror, and haze that turns distant ground
 * blue-grey (aerial perspective).
 *
 * The shadow cascades are concentric squares on the ground around the point
 * the camera looks at. Each one is drawn again only when something that
 * casts a shadow changed or the view left the ground it covers, so a view
 * at rest costs no shadow pass at all.
 */

import {
  Fn,
  If,
  abs,
  cameraPosition,
  color,
  dot,
  fog,
  max,
  mix,
  normalize,
  positionWorld,
  rangeFogFactor,
  saturate,
  shadow,
  uniform,
  vec4,
} from 'three/tsl';
import {
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PMREMGenerator,
  Scene,
  ShadowBaseNode,
  Vector3,
} from 'three/webgpu';
import type { Light, LightShadow, Node, NodeBuilder, Texture, UniformNode, WebGPURenderer } from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CASCADE_COUNT, SUN_STEP, angleBetween, cascadeHalf, cascadeNeedsFit, sunDirectionAt } from './lightMath.ts';
import type { CascadeFit, Direction } from './lightMath.ts';

export interface Lighting {
  /** Unit vector from the ground towards the sun, as last stepped. */
  readonly sunDirection: Vector3;
  /** The sky as an environment map, for the materials that mirror it. */
  readonly environment: Texture;
  /** Shadow cascades drawn since the start. Only grows. */
  readonly shadowDraws: number;
  /**
   * Fits the shadow cascades and the haze to the view and lets the sun drift.
   *
   * @param target the point the camera looks at.
   * @param distance from the camera to the target.
   * @param tilt of the view above the horizon, in radians.
   * @param dirty whether anything that casts a shadow changed since the last
   *   call. `moving` says that only pieces in motion did: the far cascade
   *   then follows at half the rate.
   * @param seconds of drawn time since the start, for the drift of the sun.
   * @returns whether a cascade is drawn again in the next frame.
   */
  update(target: Vector3, distance: number, tilt: number, dirty: boolean | 'moving', seconds: number): boolean;
  /**
   * Without tone mapping the picture would burn out: the lights are dimmed
   * to make up for it.
   */
  setToneMapped(on: boolean): void;
  dispose(): void;
}

/** Haze near the horizon; also the colour distant ground fades to. */
export const HAZE_COLOR = 0xa9bfd0;
/** The blue-grey that ground far away takes on. */
const DISTANCE_COLOR = 0x8ea6c4;
const SUN_COLOR = 0xfff1dc;
const SKY_LIGHT = 0xbfd4ee;
const GROUND_LIGHT = 0x6f6654;
const SUN_INTENSITY = 2.6;
const SKY_INTENSITY = 1.25;
/** The lights without tone mapping, as a share of their strength with it. */
const UNMAPPED = 0.6;
const SHADOW_MAP_SIZE = 2048;

/** A stand-in for a light: one per cascade, placed where that cascade's shadow camera looks from. */
class CascadeLight extends Object3D {
  readonly target = new Object3D();
  /** Tells the shadow nodes that the matrices are theirs to update, when they draw. */
  override castShadow = true;
  shadow!: LightShadow;
}

interface Cascade {
  readonly light: CascadeLight;
  /** The ground point in the middle of the cascade, and half its side. */
  readonly centre: UniformNode<'vec3', Vector3>;
  readonly half: UniformNode<'float', number>;
  fit: CascadeFit | null;
}

/** Picks, per pixel, the finest cascade that covers it. */
class CascadeShadowNode extends ShadowBaseNode {
  private readonly cascades: readonly Cascade[];
  private readonly nodes: readonly Node[];
  private readonly right: UniformNode<'vec3', Vector3>;
  private readonly up: UniformNode<'vec3', Vector3>;

  constructor(
    light: Light,
    cascades: readonly Cascade[],
    right: UniformNode<'vec3', Vector3>,
    up: UniformNode<'vec3', Vector3>,
  ) {
    super(light);
    this.cascades = cascades;
    // one shadow node, and with it one shadow map, per cascade, shared by every material
    this.nodes = cascades.map((cascade) => shadow(cascade.light as unknown as Light, cascade.light.shadow));
    this.right = right;
    this.up = up;
  }

  /** The cascades are placed by `Lighting.update`; nothing to do per render. */
  override updateBefore(): undefined {
    return undefined;
  }

  override setup(): Node {
    const nodes = this.nodes;
    return Fn((builder: NodeBuilder) => {
      this.setupShadowPosition(builder);
      const value = vec4(1, 1, 1, 1).toVar('shadowValue');
      // a cascade covers a square across the light's direction
      const inside = this.cascades.map((cascade) => {
        const offset = positionWorld.sub(cascade.centre);
        return max(abs(dot(offset, this.right)), abs(dot(offset, this.up))).lessThan(cascade.half.mul(0.93));
      });
      const pick = (index: number): void => {
        const node = nodes[index];
        const within = inside[index];
        if (node === undefined || within === undefined) return;
        If(within, () => {
          value.assign(node);
        }).Else(() => {
          pick(index + 1);
        });
      };
      pick(0);
      return value;
    })() as Node;
  }
}

export function createLighting(scene: Scene, renderer: WebGPURenderer, mapSpan: number, heightSpan: number): Lighting {
  let shownDirection: Direction = sunDirectionAt(0);
  const sunDirection = new Vector3(...shownDirection);

  const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  // drawn on request only, see `update`
  sun.shadow.autoUpdate = false;
  sun.shadow.bias = -0.0004;

  const right = uniform(new Vector3());
  const up = uniform(new Vector3());
  const cascades: Cascade[] = [];
  for (let i = 0; i < CASCADE_COUNT; i++) {
    const light = new CascadeLight();
    light.shadow = sun.shadow.clone();
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = false;
    cascades.push({ light, centre: uniform(new Vector3()), half: uniform(1), fit: null });
  }
  const cascadeNode = new CascadeShadowNode(sun, cascades, right, up);
  sun.shadow.shadowNode = cascadeNode;
  scene.add(sun, sun.target);

  const sky = new HemisphereLight(SKY_LIGHT, GROUND_LIGHT, SKY_INTENSITY);
  scene.add(sky);

  // the sky, drawn once into an environment map
  const skyMesh = new SkyMesh();
  skyMesh.scale.setScalar(1000);
  skyMesh.turbidity.value = 3.2;
  skyMesh.rayleigh.value = 1.6;
  skyMesh.mieCoefficient.value = 0.004;
  skyMesh.mieDirectionalG.value = 0.8;
  skyMesh.showSunDisc.value = 0;
  skyMesh.sunPosition.value.copy(sunDirection);
  const skyScene = new Scene();
  skyScene.add(skyMesh);
  const pmrem = new PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(skyScene, 0, 1, 5000);
  pmrem.dispose();
  skyMesh.geometry.dispose();
  skyMesh.material.dispose();

  // aerial perspective: ground far away fades to blue-grey, warmer towards the sun
  const fogNear = uniform(1);
  const fogFar = uniform(2);
  const sunUniform = uniform(sunDirection);
  const toGround = normalize(positionWorld.sub(cameraPosition));
  const towardsSun = saturate(dot(toGround, sunUniform).mul(0.5).add(0.5));
  const hazeColor = mix(color(DISTANCE_COLOR), color(HAZE_COLOR), towardsSun.mul(towardsSun));
  scene.fogNode = fog(hazeColor, rangeFogFactor(fogNear, fogFar));
  scene.backgroundNode = color(HAZE_COLOR);

  const axisRight = new Vector3();
  const axisUp = new Vector3();
  const worldUp = new Vector3(0, 1, 0);
  const placeAxes = (): void => {
    axisRight.crossVectors(worldUp, sunDirection).normalize();
    axisUp.crossVectors(sunDirection, axisRight).normalize();
    right.value.copy(axisRight);
    up.value.copy(axisUp);
  };
  placeAxes();

  let shadowDraws = 0;
  let farTurn = false;

  return {
    sunDirection,
    environment: environmentTarget.texture,
    get shadowDraws() {
      return shadowDraws;
    },
    update(target, distance, tilt, dirty, seconds) {
      // the sun moves in steps, so that the shadows are not drawn every frame
      const wanted = sunDirectionAt(seconds);
      let stepped = false;
      if (angleBetween(wanted, shownDirection) > SUN_STEP) {
        shownDirection = wanted;
        sunDirection.set(...wanted);
        placeAxes();
        stepped = true;
      }
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(sunDirection, 10);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();

      let redraw = false;
      farTurn = !farTurn;
      cascades.forEach((cascade, index) => {
        const refit = stepped || cascadeNeedsFit(cascade.fit, target.x, target.z, distance);
        // pieces in motion: the far cascade is drawn every other frame
        const changed = dirty === true || (dirty === 'moving' && (index === 0 || farTurn));
        if (!refit && !changed) return;
        if (refit) {
          const half = cascadeHalf(index, distance, mapSpan);
          cascade.fit = { x: target.x, z: target.z, distance, half };
          cascade.centre.value.copy(target);
          cascade.half.value = half;
          // far enough back to see over every mountain between it and the ground
          const back = half * 3 + heightSpan * 2;
          const { light } = cascade;
          light.target.position.copy(target);
          light.position.copy(target).addScaledVector(sunDirection, back);
          light.target.updateMatrixWorld();
          light.updateMatrixWorld();
          const camera = light.shadow.camera as unknown as {
            left: number;
            right: number;
            top: number;
            bottom: number;
            near: number;
            far: number;
            updateProjectionMatrix(): void;
          };
          camera.left = -half;
          camera.right = half;
          camera.top = half;
          camera.bottom = -half;
          camera.near = Math.max(back - half * 2.5 - heightSpan * 2, back * 0.02);
          camera.far = back + half * 2.5 + heightSpan * 2;
          camera.updateProjectionMatrix();
          light.shadow.bias = -0.0004;
          light.shadow.normalBias = ((2 * half) / SHADOW_MAP_SIZE) * 2;
        }
        cascade.light.shadow.needsUpdate = true;
        shadowDraws++;
        redraw = true;
      });

      // looking down, everything is about `distance` away and stays clear;
      // looking across, the far ground fades into the haze
      const oblique = Math.cos(tilt);
      fogNear.value = distance * (1.1 + 0.6 * (1 - oblique));
      fogFar.value = distance * (4.5 + 14 * (1 - oblique));
      return redraw;
    },
    setToneMapped(on) {
      sun.intensity = SUN_INTENSITY * (on ? 1 : UNMAPPED);
      sky.intensity = SKY_INTENSITY * (on ? 1 : UNMAPPED);
    },
    dispose() {
      scene.remove(sun, sun.target, sky);
      cascadeNode.dispose();
      for (const cascade of cascades) cascade.light.shadow.dispose();
      sun.dispose();
      sky.dispose();
      environmentTarget.dispose();
      scene.fogNode = null;
      scene.backgroundNode = null;
    },
  };
}
