import { describe, expect, it } from 'vitest';
import { createGame } from '../core/game.ts';
import { around, edit, isPlainGround, put } from '../core/testUtil.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { orderAids, pathAids } from './aids.ts';
import { findPath, reachableHexes } from './path.ts';

describe('pathAids', () => {
  it('puts the piece’s hex in front and marks where each turn ends', () => {
    expect(pathAids(7, { hexes: [8, 9, 10, 11, 12], turns: [1, 1, 2, 2, 3], total: 3 })).toEqual({
      hexes: [7, 8, 9, 10, 11, 12],
      turnEnds: [2, 4, 5],
    });
    expect(pathAids(7, { hexes: [8], turns: [1], total: 1 })).toEqual({ hexes: [7, 8], turnEnds: [1] });
    expect(pathAids(7, { hexes: [8, 9], turns: [2, 2], total: 2 })).toEqual({ hexes: [7, 8, 9], turnEnds: [2] });
  });

  it('marks one end per turn of a real path, the last on the target', () => {
    const map = createFixtureMap();
    const capital = map.zones[map.polities[0]!.capitalZone]!.siteHex;
    const far = map.zones.find((zone) => zone.id === 'jia-3')!.siteHex;
    const hex = around(map, capital).find((candidate) => isPlainGround(map, candidate))!;
    let id = 0;
    const state = edit(createGame(map, { player: 'jia', seed: 2 }), (draft) => {
      draft.units = draft.units.filter((unit) => unit.hex !== hex);
      id = put(draft, 'warrior', 0, hex).id;
    });
    const path = findPath(state, id, far, 1)!;
    expect(path.total).toBeGreaterThan(1);
    const aids = pathAids(hex, path);
    expect(aids.hexes[0]).toBe(hex);
    expect(aids.hexes).toHaveLength(path.hexes.length + 1);
    expect(aids.turnEnds).toHaveLength(path.total - path.turns[0]! + 1);
    expect(aids.turnEnds.at(-1)).toBe(aids.hexes.length - 1);
    for (const end of aids.turnEnds) expect(path.turns[end - 1]).not.toBe(path.turns[end]);

    const aidsForOrder = orderAids({ unitHex: hex, reach: reachableHexes(state, id), path, attackTarget: far });
    expect(aidsForOrder.reachable).toEqual(reachableHexes(state, id));
    expect(aidsForOrder.path).toEqual(aids);
    expect(aidsForOrder.attackTarget).toBe(far);
  });
});

describe('orderAids', () => {
  it('leaves out what there is nothing to show of', () => {
    expect(orderAids({ unitHex: 3, reach: [], path: null, attackTarget: null })).toEqual({});
    expect(orderAids({ unitHex: 3, reach: [4, 5], path: null, attackTarget: null })).toEqual({ reachable: [4, 5] });
    // next to the enemy already: no path, only the target
    expect(orderAids({ unitHex: 3, reach: [4], path: { hexes: [], turns: [], total: 0 }, attackTarget: 9 })).toEqual({
      reachable: [4],
      attackTarget: 9,
    });
  });
});
