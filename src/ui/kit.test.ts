import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAJOR_NAMES_ZH, UNITS } from '../core/data.ts';
import { KITS, KIT_NATIONS } from '../core/kits.ts';
import type { Kit } from '../core/kits.ts';
import type { Modifier } from '../core/mods.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { LANGUAGES, dictionaries, setLanguage } from '../shared/i18n.ts';
import type { MapData, MapPolity } from '../shared/mapData.ts';
import {
  effectNumbers,
  effectParams,
  kitKeys,
  kitView,
  kitViewOf,
  leaderEffect,
  listNations,
  nationEntries,
  regionsOf,
  traitEffect,
} from './kit.ts';

afterEach(() => {
  setLanguage('zh');
});

const kits = KIT_NATIONS.map((nation) => KITS[nation]!);

/** A copy of the modifiers with 100 added to every amount the texts count. */
function raised(modifiers: readonly Modifier[]): Modifier[] {
  const amounts = new Set([
    'food', 'production', 'gold', 'science', 'culture', 'percent', 'multiplier', 'hp', 'xp', 'slots', 'turns', 'favour',
    'range', 'morale', 'perRiverHexes', 'pop', 'mountainsNear', 'minPop',
  ]);
  const walk = (value: unknown, key: string): unknown => {
    if (typeof value === 'number') return amounts.has(key) ? value + (value < 0 ? -100 : 100) : value;
    if (Array.isArray(value)) return value.map((item) => walk(item, ''));
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, walk(item, name)]));
    }
    return value;
  };
  return modifiers.map((modifier) => walk(modifier, '') as Modifier);
}

describe('effect numbers', () => {
  it('counts the amounts of a modifier in a fixed order, without their sign', () => {
    expect(effectNumbers([{ type: 'cityYield', yields: { culture: 1, gold: 2 }, city: { capital: true }, per: 'friends' }])).toEqual([2, 1]);
    expect(effectNumbers([{ type: 'cityYield', yields: { science: 1 }, per: { pop: 5 } }])).toEqual([1, 5]);
    expect(effectNumbers([{ type: 'cityYield', yields: { food: 2 }, city: { mountainsNear: 3 } }])).toEqual([2, 3]);
    expect(effectNumbers([{ type: 'routeToll', percent: 20, range: 4 }])).toEqual([20, 4]);
    expect(effectNumbers([{ type: 'growth', percent: -10 }, { type: 'swapCooldown', turns: -1 }])).toEqual([10, 1]);
    expect(effectNumbers([{ type: 'cityPercent', percent: { production: 25 }, building: 'factory', city: { minEra: 4 } }])).toEqual([25]);
    expect(effectNumbers([{ type: 'routeGold', gold: 1, perRiverHexes: 3 }])).toEqual([1, 3]);
    expect(effectNumbers([{ type: 'noVassal' }, { type: 'movement', fordRivers: true }])).toEqual([]);
    expect(effectNumbers([{ type: 'reveal', resource: 'rare-earths', era: 5 }])).toEqual([]);
  });

  it('names them a, b, c and adds the constants of the rules', () => {
    const params = effectParams(KITS.yan!.trait);
    expect(params).toMatchObject({ a: 1, b: 1, c: 1, d: 1, e: 1, maxFriends: 4, maxIslands: 6 });
  });
});

