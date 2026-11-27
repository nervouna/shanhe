/** Wires the layers: rules core, renderer and UI. */

import { createGame } from './core/game.ts';
import type { GameState } from './core/game.ts';
import { createMapView } from './render/mapView.ts';
import { createFixtureMap } from './shared/fixtureMap.ts';
import type { RenderBackend } from './shared/types.ts';
import { createHud } from './ui/hud.ts';

declare global {
  interface Window {
    /** Handle for automated checks. Set once the renderer has started. */
    __shanhe?: { backend: RenderBackend; state: GameState };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#map');
const hudRoot = document.querySelector<HTMLElement>('#hud');
if (canvas === null || hudRoot === null) throw new Error('index.html is missing #map or #hud');

const state = createGame(createFixtureMap());
const hud = createHud(hudRoot);
hud.setTurn(state.turn);

try {
  const view = await createMapView(canvas, state.map);
  hud.setBackend(view.backend);
  window.__shanhe = { backend: view.backend, state };
} catch (error) {
  hud.setRendererError(error instanceof Error ? error.message : String(error));
  throw error;
}
