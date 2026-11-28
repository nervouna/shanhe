/**
 * Plays AI-only games on the rules core, without a browser:
 *
 *     npm run sim -- --map <fixture|synthetic|path to map.json> --turns 150 --seed N
 *     npm run sim -- --map <...> --turns 150 --seeds 1-10
 *     npm run sim -- --map <...> --turns 150 --seeds 1-10 --report
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
 * battles: fights with a ship on either side), the winner table, the
 * earliest end of a game and how many units stood on the map at turn 90.
 *
 * `--report` adds the balance report of `report.ts`: per major nation and per
 * era its cities, population, yields, techs, army and wars, and what it spent
 * production and gold on, as the mean over the games played.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DEFAULT_DIFFICULTY, ERAS, isDifficultyLevel } from '../src/core/data.ts';
import { createGame, endTurn } from '../src/core/game.ts';
import type { DifficultyLevel } from '../src/core/data.ts';
import type { GameResult } from '../src/core/game.ts';
import { createFixtureMap } from '../src/shared/fixtureMap.ts';
import { parseMapData } from '../src/shared/mapData.ts';
import type { MapData } from '../src/shared/mapData.ts';
import { createSyntheticMap } from '../src/shared/syntheticMap.ts';
import { createCollector, formatReport } from './report.ts';
import type { GameReport } from './report.ts';

const USAGE =
  'usage: npm run sim -- --map <fixture|synthetic|path to map.json> --turns 150 (--seed N | --seeds A-B | --seeds A,B,C) ' +
  '[--difficulty relaxed|easy|standard|hard|severe] [--report]';
const ERA_NAMES = ['Ancient', 'Classical', 'Medieval', 'Early Modern', 'Industrial', 'Modern'];
const VICTORIES: readonly GameResult['kind'][] = ['conquest', 'science', 'economic'];
/** The window the design aims at for the first major nation's entry into the Modern era. */
const MODERN_WINDOW = [110, 140] as const;
/** The turn at which the units on the map are counted: the middle of the game, when armies are at their largest. */
const CENSUS_TURN = 90;
/** The window for the turn on which the first major nation leaves the Ancient era. */
const ANCIENT_WINDOW = [18, 30] as const;
/** The window for the length of each later era: the turns between the first major's entry into it and into the next. */
const ERA_LENGTH_WINDOW = [20, 32] as const;
/** A game that ends before this turn leaves the Economic victory no chance. */
const LATE_TURN = 140;
/** No game should end before this turn. */
const EARLY_TURN = 110;
/** The turn at whose end the settled wasteland sites are counted. */
const SETTLE_TURN = 60;
/** The turn in which the idle cities of the major nations are counted. */
const IDLE_TURN = 140;

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
const withReport = process.argv.includes('--report');
const level = option('difficulty') ?? DEFAULT_DIFFICULTY;
if (!isDifficultyLevel(level)) fail();
const difficulty: DifficultyLevel = level;
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
  /** The winner's English name alone, for the winner table. */
  winnerName: string;
  /** The turn the game ended. */
  turn: number;
  /** Seconds the game took. */
  seconds: number;
  /** Units on the map, tribes included, when turn `CENSUS_TURN` began; -1 if the game ended before. */
  unitsAtCensus: number;
  /** Wasteland city sites, and how many of them carried a city when turn `SETTLE_TURN` ended; -1 if the game ended before. */
  wastelandSites: number;
  settledSites: number;
  /** Air strikes made by anybody. */
  airStrikes: number;
  /** Per living major at the end: its treasury in turns of its income. */
  treasuryTurns: number[];
  /** The majors' treasuries and incomes at the end, summed. */
  treasury: number;
  income: number;
  /** Cities of living majors in turn `IDLE_TURN`, and how many of them built nothing and had nothing queued; -1 if the game ended before. */
  majorCities: number;
  idleCities: number;
  report: GameReport | null;
}

