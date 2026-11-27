/** What still needs the player's attention this turn, and what the main action button does about it. */

import { NO_POLITY } from '../core/game.ts';
import type { GameState } from '../core/game.ts';

export type PendingItem =
  /** A unit that can still act and has been told nothing. */
  | { readonly kind: 'unit'; readonly unit: number; readonly hex: number }
  /** A city (its zone) with nothing to build. */
  | { readonly kind: 'city'; readonly city: number; readonly hex: number };

/** What the player has already decided about their units. */
export interface Attention {
  /** Units that are travelling under a standing order, by id. */
  readonly orders: { has(unit: number): boolean };
  /** Units told to do nothing this turn, by id. */
  readonly skipped: { has(unit: number): boolean };
}

/** Everything waiting for the player: idle units in order of creation, then cities without a project. */
export function pendingItems(state: GameState, attention: Attention): PendingItem[] {
  const { player, map } = state;
  if (player === NO_POLITY || state.result !== null || state.polities[player]?.alive !== true) return [];
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
  return items;
}

export function samePending(a: PendingItem | null, b: PendingItem | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'unit') return b.kind === 'unit' && a.unit === b.unit;
  return b.kind === 'city' && a.city === b.city;
}

export type MainButton =
  | { readonly kind: 'unit' | 'city'; readonly item: PendingItem }
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
