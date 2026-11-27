/**
 * Web Worker that plays the turns of everybody but the player, so that the
 * page stays responsive. It imports the rules core and `src/shared` only.
 *
 * It gets the map once, then requests to play turns from a saved state, and
 * answers each finished turn with the new save and its events.
 */

import { endTurn, loadGame, saveGame } from '../core/game.ts';
import type { GameEvent } from '../core/game.ts';
import type { MapData } from '../shared/mapData.ts';

export type WorkerRequest =
  | { readonly type: 'map'; readonly map: MapData }
  | { readonly type: 'run'; readonly id: number; readonly save: string; readonly turns: number };

export type WorkerReply =
  | { readonly type: 'turn'; readonly id: number; readonly save: string; readonly events: GameEvent[]; readonly ms: number }
  | { readonly type: 'done'; readonly id: number }
  | { readonly type: 'failed'; readonly id: number; readonly message: string };

let map: MapData | null = null;

function reply(message: WorkerReply): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'map') {
    map = request.map;
    return;
  }
  try {
    if (map === null) throw new Error('the worker has no map yet');
    let state = loadGame(request.save, map);
    for (let i = 0; i < request.turns && state.result === null; i++) {
      const before = performance.now();
      const next = endTurn(state);
      state = next.state;
      reply({
        type: 'turn',
        id: request.id,
        save: saveGame(state),
        events: next.events,
        ms: performance.now() - before,
      });
    }
    reply({ type: 'done', id: request.id });
  } catch (error) {
    reply({ type: 'failed', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
});
