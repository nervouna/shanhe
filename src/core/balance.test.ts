import { describe, expect, it } from 'vitest';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { cloneState, createCtx } from './context.ts';
import { AI, CITY, DIPLOMACY, RESEARCH, TECHS, TURNS_PER_ERA, WAR } from './data.ts';
import { applyAction, createGame, endTurn, researchCost } from './game.ts';
import type { GameEvent, GameState } from './game.ts';
import { vassalsFull } from './relations.ts';
import { calendarPercent, realmPercent } from './tech.ts';
import { around, edit, put, withAgreement, withCity } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const seat = (polity: number): number => site(map.polities[polity]!.capitalZone);
const apart = (a: number, b: number): number => hexDistance(indexToOffset(a, map.width), indexToOffset(b, map.width));
const landBy = (hex: number): number[] => around(map, hex).filter((next) => topo.enterable[next] === 1 && topo.water[next] === 0);
/** `a` and `b` at war since turn `since`, in a game that has reached turn `turn`. */
const war = (state: GameState, a: number, b: number, since = 1, turn = state.turn): GameState =>
  edit(state, (draft) => {
    draft.turn = turn;
    draft.relations[`${Math.min(a, b)}:${Math.max(a, b)}`] = {
      a: Math.min(a, b), b: Math.max(a, b), atWar: true, since, offerA: 0, offerB: 0,
    };
  });

describe('the cost of a tech', () => {
  it('follows the calendar: more ahead of its era, less once the era has passed', () => {
    const industrial = TURNS_PER_ERA * 4 + 1;
    expect(calendarPercent(4, industrial)).toBe(0);
    expect(calendarPercent(4, industrial - 1)).toBe(RESEARCH.aheadPercent);
    expect(calendarPercent(5, industrial - 1)).toBe(2 * RESEARCH.aheadPercent);
    expect(calendarPercent(3, industrial)).toBe(-RESEARCH.behindPercent);
    expect(calendarPercent(0, industrial)).toBe(-RESEARCH.behindPercent * RESEARCH.behindEras);
  });

  it('grows with every city beyond the first, up to a limit', () => {
    const state = createGame(map, { majors: ['jia'] });
    expect(realmPercent(state, JIA)).toBe(0);
    const second = map.zones.findIndex((zone, index) => zone.polity === JIA && index !== map.polities[JIA]!.capitalZone);
    const two = withCity(state, second, JIA);
    expect(realmPercent(two, JIA)).toBe(RESEARCH.cityPercent);
    const many = edit(state, (draft) => {
      draft.cities = draft.cities.map((city, zone) => city ?? { ...draft.cities[map.polities[JIA]!.capitalZone]!, zone });
      for (const city of draft.cities) if (city !== null) city.owner = JIA;
    });
    // Every site of the map is a city of Jia now: the cities beyond the first count, up to the limit.
    expect(realmPercent(many, JIA)).toBe(RESEARCH.cityPercent * Math.min(RESEARCH.citiesCounted, map.zones.length - 1));
  });

  it('is the table cost with both applied', () => {
    const state = createGame(map, { majors: ['jia'] });
    // On turn 1 an ancient tech is on time and a classical one is one era ahead.
    expect(researchCost(state, JIA, 'farming')).toBe(TECHS.farming.cost);
    expect(researchCost(state, JIA, 'writing')).toBe(Math.ceil((TECHS.writing.cost * (100 + RESEARCH.aheadPercent)) / 100));
    const later = edit(state, (draft) => {
      draft.turn = TURNS_PER_ERA + 1;
    });
    expect(researchCost(later, JIA, 'writing')).toBe(TECHS.writing.cost);
    expect(researchCost(later, JIA, 'farming')).toBe(Math.ceil((TECHS.farming.cost * (100 - RESEARCH.behindPercent)) / 100));
  });
});

describe('war weariness', () => {
  it('rises by the same amount each turn at war, however many enemies there are', () => {
    const base = createGame(map, { seed: 1, majors: ['ding'] });
    const one = endTurn(war(base, JIA, YI)).state;
    const two = endTurn(war(war(base, JIA, YI), JIA, BING)).state;
    expect(one.polities[JIA]!.warWeariness).toBe(WAR.wearinessPerWarTurn);
    expect(two.polities[JIA]!.warWeariness).toBe(WAR.wearinessPerWarTurn);
    expect(endTurn(base).state.polities[JIA]!.warWeariness).toBe(0);
  });
});

