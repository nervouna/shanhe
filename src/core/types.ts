/**
 * The game state, the actions that change it and the events that report the
 * changes. Everything except `GameState.map` is plain JSON data.
 *
 * Conventions: a polity is its index in `map.polities`; a city is the index
 * of its zone in `map.zones` (a zone holds at most one city); a hex is its
 * index `row * width + col`; a unit is its numeric `id`.
 */

import type { MapData } from '../shared/mapData.ts';
import type {
  AgreementKind,
  BuildingId,
  CityStateType,
  Focus,
  ImprovementId,
  PolicyId,
  TechId,
  Yields,
} from './data.ts';

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
  | { readonly kind: 'city'; readonly zone: number }
  /** The next stage of the endgame project (`PROJECT` in `data.ts`). Only in the capital. */
  | { readonly kind: 'project'; readonly project: string };

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
  /** True once the airfield has made this turn's air strike. */
  airStruck: boolean;
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
  /** Cumulative science and culture. */
  science: number;
  culture: number;
  /** Culture stored towards the next policy card; `policyCost(policies.length)` buys one. */
  cultureProgress: number;
  /** The policy cards it has unlocked, in order. City-states have none. */
  policies: PolicyId[];
  /** Its policy slots: one entry per slot of its era, null while empty. */
  slots: (PolicyId | null)[];
  /** Swaps it may still make without a cooldown: one per card unlocked. */
  freeSwaps: number;
  /** The first turn in which it may make a paid swap again. */
  swapReadyOn: number;
  /** The polity it is a vassal of, or -1. */
  overlord: number;
  /** For a city-state: its type. Null for everybody else. */
  cityStateType: CityStateType | null;
  /** For a city-state: influence of each polity that has any, by polity index. */
  influence: Record<string, number>;
  /** For a city-state: its suzerain, or -1. */
  suzerain: number;
  /** Gold of the last turn processing: from its trade routes, ... */
  routeIncome: number;
  /** ...received as tribute from vassals and city-states, and paid as tribute, ... */
  tributeReceived: number;
  tributePaid: number;
  /** ...and from resource deals: what it was paid less what it paid. */
  dealIncome: number;
  /** The techs it knows, in the order it learned them. */
  techs: TechId[];
  /** The tech it is researching, or null. A polity on the simplified AI never researches. */
  research: TechId | null;
  /** Science stored towards the current research. */
  researchProgress: number;
  /** Index into `ERAS` of the highest era it has entered. */
  era: number;
  /** Stages of the endgame project it has completed. */
  projectStage: number;
  /** Trade route slots its techs give. Its total is `routeSlots` in `game.ts`. */
  tradeRoutes: number;
  /** True once its techs open the off-map land ports to its trade routes. */
  landPorts: boolean;
  /** True once its techs open the off-map sea exits to its trade routes. */
  seaExits: boolean;
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

/**
 * An agreement in force between two polities. For a vassalage `a` is the
 * overlord and `b` the vassal; for the others `a` is the lower index.
 */
export interface Agreement {
  kind: AgreementKind;
  a: number;
  b: number;
  /** Turn it was signed. */
  since: number;
  /** The last turn it is in force, or 0 for one without a term (alliance, vassalage). */
  until: number;
}

/** A resource the seller lets the buyer use for gold per turn. */
export interface Deal {
  id: number;
  seller: number;
  buyer: number;
  /** `MapResource.id` of a specialty or a strategic resource. */
  resource: string;
  goldPerTurn: number;
  since: number;
  /** The last turn it is in force. */
  until: number;
}

/** A proposal waiting for the human player's answer (`respond`). */
export type Offer =
  | {
      id: number;
      type: 'agreement';
      from: number;
      to: number;
      /** Turn it was made. */
      turn: number;
      agreement: AgreementKind;
    }
  | {
      id: number;
      type: 'deal';
      from: number;
      to: number;
      turn: number;
      seller: number;
      resource: string;
      goldPerTurn: number;
    };

/** Where a trade route goes: a city (by zone) or an off-map port (index into `map.offMapPorts`). */
export type RouteTarget =
  | { readonly kind: 'city'; readonly zone: number }
  | { readonly kind: 'port'; readonly port: number };

export interface TradeRoute {
  id: number;
  owner: number;
  /** Zone of the owner's city it starts from. */
  from: number;
  /** Zone of the city it goes to, or -1 when it goes to a port. */
  toCity: number;
  /** Index into `map.offMapPorts` of the port it goes to, or -1. */
  toPort: number;
  /** True for a sea route. */
  sea: boolean;
  /** The hexes it runs over, from the first city to the second or to the hex next to the port. */
  path: number[];
  /** Gold it gave its owner in the last turn processing (at once after `establishRoute`: what it will give). */
  income: number;
  /** It earns nothing up to and including this turn: it was pillaged. 0 otherwise. */
  pillagedUntil: number;
}

export type GameResult =
  | { readonly kind: 'conquest'; readonly winner: number; readonly turn: number }
  | { readonly kind: 'science'; readonly winner: number; readonly turn: number }
  | { readonly kind: 'economic'; readonly winner: number; readonly turn: number };

