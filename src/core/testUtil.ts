/** Helpers for the rules tests: editing a state directly and finding hexes on a map. */

import { hexNeighbors, indexToOffset } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import { assignCitizens, foundCity } from './cities.ts';
import { cloneState, createCtx } from './context.ts';
import { TECH_IDS, unitDef } from './data.ts';
import type { AgreementKind, PolicyId, TechId, Yields } from './data.ts';
import { applyAction } from './game.ts';
import { learnTech } from './tech.ts';
import { topologyOf } from './topology.ts';
import type { Action, GameEvent, GameState, MutableGameState, Unit } from './types.ts';

/** A copy of `state` after `change` has edited it by hand. */
export function edit(state: GameState, change: (draft: MutableGameState) => void): GameState {
  const draft = cloneState(state);
  change(draft);
  return draft;
}

/** Adds a fresh unit to a draft state. */
export function put(draft: MutableGameState, type: string, owner: number, hex: number, extra: Partial<Unit> = {}): Unit {
  const unit: Unit = {
    id: draft.nextUnitId++,
    type,
    owner,
    hex,
    hp: 100,
    moves: unitDef(type).moves,
    xp: 0,
    level: 0,
    status: 'ready',
    acted: false,
    ...extra,
  };
  draft.units.push(unit);
  return unit;
}

/** Applies an action that must be legal. */
export function apply(state: GameState, action: Action): GameState {
  return applyWithEvents(state, action).state;
}

export function applyWithEvents(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action ${action.type} rejected: ${result.reason}`);
  return result;
}

/** The hexes next to `hex` that lie inside the grid. */
export function around(map: MapData, hex: number): number[] {
  return hexNeighbors(indexToOffset(hex, map.width))
    .filter((n) => n.col >= 0 && n.col < map.width && n.row >= 0 && n.row < map.height)
    .map((n) => n.row * map.width + n.col);
}

/** True for flat, open land without a river, city site or resource: ground with no combat or movement modifier. */
export function isPlainGround(map: MapData, hex: number): boolean {
  const topo = topologyOf(map);
  return (
    topo.enterable[hex] === 1 &&
    topo.water[hex] === 0 &&
    topo.moveCost[hex] === 1 &&
    map.riverEdges[hex] === 0 &&
    topo.siteZone[hex] === -1
  );
}

/** The first pair of adjacent hexes, in index order, for which `test` holds. */
export function findPair(map: MapData, test: (a: number, b: number) => boolean): [number, number] {
  for (let a = 0; a < map.width * map.height; a++) {
    for (const b of around(map, a)) if (test(a, b)) return [a, b];
  }
  throw new Error('no such pair of hexes on this map');
}

/**
 * A copy of `state` in which `polity` (or every polity) knows the given
 * techs (default: all of them), with the era and flags that follow from them.
 * Prerequisites and costs are not checked.
 */
export function learn(state: GameState, polity: number | 'all', techs: readonly TechId[] = TECH_IDS): GameState {
  const ctx = createCtx(cloneState(state));
  const polities = polity === 'all' ? ctx.state.polities.map((_, index) => index) : [polity];
  for (const index of polities) for (const tech of techs) learnTech(ctx, index, tech);
  return ctx.state;
}

/** A copy of `map` with the resource `id` on each of `hexes`; the resource is added to the list if it is new. */
export function withResource(map: MapData, id: string, hexes: readonly number[]): MapData {
  const resources = [...map.resources];
  let index = resources.findIndex((entry) => entry.id === id);
  if (index < 0) index = resources.push({ id, nameZh: id, nameEn: id }) - 1;
  const resource = Int16Array.from(map.resource);
  for (const hex of hexes) resource[hex] = index;
  return { ...map, resources, resource };
}

/** True if no two units share a hex. */
export function oneUnitPerHex(state: GameState): boolean {
  return new Set(state.units.map((unit) => unit.hex)).size === state.units.length;
}

/** The yields of the city in `zone`, worked out afresh from the state as it is. */
export function yieldsOf(state: GameState, zone: number): Yields {
  const ctx = createCtx(cloneState(state));
  const city = ctx.state.cities[zone];
  if (city === undefined || city === null) throw new Error(`no city in zone ${zone}`);
  assignCitizens(ctx, city);
  return city.yields;
}

/** A copy of `state` with a city founded on the site of `zone` for `owner`. */
export function withCity(state: GameState, zone: number, owner: number): GameState {
  const ctx = createCtx(cloneState(state));
  foundCity(ctx, zone, owner);
  return ctx.state;
}

/** A copy of `state` in which `polity` has unlocked the card and holds it in its first free slot (or slot 0). */
export function withPolicy(state: GameState, polity: number, policy: PolicyId): GameState {
  return edit(state, (draft) => {
    const self = draft.polities[polity];
    if (self === undefined) throw new Error(`no polity ${polity}`);
    if (!self.policies.includes(policy)) self.policies.push(policy);
    if (self.slots.includes(policy)) return;
    const free = self.slots.indexOf(null);
    self.slots[free < 0 ? 0 : free] = policy;
  });
}

/** A copy of `state` with an agreement in force between the two; for a vassalage `a` is the overlord. */
export function withAgreement(state: GameState, kind: AgreementKind, a: number, b: number): GameState {
  return edit(state, (draft) => {
    draft.agreements.push({ kind, a, b, since: draft.turn, until: 0 });
    const vassal = draft.polities[b];
    if (kind === 'vassalage' && vassal !== undefined) vassal.overlord = a;
  });
}
