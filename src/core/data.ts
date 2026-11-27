/**
 * The rules' data tables: eras, terrain yields, improvements, buildings,
 * units and every balancing constant. Rules code reads these tables and holds
 * no numbers of its own, so later issues (tech, policies, nation kits) can
 * extend or replace entries without touching code paths.
 */

import { Feature, Terrain } from '../shared/mapData.ts';

// ---------------------------------------------------------------- yields

export interface Yields {
  food: number;
  production: number;
  gold: number;
  science: number;
  culture: number;
}

export function noYields(): Yields {
  return { food: 0, production: 0, gold: 0, science: 0, culture: 0 };
}

// ------------------------------------------------------------------ eras

export const ERAS = ['ancient', 'classical', 'medieval', 'earlyModern', 'industrial', 'modern'] as const;
export type EraId = (typeof ERAS)[number];

/** Length of a game in turns. */
export const GAME_TURNS = 150;
/** Until tech exists the era is a function of the turn. */
export const TURNS_PER_ERA = 25;

/** Index into {@link ERAS} of the era that `turn` (1-based) falls in. */
export function eraOfTurn(turn: number): number {
  return Math.max(0, Math.min(ERAS.length - 1, Math.floor((turn - 1) / TURNS_PER_ERA)));
}

/** First era in which land units may embark on coast and lake (stands in for Boats). */
export const EMBARK_COAST_ERA = 1;
/** First era in which ships and embarked units may enter ocean (stands in for Compass). */
export const OCEAN_ERA = 2;

// --------------------------------------------------------------- terrain

type HexYield = Readonly<Pick<Yields, 'food' | 'production' | 'gold'>>;

/** Base yield of a worked hex, by {@link Terrain} value. */
export const TERRAIN_YIELDS: Readonly<Record<number, HexYield>> = {
  [Terrain.Ocean]: { food: 1, production: 0, gold: 0 },
  [Terrain.Coast]: { food: 1, production: 0, gold: 1 },
  [Terrain.Lake]: { food: 2, production: 0, gold: 1 },
  [Terrain.Plains]: { food: 1, production: 1, gold: 0 },
  [Terrain.Grassland]: { food: 2, production: 0, gold: 0 },
  [Terrain.Desert]: { food: 0, production: 0, gold: 0 },
  [Terrain.Tundra]: { food: 1, production: 0, gold: 0 },
  [Terrain.Snow]: { food: 0, production: 0, gold: 0 },
  [Terrain.Mountain]: { food: 0, production: 0, gold: 0 },
};

/** Added to the terrain yield, by {@link Feature} value. The sum never goes below zero. */
export const FEATURE_YIELDS: Readonly<Record<number, HexYield>> = {
  [Feature.None]: { food: 0, production: 0, gold: 0 },
  [Feature.Forest]: { food: 0, production: 1, gold: 0 },
  [Feature.Jungle]: { food: 0, production: 1, gold: 0 },
  [Feature.Marsh]: { food: -1, production: 0, gold: 0 },
  [Feature.Oasis]: { food: 3, production: 0, gold: 1 },
  [Feature.Volcano]: { food: 0, production: 0, gold: 0 },
};

/** Added on hilly hexes. */
export const HILLS_YIELD: HexYield = { food: 0, production: 1, gold: 0 };
/** Added on hexes with at least one river edge. */
export const RIVER_YIELD: HexYield = { food: 0, production: 0, gold: 1 };
/** Added on hexes that carry a resource. */
export const RESOURCE_YIELD: HexYield = { food: 0, production: 0, gold: 1 };
/** Yield of the city's own hex, whatever its terrain. */
export const CITY_CENTRE_YIELD: Readonly<Yields> = { food: 2, production: 2, gold: 2, science: 1, culture: 1 };

/** Movement points a land unit pays to enter a hex: base, plus the extras that apply. */
export const MOVE_COST = { base: 1, hills: 1, roughFeature: 1 } as const;
/** Features that cost extra movement. */
export const ROUGH_FEATURES: readonly number[] = [Feature.Forest, Feature.Jungle, Feature.Marsh];