function playGame(seed: number, announce: boolean): Outcome {
  let state = createGame(map, source === 'synthetic' ? { seed, turns, majors: spread, difficulty } : { seed, turns, difficulty });
  if (announce) {
    console.log(
      `map: ${source}, ${map.width} x ${map.height} hexes, ${map.polities.length} polities, ` +
        `${map.zones.length} zones, ${state.majors.length} major nations, difficulty ${difficulty}`,
    );
  }
  // The wasteland city sites: the zones nobody owns when the game starts.
  const wasteland = state.zoneOwner.flatMap((owner, zone) => (owner < 0 ? [zone] : []));
  let settledSites = -1;
  let airStrikes = 0;
  let majorCities = -1;
  let idleCities = -1;
  const eraTurns: number[] = ERAS.map((_, era) => (era === 0 ? 1 : 0));
  let played = 0;
  let worst = 0;
  const started = performance.now();
  const collector = withReport ? createCollector(state) : null;
  let unitsAtCensus = -1;
  while (state.result === null) {
    if (state.turn === CENSUS_TURN) unitsAtCensus = state.units.length;
    const turn = state.turn;
    const before = performance.now();
    const step = endTurn(state);
    worst = Math.max(worst, performance.now() - before);
    for (const event of step.events) {
      if (event.type === 'eraEntered' && eraTurns[event.era] === 0 && state.majors.includes(event.polity)) {
        eraTurns[event.era] = turn;
      }
      if (event.type === 'airStrike') airStrikes++;
    }
    if (turn === SETTLE_TURN) settledSites = wasteland.filter((zone) => step.state.cities[zone] !== null).length;
    if (turn === IDLE_TURN) {
      const built = new Set(step.events.flatMap((event) => (event.type === 'cityBuilt' ? [event.city] : [])));
      majorCities = 0;
      idleCities = 0;
      for (const city of step.state.cities) {
        if (city === null || !state.majors.includes(city.owner)) continue;
        majorCities++;
        if (city.queue.length === 0 && !built.has(city.zone)) idleCities++;
      }
    }
    collector?.observe(state, step.state, step.events);
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
  const treasuryTurns: number[] = [];
  let treasury = 0;
  let income = 0;
  for (const major of state.majors) {
    const self = state.polities[major];
    if (self === undefined || !self.alive) continue;
    const earned = self.yields.gold + self.routeIncome + self.tributeReceived;
    treasury += self.gold;
    income += earned;
    if (earned > 0) treasuryTurns.push(self.gold / earned);
  }
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
    winnerName: winner?.nameEn ?? '?',
    turn: result.turn,
    seconds: total / 1000,
    unitsAtCensus,
    wastelandSites: wasteland.length,
    settledSites,
    airStrikes,
    treasuryTurns,
    treasury,
    income,
    majorCities,
    idleCities,
    report: collector?.finish(state) ?? null,
  };
}

const outcomes = seeds.map((seed, index) => playGame(seed, index === 0));

console.log(
  `victories in ${outcomes.length} game(s): ` +
    VICTORIES.map((kind) => `${kind} ${outcomes.filter((outcome) => outcome.kind === kind).length}`).join(', '),
);
console.log(`winners: ${outcomes.map((outcome) => `seed ${outcome.seed} ${outcome.winner} (${outcome.kind})`).join('; ')}`);
// The winner table: one line per winner, most wins first.
const winnerNames = [...new Set(outcomes.map((outcome) => outcome.winner))];
const wins = (name: string, kind?: GameResult['kind']): number =>
  outcomes.filter((outcome) => outcome.winner === name && (kind === undefined || outcome.kind === kind)).length;
