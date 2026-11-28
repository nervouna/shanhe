import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { Terrain } from '../shared/mapData.ts';
import { createSyntheticMap } from '../shared/syntheticMap.ts';
import { ERAS, UNITS, conquestTarget, eraOfTurn } from './data.ts';
import {
  NO_POLITY,
  advanceTurn,
  applyAction,
  createGame,
  currentEra,
  endTurn,
  getLegalActions,
  hashState,
  hexOwner,
  loadGame,
  saveGame,
} from './game.ts';
import type { Action, GameState } from './game.ts';
import { apply, around, edit, findPair, isPlainGround, learn, put } from './testUtil.ts';

const map = createFixtureMap();
const JIA = 0;
const YI = 1;
const BING = 2;
const WUCHENG = 4;
const WASTELAND = 5;
const site = (zone: number): number => map.zones[zone]!.siteHex;

function play(state: GameState, turns: number): GameState {
  let current = state;
  for (let i = 0; i < turns && current.result === null; i++) current = endTurn(current).state;
  return current;
}

function playOut(state: GameState): GameState {
  return play(state, Infinity);
}

describe('game state', () => {
  it('starts at turn 1 on the given map', () => {
    const state = createGame(map);
    expect(state.turn).toBe(1);
    expect(state.map).toBe(map);
    expect(state.result).toBeNull();
  });

  it('advances the turn counter by one without changing the previous state', () => {
    const first = createGame(createFixtureMap());
    const before = saveGame(first);
    const second = advanceTurn(first);
    expect(second.turn).toBe(2);
    expect(first.turn).toBe(1);
    expect(saveGame(first)).toBe(before);
    expect(second.map).toBe(first.map);

    let state = first;
    for (let i = 0; i < 10; i++) state = advanceTurn(state);
    expect(state.turn).toBe(11);
  });

  it('starts every nation and city-state with a capital and a garrison, and wasteland with tribes', () => {
    const state = createGame(map, { seed: 7 });
    map.polities.forEach((polity, index) => {
      const cities = state.cities.filter((city) => city !== null && city.owner === index);
      if (polity.kind === 'wastelandRegion') {
        expect(cities).toHaveLength(0);
        expect(state.polities[index]!.alive).toBe(false);
        return;
      }
      expect(cities).toHaveLength(1);
      expect(cities[0]!.zone).toBe(polity.capitalZone);
      expect(state.polities[index]!.capital).toBe(polity.capitalZone);
      const garrison = state.units.filter((unit) => unit.owner === index);
      expect(garrison).toHaveLength(1);
      expect(garrison[0]!.hex).toBe(site(polity.capitalZone));
    });
    expect(state.cities[map.polities[WUCHENG]!.capitalZone]!.buildings).toContain('walls');
    expect(state.cities[map.polities[JIA]!.capitalZone]!.buildings).toHaveLength(0);

    const tribes = state.units.filter((unit) => unit.owner === NO_POLITY);
    expect(tribes.length).toBeGreaterThan(0);
    for (const tribe of tribes) {
      expect(map.zones[map.zone[tribe.hex]!]!.polity).toBe(WASTELAND);
      expect(tribe.hex).not.toBe(site(map.zone[tribe.hex]!));
    }
    // Wasteland belongs to nobody until it is settled.
    expect(hexOwner(state, site(9))).toBe(NO_POLITY);
    expect(hexOwner(state, site(0))).toBe(JIA);
  });

  it('takes the player and the majors from the setup', () => {
    const state = createGame(map, { player: 'bing', majors: ['yi', 'jia'] });
    expect(state.player).toBe(BING);
    expect(state.majors).toEqual([JIA, YI]);
    expect(createGame(map).player).toBe(NO_POLITY);
    // None of doc 02's default majors is on the fixture: its nations stand in.
    expect(createGame(map).majors).toEqual([0, 1, 2, 3]);
    expect(() => createGame(map, { player: 'nobody' })).toThrow();
    expect(() => createGame(map, { majors: ['wucheng'] })).toThrow();
  });

  it('leaves the player polity alone when the turn ends', () => {
    let state = createGame(map, { seed: 1, player: 'jia' });
    const built = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const result = endTurn(state);
      state = result.state;
      for (const event of result.events) if (event.type === 'cityBuilt') built.add(event.city);
    }
    expect(built.has(3)).toBe(true);
    expect(built.has(0)).toBe(false);
    expect(state.cities[0]!.queue).toHaveLength(0);
    expect(state.units.filter((unit) => unit.owner === JIA)).toHaveLength(1);
  });
});

