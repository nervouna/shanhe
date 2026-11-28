import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../core/game.ts';
import { routeOptions } from '../core/query.ts';
import type { RouteOption } from '../core/query.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { rankDestinations, targetKey } from './routes.ts';

function option(zone: number, income: number, length: number, reason: RouteOption['reason'] = null): RouteOption {
  return { to: { kind: 'city', zone }, reason, path: Array.from({ length }, (_, index) => index), sea: false, income };
}

describe('rankDestinations', () => {
  it('puts the route that pays most first', () => {
    const ranked = rankDestinations([option(1, 3, 5), option(2, 7, 9), option(3, 5, 2)]);
    expect(ranked.map((entry) => entry.income)).toEqual([7, 5, 3]);
  });

  it('prefers the shorter path between equal incomes, then the order of the map', () => {
    const ranked = rankDestinations([option(9, 4, 8), option(4, 4, 3), option(2, 4, 8)]);
    expect(ranked.map((entry) => (entry.to.kind === 'city' ? entry.to.zone : -1))).toEqual([4, 2, 9]);
  });

  it('lists what cannot be opened now after everything that can, however much it would pay', () => {
    const port: RouteOption = { to: { kind: 'port', port: 0 }, reason: 'portClosed', path: [], sea: false, income: 0 };
    const ranked = rankDestinations([option(1, 20, 4, 'duplicateRoute'), port, option(2, 2, 4), option(3, 6, 4)]);
    expect(ranked.map((entry) => targetKey(entry.to))).toEqual(['city:3', 'city:2', 'city:1', 'port:0']);
  });

  it('does not change its input, and gives the same order whatever order it gets', () => {
    const list = [option(5, 4, 3), option(1, 4, 3), option(3, 9, 3)];
    const copy = [...list];
    const ranked = rankDestinations(list);
    expect(list).toEqual(copy);
    expect(rankDestinations([...list].reverse())).toEqual(ranked);
  });

  it('ranks the destinations of a real city: the first one is the best route the rules open', () => {
    const map = createFixtureMap();
    const state = createGame(map, { seed: 1, player: 'jia' });
    const from = map.polities[0]!.capitalZone;
    const ranked = rankDestinations(routeOptions(state, from));
    const open = ranked.filter((entry) => entry.reason === null);
    expect(open.length).toBeGreaterThan(1);
    for (let i = 1; i < open.length; i++) expect(open[i - 1]!.income).toBeGreaterThanOrEqual(open[i]!.income);
    const best = open[0]!;
    const result = applyAction(state, { type: 'establishRoute', polity: 0, city: from, to: best.to });
    expect(result.ok).toBe(true);
    expect(result.state.routes[0]!.income).toBe(Math.max(...open.map((entry) => entry.income)));
    expect(new Set(ranked.map((entry) => targetKey(entry.to))).size).toBe(ranked.length);
  });
});
