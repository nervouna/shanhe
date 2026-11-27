/**
 * Modifiers: the one vocabulary in which policy cards, national traits,
 * leader buffs, unique buildings, unique improvements and unit abilities say
 * what they change. This file holds only the types; `modifiers.ts` collects
 * the modifiers that apply and the rules ask it at one hook per number.
 *
 * A modifier names the number it changes (`type`), by how much, and the
 * conditions under which it applies. Where it comes from decides its scope:
 *
 * - a policy card, a trait or a leader buff applies to the whole polity;
 * - a building's modifier applies to its city (its yields, what it builds,
 *   the routes that start there);
 * - an improvement's modifier applies to the units of the hex's owner that
 *   stand on it;
 * - a unit ability applies to units of that type.
 */

import type { AgreementKind, UnitClass, Yields } from './data.ts';

/** Conditions on a hex. Every field that is set must hold. */
export interface HexWhen {
  /** `Terrain` values. */
  readonly terrain?: readonly number[];
  /** `Feature` values. */
  readonly feature?: readonly number[];
  readonly hills?: boolean;
  /** The hex has a river edge. */
  readonly river?: boolean;
  /** Ocean, coast or lake. */
  readonly water?: boolean;
  /**
   * The improvement on the hex, by the generic kind it is or replaces; `any`
   * for any improvement, `none` for an unimproved hex. A pillaged improvement
   * counts as none.
   */
  readonly improvement?: readonly string[] | 'any' | 'none';
  /** At least one neighbour has one of these terrains. */
  readonly nextToTerrain?: readonly number[];
  /** At least one neighbour has one of these features. */
  readonly nextToFeature?: readonly number[];
  /** A land hex next to water. */
  readonly shore?: boolean;
  /** The hex carries a resource. `string`: this one (`MapResource.id`). */
  readonly resource?: boolean | string;
  /** At or above `KIT.plateauMetres`. */
  readonly plateau?: boolean;
}

/** Conditions on a city. */
export interface CityWhen {
  readonly capital?: boolean;
  /** The site is next to coast or ocean. */
  readonly coastal?: boolean;
  /** The site is hilly, or at least `KIT.hillCityHills` of its neighbours are hills or mountains. */
  readonly hillSite?: boolean;
  /** At least this many mountain hexes within `KIT.mountainRingRadius` of the site. */
  readonly mountainsNear?: number;
  /** A river edge on the site or a canal (or what replaces it) in its zone. */
  readonly waterway?: boolean;
  /** A military unit of the owner stands on the site. */
  readonly garrisoned?: boolean;
  readonly minPop?: number;
  /** The owner is in no war. */
  readonly atPeace?: boolean;
  /** The owner has entered this era (index into `ERAS`). */
  readonly minEra?: number;
  /** The owner lost a city at most `KIT.surgeTurns` turns ago. */
  readonly afterCityLoss?: boolean;
}

/** Conditions on a unit type. */
export interface UnitWhen {
  readonly classes?: readonly UnitClass[];
  readonly domain?: 'land' | 'sea';
  /** Unit ids; a unique unit also matches the generic unit it replaces. */
  readonly types?: readonly string[];
  readonly minEra?: number;
  /** Any unit that can fight. */
  readonly military?: boolean;
}

/** Conditions on one side of a fight. */
export interface FightWhen {
  readonly role?: 'attack' | 'defend';
  readonly unit?: UnitWhen;
  /** The hex the unit stands on. */
  readonly hex?: HexWhen;
  /**
   * `own`: on its owner's land. `home`: on its owner's land or afloat next to
   * it. `foreign`: not on its owner's land.
   */
  readonly territory?: 'own' | 'home' | 'foreign';
  /** The other side is a unit of one of these classes. */
  readonly vsClasses?: readonly UnitClass[];
  /** The other side is a city (true) or a unit (false). */
  readonly vsCity?: boolean;
  /** The other side is a coastal city. */
  readonly vsCoastalCity?: boolean;
  /** The attack is ranged (true) or a melee (false). */
  readonly rangedAttack?: boolean;
  /** A melee across a river edge. */
  readonly acrossRiver?: boolean;
  readonly fortified?: boolean;
  /** The other side is a unit at full HP. */
  readonly vsFullHp?: boolean;
  /** One of the unit owner's allies is at war with the other side too. */
  readonly allyAtWar?: boolean;
  /** The value counts once for each unit of the same owner next to the unit. */
  readonly perAdjacentFriend?: boolean;
}

