/** The colours of the minimap under each of its lenses. */

import { STRATEGIC_RESOURCES } from '../core/data.ts';
import { NO_POLITY, hexOwner, resourceOnHex } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { NO_RESOURCE, OWNER_OFF_MAP, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import { standingWith } from './diplomacy.ts';
import type { Standing } from './diplomacy.ts';

export const LENSES = ['political', 'resources', 'diplomacy'] as const;
export type Lens = (typeof LENSES)[number];

/** The colour of each relation to the player, shared by the minimap and the strip of major nations. */
export const STANDING_COLORS: Readonly<Record<Standing, string>> = {
  self: '#e8e4da',
  war: '#c8402d',
  overlord: '#c9a23a',
  vassal: '#c9a23a',
  alliance: '#4f9d7a',
  friendly: '#5b8fb8',
  truce: '#8f6f66',
  peace: '#77705f',
};

const OFF_MAP_WATER = '#1a232c';
const OFF_MAP_LAND = '#2c2a27';
const WATER = '#22323f';
const MOUNTAIN = '#5d5850';
const LAND = '#77705f';
const OWNED = '#4a463e';
const STRATEGIC = '#c8402d';
const SPECIALTY = '#d8b24a';

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * The colour of a hex on the minimap.
 *
 * - `political`: the colour of its owner.
 * - `resources`: muted ground, with the resources the viewer can see in
 *   vermilion (strategic) and gold (specialties).
 * - `diplomacy`: the owner's relation to the viewer; in observer mode,
 *   where there is nobody to relate to, the same as `political`.
 *
 * @param viewer the player's polity, or `NO_POLITY`.
 */
export function lensColor(state: GameState, hex: number, lens: Lens, viewer: number): string {
  const { map } = state;
  const terrain = map.terrain[hex] as number;
  const water = isWaterTerrain(terrain);
  if (map.owner[hex] === OWNER_OFF_MAP) return water ? OFF_MAP_WATER : OFF_MAP_LAND;
  if (lens === 'resources') {
    const resource = resourceOnHex(state, viewer, hex);
    if (resource !== NO_RESOURCE) {
      const id = map.resources[resource]?.id ?? '';
      return Object.hasOwn(STRATEGIC_RESOURCES, id) ? STRATEGIC : SPECIALTY;
    }
    if (water) return WATER;
    if (terrain === Terrain.Mountain) return MOUNTAIN;
    return hexOwner(state, hex) === NO_POLITY ? LAND : OWNED;
  }
  if (water) return WATER;
  const owner = hexOwner(state, hex);
  if (owner === NO_POLITY) return terrain === Terrain.Mountain ? MOUNTAIN : LAND;
  if (lens === 'diplomacy' && viewer !== NO_POLITY) return STANDING_COLORS[standingWith(state, viewer, owner)];
  return css(map.polities[owner]?.color ?? 0x888888);
}
