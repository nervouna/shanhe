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
  // techs and the endgame project (rules core)
  'tech.farming': '农耕',
  'tech.husbandry': '畜牧',
  'tech.mining': '采矿',
  'tech.archery': '弓矢',
  'tech.fortification': '筑城',
  'tech.ritual': '祭祀',
  'tech.boats': '舟楫',
  'tech.writing': '文字',
  'tech.currency': '货币',
  'tech.ironworking': '冶铁',
  'tech.riding': '骑术',
  'tech.irrigation': '水利',
  'tech.crossbow': '弩机',
  'tech.shipbuilding': '造船',
  'tech.paper': '造纸',
  'tech.stirrup': '马镫',
  'tech.steel': '炼钢',
  'tech.compass': '指南针',
  'tech.machinery': '机械',
  'tech.guilds': '行会',
  'tech.gunpowder': '火药',
  'tech.printing': '印刷',
  'tech.firearms': '火器',
  'tech.gunCasting': '铸炮',
  'tech.oceanNavigation': '远洋航海',
  'tech.banking': '银行',
  'tech.astronomy': '天文历算',
  'tech.newCrops': '新作物',
  'tech.steamEngine': '蒸汽机',
  'tech.railway': '铁路',
  'tech.rifling': '线膛枪',
  'tech.steelmaking': '钢铁冶金',
  'tech.electricity': '电力',
  'tech.publicHealth': '公共卫生',
  'tech.combustion': '内燃机',
  'tech.aviation': '航空',
  'tech.electronics': '电子',
  'tech.petrochemicals': '石化',
  'tech.rocketry': '火箭',
  'tech.informationNetworks': '信息网络',
  'project.tiangong': '天宫工程',
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
  // techs and the endgame project (rules core)
  'tech.farming': 'Farming',
  'tech.husbandry': 'Husbandry',
  'tech.mining': 'Mining',
  'tech.archery': 'Archery',
  'tech.fortification': 'Fortification',
  'tech.ritual': 'Ritual',
  'tech.boats': 'Boats',
  'tech.writing': 'Writing',
  'tech.currency': 'Currency',
  'tech.ironworking': 'Ironworking',
  'tech.riding': 'Riding',
  'tech.irrigation': 'Irrigation',
  'tech.crossbow': 'Crossbow',
  'tech.shipbuilding': 'Shipbuilding',
  'tech.paper': 'Paper',
  'tech.stirrup': 'Stirrup',
  'tech.steel': 'Steel',
  'tech.compass': 'Compass',
  'tech.machinery': 'Machinery',
  'tech.guilds': 'Guilds',
  'tech.gunpowder': 'Gunpowder',
  'tech.printing': 'Printing',
  'tech.firearms': 'Firearms',
  'tech.gunCasting': 'Gun Casting',
  'tech.oceanNavigation': 'Ocean Navigation',
  'tech.banking': 'Banking',
  'tech.astronomy': 'Astronomy',
  'tech.newCrops': 'New Crops',
  'tech.steamEngine': 'Steam Engine',
  'tech.railway': 'Railway',
  'tech.rifling': 'Rifling',
  'tech.steelmaking': 'Steelmaking',
  'tech.electricity': 'Electricity',
  'tech.publicHealth': 'Public Health',
  'tech.combustion': 'Combustion Engine',
  'tech.aviation': 'Aviation',
  'tech.electronics': 'Electronics',
  'tech.petrochemicals': 'Petrochemicals',
  'tech.rocketry': 'Rocketry',
  'tech.informationNetworks': 'Information Networks',
  'project.tiangong': 'Tiangong Project',
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
