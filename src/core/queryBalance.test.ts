import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { cityYieldParts } from './cities.ts';
import { cloneState, createCtx } from './context.ts';
import { BALANCE, CAPITAL_PERCENT, supplySurcharge } from './data.ts';
import { createGame, endTurn, hashState, supplyStatus } from './game.ts';
import type { GameState } from './game.ts';
import { balanceOfPower } from './power.ts';
import { capitalBonus, powerStandings, supplyStanding, takesSupply } from './query.ts';
import { edit, isPlainGround, put, withCity } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const NATIONS = [JIA, YI, BING, DING];
const cityState = map.polities.findIndex((polity) => polity.kind === 'cityState');

const base = createGame(map, { seed: 5, player: 'jia' });
const seat = base.polities[JIA]!.capital;

/** Jia with `count` fighting units in all. */
function army(count: number): GameState {
  const free = topo.zoneHexes[seat]!.filter(
    (hex) => isPlainGround(map, hex) && hex !== map.zones[seat]!.siteHex && !base.units.some((unit) => unit.hex === hex),
  );
  if (free.length < count) throw new Error(`room for ${free.length} units only`);
  return edit(base, (draft) => {
    draft.units = draft.units.filter((unit) => unit.owner !== JIA || !takesSupply(unit.type));
    for (const hex of free.slice(0, count)) put(draft, 'warrior', JIA, hex);
  });
}

describe('supplyStanding', () => {
  const limit = supplyStanding(base, JIA).limit;

  it('reports the limit, the units and the surcharge the turn charges', () => {
    expect(limit).toBeGreaterThan(1);
    for (const count of [0, limit - 1, limit, limit + 1, limit + 3]) {
      const state = army(count);
      const before = hashState(state);
      const standing = supplyStanding(state, JIA);
      expect(standing).toMatchObject(supplyStatus(state, JIA));
      expect(standing.used).toBe(count);
      expect(standing.surcharge).toBe(supplySurcharge(count - limit));
      expect(hashState(state)).toBe(before);
    }
  });

  it('says what the next fighting unit would add: nothing below the limit, more with every unit beyond', () => {
    expect(supplyStanding(army(limit - 2), JIA).nextUnit).toBe(0);
    expect(supplyStanding(army(limit - 1), JIA).nextUnit).toBe(0);
    for (const count of [limit, limit + 1, limit + 3]) {
      const now = supplyStanding(army(count), JIA);
      expect(now.nextUnit).toBe(supplyStanding(army(count + 1), JIA).surcharge - now.surcharge);
      expect(now.nextUnit).toBe(count - limit + 1);
    }
  });

  it('is what a turn takes from the treasury', () => {
    const upkeepWith = (count: number): number => endTurn(army(count)).state.polities[JIA]!.upkeep;
    // one unit more costs its upkeep either way; beyond the limit it costs `nextUnit` on top
    const within = upkeepWith(limit + 1) - upkeepWith(limit) - supplyStanding(army(limit), JIA).nextUnit;
    expect(upkeepWith(limit + 2) - upkeepWith(limit + 1)).toBe(within + supplyStanding(army(limit + 1), JIA).nextUnit);
  });

  it('counts fighting units only, and nothing for a polity that is not there', () => {
    expect(takesSupply('warrior')).toBe(true);
    expect(takesSupply('settler')).toBe(false);
    expect(supplyStanding(base, 999)).toEqual({ limit: 0, used: 0, surcharge: 0, nextUnit: 0 });
  });
});

