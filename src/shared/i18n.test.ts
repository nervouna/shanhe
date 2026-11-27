import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGES, dictionaries, getLanguage, setLanguage, t } from './i18n.ts';

afterEach(() => {
  setLanguage('zh');
});

describe('i18n', () => {
  it('has the same keys in the Chinese and English dictionaries', () => {
    const zh = Object.keys(dictionaries.zh).sort();
    const en = Object.keys(dictionaries.en).sort();
    expect(zh.length).toBeGreaterThan(0);
    expect(en).toEqual(zh);
  });

  it('has no empty strings', () => {
    for (const language of LANGUAGES) {
      for (const [key, value] of Object.entries(dictionaries[language])) {
        expect(value, `${language}:${key}`).not.toBe('');
      }
    }
  });

  it('translates in the current language and switches', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(t('backend.webgl')).toBe('WebGL');
    expect(t('app.title')).toBe(dictionaries.en['app.title']);
    setLanguage('zh');
    expect(t('app.title')).toBe(dictionaries.zh['app.title']);
  });

  it('fills in parameters', () => {
    setLanguage('en');
    expect(t('hud.backend', { backend: 'WebGPU' })).toBe('Renderer: WebGPU');
    expect(t('hud.turn', { turn: 7 })).toBe('Turn 7');
    setLanguage('zh');
    expect(t('hud.turn', { turn: 7 })).toBe('第 7 回合');
  });
});
