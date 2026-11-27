import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { AI, POLICIES } from './data.ts';
import { NO_POLITY, createGame, endTurn, hashState, hexOwner, loadGame, saveGame, tradeRouteSlots } from './game.ts';
import type { GameEvent, GameState } from './game.ts';
import { around, edit, isPlainGround, put } from './testUtil.ts';

const map = createFixtureMap();
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const WUCHENG = 4;
const YIDU = 3;
const site = (zone: number): number => map.zones[zone]!.siteHex;

interface Played {
  state: GameState;
  events: GameEvent[];
}
const play = (state: GameState, turns: number): Played => {
  let current = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < turns && current.result === null; i++) {
    const step = endTurn(current);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
};
const of = <T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] =>
  events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
const beside = (state: GameState, zone: number, polity: number): number[] =>
  around(map, site(zone)).filter((hex) => isPlainGround(map, hex) && hexOwner(state, hex) === polity);
const atWarWith = (state: GameState, a: number, b: number): GameState =>
  edit(state, (draft) => {
    draft.relations[`${Math.min(a, b)}:${Math.max(a, b)}`] = {
      a: Math.min(a, b), b: Math.max(a, b), atWar: true, since: draft.turn, offerA: 0, offerB: 0,
    };
  });

/** Nobody plays. Jia is the only major, so it alone researches, courts, trades and starts wars. */
const solo = createGame(map, { seed: 2, majors: ['jia'] });
const long = play(solo, 150);
/** All four nations are majors. */
const four = createGame(map, { seed: 2, majors: ['jia', 'yi', 'bing', 'ding'] });
const crowded = play(four, 150);

describe('AI: policies', () => {
  it('unlocks cards as culture allows and keeps its slots full', () => {
    const jia = long.state.polities[JIA]!;
    expect(jia.policies.length).toBeGreaterThanOrEqual(8);
    expect(jia.slots.filter((card) => card !== null).length).toBe(Math.min(jia.slots.length, jia.policies.length));
    expect(new Set(jia.slots.filter((card) => card !== null)).size).toBe(jia.slots.filter((card) => card !== null).length);
    expect(of(long.events, 'policySlotted').some((event) => event.replaced !== null)).toBe(true);
    // The nations on the simplified AI use policies too; the city-state has none.
    expect(long.state.polities[YI]!.policies.length).toBeGreaterThan(0);
    expect(long.state.polities[WUCHENG]!.policies).toHaveLength(0);
  });

  it('chooses the card that fits its situation: economy at peace, military at war', () => {
    const ready = edit(solo, (draft) => {
      draft.polities[JIA]!.cultureProgress = 6;
    });
    expect(endTurn(ready).state.polities[JIA]!.policies[0]).toBe('wellField');
    expect(POLICIES.wellField.kind).toBe('economy');
    const fighting = endTurn(atWarWith(ready, JIA, YI)).state.polities[JIA]!;
    expect(fighting.policies[0]).toBe('citizenLevy');
    expect(POLICIES.citizenLevy.kind).toBe('military');
    expect(fighting.slots).toContain('citizenLevy');
  });

  it('does not waste a slot on a diplomacy card that has nothing to work on', () => {
    // Culture for all four ancient cards at once: Covenant, with no city-state courted, comes last.
    const ready = edit(solo, (draft) => {
      draft.polities[JIA]!.cultureProgress = 1000;
    });
    const jia = endTurn(ready).state.polities[JIA]!;
    expect(jia.policies).toHaveLength(4);
    expect(jia.policies[3]).toBe('covenant');
    expect(jia.slots).not.toContain('covenant');
  });
});

