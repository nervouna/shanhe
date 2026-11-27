/**
 * The nation kits of doc 02: for each of the 50 nations its trait, its
 * leader's buff and personality, and the ids of its unique unit, its unique
 * building and its specialty. The unique units and buildings themselves are
 * in `uniques.ts`. A kit belongs to the polity whose `MapPolity.id` it names;
 * a polity without one (the fixture and synthetic maps, city-states) plays
 * by the plain rules.
 */

import type { Modifier } from './mods.ts';

/** Constants the kit rules share. */
export const KIT = {
  /** A hex at or above this elevation is plateau. */
  plateauMetres: 3000,
  /** A city counts as a hill city when its site is hilly or this many of its neighbours are hills or mountains. */
  hillCityHills: 2,
  /** Mountains are counted within this distance of a city's site. */
  mountainRingRadius: 2,
  /** A nation is friendly at this favour or more. */
  friendlyFavour: 15,
  maxFriends: 4,
  maxIslands: 6,
  maxRoutesCounted: 4,
  maxMountainsCounted: 2,
  maxRiverGold: 4,
  /** Turns a production surge lasts after a city is lost. */
  surgeTurns: 10,
  /** How far a unit and a city see, before modifiers. */
  unitVision: 2,
  cityVision: 3,
} as const;

export const PERSONALITY_IDS = [
  'balanced',
  'warlike',
  'mercantile',
  'defensive',
  'scholarly',
  'expansionist',
  'seafaring',
  'diplomatic',
] as const;
export type PersonalityId = (typeof PERSONALITY_IDS)[number];

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'veryHard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** The seven architectural families of doc 06. */
export const FAMILIES = ['centralPlains', 'jiangnan', 'tibetan', 'steppe', 'japanese', 'southeastAsian', 'siberian'] as const;
export type Family = (typeof FAMILIES)[number];

/** What kind of thing a nation's unique building is. */
export type UniqueKind = 'building' | 'improvement' | 'road';

export interface Kit {
  /** `MapPolity.id`. */
  readonly nation: string;
  /** The national trait. */
  readonly trait: readonly Modifier[];
  /** Id of its unique unit in `UNITS`. */
  readonly unit: string;
  /** Id of its unique building in `BUILDINGS`, improvement in `IMPROVEMENTS` or road upgrade in `ROAD_UPGRADES`. */
  readonly building: string;
  readonly buildingKind: UniqueKind;
  /** `MapResource.id` of its specialty. */
  readonly specialty: string;
  /** The leader's permanent buff. */
  readonly leader: readonly Modifier[];
  readonly personality: PersonalityId;
  readonly difficulty: Difficulty;
  readonly family: Family;
}

/** The kits by `MapPolity.id`. */
export const KITS: Readonly<Record<string, Kit>> = {};

/** The nations that have a kit, in the order of doc 02. */
export const KIT_NATIONS: readonly string[] = Object.keys(KITS);

/** The kit of the nation, or null. */
export function kitOfNation(nation: string): Kit | null {
  return Object.hasOwn(KITS, nation) ? (KITS[nation] ?? null) : null;
}
