import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { Terrain } from '../shared/mapData.ts';
import { attackStrength, combatDamage, defenceStrength } from './combat.ts';
import { createCtx } from './context.ts';
import { AI, CITY, COMBAT, UNITS, WAR } from './data.ts';
import { NO_POLITY, applyAction, createGame, endTurn, getLegalActions, hexOwner } from './game.ts';
import type { GameEvent, GameState, MutableGameState, Unit } from './game.ts';
import { apply, applyWithEvents, around, edit, findPair, isPlainGround, learn, oneUnitPerHex, put } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const WUCHENG = 4;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const unitOf = (state: GameState, id: number): Unit | undefined => state.units.find((unit) => unit.id === id);
const war = (state: GameState, a: number, b: number): GameState => apply(state, { type: 'declareWar', polity: a, target: b });
/** Passes turns. In these tests nobody is a major, so no AI starts a war. */
const quiet = (state: GameState, turns: number): GameState => {
  let current = state;
  for (let i = 0; i < turns; i++) current = endTurn(current).state;
  return current;
};
/** Land of `polity` next to the site of `zone`. */
const besideSite = (state: GameState, zone: number, polity: number): number =>
  around(map, site(zone)).find((hex) => isPlainGround(map, hex) && hexOwner(state, hex) === polity)!;

