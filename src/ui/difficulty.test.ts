import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, DIFFICULTY, DIFFICULTY_LEVELS, scienceBonus, techCostBonus } from '../core/data.ts';
import { LANGUAGES, dictionaries, setLanguage } from '../shared/i18n.ts';
import { levelEffect, levelName, levelViews } from './difficulty.ts';

afterEach(() => {
  setLanguage('zh');
});

describe('the difficulty picker', () => {
  it('lists the five levels in the rules’ order, with the middle one as the default', () => {
    const views = levelViews();
    expect(views.map((view) => view.level)).toEqual([...DIFFICULTY_LEVELS]);
    expect(views).toHaveLength(5);
    expect(DEFAULT_DIFFICULTY).toBe(views[2]!.level);
  });

  it('names every level in both languages, with keys of its own', () => {
    setLanguage('zh');
    expect(levelViews().map((view) => view.name)).toEqual(['从容', '简单', '标准', '困难', '严酷']);
    setLanguage('en');
    expect(levelViews().map((view) => view.name)).toEqual(['Relaxed', 'Easy', 'Standard', 'Hard', 'Severe']);
    for (const language of LANGUAGES) {
      setLanguage(language);
      for (const level of DIFFICULTY_LEVELS) {
        expect(levelName(level)).toBe(dictionaries[language][`level.${level}`]);
        expect(levelName(level)).not.toBe('');
      }
      expect(new Set(DIFFICULTY_LEVELS.map(levelName)).size).toBe(5);
    }
  });

  it('describes every level by what it changes, with the numbers of the rules’ table', () => {
    for (const language of LANGUAGES) {
      setLanguage(language);
      const effects = levelViews().map((view) => view.effect);
      expect(new Set(effects).size, language).toBe(5);
      for (const level of DIFFICULTY_LEVELS) {
        const text = levelEffect(level);
        const { player, ai } = DIFFICULTY[level];
        expect(text, `${language} ${level}`).not.toMatch(/[{}]/);
        const helped = player.yieldPercent !== 0 || player.strengthPercent !== 0 ? player : ai;
        if (helped.yieldPercent === 0 && helped.strengthPercent === 0) {
          // the middle level changes nothing, and says so without a number
          expect(text).toBe(dictionaries[language]['level.even']);
          expect(text).not.toMatch(/\d/);
        } else {
          expect(text).toContain(`+${helped.yieldPercent}%`);
          expect(text).toContain(`+${helped.strengthPercent}%`);
          // science where it differs from the other yields, and the cost of techs where there is one
          const science = scienceBonus(helped);
          const cost = techCostBonus(helped);
          const numbers = [helped.yieldPercent, helped.strengthPercent];
          if (science !== helped.yieldPercent && science !== 0) numbers.push(science);
          if (cost !== 0) numbers.push(cost);
          expect(text.match(/\d+/g)).toEqual(numbers.map(String));
          expect(text.includes(dictionaries[language]['level.scienceOut'])).toBe(science === 0);
        }
      }
      // who is helped: the player below the middle, the AI's major nations above it
      expect(levelEffect('relaxed')).toBe(
        dictionaries[language]['level.player'].replace('{yield}', '30').replace('{strength}', '20'),
      );
      // above the middle the AI's bonus leaves science out and its techs cost more
      const join = dictionaries[language]['level.join'];
      for (const level of ['hard', 'severe'] as const) {
        const { ai } = DIFFICULTY[level];
        expect(levelEffect(level)).toBe(
          [
            dictionaries[language]['level.ai'].replace('{yield}', String(ai.yieldPercent)).replace('{strength}', String(ai.strengthPercent)),
            dictionaries[language]['level.scienceOut'],
            dictionaries[language]['level.techCost'].replace('{cost}', String(techCostBonus(ai))),
          ].join(join),
        );
      }
    }
    setLanguage('zh');
    expect(levelEffect('hard')).toBe('AI 主要国家的城市产出 +15%，单位与城市战力 +10%，科研产出不加成，科技花费 +25%');
    setLanguage('en');
    expect(levelEffect('severe')).toBe(
      'The AI’s major nations: cities yield +30%; units and cities fight at +20%; science is not raised; techs cost +60%',
    );
  });

  it('says of science and of the cost of techs only what the table says', () => {
    const none = { yieldPercent: 0, strengthPercent: 0 };
    const of = (ai: (typeof DIFFICULTY)['hard']['ai']): string => levelEffect('hard', { ...DIFFICULTY, hard: { player: none, ai } });
    for (const language of LANGUAGES) {
      setLanguage(language);
      const words = dictionaries[language];
      const base = words['level.ai'].replace('{yield}', '42').replace('{strength}', '7');
      // science left to follow the other yields, no cost: nothing more to say
      expect(of({ yieldPercent: 42, strengthPercent: 7 })).toBe(base);
      expect(of({ yieldPercent: 42, strengthPercent: 7, sciencePercent: 42, techCostPercent: 0 })).toBe(base);
      // a science figure of its own
      expect(of({ yieldPercent: 42, strengthPercent: 7, sciencePercent: 9 })).toBe(
        base + words['level.join'] + words['level.science'].replace('{science}', '9'),
      );
      // a cost alone
      expect(of({ yieldPercent: 42, strengthPercent: 7, techCostPercent: 33 })).toBe(
        base + words['level.join'] + words['level.techCost'].replace('{cost}', '33'),
      );
      // a level that only makes the AI's techs dearer is not "the same rules"
      expect(of({ yieldPercent: 0, strengthPercent: 0, techCostPercent: 33 })).not.toBe(words['level.even']);
    }
  });

  it('takes its numbers from the table it is given, not from the text', () => {
    const table = {
      ...DIFFICULTY,
      hard: { player: { yieldPercent: 0, strengthPercent: 0 }, ai: { yieldPercent: 42, strengthPercent: 7 } },
    };
    expect(levelEffect('hard', table)).toContain('+42%');
    expect(levelEffect('hard', table)).toContain('+7%');
    expect(levelEffect('hard')).not.toContain('42');
    for (const language of LANGUAGES) {
      for (const key of ['level.player', 'level.ai', 'level.even', 'level.scienceOut', 'level.science', 'level.techCost', 'level.join'] as const) {
        expect(dictionaries[language][key], `${language} ${key}`).not.toMatch(/\d/);
      }
    }
  });
});
