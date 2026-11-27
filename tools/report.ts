/**
 * The balance report of `npm run sim -- --report`: for every major nation and
 * every era of the design's pacing (25 turns each), what it had when the era
 * ended and what it did during it. A collector watches a game turn by turn;
 * `formatReport` prints the mean over the games that were watched.
 *
 * It reads states and events only, so it shows the game as the rules played
 * it and costs the rules nothing.
 */

import { BUILDINGS, CITY, ERAS, IMPROVEMENTS, PROJECT, TURNS_PER_ERA, UNITS, UPGRADE_GOLD_PER_COST } from '../src/core/data.ts';
import type { GameEvent, GameState } from '../src/core/game.ts';

/** What production was put into, by the kind of item that was finished. */
export interface BuiltCounts {
  unit: number;
  building: number;
  improvement: number;
  city: number;
  project: number;
}

/** One major nation in one era of one game. */
export interface ReportRow {
  /** Index into `map.polities`. */
  polity: number;
  /** Index into `ERAS` of the pacing era the row covers. */
  era: number;
  /** The last turn the row covers: the era's last turn, or the turn the game ended. */
  turn: number;
  alive: boolean;
  // What it had when the era ended.
  cities: number;
  population: number;
  food: number;
  production: number;
  gold: number;
  science: number;
  culture: number;
  techs: number;
  /** Index into `ERAS` of the era its research has reached. */
  ownEra: number;
  /** Sum of its units' strength, weighted by their HP. */
  army: number;
  units: number;
  /** Wars it was in when the era ended. */
  wars: number;
  treasury: number;
  /** Cumulative gross income: what the Economic victory ranks. */
  grossIncome: number;
  /** Cumulative science. */
  totalScience: number;
  /** Original capitals of majors it held, itself or through a vassal. */
  capitals: number;
  vassals: number;
  // What it did during the era.
  warsDeclared: number;
  citiesTaken: number;
  citiesLost: number;
  airStrikes: number;
  /** Items finished, and the production they cost. */
  built: BuiltCounts;
  productionSpent: BuiltCounts;
  // Gold, summed over the era's turns.
  goldUpkeep: number;
  goldBought: number;
  goldUpgrades: number;
  goldGifts: number;
  goldDeals: number;
  goldTribute: number;
}

/** How every war that ended during a game ended. */
export interface WarEnds {
  peace: number;
  annexed: number;
  vassalized: number;
}

export interface GameReport {
  seed: number;
  rows: ReportRow[];
  warEnds: WarEnds;
  /** The most original capitals of majors any major held at the end of a turn, and who and when. */
  mostCapitals: { count: number; polity: number; turn: number };
  /** Air strikes made by anybody. */
  airStrikes: number;
  /** Gold in the treasuries of the living majors when the game ended, and their income of the last turn. */
  finalTreasury: number;
  finalIncome: number;
}

function noCounts(): BuiltCounts {
  return { unit: 0, building: 0, improvement: 0, city: 0, project: 0 };
}

interface Running {
  warsDeclared: number;
  citiesTaken: number;
  citiesLost: number;
  airStrikes: number;
  built: BuiltCounts;
  productionSpent: BuiltCounts;
  goldUpkeep: number;
  goldBought: number;
  goldUpgrades: number;
  goldGifts: number;
  goldDeals: number;
  goldTribute: number;
}

function noRunning(): Running {
  return {
    warsDeclared: 0,
    citiesTaken: 0,
    citiesLost: 0,
    airStrikes: 0,
    built: noCounts(),
    productionSpent: noCounts(),
    goldUpkeep: 0,
    goldBought: 0,
    goldUpgrades: 0,
    goldGifts: 0,
    goldDeals: 0,
    goldTribute: 0,
  };
}

/** Production cost of a finished item, from the tables (a settler's rising cost is not counted). */
function costOf(event: Extract<GameEvent, { type: 'cityBuilt' }>, stage: number): number {
  const item = event.item;
  switch (item.kind) {
    case 'unit':
      return UNITS[item.unit]?.cost ?? 0;
    case 'building':
      return BUILDINGS[item.building].cost;
    case 'improvement':
      return IMPROVEMENTS[item.improvement].cost;
    case 'city':
      return CITY.foundCost;
    case 'project':
      return PROJECT.stages[Math.max(0, stage - 1)]?.cost ?? 0;
  }
}

