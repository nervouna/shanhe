import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { FAVOUR, PROJECT, conquestTarget } from './data.ts';
import { applyAction, createGame, endTurn, getLegalActions, hashState } from './game.ts';
import type { GameEvent, GameState } from './game.ts';
import {
  airStrikeTargets,
  buildCost,
  buyCostOf,
  capitalDistance,
  capitalsHeldBy,
  checkAction,
  cityDefence,
  cityOnHex,
  dealOptions,
  favourStanding,
  hexDistance,
  researchOptions,
  routeOptions,
  routeSlotsOf,
  stepCheck,
  stepCostOf,
  strengthOf,
  unitDefence,
  unitEmbarked,
  unitOnHex,
  unitUpgrade,
  unitWithId,
  unlockOptions,
  victoryContenders,
  victoryStandings,
} from './query.ts';
import { edit, learn } from './testUtil.ts';

const map = createFixtureMap();

/** A game some turns in, so that there are wars, routes and agreements to ask about. */
function played(turns: number, seed = 5): GameState {
  let state = createGame(map, { seed });
  for (let i = 0; i < turns; i++) state = endTurn(state).state;
  return state;
}

function nations(state: GameState): number[] {
  return state.polities.flatMap((polity, index) =>
    polity.alive && map.polities[index]!.kind === 'nation' ? [index] : [],
  );
}

