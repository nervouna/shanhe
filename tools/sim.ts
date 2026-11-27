/**
 * Plays an AI-only game on the rules core, without a browser:
 *
 *     npm run sim -- --map <fixture|synthetic|path to map.json> --turns 150 --seed N
 *
 * `fixture` is the small test map, `synthetic` a generated 160 x 110 map with
 * 64 polities, and a path loads a map written by the pipeline (the `.bin`
 * files are read from the same folder). Prints the map, then one summary line.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGame, endTurn } from '../src/core/game.ts';
import { createFixtureMap } from '../src/shared/fixtureMap.ts';
import { parseMapData } from '../src/shared/mapData.ts';
import type { MapData } from '../src/shared/mapData.ts';
import { createSyntheticMap } from '../src/shared/syntheticMap.ts';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

function loadMap(source: string): MapData {
  if (source === 'fixture') return createFixtureMap();
  if (source === 'synthetic') return createSyntheticMap();
  const json = readFileSync(source, 'utf8');
  const header = JSON.parse(json) as { layers?: Record<string, { file: string }> };
  const buffers: Record<string, Uint8Array> = {};
  for (const layer of Object.values(header.layers ?? {})) {
    buffers[layer.file] = new Uint8Array(readFileSync(join(dirname(source), layer.file)));
  }
  return parseMapData(json, buffers);
}

const source = option('map', 'fixture');
const turns = Number(option('turns', '150'));
const seed = Number(option('seed', '1'));
if (!Number.isInteger(turns) || turns < 1 || !Number.isInteger(seed)) {
  console.error('usage: npm run sim -- --map <fixture|synthetic|path to map.json> --turns 150 --seed N');
  process.exit(1);
}

const map = loadMap(source);
// The synthetic map has none of the default major nations: take twelve spread evenly over its nations.
const nations = map.polities.filter((polity) => polity.kind === 'nation').map((polity) => polity.id);
const spread = Array.from({ length: 12 }, (_, i) => nations[Math.floor((i * nations.length) / 12)] ?? '');
let state = createGame(map, source === 'synthetic' ? { seed, turns, majors: spread } : { seed, turns });
console.log(
  `map: ${source}, ${map.width} x ${map.height} hexes, ${map.polities.length} polities, ` +
    `${map.zones.length} zones, ${state.majors.length} major nations`,
);

let played = 0;
let worst = 0;
const started = performance.now();
while (state.result === null) {
  const before = performance.now();
  state = endTurn(state).state;
  worst = Math.max(worst, performance.now() - before);
  played++;
}
const total = performance.now() - started;

const result = state.result;
const winner = map.polities[result.winner];
console.log(
  `seed ${seed}: ${played} turns played, result: ${result.kind} victory for ${winner?.nameEn ?? '?'} ` +
    `on turn ${result.turn}, cities captured: ${state.stats.citiesCaptured}, ` +
    `wars declared: ${state.stats.warsDeclared}, polities annexed: ${state.stats.politiesAnnexed}, ` +
    `full turn: average ${(total / played).toFixed(1)} ms, worst ${worst.toFixed(1)} ms, ` +
    `total ${(total / 1000).toFixed(1)} s`,
);
