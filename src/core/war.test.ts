/** The wars the AI starts and gives up (issue #38, item 11), and its air strikes (item 13). */

import { describe, expect, it } from 'vitest';
import { islandPower, warReach } from './ai.ts';
import { cityStrength, militaryStrength } from './combat.ts';
import { cloneState, createCtx } from './context.ts';
import { AI, WAR } from './data.ts';
import { createGame, endTurn } from './game.ts';
import type { City, GameEvent, GameState } from './game.ts';
import { WATER, WATER2, labMap } from './kitLab.ts';
import { edit, learn, put, withCity } from './testUtil.ts';
import { topologyOf } from './topology.ts';

// The lab map: the fixture map with a strait between Jia and Bing.
const map = labMap(null);
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const HOME = map.polities[JIA]!.capitalZone;
/** Free land of Jia's home zone, away from the site. */
const camp = topo.zoneHexes[HOME]!.filter((hex) => topo.water[hex] !== 1 && topo.siteZone[hex] === -1);
const declared = (events: GameEvent[]): number[] =>
  events.flatMap((event) => (event.type === 'warDeclared' && event.by === JIA ? [event.on] : []));
const reachOf = (state: GameState, foe: number): 'land' | 'sea' | null => warReach(createCtx(cloneState(state)), JIA, foe);

/**
 * Jia, the only major nation, with eight warriors on turn 13: far more than
 * any neighbour's garrison and half its city. Only its capital is founded:
 * its one neighbour is Bing, across the water.
 */
const strong = edit(createGame(map, { majors: ['jia'], seed: 3 }), (draft) => {
  draft.turn = AI.firstWarTurn + 1;
  for (let i = 0; i < 7; i++) put(draft, 'warrior', JIA, camp[i]!);
});
/** The same with a city on every site of Jia: Yi is then its neighbour by land. */
const settled = map.zones.reduce((state, zone, index) => (zone.polity === JIA && state.cities[index] === null ? withCity(state, index, JIA) : state), strong);

describe('the reach of an army', () => {
  it('is by land where a path leads to a city of the other without crossing water', () => {
    expect(reachOf(strong, YI)).toBe('land');
    expect(reachOf(settled, YI)).toBe('land');
  });

  it('is by sea once the nation can embark, and nothing before', () => {
    expect(reachOf(strong, BING)).toBeNull();
    expect(reachOf(learn(strong, JIA, ['boats']), BING)).toBe('sea');
    // Its own strength does not enter into it.
    expect(reachOf(edit(strong, (draft) => void (draft.units = draft.units.filter((unit) => unit.owner !== JIA))), BING)).toBeNull();
  });

  it('counts only the cities it knows of, within the set distance', () => {
    expect(AI.warReachLand).toBeLessThan(AI.warReachSea);
    const ctx = createCtx(cloneState(strong));
    // Nothing is in reach of a nation without a city.
    for (const city of ctx.state.cities) if (city !== null && city.owner === JIA) ctx.state.cities[city.zone] = null;
    expect(warReach(ctx, JIA, YI)).toBeNull();
  });

  it('tells a nation alone on its shores from one with neighbours by land', () => {
    const ctx = createCtx(cloneState(strong));
    const own = ctx.state.cities.filter((city): city is City => city !== null && city.owner === JIA);
    // Yi stands on the same land as Jia.
    expect(islandPower(ctx, JIA, own)).toBe(false);
    for (const city of ctx.state.cities) {
      if (city !== null && city.owner !== JIA && topo.landmass[map.zones[city.zone]!.siteHex] === topo.landmass[map.zones[HOME]!.siteHex]) {
        ctx.state.cities[city.zone] = null;
      }
    }
    expect(islandPower(ctx, JIA, own)).toBe(true);
  });
});