describe('eras', () => {
  it('are paced at 25 turns each, but follow research and not the turn', () => {
    expect(ERAS).toHaveLength(6);
    expect(eraOfTurn(1)).toBe(0);
    expect(eraOfTurn(25)).toBe(0);
    expect(eraOfTurn(26)).toBe(1);
    expect(eraOfTurn(150)).toBe(5);
    // Nobody researches here, so the turns pass and the era stays.
    expect(currentEra(play(createGame(map, { majors: [] }), 25))).toBe(0);
    expect(currentEra(learn(createGame(map, { player: 'jia' }), JIA, ['farming', 'mining', 'ritual', 'boats']))).toBe(1);
  });

  it('give 30 generic units whose strength rises about a third per era from 20', () => {
    const combat = Object.values(UNITS).filter(
      (unit) => unit.nation === null && unit.unitClass !== 'civilian' && unit.unitClass !== 'tribe',
    );
    expect(combat).toHaveLength(30);
    const infantry = combat.filter((unit) => unit.unitClass === 'infantry').sort((a, b) => a.era - b.era);
    expect(infantry.map((unit) => unit.strength)).toEqual([20, 27, 36, 47, 63, 84]);
    for (const unitClass of ['infantry', 'ranged', 'cavalry', 'siege', 'naval']) {
      expect(combat.filter((unit) => unit.unitClass === unitClass).map((unit) => unit.era).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it('decide which units a city can build', () => {
    const early = createGame(map, { player: 'jia' });
    const queue = (state: GameState, unit: string): ReturnType<typeof applyAction> =>
      applyAction(state, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'unit', unit } });
    expect(queue(early, 'warrior').ok).toBe(true);
    expect(queue(early, 'archer')).toMatchObject({ ok: false, reason: 'needsTech' });
    expect(queue(early, 'settler')).toMatchObject({ ok: false, reason: 'eraTooEarly' });
    const classical = learn(early, JIA, ['farming', 'mining', 'ritual', 'archery', 'fortification', 'crossbow']);
    expect(queue(classical, 'archer').ok).toBe(true);
    expect(queue(classical, 'crossbowman').ok).toBe(true);
    expect(queue(classical, 'settler').ok).toBe(true);
    expect(queue(classical, 'rocketArcher')).toMatchObject({ ok: false, reason: 'needsTech' });
  });
});

describe('determinism', () => {
  it('gives the same final state hash for the same seed', () => {
    const a = playOut(createGame(map, { seed: 11 }));
    const b = playOut(createGame(map, { seed: 11 }));
    expect(a.result).not.toBeNull();
    expect(hashState(a)).toBe(hashState(b));
    expect(saveGame(a)).toBe(saveGame(b));
  });

  it('holds on the large synthetic map too', () => {
    const big = createSyntheticMap();
    const a = play(createGame(big, { seed: 3 }), 30);
    const b = play(createGame(big, { seed: 3 }), 30);
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(a)).not.toBe(hashState(play(createGame(big, { seed: 4 }), 30)));
  }, 60_000);

  it('uses the stored generator: the seed changes the tribes', () => {
    const big = createSyntheticMap();
    const tribes = (seed: number): number[] =>
      createGame(big, { seed }).units.filter((unit) => unit.owner === NO_POLITY).map((unit) => unit.hex);
    expect(tribes(1)).toEqual(tribes(1));
    expect(tribes(1)).not.toEqual(tribes(2));
  });
});

describe('save and load', () => {
  it('round-trips a state as JSON', () => {
    const state = play(createGame(map, { seed: 5 }), 12);
    const text = saveGame(state);
    expect(typeof text).toBe('string');
    expect(text).not.toContain('"terrain"');
    const loaded = loadGame(text, map);
    expect(loaded.map).toBe(map);
    expect(saveGame(loaded)).toBe(text);
    expect(hashState(loaded)).toBe(hashState(state));
  });

  it('continues a game saved in the middle to the same final state', () => {
    const middle = play(createGame(map, { seed: 5 }), 20);
    expect(middle.result).toBeNull();
    const direct = playOut(middle);
    const resumed = playOut(loadGame(saveGame(middle), createFixtureMap()));
    expect(direct.result).not.toBeNull();
    expect(resumed.turn).toBe(direct.turn);
    expect(resumed.result).toEqual(direct.result);
    expect(hashState(resumed)).toBe(hashState(direct));
  });

  it('rejects text that is not a save of this map', () => {
    const text = saveGame(createGame(map));
    expect(() => loadGame('{}', map)).toThrow();
    expect(() => loadGame(text.replace(/"version":\d+/, '"version":99'), map)).toThrow();
    expect(() => loadGame(text, createSyntheticMap({ width: 60, height: 40, polities: 6 }))).toThrow();
  });
});

describe('illegal actions', () => {
  const state = createGame(map, { seed: 1, player: 'jia' });
  const garrison = state.units.find((unit) => unit.owner === JIA)!;
  const foreign = state.units.find((unit) => unit.owner === YI)!;
  const reject = (action: Action, from: GameState = state): string => {
    const result = applyAction(from, action);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(from);
    expect(result.events).toHaveLength(0);
    return result.ok ? '' : result.reason;
  };

  it('are rejected with a reason and leave the state unchanged', () => {
    const before = saveGame(state);
    expect(reject({ type: 'move', polity: JIA, unit: garrison.id, to: garrison.hex + 5 })).toBe('notAdjacent');
    expect(reject({ type: 'move', polity: JIA, unit: foreign.id, to: around(map, foreign.hex)[0]! })).toBe('notYourUnit');
    expect(reject({ type: 'move', polity: JIA, unit: 9999, to: 0 })).toBe('noSuchUnit');
    expect(reject({ type: 'move', polity: JIA, unit: garrison.id, to: -1 })).toBe('badHex');
    expect(reject({ type: 'attack', polity: JIA, unit: garrison.id, target: around(map, garrison.hex)[0]! })).toBe('noTarget');
    expect(reject({ type: 'settle', polity: JIA, unit: garrison.id })).toBe('notASettler');
    expect(reject({ type: 'upgrade', polity: JIA, unit: garrison.id })).toBe('noUpgrade');
    expect(reject({ type: 'setFocus', polity: JIA, city: 3, focus: 'gold' })).toBe('notYourCity');
    expect(reject({ type: 'setFocus', polity: JIA, city: 1, focus: 'gold' })).toBe('noSuchCity');
    expect(reject({ type: 'setFocus', polity: JIA, city: 0, focus: 'speed' as 'gold' })).toBe('badItem');
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'unit', unit: 'dragon' } })).toBe('badItem');
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'unit', unit: 'tribe' } })).toBe('badItem');
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'building', building: 'market' } })).toBe('needsTech');
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'building', building: 'harbour' } })).toBe('needsTech');
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'city', zone: 4 } })).toBe('badItem');
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'improvement', improvement: 'farm', hex: site(3) } })).toBe('badHex');
    expect(reject({ type: 'unqueueBuild', polity: JIA, city: 0, index: 0 })).toBe('badIndex');
    expect(reject({ type: 'declareWar', polity: JIA, target: JIA })).toBe('badTarget');
    expect(reject({ type: 'declareWar', polity: JIA, target: WASTELAND })).toBe('badTarget');
    expect(reject({ type: 'makePeace', polity: JIA, target: YI })).toBe('notAtWar');
    expect(reject({ type: 'fortify', polity: JIA, unit: garrison.id })).toBe('alreadyFortified');
    expect(reject({ type: 'fortify', polity: 77, unit: garrison.id })).toBe('badPolity');
    expect(reject({ type: 'teleport', polity: JIA } as unknown as Action)).toBe('badAction');
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'wonder' } } as unknown as Action)).toBe('badItem');
    expect(reject({ type: 'fortify', polity: WASTELAND, unit: garrison.id })).toBe('badPolity');
    expect(saveGame(state)).toBe(before);
  });

  it('include building the same thing twice', () => {
    const state = learn(createGame(map, { seed: 1, player: 'jia' }), JIA, ['farming']);
    const queued = apply(state, { type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'building', building: 'granary' } });
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'building', building: 'granary' } }, queued)).toBe('alreadyQueued');
    const built = edit(state, (draft) => {
      draft.cities[0]!.buildings.push('granary');
    });
    expect(reject({ type: 'queueBuild', polity: JIA, city: 0, item: { kind: 'building', building: 'granary' } }, built)).toBe('alreadyBuilt');
  });

  it('include moving onto mountains, onto another unit and with no movement left', () => {
    const [from, mountain] = findPair(
      map,
      (a, b) => isPlainGround(map, a) && map.terrain[b] === Terrain.Mountain && hexOwner(state, a) === JIA && hexOwner(state, b) === JIA,
    );
    const free = around(map, from).find((hex) => isPlainGround(map, hex) && hexOwner(state, hex) === JIA)!;
    let walker = 0;
    const placed = edit(state, (draft) => {
      walker = put(draft, 'warrior', JIA, from).id;
      put(draft, 'warrior', JIA, free);
    });
    expect(reject({ type: 'move', polity: JIA, unit: walker, to: mountain }, placed)).toBe('impassable');
    expect(reject({ type: 'move', polity: JIA, unit: walker, to: free }, placed)).toBe('hexOccupied');
    const tired = edit(placed, (draft) => {
      draft.units.find((unit) => unit.id === walker)!.moves = 0;
      draft.units = draft.units.filter((unit) => unit.hex !== free);
    });
    expect(reject({ type: 'move', polity: JIA, unit: walker, to: free }, tired)).toBe('noMovesLeft');
  });

  it('include anything after the game has ended', () => {
    const over = playOut(createGame(map, { seed: 1, turns: 3 }));
    const unit = over.units.find((candidate) => candidate.owner === JIA)!;
    expect(reject({ type: 'sleep', polity: JIA, unit: unit.id }, over)).toBe('gameOver');
    expect(getLegalActions(over, JIA)).toHaveLength(0);
    expect(endTurn(over).state).toBe(over);
  });
});

