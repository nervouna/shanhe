/**
 * The rules' data tables: eras, terrain yields, improvements, buildings,
 * units and the balancing constants. Rules code reads these tables, so later
 * issues (tech, policies, nation kits) can extend or replace entries without
 * touching code paths. Only the AI's target scoring and path costs, which are
 * heuristics and not rules, stay in `ai.ts`.
 */

import { Feature, Terrain } from '../shared/mapData.ts';
import type { Modifier } from './mods.ts';
import { UNIQUE_BUILDINGS, UNIQUE_IMPROVEMENTS, UNIQUE_UNITS } from './uniques.ts';
import type { UniqueBuildingSpec, UniqueUnitSpec } from './uniques.ts';

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
/** The pace the design aims at: about this many turns per era. A polity's real era follows its research. */
export const TURNS_PER_ERA = 25;

/**
 * Index into {@link ERAS} of the era the design's pacing expects on `turn`
 * (1-based). No rule reads this: a polity's era is `PolityState.era`.
 */
export function eraOfTurn(turn: number): number {
  return Math.max(0, Math.min(ERAS.length - 1, Math.floor((turn - 1) / TURNS_PER_ERA)));
}

/**
 * The eras that stood in for Boats and Compass before research existed. No
 * rule reads them any more: embarking follows `TechDef.sea`.
 */
export const EMBARK_COAST_ERA = 1;
export const OCEAN_ERA = 2;

// ------------------------------------------------------------------ techs

/** What a tech does besides unlocking the units, buildings and improvements that name it. */
export interface TechDef {
  /** Index into {@link ERAS}. */
  readonly era: number;
  /** Science needed, before the catch-up discount. */
  readonly cost: number;
  /** Techs that must be known first: none in the ancient era, one or two of earlier eras after it. */
  readonly requires: readonly TechId[];
  /** What the AI wants it for. */
  readonly kind: 'economy' | 'military' | 'science' | 'naval';
  /** Id (`MapResource.id`) of the strategic resource it reveals. */
  readonly reveals?: string;
  /** `coast`: land units embark on coast and lake. `ocean`: ships and embarked units enter ocean. */
  readonly sea?: 'coast' | 'ocean';
  /** Trade route slots it adds. */
  readonly tradeRoutes?: number;
  /** Off-map ports it opens to the polity's trade routes. */
  readonly ports?: 'land' | 'sea';
  /** Roads on the polity's land become railways. */
  readonly railways?: boolean;
  /** Lets the improvements that name it in `hillsTech` stand on hills. */
  readonly hillFarms?: boolean;
  /** Needed by a stage of the endgame project. */
  readonly project?: boolean;
}

/** Science cost of a tech of each era. */
export const TECH_ERA_COST: readonly number[] = [7, 32, 100, 250, 720, 1000];

export const RESEARCH = {
  /** A tech known by any other living polity costs this much less. */
  catchUpPercent: 20,
  /** Techs of its current era a polity needs to enter the next. */
  techsToAdvance: 4,
  /** A polity on the simplified AI knows a tech once this share of the researching nations does. */
  followShare: 0.5,
} as const;

type TechSpec = Omit<TechDef, 'cost' | 'requires'> & { readonly requires: readonly string[] };

const TECH_TABLE = {
  // Ancient
  farming: { era: 0, requires: [], kind: 'economy' },
  husbandry: { era: 0, requires: [], kind: 'economy', reveals: 'horses' },
  mining: { era: 0, requires: [], kind: 'economy' },
  archery: { era: 0, requires: [], kind: 'military' },
  fortification: { era: 0, requires: [], kind: 'military' },
  ritual: { era: 0, requires: [], kind: 'economy' },
  boats: { era: 0, requires: [], kind: 'naval', sea: 'coast' },
  // Classical
  writing: { era: 1, requires: ['ritual'], kind: 'science' },
  currency: { era: 1, requires: ['mining'], kind: 'economy', tradeRoutes: 1, ports: 'land' },
  ironworking: { era: 1, requires: ['mining'], kind: 'military', reveals: 'iron' },
  riding: { era: 1, requires: ['husbandry'], kind: 'military' },
  irrigation: { era: 1, requires: ['farming'], kind: 'economy' },
  crossbow: { era: 1, requires: ['archery', 'fortification'], kind: 'military' },
  shipbuilding: { era: 1, requires: ['boats'], kind: 'naval' },
  // Medieval
  paper: { era: 2, requires: ['writing'], kind: 'science' },
  stirrup: { era: 2, requires: ['riding'], kind: 'military' },
  steel: { era: 2, requires: ['ironworking'], kind: 'military' },
  compass: { era: 2, requires: ['shipbuilding'], kind: 'naval', sea: 'ocean' },
  machinery: { era: 2, requires: ['irrigation', 'crossbow'], kind: 'economy' },
  guilds: { era: 2, requires: ['currency'], kind: 'economy', tradeRoutes: 1 },
  gunpowder: { era: 2, requires: ['ironworking', 'writing'], kind: 'military' },
  // Early Modern
  printing: { era: 3, requires: ['paper'], kind: 'science' },
  firearms: { era: 3, requires: ['gunpowder'], kind: 'military' },
  gunCasting: { era: 3, requires: ['gunpowder', 'machinery'], kind: 'military' },
  oceanNavigation: { era: 3, requires: ['compass'], kind: 'naval', ports: 'sea' },
  banking: { era: 3, requires: ['guilds'], kind: 'economy', tradeRoutes: 1 },
  astronomy: { era: 3, requires: ['compass', 'paper'], kind: 'science' },
  newCrops: { era: 3, requires: ['compass'], kind: 'economy', hillFarms: true },
  // Industrial
  steamEngine: { era: 4, requires: ['gunCasting', 'astronomy'], kind: 'economy', reveals: 'coal' },
  railway: { era: 4, requires: ['banking'], kind: 'economy', railways: true },
  rifling: { era: 4, requires: ['firearms'], kind: 'military' },
  steelmaking: { era: 4, requires: ['gunCasting'], kind: 'military' },
  electricity: { era: 4, requires: ['astronomy', 'printing'], kind: 'economy' },
  publicHealth: { era: 4, requires: ['printing', 'newCrops'], kind: 'economy' },
  // Modern
  combustion: { era: 5, requires: ['steamEngine'], kind: 'military', reveals: 'oil' },
  aviation: { era: 5, requires: ['steelmaking', 'rifling'], kind: 'military' },
  electronics: { era: 5, requires: ['electricity'], kind: 'science', reveals: 'rare-earths', project: true },
  petrochemicals: { era: 5, requires: ['steelmaking', 'publicHealth'], kind: 'military' },
  rocketry: { era: 5, requires: ['rifling'], kind: 'military', project: true },
  informationNetworks: { era: 5, requires: ['electricity', 'railway'], kind: 'science', project: true },
} as const satisfies Record<string, TechSpec>;

