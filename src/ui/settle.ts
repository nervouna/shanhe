/** Where a settler can go to found a city: what the interface marks while one is selected. No DOM here. */

import { SETTLER } from '../core/data.ts';
import type { GameState } from '../core/game.ts';
import { hexDistance, settleSites, unitWithId } from '../core/query.ts';
import { findPath } from './path.ts';

export interface SettlerSite {
  /** The site hex: where the settler has to stand to settle. */
  readonly hex: number;
  /** Turns the settler needs to get there; 0 if it stands on it. */
  readonly turns: number;
}

/** Sites farther than this many hexes from the settler are not looked at. */
export const SETTLE_RANGE = 24;
/** At most this many sites are marked: the nearest. */
export const SETTLE_SITES = 8;

/**
 * The free city sites in reach of a settler: the empty sites of unsettled
 * wasteland within {@link SETTLE_RANGE} hexes that it has a way to, the
 * quickest to get to first, at most {@link SETTLE_SITES} of them. Empty for
 * a unit that is no settler.
 *
 * @param state the state as the player knows it: the way is planned on what they see.
 */
export function settlerSites(state: GameState, unitId: number): SettlerSite[] {
  const unit = unitWithId(state, unitId);
  if (unit === null || unit.type !== SETTLER) return [];
  const near = settleSites(state)
    .map((hex) => ({ hex, distance: hexDistance(state, unit.hex, hex) }))
    .filter((site) => site.distance <= SETTLE_RANGE)
    .sort((a, b) => a.distance - b.distance || a.hex - b.hex)
    // a way round water or mountains is longer than the distance: look at a few more than are kept
    .slice(0, SETTLE_SITES * 2);
  const sites: SettlerSite[] = [];
  for (const { hex } of near) {
    if (hex === unit.hex) {
      sites.push({ hex, turns: 0 });
      continue;
    }
    const path = findPath(state, unitId, hex);
    if (path !== null) sites.push({ hex, turns: path.total });
  }
  return sites.sort((a, b) => a.turns - b.turns || a.hex - b.hex).slice(0, SETTLE_SITES);
}
