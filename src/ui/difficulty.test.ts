import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, DIFFICULTY, DIFFICULTY_LEVELS } from '../core/data.ts';
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
          expect(text.match(/\d+/g)).toEqual([String(helped.yieldPercent), String(helped.strengthPercent)]);
        }
      }
      // who is helped: the player below the middle, the AI's major nations above it
      expect(levelEffect('relaxed')).toBe(
        dictionaries[language]['level.player'].replace('{yield}', '30').replace('{strength}', '20'),
      );
      expect(levelEffect('severe')).toBe(dictionaries[language]['level.ai'].replace('{yield}', '30').replace('{strength}', '20'));
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
      for (const key of ['level.player', 'level.ai', 'level.even'] as const) {
        expect(dictionaries[language][key], `${language} ${key}`).not.toMatch(/\d/);
      }
    }
  });
});
