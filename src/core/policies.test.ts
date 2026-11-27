import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { productionTowards } from './cities.ts';
import { combatFactor } from './combat.ts';
import { cloneState, createCtx } from './context.ts';
import type { Ctx } from './context.ts';
import { CITY_STATE, DIPLOMACY, POLICIES, POLICY, POLICY_IDS, policyCost } from './data.ts';
import type { PolicyId } from './data.ts';
import { applyAction, createGame, endTurn } from './game.ts';
import type { Action, BuildItem, City, GameEvent, GameState, TradeRoute, Unit } from './game.ts';
import { policySlots } from './policies.ts';
import {
  apply,
  applyWithEvents,
  around,
  edit,
  isPlainGround,
  learn,
  put,
  withAgreement,
  withCity,
  withPolicy,
  yieldsOf,
} from './testUtil.ts';
import { topologyOf } from './topology.ts';
import { routeIncome } from './trade.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const WUCHENG = 4;
/** Jia's capital and its second site, Yi's capital. */
const JIADU = 0;
const JIABEI = 1;
const YIDU = 3;
const site = (zone: number): number => map.zones[zone]!.siteHex;

/** Jia is the human player; nobody is a major, so no AI declares war or picks cards for Jia. */
const base = createGame(map, { seed: 3, player: 'jia', majors: [] });
const reason = (state: GameState, action: Action): string => {
  const result = applyAction(state, action);
  return result.ok ? 'ok' : result.reason;
};
const turns = (state: GameState, count: number): GameState => {
  let current = state;
  for (let i = 0; i < count; i++) current = endTurn(current).state;
  return current;
};
const ctxOf = (state: GameState): Ctx => createCtx(cloneState(state));
const cityOf = (ctx: Ctx, zone: number): City => ctx.state.cities[zone]!;
/** A state in which Jia has stored `culture` towards its next card. */
const cultured = (state: GameState, culture: number): GameState =>
  edit(state, (draft) => {
    draft.polities[JIA]!.cultureProgress = culture;
  });

