import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { execute, validate } from './actions.ts';
import { amphibiousFactor } from './combat.ts';
import { cloneState, createCtx } from './context.ts';
import { COMBAT, POLICIES, POLICY_IDS } from './data.ts';
import { applyAction, createGame } from './game.ts';
import { modsOf, policyModifiers } from './modifiers.ts';
import { around, edit, learn, put, withPolicy } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);

describe('policy cards as modifiers', () => {
  it('turns every effect of every card into a modifier', () => {
    for (const id of POLICY_IDS) {
      const def: Record<string, unknown> = { ...POLICIES[id] };
      const effects = Object.keys(def).filter((key) => key !== 'era' && key !== 'kind');
      let expected = 0;
      for (const key of effects) {
        const value = def[key];
        // An effect keyed by improvement or building gives one modifier per key.
        const keyed = key === 'improvementYields' || key === 'buildingYields' || key === 'buildingPercent';
        expected += keyed ? Object.keys(value as object).length : 1;
      }
      expect(policyModifiers(id).length, id).toBe(expected);
      expect(expected, id).toBeGreaterThan(0);
    }
  });

  it('gives a polity the modifiers of its slotted cards, and only those', () => {
    const base = createGame(map, { seed: 1 });
    expect(modsOf(createCtx(cloneState(base)), 0, 'hexYield')).toEqual([]);
    const state = withPolicy(base, 0, 'wellField');
    expect(modsOf(createCtx(cloneState(state)), 0, 'hexYield')).toEqual([
      { type: 'hexYield', yields: { food: 1 }, hex: { improvement: ['farm'] } },
    ]);
    expect(modsOf(createCtx(cloneState(state)), 1, 'hexYield')).toEqual([]);
  });

  it('follows a card into and out of a slot inside one context', () => {
    const state = edit(createGame(map, { seed: 1 }), (draft) => {
      draft.polities[0]!.policies.push('citizenLevy');
    });
    const ctx = createCtx(cloneState(state));
    expect(modsOf(ctx, 0, 'production')).toHaveLength(0);
    execute(ctx, { type: 'slotPolicy', polity: 0, policy: 'citizenLevy', slot: 0 });
    expect(modsOf(ctx, 0, 'production')).toHaveLength(1);
    execute(ctx, { type: 'slotPolicy', polity: 0, policy: null, slot: 0 });
    expect(modsOf(ctx, 0, 'production')).toHaveLength(0);
  });
});

describe('attacking from the water', () => {
  /** A coast hex next to a free land hex of a nation other than polity 0, and that nation. */
  function shore(): [number, number, number] {
    for (let zone = 0; zone < map.zones.length; zone++) {
      const owner = map.zones[zone]!.polity;
      if (owner === 0 || map.polities[owner]!.kind !== 'nation') continue;
      for (const land of topo.zoneHexes[zone]!) {
        if (topo.water[land] === 1 || topo.enterable[land] !== 1 || topo.siteZone[land] !== -1) continue;
        for (const water of around(map, land)) {
          if (topo.water[water] === 1 && topo.enterable[water] === 1) return [water, land, owner];
        }
      }
    }
    throw new Error('the fixture has no foreign shore');
  }

  it('lets an embarked melee unit storm the land next to it, at the amphibious penalty', () => {
    const [water, land, foe] = shore();
    let attacker = 0;
    const state = edit(learn(createGame(map, { seed: 4 }), 'all'), (draft) => {
      attacker = put(draft, 'warrior', 0, water).id;
      put(draft, 'warrior', foe, land);
      draft.relations[`0:${foe}`] = { a: 0, b: foe, atWar: true, since: 1, offerA: 0, offerB: 0 };
    });
    const ctx = createCtx(cloneState(state));
    const unit = ctx.unitById.get(attacker)!;
    expect(amphibiousFactor(ctx, unit)).toBe(1 + COMBAT.amphibiousPercent / 100);
    expect(validate(ctx, { type: 'attack', polity: 0, unit: attacker, target: land })).toBeNull();
    const result = applyAction(state, { type: 'attack', polity: 0, unit: attacker, target: land });
    expect(result.ok).toBe(true);
    expect(result.events.some((event) => event.type === 'combat')).toBe(true);
  });

  it('does not let an embarked ranged unit shoot', () => {
    const [water, land, foe] = shore();
    let archer = 0;
    const state = edit(learn(createGame(map, { seed: 4 }), 'all'), (draft) => {
      archer = put(draft, 'archer', 0, water).id;
      put(draft, 'warrior', foe, land);
      draft.relations[`0:${foe}`] = { a: 0, b: foe, atWar: true, since: 1, offerA: 0, offerB: 0 };
    });
    expect(applyAction(state, { type: 'attack', polity: 0, unit: archer, target: land })).toMatchObject({
      ok: false,
      reason: 'cannotAttack',
    });
  });
});