describe('combat arithmetic', () => {
  it('deals 30 between equals and scales exponentially with the strength difference', () => {
    expect(combatDamage(20, 20, 1)).toBe(30);
    expect(combatDamage(30, 20, 1)).toBe(Math.round(30 * Math.exp(0.4)));
    expect(combatDamage(20, 30, 1)).toBe(Math.round(30 * Math.exp(-0.4)));
    expect(combatDamage(20, 20, 1.2)).toBe(36);
    expect(combatDamage(20, 20, 0.8)).toBe(24);
    expect(combatDamage(200, 20, 1)).toBe(100);
    expect(combatDamage(1, 200, 1)).toBe(1);
  });

  it('adds 10% strength per level, halves towards 0 HP and penalises river crossings', () => {
    const unit: Unit = { id: 1, type: 'warrior', owner: JIA, hex: 0, hp: 100, moves: 2, xp: 0, level: 0, status: 'ready', acted: false };
    expect(attackStrength(unit, false, false, false)).toBe(20);
    expect(attackStrength({ ...unit, level: 1 }, false, false, false)).toBeCloseTo(22);
    expect(attackStrength({ ...unit, level: 3 }, false, false, false)).toBeCloseTo(26);
    expect(attackStrength({ ...unit, hp: 50 }, false, false, false)).toBeCloseTo(15);
    expect(attackStrength(unit, false, false, true)).toBeCloseTo(16);
    expect(attackStrength({ ...unit, type: 'batteringRam' }, true, true, false)).toBeCloseTo(UNITS.batteringRam!.rangedStrength * 2);
  });

  it('raises defence on hills and when fortified, and halves it afloat', () => {
    const base = createGame(map);
    const flat = findPair(map, (a) => isPlainGround(map, a))[0];
    const hill = findPair(map, (a) => map.hills[a] === 1 && topo.enterable[a] === 1)[0];
    const coast = findPair(map, (a) => map.terrain[a] === Terrain.Coast)[0];
    const strength = (hex: number, extra: Partial<Unit> = {}): number => {
      let unit: Unit | undefined;
      const state = edit(base, (draft) => {
        unit = put(draft, 'warrior', JIA, hex, extra);
      });
      return defenceStrength(createCtx(state as MutableGameState), unit!);
    };
    expect(strength(flat)).toBe(20);
    expect(strength(hill)).toBeCloseTo(25);
    expect(strength(flat, { status: 'fortified' })).toBeCloseTo(25);
    expect(strength(coast)).toBeCloseTo(10);
  });

  describe('between units', () => {
    const [from, to] = findPair(map, (a, b) => isPlainGround(map, a) && isPlainGround(map, b) && map.zone[a] === 0 && map.zone[b] === 0);
    const setup = (attacker: string, defenderHp = 100): { state: GameState; attackerId: number; defenderId: number } => {
      let attackerId = 0;
      let defenderId = 0;
      const state = edit(war(createGame(map, { seed: 9, player: 'jia' }), JIA, YI), (draft) => {
        attackerId = put(draft, attacker, JIA, from).id;
        defenderId = put(draft, 'warrior', YI, to, { hp: defenderHp }).id;
      });
      return { state, attackerId, defenderId };
    };

    it('hurts both sides in melee, within the random spread, and ends the attacker\'s turn', () => {
      const { state, attackerId, defenderId } = setup('warrior');
      const result = applyWithEvents(state, { type: 'attack', polity: JIA, unit: attackerId, target: to });
      const combat = result.events.find((event): event is Extract<GameEvent, { type: 'combat' }> => event.type === 'combat')!;
      for (const damage of [combat.damageToDefender, combat.damageToAttacker]) {
        expect(damage).toBeGreaterThanOrEqual(Math.round(30 * (1 - COMBAT.randomSpread)));
        expect(damage).toBeLessThanOrEqual(Math.round(30 * (1 + COMBAT.randomSpread)));
      }
      expect(unitOf(result.state, defenderId)!.hp).toBe(100 - combat.damageToDefender);
      const attacker = unitOf(result.state, attackerId)!;
      expect(attacker.hp).toBe(100 - combat.damageToAttacker);
      expect(attacker.moves).toBe(0);
      expect(attacker.xp).toBe(COMBAT.xpAttack);
      expect(result.state.rng).not.toBe(state.rng);
      expect(applyAction(result.state, { type: 'attack', polity: JIA, unit: attackerId, target: to })).toMatchObject({
        ok: false,
        reason: 'noMovesLeft',
      });
    });

    it('lets ranged units strike from two hexes away without being hit back', () => {
      const far = around(map, to).find((hex) => hex !== from && !around(map, from).includes(hex) && isPlainGround(map, hex))!;
      let archer = 0;
      const { state, defenderId } = setup('warrior');
      const ranged = edit(state, (draft) => {
        draft.units = draft.units.filter((unit) => unit.hex !== from);
        archer = put(draft, 'archer', JIA, from).id;
        draft.units.find((unit) => unit.id === defenderId)!.hex = far;
      });
      const result = applyWithEvents(ranged, { type: 'attack', polity: JIA, unit: archer, target: far });
      expect(unitOf(result.state, archer)!.hp).toBe(100);
      expect(unitOf(result.state, archer)!.hex).toBe(from);
      expect(unitOf(result.state, defenderId)!.hp).toBeLessThan(100);
      const melee = edit(ranged, (draft) => {
        draft.units.find((unit) => unit.id === archer)!.type = 'warrior';
      });
      expect(applyAction(melee, { type: 'attack', polity: JIA, unit: archer, target: far })).toMatchObject({ ok: false, reason: 'notAdjacent' });
    });

    it('removes a unit at 0 HP and moves the melee winner onto its hex', () => {
      const { state, attackerId, defenderId } = setup('warrior', 5);
      const result = applyWithEvents(state, { type: 'attack', polity: JIA, unit: attackerId, target: to });
      expect(unitOf(result.state, defenderId)).toBeUndefined();
      expect(unitOf(result.state, attackerId)!.hex).toBe(to);
      expect(unitOf(result.state, attackerId)!.hp).toBeGreaterThan(0);
      expect(result.events.some((event) => event.type === 'unitKilled')).toBe(true);
      expect(oneUnitPerHex(result.state)).toBe(true);
    });

    it('promotes a unit through three levels as it gains experience', () => {
      const { state, attackerId } = setup('warrior', 5);
      const veteran = edit(state, (draft) => {
        draft.units.find((unit) => unit.id === attackerId)!.xp = COMBAT.levelXp[2] - 1;
        draft.units.find((unit) => unit.id === attackerId)!.level = 2;
      });
      const result = apply(veteran, { type: 'attack', polity: JIA, unit: attackerId, target: to });
      expect(unitOf(result, attackerId)!.level).toBe(3);
    });
  });

  it('heals a unit that rests, faster at home, and not one that acted', () => {
    const [a, b] = findPair(map, (x, y) => isPlainGround(map, x) && isPlainGround(map, y) && map.zone[x] === 0 && map.zone[y] === 0);
    const waste = topo.zoneHexes[9]!.find((hex) => isPlainGround(map, hex))!;
    let home = 0;
    let abroad = 0;
    let busy = 0;
    const state = edit(createGame(map, { player: 'jia', majors: [] }), (draft) => {
      draft.units = draft.units.filter((unit) => unit.owner !== NO_POLITY);
      home = put(draft, 'warrior', JIA, a, { hp: 50 }).id;
      abroad = put(draft, 'warrior', JIA, waste, { hp: 50 }).id;
      busy = put(draft, 'warrior', JIA, b, { hp: 50, acted: true }).id;
    });
    const next = endTurn(state).state;
    expect(unitOf(next, home)!.hp).toBe(50 + COMBAT.healOwnTerritory);
    expect(unitOf(next, abroad)!.hp).toBe(50 + COMBAT.healNeutral);
    expect(unitOf(next, busy)!.hp).toBe(50);
    expect(unitOf(next, busy)!.acted).toBe(false);
  });
});