describe('policy cards', () => {
  it('are 24: four per era, one of each kind', () => {
    expect(POLICY_IDS).toHaveLength(24);
    for (let era = 0; era < 6; era++) {
      const kinds = POLICY_IDS.filter((id) => POLICIES[id].era === era).map((id) => POLICIES[id].kind);
      expect(kinds.sort()).toEqual(['civil', 'diplomacy', 'economy', 'military']);
    }
  });

  it('are unlocked with culture, the first after about six turns', () => {
    expect(policyCost(0)).toBe(6);
    expect(base.polities[JIA]!.cultureProgress).toBe(0);
    expect(reason(base, { type: 'unlockPolicy', polity: JIA, policy: 'wellField' })).toBe('notEnoughCulture');
    // The capital gives one culture a turn at the start.
    const early = turns(base, 5);
    expect(early.polities[JIA]!.cultureProgress).toBe(5);
    expect(reason(early, { type: 'unlockPolicy', polity: JIA, policy: 'wellField' })).toBe('notEnoughCulture');
    const ready = turns(early, 1);
    const { state, events } = applyWithEvents(ready, { type: 'unlockPolicy', polity: JIA, policy: 'wellField' });
    expect(events).toContainEqual({ type: 'policyUnlocked', polity: JIA, policy: 'wellField' });
    const jia = state.polities[JIA]!;
    expect(jia.policies).toEqual(['wellField']);
    expect(jia.cultureProgress).toBe(ready.polities[JIA]!.cultureProgress - 6);
    expect(jia.freeSwaps).toBe(1);
    // Unlocking does not slot the card.
    expect(jia.slots).toEqual([null, null]);
  });

  it('cost more each time, so that the pace stays near one card every six turns as culture grows', () => {
    for (let n = 0; n < 23; n++) expect(policyCost(n + 1)).toBeGreaterThan(policyCost(n));
    expect(policyCost(1)).toBe(Math.round(POLICY.costBase + POLICY.costStep + POLICY.costCurve));
  });

  it('cannot be unlocked twice, before their era, or by a city-state', () => {
    const rich = cultured(base, 1000);
    expect(reason(rich, { type: 'unlockPolicy', polity: JIA, policy: 'commanderies' })).toBe('eraTooEarly');
    expect(reason(rich, { type: 'unlockPolicy', polity: JIA, policy: 'nonsense' as PolicyId })).toBe('badItem');
    const once = apply(rich, { type: 'unlockPolicy', polity: JIA, policy: 'clanLaw' });
    expect(reason(once, { type: 'unlockPolicy', polity: JIA, policy: 'clanLaw' })).toBe('alreadyUnlocked');
    expect(once.polities[JIA]!.cultureProgress).toBe(1000 - policyCost(0));
    const twice = apply(once, { type: 'unlockPolicy', polity: JIA, policy: 'covenant' });
    expect(twice.polities[JIA]!.cultureProgress).toBe(1000 - policyCost(0) - policyCost(1));
    const state = edit(rich, (draft) => {
      draft.polities[WUCHENG]!.cultureProgress = 1000;
    });
    expect(reason(state, { type: 'unlockPolicy', polity: WUCHENG, policy: 'clanLaw' })).toBe('noPolicies');
    // A card of a later era opens with the era.
    const classical = learn(rich, JIA, ['farming', 'husbandry', 'mining', 'archery']);
    expect(classical.polities[JIA]!.era).toBe(1);
    expect(reason(classical, { type: 'unlockPolicy', polity: JIA, policy: 'commanderies' })).toBe('ok');
  });

  it('go into slots that grow with the era from 2 to 6', () => {
    expect([0, 1, 2, 3, 4, 5].map(policySlots)).toEqual([2, 3, 4, 5, 6, 6]);
    expect(POLICY.slotsByEra).toEqual([2, 3, 4, 5, 6, 6]);
    expect(base.polities[JIA]!.slots).toEqual([null, null]);
    expect(base.polities[WUCHENG]!.slots).toEqual([]);
    const classical = learn(base, JIA, ['farming', 'husbandry', 'mining', 'archery']);
    expect(classical.polities[JIA]!.slots).toHaveLength(3);
    const modern = learn(base, JIA);
    expect(modern.polities[JIA]!.era).toBe(5);
    expect(modern.polities[JIA]!.slots).toHaveLength(6);
    // A slotted card stays where it is when the slots grow.
    const kept = learn(withPolicy(base, JIA, 'clanLaw'), JIA);
    expect(kept.polities[JIA]!.slots).toEqual(['clanLaw', null, null, null, null, null]);
  });

  it('fill an empty slot freely, and only unlocked cards that are not slotted yet', () => {
    let state = cultured(base, 1000);
    state = apply(state, { type: 'unlockPolicy', polity: JIA, policy: 'clanLaw' });
    expect(reason(state, { type: 'slotPolicy', polity: JIA, policy: 'covenant', slot: 0 })).toBe('notUnlocked');
    expect(reason(state, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 2 })).toBe('badSlot');
    expect(reason(state, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: -1 })).toBe('badSlot');
    expect(reason(state, { type: 'slotPolicy', polity: JIA, policy: null, slot: 0 })).toBe('alreadySlotted');
    const { state: slotted, events } = applyWithEvents(state, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 1 });
    expect(events).toEqual([{ type: 'policySlotted', polity: JIA, slot: 1, policy: 'clanLaw', replaced: null }]);
    expect(slotted.polities[JIA]!.slots).toEqual([null, 'clanLaw']);
    // Filling an empty slot is not a swap: the free swap is still there.
    expect(slotted.polities[JIA]!.freeSwaps).toBe(1);
    expect(reason(slotted, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 0 })).toBe('alreadySlotted');
    const emptied = apply(slotted, { type: 'slotPolicy', polity: JIA, policy: null, slot: 1 });
    expect(emptied.polities[JIA]!.slots).toEqual([null, null]);
  });

  it('swap once for free per card unlocked; any other swap starts a five-turn cooldown', () => {
    expect(POLICY.swapCooldown).toBe(5);
    let state = cultured(base, 1000);
    for (const policy of ['clanLaw', 'covenant', 'wellField'] as const) {
      state = apply(state, { type: 'unlockPolicy', polity: JIA, policy });
    }
    state = edit(state, (draft) => {
      draft.polities[JIA]!.freeSwaps = 1;
    });
    state = apply(state, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 0 });
    state = apply(state, { type: 'slotPolicy', polity: JIA, policy: 'covenant', slot: 1 });
    // The free swap.
    state = apply(state, { type: 'slotPolicy', polity: JIA, policy: 'wellField', slot: 0 });
    expect(state.polities[JIA]!.freeSwaps).toBe(0);
    expect(state.polities[JIA]!.swapReadyOn).toBe(0);
    // A paid swap is allowed, and starts the cooldown.
    const { state: paid, events } = applyWithEvents(state, { type: 'slotPolicy', polity: JIA, policy: 'clanLaw', slot: 1 });
    expect(events).toEqual([{ type: 'policySlotted', polity: JIA, slot: 1, policy: 'clanLaw', replaced: 'covenant' }]);
    expect(paid.polities[JIA]!.swapReadyOn).toBe(paid.turn + 5);
    expect(reason(paid, { type: 'slotPolicy', polity: JIA, policy: 'covenant', slot: 0 })).toBe('swapCooldown');
    const waiting = turns(paid, 4);
    expect(reason(waiting, { type: 'slotPolicy', polity: JIA, policy: 'covenant', slot: 0 })).toBe('swapCooldown');
    const over = turns(waiting, 1);
    expect(reason(over, { type: 'slotPolicy', polity: JIA, policy: 'covenant', slot: 0 })).toBe('ok');
    // Unlocking another card during the cooldown gives a free swap at once.
    const unlocked = apply(cultured(waiting, 1000), { type: 'unlockPolicy', polity: JIA, policy: 'citizenLevy' });
    expect(reason(unlocked, { type: 'slotPolicy', polity: JIA, policy: 'citizenLevy', slot: 0 })).toBe('ok');
  });

  it('do nothing while they are only unlocked', () => {
    const unlocked = edit(base, (draft) => {
      draft.polities[JIA]!.policies.push('clanLaw');
    });
    expect(yieldsOf(unlocked, JIADU).culture).toBe(yieldsOf(base, JIADU).culture);
  });
});

