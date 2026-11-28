import { describe, expect, it } from 'vitest';
import { createGame, endTurn } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { apply, edit, learn, put } from '../core/testUtil.ts';
import { researchOptions } from '../core/query.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { mainButton, peaceOffers, pendingItems, policyPending } from './pending.ts';
import type { Attention } from './pending.ts';

const map = createFixtureMap();
const none: Attention = { orders: new Map(), skipped: new Set() };
const player = 0;
const capital = map.polities[player]!.capitalZone;
const site = map.zones[capital]!.siteHex;

function freeHexes(count: number): number[] {
  const base = createGame(map, { player: 'jia' });
  return topologyOf(map)
    .zoneHexes[capital]!.filter((hex) => hex !== site && !base.units.some((unit) => unit.hex === hex))
    .slice(0, count);
}

describe('pendingItems', () => {
  it('asks for a project and a research in a new game and leaves the fortified garrison alone', () => {
    const state = createGame(map, { player: 'jia' });
    expect(pendingItems(state, none)).toEqual([{ kind: 'city', city: capital, hex: site }, { kind: 'research' }]);
  });

  it('is empty in observer mode and once the game is over', () => {
    expect(pendingItems(createGame(map), none)).toEqual([]);
    const over = edit(createGame(map, { player: 'jia' }), (draft) => {
      draft.result = { kind: 'economic', winner: 1, turn: 1 };
    });
    expect(pendingItems(over, none)).toEqual([]);
  });

  it('lists idle units before cities, and drops a city once it has a project', () => {
    const [a, b] = freeHexes(2) as [number, number];
    let first = 0;
    let second = 0;
    const idle = edit(createGame(map, { player: 'jia' }), (draft) => {
      first = put(draft, 'warrior', player, a).id;
      second = put(draft, 'archer', player, b).id;
      // somebody else's idle unit is nobody's business
      put(draft, 'warrior', 1, topologyOf(map).zoneHexes[map.polities[1]!.capitalZone]![0]!);
    });
    expect(pendingItems(idle, none)).toEqual([
      { kind: 'unit', unit: first, hex: a },
      { kind: 'unit', unit: second, hex: b },
      { kind: 'city', city: capital, hex: site },
      { kind: 'research' },
    ]);
    const queued = apply(idle, {
      type: 'queueBuild',
      polity: player,
      city: capital,
      item: { kind: 'unit', unit: 'warrior' },
    });
    expect(pendingItems(queued, none).map((item) => item.kind)).toEqual(['unit', 'unit', 'research']);
  });

  it('skips units that are fortified, asleep, out of moves, skipped or under orders', () => {
    const hexes = freeHexes(5);
    const ids: number[] = [];
    const state = edit(createGame(map, { player: 'jia' }), (draft) => {
      ids.push(put(draft, 'warrior', player, hexes[0]!, { status: 'fortified' }).id);
      ids.push(put(draft, 'warrior', player, hexes[1]!, { status: 'asleep' }).id);
      ids.push(put(draft, 'warrior', player, hexes[2]!, { moves: 0 }).id);
      ids.push(put(draft, 'warrior', player, hexes[3]!).id);
      ids.push(put(draft, 'warrior', player, hexes[4]!).id);
    });
    const attention: Attention = { orders: new Map([[ids[3]!, site]]), skipped: new Set([ids[4]!]) };
    expect(pendingItems(state, attention).filter((item) => item.kind === 'unit')).toEqual([]);
    expect(pendingItems(state, none).filter((item) => item.kind === 'unit')).toHaveLength(2);
  });
});

/** A new game of Jia with a project and a research chosen: nothing is pending. */
function settled(): GameState {
  let state = createGame(map, { player: 'jia' });
  state = apply(state, { type: 'queueBuild', polity: player, city: capital, item: { kind: 'unit', unit: 'warrior' } });
  return apply(state, { type: 'setResearch', polity: player, tech: 'farming' });
}

