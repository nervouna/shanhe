import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { Terrain } from '../shared/mapData.ts';
import { itemCost } from './cities.ts';
import { createCtx } from './context.ts';
import { BUILDINGS, CITY, FREE_UNITS_PER_CITY, GENERIC_BUILDING_IDS, GENERIC_IMPROVEMENT_IDS, UNITS } from './data.ts';
import { NO_POLITY, applyAction, createGame, endTurn, hexOwner } from './game.ts';
import type { BuildItem, GameEvent, GameState, MutableGameState } from './game.ts';
import { apply, around, edit, isPlainGround, learn, oneUnitPerHex, put } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const WUCHENG = 4;
const site = (zone: number): number => map.zones[zone]!.siteHex;
/**
 * Jia is the human player and does nothing unless a test does it; nobody
 * declares war. Everybody knows the techs these tests build with, which puts
 * them in the classical era.
 */
const base = learn(createGame(map, { seed: 3, player: 'jia', majors: [] }), 'all', [
  'farming', 'husbandry', 'mining', 'boats', 'shipbuilding',
]);
const queue = (state: GameState, item: BuildItem, city = 0): GameState =>
  apply(state, { type: 'queueBuild', polity: state.cities[city]!.owner, city, item });

function run(state: GameState, turns: number): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < turns; i++) {
    const result = endTurn(current);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

describe('citizens and yields', () => {
  it('puts one citizen per population on hexes of the city\'s own area', () => {
    const state = edit(base, (draft) => {
      draft.cities[0]!.pop = 5;
    });
    const city = run(state, 1).state.cities[0]!;
    expect(city.worked).toHaveLength(5);
    expect(new Set(city.worked).size).toBe(5);
    for (const hex of city.worked) {
      expect(topo.workHexes[0]).toContain(hex);
      expect(hex).not.toBe(site(0));
    }
    for (const hex of topo.workHexes[0]!) {
      if (topo.water[hex] === 0) expect(map.zone[hex]).toBe(0);
    }
  });

  it('follows the focus', () => {
    const grown = edit(base, (draft) => {
      draft.cities[0]!.pop = 4;
    });
    const yields = (focus: 'balanced' | 'food' | 'production' | 'gold') =>
      apply(grown, { type: 'setFocus', polity: JIA, city: 0, focus }).cities[0]!.yields;
    expect(apply(grown, { type: 'setFocus', polity: JIA, city: 0, focus: 'gold' }).cities[0]!.focus).toBe('gold');
    expect(yields('food').food).toBeGreaterThanOrEqual(yields('balanced').food);
    expect(yields('food').food).toBeGreaterThanOrEqual(yields('production').food);
    expect(yields('production').production).toBeGreaterThan(yields('food').production);
    expect(yields('gold').gold).toBeGreaterThanOrEqual(yields('balanced').gold);
  });

  it('produces all five yields, and accumulates science and culture', () => {
    const { state } = run(base, 4);
    const city = state.cities[0]!;
    for (const key of ['food', 'production', 'gold', 'science', 'culture'] as const) {
      expect(city.yields[key]).toBeGreaterThan(0);
    }
    const polity = state.polities[JIA]!;
    expect(polity.yields).toEqual(city.yields);
    expect(polity.science).toBeGreaterThanOrEqual(4);
    expect(polity.culture).toBeGreaterThanOrEqual(4);
  });

  it('grows on food from 1 up to 20 and no further', () => {
    const { state, events } = run(base, 20);
    expect(state.cities[0]!.pop).toBeGreaterThan(1);
    expect(events).toContainEqual({ type: 'cityPopulation', city: 0, pop: 2 });
    const full = edit(base, (draft) => {
      draft.cities[0]!.pop = CITY.maxPop;
      draft.cities[0]!.food = 10_000;
    });
    expect(run(full, 3).state.cities[0]!.pop).toBe(CITY.maxPop);
  });

  it('shrinks when it cannot feed its citizens', () => {
    const crowded = edit(base, (draft) => {
      draft.cities[8]!.pop = 12;
      draft.cities[8]!.food = 0;
    });
    expect(topo.workHexes[8]!.length).toBeLessThan(12);
    expect(run(crowded, 1).state.cities[8]!.pop).toBe(11);
  });
});

describe('build queue', () => {
  it('works on one project at a time, in order', () => {
    const queued = queue(queue(base, { kind: 'unit', unit: 'warrior' }), { kind: 'building', building: 'granary' });
    expect(queued.cities[0]!.queue).toHaveLength(2);
    const { state, events } = run(queued, 30);
    const built = events.filter((event): event is Extract<GameEvent, { type: 'cityBuilt' }> => event.type === 'cityBuilt' && event.city === 0);
    expect(built.map((event) => event.item)).toEqual([
      { kind: 'unit', unit: 'warrior' },
      { kind: 'building', building: 'granary' },
    ]);
    expect(state.cities[0]!.queue).toHaveLength(0);
    expect(state.cities[0]!.buildings).toEqual(['granary']);
    // The capital's hex holds the garrison, so the new unit appears next to it.
    const jia = state.units.filter((unit) => unit.owner === JIA);
    expect(jia).toHaveLength(2);
    expect(around(map, site(0))).toContain(jia[1]!.hex);
    expect(oneUnitPerHex(state)).toBe(true);
  });

  it('takes as many turns as the cost needs, and carries the surplus over', () => {
    const queued = queue(base, { kind: 'unit', unit: 'warrior' });
    let state = queued;
    let spent = 0;
    let turns = 0;
    while (state.units.filter((unit) => unit.owner === JIA).length === 1) {
      state = endTurn(state).state;
      spent += state.cities[0]!.yields.production;
      turns++;
    }
    expect(turns).toBeGreaterThan(1);
    expect(spent).toBeGreaterThanOrEqual(UNITS.warrior!.cost);
    expect(state.cities[0]!.progress).toBe(spent - UNITS.warrior!.cost);
  });

  it('removes a queued item on request', () => {
    const queued = queue(queue(base, { kind: 'unit', unit: 'warrior' }), { kind: 'building', building: 'granary' });
    const trimmed = apply(queued, { type: 'unqueueBuild', polity: JIA, city: 0, index: 0 });
    expect(trimmed.cities[0]!.queue).toEqual([{ kind: 'building', building: 'granary' }]);
  });

  it('adds a building\'s yields and upkeep', () => {
    const plain = run(base, 1).state;
    const withGranary = run(
      edit(base, (draft) => {
        draft.cities[0]!.buildings.push('granary');
      }),
      1,
    ).state;
    expect(withGranary.cities[0]!.yields.food).toBe(plain.cities[0]!.yields.food + 2);
    expect(withGranary.polities[JIA]!.upkeep).toBe(plain.polities[JIA]!.upkeep + BUILDINGS.granary.upkeep);
    expect(GENERIC_BUILDING_IDS).toHaveLength(16);
  });

  it('places an improvement on a chosen hex of the city\'s zone', () => {
    const farmland = topo.workHexes[0]!.find(
      (hex) => isPlainGround(map, hex) && (map.terrain[hex] === Terrain.Plains || map.terrain[hex] === Terrain.Grassland) && map.feature[hex] === 0,
    )!;
    const hill = topo.workHexes[0]!.find((hex) => map.hills[hex] === 1)!;
    expect([...GENERIC_IMPROVEMENT_IDS].sort()).toEqual(['canal', 'farm', 'fishery', 'irrigationCanal', 'mine', 'pasture']);
    expect(applyAction(base, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'improvement', improvement: 'farm', hex: hill } })).toMatchObject({ ok: false, reason: 'badHex' });
    expect(applyAction(base, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'improvement', improvement: 'fishery', hex: farmland } })).toMatchObject({ ok: false, reason: 'badHex' });
    const foreign = topo.workHexes[3]![0]!;
    expect(applyAction(base, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'improvement', improvement: 'farm', hex: foreign } })).toMatchObject({ ok: false, reason: 'badHex' });

    const { state } = run(queue(queue(base, { kind: 'improvement', improvement: 'farm', hex: farmland }), { kind: 'improvement', improvement: 'mine', hex: hill }), 30);
    expect(state.improvements[farmland]).toBe('farm');
    expect(state.improvements[hill]).toBe('mine');
    expect(applyAction(state, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'improvement', improvement: 'pasture', hex: farmland } })).toMatchObject({ ok: false, reason: 'alreadyBuilt' });
    // A worked farm feeds the city.
    const before = edit(base, (draft) => {
      draft.cities[0]!.pop = 3;
      draft.cities[0]!.focus = 'food';
    });
    const after = edit(before, (draft) => {
      for (const hex of topo.workHexes[0]!) {
        if (map.terrain[hex] === Terrain.Grassland && map.hills[hex] === 0 && map.feature[hex] === 0) draft.improvements[hex] = 'farm';
      }
    });
    expect(run(after, 1).state.cities[0]!.yields.food).toBeGreaterThan(run(before, 1).state.cities[0]!.yields.food);
  });

  it('needs a coast for a harbour and for ships', () => {
    const later = base;
    expect(topo.coastal[0]).toBe(false);
    expect(topo.coastal[8]).toBe(true);
    expect(applyAction(later, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'building', building: 'harbour' } })).toMatchObject({ ok: false, reason: 'needsCoast' });
    expect(applyAction(later, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'unit', unit: 'galley' } })).toMatchObject({ ok: false, reason: 'needsCoast' });
    const afloat = run(queue(later, { kind: 'unit', unit: 'galley' }, 8), 20).state;
    // The AI that owns it may have upgraded the galley since: any ship of the city will do.
    const ship = afloat.units.find((unit) => unit.owner === afloat.cities[8]!.owner && UNITS[unit.type]!.domain === 'sea')!;
    expect(topo.water[ship.hex]).toBe(1);
  });
});

