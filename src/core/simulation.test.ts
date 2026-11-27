import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { createSyntheticMap } from '../shared/syntheticMap.ts';
import { BORDER_OPENING } from './context.ts';
import { CITY, DIPLOMACY, TECHS, UNITS } from './data.ts';
import { NO_POLITY, createGame, endTurn, hexOwner } from './game.ts';
import type { Action, GameEvent, GameSetup, GameState } from './game.ts';
import { topologyOf } from './topology.ts';

/** Everything that must hold in any state of any game; returns the first violation. */
function violation(state: GameState): string | null {
  const { map } = state;
  const topo = topologyOf(map);
  const seen = new Set<number>();
  for (const unit of state.units) {
    if (seen.has(unit.hex)) return `two units on hex ${unit.hex}`;
    seen.add(unit.hex);
    if (topo.enterable[unit.hex] !== 1) return `unit ${unit.id} on a hex nobody can enter`;
    if (unit.hp < 1 || unit.hp > 100) return `unit ${unit.id} has ${unit.hp} HP`;
    const def = UNITS[unit.type]!;
    const afloat = topo.water[unit.hex] === 1;
    if (def.domain === 'sea' && !afloat) return `ship ${unit.id} on land`;
    const known = unit.owner === NO_POLITY ? [] : state.polities[unit.owner]!.techs;
    if (def.domain === 'land' && afloat && !known.includes('boats')) return `unit ${unit.id} afloat without Boats`;
    if (map.terrain[unit.hex] === Terrain.Ocean && !known.includes('compass')) return `unit ${unit.id} on the ocean without Compass`;
    if (def.tech !== null && !known.includes(def.tech)) return `unit ${unit.id} is a ${unit.type} without its tech`;
    if (unit.owner === NO_POLITY) continue;
    if (!state.polities[unit.owner]!.alive) return `unit ${unit.id} of a dead polity`;
    const owner = hexOwner(state, unit.hex);
    if (owner !== NO_POLITY && owner !== unit.owner) {
      const key = owner < unit.owner ? `${owner}:${unit.owner}` : `${unit.owner}:${owner}`;
      // Open borders, an alliance and a vassalage let each side's units into the other's land.
      const invited = state.agreements.some(
        (agreement) =>
          BORDER_OPENING.includes(agreement.kind) &&
          ((agreement.a === owner && agreement.b === unit.owner) || (agreement.a === unit.owner && agreement.b === owner)),
      );
      if (state.relations[key]?.atWar !== true && !invited) {
        return `unit ${unit.id} of ${unit.owner} inside ${owner} at peace and without open borders`;
      }
    }
    const city = topo.siteZone[unit.hex]! >= 0 ? state.cities[topo.siteZone[unit.hex]!] : null;
    if (city !== null && city !== undefined && city.owner !== unit.owner) return `unit ${unit.id} inside a foreign city`;
  }
  for (const city of state.cities) {
    if (city === null) continue;
    if (city.pop < 1 || city.pop > CITY.maxPop) return `city ${city.zone} has population ${city.pop}`;
    if (state.zoneOwner[city.zone] !== city.owner) return `city ${city.zone} and its zone disagree on the owner`;
    if (!state.polities[city.owner]!.alive) return `city ${city.zone} belongs to a dead polity`;
    if (city.worked.length > city.pop) return `city ${city.zone} works too many hexes`;
  }
  for (const polity of state.polities) {
    if (polity.gold < 0) return 'negative treasury';
    for (const tech of polity.techs) {
      if (TECHS[tech].era > polity.era) return `a polity knows ${tech} before its era`;
    }
  }
  // Diplomacy, trade and city-states.
  const alive = (polity: number): boolean => state.polities[polity]?.alive === true;
  const fighting = (a: number, b: number): boolean => state.relations[a < b ? `${a}:${b}` : `${b}:${a}`]?.atWar === true;
  for (const [index, polity] of state.polities.entries()) {
    if (polity.overlord !== NO_POLITY) {
      if (!polity.alive || !alive(polity.overlord)) return `vassal ${index} or its overlord is dead`;
      if (!state.agreements.some((a) => a.kind === 'vassalage' && a.a === polity.overlord && a.b === index)) {
        return `vassal ${index} without a vassalage`;
      }
      if (fighting(index, polity.overlord)) return `vassal ${index} at war with its overlord`;
    }
    if (polity.slots.filter((card) => card !== null).some((card) => !polity.policies.includes(card))) {
      return `polity ${index} has a card in a slot that it has not unlocked`;
    }
    if (polity.suzerain !== NO_POLITY && (!polity.alive || !alive(polity.suzerain) || polity.cityStateType === null)) {
      return `polity ${index} has a suzerain it cannot have`;
    }
    if (polity.suzerain !== NO_POLITY && fighting(index, polity.suzerain)) return `city-state ${index} at war with its suzerain`;
  }
  for (const agreement of state.agreements) {
    if (!alive(agreement.a) || !alive(agreement.b)) return `${agreement.kind} with a dead polity`;
    if (fighting(agreement.a, agreement.b)) return `${agreement.kind} between polities at war`;
    for (const side of [agreement.a, agreement.b]) {
      if (map.polities[side]!.kind !== 'nation') return `${agreement.kind} with a polity that is no nation`;
    }
  }
  for (const polity of state.polities.keys()) {
    const alliances = state.agreements.filter((a) => a.kind === 'alliance' && (a.a === polity || a.b === polity));
    if (alliances.length > DIPLOMACY.maxAlliances) return `polity ${polity} has too many alliances`;
  }
  for (const deal of state.deals) {
    if (!alive(deal.seller) || !alive(deal.buyer) || fighting(deal.seller, deal.buyer)) return `deal ${deal.id} cannot stand`;
  }
  for (const offer of state.offers) if (offer.to !== state.player) return `offer ${offer.id} to an AI`;
  for (const route of state.routes) {
    const from = state.cities[route.from];
    if (!alive(route.owner) || from === null || from === undefined || from.owner !== route.owner) {
      return `route ${route.id} does not start from a city of its owner`;
    }
    const to = route.toCity < 0 ? null : state.cities[route.toCity];
    if (to !== null && to !== undefined && fighting(route.owner, to.owner)) return `route ${route.id} to an enemy city`;
    if (route.path.some((hex) => (topo.water[hex] === 1) !== route.sea)) return `route ${route.id} leaves its element`;
  }
  for (const hex of Object.keys(state.roads)) {
    if (topo.water[Number(hex)] === 1 || topo.enterable[Number(hex)] !== 1) return `road on hex ${hex}`;
  }
  return null;
}

