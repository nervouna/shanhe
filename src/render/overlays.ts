/**
 * Things drawn on top of the ground along hex edges and over whole hexes:
 * rivers, territory borders and hex highlights. All of them are thin meshes
 * draped over the relief.
 */

import { attribute, color, float, mix, positionLocal, positionWorld, sin, time, uniform, vec3 } from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
} from 'three/webgpu';
import { hexCorners, hexNeighbor, hexToWorld, indexToOffset } from '../shared/hex.ts';
import type { WorldPoint } from '../shared/hex.ts';
import { sampleHeight, surfaceHeightAt } from './heightField.ts';
import type { Surface } from './heightField.ts';
import type { MarkerLabel } from './labels.ts';
import type { HexHighlight, SelectionAids } from './scene.ts';
import { fbm } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface Overlays {
  readonly object: Group;
  /** Redraws the borders for a per-hex owner array (as `MapData.owner`). */
  setOwners(owner: Int16Array): void;
  setHighlights(highlights: readonly HexHighlight[]): void;
  /**
   * Replaces the aids for ordering a piece.
   *
   * @returns where the numbered turn markers of the path stand.
   */
  setAids(aids: SelectionAids | null): MarkerLabel[];
  /**
   * Marks hexes in a colour, for the sweep of a captured zone. An empty
   * list removes the marks.
   *
   * @param color as `0xRRGGBB`.
   */
  setSweep(hexes: readonly number[], color: number, opacity: number): void;
  dispose(): void;
}

/** Pieces an edge is cut into so that a ribbon follows the relief. */
const EDGE_SEGMENTS = 4;
/** Sizes as fractions of the hex size. */
const RIVER_WIDTH = 0.17;
const BORDER_WIDTH = 0.085;
const BORDER_INSET = 0.035;
const LIFT = 0.012;

function waterLevelOrLow(surface: Surface, hex: { col: number; row: number }): number {
  const { map } = surface;
  if (hex.col < 0 || hex.col >= map.width || hex.row < 0 || hex.row >= map.height) return -Infinity;
  const level = surface.waterLevel[hex.row * map.width + hex.col] as number;
  return Number.isNaN(level) ? -Infinity : level;
}

class MeshBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];
  /** Per vertex: where it moves per unit of extra width, see the border material. */
  readonly widen: number[] = [];
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number, r: number, g: number, b: number, a: number, u = 0, v = 0): number {
    this.positions.push(x, y, z);
    this.colors.push(r, g, b, a);
    this.uvs.push(u, v);
    this.widen.push(0, 0);
    return this.positions.length / 3 - 1;
  }

  /** Sets the direction in the ground plane the last vertex moves in when the mesh is widened. */
  widenLast(dx: number, dz: number): void {
    this.widen[this.widen.length - 2] = dx;
    this.widen[this.widen.length - 1] = dz;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('tint', new BufferAttribute(new Float32Array(this.colors), 4));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setAttribute('widen', new BufferAttribute(new Float32Array(this.widen), 2));
    const normals = new Float32Array(this.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function buildRivers(surface: Surface): BufferGeometry {
  const { map, field } = surface;
  const layout = map.projection.hexLayout;
  const half = (RIVER_WIDTH * layout.size) / 2;
  const lift = LIFT * layout.size;
  const mesh = new MeshBuilder();
  for (let i = 0; i < map.width * map.height; i++) {
    const edges = map.riverEdges[i] as number;
    if (edges === 0) continue;
    const hex = indexToOffset(i, map.width);
    const corners = hexCorners(hex, layout);
    // every edge is stored on both of its hexes; draw it from one of them
    for (let d = 0; d < 3; d++) {
      if ((edges & (1 << d)) === 0) continue;
      const from = corners[(d + 5) % 6] as WorldPoint;
      const to = corners[d] as WorldPoint;
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      const ax = (to.x - from.x) / length;
      const az = (to.z - from.z) / length;
      // a little longer than the edge, so that rivers join at the corners
      const start = -half * 0.6;
      const end = length + half * 0.6;
      let previous: [number, number] | null = null;
      for (let s = 0; s <= EDGE_SEGMENTS; s++) {
        const along = start + ((end - start) * s) / EDGE_SEGMENTS;
        const cx = from.x + ax * along;
        const cz = from.z + az * along;
        const pair: [number, number] = [0, 0];
        for (const side of [0, 1] as const) {
          const sign = side === 0 ? -1 : 1;
          const x = cx - az * half * sign;
          const z = cz + ax * half * sign;
          pair[side] = mesh.vertex(x, sampleHeight(field, x, z) + lift, z, 1, 1, 1, 1, sign, along / layout.size);
        }
        if (previous !== null) {
          mesh.indices.push(previous[0], previous[1], pair[0], pair[0], previous[1], pair[1]);
        }
        previous = pair;
      }
    }
  }
  return mesh.build();
}

function buildBorders(surface: Surface, owner: Int16Array, colors: readonly Color[]): BufferGeometry {
  const { map, field } = surface;
  const layout = map.projection.hexLayout;
  const lift = LIFT * layout.size;
  const inradius = (Math.sqrt(3) / 2) * layout.size;
  // the border runs just inside the hex, so two polities' lines lie side by side
  const outer = 1 - (BORDER_INSET * layout.size) / inradius;
  const inner = 1 - ((BORDER_INSET + BORDER_WIDTH) * layout.size) / inradius;
  const mesh = new MeshBuilder();
  for (let i = 0; i < map.width * map.height; i++) {
    const polity = owner[i] as number;
    const tint = colors[polity];
    if (polity < 0 || tint === undefined) continue;
    const hex = indexToOffset(i, map.width);
    const centre = hexToWorld(hex, layout);
    const corners = hexCorners(hex, layout);
    const ownLevel = waterLevelOrLow(surface, hex);
    for (let d = 0; d < 6; d++) {
      const neighbor = hexNeighbor(hex, d);
      const inside =
        neighbor.col >= 0 && neighbor.col < map.width && neighbor.row >= 0 && neighbor.row < map.height;
      if (inside && owner[neighbor.row * map.width + neighbor.col] === polity) continue;
      // along a shore the border lies on the water, not under it
      const floor = Math.max(ownLevel, waterLevelOrLow(surface, neighbor));
      const from = corners[(d + 5) % 6] as WorldPoint;
      const to = corners[d] as WorldPoint;
      let previous: [number, number] | null = null;
      for (let s = 0; s <= EDGE_SEGMENTS; s++) {
        const t = s / EDGE_SEGMENTS;
        const ex = from.x + (to.x - from.x) * t - centre.x;
        const ez = from.z + (to.z - from.z) * t - centre.z;
        const pair: [number, number] = [0, 0];
        for (const side of [0, 1] as const) {
          const k = side === 0 ? outer : inner;
          const x = centre.x + ex * k;
          const z = centre.z + ez * k;
          const y = Math.max(sampleHeight(field, x, z), floor) + lift;
          // opaque along the hex edge, fading towards the inside
          pair[side] = mesh.vertex(x, y, z, tint.r, tint.g, tint.b, side === 0 ? 1 : 0.55);
          // seen from far away the line grows towards the inside of the hex
          if (side === 1) mesh.widenLast(-ex / inradius, -ez / inradius);
        }
        if (previous !== null) {
          mesh.indices.push(previous[0], pair[0], previous[1], previous[1], pair[0], pair[1]);
        }
        previous = pair;
      }
    }
  }
  return mesh.build();
}

/** A patch over one hex that follows the relief, brighter towards the rim. */
function hexPatch(surface: Surface, mesh: MeshBuilder, index: number, tint: Color, alpha: number, reach = 0.94): void {
  const { map } = surface;
  const layout = map.projection.hexLayout;
  const lift = LIFT * 2 * layout.size;
  const hex = indexToOffset(index, map.width);
  const centre = hexToWorld(hex, layout);
  const corners = hexCorners(hex, layout);
  const at = (x: number, z: number, a: number): number =>
    mesh.vertex(x, surfaceHeightAt(surface, x, z) + lift, z, tint.r, tint.g, tint.b, a);
  // rings of points from the centre to the rim, so the patch follows the relief
  const RINGS = 3;
  const PER_EDGE = 2;
  const middle = at(centre.x, centre.z, alpha * 0.55);
  let previousRing: number[] = [];
  for (let ring = 1; ring <= RINGS; ring++) {
    const k = (ring / RINGS) * reach;
    const current: number[] = [];
    for (let c = 0; c < 6; c++) {
      const a = corners[c] as WorldPoint;
      const b = corners[(c + 1) % 6] as WorldPoint;
      for (let s = 0; s < PER_EDGE; s++) {
        const t = s / PER_EDGE;
        const x = centre.x + (a.x + (b.x - a.x) * t - centre.x) * k;
        const z = centre.z + (a.z + (b.z - a.z) * t - centre.z) * k;
        // brighter towards the rim, so the hex reads as outlined
        current.push(at(x, z, alpha * (0.55 + 0.45 * (ring / RINGS) ** 2)));
      }
    }
    const n = current.length;
    for (let s = 0; s < n; s++) {
      const next = (s + 1) % n;
      if (ring === 1) {
        mesh.indices.push(middle, current[next] as number, current[s] as number);
      } else {
        mesh.indices.push(
          previousRing[s] as number,
          current[next] as number,
          current[s] as number,
          previousRing[s] as number,
          previousRing[next] as number,
          current[next] as number,
        );
      }
    }
    previousRing = current;
  }
}

function buildHighlights(surface: Surface, highlights: readonly HexHighlight[]): BufferGeometry {
  const { map } = surface;
  const mesh = new MeshBuilder();
  const tint = new Color();
  for (const highlight of highlights) {
    if (highlight.hex < 0 || highlight.hex >= map.width * map.height) continue;
    tint.setHex(highlight.color);
    hexPatch(surface, mesh, highlight.hex, tint, highlight.opacity ?? 0.45);
  }
  return mesh.build();
}

/** Colours of the aids as `0xRRGGBB`. */
const AID_COLOR = 0xf2ede2;
const TARGET_COLOR = 0xe2452f;
/** Sizes of the aids as fractions of the hex size. */
const PATH_WIDTH = 0.15;
const OUTLINE_WIDTH = 0.07;

function buildAids(surface: Surface, aids: SelectionAids): { geometry: BufferGeometry; markers: MarkerLabel[] } {
  const { map } = surface;
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const lift = LIFT * 3 * size;
  const count = map.width * map.height;
  const valid = (hex: number): boolean => Number.isInteger(hex) && hex >= 0 && hex < count;
  const mesh = new MeshBuilder();
  const tint = new Color().setHex(aids.color ?? AID_COLOR);
  const markers: MarkerLabel[] = [];
  const ground = (x: number, z: number): number => surfaceHeightAt(surface, x, z) + lift;

  // the reachable area: a faint fill and a line around it
  const reachable = new Set((aids.reachable ?? []).filter(valid));
  const inradius = (Math.sqrt(3) / 2) * size;
  const inner = 1 - (OUTLINE_WIDTH * size) / inradius;
  for (const index of reachable) {
    hexPatch(surface, mesh, index, tint, 0.1, 1);
    const hex = indexToOffset(index, map.width);
    const centre = hexToWorld(hex, layout);
    const corners = hexCorners(hex, layout);
    for (let d = 0; d < 6; d++) {
      const neighbor = hexNeighbor(hex, d);
      const inside =
        neighbor.col >= 0 && neighbor.col < map.width && neighbor.row >= 0 && neighbor.row < map.height;
      if (inside && reachable.has(neighbor.row * map.width + neighbor.col)) continue;
      const from = corners[(d + 5) % 6] as WorldPoint;
      const to = corners[d] as WorldPoint;
      let previous: [number, number] | null = null;
      for (let s = 0; s <= EDGE_SEGMENTS; s++) {
        const t = s / EDGE_SEGMENTS;
        const ex = from.x + (to.x - from.x) * t - centre.x;
        const ez = from.z + (to.z - from.z) * t - centre.z;
        const pair: [number, number] = [0, 0];
        for (const side of [0, 1] as const) {
          const k = side === 0 ? 1 : inner;
          const x = centre.x + ex * k;
          const z = centre.z + ez * k;
          pair[side] = mesh.vertex(x, ground(x, z), z, tint.r, tint.g, tint.b, 0.9);
        }
        if (previous !== null) mesh.indices.push(previous[0], pair[0], previous[1], previous[1], pair[0], pair[1]);
        previous = pair;
      }
    }
  }

  /** A flat disc or ring around a point. `pulse` makes it throb. */
  const ring = (cx: number, cz: number, r0: number, r1: number, color: Color, alpha: number, pulse: number): void => {
    const SEGMENTS = 28;
    let previous: [number, number] | null = null;
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const pair: [number, number] = [0, 0];
      [r0, r1].forEach((r, side) => {
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        pair[side] = mesh.vertex(x, ground(x, z), z, color.r, color.g, color.b, alpha, pulse, 0);
      });
      if (previous !== null) mesh.indices.push(previous[0], pair[0], previous[1], previous[1], pair[0], pair[1]);
      previous = pair;
    }
  };

  // the path: a line through the hex centres with an arrowhead, and a dot where each turn ends
  const path = (aids.path?.hexes ?? []).filter(valid);
  if (path.length >= 2) {
    const points = path.map((index) => hexToWorld(indexToOffset(index, map.width), layout));
    const half = (PATH_WIDTH * size) / 2;
    const STEPS = 4;
    const last = points.length - 1;
    const corner = (x: number, z: number, alpha: number): number =>
      mesh.vertex(x, ground(x, z), z, tint.r, tint.g, tint.b, alpha);
    let previous: [number, number] | null = null;
    for (let i = 0; i < last; i++) {
      const a = points[i] as WorldPoint;
      const b = points[i + 1] as WorldPoint;
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const dx = (b.x - a.x) / length;
      const dz = (b.z - a.z) / length;
      const nx = -dz;
      const nz = dx;
      // the line stops short of the last hex centre, where the arrowhead is
      const end = i === last - 1 ? 1 - (0.42 * size) / length : 1;
      for (let s = i === 0 ? 0 : 1; s <= STEPS; s++) {
        const t = (s / STEPS) * end;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const pair: [number, number] = [
          corner(x + nx * half, z + nz * half, 0.92),
          corner(x - nx * half, z - nz * half, 0.92),
        ];
        if (previous !== null) mesh.indices.push(previous[0], pair[0], previous[1], previous[1], pair[0], pair[1]);
        previous = pair;
      }
      if (i === last - 1) {
        const baseX = b.x - dx * 0.44 * size;
        const baseZ = b.z - dz * 0.44 * size;
        const wing = half * 2.6;
        mesh.indices.push(
          corner(b.x - dx * 0.08 * size, b.z - dz * 0.08 * size, 0.95),
          corner(baseX + nx * wing, baseZ + nz * wing, 0.95),
          corner(baseX - nx * wing, baseZ - nz * wing, 0.95),
        );
      }
    }
    (aids.path?.turnEnds ?? []).forEach((position, turn) => {
      const index = aids.path?.hexes[position];
      if (index === undefined || !valid(index)) return;
      const p = hexToWorld(indexToOffset(index, map.width), layout);
      ring(p.x, p.z, 0, 0.2 * size, tint, 0.95, 0);
      markers.push({ text: String(turn + 1), x: p.x, y: ground(p.x, p.z) + 0.3 * size, z: p.z });
    });
  }

  // the attack target: a throbbing ring with four ticks pointing inwards
  if (aids.attackTarget !== undefined && valid(aids.attackTarget)) {
    const red = new Color().setHex(TARGET_COLOR);
    const p = hexToWorld(indexToOffset(aids.attackTarget, map.width), layout);
    hexPatch(surface, mesh, aids.attackTarget, red, 0.28);
    ring(p.x, p.z, 0.66 * size, 0.78 * size, red, 1, 1);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const w = 0.05 * size;
      const tick = (r: number, side: number): number => {
        const x = p.x + dx * r * size - dz * side;
        const z = p.z + dz * r * size + dx * side;
        return mesh.vertex(x, ground(x, z), z, red.r, red.g, red.b, 1, 1, 0);
      };
      const q0 = tick(0.5, -w);
      const q1 = tick(0.5, w);
      const q2 = tick(0.9, -w);
      const q3 = tick(0.9, w);
      mesh.indices.push(q0, q2, q1, q1, q2, q3);
    }
  }
  return { geometry: mesh.build(), markers };
}