describe('the wars the AI starts', () => {
  it('are on a neighbour it can march to', () => {
    // Strong as it is, it does not declare war on Bing, which it cannot get to: it has no boats.
    const ctx = createCtx(cloneState(strong));
    const defence = militaryStrength(ctx, BING) + cityStrength(ctx, ctx.state.cities[map.polities[BING]!.capitalZone]!) / 2;
    expect(militaryStrength(ctx, JIA)).toBeGreaterThan(defence * AI.warStrengthRatio * AI.seaWarRatio);
    expect(declared(endTurn(strong).events)).toEqual([]);
    // With Yi as a neighbour by land, it goes to war with Yi.
    expect(declared(endTurn(settled).events)).toEqual([YI]);
  });

  /** Jia can embark, and Yi, its neighbour by land, is its friend: what is left to attack lies across the water. */
  const sailing = edit(learn(strong, JIA, ['boats']), (draft) => void (draft.favour[`${JIA}:${YI}`] = AI.allianceFavour));

  it('cross the sea only with the ships to carry and escort the army', () => {
    expect(reachOf(sailing, BING)).toBe('sea');
    expect(AI.seaWarShips).toBe(2);
    expect(declared(endTurn(sailing).events)).toEqual([]);
    const oneShip = edit(sailing, (draft) => void put(draft, 'galley', JIA, WATER));
    expect(declared(endTurn(oneShip).events)).toEqual([]);
    const fleet = edit(oneShip, (draft) => void put(draft, 'galley', JIA, WATER2));
    const wars = declared(endTurn(fleet).events);
    expect(wars).toHaveLength(1);
    expect(reachOf(fleet, wars[0]!)).toBe('sea');
  });

  it('by sea need twice the strength a war by land needs', () => {
    expect(AI.seaWarRatio).toBe(2);
    // An army that would do for a war by land, with the fleet: too weak for a landing.
    const weak = edit(sailing, (draft) => {
      put(draft, 'galley', JIA, WATER, { hp: 1 });
      put(draft, 'galley', JIA, WATER2, { hp: 1 });
      for (const unit of draft.units) if (unit.owner === JIA && unit.type === 'warrior') unit.hp = 40;
    });
    const ctx = createCtx(cloneState(weak));
    const needed = (militaryStrength(ctx, BING) + cityStrength(ctx, ctx.state.cities[map.polities[BING]!.capitalZone]!) / 2) * AI.warStrengthRatio;
    expect(militaryStrength(ctx, JIA)).toBeGreaterThan(needed);
    expect(militaryStrength(ctx, JIA)).toBeLessThan(needed * AI.seaWarRatio);
    expect(declared(endTurn(weak).events)).toEqual([]);
  });
});

describe('a war in which nothing is taken', () => {
  /** Jia has been at war with Yi since turn `since`; no city has fallen. It is turn 40. */
  // (Turn 40 is late enough for a war of `AI.stalemateTurns` turns.)
  const fighting = (since: number): GameState =>
    edit(strong, (draft) => {
      draft.turn = 40;
      draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since, offerA: 0, offerB: 0 };
      // The army stays at home, so that the turn itself changes nothing.
      for (const unit of draft.units) if (unit.owner === JIA) unit.moves = 0;
    });
  const peace = (events: GameEvent[]): boolean => events.some((event) => event.type === 'peaceMade');

  it('is given up after a set time', () => {
    expect(AI.stalemateTurns).toBe(24);
    expect(AI.stalemateTurns).toBeGreaterThan(WAR.minTurns);
    expect(peace(endTurn(fighting(40 - AI.stalemateTurns + 1)).events)).toBe(false);
    expect(peace(endTurn(fighting(40 - AI.stalemateTurns)).events)).toBe(true);
  });

  it('is not given up while the enemy keeps losing cities', () => {
    // Yi has just lost a city: Jia does not ask for peace. Yi does, and pays for it with its freedom.
    const winning = endTurn(edit(fighting(40 - AI.stalemateTurns), (draft) => void (draft.polities[YI]!.cityLostOn = 35)));
    expect(winning.events.some((event) => event.type === 'vassalized' && event.vassal === YI && event.overlord === JIA)).toBe(true);
    // In the stalemate nobody submitted: it was a plain peace.
    expect(endTurn(fighting(40 - AI.stalemateTurns)).events.some((event) => event.type === 'vassalized')).toBe(false);
  });
});
