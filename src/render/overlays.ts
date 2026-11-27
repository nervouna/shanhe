/**
 * Things drawn on top of the ground along hex edges and over whole hexes:
 * rivers, territory borders and hex highlights. All of them are thin meshes
 * draped over the relief.
 */

import { attribute, color, float, mix, positionWorld, sin, time, vec3 } from 'three/tsl';
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
import type { HexHighlight } from './scene.ts';
import { fbm } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface Overlays {
  readonly object: Group;
  /** Redraws the borders for a per-hex owner array (as `MapData.owner`). */
  setOwners(owner: Int16Array): void;
  setHighlights(highlights: readonly HexHighlight[]): void;
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
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number, r: number, g: number, b: number, a: number, u = 0, v = 0): number {
    this.positions.push(x, y, z);
    this.colors.push(r, g, b, a);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('tint', new BufferAttribute(new Float32Array(this.colors), 4));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
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

function buildHighlights(surface: Surface, highlights: readonly HexHighlight[]): BufferGeometry {
  const { map } = surface;
  const layout = map.projection.hexLayout;
  const lift = LIFT * 2 * layout.size;
  const mesh = new MeshBuilder();
  const tint = new Color();
  for (const highlight of highlights) {
    if (highlight.hex < 0 || highlight.hex >= map.width * map.height) continue;
    tint.setHex(highlight.color);
    const alpha = highlight.opacity ?? 0.45;
    const hex = indexToOffset(highlight.hex, map.width);
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
      const k = (ring / RINGS) * 0.94;
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
  return mesh.build();
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
  borderMaterial.colorNode = mix(tint.rgb, vec3(1), float(0.18)).mul(pulse);
  borderMaterial.opacityNode = tint.a.mul(0.9);
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
  highlightMaterial.opacityNode = tint.a;
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

  for (const material of [riverMaterial, borderMaterial, highlightMaterial]) material.side = DoubleSide;
  rivers.visible = rivers.geometry.getAttribute('position').count > 0;

  const replace = (mesh: Mesh, geometry: BufferGeometry): void => {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.visible = geometry.getAttribute('position').count > 0;
  };

  const overlays: Overlays = {
    object,
    setOwners(owner) {
      replace(borders, buildBorders(surface, owner, polityColors));
    },
    setHighlights(highlights) {
      replace(highlightMesh, buildHighlights(surface, highlights));
    },
    dispose() {
      for (const mesh of [rivers, borders, highlightMesh]) mesh.geometry.dispose();
      riverMaterial.dispose();
      borderMaterial.dispose();
      highlightMaterial.dispose();
    },
  };
  overlays.setOwners(map.owner);
  return overlays;
}
