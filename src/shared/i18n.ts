/**
 * User-facing strings in Chinese and English.
 *
 * This module only holds the current language in memory. Remembering the
 * player's choice (in `localStorage`) is the UI layer's job, so that the
 * rules core can use `t` without a browser.
 */

const zh = {
  'app.title': '山河',
  'hud.backend': '渲染器：{backend}',
  'hud.turn': '第 {turn} 回合',
  'backend.webgpu': 'WebGPU',
  'backend.webgl': 'WebGL',
  'language.switch': 'English',
  'error.renderer': '无法启动渲染器：{message}',
};

export type TranslationKey = keyof typeof zh;

const en: Record<TranslationKey, string> = {
  'app.title': 'Shanhe',
  'hud.backend': 'Renderer: {backend}',
  'hud.turn': 'Turn {turn}',
  'backend.webgpu': 'WebGPU',
  'backend.webgl': 'WebGL',
  // the label names the language the button switches to
  'language.switch': '中文',
  'error.renderer': 'Could not start the renderer: {message}',
};

export const LANGUAGES = ['zh', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const dictionaries: Record<Language, Record<TranslationKey, string>> = { zh, en };

export const DEFAULT_LANGUAGE: Language = 'zh';

let current: Language = DEFAULT_LANGUAGE;

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  current = language;
}

/**
 * The string for `key` in the current language, with every `{name}`
 * placeholder replaced by `params.name`. A placeholder without a parameter
 * is left as it is.
 */
export function t(key: TranslationKey, params?: Readonly<Record<string, string | number>>): string {
  const template = dictionaries[current][key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
