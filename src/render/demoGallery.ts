/**
 * What the render demo shows besides its sample armies: a city of every
 * architectural family in every era, each with a landmark; a piece of every
 * era's material, plain and with a gold character; every improvement; roads,
 * a railway and trade routes on land and at sea. Placed from the map's own
 * data, so that it works on any map. No DOM and no Three.js.
 */

import { hexDistance, hexLine, hexNeighbors, indexToOffset } from '../shared/hex.ts';
import { Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { CITY_FAMILY_COUNT } from './cityGen.ts';
import type { CityFamilyId } from './cityGen.ts';
import { LANDMARK_IDS } from './landmarks.ts';
import { Improvement } from './scene.ts';
import type { ImprovementId, PieceEraId, RenderCity, RenderRoute, RenderUnit } from './scene.ts';

export interface DemoGallery {
  /** Family by family and era by era; `family` and `era` are set on every one. */
  readonly cities: RenderCity[];
  /** Two pieces per era: a plain one and a unique one. */
  readonly units: RenderUnit[];
  readonly improvements: Map<number, ImprovementId>;
  readonly roads: Map<number, 1 | 2>;
  readonly routes: RenderRoute[];
}

const ERAS = 6;
/** Ids of the gallery's pieces start here, clear of the demo's other pieces. */
const FIRST_UNIT_ID = 8000;
const ERA_CHARACTERS = '兵戟士铳枪步';
const UNIQUE_CHARACTERS = '技弩蕃关湘象';

/**
 * @param taken hexes that are already in use.
 * @param cityName the label of the city of a family in an era.
 * @param near the hex around which the gallery is laid out, nearest first; the first hex of the map if omitted.
 */
export function createDemoGallery(
  map: MapData,
  taken: ReadonlySet<number>,
  cityName: (family: CityFamilyId, era: number) => string,
  near = 0,
): DemoGallery {
  const count = map.width * map.height;
  // every hex, nearest to `near` first
  const origin = indexToOffset(Math.min(Math.max(near, 0), count - 1), map.width);
  const order = Array.from({ length: count }, (_, hex) => hex);
  const reach = order.map((hex) => hexDistance(origin, indexToOffset(hex, map.width)));
  order.sort((a, b) => (reach[a] as number) - (reach[b] as number) || a - b);
  const neighborsOf = (hex: number): number[] =>
    hexNeighbors(indexToOffset(hex, map.width))
      .filter((n) => n.col >= 0 && n.col < map.width && n.row >= 0 && n.row < map.height)
      .map((n) => n.row * map.width + n.col);
  const land = (hex: number): boolean => {
    const terrain = map.terrain[hex] as number;
    return !isWaterTerrain(terrain) && terrain !== Terrain.Mountain;
  };
  const used = new Set(taken);
  const polities = map.polities.map((polity, index) => ({ polity, index })).filter(({ polity }) => polity.kind !== 'wastelandRegion');
  const polityAt = (hex: number, fallback: number): number => {
    const owner = map.owner[hex] as number;
    return owner >= 0 ? owner : (polities[fallback % Math.max(1, polities.length)]?.index ?? 0);
  };

  // cities: on land, with a free hex between any two where the map has the room
  const sites: number[] = [];
  const wanted = polities.length === 0 ? 0 : CITY_FAMILY_COUNT * ERAS;
  for (const spaced of [true, false]) {
    const blocked = new Set(used);
    if (spaced) for (const site of sites) for (const n of neighborsOf(site)) blocked.add(n);
    for (const hex of order) {
      if (sites.length >= wanted) break;
      if (!land(hex) || blocked.has(hex)) continue;
      sites.push(hex);
      used.add(hex);
      blocked.add(hex);
      if (spaced) for (const n of neighborsOf(hex)) blocked.add(n);
    }
  }
  const cities: RenderCity[] = sites.map((hex, i) => {
    const family = (i % CITY_FAMILY_COUNT) as CityFamilyId;
    const era = Math.floor(i / CITY_FAMILY_COUNT) % ERAS;
    return {
      hex,
      polity: polityAt(hex, i),
      population: 3 + era * 3,
      name: cityName(family, era),
      capital: false,
      family,
      era: era as PieceEraId,
      walls: era >= 1,
      buildings: era * 3,
      landmark: LANDMARK_IDS[i % LANDMARK_IDS.length] as string,
    };
  });

  const free = (accept: (hex: number) => boolean, howMany: number): number[] => {
    const out: number[] = [];
    for (const hex of order) {
      if (out.length >= howMany) break;
      if (used.has(hex) || !accept(hex)) continue;
      out.push(hex);
      used.add(hex);
    }
    return out;
  };

  // pieces: every material, plain and unique
  const units: RenderUnit[] = [];
  if (polities.length > 0) {
    free(land, ERAS * 2).forEach((hex, i) => {
      const era = (i % ERAS) as PieceEraId;
      const unique = i >= ERAS;
      units.push({
        id: FIRST_UNIT_ID + i,
        hex,
        polity: polityAt(hex, i),
        character: [...(unique ? UNIQUE_CHARACTERS : ERA_CHARACTERS)][era] as string,
        unique,
        era,
        hp: unique ? 0.7 : 1,
      });
    });
  }

  // improvements: fields on flat land and on hills (terraces), pasture, mines, fisheries
  const improvements = new Map<number, ImprovementId>();
  const flat = (hex: number): boolean => land(hex) && map.hills[hex] === 0;
  const hilly = (hex: number): boolean => land(hex) && map.hills[hex] === 1;
  for (const hex of free(flat, 4)) improvements.set(hex, Improvement.Farm);
  for (const hex of free(hilly, 2)) improvements.set(hex, Improvement.Farm);
  for (const hex of free(flat, 3)) improvements.set(hex, Improvement.Pasture);
  for (const hex of free((hex) => hilly(hex) || land(hex), 3)) improvements.set(hex, Improvement.Mine);
  const shore = (hex: number): boolean => {
    const terrain = map.terrain[hex] as number;
    return terrain === Terrain.Coast || terrain === Terrain.Lake;
  };
  for (const hex of free(shore, 3)) improvements.set(hex, Improvement.Fishery);

  // roads between neighbouring cities of the gallery where a straight line stays on land;
  // every second one is a railway
  const roads = new Map<number, 1 | 2>();
  const routes: RenderRoute[] = [];
  const lineOf = (from: number, to: number): number[] =>
    hexLine(indexToOffset(from, map.width), indexToOffset(to, map.width)).map((hex) => hex.row * map.width + hex.col);
  let links = 0;
  for (let i = 0; i + 1 < sites.length && links < 8; i++) {
    const path = lineOf(sites[i] as number, sites[i + 1] as number);
    if (path.length > 9 || !path.every(land)) continue;
    const level = links % 2 === 0 ? 1 : 2;
    for (const hex of path) roads.set(hex, Math.max(roads.get(hex) ?? 0, level) as 1 | 2);
    // and a trade route along some of them
    if (links % 3 === 0) routes.push({ path, polity: polityAt(path[0] as number, i), sea: false });
    links++;
  }

  // a sea route: along the longest straight run of water hexes in a row of the map
  let best: number[] = [];
  for (let row = 0; row < map.height; row++) {
    let run: number[] = [];
    for (let col = 0; col <= map.width; col++) {
      const hex = row * map.width + col;
      if (col < map.width && isWaterTerrain(map.terrain[hex] as number)) {
        run.push(hex);
      } else {
        if (run.length > best.length) best = run;
        run = [];
      }
    }
  }
  if (best.length >= 3 && polities.length > 0) {
    routes.push({ path: best.slice(0, 14), polity: polities[0]?.index ?? 0, sea: true });
  }

  return { cities, units, improvements, roads, routes };
}
