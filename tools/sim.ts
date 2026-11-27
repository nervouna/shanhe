/**
 * Plays AI-only games on the rules core, without a browser:
 *
 *     npm run sim -- --map <fixture|synthetic|path to map.json> --turns 150 --seed N
 *     npm run sim -- --map <...> --turns 150 --seeds 1-10
 *
 * `fixture` is the small test map, `synthetic` a generated 160 x 110 map with
 * 64 polities, and a path loads a map written by the pipeline (the `.bin`
 * files are read from the same folder). `--seeds` takes a range (`1-10`) or a
 * list (`1,4,9`). Prints the map, one line per game, then a summary: how many
 * games ended in each kind of victory, who won each game, when the first
 * major nation entered each era, how much diplomacy and trade there was
 * (alliances formed, vassals made, trade routes at the end, policies unlocked
 * by the winner), and how much of the fighting crossed the sea (sea
 * invasions: cities taken on a landmass where the captor held none; naval
 * battles: fights with a ship on either side).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ERAS } from '../src/core/data.ts';
import { createGame, endTurn } from '../src/core/game.ts';
import type { GameResult } from '../src/core/game.ts';
import { createFixtureMap } from '../src/shared/fixtureMap.ts';
import { parseMapData } from '../src/shared/mapData.ts';
import type { MapData } from '../src/shared/mapData.ts';
import { createSyntheticMap } from '../src/shared/syntheticMap.ts';

const USAGE =
  'usage: npm run sim -- --map <fixture|synthetic|path to map.json> --turns 150 (--seed N | --seeds A-B | --seeds A,B,C)';
const ERA_NAMES = ['Ancient', 'Classical', 'Medieval', 'Early Modern', 'Industrial', 'Modern'];
const VICTORIES: readonly GameResult['kind'][] = ['conquest', 'science', 'economic'];
/** The window the design aims at for the first major nation's entry into the Modern era. */
const MODERN_WINDOW = [110, 140] as const;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(): never {
  console.error(USAGE);
  process.exit(1);
}

function parseSeeds(): number[] {
  const list = option('seeds');
  if (list === undefined) return [Number(option('seed') ?? '1')];
  const range = /^(\d+)-(\d+)$/.exec(list);
  if (range !== null) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  }
  return list.split(',').map(Number);
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

const source = option('map') ?? 'fixture';
const turns = Number(option('turns') ?? '150');
const seeds = parseSeeds();
if (!Number.isInteger(turns) || turns < 1 || seeds.length === 0 || seeds.some((seed) => !Number.isInteger(seed))) fail();

const map = loadMap(source);
// The synthetic map has none of the default major nations: take twelve spread evenly over its nations.
const nations = map.polities.filter((polity) => polity.kind === 'nation').map((polity) => polity.id);
const spread = Array.from({ length: 12 }, (_, i) => nations[Math.floor((i * nations.length) / 12)] ?? '');

interface Outcome {
  kind: GameResult['kind'];
  /** Per era: the turn in which the first major nation entered it, or 0 if none did. */
  eraTurns: number[];
  /** Alliances signed during the game. */
  alliances: number;
  /** Polities that became vassals during the game. */
  vassals: number;
  /** Trade routes running when the game ended. */
  routes: number;
  /** Policy cards the winner had unlocked. */
  policies: number;
  seed: number;
  /** The winner's English and Chinese names. */
  winner: string;
  /** Cities taken on a landmass where the captor held none. */
  seaInvasions: number;
  /** Fights with a ship on either side. */
  navalBattles: number;
}

