import { afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS, CITY_PROJECT_IDS, IMPROVEMENTS } from '../core/data.ts';
import { dictionaries, setLanguage } from '../shared/i18n.ts';
import { conversionText, counted, gainText, majorRows, perTurnText, turnsText } from './text.ts';

afterEach(() => {
  setLanguage('zh');
});

describe('plural forms', () => {
  it('says one turn and several turns in English', () => {
    setLanguage('en');
    expect(turnsText(1)).toBe('1 turn');
    expect(turnsText(2)).toBe('2 turns');
    expect(turnsText(0)).toBe('0 turns');
    expect(turnsText(15)).toBe('15 turns');
  });

  it('has one form in Chinese', () => {
    expect(turnsText(1)).toBe('1 回合');
    expect(turnsText(2)).toBe('2 回合');
  });

  it('counts every string that names a number of something', () => {
    setLanguage('en');
    expect(counted('city.unrest', 1, { turns: 1 })).toBe('Unrest for 1 turn');
    expect(counted('city.unrest', 3, { turns: 3 })).toBe('Unrest for 3 turns');
    expect(counted('hud.researching', 1, { tech: 'Farming', turns: 1 })).toBe('Farming · 1 turn');
    expect(counted('hud.researching', 9, { tech: 'Farming', turns: 9 })).toBe('Farming · 9 turns');
    expect(counted('victory.turnsLeft', 1, { turns: 1 })).toBe('Decided in 1 turn');
    expect(counted('victory.turnsLeft', 123, { turns: 123 })).toBe('Decided in 123 turns');
    expect(counted('policy.freeSwaps', 1, { count: 1 })).toBe('1 free swap');
    expect(counted('policy.freeSwaps', 3, { count: 3 })).toBe('3 free swaps');
    expect(counted('polity.cities', 1, { count: 1 })).toBe('1 city');
    expect(counted('polity.cities', 2, { count: 2 })).toBe('2 cities');
  });

  it('has no English string left that would read "1 turns"', () => {
    for (const [key, template] of Object.entries(dictionaries.en)) {
      if (!/\{(turns|count)\} ?([a-z]+ )?[a-z]+s\b/.test(template)) continue;
      expect(Object.hasOwn(dictionaries.en, `${key}.one`), key).toBe(true);
    }
  });
});

describe('gainText', () => {
  it('puts a space between the number and the yield in English and none in Chinese', () => {
    setLanguage('en');
    expect(gainText('food', 2)).toBe('+2 food');
    expect(gainText('production', 1)).toBe('+1 production');
    expect(gainText('gold', -1)).toBe('−1 gold');
    setLanguage('zh');
    expect(gainText('food', 2)).toBe('+2粮');
  });

  it('writes what a farm gives as the build list shows it', () => {
    setLanguage('en');
    const gains = IMPROVEMENTS.farm.yields;
    const text = (['food', 'production', 'gold'] as const)
      .filter((name) => gains[name] !== 0)
      .map((name) => gainText(name, gains[name]))
      .join(' ');
    expect(`Farm ${text}`).toBe('Farm +2 food');
  });
});

describe('majorRows', () => {
  it('lays twelve English names out in two rows and keeps one row otherwise', () => {
    setLanguage('en');
    expect(majorRows(12)).toBe(2);
    expect(majorRows(4)).toBe(1);
    setLanguage('zh');
    expect(majorRows(12)).toBe(1);
  });
});

describe('city projects', () => {
  it('says what a project turns production into, at the rate of the rules’ table', () => {
    setLanguage('zh');
    expect(CITY_PROJECT_IDS.map((id) => conversionText(BUILDINGS[id].converts!))).toEqual(['每 4 工 → 1 文', '每 2 工 → 1 金', '每 4 工 → 1 科']);
    expect(perTurnText('culture', 3)).toBe('+3文/回合');
    setLanguage('en');
    expect(CITY_PROJECT_IDS.map((id) => conversionText(BUILDINGS[id].converts!))).toEqual([
      '4 production → 1 culture',
      '2 production → 1 gold',
      '4 production → 1 science',
    ]);
    expect(perTurnText('gold', 0)).toBe('+0 gold a turn');
  });

  it('follows the table: a rate that is no whole number of production is given as a percentage', () => {
    setLanguage('zh');
    expect(conversionText({ to: 'gold', percent: 100 })).toBe('每 1 工 → 1 金');
    expect(conversionText({ to: 'gold', percent: 30 })).toBe('工的 30% → 金');
    setLanguage('en');
    expect(conversionText({ to: 'science', percent: 30 })).toBe('30% of production → science');
  });
});
