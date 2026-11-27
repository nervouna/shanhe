/**
 * The rules core's public API. Pure functions on plain data: no DOM, no
 * Three.js, so it runs in Node for tests and simulations.
 *
 * A `GameState` is JSON data plus a reference to the map it is played on.
 * No function here modifies a state it is given: each returns a new one.
 */

import { hexRange, indexToOffset } from '../shared/hex.ts';
import { NO_ZONE } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { runAi } from './ai.ts';
import { buyCost, execute, legalActions, validate } from './actions.ts';
import { assignCitizens, foundCity } from './cities.ts';
import { addUnit, at, cloneState, createCtx, random } from './context.ts';
import type { Ctx } from './context.ts';
import type { TechId } from './data.ts';
import {
  CITY_STATE_TYPES,
  CITY_STATE_TYPE_BY_ID,
  DEFAULT_MAJOR_NAMES_ZH,
  GAME_TURNS,
  HEXES_PER_TRIBE,
  MAJOR_COUNT,
  ROSTER,
  unitFor,
  TRIBE,
  noYields,
  policyCost,
  unitDef,
} from './data.ts';
import { KIT } from './kits.ts';
import { visionRange } from './modifiers.ts';
import { policySlotsFor } from './policies.ts';
import { hasResource, specialtiesOf, techCost, visibleResource, worldEra } from './tech.ts';
import { findRoutePath, routeSlots } from './trade.ts';
import type { RoutePath } from './trade.ts';
import { topologyOf } from './topology.ts';
import { endRound } from './turn.ts';
import { NO_POLITY } from './types.ts';
import type {
  Action,
  ActionResult,
  Agreement,
  BuildItem,
  City,
  GameEvent,
  GameSetup,
  GameState,
  MutableGameState,
  PolityState,
  RouteTarget,
  Unit,
} from './types.ts';

export type * from './types.ts';
export { NO_POLITY } from './types.ts';

/** Version of the state format. `loadGame` rejects any other. */
export const STATE_VERSION = 4;

function polityIndex(map: MapData, id: string): number {
  const index = map.polities.findIndex((polity) => polity.id === id);
  if (index < 0) throw new Error(`game setup: no polity with id ${id}`);
  return index;
}

function defaultMajors(map: MapData): number[] {
  const nations = map.polities.flatMap((polity, index) => (polity.kind === 'nation' ? [index] : []));
  const listed = nations.filter((index) => DEFAULT_MAJOR_NAMES_ZH.includes(at(map.polities, index).nameZh));
  return listed.length > 0 ? listed : nations.slice(0, MAJOR_COUNT);
}

/**
 * The state of a new game on `map`, at turn 1: every nation and city-state
 * has its capital and one garrison, wasteland is empty but for its tribes.
 *
 * @throws if the setup names a polity the map does not have, or one that is not a nation.
 */
export function createGame(map: MapData, setup: GameSetup = {}): GameState {
  const topo = topologyOf(map);
  const seed = (setup.seed ?? 0) >>> 0;
  const nation = (id: string): number => {
    const index = polityIndex(map, id);
    if (at(map.polities, index).kind !== 'nation') throw new Error(`game setup: ${id} is not a nation`);
    return index;
  };
  const player = setup.player === undefined || setup.player === null ? NO_POLITY : nation(setup.player);
  const majors =
    setup.majors === undefined ? defaultMajors(map) : [...new Set(setup.majors.map(nation))].sort((a, b) => a - b);

  let cityStates = 0;
  const polities: PolityState[] = map.polities.map((polity) => ({
    alive: polity.kind !== 'wastelandRegion',
    gold: 0,
    grossIncome: 0,
    science: 0,
    culture: 0,
    cultureProgress: 0,
    policies: [],
    slots: polity.kind === 'nation' ? Array.from({ length: policySlotsFor(polity.id, 0) }, () => null) : [],
    freeSwaps: 0,
    swapReadyOn: 0,
    overlord: NO_POLITY,
    cityStateType:
      polity.kind === 'cityState'
        ? (CITY_STATE_TYPE_BY_ID[polity.id] ?? at(CITY_STATE_TYPES, cityStates++ % CITY_STATE_TYPES.length))
        : null,
    influence: {},
    suzerain: NO_POLITY,
    routeIncome: 0,
    tributeReceived: 0,
    tributePaid: 0,
    dealIncome: 0,
    techs: [],
    research: null,
    researchProgress: 0,
    era: 0,
    projectStage: 0,
    tradeRoutes: 0,
    landPorts: false,
    seaExits: false,
    yields: noYields(),
    upkeep: 0,
    warWeariness: 0,
    settlersBuilt: 0,
    capital: -1,
    aiTarget: -1,
    cityLostOn: 0,
  }));
  const state: MutableGameState = {
    map,
    version: STATE_VERSION,
    turn: 1,
    lastTurn: setup.turns ?? GAME_TURNS,
    seed,
    rng: seed,
    player,
    majors,
    polities,
    zoneOwner: map.zones.map((zone) =>
      at(map.polities, zone.polity).kind === 'wastelandRegion' ? NO_POLITY : zone.polity,
    ),
    cities: map.zones.map(() => null),
    units: [],
    nextUnitId: 1,
    improvements: {},
    relations: {},
    favour: {},
    agreements: [],
    deals: [],
    offers: [],
    routes: [],
    nextId: 1,
    roads: {},
    roadLinks: {},
    pillaged: {},
    stats: {
      citiesCaptured: 0,
      citiesFounded: 0,
      warsDeclared: 0,
      politiesAnnexed: 0,
      alliancesFormed: 0,
      vassalsMade: 0,
      routesEstablished: 0,
      seaInvasions: 0,
      navalBattles: 0,
    },
    result: null,
  };
  const ctx = createCtx(state);

  // Capitals, each with a garrison; city-states also start with walls.
  map.polities.forEach((polity, index) => {
    if (polity.kind === 'wastelandRegion' || polity.capitalZone === NO_ZONE) return;
    const city = foundCity(ctx, polity.capitalZone, index);
    if (polity.kind === 'cityState') city.buildings.push('walls');
    const garrison = addUnit(ctx, unitFor(polity.id, at(ROSTER.infantry, 0)), index, at(map.zones, polity.capitalZone).siteHex);
    garrison.status = 'fortified';
    assignCitizens(ctx, city);
  });

  // Tribes on some hexes of every wasteland zone, never on the city site.
  map.zones.forEach((zone, z) => {
    if (state.zoneOwner[z] !== NO_POLITY) return;
    const free = at(topo.zoneHexes, z).filter(
      (hex) => hex !== zone.siteHex && topo.enterable[hex] === 1 && topo.water[hex] === 0,
    );
    const tribes = Math.min(free.length, Math.max(1, Math.round(free.length / HEXES_PER_TRIBE)));
    for (let i = 0; i < tribes; i++) {
      const pick = Math.floor(random(ctx) * free.length);
      const tribe = addUnit(ctx, TRIBE, NO_POLITY, at(free, pick));
      tribe.status = 'fortified';
      free.splice(pick, 1);
    }
  });

  for (const unit of state.units) unit.moves = unitDef(unit.type).moves;
  state.stats.citiesFounded = 0;
  return state;
}

