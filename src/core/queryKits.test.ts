import { describe, expect, it } from 'vitest';
import { Feature } from '../shared/mapData.ts';
import { attackStrength, combatDamage } from './combat.ts';
import { unitDef } from './data.ts';
import { applyAction } from './game.ts';
import type { GameEvent, GameState } from './game.ts';
import { FOE, FOE_SITE, FOE_ZONE, HOME_ZONE, LAND, LAND2, SELF, labGame } from './kitLab.ts';
import {
  activeRoadUpgrade,
  attackOutcome,
  checkAction,
  eraOfPolity,
  improvementSites,
  unitDefence,
  unitUpgrade,
  upgradeOffer,
} from './query.ts';
import { edit, put } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const SEEDS = 240;

function atWar(state: GameState): GameState {
  return edit(state, (draft) => {
    draft.relations[`${SELF}:${FOE}`] = { a: SELF, b: FOE, atWar: true, since: 1, offerA: 0, offerB: 0 };
  });
}

/** The mean damage the rules deal over many rolls of the same attack. */
function meanDamage(state: GameState, unit: number, target: number): { toDefender: number; toAttacker: number } {
  let toDefender = 0;
  let toAttacker = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rolled = edit(state, (draft) => {
      draft.rng = seed * 7919;
    });
    const result = applyAction(rolled, { type: 'attack', polity: SELF, unit, target });
    if (!result.ok) throw new Error(`attack rejected: ${result.reason}`);
    const combat = result.events.find((event): event is Extract<GameEvent, { type: 'combat' }> => event.type === 'combat');
    if (combat === undefined) throw new Error('no combat event');
    toDefender += combat.damageToDefender;
    toAttacker += combat.damageToAttacker;
  }
  return { toDefender: toDefender / SEEDS, toAttacker: toAttacker / SEEDS };
}

/** A fight between a unit of polity 0 on `LAND` and a warrior of polity 1 next to it. */
function duel(nation: string | null, type: string, prepare?: (state: GameState) => GameState): { state: GameState; unit: number } {
  let unit = 0;
  let state = edit(atWar(labGame(nation).state), (draft) => {
    draft.units = draft.units.filter((other) => other.hex !== LAND && other.hex !== LAND2);
    unit = put(draft, type, SELF, LAND).id;
    put(draft, 'warrior', FOE, LAND2);
  });
  if (prepare !== undefined) state = prepare(state);
  return { state, unit };
}

