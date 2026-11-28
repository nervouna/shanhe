/**
 * Read-only questions about a game state, for the interface and for tools.
 * Every function takes a `GameState` and changes nothing: the state hashes
 * the same before and after. The rules' own checks answer them, so what a
 * query calls legal is what `applyAction` accepts.
 */

import { buyCost, checkStep, stepCost, upgradeCost, upgradePrice, validate } from './actions.ts';
import { improvableHexes, itemCost } from './cities.ts';
import {
  amphibiousFactor,
  attackStrength,
  cityStrength,
  combatDamage,
  combatFactor,
  defenceStrength,
  hexesApart,
  militaryStrength,
} from './combat.ts';
import { at, atWar, cityAtHex, createCtx, isEmbarked, relationKey, relationOf } from './context.ts';
import type { Ctx } from './context.ts';
import { AIR_STRIKE, CAPITAL_PERCENT, DIPLOMACY, PROJECT, TRADE, conquestTarget, supplySurcharge, unitDef } from './data.ts';
import type { AgreementKind, PolicyId, TechId, Yields } from './data.ts';
import { dealPrice, favourStandings, submits } from './diplomacy.ts';
import { kitOf, roadUpgradeOf } from './modifiers.ts';
import { openPolicies } from './policies.ts';
import { balanceIn, ratedIn } from './power.ts';
import type { Track } from './power.ts';
import { isNation, vassalsOf } from './relations.ts';
import { eraOf, hasResource, openTechs, ownsResource, researches, upgradeTargetFor } from './tech.ts';
import { checkRoute, checkRouteTarget, findRoutePath, routeIncome, routeSlots, routesOf } from './trade.ts';
import { capitalsHeld, contenders, needsSupply, supplyOf } from './turn.ts';
import { NO_POLITY } from './types.ts';
import type {
  Action,
  BuildItem,
  City,
  GameState,
  MutableGameState,
  RejectReason,
  RouteTarget,
  TradeRoute,
  Unit,
} from './types.ts';

/**
 * The rules' working context of a state. The rules only read a context they
 * validate with, so one per state object is enough however often it is asked.
 */
const contexts = new WeakMap<GameState, Ctx>();

function ctxOf(state: GameState): Ctx {
  let ctx = contexts.get(state);
  if (ctx === undefined) {
    ctx = createCtx(state as MutableGameState);
    contexts.set(state, ctx);
  }
  return ctx;
}

// ----------------------------------------------------------------- actions

/** Why the rules would refuse the action, or null if they would accept it. */
export function checkAction(state: GameState, action: Action): RejectReason | null {
  return validate(ctxOf(state), action);
}

// ------------------------------------------------------------ units, hexes

/** The unit with the id, or null. */
export function unitWithId(state: GameState, id: number): Readonly<Unit> | null {
  return ctxOf(state).unitById.get(id) ?? null;
}

/** The unit standing on the hex, or null. */
export function unitOnHex(state: GameState, hex: number): Readonly<Unit> | null {
  return ctxOf(state).unitAt.get(hex) ?? null;
}

/** The city whose site the hex is, or null. */
export function cityOnHex(state: GameState, hex: number): Readonly<City> | null {
  return cityAtHex(ctxOf(state), hex);
}

/** Distance between two hexes, in hexes. */
export function hexDistance(state: GameState, a: number, b: number): number {
  return hexesApart(ctxOf(state), a, b);
}

/** True if the two polities are at war. Tribes (`NO_POLITY`) are at war with everybody. */
export function atWarWith(state: GameState, a: number, b: number): boolean {
  return atWar(ctxOf(state), a, b);
}

/**
 * Why a unit like `unit` could not step onto the adjacent hex `to`, or null.
 * `unit` need not be in the state: a planner asks for a unit as it would
 * stand somewhere else. Movement points are not checked.
 */
export function stepCheck(state: GameState, unit: Readonly<Unit>, to: number): RejectReason | null {
  return checkStep(ctxOf(state), unit as Unit, to);
}

/** Movement points the step of {@link stepCheck} costs. */
export function stepCostOf(state: GameState, unit: Readonly<Unit>, to: number): number {
  return stepCost(ctxOf(state), unit as Unit, to);
}

