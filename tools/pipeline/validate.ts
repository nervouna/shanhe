/**
 * Checks on a finished `MapData`. They read nothing but the map, so they run
 * on the committed files: `npm run pipeline:check` and the tests use them,
 * and the pipeline refuses to write a map that fails them.
 */

import { hexNeighbor, indexToOffset, oppositeDirection } from '../../src/shared/hex.ts';
import type { Offset } from '../../src/shared/hex.ts';
import {
  Feature,
  NO_RESOURCE,
  NO_ZONE,
  OWNER_OFF_MAP,
  OWNER_SEA,
  OWNER_UNOWNED,
  Terrain,
  isWaterTerrain,
} from '../../src/shared/mapData.ts';
import type { MapData } from '../../src/shared/mapData.ts';
import { edgeCorners, edgeKey } from './hexEdges.ts';

/** What the map must satisfy (issue #4 and `docs/design/01-world-and-map.md`). */
export const RULES = {
  nations: 50,
  cityStates: 10,
  wastelandRegions: 4,
  nationMinHexes: 7,
  cityStateMinHexes: 1,
  cityStateMaxHexes: 3,
  nationMaxZones: 4,
  wastelandMinZones: 2,
  wastelandMaxZones: 6,
  playableLandMin: 6000,
  playableLandMax: 8000,
  /** Largest number of sea hexes between two parts of one zone. */
  maxSeaGap: 3,
  minRivers: 40,
  minLandPorts: 3,
  minSeaPorts: 2,
  maxHeightmapWidth: 4096,
} as const;

export interface PolityRow {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly kind: string;
  readonly hexes: number;
  readonly zones: number;
}

export interface MapTotals {
  readonly hexes: number;
  /** Land hexes of nations, city-states and wasteland regions. */
  readonly playableLand: number;
  /** Land hexes owned by a nation or a city-state at the start. */
  readonly ownedLand: number;
  readonly wastelandLand: number;
  readonly offMapLand: number;
  readonly water: number;
  readonly zones: number;
  /** Zones whose hexes are not all joined over land (islands). */
  readonly zonesJoinedBySea: number;
  readonly riverEdges: number;
  readonly rivers: number;
  readonly landPorts: number;
  readonly seaPorts: number;
}

export interface MapReport {
  readonly errors: readonly string[];
  readonly rows: readonly PolityRow[];
  readonly totals: MapTotals;
}

function inGrid(map: MapData, hex: Offset): boolean {
  return hex.col >= 0 && hex.col < map.width && hex.row >= 0 && hex.row < map.height;
}

/**
 * The hexes of zone `zone` that can be reached from `start`: by steps to an
 * adjacent hex of the zone or, if `maxSeaGap` is above 0, across at most
 * that many sea hexes of the play area (`OWNER_SEA`). Land of another zone,
 * off-map hexes and lakes surrounded by them do not carry a link.
 */
export function reachableInZone(
  map: MapData,
  zone: number,
  start: number,
  maxSeaGap: number,
): Set<number> {
  const reached = new Set<number>();
  if (map.zone[start] !== zone) return reached;
  // smallest number of sea hexes used to arrive at a water hex
  const seaDepth = new Map<number, number>();
  const queue: [index: number, depth: number][] = [[start, 0]];
  reached.add(start);
  for (let head = 0; head < queue.length; head++) {
    const [index, depth] = queue[head] as [number, number];
    const hex = indexToOffset(index, map.width);
    for (let d = 0; d < 6; d++) {
      const n = hexNeighbor(hex, d);
      if (!inGrid(map, n)) continue;
      const ni = n.row * map.width + n.col;
      if (map.zone[ni] === zone) {
        if (!reached.has(ni)) {
          reached.add(ni);
          queue.push([ni, 0]);
        }
      } else if (map.owner[ni] === OWNER_SEA && depth < maxSeaGap) {
        const known = seaDepth.get(ni);
        if (known === undefined || known > depth + 1) {
          seaDepth.set(ni, depth + 1);
          queue.push([ni, depth + 1]);
        }
      }
    }
  }
  return reached;
}

/**
 * River edges and the number of rivers they amount to.
 *
 * River edges form a graph on the corners of the hexes. In each connected
 * piece of it, a corner where only one river edge ends is a spring or a
 * mouth, and a piece with `n` such ends holds `n - 1` rivers: the main
 * stream plus one per tributary. A piece without ends (a loop) counts as one.
 */