describe('attackOutcome', () => {
  it('is the rules’ own damage at a roll of 1, for a unit without a kit', () => {
    const { state, unit } = duel(null, 'warrior');
    const outcome = attackOutcome(state, unit, LAND2)!;
    const attacker = state.units.find((other) => other.id === unit)!;
    const defender = state.units.find((other) => other.hex === LAND2)!;
    const attack = attackStrength(attacker, false, false, false);
    const defence = unitDefence(state, defender);
    expect(outcome).toEqual({ toDefender: combatDamage(attack, defence, 1), toAttacker: combatDamage(defence, attack, 1), capture: false });
    const mean = meanDamage(state, unit, LAND2);
    expect(Math.abs(mean.toDefender - outcome.toDefender)).toBeLessThan(1.2);
    expect(Math.abs(mean.toAttacker - outcome.toAttacker)).toBeLessThan(1.2);
  });

  it.each([
    // 齐's 技击士 attacks units harder
    ['qi', 'jijiInfantry'],
    // 渤泥's 吹箭猎手, a ranged unit, hits infantry harder
    ['boni', 'blowpipeHunter'],
    // 辽东's leader: stronger for every friend next to the unit
    ['liaodong', 'warrior'],
  ])('agrees with the rules for %s and counts its modifiers', (nation, type) => {
    const withFriend = (state: GameState): GameState =>
      edit(state, (draft) => {
        const free = topologyOf(draft.map).neighbors.slice(LAND * 6, LAND * 6 + 6).find(
          (hex) => hex >= 0 && hex !== LAND2 && !draft.units.some((other) => other.hex === hex) && topologyOf(draft.map).water[hex] === 0,
        )!;
        put(draft, 'warrior', SELF, free);
      });
    const kit = duel(nation, type, withFriend);
    const plain = duel(null, unitDef(type).replaces ?? type, withFriend);
    const outcome = attackOutcome(kit.state, kit.unit, LAND2)!;
    const without = attackOutcome(plain.state, plain.unit, LAND2)!;
    expect(outcome.toDefender).toBeGreaterThan(without.toDefender);
    const mean = meanDamage(kit.state, kit.unit, LAND2);
    expect(Math.abs(mean.toDefender - outcome.toDefender)).toBeLessThan(1.5);
    expect(Math.abs(mean.toAttacker - outcome.toAttacker)).toBeLessThan(1.5);
  });

  it('counts the defender’s modifiers: 交趾’s units hold better in forest', () => {
    const forest = (nation: string | null): GameState => {
      const game = labGame(nation, {
        tweak: (m) => {
          m.feature[LAND] = Feature.Forest;
        },
      });
      return edit(atWar(game.state), (draft) => {
        draft.units = draft.units.filter((other) => other.hex !== LAND && other.hex !== LAND2);
        put(draft, 'warrior', SELF, LAND);
        put(draft, 'warrior', FOE, LAND2);
      });
    };
    const attacker = (state: GameState): number => state.units.find((unit) => unit.hex === LAND2)!.id;
    const kit = forest('jiaozhi');
    const plain = forest(null);
    expect(attackOutcome(kit, attacker(kit), LAND)!.toDefender).toBeLessThan(attackOutcome(plain, attacker(plain), LAND)!.toDefender);
  });

  it('counts the penalty for attacking from the water, and what 东宁’s 铁人军 takes off it', () => {
    const afloat = (nation: string | null, type: string): { state: GameState; unit: number } => {
      let unit = 0;
      const state = edit(atWar(labGame(nation).state), (draft) => {
        const topo = topologyOf(draft.map);
        const water = topo.neighbors.slice(LAND * 6, LAND * 6 + 6).find((hex) => hex >= 0 && topo.water[hex] === 1)!;
        draft.units = draft.units.filter((other) => other.hex !== LAND && other.hex !== water);
        unit = put(draft, type, SELF, water).id;
        put(draft, 'warrior', FOE, LAND);
      });
      return { state, unit };
    };
    const plain = afloat(null, 'musketeer');
    const ironMen = afloat('dongning', 'ironMen');
    const onLand = duel(null, 'musketeer');
    const fromWater = attackOutcome(plain.state, plain.unit, LAND)!;
    expect(fromWater.toDefender).toBeLessThan(attackOutcome(onLand.state, onLand.unit, LAND2)!.toDefender);
    expect(attackOutcome(ironMen.state, ironMen.unit, LAND)!.toDefender).toBeGreaterThan(fromWater.toDefender);
    const mean = meanDamage(plain.state, plain.unit, LAND);
    expect(Math.abs(mean.toDefender - fromWater.toDefender)).toBeLessThan(1.2);
  });

  it('works the fight out from the hex the unit would attack from', () => {
    // 越's 鸳鸯阵兵 is stronger for each friend next to it: next to nobody, the unit itself must not count
    const base = edit(atWar(labGame('yue').state), (draft) => {
      draft.units = draft.units.filter((unit) => unit.owner !== SELF && unit.owner !== FOE);
    });
    const topo = topologyOf(base.map);
    const around = (hex: number): number[] => [...topo.neighbors.slice(hex * 6, hex * 6 + 6)].filter((next) => next >= 0);
    const from = around(LAND).find((hex) => hex !== LAND2 && around(LAND2).includes(hex) && topo.water[hex] === 0)!;
    let unit = 0;
    const state = edit(base, (draft) => {
      unit = put(draft, 'mandarinDuckInfantry', SELF, LAND).id;
      put(draft, 'warrior', FOE, LAND2);
    });
    const moved = edit(state, (draft) => {
      draft.units.find((other) => other.id === unit)!.hex = from;
    });
    expect(attackOutcome(state, unit, LAND2, from)).toEqual(attackOutcome(moved, unit, LAND2));
    expect(attackOutcome(state, unit, LAND2, LAND)).toEqual(attackOutcome(state, unit, LAND2));
  });

  it('takes a fallen city and refuses what is no enemy', () => {
    const { state, unit } = duel(null, 'warrior');
    expect(attackOutcome(state, unit, LAND)).toBeNull();
    expect(attackOutcome(state, 9999, LAND2)).toBeNull();
    expect(attackOutcome(state, unit, -1)).toBeNull();
    const fallen = edit(state, (draft) => {
      draft.units = draft.units.filter((other) => other.hex !== FOE_SITE);
      draft.cities[FOE_ZONE]!.hp = 0;
    });
    expect(attackOutcome(fallen, unit, FOE_SITE)).toEqual({ toDefender: 0, toAttacker: 0, capture: true });
    const standing = attackOutcome(state, unit, FOE_SITE)!;
    expect(standing.capture).toBe(false);
    expect(standing.toDefender).toBeGreaterThan(0);
    const peace = edit(state, (draft) => {
      draft.relations[`${SELF}:${FOE}`]!.atWar = false;
    });
    expect(attackOutcome(peace, unit, LAND2)).toBeNull();
  });
});