describe('AI: trade routes', () => {
  it('fills its route slots, each route to a different place', () => {
    const early = play(solo, 3).state;
    expect(early.routes.filter((route) => route.owner === JIA)).toHaveLength(tradeRouteSlots(early, JIA));
    const routes = long.state.routes.filter((route) => route.owner === JIA);
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.length).toBeLessThanOrEqual(tradeRouteSlots(long.state, JIA));
    expect(new Set(routes.map((route) => `${route.toCity}:${route.toPort}`)).size).toBe(routes.length);
    expect(long.state.polities[JIA]!.routeIncome).toBeGreaterThan(0);
    expect(long.state.stats.routesEstablished).toBeGreaterThanOrEqual(routes.length);
    // The nations on the simplified AI open none.
    expect(long.state.routes.every((route) => route.owner === JIA)).toBe(true);
  });

  it('gets roads between its cities and along its land routes', () => {
    expect(Object.keys(long.state.roads).length).toBeGreaterThan(20);
    expect(of(long.events, 'roadsBuilt').some((event) => event.level === 2)).toBe(long.state.polities[JIA]!.techs.includes('railway'));
  });
});

describe('AI: agreements and deals', () => {
  it('proposes trade pacts, open borders and alliances, and the others accept from favour', () => {
    const signed = of(crowded.events, 'agreementSigned');
    expect(signed.some((event) => event.agreement === 'tradePact')).toBe(true);
    expect(signed.some((event) => event.agreement === 'openBorders')).toBe(true);
    const soloSigned = of(long.events, 'agreementSigned');
    expect(soloSigned.some((event) => event.agreement === 'tradePact')).toBe(true);
    // Somewhere on the fixture an alliance is made in one of the two games.
    expect(crowded.state.stats.alliancesFormed + long.state.stats.alliancesFormed).toBeGreaterThan(0);
  });

  it('sells a resource to a neighbour that has a use for it', () => {
    const deals = of(long.events, 'dealSigned');
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((event) => event.deal.seller === JIA)).toBe(true);
  });

  it('courts the nearby city-state with gifts once it has gold to spare', () => {
    const gifts = [...of(long.events, 'goldGifted'), ...of(crowded.events, 'goldGifted')];
    expect(gifts.length).toBeGreaterThan(0);
    expect(gifts.every((event) => event.to === WUCHENG && event.amount === AI.giftGold)).toBe(true);
  });

  it('leaves proposals to a human player as pending offers', () => {
    const played = play(createGame(map, { seed: 2, player: 'ding', majors: ['jia', 'yi', 'bing'] }), 40);
    const offers = of(played.events, 'offerMade');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((event) => event.offer.to === DING)).toBe(true);
    // Nothing was signed for the player without an answer.
    expect(of(played.events, 'agreementSigned').some((event) => event.a === DING || event.b === DING)).toBe(false);
    expect(played.state.offers.every((offer) => offer.to === DING)).toBe(true);
  });
});

