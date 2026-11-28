import { describe, expect, it } from 'vitest';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { checkStep, execute, validate } from './actions.ts';
import { runAi, stepKnown } from './ai.ts';
import { cloneState, createCtx } from './context.ts';
import {
  AI,
  BALANCE,
  CAPITAL_PERCENT,
  DIPLOMACY,
  FAVOUR,
  RESEARCH,
  SUPPLY,
  TECHS,
  TECH_IDS,
  supplyLimitFor,
  supplySurcharge,
} from './data.ts';
import { favourStandings, vassalLeaves } from './diplomacy.ts';
import { createGame, endTurn, hashState, loadGame, researchCost, saveGame, supplyStatus } from './game.ts';
import type { Action, GameEvent, GameState } from './game.ts';
import { balanceOfPower, fearFor, leakPercent } from './power.ts';
import { favourStanding } from './query.ts';
import { realmPercent } from './tech.ts';
import { around, edit, isPlainGround, put, withAgreement, yieldsOf } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const NATIONS = [JIA, YI, BING, DING];
const site = (zone: number): number => map.zones[zone]!.siteHex;
const seat = (polity: number): number => site(map.polities[polity]!.capitalZone);
const apart = (a: number, b: number): number => hexDistance(indexToOffset(a, map.width), indexToOffset(b, map.width));
const key = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`;
const of = <T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] =>
  events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
const freeLand = (state: GameState, polity: number): number[] =>
  topo.zoneHexes[map.polities[polity]!.capitalZone]!.filter(
    (hex) => isPlainGround(map, hex) && hex !== seat(polity) && !state.units.some((unit) => unit.hex === hex),
  );

/** All four nations are in the race, nobody plays, and the game is past the turn from which fear counts in full. */
const four = edit(createGame(map, { seed: 2, majors: ['jia', 'yi', 'bing', 'ding'] }), (draft) => {
  draft.turn = BALANCE.fullTurn + 10;
  for (const polity of NATIONS) draft.polities[polity]!.grossIncome = 1000;
});
/** The same game with Jia's income at `income` against 1000 for each of the others. */
const jiaEarns = (income: number, from: GameState = four): GameState =>
  edit(from, (draft) => {
    draft.polities[JIA]!.grossIncome = income;
  });
/** Jia has earned three times what the others have: a complete lead. */
const runaway = jiaEarns(3000);
const balanceOf = (state: GameState): ReturnType<typeof balanceOfPower> => balanceOfPower(createCtx(cloneState(state)));

describe('the balance of power: standing and fear', () => {
  it('measures every nation in the race against the average on each track', () => {
    const balance = balanceOf(runaway);
    // 3000 against an average of 1500.
    expect(balance.ratios[JIA]!.income).toBeCloseTo(2);
    expect(balance.ratios[YI]!.income).toBeCloseTo(1000 / 1500);
    expect(balance.fear[JIA]).toBe(BALANCE.maxFear);
    expect(balance.lead[JIA]).toBe('income');
    for (const polity of [YI, BING, DING]) {
      expect(balance.fear[polity]).toBe(0);
      expect(balance.lead[polity]).toBeNull();
    }
    // Nobody is feared while nobody is ahead.
    expect(balanceOf(four).fear.every((fear) => fear === 0)).toBe(true);
  });

  it('fears a leader more the further ahead it is', () => {
    const fears = [1000, 1400, 1700, 2000, 2600, 3000, 6000].map((income) => balanceOf(jiaEarns(income)).fear[JIA]!);
    for (let i = 1; i < fears.length; i++) expect(fears[i]).toBeGreaterThanOrEqual(fears[i - 1]!);
    expect(fears[0]).toBe(0);
    expect(fears[2]).toBeGreaterThan(0);
    expect(fears[2]).toBeLessThan(fears[4]!);
    expect(fears[fears.length - 1]).toBe(BALANCE.maxFear);
    const { from, full } = BALANCE.tracks.income;
    expect(fearFor('income', from, 100)).toBe(0);
    expect(fearFor('income', (from + full) / 2, 100)).toBe(BALANCE.maxFear / 2);
    expect(fearFor('income', full, 100)).toBe(BALANCE.maxFear);
  });

  it('counts for nothing in the first turns and grows with the game', () => {
    const on = (turn: number): number =>
      balanceOf(edit(runaway, (draft) => {
        draft.turn = turn;
      })).fear[JIA]!;
    expect(on(BALANCE.fromTurn - 1)).toBe(0);
    expect(on(BALANCE.fromTurn)).toBeGreaterThan(0);
    expect(on(BALANCE.fullTurn / 2)).toBe(BALANCE.maxFear / 2);
    expect(on(BALANCE.fullTurn)).toBe(BALANCE.maxFear);
    expect(on(BALANCE.fullTurn + 30)).toBe(BALANCE.maxFear);
  });

  it('has a track for science and one for the army, and adds to the fear for every project stage', () => {
    const learned = edit(four, (draft) => {
      for (const polity of NATIONS) draft.polities[polity]!.science = polity === YI ? 5000 : 1000;
    });
    expect(balanceOf(learned).lead[YI]).toBe('science');
    expect(balanceOf(learned).fear[YI]).toBe(BALANCE.maxFear);
    const armed = edit(four, (draft) => {
      for (const hex of freeLand(draft, BING).slice(0, 12)) put(draft, 'warrior', BING, hex);
    });
    expect(balanceOf(armed).lead[BING]).toBe('army');
    expect(balanceOf(armed).fear[BING]).toBeGreaterThan(0);
    const staged = edit(four, (draft) => {
      draft.polities[DING]!.projectStage = 2;
    });
    expect(balanceOf(staged).fear[DING]).toBe(2 * BALANCE.fearPerStage);
    expect(balanceOf(staged).lead[DING]).toBe('science');
  });

  it('needs a rest of the world: with two in the race nobody is feared', () => {
    const two = edit(createGame(map, { seed: 2, majors: ['jia', 'yi'] }), (draft) => {
      draft.turn = 100;
      draft.polities[JIA]!.grossIncome = 5000;
      draft.polities[YI]!.grossIncome = 1000;
    });
    expect(BALANCE.minRated).toBe(3);
    expect(balanceOf(two).fear.every((fear) => fear === 0)).toBe(true);
  });
});

describe('the balance of power: favour', () => {
  it('shows the fear of a leader as a cause of the favour of every nation below it', () => {
    for (const other of [YI, BING, DING]) {
      const standing = favourStanding(runaway, JIA, other)!;
      expect(standing.power).toContainEqual({ cause: 'leader', value: -BALANCE.maxFear, polity: JIA });
      const sum = [...standing.terms, ...standing.power].reduce((total, term) => total + term.value, 0);
      expect(standing.target).toBe(Math.max(-FAVOUR.max, Math.min(FAVOUR.max, sum)));
      expect(standing.target).toBeLessThan(favourStanding(four, JIA, other)!.target);
    }
    // Without a lead there is no such cause.
    expect(favourStanding(four, JIA, YI)!.power).toEqual([]);
  });

  it('lets favour fall with the lead, one point a turn towards the level the causes add up to', () => {
    const settled = edit(runaway, (draft) => {
      for (const polity of draft.polities) polity.gold = 0;
    });
    const before = favourStanding(settled, JIA, DING)!;
    expect(before.favour).toBe(0);
    const next = endTurn(settled).state;
    expect(next.favour[key(JIA, DING)]).toBe(-FAVOUR.drift);
    // What the turn moved towards is what the query reports.
    const ctx = createCtx(cloneState(next));
    for (const [pair, entry] of favourStandings(ctx)) {
      const [a, b] = pair.split(':').map(Number) as [number, number];
      expect(favourStanding(next, a, b)!.target).toBe(entry.target);
    }
    // The larger the lead, the lower the level favour moves towards.
    const targets = [1000, 1800, 2400, 3000].map((income) => favourStanding(jiaEarns(income), JIA, DING)!.target);
    for (let i = 1; i < targets.length; i++) expect(targets[i]).toBeLessThanOrEqual(targets[i - 1]!);
    expect(targets[targets.length - 1]).toBeLessThan(targets[0]!);
  });

  it('draws those who stand against the same leader together, and shows it as a cause', () => {
    for (const [a, b] of [[YI, BING], [YI, DING], [BING, DING]] as const) {
      const standing = favourStanding(runaway, a, b)!;
      expect(standing.power).toContainEqual({ cause: 'commonThreat', value: BALANCE.commonThreat, polity: JIA });
      expect(standing.target).toBe(favourStanding(four, a, b)!.target + BALANCE.commonThreat);
    }
    // An ally of the leader does not stand against it.
    const bound = withAgreement(runaway, 'alliance', JIA, YI);
    expect(favourStanding(bound, YI, BING)!.power).toEqual([]);
    expect(favourStanding(bound, BING, DING)!.power).toHaveLength(1);
    // Nor does its vassal.
    const held = withAgreement(runaway, 'vassalage', JIA, DING);
    expect(favourStanding(held, DING, BING)!.power).toEqual([]);
    // A leader feared too little draws nobody together.
    const mild = jiaEarns(1500);
    expect(balanceOf(mild).fear[JIA]).toBeGreaterThan(0);
    expect(balanceOf(mild).fear[JIA]).toBeLessThan(BALANCE.commonThreatAt);
    expect(favourStanding(mild, YI, BING)!.power).toEqual([]);
  });

  it('makes an alliance against the leader possible where there was none', () => {
    // Two majors with a trade pact and open borders: not enough for an alliance, until both stand against a leader.
    const partners = (state: GameState): GameState =>
      withAgreement(withAgreement(state, 'tradePact', YI, BING), 'openBorders', YI, BING);
    const calm = favourStanding(partners(four), YI, BING)!.target;
    const threatened = favourStanding(partners(runaway), YI, BING)!.target;
    expect(calm).toBeLessThan(AI.allianceFavour);
    expect(threatened).toBeGreaterThanOrEqual(AI.allianceFavour);
    // And once favour is there, the AI signs: Bing accepts Yi's proposal.
    const friendly = edit(partners(runaway), (draft) => {
      draft.favour[key(YI, BING)] = threatened;
    });
    const ctx = createCtx(cloneState(friendly));
    expect(validate(ctx, { type: 'propose', polity: YI, target: BING, agreement: 'alliance' })).toBeNull();
    const cool = edit(partners(four), (draft) => {
      draft.favour[key(YI, BING)] = calm;
    });
    expect(validate(createCtx(cloneState(cool)), { type: 'propose', polity: YI, target: BING, agreement: 'alliance' })).toBe('refused');
  });
});

describe('the balance of power: war, vassals and knowledge', () => {
  /** Yi has an army; Jia is stronger than Yi's other neighbours, so a Yi that only looks for the weakest leaves it alone. */
  const armed = (state: GameState): GameState =>
    edit(state, (draft) => {
      for (const hex of freeLand(draft, YI).slice(0, 14)) put(draft, 'warrior', YI, hex);
      for (const hex of freeLand(draft, JIA).slice(0, 3)) put(draft, 'warrior', JIA, hex);
    });
  const declaredBy = (state: GameState, polity: number): number[] =>
    of(endTurn(state).events, 'warDeclared').filter((event) => event.by === polity).map((event) => event.on);

  it('makes an AI major prefer the feared leader as its war target', () => {
    const calm = declaredBy(armed(four), YI);
    expect(calm).toHaveLength(1);
    expect(calm[0]).not.toBe(JIA);
    expect(declaredBy(armed(runaway), YI)).toEqual([JIA]);
  });

  it('has an AI major join the war of containment once it dislikes the leader enough and its side is strong enough', () => {
    const disliked = (state: GameState, favour: number): GameState =>
      edit(state, (draft) => {
        draft.favour[key(JIA, YI)] = favour;
        // War weariness keeps Yi from any war of its own choosing, but not from this one.
        draft.polities[YI]!.warWeariness = AI.containmentWeariness;
      });
    expect(AI.containmentWeariness).toBeGreaterThan(0);
    expect(declaredBy(disliked(armed(runaway), BALANCE.warFavour), YI)).toEqual([JIA]);
    // Not while it still thinks well enough of the leader, ...
    expect(declaredBy(disliked(armed(runaway), BALANCE.warFavour + 5), YI)).toEqual([]);
    // ...not against a nation nobody fears, ...
    expect(declaredBy(disliked(armed(four), BALANCE.warFavour), YI)).toEqual([]);
    // ...and not when the leader's side is too strong for it.
    const outmatched = edit(disliked(runaway, BALANCE.warFavour), (draft) => {
      for (const hex of freeLand(draft, YI).slice(0, 3)) put(draft, 'warrior', YI, hex);
      for (const hex of freeLand(draft, JIA).slice(0, 12)) put(draft, 'warrior', JIA, hex);
    });
    expect(declaredBy(outmatched, YI)).toEqual([]);
  });

  it('lets a vassal drift away from an overlord it dislikes, unless the overlord overawes it', () => {
    const vassalage = (favour: number, overlordUnits = 0): GameState =>
      edit(withAgreement(runaway, 'vassalage', JIA, DING), (draft) => {
        draft.agreements[draft.agreements.length - 1]!.since = draft.turn - DIPLOMACY.minTurns;
        draft.favour[key(JIA, DING)] = favour;
        for (const hex of freeLand(draft, JIA).slice(0, overlordUnits)) put(draft, 'warrior', JIA, hex);
      });
    // The fear of the leader is what brings the favour down: it shows among the causes.
    expect(favourStanding(vassalage(0), JIA, DING)!.power).toContainEqual({ cause: 'leader', value: -BALANCE.maxFear, polity: JIA });
    expect(favourStanding(vassalage(0), JIA, DING)!.target).toBeLessThan(BALANCE.vassalLeavesFavour);

    const gone = endTurn(vassalage(BALANCE.vassalLeavesFavour - 2));
    expect(gone.state.polities[DING]!.overlord).toBe(-1);
    expect(of(gone.events, 'vassalReleased')).toContainEqual({ type: 'vassalReleased', vassal: DING, overlord: JIA, reason: 'cancelled' });
    // Favour still above the mark: it stays.
    expect(endTurn(vassalage(BALANCE.vassalLeavesFavour + 5)).state.polities[DING]!.overlord).toBe(JIA);
    // An army several times its own: it stays, whatever it thinks.
    const awed = vassalage(BALANCE.vassalLeavesFavour - 2, 6);
    expect(vassalLeaves(createCtx(cloneState(awed)), DING, JIA)).toBe(false);
    expect(endTurn(awed).state.polities[DING]!.overlord).toBe(JIA);
    // A vassalage younger than the shortest term of an agreement is not looked at.
    const young = edit(vassalage(BALANCE.vassalLeavesFavour - 2), (draft) => {
      draft.agreements[draft.agreements.length - 1]!.since = draft.turn - 1;
    });
    expect(endTurn(young).state.polities[DING]!.overlord).toBe(JIA);
  });

  it('lets what a feared leader knows leak to those who fear it', () => {
    const tech = TECH_IDS.find((id) => TECHS[id].era === 3)!;
    const knows = (state: GameState, polity: number): GameState =>
      edit(state, (draft) => {
        draft.polities[polity]!.techs.push(tech);
      });
    const cost = (state: GameState, polity: number, percent: number): number =>
      Math.max(1, Math.ceil((TECHS[tech].cost * (100 + percent + realmPercent(state, polity))) / 100));
    const leak = BALANCE.maxFear * BALANCE.learnPercentPerFear;
    // Known by a nation nobody fears: the catch-up discount alone.
    expect(researchCost(knows(four, JIA), YI, tech)).toBe(cost(four, YI, -RESEARCH.catchUpPercent));
    // Known by the feared leader: its fear comes off as well.
    expect(researchCost(knows(runaway, JIA), YI, tech)).toBe(cost(runaway, YI, -RESEARCH.catchUpPercent - leak));
    expect(leakPercent(knows(runaway, JIA), YI, [JIA])).toBe(leak);
    // The leader gets nothing of the kind from those below it, and nobody does from a tech the leader lacks.
    expect(researchCost(knows(runaway, YI), JIA, tech)).toBe(cost(runaway, JIA, -RESEARCH.catchUpPercent));
    expect(researchCost(knows(runaway, BING), YI, tech)).toBe(cost(runaway, YI, -RESEARCH.catchUpPercent));
    expect(researchCost(runaway, YI, tech)).toBe(cost(runaway, YI, 0));
  });
});

describe('the supply limit', () => {
  const start = createGame(map, { seed: 2, majors: ['jia', 'yi', 'bing', 'ding'] });

  it('grows with cities and people', () => {
    expect(supplyLimitFor(1, 1)).toBe(Math.floor(SUPPLY.base + SUPPLY.perCity + 1 / SUPPLY.popPerUnit));
    expect(supplyLimitFor(1, 1)).toBe(3);
    expect(supplyLimitFor(4, 24)).toBe(12);
    expect(supplyLimitFor(4, 60)).toBeGreaterThan(supplyLimitFor(4, 24));
    expect(supplyLimitFor(5, 24)).toBeGreaterThan(supplyLimitFor(4, 24));
    expect(supplyLimitFor(0, 0)).toBe(SUPPLY.base);
  });

  it('charges every unit beyond it more than the one before', () => {
    expect([-3, 0, 1, 2, 3, 4, 5].map(supplySurcharge)).toEqual([0, 0, 1, 3, 6, 10, 15].map((gold) => gold * SUPPLY.overStep));
    for (let over = 1; over < 30; over++) {
      const step = supplySurcharge(over + 1) - supplySurcharge(over);
      expect(step).toBe(SUPPLY.overStep * (over + 1));
      expect(step).toBeGreaterThan(supplySurcharge(over) - supplySurcharge(over - 1));
    }
  });

  it('counts the units that fight, on land and at sea, and adds the excess to the upkeep', () => {
    const limit = supplyStatus(start, JIA).limit;
    expect(limit).toBe(supplyLimitFor(1, start.cities[map.polities[JIA]!.capitalZone]!.pop));
    const withUnits = (warriors: number, settlers = 0): GameState =>
      edit(start, (draft) => {
        draft.polities[JIA]!.gold = 10_000;
        const free = freeLand(draft, JIA);
        for (let i = 0; i < warriors; i++) put(draft, 'warrior', JIA, free[i]!);
        for (let i = 0; i < settlers; i++) put(draft, 'settler', JIA, free[warriors + i]!);
      });
    const own = start.units.filter((unit) => unit.owner === JIA).length;
    expect(supplyStatus(withUnits(limit - own), JIA)).toEqual({ limit, used: limit, surcharge: 0 });
    expect(supplyStatus(withUnits(limit - own + 4), JIA)).toEqual({ limit, used: limit + 4, surcharge: supplySurcharge(4) });
    // A settler does not fight: it is not counted.
    expect(supplyStatus(withUnits(limit - own, 3), JIA).used).toBe(limit);
    // The upkeep of a turn: at the limit nothing is added, beyond it the surcharge is.
    const upkeepOf = (state: GameState): number => endTurn(state, {}).state.polities[JIA]!.upkeep;
    const atLimit = upkeepOf(withUnits(limit - own));
    for (const over of [1, 2, 5]) {
      expect(upkeepOf(withUnits(limit - own + over))).toBe(atLimit + over + supplySurcharge(over));
    }
  });

  it('is the most the AI plans for at peace, and games keep far fewer pieces on the board for it', () => {
    let state = start;
    for (let turn = 0; turn < 60 && state.result === null; turn++) state = endTurn(state).state;
    for (const polity of NATIONS) {
      const atWar = Object.values(state.relations).some((relation) => relation.atWar && (relation.a === polity || relation.b === polity));
      const supply = supplyStatus(state, polity);
      if (state.polities[polity]!.alive && !atWar) expect(supply.used, `polity ${polity}`).toBeLessThanOrEqual(supply.limit);
    }
  });
});

describe('the capital', () => {
  it('yields more gold and science than the same city would elsewhere', () => {
    const start = createGame(map, { seed: 2 });
    const zone = map.polities[JIA]!.capitalZone;
    const moved = edit(start, (draft) => {
      draft.polities[JIA]!.capital = -1;
    });
    const seatYields = yieldsOf(start, zone);
    const plain = yieldsOf(moved, zone);
    expect(CAPITAL_PERCENT).toEqual({ gold: 50, science: 50 });
    expect(seatYields.gold).toBe(Math.floor((plain.gold * 150) / 100));
    expect(seatYields.science).toBe(Math.floor((plain.science * 150) / 100));
    expect(seatYields.food).toBe(plain.food);
    expect(seatYields.production).toBe(plain.production);
    expect(seatYields.culture).toBe(plain.culture);
  });
});

describe('the AI and a step the rules refuse', () => {
  /** Runs Yi's turn. `blind`: Yi sees nothing at all, as if every hex lay in the fog. */
  function yiMoves(state: GameState, blind: boolean): { state: GameState; tried: Action[]; done: Action[] } {
    const ctx = createCtx(cloneState(state));
    if (blind) ctx.sight.set(YI, new Uint8Array(topo.count));
    const tried: Action[] = [];
    const done: Action[] = [];
    runAi(ctx, YI, (action) => {
      if (action.type === 'move') tried.push(action);
      if (validate(ctx, action) !== null) return false;
      execute(ctx, action);
      if (action.type === 'move') done.push(action);
      return true;
    });
    return { state: ctx.state, tried, done };
  }

  /**
   * Yi's capital has lost its garrison and its only unit stands two hexes
   * off, with more than one way in. A unit of Bing stands on the hex Yi's
   * unit would step on first.
   */
  function blocked(): { state: GameState; walker: number; from: number; between: number } {
    const base = createGame(map, { seed: 2, majors: ['jia', 'yi', 'bing', 'ding'] });
    const home = seat(YI);
    const ring = around(map, home).filter((hex) => isPlainGround(map, hex));
    for (const from of ring.flatMap((hex) => around(map, hex))) {
      if (!isPlainGround(map, from) || apart(from, home) !== 2) continue;
      if (around(map, from).filter((hex) => ring.includes(hex)).length < 2) continue;
      let walker = -1;
      const open = edit(base, (draft) => {
        draft.units = draft.units.filter((unit) => unit.owner !== YI);
        walker = put(draft, 'warrior', YI, from).id;
      });
      const first = yiMoves(open, false).done[0];
      if (first === undefined || first.type !== 'move' || first.to === home) continue;
      const between = first.to;
      const state = edit(open, (draft) => {
        put(draft, 'warrior', BING, between);
      });
      return { state, walker, from, between };
    }
    throw new Error('the fixture map has no such place');
  }

  it('plans as if a unit it does not see were not there', () => {
    const { state, walker, between } = blocked();
    const seeing = createCtx(cloneState(state));
    const unit = seeing.unitById.get(walker)!;
    expect(checkStep(seeing, unit, between)).toBe('hexOccupied');
    expect(stepKnown(seeing, unit, between)).toBe('hexOccupied');
    const blind = createCtx(cloneState(state));
    blind.sight.set(YI, new Uint8Array(topo.count));
    const unseen = blind.unitById.get(walker)!;
    expect(checkStep(blind, unseen, between)).toBe('hexOccupied');
    expect(stepKnown(blind, unseen, between)).toBeNull();
    // What fog does not hide still stands in the way: the step into another polity's land and city.
    const beside = around(map, seat(JIA)).find((hex) => isPlainGround(map, hex))!;
    const atGates = edit(state, (draft) => {
      draft.units.find((entry) => entry.id === walker)!.hex = beside;
    });
    const fogged = createCtx(cloneState(atGates));
    fogged.sight.set(YI, new Uint8Array(topo.count));
    const reason = checkStep(fogged, fogged.unitById.get(walker)!, seat(JIA));
    expect(reason).not.toBeNull();
    expect(stepKnown(fogged, fogged.unitById.get(walker)!, seat(JIA))).toBe(reason);
  });

  it('goes round a unit it sees', () => {
    const { state, walker, from, between } = blocked();
    const turn = yiMoves(state, false);
    const unit = turn.state.units.find((entry) => entry.id === walker)!;
    expect(unit.hex).not.toBe(from);
    expect(turn.tried.every((action) => action.type === 'move' && action.to !== between)).toBe(true);
  });

  it('learns nothing from a refused step: it tries the hex once, stays where it is and looks for no other way', () => {
    const { state, walker, from, between } = blocked();
    const turn = yiMoves(state, true);
    const unit = turn.state.units.find((entry) => entry.id === walker)!;
    expect(turn.tried).toEqual([{ type: 'move', polity: YI, unit: walker, to: between }]);
    expect(turn.done).toEqual([]);
    expect(unit.hex).toBe(from);
  });
});

describe('determinism with the supply limit and the balance of power', () => {
  it('plays the same game twice, and the same game after a save and a load', () => {
    const play = (state: GameState, turns: number): GameState => {
      let current = state;
      for (let i = 0; i < turns && current.result === null; i++) current = endTurn(current).state;
      return current;
    };
    const start = createGame(map, { seed: 11, majors: ['jia', 'yi', 'bing', 'ding'] });
    const middle = play(start, 60);
    expect(hashState(play(start, 60))).toBe(hashState(middle));
    // The balance of power is worked out from the state: nothing of it is lost in a save.
    const loaded = loadGame(saveGame(middle), map);
    expect(hashState(loaded)).toBe(hashState(middle));
    expect(balanceOf(loaded)).toEqual(balanceOf(middle));
    expect(hashState(play(loaded, 40))).toBe(hashState(play(middle, 40)));
  });
});