describe('the kit view', () => {
  it('has every text of all 50 nations in both languages', () => {
    expect(kits).toHaveLength(50);
    for (const language of LANGUAGES) {
      const dictionary: Record<string, string> = dictionaries[language];
      for (const kit of kits) {
        for (const key of kitKeys(kit)) expect(dictionary[key], `${language}:${key}`).toBeTruthy();
      }
    }
  });

  it('fills every placeholder of every effect text from the data', () => {
    for (const language of LANGUAGES) {
      setLanguage(language);
      for (const kit of kits) {
        const view = kitView(kit);
        const texts = [
          view.trait.name, view.trait.effect, view.leader.name, view.leader.archetype, view.leader.effect,
          view.leader.personalityName, view.unit.name, view.unit.className, view.building.name, view.building.kindName,
          view.specialty.name, view.difficultyName,
        ];
        for (const value of texts) {
          expect(value, `${language}:${kit.nation}`).not.toBe('');
          expect(value, `${language}:${kit.nation}`).not.toMatch(/[{}]/);
        }
        expect(view.unit.piece, kit.nation).toBe(UNITS[kit.unit]!.piece);
        expect(view.difficultyLevel).toBeGreaterThanOrEqual(1);
        expect(view.difficultyLevel).toBeLessThanOrEqual(4);
        expect(view.building.tech, kit.nation).not.toBeNull();
      }
    }
  });

  it('uses the same placeholders in Chinese and in English', () => {
    const used = (template: string): string[] => [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    const zh: Record<string, string> = dictionaries.zh;
    const en: Record<string, string> = dictionaries.en;
    for (const kit of kits) {
      for (const [key, modifiers] of [[`trait.${kit.nation}.effect`, kit.trait], [`leader.${kit.nation}.effect`, kit.leader]] as const) {
        expect(new Set(used(zh[key]!)), key).toEqual(new Set(used(en[key]!)));
        const params = effectParams(modifiers);
        for (const name of used(zh[key]!)) expect(params[name], `${key} {${name}}`).toBeTypeOf('number');
      }
    }
  });

  it('writes no number into a text by hand: the texts follow the data', () => {
    const digits = /[0-9０-９]/;
    for (const language of LANGUAGES) {
      const dictionary: Record<string, string> = dictionaries[language];
      for (const kit of kits) {
        expect(dictionary[`trait.${kit.nation}.effect`], kit.nation).not.toMatch(digits);
        expect(dictionary[`leader.${kit.nation}.effect`], kit.nation).not.toMatch(digits);
      }
    }
    for (const language of LANGUAGES) {
      setLanguage(language);
      for (const kit of kits) {
        const changed: Kit = { ...kit, trait: raised(kit.trait), leader: raised(kit.leader) };
        const first = effectNumbers(kit.trait)[0];
        if (first !== undefined) {
          expect(traitEffect(changed), kit.nation).not.toBe(traitEffect(kit));
          expect(traitEffect(kit), kit.nation).toContain(String(first));
          expect(traitEffect(changed), kit.nation).toContain(String(first + 100));
        }
        const buff = effectNumbers(kit.leader)[0];
        expect(buff, kit.nation).toBeDefined();
        expect(leaderEffect(changed), kit.nation).toContain(String(buff! + 100));
        expect(leaderEffect(changed), kit.nation).not.toBe(leaderEffect(kit));
      }
    }
  });

  it('says what doc 02 says for a few nations', () => {
    expect(traitEffect(KITS.qin!)).toBe('农田工 +1');
    expect(leaderEffect(KITS.qin!)).toBe('城墙建造速度 +10%');
    expect(traitEffect(KITS.ryukyu!)).toBe('他国商路经过其城市 4 格内时，抽取收入的 20%');
    setLanguage('en');
    expect(traitEffect(KITS.qin!)).toBe('Farms give +1 production');
    expect(traitEffect(KITS.goryeo!)).toBe('+1 science per 5 population in each city');
    expect(leaderEffect(KITS.yamato!)).toBe('+1 science in the capital per friendly nation, up to 4');
    const view = kitView(KITS.qi!);
    expect(view).toMatchObject({
      nation: 'qi',
      trait: { name: 'Fish and Salt' },
      leader: { name: 'Uncle Zhong', archetype: 'Guan Zhong', personality: 'mercantile', personalityName: 'Mercantile' },
      unit: { id: 'jijiInfantry', name: 'Jiji infantry', piece: '技', era: 0, unitClass: 'infantry', className: 'Infantry' },
      building: { id: 'jixiaAcademy', kind: 'building', kindName: 'Unique building', name: 'Jixia academy', tech: 'writing' },
      specialty: { id: 'sea-salt', name: 'Sea salt' },
      difficulty: 'hard',
      difficultyLevel: 3,
      difficultyName: 'Hard',
    });
    expect(kitView(KITS.qin!).building).toMatchObject({ kind: 'road', kindName: 'Unique road', tech: 'currency' });
    expect(kitView(KITS.yan!).building).toMatchObject({ kind: 'improvement', kindName: 'Unique improvement', tech: 'fortification' });
  });

  it('is null for a polity without a kit', () => {
    const map = createFixtureMap();
    expect(kitViewOf(map, 0)).toBeNull();
    expect(kitViewOf(map, 999)).toBeNull();
    const withKit: MapData = { ...map, polities: map.polities.map((polity, index) => (index === 0 ? { ...polity, id: 'shu' } : polity)) };
    expect(kitViewOf(withKit, 0)?.nation).toBe('shu');
  });
});

describe('the list of nations', () => {
  const fixture = createFixtureMap();
  const polities: MapPolity[] = KIT_NATIONS.map((id, index) => ({
    ...fixture.polities[0]!,
    id,
    kind: 'nation',
    nameZh: `国${index}`,
    nameEn: `Nation ${index}`,
  }));
  polities.push({ ...fixture.polities[0]!, id: 'tsushima', kind: 'cityState' });
  const map: MapData = { ...fixture, polities };
  const entries = nationEntries(map, [0, 4]);

  it('lists the 50 nations in the order of doc 02, with region, difficulty and the default majors', () => {
    expect(entries.map((entry) => entry.id)).toEqual(KIT_NATIONS);
    expect(entries[0]).toEqual({ id: 'yan', polity: 0, region: 'north', difficulty: 'normal', major: true });
    expect(entries.filter((entry) => entry.major).map((entry) => entry.id)).toEqual(['yan', 'qin']);
    expect(regionsOf(entries)).toEqual(['north', 'central', 'east', 'steppe', 'southeast']);
    expect(DEFAULT_MAJOR_NAMES_ZH).toHaveLength(12);
  });

  it('filters by region', () => {
    expect(listNations(entries, 'all', 'region')).toEqual(entries);
    const north = listNations(entries, 'north', 'region');
    expect(north.map((entry) => entry.id)).toEqual(['yan', 'jin', 'qi', 'zhongzhou', 'qin', 'longyou', 'xixia', 'qingtang']);
    expect(listNations(entries, 'southeast', 'region')).toHaveLength(13);
  });

  it('sorts by difficulty either way and keeps the order among equals', () => {
    const easy = listNations(entries, 'all', 'easy');
    expect(easy.slice(0, 7).map((entry) => entry.id)).toEqual(['shu', 'tubo', 'monan', 'mobei', 'siam', 'pagan', 'boni']);
    expect(easy.at(-1)!.difficulty).toBe('veryHard');
    const hard = listNations(entries, 'all', 'hard');
    expect(hard.slice(0, 9).map((entry) => entry.id)).toEqual([
      'xixia', 'ba', 'wu', 'dongning', 'qiongya', 'ezo', 'yamato', 'tsukushi', 'ryukyu',
    ]);
    expect(hard.at(-1)!.id).toBe('boni');
    expect(listNations(entries, 'north', 'hard').map((entry) => entry.id)).toEqual([
      'xixia', 'jin', 'qi', 'zhongzhou', 'yan', 'qin', 'longyou', 'qingtang',
    ]);
  });

  it('puts nations without a rating last, as on the fixture map', () => {
    const plain = nationEntries(fixture, [0]);
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((entry) => entry.difficulty === null && entry.region === 'other')).toBe(true);
    expect(listNations(plain, 'all', 'hard')).toEqual(plain);
    expect(regionsOf(plain)).toEqual(['other']);
    const mixed = [...plain.slice(0, 1), ...entries.slice(0, 2)];
    expect(listNations(mixed, 'all', 'easy').at(-1)).toEqual(plain[0]);
    expect(listNations(mixed, 'all', 'hard').at(-1)).toEqual(plain[0]);
  });
});
