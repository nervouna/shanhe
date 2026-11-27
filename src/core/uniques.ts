/**
 * The unique units, buildings and improvements of the 50 nations of doc 02.
 * `data.ts` merges them into `UNITS`, `BUILDINGS` and `IMPROVEMENTS`; this
 * file only holds the tables, so that it needs nothing from `data.ts` but
 * types.
 */

import type { ImprovementDef, TechId, UnitClass } from './data.ts';
import type { Modifier } from './mods.ts';

/** A unique unit: it replaces the generic unit of its class and era for its nation. */
export interface UniqueUnitSpec {
  /** `MapPolity.id`. */
  readonly nation: string;
  /** Index into `ERAS`. */
  readonly era: number;
  readonly unitClass: Exclude<UnitClass, 'civilian' | 'tribe'>;
  /** The character on its piece. */
  readonly piece: string;
  /** Its strength (melee and ranged) as a percentage of the replaced unit's. Default 100. */
  readonly strengthPercent?: number;
  /** A ranged strength of its own, as a fraction of the era's strength. */
  readonly rangedStrength?: number;
  readonly range?: number;
  readonly moves?: number;
  /** Its cost as a percentage of the replaced unit's. Default 100. */
  readonly costPercent?: number;
  readonly cityAttackPercent?: number;
  /** The strategic resource it needs, or null for none. Default: that of the replaced unit. */
  readonly resource?: string | null;
  /** Its ability. */
  readonly abilities: readonly Modifier[];
}

/** A unique building: a replacement keeps everything of the building it replaces and adds what is set here. */
export interface UniqueBuildingSpec {
  readonly nation: string;
  /** The generic building it replaces. Without it the building is an extra. */
  readonly replaces?: string;
  /** The tech that unlocks it. Default: that of the replaced building. */
  readonly tech?: TechId;
  readonly cost?: number;
  readonly upkeep?: number;
  /** Added to the replaced building's values. */
  readonly cityHp?: number;
  readonly cityStrengthPercent?: number;
  readonly tradeRoutes?: number;
  readonly coastal?: boolean;
  readonly capitalOnly?: boolean;
  readonly modifiers: readonly Modifier[];
}

/** A road upgrade: what a nation's automatic roads become once it knows the tech. */
export interface RoadUpgradeSpec {
  readonly nation: string;
  readonly tech: TechId;
  /** What the nation gains while it knows the tech. */
  readonly modifiers: readonly Modifier[];
}

export const UNIQUE_UNITS = {} as const satisfies Record<string, UniqueUnitSpec>;

export const UNIQUE_BUILDINGS = {} as const satisfies Record<string, UniqueBuildingSpec>;

export const UNIQUE_IMPROVEMENTS = {} as const satisfies Record<string, ImprovementDef>;

export const ROAD_UPGRADES = {} as const satisfies Record<string, RoadUpgradeSpec>;
