/**
 * The working context of the rules: a private, mutable copy of the state plus
 * the lookups that are rebuilt from it (unit by hex, the war matrix). Every
 * public entry point makes one context, mutates it and hands the state back.
 */

import { Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { EMBARK_COAST_ERA, OCEAN_ERA, eraOfTurn, unitDef } from './data.ts';
import type { UnitDef } from './data.ts';
import { topologyOf } from './topology.ts';
import type { Topology } from './topology.ts';
import { NO_POLITY } from './types.ts';
import type { City, GameEvent, GameState, MutableGameState, PolityState, Relation, Unit } from './types.ts';

export interface Ctx {
  readonly state: MutableGameState;
  readonly map: MapData;
  readonly topo: Topology;
  readonly events: GameEvent[];
  /** Hex index to the unit standing there. */
  readonly unitAt: Map<number, Unit>;
  readonly unitById: Map<number, Unit>;
  /** Number of polities. */
  readonly n: number;
  /** `n * n` flags: 1 where the two polities are at war. */
  readonly war: Uint8Array;
  /** Era of the current turn. */
  era: number;
}

/** Copies plain JSON data. */
export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry as unknown)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = deepClone((value as Record<string, unknown>)[key]);
    return out as T;
  }
  return value;
}

/** A copy of `state` that shares only the map. */
export function cloneState(state: GameState): MutableGameState {
  const { map, ...rest } = state;
  return { ...(deepClone(rest) as Omit<MutableGameState, 'map'>), map };
}

/** A context that works directly on `state`: pass a copy. */
export function createCtx(state: MutableGameState): Ctx {
  const n = state.polities.length;
  const ctx: Ctx = {
    state,
    map: state.map,
    topo: topologyOf(state.map),
    events: [],
    unitAt: new Map(),
    unitById: new Map(),
    n,
    war: new Uint8Array(n * n),
    era: eraOfTurn(state.turn),
  };
  for (const unit of state.units) {
    ctx.unitAt.set(unit.hex, unit);
    ctx.unitById.set(unit.id, unit);
  }
  for (const key of Object.keys(state.relations)) {
    const relation = state.relations[key] as Relation;
    if (relation.atWar) setWarFlag(ctx, relation.a, relation.b, true);
  }
  return ctx;
}

/** Entry `index` of `list`; throws when it is missing. */
export function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`index out of range: ${index}`);
  return value;
}

export function polityOf(ctx: Ctx, polity: number): PolityState {
  return at(ctx.state.polities, polity);
}

// ----------------------------------------------------------------- random

