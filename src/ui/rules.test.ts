import { describe, expect, it } from 'vitest';
import { createGame, endTurn } from '../core/game.ts';
import { apply, edit, put } from '../core/testUtil.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import {
  check,
  cityView,
  cityZoneAt,
  polityRows,
  politySummary,
  ranking,
  relationView,
  researchView,
  sortPolityRows,
  upgradeView,
  victoryView,
} from './rules.ts';

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
    // buildings wait for their techs
    expect(view.buildings).toEqual([]);
    expect(view.projects).toEqual([]);
    const learned = edit(state, (draft) => {
      draft.polities[JIA]!.techs.push('farming');
    });
    expect(cityView(learned, capital)!.buildings.map((option) => (option.item.kind === 'building' ? option.item.building : ''))).toEqual(['granary']);
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

  it('shows the research under way with the turns it still takes', () => {
    const start = createGame(map, { player: 'jia' });
    expect(researchView(start, JIA)).toBeNull();
    // the rules pick a tech for a player who has chosen none
    const state = endTurn(start).state;
    const view = researchView(state, JIA)!;
    expect(view.tech).toBe(state.polities[JIA]!.research);
    expect(view.turns).toBeGreaterThanOrEqual(1);
    expect(researchView(state, 5)).toBeNull();
  });

  it('offers an upgrade only once its tech is known', () => {
    let id = 0;
    const state = edit(createGame(map, { player: 'jia' }), (draft) => {
      id = put(draft, 'archer', JIA, map.zones[capital]!.siteHex + 1).id;
    });
    expect(upgradeView(state, id)).toBeNull();
    const learned = edit(state, (draft) => {
      draft.polities[JIA]!.techs.push('crossbow');
    });
    expect(upgradeView(learned, id)).toEqual({ type: 'crossbowman', gold: 24 });
    expect(upgradeView(state, 99999)).toBeNull();
  });

  it('finds the city on a hex', () => {
    const state = createGame(map);
    expect(cityZoneAt(state, map.zones[capital]!.siteHex)).toBe(capital);
    expect(cityZoneAt(state, map.zones.find((zone) => zone.id === 'jia-2')!.siteHex)).toBe(-1);
    expect(cityZoneAt(state, 0)).toBe(-1);
  });
});

describe('victoryView', () => {
  it('names the leader of each victory and where the player stands', () => {
    const start = createGame(map, { seed: 3, player: 'jia' });
    const state = edit(start, (draft) => {
      draft.polities[1]!.projectStage = 2;
      draft.polities[2]!.grossIncome = 900;
      draft.polities[0]!.grossIncome = 300;
    });
    const view = victoryView(state);
    expect(view.turnsLeft).toBe(state.lastTurn - state.turn);
    expect(view.lines.map((line) => line.kind)).toEqual(['conquest', 'science', 'economic']);
    const [conquest, science, economic] = view.lines;
    // everybody holds its own capital: the tie goes to the first
    expect(conquest).toMatchObject({ leaderValue: 1, playerValue: 1 });
    expect(conquest!.needed).toBeGreaterThan(1);
    expect(science).toMatchObject({ leader: 1, leaderValue: 2, playerValue: 0, needed: 3 });
    expect(economic).toMatchObject({ leader: 2, leaderValue: 900, playerValue: 300, needed: null });
  });

  it('has no player value in observer mode', () => {
    const view = victoryView(createGame(map, { seed: 3 }));
    expect(view.lines.every((line) => line.playerValue === null)).toBe(true);
    expect(view.lines.every((line) => line.leader >= 0)).toBe(true);
  });
});

describe('polityRows', () => {
  const state = edit(createGame(map, { seed: 3, player: 'jia' }), (draft) => {
    draft.favour['0:1'] = 40;
    draft.favour['0:2'] = -25;
  });
  const rows = polityRows(state, 0);

  it('lists every living polity but the viewer', () => {
    const alive = state.polities.flatMap((polity, index) => (polity.alive && index !== 0 ? [index] : []));
    expect(rows.map((row) => row.polity)).toEqual(alive);
    expect(rows.find((row) => row.polity === 1)).toMatchObject({ favour: 40 });
    const cityState = map.polities.findIndex((polity) => polity.kind === 'cityState');
    expect(rows.find((row) => row.polity === cityState)!.favour).toBeNull();
    for (const row of rows) {
      expect(row.strength).toBeGreaterThan(0);
      expect(row.distance).toBeGreaterThan(0);
    }
  });

  it('sorts by favour, strength and distance, both ways, with missing values last', () => {
    const byFavour = sortPolityRows(rows, 'favour', true);
    expect(byFavour[0]!.polity).toBe(1);
    const numbered = byFavour.filter((row) => row.favour !== null);
    expect(numbered.at(-1)!.polity).toBe(2);
    expect(byFavour.slice(numbered.length).every((row) => row.favour === null)).toBe(true);
    const ascending = sortPolityRows(rows, 'favour', false);
    expect(ascending[0]!.polity).toBe(2);
    expect(ascending.slice(numbered.length).every((row) => row.favour === null)).toBe(true);

    const near = sortPolityRows(rows, 'distance', false);
    for (let i = 1; i < near.length; i++) expect(near[i - 1]!.distance!).toBeLessThanOrEqual(near[i]!.distance!);
    const strong = sortPolityRows(rows, 'strength', true);
    for (let i = 1; i < strong.length; i++) expect(strong[i - 1]!.strength).toBeGreaterThanOrEqual(strong[i]!.strength);
    expect(sortPolityRows(rows, 'strength', true)).toEqual(strong);
  });

  it('has neither favour nor distance in observer mode', () => {
    const watched = polityRows(createGame(map, { seed: 3 }), -1);
    expect(watched.every((row) => row.favour === null && row.distance === null)).toBe(true);
  });
});