winnerNames.sort((a, b) => wins(b) - wins(a) || a.localeCompare(b));
console.log(`winner table: ${winnerNames.length} different winner(s) in ${outcomes.length} game(s)`);
for (const name of winnerNames) {
  console.log(`  ${name}: ${wins(name)} (${VICTORIES.map((kind) => `${kind} ${wins(name, kind)}`).join(', ')})`);
}
const ends = outcomes.map((outcome) => outcome.turn);
console.log(
  `games end on turns ${Math.min(...ends)} to ${Math.max(...ends)}; ` +
    `all games together took ${outcomes.reduce((sum, outcome) => sum + outcome.seconds, 0).toFixed(1)} s`,
);
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
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
// Pacing: when the first major leaves the Ancient era, and how long each later era lasts for the first major to enter it
// (the turns from the first major's entry into the era to the first major's entry into the next).
const ancient = outcomes.map((outcome) => outcome.eraTurns[1] ?? 0).filter((turn) => turn > 0);
const ancientInWindow = ancient.filter((turn) => turn >= ANCIENT_WINDOW[0] && turn <= ANCIENT_WINDOW[1]).length;
const lengths: number[][] = ERAS.map(() => []);
let gamesInPace = 0;
for (const outcome of outcomes) {
  const first = outcome.eraTurns[1] ?? 0;
  let inPace = first >= ANCIENT_WINDOW[0] && first <= ANCIENT_WINDOW[1];
  for (let era = 1; era < ERAS.length - 1; era++) {
    const from = outcome.eraTurns[era] ?? 0;
    const to = outcome.eraTurns[era + 1] ?? 0;
    if (from === 0 || to === 0) continue;
    lengths[era]?.push(to - from);
    if (to - from < ERA_LENGTH_WINDOW[0] || to - from > ERA_LENGTH_WINDOW[1]) inPace = false;
  }
  if (inPace) gamesInPace++;
}
const allLengths = lengths.flat();
const lengthsInWindow = allLengths.filter((length) => length >= ERA_LENGTH_WINDOW[0] && length <= ERA_LENGTH_WINDOW[1]).length;
console.log(
  `pacing: the first major leaves the Ancient era on turn ${ancient.length === 0 ? '-' : range(ancient)} ` +
    `(turns ${ANCIENT_WINDOW[0]} to ${ANCIENT_WINDOW[1]}: ${ancientInWindow} of ${outcomes.length} game(s)); later eras last ` +
    lengths
      .flatMap((list, era) => (list.length === 0 ? [] : [`${ERA_NAMES[era] ?? ''} ${range(list)}`]))
      .join(', ') +
    ` turns (${ERA_LENGTH_WINDOW[0]} to ${ERA_LENGTH_WINDOW[1]} turns: ${lengthsInWindow} of ${allLengths.length} era(s)); ` +
    `games with every era in its window: ${gamesInPace} of ${outcomes.length}`,
);
console.log(
  `games that end before turn ${EARLY_TURN}: ${ends.filter((turn) => turn < EARLY_TURN).length}; ` +
    `before turn ${LATE_TURN}: ${ends.filter((turn) => turn < LATE_TURN).length} of ${outcomes.length}`,
);
const settled = outcomes.filter((outcome) => outcome.settledSites >= 0);
if (settled.length > 0) {
  const sites = settled[0]?.wastelandSites ?? 0;
  const count = mean(settled.map((outcome) => outcome.settledSites));
  console.log(
    `wasteland sites settled when turn ${SETTLE_TURN} ends: ${count.toFixed(1)} of ${sites} on average ` +
      `(${sites === 0 ? 0 : ((100 * count) / sites).toFixed(0)}%), ${range(settled.map((outcome) => outcome.settledSites))}`,
  );
}
const everyMajor = outcomes.flatMap((outcome) => outcome.treasuryTurns);
console.log(
  `majors' treasuries at the end: ${mean(everyMajor).toFixed(1)} turns of income for a major on average ` +
    `(${everyMajor.length} majors); all treasuries over all incomes: ` +
    `${(outcomes.reduce((sum, outcome) => sum + outcome.treasury, 0) / Math.max(1, outcomes.reduce((sum, outcome) => sum + outcome.income, 0))).toFixed(1)} turns`,
);
const struck = outcomes.filter((outcome) => outcome.airStrikes > 0).length;
console.log(
  `air strikes: ${mean(outcomes.map((outcome) => outcome.airStrikes)).toFixed(1)} a game, in ${struck} of ${outcomes.length} game(s)`,
);
const late = outcomes.filter((outcome) => outcome.majorCities > 0);
if (late.length > 0) {
  const cities = late.reduce((sum, outcome) => sum + outcome.majorCities, 0);
  const idle = late.reduce((sum, outcome) => sum + outcome.idleCities, 0);
  console.log(`major nations' cities with nothing to build in turn ${IDLE_TURN}: ${idle} of ${cities} (${((100 * idle) / cities).toFixed(0)}%)`);
}
/** The median of the values: the middle one, or the mean of the middle two. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
const census = outcomes.map((outcome) => outcome.unitsAtCensus).filter((count) => count >= 0);
if (census.length > 0) {
  console.log(
    `units on the map at turn ${CENSUS_TURN}: ${range(census)}, median ${median(census)} ` +
      `(${census.length} of ${outcomes.length} game(s) reached it)`,
  );
}
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

if (withReport) {
  const reports = outcomes.flatMap((outcome) => (outcome.report === null ? [] : [outcome.report]));
  console.log('');
  for (const text of formatReport(reports, (polity) => map.polities[polity]?.nameEn ?? String(polity))) console.log(text);
}