/** Conditions on a trade route. */
export interface RouteWhen {
  readonly sea?: boolean;
  /**
   * Where it goes: an off-map port; a city of another polity (`foreign`); a
   * city of a nation whose land touches the owner's (`neighbour`).
   */
  readonly to?: 'port' | 'foreign' | 'neighbour';
  /** It goes to this off-map port (`MapOffMapPort.nameEn`). */
  readonly port?: string;
  /** It goes to a city of one of these polities (`MapPolity.id`). */
  readonly toPolities?: readonly string[];
  /** Its path crosses a hilly hex. */
  readonly crossesHills?: boolean;
  /** The destination's owner is an ally of the route's owner. */
  readonly toAlly?: boolean;
}

/** What a flat city yield is counted per. Without it the yield counts once. */
export type Per =
  /** Once if the city has the building or what replaces it. */
  | { readonly building: string }
  /** Once per this many citizens. */
  | { readonly pop: number }
  /** Per nation at `KIT.friendlyFavour` or more, at most `KIT.maxFriends`. */
  | 'friends'
  /** Per island (a landmass other than the largest) with a city of the owner, at most `KIT.maxIslands`. */
  | 'islands'
  /** Per trade route of the owner, at most `KIT.maxRoutesCounted`. */
  | 'routes'
  /** Per mountain hex in the city's zone, at most `KIT.maxMountainsCounted`. */
  | 'zoneMountains';

