/**
 * Unit pieces: thick round discs like xiangqi pieces, with a band in the
 * polity colour around the side, one Chinese character engraved on top
 * (filled with gold for unique units), a material per era and a ring of
 * hit-point ticks along the rim. All pieces are one instanced mesh, so a
 * thousand of them cost one draw call.
 */

import {
  abs,
  atan,
  attribute,
  color,
  float,
  floor,
  fract,
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
  vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import { surfaceHeightAtHex } from './heightField.ts';
import type { Surface } from './heightField.ts';
import type { RenderUnit } from './scene.ts';
import { noise } from './shaderLib.ts';

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

export interface Pieces {
  readonly object: InstancedMesh;
  /** Replaces the pieces. Every pose and effect set since the last call is dropped. */
  setUnits(units: readonly RenderUnit[]): void;
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
const RADIUS = 0.54;
const HEIGHT = 0.3;
const BEVEL = 0.055;
/** How deep a piece sits in the water at sea, as a fraction of its height. */
const DRAFT = 0.25;

/** Per era: body colour, roughness, metalness, and the colour of the engraving. */
const ERA_MATERIALS: readonly (readonly [body: number, rough: number, metal: number, ink: number])[] = [
  [0xb9875a, 0.85, 0.0, 0x2a1a10], // pottery and wood
  [0xa87a3a, 0.42, 0.6, 0x1d2b22], // bronze
  [0x5e1014, 0.18, 0.0, 0xe9dcc0], // lacquer
  [0x7fbf9d, 0.22, 0.0, 0x1f3a2e], // jade
  [0xd0aa4e, 0.3, 0.65, 0x2b2010], // brass
  [0x8f99a3, 0.36, 0.55, 0xe4ebf2], // steel
];
const GOLD = 0xf0bf45;

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
  // the outline from the centre of the top to the bottom rim: radius, height, normal
  const outline: (readonly [r: number, y: number, nr: number, ny: number])[] = [
    [0, HEIGHT, 0, 1],
    [RADIUS - BEVEL, HEIGHT, 0, 1],
  ];
  const ARC = 3;
  for (let s = 1; s < ARC; s++) {
    const a = (s / ARC) * (Math.PI / 2);
    outline.push([RADIUS - BEVEL + BEVEL * Math.sin(a), HEIGHT - BEVEL + BEVEL * Math.cos(a), Math.sin(a), Math.cos(a)]);
  }
  outline.push([RADIUS, HEIGHT - BEVEL, 1, 0], [RADIUS, BEVEL, 1, 0]);
  for (let s = 1; s <= ARC; s++) {
    const a = Math.PI / 2 + (s / ARC) * (Math.PI / 2);
    outline.push([RADIUS - BEVEL + BEVEL * Math.sin(a), BEVEL + BEVEL * Math.cos(a), Math.sin(a), Math.cos(a)]);
  }

  const AROUND = 36;
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

function createMaterial(atlas: GlyphAtlas): MeshStandardNodeMaterial {
  // per piece: glyph cell, era, unique flag, hit points
  const data = attribute('pieceData', 'vec4');
  const bandColor = attribute('pieceColor', 'vec3');
  // per piece, while animated: golden flash, spread of cracks
  const effect = attribute('pieceEffect', 'vec2');
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

  // the body: the era's material with some grain, different on every piece
  const seed = data.x.mul(7.31).add(era.mul(3.7));
  const grain = noise(vec3(g.x.mul(26), g.y.mul(9), g.z.mul(26)).add(seed)).mul(0.5).add(0.5);
  const veins = sin(g.x.mul(31).add(g.z.mul(17)).add(grain.mul(6))).mul(0.5).add(0.5);
  let body = colorByEra(ERA_MATERIALS.map((m) => m[0]));
  body = vec3(body.mul(mix(float(0.82), float(1.1), grain.mul(0.7).add(veins.mul(0.3)))));

  // the band in the polity colour around the side
  const y = g.y.div(HEIGHT);
  const band = side.mul(smoothstep(0.22, 0.27, y)).mul(float(1).sub(smoothstep(0.73, 0.78, y)));

  // the engraving on top: the character inside a thin circle
  const GLYPH_BOX = RADIUS * 0.58;
  const local = vec2(g.x.div(GLYPH_BOX * 2).add(0.5), float(0.5).sub(g.z.div(GLYPH_BOX * 2)));
  const inBox = step(0, local.x).mul(step(local.x, 1)).mul(step(0, local.y)).mul(step(local.y, 1));
  const cellX = float(data.x.sub(floor(data.x.div(ATLAS_CELLS)).mul(ATLAS_CELLS)));
  const cellY = floor(data.x.div(ATLAS_CELLS));
  // the canvas is flipped on upload: its top row is at v = 1
  const atlasUv = vec2(
    cellX.add(local.x).div(ATLAS_CELLS),
    float(1).sub(cellY.add(float(1).sub(local.y)).div(ATLAS_CELLS)),
  );
  const glyph = texture(atlas.texture, atlasUv).r.mul(inBox);
  const circle = float(1).sub(smoothstep(0.012, 0.024, abs(radius.sub(0.74))));
  const engraved = max(glyph, circle).mul(top);
  const ink = mix(colorByEra(ERA_MATERIALS.map((m) => m[3])), color(GOLD), unique);

  // hit points: ticks around the rim that go dark as they are lost
  const TICKS = 20;
  const turn = atan(g.x, g.z.negate()).div(Math.PI * 2).add(0.5);
  const within = fract(turn.mul(TICKS));
  const tick = smoothstep(0.14, 0.24, within)
    .mul(float(1).sub(smoothstep(0.76, 0.86, within)))
    .mul(smoothstep(0.8, 0.83, radius))
    .mul(float(1).sub(smoothstep(0.91, 0.94, radius)))
    .mul(top);
  const lit = step(floor(turn.mul(TICKS)).add(0.5).div(TICKS), hp);
  const tickColor = mix(color(0x16130f), color(0xf6ecc9), lit);

  let surface = mix(body, bandColor, band);
  surface = mix(surface, ink, engraved);
  surface = mix(surface, tickColor, tick);

  // cracks: dark lines that grow out of a noise pattern as the piece breaks
  const fracture = abs(noise(vec3(g.x.mul(7.5), g.y.mul(5), g.z.mul(7.5)).add(seed)));
  const cracks = float(1).sub(smoothstep(0, effect.y.mul(0.11).add(0.0001), fracture)).mul(step(0.001, effect.y));
  surface = mix(surface, vec3(0.03, 0.025, 0.02), cracks);
  surface = mix(surface, color(0xfff0b8), effect.x.mul(0.45));

  const goldFill = engraved.mul(unique);
  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(surface);
  material.roughnessNode = mix(
    mix(byEra(ERA_MATERIALS.map((m) => m[1])), float(0.4), max(band, tick)),
    float(0.28),
    goldFill,
  );
  material.metalnessNode = mix(
    byEra(ERA_MATERIALS.map((m) => m[2])).mul(float(1).sub(max(max(band, tick), engraved))),
    float(0.9),
    goldFill,
  );
  // lit ticks and gold stay readable in shadow
  material.emissiveNode = vec3(
    tickColor.mul(tick).mul(lit).mul(0.35).add(color(GOLD).mul(goldFill).mul(0.25)).add(color(GOLD).mul(effect.x).mul(0.9)),
  );
  return material;
}

export function createPieces(surface: Surface): Pieces {
  const { map } = surface;
  const layout = map.projection.hexLayout;
  const atlas = new GlyphAtlas();
  const geometry = buildPieceGeometry();
  const material = createMaterial(atlas);
  const polityColors = map.polities.map((polity) => new Color().setHex(polity.color));
  const fallbackColor = new Color(0x888888);

  let capacity = 0;
  let mesh = allocate(256);

  function allocate(size: number): InstancedMesh {
    capacity = size;
    geometry.setAttribute('pieceData', new InstancedBufferAttribute(new Float32Array(size * 4), 4));
    geometry.setAttribute('pieceColor', new InstancedBufferAttribute(new Float32Array(size * 3), 3));
    geometry.setAttribute('pieceEffect', new InstancedBufferAttribute(new Float32Array(size * 2), 2));
    const created = new InstancedMesh(geometry, material, size);
    created.name = 'pieces';
    created.count = 0;
    created.castShadow = true;
    created.receiveShadow = true;
    // instances are spread over the whole map
    created.frustumCulled = false;
    return created;
  }

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3();
  const position = new Vector3();
  const scale = new Vector3();
  /** Unit id to instance index and hex. */
  const slots = new Map<number, { readonly index: number; readonly hex: number }>();

  const standOn = (hex: number): PiecePose => {
    const p = hexToWorld(indexToOffset(hex, map.width), layout);
    const afloat = !Number.isNaN(surface.waterLevel[hex] as number);
    return { x: p.x, y: surfaceHeightAtHex(surface, hex) - (afloat ? DRAFT * HEIGHT * layout.size : 0), z: p.z };
  };

  const pieces: Pieces = {
    get object() {
      return mesh;
    },
    setUnits(units) {
      if (units.length > capacity) {
        const parent = mesh.parent;
        parent?.remove(mesh);
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
        slots.set(unit.id, { index: i, hex: unit.hex });
        const stand = standOn(unit.hex);
        matrix.makeScale(layout.size, layout.size, layout.size).setPosition(stand.x, stand.y, stand.z);
        mesh.setMatrixAt(i, matrix);
        // one character per piece; anything longer shows its first character
        const character = [...unit.character][0] ?? '';
        data.setXYZW(i, atlas.cell(character), unit.era, unit.unique ? 1 : 0, Math.min(Math.max(unit.hp, 0), 1));
        const band = polityColors[unit.polity] ?? fallbackColor;
        colors.setXYZ(i, band.r, band.g, band.b);
        effects.setXY(i, 0, 0);
      });
      mesh.count = units.length;
      mesh.instanceMatrix.needsUpdate = true;
      data.needsUpdate = true;
      colors.needsUpdate = true;
      effects.needsUpdate = true;
    },
    has(id) {
      return slots.has(id);
    },
    hexOf(id) {
      return slots.get(id)?.hex ?? null;
    },
    standOn,
    setPose(id, pose) {
      const slot = slots.get(id);
      if (slot === undefined) return;
      const size = layout.size * (pose.scale ?? 1);
      // tipping over turns the piece about the horizontal axis across its fall
      axis.set(pose.tiltZ ?? 0, 0, -(pose.tiltX ?? 1));
      if (axis.lengthSq() < 1e-9) axis.set(0, 0, -1);
      rotation.setFromAxisAngle(axis.normalize(), pose.tilt ?? 0);
      matrix.compose(position.set(pose.x, pose.y, pose.z), rotation, scale.set(size, size, size));
      mesh.setMatrixAt(slot.index, matrix);
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
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
  return pieces;
}
