/** The minimap: the map through one of its lenses, drawn on a 2D canvas, with the camera's position on it. */

import { resourceOnHex } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { NO_RESOURCE } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { lensColor } from './lens.ts';
import type { Lens } from './lens.ts';

export interface Minimap {
  readonly element: HTMLElement;
  /** Repaints the map through `lens`, as `viewer` (the player's polity, or -1) sees it. */
  draw(state: GameState, lens: Lens, viewer: number): void;
  /** Moves the camera mark to a point of the ground plane. */
  setCamera(x: number, z: number): void;
}

const MAX_WIDTH = 168;
const MAX_HEIGHT = 190;
const SQRT3 = Math.sqrt(3);
/** Under the resources lens a resource is drawn at least this large, in pixels, so that it shows on a big map. */
const RESOURCE_MARK = 3;

/**
 * @param onPick called with the hex index under a click.
 */
export function createMinimap(map: MapData, onPick: (hex: number) => void): Minimap {
  // a hex is sqrt(3) wide and rows are 1.5 apart, in units of the hex size
  const spanX = (map.width + 0.5) * SQRT3;
  const spanY = map.height * 1.5 + 0.5;
  const scale = Math.min(MAX_WIDTH / spanX, MAX_HEIGHT / spanY);
  const width = Math.ceil(spanX * scale);
  const height = Math.ceil(spanY * scale);
  const cellW = SQRT3 * scale;
  const cellH = 1.5 * scale;

  const element = document.createElement('div');
  element.id = 'minimap';
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  const canvas = document.createElement('canvas');
  const ratio = Math.min(3, (window.devicePixelRatio || 1) * 1.5);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const mark = document.createElement('div');
  mark.className = 'minimap-mark';
  element.append(canvas, mark);

  const { size, originX, originZ } = map.projection.hexLayout;

  element.addEventListener('click', (event) => {
    // the interface is scaled as a whole: measure the click in fractions of the canvas as it is on screen
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const localX = ((event.clientX - bounds.left) / bounds.width) * width;
    const localY = ((event.clientY - bounds.top) / bounds.height) * height;
    const row = Math.max(0, Math.min(map.height - 1, Math.floor(localY / cellH)));
    const x = localX / cellW - (row % 2 === 1 ? 0.5 : 0);
    const col = Math.max(0, Math.min(map.width - 1, Math.floor(x)));
    onPick(row * map.width + col);
  });

  return {
    element,
    draw(state, lens, viewer) {
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const marks: { x: number; y: number; color: string }[] = [];
      for (let row = 0; row < map.height; row++) {
        const shift = row % 2 === 1 ? 0.5 : 0;
        for (let col = 0; col < map.width; col++) {
          const hex = row * map.width + col;
          const color = lensColor(state, hex, lens, viewer);
          context.fillStyle = color;
          context.fillRect((col + shift) * cellW, row * cellH, cellW + 0.5, cellH + 0.5);
          if (lens === 'resources' && cellW < RESOURCE_MARK && resourceOnHex(state, viewer, hex) !== NO_RESOURCE) {
            marks.push({ x: (col + shift + 0.5) * cellW, y: (row + 0.5) * cellH, color });
          }
        }
      }
      for (const entry of marks) {
        context.fillStyle = entry.color;
        context.fillRect(entry.x - RESOURCE_MARK / 2, entry.y - RESOURCE_MARK / 2, RESOURCE_MARK, RESOURCE_MARK);
      }
    },
    setCamera(x, z) {
      const left = ((x - originX) / size + SQRT3 / 2) * scale;
      const top = ((z - originZ) / size + 0.75) * scale;
      mark.style.transform = `translate(${Math.max(0, Math.min(width, left))}px, ${Math.max(0, Math.min(height, top))}px)`;
    },
  };
}
