import { describe, expect, it } from 'vitest';
import { encodeHexSet } from '../core/fog.ts';
import { createGame, hexOwner, rememberedBy, visibleTo } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { edit, put, withCity } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { FogState, Improvement } from '../render/scene.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { decodeMemory, encodeMemory, remember, sceneOf, startingMemory } from './board.ts';
import type { BoardView } from './board.ts';
import { sightOf } from './sight.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const yiSeat = map.polities[YI]!.capitalZone;
const start = createGame(map, { seed: 1, player: 'jia' });

/** The view of a player who looks at `state` for the first time. */
const viewOf = (state: GameState, memory = remember(null, state, sightOf(state)!)): BoardView => ({ sight: sightOf(state)!, memory });
const cityAt = (state: GameState, view: BoardView | null, zone: number) =>
  sceneOf(state, 'zh', view).cities.find((city) => city.hex === site(zone));
/** A free land hex of the fixture, outside the player's land, that the player does not see at the start. */
const unseenHex = (state: GameState, avoid: readonly number[] = []): number => {
  const visible = visibleTo(state, JIA);
  const hex = visible.findIndex(
    (flag, index) =>
      flag === 0 && topo.enterable[index] === 1 && topo.water[index] === 0 && hexOwner(state, index) !== JIA &&
      !avoid.includes(index) && !state.units.some((unit) => unit.hex === index) && !map.zones.some((zone) => zone.siteHex === index),
  );
  expect(hex).toBeGreaterThanOrEqual(0);
  return hex;
};

describe('sceneOf under fog', () => {
  it('hands the renderer the fog: visible, remembered and unseen hexes', () => {
    const visible = visibleTo(start, JIA);
    const far = unseenHex(start);
    const state = edit(start, (draft) => {
      const seen = rememberedBy(start, JIA);
      seen[far] = 1;
      draft.explored[JIA] = encodeHexSet(seen);
    });
    const { fog } = sceneOf(state, 'zh', viewOf(state));
    expect(fog).not.toBeNull();
    expect(fog).toHaveLength(map.width * map.height);
    const other = unseenHex(start, [far]);
    expect(fog![site(map.polities[JIA]!.capitalZone)]).toBe(FogState.Visible);
    expect(fog![far]).toBe(FogState.Remembered);
    expect(fog![other]).toBe(FogState.Unseen);
    visible.forEach((flag, hex) => {
      expect(fog![hex] === FogState.Visible, `hex ${hex}`).toBe(flag === 1);
    });
    // nothing is hidden from the observer
    const watched = createGame(map, { seed: 1 });
    expect(sightOf(watched)).toBeNull();
    expect(sceneOf(watched, 'zh').fog).toBeNull();
    expect(sceneOf(watched, 'zh').units).toHaveLength(watched.units.length);
  });

  it('leaves out foreign units on hexes the player does not see', () => {
    const visible = visibleTo(start, JIA);
    const near = visible.findIndex(
      (flag, hex) => flag === 1 && topo.enterable[hex] === 1 && topo.water[hex] === 0 && !start.units.some((unit) => unit.hex === hex),
    );
    const far = unseenHex(start);
    let shown = 0;
    let hidden = 0;
    const state = edit(start, (draft) => {
      shown = put(draft, 'warrior', YI, near).id;
      hidden = put(draft, 'warrior', YI, far).id;
    });
    const scene = sceneOf(state, 'zh', viewOf(state));
    const ids = scene.units.map((unit) => unit.id);
    expect(ids).toContain(shown);
    expect(ids).not.toContain(hidden);
    for (const unit of state.units) {
      expect(ids.includes(unit.id), `unit ${unit.id}`).toBe(unit.owner === JIA || visible[unit.hex] === 1);
    }
    expect(scene.units.length).toBeLessThan(state.units.length);
    // the observer's board has them all
    expect(sceneOf(state, 'zh').units).toHaveLength(state.units.length);
  });

  it('draws a foreign city out of sight as it was last seen, not as it is', () => {
    expect(visibleTo(start, JIA)[site(yiSeat)]).toBe(0);
    // a starting capital is known from the first turn, as it then is
    expect(cityAt(start, viewOf(start), yiSeat)).toMatchObject({ polity: YI, population: 1, walls: false, buildings: 0 });

    // it grows and falls out of sight: the board still shows what the player knows
    const changed = edit(start, (draft) => {
      const city = draft.cities[yiSeat]!;
      city.pop = 9;
      city.owner = BING;
      city.buildings.push('walls');
    });
    const memory = remember(null, start, sightOf(start)!);
    expect(cityAt(changed, viewOf(changed, memory), yiSeat)).toMatchObject({ polity: YI, population: 1, walls: false, buildings: 0 });
    expect(cityAt(changed, null, yiSeat)).toMatchObject({ polity: BING, population: 9, walls: true, buildings: 1 });

    // a unit of the player comes within sight of it: the board shows it as it is, and remembers that
    const next = topo.neighbors[site(yiSeat) * 6] as number;
    const scouting = edit(changed, (draft) => {
      put(draft, 'warrior', JIA, next);
    });
    expect(sightOf(scouting)!.visible[site(yiSeat)]).toBe(1);
    const seen = remember(memory, scouting, sightOf(scouting)!);
    expect(cityAt(scouting, { sight: sightOf(scouting)!, memory: seen }, yiSeat)).toMatchObject({ polity: BING, population: 9, walls: true });

    // the scout leaves and the city changes again: it stays as last seen
    const later = edit(changed, (draft) => {
      const city = draft.cities[yiSeat]!;
      city.pop = 14;
      city.owner = YI;
    });
    expect(sightOf(later)!.visible[site(yiSeat)]).toBe(0);
    const after = remember(seen, later, sightOf(later)!);
    expect(cityAt(later, { sight: sightOf(later)!, memory: after }, yiSeat)).toMatchObject({ polity: BING, population: 9, walls: true });
  });

  it('does not draw a city on a site the player has never seen, and draws their own always', () => {
    const second = map.zones.findIndex((zone, index) => zone.polity === YI && index !== yiSeat);
    expect(second).toBeGreaterThanOrEqual(0);
    const state = withCity(start, second, YI);
    expect(visibleTo(state, JIA)[site(second)]).toBe(0);
    expect(cityAt(state, null, second)).toBeDefined();
    expect(cityAt(state, viewOf(state), second)).toBeUndefined();
    // a site seen empty stays empty in memory after a city was founded out of sight
    const next = topo.neighbors[site(second) * 6] as number;
    const scouting = edit(start, (draft) => {
      put(draft, 'warrior', JIA, next);
    });
    const memory = remember(null, scouting, sightOf(scouting)!);
    expect(memory.cities.get(second)).toBeNull();
    expect(cityAt(state, viewOf(state, remember(memory, state, sightOf(state)!)), second)).toBeUndefined();

    const own = cityAt(start, viewOf(start), map.polities[JIA]!.capitalZone);
    expect(own).toMatchObject({ polity: JIA, population: start.cities[map.polities[JIA]!.capitalZone]!.pop });
  });

  it('keeps improvements, roads and trade routes out of sight as the player knows them', () => {
    const far = unseenHex(start);
    const farther = unseenHex(start, [far]);
    const home = topo.zoneHexes[map.polities[JIA]!.capitalZone]!.find((hex) => hex !== site(map.polities[JIA]!.capitalZone))!;
    const state = edit(start, (draft) => {
      draft.improvements[far] = 'farm';
      draft.improvements[home] = 'mine';
      draft.roads[farther] = 1;
      draft.routes.push({
        id: 1, owner: YI, from: yiSeat, toCity: 0, toPort: -1, sea: false, path: [far, farther], income: 3, pillagedUntil: 0,
      });
      draft.routes.push({
        id: 2, owner: JIA, from: 0, toCity: yiSeat, toPort: -1, sea: false, path: [home, far], income: 3, pillagedUntil: 0,
      });
    });
    const scene = sceneOf(state, 'zh', viewOf(state));
    expect(scene.improvements.has(far)).toBe(false);
    expect(scene.improvements.get(home)).toBe(Improvement.Mine);
    expect(scene.roads.has(farther)).toBe(false);
    // the player's own route is whole; of somebody else's only what is in sight
    expect(scene.routes).toEqual([{ path: [home, far], polity: JIA, sea: false }]);
    const all = sceneOf(state, 'zh');
    expect(all.improvements.get(far)).toBe(Improvement.Farm);
    expect(all.roads.get(farther)).toBe(1);
    expect(all.routes).toHaveLength(2);

    // seen once, they stay on the board after the scout has left, even when they are gone
    const scouting = edit(state, (draft) => {
      put(draft, 'warrior', JIA, far);
    });
    const memory = remember(null, scouting, sightOf(scouting)!);
    expect(memory.improvements.get(far)).toBe(Improvement.Farm);
    const gone = edit(state, (draft) => {
      draft.improvements = { [home]: 'mine' };
    });
    expect(sceneOf(gone, 'zh', viewOf(gone, remember(memory, gone, sightOf(gone)!))).improvements.get(far)).toBe(Improvement.Farm);
  });
});

