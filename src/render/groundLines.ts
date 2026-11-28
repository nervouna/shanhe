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
  riverLine,
  roadCourses,
  splineCourse,
} from './ribbon.ts';
import type { Course, Ribbon, RoadCourse } from './ribbon.ts';
import { createKeyedCache } from './keyed.ts';
import { replaceGeometry } from './release.ts';
import type { RenderRoute } from './scene.ts';
import { cloudShade, mapUv, withFogOfWar } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface GroundLines {
  readonly object: Group;
  /**
   * Replaces the roads: hex index to 1 (road) or 2 (railway). A stretch of
   * road that runs as before keeps its vertices.
   *
   * @returns the stretches laid on the ground in this call.
   */
  setRoads(roads: ReadonlyMap<number, number>): number;
  /**
   * Replaces the trade routes; a route that runs as before keeps its vertices.
   *
   * @returns the routes laid on the ground in this call.
   */
  setRoutes(routes: readonly RenderRoute[]): number;
  /** Stretches of road and routes laid on the ground since the start. Only grows. */
  readonly builds: number;
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

/** One line as it is drawn: the vertices of its ribbon, laid on the ground. */
interface Piece {
  readonly positions: Float32Array;
  readonly line: Float32Array;
  readonly outward: Float32Array;
  readonly kind: Float32Array;
  readonly tint: Float32Array;
  readonly indices: readonly number[];
}

/**
 * Lays a ribbon on the ground.
 *
 * @param kind per vertex: 0 for a road, 1 for a railway.
 * @param tint the colour of every vertex.
 */
function buildPiece(
  ribbon: Ribbon,
  height: (x: number, z: number) => number,
  lift: number,
  kind: number,
  tint: readonly [number, number, number],
): Piece {
  const count = ribbon.across.length;
  const positions = new Float32Array(count * 3);
  const line = new Float32Array(count * 2);
  const tints = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const x = ribbon.positions[v * 2] as number;
    const z = ribbon.positions[v * 2 + 1] as number;
    // level across: the higher of the ground under the edge and under the middle
    const y = Math.max(height(x, z), height(ribbon.centres[v * 2] as number, ribbon.centres[v * 2 + 1] as number));
    positions[v * 3] = x;
    positions[v * 3 + 1] = y + lift;
    positions[v * 3 + 2] = z;
    line[v * 2] = ribbon.across[v] as number;
    line[v * 2 + 1] = ribbon.along[v] as number;
    tints.set(tint, v * 3);
  }
  return {
    positions,
    line,
    outward: new Float32Array(ribbon.outward),
    kind: new Float32Array(count).fill(kind),
    tint: tints,
    indices: ribbon.indices,
  };
}

/** One geometry of all pieces. */
function mergePieces(pieces: readonly Piece[]): BufferGeometry {
  let count = 0;
  let indexCount = 0;
  for (const piece of pieces) {
    count += piece.kind.length;
    indexCount += piece.indices.length;
  }
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const line = new Float32Array(count * 2);
  const outward = new Float32Array(count * 2);
  const kind = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  const indices = count > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let v = 0;
  let n = 0;
  for (const piece of pieces) {
    positions.set(piece.positions, v * 3);
    line.set(piece.line, v * 2);
    outward.set(piece.outward, v * 2);
    kind.set(piece.kind, v);
    tint.set(piece.tint, v * 3);
    for (const index of piece.indices) indices[n++] = v + index;
    v += piece.kind.length;
  }
  for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('line', new BufferAttribute(line, 2));
  geometry.setAttribute('outward', new BufferAttribute(outward, 2));
  geometry.setAttribute('kind', new BufferAttribute(kind, 1));
  geometry.setAttribute('tint', new BufferAttribute(tint, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const WHITE = [1, 1, 1] as const;

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
    // the hex edges are smoothed out of the course, and the river widens downstream
    const line = riverLine(course, size, SPACING * size);
    appendRibbon(riverRibbon, line.course, RIVER_HALF * size, true, line.widths);
  }
  const rivers = new Mesh(mergePieces([buildPiece(riverRibbon, ground, RIVER_LIFT * size, 0, WHITE)]), riverMaterial);
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
  const show = (mesh: Mesh, pieces: readonly Piece[]): number => {
    const geometry = mergePieces(pieces);
    replaceGeometry(mesh, geometry);
    const triangles = (geometry.getIndex()?.count ?? 0) / 3;
    mesh.visible = triangles > 0;
    return triangles;
  };

  // a line that is drawn as before keeps its vertices: only new and changed lines are laid on the ground
  const courseKey = (course: Course): string => {
    let key = course.closed ? 'o' : '-';
    for (const point of course.points) key += `${point.x.toFixed(3)},${point.z.toFixed(3)};`;
    return key;
  };
  const roadId = (road: RoadCourse): string => `${road.level}${courseKey(road.course)}`;
  const roadPieces = createKeyedCache<RoadCourse, Piece, string>(
    roadId,
    () => '',
    ({ course, level }) => {
      const ribbon = emptyRibbon();
      appendRibbon(ribbon, resampleCourse(splineCourse(course, 4), SPACING * size), (level === 2 ? RAIL_HALF : ROAD_HALF) * size);
      return buildPiece(ribbon, top, ROAD_LIFT * size, level === 2 ? 1 : 0, WHITE);
    },
  );
  const routeId = (route: RenderRoute): string => `${route.polity}:${route.sea ? 1 : 0}:${route.path.join(',')}`;
  const routePieces = createKeyedCache<RenderRoute, Piece | null, string>(
    routeId,
    () => '',
    (route) => {
      const course = pathCourse(map, route.path);
      if (course.points.length < 2) return null;
      const ribbon = emptyRibbon();
      appendRibbon(ribbon, resampleCourse(splineCourse(course, 4), SPACING * size), ROUTE_HALF * size, false);
      const tintOf = polityColors[route.polity] ?? new Color(0xffffff);
      return buildPiece(ribbon, top, ROUTE_LIFT * size, 0, [tintOf.r, tintOf.g, tintOf.b]);
    },
  );
  /** The pieces of the lines given, each once, in their order. */
  const piecesOf = <T>(lines: readonly T[], idOf: (line: T) => string, cache: { get(id: string): Piece | null | undefined }): Piece[] => {
    const pieces: Piece[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const id = idOf(line);
      const piece = cache.get(id);
      if (piece === undefined || piece === null || seen.has(id)) continue;
      seen.add(id);
      pieces.push(piece);
    }
    return pieces;
  };

  return {
    object,
    counts,
    get builds() {
      return roadPieces.builds + routePieces.builds;
    },
    setRoads(next) {
      const courses = roadCourses(map, next);
      const { built, removed } = roadPieces.update(courses);
      if (built.length === 0 && removed.length === 0) return 0;
      counts.roads = show(roads, piecesOf(courses, roadId, roadPieces));
      return built.length;
    },
    setRoutes(next) {
      const { built, removed } = routePieces.update(next);
      if (built.length === 0 && removed.length === 0) return 0;
      counts.routes = show(routes, piecesOf(next, routeId, routePieces));
      return built.length;
    },
    dispose() {
      for (const mesh of [rivers, roads, routes]) mesh.geometry.dispose();
      riverMaterial.dispose();
      roadMaterial.dispose();
      routeMaterial.dispose();
    },
  };
}
