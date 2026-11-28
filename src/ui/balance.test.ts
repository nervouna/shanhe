import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE, CAPITAL_PERCENT } from '../core/data.ts';
import { createGame } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { supplyStanding, takesSupply } from '../core/query.ts';
import { edit, isPlainGround, put, withCity } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { setLanguage } from '../shared/i18n.ts';
import { balanceRows, beyondSupply, capitalLines, supplyOf, supplyView, supplyWarning } from './balance.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const base = createGame(map, { seed: 5, player: 'jia' });
const seat = base.polities[JIA]!.capital;
const limit = supplyStanding(base, JIA).limit;

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

afterEach(() => {
  setLanguage('zh');
});

describe('the supply on screen', () => {
  it('shows units against the limit below it, with no surcharge and no warning', () => {
    const supply = supplyOf(army(limit - 1), JIA);
    expect(supply).toMatchObject({ value: `${limit - 1}/${limit}`, text: `补给 ${limit - 1}/${limit}`, over: false, surcharge: 0 });
    expect(supplyWarning(supply)).toBeNull();
    expect(beyondSupply(supply, 'warrior')).toBe(false);
    setLanguage('en');
    expect(supplyOf(army(limit - 1), JIA).text).toBe(`Supply ${limit - 1}/${limit}`);
  });

  it('shows no surcharge at the limit, and warns that the next fighting unit goes over', () => {
    const supply = supplyOf(army(limit), JIA);
    expect(supply).toMatchObject({ value: `${limit}/${limit}`, text: `补给 ${limit}/${limit}`, over: false, surcharge: 0 });
    expect(supplyWarning(supply)).toBe('超出补给：下一支作战单位每回合 −1 金');
    expect(beyondSupply(supply, 'warrior')).toBe(true);
    // a unit that does not fight takes no supply
    expect(beyondSupply(supply, 'settler')).toBe(false);
    setLanguage('en');
    expect(supplyWarning(supply)).toBe('Beyond supply: the next fighting unit costs −1 gold a turn');
  });

  it('shows the surcharge above the limit, and what one more unit adds to it', () => {
    const supply = supplyOf(army(limit + 2), JIA);
    // two beyond: 1 + 2
    expect(supply).toMatchObject({
      value: `${limit + 2}/${limit} −3`,
      text: `补给 ${limit + 2}/${limit} · 超额每回合 −3 金`,
      over: true,
      surcharge: 3,
    });
    expect(supplyWarning(supply)).toBe('超出补给：下一支作战单位每回合 −3 金');
    setLanguage('en');
    expect(supplyOf(army(limit + 2), JIA).text).toBe(`Supply ${limit + 2}/${limit} · −3 gold a turn beyond the limit`);
    expect(supplyView({ limit: 4, used: 5, surcharge: 1 })).toEqual({
      value: '5/4 −1',
      text: 'Supply 5/4 · −1 gold a turn beyond the limit',
      over: true,
    });
  });
});

describe("the capital's breakdown", () => {
  it('lists the bonus to gold and science in the capital, with the numbers of the rules', () => {
    expect(capitalLines(base, seat)).toEqual([
      { yield: 'gold', percent: CAPITAL_PERCENT.gold, text: '金 +50%' },
      { yield: 'science', percent: CAPITAL_PERCENT.science, text: '科 +50%' },
    ]);
    setLanguage('en');
    expect(capitalLines(base, seat).map((line) => line.text)).toEqual(['Gold +50%', 'Science +50%']);
  });

  it('lists nothing in another city, in the seat of a city-state or where there is no city', () => {
    const second = base.zoneOwner.findIndex((owner, zone) => owner === JIA && zone !== seat && base.cities[zone] === null);
    expect(capitalLines(withCity(base, second, JIA), second)).toEqual([]);
    const cityState = map.polities.findIndex((polity) => polity.kind === 'cityState');
    expect(capitalLines(base, base.polities[cityState]!.capital)).toEqual([]);
    expect(capitalLines(base, second)).toEqual([]);
  });
});

describe("the victory overlay's balance of power", () => {
  const four = edit(createGame(map, { seed: 2, player: 'yi', majors: ['jia', 'yi', 'bing', 'ding'] }), (draft) => {
    draft.turn = BALANCE.fullTurn + 10;
    for (const polity of [JIA, YI, BING, DING]) {
      draft.polities[polity]!.grossIncome = 1000;
      draft.polities[polity]!.science = 100;
    }
  });

  it('lists every nation in the race, the most feared first, with the track it leads on', () => {
    const led = edit(four, (draft) => {
      draft.polities[BING]!.grossIncome = 3000;
      draft.polities[DING]!.science = 270;
    });
    const rows = balanceRows(led);
    expect(rows.map((row) => row.polity)).toEqual([BING, DING, JIA, YI]);
    expect(rows[0]).toEqual({ polity: BING, fear: BALANCE.maxFear, lead: 'income', leadName: '财力' });
    expect(rows[1]!.lead).toBe('science');
    expect(rows[1]!.leadName).toBe('科技');
    expect(rows[1]!.fear).toBeGreaterThan(0);
    expect(rows[1]!.fear).toBeLessThan(BALANCE.maxFear);
    for (const row of rows.slice(2)) expect(row).toMatchObject({ fear: 0, lead: null, leadName: null });
    setLanguage('en');
    expect(balanceRows(led).map((row) => row.leadName)).toEqual(['Income', 'Science', null, null]);
  });

  it('names the army track, and fears nobody while all stand level', () => {
    expect(balanceRows(four).map((row) => [row.polity, row.fear, row.leadName])).toEqual([
      [JIA, 0, null],
      [YI, 0, null],
      [BING, 0, null],
      [DING, 0, null],
    ]);
    const free = topo.zoneHexes[seat]!.filter(
      (hex) => isPlainGround(map, hex) && hex !== map.zones[seat]!.siteHex && !four.units.some((unit) => unit.hex === hex),
    );
    const armed = edit(four, (draft) => {
      for (const hex of free.slice(0, 12)) put(draft, 'warrior', JIA, hex);
    });
    expect(balanceRows(armed)[0]).toMatchObject({ polity: JIA, lead: 'army', leadName: '军力' });
  });
});