export type TechId = keyof typeof TECH_TABLE;
/** The 40 techs of doc 04, in the order of its tables. */
export const TECH_IDS = Object.keys(TECH_TABLE) as TechId[];

/** Every tech by id. Units, buildings and improvements name the tech that unlocks them. */
export const TECHS: Readonly<Record<TechId, TechDef>> = Object.fromEntries(
  TECH_IDS.map((id) => {
    const spec: TechSpec = TECH_TABLE[id];
    return [id, { ...spec, requires: spec.requires as readonly TechId[], cost: TECH_ERA_COST[spec.era] as number }];
  }),
) as Record<TechId, TechDef>;

export function isTechId(value: unknown): value is TechId {
  return typeof value === 'string' && Object.hasOwn(TECH_TABLE, value);
}

/** The strategic resources (`MapResource.id`) and the tech that reveals each. */
export const STRATEGIC_RESOURCES: Readonly<Record<string, TechId>> = Object.fromEntries(
  TECH_IDS.flatMap((id) => {
    const reveals = TECHS[id].reveals;
    return reveals === undefined ? [] : [[reveals, id]];
  }),
);

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
  /** The tech that unlocks it. */
  readonly tech: TechId;
  /** True if the hex needs a river edge. */
  readonly river?: boolean;
  /** With this tech it may stand on hills whatever `hills` says. */
  readonly hillsTech?: TechId;
  /** Id (`MapPolity.id`) of the only nation that may build it. */
  readonly nation?: string;
  /** The generic improvement it stands in for: its nation builds it instead, and it counts as one. */
  readonly replaces?: string;
  /** True if the hex must be next to water. */
  readonly shore?: boolean;
  /** True if it lays a road on its hex when it is built. */
  readonly road?: boolean;
  /** What it does for the units of the hex's owner that stand on it. */
  readonly modifiers?: readonly Modifier[];
}

const OPEN = [Feature.None];
const LAND = [Terrain.Plains, Terrain.Grassland, Terrain.Desert, Terrain.Tundra, Terrain.Snow];

const GENERIC_IMPROVEMENTS = {
  farm: {
    cost: 30,
    yields: { food: 2, production: 0, gold: 0 },
    terrains: [Terrain.Plains, Terrain.Grassland],
    hills: 'no',
    features: OPEN,
    tech: 'farming',
    hillsTech: 'newCrops',
  },
  mine: {
    cost: 30,
    yields: { food: 0, production: 2, gold: 0 },
    terrains: LAND,
    hills: 'yes',
    features: [Feature.None, Feature.Forest, Feature.Jungle],
    tech: 'mining',
  },
  pasture: {
    cost: 30,
    yields: { food: 1, production: 1, gold: 0 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Tundra, Terrain.Desert],
    hills: 'no',
    features: OPEN,
    tech: 'husbandry',
  },
  fishery: {
    cost: 30,
    yields: { food: 1, production: 0, gold: 1 },
    terrains: [Terrain.Coast, Terrain.Lake],
    hills: 'any',
    features: OPEN,
    tech: 'boats',
  },
  /** A farm fed by a river: flat river land only. */
  irrigationCanal: {
    cost: 50,
    yields: { food: 3, production: 0, gold: 0 },
    terrains: [Terrain.Plains, Terrain.Grassland, Terrain.Desert],
    hills: 'no',
    features: OPEN,
    tech: 'irrigation',
    river: true,
  },
  /** A waterway for barges: flat river land only. Ships do not use it yet. */
  canal: {
    cost: 60,
    yields: { food: 0, production: 1, gold: 3 },
    terrains: LAND,
    hills: 'no',
    features: [Feature.None, Feature.Marsh],
    tech: 'irrigation',
    river: true,
  },
} as const satisfies Record<string, ImprovementDef>;
export type GenericImprovementId = keyof typeof GENERIC_IMPROVEMENTS;
export type ImprovementId = GenericImprovementId | keyof typeof UNIQUE_IMPROVEMENTS;
/** Every improvement by id: the generic ones, then the unique ones of the nations (`uniques.ts`). */
export const IMPROVEMENTS: Readonly<Record<ImprovementId, ImprovementDef>> = {
  ...GENERIC_IMPROVEMENTS,
  ...UNIQUE_IMPROVEMENTS,
};
export const IMPROVEMENT_IDS = Object.keys(IMPROVEMENTS) as ImprovementId[];
/** The improvements every nation can build. */
export const GENERIC_IMPROVEMENT_IDS = Object.keys(GENERIC_IMPROVEMENTS) as GenericImprovementId[];

