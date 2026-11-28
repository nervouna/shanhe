/**
 * The light of the scene: an afternoon sun that drifts slowly, with a
 * cascaded shadow map fitted to the view, sky light, a physically based sky
 * that the glossy materials mirror, and haze that turns distant ground
 * blue-grey (aerial perspective).
 *
 * The shadow cascades are concentric squares on the ground around the point
 * the camera looks at. Each has two shadow maps with the same fit: one of
 * the ground (terrain, trees, cities) and one of the unit pieces alone. A
 * map is drawn again only when something in its layer changed or the view
 * left the ground the cascade covers. A view at rest costs no shadow pass
 * at all, and a piece in motion costs the piece maps only: a few thousand
 * triangles in one draw call each, not the ground a second time.
 */

import {
  BasicShadowFilter,
  Fn,
  If,
  abs,
  cameraPosition,
  color,
  dot,
  fog,
  max,
  min,
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
import {
  CASCADE_COUNT,
  SUN_STEP,
  angleBetween,
  cascadeHalf,
  cascadeNeedsFit,
  shadowRedraw,
  sunDirectionAt,
} from './lightMath.ts';
import type { CascadeFit, Direction, ShadowLayers } from './lightMath.ts';
import { GROUND_SHADOW_LAYER, PIECE_SHADOW_LAYER } from './shadowLayers.ts';

export interface Lighting {
  /** Unit vector from the ground towards the sun, as last stepped. */
  readonly sunDirection: Vector3;
  /** The sky as an environment map, for the materials that mirror it. */
  readonly environment: Texture;
  /** Shadow maps drawn since the start, of both layers. Only grows. */
  readonly shadowDraws: number;
  /** Of those, the maps of the pieces alone. */
  readonly pieceShadowDraws: number;
  /** Triangles drawn into shadow maps since the last call of `update`. */
  readonly shadowTriangles: number;
  /**
   * Fits the shadow cascades and the haze to the view and lets the sun drift.
   *
   * @param target the point the camera looks at.
   * @param distance from the camera to the target.
   * @param tilt of the view above the horizon, in radians.
   * @param changed the layers in which something that casts a shadow changed
   *   since the last call.
   * @param seconds of drawn time since the start, for the drift of the sun.
   * @returns whether a shadow map is drawn again in the next frame.
   */
  update(target: Vector3, distance: number, tilt: number, changed: ShadowLayers, seconds: number): boolean;
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

/** A stand-in for a light: one per shadow map, placed where that map's shadow camera looks from. */
class CascadeLight extends Object3D {
  readonly target = new Object3D();
  /** Tells the shadow nodes that the matrices are theirs to update, when they draw. */
  override castShadow = true;
  shadow!: LightShadow;
}

interface Cascade {
  /** The lights of its two shadow maps; both are placed alike. */
  readonly ground: CascadeLight;
  readonly pieces: CascadeLight;
  /** The ground point in the middle of the cascade, and half its side. */
  readonly centre: UniformNode<'vec3', Vector3>;
  readonly half: UniformNode<'float', number>;
  fit: CascadeFit | null;
}

/** What the shadow node of a map reports when it has drawn the map. */
type DrawListener = (triangles: number) => void;

/** The shadow node of one map. `onDraw` is called whenever the map is drawn. */
function shadowMapNode(light: CascadeLight, onDraw: DrawListener): Node<'float'> {
  const node = shadow(light as unknown as Light, light.shadow);
  // the typings leave out the method that draws the map
  const drawn = node as unknown as { renderShadow(frame: { readonly renderer: WebGPURenderer }): void };
  const draw = drawn.renderShadow.bind(drawn);
  drawn.renderShadow = (frame) => {
    const info = frame.renderer.info.render;
    const before = info.triangles;
    draw(frame);
    onDraw(info.triangles - before);
  };
  // how much of the sun's light arrives: 1 in the open, 0 in shadow
  return node as unknown as Node<'float'>;
}

/** Picks, per pixel, the finest cascade that covers it, and takes the darker of its two maps. */
class CascadeShadowNode extends ShadowBaseNode {
  private readonly cascades: readonly Cascade[];
  private readonly nodes: readonly (readonly [ground: Node<'float'>, pieces: Node<'float'>])[];
  private readonly right: UniformNode<'vec3', Vector3>;
  private readonly up: UniformNode<'vec3', Vector3>;

  constructor(
    light: Light,
    cascades: readonly Cascade[],
    right: UniformNode<'vec3', Vector3>,
    up: UniformNode<'vec3', Vector3>,
    onDraw: (layer: keyof ShadowLayers, triangles: number) => void,
  ) {
    super(light);
    this.cascades = cascades;
    // one shadow node, and with it one shadow map, per cascade and layer, shared by every material
    this.nodes = cascades.map((cascade) => [
      shadowMapNode(cascade.ground, (triangles) => {
        onDraw('ground', triangles);
      }),
      shadowMapNode(cascade.pieces, (triangles) => {
        onDraw('pieces', triangles);
      }),
    ]);
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
        const pair = nodes[index];
        const within = inside[index];
        if (pair === undefined || within === undefined) return;
        If(within, () => {
          value.assign(min(pair[0], pair[1]));
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
  const mapLight = (layer: number): CascadeLight => {
    const light = new CascadeLight();
    light.shadow = sun.shadow.clone();
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = false;
    // the map holds the casters of one layer only
    light.shadow.camera.layers.set(layer);
    return light;
  };
  for (let i = 0; i < CASCADE_COUNT; i++) {
    const pieces = mapLight(PIECE_SHADOW_LAYER);
    // a texel of a piece map is about a pixel on screen, and the edge of a
    // piece's shadow is short: one filtered lookup is enough, where the
    // ground's shadow takes five
    (pieces.shadow as unknown as { filterNode: unknown }).filterNode = BasicShadowFilter;
    cascades.push({
      ground: mapLight(GROUND_SHADOW_LAYER),
      pieces,
      centre: uniform(new Vector3()),
      half: uniform(1),
      fit: null,
    });
  }
  let shadowDraws = 0;
  let pieceShadowDraws = 0;
  let shadowTriangles = 0;
  const cascadeNode = new CascadeShadowNode(sun, cascades, right, up, (layer, triangles) => {
    shadowDraws++;
    if (layer === 'pieces') pieceShadowDraws++;
    shadowTriangles += triangles;
  });
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

  return {
    sunDirection,
    environment: environmentTarget.texture,
    get shadowDraws() {
      return shadowDraws;
    },
    get pieceShadowDraws() {
      return pieceShadowDraws;
    },
    get shadowTriangles() {
      return shadowTriangles;
    },
    update(target, distance, tilt, changed, seconds) {
      shadowTriangles = 0;
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
      for (const [index, cascade] of cascades.entries()) {
        const refit = stepped || cascadeNeedsFit(cascade.fit, target.x, target.z, distance);
        const draw = shadowRedraw(refit, changed);
        if (refit) {
          const half = cascadeHalf(index, distance, mapSpan);
          cascade.fit = { x: target.x, z: target.z, distance, half };
          cascade.centre.value.copy(target);
          cascade.half.value = half;
          // far enough back to see over every mountain between it and the ground
          const back = half * 3 + heightSpan * 2;
          for (const light of [cascade.ground, cascade.pieces]) {
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
        }
        if (draw.ground) cascade.ground.shadow.needsUpdate = true;
        if (draw.pieces) cascade.pieces.shadow.needsUpdate = true;
        if (draw.ground || draw.pieces) redraw = true;
      }

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
      for (const cascade of cascades) {
        cascade.ground.shadow.dispose();
        cascade.pieces.shadow.dispose();
      }
      sun.dispose();
      sky.dispose();
      environmentTarget.dispose();
      scene.fogNode = null;
      scene.backgroundNode = null;
    },
  };
}
