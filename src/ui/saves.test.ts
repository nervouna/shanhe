import { describe, expect, it } from 'vitest';
import { maxCityHp } from '../core/cities.ts';
import { createGame, endTurn, hashState, rememberedBy, saveGame, supplyStatus, visibleTo } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { LAND, LAND2, labMap } from '../core/kitLab.ts';
import { favourStanding } from '../core/query.ts';
import { apply, edit, isPlainGround, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { createSyntheticMap } from '../shared/syntheticMap.ts';
import { MAX_SAVE_BYTES, exportSave, importSave } from './saves.ts';

const map = createFixtureMap();

function played(turns: number): GameState {
  let state = createGame(map, { seed: 5, player: 'jia' });
  state = apply(state, {
    type: 'queueBuild',
    polity: 0,
    city: map.polities[0]!.capitalZone,
    item: { kind: 'unit', unit: 'warrior' },
  });
  for (let i = 0; i < turns; i++) state = endTurn(state).state;
  return state;
}

/** The exported save with one change made to its parsed JSON. */
function tampered(state: GameState, change: (data: Record<string, unknown>) => void): string {
  const data = JSON.parse(exportSave(state)) as Record<string, unknown>;
  change(data);
  return JSON.stringify(data);
}

describe('exportSave and importSave', () => {
  it('round-trips a game in progress', () => {
    const state = played(30);
    expect(state.units.length).toBeGreaterThan(0);
    expect(Object.keys(state.relations).length + Object.keys(state.improvements).length).toBeGreaterThan(0);
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.map).toBe(map);
    expect(hashState(result.state)).toBe(hashState(state));
    // and the game goes on from it exactly as from the original
    expect(hashState(endTurn(result.state).state)).toBe(hashState(endTurn(state).state));
  });

  it('round-trips a game with the supply limit and the balance of power at work', () => {
    // Every nation is in the race, armies are past their limits, and one nation is far ahead: nothing of that
    // is kept in a field of its own, so the save needs no new field and the format keeps its version.
    let state = createGame(map, { seed: 7, majors: ['jia', 'yi', 'bing', 'ding'] });
    for (let i = 0; i < 40; i++) state = endTurn(state).state;
    state = edit(state, (draft) => {
      draft.polities[0]!.grossIncome += 5000;
      const free = topologyOf(map).zoneHexes[map.polities[1]!.capitalZone]!.filter(
        (hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex),
      );
      for (const hex of free.slice(0, 6)) put(draft, 'warrior', 1, hex);
    });
    expect(supplyStatus(state, 1).surcharge).toBeGreaterThan(0);
    expect(favourStanding(state, 0, 1)!.power.length).toBeGreaterThan(0);
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(hashState(result.state)).toBe(hashState(state));
    expect(supplyStatus(result.state, 1)).toEqual(supplyStatus(state, 1));
    expect(favourStanding(result.state, 0, 1)).toEqual(favourStanding(state, 0, 1));
    let loaded = result.state;
    for (let i = 0; i < 10; i++) {
      state = endTurn(state).state;
      loaded = endTurn(loaded).state;
    }
    expect(hashState(loaded)).toBe(hashState(state));
  });

  it('loads a save made when cities had more HP, and the next turn brings them down to what they can have now', () => {
    const state = played(5);
    const zone = map.polities[0]!.capitalZone;
    const limit = maxCityHp(state.cities[zone]!);
    const result = importSave(
      tampered(state, (data) => {
        (data.cities as ({ hp: number } | null)[])[zone]!.hp = limit + 70;
      }),
      map,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.state.cities[zone]!.hp).toBe(limit + 70);
    expect(endTurn(result.state).state.cities[zone]!.hp).toBe(limit);
  });

  it('round-trips a finished game', () => {
    let state = createGame(map, { seed: 1 });
    while (state.result === null) state = endTurn(state).state;
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.result).toEqual(state.result);
  });

  it('keeps the difficulty level and what every polity has seen', () => {
    let state = createGame(map, { seed: 5, player: 'jia', difficulty: 'hard' });
    for (let i = 0; i < 20; i++) state = endTurn(state).state;
    expect(state.explored.filter((entry) => entry !== '').length).toBeGreaterThan(1);
    // The city-state is neither a major nor the player: it keeps no memory.
    expect(state.explored[4]).toBe('');
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.difficulty).toBe('hard');
    expect(result.state.explored).toEqual(state.explored);
    expect(rememberedBy(result.state, 0)).toEqual(rememberedBy(state, 0));
    expect(visibleTo(result.state, 0)).toEqual(visibleTo(state, 0));
    expect(hashState(result.state)).toBe(hashState(state));
    expect(hashState(endTurn(result.state).state)).toBe(hashState(endTurn(state).state));
  });

  it('rejects text that is not JSON, not a save, or too large', () => {
    expect(importSave('', map)).toEqual({ ok: false, error: 'notJson' });
    expect(importSave('{"format":', map)).toEqual({ ok: false, error: 'notJson' });
    expect(importSave('alert(1)', map)).toEqual({ ok: false, error: 'notJson' });
    expect(importSave('null', map)).toEqual({ ok: false, error: 'notASave' });
    expect(importSave('[1,2]', map)).toEqual({ ok: false, error: 'notASave' });
    expect(importSave('{"format":"something-else"}', map)).toEqual({ ok: false, error: 'notASave' });
    expect(importSave(' '.repeat(MAX_SAVE_BYTES + 1), map)).toEqual({ ok: false, error: 'tooLarge' });
  });

  it('rejects another version and another map', () => {
    const state = played(2);
    expect(importSave(tampered(state, (data) => (data.version = 99)), map)).toEqual({ ok: false, error: 'badVersion' });
    expect(importSave(exportSave(state), createSyntheticMap())).toEqual({ ok: false, error: 'wrongMap' });
    expect(importSave(saveGame(createGame(createSyntheticMap())), map)).toEqual({ ok: false, error: 'wrongMap' });
  });

  it('rejects a save whose content does not fit the map or the rules', () => {
    const state = played(12);
    const cases: Record<string, (data: Record<string, unknown>) => void> = {
      'missing units': (data) => delete data.units,
      'units not a list': (data) => (data.units = {}),
      'unit on a hex outside the map': (data) => ((data.units as { hex: number }[])[0]!.hex = map.width * map.height),
      'unit of an unknown type': (data) => ((data.units as { type: string }[])[0]!.type = 'deathStar'),
      'unit of a polity that does not exist': (data) => ((data.units as { owner: number }[])[0]!.owner = 64),
      'unit id as text': (data) => ((data.units as { id: unknown }[])[0]!.id = '1'),
      'two units with one id': (data) => {
        const units = data.units as { id: number }[];
        units[1]!.id = units[0]!.id;
      },
      'unit health out of range': (data) => ((data.units as { hp: number }[])[0]!.hp = 1e9),
      'unit status unknown': (data) => ((data.units as { status: string }[])[0]!.status = 'flying'),
      'too few polities': (data) => (data.polities as unknown[]).pop(),
      'gold not a number': (data) => ((data.polities as { gold: unknown }[])[0]!.gold = 'lots'),
      'gold not finite': (data) => ((data.polities as { gold: unknown }[])[0]!.gold = null),
      'zone owner out of range': (data) => ((data.zoneOwner as number[])[0] = 1000),
      'city in the wrong slot': (data) => ((data.cities as ({ zone: number } | null)[]).find((city) => city !== null)!.zone = 9),
      'city with an unknown building': (data) =>
        (data.cities as ({ buildings: string[] } | null)[]).find((city) => city !== null)!.buildings.push('deathRay'),
      'city with an unknown focus': (data) =>
        ((data.cities as ({ focus: string } | null)[]).find((city) => city !== null)!.focus = 'chaos'),
      'queue item of an unknown kind': (data) =>
        (data.cities as ({ queue: unknown[] } | null)[]).find((city) => city !== null)!.queue.push({ kind: 'wonder' }),
      'queue item with an unknown unit': (data) =>
        (data.cities as ({ queue: unknown[] } | null)[])
          .find((city) => city !== null)!
          .queue.push({ kind: 'unit', unit: '__proto__' }),
      'worked hex outside the map': (data) =>
        (data.cities as ({ worked: number[] } | null)[]).find((city) => city !== null)!.worked.push(-5),
      'improvement of an unknown kind': (data) => (data.improvements = { '40': 'casino' }),
      'improvement on a hex outside the map': (data) => (data.improvements = { '99999': 'farm' }),
      'relation under the wrong key': (data) =>
        (data.relations = { '0:1': { a: 0, b: 2, atWar: true, since: 1, offerA: 0, offerB: 0 } }),
      'relation of a polity with itself': (data) =>
        (data.relations = { '1:1': { a: 1, b: 1, atWar: true, since: 1, offerA: 0, offerB: 0 } }),
      'player out of range': (data) => (data.player = 50),
      'majors not a list of polities': (data) => (data.majors = [0, 'yi']),
      'turn zero': (data) => (data.turn = 0),
      'turn after the last': (data) => (data.turn = (data.lastTurn as number) + 5),
      'result of an unknown kind': (data) => (data.result = { kind: 'domination', winner: 0, turn: 3 }),
      'result with no such winner': (data) => (data.result = { kind: 'economic', winner: -4, turn: 3 }),
      'stats missing': (data) => (data.stats = {}),
      'next unit id below an existing id': (data) => (data.nextUnitId = 1),
      'rng not an integer': (data) => (data.rng = 0.5),
      'difficulty missing': (data) => delete data.difficulty,
      'difficulty of an unknown level': (data) => (data.difficulty = 'nightmare'),
      'explored missing': (data) => delete data.explored,
      'explored not a list': (data) => (data.explored = 'AAAA'),
      'explored with too few polities': (data) => (data.explored as string[]).pop(),
      'explored set not text': (data) => ((data.explored as unknown[])[0] = [1, 2, 3]),
      'explored set with an unknown character': (data) => ((data.explored as string[])[0] = '?'),
      'explored set with an empty tail': (data) => ((data.explored as string[])[0] += 'A'),
      'explored set past the end of the map': (data) =>
        ((data.explored as string[])[0] = 'B'.repeat(Math.ceil((map.width * map.height) / 6) + 1)),
      'explored set of a polity that keeps none': (data) => ((data.explored as string[])[4] = 'B'),
    };
    for (const [name, change] of Object.entries(cases)) {
      expect(importSave(tampered(state, change), map), name).toEqual({ ok: false, error: 'corrupt' });
    }
  });

  /**
   * Ding plays among three major nations for 30 turns, so there are policy
   * cards, agreements, trade routes and roads; a deal, an offer to the
   * player, a pillaged farm and a unit half-way down a road are added by hand.
   */
  function diplomatic(): GameState {
    let state = createGame(map, { seed: 2, player: 'ding', majors: ['jia', 'yi', 'bing'] });
    for (let i = 0; i < 30; i++) state = endTurn(state).state;
    return edit(state, (draft) => {
      draft.deals.push({
        id: draft.nextId++, seller: 0, buyer: 3, resource: 'horses', goldPerTurn: 4, since: draft.turn, until: draft.turn + 19,
      });
      draft.offers.push({ id: draft.nextId++, type: 'agreement', from: 1, to: 3, turn: draft.turn, agreement: 'openBorders' });
      draft.offers.push({
        id: draft.nextId++, type: 'deal', from: 2, to: 3, turn: draft.turn, seller: 2, resource: 'horses', goldPerTurn: 5,
      });
      draft.pillaged[40] = draft.turn + 3;
      draft.polities[4]!.influence[0] = 75;
      draft.polities[4]!.suzerain = 0;
      draft.units.find((unit) => unit.owner === 3)!.moves = 0.25;
    });
  }

  it('round-trips policies, agreements, offers, deals, routes, roads and influence', () => {
    const state = diplomatic();
    expect(state.polities.some((polity) => polity.policies.length > 0 && polity.slots.some((card) => card !== null))).toBe(true);
    expect(state.agreements.length).toBeGreaterThan(0);
    expect(Object.keys(state.favour).length).toBeGreaterThan(0);
    expect(state.routes.length).toBeGreaterThan(0);
    expect(Object.keys(state.roads).length).toBeGreaterThan(0);
    expect(Object.keys(state.roadLinks).length).toBeGreaterThan(0);
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state).toEqual(state);
    expect(exportSave(result.state)).toBe(exportSave(state));
    expect(hashState(endTurn(result.state).state)).toBe(hashState(endTurn(state).state));
  });

  it('round-trips a vassalage', () => {
    const state = edit(played(5), (draft) => {
      draft.polities[1]!.overlord = 0;
      draft.agreements.push({ kind: 'vassalage', a: 0, b: 1, since: 2, until: 0 });
      draft.agreements.push({ kind: 'alliance', a: 2, b: 3, since: 3, until: 0 });
    });
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state).toEqual(state);
  });

  it('rejects malformed policies, agreements, offers, deals, routes, roads and influence', () => {
    const state = diplomatic();
    type Rows = Record<string, unknown>[];
    const polities = (data: Record<string, unknown>): Rows => data.polities as Rows;
    const first = (data: Record<string, unknown>, field: string): Record<string, unknown> => (data[field] as Rows)[0]!;
    const carded = state.polities.findIndex((polity) => polity.slots.some((card) => card !== null));
    const cases: Record<string, (data: Record<string, unknown>) => void> = {
      'policies missing': (data) => delete polities(data)[0]!.policies,
      'unknown policy': (data) => (polities(data)[carded]!.policies as string[]).push('divineRight'),
      'policy listed twice': (data) => {
        const list = polities(data)[carded]!.policies as string[];
        list.push(list[0]!);
      },
      'slotted card that is not unlocked': (data) => (polities(data)[carded]!.policies = []),
      'too many slots': (data) => (polities(data)[carded]!.slots as unknown[]).push(null, null, null, null, null, null),
      'too few slots': (data) => (polities(data)[carded]!.slots = []),
      'policies of a city-state': (data) => (polities(data)[4]!.policies = ['clanLaw']),
      'culture progress negative': (data) => (polities(data)[0]!.cultureProgress = -1),
      'free swaps not a whole number': (data) => (polities(data)[0]!.freeSwaps = 1.5),
      'overlord that does not exist': (data) => (polities(data)[0]!.overlord = 99),
      'own overlord': (data) => (polities(data)[0]!.overlord = 0),
      'vassal without a vassalage': (data) => (polities(data)[1]!.overlord = 0),
      'city-state type of a nation': (data) => (polities(data)[0]!.cityStateType = 'finance'),
      'city-state without a type': (data) => (polities(data)[4]!.cityStateType = null),
      'unknown city-state type': (data) => (polities(data)[4]!.cityStateType = 'piracy'),
      'influence beyond the maximum': (data) => (polities(data)[4]!.influence = { '0': 5000 }),
      'influence of a polity that does not exist': (data) => (polities(data)[4]!.influence = { '77': 10 }),
      'influence under a key that is no index': (data) => (polities(data)[4]!.influence = { __proto__x: 10 }),
      'influence with a nation': (data) => (polities(data)[0]!.influence = { '1': 10 }),
      'suzerain of a nation': (data) => (polities(data)[0]!.suzerain = 1),
      'route income as text': (data) => (polities(data)[0]!.routeIncome = '9'),
      'favour missing': (data) => delete data.favour,
      'favour out of range': (data) => (data.favour = { '0:1': 500 }),
      'favour under a reversed key': (data) => (data.favour = { '1:0': 5 }),
      'favour with a city-state': (data) => (data.favour = { '0:4': 5 }),
      'favour with itself': (data) => (data.favour = { '1:1': 5 }),
      'agreements not a list': (data) => (data.agreements = {}),
      'agreement of an unknown kind': (data) => (first(data, 'agreements').kind = 'marriage'),
      'agreement with a polity that does not exist': (data) => (first(data, 'agreements').b = 64),
      'agreement with a city-state': (data) => (data.agreements = [{ kind: 'tradePact', a: 0, b: 4, since: 1, until: 0 }]),
      'agreement with itself': (data) => (data.agreements = [{ kind: 'tradePact', a: 2, b: 2, since: 1, until: 0 }]),
      'agreement in the wrong order': (data) => (data.agreements = [{ kind: 'tradePact', a: 2, b: 1, since: 1, until: 0 }]),
      'agreement listed twice': (data) =>
        (data.agreements = [
          { kind: 'alliance', a: 0, b: 1, since: 1, until: 0 },
          { kind: 'alliance', a: 0, b: 1, since: 2, until: 0 },
        ]),
      'agreement from the future': (data) => (first(data, 'agreements').since = 9999),
      'agreement that ends before it starts': (data) => (data.agreements = [{ kind: 'tradePact', a: 0, b: 1, since: 20, until: 3 }]),
      'vassalage the vassal does not know of': (data) => (data.agreements = [{ kind: 'vassalage', a: 0, b: 1, since: 1, until: 0 }]),
      'deal for an unknown resource': (data) => (first(data, 'deals').resource = 'unobtainium'),
      'deal with a price of zero': (data) => (first(data, 'deals').goldPerTurn = 0),
      'deal with an absurd price': (data) => (first(data, 'deals').goldPerTurn = 1e9),
      'deal with a buyer that does not exist': (data) => (first(data, 'deals').buyer = -1),
      'deal of a nation with itself': (data) => (first(data, 'deals').buyer = first(data, 'deals').seller),
      'deal id at or above the next id': (data) => (first(data, 'deals').id = data.nextId),
      'offer to an AI': (data) => (first(data, 'offers').to = 0),
      'offer of an unknown type': (data) => (first(data, 'offers').type = 'bribe'),
      'offer of an unknown agreement': (data) =>
        ((data.offers as Rows).find((offer) => offer.type === 'agreement')!.agreement = 'marriage'),
      'deal offer with a third seller': (data) => ((data.offers as Rows).find((offer) => offer.type === 'deal')!.seller = 0),
      'offer and deal with one id': (data) => (first(data, 'offers').id = first(data, 'deals').id),
      'route from a zone that does not exist': (data) => (first(data, 'routes').from = 500),
      'route from a zone without a city': (data) =>
        (first(data, 'routes').from = state.cities.findIndex((entry) => entry === null)),
      'route to nowhere': (data) => {
        first(data, 'routes').toCity = -1;
        first(data, 'routes').toPort = -1;
      },
      'route to a city and a port': (data) => {
        first(data, 'routes').toCity = 3;
        first(data, 'routes').toPort = 0;
      },
      'route to a port that does not exist': (data) => {
        first(data, 'routes').toCity = -1;
        first(data, 'routes').toPort = 9;
      },
      'route over a hex outside the map': (data) => (first(data, 'routes').path as number[]).push(map.width * map.height),
      'route without a path': (data) => (first(data, 'routes').path = []),
      'route path not a list': (data) => (first(data, 'routes').path = '1,2,3'),
      'route of a polity that does not exist': (data) => (first(data, 'routes').owner = 64),
      'route sea flag as a number': (data) => (first(data, 'routes').sea = 1),
      'next id missing': (data) => delete data.nextId,
      'next id below a used id': (data) => (data.nextId = 1),
      'road of an unknown level': (data) => (data.roads = { '40': 3 }),
      'road on a hex outside the map': (data) => (data.roads = { '99999': 1 }),
      'road under a key that is no hex': (data) => (data.roads = { 'constructor': 1 }),
      'road under a padded key': (data) => (data.roads = { '040': 1 }),
      'roads as a list': (data) => (data.roads = [1, 1]),
      'road link between a zone and itself': (data) => (data.roadLinks = { '1:1': 1 }),
      'road link in the wrong order': (data) => (data.roadLinks = { '2:1': 1 }),
      'road link to a zone that does not exist': (data) => (data.roadLinks = { '1:500': 1 }),
      'road link with an unknown value': (data) => (data.roadLinks = { '0:1': 7 }),
      'pillaged hex outside the map': (data) => (data.pillaged = { '-1': 5 }),
      'pillaged until a fraction of a turn': (data) => (data.pillaged = { '40': 2.5 }),
      'unit with more movement than its type has': (data) => ((data.units as Rows)[0]!.moves = 99),
      'unit with negative movement': (data) => ((data.units as Rows)[0]!.moves = -0.5),
      'stats without the new counters': (data) => delete (data.stats as Record<string, unknown>).vassalsMade,
    };
    for (const [name, change] of Object.entries(cases)) {
      expect(importSave(tampered(state, change), map), name).toEqual({ ok: false, error: 'corrupt' });
    }
  });

  it('keeps only the fields of the new records too', () => {
    const state = diplomatic();
    const text = tampered(state, (data) => {
      for (const field of ['agreements', 'deals', 'offers', 'routes']) (data[field] as Record<string, unknown>[])[0]!.extra = 'x';
    });
    const result = importSave(text, map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state).toEqual(state);
  });

  it('keeps only the fields of the format', () => {
    const state = played(3);
    const text = tampered(state, (data) => {
      data.onload = 'alert(1)';
      (data.units as Record<string, unknown>[])[0]!.extra = { nested: true };
      (data.polities as Record<string, unknown>[])[0]!.treasure = 'x';
    });
    const result = importSave(text, map);
    if (!result.ok) throw new Error(result.error);
    expect(Object.keys(result.state).sort()).toEqual(Object.keys(state).sort());
    expect(Object.keys(result.state.units[0]!).sort()).toEqual(Object.keys(state.units[0]!).sort());
    expect(Object.keys(result.state.polities[0]!).sort()).toEqual(Object.keys(state.polities[0]!).sort());
    expect(hashState(result.state)).toBe(hashState(state));
  });
});