// ------------------------------------------------------------ every card

/** A city of `pop` citizens with the given buildings and focus, for yields large enough to show a percentage. */
const grown = (state: GameState, zone: number, pop: number, buildings: City['buildings'] = [], focus: City['focus'] = 'balanced'): GameState =>
  edit(state, (draft) => {
    const city = draft.cities[zone]!;
    city.pop = pop;
    city.buildings = [...buildings];
    city.focus = focus;
  });
const production = (state: GameState, zone: number, item: BuildItem): number => {
  const ctx = ctxOf(state);
  const city = cityOf(ctx, zone);
  city.yields.production = 100;
  return productionTowards(ctx, city, item);
};
const factor = (state: GameState, type: string, hex: number, enemy: number): number => {
  const ctx = ctxOf(state);
  const unit: Unit = { id: 999, type, owner: JIA, hex, hp: 100, moves: 2, xp: 0, level: 0, status: 'ready', acted: false };
  return combatFactor(ctx, unit, enemy);
};
const route = (extra: Partial<TradeRoute>): TradeRoute => ({
  id: 1, owner: JIA, from: JIADU, toCity: YIDU, toPort: -1, sea: false, path: [1, 2, 3, 4, 5, 6], income: 0, pillagedUntil: 0, ...extra,
});
const income = (state: GameState, extra: Partial<TradeRoute> = {}): number => routeIncome(ctxOf(state), route(extra));
const jiaLand = around(map, site(JIADU)).find((hex) => isPlainGround(map, hex))!;
const yiLand = around(map, site(YIDU)).find((hex) => isPlainGround(map, hex))!;
/** Jia with a second city, so that capital and non-capital differ. */
const twoCities = withCity(base, JIABEI, JIA);

/**
 * One check per card: each compares a number with the card in a slot against
 * the same number without it. The record's type makes a card without a check
 * a compile error.
 */