/** Next number in [0, 1) from the generator stored in the state (mulberry32). */
export function random(ctx: Ctx): number {
  const state = ctx.state;
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ------------------------------------------------------- owners and wars

/** The polity that owns a hex, or `NO_POLITY` (water, off-map, unsettled wasteland). */
export function ownerOf(ctx: Ctx, hex: number): number {
  const zone = ctx.map.zone[hex] as number;
  return zone < 0 ? NO_POLITY : (ctx.state.zoneOwner[zone] as number);
}

/** True if the two are at war. Everybody is at war with the tribes (`NO_POLITY`). */
export function atWar(ctx: Ctx, a: number, b: number): boolean {
  if (a === b) return false;
  if (a === NO_POLITY || b === NO_POLITY) return true;
  return ctx.war[a * ctx.n + b] === 1;
}

export function setWarFlag(ctx: Ctx, a: number, b: number, value: boolean): void {
  ctx.war[a * ctx.n + b] = value ? 1 : 0;
  ctx.war[b * ctx.n + a] = value ? 1 : 0;
}

export function relationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function relationOf(ctx: Ctx, a: number, b: number): Relation | undefined {
  return ctx.state.relations[relationKey(a, b)];
}

/** Number of wars a polity is in. */
export function warCount(ctx: Ctx, polity: number): number {
  let wars = 0;
  for (let other = 0; other < ctx.n; other++) if (ctx.war[polity * ctx.n + other] === 1) wars++;
  return wars;
}

// --------------------------------------------------------------- movement

/** True if the unit type may stand on the hex's terrain in the current era. */
export function terrainAllows(ctx: Ctx, def: UnitDef, hex: number): boolean {
  if (ctx.topo.enterable[hex] !== 1) return false;
  if (ctx.topo.water[hex] === 1) {
    const ocean = ctx.map.terrain[hex] === Terrain.Ocean;
    if (def.domain === 'sea') return !ocean || ctx.era >= OCEAN_ERA;
    return ocean ? ctx.era >= OCEAN_ERA : ctx.era >= EMBARK_COAST_ERA;
  }
  return def.domain === 'land';
}

/** True if `polity`'s units may be on the hex: its own land, nobody's, or an enemy's. */
export function bordersOpen(ctx: Ctx, polity: number, hex: number): boolean {
  const owner = ownerOf(ctx, hex);
  return owner === NO_POLITY || owner === polity || atWar(ctx, polity, owner);
}

/** True for a land unit standing on water. */
export function isEmbarked(ctx: Ctx, unit: Unit): boolean {
  return ctx.topo.water[unit.hex] === 1 && unitDef(unit.type).domain === 'land';
}

// ------------------------------------------------------------------ units

export function cityAtHex(ctx: Ctx, hex: number): City | null {
  const zone = ctx.topo.siteZone[hex] as number;
  return zone < 0 ? null : (ctx.state.cities[zone] ?? null);
}

export function addUnit(ctx: Ctx, type: string, owner: number, hex: number): Unit {
  const unit: Unit = {
    id: ctx.state.nextUnitId++,
    type,
    owner,
    hex,
    hp: 100,
    moves: 0,
    xp: 0,
    level: 0,
    status: 'ready',
    acted: false,
  };
  ctx.state.units.push(unit);
  ctx.unitAt.set(hex, unit);
  ctx.unitById.set(unit.id, unit);
  ctx.events.push({ type: 'unitCreated', unit: unit.id, owner, hex, unitType: type });
  return unit;
}

export function removeUnit(ctx: Ctx, unit: Unit): void {
  const index = ctx.state.units.indexOf(unit);
  if (index >= 0) ctx.state.units.splice(index, 1);
  if (ctx.unitAt.get(unit.hex) === unit) ctx.unitAt.delete(unit.hex);
  ctx.unitById.delete(unit.id);
}

export function placeUnit(ctx: Ctx, unit: Unit, hex: number): void {
  if (ctx.unitAt.get(unit.hex) === unit) ctx.unitAt.delete(unit.hex);
  unit.hex = hex;
  ctx.unitAt.set(hex, unit);
}

/**
 * Moves every unit that stands in territory closed to it (after a peace, a
 * capture or a settlement) to the nearest hex it may stand on, or disbands it
 * when there is none nearby.
 */
export function enforceBorders(ctx: Ctx): void {
  const stranded = ctx.state.units.filter(
    (unit) => unit.owner !== NO_POLITY && !bordersOpen(ctx, unit.owner, unit.hex),
  );
  for (const unit of stranded) {
    const def = unitDef(unit.type);
    const from = unit.hex;
    const to = nearestRefuge(ctx, def, unit.owner, from);
    if (to < 0) {
      removeUnit(ctx, unit);
      ctx.events.push({ type: 'unitDisbanded', unit: unit.id, owner: unit.owner, hex: from });
    } else {
      placeUnit(ctx, unit, to);
      ctx.events.push({ type: 'unitExpelled', unit: unit.id, from, to });
    }
  }
}

const REFUGE_SEARCH_LIMIT = 4000;

function nearestRefuge(ctx: Ctx, def: UnitDef, polity: number, from: number): number {
  const seen = new Set<number>([from]);
  const queue = [from];
  for (let head = 0; head < queue.length && head < REFUGE_SEARCH_LIMIT; head++) {
    const hex = queue[head] as number;
    for (let d = 0; d < 6; d++) {
      const next = ctx.topo.neighbors[hex * 6 + d] as number;
      if (next < 0 || seen.has(next) || ctx.topo.enterable[next] !== 1) continue;
      seen.add(next);
      // A land unit is only carried over land; a ship only over water.
      if ((ctx.topo.water[next] === 1) !== (def.domain === 'sea')) continue;
      queue.push(next);
      if (!ctx.unitAt.has(next) && bordersOpen(ctx, polity, next)) {
        const city = cityAtHex(ctx, next);
        if (city === null || city.owner === polity) return next;
      }
    }
  }
  return -1;
}
