/**
 * Turns what the rules report into what the renderer plays: pieces that
 * slide, strike and fall, cities that shoot, zones that change colour.
 */

import { unitDef } from '../core/data.ts';
import type { GameEvent, GameState } from '../core/game.ts';
import { topologyOf } from '../core/topology.ts';
import type { VisualEvent } from '../render/scene.ts';

/** More events than this in one go are played faster, so that a long AI turn does not hold the player up. */
const EVENTS_AT_FULL_LENGTH = 6;
const MAX_SPEED = 6;

/**
 * The animations for `events`, in their order.
 *
 * @param before the state the events started from: the board the renderer
 *   still shows. Only its units can be animated; a unit made by these very
 *   events is not on the board yet.
 * @param inView true for a hex the player is looking at. An event is kept
 *   if any of its hexes is in view.
 * @param sighted true for a hex the player's nation sees (fog of war);
 *   everything by default, as for the observer. A step between two hexes out
 *   of sight is not played, nor a strike at a hex out of sight or the fall
 *   of a city out of sight. `before` is then the state as the player knows
 *   it: a unit the fog hides is not on the board and nothing it does is played.
 */
export function visualEvents(
  before: GameState,
  events: readonly GameEvent[],
  inView: (hex: number) => boolean,
  sighted: (hex: number) => boolean = () => true,
): VisualEvent[] {
  const { map } = before;
  const topo = topologyOf(map);
  /** Where each unit of the board stands as the events go by; a destroyed unit is dropped. */
  const hexOf = new Map<number, number>();
  const typeOf = new Map<number, string>();
  for (const unit of before.units) {
    hexOf.set(unit.id, unit.hex);
    typeOf.set(unit.id, unit.type);
  }
  const siteOf = (zone: number): number => map.zones[zone]?.siteHex ?? -1;

  const out: { event: VisualEvent; seen: boolean }[] = [];
  const push = (event: VisualEvent, hexes: readonly number[]): void => {
    out.push({ event, seen: hexes.some((hex) => hex >= 0 && inView(hex)) });
  };

  for (const event of events) {
    switch (event.type) {
      case 'unitMoved':
      case 'unitExpelled': {
        if (!hexOf.has(event.unit)) break;
        hexOf.set(event.unit, event.to);
        // out of sight the piece is not followed: it stays where it was last seen until the board is redrawn
        if (!sighted(event.from) && !sighted(event.to)) break;
        const last = out.at(-1);
        if (
          event.type === 'unitMoved' &&
          last !== undefined &&
          last.event.type === 'move' &&
          last.event.unit === event.unit &&
          last.event.path.at(-1) === event.from
        ) {
          // steps of one walk become one slide
          out[out.length - 1] = {
            event: { type: 'move', unit: event.unit, path: [...last.event.path, event.to] },
            seen: last.seen || inView(event.to),
          };
        } else {
          push({ type: 'move', unit: event.unit, path: [event.from, event.to] }, [event.from, event.to]);
        }
        break;
      }
      case 'combat': {
        if (!hexOf.has(event.unit) || !sighted(event.target)) break;
        const siege = unitDef(typeOf.get(event.unit) ?? '').unitClass === 'siege';
        const type = event.ranged ? (siege ? 'siege' : 'ranged') : 'melee';
        push({ type, unit: event.unit, targetHex: event.target }, [event.from, event.target]);
        break;
      }
      case 'cityStrike': {
        const cityHex = siteOf(event.city);
        const targetHex = hexOf.get(event.unit);
        if (cityHex < 0 || targetHex === undefined || !sighted(targetHex)) break;
        push({ type: 'cityStrike', cityHex, targetHex }, [cityHex, targetHex]);
        break;
      }
      case 'airStrike': {
        const cityHex = siteOf(event.city);
        if (cityHex < 0 || !sighted(event.target)) break;
        push({ type: 'cityStrike', cityHex, targetHex: event.target }, [cityHex, event.target]);
        break;
      }
      case 'unitKilled': {
        if (!hexOf.has(event.unit)) break;
        hexOf.delete(event.unit);
        push({ type: 'destroy', unit: event.unit }, [event.hex]);
        break;
      }
      case 'unitDisbanded':
        // it leaves the board without a show
        hexOf.delete(event.unit);
        break;
      case 'unitPromoted': {
        const hex = hexOf.get(event.unit);
        if (hex !== undefined) push({ type: 'promote', unit: event.unit }, [hex]);
        break;
      }
      case 'cityCaptured':
      case 'zoneTransferred': {
        const zone = event.type === 'cityCaptured' ? event.city : event.zone;
        const cityHex = siteOf(zone);
        const hexes = topo.zoneHexes[zone] ?? [];
        if (cityHex < 0 || event.to < 0 || hexes.length === 0 || !sighted(cityHex)) break;
        // a captured city's zone is also reported as transferred: one sweep is enough
        const last = out.at(-1);
        if (last !== undefined && last.event.type === 'capture' && last.event.cityHex === cityHex) break;
        push({ type: 'capture', cityHex, hexes, polity: event.to }, hexes);
        break;
      }
      default:
        break;
    }
  }
  return out.filter((entry) => entry.seen).map((entry) => entry.event);
}

/** The speed to play `count` events at: 1 for a few, faster for many. */
export function playSpeed(count: number): number {
  return Math.max(1, Math.min(MAX_SPEED, count / EVENTS_AT_FULL_LENGTH));
}