describe('founding cities', () => {
  it('founds a nation\'s other cities on its own preset sites through a build item', () => {
    expect(base.cities[1]).toBeNull();
    const queued = queue(base, { kind: 'city', zone: 1 });
    expect(applyAction(queued, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'city', zone: 1 } })).toMatchObject({ ok: false, reason: 'alreadyQueued' });
    const { state, events } = run(queued, 30);
    expect(state.cities[1]).toMatchObject({ zone: 1, owner: JIA, originalOwner: JIA });
    expect(events).toContainEqual({ type: 'cityFounded', city: 1, owner: JIA });
    expect(state.stats.citiesFounded).toBeGreaterThanOrEqual(1);
    expect(applyAction(state, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'city', zone: 1 } })).toMatchObject({ ok: false, reason: 'alreadyBuilt' });
    expect(state.polities[JIA]!.capital).toBe(0);
  });

  it('never lets a city-state expand', () => {
    const later = base;
    expect(applyAction(later, { type: 'queueBuild', polity: WUCHENG, city: 8, item: { kind: 'unit', unit: 'settler' } })).toMatchObject({ ok: false, reason: 'badItem' });
    expect(applyAction(later, { type: 'queueBuild', polity: WUCHENG, city: 8, item: { kind: 'city', zone: 8 } })).toMatchObject({ ok: false, reason: 'badItem' });
  });

  it('charges more for each settler than for the last', () => {
    const cost = (built: number): number => {
      const state = edit(base, (draft) => {
        draft.polities[JIA]!.settlersBuilt = built;
      });
      const ctx = createCtx(state as MutableGameState);
      return itemCost(ctx, ctx.state.cities[0]!, { kind: 'unit', unit: 'settler' });
    };
    expect(cost(0)).toBe(UNITS.settler!.cost);
    expect(cost(1)).toBeGreaterThan(cost(0));
    expect(cost(2)).toBeGreaterThan(cost(1));
    const built = run(queue(base, { kind: 'unit', unit: 'settler' }), 40).state;
    expect(built.units.some((unit) => unit.type === 'settler' && unit.owner === JIA)).toBe(true);
    expect(built.polities[JIA]!.settlersBuilt).toBe(1);
  });

  it('settles a wasteland site with a settler, first come first served', () => {
    const wild = site(9);
    let first = 0;
    let second = 0;
    let visitor = 0;
    const state = edit(base, (draft) => {
      first = put(draft, 'settler', JIA, wild).id;
      second = put(draft, 'settler', YI, around(map, wild).find((hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex))!).id;
      visitor = put(draft, 'warrior', YI, topo.zoneHexes[9]!.find((hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex))!).id;
    });
    const tribes = state.units.filter((unit) => unit.owner === NO_POLITY).length;
    expect(applyAction(state, { type: 'settle', polity: YI, unit: second })).toMatchObject({ ok: false, reason: 'notASettleSite' });
    const settled = apply(state, { type: 'settle', polity: JIA, unit: first });
    expect(settled.cities[9]).toMatchObject({ owner: JIA, originalOwner: NO_POLITY, pop: 1 });
    expect(settled.zoneOwner[9]).toBe(JIA);
    expect(settled.units.some((unit) => unit.id === first)).toBe(false);
    expect(hexOwner(settled, wild)).toBe(JIA);
    // The land is Jia's now: Yi's units are shown out, the tribes stay.
    expect(hexOwner(settled, settled.units.find((unit) => unit.id === visitor)!.hex)).not.toBe(JIA);
    expect(hexOwner(settled, settled.units.find((unit) => unit.id === second)!.hex)).not.toBe(JIA);
    expect(settled.units.filter((unit) => unit.owner === NO_POLITY)).toHaveLength(tribes);
    expect(oneUnitPerHex(settled)).toBe(true);
    // Not on one's own land, and not where a city already stands.
    const home = edit(base, (draft) => {
      first = put(draft, 'settler', JIA, site(1)).id;
    });
    expect(applyAction(home, { type: 'settle', polity: JIA, unit: first })).toMatchObject({ ok: false, reason: 'notASettleSite' });
  });
});

