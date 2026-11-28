import { describe, expect, it } from 'vitest';
import { AIR_STRIKE } from '../core/data.ts';
import { encodeHexSet } from '../core/fog.ts';
import { applyAction, createGame, hashState, rememberedBy, visibleTo } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { airStrikeTargets, checkAction, hexDistance } from '../core/query.ts';
import { edit, put, withCity } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { FogState } from '../render/scene.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { findPath, previewAttack, reachableHexes } from './path.ts';
import { hiddenUnits, inSight, isHidden, knownState, sightOf, strikeTargets } from './sight.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const jiaZone = map.polities[JIA]!.capitalZone;
const jiaSeat = map.zones[jiaZone]!.siteHex;
const yiSeat = map.zones[map.polities[YI]!.capitalZone]!.siteHex;
const start = createGame(map, { seed: 1, player: 'jia' });

const atWar = (state: GameState): GameState =>
  edit(state, (draft) => {
    draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: draft.turn, offerA: 0, offerB: 0 };
  });

describe('sightOf', () => {
  it('is the rules’ sight of the player, and nothing for the observer', () => {
    const sight = sightOf(start)!;
    expect(sight.viewer).toBe(JIA);
    expect([...sight.visible]).toEqual([...visibleTo(start, JIA)]);
    expect(sight.fog[jiaSeat]).toBe(FogState.Visible);
    expect(sight.fog[yiSeat]).toBe(FogState.Unseen);
    expect(sightOf(start)).toBe(sight);
    expect(sightOf(createGame(map, { seed: 1 }))).toBeNull();
    expect(inSight(null, yiSeat)).toBe(true);
    expect(inSight(sight, yiSeat)).toBe(false);
    expect(inSight(sight, jiaSeat)).toBe(true);
  });
});

describe('knownState', () => {
  it('is the game without the units the fog hides, and the game itself for the observer', () => {
    const sight = sightOf(start)!;
    const known = knownState(start);
    const before = hashState(start);
    expect(known.units.length).toBeLessThan(start.units.length);
    expect(hiddenUnits(start)).toBe(start.units.length - known.units.length);
    for (const unit of start.units) {
      const kept = known.units.some((other) => other.id === unit.id);
      expect(kept, `unit ${unit.id}`).toBe(unit.owner === JIA || sight.visible[unit.hex] === 1);
      expect(isHidden(sight, unit)).toBe(!kept);
    }
    expect(hashState(start)).toBe(before);
    expect(knownState(start)).toBe(known);
    const watched = createGame(map, { seed: 1 });
    expect(knownState(watched)).toBe(watched);
    expect(hiddenUnits(watched)).toBe(0);
  });

  it('plans paths, reach and attacks as if a hidden unit were not there', () => {
    const base = atWar(start);
    const garrison = base.units.find((unit) => unit.owner === JIA)!;
    // a hex of the player's own land, one step out of everybody's sight
    const dark = topo.zoneHexes[jiaZone]!.find(
      (hex) => sightOf(base)!.visible[hex] === 0 && topo.enterable[hex] === 1 && topo.water[hex] === 0 && findPath(base, garrison.id, hex) !== null,
    )!;
    expect(dark).toBeGreaterThanOrEqual(0);
    const state = edit(base, (draft) => {
      put(draft, 'warrior', YI, dark);
    });
    const known = knownState(state);
    // the rules know of the unit: there is something to attack, and the hex is taken
    expect(previewAttack(state, garrison.id, dark)).not.toBeNull();
    expect(findPath(state, garrison.id, dark)).toBeNull();
    // the player does not
    expect(previewAttack(known, garrison.id, dark)).toBeNull();
    expect(findPath(known, garrison.id, dark)).toEqual(findPath(base, garrison.id, dark));
    expect(reachableHexes(known, garrison.id)).toEqual(reachableHexes(base, garrison.id));
  });
});

describe('strikeTargets', () => {
  // Jia has an airfield and is at war with Yi, whose capital is in reach of it
  const armed = edit(atWar(start), (draft) => {
    draft.cities[jiaZone]!.buildings.push('airfield');
  });
  const inReach = (hex: number): boolean => hexDistance(armed, jiaSeat, hex) <= AIR_STRIKE.range;
  const free = (state: GameState, visible: boolean): number =>
    sightOf(state)!.visible.findIndex(
      (flag, hex) =>
        (flag === 1) === visible && inReach(hex) && topo.enterable[hex] === 1 && topo.water[hex] === 0 &&
        hex !== jiaSeat && !state.units.some((unit) => unit.hex === hex) && !map.zones.some((zone) => zone.siteHex === hex),
    );

  it('offers the units in sight and none of those out of it', () => {
    const near = free(armed, true);
    const far = free(armed, false);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThanOrEqual(0);
    const state = edit(armed, (draft) => {
      put(draft, 'warrior', YI, near);
      put(draft, 'warrior', YI, far);
    });
    const targets = strikeTargets(state, jiaZone);
    expect(targets.hexes).toContain(near);
    expect(targets.hexes).not.toContain(far);
    for (const hex of targets.hexes) {
      expect(sightOf(state)!.visible[hex]).toBe(1);
      expect(checkAction(state, { type: 'airStrike', polity: JIA, city: jiaZone, target: hex })).toBeNull();
    }
    // what the rules refuse for the fog is refused as having no target
    expect(applyAction(state, { type: 'airStrike', polity: JIA, city: jiaZone, target: far })).toMatchObject({ ok: false, reason: 'noTarget' });
  });

  it('does not offer a city the rules know of but the player does not see, and says so', () => {
    // Yi holds a city on a site near Jia's capital that Jia has seen before and does not see now
    const zone = map.zones.findIndex((entry, index) => index !== jiaZone && inReach(entry.siteHex) && sightOf(armed)!.visible[entry.siteHex] === 0);
    expect(zone).toBeGreaterThanOrEqual(0);
    const site = map.zones[zone]!.siteHex;
    const state = edit(withCity(armed, zone, YI), (draft) => {
      const seen = rememberedBy(armed, JIA);
      seen[site] = 1;
      draft.explored[JIA] = encodeHexSet(seen);
    });
    expect(sightOf(state)!.fog[site]).toBe(FogState.Remembered);
    expect(airStrikeTargets(state, jiaZone)).toEqual([site]);
    expect(strikeTargets(state, jiaZone)).toEqual({ hexes: [], unseen: true });
    // with the city in sight it is offered
    const spotted = edit(state, (draft) => {
      put(draft, 'warrior', JIA, topo.neighbors[site * 6] as number);
    });
    expect(strikeTargets(spotted, jiaZone)).toEqual({ hexes: [site], unseen: false });
  });

  it('has nothing to say where there is nothing to strike', () => {
    const peaceful = edit(start, (draft) => {
      draft.cities[jiaZone]!.buildings.push('airfield');
    });
    expect(strikeTargets(peaceful, jiaZone)).toEqual({ hexes: [], unseen: false });
    // the observer is offered what the rules offer
    const watched = edit(createGame(map, { seed: 1 }), (draft) => {
      draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 1, offerA: 0, offerB: 0 };
      draft.cities[jiaZone]!.buildings.push('airfield');
    });
    expect(strikeTargets(watched, jiaZone).hexes).toEqual(airStrikeTargets(watched, jiaZone));
    expect(strikeTargets(watched, jiaZone).unseen).toBe(false);
  });
});