export type Modifier =
  // ------------------------------------------------------------- yields
  /** Added to the yield of every worked hex that matches. */
  | { readonly type: 'hexYield'; readonly yields: Partial<Yields>; readonly hex: HexWhen }
  /** Flat yields of a city. */
  | { readonly type: 'cityYield'; readonly yields: Partial<Yields>; readonly city?: CityWhen; readonly per?: Per }
  /** Percentage added to the yields of a city. `building`: only in a city with it. */
  | {
      readonly type: 'cityPercent';
      readonly percent: Partial<Yields>;
      readonly city?: CityWhen;
      readonly building?: string;
    }
  /** Flat yields a route gives the city it starts from. */
  | { readonly type: 'routeYield'; readonly yields: Partial<Yields>; readonly route?: RouteWhen }
  /** Percentage added to the gold each specialty gives a city. */
  | { readonly type: 'specialtyGold'; readonly percent: number }
  /** Percentage of city gold for both sides of a trade pact. */
  | { readonly type: 'tradePactGold'; readonly percent: number }
  /** Percentage added to the food a city needs to grow. */
  | { readonly type: 'growth'; readonly percent: number }
  /** Added to the morale of a city. */
  | { readonly type: 'morale'; readonly morale: number; readonly city?: CityWhen }
  // --------------------------------------------------- production, costs
  /** Percentage added to a city's production while it builds a matching item. */
  | {
      readonly type: 'production';
      readonly percent: number;
      readonly item: 'unit' | 'building' | 'improvement';
      readonly unit?: UnitWhen;
      /** Only this building, or what replaces it. */
      readonly building?: string;
      /** Only the first building of a city. */
      readonly firstBuilding?: boolean;
    }
  /** Percentage added to the upkeep of matching units. */
  | { readonly type: 'unitUpkeep'; readonly percent: number; readonly unit?: UnitWhen }
  /** Percentage added to building upkeep. */
  | { readonly type: 'buildingUpkeep'; readonly percent: number }
  /** Percentage added to the gold an upgrade costs. */
  | { readonly type: 'upgradeCost'; readonly percent: number }
  /** Percentage added to the science a tech costs. `knownByOther`: only for a tech another living polity knows. */
  | { readonly type: 'techCost'; readonly percent: number; readonly knownByOther?: boolean }
  // --------------------------------------------------------------- combat
  /** Percentage of strength for the owner's units in a fight that matches. */
  | { readonly type: 'strength'; readonly percent: number; readonly when?: FightWhen }
  /** Percentage of strength for foreign units that fight inside the owner's borders. */
  | { readonly type: 'enemyStrength'; readonly percent: number }
  /** Percentage of combat strength for the owner's cities. */
  | { readonly type: 'cityStrength'; readonly percent: number; readonly city?: CityWhen }
  /** HP a unit at war with the owner loses each turn it ends on a matching hex of the owner's land. */
  | { readonly type: 'attrition'; readonly hp: number; readonly hex?: HexWhen }
  /** HP added to what a resting unit regains. */
  | { readonly type: 'heal'; readonly hp: number; readonly territory?: 'own' | 'foreign'; readonly unit?: UnitWhen }
  /** Experience of a newly built unit. */
  | { readonly type: 'startXp'; readonly xp: number; readonly unit?: UnitWhen }
  /** Culture for each enemy unit the owner's units destroy. */
  | { readonly type: 'cultureOnKill'; readonly culture: number }
  /** Percentage taken off the penalty of an attack from the water (100: no penalty). */
  | { readonly type: 'amphibious'; readonly percent: number }
  /** Added to how far a unit sees. */
  | { readonly type: 'vision'; readonly range: number; readonly unit?: UnitWhen; readonly hex?: HexWhen }
  // ------------------------------------------------------------- movement
  /**
   * How the owner's units move. `fordRivers`: a river edge costs no more than
   * the ground beyond it. `ignoreHills` and `ignoreRough`: no extra cost for
   * hills, or for forest, jungle and marsh. `roadCost`: what a step between
   * two road hexes on the owner's land costs once it knows `tech`.
   */
  | {
      readonly type: 'movement';
      readonly fordRivers?: boolean;
      readonly ignoreHills?: boolean;
      readonly ignoreRough?: boolean;
      readonly roadCost?: number;
      readonly unit?: UnitWhen;
    }
  // ---------------------------------------------------------------- trade
  /**
   * Gold of a matching route of the owner: `gold` is added, `percent` is
   * added to the percentages, `multiplier` multiplies the result.
   * `perRiverHexes`: `gold` counts once per this many river hexes on the
   * path, at most `KIT.maxRiverGold` times.
   */
  | {
      readonly type: 'routeGold';
      readonly gold?: number;
      readonly percent?: number;
      readonly multiplier?: number;
      readonly route?: RouteWhen;
      readonly perRiverHexes?: number;
    }
  /** Percentage added to how far the owner's land routes reach. */
  | { readonly type: 'routeRange'; readonly percent: number }
  /**
   * The owner takes this share of the income of every other polity's route
   * that passes within `range` hexes of one of its cities. `sea`: sea routes only.
   */
  | { readonly type: 'routeToll'; readonly percent: number; readonly range: number; readonly sea?: boolean }
  /** Percentage added to the gold of pillaging. `what`: only routes, or only improvements. */
  | {
      readonly type: 'pillage';
      readonly percent: number;
      readonly what?: 'route' | 'improvement';
      readonly unit?: UnitWhen;
    }
  /** Percentage added to the price of a specialty the owner sells, and to what its specialties add to a route. */
  | { readonly type: 'specialtySale'; readonly percent: number }
  /** Gold per turn added to what the owner gets from each deal that sells this resource. */
  | { readonly type: 'dealGold'; readonly gold: number; readonly resource: string }
  /** Only the owner's routes may use this off-map port (`MapOffMapPort.nameEn`). */
  | { readonly type: 'exclusivePort'; readonly port: string }
  /** Gold per turn for each of these ships that ends the turn in the waters of a foreign city at peace. */
  | { readonly type: 'tributeTrade'; readonly gold: number }
  // ------------------------------------------------------------ diplomacy
  /** Percentage added to the influence the owner gains with city-states. */
  | { readonly type: 'influence'; readonly percent: number }
  /** Percentage added to the tribute the owner's vassals and city-states pay. */
  | { readonly type: 'tribute'; readonly percent: number }
  /**
   * Added to the favour an AI needs to accept one of these agreements with
   * the owner (negative: easier). `vsStronger`: only when the other side is
   * the stronger of the two.
   */
  | {
      readonly type: 'favourNeeded';
      readonly favour: number;
      readonly agreements: readonly AgreementKind[];
      readonly vsStronger?: boolean;
    }
  /** The owner cannot be made a vassal. */
  | { readonly type: 'noVassal' }
  // -------------------------------------------------------------- culture
  /** Added to the owner's policy slots. */
  | { readonly type: 'policySlots'; readonly slots: number }
  /** Added to the turns of the swap cooldown. */
  | { readonly type: 'swapCooldown'; readonly turns: number }
  /** Added to the turns of unrest in a city the owner captures. */
  | { readonly type: 'unrest'; readonly turns: number }
  /** Culture at once when the owner captures another nation's original capital, or enters an era. */
  | { readonly type: 'cultureOn'; readonly event: 'captureCapital' | 'era'; readonly culture: number }
  // ----------------------------------------------------------------- land
  /**
   * Lets the owner's cities put these improvements (by generic kind) on more
   * ground: on these terrains too, and on hills where `hills` is set.
   */
  | {
      readonly type: 'improvementSite';
      readonly improvements: readonly string[];
      readonly terrains?: readonly number[];
      readonly hills?: boolean;
    }
  /** The owner sees and uses this strategic resource from this era on, whatever it has researched. */
  | { readonly type: 'reveal'; readonly resource: string; readonly era: number };

export type ModifierType = Modifier['type'];
export type ModifierOf<T extends ModifierType> = Extract<Modifier, { type: T }>;
