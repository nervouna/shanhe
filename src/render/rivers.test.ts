import { beforeAll, describe, expect, it } from 'vitest';
import { hexNeighbor, indexToOffset } from '../shared/hex.ts';
import type { WorldPoint } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import { loadRealMap } from './realMapForTests.ts';
import { ringHexes, riverCourses, riverLine, riverNetwork, riverWidthFactor } from './ribbon.ts';
import type { RiverCourse } from './ribbon.ts';
import { createFlatMap } from './testMaps.ts';

/** Sets the river edge between a hex and its neighbour in direction `d`, on both hexes. */
function setRiver(map: MapData, hex: number, d: number): void {
  const neighbor = hexNeighbor(indexToOffset(hex, map.width), d);
  (map.riverEdges[hex] as number) |= 1 << d;
  (map.riverEdges[neighbor.row * map.width + neighbor.col] as number) |= 1 << ((d + 3) % 6);
}

function edgeCount(links: ReadonlyMap<number, readonly number[]>): number {
  let ends = 0;
  for (const list of links.values()) ends += list.length;
  return ends / 2;
}

function rawEdgeCount(map: MapData): number {
  let bits = 0;
  for (const edges of map.riverEdges) for (let d = 0; d < 6; d++) if ((edges >> d) & 1) bits++;
  return bits / 2;
}

/** The change of direction of a line between a point and the point `span` farther along it, in degrees; one value per point. */
function turns(points: readonly WorldPoint[], span: number, skipEnds: number): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z));
  }
  const total = lengths[lengths.length - 1]!;
  const direction = (i: number): number => Math.atan2(points[i + 1]!.z - points[i]!.z, points[i + 1]!.x - points[i]!.x);
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < points.length - 2; i++) {
    if (lengths[i]! < skipEnds || lengths[i]! > total - skipEnds - span) continue;
    while (j < points.length - 2 && lengths[j]! < lengths[i]! + span) j++;
    let turn = Math.abs(direction(j) - direction(i));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    out.push((turn * 180) / Math.PI);
  }
  return out;
}

function distanceToLine(p: WorldPoint, line: readonly WorldPoint[]): number {
  let best = Infinity;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.min(Math.max(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0), 1);
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}

describe('riverNetwork', () => {
  it('opens a ring around a single hex that nothing joins: it is left out', () => {
    const map = createFlatMap({ width: 8, height: 8, metres: 10 });
    const hex = 3 * 8 + 3;
    for (let d = 0; d < 6; d++) setRiver(map, hex, d);
    expect(ringHexes(map, riverNetwork({ ...map, riverEdges: map.riverEdges }).links)).toEqual([]);
    const network = riverNetwork(map);
    expect(network.opened).toBe(6);
    expect(edgeCount(network.links)).toBe(0);
    expect(riverCourses(map)).toEqual([]);
  });

  it('opens a ring that a river runs into and out of on the long side, and keeps the river in one piece', () => {
    const map = createFlatMap({ width: 10, height: 8, metres: 10 });
    const hex = 3 * 10 + 4;
    for (let d = 0; d < 6; d++) setRiver(map, hex, d);
    // a river arrives from the west and leaves to the east: an edge of each neighbour that ends on the ring
    setRiver(map, 3 * 10 + 3, 1);
    setRiver(map, 3 * 10 + 5, 4);
    const before = rawEdgeCount(map);
    const network = riverNetwork(map);
    expect(ringHexes(map, network.links)).toEqual([]);
    expect(network.opened).toBeGreaterThanOrEqual(1);
    expect(network.opened).toBeLessThanOrEqual(5);
    expect(edgeCount(network.links)).toBe(before - network.opened);
    // one river still, from end to end
    const courses = riverCourses(map);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.closed).toBe(false);
    expect(courses[0]!.points.length - 1).toBe(before - network.opened);
  });

  it('counts what drains through a corner: more downstream', () => {
    const map = createFlatMap({ width: 12, height: 6, metres: 10 });
    for (const col of [2, 3, 4, 5, 6]) {
      setRiver(map, 2 * 12 + col, 4);
      setRiver(map, 2 * 12 + col, 5);
    }
    const [course] = riverCourses(map);
    expect(course!.flows).toHaveLength(course!.points.length);
    const flows = course!.flows;
    // from one end to the other the flow only grows, or only falls
    const rising = flows.every((flow, i) => i === 0 || flow >= flows[i - 1]!);
    const falling = flows.every((flow, i) => i === 0 || flow <= flows[i - 1]!);
    expect(rising || falling).toBe(true);
    expect(Math.max(...flows)).toBeGreaterThanOrEqual(flows.length - 1);
    expect(Math.min(...flows)).toBeLessThanOrEqual(2);
  });

  it('widens a river with its flow', () => {
    expect(riverWidthFactor(1)).toBeLessThan(0.7);
    expect(riverWidthFactor(40)).toBeGreaterThan(riverWidthFactor(10));
    expect(riverWidthFactor(150)).toBeGreaterThan(1.5);
    expect(riverWidthFactor(1e6)).toBe(riverWidthFactor(150));
  });
});