/** The generic kind an improvement is or replaces: what cards and traits that name a kind go by. */
export function baseImprovement(id: ImprovementId): ImprovementId {
  return (IMPROVEMENTS[id].replaces as ImprovementId | undefined) ?? id;
}

// -------------------------------------------------------------- buildings

export interface BuildingDef {
  /** Production cost. */
  readonly cost: number;
  /** Gold per turn. */
  readonly upkeep: number;
  /** Era (index into {@link ERAS}) of its tech. */
  readonly era: number;
  /** The tech that unlocks it. */
  readonly tech: TechId;
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
  /** Gives the city one air strike per turn. */
  readonly airStrike: boolean;
  /** Trade route slots the polity's first building of this kind adds. */
  readonly tradeRoutes: number;
  /** Id (`MapPolity.id`) of the only nation that may build it, or null for everybody. */
  readonly nation: string | null;
  /** The generic building it stands in for: its nation builds it instead, and it counts as one. Null for the others. */
  readonly replaces: string | null;
  /** True if only the capital may have it. */
  readonly capitalOnly: boolean;
  /** What it does beyond the fields above, for its city. */
  readonly modifiers: readonly Modifier[];
}

const BUILDING_BASE = {
  yields: {},
  percent: {},
  coastal: false,
  cityHp: 0,
  cityStrengthPercent: 0,
  counterStrike: false,
  waterYields: {},
  airStrike: false,
  tradeRoutes: 0,
  nation: null,
  replaces: null,
  capitalOnly: false,
  modifiers: [],
} as const;

const GENERIC_BUILDINGS = {
  granary: { ...BUILDING_BASE, tech: 'farming', cost: 40, upkeep: 1, era: 0, yields: { food: 2 } },
  walls: {
    ...BUILDING_BASE, tech: 'fortification', cost: 50, upkeep: 0, era: 0,
    cityHp: 50, cityStrengthPercent: 20, counterStrike: true,
  },
  temple: { ...BUILDING_BASE, tech: 'ritual', cost: 40, upkeep: 1, era: 0, yields: { culture: 2 } },
  academy: { ...BUILDING_BASE, tech: 'writing', cost: 60, upkeep: 1, era: 1, yields: { science: 3 } },
  market: { ...BUILDING_BASE, tech: 'currency', cost: 60, upkeep: 0, era: 1, yields: { gold: 2 }, percent: { gold: 25 } },
  harbour: {
    ...BUILDING_BASE, tech: 'shipbuilding', cost: 60, upkeep: 1, era: 1,
    coastal: true, yields: { gold: 2 }, waterYields: { food: 1 }, tradeRoutes: 1,
  },
  printShop: { ...BUILDING_BASE, tech: 'paper', cost: 80, upkeep: 1, era: 2, yields: { culture: 3, science: 1 } },
  workshop: {
    ...BUILDING_BASE, tech: 'machinery', cost: 80, upkeep: 1, era: 2,
    yields: { production: 2 }, percent: { production: 25 },
  },
  university: {
    ...BUILDING_BASE, tech: 'printing', cost: 120, upkeep: 2, era: 3,
    yields: { science: 3 }, percent: { science: 25 },
  },
  bank: { ...BUILDING_BASE, tech: 'banking', cost: 120, upkeep: 0, era: 3, yields: { gold: 3 }, percent: { gold: 25 } },
  observatory: { ...BUILDING_BASE, tech: 'astronomy', cost: 120, upkeep: 1, era: 3, yields: { science: 4 } },
  factory: {
    ...BUILDING_BASE, tech: 'steamEngine', cost: 180, upkeep: 3, era: 4,
    yields: { production: 4 }, percent: { production: 25 },
  },
  powerPlant: {
    ...BUILDING_BASE, tech: 'electricity', cost: 180, upkeep: 3, era: 4,
    percent: { production: 25, science: 10 },
  },
  hospital: { ...BUILDING_BASE, tech: 'publicHealth', cost: 180, upkeep: 2, era: 4, yields: { food: 4 } },
  airfield: { ...BUILDING_BASE, tech: 'aviation', cost: 240, upkeep: 3, era: 5, airStrike: true },
  researchInstitute: {
    ...BUILDING_BASE, tech: 'electronics', cost: 270, upkeep: 3, era: 5,
    yields: { science: 6 }, percent: { science: 25 },
  },
} as const satisfies Record<string, BuildingDef>;
export type GenericBuildingId = keyof typeof GENERIC_BUILDINGS;
export type BuildingId = GenericBuildingId | keyof typeof UNIQUE_BUILDINGS;

/**
 * A unique building as a full definition: one that replaces a generic
 * building starts from it (cost, upkeep, tech and effects) and adds its own;
 * an extra starts from nothing.
 */
function uniqueBuilding(spec: UniqueBuildingSpec): BuildingDef {
  const base: BuildingDef | null =
    spec.replaces === undefined ? null : (GENERIC_BUILDINGS as Record<string, BuildingDef>)[spec.replaces] ?? null;
  const tech = spec.tech ?? base?.tech;
  if (tech === undefined) throw new Error(`unique building of ${spec.nation} has no tech`);
  return {
    ...BUILDING_BASE,
    ...(base ?? { cost: 0, upkeep: 0 }),
    ...(spec.cost === undefined ? {} : { cost: spec.cost }),
    ...(spec.upkeep === undefined ? {} : { upkeep: spec.upkeep }),
    tech,
    era: TECHS[tech].era,
    cityHp: (base?.cityHp ?? 0) + (spec.cityHp ?? 0),
    cityStrengthPercent: (base?.cityStrengthPercent ?? 0) + (spec.cityStrengthPercent ?? 0),
    tradeRoutes: (base?.tradeRoutes ?? 0) + (spec.tradeRoutes ?? 0),
    coastal: spec.coastal ?? base?.coastal ?? false,
    nation: spec.nation,
    replaces: spec.replaces ?? null,
    capitalOnly: spec.capitalOnly ?? false,
    modifiers: spec.modifiers,
  };
}

