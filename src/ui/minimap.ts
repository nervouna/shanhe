/** The minimap: who owns what, drawn on a 2D canvas, with the camera's position on it. */

import type { GameState } from '../core/game.ts';
import { NO_POLITY, hexOwner } from '../core/game.ts';
import { OWNER_OFF_MAP, Terrain, isWaterTerrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';

export interface Minimap {
  readonly element: HTMLElement;
  /** Repaints the owners. */
  draw(state: GameState): void;
  /** Moves the camera mark to a point of the ground plane. */
  setCamera(x: number, z: number): void;
}

const MAX_WIDTH = 168;
const MAX_HEIGHT = 190;
const SQRT3 = Math.sqrt(3);

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

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
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const mark = document.createElement('div');
  mark.className = 'minimap-mark';
  element.append(canvas, mark);

  const { size, originX, originZ } = map.projection.hexLayout;

  element.addEventListener('click', (event) => {
    const bounds = canvas.getBoundingClientRect();
    const row = Math.max(0, Math.min(map.height - 1, Math.floor((event.clientY - bounds.top) / cellH)));
    const x = (event.clientX - bounds.left) / cellW - (row % 2 === 1 ? 0.5 : 0);
    const col = Math.max(0, Math.min(map.width - 1, Math.floor(x)));
    onPick(row * map.width + col);
  });

  return {
    element,
    draw(state) {
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      for (let row = 0; row < map.height; row++) {
        const shift = row % 2 === 1 ? 0.5 : 0;
        for (let col = 0; col < map.width; col++) {
          const hex = row * map.width + col;
          const terrain = map.terrain[hex] as number;
          const owner = hexOwner(state, hex);
          let color: string;
          if (map.owner[hex] === OWNER_OFF_MAP) color = isWaterTerrain(terrain) ? '#1a232c' : '#2c2a27';
          else if (isWaterTerrain(terrain)) color = '#22323f';
          else if (owner !== NO_POLITY) color = css(map.polities[owner]?.color ?? 0x888888);
          else color = terrain === Terrain.Mountain ? '#5d5850' : '#77705f';
          context.fillStyle = color;
          context.fillRect((col + shift) * cellW, row * cellH, cellW + 0.5, cellH + 0.5);
        }
      }
    },
    setCamera(x, z) {
      const left = ((x - originX) / size + SQRT3 / 2) * scale;
      const top = ((z - originZ) / size + 0.75) * scale;
      mark.style.transform = `translate(${Math.max(0, Math.min(width, left))}px, ${Math.max(0, Math.min(height, top))}px)`;
    },
  };
}