// ---------------------------------------------------------- improvements

export interface ImprovementDef {
  /** Production cost. */
  readonly cost: number;
  readonly yields: HexYield;
  /** Terrain values the improvement may stand on. */
  readonly terrains: readonly number[];
  /** `yes`: only on hills. `no`: only on flat ground. */
  readonly hills: 'yes' | 'no' | 'any';
  /** Features the hex may carry. */
  readonly features: readonly number[];
}

const OPEN = [Feature.None];
const LAND = [Terrain.Plains, Terrain.Grassland, Terrain.Desert, Terrain.Tundra, Terrain.Snow];

export const IMPROVEMENTS = {
  farm: {
    cost: 30,
    yields: { food: 2, production: 0, gold: 0 },
    terrains: [Terrain.Plains, Terrain.Grassland],
    hills: 'no',
    features: OPEN,
  },
  mine: {
    cost: 30,
    yields: { food: 0, production: 2, gold: 0 },
    terrains: LAND,
    hills: 'yes',
    features: [Feature.None, Feature.Forest, Feature.Jungle],
  },
  pasture: {
    cost: 30,
    yields: { food: 1, production: 1, gold: 0 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Tundra, Terrain.Desert],
    hills: 'no',
    features: OPEN,
  },
  fishery: {
    cost: 30,
    yields: { food: 1, production: 0, gold: 1 },
    terrains: [Terrain.Coast, Terrain.Lake],
    hills: 'any',
    features: OPEN,
  },
} as const satisfies Record<string, ImprovementDef>;
export type ImprovementId = keyof typeof IMPROVEMENTS;
export const IMPROVEMENT_IDS = Object.keys(IMPROVEMENTS) as ImprovementId[];

// -------------------------------------------------------------- buildings

export interface BuildingDef {
  /** Production cost. */
  readonly cost: number;
  /** Gold per turn. */
  readonly upkeep: number;
  /** First era (index into {@link ERAS}) in which it can be built. */
  readonly era: number;
  /** Flat yields added to the city. */
  readonly yields: Partial<Yields>;
  /** Percentage added to a city yield after the flat yields. */
  readonly percent: Partial<Yields>;
  /** Needs a city next to coast or ocean. */
  readonly coastal: boolean;
  /** Added to the city's maximum HP. */
  readonly cityHp: number;
  /** Percentage added to the city's combat strength. */
  readonly cityStrengthPercent: number;
  /** Gives the city one ranged counter-strike per turn. */
  readonly counterStrike: boolean;
  /** Extra yield of every worked water hex. */
  readonly waterYields: Partial<Yields>;
}

const BUILDING_BASE = {
  yields: {},
  percent: {},
  coastal: false,
  cityHp: 0,
  cityStrengthPercent: 0,
  counterStrike: false,
  waterYields: {},
} as const;

export const BUILDINGS = {
  granary: { ...BUILDING_BASE, cost: 40, upkeep: 1, era: 0, yields: { food: 2 } },
  walls: { ...BUILDING_BASE, cost: 50, upkeep: 0, era: 0, cityHp: 50, cityStrengthPercent: 20, counterStrike: true },
  temple: { ...BUILDING_BASE, cost: 40, upkeep: 1, era: 0, yields: { culture: 2 } },
  market: { ...BUILDING_BASE, cost: 60, upkeep: 0, era: 1, yields: { gold: 2 }, percent: { gold: 25 } },
  academy: { ...BUILDING_BASE, cost: 60, upkeep: 1, era: 1, yields: { science: 3 } },
  harbour: { ...BUILDING_BASE, cost: 60, upkeep: 1, era: 1, coastal: true, yields: { gold: 2 }, waterYields: { food: 1 } },
  workshop: { ...BUILDING_BASE, cost: 80, upkeep: 1, era: 2, yields: { production: 2 }, percent: { production: 25 } },
} as const satisfies Record<string, BuildingDef>;
export type BuildingId = keyof typeof BUILDINGS;
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];

// ------------------------------------------------------------------ units

