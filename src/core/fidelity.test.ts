/** Rules the design docs state and an independent review found missing (issue #38, items 1 to 4). */

import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { validate } from './actions.ts';
import { cloneState, createCtx } from './context.ts';
import { AI, DIPLOMACY, POLICY, UNIQUE_UNIT_IDS, UNITS, WAR, startingGarrison } from './data.ts';
import { processDiplomacy } from './diplomacy.ts';
import { applyAction, createGame, endTurn } from './game.ts';
import type { Action, GameEvent, GameState } from './game.ts';
import { SELF, labMap } from './kitLab.ts';
import { apply, around, edit, put } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const seat = (polity: number): number => site(map.polities[polity]!.capitalZone);
const landBy = (hex: number): number[] => around(map, hex).filter((next) => topo.enterable[next] === 1 && topo.water[next] === 0);
const reason = (state: GameState, action: Action): string => {
  const result = applyAction(state, action);
  return result.ok ? 'ok' : result.reason;
};
/** `a` and `b` at war since turn `since`, in a game that has reached turn `turn`. */
const war = (state: GameState, a: number, b: number, since: number, turn: number): GameState =>
  edit(state, (draft) => {
    draft.turn = turn;
    draft.relations[`${Math.min(a, b)}:${Math.max(a, b)}`] = {
      a: Math.min(a, b), b: Math.max(a, b), atWar: true, since, offerA: 0, offerB: 0,
    };
  });

describe('the garrison a nation starts with', () => {
  const ancient = UNIQUE_UNIT_IDS.filter((id) => UNITS[id]!.era === 0);

  it('is its unique unit of the Ancient era, whatever its class', () => {
    // Infantry and ranged units both: three of the seven are ranged.
    expect(ancient.map((id) => UNITS[id]!.unitClass).sort()).toEqual([
      'infantry', 'infantry', 'infantry', 'infantry', 'ranged', 'ranged', 'ranged',
    ]);
    for (const id of ancient) {
      const nation = UNITS[id]!.nation!;
      expect(startingGarrison(nation), nation).toBe(id);
      const lab = labMap(nation);
      const state = createGame(lab, { seed: 1 });
      const own = state.units.filter((unit) => unit.owner === SELF);
      expect(own.map((unit) => unit.type), nation).toEqual([id]);
      expect(own[0]!.hex).toBe(lab.zones[lab.polities[SELF]!.capitalZone]!.siteHex);
      expect(own[0]!.status).toBe('fortified');
    }
    for (const nation of ['qiongya', 'ezo', 'boni']) {
      expect(UNITS[startingGarrison(nation)]!.unitClass, nation).toBe('ranged');
    }
  });

  it('is the warrior for a nation whose unique unit comes later, and for a nation without a kit', () => {
    const later = UNIQUE_UNIT_IDS.find((id) => UNITS[id]!.era > 0)!;
    const nation = UNITS[later]!.nation!;
    expect(startingGarrison(nation)).toBe('warrior');
    const state = createGame(labMap(nation), { seed: 1 });
    expect(state.units.filter((unit) => unit.owner === SELF).map((unit) => unit.type)).toEqual(['warrior']);
    expect(startingGarrison('jia')).toBe('warrior');
    expect(createGame(map).units.filter((unit) => unit.owner === JIA).map((unit) => unit.type)).toEqual(['warrior']);
  });
});