describe('gold', () => {
  it('pays unit and building upkeep and tracks cumulative gross income', () => {
    const state = edit(base, (draft) => {
      draft.cities[0]!.buildings.push('granary', 'temple');
      for (const hex of around(map, site(0)).filter((candidate) => topo.enterable[candidate] === 1).slice(0, 4)) {
        put(draft, 'warrior', JIA, hex);
      }
      draft.polities[JIA]!.gold = 100;
    });
    const units = state.units.filter((unit) => unit.owner === JIA).length;
    const next = endTurn(state).state;
    const polity = next.polities[JIA]!;
    const upkeep = BUILDINGS.granary.upkeep + BUILDINGS.temple.upkeep + (units - FREE_UNITS_PER_CITY);
    expect(polity.upkeep).toBe(upkeep);
    expect(polity.grossIncome).toBe(polity.yields.gold);
    expect(polity.gold).toBe(100 + polity.yields.gold - upkeep);
    const third = endTurn(next).state.polities[JIA]!;
    expect(third.grossIncome).toBe(polity.yields.gold + third.yields.gold);
  });

  it('disbands the newest unit when the treasury runs dry', () => {
    let last = 0;
    const state = edit(base, (draft) => {
      for (const hex of topo.zoneHexes[0]!.filter((candidate) => isPlainGround(map, candidate)).slice(0, 12)) {
        last = put(draft, 'warrior', JIA, hex).id;
      }
    });
    const { state: next, events } = endTurn(state);
    expect(next.polities[JIA]!.gold).toBe(0);
    expect(next.units.some((unit) => unit.id === last)).toBe(false);
    expect(events.some((event) => event.type === 'unitDisbanded' && event.unit === last)).toBe(true);
  });
});