/** Every building by id: the generic ones, then the unique ones of the nations (`uniques.ts`). */
export const BUILDINGS: Readonly<Record<BuildingId, BuildingDef>> = {
  ...GENERIC_BUILDINGS,
  ...(Object.fromEntries(
    Object.entries(UNIQUE_BUILDINGS as Record<string, UniqueBuildingSpec>).map(([id, spec]) => [id, uniqueBuilding(spec)]),
  ) as Record<keyof typeof UNIQUE_BUILDINGS, BuildingDef>),
};
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
/** The buildings every nation can build. */
export const GENERIC_BUILDING_IDS = Object.keys(GENERIC_BUILDINGS) as GenericBuildingId[];

/** The generic kind a building is or replaces: what cards, traits and slots that name a kind go by. */
export function baseBuilding(id: BuildingId): BuildingId {
  return (BUILDINGS[id].replaces as BuildingId | null) ?? id;
}

// ------------------------------------------------------------------ units

export type UnitClass = 'infantry' | 'ranged' | 'cavalry' | 'siege' | 'naval' | 'civilian' | 'tribe';
export const COMBAT_CLASSES = ['infantry', 'ranged', 'cavalry', 'siege', 'naval'] as const;

export interface UnitDef {
  readonly id: string;
  readonly unitClass: UnitClass;
  /** Its era (index into {@link ERAS}). The settler can be built once its owner has entered it. */
  readonly era: number;
  /** The tech that unlocks it, or null for none. */
  readonly tech: TechId | null;
  /** Id (`MapResource.id`) of the strategic resource its owner needs a source of, or null. */
  readonly resource: string | null;
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
  /** Id (`MapPolity.id`) of the only nation that builds it, or null for a generic unit. */
  readonly nation: string | null;
  /** The generic unit it replaces for its nation, or null. */
  readonly replaces: string | null;
  /** The character engraved on a unique unit's piece, or null. */
  readonly piece: string | null;
  /** What sets a unique unit apart: modifiers that apply to units of this type. */
  readonly abilities: readonly Modifier[];
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

/** The tech that unlocks each unit of the roster. The warrior needs none. */
export const UNIT_TECH: Readonly<Record<string, TechId>> = {
  archer: 'archery',
  chariot: 'husbandry',
  batteringRam: 'fortification',
  galley: 'boats',
  swordsman: 'ironworking',
  crossbowman: 'crossbow',
  horseman: 'riding',
  catapult: 'crossbow',
  warJunk: 'shipbuilding',
  heavyInfantry: 'steel',
  rocketArcher: 'gunpowder',
  heavyCavalry: 'stirrup',
  trebuchet: 'machinery',
  junk: 'compass',
  musketeer: 'firearms',
  fieldGun: 'gunCasting',
  dragoon: 'firearms',
  heavyCannon: 'gunCasting',
  shipOfTheLine: 'oceanNavigation',
  rifleman: 'rifling',
  machineGun: 'steelmaking',
  mountedRifleman: 'rifling',
  howitzer: 'steelmaking',
  ironclad: 'steelmaking',
  mechInfantry: 'petrochemicals',
  rocketArtillery: 'rocketry',
  tank: 'combustion',
  missileLauncher: 'electronics',
  destroyer: 'petrochemicals',
};

/** The strategic resource a unit's owner needs a source of. */
export const UNIT_RESOURCE: Readonly<Record<string, string>> = {
  chariot: 'horses',
  horseman: 'horses',
  heavyCavalry: 'horses',
  dragoon: 'horses',
  mountedRifleman: 'horses',
  swordsman: 'iron',
  heavyInfantry: 'iron',
  ironclad: 'coal',
  tank: 'oil',
  mechInfantry: 'oil',
  destroyer: 'oil',
  missileLauncher: 'rare-earths',
};

export const UNIT_UPKEEP = 1;
/** Units a polity keeps without upkeep, per city. */
export const FREE_UNITS_PER_CITY = 2;

export const SETTLER = 'settler';
export const TRIBE = 'tribe';
/** Each settler a polity completes raises the cost of its next one by this percentage of the base cost. */
export const SETTLER_COST_STEP_PERCENT = 50;

const GENERIC_UNIT = { nation: null, replaces: null, piece: null, abilities: [] } as const;

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
        tech: UNIT_TECH[id] ?? null,
        resource: UNIT_RESOURCE[id] ?? null,
        strength: Math.round(strength * profile.strength),
        rangedStrength: Math.round(strength * profile.rangedStrength),
        range: profile.range,
        moves: profile.moves,
        cost: Math.round((ERA_UNIT_COST[era] as number) * profile.cost),
        upkeep: UNIT_UPKEEP,
        domain: profile.domain,
        cityAttackPercent: profile.cityAttackPercent,
        buildable: true,
        ...GENERIC_UNIT,
      };
    });
  }
  for (const [id, spec] of Object.entries(UNIQUE_UNITS as Record<string, UniqueUnitSpec>)) {
    const replaces = ROSTER[spec.unitClass][spec.era];
    if (replaces === undefined) throw new Error(`unique unit ${id} replaces nothing`);
    const base = units[replaces] as UnitDef;
    const scale = (value: number): number => Math.round((value * (spec.strengthPercent ?? 100)) / 100);
    const eraStrength = ERA_STRENGTH[spec.era] as number;
    units[id] = {
      ...base,
      id,
      resource: spec.resource === undefined ? base.resource : spec.resource,
      strength: scale(base.strength),
      rangedStrength:
        spec.rangedStrength === undefined ? scale(base.rangedStrength) : Math.round(eraStrength * spec.rangedStrength),
      range: spec.range ?? base.range,
      moves: spec.moves ?? base.moves,
      cost: Math.round((base.cost * (spec.costPercent ?? 100)) / 100),
      cityAttackPercent: spec.cityAttackPercent ?? base.cityAttackPercent,
      nation: spec.nation,
      replaces,
      piece: spec.piece,
      abilities: spec.abilities,
    };
  }
  units[SETTLER] = {
    id: SETTLER,
    unitClass: 'civilian',
    era: 1,
    tech: null,
    resource: null,
    strength: 0,
    rangedStrength: 0,
    range: 0,
    moves: 2,
    cost: 70,
    upkeep: UNIT_UPKEEP,
    domain: 'land',
    cityAttackPercent: 0,
    buildable: true,
    ...GENERIC_UNIT,
  };
  units[TRIBE] = {
    id: TRIBE,
    unitClass: 'tribe',
    era: 0,
    tech: null,
    resource: null,
    strength: 24,
    rangedStrength: 0,
    range: 0,
    moves: 0,
    cost: 0,
    upkeep: 0,
    domain: 'land',
    cityAttackPercent: 0,
    buildable: false,
    ...GENERIC_UNIT,
  };
  return units;
}