describe('the rivers of the real map', () => {
  let map: MapData;
  let courses: RiverCourse[];
  beforeAll(async () => {
    map = (await loadRealMap()).map;
    courses = riverCourses(map);
  });

  it('have no ring around a single hex, though the data holds several', () => {
    // the data: hexes with a river on all six edges
    let rings = 0;
    for (const edges of map.riverEdges) if (edges === 63) rings++;
    expect(rings).toBeGreaterThan(0);
    const network = riverNetwork(map);
    expect(ringHexes(map, network.links)).toEqual([]);
    expect(network.opened).toBeGreaterThan(0);
    // nothing but ring edges is left out
    expect(edgeCount(network.links)).toBe(rawEdgeCount(map) - network.opened);
    expect(network.opened).toBeLessThanOrEqual(rings * 6);
    // and no course closes on itself around one hex
    for (const course of courses) expect(course.closed && course.points.length <= 7).toBe(false);
    const drawn = courses.reduce((sum, course) => sum + course.points.length - 1, 0);
    expect(drawn).toBe(edgeCount(network.links));
  });

  it('are drawn without the zigzag of the hex edges', () => {
    const span = 0.3;
    const raw: number[] = [];
    const smooth: number[] = [];
    let farthest = 0;
    for (const course of courses) {
      if (course.points.length < 8) continue;
      // the course as the edges give it, with points every tenth of a hex
      const dense: WorldPoint[] = [];
      course.points.forEach((p, i) => {
        const q = course.points[i + 1];
        if (q === undefined) dense.push(p);
        else for (let k = 0; k < 10; k++) dense.push({ x: p.x + ((q.x - p.x) * k) / 10, z: p.z + ((q.z - p.z) * k) / 10 });
      });
      raw.push(...turns(dense, span, 1));
      const line = riverLine(course, 1, 0.1);
      smooth.push(...turns(line.course.points, span, 1));
      for (const p of line.course.points) farthest = Math.max(farthest, distanceToLine(p, course.points));
      // ends stay where they are: rivers still meet in a point
      expect(line.course.points[0]).toEqual(course.points[0]);
      expect(line.course.points[line.course.points.length - 1]).toEqual(course.points[course.points.length - 1]);
      expect(line.widths).toHaveLength(line.course.points.length);
    }
    const share = (values: readonly number[], from: number): number => values.filter((v) => v >= from).length / values.length;
    // along the edges, three stretches in ten turn by the 60 degrees of a hex corner
    expect(share(raw, 45)).toBeGreaterThan(0.2);
    // as drawn, almost none does, and the typical stretch is nearly straight
    expect(share(smooth, 45)).toBeLessThan(0.01);
    expect(share(smooth, 30)).toBeLessThan(0.06);
    const sorted = smooth.slice().sort((a, b) => a - b);
    expect(sorted[sorted.length >> 1]).toBeLessThan(12);
    // and the line stays with the edges it stands for
    expect(farthest).toBeLessThan(0.7);
  });

  it('grow wider downstream: the great rivers are several times as wide at the mouth as at the source', () => {
    const flows = courses.flatMap((course) => course.flows);
    expect(Math.max(...flows)).toBeGreaterThan(120);
    expect(Math.min(...flows)).toBe(1);
    const widest = Math.max(...courses.map((course) => Math.max(...riverLine(course, 1, 0.5).widths)));
    const narrowest = Math.min(...courses.map((course) => Math.min(...riverLine(course, 1, 0.5).widths)));
    expect(widest / narrowest).toBeGreaterThan(2.5);
    // from every corner to the next one downstream there is more river, all the way to a mouth
    const network = riverNetwork(map);
    let mouths = 0;
    for (const [node, next] of network.downstream) {
      if (next < 0) {
        mouths++;
        continue;
      }
      expect(network.flow.get(next)!).toBeGreaterThan(network.flow.get(node)!);
      expect(network.links.get(node)).toContain(next);
    }
    expect(mouths).toBeGreaterThan(20);
    // most rivers end in the water
    const wetMouths = [...network.downstream].filter(([node, next]) => next < 0 && network.wet.has(node)).length;
    expect(wetMouths / mouths).toBeGreaterThan(0.6);
  });
});
