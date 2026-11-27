import { describe, expect, it } from 'vitest';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { NO_ZONE, OWNER_SEA, Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { overseas, seaNeighbours } from './ai.ts';
import { cityStrength, militaryStrength } from './combat.ts';
import { cloneState, createCtx } from './context.ts';
import { AI, UNITS } from './data.ts';
import { createGame, endTurn, hashState, loadGame, saveGame } from './game.ts';
import type { GameEvent, GameState } from './game.ts';
import { labMap } from './kitLab.ts';
import type { Lab } from './kitLab.ts';
import { KITS, PERSONALITIES } from './kits.ts';
import { suggestResearch } from './tech.ts';
import { edit, learn, put, withCity } from './testUtil.ts';
import { topologyOf } from './topology.ts';

/** Gives the lab's nations the ids, and so the kits, of real ones. */
function named(ids: readonly (string | null)[], tweak?: (m: Lab) => void): MapData {
  return labMap(null, (m) => {
    ids.forEach((id, index) => {
      if (id !== null) (m.polities[index] as { id: string }).id = id;
    });
    tweak?.(m);
  });
}

function play(state: GameState, turns: number): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < turns && current.result === null; i++) {
    const step = endTurn(current);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}

describe('personalities', () => {
  it('bend what a nation researches first', () => {
    const first = (nation: string | null): string | null => {
      const map = labMap(nation);
      const id = map.polities[0]!.id;
      return suggestResearch(createCtx(cloneState(createGame(map, { majors: [id] }))), 0);
    };
    expect(KITS.qin!.personality).toBe('warlike');
    expect(KITS.wu!.personality).toBe('seafaring');
    // No style: an economy tech. A warlike leader: a military one. A seafaring one: boats.
    expect(first(null)).toBe('farming');
    expect(first('qin')).toBe('archery');
    expect(first('wu')).toBe('boats');
  });

  it('bend what a city builds first', () => {
    // With walls and a temple open and nothing else to do, the common order takes walls;
    // a diplomatic leader's cities build the temple first.
    const queued = (nation: string | null): unknown => {
      const map = labMap(nation);
      const start = learn(createGame(map, { majors: [] }), 0, ['fortification', 'ritual']);
      return endTurn(start).state.cities[map.polities[0]!.capitalZone]!.queue[0];
    };
    expect(KITS.jin!.personality).toBe('diplomatic');
    expect(PERSONALITIES.diplomatic.buildFirst).toEqual(['temple']);
    expect(queued(null)).toEqual({ kind: 'building', building: 'walls' });
    expect(queued('jin')).toEqual({ kind: 'building', building: 'temple' });
  });

  it('bend when a nation goes to war', () => {
    // An army between the strength a warlike leader and the strength any leader asks for.
    const declares = (nation: string | null): boolean => {
      const map = labMap(nation);
      const id = map.polities[0]!.id;
      const topo = topologyOf(map);
      const home = topo.zoneHexes[map.polities[0]!.capitalZone]!.filter(
        (hex) => topo.water[hex] !== 1 && topo.siteZone[hex] === -1,
      );
      let state = edit(createGame(map, { majors: [id], seed: 3 }), (draft) => {
        draft.turn = AI.firstWarTurn + 1;
        for (let i = 0; i < 5; i++) put(draft, 'warrior', 0, home[i]!);
      });
      // The weakest neighbour as the AI sees it: one garrison and half its city.
      const ctx = createCtx(cloneState(state));
      const defence = militaryStrength(ctx, 1) + cityStrength(ctx, ctx.state.cities[map.polities[1]!.capitalZone]!) / 2;
      const wanted = defence * AI.warStrengthRatio * 0.9;
      state = edit(state, (draft) => {
        const own = draft.units.filter((unit) => unit.owner === 0);
        for (const unit of own) unit.hp = Math.round((wanted / own.length / UNITS[unit.type]!.strength) * 100);
      });
      return endTurn(state).events.some((event) => event.type === 'warDeclared' && event.by === 0);
    };
    expect(PERSONALITIES.warlike.warRatio).toBeLessThan(0.9);
    expect(declares(null)).toBe(false);
    expect(declares('qin')).toBe(true);
  });

  it('leave a polity without a kit with the plain weights', () => {
    expect(PERSONALITIES.balanced).toEqual({
      warRatio: 1, armyShare: 1, navy: 1, buildFirst: [], research: {}, policy: {},
      routeForeign: 0, routeSea: 0, favour: 0, settleRange: 0, settleFirst: false,
    });
  });
});

