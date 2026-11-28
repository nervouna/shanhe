/** The order in which the city panel offers the destinations of a trade route. */

import type { RouteOption } from '../core/query.ts';
import type { RouteTarget } from '../core/game.ts';

/** A stable name for a route target, also its `data-route` in the page. */
export function targetKey(to: RouteTarget): string {
  return to.kind === 'city' ? `city:${to.zone}` : `port:${to.port}`;
}

function order(to: RouteTarget): number {
  return to.kind === 'city' ? to.zone : 1_000_000 + to.port;
}

/**
 * Ranks the destinations: those that can be opened now first, then the more
 * gold a turn the higher, then the shorter path, then the order of the map,
 * so that equal destinations never swap places between two draws.
 */
export function rankDestinations(options: readonly RouteOption[]): RouteOption[] {
  return [...options].sort(
    (a, b) =>
      Number(a.reason !== null) - Number(b.reason !== null) ||
      b.income - a.income ||
      a.path.length - b.path.length ||
      order(a.to) - order(b.to),
  );
}