/** Original capitals of majors `polity` holds, itself or through a vassal. */
export function capitalsOf(state: GameState, polity: number): number {
  let held = 0;
  for (const major of state.majors) {
    const zone = state.map.polities[major]?.capitalZone ?? -1;
    const city = state.cities[zone];
    if (city === undefined || city === null) continue;
    if (city.owner === polity || state.polities[city.owner]?.overlord === polity) held++;
  }
  return held;
}

export interface Collector {
  /** Call after every `endTurn` with the state before it, the state after it and its events. */
  observe(before: GameState, after: GameState, events: readonly GameEvent[]): void;
  /** The report of the game so far; call it when the game has ended. */
  finish(state: GameState): GameReport;
}

/** Watches one game from its first turn. */
export function createCollector(start: GameState): Collector {
  const majors = [...start.majors];
  const running = new Map<number, Running>(majors.map((major) => [major, noRunning()]));
  const rows: ReportRow[] = [];
  const warEnds: WarEnds = { peace: 0, annexed: 0, vassalized: 0 };
  const mostCapitals = { count: 0, polity: -1, turn: 0 };
  let airStrikes = 0;
  let lastSnapshot = 0;

  const snapshot = (state: GameState, turn: number): void => {
    if (turn <= lastSnapshot) return;
    lastSnapshot = turn;
    const era = Math.min(ERAS.length - 1, Math.floor((turn - 1) / TURNS_PER_ERA));
    for (const major of majors) {
      const self = state.polities[major];
      const run = running.get(major);
      if (self === undefined || run === undefined) continue;
      let cities = 0;
      let population = 0;
      for (const city of state.cities) {
        if (city === null || city.owner !== major) continue;
        cities++;
        population += city.pop;
      }
      let army = 0;
      let units = 0;
      for (const unit of state.units) {
        if (unit.owner !== major) continue;
        const def = UNITS[unit.type];
        if (def === undefined || def.strength <= 0) continue;
        units++;
        army += (Math.max(def.strength, def.rangedStrength) * unit.hp) / 100;
      }
      let wars = 0;
      for (const relation of Object.values(state.relations)) {
        if (relation.atWar && (relation.a === major || relation.b === major)) wars++;
      }
      rows.push({
        polity: major,
        era,
        turn,
        alive: self.alive,
        cities,
        population,
        food: self.yields.food,
        production: self.yields.production,
        gold: self.yields.gold,
        science: self.yields.science,
        culture: self.yields.culture,
        techs: self.techs.length,
        ownEra: self.era,
        army: Math.round(army),
        units,
        wars,
        treasury: Math.round(self.gold),
        grossIncome: Math.round(self.grossIncome),
        totalScience: Math.round(self.science),
        capitals: self.alive ? capitalsOf(state, major) : 0,
        vassals: state.polities.filter((other) => other.alive && other.overlord === major).length,
        ...run,
      });
      running.set(major, noRunning());
    }
  };

  return {
    observe(before, after, events) {
      const turn = before.turn;
      for (const event of events) {
        switch (event.type) {
          case 'warDeclared': {
            const run = running.get(event.by);
            if (run !== undefined) run.warsDeclared++;
            break;
          }
          case 'cityCaptured': {
            const taker = running.get(event.to);
            if (taker !== undefined) taker.citiesTaken++;
            const loser = running.get(event.from);
            if (loser !== undefined) loser.citiesLost++;
            break;
          }
          case 'airStrike': {
            airStrikes++;
            const run = running.get(event.owner);
            if (run !== undefined) run.airStrikes++;
            break;
          }
          case 'cityBuilt': {
            const owner = after.cities[event.city]?.owner ?? before.cities[event.city]?.owner ?? -1;
            const run = running.get(owner);
            if (run === undefined) break;
            run.built[event.item.kind]++;
            run.productionSpent[event.item.kind] += costOf(event, after.polities[owner]?.projectStage ?? 0);
            break;
          }
          case 'itemBought': {
            const owner = after.cities[event.city]?.owner ?? -1;
            const run = running.get(owner);
            if (run !== undefined) run.goldBought += event.gold;
            break;
          }
          case 'unitUpgraded': {
            const unit = after.units.find((entry) => entry.id === event.unit) ?? before.units.find((entry) => entry.id === event.unit);
            const run = unit === undefined ? undefined : running.get(unit.owner);
            if (run === undefined) break;
            const from = UNITS[event.from]?.cost ?? 0;
            const to = UNITS[event.to]?.cost ?? 0;
            run.goldUpgrades += Math.max(0, to - from) * UPGRADE_GOLD_PER_COST;
            break;
          }
          case 'goldGifted': {
            const run = running.get(event.from);
            if (run !== undefined) run.goldGifts += event.amount;
            break;
          }
          case 'peaceMade':
            warEnds.peace++;
            break;
          case 'polityAnnexed':
            warEnds.annexed++;
            break;
          case 'vassalized':
            if (event.forced) warEnds.vassalized++;
            break;
          default:
            break;
        }
      }
      for (const major of majors) {
        const self = after.polities[major];
        const run = running.get(major);
        if (self === undefined || run === undefined || !self.alive) continue;
        run.goldUpkeep += self.upkeep;
        run.goldTribute += self.tributePaid;
        if (self.dealIncome < 0) run.goldDeals -= self.dealIncome;
        const held = capitalsOf(after, major);
        if (held > mostCapitals.count) {
          mostCapitals.count = held;
          mostCapitals.polity = major;
          mostCapitals.turn = turn;
        }
      }
      if (turn % TURNS_PER_ERA === 0 || after.result !== null) snapshot(after, turn);
    },
    finish(state) {
      let finalTreasury = 0;
      let finalIncome = 0;
      for (const major of majors) {
        const self = state.polities[major];
        if (self === undefined || !self.alive) continue;
        finalTreasury += self.gold;
        finalIncome += self.yields.gold + self.routeIncome + self.tributeReceived;
      }
      return {
        seed: state.seed,
        rows,
        warEnds,
        mostCapitals,
        airStrikes,
        finalTreasury: Math.round(finalTreasury),
        finalIncome: Math.round(finalIncome),
      };
    },
  };
}