describe('upgradeOffer', () => {
  it('is the price the rules take: 潇湘’s leader makes upgrades cheaper', () => {
    const offer = (nation: string | null): { plain: number; offer: number; paid: number } => {
      let unit = 0;
      const state = edit(labGame(nation).state, (draft) => {
        draft.units = draft.units.filter((other) => other.hex !== LAND);
        unit = put(draft, 'warrior', SELF, LAND).id;
        draft.polities[SELF]!.gold = 1000;
      });
      const result = applyAction(state, { type: 'upgrade', polity: SELF, unit });
      if (!result.ok) throw new Error(result.reason);
      return {
        plain: unitUpgrade(state, unit)!.gold,
        offer: upgradeOffer(state, unit)!.gold,
        paid: 1000 - result.state.polities[SELF]!.gold,
      };
    };
    const xiaoxiang = offer('xiaoxiang');
    expect(xiaoxiang.offer).toBe(xiaoxiang.paid);
    expect(xiaoxiang.offer).toBeLessThan(xiaoxiang.plain);
    const none = offer(null);
    expect(none.offer).toBe(none.paid);
    expect(none.offer).toBe(none.plain);
    expect(upgradeOffer(labGame(null).state, 9999)).toBeNull();
  });
});

describe('improvementSites', () => {
  it('lists the hexes a city works, and every hex the rules let it improve is among them', () => {
    const { state } = labGame(null);
    const sites = improvementSites(state, HOME_ZONE);
    expect(sites).toEqual(topologyOf(state.map).workHexes[HOME_ZONE]);
    expect(sites).toContain(LAND);
    const legal = (hex: number): boolean =>
      checkAction(state, { type: 'queueBuild', polity: SELF, city: HOME_ZONE, item: { kind: 'improvement', improvement: 'farm', hex } }) === null;
    expect(sites.some(legal)).toBe(true);
    for (let hex = 0; hex < state.map.width * state.map.height; hex++) {
      if (legal(hex)) expect(sites, String(hex)).toContain(hex);
    }
    expect(improvementSites(state, 9999)).toEqual([]);
  });
});

describe('activeRoadUpgrade and eraOfPolity', () => {
  it('names 秦’s highway once it knows Currency, and nobody else’s', () => {
    expect(activeRoadUpgrade(labGame('qin').state, SELF)).toBe('imperialHighway');
    expect(activeRoadUpgrade(labGame('qin', { techs: [] }).state, SELF)).toBeNull();
    expect(activeRoadUpgrade(labGame('yan').state, SELF)).toBeNull();
    expect(activeRoadUpgrade(labGame(null).state, SELF)).toBeNull();
    expect(activeRoadUpgrade(labGame('qin').state, 9999)).toBeNull();
  });

  it('reads the era a polity has reached', () => {
    const state = edit(labGame(null).state, (draft) => {
      draft.polities[SELF]!.era = 3;
    });
    expect(eraOfPolity(state, SELF)).toBe(3);
    expect(eraOfPolity(state, -1)).toBe(0);
  });
});