describe('movement', () => {
  const base = createGame(map, { player: 'jia', majors: [] });

  it('spends movement points by terrain: hills and forests cost more', () => {
    const [from, flat] = findPair(map, (a, b) => isPlainGround(map, a) && isPlainGround(map, b) && map.zone[a] === 0 && map.zone[b] === 0);
    const [low, rough] = findPair(
      map,
      (a, b) => isPlainGround(map, a) && topo.moveCost[b] === 2 && map.riverEdges[b] === 0 && map.zone[a] === 0 && map.zone[b] === 0 && topo.enterable[b] === 1,
    );
    let rider = 0;
    let climber = 0;
    const state = edit(base, (draft) => {
      rider = put(draft, 'chariot', JIA, from).id;
      climber = put(draft, 'chariot', JIA, low === from || low === flat ? flat : low).id;
    });
    const moved = apply(state, { type: 'move', polity: JIA, unit: rider, to: flat });
    expect(unitOf(moved, rider)).toMatchObject({ hex: flat, moves: UNITS.chariot!.moves - 1 });
    if (low !== from && low !== flat) {
      const climbed = apply(state, { type: 'move', polity: JIA, unit: climber, to: rough });
      expect(unitOf(climbed, climber)!.moves).toBe(UNITS.chariot!.moves - 2);
    }
  });

  it('ends a unit\'s turn when it crosses a river', () => {
    const [from, to] = findPair(map, (a, b) => {
      if (topo.water[a] === 1 || topo.water[b] === 1 || topo.enterable[a] !== 1 || topo.enterable[b] !== 1) return false;
      const direction = around(map, a).indexOf(b);
      return hexOwner(base, a) === YI && hexOwner(base, b) === YI && topo.neighbors[a * 6 + direction] === b && (map.riverEdges[a]! & (1 << direction)) !== 0;
    });
    let rider = 0;
    const state = edit(base, (draft) => {
      rider = put(draft, 'chariot', YI, from).id;
    });
    const moved = apply(state, { type: 'move', polity: YI, unit: rider, to });
    expect(unitOf(moved, rider)).toMatchObject({ hex: to, moves: 0 });
  });

  it('lets land units embark on coast with Boats and on ocean with Compass', () => {
    const [shore, coast] = findPair(map, (a, b) => isPlainGround(map, a) && hexOwner(base, a) === YI && map.terrain[b] === Terrain.Coast);
    const ocean = around(map, coast).find((hex) => map.terrain[hex] === Terrain.Ocean);
    let walker = 0;
    const ancient = edit(base, (draft) => {
      walker = put(draft, 'warrior', YI, shore).id;
    });
    expect(applyAction(ancient, { type: 'move', polity: YI, unit: walker, to: coast })).toMatchObject({ ok: false, reason: 'impassable' });
    const classical = learn(ancient, YI, ['boats']);
    const afloat = apply(classical, { type: 'move', polity: YI, unit: walker, to: coast });
    expect(unitOf(afloat, walker)).toMatchObject({ hex: coast, moves: 0 });
    if (ocean !== undefined) {
      const rested = edit(afloat, (draft) => {
        draft.units.find((unit) => unit.id === walker)!.moves = 2;
      });
      expect(applyAction(rested, { type: 'move', polity: YI, unit: walker, to: ocean })).toMatchObject({ ok: false, reason: 'impassable' });
      const medieval = learn(rested, YI, ['compass']);
      expect(applyAction(medieval, { type: 'move', polity: YI, unit: walker, to: ocean }).ok).toBe(true);
    }
    // Afloat, a land unit cannot attack or fortify.
    expect(applyAction(afloat, { type: 'fortify', polity: YI, unit: walker })).toMatchObject({ ok: false, reason: 'cannotAttack' });
  });

  it('fortifies and puts to sleep', () => {
    let id = 0;
    const state = edit(base, (draft) => {
      id = put(draft, 'warrior', JIA, besideSite(base, 0, JIA)).id;
    });
    const fortified = apply(state, { type: 'fortify', polity: JIA, unit: id });
    expect(unitOf(fortified, id)).toMatchObject({ status: 'fortified', moves: 0 });
    const asleep = apply(state, { type: 'sleep', polity: JIA, unit: id });
    expect(unitOf(asleep, id)!.status).toBe('asleep');
    // Orders stand until the unit moves again.
    const later = endTurn(fortified).state;
    expect(unitOf(later, id)!.status).toBe('fortified');
    const target = around(map, unitOf(later, id)!.hex).find((hex) => isPlainGround(map, hex) && hexOwner(later, hex) === JIA)!;
    expect(unitOf(apply(later, { type: 'move', polity: JIA, unit: id, to: target }), id)!.status).toBe('ready');
  });

  it('upgrades a unit with gold inside its own borders', () => {
    let id = 0;
    const home = besideSite(base, 0, JIA);
    // The fixture has no iron, so the warrior's next step is the musketeer.
    const state = edit(learn(base, JIA, ['ironworking', 'firearms']), (draft) => {
      id = put(draft, 'warrior', JIA, home, { xp: 9, level: 1, hp: 70 }).id;
    });
    expect(applyAction(state, { type: 'upgrade', polity: JIA, unit: id })).toMatchObject({ ok: false, reason: 'notEnoughGold' });
    const cost = (UNITS.musketeer!.cost - UNITS.warrior!.cost) * 2;
    const rich = edit(state, (draft) => {
      draft.polities[JIA]!.gold = cost + 5;
    });
    const upgraded = apply(rich, { type: 'upgrade', polity: JIA, unit: id });
    expect(unitOf(upgraded, id)).toMatchObject({ type: 'musketeer', level: 1, xp: 9, hp: 70 });
    expect(upgraded.polities[JIA]!.gold).toBe(5);
    const abroad = edit(rich, (draft) => {
      draft.units.find((unit) => unit.id === id)!.hex = topo.zoneHexes[9]!.find((hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex))!;
    });
    expect(applyAction(abroad, { type: 'upgrade', polity: JIA, unit: id })).toMatchObject({ ok: false, reason: 'notInOwnBorders' });
  });
});

