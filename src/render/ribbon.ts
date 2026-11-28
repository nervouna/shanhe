/**
 * Lines on the ground as geometry, without Three.js: the courses of the
 * rivers through the corners of the hexes they flow between, the lines of
 * roads and trade routes through hex centres, their smoothing, and the
 * ribbon of triangles drawn along a line.
 */

import { hexCorners, hexToWorld, indexToOffset } from '../shared/hex.ts';
import type { HexLayout, WorldPoint } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import { isWaterTerrain } from '../shared/mapData.ts';

/** A line on the ground. */
export interface Course {
  readonly points: readonly WorldPoint[];
  /** Whether the line ends where it began. */
  readonly closed: boolean;
  /** Whether the first and the last point are loose ends that should thin out (a river's source). */
  readonly taperStart: boolean;
  readonly taperEnd: boolean;
}

const SQRT3 = Math.sqrt(3);

/**
 * A number that names a hex corner, the same from whichever of its three
 * hexes it is computed: corners lie on a lattice of half hex widths and
 * half hex sizes, so two integers identify one.
 */
export function cornerId(point: WorldPoint, layout: HexLayout): number {
  const a = Math.round((point.x - layout.originX) / ((SQRT3 / 2) * layout.size));
  const b = Math.round((point.z - layout.originZ) / (layout.size / 2));
  return (a + 4096) * 65536 + (b + 4096);
}

/**
 * The rivers of a map as lines through hex corners. Every river edge is
 * part of exactly one line. Lines end at a source, at the water, or at a
 * corner where three river edges meet; there, the lines that meet share the
 * corner as their end point.
 */
export function riverCourses(map: MapData): Course[] {
  const layout = map.projection.hexLayout;
  const position = new Map<number, WorldPoint>();
  const links = new Map<number, number[]>();
  /** Corners that touch a water hex: a river ends there without thinning out. */
  const wet = new Set<number>();
  const link = (a: number, b: number): void => {
    const list = links.get(a);
    if (list === undefined) links.set(a, [b]);
    else if (!list.includes(b)) list.push(b);
  };
  for (let i = 0; i < map.width * map.height; i++) {
    const edges = map.riverEdges[i] as number;
    const water = isWaterTerrain(map.terrain[i] as number);
    if (edges === 0 && !water) continue;
    const corners = hexCorners(indexToOffset(i, map.width), layout);
    if (water) for (const corner of corners) wet.add(cornerId(corner, layout));
    for (let d = 0; d < 6; d++) {
      if ((edges & (1 << d)) === 0) continue;
      const from = corners[(d + 5) % 6] as WorldPoint;
      const to = corners[d] as WorldPoint;
      const a = cornerId(from, layout);
      const b = cornerId(to, layout);
      position.set(a, from);
      position.set(b, to);
      link(a, b);
      link(b, a);
    }
  }

  const used = new Set<string>();
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const degree = (node: number): number => links.get(node)?.length ?? 0;
  const courses: Course[] = [];
  /** Follows unused edges from `start` through `next` until a corner that is not a plain bend. */
  const walk = (start: number, next: number): number[] => {
    const nodes = [start, next];
    used.add(edgeKey(start, next));
    let previous = start;
    let here = next;
    while (degree(here) === 2 && here !== start) {
      const onward = (links.get(here) as number[]).find((n) => n !== previous);
      if (onward === undefined || used.has(edgeKey(here, onward))) break;
      used.add(edgeKey(here, onward));
      nodes.push(onward);
      previous = here;
      here = onward;
    }
    return nodes;
  };
  const emit = (nodes: number[]): void => {
    const first = nodes[0] as number;
    const last = nodes[nodes.length - 1] as number;
    const closed = nodes.length > 2 && first === last;
    courses.push({
      points: nodes.map((node) => position.get(node) as WorldPoint),
      closed,
      taperStart: !closed && degree(first) === 1 && !wet.has(first),
      taperEnd: !closed && degree(last) === 1 && !wet.has(last),
    });
  };
  // from ends and junctions first, then whatever is left: closed loops
  for (const [node, neighbours] of links) {
    if (neighbours.length === 2) continue;
    for (const next of neighbours) if (!used.has(edgeKey(node, next))) emit(walk(node, next));
  }
  for (const [node, neighbours] of links) {
    for (const next of neighbours) if (!used.has(edgeKey(node, next))) emit(walk(node, next));
  }
  return courses;
}