describe('the memory in storage', () => {
  it('comes back as it was written', () => {
    const state = edit(start, (draft) => {
      draft.improvements[site(map.polities[JIA]!.capitalZone) + 1] = 'farm';
      draft.roads[site(map.polities[JIA]!.capitalZone) + 1] = 2;
    });
    const memory = remember(null, state, sightOf(state)!);
    expect(memory.cities.size).toBeGreaterThan(0);
    const back = decodeMemory(JSON.parse(JSON.stringify(encodeMemory(memory))), map);
    expect(back).not.toBeNull();
    expect([...back!.cities]).toEqual([...memory.cities]);
    expect([...back!.improvements]).toEqual([...memory.improvements]);
    expect([...back!.roads]).toEqual([...memory.roads]);
  });

  it('is refused when it is not a memory of this map', () => {
    const good = encodeMemory(startingMemory(map)) as { cities: unknown[]; improvements: unknown[]; roads: unknown[] };
    expect(decodeMemory(good, map)).not.toBeNull();
    expect(decodeMemory(null, map)).toBeNull();
    expect(decodeMemory('memory', map)).toBeNull();
    expect(decodeMemory({ ...good, cities: 'all' }, map)).toBeNull();
    expect(decodeMemory({ ...good, cities: [[999, null]] }, map)).toBeNull();
    expect(decodeMemory({ ...good, cities: [[0, { owner: 99, population: 1, family: 0, era: 0, walls: false, buildings: 0 }]] }, map)).toBeNull();
    expect(decodeMemory({ ...good, cities: [[0, { owner: 0, population: 1, family: 0, era: 0, walls: 'no', buildings: 0 }]] }, map)).toBeNull();
    expect(decodeMemory({ ...good, improvements: [[0, 77]] }, map)).toBeNull();
    expect(decodeMemory({ ...good, roads: [[-1, 1]] }, map)).toBeNull();
    expect(decodeMemory({ ...good, roads: [[0, 3]] }, map)).toBeNull();
  });
});
