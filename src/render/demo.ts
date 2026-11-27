/**
 * The render demo (`/?demo=render`): sample pieces and cities placed from
 * the map's own data, and a frame-time readout.
 */

import { indexToOffset, hexNeighbors } from '../shared/hex.ts';
import { Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { PieceEra } from './scene.ts';
import type { PieceEraId, Renderer, RenderCity, RenderScene, RenderUnit } from './scene.ts';

const DEMO_UNITS = 60;
const DEMO_CITIES = 6;

/** Sample class characters per era: two land classes, then the naval one. */
const CHARACTERS: readonly (readonly [era: PieceEraId, characters: string])[] = [
  [PieceEra.Ancient, '兵弓舟'],
  [PieceEra.Classical, '戟弩船'],
  [PieceEra.Medieval, '士炮船'],
  [PieceEra.EarlyModern, '铳骑舰'],
  [PieceEra.Industrial, '枪炮舰'],
  [PieceEra.Modern, '步坦舰'],
];
const UNIQUE_CHARACTERS = '象弩';

function hash(value: number): number {
  let h = Math.imul(value + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** `count` entries of `items`, evenly spread over the list. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.floor(((i + 0.5) * items.length) / count)] as T);
  return out;
}

/** About 60 pieces of several polities and eras and a few cities, on any map. */
export function createDemoScene(map: MapData): RenderScene {
  const cities: RenderCity[] = spread(
    map.zones.filter((zone) => map.polities[zone.polity]?.kind !== 'wastelandRegion'),
    DEMO_CITIES,
  ).map((zone, i) => ({
    hex: zone.siteHex,
    polity: zone.polity,
    population: zone.capital ? 9 + (i % 3) * 4 : 2 + (i % 4) * 2,
    name: zone.cityNameZh,
  }));
  const cityHexes = new Set(cities.map((city) => city.hex));

  // owned land for armies, coast next to owned land for fleets
  const land: number[] = [];
  const coast: { hex: number; polity: number }[] = [];
  for (let i = 0; i < map.width * map.height; i++) {
    const terrain = map.terrain[i] as number;
    if ((map.owner[i] as number) >= 0 && terrain !== Terrain.Mountain && !cityHexes.has(i)) {
      land.push(i);
    } else if (terrain === Terrain.Coast) {
      for (const n of hexNeighbors(indexToOffset(i, map.width))) {
        if (n.col < 0 || n.col >= map.width || n.row < 0 || n.row >= map.height) continue;
        const owner = map.owner[n.row * map.width + n.col] as number;
        if (owner >= 0) {
          coast.push({ hex: i, polity: owner });
          break;
        }
      }
    }
  }
  const fleets = spread(coast, Math.min(8, Math.floor(DEMO_UNITS / 7)));
  const armies = spread(land, DEMO_UNITS - fleets.length);

  const units: RenderUnit[] = [];
  const add = (hex: number, polity: number, naval: boolean): void => {
    const id = units.length;
    const h = hash(hex);
    const [era, characters] = CHARACTERS[h % CHARACTERS.length] as (typeof CHARACTERS)[number];
    const unique = !naval && h % 9 === 0;
    // per era: two land classes, then the naval one
    const [first, second, ship] = [...characters] as [string, string, string];
    const uniques = [...UNIQUE_CHARACTERS];
    const pick = h >>> 8;
    const character = naval
      ? ship
      : unique
        ? (uniques[pick % uniques.length] as string)
        : pick % 2 === 0
          ? first
          : second;
    const hp = id % 5 === 0 ? 0.25 + ((h >>> 4) % 60) / 100 : 1;
    units.push({ id, hex, polity, character, unique, era, hp });
  };
  for (const hex of armies) add(hex, map.owner[hex] as number, false);
  for (const fleet of fleets) add(fleet.hex, fleet.polity, true);

  return { units, cities, ownerOverrides: new Map(), fog: null };
}

/** Shows the frame time in a corner of the page. Returns a function that removes it. */
export function attachFrameReadout(renderer: Renderer): () => void {
  const readout = document.createElement('output');
  readout.id = 'frame-time';
  Object.assign(readout.style, {
    position: 'fixed',
    right: '12px',
    top: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgb(16 21 28 / 75%)',
    color: '#e8e4da',
    font: '12px/1.4 ui-monospace, Menlo, Consolas, monospace',
    pointerEvents: 'none',
  });
  document.body.append(readout);
  let shown = 0;
  const stop = renderer.onFrame((stats) => {
    // a few updates per second are enough to read
    if (stats.frames - shown < 15 && shown !== 0) return;
    shown = stats.frames;
    readout.textContent = `${stats.frameMs.toFixed(1)} ms`;
  });
  return () => {
    stop();
    readout.remove();
  };
}
