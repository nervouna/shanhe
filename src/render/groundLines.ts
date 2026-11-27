/**
 * Lines drawn on the ground as ribbons draped over the relief: rivers as
 * flowing water along their smoothed courses, roads and railways through
 * the hex centres, and trade routes as faint dotted lines in their owner's
 * colour, over the water where they run at sea. The geometry comes from
 * `ribbon.ts`.
 */

import {
  abs,
  attribute,
  cameraPosition,
  color,
  float,
  fract,
  max,
  mix,
  positionLocal,
  smoothstep,
  step,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
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
import { sampleHeight, surfaceHeightAt } from './heightField.ts';
import type { Surface } from './heightField.ts';
import {
  appendRibbon,
  emptyRibbon,
  pathCourse,
  resampleCourse,
  riverCourses,
  roadCourses,
  smoothCourse,
  splineCourse,
} from './ribbon.ts';
import type { Ribbon } from './ribbon.ts';
import type { RenderRoute } from './scene.ts';
import { cloudShade, mapUv, withFogOfWar } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface GroundLines {
  readonly object: Group;
  /** Replaces the roads: hex index to 1 (road) or 2 (railway). */
  setRoads(roads: ReadonlyMap<number, number>): void;
  /** Replaces the trade routes. */
  setRoutes(routes: readonly RenderRoute[]): void;
  /** Triangles of the rivers, roads and routes now drawn. */
  readonly counts: { readonly rivers: number; readonly roads: number; readonly routes: number };
  dispose(): void;
}

/** Half widths and heights over the ground, as fractions of the hex size. */
const RIVER_HALF = 0.085;
const ROAD_HALF = 0.05;
const RAIL_HALF = 0.062;
const ROUTE_HALF = 0.034;
const RIVER_LIFT = 0.02;
const ROAD_LIFT = 0.028;
const ROUTE_LIFT = 0.042;
/** Distance between two points of a line, so that it follows the relief. */
const SPACING = 0.1;

/** Per-vertex extras a ribbon can carry besides its own attributes. */
interface Extras {
  readonly kind: number[];
  readonly tint: number[];
}

function toGeometry(
  ribbon: Ribbon,
  height: (x: number, z: number) => number,
  lift: number,
  extras: Extras,
): BufferGeometry {
  const count = ribbon.across.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const line = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    const x = ribbon.positions[v * 2] as number;
    const z = ribbon.positions[v * 2 + 1] as number;
    // level across: the higher of the ground under the edge and under the middle
    const y = Math.max(height(x, z), height(ribbon.centres[v * 2] as number, ribbon.centres[v * 2 + 1] as number));
    positions[v * 3] = x;
    positions[v * 3 + 1] = y + lift;
    positions[v * 3 + 2] = z;
    normals[v * 3 + 1] = 1;
    line[v * 2] = ribbon.across[v] as number;
    line[v * 2 + 1] = ribbon.along[v] as number;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('line', new BufferAttribute(line, 2));
  geometry.setAttribute('outward', new BufferAttribute(new Float32Array(ribbon.outward), 2));
  geometry.setAttribute('kind', new BufferAttribute(new Float32Array(extras.kind), 1));
  geometry.setAttribute('tint', new BufferAttribute(new Float32Array(extras.tint), 3));
  geometry.setIndex(ribbon.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGroundLines(surface: Surface, u: MapUniforms): GroundLines {
  const { map, field } = surface;
  const size = map.projection.hexLayout.size;
  const object = new Group();
  object.name = 'groundLines';
  const ground = (x: number, z: number): number => sampleHeight(field, x, z);
  const top = (x: number, z: number): number => surfaceHeightAt(surface, x, z);

  const line = attribute('line', 'vec2');
  const outward = attribute('outward', 'vec2');
  const kind = attribute('kind', 'float');
  const across = abs(line.x);
  const along = line.y.div(u.hexSize);
  const xz = positionLocal.xz;
  const fogged = texture(u.textures.fog, mapUv(u, xz)).r;
  /** From far away a line grows wider, so that it does not vanish between pixels. */
  const widened = (share: number) =>
    positionLocal.add(
      vec3(
        outward.x.mul(u.borderExtra).mul(share),
        // and floats higher: far ground is drawn with a coarser mesh, which would bury a line laid close on it
        u.borderExtra.mul(0.3).add(cameraPosition.sub(positionLocal).length().mul(0.0035)),
        outward.y.mul(u.borderExtra).mul(share),
      ),
    );

  // rivers: water with streaks that run downstream and darker banks
  const riverMaterial = new MeshStandardNodeMaterial();
  const streaks = texture(u.textures.noise, vec2(line.x.mul(0.11), along.mul(0.35).sub(u.clock.mul(0.22))));
  const ripples = texture(u.textures.noise, vec2(line.x.mul(0.3).add(0.5), along.mul(1.1).sub(u.clock.mul(0.5))));
  const glint = smoothstep(0.55, 0.85, streaks.r.mul(0.6).add(ripples.b.mul(0.4)));
  let riverColor = mix(color(0x2c7396), color(0x4f9cb8), streaks.g);
  riverColor = mix(riverColor, color(0xbfe2ee), glint.mul(0.55));
  riverColor = mix(riverColor, color(0x1f5a78), smoothstep(0.55, 1, across).mul(0.7));
  riverMaterial.colorNode = withFogOfWar(vec3(riverColor.mul(cloudShade(u, xz))), fogged);
  riverMaterial.roughnessNode = mix(float(0.12), float(0.3), glint);
  riverMaterial.metalness = 0;
  riverMaterial.positionNode = widened(0.5);
  riverMaterial.side = DoubleSide;
  riverMaterial.polygonOffset = true;
  riverMaterial.polygonOffsetFactor = -4;
  riverMaterial.polygonOffsetUnits = -4;

  const riverRibbon = emptyRibbon();
  for (const course of riverCourses(map)) {
    appendRibbon(riverRibbon, resampleCourse(smoothCourse(course, 2), SPACING * size), RIVER_HALF * size);
  }
  const noExtras = (ribbon: Ribbon): Extras => ({
    kind: new Array<number>(ribbon.across.length).fill(0),
    tint: new Array<number>(ribbon.across.length * 3).fill(1),
  });
  const rivers = new Mesh(toGeometry(riverRibbon, ground, RIVER_LIFT * size, noExtras(riverRibbon)), riverMaterial);
  rivers.name = 'rivers';
  rivers.receiveShadow = true;
  rivers.visible = riverRibbon.indices.length > 0;
  object.add(rivers);

  // roads: trodden earth; railways: ballast, sleepers and two rails
  const roadMaterial = new MeshStandardNodeMaterial();
  const rail = step(0.5, kind);
  const earth = mix(color(0xa8946c), color(0x8a7650), smoothstep(0.5, 1, across));
  const ruts = float(1).sub(float(1).sub(smoothstep(0.08, 0.2, abs(across.sub(0.45)))).mul(0.18));
  const sleeper = step(0.55, fract(along.mul(16)));
  const ballast = mix(color(0x6a655d), color(0x3f3226), sleeper.mul(float(1).sub(smoothstep(0.75, 0.85, across))));
  const steel = float(1).sub(smoothstep(0.05, 0.11, abs(across.sub(0.5))));
  const railway = mix(ballast, color(0x8d949a), steel);
  const roadColor = mix(earth.mul(ruts), railway, rail);
  roadMaterial.colorNode = withFogOfWar(vec3(roadColor.mul(cloudShade(u, xz))), fogged);
  roadMaterial.roughnessNode = mix(float(0.95), mix(float(0.9), float(0.35), steel), rail);
  roadMaterial.metalnessNode = steel.mul(rail).mul(0.7);
  roadMaterial.positionNode = widened(0.35);
  roadMaterial.side = DoubleSide;
  roadMaterial.polygonOffset = true;
  roadMaterial.polygonOffsetFactor = -6;
  roadMaterial.polygonOffsetUnits = -6;
  const roads = new Mesh(new BufferGeometry(), roadMaterial);
  roads.name = 'roads';
  roads.receiveShadow = true;
  roads.visible = false;
  object.add(roads);

  // trade routes: dots in the owner's colour that creep along the route
  const routeMaterial = new MeshBasicNodeMaterial();
  const tint = attribute('tint', 'vec3');
  const dot = smoothstep(0.5, 0.42, abs(fract(along.mul(2.6).sub(u.clock.mul(0.12))).sub(0.5)).mul(2.4))
    .mul(float(1).sub(smoothstep(0.55, 1, across)));
  routeMaterial.colorNode = mix(tint, vec3(1), float(0.35));
  // faint on the ground, and gone on the political map, where colour means territory
  routeMaterial.opacityNode = dot.mul(0.62).mul(float(1).sub(u.political)).mul(max(fogged, 0.45));
  routeMaterial.positionNode = widened(0.3);
  routeMaterial.transparent = true;
  routeMaterial.depthWrite = false;
  routeMaterial.side = DoubleSide;
  routeMaterial.polygonOffset = true;
  routeMaterial.polygonOffsetFactor = -8;
  routeMaterial.polygonOffsetUnits = -8;
  const routes = new Mesh(new BufferGeometry(), routeMaterial);
  routes.name = 'routes';
  routes.renderOrder = 2;
  routes.visible = false;
  object.add(routes);

  const counts = { rivers: riverRibbon.indices.length / 3, roads: 0, routes: 0 };
  const polityColors = map.polities.map((polity) => new Color().setHex(polity.color));
  const swap = (mesh: Mesh, geometry: BufferGeometry, triangles: number): void => {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.visible = triangles > 0;
  };

  return {
    object,
    counts,
    setRoads(next) {
      const ribbon = emptyRibbon();
      const kinds: number[] = [];
      for (const { course, level } of roadCourses(map, next)) {
        const before = ribbon.across.length;
        appendRibbon(
          ribbon,
          resampleCourse(splineCourse(course, 4), SPACING * size),
          (level === 2 ? RAIL_HALF : ROAD_HALF) * size,
        );
        for (let v = before; v < ribbon.across.length; v++) kinds.push(level === 2 ? 1 : 0);
      }
      counts.roads = ribbon.indices.length / 3;
      const extras: Extras = { kind: kinds, tint: new Array<number>(kinds.length * 3).fill(1) };
      swap(roads, toGeometry(ribbon, top, ROAD_LIFT * size, extras), counts.roads);
    },
    setRoutes(next) {
      const ribbon = emptyRibbon();
      const tints: number[] = [];
      for (const route of next) {
        const course = pathCourse(map, route.path);
        if (course.points.length < 2) continue;
        const before = ribbon.across.length;
        appendRibbon(ribbon, resampleCourse(splineCourse(course, 4), SPACING * size), ROUTE_HALF * size, false);
        const tintOf = polityColors[route.polity] ?? new Color(0xffffff);
        for (let v = before; v < ribbon.across.length; v++) tints.push(tintOf.r, tintOf.g, tintOf.b);
      }
      counts.routes = ribbon.indices.length / 3;
      const extras: Extras = { kind: new Array<number>(ribbon.across.length).fill(0), tint: tints };
      swap(routes, toGeometry(ribbon, top, ROUTE_LIFT * size, extras), counts.routes);
    },
    dispose() {
      for (const mesh of [rivers, roads, routes]) mesh.geometry.dispose();
      riverMaterial.dispose();
      roadMaterial.dispose();
      routeMaterial.dispose();
    },
  };
}