export interface GameStats {
  citiesCaptured: number;
  citiesFounded: number;
  warsDeclared: number;
  politiesAnnexed: number;
  alliancesFormed: number;
  vassalsMade: number;
  routesEstablished: number;
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
  /** Favour between two nations, by `"a:b"` with `a < b`, from -100 to 100. A pair without an entry is at 0. */
  readonly favour: Readonly<Record<string, number>>;
  /** The agreements in force, in the order they were signed. */
  readonly agreements: readonly Readonly<Agreement>[];
  /** The resource deals in force. */
  readonly deals: readonly Readonly<Deal>[];
  /** Proposals waiting for the human player's answer. */
  readonly offers: readonly Readonly<Offer>[];
  readonly routes: readonly Readonly<TradeRoute>[];
  /** Next id for an offer, a deal or a trade route. */
  readonly nextId: number;
  /** Roads by hex index: 1 for a road, 2 for a railway. */
  readonly roads: Readonly<Record<string, number>>;
  /** City pairs (`"zoneA:zoneB"`, `zoneA < zoneB`) whose road link has been looked at: 1 built, 0 no way. */
  readonly roadLinks: Readonly<Record<string, number>>;
  /** Pillaged improvements by hex index: the last turn in which the improvement yields nothing. */
  readonly pillaged: Readonly<Record<string, number>>;
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
  /** Chooses the tech the polity researches. Science already stored stays. */
  | { readonly type: 'setResearch'; readonly polity: number; readonly tech: TechId }
  /** The air strike of a city with an airfield on the enemy city or unit on `target` (a hex). */
  | { readonly type: 'airStrike'; readonly polity: number; readonly city: number; readonly target: number }
  | { readonly type: 'declareWar'; readonly polity: number; readonly target: number }
  /** Makes peace if the other side agrees; towards a human player it records an offer. */
  | { readonly type: 'makePeace'; readonly polity: number; readonly target: number }
  /** Unlocks a policy card with stored culture. */
  | { readonly type: 'unlockPolicy'; readonly polity: number; readonly policy: PolicyId }
  /** Puts an unlocked card into slot `slot`, or empties the slot with `policy: null`. */
  | { readonly type: 'slotPolicy'; readonly polity: number; readonly policy: PolicyId | null; readonly slot: number }
  /**
   * Proposes an agreement to `target`. An AI answers at once (`refused` when
   * it declines); a human player gets a pending offer. `vassalage` asks the
   * target to become the proposer's vassal; `truce` is `makePeace`.
   */
  | { readonly type: 'propose'; readonly polity: number; readonly target: number; readonly agreement: AgreementKind }
  /** The player's answer to the pending offer with id `offer`. */
  | { readonly type: 'respond'; readonly polity: number; readonly offer: number; readonly accept: boolean }
  /** Ends a trade pact, open borders or an alliance with `target`, or releases the vassal `target`. */
  | {
      readonly type: 'cancelAgreement';
      readonly polity: number;
      readonly target: number;
      readonly agreement: AgreementKind;
    }
  /**
   * With a melee land unit next to an enemy nation's capital at 0 HP: instead
   * of taking the city, makes its owner a vassal. `target` is the city's hex.
   */
  | { readonly type: 'demandVassalage'; readonly polity: number; readonly unit: number; readonly target: number }
  /** Proposes that `seller` (the proposer or the target) lets the other use `resource` for gold per turn. */
  | {
      readonly type: 'proposeDeal';
      readonly polity: number;
      readonly target: number;
      readonly seller: number;
      readonly resource: string;
      readonly goldPerTurn: number;
    }
  /** Ends a resource deal the polity is a party to. */
  | { readonly type: 'cancelDeal'; readonly polity: number; readonly deal: number }
  /** Opens a trade route from the polity's city `city` (a zone). */
  | { readonly type: 'establishRoute'; readonly polity: number; readonly city: number; readonly to: RouteTarget }
  | { readonly type: 'cancelRoute'; readonly polity: number; readonly route: number }
  /** Pillages the enemy improvement under the unit or, if there is none, the enemy trade routes that pass there. */
  | { readonly type: 'pillage'; readonly polity: number; readonly unit: number }
  /** Buys a unit or a building in a city for gold. */
  | { readonly type: 'buy'; readonly polity: number; readonly city: number; readonly item: BuildItem }
  /** Gives gold: to a city-state for influence, to a nation for favour. */
  | { readonly type: 'gift'; readonly polity: number; readonly target: number; readonly amount: number };

/** Why an agreement, a deal, a route or a vassalage ended. */
export type EndReason =
  | 'expired'
  | 'cancelled'
  | 'war'
  | 'annexed'
  | 'replaced'
  | 'unpaid'
  | 'lost'
  | 'capitalLost'
  | 'cityLost';

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
  | {
      readonly type: 'airStrike';
      readonly city: number;
      readonly owner: number;
      readonly target: number;
      /** Id of the unit hit, or -1 when a city is hit. */
      readonly defenderUnit: number;
      /** Zone of the city hit, or -1. */
      readonly defenderCity: number;
      readonly damage: number;
    }
  | { readonly type: 'researchFinished'; readonly polity: number; readonly tech: TechId }
  /** A polity entered an era. Also sent for the polities whose techs follow the world average. */
  | { readonly type: 'eraEntered'; readonly polity: number; readonly era: number }
  | { readonly type: 'projectStageFinished'; readonly polity: number; readonly city: number; readonly stage: number }
  /** The era of the game moved on: that of the player, or of the most advanced major nation in observer mode. */
  | { readonly type: 'eraStarted'; readonly era: number }
  | { readonly type: 'policyUnlocked'; readonly polity: number; readonly policy: PolicyId }
  | {
      readonly type: 'policySlotted';
      readonly polity: number;
      readonly slot: number;
      readonly policy: PolicyId | null;
      /** The card that was in the slot, or null. */
      readonly replaced: PolicyId | null;
    }
  /** A proposal reached the human player and waits for `respond`. */
  | { readonly type: 'offerMade'; readonly offer: Offer }
  /** A pending offer was answered, withdrawn or ran out (`accepted: false`). */
  | {
      readonly type: 'offerAnswered';
      readonly offer: number;
      readonly from: number;
      readonly to: number;
      readonly accepted: boolean;
    }
  | { readonly type: 'agreementSigned'; readonly agreement: AgreementKind; readonly a: number; readonly b: number }
  | {
      readonly type: 'agreementEnded';
      readonly agreement: AgreementKind;
      readonly a: number;
      readonly b: number;
      readonly reason: EndReason;
    }
  /** `polity` entered the war against `against` at the side of its ally or overlord `with`. */
  | { readonly type: 'warJoined'; readonly polity: number; readonly against: number; readonly with: number }
  /** `forced`: demanded at the gates of the capital; otherwise agreed. */
  | { readonly type: 'vassalized'; readonly vassal: number; readonly overlord: number; readonly forced: boolean }
  | { readonly type: 'vassalReleased'; readonly vassal: number; readonly overlord: number; readonly reason: EndReason }
  | { readonly type: 'dealSigned'; readonly deal: Deal }
  | {
      readonly type: 'dealEnded';
      readonly deal: number;
      readonly seller: number;
      readonly buyer: number;
      readonly resource: string;
      readonly reason: EndReason;
    }
  | { readonly type: 'routeEstablished'; readonly route: TradeRoute }
  | { readonly type: 'routeEnded'; readonly route: number; readonly owner: number; readonly reason: EndReason }
  | {
      readonly type: 'routePillaged';
      readonly route: number;
      readonly owner: number;
      readonly by: number;
      readonly unit: number;
      readonly hex: number;
      readonly gold: number;
    }
  | {
      readonly type: 'improvementPillaged';
      readonly hex: number;
      readonly owner: number;
      readonly by: number;
      readonly unit: number;
      readonly gold: number;
    }
  /** Roads appeared (`level` 1) or became railways (`level` 2) on these hexes. */
  | { readonly type: 'roadsBuilt'; readonly hexes: number[]; readonly level: number }
  | { readonly type: 'itemBought'; readonly city: number; readonly item: BuildItem; readonly gold: number }
  | { readonly type: 'goldGifted'; readonly from: number; readonly to: number; readonly amount: number }
  /** A city-state got a new suzerain, or lost it (`to: -1`). */
  | { readonly type: 'suzerainChanged'; readonly cityState: number; readonly from: number; readonly to: number }
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
  | 'needsTech'
  | 'needsResource'
  | 'notCapital'
  | 'alreadyKnown'
  | 'missingPrerequisite'
  | 'doesNotResearch'
  | 'noAirfield'
  | 'alreadyStruck'
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
  | 'refused'
  | 'noPolicies'
  | 'alreadyUnlocked'
  | 'notEnoughCulture'
  | 'notUnlocked'
  | 'badSlot'
  | 'alreadySlotted'
  | 'swapCooldown'
  | 'atWar'
  | 'alreadyAgreed'
  | 'alreadyOffered'
  | 'noSuchAgreement'
  | 'agreementTooYoung'
  | 'tooManyAlliances'
  | 'allied'
  | 'vassal'
  | 'notACapital'
  | 'cityNotFallen'
  | 'noSuchOffer'
  | 'noSuchDeal'
  | 'alreadyHasResource'
  | 'badAmount'
  | 'noRouteSlot'
  | 'noRoute'
  | 'duplicateRoute'
  | 'noSuchRoute'
  | 'portClosed'
  | 'nothingToPillage'
  | 'cannotBuy'
  | 'inUnrest'
  | 'noRoom';

export type ActionResult =
  | { readonly ok: true; readonly state: GameState; readonly events: GameEvent[] }
  | { readonly ok: false; readonly reason: RejectReason; readonly state: GameState; readonly events: GameEvent[] };