/**
 * Lines through the centres of neighbouring hexes that are both in `hexes`:
 * every pair of neighbours is joined once, and runs of hexes with exactly
 * two neighbours become one line. Used for roads.
 *
 * @param joins whether two neighbouring hexes of the set are joined; all are if omitted.
 */
export function networkCourses(
  map: MapData,
  hexes: ReadonlySet<number>,
  joins: (a: number, b: number) => boolean = () => true,
): Course[] {
  const layout = map.projection.hexLayout;
  const neighboursOf = (hex: number): number[] => {
    const { col, row } = indexToOffset(hex, map.width);
    const out: number[] = [];
    const odd = row & 1;
    const around = [
      [col + 1, row],
      [col - 1, row],
      [col + odd, row - 1],
      [col + odd - 1, row - 1],
      [col + odd, row + 1],
      [col + odd - 1, row + 1],
    ] as const;
    for (const [c, r] of around) {
      if (c < 0 || c >= map.width || r < 0 || r >= map.height) continue;
      const index = r * map.width + c;
      if (hexes.has(index) && joins(hex, index)) out.push(index);
    }
    return out;
  };
  const links = new Map<number, number[]>();
  for (const hex of hexes) links.set(hex, neighboursOf(hex));

  const used = new Set<string>();
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const courses: Course[] = [];
  const centre = (hex: number): WorldPoint => hexToWorld(indexToOffset(hex, map.width), layout);
  const walk = (start: number, next: number): void => {
    const nodes = [start, next];
    used.add(edgeKey(start, next));
    let previous = start;
    let here = next;
    while ((links.get(here) as number[]).length === 2 && here !== start) {
      const onward = (links.get(here) as number[]).find((n) => n !== previous);
      if (onward === undefined || used.has(edgeKey(here, onward))) break;
      used.add(edgeKey(here, onward));
      nodes.push(onward);
      previous = here;
      here = onward;
    }
    const closed = nodes.length > 2 && nodes[0] === nodes[nodes.length - 1];
    courses.push({ points: nodes.map(centre), closed, taperStart: false, taperEnd: false });
  };
  for (const [hex, neighbours] of links) {
    if (neighbours.length === 2) continue;
    for (const next of neighbours) if (!used.has(edgeKey(hex, next))) walk(hex, next);
  }
  for (const [hex, neighbours] of links) {
    for (const next of neighbours) if (!used.has(edgeKey(hex, next))) walk(hex, next);
  }
  return courses;
}

/** A stretch of road or railway. */
export interface RoadCourse {
  readonly course: Course;
  /** 1 for a road, 2 for a railway. */
  readonly level: 1 | 2;
}

/**
 * The lines of a road network (`roads`: hex index to 1 for a road, 2 for a
 * railway). Two neighbouring hexes are joined by a railway if both carry
 * one, and by a road otherwise; every such join is drawn exactly once.
 */
export function roadCourses(map: MapData, roads: ReadonlyMap<number, number>): RoadCourse[] {
  const count = map.width * map.height;
  const all = new Set<number>();
  const rails = new Set<number>();
  for (const [hex, level] of roads) {
    if (!Number.isInteger(hex) || hex < 0 || hex >= count) continue;
    if (level === 1 || level === 2) all.add(hex);
    if (level === 2) rails.add(hex);
  }
  const out: RoadCourse[] = [];
  for (const course of networkCourses(map, rails)) out.push({ course, level: 2 });
  for (const course of networkCourses(map, all, (a, b) => !(rails.has(a) && rails.has(b)))) out.push({ course, level: 1 });
  return out;
}

/** The line through the centres of a path of hexes, in order. Hexes outside the map are skipped. */
export function pathCourse(map: MapData, path: readonly number[]): Course {
  const layout = map.projection.hexLayout;
  const count = map.width * map.height;
  const points = path
    .filter((hex) => Number.isInteger(hex) && hex >= 0 && hex < count)
    .map((hex) => hexToWorld(indexToOffset(hex, map.width), layout));
  return { points, closed: false, taperStart: false, taperEnd: false };
}

/**
 * Rounds the corners of a line by cutting each one off, `passes` times
 * (Chaikin's scheme). The ends of an open line stay where they are, so
 * lines that meet in a point still do.
 */