describe('pendingItems: research, policies and offers', () => {
  it('asks for a research until one is chosen, and again when it is done', () => {
    const state = settled();
    expect(pendingItems(state, none)).toEqual([]);
    const done = edit(state, (draft) => {
      draft.polities[player]!.research = null;
    });
    expect(pendingItems(done, none)).toEqual([{ kind: 'research' }]);
  });

  it('does not ask for a research when nothing is open', () => {
    const all = edit(learn(settled(), player), (draft) => {
      draft.polities[player]!.research = null;
    });
    expect(pendingItems(all, none).some((item) => item.kind === 'research')).toBe(false);
  });

  it('does not ask about the empty slots of a nation without a card', () => {
    const state = settled();
    expect(state.polities[player]!.slots).toEqual([null, null]);
    expect(policyPending(state)).toBe(false);
  });

  it('asks when a card can be unlocked, and when an unlocked card has a free slot', () => {
    const rich = edit(settled(), (draft) => {
      draft.polities[player]!.cultureProgress = 6;
    });
    expect(pendingItems(rich, none)).toEqual([{ kind: 'policy' }]);
    const unlocked = apply(rich, { type: 'unlockPolicy', polity: player, policy: 'wellField' });
    expect(pendingItems(unlocked, none)).toEqual([{ kind: 'policy' }]);
    const slotted = apply(unlocked, { type: 'slotPolicy', polity: player, policy: 'wellField', slot: 0 });
    // one slot is still empty, but there is no card left to put into it
    expect(slotted.polities[player]!.slots).toEqual(['wellField', null]);
    expect(pendingItems(slotted, none)).toEqual([]);
  });

  it('leaves a card alone that the player took out of its slot', () => {
    const rich = edit(settled(), (draft) => {
      draft.polities[player]!.cultureProgress = 6;
    });
    const unlocked = apply(rich, { type: 'unlockPolicy', polity: player, policy: 'wellField' });
    const slotted = apply(unlocked, { type: 'slotPolicy', polity: player, policy: 'wellField', slot: 0 });
    const emptiedSlot = apply(slotted, { type: 'slotPolicy', polity: player, policy: null, slot: 0 });
    expect(emptiedSlot.polities[player]!.slots).toEqual([null, null]);
    // both slots are empty and the card is in neither: it would wait for one, had the player not taken it out
    expect(policyPending(emptiedSlot)).toBe(true);
    expect(policyPending(emptiedSlot, new Set(['wellField']))).toBe(false);
    expect(policyPending(emptiedSlot, new Set(['clanLaw']))).toBe(true);
    expect(pendingItems(emptiedSlot, { ...none, shelved: new Set(['wellField']) })).toEqual([]);
    expect(pendingItems(emptiedSlot, none)).toEqual([{ kind: 'policy' }]);
    // a card that can be unlocked still asks
    const rich2 = edit(emptiedSlot, (draft) => {
      draft.polities[player]!.cultureProgress = 1000;
    });
    expect(policyPending(rich2, new Set(['wellField']))).toBe(true);
  });

  it('lists the proposals waiting for an answer, and drops one once answered', () => {
    const offered = edit(settled(), (draft) => {
      draft.offers.push({ id: 7, type: 'agreement', from: 1, to: player, turn: 1, agreement: 'tradePact' });
      draft.offers.push({ id: 8, type: 'deal', from: 2, to: player, turn: 1, seller: 2, resource: 'horses', goldPerTurn: 4 });
      // an offer between two others is not the player's
      draft.offers.push({ id: 9, type: 'agreement', from: 2, to: 1, turn: 1, agreement: 'openBorders' });
    });
    expect(pendingItems(offered, none)).toEqual([
      { kind: 'offer', offer: 7, from: 1 },
      { kind: 'offer', offer: 8, from: 2 },
    ]);
    const answered = apply(offered, { type: 'respond', polity: player, offer: 7, accept: false });
    expect(pendingItems(answered, none)).toEqual([{ kind: 'offer', offer: 8, from: 2 }]);
  });

  it('lists a peace offer of the last turn until it is declined, taken up or stale', () => {
    const atWar = edit(settled(), (draft) => {
      draft.relations['0:1'] = { a: 0, b: 1, atWar: true, since: 1, offerA: 0, offerB: 0 };
      draft.relations['0:2'] = { a: 0, b: 2, atWar: true, since: 1, offerA: 0, offerB: 0 };
    });
    expect(peaceOffers(atWar)).toEqual([]);
    const offered = edit(atWar, (draft) => {
      draft.turn = 12;
      draft.relations['0:1']!.offerB = 11;
      // the player's own offer is not one to answer
      draft.relations['0:2']!.offerA = 11;
    });
    expect(peaceOffers(offered)).toEqual([1]);
    expect(pendingItems(offered, none)).toEqual([{ kind: 'peace', from: 1 }]);
    expect(pendingItems(offered, { ...none, declined: new Set([1]) })).toEqual([]);
    const stale = edit(offered, (draft) => {
      draft.turn = 14;
    });
    expect(peaceOffers(stale)).toEqual([]);
    const peace = apply(offered, { type: 'makePeace', polity: player, target: 1 });
    expect(pendingItems(peace, none)).toEqual([]);
  });

  it('never blocks the next turn in a game the AI plays alongside', () => {
    // twelve turns of a player who only answers what is asked: the queue always empties
    let state = createGame(map, { player: 'jia', seed: 3 });
    for (let turn = 0; turn < 12; turn++) {
      for (let guard = 0; guard < 50; guard++) {
        const item = pendingItems(state, none)[0];
        if (item === undefined) break;
        if (item.kind === 'unit') state = apply(state, { type: 'sleep', polity: player, unit: item.unit });
        else if (item.kind === 'city') {
          state = apply(state, { type: 'queueBuild', polity: player, city: item.city, item: { kind: 'unit', unit: 'warrior' } });
        } else if (item.kind === 'research') {
          state = apply(state, { type: 'setResearch', polity: player, tech: researchOptions(state, player)[0]! });
        } else break;
      }
      expect(pendingItems(state, none).filter((item) => ['unit', 'city', 'research'].includes(item.kind))).toEqual([]);
      state = endTurn(state).state;
    }
    expect(state.turn).toBe(13);
  });
});