export type UnitClass = 'infantry' | 'ranged' | 'cavalry' | 'siege' | 'naval' | 'civilian' | 'tribe';
export const COMBAT_CLASSES = ['infantry', 'ranged', 'cavalry', 'siege', 'naval'] as const;

export interface UnitDef {
  readonly id: string;
  readonly unitClass: UnitClass;
  /** First era (index into {@link ERAS}) in which it can be built. */
  readonly era: number;
  /** Strength in melee and whenever it defends. 0: cannot fight. */
  readonly strength: number;
  /** Strength of its ranged attack. 0: melee only. */
  readonly rangedStrength: number;
  /** Reach of the ranged attack in hexes. 0: melee only. */
  readonly range: number;
  /** Movement points per turn. */
  readonly moves: number;
  /** Production cost. */
  readonly cost: number;
  /** Gold per turn. */
  readonly upkeep: number;
  readonly domain: 'land' | 'sea';
  /** Percentage added to its attack strength against a city. */
  readonly cityAttackPercent: number;
  /** False for units that only exist by rule (tribes). */
  readonly buildable: boolean;
}

/** Strength of the era's generic units: 20 in the ancient era, a third more each era. */
export const ERA_STRENGTH: readonly number[] = ERAS.map((_, era) => Math.round(20 * (4 / 3) ** era));
/** Production cost of the era's infantry. */
export const ERA_UNIT_COST: readonly number[] = ERAS.map((_, era) => Math.round(24 * 1.5 ** era));

interface ClassProfile {
  /** Fractions of the era strength. */
  readonly strength: number;
  readonly rangedStrength: number;
  readonly range: number;
  readonly moves: number;
  /** Fraction of the era cost. */
  readonly cost: number;
  readonly domain: 'land' | 'sea';
  readonly cityAttackPercent: number;
}

export const CLASS_PROFILES: Readonly<Record<(typeof COMBAT_CLASSES)[number], ClassProfile>> = {
  infantry: { strength: 1, rangedStrength: 0, range: 0, moves: 2, cost: 1, domain: 'land', cityAttackPercent: 0 },
  ranged: { strength: 0.7, rangedStrength: 0.9, range: 2, moves: 2, cost: 1, domain: 'land', cityAttackPercent: 0 },
  cavalry: { strength: 1.1, rangedStrength: 0, range: 0, moves: 4, cost: 1.25, domain: 'land', cityAttackPercent: -25 },
  siege: { strength: 0.5, rangedStrength: 0.8, range: 2, moves: 2, cost: 1.2, domain: 'land', cityAttackPercent: 100 },
  naval: { strength: 1, rangedStrength: 0, range: 0, moves: 4, cost: 1.25, domain: 'sea', cityAttackPercent: -25 },
};

/** The generic roster of doc 04: one unit per class per era, eras in order. */
export const ROSTER: Readonly<Record<(typeof COMBAT_CLASSES)[number], readonly string[]>> = {
  infantry: ['warrior', 'swordsman', 'heavyInfantry', 'musketeer', 'rifleman', 'mechInfantry'],
  ranged: ['archer', 'crossbowman', 'rocketArcher', 'fieldGun', 'machineGun', 'rocketArtillery'],
  cavalry: ['chariot', 'horseman', 'heavyCavalry', 'dragoon', 'mountedRifleman', 'tank'],
  siege: ['batteringRam', 'catapult', 'trebuchet', 'heavyCannon', 'howitzer', 'missileLauncher'],
  naval: ['galley', 'warJunk', 'junk', 'shipOfTheLine', 'ironclad', 'destroyer'],
};

export const UNIT_UPKEEP = 1;
/** Units a polity keeps without upkeep, per city. */
export const FREE_UNITS_PER_CITY = 2;

export const SETTLER = 'settler';
export const TRIBE = 'tribe';
/** Each settler a polity completes raises the cost of its next one by this percentage of the base cost. */
export const SETTLER_COST_STEP_PERCENT = 50;

