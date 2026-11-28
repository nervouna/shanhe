/** Translated names of the rules' things. The template types make the compiler check that every code has a string. */

import { ERAS, unitFor } from '../core/data.ts';
import type { AgreementKind, BuildingId, Focus, ImprovementId, PolicyId, TechId, Yields } from '../core/data.ts';
import { NO_POLITY } from '../core/game.ts';
import type { BuildItem, RejectReason } from '../core/game.ts';
import { dictionaries, getLanguage, t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import type { ImportError } from './saves.ts';

export function rejectText(reason: RejectReason | 'noPath'): string {
  const key: TranslationKey = `reject.${reason}`;
  return t(key);
}

export function saveErrorText(error: ImportError): string {
  const key: TranslationKey = `save.error.${error}`;
  return t(key);
}

export function buildingName(id: BuildingId): string {
  const key: TranslationKey = `building.${id}`;
  return t(key);
}

export function improvementName(id: ImprovementId): string {
  const key: TranslationKey = `improvement.${id}`;
  return t(key);
}

export function techName(tech: TechId): string {
  const key: TranslationKey = `tech.${tech}`;
  return t(key);
}

export function focusName(focus: Focus): string {
  const key: TranslationKey = `focus.${focus}`;
  return t(key);
}

export function yieldName(name: keyof Yields): string {
  const key: TranslationKey = `yield.${name}`;
  return t(key);
}

export function eraName(era: number): string {
  const id = ERAS[Math.max(0, Math.min(ERAS.length - 1, era))] ?? 'ancient';
  const key: TranslationKey = `era.${id}`;
  return t(key);
}

/** The translation key of a unit type, or null for a type without a string. */
export function unitKey(type: string): TranslationKey | null {
  const key = `unit.${type}`;
  return Object.hasOwn(dictionaries.zh, key) ? (key as TranslationKey) : null;
}

export function unitName(type: string): string {
  const key = unitKey(type);
  return key === null ? type : t(key);
}

export function polityName(map: MapData, polity: number): string {
  if (polity === NO_POLITY) return t('polity.tribes');
  const entry = map.polities[polity];
  if (entry === undefined) return '';
  return getLanguage() === 'zh' ? entry.nameZh : entry.nameEn;
}

export function cityName(map: MapData, zone: number): string {
  const entry = map.zones[zone];
  if (entry === undefined) return '';
  return getLanguage() === 'zh' ? entry.cityNameZh : entry.cityNameEn;
}

/**
 * The unit type a polity really builds for a unit id: its nation's unique
 * unit where it has one in that place, otherwise the id itself.
 */
export function builtUnit(map: MapData, polity: number, unit: string): string {
  return unitFor(map.polities[polity]?.id ?? '', unit);
}

/**
 * The name of something a city builds.
 *
 * @param owner the polity that builds it: its unique unit takes the place of the generic one it replaces.
 */
export function itemName(map: MapData, item: BuildItem, owner: number = NO_POLITY): string {
  switch (item.kind) {
    case 'unit':
      return unitName(builtUnit(map, owner, item.unit));
    case 'building':
      return buildingName(item.building);
    case 'improvement':
      return improvementName(item.improvement);
    case 'city':
      return t('city.found', { name: cityName(map, item.zone) });
    case 'project':
      return t('project.tiangong');
  }
}

/** The headings of doc 02's nation tables, in order. */
export const REGIONS = ['north', 'central', 'east', 'steppe', 'southeast', 'other'] as const;
export type Region = (typeof REGIONS)[number];

const REGION_MEMBERS: Readonly<Record<Exclude<Region, 'other'>, readonly string[]>> = {
  north: ['yan', 'jin', 'qi', 'zhongzhou', 'qin', 'longyou', 'xixia', 'qingtang'],
  central: ['shu', 'ba', 'dian', 'yelang', 'tubo', 'chu', 'xiaoxiang', 'yuzhang', 'huainan'],
  east: ['wu', 'yue', 'min', 'dongning', 'lingnan', 'luoyue', 'qiongya', 'liaodong', 'fuyu', 'heishui', 'monan'],
  steppe: ['mobei', 'goryeo', 'ezo', 'togoku', 'yamato', 'tsukushi', 'ryukyu', 'beihai', 'shuaibin'],
  southeast: [
    'jiaozhi', 'champa', 'lanxang', 'chenla', 'siam', 'pagan', 'malacca',
    'srivijaya', 'shepo', 'boni', 'luzon', 'sulu', 'maluku',
  ],
};

/** The region a nation is listed under, by `MapPolity.id`; `other` for a nation doc 02 does not have. */
export function regionOf(polityId: string): Region {
  for (const region of REGIONS) {
    if (region !== 'other' && REGION_MEMBERS[region].includes(polityId)) return region;
  }
  return 'other';
}

export function regionName(region: Region): string {
  const key: TranslationKey = `region.${region}`;
  return t(key);
}

/** The name of a resource by its `MapResource.id`: the map's own name for it, or the game's for a strategic resource. */
export function resourceName(map: MapData, id: string): string {
  const entry = map.resources.find((resource) => resource.id === id);
  if (entry !== undefined) return getLanguage() === 'zh' ? entry.nameZh : entry.nameEn;
  // a strategic resource the map does not have still has a name in the tech tree
  const key = `resource.${id}`;
  return Object.hasOwn(dictionaries.zh, key) ? t(key as TranslationKey) : id;
}

/** The name of an off-map port by its index into `MapData.offMapPorts`. */
export function portName(map: MapData, port: number): string {
  const entry = map.offMapPorts[port];
  if (entry === undefined) return '';
  return getLanguage() === 'zh' ? entry.nameZh : entry.nameEn;
}

export function policyName(policy: PolicyId): string {
  const key: TranslationKey = `policy.${policy}`;
  return t(key);
}

export function policyEffect(policy: PolicyId): string {
  const key: TranslationKey = `policy.${policy}.effect`;
  return t(key);
}

export function agreementName(kind: AgreementKind): string {
  const key: TranslationKey = `agreement.${kind}`;
  return t(key);
}