describe('borders, war and peace', () => {
  const base = createGame(map, { seed: 4, player: 'jia', majors: [] });
  const [inside, across] = findPair(map, (a, b) => isPlainGround(map, a) && isPlainGround(map, b) && hexOwner(base, a) === JIA && hexOwner(base, b) === BING);
  let scout = 0;
  const start = edit(base, (draft) => {
    scout = put(draft, 'warrior', JIA, inside).id;
  });

  it('starts everybody at peace', () => {
    expect(Object.keys(base.relations)).toHaveLength(0);
  });

  it('keeps units out of another polity\'s territory at peace', () => {
    expect(applyAction(start, { type: 'move', polity: JIA, unit: scout, to: across })).toMatchObject({ ok: false, reason: 'closedBorders' });
    expect(getLegalActions(start, JIA).some((action) => action.type === 'move' && action.unit === scout && action.to === across)).toBe(false);
  });

  it('forbids attacks at peace', () => {
    const facing = edit(start, (draft) => {
      put(draft, 'warrior', BING, across);
    });
    expect(applyAction(facing, { type: 'attack', polity: JIA, unit: scout, target: across })).toMatchObject({ ok: false, reason: 'atPeace' });
  });

  it('opens the border to the two sides of a war, and to nobody else', () => {
    const atWar = war(start, JIA, BING);
    expect(atWar.relations['0:2']).toMatchObject({ atWar: true, since: 1 });
    expect(atWar.stats.warsDeclared).toBe(1);
    expect(applyAction(atWar, { type: 'move', polity: JIA, unit: scout, to: across }).ok).toBe(true);
    expect(applyAction(atWar, { type: 'declareWar', polity: BING, target: JIA })).toMatchObject({ ok: false, reason: 'alreadyAtWar' });
    const [yiSide, bingSide] = findPair(map, (a, b) => isPlainGround(map, a) && isPlainGround(map, b) && hexOwner(base, a) === DING && hexOwner(base, b) === BING);
    let other = 0;
    const third = edit(atWar, (draft) => {
      other = put(draft, 'warrior', DING, yiSide).id;
    });
    expect(applyAction(third, { type: 'move', polity: DING, unit: other, to: bingSide })).toMatchObject({ ok: false, reason: 'closedBorders' });
  });

  it('lets anybody walk into unsettled wasteland', () => {
    const [own, wild] = findPair(map, (a, b) => isPlainGround(map, a) && isPlainGround(map, b) && hexOwner(base, a) === YI && map.zone[b] === 9 && !base.units.some((unit) => unit.hex === b));
    let id = 0;
    const state = edit(base, (draft) => {
      id = put(draft, 'warrior', YI, own).id;
    });
    expect(applyAction(state, { type: 'move', polity: YI, unit: id, to: wild }).ok).toBe(true);
  });

  it('makes a war last a minimum number of turns, then sends units home at the peace', () => {
    const invaded = apply(war(start, JIA, BING), { type: 'move', polity: JIA, unit: scout, to: across });
    expect(applyAction(invaded, { type: 'makePeace', polity: JIA, target: BING })).toMatchObject({ ok: false, reason: 'warTooYoung' });
    const later = edit(invaded, (draft) => {
      draft.turn = 1 + WAR.minTurns;
    });
    const peace = applyWithEvents(later, { type: 'makePeace', polity: JIA, target: BING });
    expect(peace.state.relations['0:2']).toMatchObject({ atWar: false, since: 1 + WAR.minTurns });
    expect(peace.events.map((event) => event.type)).toEqual(['peaceMade', 'unitExpelled']);
    expect(hexOwner(peace.state, unitOf(peace.state, scout)!.hex)).not.toBe(BING);
    expect(oneUnitPerHex(peace.state)).toBe(true);
    // A truce follows.
    expect(applyAction(peace.state, { type: 'declareWar', polity: JIA, target: BING })).toMatchObject({ ok: false, reason: 'truce' });
    const afterTruce = edit(peace.state, (draft) => {
      draft.turn += WAR.truceTurns;
    });
    expect(applyAction(afterTruce, { type: 'declareWar', polity: JIA, target: BING }).ok).toBe(true);
  });

  it('leaves a peace offer for a human player to take up', () => {
    const human = edit(war(createGame(map, { player: 'jia', majors: [] }), BING, JIA), (draft) => {
      draft.turn = 1 + WAR.minTurns;
    });
    const offered = applyWithEvents(human, { type: 'makePeace', polity: BING, target: JIA });
    expect(offered.events).toEqual([{ type: 'peaceOffered', from: BING, to: JIA }]);
    expect(offered.state.relations['0:2']!.atWar).toBe(true);
    const accepted = apply(offered.state, { type: 'makePeace', polity: JIA, target: BING });
    expect(accepted.relations['0:2']!.atWar).toBe(false);
  });

  it('lowers morale in every city of a polity at war, more the longer it lasts', () => {
    const morale = (state: GameState, polity: number): number[] =>
      state.cities.flatMap((city) => (city !== null && city.owner === polity ? [city.morale] : []));
    const second = edit(base, (draft) => {
      draft.cities[1] = { ...draft.cities[0]!, zone: 1, buildings: [], queue: [], worked: [] };
    });
    const five = quiet(war(second, JIA, BING), 5);
    const ten = quiet(five, 5);
    expect(five.polities[JIA]!.warWeariness).toBe(5 * WAR.wearinessPerWarTurn);
    expect(morale(five, JIA)).toEqual([95, 95]);
    expect(morale(ten, JIA)).toEqual([90, 90]);
    expect(morale(ten, YI)).toEqual([100]);
    // Lower morale costs gold.
    const weary = edit(ten, (draft) => {
      draft.polities[JIA]!.warWeariness = WAR.wearinessMax;
    });
    expect(quiet(weary, 1).cities[0]!.yields.gold).toBeLessThan(quiet(second, 11).cities[0]!.yields.gold);
  });
});