function buildUnits(): Record<string, UnitDef> {
  const units: Record<string, UnitDef> = {};
  for (const unitClass of COMBAT_CLASSES) {
    const profile = CLASS_PROFILES[unitClass];
    ROSTER[unitClass].forEach((id, era) => {
      const strength = ERA_STRENGTH[era] as number;
      units[id] = {
        id,
        unitClass,
        era,
        strength: Math.round(strength * profile.strength),
        rangedStrength: Math.round(strength * profile.rangedStrength),
        range: profile.range,
        moves: profile.moves,
        cost: Math.round((ERA_UNIT_COST[era] as number) * profile.cost),
        upkeep: UNIT_UPKEEP,
        domain: profile.domain,
        cityAttackPercent: profile.cityAttackPercent,
        buildable: true,
      };
    });
  }
  units[SETTLER] = {
    id: SETTLER,
    unitClass: 'civilian',
    era: 1,
    strength: 0,
    rangedStrength: 0,
    range: 0,
    moves: 2,
    cost: 70,
    upkeep: UNIT_UPKEEP,
    domain: 'land',
    cityAttackPercent: 0,
    buildable: true,
  };
  units[TRIBE] = {
    id: TRIBE,
    unitClass: 'tribe',
    era: 0,
    strength: 24,
    rangedStrength: 0,
    range: 0,
    moves: 0,
    cost: 0,
    upkeep: 0,
    domain: 'land',
    cityAttackPercent: 0,
    buildable: false,
  };
  return units;
}

/** Every unit type by id: the 30 generic units, the settler and the tribe. */
export const UNITS: Readonly<Record<string, UnitDef>> = buildUnits();
export const UNIT_IDS: readonly string[] = Object.keys(UNITS);

export function unitDef(type: string): UnitDef {
  const def = UNITS[type];
  if (def === undefined) throw new Error(`unknown unit type: ${type}`);
  return def;
}

/** The unit a type upgrades to: the next era's unit of the same class, or null. */
export function upgradeTarget(type: string): UnitDef | null {
  const def = unitDef(type);
  if (def.unitClass === 'civilian' || def.unitClass === 'tribe') return null;
  const next = ROSTER[def.unitClass][def.era + 1];
  return next === undefined ? null : unitDef(next);
}

/** Gold per point of production cost difference when upgrading. */
export const UPGRADE_GOLD_PER_COST = 2;

// ----------------------------------------------------------------- combat

export const COMBAT = {
  maxHp: 100,
  /** Damage dealt between equal strengths. */
  baseDamage: 30,
  /** Damage grows by `exp(exponent * strength difference)`. */
  exponent: 0.04,
  /** Damage is multiplied by a random factor in `1 ± spread`. */
  randomSpread: 0.2,
  /** A unit at 0 HP would fight at this fraction of its strength; it scales linearly up to 1 at full HP. */
  woundedFloor: 0.5,
  hillsDefencePercent: 25,
  fortifyDefencePercent: 25,
  /** Melee attack across a river edge. */
  riverAttackPercent: -20,
  /** Strength of a land unit on water. */
  embarkedPercent: -50,
  /** XP needed for levels 1, 2 and 3. */
  levelXp: [8, 20, 40],
  /** Strength per level. */
  levelPercent: 10,
  xpAttack: 4,
  xpDefend: 2,
  xpKill: 3,
  /** HP regained by a unit that neither moved nor attacked during the turn. */
  healNeutral: 10,
  healOwnTerritory: 20,
} as const;

// ----------------------------------------------------------------- cities

export const CITY = {
  maxPop: 20,
  /** Food each citizen eats per turn. */
  foodPerCitizen: 2,
  /** Food needed to grow from population `p`: `growthBase + growthPerPop * p`. */
  growthBase: 5,
  growthPerPop: 5,
  /** Citizens work the land of their zone, and water hexes within this distance of the city. */
  waterRadius: 2,
  /** Population per point of science. */
  popPerScience: 2,
  /** Population per point of gold. */
  popPerGold: 2,
  hp: 200,
  /** Strength: `strengthBase + strengthPerEra * ERA_STRENGTH + strengthPerPop * pop`. */
  strengthBase: 6,
  strengthPerEra: 0.5,
  strengthPerPop: 0.5,
  /** Fraction of a garrison unit's strength added to its city. */
  garrisonShare: 0.25,
  /** Reach of the walls' counter-strike. */
  strikeRange: 2,
  /** HP a city regains in a turn in which nobody attacked it. */
  heal: 15,
  /** Turns of unrest after a capture: no production, lower morale. */
  unrestTurns: 8,
  unrestMorale: 30,
  /** HP of a city right after its capture, as a fraction of its maximum. */
  captureHpFraction: 0.5,
  /** Production cost of founding a city on one of the nation's own preset sites. */
  foundCost: 60,
  /** Production and gold are multiplied by `moraleFloor + (1 - moraleFloor) * morale / 100`. */
  moraleFloor: 0.5,
} as const;