export function smoothCourse(course: Course, passes: number): Course {
  let points = course.closed ? course.points.slice(0, -1) : course.points.slice();
  for (let pass = 0; pass < passes && points.length >= 3; pass++) {
    const next: WorldPoint[] = [];
    const n = points.length;
    const segments = course.closed ? n : n - 1;
    if (!course.closed) next.push(points[0] as WorldPoint);
    for (let i = 0; i < segments; i++) {
      const a = points[i] as WorldPoint;
      const b = points[(i + 1) % n] as WorldPoint;
      // the first and last segment of an open line keep their outer end
      if (course.closed || i > 0) next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      if (course.closed || i < segments - 1) next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    if (!course.closed) next.push(points[n - 1] as WorldPoint);
    points = next;
  }
  if (course.closed && points.length > 0) points.push(points[0] as WorldPoint);
  return { ...course, points };
}

/**
 * A smooth curve through every point of a line (a Catmull-Rom spline),
 * with `pieces` steps between two points. Unlike {@link smoothCourse} it
 * passes exactly through the points: a road drawn this way still crosses
 * the centre of each of its hexes.
 */
export function splineCourse(course: Course, pieces: number): Course {
  const source = course.points;
  const n = source.length;
  if (n < 3) return course;
  const at = (i: number): WorldPoint => {
    if (course.closed) return source[((i % (n - 1)) + (n - 1)) % (n - 1)] as WorldPoint;
    return source[Math.min(Math.max(i, 0), n - 1)] as WorldPoint;
  };
  const points: WorldPoint[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < pieces; s++) {
      const t = s / pieces;
      const t2 = t * t;
      const t3 = t2 * t;
      const blend = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      points.push({ x: blend(p0.x, p1.x, p2.x, p3.x), z: blend(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  points.push(source[n - 1] as WorldPoint);
  return { ...course, points };
}

/** Adds points so that no two neighbours are farther apart than `spacing`: the line can then follow the relief. */
export function resampleCourse(course: Course, spacing: number): Course {
  const points: WorldPoint[] = [];
  course.points.forEach((point, i) => {
    const previous = course.points[i - 1];
    if (previous !== undefined) {
      const pieces = Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z) / spacing);
      for (let s = 1; s < pieces; s++) {
        const t = s / pieces;
        points.push({ x: previous.x + (point.x - previous.x) * t, z: previous.z + (point.z - previous.z) * t });
      }
    }
    points.push(point);
  });
  return { ...course, points };
}

/** A strip of triangles along a line, flat on the ground plane; heights are the caller's. */
export interface Ribbon {
  /** `x`, `z` per vertex. */
  readonly positions: number[];
  /** Per vertex: -1 on the left edge, 1 on the right, 0 on the centre line. */
  readonly across: number[];
  /** Per vertex: distance along the line from its start. */
  readonly along: number[];
  /** Per vertex: the centre-line point it belongs to (`x`, `z`), for heights taken from the middle of the ribbon. */
  readonly centres: number[];
  /** Per vertex: unit direction (`x`, `z`) in which it moves when the ribbon is widened; 0 on the centre line. */
  readonly outward: number[];
  readonly indices: number[];
}

export function emptyRibbon(): Ribbon {
  return { positions: [], across: [], along: [], centres: [], outward: [], indices: [] };
}

/** Segments of the half-disc that closes an end of a ribbon. */
const CAP_SEGMENTS = 5;
/** The width of a thinned-out end as a share of the full width, and the length over which it thins, in widths. */
const TAPER_TO = 0.35;
const TAPER_OVER = 9;

/**
 * Appends the ribbon of `course` to `ribbon`: one cross-section of two
 * vertices per point, mitred at bends, so that consecutive pieces share
 * their vertices and no gap can open; and a rounded cap at each end of an
 * open line, so that lines meeting in a point overlap in a disc.
 *
 * @param halfWidth half the width of the ribbon.
 * @param caps whether to close open ends with half-discs.
 */
export function appendRibbon(ribbon: Ribbon, course: Course, halfWidth: number, caps = true): void {
  const points = course.points;
  const n = points.length;
  if (n < 2) return;
  const vertex = (x: number, z: number, across: number, along: number, cx: number, cz: number, ox: number, oz: number): number => {
    ribbon.positions.push(x, z);
    ribbon.across.push(across);
    ribbon.along.push(along);
    ribbon.centres.push(cx, cz);
    ribbon.outward.push(ox, oz);
    return ribbon.across.length - 1;
  };
  let total = 0;
  const lengths = [0];
  for (let i = 1; i < n; i++) {
    const a = points[i - 1] as WorldPoint;
    const b = points[i] as WorldPoint;
    total += Math.hypot(b.x - a.x, b.z - a.z);
    lengths.push(total);
  }
  const widthAt = (i: number): number => {
    let width = halfWidth;
    const reach = TAPER_OVER * halfWidth;
    if (course.taperStart) width = Math.min(width, halfWidth * (TAPER_TO + (1 - TAPER_TO) * Math.min(1, (lengths[i] as number) / reach)));
    if (course.taperEnd) {
      width = Math.min(width, halfWidth * (TAPER_TO + (1 - TAPER_TO) * Math.min(1, (total - (lengths[i] as number)) / reach)));
    }
    return width;
  };
  const direction = (from: WorldPoint, to: WorldPoint): [number, number] => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    return [dx / length, dz / length];
  };

  let previous: [number, number] | null = null;
  let firstPair: [number, number] | null = null;
  const last = course.closed ? n - 1 : n;
  for (let i = 0; i < last; i++) {
    const here = points[i] as WorldPoint;
    const before = points[i === 0 ? (course.closed ? n - 2 : 0) : i - 1] as WorldPoint;
    const after = points[i === n - 1 ? n - 1 : i + 1] as WorldPoint;
    const into = i === 0 && !course.closed ? direction(here, after) : direction(before, here);
    const out = i === n - 1 ? into : direction(here, after);
    // the mitre: across the bisector of the two directions, lengthened so that the ribbon keeps its width
    let tx = into[0] + out[0];
    let tz = into[1] + out[1];
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-6) {
      tx = out[0];
      tz = out[1];
    } else {
      tx /= tl;
      tz /= tl;
    }
    const nx = -tz;
    const nz = tx;
    const cosHalf = Math.max(0.5, nx * -out[1] + nz * out[0]);
    const width = widthAt(i) / cosHalf;
    const along = lengths[i] as number;
    const pair: [number, number] = [
      vertex(here.x - nx * width, here.z - nz * width, -1, along, here.x, here.z, -nx, -nz),
      vertex(here.x + nx * width, here.z + nz * width, 1, along, here.x, here.z, nx, nz),
    ];
    if (previous !== null) ribbon.indices.push(previous[0], previous[1], pair[0], pair[0], previous[1], pair[1]);
    previous = pair;
    firstPair ??= pair;
  }
  if (course.closed && previous !== null && firstPair !== null) {
    ribbon.indices.push(previous[0], previous[1], firstPair[0], firstPair[0], previous[1], firstPair[1]);
    return;
  }
  if (!caps || previous === null || firstPair === null) return;

  // a half-disc at each end, fanned out from the end point
  const cap = (at: WorldPoint, pair: [number, number], away: [number, number], along: number, width: number): void => {
    const centre = vertex(at.x, at.z, 0, along, at.x, at.z, 0, 0);
    let before = pair[1];
    // from the right edge round the outside to the left edge
    const nx = -away[1];
    const nz = away[0];
    for (let s = 1; s < CAP_SEGMENTS; s++) {
      const angle = (s / CAP_SEGMENTS) * Math.PI;
      const ox = nx * Math.cos(angle) + away[0] * Math.sin(angle);
      const oz = nz * Math.cos(angle) + away[1] * Math.sin(angle);
      const v = vertex(at.x + ox * width, at.z + oz * width, Math.cos(angle), along, at.x, at.z, ox, oz);
      ribbon.indices.push(centre, before, v);
      before = v;
    }
    ribbon.indices.push(centre, before, pair[0]);
  };
  const start = points[0] as WorldPoint;
  const end = points[n - 1] as WorldPoint;
  const outOfStart = direction(points[1] as WorldPoint, start);
  const outOfEnd = direction(points[n - 2] as WorldPoint, end);
  // at the start the right edge lies on the other side of the outward direction
  cap(start, [firstPair[1], firstPair[0]], outOfStart, 0, widthAt(0));
  cap(end, previous, outOfEnd, total, widthAt(n - 1));
}
