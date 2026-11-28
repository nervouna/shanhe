/**
 * A nation's kit as the interface shows it: names, the effect of the trait
 * and of the leader's buff in words, and the list of nations at nation
 * select. No DOM here.
 *
 * The effect texts carry no numbers of their own: every number in them is a
 * placeholder filled from the kit's modifiers and the rules' constants, so
 * that a change of the data changes the text.
 */

import { BUILDINGS, IMPROVEMENTS, UNITS } from '../core/data.ts';
import type { BuildingId, ImprovementId, TechId, UnitClass } from '../core/data.ts';
import { DIFFICULTIES, KIT, kitOfNation } from '../core/kits.ts';
import type { Difficulty, Kit, PersonalityId, UniqueKind } from '../core/kits.ts';
import type { Modifier } from '../core/mods.ts';
import { ROAD_UPGRADES } from '../core/uniques.ts';
import { dictionaries, t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import { REGIONS, regionOf } from './names.ts';
import type { Region } from './names.ts';

const YIELDS = ['food', 'production', 'gold', 'science', 'culture'] as const;
/** The fields of a modifier that hold an amount, in the order the texts count them. */
const AMOUNTS = ['gold', 'multiplier', 'hp', 'xp', 'culture', 'slots', 'turns', 'favour', 'range', 'morale', 'perRiverHexes'] as const;

function yieldNumbers(value: unknown, into: number[]): void {
  if (typeof value !== 'object' || value === null) return;
  const yields = value as Partial<Record<(typeof YIELDS)[number], number>>;
  for (const name of YIELDS) {
    const amount = yields[name];
    if (typeof amount === 'number') into.push(Math.abs(amount));
  }
}

/**
 * The amounts of a list of modifiers, as the effect texts number them: for
 * each modifier in order its yields (food, production, gold, science,
 * culture), its percentage (a number, or per yield), then gold, multiplier,
 * HP, experience, culture, slots, turns, favour, range, morale, the river
 * hexes a route's gold is counted per, the population a yield is counted
 * per, and the mountains or population a city needs. Signs are dropped: the
 * text says "less" or "more".
 */
export function effectNumbers(modifiers: readonly Modifier[]): number[] {
  const out: number[] = [];
  for (const modifier of modifiers) {
    const fields = modifier as unknown as Record<string, unknown>;
    yieldNumbers(fields.yields, out);
    if (typeof fields.percent === 'number') out.push(Math.abs(fields.percent));
    else yieldNumbers(fields.percent, out);
    for (const name of AMOUNTS) {
      const amount = fields[name];
      if (typeof amount === 'number') out.push(Math.abs(amount));
    }
    const per = fields.per as { pop?: unknown } | string | undefined;
    if (typeof per === 'object' && typeof per.pop === 'number') out.push(per.pop);
    const city = fields.city as { mountainsNear?: unknown; minPop?: unknown } | undefined;
    if (typeof city?.mountainsNear === 'number') out.push(city.mountainsNear);
    if (typeof city?.minPop === 'number') out.push(city.minPop);
  }
  return out;
}

/** The parameters of an effect text: `{a}`, `{b}`, ... for the modifiers' amounts, and the rules' constants by name. */
export function effectParams(modifiers: readonly Modifier[]): Record<string, number> {
  const params: Record<string, number> = {
    maxFriends: KIT.maxFriends,
    maxIslands: KIT.maxIslands,
    maxMountains: KIT.maxMountainsCounted,
    maxRiverGold: KIT.maxRiverGold,
    surgeTurns: KIT.surgeTurns,
    friendlyFavour: KIT.friendlyFavour,
  };
  effectNumbers(modifiers).forEach((value, index) => {
    params[String.fromCharCode(97 + index)] = value;
  });
  return params;
}

function has(key: string): key is TranslationKey {
  return Object.hasOwn(dictionaries.zh, key);
}

function text(key: string, params?: Record<string, number>): string {
  return has(key) ? t(key, params) : '';
}

/** What the trait does, in the current language. */
export function traitEffect(kit: Kit): string {
  return text(`trait.${kit.nation}.effect`, effectParams(kit.trait));
}

/** What the leader's buff does, in the current language. */
export function leaderEffect(kit: Kit): string {
  return text(`leader.${kit.nation}.effect`, effectParams(kit.leader));
}

/** Every translation key the kit view of a nation reads. */
export function kitKeys(kit: Kit): string[] {
  const unit = UNITS[kit.unit];
  return [
    `trait.${kit.nation}`,
    `trait.${kit.nation}.effect`,
    `leader.${kit.nation}`,
    `leader.${kit.nation}.archetype`,
    `leader.${kit.nation}.effect`,
    `personality.${kit.personality}`,
    `difficulty.${kit.difficulty}`,
    `unit.${kit.unit}`,
    `class.${unit?.unitClass ?? ''}`,
    `${kit.buildingKind}.${kit.building}`,
    `kit.${kit.buildingKind}`,
    `specialty.${kit.specialty}`,
    `tech.${uniqueTech(kit) ?? ''}`,
  ];
}

/** The tech that unlocks the nation's unique building, improvement or road upgrade. */
function uniqueTech(kit: Kit): TechId | null {
  if (kit.buildingKind === 'building') return BUILDINGS[kit.building as BuildingId]?.tech ?? null;
  if (kit.buildingKind === 'improvement') return IMPROVEMENTS[kit.building as ImprovementId]?.tech ?? null;
  return (ROAD_UPGRADES as Record<string, { tech: TechId } | undefined>)[kit.building]?.tech ?? null;
}

export interface KitView {
  /** `MapPolity.id`. */
  readonly nation: string;
  readonly trait: { readonly name: string; readonly effect: string };
  readonly leader: {
    readonly name: string;
    /** The historical figure behind the title. */
    readonly archetype: string;
    readonly effect: string;
    readonly personality: PersonalityId;
    readonly personalityName: string;
  };
  readonly unit: {
    readonly id: string;
    readonly name: string;
    /** The character on its piece. */
    readonly piece: string;
    /** Index into `ERAS`. */
    readonly era: number;
    readonly unitClass: UnitClass;
    readonly className: string;
  };
  readonly building: {
    readonly id: string;
    readonly kind: UniqueKind;
    /** "Unique building", "Unique improvement" or "Unique road". */
    readonly kindName: string;
    readonly name: string;
    readonly tech: TechId | null;
  };
  readonly specialty: { readonly id: string; readonly name: string };
  readonly difficulty: Difficulty;
  /** 1 (easy) to 4 (very hard). */
  readonly difficultyLevel: number;
  readonly difficultyName: string;
}

/** Everything the interface shows of a kit, in the current language. */
export function kitView(kit: Kit): KitView {
  const unit = UNITS[kit.unit];
  const unitClass = unit?.unitClass ?? 'infantry';
  return {
    nation: kit.nation,
    trait: { name: text(`trait.${kit.nation}`), effect: traitEffect(kit) },
    leader: {
      name: text(`leader.${kit.nation}`),
      archetype: text(`leader.${kit.nation}.archetype`),
      effect: leaderEffect(kit),
      personality: kit.personality,
      personalityName: text(`personality.${kit.personality}`),
    },
    unit: {
      id: kit.unit,
      name: text(`unit.${kit.unit}`),
      piece: unit?.piece ?? '',
      era: unit?.era ?? 0,
      unitClass,
      className: text(`class.${unitClass}`),
    },
    building: {
      id: kit.building,
      kind: kit.buildingKind,
      kindName: text(`kit.${kit.buildingKind}`),
      name: text(`${kit.buildingKind}.${kit.building}`),
      tech: uniqueTech(kit),
    },
    specialty: { id: kit.specialty, name: text(`specialty.${kit.specialty}`) },
    difficulty: kit.difficulty,
    difficultyLevel: DIFFICULTIES.indexOf(kit.difficulty) + 1,
    difficultyName: text(`difficulty.${kit.difficulty}`),
  };
}

/** The kit view of the polity at `index` of the map, or null for a polity without a kit. */
export function kitViewOf(map: MapData, index: number): KitView | null {
  const entry = map.polities[index];
  const kit = entry === undefined || entry.kind !== 'nation' ? null : kitOfNation(entry.id);
  return kit === null ? null : kitView(kit);
}

// ------------------------------------------------------------ nation select

export interface NationEntry {
  /** `MapPolity.id`. */
  readonly id: string;
  /** Index into `MapData.polities`. */
  readonly polity: number;
  readonly region: Region;
  /** Null for a nation without a kit (the fixture map). */
  readonly difficulty: Difficulty | null;
  /** One of the nations that run the full AI by default. */
  readonly major: boolean;
}

export const NATION_SORTS = ['region', 'easy', 'hard'] as const;
/** `region`: in the order of the design document. `easy` and `hard`: by difficulty, that end first. */
export type NationSort = (typeof NATION_SORTS)[number];

/** Every playable nation of the map, in the order of doc 02. */
export function nationEntries(map: MapData, majors: readonly number[]): NationEntry[] {
  const entries: NationEntry[] = [];
  for (const region of REGIONS) {
    map.polities.forEach((polity, index) => {
      if (polity.kind !== 'nation' || regionOf(polity.id) !== region) return;
      entries.push({
        id: polity.id,
        polity: index,
        region,
        difficulty: kitOfNation(polity.id)?.difficulty ?? null,
        major: majors.includes(index),
      });
    });
  }
  return entries;
}

/** The regions that have a nation, in order. */
export function regionsOf(entries: readonly NationEntry[]): Region[] {
  return REGIONS.filter((region) => entries.some((entry) => entry.region === region));
}

/**
 * The nations of one region, or of all, in the chosen order. Sorting by
 * difficulty keeps the document's order among equals; nations without a
 * rating come last either way.
 */
export function listNations(entries: readonly NationEntry[], region: Region | 'all', sort: NationSort): NationEntry[] {
  const shown = entries.filter((entry) => region === 'all' || entry.region === region);
  if (sort === 'region') return shown;
  const rank = (entry: NationEntry): number => (entry.difficulty === null ? -1 : DIFFICULTIES.indexOf(entry.difficulty));
  return shown
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const x = rank(a.entry);
      const y = rank(b.entry);
      if (x < 0 || y < 0) return Number(x < 0) - Number(y < 0) || a.index - b.index;
      return (sort === 'easy' ? x - y : y - x) || a.index - b.index;
    })
    .map((item) => item.entry);
}