describe('a peace offer to the player', () => {
  /** Yi, a major nation on the AI and much the stronger, has been at war with the player Jia since turn 5; it is turn 20. */
  const fighting = (): GameState =>
    edit(war(createGame(map, { seed: 3, player: 'jia', majors: ['yi'] }), JIA, YI, 5, 20), (draft) => {
      for (const hex of landBy(seat(YI))) put(draft, 'warrior', YI, hex);
    });
  const peace: Action = { type: 'makePeace', polity: JIA, target: YI };
  const offerOf = (state: GameState): number => state.relations[`${JIA}:${YI}`]!.offerB;
  /** The state after the diplomacy of the turn that is `turns` after the current one has been processed. */
  const diplomacyAfter = (state: GameState, turns: number): GameState => {
    const ctx = createCtx(edit(state, (draft) => void (draft.turn += turns)));
    processDiplomacy(ctx);
    return ctx.state;
  };

  it('stands for ten turns and then lapses, like any other offer', () => {
    expect(DIPLOMACY.offerTurns).toBe(10);
    // Yi is winning: it refuses the player's peace.
    expect(reason(fighting(), peace)).toBe('refused');
    const offered = apply(fighting(), { type: 'makePeace', polity: YI, target: JIA });
    expect(offerOf(offered)).toBe(20);
    // While the offer stands the player can take it up.
    expect(reason(offered, peace)).toBe('ok');
    const standing = diplomacyAfter(offered, DIPLOMACY.offerTurns - 2);
    expect(offerOf(standing)).toBe(20);
    expect(reason(standing, peace)).toBe('ok');
    // The same turn count that ends any other offer ends this one.
    const lapsed = diplomacyAfter(offered, DIPLOMACY.offerTurns - 1);
    expect(offerOf(lapsed)).toBe(-(20 + DIPLOMACY.offerTurns - 1));
    expect(reason(lapsed, peace)).toBe('refused');
    expect(validate(createCtx(cloneState(lapsed)), peace)).toBe('refused');
  });

  it('is not made again at once: the AI waits as long as the offer stood, and then may offer again', () => {
    /** Yi wants peace (it is weary); its last offer lapsed `ago` turns ago. */
    const weary = (ago: number): GameState =>
      edit(fighting(), (draft) => {
        draft.polities[YI]!.warWeariness = AI.peaceWeariness;
        draft.relations[`${JIA}:${YI}`]!.offerB = ago === 0 ? 0 : -(draft.turn - ago);
      });
    const offers = (events: GameEvent[]): GameEvent[] => events.filter((event) => event.type === 'peaceOffered');
    expect(offers(endTurn(weary(0)).events)).toEqual([{ type: 'peaceOffered', from: YI, to: JIA }]);
    expect(offers(endTurn(weary(1)).events)).toEqual([]);
    expect(offers(endTurn(weary(DIPLOMACY.offerTurns - 1)).events)).toEqual([]);
    const again = endTurn(weary(DIPLOMACY.offerTurns));
    expect(offers(again.events)).toEqual([{ type: 'peaceOffered', from: YI, to: JIA }]);
    expect(offerOf(again.state)).toBe(20);
  });

  it('is forgotten with the war', () => {
    const offered = apply(fighting(), { type: 'makePeace', polity: YI, target: JIA });
    const made = apply(offered, peace);
    expect(made.relations[`${JIA}:${YI}`]).toMatchObject({ atWar: false, offerA: 0, offerB: 0 });
  });
});