// ----------------------------------------------------------------- printing

const ERA_NAMES = ['Ancient', 'Classical', 'Medieval', 'Early Modern', 'Industrial', 'Modern'];

/** The columns of the report table, in order. */
export const REPORT_COLUMNS = [
  'nation', 'games', 'cities', 'pop', 'food', 'prod', 'gold', 'sci', 'cult', 'techs', 'era', 'army', 'units', 'wars',
  'caps', 'vassals', 'declared', 'taken', 'lost', 'air', 'units built', 'buildings', 'improvements', 'cities founded',
  'project', 'prod on units', 'prod on buildings', 'prod on other', 'upkeep', 'bought', 'upgrades', 'gifts', 'deals',
  'tribute', 'treasury', 'gross income', 'total science',
] as const;

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cell(value: number): string {
  return Math.abs(value) >= 100 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
}

/** The cells of one nation's line: the mean of its rows over the games. */
function line(name: string, rows: readonly ReportRow[]): string[] {
  const avg = (pick: (row: ReportRow) => number): string => cell(mean(rows.map(pick)));
  return [
    name,
    String(rows.length),
    avg((row) => row.cities),
    avg((row) => row.population),
    avg((row) => row.food),
    avg((row) => row.production),
    avg((row) => row.gold),
    avg((row) => row.science),
    avg((row) => row.culture),
    avg((row) => row.techs),
    avg((row) => row.ownEra),
    avg((row) => row.army),
    avg((row) => row.units),
    avg((row) => row.wars),
    avg((row) => row.capitals),
    avg((row) => row.vassals),
    avg((row) => row.warsDeclared),
    avg((row) => row.citiesTaken),
    avg((row) => row.citiesLost),
    avg((row) => row.airStrikes),
    avg((row) => row.built.unit),
    avg((row) => row.built.building),
    avg((row) => row.built.improvement),
    avg((row) => row.built.city),
    avg((row) => row.built.project),
    avg((row) => row.productionSpent.unit),
    avg((row) => row.productionSpent.building),
    avg((row) => row.productionSpent.improvement + row.productionSpent.city + row.productionSpent.project),
    avg((row) => row.goldUpkeep),
    avg((row) => row.goldBought),
    avg((row) => row.goldUpgrades),
    avg((row) => row.goldGifts),
    avg((row) => row.goldDeals),
    avg((row) => row.goldTribute),
    avg((row) => row.treasury),
    avg((row) => row.grossIncome),
    avg((row) => row.totalScience),
  ];
}

/**
 * The report as lines of text: for each era a table with one line per major
 * nation (the mean over the games in which the era was played; the living
 * nations only), then what the games had in common.
 */