export function createOverlays(surface: Surface, uniforms: MapUniforms): Overlays {
  const { map } = surface;
  const object = new Group();
  object.name = 'overlays';

  // rivers: opaque flowing water
  const riverMaterial = new MeshStandardNodeMaterial();
  const uv = attribute('uv', 'vec2');
  const flow = fbm(vec3(uv.x.mul(1.5), uv.y.mul(5).sub(time.mul(0.8)), 0), 2).mul(0.5).add(0.5);
  const bank = uv.x.abs();
  riverMaterial.colorNode = mix(
    mix(color(0x2f7fa6), color(0x7cc3dc), flow.mul(0.7)),
    color(0x245f80),
    bank.mul(bank).mul(0.6),
  );
  riverMaterial.roughness = 0.2;
  riverMaterial.metalness = 0;
  riverMaterial.polygonOffset = true;
  riverMaterial.polygonOffsetFactor = -2;
  riverMaterial.polygonOffsetUnits = -2;
  const rivers = new Mesh(buildRivers(surface), riverMaterial);
  rivers.receiveShadow = true;
  rivers.name = 'rivers';
  object.add(rivers);

  // borders: unlit lines in the polity colour, gently pulsing
  const tint = attribute('tint', 'vec4');
  const borderMaterial = new MeshBasicNodeMaterial();
  const pulse = sin(time.mul(1.2).add(positionWorld.x.add(positionWorld.z).div(uniforms.hexSize))).mul(0.06).add(1);
  // on the political map the borders are bright and wide enough to see
  borderMaterial.colorNode = mix(tint.rgb, vec3(1), mix(float(0.18), float(0.5), uniforms.political)).mul(pulse);
  borderMaterial.opacityNode = mix(tint.a.mul(0.9), float(1), uniforms.political);
  const widen = attribute('widen', 'vec2');
  borderMaterial.positionNode = positionLocal.add(
    vec3(widen.x.mul(uniforms.borderExtra), uniforms.borderExtra.mul(0.5), widen.y.mul(uniforms.borderExtra)),
  );
  borderMaterial.transparent = true;
  borderMaterial.depthWrite = false;
  borderMaterial.polygonOffset = true;
  borderMaterial.polygonOffsetFactor = -3;
  borderMaterial.polygonOffsetUnits = -3;
  const polityColors = map.polities.map((polity) => new Color().setHex(polity.color));
  const borders = new Mesh(new BufferGeometry(), borderMaterial);
  borders.name = 'borders';
  borders.renderOrder = 2;
  object.add(borders);

  const highlightMaterial = new MeshBasicNodeMaterial();
  highlightMaterial.colorNode = tint.rgb;
  // vertices with u = 1 throb: the attack target
  const throb = sin(time.mul(6)).mul(0.3).add(0.7);
  highlightMaterial.opacityNode = tint.a.mul(mix(float(1), throb, uv.x));
  highlightMaterial.transparent = true;
  highlightMaterial.depthWrite = false;
  highlightMaterial.polygonOffset = true;
  highlightMaterial.polygonOffsetFactor = -4;
  highlightMaterial.polygonOffsetUnits = -4;
  const highlightMesh = new Mesh(new BufferGeometry(), highlightMaterial);
  highlightMesh.name = 'highlights';
  highlightMesh.renderOrder = 3;
  highlightMesh.visible = false;
  borders.visible = false;
  object.add(highlightMesh);

  const aidMesh = new Mesh(new BufferGeometry(), highlightMaterial);
  aidMesh.name = 'aids';
  aidMesh.renderOrder = 4;
  aidMesh.visible = false;
  object.add(aidMesh);

  // the sweep of a captured zone: its own material, so that it can fade
  const sweepOpacity = uniform(0);
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.colorNode = mix(tint.rgb, vec3(1), float(0.25));
  sweepMaterial.opacityNode = tint.a.mul(sweepOpacity);
  sweepMaterial.transparent = true;
  sweepMaterial.depthWrite = false;
  sweepMaterial.polygonOffset = true;
  sweepMaterial.polygonOffsetFactor = -4;
  sweepMaterial.polygonOffsetUnits = -4;
  sweepMaterial.side = DoubleSide;
  const sweepMesh = new Mesh(new BufferGeometry(), sweepMaterial);
  sweepMesh.name = 'sweep';
  sweepMesh.renderOrder = 3;
  sweepMesh.visible = false;
  object.add(sweepMesh);
  let sweepCount = -1;
  let sweepColor = -1;

  for (const material of [riverMaterial, borderMaterial, highlightMaterial]) material.side = DoubleSide;
  rivers.visible = rivers.geometry.getAttribute('position').count > 0;

  const emptyGeometry = (): BufferGeometry => new MeshBuilder().build();
  const swapGeometry = (mesh: Mesh, geometry: BufferGeometry): void => {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.visible = geometry.getAttribute('position').count > 0;
  };

  const overlays: Overlays = {
    object,
    setOwners(owner) {
      swapGeometry(borders, buildBorders(surface, owner, polityColors));
    },
    setHighlights(highlights) {
      swapGeometry(highlightMesh, buildHighlights(surface, highlights));
    },
    setAids(aids) {
      const built = aids === null ? null : buildAids(surface, aids);
      swapGeometry(aidMesh, built?.geometry ?? emptyGeometry());
      return built?.markers ?? [];
    },
    setSweep(hexes, sweepTint, opacity) {
      sweepOpacity.value = opacity;
      // the hexes only ever grow during a sweep: rebuild when they did
      if (hexes.length === sweepCount && sweepTint === sweepColor) return;
      sweepCount = hexes.length;
      sweepColor = sweepTint;
      const mesh = new MeshBuilder();
      const patchTint = new Color().setHex(sweepTint);
      for (const hex of hexes) {
        if (hex >= 0 && hex < map.width * map.height) hexPatch(surface, mesh, hex, patchTint, 1);
      }
      swapGeometry(sweepMesh, mesh.build());
    },
    dispose() {
      for (const mesh of [rivers, borders, highlightMesh, aidMesh, sweepMesh]) mesh.geometry.dispose();
      sweepMaterial.dispose();
      riverMaterial.dispose();
      borderMaterial.dispose();
      highlightMaterial.dispose();
    },
  };
  overlays.setOwners(map.owner);
  return overlays;
}
