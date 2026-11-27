import { describe, expect, it } from 'vitest';
import { unitDef } from '../core/data.ts';
import { applyAction, createGame } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { apply, around, edit, findPair, isPlainGround, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { Terrain } from '../shared/mapData.ts';
import { findPath, previewAttack, reachableHexes, stepsThisTurn } from './path.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const jiaCapital = map.zones[map.polities[JIA]!.capitalZone]!.siteHex;
const jiaSouth = map.zones.find((zone) => zone.id === 'jia-3')!.siteHex;
const yiCapital = map.zones[map.polities[YI]!.capitalZone]!.siteHex;

function distance(a: number, b: number): number {
  return hexDistance(indexToOffset(a, map.width), indexToOffset(b, map.width));
}

/** A game with one extra unit of `type` for Jia on `hex`; every other unit of Jia is removed. */
function withUnit(type: string, hex: number, moves?: number): { state: GameState; id: number } {
  let id = 0;
  const state = edit(createGame(map, { player: 'jia' }), (draft) => {
    draft.units = draft.units.filter((unit) => unit.owner !== JIA);
    id = put(draft, type, JIA, hex, moves === undefined ? {} : { moves }).id;
  });
  return { state, id };
}

describe('paths along a road', () => {
  it('count half a movement point per step, so a unit reaches twice as far', () => {
    // A straight line of open ground east of a hex in Jia's land.
    const line = (() => {
      for (let hex = 0; hex < map.width * map.height; hex++) {
        const hexes = [hex, hex + 1, hex + 2, hex + 3, hex + 4];
        const sameRow = Math.floor((hex + 4) / map.width) === Math.floor(hex / map.width);
        const dry = hexes.every((h, i) => map.owner[h] === JIA && isPlainGround(map, h) && (i === 0 || (map.riverEdges[hexes[i - 1]!]! & 1) === 0));
        if (sameRow && dry) return hexes;
      }
      throw new Error('no straight line of open ground on the fixture');
    })();
    const { state, id } = withUnit('warrior', line[0]!);
    expect(reachableHexes(state, id)).not.toContain(line[4]!);
    const paved = edit(state, (draft) => {
      for (const hex of line) draft.roads[hex] = 1;
    });
    expect(reachableHexes(paved, id)).toContain(line[4]!);
    expect(stepsThisTurn(paved, id, line[4]!)).toEqual(line.slice(1));
    // The rules agree step by step, down to the last half point.
    let walked = paved;
    for (const to of line.slice(1)) walked = apply(walked, { type: 'move', polity: JIA, unit: id, to });
    expect(walked.units.find((unit) => unit.id === id)!.moves).toBe(0);
    expect(walked.units.find((unit) => unit.id === id)!.hex).toBe(line[4]);
  });
});

/** What `endTurn` does to movement: everybody gets their points back. */
function newTurn(state: GameState): GameState {
  return edit(state, (draft) => {
    for (const unit of draft.units) unit.moves = unitDef(unit.type).moves;
  });
}

/**
 * Walks the path the way the game does: this turn's steps, then a new turn,
 * again and again. Returns the number of turns it took.
 */
function walk(start: GameState, id: number, target: number): number {
  let state = start;
  for (let turn = 1; turn <= 40; turn++) {
    for (const to of stepsThisTurn(state, id, target)) {
      const result = applyAction(state, { type: 'move', polity: JIA, unit: id, to });
      expect(result.ok, `step to ${to} on turn ${turn}`).toBe(true);
      state = result.state;
    }
    if (state.units.find((unit) => unit.id === id)!.hex === target) return turn;
    state = newTurn(state);
  }
  throw new Error('the unit never arrived');
}

describe('findPath', () => {
  it('reaches an adjacent hex of plain ground in one turn', () => {
    const [a, b] = findPair(map, (x, y) => map.owner[x] === JIA && map.owner[y] === JIA && isPlainGround(map, x) && isPlainGround(map, y));
    const { state, id } = withUnit('warrior', a);
    expect(findPath(state, id, b)).toEqual({ hexes: [b], turns: [1], total: 1 });
    expect(findPath(state, id, a)).toEqual({ hexes: [], turns: [], total: 0 });
  });

  it('plans a move over several turns that the rules then accept step by step', () => {
    const { state, id } = withUnit('warrior', jiaCapital);
    const path = findPath(state, id, jiaSouth)!;
    expect(path).not.toBeNull();
    expect(path.hexes.at(-1)).toBe(jiaSouth);
    expect(path.total).toBeGreaterThan(1);
    expect(path.turns.at(-1)).toBe(path.total);
    // consecutive hexes are neighbours and the turn numbers never go back
    let previous = jiaCapital;
    path.hexes.forEach((hex, i) => {
      expect(around(map, previous)).toContain(hex);
      expect(path.turns[i]!).toBeGreaterThanOrEqual(path.turns[i - 1] ?? 1);
      previous = hex;
    });
    // no path can be faster than full speed over open ground
    expect(path.total).toBeGreaterThanOrEqual(Math.ceil(distance(jiaCapital, jiaSouth) / 2));
    expect(walk(state, id, jiaSouth)).toBe(path.total);
  });

  it('is faster for a unit with more movement', () => {
    const foot = withUnit('warrior', jiaCapital);
    const horse = withUnit('chariot', jiaCapital);
    const slow = findPath(foot.state, foot.id, jiaSouth)!;
    const fast = findPath(horse.state, horse.id, jiaSouth)!;
    expect(fast.total).toBeLessThan(slow.total);
    expect(walk(horse.state, horse.id, jiaSouth)).toBe(fast.total);
  });

  it('counts a step onto hills as two movement points', () => {
    const [flat, hill] = findPair(
      map,
      (x, y) =>
        map.owner[x] === JIA && map.owner[y] === JIA && isPlainGround(map, x) &&
        topo.moveCost[y] === 2 && topo.enterable[y] === 1 && map.riverEdges[y] === 0 && topo.siteZone[y] === -1,
    );
    const beyond = around(map, hill).find(
      (hex) => hex !== flat && distance(hex, flat) === 2 && topo.enterable[hex] === 1 && topo.water[hex] === 0 && map.owner[hex] === JIA,
    )!;
    const { state, id } = withUnit('warrior', flat);
    const path = findPath(state, id, hill)!;
    expect(path).toEqual({ hexes: [hill], turns: [1], total: 1 });
    // the hill used both points, so anything two hexes away through it waits for the next turn
    const far = findPath(state, id, beyond)!;
    expect(far.hexes).toHaveLength(2);
    if (far.hexes[0] === hill) expect(far.turns).toEqual([1, 2]);
    expect(walk(state, id, beyond)).toBe(far.total);
  });

  it('ends the turn at a river crossing', () => {
    const river = (a: number, b: number): boolean => {
      for (let d = 0; d < 6; d++) {
        if (topo.neighbors[a * 6 + d] === b) return ((map.riverEdges[a] as number) & (1 << d)) !== 0;
      }
      return false;
    };
    const land = (hex: number): boolean => topo.enterable[hex] === 1 && topo.water[hex] === 0 && topo.siteZone[hex] === -1;
    const [near, far] = findPair(map, (x, y) => land(x) && land(y) && river(x, y) && map.owner[x] === map.owner[y] && (map.owner[x] as number) >= 0);
    const owner = map.owner[near] as number;
    let id = 0;
    const state = edit(createGame(map, { player: map.polities[owner]!.id }), (draft) => {
      draft.units = draft.units.filter((unit) => unit.owner !== owner);
      id = put(draft, 'chariot', owner, near).id;
    });
    const path = findPath(state, id, far)!;
    expect(path.total).toBeGreaterThanOrEqual(1);
    const crossed = apply(state, { type: 'move', polity: owner, unit: id, to: far });
    expect(crossed.units.find((unit) => unit.id === id)!.moves).toBe(0);
    // the planner knows it: nothing lies within this turn's reach beyond the river
    for (const hex of reachableHexes(state, id)) {
      const route = findPath(state, id, hex)!;
      const index = route.hexes.indexOf(far);
      if (index >= 0 && route.hexes[index - 1] === near) expect(route.hexes.at(-1)).toBe(far);
      else if (index === 0) expect(route.hexes).toEqual([far]);
    }
  });

  it('starts on the next turn when the unit has no movement left', () => {
    const [a, b] = findPair(map, (x, y) => map.owner[x] === JIA && map.owner[y] === JIA && isPlainGround(map, x) && isPlainGround(map, y));
    const { state, id } = withUnit('warrior', a, 0);
    expect(findPath(state, id, b)).toEqual({ hexes: [b], turns: [2], total: 2 });
    expect(stepsThisTurn(state, id, b)).toEqual([]);
    expect(reachableHexes(state, id)).toEqual([]);
  });

  it('finds no way onto a mountain, into closed borders or onto an occupied hex', () => {
    const { state, id } = withUnit('warrior', jiaCapital);
    const mountain = map.terrain.findIndex((terrain) => terrain === Terrain.Mountain);
    expect(mountain).toBeGreaterThanOrEqual(0);
    expect(findPath(state, id, mountain)).toBeNull();
    // Yi is at peace with Jia: its land is closed, its capital too
    const yiLand = topo.zoneHexes[map.polities[YI]!.capitalZone]!.find((hex) => isPlainGround(map, hex))!;
    expect(findPath(state, id, yiLand)).toBeNull();
    expect(findPath(state, id, yiCapital)).toBeNull();
    expect(findPath(state, id, -1)).toBeNull();
    expect(findPath(state, 987654, jiaSouth)).toBeNull();
  });

  it('crosses the border of a nation it is at war with, and stops next to the target when asked', () => {
    const peace = withUnit('warrior', jiaCapital);
    const war = apply(peace.state, { type: 'declareWar', polity: JIA, target: YI });
    const yiLand = topo.zoneHexes[map.polities[YI]!.capitalZone]!.find((hex) => isPlainGround(map, hex))!;
    const path = findPath(war, peace.id, yiLand)!;
    expect(path.hexes.at(-1)).toBe(yiLand);
    // the capital itself cannot be entered, but it can be approached
    expect(findPath(war, peace.id, yiCapital)).toBeNull();
    const approach = findPath(war, peace.id, yiCapital, 1)!;
    expect(distance(approach.hexes.at(-1)!, yiCapital)).toBe(1);
  });
});

describe('reachableHexes', () => {
  it('is exactly the set of hexes whose path takes one turn', () => {
    const { state, id } = withUnit('warrior', jiaCapital);
    const reach = reachableHexes(state, id);
    expect(reach.length).toBeGreaterThan(0);
    expect(reach).not.toContain(jiaCapital);
    for (const hex of reach) expect(findPath(state, id, hex)!.total).toBe(1);
    for (const hex of around(map, jiaCapital)) {
      const path = findPath(state, id, hex);
      expect(reach.includes(hex)).toBe(path !== null && path.total === 1);
    }
    for (const hex of reach) expect(distance(hex, jiaCapital)).toBeLessThanOrEqual(2);
  });
});

describe('previewAttack', () => {
  it('gives the expected loss on both sides of a melee, and none to a ranged attacker', () => {
    const [a, b] = findPair(map, (x, y) => map.owner[x] === JIA && map.owner[y] === JIA && isPlainGround(map, x) && isPlainGround(map, y));
    let melee = 0;
    let ranged = 0;
    const other = around(map, b).find((hex) => hex !== a && isPlainGround(map, hex) && distance(hex, b) === 1)!;
    const state = apply(
      edit(createGame(map, { player: 'jia' }), (draft) => {
        melee = put(draft, 'warrior', JIA, a).id;
        ranged = put(draft, 'archer', JIA, other).id;
        put(draft, 'warrior', YI, b);
      }),
      { type: 'declareWar', polity: JIA, target: YI },
    );
    // equal strengths on open ground: the base damage both ways
    expect(previewAttack(state, melee, b)).toEqual({ toDefender: 30, toAttacker: 30, capture: false });
    const shot = previewAttack(state, ranged, b)!;
    expect(shot.toAttacker).toBe(0);
    expect(shot.toDefender).toBeGreaterThan(0);
    // the real fight stays within the random spread of the preview
    const result = applyAction(state, { type: 'attack', polity: JIA, unit: melee, target: b });
    if (!result.ok) throw new Error(result.reason);
    const combat = result.events.find((event) => event.type === 'combat');
    if (combat?.type !== 'combat') throw new Error('no combat event');
    expect(Math.abs(combat.damageToDefender - 30)).toBeLessThanOrEqual(7);
    expect(Math.abs(combat.damageToAttacker - 30)).toBeLessThanOrEqual(7);
  });

  it('is null without an enemy on the hex, and announces a capture', () => {
    const neighbour = around(map, yiCapital).find((hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0)!;
    let id = 0;
    const peace = edit(createGame(map, { player: 'jia' }), (draft) => {
      id = put(draft, 'warrior', JIA, neighbour).id;
    });
    expect(previewAttack(peace, id, yiCapital)).toBeNull();
    expect(previewAttack(peace, id, neighbour)).toBeNull();
    const war = apply(peace, { type: 'declareWar', polity: JIA, target: YI });
    const siege = previewAttack(war, id, yiCapital)!;
    expect(siege.capture).toBe(false);
    expect(siege.toDefender).toBeGreaterThan(0);
    expect(siege.toAttacker).toBeGreaterThan(0);
    const fallen = edit(war, (draft) => {
      draft.cities[map.polities[YI]!.capitalZone]!.hp = 0;
    });
    expect(previewAttack(fallen, id, yiCapital)).toEqual({ toDefender: 0, toAttacker: 0, capture: true });
  });
});