export function formatReport(reports: readonly GameReport[], names: (polity: number) => string): string[] {
  const out: string[] = [];
  const all = reports.flatMap((report) => report.rows);
  const majors = [...new Set(all.map((row) => row.polity))].sort((a, b) => a - b);
  out.push(`report: ${reports.length} game(s); every number is the mean over the games in which the nation was alive when the era ended`);
  out.push(
    'columns up to "vassals" are the state when the era ended (yields per turn); from "declared" to "tribute" they are sums over the era; ' +
      'the last three are the treasury and the cumulative gross income and science',
  );
  for (let era = 0; era < ERAS.length; era++) {
    const inEra = all.filter((row) => row.era === era);
    if (inEra.length === 0) continue;
    const turns = inEra.map((row) => row.turn);
    out.push('');
    out.push(`era ${ERA_NAMES[era] ?? era} (turns ${era * TURNS_PER_ERA + 1} to ${Math.max(...turns)})`);
    const table = [
      [...REPORT_COLUMNS] as string[],
      ...majors.flatMap((major) => {
        const rows = inEra.filter((row) => row.polity === major && row.alive);
        return rows.length === 0 ? [] : [line(names(major), rows)];
      }),
    ];
    const widths = REPORT_COLUMNS.map((_, column) => Math.max(...table.map((cells) => (cells[column] ?? '').length)));
    for (const cells of table) out.push(cells.map((text, column) => text.padStart(widths[column] ?? 0)).join('  ').trimEnd());
  }

  // The spread between games: who leads, and how far apart the games are.
  out.push('');
  out.push('spread over the games (minimum, mean, maximum) at the end of each game');
  const last = (report: GameReport, major: number): ReportRow | undefined => {
    const rows = report.rows.filter((row) => row.polity === major);
    return rows[rows.length - 1];
  };
  for (const major of majors) {
    const rows = reports.flatMap((report) => {
      const row = last(report, major);
      return row === undefined ? [] : [row];
    });
    const span = (pick: (row: ReportRow) => number): string => {
      const values = rows.map(pick);
      return `${cell(Math.min(...values))}/${cell(mean(values))}/${cell(Math.max(...values))}`;
    };
    out.push(
      `${names(major)}: alive in ${rows.filter((row) => row.alive).length} of ${rows.length}, cities ${span((row) => row.cities)}, ` +
        `science per turn ${span((row) => row.science)}, total science ${span((row) => row.totalScience)}, ` +
        `gross income ${span((row) => row.grossIncome)}, army ${span((row) => row.army)}, capitals ${span((row) => row.capitals)}`,
    );
  }
  const leaders = (pick: (row: ReportRow) => number): string => {
    const wins = new Map<number, number>();
    for (const report of reports) {
      let best: ReportRow | undefined;
      for (const major of majors) {
        const row = last(report, major);
        if (row !== undefined && row.alive && (best === undefined || pick(row) > pick(best))) best = row;
      }
      if (best !== undefined) wins.set(best.polity, (wins.get(best.polity) ?? 0) + 1);
    }
    return [...wins.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([major, count]) => `${names(major)} ${count}`).join(', ');
  };
  out.push(`leader in total science at the end: ${leaders((row) => row.totalScience)}`);
  out.push(`leader in gross income at the end: ${leaders((row) => row.grossIncome)}`);
  out.push(`leader in army at the end: ${leaders((row) => row.army)}`);
  const sum = (pick: (report: GameReport) => number): number => reports.reduce((total, report) => total + pick(report), 0);
  out.push(
    `wars ended: by peace ${sum((report) => report.warEnds.peace)}, by annexation ${sum((report) => report.warEnds.annexed)}, ` +
      `by forced vassalage ${sum((report) => report.warEnds.vassalized)}`,
  );
  out.push(
    `most capitals held by one major: ${reports
      .map((report) => `seed ${report.seed} ${report.mostCapitals.count} (${report.mostCapitals.polity < 0 ? '-' : names(report.mostCapitals.polity)}, turn ${report.mostCapitals.turn})`)
      .join('; ')}`,
  );
  out.push(
    `air strikes per game: ${cell(mean(reports.map((report) => report.airStrikes)))}; ` +
      `majors' treasuries at the end: ${cell(mean(reports.map((report) => report.finalTreasury)))} gold, ` +
      `${cell(mean(reports.map((report) => (report.finalIncome === 0 ? 0 : report.finalTreasury / report.finalIncome))))} turns of their income`,
  );
  return out;
}