/** Every unit type by id: the 30 generic units, the settler, the tribe and the 50 unique units. */
export const UNITS: Readonly<Record<string, UnitDef>> = buildUnits();
/** The units every nation shares: the generic roster, the settler and the tribe. */
export const UNIT_IDS: readonly string[] = Object.keys(UNITS).filter((id) => (UNITS[id] as UnitDef).nation === null);
/** The unique units of the nations (`uniques.ts`). */
export const UNIQUE_UNIT_IDS: readonly string[] = Object.keys(UNITS).filter(
  (id) => (UNITS[id] as UnitDef).nation !== null,
);

const UNIT_REPLACEMENTS = new Map<string, string>(
  UNIQUE_UNIT_IDS.map((id) => {
    const def = UNITS[id] as UnitDef;
    return [`${def.nation ?? ''}:${def.replaces ?? ''}`, id];
  }),
);
const BUILDING_REPLACEMENTS = new Map<string, BuildingId>(
  BUILDING_IDS.flatMap((id): [string, BuildingId][] => {
    const def = BUILDINGS[id];
    return def.nation === null || def.replaces === null ? [] : [[`${def.nation}:${def.replaces}`, id]];
  }),
);
const IMPROVEMENT_REPLACEMENTS = new Map<string, ImprovementId>(
  IMPROVEMENT_IDS.flatMap((id): [string, ImprovementId][] => {
    const def = IMPROVEMENTS[id];
    return def.nation === undefined || def.replaces === undefined ? [] : [[`${def.nation}:${def.replaces}`, id]];
  }),
);

/** The unit the nation (`MapPolity.id`) builds where others build `type`: its unique unit, or `type` itself. */
export function unitFor(nation: string, type: string): string {
  return UNIT_REPLACEMENTS.get(`${nation}:${type}`) ?? type;
}

/** The building the nation builds where others build `id`: its unique building, or `id` itself. */
export function buildingFor(nation: string, id: BuildingId): BuildingId {
  return BUILDING_REPLACEMENTS.get(`${nation}:${id}`) ?? id;
}

/** The improvement the nation builds where others build `id`: its unique improvement, or `id` itself. */
export function improvementFor(nation: string, id: ImprovementId): ImprovementId {
  return IMPROVEMENT_REPLACEMENTS.get(`${nation}:${id}`) ?? id;
}

/** The roster of a class as the nation builds it, eras in order: its unique unit stands where it replaces one. */
export function rosterFor(nation: string, unitClass: keyof typeof ROSTER): string[] {
  return ROSTER[unitClass].map((type) => unitFor(nation, type));
}

export function unitDef(type: string): UnitDef {
  const def = UNITS[type];
  if (def === undefined) throw new Error(`unknown unit type: ${type}`);
  return def;
}

/**
 * The next era's unit of the same class, or null. The upgrade a unit really
 * gets is the nearest later unit its owner can build: see `upgradeTargetFor`.
 */