/** True for a land unit standing on water. */
export function unitEmbarked(state: GameState, unit: Readonly<Unit>): boolean {
  return isEmbarked(ctxOf(state), unit as Unit);
}

/** Strength the unit defends with where it stands. */
export function unitDefence(state: GameState, unit: Readonly<Unit>): number {
  return defenceStrength(ctxOf(state), unit as Unit);
}

/** Combat strength of the city in `zone`, or 0 if there is none. */
export function cityDefence(state: GameState, zone: number): number {
  const city = state.cities[zone];
  return city === undefined || city === null ? 0 : cityStrength(ctxOf(state), city as City);
}

/** What a unit would upgrade to and the gold it costs, or null if it has no upgrade now. */
export function unitUpgrade(state: GameState, unitId: number): { readonly type: string; readonly gold: number } | null {
  const ctx = ctxOf(state);
  const unit = ctx.unitById.get(unitId);
  const target = unit === undefined ? null : upgradeTargetFor(ctx, unit);
  return unit === undefined || target === null ? null : { type: target.id, gold: upgradeCost(unit, target) };
}

// ------------------------------------------------------------------ cities

/** Production the city in `zone` needs for the item, or 0 if there is no city. */
export function buildCost(state: GameState, zone: number, item: BuildItem): number {
  const city = state.cities[zone];
  return city === undefined || city === null ? 0 : itemCost(ctxOf(state), city as City, item);
}

/** Gold the city in `zone` pays to buy the item outright, or 0 if there is no city. */
export function buyCostOf(state: GameState, zone: number, item: BuildItem): number {
  const city = state.cities[zone];
  return city === undefined || city === null ? 0 : buyCost(ctxOf(state), city as City, item);
}

/** The hexes the air strike of the city in `zone` could hit now, ascending. Empty without an airfield. */
export function airStrikeTargets(state: GameState, zone: number): number[] {
  const city = state.cities[zone];
  const site = state.map.zones[zone]?.siteHex;
  if (city === undefined || city === null || site === undefined) return [];
  const ctx = ctxOf(state);
  const probe = { type: 'airStrike', polity: city.owner, city: zone } as const;
  if (validate(ctx, { ...probe, target: site }) === 'noAirfield') return [];
  const targets: number[] = [];
  const seen = new Set<number>();
  for (const unit of state.units) {
    if (unit.owner !== city.owner) seen.add(unit.hex);
  }
  state.cities.forEach((other, index) => {
    if (other !== null && other.owner !== city.owner) seen.add(at(state.map.zones, index).siteHex);
  });
  for (const hex of seen) {
    if (hexesApart(ctx, site, hex) > AIR_STRIKE.range) continue;
    if (validate(ctx, { ...probe, target: hex }) === null) targets.push(hex);
  }
  return targets.sort((a, b) => a - b);
}

// ---------------------------------------------------- research and policies

/** The techs `polity` could research now, in table order. Empty for a polity that does not research. */
export function researchOptions(state: GameState, polity: number): TechId[] {
  if (state.polities[polity] === undefined || !researches(state, polity)) return [];
  return openTechs(ctxOf(state), polity);
}

/** The policy cards `polity` could unlock now, in table order. */
export function unlockOptions(state: GameState, polity: number): PolicyId[] {
  if (state.polities[polity] === undefined) return [];
  return openPolicies(ctxOf(state), polity);
}

// ---------------------------------------------------------------- standing

/** Military strength of a polity: the sum of its units' power. */
export function strengthOf(state: GameState, polity: number): number {
  return militaryStrength(ctxOf(state), polity);
}

/** Hexes between the capitals of two polities, or null if one of them has none. */
export function capitalDistance(state: GameState, a: number, b: number): number | null {
  const site = (polity: number): number | undefined => {
    const zone = state.polities[polity]?.capital ?? -1;
    return state.map.zones[zone >= 0 ? zone : (state.map.polities[polity]?.capitalZone ?? -1)]?.siteHex;
  };
  const from = site(a);
  const to = site(b);
  return from === undefined || to === undefined ? null : hexesApart(ctxOf(state), from, to);
}

export type FavourCause = 'border' | 'war' | 'sharedEnemy' | 'deal' | 'route' | Exclude<AgreementKind, 'truce'>;

