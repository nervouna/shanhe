/**
 * Lines on the ground as geometry, without Three.js: the courses of the
 * rivers through the corners of the hexes they flow between, the lines of
 * roads and trade routes through hex centres, their smoothing, and the
 * ribbon of triangles drawn along a line.
 */

import { hexCorners, hexToWorld, indexToOffset, worldToHex } from '../shared/hex.ts';
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

/** A river as a line through hex corners, with how much river lies upstream of each of its points. */
export interface RiverCourse extends Course {
  /**
   * Per point: the number of river edges that drain through it, itself
   * included. It grows downstream, and sets the width.
   */
  readonly flows: readonly number[];
}

/** The river edges of a map as a graph of hex corners. */
export interface RiverNetwork {
  /** Where each corner is, by its id ({@link cornerId}). */
  readonly position: ReadonlyMap<number, WorldPoint>;
  /** The corners each corner is joined to by a river edge. */
  readonly links: ReadonlyMap<number, readonly number[]>;
  /** Corners that touch a water hex: a river ends there without thinning out. */
  readonly wet: ReadonlySet<number>;
  /** Per corner: the river edges that drain through it, itself included. */
  readonly flow: ReadonlyMap<number, number>;
  /** Per corner: the next corner downstream, or -1 at a mouth. */
  readonly downstream: ReadonlyMap<number, number>;
  /** River edges left out because they closed a ring around a single hex. */
  readonly opened: number;
}

/**
 * The hexes all six of whose edges are joined in a set of links: a river
 * drawn along them would be a ring around the hex.
 */
export function ringHexes(map: MapData, links: ReadonlyMap<number, readonly number[]>): number[] {
  const layout = map.projection.hexLayout;
  const out: number[] = [];
  for (let i = 0; i < map.width * map.height; i++) {
    const ids = hexCorners(indexToOffset(i, map.width), layout).map((corner) => cornerId(corner, layout));
    if (ids.every((id, k) => links.get(id)?.includes(ids[(k + 1) % 6] as number) === true)) out.push(i);
  }
  return out;
}

/**
 * The rivers of a map as a graph. Where the data sets all six edges of a
 * hex (a river on both sides of it), the ring is opened: of the stretches
 * between the corners where other river edges join it, the longest is left
 * out, so that the river still connects everything it connected and passes
 * the hex on one side; a ring that nothing joins is left out altogether.
 *
 * Every river then drains towards the water: the flow of a corner counts
 * the river edges upstream of it.
 */
export function riverNetwork(map: MapData): RiverNetwork {
  const layout = map.projection.hexLayout;
  const position = new Map<number, WorldPoint>();
  const links = new Map<number, number[]>();
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

  // open the rings around single hexes
  const unlink = (a: number, b: number): void => {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const list = links.get(from);
      if (list === undefined) continue;
      const at = list.indexOf(to);
      if (at >= 0) list.splice(at, 1);
      if (list.length === 0) links.delete(from);
    }
  };
  let opened = 0;
  for (const hex of ringHexes(map, links)) {
    const ids = hexCorners(indexToOffset(hex, map.width), layout).map((corner) => cornerId(corner, layout));
    // an earlier ring may have shared an edge with this one and opened it already
    if (!ids.every((id, k) => links.get(id)?.includes(ids[(k + 1) % 6] as number) === true)) continue;
    const ports = ids.map((id, k) => ((links.get(id)?.length ?? 0) > 2 ? k : -1)).filter((k) => k >= 0);
    let from = 0;
    let span = 6;
    if (ports.length >= 2) {
      // the longest stretch between two corners where the ring is joined
      span = 0;
      ports.forEach((port, n) => {
        const next = ports[(n + 1) % ports.length] as number;
        const gap = (next - port + 6) % 6 || 6;
        if (gap > span) {
          span = gap;
          from = port;
        }
      });
    }
    for (let k = 0; k < span; k++) {
      unlink(ids[(from + k) % 6] as number, ids[(from + k + 1) % 6] as number);
      opened++;
    }
  }
  for (const id of [...position.keys()]) if (!links.has(id)) position.delete(id);

  // towards the water: breadth first from the mouths, then from the lowest end of what is left
  const downstream = new Map<number, number>();
  const order: number[] = [];
  const spread = (roots: readonly number[]): void => {
    const queue = roots.filter((root) => !downstream.has(root));
    for (const root of queue) downstream.set(root, -1);
    for (let n = 0; n < queue.length; n++) {
      const node = queue[n] as number;
      order.push(node);
      for (const next of links.get(node) ?? []) {
        if (downstream.has(next)) continue;
        downstream.set(next, node);
        queue.push(next);
      }
    }
  };
  spread([...links.keys()].filter((node) => wet.has(node)));
  const elevationAt = (node: number): number => {
    const p = position.get(node) as WorldPoint;
    const hex = worldToHex({ x: p.x, z: p.z + layout.size * 0.01 }, layout);
    if (hex.col < 0 || hex.col >= map.width || hex.row < 0 || hex.row >= map.height) return 0;
    return map.elevation[hex.row * map.width + hex.col] as number;
  };
  const rest = [...links.keys()].filter((node) => !downstream.has(node)).sort((a, b) => elevationAt(a) - elevationAt(b) || a - b);
  for (const node of rest) if (!downstream.has(node)) spread([node]);
  const flow = new Map<number, number>();
  for (let n = order.length - 1; n >= 0; n--) {
    const node = order[n] as number;
    const own = (flow.get(node) ?? 0) + 1;
    flow.set(node, own);
    const to = downstream.get(node) as number;
    if (to >= 0) flow.set(to, (flow.get(to) ?? 0) + own);
  }
  return { position, links, wet, flow, downstream, opened };
}

