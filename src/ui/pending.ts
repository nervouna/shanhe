/** What still needs the player's attention this turn, and what the main action button does about it. */

import { NO_POLITY } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { researchOptions, unlockOptions } from '../core/query.ts';

export type PendingItem =
  /** A unit that can still act and has been told nothing. */
  | { readonly kind: 'unit'; readonly unit: number; readonly hex: number }
  /** A city (its zone) with nothing to build. */
  | { readonly kind: 'city'; readonly city: number; readonly hex: number }
  /** Nothing is being researched although something could be. */
  | { readonly kind: 'research' }
  /** A policy card can be unlocked, or a slot is empty while an unlocked card is not in use. */
  | { readonly kind: 'policy' }
  /** A proposal of `from` (an agreement or a resource deal) waits for an answer; `offer` is its id. */
  | { readonly kind: 'offer'; readonly offer: number; readonly from: number }
  /** `from` offered peace during the last turn. */
  | { readonly kind: 'peace'; readonly from: number };

export type PendingKind = PendingItem['kind'];

/** What the player has already decided this turn. */
export interface Attention {
  /** Units that are travelling under a standing order, by id. */
  readonly orders: { has(unit: number): boolean };
  /** Units told to do nothing this turn, by id. */
  readonly skipped: { has(unit: number): boolean };
  /** Polities whose peace offer the player turned down this turn. */
  readonly declined?: { has(polity: number): boolean };
}

/** The polities that offered the player peace during the last turn and are still at war with them. */
export function peaceOffers(state: GameState): number[] {
  const { player } = state;
  if (player === NO_POLITY) return [];
  const list: number[] = [];
  for (const relation of Object.values(state.relations)) {
    if (!relation.atWar) continue;
    const other = relation.a === player ? relation.b : relation.b === player ? relation.a : NO_POLITY;
    if (other === NO_POLITY) continue;
    const offered = relation.a === other ? relation.offerA : relation.offerB;
    // the others act while the turn ends, so their offer carries the number of the turn before
    if (offered > 0 && offered >= state.turn - 1) list.push(other);
  }
  return list.sort((a, b) => a - b);
}

/** True if the player has a card to unlock, or an empty slot and an unlocked card that is in no slot. */
export function policyPending(state: GameState): boolean {
  const self = state.polities[state.player];
  if (self === undefined) return false;
  if (unlockOptions(state, state.player).length > 0) return true;
  return self.slots.includes(null) && self.policies.some((policy) => !self.slots.includes(policy));
}

/**
 * Everything waiting for the player: idle units in order of creation, cities
 * without a project, a research to choose, policies, then the offers of
 * other polities.
 */
export function pendingItems(state: GameState, attention: Attention): PendingItem[] {
  const { player, map } = state;
  const self = state.polities[player];
  if (player === NO_POLITY || state.result !== null || self?.alive !== true) return [];
  const items: PendingItem[] = [];
  for (const unit of state.units) {
    if (unit.owner !== player || unit.moves <= 0 || unit.status !== 'ready') continue;
    if (attention.skipped.has(unit.id) || attention.orders.has(unit.id)) continue;
    items.push({ kind: 'unit', unit: unit.id, hex: unit.hex });
  }
  for (const city of state.cities) {
    if (city === null || city.owner !== player || city.queue.length > 0) continue;
    const zone = map.zones[city.zone];
    if (zone !== undefined) items.push({ kind: 'city', city: city.zone, hex: zone.siteHex });
  }
  if (self.research === null && researchOptions(state, player).length > 0) items.push({ kind: 'research' });
  if (policyPending(state)) items.push({ kind: 'policy' });
  for (const offer of state.offers) {
    if (offer.to === player) items.push({ kind: 'offer', offer: offer.id, from: offer.from });
  }
  for (const from of peaceOffers(state)) {
    if (attention.declined?.has(from) !== true) items.push({ kind: 'peace', from });
  }
  return items;
}

export function samePending(a: PendingItem | null, b: PendingItem | null): boolean {
  if (a === null || b === null) return a === b;
  switch (a.kind) {
    case 'unit':
      return b.kind === 'unit' && a.unit === b.unit;
    case 'city':
      return b.kind === 'city' && a.city === b.city;
    case 'offer':
      return b.kind === 'offer' && a.offer === b.offer;
    case 'peace':
      return b.kind === 'peace' && a.from === b.from;
    default:
      return a.kind === b.kind;
  }
}

export type MainButton =
  | { readonly kind: PendingKind; readonly item: PendingItem }
  | { readonly kind: 'nextTurn' };

/**
 * What the main action button offers: the pending item after the one in
 * focus, so that repeated presses cycle through all of them, and "next turn"
 * only when nothing is pending.
 *
 * @param focus the item the player is looking at, if any.
 */
export function mainButton(items: readonly PendingItem[], focus: PendingItem | null): MainButton {
  if (items.length === 0) return { kind: 'nextTurn' };
  const at = items.findIndex((item) => samePending(item, focus));
  const item = items[(at + 1) % items.length] as PendingItem;
  return { kind: item.kind, item };
}