export type Focus = 'balanced' | 'food' | 'production' | 'gold';
export const FOCUSES: readonly Focus[] = ['balanced', 'food', 'production', 'gold'];
/** How much a citizen values each yield of a hex under each focus. */
export const FOCUS_WEIGHTS: Readonly<Record<Focus, HexYield>> = {
  balanced: { food: 3, production: 2, gold: 1 },
  food: { food: 6, production: 1, gold: 1 },
  production: { food: 2, production: 6, gold: 1 },
  gold: { food: 2, production: 1, gold: 6 },
};

// ------------------------------------------------------------ war & peace

export const WAR = {
  /** Turns a war must last before peace can be made. */
  minTurns: 10,
  /** Turns after a peace during which neither side can declare war on the other. */
  truceTurns: 10,
  /** War weariness gained per turn for each war a polity is in. */
  wearinessPerWarTurn: 1,
  /** Gained by the loser of a city. */
  wearinessPerCityLost: 5,
  /** Lost per turn at peace. */
  wearinessDecay: 2,
  wearinessMax: 60,
} as const;

// ---------------------------------------------------------------- victory

/** Number of major nations the design assumes. */
export const MAJOR_COUNT = 12;
/** Original capitals of majors to hold for a Conquest victory when there are {@link MAJOR_COUNT} majors. */
export const CONQUEST_CAPITALS = 6;

/** Capitals needed with `majors` major nations: half of them, 6 of 12. Never fewer than 2. */
export function conquestTarget(majors: number): number {
  return Math.max(2, Math.ceil((majors * CONQUEST_CAPITALS) / MAJOR_COUNT));
}

/** `nameZh` of the default full-AI nations of doc 02. */
export const DEFAULT_MAJOR_NAMES_ZH: readonly string[] = [
  '秦', '燕', '楚', '蜀', '吴', '岭南', '吐蕃', '漠北', '高丽', '大和', '暹罗', '阇婆',
];

// ----------------------------------------------------------------- tribes

/** One tribe per this many hexes of a wasteland zone, at least one per zone. */
export const HEXES_PER_TRIBE = 12;

// --------------------------------------------------------------------- AI

export const AI = {
  /** A major nation keeps this share of its spare gold income for unit upkeep. */
  armyIncomeShare: 0.6,
  /** No war before this turn. */
  firstWarTurn: 12,
  /** Field units needed before declaring war. */
  minFieldUnits: 3,
  /** Declares war when its military strength is this many times the target's defence. */
  warStrengthRatio: 1.4,
  /** Sues for peace when its strength falls below this fraction of the enemy's. */
  peaceStrengthRatio: 0.6,
  /** Sues for peace at this war weariness. */
  peaceWeariness: 35,
  /** Sues for peace after this many turns of war without progress. */
  stalemateTurns: 30,
  /** A unit below this HP rests instead of attacking. */
  restHp: 40,
  /** Gold kept back when upgrading. */
  upgradeReserve: 20,
  /** A wasteland site this close to one of its cities is worth a settler. */
  settleRange: 10,
  /** Smallest city that builds a settler or founds a city. */
  expandPop: 2,
  /** A city gets this many of its first buildings before it adds to the peacetime army. */
  coreBuildings: 3,
  /** A city with at least this much spare food switches its focus to production... */
  productionFocusSurplus: 6,
  /** ...and back to balanced when the surplus falls below this. */
  balancedFocusSurplus: 2,
} as const;
