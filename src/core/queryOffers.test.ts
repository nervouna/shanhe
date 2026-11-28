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
   * offer goes away and no deal is made. The rules take the answer and say
   * nothing; the query says beforehand why.
   */
  it('says that a buyer without the gold cannot take the deal, where the rules drop the offer in silence', () => {
    const state = offered(0);
    expect(offerObstacle(state, 31)).toBe('notEnoughGold');
    const accepted = applyWithEvents(state, { type: 'respond', polity: DING, offer: 31, accept: true });
    expect(accepted.state.offers).toHaveLength(0);
    expect(accepted.state.deals).toHaveLength(0);
    expect(accepted.events).toEqual([{ type: 'offerAnswered', offer: 31, from: JIA, to: DING, accepted: false }]);
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