/**
 * The rivers of a map as lines through hex corners. Every river edge of
 * the network ({@link riverNetwork}) is part of exactly one line. Lines end
 * at a source, at the water, or at a corner where three river edges meet;
 * there, the lines that meet share the corner as their end point.
 */
export function riverCourses(map: MapData): RiverCourse[] {
  const { position, links, wet, flow, downstream } = riverNetwork(map);
  const used = new Set<string>();
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const degree = (node: number): number => links.get(node)?.length ?? 0;
  /** What drains through the edge between two corners: the flow of its upstream end. */
  const edgeFlow = (a: number, b: number): number => {
    if (downstream.get(a) === b) return flow.get(a) as number;
    if (downstream.get(b) === a) return flow.get(b) as number;
    return Math.min(flow.get(a) as number, flow.get(b) as number);
  };
  const courses: RiverCourse[] = [];
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
    // a point carries what flows through the edges on either side of it: a tributary stays narrow up to the junction
    const flows = nodes.map((node, i) => {
      const before = i > 0 ? edgeFlow(nodes[i - 1] as number, node) : null;
      const after = i < nodes.length - 1 ? edgeFlow(node, nodes[i + 1] as number) : null;
      return before === null ? (after as number) : after === null ? before : (before + after) / 2;
    });
    courses.push({
      points: nodes.map((node) => position.get(node) as WorldPoint),
      closed,
      taperStart: !closed && degree(first) === 1 && !wet.has(first),
      taperEnd: !closed && degree(last) === 1 && !wet.has(last),
      flows,
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

/** The flow at which a river has its full width: the great rivers of the map reach it. */
const FULL_FLOW = 150;
/** The width of a river at its source and in full flow, as multiples of the nominal width. */
const WIDTH_AT_SOURCE = 0.55;
const WIDTH_IN_FULL_FLOW = 1.7;

/** How wide a river is for what flows through it, as a multiple of the nominal width: it grows downstream. */
export function riverWidthFactor(flow: number): number {
  const t = Math.sqrt(Math.min(Math.max(flow, 0) / FULL_FLOW, 1));
  return WIDTH_AT_SOURCE + (WIDTH_IN_FULL_FLOW - WIDTH_AT_SOURCE) * t;
}

/** A river as it is drawn: a smooth line, and its width at every point as a multiple of the nominal width. */
export interface RiverLine {
  readonly course: Course;
  readonly widths: readonly number[];
}

/** Passes of the filter that takes the hex edges out of a course. */
const RIVER_SMOOTHING = 3;
/** The bends a river is given back afterwards: how far to either side and how long, in hex sizes. */
const MEANDER_REACH = 0.13;
const MEANDER_LENGTH = 2.7;

/**
 * Turns a river's course along hex edges into the line that is drawn. The
 * edges zigzag by 120 degrees at every corner: a filter over three points
 * takes exactly that out, and two more passes round what is left over
 * several hexes. The line is then given gentle bends of its own, a spline
 * is laid through it, and points are added so that it can follow the
 * relief. The ends stay where they are, so rivers still meet in a point,
 * and the line stays within a quarter of a hex of the edges it stands for.
 *
 * @param size the hex size.
 * @param spacing the largest distance between two points of the result.
 */
export function riverLine(course: RiverCourse, size: number, spacing: number): RiverLine {
  const closed = course.closed;
  let points = closed ? course.points.slice(0, -1) : course.points.slice();
  const flows = closed ? course.flows.slice(0, -1) : course.flows.slice();
  const n = points.length;
  if (n >= 3) {
    for (let pass = 0; pass < RIVER_SMOOTHING; pass++) {
      const next = points.slice();
      for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) continue;
        const a = points[(i - 1 + n) % n] as WorldPoint;
        const b = points[i] as WorldPoint;
        const c = points[(i + 1) % n] as WorldPoint;
        next[i] = { x: (a.x + 2 * b.x + c.x) / 4, z: (a.z + 2 * b.z + c.z) / 4 };
      }
      points = next;
    }
    // bends: to either side of the smoothed line, none at the ends
    const lengths = [0];
    for (let i = 1; i < n; i++) {
      lengths.push((lengths[i - 1] as number) + Math.hypot((points[i] as WorldPoint).x - (points[i - 1] as WorldPoint).x, (points[i] as WorldPoint).z - (points[i - 1] as WorldPoint).z));
    }
    const first = course.points[0] as WorldPoint;
    const phase = (Math.abs(Math.round(first.x * 131 + first.z * 71)) % 628) / 100;
    const bent = points.slice();
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = points[(i - 1 + n) % n] as WorldPoint;
      const c = points[(i + 1) % n] as WorldPoint;
      const along = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      const ease = closed ? 1 : Math.min(1, Math.min(i, n - 1 - i) / 3);
      const sway = Math.sin(((lengths[i] as number) / (MEANDER_LENGTH * size)) * Math.PI * 2 + phase) * MEANDER_REACH * size * ease;
      bent[i] = { x: (points[i] as WorldPoint).x - ((c.z - a.z) / along) * sway, z: (points[i] as WorldPoint).z + ((c.x - a.x) / along) * sway };
    }
    points = bent;
  }
  if (closed) {
    points.push(points[0] as WorldPoint);
    flows.push(flows[0] as number);
  }
  // a spline through the points, the widths carried along, then points close enough to follow the relief
  const pieces = 4;
  const splined = splineCourse({ ...course, points }, pieces);
  let widths: number[] = [];
  if (splined.points.length === points.length) {
    widths = flows.map(riverWidthFactor);
  } else {
    for (let i = 0; i < points.length - 1; i++) {
      for (let k = 0; k < pieces; k++) {
        const t = k / pieces;
        widths.push(riverWidthFactor((flows[i] as number) * (1 - t) + (flows[i + 1] as number) * t));
      }
    }
    widths.push(riverWidthFactor(flows[flows.length - 1] as number));
  }
  const dense: WorldPoint[] = [];
  const denseWidths: number[] = [];
  splined.points.forEach((point, i) => {
    const previous = splined.points[i - 1];
    if (previous !== undefined) {
      const steps = Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z) / spacing);
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        dense.push({ x: previous.x + (point.x - previous.x) * t, z: previous.z + (point.z - previous.z) * t });
        denseWidths.push((widths[i - 1] as number) * (1 - t) + (widths[i] as number) * t);
      }
    }
    dense.push(point);
    denseWidths.push(widths[i] as number);
  });
  return {
    course: { points: dense, closed, taperStart: course.taperStart, taperEnd: course.taperEnd },
    widths: denseWidths,
  };
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
 * @param widths per point of the course, a factor on the width there; 1 everywhere if omitted.
 */
export function appendRibbon(ribbon: Ribbon, course: Course, halfWidth: number, caps = true, widths?: readonly number[]): void {
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
    const full = halfWidth * (widths?.[i] ?? 1);
    let width = full;
    const reach = TAPER_OVER * halfWidth;
    if (course.taperStart) width = Math.min(width, full * (TAPER_TO + (1 - TAPER_TO) * Math.min(1, (lengths[i] as number) / reach)));
    if (course.taperEnd) {
      width = Math.min(width, full * (TAPER_TO + (1 - TAPER_TO) * Math.min(1, (total - (lengths[i] as number)) / reach)));
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