describe('mainButton', () => {
  const unitA = { kind: 'unit', unit: 7, hex: 1 } as const;
  const unitB = { kind: 'unit', unit: 9, hex: 2 } as const;
  const city = { kind: 'city', city: 3, hex: 5 } as const;

  it('becomes next turn only when nothing is pending', () => {
    expect(mainButton([], null)).toEqual({ kind: 'nextTurn' });
    expect(mainButton([city], null)).toEqual({ kind: 'city', item: city });
  });

  it('shows the first item, then the one after the item in focus, and wraps', () => {
    const items = [unitA, unitB, city];
    expect(mainButton(items, null)).toEqual({ kind: 'unit', item: unitA });
    expect(mainButton(items, unitA)).toEqual({ kind: 'unit', item: unitB });
    expect(mainButton(items, unitB)).toEqual({ kind: 'city', item: city });
    expect(mainButton(items, city)).toEqual({ kind: 'unit', item: unitA });
  });

  it('cycles through research, policy and offers like through units and cities', () => {
    const research = { kind: 'research' } as const;
    const policy = { kind: 'policy' } as const;
    const offer = { kind: 'offer', offer: 4, from: 2 } as const;
    const other = { kind: 'offer', offer: 5, from: 2 } as const;
    const peace = { kind: 'peace', from: 3 } as const;
    const items = [unitA, research, policy, offer, other, peace];
    expect(mainButton(items, unitA)).toEqual({ kind: 'research', item: research });
    expect(mainButton(items, research)).toEqual({ kind: 'policy', item: policy });
    expect(mainButton(items, policy)).toEqual({ kind: 'offer', item: offer });
    expect(mainButton(items, offer)).toEqual({ kind: 'offer', item: other });
    expect(mainButton(items, other)).toEqual({ kind: 'peace', item: peace });
    expect(mainButton(items, peace)).toEqual({ kind: 'unit', item: unitA });
    expect(mainButton([research], research)).toEqual({ kind: 'research', item: research });
  });

  it('keeps showing the only pending item even while it is in focus', () => {
    expect(mainButton([city], city)).toEqual({ kind: 'city', item: city });
    expect(mainButton([city], unitA)).toEqual({ kind: 'city', item: city });
  });
});

