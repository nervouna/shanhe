import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { createGame, hashState, polityHasResource } from './game.ts';
import type { GameState } from './game.ts';
import { offerObstacle } from './query.ts';
import { applyWithEvents, edit, learn, withAgreement } from './testUtil.ts';

const map = createFixtureMap();
const JIA = 0;
const DING = 3;
/** Ding is played by a human; Jia has horses and Ding has none. */
const base = learn(createGame(map, { seed: 4, player: 'ding' }), 'all', ['husbandry']);

/** Jia offers Ding its horses for 4 gold a turn, and Ding has `gold`. */
function offered(gold: number): GameState {
  return edit(base, (draft) => {
    draft.polities[DING]!.gold = gold;
    draft.offers.push({ id: 31, type: 'deal', from: JIA, to: DING, turn: draft.turn, seller: JIA, resource: 'horses', goldPerTurn: 4 });
  });
}

describe('offerObstacle', () => {
  it('finds nothing in the way of a deal the buyer can pay for, and the deal is then made', () => {
    expect(polityHasResource(base, JIA, 'horses')).toBe(true);
    expect(polityHasResource(base, DING, 'horses')).toBe(false);
    const state = offered(50);
    const before = hashState(state);
    expect(offerObstacle(state, 31)).toBeNull();
    expect(hashState(state)).toBe(before);
    const accepted = applyWithEvents(state, { type: 'respond', polity: DING, offer: 31, accept: true });
    expect(accepted.state.deals).toMatchObject([{ seller: JIA, buyer: DING, resource: 'horses', goldPerTurn: 4 }]);
  });

  /**
   * The report of the interface review: accepted with an empty treasury, the
   * offer went away and no deal was made. The rules now refuse with the
   * reason and keep the offer; the query says the same beforehand.
   */
  it('says that a buyer without the gold cannot take the deal, and the rules refuse it and keep the offer', () => {
    const state = offered(3);
    expect(offerObstacle(state, 31)).toBe('notEnoughGold');
    const accepted = applyWithEvents(state, { type: 'respond', polity: DING, offer: 31, accept: true });
    expect(accepted.state.offers).toEqual(state.offers);
    expect(accepted.state.deals).toHaveLength(0);
    expect(accepted.state.polities[DING]!.gold).toBe(3);
    expect(accepted.events).toEqual([{ type: 'offerRefused', offer: 31, from: JIA, to: DING, reason: 'notEnoughGold' }]);
    // with the gold the same answer makes the deal
    const paid = edit(accepted.state, (draft) => {
      draft.polities[DING]!.gold = 4;
    });
    const again = applyWithEvents(paid, { type: 'respond', polity: DING, offer: 31, accept: true });
    expect(again.state.offers).toHaveLength(0);
    expect(again.state.deals).toMatchObject([{ seller: JIA, buyer: DING, resource: 'horses', goldPerTurn: 4 }]);
    expect(again.events).toContainEqual({ type: 'offerAnswered', offer: 31, from: JIA, to: DING, accepted: true });
  });

  it('keeps the offer too when the one who offered to buy has run out of gold, and it can still be declined', () => {
    // The other way round: Ding, the AI, offered to buy Jia's horses and can no longer pay.
    const state = edit(learn(createGame(map, { seed: 4, player: 'jia' }), 'all', ['husbandry']), (draft) => {
      draft.polities[DING]!.gold = 0;
      draft.offers.push({ id: 33, type: 'deal', from: DING, to: JIA, turn: draft.turn, seller: JIA, resource: 'horses', goldPerTurn: 4 });
    });
    const accepted = applyWithEvents(state, { type: 'respond', polity: JIA, offer: 33, accept: true });
    expect(accepted.state.offers).toHaveLength(1);
    expect(accepted.events).toEqual([{ type: 'offerRefused', offer: 33, from: DING, to: JIA, reason: 'notEnoughGold' }]);
    const declined = applyWithEvents(accepted.state, { type: 'respond', polity: JIA, offer: 33, accept: false });
    expect(declined.state.offers).toHaveLength(0);
    expect(declined.events).toEqual([{ type: 'offerAnswered', offer: 33, from: DING, to: JIA, accepted: false }]);
  });

  it('still drops an accepted offer that anything else stands in the way of', () => {
    const state = edit(withAgreement(base, 'tradePact', JIA, DING), (draft) => {
      draft.offers.push({ id: 32, type: 'agreement', from: JIA, to: DING, turn: draft.turn, agreement: 'tradePact' });
    });
    const accepted = applyWithEvents(state, { type: 'respond', polity: DING, offer: 32, accept: true });
    expect(accepted.state.offers).toHaveLength(0);
    expect(accepted.events).toEqual([{ type: 'offerAnswered', offer: 32, from: JIA, to: DING, accepted: false }]);
  });

  it('says why an agreement that was offered can no longer be made', () => {
    const proposal = (state: GameState): GameState =>
      edit(state, (draft) => {
        draft.offers.push({ id: 32, type: 'agreement', from: JIA, to: DING, turn: draft.turn, agreement: 'tradePact' });
      });
    expect(offerObstacle(proposal(base), 32)).toBeNull();
    expect(offerObstacle(proposal(withAgreement(base, 'tradePact', JIA, DING)), 32)).toBe('alreadyAgreed');
  });

  it('knows no obstacle for an offer that does not wait', () => {
    expect(offerObstacle(base, 99)).toBe('noSuchOffer');
  });
});