export interface FavourTerm {
  readonly cause: FavourCause;
  /** What it adds to the level favour moves towards. */
  readonly value: number;
  /** How many times it counts: deals, routes and shared enemies. 1 for the others. */
  readonly count: number;
}

/**
 * What the balance of power puts between two nations: `leader` is the fear
 * of the one of the two that leads the race for victory (`polity` is that
 * one), `commonThreat` what draws two nations together that both stand
 * against a leader (`polity` is that leader).
 */
export interface PowerTerm {
  readonly cause: 'leader' | 'commonThreat';
  /** What it adds to the level favour moves towards. */
  readonly value: number;
  readonly polity: number;
}

export interface FavourStanding {
  /** Favour now, from -100 to 100. */
  readonly favour: number;
  /** The level it moves towards by `FAVOUR.drift` a turn: the sum of `terms` and `power`, within the limits. */
  readonly target: number;
  readonly terms: readonly FavourTerm[];
  /** The terms the balance of power adds. */
  readonly power: readonly PowerTerm[];
}

/**
 * Favour between two nations and what moves it: the standing terms that the
 * turn processing of `diplomacy.ts` adds up. Null unless both are living
 * nations.
 */
export function favourStanding(state: GameState, a: number, b: number): FavourStanding | null {
  const ctx = ctxOf(state);
  if (a === b || !isNation(ctx, a) || !isNation(ctx, b)) return null;
  if (state.polities[a]?.alive !== true || state.polities[b]?.alive !== true) return null;
  const standing = favourStandings(ctx).get(relationKey(a, b));
  const terms: FavourTerm[] = [];
  const power: PowerTerm[] = [];
  for (const term of standing?.terms ?? []) {
    if (term.cause === 'leader' || term.cause === 'commonThreat') {
      power.push({ cause: term.cause, value: term.value, polity: term.polity ?? NO_POLITY });
    } else {
      terms.push({ cause: term.cause, value: term.value, count: term.count });
    }
  }
  // The order the interface has always listed them in.
  const order: readonly FavourCause[] = ['border', 'war', 'tradePact', 'openBorders', 'alliance', 'vassalage', 'deal', 'route', 'sharedEnemy'];
  terms.sort((x, y) => order.indexOf(x.cause) - order.indexOf(y.cause));
  return { favour: state.favour[relationKey(a, b)] ?? 0, target: standing?.target ?? 0, terms, power };
}

// -------------------------------------------------------------------- deals

export interface DealOption {
  readonly seller: number;
  readonly buyer: number;
  /** `MapResource.id`. */
  readonly resource: string;
  /** The price per turn an AI asks and pays. */
  readonly goldPerTurn: number;
}

/**
 * The resource deals that could stand between the two nations: each
 * resource one of them has a source of and the other cannot draw on, at the
 * price an AI asks and pays. Whether the other side agrees is `checkAction`'s
 * answer for the `proposeDeal` action.
 */
export function dealOptions(state: GameState, a: number, b: number): DealOption[] {
  const ctx = ctxOf(state);
  if (a === b || !isNation(ctx, a) || !isNation(ctx, b)) return [];
  const options: DealOption[] = [];
  for (const [seller, buyer] of [[b, a], [a, b]] as const) {
    for (const resource of state.map.resources) {
      if (!ownsResource(ctx, seller, resource.id) || hasResource(ctx, buyer, resource.id)) continue;
      options.push({ seller, buyer, resource: resource.id, goldPerTurn: dealPrice(resource.id) });
    }
  }
  return options;
}

// ------------------------------------------------------------- trade routes

export interface RouteOption {
  readonly to: RouteTarget;
  /** Why the route cannot be opened now, or null. */
  readonly reason: RejectReason | null;
  /** The hexes it would run over; empty when the target itself is refused. */
  readonly path: readonly number[];
  readonly sea: boolean;
  /** Gold per turn it would give; 0 when the target itself is refused. */
  readonly income: number;
}

export interface RouteSlots {
  readonly used: number;
  readonly total: number;
}

/** The trade route slots of `polity` and how many its routes fill. */
export function routeSlotsOf(state: GameState, polity: number): RouteSlots {
  const ctx = ctxOf(state);
  return { used: routesOf(ctx, polity).length, total: routeSlots(ctx, polity) };
}

