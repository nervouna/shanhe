/**
 * The game state, the actions that change it and the events that report the
 * changes. Everything except `GameState.map` is plain JSON data.
 *
 * Conventions: a polity is its index in `map.polities`; a city is the index
 * of its zone in `map.zones` (a zone holds at most one city); a hex is its
 * index `row * width + col`; a unit is its numeric `id`.
 */

import type { MapData } from '../shared/mapData.ts';
import type { BuildingId, Focus, ImprovementId, Yields } from './data.ts';

/** Owner of the tribes, and the "nobody" value of `zoneOwner`. */
export const NO_POLITY = -1;

/** How a new game is set up. */
export interface GameSetup {
  /** Seed of the game's random generator. Default 0. */
  readonly seed?: number;
  /** Id (`MapPolity.id`) of the human player's polity, or null for observer mode. Default null. */
  readonly player?: string | null;
  /**
   * Ids of the major nations. Default: the nations of doc 02's default list
   * that the map has, or the map's first twelve nations if it has none of them.
   */
  readonly majors?: readonly string[];
  /** Length of the game in turns. Default {@link GAME_TURNS}. */
  readonly turns?: number;
}

/** Something a city can build. */
export type BuildItem =
  | { readonly kind: 'unit'; readonly unit: string }
  | { readonly kind: 'building'; readonly building: BuildingId }
  | { readonly kind: 'improvement'; readonly improvement: ImprovementId; readonly hex: number }
  /** Founds the nation's city on the preset site of one of its own zones. */
  | { readonly kind: 'city'; readonly zone: number };

export interface City {
  /** Index into `map.zones`; also the city's identifier. */
  zone: number;
  owner: number;
  /** The polity the zone belonged to when the game started (`NO_POLITY` for wasteland). */
  originalOwner: number;
  pop: number;
  /** Food stored towards the next citizen. */
  food: number;
  hp: number;
  focus: Focus;
  buildings: BuildingId[];
  /** The first entry is the current project. */
  queue: BuildItem[];
  /** Production stored towards the current project. */
  progress: number;
  /** Turns of unrest left. */
  unrest: number;
  /** 0–100. */
  morale: number;
  /** True once the walls have made this turn's counter-strike. */
  struck: boolean;
  /** Turn in which the city was last attacked, or 0. */
  attackedOn: number;
  /** Hexes its citizens work, as of the last assignment. */
  worked: number[];
  /** Its yields per turn, as of the last assignment. */
  yields: Yields;
}

export type UnitStatus = 'ready' | 'fortified' | 'asleep';

export interface Unit {
  id: number;
  /** Key of `UNITS` in `data.ts`. */
  type: string;
  /** Polity index, or `NO_POLITY` for a tribe. */
  owner: number;
  hex: number;
  hp: number;
  /** Movement points left this turn. */
  moves: number;
  xp: number;
  /** 0–3. */
  level: number;
  status: UnitStatus;
  /** True once it moved or attacked this turn: it then does not heal. */
  acted: boolean;
}

export interface PolityState {
  /** False once annexed. Always false for a wasteland region. */
  alive: boolean;
  gold: number;
  /** Cumulative gross gold income: what the Economic victory ranks. */
  grossIncome: number;
  /** Accumulated science and culture; they unlock nothing yet. */
  science: number;
  culture: number;
  /** Total city yields of the last turn processing. */
  yields: Yields;
  /** Gold spent on unit and building upkeep in the last turn processing. */
  upkeep: number;
  warWeariness: number;
  /** Settlers completed so far; each raises the cost of the next. */
  settlersBuilt: number;
  /** Zone of the current capital, or -1. */
  capital: number;
  /** AI memory: the enemy city (zone) its army is concentrating on, or -1. */
  aiTarget: number;
}

/** State of a pair of polities that have been at war at least once. */
export interface Relation {
  /** The lower polity index. */
  a: number;
  b: number;
  atWar: boolean;
  /** Turn the current war, or the current peace, began. */
  since: number;
  /** Turn in which `a` last offered peace to `b`, or 0. */
  offerA: number;
  /** Turn in which `b` last offered peace to `a`, or 0. */
  offerB: number;
}

export type GameResult =
  | { readonly kind: 'conquest'; readonly winner: number; readonly turn: number }
  | { readonly kind: 'economic'; readonly winner: number; readonly turn: number };

export interface GameStats {
  citiesCaptured: number;
  citiesFounded: number;
  warsDeclared: number;
  politiesAnnexed: number;
}

/** Everything that defines a game in progress. The public API never modifies a state it was given. */
export interface GameState {
  /** The map the game is played on. Never modified, and not part of a save. */
  readonly map: MapData;
  /** Version of the state format. */
  readonly version: number;
  /** The current turn, starting at 1. */
  readonly turn: number;
  /** The last turn of the game. */
  readonly lastTurn: number;
  readonly seed: number;
  /** State of the random generator. */
  readonly rng: number;
  /** The human player's polity, or `NO_POLITY` in observer mode. */
  readonly player: number;
  /** The major nations, ascending. Fixed at setup. */
  readonly majors: readonly number[];
  /** Per polity, in the order of `map.polities`. */
  readonly polities: readonly Readonly<PolityState>[];
  /** Per zone: the polity that owns it, or `NO_POLITY` for unsettled wasteland. */
  readonly zoneOwner: readonly number[];
  /** Per zone: its city, or null while the site is empty. */
  readonly cities: readonly (Readonly<City> | null)[];
  /** All units, tribes included, in order of creation. */
  readonly units: readonly Readonly<Unit>[];
  readonly nextUnitId: number;
  /** Improvements by hex index. */
  readonly improvements: Readonly<Record<string, ImprovementId>>;
  /** Pairs of polities that are or have been at war, by `"a:b"` with `a < b`. Every other pair is at peace. */
  readonly relations: Readonly<Record<string, Readonly<Relation>>>;
  readonly stats: Readonly<GameStats>;
  /** Null while the game runs. Once set, nothing changes any more. */
  readonly result: GameResult | null;
}