export function countRivers(map: MapData): { edges: number; rivers: number } {
  const neighbours = new Map<number, number[]>();
  const seen = new Set<number>();
  for (let i = 0; i < map.riverEdges.length; i++) {
    const bits = map.riverEdges[i] as number;
    if (bits === 0) continue;
    const hex = indexToOffset(i, map.width);
    for (let d = 0; d < 6; d++) {
      if ((bits & (1 << d)) === 0) continue;
      const [a, b] = edgeCorners(hex, d);
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
      neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
    }
  }
  let rivers = 0;
  const visited = new Set<number>();
  for (const first of neighbours.keys()) {
    if (visited.has(first)) continue;
    let ends = 0;
    const stack = [first];
    visited.add(first);
    while (stack.length > 0) {
      const corner = stack.pop() as number;
      const next = neighbours.get(corner) as number[];
      if (next.length === 1) ends++;
      for (const other of next) {
        if (!visited.has(other)) {
          visited.add(other);
          stack.push(other);
        }
      }
    }
    rivers += Math.max(1, ends - 1);
  }
  return { edges: seen.size, rivers };
}

/** Runs every check. `errors` is empty for a valid map. */
export function validateMap(map: MapData): MapReport {
  const errors: string[] = [];
  const fail = (message: string): void => {
    if (errors.length < 200) errors.push(message);
  };
  const count = map.width * map.height;
  const polities = map.polities;
  const zones = map.zones;

  // Polities.
  const kinds = { nation: 0, cityState: 0, wastelandRegion: 0 };
  const ids = new Set<string>();
  const colours = new Set<number>();
  for (const p of polities) {
    kinds[p.kind]++;
    if (ids.has(p.id)) fail(`polity id ${p.id} is used twice`);
    ids.add(p.id);
    if (colours.has(p.color)) fail(`polity ${p.id} shares its colour with another polity`);
    colours.add(p.color);
    if (p.nameZh === '' || p.nameEn === '') fail(`polity ${p.id} lacks a name`);
  }
  if (kinds.nation !== RULES.nations) fail(`${kinds.nation} nations, expected ${RULES.nations}`);
  if (kinds.cityState !== RULES.cityStates) {
    fail(`${kinds.cityState} city-states, expected ${RULES.cityStates}`);
  }
  if (kinds.wastelandRegion !== RULES.wastelandRegions) {
    fail(`${kinds.wastelandRegion} wasteland regions, expected ${RULES.wastelandRegions}`);
  }

  // Hexes.
  const polityHexes = new Array<number>(polities.length).fill(0);
  const zoneHexes = new Array<number>(zones.length).fill(0);
  let offMapLand = 0;
  let water = 0;
  for (let i = 0; i < count; i++) {
    const terrain = map.terrain[i] as number;
    const owner = map.owner[i] as number;
    const zone = map.zone[i] as number;
    const at = `hex ${i}`;
    if (terrain > Terrain.Mountain) fail(`${at}: unknown terrain ${terrain}`);
    if ((map.feature[i] as number) > Feature.Volcano) fail(`${at}: unknown feature`);
    if ((map.hills[i] as number) > 1) fail(`${at}: hills is not 0 or 1`);
    const isWater = isWaterTerrain(terrain);
    if ((isWater || terrain === Terrain.Mountain) && map.hills[i] !== 0) {
      fail(`${at}: hills on water or a mountain`);
    }
    if (isWater && map.feature[i] !== Feature.None) fail(`${at}: feature on water`);
    const resource = map.resource[i] as number;
    if (resource !== NO_RESOURCE && (resource < 0 || resource >= map.resources.length)) {
      fail(`${at}: unknown resource ${resource}`);
    }
    if (isWater) {
      water++;
      if (owner !== OWNER_SEA && owner !== OWNER_OFF_MAP) fail(`${at}: water with owner ${owner}`);
      if (zone !== NO_ZONE) fail(`${at}: water in a zone`);
      if (map.riverEdges[i] !== 0) fail(`${at}: river edge on water`);
      if (resource !== NO_RESOURCE) fail(`${at}: resource on water`);
    } else if (owner === OWNER_OFF_MAP) {
      offMapLand++;
      if (zone !== NO_ZONE) fail(`${at}: off-map land in a zone`);
      if (resource !== NO_RESOURCE) fail(`${at}: resource on off-map land`);
    } else {
      const z = zones[zone];
      if (zone === NO_ZONE || z === undefined) {
        fail(`${at}: land in the play area without a zone`);
        continue;
      }
      zoneHexes[zone] = (zoneHexes[zone] as number) + 1;
      polityHexes[z.polity] = (polityHexes[z.polity] as number) + 1;
      const polity = polities[z.polity];
      if (polity === undefined) fail(`${at}: zone ${z.id} names no polity`);
      else if (polity.kind === 'wastelandRegion') {
        if (owner !== OWNER_UNOWNED) fail(`${at}: wasteland hex with owner ${owner}`);
      } else if (owner !== z.polity) fail(`${at}: owner ${owner} differs from its zone's polity`);
    }
    // a river edge is set on both hexes that share it
    const bits = map.riverEdges[i] as number;
    if (bits !== 0) {
      const hex = indexToOffset(i, map.width);
      for (let d = 0; d < 6; d++) {
        if ((bits & (1 << d)) === 0) continue;
        const n = hexNeighbor(hex, d);
        if (!inGrid(map, n)) continue;
        const other = map.riverEdges[n.row * map.width + n.col] as number;
        if ((other & (1 << oppositeDirection(d))) === 0) fail(`${at}: river edge ${d} is one-sided`);
      }
    }
  }

  // Zones.
  const zoneIds = new Set<string>();
  const zonesOf = new Array<number>(polities.length).fill(0);
  const capitalsOf = new Array<number>(polities.length).fill(0);
  let zonesJoinedBySea = 0;
  zones.forEach((z, zi) => {
    if (zoneIds.has(z.id)) fail(`zone id ${z.id} is used twice`);
    zoneIds.add(z.id);
    const polity = polities[z.polity];
    if (polity === undefined) {
      fail(`zone ${z.id}: unknown polity`);
      return;
    }
    zonesOf[z.polity] = (zonesOf[z.polity] as number) + 1;
    if (z.capital) capitalsOf[z.polity] = (capitalsOf[z.polity] as number) + 1;
    if (z.cityNameZh === '' || z.cityNameEn === '') fail(`zone ${z.id}: city without a name`);
    if (map.zone[z.siteHex] !== zi) {
      fail(`zone ${z.id}: its site is not inside the zone`);
      return;
    }
    const siteOwner = map.owner[z.siteHex];
    if (siteOwner !== (polity.kind === 'wastelandRegion' ? OWNER_UNOWNED : z.polity)) {
      fail(`zone ${z.id}: its site is not owned by ${polity.id}`);
    }
    if (map.terrain[z.siteHex] === Terrain.Mountain) fail(`zone ${z.id}: its site is a mountain`);
    const size = zoneHexes[zi] as number;
    const linked = reachableInZone(map, zi, z.siteHex, RULES.maxSeaGap).size;
    if (linked !== size) {
      fail(`zone ${z.id}: ${size - linked} of ${size} hexes are cut off from the site`);
    } else if (reachableInZone(map, zi, z.siteHex, 0).size !== size) {
      zonesJoinedBySea++;
    }
  });

  // Sizes, zone counts and capitals per polity.
  const rows: PolityRow[] = polities.map((p, pi) => {
    const hexes = polityHexes[pi] as number;
    const zoneCount = zonesOf[pi] as number;
    const capitals = capitalsOf[pi] as number;
    if (p.kind === 'nation') {
      if (hexes < RULES.nationMinHexes) fail(`nation ${p.id} has ${hexes} hexes`);
      if (zoneCount < 1 || zoneCount > RULES.nationMaxZones) {
        fail(`nation ${p.id} has ${zoneCount} zones`);
      }
    } else if (p.kind === 'cityState') {
      if (hexes < RULES.cityStateMinHexes || hexes > RULES.cityStateMaxHexes) {
        fail(`city-state ${p.id} has ${hexes} hexes`);
      }
      if (zoneCount !== 1) fail(`city-state ${p.id} has ${zoneCount} zones`);
    } else if (zoneCount < RULES.wastelandMinZones || zoneCount > RULES.wastelandMaxZones) {
      fail(`wasteland region ${p.id} has ${zoneCount} sites`);
    }
    if (p.kind === 'wastelandRegion') {
      if (capitals !== 0 || p.capitalZone !== NO_ZONE) fail(`wasteland region ${p.id} has a capital`);
    } else {
      if (capitals !== 1) fail(`${p.id} has ${capitals} capital zones`);
      const capital = zones[p.capitalZone];
      if (capital === undefined || capital.polity !== pi || !capital.capital) {
        fail(`${p.id}: capitalZone does not name its capital zone`);
      }
    }
    return { id: p.id, nameZh: p.nameZh, nameEn: p.nameEn, kind: p.kind, hexes, zones: zoneCount };
  });

  let ownedLand = 0;
  let wastelandLand = 0;
  polities.forEach((p, pi) => {
    if (p.kind === 'wastelandRegion') wastelandLand += polityHexes[pi] as number;
    else ownedLand += polityHexes[pi] as number;
  });
  const playableLand = ownedLand + wastelandLand;
  if (playableLand < RULES.playableLandMin || playableLand > RULES.playableLandMax) {
    fail(`playable land is ${playableLand} hexes`);
  }

  // Rivers.
  const river = countRivers(map);
  if (river.rivers < RULES.minRivers) fail(`river edges amount to only ${river.rivers} rivers`);

  // Ports: off-map hexes that border the play area.
  let landPorts = 0;
  let seaPorts = 0;
  for (const port of map.offMapPorts) {
    const at = `port ${port.nameEn}`;
    if (port.hex < 0 || port.hex >= count) {
      fail(`${at}: hex out of range`);
      continue;
    }
    if (map.owner[port.hex] !== OWNER_OFF_MAP) fail(`${at}: not on an off-map hex`);
    const isWater = isWaterTerrain(map.terrain[port.hex] as number);
    if (isWater !== (port.kind === 'sea')) fail(`${at}: kind does not match its terrain`);
    const hex = indexToOffset(port.hex, map.width);
    let bordersPlay = false;
    for (let d = 0; d < 6; d++) {
      const n = hexNeighbor(hex, d);
      if (!inGrid(map, n)) continue;
      const ni = n.row * map.width + n.col;
      const owner = map.owner[ni] as number;
      const neighbourIsWater = isWaterTerrain(map.terrain[ni] as number);
      // a land port is reached over land, a sea exit by sea
      if (owner !== OWNER_OFF_MAP && neighbourIsWater === isWater) bordersPlay = true;
    }
    if (!bordersPlay) fail(`${at}: does not border the play area`);
    if (port.kind === 'land') landPorts++;
    else seaPorts++;
  }
  if (landPorts < RULES.minLandPorts) fail(`${landPorts} land ports`);
  if (seaPorts < RULES.minSeaPorts) fail(`${seaPorts} sea exits`);

  // Heightmap description.
  const h = map.heightmap;
  if (h.width > RULES.maxHeightmapWidth || h.width < 2 || h.height < 2) {
    fail(`heightmap is ${h.width} x ${h.height}`);
  }

  return {
    errors,
    rows,
    totals: {
      hexes: count,
      playableLand,
      ownedLand,
      wastelandLand,
      offMapLand,
      water,
      zones: zones.length,
      zonesJoinedBySea,
      riverEdges: river.edges,
      rivers: river.rivers,
      landPorts,
      seaPorts,
    },
  };
}