describe('war weariness', () => {
  /** Jia, far stronger than Yi and weary of the war, has been fighting it since turn 5; Yi has lost a city. */
  const beaten = (): GameState =>
    edit(war(createGame(map, { seed: 3, majors: ['jia'] }), JIA, YI, 5, 20), (draft) => {
      for (const hex of landBy(seat(JIA))) put(draft, 'warrior', JIA, hex);
      draft.polities[YI]!.cityLostOn = 10;
      draft.polities[JIA]!.warWeariness = 30;
    });

  it('falls by 10 for the victor when a beaten nation submits in a peace, as when vassalage is forced at its capital', () => {
    expect(WAR.wearinessPerVassalMade).toBe(10);
    const result = applyAction(beaten(), { type: 'makePeace', polity: YI, target: JIA });
    if (!result.ok) throw new Error(result.reason);
    expect(result.events).toContainEqual({ type: 'vassalized', vassal: YI, overlord: JIA, forced: true });
    expect(result.state.polities[JIA]!.warWeariness).toBe(20);
    // The vassal's own weariness is not touched.
    expect(result.state.polities[YI]!.warWeariness).toBe(beaten().polities[YI]!.warWeariness);
  });

  it('does not fall for a vassal that comes by agreement', () => {
    const state = edit(createGame(map, { seed: 3, majors: ['jia'] }), (draft) => {
      for (const hex of landBy(seat(JIA))) put(draft, 'warrior', JIA, hex);
      draft.polities[JIA]!.warWeariness = 30;
      draft.favour[`${JIA}:${YI}`] = 100;
    });
    const result = applyAction(state, { type: 'propose', polity: JIA, target: YI, agreement: 'vassalage' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.polities[YI]!.overlord).toBe(JIA);
    expect(result.state.polities[JIA]!.warWeariness).toBe(30);
  });
});

describe('the swap cooldown', () => {
  /** Jia holds Clan law and Covenant in its two slots, has Well-field unlocked too, and no free swap left. */
  const base = edit(createGame(map, { seed: 3, player: 'jia', majors: [] }), (draft) => {
    const self = draft.polities[JIA]!;
    draft.turn = 10;
    self.policies = ['clanLaw', 'covenant', 'wellField'];
    self.slots = ['clanLaw', 'covenant'];
    self.freeSwaps = 0;
  });
  const slot = (policy: 'clanLaw' | 'covenant' | 'wellField' | null, index: number): Action => ({
    type: 'slotPolicy', polity: JIA, policy, slot: index,
  });
  const later = (state: GameState, turns: number): GameState => edit(state, (draft) => void (draft.turn += turns));

  it('counts emptying a slot and refilling it as a swap', () => {
    expect(POLICY.swapCooldown).toBe(5);
    // Emptying is always allowed and costs nothing by itself.
    const emptied = apply(base, slot(null, 0));
    expect(emptied.polities[JIA]).toMatchObject({ slots: [null, 'covenant'], swapReadyOn: 0, slotFreedOn: [10, 0] });
    // Refilling it is the swap: allowed while no cooldown runs, and it starts one.
    const refilled = apply(emptied, slot('wellField', 0));
    expect(refilled.polities[JIA]).toMatchObject({ slots: ['wellField', 'covenant'], swapReadyOn: 15, slotFreedOn: [0, 0] });
    // The loophole: during the cooldown a card can still be taken out, but nothing goes into its place.
    expect(reason(refilled, slot('clanLaw', 1))).toBe('swapCooldown');
    const again = apply(refilled, slot(null, 1));
    expect(reason(again, slot('clanLaw', 1))).toBe('swapCooldown');
    expect(reason(later(again, 4), slot('clanLaw', 1))).toBe('swapCooldown');
    // Once the cooldown is over the slot can be filled. It has then stood empty for a whole cooldown,
    // which is its price: no new cooldown starts.
    const over = apply(later(again, 5), slot('clanLaw', 1));
    expect(over.polities[JIA]).toMatchObject({ slots: ['wellField', 'clanLaw'], swapReadyOn: 15 });
    // A slot emptied after the cooldown and refilled at once is a paid swap like any other.
    const next = apply(apply(later(refilled, 5), slot(null, 1)), slot('clanLaw', 1));
    expect(next.polities[JIA]).toMatchObject({ slots: ['wellField', 'clanLaw'], swapReadyOn: 20 });
  });

  it('takes a free swap for the refill if there is one', () => {
    const free = edit(apply(base, slot(null, 0)), (draft) => void (draft.polities[JIA]!.freeSwaps = 1));
    const refilled = apply(free, slot('wellField', 0));
    expect(refilled.polities[JIA]).toMatchObject({ freeSwaps: 0, swapReadyOn: 0 });
  });

  it('leaves a slot that was never filled, or has stood empty for a cooldown, free to fill', () => {
    const fresh = edit(base, (draft) => {
      draft.polities[JIA]!.slots = ['clanLaw', null];
      draft.polities[JIA]!.swapReadyOn = 14;
    });
    // A cooldown runs, but the second slot never held a card.
    const filled = apply(fresh, slot('covenant', 1));
    expect(filled.polities[JIA]).toMatchObject({ slots: ['clanLaw', 'covenant'], swapReadyOn: 14 });
    // A slot emptied a full cooldown ago has paid with the turns it stood empty.
    const emptied = apply(base, slot(null, 0));
    expect(apply(later(emptied, 5), slot('wellField', 0)).polities[JIA]).toMatchObject({ swapReadyOn: 0 });
    expect(apply(later(emptied, 4), slot('wellField', 0)).polities[JIA]).toMatchObject({ swapReadyOn: 19 });
  });
});