describe('saves of games with nation kits', () => {
  // Polity 0 is 燕: one policy slot more than its era gives, and a unique unit and improvement of its own.
  const kitMap = labMap('yan');
  const home = kitMap.polities[0]!.capitalZone;

  function kitted(): GameState {
    return edit(endTurn(createGame(kitMap, { seed: 9, player: 'yan' })).state, (draft) => {
      put(draft, 'youzhouCavalry', 0, LAND);
      draft.improvements[LAND2] = 'greatWallPass';
      draft.cities[home]!.buildings.push('jixiaAcademy');
      draft.polities[0]!.cityLostOn = 1;
      draft.stats.seaInvasions = 2;
      draft.stats.navalBattles = 5;
    });
  }

  it('round-trips the extra slot, the unique unit, building and improvement, and the new counters', () => {
    const state = kitted();
    expect(state.polities[0]!.slots).toHaveLength(3);
    expect(state.polities[1]!.slots).toHaveLength(2);
    const result = importSave(exportSave(state), kitMap);
    if (!result.ok) throw new Error(result.error);
    expect(result.state).toEqual(state);
    expect(hashState(endTurn(result.state).state)).toBe(hashState(endTurn(state).state));
  });

  it('rejects a save whose new fields do not fit the rules', () => {
    const state = kitted();
    type Rows = Record<string, unknown>[];
    const polity = (data: Record<string, unknown>, index: number): Record<string, unknown> => (data.polities as Rows)[index]!;
    const stats = (data: Record<string, unknown>): Record<string, unknown> => data.stats as Record<string, unknown>;
    const cases: Record<string, (data: Record<string, unknown>) => void> = {
      'the turn a city was lost missing': (data) => delete polity(data, 0).cityLostOn,
      'the turn a city was lost negative': (data) => (polity(data, 0).cityLostOn = -1),
      'the turn a city was lost a fraction': (data) => (polity(data, 0).cityLostOn = 1.5),
      'the turn a city was lost as text': (data) => (polity(data, 0).cityLostOn = '1'),
      'sea invasions missing': (data) => delete stats(data).seaInvasions,
      'sea invasions negative': (data) => (stats(data).seaInvasions = -1),
      'naval battles missing': (data) => delete stats(data).navalBattles,
      'naval battles a fraction': (data) => (stats(data).navalBattles = 0.5),
      'a nation with the extra slot only its neighbour has': (data) => (polity(data, 1).slots as unknown[]).push(null),
      'the nation of the extra slot without it': (data) => (polity(data, 0).slots as unknown[]).pop(),
      'a unique unit that does not exist': (data) => ((data.units as Rows)[(data.units as Rows).length - 1]!.type = 'youzhouCavalry2'),
      'a unique building that does not exist': (data) => ((data.cities as Rows)[home]!.buildings = ['jixiaAcademia']),
      'a unique improvement that does not exist': (data) => (data.improvements = { [String(LAND2)]: 'greatWall' }),
    };
    for (const [name, change] of Object.entries(cases)) {
      expect(importSave(tampered(state, change), kitMap), name).toEqual({ ok: false, error: 'corrupt' });
    }
  });

  it('rejects a save of the format before the kits', () => {
    const state = kitted();
    expect(importSave(tampered(state, (data) => (data.version = 3)), kitMap)).toEqual({ ok: false, error: 'badVersion' });
  });
});