/** The polity that owns a hex right now, or `NO_POLITY` (water, off-map, unsettled wasteland). */
export function hexOwner(state: GameState, hex: number): number {
  const zone = state.map.zone[hex];
  return zone === undefined || zone < 0 ? NO_POLITY : at(state.zoneOwner, zone);
}

/**
 * The index into `ERAS` of the era the game is in: the player's era, or that
 * of the most advanced living major nation when nobody plays.
 */
export function currentEra(state: GameState): number {
  return worldEra(state);
}

/** The index into `ERAS` of the era `polity` has reached with its research. */
export function polityEra(state: GameState, polity: number): number {
  return state.polities[polity]?.era ?? 0;
}

/** Science `polity` needs for `tech`, the catch-up discount included. */
export function researchCost(state: GameState, polity: number, tech: TechId): number {
  return techCost(state, polity, tech);
}

/**
 * The resource `polity` sees on a hex, as an index into `map.resources`, or
 * `NO_RESOURCE`: a strategic resource is hidden until its tech is known.
 */
export function resourceOnHex(state: GameState, polity: number, hex: number): number {
  return visibleResource(state, polity, hex);
}

/** True if `polity` has a source of the strategic resource (`MapResource.id`) in its territory and can see it. */
export function polityHasResource(state: GameState, polity: number, resource: string): boolean {
  return hasResource(createCtx(state as MutableGameState), polity, resource);
}

// ------------------------------------------------- reading the new systems

/** Favour between two nations, from -100 to 100. */
export function favourBetween(state: GameState, a: number, b: number): number {
  return state.favour[a < b ? `${a}:${b}` : `${b}:${a}`] ?? 0;
}

/** The agreements `polity` is a party to. In a vassalage `a` is the overlord and `b` the vassal. */
export function agreementsOf(state: GameState, polity: number): Agreement[] {
  return state.agreements.filter((agreement) => agreement.a === polity || agreement.b === polity);
}

/** Culture `polity` needs in `PolityState.cultureProgress` to unlock its next policy card. */
export function nextPolicyCost(state: GameState, polity: number): number {
  return policyCost(state.polities[polity]?.policies.length ?? 0);
}

/** Trade route slots of `polity`: the base, its techs, its buildings and the commerce city-states it is suzerain of. */
export function tradeRouteSlots(state: GameState, polity: number): number {
  return routeSlots(createCtx(state as MutableGameState), polity);
}

/**
 * The path a trade route of `polity` from its city in zone `from` to the
 * target would take, or null when there is none in range.
 */
export function tradeRoutePath(state: GameState, polity: number, from: number, to: RouteTarget): RoutePath | null {
  return findRoutePath(createCtx(state as MutableGameState), polity, from, to);
}

/** Gold it costs the city in `zone` to buy the item outright (see the `buy` action). */
export function buyPrice(state: GameState, zone: number, item: BuildItem): number {
  const city = state.cities[zone];
  if (city === undefined || city === null) return 0;
  return buyCost(createCtx(state as MutableGameState), city as City, item);
}