/**
 * Where a trade route from the city in zone `from` could go, in the order of
 * the map: every city with a path in range and every off-map port in reach,
 * each with the income it would give and, where the rules refuse it now, the
 * reason (no free slot, a route there already, a port its techs have not
 * opened). Cities of polities it is at war with are left out.
 */
export function routeOptions(state: GameState, from: number): RouteOption[] {
  const city = state.cities[from];
  if (city === undefined || city === null) return [];
  const ctx = ctxOf(state);
  const polity = city.owner;
  const start = at(state.map.zones, from).siteHex;
  const reach = Math.max(TRADE.landRange, TRADE.seaRange) + 2;
  const options: RouteOption[] = [];

  const consider = (to: RouteTarget, hex: number): void => {
    if (hexesApart(ctx, start, hex) > reach) return;
    const closed = checkRouteTarget(ctx, polity, from, to);
    if (closed === 'portClosed') {
      options.push({ to, reason: closed, path: [], sea: false, income: 0 });
      return;
    }
    if (closed !== null) return;
    const found = findRoutePath(ctx, polity, from, to);
    if (found === null) return;
    const route: TradeRoute = {
      id: 0,
      owner: polity,
      from,
      toCity: to.kind === 'city' ? to.zone : -1,
      toPort: to.kind === 'port' ? to.port : -1,
      sea: found.sea,
      path: found.path,
      income: 0,
      pillagedUntil: 0,
    };
    options.push({
      to,
      reason: checkRoute(ctx, polity, from, to),
      path: found.path,
      sea: found.sea,
      income: routeIncome(ctx, route),
    });
  };

  state.cities.forEach((other, zone) => {
    if (other !== null && zone !== from) consider({ kind: 'city', zone }, at(state.map.zones, zone).siteHex);
  });
  state.map.offMapPorts.forEach((port, index) => {
    consider({ kind: 'port', port: index }, port.hex);
  });
  return options;
}

// ------------------------------------------------------------------ victory

export interface VictoryRow {
  readonly polity: number;
  /** Original capitals of major nations it holds, itself or through a vassal. */
  readonly capitals: number;
  /** Stages of the endgame project it has completed. */
  readonly stages: number;
  /** Cumulative gross income: what the Economic victory ranks. */
  readonly income: number;
}

export interface VictoryStandings {
  /** Capitals the Conquest victory needs. */
  readonly capitalsNeeded: number;
  /** Stages the Science victory needs. */
  readonly stagesNeeded: number;
  /** Turns left until the Economic victory is decided. */
  readonly turnsLeft: number;
  /** One row per polity that can win, ascending by polity. */
  readonly rows: readonly VictoryRow[];
}

/** Where every polity that can win stands on each of the three victories. */
export function victoryStandings(state: GameState): VictoryStandings {
  const ctx = ctxOf(state);
  return {
    capitalsNeeded: conquestTarget(state.majors.length),
    stagesNeeded: PROJECT.stages.length,
    turnsLeft: Math.max(0, state.lastTurn - state.turn),
    rows: contenders(ctx).map((polity) => ({
      polity,
      capitals: capitalsHeld(ctx, polity),
      stages: state.polities[polity]?.projectStage ?? 0,
      income: state.polities[polity]?.grossIncome ?? 0,
    })),
  };
}

/** The polities that can win: the living major nations and the player. */
export function victoryContenders(state: GameState): number[] {
  return contenders(ctxOf(state));
}

/** Number of major nations' original capitals `polity` holds, itself or through a vassal. */
export function capitalsHeldBy(state: GameState, polity: number): number {
  return polity === NO_POLITY ? 0 : capitalsHeld(ctxOf(state), polity);
}

// ------------------------------------------- kits and modifiers (interface)

/** The era `polity` has reached (an index into `ERAS`); 0 for `NO_POLITY`. */
export function eraOfPolity(state: GameState, polity: number): number {
  return state.polities[polity] === undefined ? 0 : eraOf(ctxOf(state), polity);
}

/**
 * What a unit would upgrade to and the gold its owner pays for it, with the
 * owner's modifiers counted in: the price the `upgrade` action takes. Null
 * if it has no upgrade now.
 */