export function upgradeTarget(type: string): UnitDef | null {
  const def = unitDef(type);
  if (def.unitClass === 'civilian' || def.unitClass === 'tribe') return null;
  const next = ROSTER[def.unitClass][def.era + 1];
  return next === undefined ? null : unitDef(unitFor(def.nation ?? '', next));
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
  /** A melee land unit attacking from the water onto land. */
  amphibiousPercent: -50,
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

/** The strike a city with an airfield makes once per turn. */
export const AIR_STRIKE = {
  /** Reach in hexes from the city. */
  range: 6,
  /** Its attack strength: that of a modern ranged unit. */
  strength: 76,
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

/** The endgame project of the Science victory: its stages are built in order in the capital. */
export const PROJECT = {
  id: 'tiangong',
  stages: [
    { tech: 'rocketry', cost: 470 },
    { tech: 'electronics', cost: 470 },
    { tech: 'informationNetworks', cost: 470 },
  ],
} as const satisfies { id: string; stages: readonly { tech: TechId; cost: number }[] };

// --------------------------------------------------------------- policies

export type PolicyKind = 'economy' | 'military' | 'civil' | 'diplomacy';

/** A policy card. Every effect field is read by the rule it belongs to; a card sets only the ones it has. */
export interface PolicyDef {
  /** Index into {@link ERAS}: the card can be unlocked once the polity has entered this era. */
  readonly era: number;
  readonly kind: PolicyKind;
  /** Added to the yields of each improvement of the kind. */
  readonly improvementYields?: Readonly<Partial<Record<ImprovementId, Partial<Yields>>>>;
  /** Flat yields a city gets for each of these buildings it has. */
  readonly buildingYields?: Readonly<Partial<Record<BuildingId, Partial<Yields>>>>;
  /** Percentage a city with the building adds to a yield. */
  readonly buildingPercent?: Readonly<Partial<Record<BuildingId, Partial<Yields>>>>;
  /** Flat yields of the capital. */
  readonly capitalYields?: Partial<Yields>;
  /** Percentage added to a yield of every city. */
  readonly cityPercent?: Partial<Yields>;
  /** Percentage added to a yield of every city but the capital. */
  readonly nonCapitalPercent?: Partial<Yields>;
  /** One extra science per this many citizens in each city. */
  readonly popPerScience?: number;
  /** Percentage added to a city's production while it builds a unit. */
  readonly unitProductionPercent?: number;
  /** The same, for land units from the era {@link MODERN_LAND_ERA} on. */
  readonly modernLandUnitProductionPercent?: number;
  /** Percentage added to a city's production while it builds a building. */
  readonly buildingProductionPercent?: number;
  /** Percentage added to unit upkeep (negative: cheaper). */
  readonly unitUpkeepPercent?: number;
  /** Culture for each enemy unit its units destroy. */
  readonly cultureOnKill?: number;
  /** Percentage of strength against an enemy that one of its allies is also at war with. */
  readonly allyStrengthPercent?: number;
  /** Percentage of strength for the units of {@link FIREARM_UNITS}. */
  readonly firearmStrengthPercent?: number;
  /** Percentage of strength for a unit on its owner's land. */
  readonly homeStrengthPercent?: number;
  /** Percentage added to the influence it gains with city-states. */
  readonly influencePercent?: number;
  /** Percentage added to the tribute its vassals and the city-states it is suzerain of pay. */
  readonly tributePercent?: number;
  /** Gold added to each of its sea trade routes. */
  readonly seaRouteGold?: number;
  /** Percentage of city gold for both sides of a trade pact it has. */
  readonly tradePactGoldPercent?: number;
  /** Multiplier of the income of its trade routes to an ally's city. */
  readonly allyRouteMultiplier?: number;
}

const POLICY_TABLE = {
  // Ancient
  wellField: { era: 0, kind: 'economy', improvementYields: { farm: { food: 1 } } },
  citizenLevy: { era: 0, kind: 'military', unitProductionPercent: 15 },
  clanLaw: { era: 0, kind: 'civil', capitalYields: { culture: 2 } },
  covenant: { era: 0, kind: 'diplomacy', influencePercent: 25 },
  // Classical
  commanderies: { era: 1, kind: 'economy', nonCapitalPercent: { production: 10 } },
  meritRanks: { era: 1, kind: 'military', cultureOnKill: 5 },
  hundredSchools: { era: 1, kind: 'civil', buildingYields: { academy: { science: 2 } } },
  alliances: { era: 1, kind: 'diplomacy', allyStrengthPercent: 5 },
  // Medieval
  twoTax: { era: 2, kind: 'economy', cityPercent: { gold: 10 } },
  paidArmy: { era: 2, kind: 'military', unitUpkeepPercent: -20 },
  imperialExam: { era: 2, kind: 'civil', buildingYields: { academy: { culture: 1 }, printShop: { culture: 1 } } },
  tribute: { era: 2, kind: 'diplomacy', tributePercent: 50 },
  // Early Modern
  singleWhip: { era: 3, kind: 'economy', buildingYields: { market: { gold: 2 }, bank: { gold: 2 } } },
  firearmsCorps: { era: 3, kind: 'military', firearmStrengthPercent: 5 },
  academyLectures: { era: 3, kind: 'civil', buildingYields: { university: { science: 3 } } },
  openSeas: { era: 3, kind: 'diplomacy', seaRouteGold: 2 },
  // Industrial
  industryFirst: { era: 4, kind: 'economy', buildingPercent: { factory: { production: 15 } } },
  newArmy: { era: 4, kind: 'military', modernLandUnitProductionPercent: 20 },
  newSchools: { era: 4, kind: 'civil', popPerScience: 5 },
  treatyPorts: { era: 4, kind: 'diplomacy', tradePactGoldPercent: 10 },
  // Modern
  industrialPlanning: { era: 5, kind: 'economy', buildingProductionPercent: 15 },
  totalDefence: { era: 5, kind: 'military', homeStrengthPercent: 10 },
  compulsoryEducation: { era: 5, kind: 'civil', cityPercent: { science: 10 } },
  regionalCooperation: { era: 5, kind: 'diplomacy', allyRouteMultiplier: 2 },
} as const satisfies Record<string, PolicyDef>;

export type PolicyId = keyof typeof POLICY_TABLE;
/** The 24 cards of doc 04, in the order of its table. */
export const POLICY_IDS = Object.keys(POLICY_TABLE) as PolicyId[];
export const POLICIES: Readonly<Record<PolicyId, PolicyDef>> = POLICY_TABLE;

export function isPolicyId(value: unknown): value is PolicyId {
  return typeof value === 'string' && Object.hasOwn(POLICY_TABLE, value);
}

export const POLICY = {
  /** Slots by era. */
  slotsByEra: [2, 3, 4, 5, 6, 6],
  /** Culture the card after `n` unlocked ones costs: `costBase + costStep * n + costCurve * n * n`, rounded. */
  costBase: 6,
  costStep: 0,
  costCurve: 0.85,
  /** Turns before another paid swap after one. */
  swapCooldown: 5,
} as const;

/** Culture needed for the next card of a polity that has unlocked `unlocked` cards. */
export function policyCost(unlocked: number): number {
  return Math.round(POLICY.costBase + POLICY.costStep * unlocked + POLICY.costCurve * unlocked * unlocked);
}

/** The units the Firearms corps card strengthens: the gunpowder land units of the Early Modern and Industrial eras. */
export const FIREARM_UNITS: readonly string[] = [
  'musketeer', 'fieldGun', 'dragoon', 'heavyCannon', 'rifleman', 'machineGun', 'mountedRifleman', 'howitzer',
];
/** The New Army card speeds up land units from this era (Industrial) on. */
export const MODERN_LAND_ERA = 4;

// -------------------------------------------------------------- diplomacy

export const AGREEMENT_KINDS = ['tradePact', 'openBorders', 'alliance', 'vassalage', 'truce'] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export const DIPLOMACY = {
  /** Turns a trade pact or an open-borders agreement lasts. */
  termTurns: 30,
  /** Turns before a trade pact, open borders or an alliance can be cancelled. */
  minTurns: 10,
  /** Alliances a polity can have at once. */
  maxAlliances: 2,
  /** Turns a pending offer to the player stays open. */
  offerTurns: 10,
  /** Share of its income (city gold and trade routes) a vassal pays its overlord, in percent. */
  vassalTributePercent: 20,
} as const;

/** Favour between two nations runs from `-max` to `max` and starts at 0. */
export const FAVOUR = {
  max: 100,
  /** Points per turn it moves towards the sum of the standing terms below that apply. */
  drift: 1,
  // Standing terms.
  border: -5,
  war: -60,
  tradePact: 15,
  openBorders: 10,
  alliance: 30,
  vassalage: 15,
  /** Per resource deal between the two. */
  deal: 5,
  /** Per trade route between the two. */
  route: 5,
  /** Per third polity both are at war with. */
  sharedEnemy: 10,
  /** Deals, routes and shared enemies each count at most this many times. */
  maxCounted: 2,
  // One-off changes.
  warDeclared: -30,
  /** Towards a polity whose ally it attacked. */
  allyAttacked: -15,
  peaceMade: 10,
  /** An agreement or deal that ran its full term. */
  dealKept: 5,
  /** An agreement or deal cancelled, unpaid or ended by war. */
  dealBroken: -15,
  /** Gold of a gift per point of favour. */
  goldPerPoint: 10,
} as const;

export const DEAL = {
  /** Turns a resource deal lasts. */
  turns: 20,
  maxGoldPerTurn: 50,
  /** What the AI asks and pays per turn. */
  strategicPrice: 4,
  specialtyPrice: 2,
  /** The AI sells only at this favour or more. */
  minFavour: -20,
} as const;

/** What a specialty is good for: gold in every city for each different specialty the polity has, own or bought. */
export const SPECIALTY = {
  goldPerCity: 1,
  /** Specialties beyond this many add nothing. */
  max: 5,
} as const;

// ------------------------------------------------------------------ trade

export const TRADE = {
  /** Route slots every nation and city-state has from the start. */
  baseRoutes: 1,
  /** Longest land path, in hexes. */
  landRange: 24,
  /** Longest sea path, in hexes. */
  seaRange: 40,
  /** A land path counts a hex without a road as this many hexes with one, so it follows the roads. */
  offRoadFactor: 2,
  /** Income: `baseGold + path length / hexesPerGold + (both populations) / popPerGold + specialties`. */
  baseGold: 2,
  hexesPerGold: 5,
  popPerGold: 5,
  /** Per specialty found in the zone of one of the two cities and not the other. */
  specialtyGold: 2,
  /** What an off-map port adds in place of a second city. */
  portGold: 4,
  /** A route between two cities of the same polity earns this share. */
  domesticPercent: 50,
  /** Added to a route to a city of a trade-pact partner. */
  pactPercent: 50,
  /** Turns a pillaged route earns nothing. */
  pillageTurns: 5,
  /** The pillager gets this many turns of the route's income. */
  pillageIncomeTurns: 3,
} as const;

/** Off-map ports (by `MapOffMapPort.nameEn`) that only one polity (by id) may use. */
export const EXCLUSIVE_PORTS: Readonly<Record<string, string>> = {
  'Great Eastern Ocean': 'luzon',
};

export const ROADS = {
  /** A city is linked to its nearest own cities within this many hexes... */
  range: 10,
  /** ...at most this many of them... */
  links: 2,
  /** ...when a land path of at most this many hexes joins them. */
  maxPath: 16,
  /** Movement points to step from a road hex onto a road hex, rivers and terrain notwithstanding. */
  roadCost: 0.5,
  /** The same between two railway hexes. */
  railCost: 0.25,
} as const;

export const PILLAGE = {
  /** Turns a pillaged improvement yields nothing. */
  turns: 10,
  /** The pillager gets this share of the improvement's production cost in gold. */
  goldPercentOfCost: 50,
} as const;

export const BUY = {
  /** Gold per point of production cost when a city buys a unit or a building. */
  goldPerProduction: 3,
} as const;

// ------------------------------------------------------------ city-states

export const CITY_STATE_TYPES = ['finance', 'culture', 'industry', 'commerce', 'naval'] as const;
export type CityStateType = (typeof CITY_STATE_TYPES)[number];

/** Type of each city-state of doc 01, by polity id. Any other city-state gets a type by its position. */
export const CITY_STATE_TYPE_BY_ID: Readonly<Record<string, CityStateType>> = {
  xiangjiang: 'finance',
  haojing: 'culture',
  shen: 'finance',
  jinmen: 'industry',
  temasek: 'commerce',
  wenlai: 'commerce',
  dimen: 'commerce',
  tamna: 'naval',
  tsushima: 'naval',
  shazhou: 'culture',
};

export const CITY_STATE = {
  /** Influence needed to be suzerain. */
  suzerainInfluence: 60,
  maxInfluence: 200,
  /** Influence per turn for each trade route to the city-state. */
  influencePerRoute: 4,
  /** Gold of a gift per point of influence. */
  goldPerInfluence: 2,
  /** Influence every polity loses per turn. */
  decay: 1,
  /** Share of its gold income a city-state pays its suzerain, in percent. */
  tributePercent: 10,
  // Suzerain bonuses, per city-state of the type.
  financeGoldPercent: 10,
  cultureInCapital: 3,
  industryCapitalProductionPercent: 15,
  commerceRoutes: 1,
  /** Experience of a newly built ship. */
  navalXp: 8,
} as const;

// ------------------------------------------------------------- difficulty

/** The five difficulty levels, easiest first. */
export const DIFFICULTY_LEVELS = ['relaxed', 'easy', 'standard', 'hard', 'severe'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];
/** The middle level: the AI plays by the same rules as the player. */
export const DEFAULT_DIFFICULTY: DifficultyLevel = 'standard';

/** What a level gives one side: a percentage on every city yield, and on the strength of its units and cities. */
export interface DifficultyBonus {
  readonly yieldPercent: number;
  readonly strengthPercent: number;
}

/**
 * What each level gives the player and what it gives the AI's major nations.
 * Below the middle level the player is helped, above it the AI majors are;
 * nobody else is ever touched.
 */
export const DIFFICULTY: Readonly<Record<DifficultyLevel, { readonly player: DifficultyBonus; readonly ai: DifficultyBonus }>> = {
  relaxed: { player: { yieldPercent: 30, strengthPercent: 20 }, ai: { yieldPercent: 0, strengthPercent: 0 } },
  easy: { player: { yieldPercent: 15, strengthPercent: 10 }, ai: { yieldPercent: 0, strengthPercent: 0 } },
  standard: { player: { yieldPercent: 0, strengthPercent: 0 }, ai: { yieldPercent: 0, strengthPercent: 0 } },
  hard: { player: { yieldPercent: 0, strengthPercent: 0 }, ai: { yieldPercent: 15, strengthPercent: 10 } },
  severe: { player: { yieldPercent: 0, strengthPercent: 0 }, ai: { yieldPercent: 30, strengthPercent: 20 } },
};

export function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return typeof value === 'string' && (DIFFICULTY_LEVELS as readonly string[]).includes(value);
}

// ----------------------------------------------------------------- tribes

/** One tribe per this many hexes of a wasteland zone, at least one per zone. */
export const HEXES_PER_TRIBE = 12;

// --------------------------------------------------------------------- AI

const AI_BUILDING_ORDER: readonly BuildingId[] = [
  'granary', 'walls', 'workshop', 'factory', 'academy', 'market', 'university', 'observatory', 'researchInstitute',
  'bank', 'powerPlant', 'hospital', 'harbour', 'temple', 'printShop', 'airfield',
];

export const AI = {
  /** The order in which a city gets its buildings. */
  buildingOrder: AI_BUILDING_ORDER,
  /** Field army mix by class and share: the class furthest below its share is built next. */
  armyMix: [
    ['infantry', 3],
    ['ranged', 2],
    ['siege', 2],
    ['cavalry', 1],
  ],
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
  /**
   * Research: how much it wants a tech of each kind, at peace and at war.
   * A naval tech counts as an economy tech for a polity with a coastal city.
   */
  researchAtPeace: { science: 4, economy: 3, military: 2, naval: 1 },
  researchAtWar: { military: 4, science: 3, economy: 2, naval: 1 },
  /** Taken off a tech's score per era it lies beyond the oldest tech still open, so an era is finished first. */
  researchEraStep: 10,
  /**
   * Policies: how much it wants a card of each kind, at peace and at war. A
   * diplomacy card counts only for a polity that has what the card works on.
   */
  policyAtPeace: { economy: 4, civil: 3, diplomacy: 2, military: 1 },
  policyAtWar: { military: 4, economy: 3, civil: 2, diplomacy: 1 },
  /** A card's era adds this much per era to its score: newer cards are stronger. */
  policyEraWeight: 0.5,
  /** A polity looks at its agreements, deals and gifts every this many turns (staggered by its index). */
  diplomacyInterval: 4,
  /** Favour at which a major accepts a trade pact, open borders and an alliance. */
  tradePactFavour: -10,
  openBordersFavour: 5,
  allianceFavour: 30,
  /** A nation on the simplified AI accepts an alliance at this favour. */
  simpleAllianceFavour: 10,
  /** A nation on the simplified AI becomes a vassal peacefully when the other is this many times stronger... */
  vassalStrengthRatio: 8,
  /** ...and favour is at least this. */
  vassalFavour: 40,
  /** A major takes a capital's owner as a vassal instead of the city when it is this many times stronger. */
  demandVassalRatio: 2,
  /** ...and it is at war with somebody else too, or its war weariness has reached this. */
  vassalWeariness: 15,
  /** Vassals a major wants at most. */
  maxVassals: 3,
  /** Gold kept back before gifts, and before buying when nothing threatens. */
  goldReserve: 80,
  /** Gold of one gift to a city-state. */
  giftGold: 30,
  /** A city-state this close (hexes between capitals) is worth courting. */
  courtRange: 14,
  /** An enemy unit this close to a city is a threat. */
  threatRange: 3,
  /** Candidate destinations it tries per free route slot. */
  routeTries: 8,
  /** Warships a nation wants per coastal city... */
  shipsPerCoastalCity: 0.5,
  /** ...plus one per enemy warship afloat... */
  shipsPerEnemyShip: 1,
  /** ...plus this many while its army marches on a city it can only reach by sea. */
  shipsForSeaTarget: 2,
  /** Its navy is at most this share of the units it can pay for (but one ship is always allowed beside the garrisons). */
  navyShare: 0.4,
  /** A coastal city within this many hexes by water of one of its own is a neighbour by sea. */
  seaReach: 12,
  /** A fleet with nothing else to do hunts enemy ships and embarked units this close to its coastal cities. */
  patrolRange: 8,
} as const;
