/**
 * Unit pieces: thick round discs like xiangqi pieces. On top, one Chinese
 * character (gold in a dark field for unique units), a broad ring in the
 * owner's colour between two lines and a ring of hit-point ticks along the
 * rim; around the side a band in the owner's colour; a material per era
 * that mirrors the sky, and a soft shade on the ground under it. All pieces
 * are one instanced mesh, so a thousand of them cost one draw call.
 *
 * A piece is never drawn smaller than a readable size (`pieceLayout.ts`):
 * from far away it grows with the distance and turns into a marker, pieces
 * of one owner that would overlap merge into a stack with a count, and the
 * markers of different owners make room for each other. Pieces are drawn
 * after the cloud layer, so cloud never covers them.
 *
 * In the shadow map a piece is a plain disc of a tenth of the triangles (one
 * more instanced mesh, placed by the same matrices), drawn into the piece
 * layer's own shadow maps: a piece in motion costs one small pass, not a new
 * shadow of the whole ground.
 */

import {
  abs,
  atan,
  attribute,
  color,
  dot,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  normalGeometry,
  positionGeometry,
  saturate,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node, Texture, UniformNode } from 'three/webgpu';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import { surfaceHeightAt, surfaceHeightAtHex } from './heightField.ts';
import type { Surface } from './heightField.ts';
import {
  GARRISON_OFFSET,
  garrisonZoomScale,
  markerShare,
  pieceHeightScale,
  pieceStrength,
  spreadMarkers,
  stackCountText,
  stackPieces,
} from './pieceLayout.ts';
import type { StackMarker, Standing } from './pieceLayout.ts';
import { PIECE_AROUND, PIECE_HEIGHT, PIECE_RADIUS, pieceCasterMesh, pieceOutline } from './pieceShape.ts';
import {
  BAND_FROM,
  BAND_TO,
  ERA_MATERIALS,
  FACE,
  GOLD,
  GOLD_FIELD,
  GRAIN_BRIGHTEST,
  GRAIN_DARKEST,
  KEYLINE_DARK,
  KEYLINE_PALE,
  KEYLINE_SWITCH,
} from './pieceStyle.ts';
import type { RenderUnit } from './scene.ts';
import { noise } from './shaderLib.ts';
import { PIECE_SHADOW_LAYER } from './shadowLayers.ts';

/** Where a piece is drawn while it is animated. */
export interface PiecePose {
  /** Position of the middle of its underside. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Angle by which it is tipped over, in radians, and the direction it falls in. */
  readonly tilt?: number;
  readonly tiltX?: number;
  readonly tiltZ?: number;
  /** Size, 1 if omitted; 0 hides the piece. */
  readonly scale?: number;
}

/** A piece or a stack as it is drawn. */
export interface DrawnMarker {
  /** The unit whose piece is drawn. */
  readonly id: number;
  /** The hex that unit stands on. */
  readonly hex: number;
  /** The middle of the top face. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radius and height of the piece as drawn, in world units. */
  readonly radius: number;
  readonly height: number;
  /** Pieces it stands for. */
  readonly count: number;
}

export interface Pieces {
  readonly object: InstancedMesh;
  /** The soft dark patch on the ground under every piece. */
  readonly shadows: InstancedMesh;
  /**
   * Grows whenever a piece is placed, moved, tipped or resized: whoever
   * draws the shadows of the pieces draws them again when it has changed.
   */
  readonly version: number;
  /**
   * Says which hexes hold a city: a piece on one of them stands before the
   * city's gate, not on the city. Call it before {@link Pieces.setUnits}.
   */
  setCitySites(hexes: ReadonlySet<number>): void;
  /** Replaces the pieces. Every pose and effect set since the last call is dropped. */
  setUnits(units: readonly RenderUnit[]): void;
  /**
   * Sets how the least size of a piece on screen compares with its size on
   * the board (`pieceFit`), and lays the pieces out again if it changed:
   * their size, stacks, the room markers make for each other, and their
   * height over the ground.
   */
  setFit(fit: number): void;
  /** The factor now in use. */
  readonly zoom: number;
  /** What is drawn: one entry per piece or stack, where it is drawn. The list is replaced whenever it changes. */
  readonly markers: readonly DrawnMarker[];
  /** Of {@link Pieces.markers}, how many stand for more than one piece. */
  readonly stacks: number;
  /** Whether a unit with this id is on the board. */
  has(id: number): boolean;
  /** The hex a unit was placed on by `setUnits`, or `null`. */
  hexOf(id: number): number | null;
  /** Where a piece stands when it is on a hex. */
  standOn(hex: number): PiecePose;
  /** Draws a unit's piece somewhere else than on its hex. */
  setPose(id: number, pose: PiecePose): void;
  /**
   * Effects on a unit's piece.
   *
   * @param flash a golden glow, 0 to 1.
   * @param crack how far cracks have spread over it, 0 to 1.
   */
  setEffect(id: number, flash: number, crack: number): void;
  dispose(): void;
}