describe('cities in combat', () => {
  /** Jia at war with Yi, which has both of its cities; a Jia unit stands next to Yi's second city. */
  const scene = (attacker: string, cityHp: number, walls = false): { state: GameState; id: number; from: number } => {
    const base = createGame(map, { seed: 6, player: 'jia', majors: [] });
    const from = besideSite(base, 4, YI);
    let id = 0;
    const state = edit(war(base, JIA, YI), (draft) => {
      draft.cities[4] = { ...draft.cities[3]!, zone: 4, hp: cityHp, buildings: walls ? ['walls'] : [], queue: [], worked: [] };
      id = put(draft, attacker, JIA, from).id;
    });
    return { state, id, from };
  };

  it('wears a city down without capturing it while it has HP', () => {
    const { state, id } = scene('warrior', CITY.hp);
    const result = applyWithEvents(state, { type: 'attack', polity: JIA, unit: id, target: site(4) });
    const city = result.state.cities[4]!;
    expect(city.owner).toBe(YI);
    expect(city.hp).toBeLessThan(CITY.hp);
    expect(city.attackedOn).toBe(1);
    expect(unitOf(result.state, id)!.hp).toBeLessThan(100);
    expect(unitOf(result.state, id)!.hex).not.toBe(site(4));
    // A city that was attacked does not repair itself that turn; a city left alone does.
    const next = endTurn(result.state).state;
    expect(next.cities[4]!.hp).toBe(city.hp);
    expect(endTurn(next).state.cities[4]!.hp).toBe(Math.min(CITY.hp, city.hp + CITY.heal));
  });

  it('answers the first attack of a turn with a ranged strike if it has walls', () => {
    const walled = scene('archer', CITY.hp, true);
    const struck = applyWithEvents(walled.state, { type: 'attack', polity: JIA, unit: walled.id, target: site(4) });
    const strike = struck.events.find((event): event is Extract<GameEvent, { type: 'cityStrike' }> => event.type === 'cityStrike')!;
    expect(strike).toMatchObject({ city: 4, unit: walled.id });
    expect(unitOf(struck.state, walled.id)!.hp).toBe(100 - strike.damage);
    expect(struck.state.cities[4]!.struck).toBe(true);
    // Only once per turn.
    const again = edit(struck.state, (draft) => {
      draft.units.find((unit) => unit.id === walled.id)!.moves = 2;
    });
    expect(applyWithEvents(again, { type: 'attack', polity: JIA, unit: walled.id, target: site(4) }).events.some((event) => event.type === 'cityStrike')).toBe(false);
    expect(endTurn(struck.state).state.cities[4]!.struck).toBe(false);

    const bare = scene('archer', CITY.hp);
    const unanswered = applyWithEvents(bare.state, { type: 'attack', polity: JIA, unit: bare.id, target: site(4) });
    expect(unanswered.events.some((event) => event.type === 'cityStrike')).toBe(false);
    expect(unitOf(unanswered.state, bare.id)!.hp).toBe(100);
  });

  it('cannot be taken by a ranged unit', () => {
    const { state, id } = scene('archer', 0);
    const result = apply(state, { type: 'attack', polity: JIA, unit: id, target: site(4) });
    expect(result.cities[4]).toMatchObject({ owner: YI, hp: 0 });
  });

  it('is captured by a melee unit at 0 HP, and its zone changes hands with it', () => {
    const { state, id, from } = scene('warrior', 0);
    const zoneHexes = topo.zoneHexes[4]!;
    expect(zoneHexes.every((hex) => hexOwner(state, hex) === YI)).toBe(true);
    const result = applyWithEvents(state, { type: 'attack', polity: JIA, unit: id, target: site(4) });
    const city = result.state.cities[4]!;
    expect(city.owner).toBe(JIA);
    expect(city.originalOwner).toBe(YI);
    expect(city.unrest).toBe(CITY.unrestTurns);
    expect(city.hp).toBe(CITY.hp * CITY.captureHpFraction);
    expect(city.yields.production).toBe(0);
    expect(unitOf(result.state, id)!.hex).toBe(site(4));
    expect(result.state.zoneOwner[4]).toBe(JIA);
    expect(zoneHexes.every((hex) => hexOwner(result.state, hex) === JIA)).toBe(true);
    // Only that zone: Yi keeps its capital and its other zone.
    expect(result.state.zoneOwner[3]).toBe(YI);
    expect(result.state.cities[3]!.owner).toBe(YI);
    expect(result.state.polities[YI]!.alive).toBe(true);
    expect(result.state.stats).toMatchObject({ citiesCaptured: 1, politiesAnnexed: 0 });
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['cityCaptured', 'zoneTransferred', 'unitMoved']));
    expect(result.events.find((event) => event.type === 'unitMoved')).toMatchObject({ from, to: site(4) });
    // Unrest passes.
    expect(quiet(result.state, CITY.unrestTurns).cities[4]!.unrest).toBe(0);
  });

  it('loses its garrison when it falls, and moves the capital if it was one', () => {
    const base = createGame(map, { seed: 6, player: 'jia', majors: [] });
    const from = besideSite(base, 3, YI);
    let id = 0;
    const state = edit(war(base, JIA, YI), (draft) => {
      draft.cities[4] = { ...draft.cities[3]!, zone: 4, queue: [], worked: [] };
      draft.cities[3]!.hp = 0;
      id = put(draft, 'warrior', JIA, from).id;
    });
    const garrison = state.units.find((unit) => unit.owner === YI && unit.hex === site(3))!;
    const result = apply(state, { type: 'attack', polity: JIA, unit: id, target: site(3) });
    expect(unitOf(result, garrison.id)).toBeUndefined();
    expect(result.polities[YI]!.capital).toBe(4);
    expect(result.polities[YI]!.alive).toBe(true);
    expect(oneUnitPerHex(result)).toBe(true);
  });
});