function playGame(seed: number, announce: boolean): Outcome {
  let state = createGame(map, source === 'synthetic' ? { seed, turns, majors: spread } : { seed, turns });
  if (announce) {
    console.log(
      `map: ${source}, ${map.width} x ${map.height} hexes, ${map.polities.length} polities, ` +
        `${map.zones.length} zones, ${state.majors.length} major nations`,
    );
  }
  const eraTurns: number[] = ERAS.map((_, era) => (era === 0 ? 1 : 0));
  let played = 0;
  let worst = 0;
  const started = performance.now();
  while (state.result === null) {
    const turn = state.turn;
    const before = performance.now();
    const step = endTurn(state);
    worst = Math.max(worst, performance.now() - before);
    for (const event of step.events) {
      if (event.type === 'eraEntered' && eraTurns[event.era] === 0 && state.majors.includes(event.polity)) {
        eraTurns[event.era] = turn;
      }
    }
    state = step.state;
    played++;
  }
  const total = performance.now() - started;

  const result = state.result;
  const winner = map.polities[result.winner];
  const techs = state.majors
    .filter((major) => state.polities[major]?.alive === true)
    .map((major) => state.polities[major]?.techs.length ?? 0)
    .sort((a, b) => a - b);
  const policies = state.polities[result.winner]?.policies.length ?? 0;
  const eras = eraTurns.slice(1).map((turn, i) => `${ERA_NAMES[i + 1] ?? ''} ${turn === 0 ? '-' : turn}`);
  console.log(
    `seed ${seed}: ${played} turns played, result: ${result.kind} victory for ${winner?.nameEn ?? '?'} ` +
      `on turn ${result.turn}, cities captured: ${state.stats.citiesCaptured}, ` +
      `wars declared: ${state.stats.warsDeclared}, polities annexed: ${state.stats.politiesAnnexed}, ` +
      `alliances formed: ${state.stats.alliancesFormed}, vassals made: ${state.stats.vassalsMade}, ` +
      `sea invasions: ${state.stats.seaInvasions}, naval battles: ${state.stats.navalBattles}, ` +
      `trade routes at the end: ${state.routes.length}, policies unlocked by the leader: ${policies}, ` +
      `first major enters: ${eras.join(', ')}, ` +
      `techs of the living majors: ${techs[0] ?? 0} to ${techs[techs.length - 1] ?? 0}, ` +
      `full turn: average ${(total / played).toFixed(1)} ms, worst ${worst.toFixed(1)} ms, ` +
      `total ${(total / 1000).toFixed(1)} s`,
  );
  return {
    kind: result.kind,
    eraTurns,
    alliances: state.stats.alliancesFormed,
    vassals: state.stats.vassalsMade,
    routes: state.routes.length,
    policies,
    seed,
    winner: winner === undefined ? '?' : `${winner.nameEn} ${winner.nameZh}`,
    seaInvasions: state.stats.seaInvasions,
    navalBattles: state.stats.navalBattles,
  };
}

const outcomes = seeds.map((seed, index) => playGame(seed, index === 0));

console.log(
  `victories in ${outcomes.length} game(s): ` +
    VICTORIES.map((kind) => `${kind} ${outcomes.filter((outcome) => outcome.kind === kind).length}`).join(', '),
);
console.log(`winners: ${outcomes.map((outcome) => `seed ${outcome.seed} ${outcome.winner} (${outcome.kind})`).join('; ')}`);
const spans: string[] = [];
for (let era = 1; era < ERAS.length; era++) {
  const reached = outcomes.map((outcome) => outcome.eraTurns[era] ?? 0).filter((turn) => turn > 0).sort((a, b) => a - b);
  const span =
    reached.length === 0 ? 'never' : `turn ${reached[0] ?? 0} to ${reached[reached.length - 1] ?? 0}`;
  spans.push(`${ERA_NAMES[era] ?? ''} ${span} (${reached.length} of ${outcomes.length} games)`);
}
console.log(`first major nation enters: ${spans.join('; ')}`);
const modern = outcomes.filter((outcome) => {
  const turn = outcome.eraTurns[ERAS.length - 1] ?? 0;
  return turn >= MODERN_WINDOW[0] && turn <= MODERN_WINDOW[1];
}).length;
console.log(
  `first major nation enters the Modern era between turns ${MODERN_WINDOW[0]} and ${MODERN_WINDOW[1]}: ` +
    `${modern} of ${outcomes.length} game(s)`,
);
const range = (values: number[]): string => `${Math.min(...values)} to ${Math.max(...values)}`;
console.log(
  `alliances formed: ${range(outcomes.map((outcome) => outcome.alliances))}; ` +
    `vassals made: ${range(outcomes.map((outcome) => outcome.vassals))}; ` +
    `trade routes at the end: ${range(outcomes.map((outcome) => outcome.routes))}; ` +
    `policies unlocked by the leader: ${range(outcomes.map((outcome) => outcome.policies))}`,
);
const invaded = outcomes.filter((outcome) => outcome.seaInvasions > 0).length;
console.log(
  `sea invasions: ${range(outcomes.map((outcome) => outcome.seaInvasions))}, in ${invaded} of ${outcomes.length} game(s); ` +
    `naval battles: ${range(outcomes.map((outcome) => outcome.navalBattles))}`,
);
const lively = outcomes.filter((outcome) => outcome.alliances > 0 && outcome.vassals > 0 && outcome.routes > 0).length;
console.log(`games with alliances, vassals and trade routes all above zero: ${lively} of ${outcomes.length}`);