/** Deeply writable version of a type; the rules work on a private copy of the state. */
export type Mutable<T> = T extends MapData
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
export type MutableGameState = Mutable<GameState>;

/** Everything a participant can do. `polity` is the polity that acts. */
export type Action =
  /** Moves a unit to an adjacent hex. */
  | { readonly type: 'move'; readonly polity: number; readonly unit: number; readonly to: number }
  /** Attacks the city or unit on `target` (a hex). A melee attack on a city at 0 HP captures it. */
  | { readonly type: 'attack'; readonly polity: number; readonly unit: number; readonly target: number }
  | { readonly type: 'fortify'; readonly polity: number; readonly unit: number }
  | { readonly type: 'sleep'; readonly polity: number; readonly unit: number }
  | { readonly type: 'upgrade'; readonly polity: number; readonly unit: number }
  /** Founds a city with a settler standing on an unsettled wasteland site. */
  | { readonly type: 'settle'; readonly polity: number; readonly unit: number }
  | { readonly type: 'setFocus'; readonly polity: number; readonly city: number; readonly focus: Focus }
  /** Appends an item to a city's build queue. */
  | { readonly type: 'queueBuild'; readonly polity: number; readonly city: number; readonly item: BuildItem }
  /** Removes the item at `index` from a city's build queue. */
  | { readonly type: 'unqueueBuild'; readonly polity: number; readonly city: number; readonly index: number }
  | { readonly type: 'declareWar'; readonly polity: number; readonly target: number }
  /** Makes peace if the other side agrees; towards a human player it records an offer. */
  | { readonly type: 'makePeace'; readonly polity: number; readonly target: number };

/** What happened, for the UI and the renderer to show. */
export type GameEvent =
  | { readonly type: 'unitMoved'; readonly unit: number; readonly owner: number; readonly from: number; readonly to: number }
  | {
      readonly type: 'combat';
      readonly unit: number;
      readonly owner: number;
      readonly from: number;
      readonly target: number;
      readonly ranged: boolean;
      /** Id of the defending unit, or -1 when a city defends. */
      readonly defenderUnit: number;
      /** Zone of the defending city, or -1. */
      readonly defenderCity: number;
      readonly damageToDefender: number;
      readonly damageToAttacker: number;
    }
  | { readonly type: 'cityStrike'; readonly city: number; readonly unit: number; readonly damage: number }
  | { readonly type: 'unitKilled'; readonly unit: number; readonly owner: number; readonly hex: number; readonly unitType: string }
  | { readonly type: 'unitCreated'; readonly unit: number; readonly owner: number; readonly hex: number; readonly unitType: string }
  | { readonly type: 'unitUpgraded'; readonly unit: number; readonly from: string; readonly to: string }
  | { readonly type: 'unitPromoted'; readonly unit: number; readonly level: number }
  /** A unit was moved out of territory that closed to it. */
  | { readonly type: 'unitExpelled'; readonly unit: number; readonly from: number; readonly to: number }
  /** A unit was removed without a fight: no gold for upkeep, no room to go, or its polity was annexed. */
  | { readonly type: 'unitDisbanded'; readonly unit: number; readonly owner: number; readonly hex: number }
  | { readonly type: 'cityFounded'; readonly city: number; readonly owner: number }
  | { readonly type: 'cityPopulation'; readonly city: number; readonly pop: number }
  | { readonly type: 'cityBuilt'; readonly city: number; readonly item: BuildItem }
  | { readonly type: 'cityCaptured'; readonly city: number; readonly from: number; readonly to: number }
  | { readonly type: 'zoneTransferred'; readonly zone: number; readonly from: number; readonly to: number }
  | { readonly type: 'polityAnnexed'; readonly polity: number; readonly by: number }
  | { readonly type: 'warDeclared'; readonly by: number; readonly on: number }
  | { readonly type: 'peaceOffered'; readonly from: number; readonly to: number }
  | { readonly type: 'peaceMade'; readonly a: number; readonly b: number }
  | { readonly type: 'eraStarted'; readonly era: number }
  | { readonly type: 'turnStarted'; readonly turn: number }
  | { readonly type: 'gameEnded'; readonly result: GameResult };

/** Why an action was rejected. */
export type RejectReason =
  | 'gameOver'
  | 'badAction'
  | 'badPolity'
  | 'noSuchUnit'
  | 'notYourUnit'
  | 'noSuchCity'
  | 'notYourCity'
  | 'noMovesLeft'
  | 'notAdjacent'
  | 'impassable'
  | 'closedBorders'
  | 'hexOccupied'
  | 'cannotAttack'
  | 'outOfRange'
  | 'noTarget'
  | 'atPeace'
  | 'alreadyFortified'
  | 'noUpgrade'
  | 'notInOwnBorders'
  | 'notEnoughGold'
  | 'notASettler'
  | 'notASettleSite'
  | 'badItem'
  | 'eraTooEarly'
  | 'alreadyBuilt'
  | 'alreadyQueued'
  | 'needsCoast'
  | 'badHex'
  | 'badIndex'
  | 'badTarget'
  | 'alreadyAtWar'
  | 'truce'
  | 'notAtWar'
  | 'warTooYoung'
  | 'refused';

export type ActionResult =
  | { readonly ok: true; readonly state: GameState; readonly events: GameEvent[] }
  | { readonly ok: false; readonly reason: RejectReason; readonly state: GameState; readonly events: GameEvent[] };
