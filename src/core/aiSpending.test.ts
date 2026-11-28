/** What the AI does with gold, empty land and airfields (issue #38, items 10, 12 and 13). */

import { describe, expect, it } from 'vitest';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { AI, AIR_STRIKE, CITY_STATE } from './data.ts';
import { createGame, endTurn } from './game.ts';
import type { GameEvent, GameState } from './game.ts';
import { edit, isPlainGround, learn, put, withCity } from './testUtil.ts';
import { topologyOf } from './topology.ts';
import { NO_POLITY } from './types.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const apart = (a: number, b: number): number => hexDistance(indexToOffset(a, map.width), indexToOffset(b, map.width));
const of = <T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] =>
  events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
const cityStates = map.polities.flatMap((polity, index) => (polity.kind === 'cityState' ? [index] : []));

describe('a full treasury', () => {
  /** Jia, the only major nation, in a turn in which it looks at its neighbours, with `gold` in its treasury. */
  const rich = (gold: number): GameState =>
    edit(createGame(map, { seed: 3, majors: ['jia'] }), (draft) => {
      draft.turn = AI.diplomacyInterval * 3 - JIA;
      draft.polities[JIA]!.gold = gold;
    });
  const income = (state: GameState): number => {
    const self = state.polities[JIA]!;
    return self.yields.gold + self.routeIncome + self.tributeReceived;
  };

  it('is given away for standing beyond a few turns of income: to city-states first, then to neighbours', () => {
    expect(AI.treasuryTurns).toBeLessThanOrEqual(6);
    const gift = AI.giftGold * AI.richGiftFactor;
    const { state, events } = endTurn(rich(5000));
    const gifts = of(events, 'goldGifted').filter((event) => event.from === JIA);
    expect(gifts.length).toBeGreaterThan(2);
    // City-states in reach get what their influence can still take.
    const courted = gifts.filter((event) => cityStates.includes(event.to));
    expect(courted.length).toBeGreaterThan(0);
    for (const court of new Set(courted.map((event) => event.to))) {
      expect(state.polities[court]!.influence[JIA]).toBeGreaterThan(CITY_STATE.maxInfluence - gift / CITY_STATE.goldPerInfluence - 2);
      expect(state.polities[court]!.suzerain).toBe(JIA);
    }
    // The rest buys favour with the neighbours.
    const neighbours = gifts.filter((event) => map.polities[event.to]!.kind === 'nation');
    expect(neighbours.length).toBeGreaterThan(0);
    for (const event of neighbours) expect(state.favour[`${Math.min(JIA, event.to)}:${Math.max(JIA, event.to)}`]).toBeGreaterThan(0);
    // What it keeps: its reserve, a few turns of income, and less than one more gift (or nobody left to take one).
    const spent = gifts.reduce((sum, event) => sum + event.amount, 0);
    expect(spent).toBeGreaterThanOrEqual(3 * gift);
    expect(state.polities[JIA]!.gold).toBeLessThan(5000);
  });

  it('is left alone below that', () => {
    const state = rich(AI.goldReserve + AI.giftGold * AI.richGiftFactor - 1);
    const kept = AI.goldReserve + income(state) * AI.treasuryTurns;
    expect(state.polities[JIA]!.gold).toBeLessThan(kept + AI.giftGold * AI.richGiftFactor);
    const gifts = of(endTurn(state).events, 'goldGifted').filter((event) => event.from === JIA);
    // Only the small gift with which it courts the nearest city-state.
    expect(gifts.every((event) => event.amount === AI.giftGold && cityStates.includes(event.to))).toBe(true);
  });
});