describe('queries', () => {
  it('leave the state as it was', () => {
    const state = played(25);
    const before = hashState(state);
    const unit = state.units[0]!;
    const city = state.cities.find((entry) => entry !== null)!;
    const site = map.zones[city.zone]!.siteHex;
    checkAction(state, { type: 'fortify', polity: unit.owner, unit: unit.id });
    unitWithId(state, unit.id);
    unitOnHex(state, unit.hex);
    cityOnHex(state, site);
    hexDistance(state, 0, 5);
    stepCheck(state, unit, unit.hex + 1);
    stepCostOf(state, unit, unit.hex + 1);
    unitEmbarked(state, unit);
    unitDefence(state, unit);
    cityDefence(state, city.zone);
    unitUpgrade(state, unit.id);
    buildCost(state, city.zone, { kind: 'unit', unit: 'warrior' });
    buyCostOf(state, city.zone, { kind: 'unit', unit: 'warrior' });
    airStrikeTargets(state, city.zone);
    researchOptions(state, city.owner);
    unlockOptions(state, city.owner);
    strengthOf(state, city.owner);
    capitalDistance(state, 0, 1);
    favourStanding(state, 0, 1);
    dealOptions(state, 0, 1);
    routeSlotsOf(state, city.owner);
    routeOptions(state, city.zone);
    victoryStandings(state);
    victoryContenders(state);
    capitalsHeldBy(state, 0);
    expect(hashState(state)).toBe(before);
  });

  it('checkAction gives the answer applyAction gives', () => {
    const state = played(12);
    const polity = state.majors[0]!;
    for (const action of getLegalActions(state, polity).slice(0, 40)) {
      expect(checkAction(state, action)).toBeNull();
      expect(applyAction(state, action).ok).toBe(true);
    }
    const refused = { type: 'declareWar', polity, target: polity } as const;
    const result = applyAction(state, refused);
    expect(result.ok).toBe(false);
    expect(checkAction(state, refused)).toBe(result.ok ? null : result.reason);
  });

  it('finds units and cities by hex, and prices what a city builds and buys', () => {
    const state = createGame(map, { seed: 1 });
    const unit = state.units.find((entry) => entry.owner === 0)!;
    expect(unitWithId(state, unit.id)).toBe(unit);
    expect(unitOnHex(state, unit.hex)).toBe(unit);
    expect(unitWithId(state, -5)).toBeNull();
    const zone = map.polities[0]!.capitalZone;
    expect(cityOnHex(state, map.zones[zone]!.siteHex)?.zone).toBe(zone);
    const item = { kind: 'unit', unit: 'warrior' } as const;
    expect(buildCost(state, zone, item)).toBeGreaterThan(0);
    expect(buyCostOf(state, zone, item)).toBeGreaterThan(buildCost(state, zone, item));
    expect(cityDefence(state, zone)).toBeGreaterThan(0);
    expect(strengthOf(state, 0)).toBeGreaterThan(0);
    expect(capitalDistance(state, 0, 0)).toBe(0);
    expect(capitalDistance(state, 0, 1)).toBeGreaterThan(0);
  });

  it('lists the research and the cards that are open', () => {
    const state = createGame(map, { seed: 1, player: map.polities[0]!.id });
    const open = researchOptions(state, 0);
    expect(open.length).toBeGreaterThan(0);
    for (const tech of open) expect(checkAction(state, { type: 'setResearch', polity: 0, tech })).toBeNull();
    expect(unlockOptions(state, 0)).toEqual([]);
    const rich = edit(state, (draft) => {
      draft.polities[0]!.cultureProgress = 100;
    });
    const cards = unlockOptions(rich, 0);
    expect(cards.length).toBeGreaterThan(0);
    for (const policy of cards) expect(checkAction(rich, { type: 'unlockPolicy', polity: 0, policy })).toBeNull();
  });

  it('names what stands between two nations, and favour moves towards the sum', () => {
    const start = createGame(map, { seed: 2 });
    const [a, b] = nations(start) as [number, number];
    const state = edit(start, (draft) => {
      draft.agreements.push({ kind: 'tradePact', a, b, since: 1, until: 30 });
      draft.agreements.push({ kind: 'truce', a, b, since: 1, until: 10 });
    });
    const standing = favourStanding(state, a, b)!;
    expect(standing.favour).toBe(0);
    expect(standing.terms.find((term) => term.cause === 'tradePact')?.value).toBe(FAVOUR.tradePact);
    expect(standing.terms.some((term) => (term.cause as string) === 'truce')).toBe(false);
    expect(standing.target).toBe(standing.terms.reduce((sum, term) => sum + term.value, 0));
    expect(favourStanding(state, b, a)).toEqual(standing);
    expect(favourStanding(state, a, a)).toBeNull();

    // Over a whole game: in a turn without a one-off change, every pair's favour takes one step towards the target.
    const jumps: GameEvent['type'][] = [
      'warDeclared', 'warJoined', 'peaceMade', 'agreementEnded', 'dealEnded', 'goldGifted', 'polityAnnexed',
    ];
    let checked = 0;
    let current = createGame(map, { seed: 4 });
    for (let turn = 0; turn < 40 && current.result === null; turn++) {
      const next = endTurn(current);
      if (!next.events.some((event) => jumps.includes(event.type))) {
        const alive = nations(next.state);
        for (const x of alive) {
          for (const y of alive) {
            if (x >= y) continue;
            const before = favourStanding(current, x, y)?.favour ?? 0;
            const after = favourStanding(next.state, x, y)!;
            const step = Math.sign(after.target - before) * Math.min(FAVOUR.drift, Math.abs(after.target - before));
            expect(after.favour, `turn ${current.turn}, ${x}:${y}`).toBe(before + step);
            checked++;
          }
        }
      }
      current = next.state;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('offers the resources one side has and the other lacks', () => {
    const state = learn(createGame(map, { seed: 3 }), 'all', ['husbandry']);
    const list = nations(state);
    let seen = 0;
    for (const a of list) {
      for (const b of list) {
        for (const option of dealOptions(state, a, b)) {
          seen++;
          expect([a, b]).toContain(option.seller);
          expect(option.buyer).toBe(option.seller === a ? b : a);
          const reason = checkAction(state, {
            type: 'proposeDeal', polity: a, target: b, seller: option.seller,
            resource: option.resource, goldPerTurn: option.goldPerTurn,
          });
          expect(['needsResource', 'alreadyHasResource', 'badItem', 'badTarget']).not.toContain(reason);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(dealOptions(state, list[0]!, list[0]!)).toEqual([]);
  });

  it('lists route destinations with the income the route then has', () => {
    const state = createGame(map, { seed: 1, player: map.polities[0]!.id });
    const from = map.polities[0]!.capitalZone;
    const options = routeOptions(state, from);
    expect(routeSlotsOf(state, 0)).toEqual({ used: 0, total: 1 });
    const open = options.filter((option) => option.reason === null);
    expect(open.length).toBeGreaterThan(0);
    for (const option of open) {
      expect(option.path.length).toBeGreaterThan(0);
      const result = applyAction(state, { type: 'establishRoute', polity: 0, city: from, to: option.to });
      expect(result.ok).toBe(true);
      const route = result.state.routes.at(-1)!;
      expect(route.income).toBe(option.income);
      expect(route.path).toEqual(option.path);
      expect(route.sea).toBe(option.sea);
    }
    // with the one slot used every destination is refused, the one in use as a duplicate
    const first = open[0]!;
    const used = applyAction(state, { type: 'establishRoute', polity: 0, city: from, to: first.to }).state;
    const after = routeOptions(used, from);
    expect(routeSlotsOf(used, 0)).toEqual({ used: 1, total: 1 });
    expect(after.every((option) => option.reason !== null)).toBe(true);
    expect(after.find((option) => JSON.stringify(option.to) === JSON.stringify(first.to))?.reason).toBe('duplicateRoute');
    // a port its techs have not opened is listed as closed
    const port = options.find((option) => option.to.kind === 'port');
    if (port !== undefined) expect(port.reason).toBe('portClosed');
    expect(routeOptions(state, -1)).toEqual([]);
  });

  it('finds the air strike targets of a city with an airfield', () => {
    const base = createGame(map, { seed: 1 });
    const zone = map.polities[0]!.capitalZone;
    expect(airStrikeTargets(base, zone)).toEqual([]);
    const enemy = base.units.find(
      (unit) => unit.owner > 0 && hexDistance(base, unit.hex, map.zones[zone]!.siteHex) <= 6,
    );
    const state = edit(base, (draft) => {
      draft.cities[zone]!.buildings.push('airfield');
      if (enemy !== undefined) {
        draft.relations[`0:${enemy.owner}`] = { a: 0, b: enemy.owner, atWar: true, since: 1, offerA: 0, offerB: 0 };
      }
    });
    const targets = airStrikeTargets(state, zone);
    for (const target of targets) {
      expect(checkAction(state, { type: 'airStrike', polity: 0, city: zone, target })).toBeNull();
    }
    if (enemy !== undefined) expect(targets).toContain(enemy.hex);
  });

  it('reports the standings of the three victories', () => {
    const state = played(30);
    const standings = victoryStandings(state);
    expect(standings.capitalsNeeded).toBe(conquestTarget(state.majors.length));
    expect(standings.stagesNeeded).toBe(PROJECT.stages.length);
    expect(standings.turnsLeft).toBe(state.lastTurn - state.turn);
    expect(standings.rows.map((row) => row.polity)).toEqual(victoryContenders(state));
    for (const row of standings.rows) {
      expect(row.capitals).toBe(capitalsHeldBy(state, row.polity));
      expect(row.income).toBe(state.polities[row.polity]!.grossIncome);
    }
    expect(capitalsHeldBy(state, -1)).toBe(0);
  });
});