/**
 * The situation of the interface review: the capital finishes a warrior
 * while the turn ends, so the new turn begins with a unit that has no order,
 * a city that has no project and a research to choose.
 */
describe('the main button when a city has just finished a unit', () => {
  const begin = (): { state: GameState; unit: number } => {
    let state = apply(createGame(map, { player: 'jia' }), {
      type: 'queueBuild',
      polity: player,
      city: capital,
      item: { kind: 'unit', unit: 'warrior' },
    });
    const before = new Set(state.units.map((unit) => unit.id));
    for (let turn = 0; turn < 40 && state.cities[capital]!.queue.length > 0; turn++) state = endTurn(state).state;
    const built = state.units.find((unit) => unit.owner === player && !before.has(unit.id));
    expect(built, 'the capital built its warrior').toBeDefined();
    // and, as in the review, the research was finished in the same turn
    state = edit(state, (draft) => {
      draft.polities[player]!.research = null;
    });
    expect(researchOptions(state, player).length).toBeGreaterThan(0);
    return { state, unit: built!.id };
  };

  it('offers the newly idle unit before the city, and the city before the research', () => {
    const { state, unit } = begin();
    const items = pendingItems(state, none);
    expect(items.map((item) => item.kind)).toEqual(['unit', 'city', 'research']);
    expect(items[0]).toMatchObject({ kind: 'unit', unit });
    // the turn has just begun and nothing is in focus: the button names the unit
    expect(mainButton(items, null)).toMatchObject({ kind: 'unit', item: { unit } });
    // one press goes to the unit; only then does the button name the city, and after it the research
    expect(mainButton(items, items[0]!)).toMatchObject({ kind: 'city', item: { city: capital } });
    expect(mainButton(items, items[1]!)).toEqual({ kind: 'research', item: { kind: 'research' } });
    expect(mainButton(items, items[2]!)).toMatchObject({ kind: 'unit', item: { unit } });
  });

  it('comes back to the unit as soon as the city has its project, while the unit is still idle', () => {
    const { state, unit } = begin();
    const city = pendingItems(state, none)[1]!;
    const queued = apply(state, { type: 'queueBuild', polity: player, city: capital, item: { kind: 'unit', unit: 'warrior' } });
    const items = pendingItems(queued, none);
    expect(items.map((item) => item.kind)).toEqual(['unit', 'research']);
    // the city was in focus and is no longer pending: the queue starts from its head again
    expect(mainButton(items, city)).toMatchObject({ kind: 'unit', item: { unit } });
  });

  it('leaves the unit alone once it has an order or was told to wait, and goes on to the city', () => {
    const { state, unit } = begin();
    for (const attention of [
      { orders: new Map([[unit, true]]), skipped: new Set<number>() },
      { orders: new Map<number, boolean>(), skipped: new Set([unit]) },
    ]) {
      const items = pendingItems(state, attention);
      expect(items.map((item) => item.kind)).toEqual(['city', 'research']);
      expect(mainButton(items, null)).toMatchObject({ kind: 'city', item: { city: capital } });
    }
  });
});
