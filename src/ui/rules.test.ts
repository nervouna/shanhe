import { describe, expect, it } from 'vitest';
import { createGame, endTurn } from '../core/game.ts';
import { apply, edit } from '../core/testUtil.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { check, cityView, cityZoneAt, politySummary, ranking, relationView } from './rules.ts';

const map = createFixtureMap();
const JIA = 0;
const YI = 1;
const capital = map.polities[JIA]!.capitalZone;

describe('cityView', () => {
  it('offers what the rules allow in the first era, with costs and turns', () => {
    const state = createGame(map, { player: 'jia' });
    const view = cityView(state, capital)!;
    expect(view.queue).toEqual([]);
    const units = view.units.map((option) => (option.item.kind === 'unit' ? option.item.unit : ''));
    expect(units).toContain('warrior');
    expect(units).not.toContain('swordsman');
    expect(units).not.toContain('settler');
    expect(units).not.toContain('tribe');
    const warrior = view.units.find((option) => option.item.kind === 'unit' && option.item.unit === 'warrior')!;
    expect(warrior.cost).toBe(24);
    expect(warrior.turns).toBe(Math.ceil(24 / view.city.yields.production));
    expect(view.buildings.map((option) => (option.item.kind === 'building' ? option.item.building : ''))).toEqual(
      expect.arrayContaining(['granary', 'walls', 'temple']),
    );
    // Jia has two more sites of its own to found cities on
    expect(view.sites).toHaveLength(2);
    for (const entry of view.improvements) {
      expect(entry.hexes.length).toBeGreaterThan(0);
      for (const hex of entry.hexes) {
        const item = { kind: 'improvement', improvement: entry.improvement, hex } as const;
        expect(check(state, { type: 'queueBuild', polity: JIA, city: capital, item })).toBeNull();
      }
    }
    expect(cityView(state, map.zones.findIndex((zone) => zone.id === 'jia-2'))).toBeNull();
  });

  it('counts stored production towards the first queue entry only', () => {
    let state = createGame(map, { player: 'jia' });
    const item = { kind: 'unit', unit: 'warrior' } as const;
    state = apply(state, { type: 'queueBuild', polity: JIA, city: capital, item });
    state = apply(state, { type: 'queueBuild', polity: JIA, city: capital, item });
    state = endTurn(state).state;
    const view = cityView(state, capital)!;
    const production = view.city.yields.production;
    expect(view.city.progress).toBeGreaterThan(0);
    expect(view.queue.map((entry) => entry.turns)).toEqual([
      Math.ceil((24 - view.city.progress) / production),
      Math.ceil(24 / production),
    ]);
  });
});

describe('summaries', () => {
  it('sums a polity\'s city yields and averages morale', () => {
    const state = createGame(map, { player: 'jia' });
    const summary = politySummary(state, JIA);
    const city = state.cities[capital]!;
    expect(summary).toEqual({ yields: city.yields, net: city.yields.gold, morale: 100, cities: 1 });
    expect(politySummary(state, 5).morale).toBeNull();
  });

  it('tells war, truce and peace apart', () => {
    let state = createGame(map, { player: 'jia' });
    expect(relationView(state, JIA, YI)).toEqual({ kind: 'peace' });
    state = apply(state, { type: 'declareWar', polity: JIA, target: YI });
    expect(relationView(state, YI, JIA)).toEqual({ kind: 'war', since: 1 });
    const peace = edit(state, (draft) => {
      draft.turn = 20;
      const relation = draft.relations['0:1']!;
      relation.atWar = false;
      relation.since = 15;
    });
    expect(relationView(peace, JIA, YI)).toEqual({ kind: 'truce', until: 25 });
    expect(check(peace, { type: 'declareWar', polity: JIA, target: YI })).toBe('truce');
    expect(relationView({ ...peace, turn: 25 }, JIA, YI)).toEqual({ kind: 'peace' });
  });

  it('ranks the winner first and the rest by income', () => {
    let state = createGame(map, { seed: 1 });
    while (state.result === null) state = endTurn(state).state;
    const rows = ranking(state);
    expect(rows[0]!.polity).toBe(state.result.winner);
    expect(rows.map((row) => row.polity).sort()).toEqual([...state.majors].sort());
    const rest = rows.slice(1).filter((row) => row.alive);
    for (let i = 1; i < rest.length; i++) expect(rest[i - 1]!.income).toBeGreaterThanOrEqual(rest[i]!.income);
  });

  it('finds the city on a hex', () => {
    const state = createGame(map);
    expect(cityZoneAt(state, map.zones[capital]!.siteHex)).toBe(capital);
    expect(cityZoneAt(state, map.zones.find((zone) => zone.id === 'jia-2')!.siteHex)).toBe(-1);
    expect(cityZoneAt(state, 0)).toBe(-1);
  });
});