export function upgradeOffer(state: GameState, unitId: number): { readonly type: string; readonly gold: number } | null {
  const ctx = ctxOf(state);
  const unit = ctx.unitById.get(unitId);
  const target = unit === undefined ? null : upgradeTargetFor(ctx, unit);
  return unit === undefined || target === null ? null : { type: target.id, gold: upgradePrice(ctx, unit, target) };
}

/**
 * The hexes the city in `zone` could put an improvement on as far as reach
 * goes: those its citizens work and the mountains of its zone. Whether a
 * given improvement fits a hex is `checkAction`'s answer.
 */
export function improvementSites(state: GameState, zone: number): readonly number[] {
  const city = state.cities[zone];
  return city === undefined || city === null ? [] : improvableHexes(ctxOf(state), city as City);
}

/** The id (in `ROAD_UPGRADES`) of the road upgrade the polity's roads have now, or null. */
export function activeRoadUpgrade(state: GameState, polity: number): string | null {
  if (state.polities[polity] === undefined) return null;
  const ctx = ctxOf(state);
  return roadUpgradeOf(ctx, polity) === null ? null : (kitOf(ctx, polity)?.building ?? null);
}

export interface AttackOutcome {
  /** Expected hit points the defender loses. */
  readonly toDefender: number;
  /** Expected hit points the attacker loses: 0 for a ranged attack. */
  readonly toAttacker: number;
  /** True if the attack would take a defenceless city. */
  readonly capture: boolean;
}

function riverEdgeBetween(ctx: Ctx, from: number, to: number): boolean {
  for (let d = 0; d < 6; d++) {
    if (ctx.topo.neighbors[from * 6 + d] === to) return ((ctx.map.riverEdges[from] as number) & (1 << d)) !== 0;
  }
  return false;
}

/**
 * What an attack of the unit on `target` would do on average: the damage of
 * the rules' own attack with its random factor at 1, every modifier and the
 * penalty for attacking from the water counted in. Null if the unit cannot
 * fight or there is no enemy of it on that hex. Distance and movement points
 * are not checked.
 *
 * @param from the hex the unit would attack from. Default: where it stands.
 */
export function attackOutcome(state: GameState, unitId: number, target: number, from?: number): AttackOutcome | null {
  const real = ctxOf(state);
  const found = real.unitById.get(unitId);
  if (found === undefined || !Number.isInteger(target) || target < 0 || target >= real.topo.count) return null;
  const def = unitDef(found.type);
  if (def.strength <= 0) return null;
  const origin = from ?? found.hex;
  // From another hex the unit's surroundings differ: the fight is worked out on a board with the unit standing there.
  let ctx = real;
  let unit = found;
  if (origin !== found.hex) {
    const moved = { ...found, hex: origin };
    unit = moved;
    ctx = createCtx({ ...state, units: state.units.map((other) => (other.id === unitId ? moved : other)) } as MutableGameState);
  }
  const ranged = def.range > 0;
  const river = riverEdgeBetween(ctx, origin, target);
  const acrossRiver = river && !ranged;

  const city = cityAtHex(ctx, target);
  if (city !== null && city.owner !== unit.owner) {
    if (!atWar(ctx, unit.owner, city.owner)) return null;
    if (!ranged && city.hp <= 0 && def.domain === 'land') return { toDefender: 0, toAttacker: 0, capture: true };
    const strength = cityStrength(ctx, city);
    const factor =
      amphibiousFactor(ctx, unit) * combatFactor(ctx, unit, city.owner, { role: 'attack', ranged, acrossRiver, enemyCity: city });
    return {
      toDefender: combatDamage(attackStrength(unit, ranged, true, river) * factor, strength, 1),
      toAttacker: ranged ? 0 : combatDamage(strength, attackStrength(unit, false, false, false) * factor, 1),
      capture: false,
    };
  }

  const defender = ctx.unitAt.get(target);
  if (defender === undefined || defender.owner === unit.owner || !atWar(ctx, unit.owner, defender.owner)) return null;
  if (unitDef(defender.type).strength === 0) return { toDefender: defender.hp, toAttacker: 0, capture: false };
  const attack =
    attackStrength(unit, ranged, false, river) *
    amphibiousFactor(ctx, unit) *
    combatFactor(ctx, unit, defender.owner, { role: 'attack', ranged, acrossRiver, enemyUnit: defender });
  const defence =
    defenceStrength(ctx, defender) *
    combatFactor(ctx, defender, unit.owner, { role: 'defend', ranged, acrossRiver, enemyUnit: unit });
  return {
    toDefender: combatDamage(attack, defence, 1),
    toAttacker: ranged ? 0 : combatDamage(defence, attack, 1),
    capture: false,
  };
}