/** The different specialties (`MapResource.id`) `polity` has, on its own land or bought. */
export function politySpecialties(state: GameState, polity: number): string[] {
  return specialtiesOf(createCtx(state as MutableGameState), polity);
}

/**
 * The hexes `polity` sees: 1 where one of its units or cities is within
 * sight, 0 elsewhere. The rules hide nothing by it; it is there for a fog of
 * war to draw.
 */
export function visibleHexes(state: GameState, polity: number): Uint8Array {
  const ctx = createCtx(state as MutableGameState);
  const { map } = state;
  const seen = new Uint8Array(map.width * map.height);
  const reveal = (hex: number, range: number): void => {
    for (const offset of hexRange(indexToOffset(hex, map.width), range)) {
      if (offset.col < 0 || offset.col >= map.width || offset.row < 0 || offset.row >= map.height) continue;
      seen[offset.row * map.width + offset.col] = 1;
    }
  };
  for (const unit of state.units) if (unit.owner === polity) reveal(unit.hex, visionRange(ctx, unit as Unit));
  for (const city of state.cities) {
    if (city !== null && city.owner === polity) reveal(at(map.zones, city.zone).siteHex, KIT.cityVision);
  }
  return seen;
}

/** How many hexes away the unit with the id sees, or 0 if there is no such unit. */
export function unitVision(state: GameState, unit: number): number {
  const ctx = createCtx(state as MutableGameState);
  const found = ctx.unitById.get(unit);
  return found === undefined ? 0 : visionRange(ctx, found);
}

// ------------------------------------------------------------ save and load

/** The game as a JSON string. The map is not included: it is given again to {@link loadGame}. */
export function saveGame(state: GameState): string {
  const { map, ...rest } = state;
  return JSON.stringify({
    format: 'shanhe-save',
    mapSize: [map.width, map.height, map.zones.length, map.polities.length],
    ...rest,
  });
}

/**
 * Rebuilds a state from {@link saveGame}'s output and the map it was played on.
 *
 * @throws if the text is not a save of this version, or the map does not match.
 */
export function loadGame(json: string, map: MapData): GameState {
  const data = JSON.parse(json) as { format?: unknown; mapSize?: unknown; version?: unknown } & Record<string, unknown>;
  if (data.format !== 'shanhe-save') throw new Error('load game: not a shanhe save');
  if (data.version !== STATE_VERSION) {
    throw new Error(`load game: unsupported version ${String(data.version)}, expected ${STATE_VERSION}`);
  }
  const expected = [map.width, map.height, map.zones.length, map.polities.length];
  if (!Array.isArray(data.mapSize) || expected.some((value, i) => (data.mapSize as unknown[])[i] !== value)) {
    throw new Error('load game: the save belongs to a different map');
  }
  const rest: Record<string, unknown> = { ...data };
  delete rest.format;
  delete rest.mapSize;
  return { ...(rest as unknown as Omit<GameState, 'map'>), map };
}

/** A short hash of everything in the state except the map. Equal states have equal hashes. */
export function hashState(state: GameState): string {
  const text = saveGame(state);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b + code, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

// ----------------------------------------------------------------- actions

/** Every action `polity` (an index into `map.polities`) may take right now. */
export function getLegalActions(state: GameState, polity: number): Action[] {
  return legalActions(createCtx(state as MutableGameState), polity);
}

/**
 * Applies one action. A legal action gives the new state and what happened;
 * an illegal one gives the reason and the state unchanged.
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  const reason = validate(createCtx(state as MutableGameState), action);
  if (reason !== null) return { ok: false, reason, state, events: [] };
  const ctx = createCtx(cloneState(state));
  execute(ctx, action);
  return { ok: true, state: ctx.state, events: ctx.events };
}

export interface EndTurnHooks {
  /**
   * Called after every action an AI takes, with the state as it then is.
   * The state is the engine's working copy: read it, do not keep or change it.
   */
  readonly onAction?: (state: GameState, action: Action) => void;
}

/**
 * Ends the turn: every polity the player does not control takes its turn,
 * then the turn is processed (income, growth, production, healing, victory)
 * and the next one starts. Once the game has a result this changes nothing.
 */
export function endTurn(state: GameState, hooks: EndTurnHooks = {}): { state: GameState; events: GameEvent[] } {
  if (state.result !== null) return { state, events: [] };
  const ctx = createCtx(cloneState(state));
  runAiTurns(ctx, hooks);
  endRound(ctx);
  return { state: ctx.state, events: ctx.events };
}

function runAiTurns(ctx: Ctx, hooks: EndTurnHooks): void {
  const { state } = ctx;
  const act = (action: Action): boolean => {
    if (validate(ctx, action) !== null) return false;
    execute(ctx, action);
    hooks.onAction?.(state, action);
    return true;
  };
  for (let polity = 0; polity < ctx.n; polity++) {
    if (polity === state.player || !at(state.polities, polity).alive) continue;
    runAi(ctx, polity, act);
  }
}

/** The state after the current turn ends: {@link endTurn} without the events. */
export function advanceTurn(state: GameState): GameState {
  return endTurn(state).state;
}