describe('vassals', () => {
  it('are limited by the overlord\'s era', () => {
    const state = createGame(map, { majors: ['jia'] });
    const full = (from: GameState): boolean => vassalsFull(createCtx(cloneState(from)), JIA);
    expect(DIPLOMACY.vassalsByEra[0]).toBe(1);
    expect(full(state)).toBe(false);
    const one = withAgreement(state, 'vassalage', JIA, BING);
    expect(full(one)).toBe(true);
    // At the limit another vassal is refused, whatever the other nation thinks of it.
    expect(applyAction(one, { type: 'propose', polity: JIA, target: DING, agreement: 'vassalage' })).toMatchObject({
      ok: false, reason: 'refused',
    });
    const later = edit(one, (draft) => {
      draft.polities[JIA]!.era = 2;
    });
    expect(DIPLOMACY.vassalsByEra[2]).toBeGreaterThan(1);
    expect(full(later)).toBe(false);
  });

  /** Jia, far stronger than Yi, has been at war with it for 15 turns. */
  const beaten = (player: string | null, cityLost: boolean): GameState =>
    edit(war(createGame(map, { seed: 3, player, majors: ['jia'] }), JIA, YI, 5, 20), (draft) => {
      for (const hex of landBy(seat(JIA))) put(draft, 'warrior', JIA, hex);
      if (cityLost) draft.polities[YI]!.cityLostOn = 10;
    });
  const vassalized = (events: GameEvent[]): GameEvent[] => events.filter((event) => event.type === 'vassalized');

  it('a beaten nation that asks a far stronger enemy for peace becomes its vassal', () => {
    const state = beaten(null, true);
    const ctx = createCtx(cloneState(state));
    const strength = (polity: number): number => ctx.state.units.filter((unit) => unit.owner === polity).length;
    expect(strength(JIA)).toBeGreaterThanOrEqual(strength(YI) * AI.submitRatio);
    const result = applyAction(state, { type: 'makePeace', polity: YI, target: JIA });
    if (!result.ok) throw new Error(result.reason);
    expect(vassalized(result.events)).toEqual([{ type: 'vassalized', vassal: YI, overlord: JIA, forced: true }]);
    expect(result.state.polities[YI]!.overlord).toBe(JIA);
    expect(result.state.relations[`${JIA}:${YI}`]!.atWar).toBe(false);
  });

  it('a nation that has lost no city does not submit, and a strong enemy that is winning refuses it peace', () => {
    expect(applyAction(beaten(null, false), { type: 'makePeace', polity: YI, target: JIA })).toMatchObject({
      ok: false, reason: 'refused',
    });
  });

  it('a player who accepts such an offer of peace gets the vassal; a player who asks never submits', () => {
    const offered = applyAction(beaten('jia', true), { type: 'makePeace', polity: YI, target: JIA });
    if (!offered.ok) throw new Error(offered.reason);
    expect(offered.events).toContainEqual({ type: 'peaceOffered', from: YI, to: JIA });
    const accepted = applyAction(offered.state, { type: 'makePeace', polity: JIA, target: YI });
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(vassalized(accepted.events)).toHaveLength(1);
    expect(accepted.state.polities[YI]!.overlord).toBe(JIA);
    // The other way round: the player is the weak one and asks. If the AI agrees, it is a plain peace.
    const weak = edit(war(createGame(map, { seed: 3, player: 'yi', majors: ['jia'] }), JIA, YI, 5, 20), (draft) => {
      for (const hex of landBy(seat(JIA))) put(draft, 'warrior', JIA, hex);
      draft.polities[YI]!.cityLostOn = 10;
      draft.polities[JIA]!.warWeariness = AI.peaceWeariness;
    });
    const asked = applyAction(weak, { type: 'makePeace', polity: YI, target: JIA });
    if (!asked.ok) throw new Error(asked.reason);
    expect(vassalized(asked.events)).toHaveLength(0);
    expect(asked.state.polities[YI]!.overlord).toBe(-1);
  });
});

describe('a new unit', () => {
  it('musters on the nearest free hex within reach of its city when the gates are crowded', () => {
    const state = edit(createGame(map, { seed: 1, player: 'jia' }), (draft) => {
      draft.polities[JIA]!.gold = 1000;
      for (const hex of landBy(seat(JIA))) put(draft, 'warrior', JIA, hex);
    });
    const zone = map.polities[JIA]!.capitalZone;
    const result = applyAction(state, { type: 'buy', polity: JIA, city: zone, item: { kind: 'unit', unit: 'warrior' } });
    if (!result.ok) throw new Error(result.reason);
    const created = result.events.find((event) => event.type === 'unitCreated');
    if (created === undefined || created.type !== 'unitCreated') throw new Error('no unit');
    expect(apart(created.hex, seat(JIA))).toBe(2);
    expect(CITY.musterRadius).toBeGreaterThanOrEqual(2);
  });
});