/**
 * Polity 3's capital on an island of its own: its site, two hexes of land
 * beside it, and four hexes of water all round, as far as the second city
 * site of polity 2 on the shore opposite.
 */
function island(m: Lab): void {
  const width = 28;
  const site = { col: 16, row: 12 };
  const keep = new Set([12 * width + 15, 12 * width + 17]);
  for (let hex = 0; hex < m.terrain.length; hex++) {
    const distance = hexDistance(indexToOffset(hex, width), site);
    if (distance === 0 || distance > 4 || keep.has(hex)) continue;
    m.terrain[hex] = Terrain.Coast;
    m.owner[hex] = OWNER_SEA;
    m.zone[hex] = NO_ZONE;
  }
}

describe('a war across the water', () => {
  const map = named([null, null, 'shepo', 'ryukyu'], island);
  const topo = topologyOf(map);
  const ATTACKER = 2;
  const DEFENDER = 3;
  const target = map.polities[DEFENDER]!.capitalZone;
  const site = map.zones[target]!.siteHex;
  const SECOND = map.zones.findIndex((zone, index) => zone.polity === ATTACKER && index !== map.polities[ATTACKER]!.capitalZone);

  it('knows the island for a neighbour by sea that only ships can reach', () => {
    const ctx = createCtx(cloneState(withCity(createGame(map, { majors: ['shepo'] }), SECOND, ATTACKER)));
    expect(topo.landmass[site]).not.toBe(topo.mainland);
    expect(topo.coastal[target]).toBe(true);
    const cities = ctx.state.cities.filter((city) => city !== null && city.owner === ATTACKER);
    expect(overseas(ctx, target, cities as never)).toBe(true);
    // The attacker's second city looks across the strait; its capital is inland.
    expect(topo.coastal[SECOND]).toBe(true);
    expect(topo.coastal[map.polities[ATTACKER]!.capitalZone]).toBe(false);
    expect(seaNeighbours(ctx, SECOND, false)).toContain(target);
    expect(seaNeighbours(ctx, target, false)).toContain(SECOND);
  });

  it('ends with the army landing and the coastal city taken: a sea invasion', () => {
    // The attacker has a city on the coast opposite, knows Boats, and has an army and two galleys there.
    const camp = topo.zoneHexes[SECOND]!.filter((hex) => topo.water[hex] !== 1 && topo.siteZone[hex] === -1);
    const sea = topo.workHexes[SECOND]!.filter((hex) => topo.water[hex] === 1);
    expect(sea.length).toBeGreaterThanOrEqual(2);
    let state = withCity(createGame(map, { majors: ['shepo'], seed: 5 }), SECOND, ATTACKER);
    state = learn(learn(state, ATTACKER, ['boats']), DEFENDER, ['boats']);
    state = edit(state, (draft) => {
      draft.relations[`${ATTACKER}:${DEFENDER}`] = { a: ATTACKER, b: DEFENDER, atWar: true, since: 1, offerA: 0, offerB: 0 };
      for (let i = 0; i < 8; i++) put(draft, 'warrior', ATTACKER, camp[i]!);
      put(draft, 'galley', ATTACKER, sea[0]!);
      put(draft, 'galley', ATTACKER, sea[1]!);
    });
    const { state: after, events } = play(state, 40);
    const captured = events.find((event) => event.type === 'cityCaptured' && event.city === target);
    expect(captured).toMatchObject({ from: DEFENDER, to: ATTACKER });
    expect(after.stats.seaInvasions).toBeGreaterThanOrEqual(1);
    expect(after.stats.navalBattles).toBeGreaterThan(0);
    // The galleys fought: some fight had a ship on the attacking side.
    const ships = new Set(state.units.filter((unit) => UNITS[unit.type]!.domain === 'sea').map((unit) => unit.id));
    expect(events.some((event) => event.type === 'combat' && ships.has(event.unit))).toBe(true);
  }, 60_000);

  it('goes the other way too: the island nation lands on the mainland and takes a coastal city', () => {
    // The island has room for three units; the rest of its army starts afloat beside it.
    const shore = topo.zoneHexes[target]!.filter((hex) => topo.landmass[hex] === topo.landmass[site] && hex !== site);
    const afloat = topo.workHexes[target]!.filter((hex) => topo.water[hex] === 1);
    expect(shore).toHaveLength(2);
    expect(afloat.length).toBeGreaterThanOrEqual(6);
    let state = withCity(createGame(map, { majors: ['ryukyu'], seed: 5 }), SECOND, ATTACKER);
    state = learn(learn(state, ATTACKER, ['boats']), DEFENDER, ['boats']);
    state = edit(state, (draft) => {
      draft.relations[`${ATTACKER}:${DEFENDER}`] = { a: ATTACKER, b: DEFENDER, atWar: true, since: 1, offerA: 0, offerB: 0 };
      for (const hex of shore) put(draft, 'warrior', DEFENDER, hex);
      for (let i = 0; i < 6; i++) put(draft, 'warrior', DEFENDER, afloat[i]!);
    });
    const { state: after, events } = play(state, 40);
    const captured = events.find((event) => event.type === 'cityCaptured' && event.city === SECOND);
    expect(captured).toMatchObject({ from: ATTACKER, to: DEFENDER });
    expect(after.stats.seaInvasions).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('has coastal nations keep warships, and inland ones none', () => {
    // Every nation knows Boats and nobody goes to war; after a while the ones whose capital
    // is on the coast have a ship, and a nation without a coastal city has none.
    const all = named(['qin', 'wu', 'shepo', 'ryukyu'], island);
    const start = learn(createGame(all, { majors: [], seed: 2 }), 'all', ['boats']);
    const { state } = play(start, 40);
    const fleet = (polity: number): number =>
      state.units.filter((unit) => unit.owner === polity && UNITS[unit.type]!.domain === 'sea').length;
    const allTopo = topologyOf(all);
    const coastalCity = (polity: number): boolean =>
      state.cities.some((city) => city !== null && city.owner === polity && allTopo.coastal[city.zone] === true);
    let withCoast = 0;
    for (let polity = 0; polity < 4; polity++) {
      if (allTopo.coastal[all.polities[polity]!.capitalZone] === true) {
        withCoast++;
        expect(fleet(polity), `polity ${polity}`).toBeGreaterThan(0);
      } else if (!coastalCity(polity)) {
        expect(fleet(polity), `polity ${polity}`).toBe(0);
      }
    }
    expect(withCoast).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

describe('games with kits', () => {
  const map = named(['qin', 'wu', 'shepo', 'ryukyu'], island);

  it('are deterministic: the same seed gives the same game', () => {
    const run = (seed: number): string => hashState(play(createGame(map, { seed }), 60).state);
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  }, 60_000);

  it('survive a save and a load', () => {
    const { state } = play(createGame(map, { seed: 7 }), 30);
    const loaded = loadGame(saveGame(state), map);
    expect(hashState(loaded)).toBe(hashState(state));
    expect(hashState(play(loaded, 5).state)).toBe(hashState(play(state, 5).state));
    expect(state.stats).toHaveProperty('seaInvasions');
    expect(state.polities[0]).toHaveProperty('cityLostOn');
  }, 60_000);
});
