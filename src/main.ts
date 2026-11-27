/** Wires the layers: rules core, renderer and UI. */

import type { GameState } from './core/game.ts';
import { createRenderer } from './render/api.ts';
import type { CameraState, FrameStats, Renderer } from './render/api.ts';
import { attachFrameReadout, createDemoScene } from './render/demo.ts';
import { loadMap } from './render/loadMap.ts';
import { setLanguage, t } from './shared/i18n.ts';
import type { RenderBackend } from './shared/types.ts';
import { createApp } from './ui/app.ts';
import type { Board, StartOptions, UiSnapshot } from './ui/app.ts';
import type { RunReport } from './ui/host.ts';
import { loadLanguage } from './ui/language.ts';

declare global {
  interface Window {
    /** Handle for automated checks. Set once the renderer has started. */
    __shanhe?: {
      readonly backend: RenderBackend;
      /** The current game state. Read it; the page never changes a state in place. */
      readonly state: GameState;
      readonly render: {
        /** The hex index under a point of the page, or `null`. */
        pickHex(clientX: number, clientY: number): number | null;
        /** The camera state being drawn. */
        readonly camera: CameraState;
        readonly stats: FrameStats;
        /** The whole renderer, for moving the camera and changing the scene. */
        readonly renderer: Renderer;
      };
      /** What the interface shows: screen, open panel, main button. */
      readonly ui: UiSnapshot;
      /** Starts a new game; without a nation, or with `observe`, in observer mode. */
      startGame(options?: StartOptions): Promise<void>;
      /** Ends the current turn. Resolves to false if no game is running. */
      endTurn(): Promise<boolean>;
      /** Ends up to `turns` turns, stopping at a result; resolves when done. */
      runTurns(turns: number): Promise<RunReport>;
    };
  }
}

const uiRoot = document.querySelector<HTMLElement>('#ui');
if (document.querySelector('#map') === null || uiRoot === null) throw new Error('index.html is missing #map or #ui');

const query = new URLSearchParams(window.location.search);

/** Loads a map and starts a renderer for it on a canvas of its own, which takes the place of the current one. */
async function loadBoard(source: 'file' | 'fixture', previous?: Board): Promise<Board> {
  const loaded = await loadMap(source);
  previous?.renderer.dispose();
  const old = document.querySelector<HTMLCanvasElement>('#map');
  if (old === null) throw new Error('index.html is missing #map');
  // a canvas keeps its graphics context for good, so a new renderer gets a new canvas
  const canvas = previous === undefined ? old : document.createElement('canvas');
  if (canvas !== old) {
    canvas.id = 'map';
    old.replaceWith(canvas);
  }
  const renderer = await createRenderer(
    canvas,
    loaded.map,
    loaded.heightmap === undefined ? {} : { heightmap: loaded.heightmap },
  );
  return { map: loaded.map, source: loaded.source, renderer, canvas };
}

let board: Board;
try {
  board = await loadBoard(query.get('map') === 'fixture' ? 'fixture' : 'file');
} catch (error) {
  setLanguage(loadLanguage());
  uiRoot.className = 'fatal';
  uiRoot.textContent = t('error.renderer', { message: error instanceof Error ? error.message : String(error) });
  throw error;
}
const app = createApp({
  root: uiRoot,
  board,
  loadBoard: (source) => loadBoard(source, board),
  onBoard: (next) => {
    board = next;
  },
});

if (query.get('demo') === 'render') {
  app.hide();
  board.renderer.setScene(createDemoScene(board.map));
  attachFrameReadout(board.renderer);
}

window.__shanhe = {
  get backend() {
    return board.renderer.backend;
  },
  get state() {
    return app.state;
  },
  render: {
    pickHex: (clientX, clientY) => board.renderer.pickHex(clientX, clientY),
    get camera() {
      return board.renderer.getCamera();
    },
    get stats() {
      return board.renderer.getStats();
    },
    get renderer() {
      return board.renderer;
    },
  },
  get ui() {
    return app.ui;
  },
  startGame: (options) => app.startGame(options),
  endTurn: () => app.endTurn(),
  runTurns: (turns) => app.runTurns(turns),
};
