/** Wires the layers: rules core, renderer and UI. */

import { createGame } from './core/game.ts';
import type { GameState } from './core/game.ts';
import { EMPTY_SCENE, createRenderer } from './render/api.ts';
import type { CameraState, FrameStats, Renderer, RenderScene } from './render/api.ts';
import { attachFrameReadout, createDemoScene } from './render/demo.ts';
import { loadMap } from './render/loadMap.ts';
import { getLanguage } from './shared/i18n.ts';
import type { RenderBackend } from './shared/types.ts';
import { createHud } from './ui/hud.ts';

declare global {
  interface Window {
    /** Handle for automated checks. Set once the renderer has started. */
    __shanhe?: {
      backend: RenderBackend;
      state: GameState;
      render: {
        /** The hex index under a point of the page, or `null`. */
        pickHex(clientX: number, clientY: number): number | null;
        /** The camera state being drawn. */
        readonly camera: CameraState;
        readonly stats: FrameStats;
        /** The whole renderer, for moving the camera and changing the scene. */
        readonly renderer: Renderer;
      };
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#map');
const hudRoot = document.querySelector<HTMLElement>('#hud');
if (canvas === null || hudRoot === null) throw new Error('index.html is missing #map or #hud');

const loaded = await loadMap();
const state = createGame(loaded.map);
const hud = createHud(hudRoot);
hud.setTurn(state.turn);

/** The board of a game: for now, a city on every city site. */
function sceneOf(game: GameState): RenderScene {
  const { map } = game;
  const chinese = getLanguage() === 'zh';
  return {
    ...EMPTY_SCENE,
    cities: map.zones
      .filter((zone) => map.polities[zone.polity]?.kind !== 'wastelandRegion')
      .map((zone) => ({
        hex: zone.siteHex,
        polity: zone.polity,
        population: zone.capital ? 8 : 3,
        name: chinese ? zone.cityNameZh : zone.cityNameEn,
      })),
  };
}

try {
  const renderer = await createRenderer(
    canvas,
    state.map,
    loaded.heightmap === undefined ? {} : { heightmap: loaded.heightmap },
  );
  hud.setBackend(renderer.backend);

  if (new URLSearchParams(window.location.search).get('demo') === 'render') {
    renderer.setScene(createDemoScene(state.map));
    attachFrameReadout(renderer);
  } else {
    renderer.setScene(sceneOf(state));
    // the language switch lives in the HUD; city labels follow it
    hudRoot.addEventListener('click', () => {
      renderer.setScene(sceneOf(state));
    });
  }

  window.__shanhe = {
    backend: renderer.backend,
    state,
    render: {
      pickHex: (clientX, clientY) => renderer.pickHex(clientX, clientY),
      get camera() {
        return renderer.getCamera();
      },
      get stats() {
        return renderer.getStats();
      },
      renderer,
    },
  };
} catch (error) {
  hud.setRendererError(error instanceof Error ? error.message : String(error));
  throw error;
}