const CARD_CHECKS: Record<PolicyId, (card: PolicyId) => void> = {
  wellField: (card) => {
    // One citizen under the food focus works the best food hex: the farm.
    const farmHex = topo.workHexes[JIADU]!.find((hex) => isPlainGround(map, hex) && map.terrain[hex] === 4)!;
    const state = edit(grown(base, JIADU, 1, [], 'food'), (draft) => {
      draft.improvements[farmHex] = 'farm';
    });
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).food).toBe(yieldsOf(state, JIADU).food + 1);
  },
  citizenLevy: (card) => {
    const state = withPolicy(base, JIA, card);
    expect(production(base, JIADU, { kind: 'unit', unit: 'warrior' })).toBe(100);
    expect(production(state, JIADU, { kind: 'unit', unit: 'warrior' })).toBe(115);
    expect(production(state, JIADU, { kind: 'building', building: 'granary' })).toBe(100);
  },
  clanLaw: (card) => {
    const state = withPolicy(twoCities, JIA, card);
    expect(yieldsOf(state, JIADU).culture).toBe(yieldsOf(twoCities, JIADU).culture + 2);
    expect(yieldsOf(state, JIABEI).culture).toBe(yieldsOf(twoCities, JIABEI).culture);
  },
  covenant: (card) => {
    const rich = edit(base, (draft) => {
      draft.polities[JIA]!.gold = 100;
    });
    const gift: Action = { type: 'gift', polity: JIA, target: WUCHENG, amount: 40 };
    const plain = 40 / CITY_STATE.goldPerInfluence;
    expect(apply(rich, gift).polities[WUCHENG]!.influence[JIA]).toBe(plain);
    expect(apply(withPolicy(rich, JIA, card), gift).polities[WUCHENG]!.influence[JIA]).toBe(plain * 1.25);
  },
  commanderies: (card) => {
    const state = grown(grown(twoCities, JIABEI, 12, [], 'production'), JIADU, 12, [], 'production');
    const without = yieldsOf(state, JIABEI).production;
    expect(without).toBeGreaterThanOrEqual(10);
    const carded = withPolicy(state, JIA, card);
    expect(yieldsOf(carded, JIABEI).production).toBe(Math.floor((without * 110) / 100));
    expect(yieldsOf(carded, JIADU).production).toBe(yieldsOf(state, JIADU).production);
  },
  meritRanks: (card) => {
    const fight = (state: GameState): GameState => {
      let attacker = 0;
      const ready = edit(state, (draft) => {
        draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 1, offerA: 0, offerB: 0 };
        const [from, to] = around(map, jiaLand)
          .filter((hex) => isPlainGround(map, hex))
          .map((hex) => [jiaLand, hex] as const)[0]!;
        attacker = put(draft, 'swordsman', JIA, from).id;
        put(draft, 'warrior', YI, to, { hp: 1 });
      });
      const target = ready.units[ready.units.length - 1]!.hex;
      return apply(ready, { type: 'attack', polity: JIA, unit: attacker, target });
    };
    const without = fight(base).polities[JIA]!;
    const carded = fight(withPolicy(base, JIA, card)).polities[JIA]!;
    expect(without.culture).toBe(0);
    expect(carded.culture).toBe(5);
    expect(carded.cultureProgress).toBe(5);
  },
  hundredSchools: (card) => {
    const state = grown(base, JIADU, 4, ['academy']);
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).science).toBe(yieldsOf(state, JIADU).science + 2);
    expect(yieldsOf(withPolicy(base, JIA, card), JIADU).science).toBe(yieldsOf(base, JIADU).science);
  },
  alliances: (card) => {
    // Jia is allied with Yi, and Yi is at war with Bing: against Bing they fight together.
    const allied = edit(withAgreement(base, 'alliance', JIA, YI), (draft) => {
      draft.relations[`${YI}:${BING}`] = { a: YI, b: BING, atWar: true, since: 1, offerA: 0, offerB: 0 };
    });
    expect(factor(allied, 'warrior', jiaLand, BING)).toBe(1);
    const carded = withPolicy(allied, JIA, card);
    expect(factor(carded, 'warrior', jiaLand, BING)).toBeCloseTo(1.05);
    expect(factor(carded, 'warrior', jiaLand, DING)).toBe(1);
    expect(factor(withPolicy(base, JIA, card), 'warrior', jiaLand, BING)).toBe(1);
  },
  twoTax: (card) => {
    const state = grown(base, JIADU, 18, [], 'gold');
    const without = yieldsOf(state, JIADU).gold;
    expect(without).toBeGreaterThanOrEqual(10);
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).gold).toBe(Math.floor((without * 110) / 100));
  },
  paidArmy: (card) => {
    // One city keeps two units for free; ten more cost one gold each.
    const armed = edit(base, (draft) => {
      draft.polities[JIA]!.gold = 1000;
      const free = topo.zoneHexes[JIADU]!.filter(
        (hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex),
      );
      for (let i = 0; i < 11; i++) put(draft, 'warrior', JIA, free[i]!);
    });
    expect(endTurn(armed).state.polities[JIA]!.upkeep).toBe(10);
    expect(endTurn(withPolicy(armed, JIA, card)).state.polities[JIA]!.upkeep).toBe(8);
  },
  imperialExam: (card) => {
    const state = grown(base, JIADU, 4, ['academy', 'printShop']);
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).culture).toBe(yieldsOf(state, JIADU).culture + 2);
    const one = grown(base, JIADU, 4, ['academy']);
    expect(yieldsOf(withPolicy(one, JIA, card), JIADU).culture).toBe(yieldsOf(one, JIADU).culture + 1);
  },
  tribute: (card) => {
    const vassal = withAgreement(grown(base, YIDU, 18, [], 'gold'), 'vassalage', JIA, YI);
    const plain = endTurn(vassal).state;
    const yiIncome = plain.polities[YI]!.yields.gold;
    expect(yiIncome).toBeGreaterThanOrEqual(10);
    expect(plain.polities[JIA]!.tributeReceived).toBe(Math.floor((yiIncome * DIPLOMACY.vassalTributePercent) / 100));
    const carded = endTurn(withPolicy(vassal, JIA, card)).state;
    expect(carded.polities[JIA]!.tributeReceived).toBe(Math.floor((yiIncome * 30) / 100));
    expect(carded.polities[YI]!.tributePaid).toBe(Math.floor((yiIncome * 30) / 100));
  },
  singleWhip: (card) => {
    // Two gold for each, raised by the 50% the two buildings give.
    const state = grown(base, JIADU, 4, ['market', 'bank']);
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).gold).toBe(yieldsOf(state, JIADU).gold + 6);
    expect(yieldsOf(withPolicy(base, JIA, card), JIADU).gold).toBe(yieldsOf(base, JIADU).gold);
  },
  firearmsCorps: (card) => {
    const state = withPolicy(base, JIA, card);
    expect(factor(base, 'musketeer', yiLand, YI)).toBe(1);
    expect(factor(state, 'musketeer', yiLand, YI)).toBeCloseTo(1.05);
    expect(factor(state, 'rifleman', yiLand, YI)).toBeCloseTo(1.05);
    expect(factor(state, 'warrior', yiLand, YI)).toBe(1);
    expect(factor(state, 'tank', yiLand, YI)).toBe(1);
  },
  academyLectures: (card) => {
    const state = grown(base, JIADU, 4, ['university']);
    const gain = yieldsOf(withPolicy(state, JIA, card), JIADU).science - yieldsOf(state, JIADU).science;
    // Three science, raised by the university's own 25%.
    expect(gain).toBeGreaterThanOrEqual(3);
    expect(gain).toBeLessThanOrEqual(4);
    expect(yieldsOf(withPolicy(base, JIA, card), JIADU).science).toBe(yieldsOf(base, JIADU).science);
  },
  openSeas: (card) => {
    const state = withPolicy(base, JIA, card);
    expect(income(state, { sea: true })).toBe(income(base, { sea: true }) + 2);
    expect(income(state, { sea: false })).toBe(income(base, { sea: false }));
  },
  industryFirst: (card) => {
    const plain = grown(base, JIADU, 12, [], 'production');
    const raw = yieldsOf(plain, JIADU).production + 4;
    const state = grown(base, JIADU, 12, ['factory'], 'production');
    expect(yieldsOf(state, JIADU).production).toBe(Math.floor((raw * 125) / 100));
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).production).toBe(Math.floor((raw * 140) / 100));
    expect(yieldsOf(withPolicy(plain, JIA, card), JIADU).production).toBe(raw - 4);
  },
  newArmy: (card) => {
    const state = withPolicy(base, JIA, card);
    expect(production(base, JIADU, { kind: 'unit', unit: 'rifleman' })).toBe(100);
    expect(production(state, JIADU, { kind: 'unit', unit: 'rifleman' })).toBe(120);
    expect(production(state, JIADU, { kind: 'unit', unit: 'tank' })).toBe(120);
    expect(production(state, JIADU, { kind: 'unit', unit: 'musketeer' })).toBe(100);
    expect(production(state, JIADU, { kind: 'unit', unit: 'ironclad' })).toBe(100);
  },
  newSchools: (card) => {
    const state = grown(base, JIADU, 10);
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).science).toBe(yieldsOf(state, JIADU).science + 2);
  },
  treatyPorts: (card) => {
    const big = grown(grown(base, JIADU, 18, [], 'gold'), YIDU, 18, [], 'gold');
    const pact = withAgreement(big, 'tradePact', JIA, YI);
    const carded = withPolicy(pact, JIA, card);
    for (const zone of [JIADU, YIDU]) {
      const without = yieldsOf(pact, zone).gold;
      expect(without).toBeGreaterThanOrEqual(10);
      expect(yieldsOf(carded, zone).gold).toBe(Math.floor((without * 110) / 100));
    }
    // Without a trade pact the card does nothing.
    expect(yieldsOf(withPolicy(big, JIA, card), JIADU).gold).toBe(yieldsOf(big, JIADU).gold);
  },
  industrialPlanning: (card) => {
    const state = withPolicy(base, JIA, card);
    expect(production(state, JIADU, { kind: 'building', building: 'granary' })).toBe(115);
    expect(production(state, JIADU, { kind: 'unit', unit: 'warrior' })).toBe(100);
    expect(production(base, JIADU, { kind: 'building', building: 'granary' })).toBe(100);
  },
  totalDefence: (card) => {
    const state = withPolicy(base, JIA, card);
    expect(factor(base, 'warrior', jiaLand, YI)).toBe(1);
    expect(factor(state, 'warrior', jiaLand, YI)).toBeCloseTo(1.1);
    expect(factor(state, 'warrior', yiLand, YI)).toBe(1);
  },
  compulsoryEducation: (card) => {
    const state = grown(base, JIADU, 12, ['academy']);
    const without = yieldsOf(state, JIADU).science;
    expect(without).toBeGreaterThanOrEqual(10);
    expect(yieldsOf(withPolicy(state, JIA, card), JIADU).science).toBe(Math.floor((without * 110) / 100));
  },
  regionalCooperation: (card) => {
    const allied = withAgreement(base, 'alliance', JIA, YI);
    const plain = income(allied);
    expect(plain).toBeGreaterThan(0);
    expect(income(withPolicy(allied, JIA, card))).toBe(plain * 2);
    // Only routes to an ally's city are doubled.
    expect(income(withPolicy(base, JIA, card))).toBe(income(base));
  },
};

describe('each policy card changes the number it should', () => {
  it.each(POLICY_IDS)('%s', (card) => {
    CARD_CHECKS[card](card);
  });

  it('applies in combat itself: a home unit with Total defence takes less damage', () => {
    const damageTaken = (state: GameState): number => {
      let attacker = 0;
      let defenderHex = 0;
      const ready = edit(state, (draft) => {
        draft.relations[`${JIA}:${YI}`] = { a: JIA, b: YI, atWar: true, since: 1, offerA: 0, offerB: 0 };
        defenderHex = jiaLand;
        const from = around(map, jiaLand).find((hex) => isPlainGround(map, hex))!;
        put(draft, 'warrior', JIA, defenderHex);
        attacker = put(draft, 'warrior', YI, from).id;
      });
      const events: GameEvent[] = applyWithEvents(ready, { type: 'attack', polity: YI, unit: attacker, target: defenderHex }).events;
      const combat = events.find((event): event is Extract<GameEvent, { type: 'combat' }> => event.type === 'combat')!;
      return combat.damageToDefender;
    };
    expect(damageTaken(withPolicy(base, JIA, 'totalDefence'))).toBeLessThan(damageTaken(base));
  });
});
