import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexCorners, hexNeighbor, hexToWorld, indexToOffset } from '../shared/hex.ts';
import type { WorldPoint } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import {
  appendRibbon,
  cornerId,
  emptyRibbon,
  networkCourses,
  pathCourse,
  resampleCourse,
  riverCourses,
  roadCourses,
  smoothCourse,
  splineCourse,
} from './ribbon.ts';
import type { Course, Ribbon } from './ribbon.ts';
import { createFlatMap } from './testMaps.ts';

/** Sets the river edge between a hex and its neighbour in direction `d`, on both hexes. */
function setRiver(map: MapData, hex: number, d: number): void {
  const neighbor = hexNeighbor(indexToOffset(hex, map.width), d);
  (map.riverEdges[hex] as number) |= 1 << d;
  (map.riverEdges[neighbor.row * map.width + neighbor.col] as number) |= 1 << ((d + 3) % 6);
}

function riverEdgeCount(map: MapData): number {
  let bits = 0;
  for (const edges of map.riverEdges) for (let d = 0; d < 6; d++) if ((edges >> d) & 1) bits++;
  return bits / 2;
}

/** Whether a point lies inside (or on the edge of) any triangle of a ribbon. */
function covered(ribbon: Ribbon, x: number, z: number): boolean {
  for (let t = 0; t < ribbon.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => {
      const v = ribbon.indices[t + k]!;
      return [ribbon.positions[v * 2]!, ribbon.positions[v * 2 + 1]!] as const;
    }) as [readonly [number, number], readonly [number, number], readonly [number, number]];
    const side = (p: readonly [number, number], q: readonly [number, number]): number =>
      (q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const d1 = side(a, b);
    const d2 = side(b, c);
    const d3 = side(c, a);
    const eps = 1e-9;
    if ((d1 >= -eps && d2 >= -eps && d3 >= -eps) || (d1 <= eps && d2 <= eps && d3 <= eps)) return true;
  }
  return false;
}

function length(course: Course): number {
  let total = 0;
  for (let i = 1; i < course.points.length; i++) {
    total += Math.hypot(course.points[i]!.x - course.points[i - 1]!.x, course.points[i]!.z - course.points[i - 1]!.z);
  }
  return total;
}