describe('annexation', () => {
  it('follows the capture of a polity\'s last city and takes the zones whose city was never built', () => {
    const base = createGame(map, { seed: 6, player: 'jia', majors: [] });
    expect(base.cities[6]).toBeNull();
    const from = besideSite(base, 5, BING);
    let id = 0;
    let stray = 0;
    const state = edit(war(war(base, JIA, BING), BING, DING), (draft) => {
      draft.cities[5]!.hp = 0;
      id = put(draft, 'warrior', JIA, from).id;
      stray = put(draft, 'warrior', BING, topo.zoneHexes[6]!.find((hex) => isPlainGround(map, hex))!).id;
    });
    const result = applyWithEvents(state, { type: 'attack', polity: JIA, unit: id, target: site(5) });
    const after = result.state;
    expect(after.polities[BING]!.alive).toBe(false);
    expect(after.zoneOwner[5]).toBe(JIA);
    expect(after.zoneOwner[6]).toBe(JIA);
    expect(after.cities[6]).toBeNull();
    expect(after.units.some((unit) => unit.owner === BING)).toBe(false);
    expect(unitOf(after, stray)).toBeUndefined();
    expect(after.stats).toMatchObject({ citiesCaptured: 1, politiesAnnexed: 1 });
    expect(result.events).toContainEqual({ type: 'polityAnnexed', polity: BING, by: JIA });
    expect(result.events).toContainEqual({ type: 'zoneTransferred', zone: 6, from: BING, to: JIA });
    // Its wars are over, and it takes no further part.
    expect(after.relations['0:2']!.atWar).toBe(false);
    expect(after.relations['2:3']!.atWar).toBe(false);
    expect(getLegalActions(after, BING)).toHaveLength(0);
    expect(applyAction(after, { type: 'declareWar', polity: JIA, target: BING })).toMatchObject({ ok: false, reason: 'badTarget' });
    // The new owner can found the missing city.
    expect(applyAction(after, { type: 'queueBuild', polity: JIA, city: 5, item: { kind: 'city', zone: 6 } }).ok).toBe(true);
    const later = quiet(after, 3);
    expect(later.polities[BING]!.alive).toBe(false);
    expect(later.cities[5]!.owner).toBe(JIA);
  });

  it('applies to a city-state, which has one city', () => {
    const base = createGame(map, { seed: 6, player: 'jia', majors: [] });
    let id = 0;
    const state = edit(war(base, JIA, WUCHENG), (draft) => {
      draft.cities[8]!.hp = 0;
      id = put(draft, 'warrior', JIA, around(map, site(8)).find((hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0 && !draft.units.some((unit) => unit.hex === hex))!).id;
    });
    const after = apply(state, { type: 'attack', polity: JIA, unit: id, target: site(8) });
    expect(after.polities[WUCHENG]!.alive).toBe(false);
    expect(after.cities[8]!.owner).toBe(JIA);
    expect(topo.zoneHexes[8]!.every((hex) => hexOwner(after, hex) === JIA)).toBe(true);
  });
});

describe('victory', () => {
  it('goes to a major that holds half of the majors\' original capitals: Conquest', () => {
    const base = createGame(map, { seed: 6, player: 'jia' });
    expect(base.majors).toHaveLength(4);
    let id = 0;
    const state = edit(war(base, JIA, DING), (draft) => {
      draft.cities[7]!.hp = 0;
      id = put(draft, 'warrior', JIA, besideSite(base, 7, DING)).id;
    });
    const captured = apply(state, { type: 'attack', polity: JIA, unit: id, target: site(7) });
    expect(captured.result).toBeNull();
    const ended = endTurn(captured);
    expect(ended.state.result).toEqual({ kind: 'conquest', winner: JIA, turn: 1 });
    expect(ended.events.at(-1)).toEqual({ type: 'gameEnded', result: ended.state.result });
    expect(ended.state.turn).toBe(1);
    // The game has stopped.
    expect(endTurn(ended.state).state).toBe(ended.state);
    expect(applyAction(ended.state, { type: 'declareWar', polity: JIA, target: YI })).toMatchObject({ ok: false, reason: 'gameOver' });
  });

  it('does not count the capital of a nation that is not a major', () => {
    const base = createGame(map, { seed: 6, player: 'jia', majors: ['jia', 'yi', 'bing'] });
    let id = 0;
    const state = edit(war(base, JIA, DING), (draft) => {
      draft.cities[7]!.hp = 0;
      id = put(draft, 'warrior', JIA, besideSite(base, 7, DING)).id;
    });
    const ended = endTurn(apply(state, { type: 'attack', polity: JIA, unit: id, target: site(7) }));
    expect(ended.state.polities[DING]!.alive).toBe(false);
    expect(ended.state.result).toBeNull();
  });

  it('goes to the highest cumulative gross income when the last turn ends: Economic', () => {
    let state = createGame(map, { seed: 6, turns: 6 });
    while (state.result === null) state = endTurn(state).state;
    expect(state.turn).toBe(6);
    expect(state.result.kind).toBe('economic');
    expect(state.result.turn).toBe(6);
    const best = Math.max(...state.majors.map((polity) => state.polities[polity]!.grossIncome));
    expect(best).toBeGreaterThan(0);
    expect(state.polities[state.result.winner]!.grossIncome).toBe(best);
    expect(state.majors).toContain(state.result.winner);
  });

  it('ranks only the majors and the player for the Economic victory', () => {
    const rich = edit(createGame(map, { seed: 6, turns: 1, player: 'ding', majors: ['jia'] }), (draft) => {
      draft.polities[YI]!.grossIncome = 9000;
      draft.polities[WUCHENG]!.grossIncome = 9000;
      draft.polities[DING]!.grossIncome = 500;
    });
    expect(endTurn(rich).state.result).toMatchObject({ kind: 'economic', winner: DING });
  });

  it('counts income, not the treasury', () => {
    const state = edit(createGame(map, { seed: 6, turns: 1, majors: ['jia', 'yi'] }), (draft) => {
      draft.polities[JIA]!.gold = 5000;
      draft.polities[YI]!.grossIncome = 50;
    });
    expect(endTurn(state).state.result).toMatchObject({ kind: 'economic', winner: YI });
  });
});

describe('tribes', () => {
  it('defend themselves and never act', () => {
    const base = createGame(map, { seed: 8, player: 'jia', majors: [] });
    const tribe = base.units.find((unit) => unit.owner === NO_POLITY)!;
    expect(tribe.type).toBe('tribe');
    let id = 0;
    const state = edit(base, (draft) => {
      id = put(draft, 'warrior', JIA, around(map, tribe.hex).find((hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0 && !draft.units.some((unit) => unit.hex === hex))!).id;
    });
    const result = applyWithEvents(state, { type: 'attack', polity: JIA, unit: id, target: tribe.hex });
    expect(unitOf(result.state, id)!.hp).toBeLessThan(100);
    expect(unitOf(result.state, tribe.id)!.hp).toBeLessThan(100);
    expect(getLegalActions(state, NO_POLITY)).toHaveLength(0);
    const later = quiet(result.state, 5);
    expect(unitOf(later, tribe.id)!.hex).toBe(tribe.hex);
    expect(unitOf(later, id)!.hp).toBeGreaterThan(0);
  });
});

describe('AI', () => {
  /** Jia and Yi are majors; Jia has `extra` more warriors around its capital, and it is turn 12. */
  const armed = (extra: number, yiExtra = 0): GameState =>
    edit(createGame(map, { seed: 8, majors: ['jia', 'yi'] }), (draft) => {
      draft.turn = AI.firstWarTurn;
      const free = (zone: number): number[] => topo.zoneHexes[zone]!.filter((hex) => isPlainGround(map, hex));
      free(0).slice(0, extra).forEach((hex) => put(draft, 'warrior', JIA, hex));
      free(3).slice(0, yiExtra).forEach((hex) => put(draft, 'warrior', YI, hex));
    });
  const declared = (events: GameEvent[]): Extract<GameEvent, { type: 'warDeclared' }>[] =>
    events.filter((event): event is Extract<GameEvent, { type: 'warDeclared' }> => event.type === 'warDeclared');

  it('declares war on a weaker neighbour when it is stronger, and picks one city to march on', () => {
    const result = endTurn(armed(6));
    const wars = declared(result.events);
    expect(wars).toHaveLength(1);
    expect(wars[0]!.by).toBe(JIA);
    const target = result.state.polities[JIA]!.aiTarget;
    expect(result.state.cities[target]!.owner).toBe(wars[0]!.on);
    // The target stays the same while the war lasts.
    const next = endTurn(result.state).state;
    if (next.cities[target]!.owner === wars[0]!.on) expect(next.polities[JIA]!.aiTarget).toBe(target);
  });

  it('stays at peace without an army, and when every neighbour is as strong', () => {
    expect(declared(endTurn(armed(0)).events)).toHaveLength(0);
    const balanced = edit(armed(6, 6), (draft) => {
      for (const polity of [BING, DING, WUCHENG]) {
        const zone = map.polities[polity]!.capitalZone;
        topo.zoneHexes[zone]!.filter((hex) => topo.enterable[hex] === 1 && topo.water[hex] === 0 && hex !== site(zone))
          .slice(0, 6)
          .forEach((hex) => put(draft, 'warrior', polity, hex));
      }
    });
    expect(declared(endTurn(balanced).events)).toHaveLength(0);
  });

  it('never declares war before the first-war turn, and never as a non-major', () => {
    const early = edit(armed(6), (draft) => {
      draft.turn = AI.firstWarTurn - 2;
    });
    expect(declared(endTurn(early).events)).toHaveLength(0);
    const minor = edit(armed(6), (draft) => {
      draft.majors = [YI];
    });
    expect(declared(endTurn(minor).events)).toHaveLength(0);
  });

  it('makes peace when the war goes badly', () => {
    const losing = edit(war(armed(0), JIA, YI), (draft) => {
      draft.turn = 1 + WAR.minTurns;
      draft.relations['0:1']!.since = 1;
      draft.polities[JIA]!.warWeariness = AI.peaceWeariness;
    });
    const result = endTurn(losing);
    expect(result.events).toContainEqual({ type: 'peaceMade', a: JIA, b: YI });
    expect(result.state.relations['0:1']!.atWar).toBe(false);
    // An even, young war goes on.
    const even = edit(losing, (draft) => {
      draft.polities[JIA]!.warWeariness = 0;
    });
    expect(endTurn(even).state.relations['0:1']!.atWar).toBe(true);
  });
});
