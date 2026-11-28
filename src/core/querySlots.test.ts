import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { POLICY } from './data.ts';
import { createGame, hashState } from './game.ts';
import type { GameState, RejectReason } from './game.ts';
import { checkAction, slotOpensOn } from './query.ts';
import { apply, edit } from './testUtil.ts';

const map = createFixtureMap();
const JIA = 0;

/** Jia with two cards in its two slots, a third unlocked, no free swap, on turn 20. */
const full = edit(createGame(map, { seed: 2, player: 'jia' }), (draft) => {
  const self = draft.polities[JIA]!;
  draft.turn = 20;
  self.policies.push('wellField', 'citizenLevy', 'clanLaw');
  self.slots = ['wellField', 'citizenLevy'];
  self.freeSwaps = 0;
});
const at = (state: GameState, turn: number): GameState =>
  edit(state, (draft) => {
    draft.turn = turn;
  });
const refill = (state: GameState, slot: number): RejectReason | null =>
  checkAction(state, { type: 'slotPolicy', polity: JIA, policy: 'wellField', slot });

describe('slotOpensOn', () => {
  it('is the current turn for a slot the rules would fill now', () => {
    const before = hashState(full);
    expect(slotOpensOn(full, JIA, 0)).toBe(20);
    expect(slotOpensOn(full, JIA, 1)).toBe(20);
    expect(hashState(full)).toBe(before);
    // a slot that was never filled is always open
    const fresh = createGame(map, { seed: 2, player: 'jia' });
    expect(slotOpensOn(fresh, JIA, 0)).toBe(fresh.turn);
  });

  it('is the end of the cooldown for every slot after a paid swap', () => {
    const swapped = apply(full, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 0 });
    expect(swapped.polities[JIA]!.swapReadyOn).toBe(20 + POLICY.swapCooldown);
    expect(slotOpensOn(swapped, JIA, 1)).toBe(25);
    expect(refill(swapped, 1)).toBe('swapCooldown');
    // a free swap opens every slot at once
    const free = edit(swapped, (draft) => {
      draft.polities[JIA]!.freeSwaps = 1;
    });
    expect(slotOpensOn(free, JIA, 1)).toBe(20);
    expect(refill(free, 1)).toBeNull();
  });

  it('is the turn a slot emptied during the cooldown takes a card again: the earlier of the two ends', () => {
    const swapped = apply(full, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 0 });
    // emptied two turns later: the paid swap's cooldown ends first
    const early = apply(at(swapped, 22), { type: 'slotPolicy', polity: JIA, policy: null, slot: 1 });
    expect(refill(early, 1)).toBe('swapCooldown');
    expect(slotOpensOn(early, JIA, 1)).toBe(25);
    // a cooldown that still runs for long: the slot has stood empty for a whole cooldown before it ends
    const long = edit(early, (draft) => {
      draft.polities[JIA]!.swapReadyOn = 40;
    });
    expect(slotOpensOn(long, JIA, 1)).toBe(22 + POLICY.swapCooldown);
    expect(slotOpensOn(long, JIA, 0)).toBe(40);
    expect(refill(at(long, 26), 1)).toBe('swapCooldown');
    expect(refill(at(long, 27), 1)).toBeNull();
    expect(slotOpensOn(at(long, 27), JIA, 1)).toBe(27);
  });

  it('agrees with the rules on every turn of a cooldown', () => {
    const swapped = apply(full, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 0 });
    const emptied = apply(swapped, { type: 'slotPolicy', polity: JIA, policy: null, slot: 1 });
    for (let turn = 20; turn <= 27; turn++) {
      const then = at(emptied, turn);
      for (const slot of [0, 1]) {
        expect(slotOpensOn(then, JIA, slot) <= turn, `turn ${turn} slot ${slot}`).toBe(refill(then, slot) === null);
      }
    }
  });
});