describe('riverCourses', () => {
  it('names a corner the same from each of its three hexes', () => {
    const map = createFlatMap({ width: 6, height: 6, metres: 10, originX: -3.3, originZ: 7.1 });
    const layout = map.projection.hexLayout;
    const ids = new Map<number, number>();
    for (let i = 0; i < 36; i++) {
      for (const corner of hexCorners(indexToOffset(i, map.width), layout)) {
        const id = cornerId(corner, layout);
        ids.set(id, (ids.get(id) ?? 0) + 1);
      }
    }
    // an inner corner is shared by three hexes, never by more
    expect(Math.max(...ids.values())).toBe(3);
    expect([...ids.values()].filter((n) => n === 3).length).toBeGreaterThan(20);
  });

  it('turns a run of edges into one line through their corners', () => {
    const map = createFlatMap({ width: 8, height: 6, metres: 10 });
    // along the south side of row 2: SW and SE edges of three hexes in a row
    for (const col of [2, 3, 4]) {
      setRiver(map, 2 * 8 + col, 4);
      setRiver(map, 2 * 8 + col, 5);
    }
    const courses = riverCourses(map);
    expect(courses).toHaveLength(1);
    const course = courses[0]!;
    expect(course.points).toHaveLength(7);
    expect(course.closed).toBe(false);
    // both ends are sources on dry land: they thin out
    expect(course.taperStart).toBe(true);
    expect(course.taperEnd).toBe(true);
    for (let i = 1; i < course.points.length; i++) {
      const step = Math.hypot(course.points[i]!.x - course.points[i - 1]!.x, course.points[i]!.z - course.points[i - 1]!.z);
      expect(step).toBeCloseTo(1, 6);
    }
  });

  it('ends three lines in the corner where three river edges meet', () => {
    const map = createFlatMap({ width: 8, height: 8, metres: 10 });
    const hex = 3 * 8 + 3;
    // the E and SE edges of a hex share its lower right corner; the third edge at that corner
    // lies between its E and SE neighbours
    setRiver(map, hex, 0);
    setRiver(map, hex, 5);
    const east = hexNeighbor(indexToOffset(hex, 8), 0);
    setRiver(map, east.row * 8 + east.col, 4);
    const courses = riverCourses(map);
    expect(courses).toHaveLength(3);
    const layout = map.projection.hexLayout;
    const ends = courses.flatMap((course) => [course.points[0]!, course.points[course.points.length - 1]!]);
    const counts = new Map<number, number>();
    for (const end of ends) counts.set(cornerId(end, layout), (counts.get(cornerId(end, layout)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(3);
  });

  it('uses every river edge of the fixture map exactly once', () => {
    const map = createFixtureMap();
    const courses = riverCourses(map);
    expect(courses.length).toBeGreaterThan(0);
    const layout = map.projection.hexLayout;
    const seen = new Set<string>();
    let segments = 0;
    for (const course of courses) {
      for (let i = 1; i < course.points.length; i++) {
        const a = cornerId(course.points[i - 1]!, layout);
        const b = cornerId(course.points[i]!, layout);
        expect(a).not.toBe(b);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        segments++;
      }
    }
    expect(segments).toBe(riverEdgeCount(map));
  });

  it('does not thin a river out where it reaches the water', () => {
    const map = createFixtureMap();
    const water = new Set<number>();
    const layout = map.projection.hexLayout;
    for (let i = 0; i < map.width * map.height; i++) {
      if ((map.terrain[i] as number) > 2) continue;
      for (const corner of hexCorners(indexToOffset(i, map.width), layout)) water.add(cornerId(corner, layout));
    }
    for (const course of riverCourses(map)) {
      if (course.taperStart) expect(water.has(cornerId(course.points[0]!, layout))).toBe(false);
      if (course.taperEnd) expect(water.has(cornerId(course.points[course.points.length - 1]!, layout))).toBe(false);
    }
  });
});

describe('smoothing', () => {
  const zigzag: Course = {
    points: [0, 1, 2, 3, 4, 5].map((i) => ({ x: i, z: i % 2 })),
    closed: false,
    taperStart: false,
    taperEnd: false,
  };

  it('rounds the corners and keeps the ends of an open line', () => {
    const smooth = smoothCourse(zigzag, 2);
    expect(smooth.points.length).toBeGreaterThan(zigzag.points.length * 2);
    expect(smooth.points[0]).toEqual(zigzag.points[0]);
    expect(smooth.points[smooth.points.length - 1]).toEqual(zigzag.points[5]);
    expect(length(smooth)).toBeLessThan(length(zigzag));
    // no bend is as sharp as before: the sharpest turn of the zigzag is 90 degrees
    let sharpest = 0;
    for (let i = 1; i < smooth.points.length - 1; i++) {
      const a = smooth.points[i - 1]!;
      const b = smooth.points[i]!;
      const c = smooth.points[i + 1]!;
      const turn = Math.abs(Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x));
      sharpest = Math.max(sharpest, turn);
    }
    expect(sharpest).toBeLessThan(Math.PI / 4);
  });

  it('keeps a closed line closed', () => {
    const square: Course = {
      points: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
        { x: 0, z: 1 },
        { x: 0, z: 0 },
      ],
      closed: true,
      taperStart: false,
      taperEnd: false,
    };
    const smooth = smoothCourse(square, 2);
    expect(smooth.points[0]).toEqual(smooth.points[smooth.points.length - 1]);
    expect(smooth.points.length).toBe(17);
  });

  it('passes a spline through every point of the line', () => {
    const spline = splineCourse(zigzag, 4);
    expect(spline.points).toHaveLength(5 * 4 + 1);
    zigzag.points.forEach((point, i) => {
      expect(spline.points[i * 4]!.x).toBeCloseTo(point.x, 9);
      expect(spline.points[i * 4]!.z).toBeCloseTo(point.z, 9);
    });
  });

  it('resamples so that no two points are farther apart than asked', () => {
    const fine = resampleCourse(zigzag, 0.2);
    for (let i = 1; i < fine.points.length; i++) {
      expect(Math.hypot(fine.points[i]!.x - fine.points[i - 1]!.x, fine.points[i]!.z - fine.points[i - 1]!.z)).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    expect(length(fine)).toBeCloseTo(length(zigzag), 9);
  });
});

describe('appendRibbon', () => {
  const bend: Course = {
    points: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1.5, z: 0.866 },
      { x: 2.5, z: 0.866 },
    ],
    closed: false,
    taperStart: false,
    taperEnd: false,
  };

  it('is continuous: consecutive pieces share their two vertices', () => {
    const ribbon = emptyRibbon();
    appendRibbon(ribbon, bend, 0.1, false);
    // two vertices per point, two triangles per piece
    expect(ribbon.across).toHaveLength(8);
    expect(ribbon.indices).toHaveLength(3 * 6);
    for (let piece = 0; piece < 3; piece++) {
      const used = new Set(ribbon.indices.slice(piece * 6, piece * 6 + 6));
      expect([...used].sort((a, b) => a - b)).toEqual([piece * 2, piece * 2 + 1, piece * 2 + 2, piece * 2 + 3]);
    }
  });

  it('keeps its width through a bend and covers the centre line without a gap', () => {
    const ribbon = emptyRibbon();
    const fine = resampleCourse(smoothCourse(bend, 2), 0.05);
    appendRibbon(ribbon, fine, 0.1);
    for (let i = 1; i < fine.points.length; i++) {
      const a = fine.points[i - 1]!;
      const b = fine.points[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz);
      for (const t of [0.25, 0.75]) {
        const x = a.x + dx * t;
        const z = a.z + dz * t;
        expect(covered(ribbon, x, z)).toBe(true);
        // and most of the way to either edge
        expect(covered(ribbon, x - (dz / l) * 0.085, z + (dx / l) * 0.085)).toBe(true);
        expect(covered(ribbon, x + (dz / l) * 0.085, z - (dx / l) * 0.085)).toBe(true);
        // but not well outside it
        expect(covered(ribbon, x - (dz / l) * 0.16, z + (dx / l) * 0.16)).toBe(false);
      }
    }
  });

  it('leaves no gap at a joint: the lines that meet in a corner cover a disc around it', () => {
    const map = createFlatMap({ width: 8, height: 8, metres: 10 });
    const hex = 3 * 8 + 3;
    setRiver(map, hex, 0);
    setRiver(map, hex, 5);
    const east = hexNeighbor(indexToOffset(hex, 8), 0);
    setRiver(map, east.row * 8 + east.col, 4);
    const half = 0.085;
    const ribbon = emptyRibbon();
    for (const course of riverCourses(map)) appendRibbon(ribbon, resampleCourse(smoothCourse(course, 2), 0.1), half);
    // the corner the three lines share: the one point that is an end of all of them
    const layout = map.projection.hexLayout;
    const ends = riverCourses(map).flatMap((course) => [course.points[0]!, course.points[course.points.length - 1]!]);
    const joint = ends.find((end) => ends.filter((other) => cornerId(other, layout) === cornerId(end, layout)).length === 3) as WorldPoint;
    expect(joint).toBeDefined();
    for (let k = 0; k < 36; k++) {
      const angle = (k / 36) * Math.PI * 2;
      for (const r of [0.3, 0.6, 0.9]) {
        expect(covered(ribbon, joint.x + Math.cos(angle) * half * r, joint.z + Math.sin(angle) * half * r)).toBe(true);
      }
    }
  });

  it('closes an open end with a round cap and thins a source out', () => {
    const ribbon = emptyRibbon();
    appendRibbon(ribbon, bend, 0.1);
    // beyond the end, within the radius: covered by the cap
    expect(covered(ribbon, -0.07, 0)).toBe(true);
    expect(covered(ribbon, 2.57, 0.866)).toBe(true);
    expect(covered(ribbon, -0.12, 0)).toBe(false);

    const source = emptyRibbon();
    appendRibbon(source, { ...bend, taperStart: true }, 0.1, false);
    const widthAt = (pair: number): number =>
      Math.hypot(source.positions[pair * 4]! - source.positions[pair * 4 + 2]!, source.positions[pair * 4 + 1]! - source.positions[pair * 4 + 3]!);
    expect(widthAt(0)).toBeLessThan(0.1);
    expect(widthAt(3)).toBeGreaterThan(0.19);
  });

  it('closes a loop on itself', () => {
    const ribbon = emptyRibbon();
    const loop: Course = {
      points: [0, 1, 2, 3, 4, 5, 0].map((k) => ({ x: Math.cos((k / 6) * Math.PI * 2), z: Math.sin((k / 6) * Math.PI * 2) })),
      closed: true,
      taperStart: false,
      taperEnd: false,
    };
    appendRibbon(ribbon, loop, 0.1);
    expect(ribbon.across).toHaveLength(12);
    expect(ribbon.indices).toHaveLength(6 * 6);
    for (let k = 0; k < 24; k++) {
      const angle = (k / 24) * Math.PI * 2;
      const r = Math.cos(Math.PI / 6) / Math.cos((angle % (Math.PI / 3)) - Math.PI / 6);
      expect(covered(ribbon, Math.cos(angle) * r, Math.sin(angle) * r)).toBe(true);
    }
  });
});

