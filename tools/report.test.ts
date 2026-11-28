import { describe, expect, it } from 'vitest';
import { ERAS, TURNS_PER_ERA } from '../src/core/data.ts';
import { createGame, endTurn } from '../src/core/game.ts';
import { createFixtureMap } from '../src/shared/fixtureMap.ts';
import { REPORT_COLUMNS, capitalsOf, createCollector, formatReport } from './report.ts';
import type { GameReport } from './report.ts';

const map = createFixtureMap();

function play(seed: number): GameReport {
  let state = createGame(map, { seed });
  const collector = createCollector(state);
  while (state.result === null) {
    const step = endTurn(state);
    collector.observe(state, step.state, step.events);
    state = step.state;
  }
  return collector.finish(state);
}

describe('the balance report', () => {
  const report = play(3);
  const majors = createGame(map, { seed: 3 }).majors;

  it('has one row per major nation for every era the game reached, in order', () => {
    const eras = [...new Set(report.rows.map((row) => row.era))];
    expect(eras).toEqual(Array.from({ length: eras.length }, (_, era) => era));
    expect(eras.length).toBeGreaterThan(1);
    expect(eras.length).toBeLessThanOrEqual(ERAS.length);
    for (const era of eras) {
      expect(report.rows.filter((row) => row.era === era).map((row) => row.polity)).toEqual([...majors]);
    }
    // Every era but the last ends on its last turn.
    for (const row of report.rows) {
      if (row.era < eras.length - 1) expect(row.turn).toBe((row.era + 1) * TURNS_PER_ERA);
    }
  });

  it('counts what a nation has and what it spent', () => {
    const first = report.rows.filter((row) => row.era === 0);
    for (const row of first) {
      expect(row.alive).toBe(true);
      expect(row.cities).toBeGreaterThanOrEqual(1);
      expect(row.population).toBeGreaterThanOrEqual(row.cities);
      expect(row.techs).toBeGreaterThan(0);
      expect(row.army).toBeGreaterThan(0);
      expect(row.capitals).toBeGreaterThanOrEqual(1);
      expect(row.grossIncome).toBeGreaterThan(0);
    }
    const built = report.rows.reduce((sum, row) => sum + row.built.unit + row.built.building + row.built.improvement, 0);
    const spent = report.rows.reduce((sum, row) => sum + row.productionSpent.unit + row.productionSpent.building, 0);
    expect(built).toBeGreaterThan(10);
    expect(spent).toBeGreaterThan(built);
    expect(report.rows.some((row) => row.goldUpkeep > 0)).toBe(true);
    expect(report.mostCapitals.count).toBeGreaterThanOrEqual(1);
    expect(report.seed).toBe(3);
  });

  it('prints one table per era with a cell for every column, then the spread over the games', () => {
    const lines = formatReport([report, play(4)], (polity) => map.polities[polity]?.nameEn ?? '?');
    expect(lines[0]).toMatch(/^report: 2 game\(s\)/);
    const headers = lines.flatMap((line, index) => (line.startsWith('era ') ? [index] : []));
    expect(headers.length).toBeGreaterThan(1);
    const cells = (text: string): string[] => text.trim().split(/ {2,}/);
    for (const index of headers) {
      expect(cells(lines[index + 1] ?? '')).toEqual([...REPORT_COLUMNS]);
      const row = cells(lines[index + 2] ?? '');
      expect(row).toHaveLength(REPORT_COLUMNS.length);
      expect(row.slice(1).every((cell) => /^-?\d+(\.\d)?$/.test(cell))).toBe(true);
    }
    for (const start of [
      'spread over the games',
      'leader in total science',
      'leader in gross income',
      'wars ended:',
      'most capitals held',
      'air strikes per game',
    ]) {
      expect(lines.some((line) => line.startsWith(start)), start).toBe(true);
    }
  });

  it('counts a capital held through a vassal', () => {
    const state = createGame(map, { seed: 1 });
    const [a, b] = state.majors as [number, number];
    expect(capitalsOf(state, a)).toBe(1);
    const vassal = {
      ...state,
      polities: state.polities.map((polity, index) => (index === b ? { ...polity, overlord: a } : polity)),
    };
    expect(capitalsOf(vassal, a)).toBe(2);
  });
});