describe('AI: war', () => {
  /** Jia, at war with Yi and Bing, stands with an army at the gates of Yi's fallen capital. */
  const siege = (enemies: number[]): GameState => {
    let state = solo;
    for (const enemy of enemies) state = atWarWith(state, JIA, enemy);
    return edit(state, (draft) => {
      draft.turn = 20;
      for (const key of Object.keys(draft.relations)) draft.relations[key]!.since = 20;
      draft.cities[YIDU]!.hp = 0;
      draft.polities[JIA]!.gold = 300;
      for (const hex of beside(state, YIDU, YI).slice(0, 4)) put(draft, 'warrior', JIA, hex);
    });
  };

  it('takes the owner of a fallen capital as a vassal when it is much the stronger and has another war', () => {
    const { state, events } = endTurn(siege([YI, BING]));
    expect(of(events, 'vassalized')).toEqual([{ type: 'vassalized', vassal: YI, overlord: JIA, forced: true }]);
    expect(state.polities[YI]!.overlord).toBe(JIA);
    expect(state.cities[YIDU]!.owner).toBe(YI);
    expect(state.stats.vassalsMade).toBe(1);
  });

  it('takes the city instead when that is its only war and it is not weary', () => {
    const { state, events } = endTurn(siege([YI]));
    expect(of(events, 'vassalized')).toHaveLength(0);
    expect(state.cities[YIDU]!.owner).toBe(JIA);
  });

  it('buys a defender for a threatened city without a garrison', () => {
    // Yi is the major here; a Jia army stands next to its empty capital.
    const game = createGame(map, { seed: 2, majors: ['yi'] });
    const threatened = edit(atWarWith(game, JIA, YI), (draft) => {
      draft.polities[YI]!.gold = 500;
      draft.units.splice(draft.units.findIndex((unit) => unit.owner === YI), 1);
      put(draft, 'warrior', JIA, beside(game, YIDU, YI)[0]!);
    });
    const { state, events } = endTurn(threatened);
    const bought = of(events, 'itemBought');
    expect(bought).toHaveLength(1);
    expect(bought[0]).toMatchObject({ city: YIDU, item: { kind: 'unit', unit: 'warrior' } });
    expect(state.polities[YI]!.gold).toBeLessThan(500);
    // At peace it buys nothing.
    const calm = edit(game, (draft) => {
      draft.polities[YI]!.gold = 500;
    });
    expect(of(endTurn(calm).events, 'itemBought')).toHaveLength(0);
  });

  it('keeps the nations on the simplified AI out of wars of their own, but not out of their allies\' wars', () => {
    const declared = [...of(long.events, 'warDeclared'), ...of(crowded.events, 'warDeclared')];
    expect(of(long.events, 'warDeclared').every((event) => event.by === JIA)).toBe(true);
    expect(declared.length).toBeGreaterThan(0);
    // Yi and Bing are allied; Jia, the only major, attacks Yi: Bing is in.
    const allied = edit(solo, (draft) => {
      draft.agreements.push({ kind: 'alliance', a: YI, b: BING, since: 1, until: 0 });
    });
    const attacked = endTurn(edit(allied, (draft) => {
      draft.turn = AI.firstWarTurn;
      for (const hex of beside(solo, 0, JIA).slice(0, 5)) put(draft, 'swordsman', JIA, hex);
      for (const hex of beside(solo, 2, JIA).slice(0, 3)) put(draft, 'swordsman', JIA, hex);
    }));
    const wars = of(attacked.events, 'warDeclared');
    expect(wars).toHaveLength(1);
    const victim = wars[0]!.on;
    expect([YI, BING]).toContain(victim);
    const friend = victim === YI ? BING : YI;
    expect(of(attacked.events, 'warJoined')).toContainEqual({ type: 'warJoined', polity: friend, against: JIA, with: victim });
    expect(attacked.state.relations[JIA + ':' + friend]?.atWar).toBe(true);
  });
});

describe('AI games with every system running', () => {
  it('are deterministic', () => {
    expect(hashState(play(four, 150).state)).toBe(hashState(crowded.state));
    expect(crowded.state.result).not.toBeNull();
  });

  it('continue from a save in the middle to the same final state', () => {
    const middle = play(four, 60).state;
    expect(middle.agreements.length + middle.routes.length).toBeGreaterThan(0);
    const loaded = loadGame(saveGame(middle), map);
    expect(loaded).toEqual(middle);
    expect(hashState(play(loaded, 150).state)).toBe(hashState(crowded.state));
  });

  it('never leave a vassal without a living overlord, an alliance at war, or an offer to an AI', () => {
    for (const { state } of [long, crowded]) {
      state.polities.forEach((polity, index) => {
        if (polity.overlord === NO_POLITY) return;
        expect(polity.alive).toBe(true);
        expect(state.polities[polity.overlord]!.alive).toBe(true);
        expect(state.agreements).toContainEqual(expect.objectContaining({ kind: 'vassalage', a: polity.overlord, b: index }));
      });
      for (const agreement of state.agreements) {
        expect(state.polities[agreement.a]!.alive && state.polities[agreement.b]!.alive).toBe(true);
        if (agreement.kind !== 'truce') {
          expect(state.relations[`${Math.min(agreement.a, agreement.b)}:${Math.max(agreement.a, agreement.b)}`]?.atWar ?? false).toBe(false);
        }
      }
      expect(state.offers).toHaveLength(0);
    }
  });
});