describe('empty land', () => {
  const wasteland = map.zones.flatMap((zone, index) => (map.polities[zone.polity]!.kind === 'wastelandRegion' ? [index] : []));

  it('is worth a settler from farther away than before, and early', () => {
    expect(AI.settleRange).toBeGreaterThanOrEqual(20);
    expect(AI.settleAfterBuildings).toBe(1);
    expect(wasteland.length).toBeGreaterThan(0);
    // A nation at peace in the Classical era whose capital has its first building and two citizens.
    const nations = map.polities.flatMap((polity, index) => (polity.kind === 'nation' ? [index] : []));
    let base = learn(createGame(map, { seed: 3, majors: [] }), 'all', ['farming', 'husbandry', 'mining', 'archery']);
    // Every nation has founded the cities of its own sites: those come before any settler.
    map.zones.forEach((zone, index) => {
      if (map.polities[zone.polity]!.kind === 'nation' && base.cities[index] === null) base = withCity(base, index, zone.polity);
    });
    let sent = 0;
    for (const nation of nations) {
      const zone = map.polities[nation]!.capitalZone;
      // In reach: near enough, and a chain of zones leads there that are its own or nobody's (nobody has open borders yet).
      const way = (to: number): boolean => {
        const seen = new Set([to]);
        const frontier = [to];
        while (frontier.length > 0) {
          for (const next of topo.zoneNeighbors[frontier.pop()!]!) {
            if (seen.has(next) || (base.zoneOwner[next] !== nation && base.zoneOwner[next] !== NO_POLITY)) continue;
            if (next === zone) return true;
            seen.add(next);
            frontier.push(next);
          }
        }
        return false;
      };
      const near = wasteland.some(
        (other) => apart(site(other), site(zone)) <= AI.settleRange && topo.landmass[site(other)] === topo.landmass[site(zone)] && way(other),
      );
      const state = edit(base, (draft) => {
        draft.cities[zone]!.pop = 3;
        draft.cities[zone]!.buildings = ['granary'];
        // Every city has its garrison and the field unit is there too, so that the settler is the next thing it wants.
        for (const city of draft.cities) {
          if (city !== null && city.owner === nation && !draft.units.some((unit) => unit.hex === site(city.zone))) {
            put(draft, 'warrior', nation, site(city.zone));
          }
        }
        const spare = topo.zoneHexes[zone]!.find((hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex))!;
        put(draft, 'warrior', nation, spare);
      });
      const queue = endTurn(state).state.cities[zone]!.queue;
      const settler = queue.some((item) => item.kind === 'unit' && item.unit === 'settler');
      expect(settler, map.polities[nation]!.id).toBe(near);
      if (settler) sent++;
      // Without a building yet, it builds that first.
      const bare = endTurn(edit(state, (draft) => void (draft.cities[zone]!.buildings = []))).state.cities[zone]!.queue;
      expect(bare.some((item) => item.kind === 'unit' && item.unit === 'settler'), map.polities[nation]!.id).toBe(false);
    }
    expect(sent).toBeGreaterThan(0);
  });
});

describe('air power', () => {
  /** Jia, a major nation that knows every tech, at war with Yi, with a city on each of its sites. */
  const fighting = (): { state: GameState; front: number; target: number } => {
    let state = learn(createGame(map, { seed: 3, majors: ['jia'] }), JIA);
    map.zones.forEach((zone, index) => {
      if (zone.polity === JIA && state.cities[index] === null) state = withCity(state, index, JIA);
    });
    const enemy = site(map.polities[YI]!.capitalZone);
    const own = map.zones.flatMap((zone, index) => (zone.polity === JIA ? [index] : []));
    const front = own.reduce((best, zone) => (apart(site(zone), enemy) < apart(site(best), enemy) ? zone : best));
    state = edit(state, (draft) => {
      draft.turn = 30;
      draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 29, offerA: 0, offerB: 0 };
    });
    return { state, front, target: enemy };
  };

  it('is bought for the cities near the enemy as soon as a nation at war can pay for it', () => {
    const { state, front, target } = fighting();
    expect(apart(site(front), target)).toBeLessThanOrEqual(AI.airfieldFrontRange);
    const rich = edit(state, (draft) => void (draft.polities[JIA]!.gold = 5000));
    const bought = of(endTurn(rich).events, 'itemBought');
    expect(bought).toContainEqual(expect.objectContaining({ city: front, item: { kind: 'building', building: 'airfield' } }));
    // At peace nothing of the kind is hurried.
    const calm = edit(rich, (draft) => void (draft.relations = {}));
    const hurried = of(endTurn(calm).events, 'itemBought').filter((event) => event.item.kind === 'building' && event.item.building === 'airfield');
    expect(hurried.length).toBeLessThanOrEqual(bought.filter((event) => event.item.kind === 'building' && event.item.building === 'airfield').length);
  });

  it('is used: a city with an airfield strikes the enemy it sees in reach, every turn', () => {
    const { state, front } = fighting();
    const armed = edit(state, (draft) => {
      draft.cities[front]!.buildings.push('airfield');
      // An enemy unit in the open, in sight of the city and in reach of its airfield.
      const hex = topo.zoneHexes[front]!.find(
        (candidate) => isPlainGround(map, candidate) && apart(candidate, site(front)) === 2 && !draft.units.some((unit) => unit.hex === candidate),
      )!;
      put(draft, 'warrior', YI, hex);
    });
    const first = endTurn(armed);
    const strikes = of(first.events, 'airStrike').filter((event) => event.owner === JIA);
    expect(strikes).toHaveLength(1);
    expect(strikes[0]!.city).toBe(front);
    expect(apart(strikes[0]!.target, site(front))).toBeLessThanOrEqual(AIR_STRIKE.range);
    expect(strikes[0]!.damage).toBeGreaterThan(0);
    // A city without an airfield strikes nothing, and nobody strikes at peace.
    expect(of(endTurn(state).events, 'airStrike')).toEqual([]);
    const calm = edit(armed, (draft) => void (draft.relations = {}));
    expect(of(endTurn(calm).events, 'airStrike')).toEqual([]);
    expect(NO_POLITY).toBe(-1);
  });
});