describe('roads and routes', () => {
  const map = createFlatMap({ width: 10, height: 8, metres: 10 });
  const layout = map.projection.hexLayout;
  const centre = (hex: number): WorldPoint => hexToWorld(indexToOffset(hex, map.width), layout);
  const at = (course: Course, hex: number): boolean =>
    course.points.some((p) => Math.hypot(p.x - centre(hex).x, p.z - centre(hex).z) < 1e-9);

  it('draws a road through the centres of its hexes, once', () => {
    const hexes = [21, 22, 23, 24];
    const courses = networkCourses(map, new Set(hexes));
    expect(courses).toHaveLength(1);
    expect(courses[0]!.points).toHaveLength(4);
    for (const hex of hexes) expect(at(courses[0]!, hex)).toBe(true);
    // smoothed for drawing, it still passes through every centre
    const drawn = resampleCourse(splineCourse(courses[0]!, 4), 0.1);
    for (const hex of hexes) expect(at(drawn, hex)).toBe(true);
  });

  it('joins every pair of neighbouring road hexes exactly once, also at a fork', () => {
    // a line with a branch: 22 has three neighbours in the set
    const hexes = new Set([21, 22, 23, 32, 42]);
    const courses = networkCourses(map, hexes);
    const joined = new Set<string>();
    for (const course of courses) {
      for (let i = 1; i < course.points.length; i++) {
        const a = [...hexes].find((hex) => at({ ...course, points: [course.points[i - 1]!] }, hex))!;
        const b = [...hexes].find((hex) => at({ ...course, points: [course.points[i]!] }, hex))!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        expect(joined.has(key)).toBe(false);
        joined.add(key);
      }
    }
    // 21-22, 22-23, 22-32 (or 23-32, both are neighbours of 32 on an odd row), 32-42
    expect(joined.has('21:22')).toBe(true);
    expect(joined.has('22:23')).toBe(true);
    expect(joined.has('32:42')).toBe(true);
    expect(joined.size).toBeGreaterThanOrEqual(4);
  });

  it('draws a railway where both hexes have one and a road where only one has', () => {
    const roads = new Map<number, number>([
      [21, 1],
      [22, 1],
      [23, 2],
      [24, 2],
      [25, 2],
      [99, 1],
      [-4, 2],
    ]);
    const courses = roadCourses(map, roads);
    const rails = courses.filter((c) => c.level === 2);
    const plain = courses.filter((c) => c.level === 1);
    expect(rails).toHaveLength(1);
    expect(rails[0]!.course.points).toHaveLength(3);
    for (const hex of [23, 24, 25]) expect(at(rails[0]!.course, hex)).toBe(true);
    // the road runs 21, 22 and on to the first railway hex, where the two meet
    expect(plain).toHaveLength(1);
    for (const hex of [21, 22, 23]) expect(at(plain[0]!.course, hex)).toBe(true);
    expect(at(plain[0]!.course, 24)).toBe(false);
  });

  it('draws nothing for a single road hex and for no roads at all', () => {
    expect(roadCourses(map, new Map([[21, 1]]))).toEqual([]);
    expect(roadCourses(map, new Map())).toEqual([]);
  });

  it('lays a route through the centres of its path, in order, skipping hexes that are not on the map', () => {
    const course = pathCourse(map, [21, 22, 33, -1, 1e6, 43]);
    expect(course.points).toEqual([21, 22, 33, 43].map(centre));
    const ribbon = emptyRibbon();
    appendRibbon(ribbon, resampleCourse(splineCourse(course, 4), 0.1), 0.034, false);
    for (const hex of [21, 22, 33, 43]) expect(covered(ribbon, centre(hex).x, centre(hex).z)).toBe(true);
    // `along` grows from the start to the end: the dots of a route run along it
    for (let v = 2; v < ribbon.along.length; v += 2) expect(ribbon.along[v]!).toBeGreaterThan(ribbon.along[v - 2]!);
    expect(pathCourse(map, [5]).points).toHaveLength(1);
  });
});