describe('legal actions', () => {
  it('are all accepted, for every polity, in the middle of a game', () => {
    const state = play(createGame(map, { seed: 2, majors: ['jia', 'yi', 'bing', 'ding'] }), 30);
    expect(state.result).toBeNull();
    let total = 0;
    map.polities.forEach((_, polity) => {
      const actions = getLegalActions(state, polity);
      total += actions.length;
      for (const action of actions) {
        const result = applyAction(state, action);
        expect(result.ok, JSON.stringify(action)).toBe(true);
      }
    });
    expect(total).toBeGreaterThan(100);
    expect(getLegalActions(state, WASTELAND)).toHaveLength(0);
  });

  it('cover moving, building, focus, war, agreements and trade routes at the start', () => {
    const state = createGame(map, { player: 'jia' });
    const kinds = new Set(getLegalActions(state, JIA).map((action) => action.type));
    expect([...kinds].sort()).toEqual([
      'declareWar', 'establishRoute', 'move', 'propose', 'queueBuild', 'setFocus', 'setRepeat', 'setResearch', 'sleep',
    ]);
  });
});

describe('victory arithmetic', () => {
  it('asks for 6 of 12 capitals and scales with fewer majors', () => {
    expect(conquestTarget(12)).toBe(6);
    expect(conquestTarget(4)).toBe(2);
    expect(conquestTarget(1)).toBe(2);
  });
});