/** Shape of a piece, as fractions of the hex size. */
const RADIUS = PIECE_RADIUS;
const HEIGHT = PIECE_HEIGHT;
/** How deep a piece sits in the water at sea, as a fraction of its height. */
const DRAFT = 0.25;

const ATLAS_SIZE = 2048;
const ATLAS_CELLS = 16;
const GLYPH_FONT = '"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif';

/** A canvas of characters, drawn as they are first needed. */
class GlyphAtlas {
  readonly texture: CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly cells = new Map<string, number>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('2D canvas is not available');
    this.context = context;
    context.fillStyle = '#000';
    context.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
  }

  /** The cell of a character, drawing it first if it is new. */
  cell(character: string): number {
    const known = this.cells.get(character);
    if (known !== undefined) return known;
    // when the atlas is full, further characters share the last cell
    const cell = Math.min(this.cells.size, ATLAS_CELLS * ATLAS_CELLS - 1);
    this.cells.set(character, cell);
    const size = ATLAS_SIZE / ATLAS_CELLS;
    const x = (cell % ATLAS_CELLS) * size;
    const y = Math.floor(cell / ATLAS_CELLS) * size;
    const context = this.context;
    context.fillStyle = '#000';
    context.fillRect(x, y, size, size);
    context.fillStyle = '#fff';
    context.font = `900 ${size * 0.8}px ${GLYPH_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(character, x + size / 2, y + size * 0.54, size);
    this.texture.needsUpdate = true;
    return cell;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** A disc with rounded edges, standing on y = 0. The underside is left open. */
function buildPieceGeometry(): BufferGeometry {
  const outline = pieceOutline();

  const AROUND = PIECE_AROUND;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let a = 0; a <= AROUND; a++) {
    const angle = (a / AROUND) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [r, y, nr, ny] of outline) {
      positions.push(r * cos, y, r * sin);
      normals.push(nr * cos, ny, nr * sin);
    }
  }
  const ring = outline.length;
  for (let a = 0; a < AROUND; a++) {
    for (let k = 0; k < ring - 1; k++) {
      const p = a * ring + k;
      indices.push(p, p + ring, p + 1, p + 1, p + ring, p + ring + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  return geometry;
}

type Float = Node<'float'>;

/** Where the count of a stack sits on the top face, and how large it is, as fractions of the piece's radius. */
const BADGE_X = 0.5;
const BADGE_Z = -0.5;
const BADGE_RADIUS = 0.33;

function createMaterial(atlas: GlyphAtlas, environment: Texture, marker: UniformNode<'float'>): MeshStandardNodeMaterial {
  // per piece: glyph cell, era, unique flag, hit points
  const data = attribute('pieceData', 'vec4');
  const bandColor = attribute('pieceColor', 'vec3');
  // per piece: golden flash and spread of cracks while animated; the atlas cell of a stack's count, or -1
  const effect = attribute('pieceEffect', 'vec3');
  const era = data.y;
  const unique = data.z;
  const hp = data.w;

  /** The entry of `values` for this piece's era, without integer maths. */
  const byEra = (values: readonly number[]): Float => {
    let sum: Float = float(0);
    values.forEach((value, k) => {
      sum = float(sum.add(float(value).mul(saturate(float(1).sub(abs(era.sub(k)))))));
    });
    return sum;
  };
  const colorByEra = (hexes: readonly number[]): Node<'vec3'> => {
    const colors = hexes.map((hex) => new Color().setHex(hex));
    return vec3(byEra(colors.map((c) => c.r)), byEra(colors.map((c) => c.g)), byEra(colors.map((c) => c.b)));
  };

  const g = positionGeometry;
  const n = normalGeometry;
  const radius = float(length(g.xz).div(RADIUS));
  const top = smoothstep(0.75, 0.95, n.y);
  const side = smoothstep(0.75, 0.95, float(1).sub(abs(n.y)));
  // edges on the top face are as soft as a pixel is wide, so that a small piece does not shimmer
  const soft = max(fwidth(radius), 0.006);
  const asFloat = (value: Float | number): Float => (typeof value === 'number' ? float(value) : value);
  /** 1 between two radii of the top face. */
  const between = (from: Float | number, to: Float | number): Float => {
    const a = asFloat(from);
    const b = asFloat(to);
    return float(smoothstep(a.sub(soft), a.add(soft), radius).mul(float(1).sub(smoothstep(b.sub(soft), b.add(soft), radius))));
  };

  // the body: the era's material with some grain, different on every piece
  const seed = data.x.mul(7.31).add(era.mul(3.7));
  const grain = noise(vec3(g.x.mul(26), g.y.mul(9), g.z.mul(26)).add(seed)).mul(0.5).add(0.5);
  const veins = sin(g.x.mul(31).add(g.z.mul(17)).add(grain.mul(6))).mul(0.5).add(0.5);
  let body = colorByEra(ERA_MATERIALS.map((m) => m.body));
  body = vec3(body.mul(mix(float(GRAIN_DARKEST), float(GRAIN_BRIGHTEST), saturate(grain.mul(0.7).add(veins.mul(0.3))))));

  // the band in the owner's colour around the side
  const y = g.y.div(HEIGHT);
  const band = side.mul(smoothstep(BAND_FROM - 0.03, BAND_FROM + 0.03, y)).mul(float(1).sub(smoothstep(BAND_TO - 0.03, BAND_TO + 0.03, y)));

  // a unique unit's character is gold in a field of dark lacquer
  const field = float(1).sub(smoothstep(float(FACE.fieldEdge).sub(soft), float(FACE.fieldEdge).add(soft), radius)).mul(top).mul(unique);

  // the character, engraved in the middle
  const GLYPH_BOX = RADIUS * FACE.glyphHalf;
  /** The value of an atlas cell at a point of a square of half side `half` around (`cx`, `cz`). */
  const glyphAt = (cell: Float, cx: number, cz: number, half: number): Float => {
    const local = vec2(g.x.sub(cx).div(half * 2).add(0.5), float(0.5).sub(g.z.sub(cz).div(half * 2)));
    const inBox = step(0, local.x).mul(step(local.x, 1)).mul(step(0, local.y)).mul(step(local.y, 1));
    const cellX = float(cell.sub(floor(cell.div(ATLAS_CELLS)).mul(ATLAS_CELLS)));
    const cellY = floor(cell.div(ATLAS_CELLS));
    // the canvas is flipped on upload: its top row is at v = 1
    const atlasUv = vec2(
      cellX.add(local.x).div(ATLAS_CELLS),
      float(1).sub(cellY.add(float(1).sub(local.y)).div(ATLAS_CELLS)),
    );
    // a level finer than the size on screen asks for: a small character stays crisp
    return float(texture(atlas.texture, atlasUv).bias(float(-0.8)).r.mul(inBox));
  };
  const engraved = glyphAt(data.x, 0, 0, GLYPH_BOX).mul(top);
  const ink = mix(colorByEra(ERA_MATERIALS.map((m) => m.ink)), color(GOLD), unique);

  // the owner's ring between two lines that set it off: pale beside a dark colour, dark beside a bright one
  const ringOuter = mix(float(FACE.ringOuter), float(FACE.ringOuterMarker), marker);
  const lineOuter = ringOuter.add(mix(float(FACE.outerLine), float(FACE.outerLineMarker), marker));
  const ring = between(FACE.ringInner, ringOuter).mul(top);
  const lines = max(between(FACE.fieldEdge, FACE.ringInner), between(ringOuter, lineOuter)).mul(top);
  const ringLuminance = dot(bandColor, vec3(0.2126, 0.7152, 0.0722));
  const lineColor = mix(color(KEYLINE_DARK), color(KEYLINE_PALE), step(ringLuminance, KEYLINE_SWITCH));

  // hit points: ticks around the rim that go dark as they are lost; a marker has none
  const TICKS = 20;
  const turn = atan(g.x, g.z.negate()).div(Math.PI * 2).add(0.5);
  const within = fract(turn.mul(TICKS));
  const tick = smoothstep(0.14, 0.24, within)
    .mul(float(1).sub(smoothstep(0.76, 0.86, within)))
    .mul(between(FACE.ticksInner, FACE.ticksOuter))
    .mul(top)
    .mul(float(1).sub(marker));
  const lit = step(floor(turn.mul(TICKS)).add(0.5).div(TICKS), hp);
  const tickColor = mix(color(0x16130f), color(0xf6ecc9), lit);

  // the count of a stack: a dark disc with a pale rim and the number in it
  const stacked = step(0, effect.z);
  const fromBadge = float(length(g.xz.div(RADIUS).sub(vec2(BADGE_X, BADGE_Z))));
  const badge = float(1).sub(smoothstep(float(BADGE_RADIUS).sub(soft), float(BADGE_RADIUS).add(soft), fromBadge)).mul(top).mul(stacked);
  const badgeRim = smoothstep(float(BADGE_RADIUS - 0.07).sub(soft), float(BADGE_RADIUS - 0.07).add(soft), fromBadge);
  const numeral = glyphAt(max(effect.z, 0), BADGE_X * RADIUS, BADGE_Z * RADIUS, BADGE_RADIUS * 0.74 * RADIUS);
  const badgeColor = mix(color(0x17130f), color(0xf6ecc9), max(badgeRim, numeral));

  let surface = mix(body, bandColor, band);
  surface = mix(surface, color(GOLD_FIELD), field);
  surface = mix(surface, ink, engraved);
  surface = mix(surface, bandColor, ring);
  surface = mix(surface, lineColor, lines);
  surface = mix(surface, tickColor, tick);
  surface = mix(surface, badgeColor, badge);

  // cracks: dark lines that grow out of a noise pattern as the piece breaks
  const fracture = abs(noise(vec3(g.x.mul(7.5), g.y.mul(5), g.z.mul(7.5)).add(seed)));
  const cracks = float(1).sub(smoothstep(0, effect.y.mul(0.11).add(0.0001), fracture)).mul(step(0.001, effect.y));
  surface = mix(surface, vec3(0.03, 0.025, 0.02), cracks);
  surface = mix(surface, color(0xfff0b8), effect.x.mul(0.45));

  const goldFill = engraved.mul(unique);
  // what is painted on: neither the ring nor the lines, the ticks or the count take the material's polish
  const painted = max(max(band, tick), max(max(ring, lines), max(badge, field.mul(float(1).sub(engraved)))));
  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(surface);
  material.roughnessNode = mix(
    mix(byEra(ERA_MATERIALS.map((m) => m.roughness)), float(0.45), painted),
    float(0.28),
    goldFill,
  );
  material.metalnessNode = mix(
    byEra(ERA_MATERIALS.map((m) => m.metalness)).mul(float(1).sub(max(painted, engraved))),
    float(0.9),
    goldFill,
  );
  // the polished materials mirror the sky
  material.envMap = environment;
  material.envMapIntensity = 0.1;
  // lit ticks, gold, the owner's ring and the count stay readable in shadow
  material.emissiveNode = vec3(
    tickColor
      .mul(tick)
      .mul(lit)
      .mul(0.35)
      .add(color(GOLD).mul(goldFill).mul(0.25))
      .add(bandColor.mul(ring).mul(0.16))
      .add(badgeColor.mul(badge).mul(0.3))
      .add(color(GOLD).mul(effect.x).mul(0.9)),
  );
  // drawn with the transparent things, after the cloud layer: cloud never covers a piece
  material.transparent = true;
  material.depthWrite = true;
  material.forceSinglePass = true;
  return material;
}

/** Radius of the patch of shade under a piece, and how far over the ground it lies, as fractions of the hex size. */
const SHADE_RADIUS = 0.8;
const SHADE_LIFT = 0.016;
/** Pieces are drawn after the cloud layer (`clouds.ts`, order 8). */
const PIECE_ORDER = 9;

/** Where a piece of the scene is in the instance buffers, and what is known about it. */
interface Slot {
  readonly index: number;
  readonly unit: RenderUnit;
  /** Where it is drawn while an animation holds it; `null` while it stands on its hex. */
  pose: PiecePose | null;
}

/**
 * @param environment the sky, which the polished pieces mirror.
 */
export function createPieces(surface: Surface, environment: Texture): Pieces {
  const { map } = surface;
  const layout = map.projection.hexLayout;
  const atlas = new GlyphAtlas();
  const geometry = buildPieceGeometry();
  const markerUniform = uniform(0);
  const material = createMaterial(atlas, environment, markerUniform);

  // the base shadow: a flat disc that is darkest under the rim of the piece
  const shadeGeometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const shadeMaterial = new MeshBasicNodeMaterial();
  const fromCentre = length(positionGeometry.xz);
  shadeMaterial.colorNode = vec3(0.02, 0.018, 0.015);
  shadeMaterial.opacityNode = smoothstep(1, RADIUS / SHADE_RADIUS, fromCentre).mul(0.42);
  shadeMaterial.transparent = true;
  shadeMaterial.depthWrite = false;
  shadeMaterial.polygonOffset = true;
  shadeMaterial.polygonOffsetFactor = -5;
  shadeMaterial.polygonOffsetUnits = -5;
  const allocateShadows = (size: number): InstancedMesh => {
    const created = new InstancedMesh(shadeGeometry, shadeMaterial, size);
    created.name = 'pieceShadows';
    created.count = 0;
    created.frustumCulled = false;
    created.renderOrder = 1;
    return created;
  };
  let shadows: InstancedMesh = allocateShadows(256);
  /** Lays the shade of instance `index` on the ground under a point. */
  const shade = (index: number, x: number, z: number, scale: number): void => {
    const reach = SHADE_RADIUS * layout.size * scale;
    matrix.makeScale(reach, 1, reach).setPosition(x, surfaceHeightAt(surface, x, z) + SHADE_LIFT * layout.size, z);
    shadows.setMatrixAt(index, matrix);
    shadows.instanceMatrix.needsUpdate = true;
  };
  const polityColors = map.polities.map((polity) => new Color().setHex(polity.color));
  const fallbackColor = new Color(0x888888);

  // what casts the shadows: a coarse disc per piece, seen by the shadow cameras of the piece layer only
  const caster = pieceCasterMesh();
  const casterGeometry = new BufferGeometry();
  casterGeometry.setAttribute('position', new BufferAttribute(new Float32Array(caster.positions), 3));
  casterGeometry.setIndex(caster.indices);
  const casterMaterial = new MeshBasicNodeMaterial();
  // the side towards the sun is the shadow: the disc lies inside the piece, so the piece's own face stays lit
  casterMaterial.shadowSide = FrontSide;

  let capacity = 0;
  let version = 0;
  let casters!: InstancedMesh;
  let mesh = allocate(256);

  function allocate(size: number): InstancedMesh {
    capacity = size;
    geometry.setAttribute('pieceData', new InstancedBufferAttribute(new Float32Array(size * 4), 4));
    geometry.setAttribute('pieceColor', new InstancedBufferAttribute(new Float32Array(size * 3), 3));
    geometry.setAttribute('pieceEffect', new InstancedBufferAttribute(new Float32Array(size * 3), 3));
    const created = new InstancedMesh(geometry, material, size);
    created.name = 'pieces';
    created.count = 0;
    created.receiveShadow = true;
    // instances are spread over the whole map
    created.frustumCulled = false;
    created.renderOrder = PIECE_ORDER;
    // the casters go wherever the pieces go: one set of matrices for both
    casters = new InstancedMesh(casterGeometry, casterMaterial, size);
    casters.name = 'pieceCasters';
    casters.instanceMatrix = created.instanceMatrix;
    casters.count = 0;
    casters.castShadow = true;
    casters.frustumCulled = false;
    casters.layers.set(PIECE_SHADOW_LAYER);
    created.add(casters);
    return created;
  }

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3();
  const position = new Vector3();
  const scale = new Vector3();
  /** Unit id to its slot. */
  const slots = new Map<number, Slot>();
  let citySites: ReadonlySet<number> = new Set();
  let fit = 0;
  let zoom = 1;
  let drawn: DrawnMarker[] = [];
  let stacks = 0;

  const standOn = (hex: number): PiecePose => {
    const p = hexToWorld(indexToOffset(hex, map.width), layout);
    // before the gate of a city, not on it
    const z = p.z + (citySites.has(hex) ? GARRISON_OFFSET * layout.size : 0);
    const afloat = !Number.isNaN(surface.waterLevel[hex] as number);
    const ground = z === p.z ? surfaceHeightAtHex(surface, hex) : surfaceHeightAt(surface, p.x, z);
    return { x: p.x, y: ground - (afloat ? DRAFT * HEIGHT * layout.size : 0), z };
  };

  /** The highest ground under a piece of radius `radius` around a point. */
  const groundUnder = (x: number, z: number, radius: number): number => {
    let top = surfaceHeightAt(surface, x, z);
    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2;
      for (const share of [0.5, 0.95]) {
        top = Math.max(top, surfaceHeightAt(surface, x + Math.cos(angle) * radius * share, z + Math.sin(angle) * radius * share));
      }
    }
    return top;
  };

  /** Writes the matrix of a slot: a piece at a pose, as large as the zoom makes it. */
  const place = (slot: Slot, pose: PiecePose): void => {
    const own = pose.scale ?? 1;
    const across = layout.size * own * zoom;
    const tall = layout.size * own * pieceHeightScale(zoom);
    // tipping over turns the piece about the horizontal axis across its fall
    axis.set(pose.tiltZ ?? 0, 0, -(pose.tiltX ?? 1));
    if (axis.lengthSq() < 1e-9) axis.set(0, 0, -1);
    rotation.setFromAxisAngle(axis.normalize(), pose.tilt ?? 0);
    matrix.compose(position.set(pose.x, pose.y, pose.z), rotation, scale.set(across, tall, across));
    mesh.setMatrixAt(slot.index, matrix);
    shade(slot.index, pose.x, pose.z, own * zoom);
  };

  /** Lays every piece out for the current zoom: stacks, the room markers make, heights. */
  const relayout = (): void => {
    version++;
    const effects = geometry.getAttribute('pieceEffect') as InstancedBufferAttribute;
    const radius = RADIUS * layout.size * zoom;
    const standing: Standing[] = [];
    const stands = new Map<number, PiecePose>();
    for (const [id, slot] of slots) {
      if (slot.pose !== null) continue;
      let stand = standOn(slot.unit.hex);
      if (zoom > 1 && citySites.has(slot.unit.hex)) {
        // a grown garrison keeps clear of the city's marker, which lies north of the middle of the hex
        stand = { ...stand, z: stand.z + GARRISON_OFFSET * layout.size * (zoom - 1) };
      }
      stands.set(id, stand);
      standing.push({ id, polity: slot.unit.polity, x: stand.x, z: stand.z, strength: pieceStrength(slot.unit) });
    }
    // on the board nothing overlaps: every piece is its own marker
    // before its city, a piece is smaller than in the field for as long as that is readable
    const garrisonOwn = garrisonZoomScale(fit) / zoom;
    const markers: StackMarker[] =
      zoom > 1
        ? spreadMarkers(stackPieces(standing, radius), radius)
        : standing.map((piece) => ({ id: piece.id, polity: piece.polity, x: piece.x, z: piece.z, count: 1, members: [piece.id] }));
    const next: DrawnMarker[] = [];
    stacks = 0;
    const top = HEIGHT * layout.size * pieceHeightScale(zoom);
    for (const marker of markers) {
      const slot = slots.get(marker.id) as Slot;
      const stand = stands.get(marker.id) as PiecePose;
      // a grown piece covers its neighbours' ground too, and stands on the highest of it
      const y = zoom > 1 ? Math.max(stand.y, groundUnder(marker.x, marker.z, radius)) : stand.y;
      const own = citySites.has(slot.unit.hex) ? garrisonOwn : 1;
      place(slot, { x: marker.x, y, z: marker.z, scale: own });
      effects.setZ(slot.index, marker.count > 1 ? atlas.cell(stackCountText(marker.count)) : -1);
      if (marker.count > 1) stacks++;
      for (const member of marker.members) {
        if (member === marker.id) continue;
        // in the stack: not drawn by itself
        const hidden = slots.get(member) as Slot;
        place(hidden, { ...(stands.get(member) as PiecePose), scale: 0 });
      }
      next.push({
        id: marker.id,
        hex: slot.unit.hex,
        x: marker.x,
        y: y + top * own,
        z: marker.z,
        radius: radius * own,
        height: top * own,
        count: marker.count,
      });
    }
    for (const slot of slots.values()) {
      if (slot.pose === null) continue;
      place(slot, slot.pose);
      effects.setZ(slot.index, -1);
    }
    drawn = next;
    mesh.instanceMatrix.needsUpdate = true;
    effects.needsUpdate = true;
  };

  const pieces: Pieces = {
    get object() {
      return mesh;
    },
    get shadows() {
      return shadows;
    },
    get version() {
      return version;
    },
    get zoom() {
      return zoom;
    },
    get markers() {
      return drawn;
    },
    get stacks() {
      return stacks;
    },
    setCitySites(hexes) {
      citySites = hexes;
    },
    setFit(next) {
      const value = Number.isFinite(next) && next > 0 ? next : 0;
      if (value === fit) return;
      // below 1 only the garrisons change, and only down to their own scale
      const same = Math.max(1, value) === zoom && garrisonZoomScale(value) === garrisonZoomScale(fit);
      fit = value;
      if (same) return;
      zoom = Math.max(1, fit);
      markerUniform.value = markerShare(zoom);
      relayout();
    },
    setUnits(units) {
      if (units.length > capacity) {
        const shadeParent = shadows.parent;
        shadeParent?.remove(shadows);
        shadows.dispose();
        let shadeSize = capacity;
        while (shadeSize < units.length) shadeSize *= 2;
        shadows = allocateShadows(shadeSize);
        shadeParent?.add(shadows);
        const parent = mesh.parent;
        parent?.remove(mesh);
        mesh.remove(casters);
        casters.dispose();
        mesh.dispose();
        let size = capacity;
        while (size < units.length) size *= 2;
        mesh = allocate(size);
        parent?.add(mesh);
      }
      const data = geometry.getAttribute('pieceData') as InstancedBufferAttribute;
      const colors = geometry.getAttribute('pieceColor') as InstancedBufferAttribute;
      const effects = geometry.getAttribute('pieceEffect') as InstancedBufferAttribute;
      slots.clear();
      units.forEach((unit, i) => {
        slots.set(unit.id, { index: i, unit, pose: null });
        // one character per piece; anything longer shows its first character
        const character = [...unit.character][0] ?? '';
        data.setXYZW(i, atlas.cell(character), unit.era, unit.unique ? 1 : 0, Math.min(Math.max(unit.hp, 0), 1));
        const band = polityColors[unit.polity] ?? fallbackColor;
        colors.setXYZ(i, band.r, band.g, band.b);
        effects.setXYZ(i, 0, 0, -1);
      });
      shadows.count = units.length;
      mesh.count = units.length;
      casters.count = units.length;
      data.needsUpdate = true;
      colors.needsUpdate = true;
      relayout();
    },
    has(id) {
      return slots.has(id);
    },
    hexOf(id) {
      return slots.get(id)?.unit.hex ?? null;
    },
    standOn,
    setPose(id, pose) {
      const slot = slots.get(id);
      if (slot === undefined) return;
      const wasStanding = slot.pose === null;
      slot.pose = pose;
      if (wasStanding && zoom > 1) {
        // it leaves its stack, or makes room in the layout: the others close up
        relayout();
        return;
      }
      version++;
      if (wasStanding) drawn = drawn.filter((marker) => marker.id !== id);
      place(slot, pose);
      mesh.instanceMatrix.needsUpdate = true;
    },
    setEffect(id, flash, crack) {
      const slot = slots.get(id);
      if (slot === undefined) return;
      const effects = geometry.getAttribute('pieceEffect') as InstancedBufferAttribute;
      effects.setXY(slot.index, flash, crack);
      effects.needsUpdate = true;
    },
    dispose() {
      casters.dispose();
      casterGeometry.dispose();
      casterMaterial.dispose();
      mesh.dispose();
      shadows.dispose();
      shadeGeometry.dispose();
      shadeMaterial.dispose();
      geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
  return pieces;
}