// -------------------------------------------------------- vassals (interface)

export interface VassalRoom {
  /** Living vassals the polity holds. */
  readonly used: number;
  /** Vassals its era lets it hold (`DIPLOMACY.vassalsByEra`). */
  readonly cap: number;
}

/** The vassals `polity` holds and how many it may hold in the era it has reached. */
export function vassalRoom(state: GameState, polity: number): VassalRoom {
  const self = state.polities[polity];
  if (self === undefined) return { used: 0, cap: 0 };
  return { used: vassalsOf(ctxOf(state), polity).length, cap: DIPLOMACY.vassalsByEra[self.era] ?? 0 };
}

/**
 * True if `polity` making peace with `other` now would make `other` its
 * vassal: `other` has a peace offer standing, so it is the one who asked,
 * and the rules have it pay for the peace with its freedom (doc 03,
 * "Submission"). False where the `makePeace` action itself is refused.
 */
export function peaceMakesVassal(state: GameState, polity: number, other: number): boolean {
  const ctx = ctxOf(state);
  if (validate(ctx, { type: 'makePeace', polity, target: other }) !== null) return false;
  const relation = relationOf(ctx, polity, other);
  if (relation === undefined) return false;
  const theirOffer = relation.a === other ? relation.offerA : relation.offerB;
  return theirOffer > 0 && submits(ctx, other, polity);
}

// ------------------------- supply, the capital, the balance of power (interface)

export interface SupplyStanding {
  /** Fighting units the polity's cities and people keep at the ordinary upkeep. */
  readonly limit: number;
  /** Fighting units it has. */
  readonly used: number;
  /** Gold a turn the units beyond the limit cost on top of their upkeep. */
  readonly surcharge: number;
  /** Gold a turn one more fighting unit would add to the surcharge; 0 while there is room for it. */
  readonly nextUnit: number;
}

/** The supply of `polity` as the turn charges it, and what its next fighting unit would cost beyond the upkeep. */
export function supplyStanding(state: GameState, polity: number): SupplyStanding {
  if (state.polities[polity] === undefined) return { limit: 0, used: 0, surcharge: 0, nextUnit: 0 };
  const { limit, used, surcharge } = supplyOf(ctxOf(state), polity);
  return { limit, used, surcharge, nextUnit: supplySurcharge(used + 1 - limit) - surcharge };
}

/** True if a unit of this type counts against its owner's supply limit. */
export function takesSupply(type: string): boolean {
  return needsSupply({ type } as Unit);
}

/**
 * The percentages the city in `zone` adds to its yields for being the seat
 * of its nation (`CAPITAL_PERCENT`). Empty for any other city, and for the
 * seat of a polity that is not a nation.
 */
export function capitalBonus(state: GameState, zone: number): Readonly<Partial<Yields>> {
  const city = state.cities[zone];
  if (city === undefined || city === null) return {};
  const ctx = ctxOf(state);
  return isNation(ctx, city.owner) && state.polities[city.owner]?.capital === zone ? CAPITAL_PERCENT : {};
}

export interface PowerRow {
  readonly polity: number;
  /** The favour it loses with every nation that fears it; 0 for a nation nobody fears. */
  readonly fear: number;
  /** The track on which it is feared most, or null. */
  readonly lead: Track | null;
}

/**
 * The balance of power: for every nation in the race (the living major
 * nations and the player), how much it is feared and for which lead,
 * ascending by polity. All of it is public knowledge.
 */
export function powerStandings(state: GameState): PowerRow[] {
  const balance = balanceIn(state);
  return ratedIn(state).map((polity) => ({
    polity,
    fear: balance.fear[polity] ?? 0,
    lead: balance.lead[polity] ?? null,
  }));
}