describe('capitalBonus', () => {
  const second = base.zoneOwner.findIndex((owner, zone) => owner === JIA && zone !== seat && base.cities[zone] === null);

  it('is the capital percentage in the seat of a nation and nothing anywhere else', () => {
    const before = hashState(base);
    expect(capitalBonus(base, seat)).toEqual(CAPITAL_PERCENT);
    expect(capitalBonus(base, seat)).toEqual({ gold: 50, science: 50 });
    expect(hashState(base)).toBe(before);
    // another city of the same nation
    expect(second).toBeGreaterThanOrEqual(0);
    const grown = withCity(base, second, JIA);
    expect(capitalBonus(grown, second)).toEqual({});
    expect(capitalBonus(grown, seat)).toEqual(CAPITAL_PERCENT);
    // the seat of a city-state, and a zone without a city
    expect(base.cities[base.polities[cityState]!.capital]).not.toBeNull();
    expect(capitalBonus(base, base.polities[cityState]!.capital)).toEqual({});
    expect(capitalBonus(base, second)).toEqual({});
    expect(capitalBonus(base, -1)).toEqual({});
  });

  it('is what the rules add to the percentages of that city', () => {
    const percentOf = (state: GameState): { gold: number; science: number } => {
      const ctx = createCtx(cloneState(state));
      const { percent } = cityYieldParts(ctx, ctx.state.cities[seat]!);
      return { gold: percent.gold, science: percent.science };
    };
    // the same city once the seat has moved elsewhere
    const moved = edit(withCity(base, second, JIA), (draft) => {
      draft.polities[JIA]!.capital = second;
    });
    expect(capitalBonus(moved, seat)).toEqual({});
    expect(capitalBonus(moved, second)).toEqual(CAPITAL_PERCENT);
    const here = percentOf(base);
    const gone = percentOf(moved);
    expect(here.gold - gone.gold).toBe(CAPITAL_PERCENT.gold);
    expect(here.science - gone.science).toBe(CAPITAL_PERCENT.science);
  });
});

describe('powerStandings', () => {
  /** All four nations are in the race, late in the game, each with the same income. */
  const four = edit(createGame(map, { seed: 2, majors: ['jia', 'yi', 'bing', 'ding'] }), (draft) => {
    draft.turn = BALANCE.fullTurn + 10;
    for (const polity of NATIONS) draft.polities[polity]!.grossIncome = 1000;
  });
  const runaway = edit(four, (draft) => {
    draft.polities[JIA]!.grossIncome = 3000;
  });

  it('lists every nation in the race with its fear and the track it leads on', () => {
    const before = hashState(runaway);
    const rows = powerStandings(runaway);
    expect(hashState(runaway)).toBe(before);
    expect(rows.map((row) => row.polity)).toEqual(NATIONS);
    expect(rows[0]).toEqual({ polity: JIA, fear: BALANCE.maxFear, lead: 'income' });
    for (const row of rows.slice(1)) expect(row).toMatchObject({ fear: 0, lead: null });
    // the figures of the rules
    const balance = balanceOfPower(createCtx(cloneState(runaway)));
    for (const row of rows) {
      expect(row.fear).toBe(balance.fear[row.polity]);
      expect(row.lead).toBe(balance.lead[row.polity]);
    }
  });

  it('names the track of the largest lead', () => {
    const learned = edit(four, (draft) => {
      for (const polity of NATIONS) draft.polities[polity]!.science = 100;
      draft.polities[BING]!.science = 2000;
    });
    const row = powerStandings(learned).find((entry) => entry.polity === BING)!;
    expect(row.lead).toBe('science');
    expect(row.fear).toBeGreaterThan(0);
  });

  it('fears nobody while nobody is ahead, and in the first turns', () => {
    for (const row of powerStandings(four)) expect(row).toMatchObject({ fear: 0, lead: null });
    const early = edit(runaway, (draft) => {
      draft.turn = BALANCE.fromTurn - 1;
    });
    for (const row of powerStandings(early)) expect(row).toMatchObject({ fear: 0, lead: null });
  });

  it('lists the living majors and the player, and nobody else', () => {
    const played = edit(createGame(map, { seed: 2, player: 'ding', majors: ['jia', 'yi', 'bing'] }), (draft) => {
      draft.polities[YI]!.alive = false;
    });
    expect(powerStandings(played).map((row) => row.polity)).toEqual([JIA, BING, DING]);
  });
});
