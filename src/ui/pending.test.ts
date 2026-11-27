import { describe, expect, it } from 'vitest';
import { createGame } from '../core/game.ts';
import { apply, edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { mainButton, pendingItems } from './pending.ts';
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
  it('asks for a project in a new capital and leaves the fortified garrison alone', () => {
    const state = createGame(map, { player: 'jia' });
    expect(pendingItems(state, none)).toEqual([{ kind: 'city', city: capital, hex: site }]);
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
    ]);
    const queued = apply(idle, {
      type: 'queueBuild',
      polity: player,
      city: capital,
      item: { kind: 'unit', unit: 'warrior' },
    });
    expect(pendingItems(queued, none).map((item) => item.kind)).toEqual(['unit', 'unit']);
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

  it('keeps showing the only pending item even while it is in focus', () => {
    expect(mainButton([city], city)).toEqual({ kind: 'city', item: city });
    expect(mainButton([city], unitA)).toEqual({ kind: 'city', item: city });
  });
});