interface Played {
  state: GameState;
  events: GameEvent[];
  actions: number;
}

/** Plays a game, checking the invariants after every AI action and every turn. */
function playChecked(map: MapData, setup: GameSetup, turns: number): Played {
  let state = createGame(map, setup);
  expect(violation(state)).toBeNull();
  const events: GameEvent[] = [];
  let actions = 0;
  const onAction = (working: GameState, action: Action): void => {
    actions++;
    const problem = violation(working);
    if (problem !== null) throw new Error(`turn ${working.turn}, after ${JSON.stringify(action)}: ${problem}`);
  };
  for (let i = 0; i < turns && state.result === null; i++) {
    const result = endTurn(state, { onAction });
    state = result.state;
    events.push(...result.events);
    const problem = violation(state);
    if (problem !== null) throw new Error(`after turn ${i + 1}: ${problem}`);
  }
  return { state, events, actions };
}

describe('simulated games on the fixture', () => {
  const map = createFixtureMap();

  it.each([1, 2, 3])('keep one unit per hex and closed borders after every action (seed %i)', (seed) => {
    const { state, actions } = playChecked(map, { seed }, 150);
    expect(state.result).not.toBeNull();
    expect(actions).toBeGreaterThan(200);
  }, 60_000);

  // With a single major there is no Conquest to be had, so the game runs its full length.
  const long = playChecked(map, { seed: 2, majors: ['jia'] }, 150);

  it('run the full 150 turns and end with a result', () => {
    expect(long.state.turn).toBe(150);
    expect(long.state.result).toMatchObject({ kind: 'economic', winner: 0, turn: 150 });
  });

  it('have every nation found its other cities and develop them', () => {
    expect(long.events.filter((event) => event.type === 'cityFounded').length).toBeGreaterThanOrEqual(4);
    const cities = long.state.cities.filter((city) => city !== null);
    expect(cities.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...cities.map((city) => city.pop))).toBeGreaterThan(8);
    expect(Object.keys(long.state.improvements).length).toBeGreaterThan(10);
    expect(cities.every((city) => city.buildings.length > 0)).toBe(true);
  });

  it('have the major research through the eras, build what that unlocks and take the others along', () => {
    const jia = long.state.polities[0]!;
    expect(jia.techs.length).toBeGreaterThanOrEqual(24);
    expect(jia.era).toBeGreaterThanOrEqual(3);
    const eras = long.events.filter((event): event is Extract<GameEvent, { type: 'eraEntered' }> => event.type === 'eraEntered');
    expect(eras.filter((event) => event.polity === 0).map((event) => event.era)).toEqual(
      Array.from({ length: jia.era }, (_, i) => i + 1),
    );
    const built = new Set(long.state.cities.flatMap((city) => (city === null ? [] : city.buildings)));
    for (const building of ['academy', 'market', 'workshop', 'printShop', 'university', 'observatory', 'bank'] as const) {
      expect(built.has(building), building).toBe(true);
    }
    expect(new Set(Object.values(long.state.improvements)).has('irrigationCanal')).toBe(true);
    // The nations that do not research know what the only researching nation knows.
    const yi = long.state.polities[1]!;
    if (yi.alive) expect([...yi.techs].sort()).toEqual([...jia.techs].sort());
  });

  it('have only major nations declare war, and wars end in peace or conquest', () => {
    const wars = long.events.filter((event): event is Extract<GameEvent, { type: 'warDeclared' }> => event.type === 'warDeclared');
    expect(wars.length).toBeGreaterThan(0);
    expect(wars.every((event) => event.by === 0)).toBe(true);
    const ended = long.events.filter((event) => event.type === 'peaceMade' || event.type === 'polityAnnexed');
    expect(ended.length).toBeGreaterThan(0);
  });

  it('have a major keep an army its income pays for', () => {
    expect(long.state.units.filter((unit) => unit.owner === 0).length).toBeGreaterThan(4);
    expect(long.events.some((event) => event.type === 'unitUpgraded')).toBe(true);
  });

  it('keep the city-state to one garrison and its own zone, and the tribes where they were', () => {
    const start = createGame(map, { seed: 2, majors: ['jia'] });
    let state = start;
    for (let i = 0; i < 60; i++) {
      state = endTurn(state).state;
      if (state.polities[4]!.alive) {
        expect(state.units.filter((unit) => unit.owner === 4).length).toBeLessThanOrEqual(1);
        expect(state.zoneOwner.filter((owner) => owner === 4)).toHaveLength(1);
      }
    }
    const before = new Map(start.units.filter((unit) => unit.owner === NO_POLITY).map((unit) => [unit.id, unit.hex]));
    for (const tribe of state.units.filter((unit) => unit.owner === NO_POLITY)) {
      expect(tribe.hex).toBe(before.get(tribe.id));
    }
  });

  it('see cities change hands', () => {
    const captured = [1, 2, 3, 4, 5].map((seed) => playChecked(map, { seed }, 150).state.stats.citiesCaptured);
    expect(captured.filter((count) => count > 0).length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

describe('simulated game on the 160 x 110 synthetic map', () => {
  it('keeps the invariants with 64 polities, settles wasteland and fights wars', () => {
    const map = createSyntheticMap();
    expect(map.width * map.height).toBe(160 * 110);
    expect(map.polities).toHaveLength(64);
    const { state, events } = playChecked(map, { seed: 1 }, 70);
    expect(state.majors).toHaveLength(12);
    expect(state.turn).toBe(71);
    expect(events.some((event) => event.type === 'warDeclared')).toBe(true);
    expect(state.stats.citiesFounded).toBeGreaterThan(60);
    // Somebody settled wasteland.
    expect(state.cities.some((city) => city !== null && city.originalOwner === NO_POLITY)).toBe(true);
  }, 120_000);
});