/** The report as text: one row per polity, then the totals line. */
export function formatReport(report: MapReport): string {
  const lines: string[] = [];
  const pad = (text: string, width: number): string => {
    // Chinese characters take two columns
    let shown = 0;
    for (const ch of text) shown += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
    return text + ' '.repeat(Math.max(0, width - shown));
  };
  lines.push(`${pad('polity', 26)}${pad('kind', 17)}${pad('hexes', 7)}zones`);
  for (const row of report.rows) {
    lines.push(
      `${pad(`${row.nameZh} ${row.nameEn}`, 26)}${pad(row.kind, 17)}${pad(String(row.hexes), 7)}${row.zones}`,
    );
  }
  const t = report.totals;
  lines.push(
    `totals: ${report.rows.length} polities, playable land ${t.playableLand} hexes ` +
      `(${t.ownedLand} owned by nations and city-states, ${t.wastelandLand} wasteland), ` +
      `${t.zones} zones (${t.zonesJoinedBySea} joined across sea), ` +
      `${t.riverEdges} river edges = ${t.rivers} rivers, ` +
      `${t.landPorts} land ports, ${t.seaPorts} sea exits, ` +
      `${t.offMapLand} off-map land hexes, ${t.water} water hexes, ${t.hexes} hexes in all`,
  );
  return lines.join('\n');
}
