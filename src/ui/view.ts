/** What a panel or an overlay needs from the application that hosts it. */

import type { Action, GameState } from '../core/game.ts';
import type { MapData } from '../shared/mapData.ts';

export interface View {
  readonly state: GameState;
  readonly map: MapData;
  /** The player's polity, or `NO_POLITY` in observer mode. */
  readonly player: number;
  /** True while turns are being played: nothing can be done then. */
  readonly busy: boolean;
  /** Sends an action of the player and says why if the rules refuse it. Does not redraw. */
  act(action: Action): boolean;
  /** Turns down a peace offer for this turn. */
  declinePeace(polity: number): void;
  /** Redraws the whole interface. */
  refresh(): void;
  /** Moves the camera to a hex. */
  flyTo(hex: number): void;
  /** Opens the panel of a polity and flies to its capital. */
  openPolity(polity: number): void;
  /** Closes the full-screen overlay that is open. */
  closeOverlay(): void;
  /** Draws a path on the map, or removes it with null. */
  previewPath(hexes: readonly number[] | null): void;
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
