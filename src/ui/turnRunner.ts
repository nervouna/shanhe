/** The {@link TurnRunner} that plays turns in a Web Worker, falling back to the page's own thread if the worker fails. */

import { loadGame, saveGame } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import type { MapData } from '../shared/mapData.ts';
import { createInlineRunner } from './host.ts';
import type { TurnReport, TurnRunner } from './host.ts';
import type { WorkerReply, WorkerRequest } from './turnWorker.ts';

interface Job {
  /** The newest state of the run, to continue from if the worker dies. */
  state: GameState;
  left: number;
  readonly onTurn: (report: TurnReport) => void;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** A runner for games on `map`. */
export function createWorkerRunner(map: MapData): TurnRunner {
  const inline = createInlineRunner();
  const jobs = new Map<number, Job>();
  let nextId = 1;
  let worker: Worker | null = null;

  /** Finishes every open run on this thread. */
  const fallBack = (): void => {
    worker?.terminate();
    worker = null;
    for (const [id, job] of [...jobs]) {
      jobs.delete(id);
      inline.run(job.state, job.left, job.onTurn).then(job.resolve, job.reject);
    }
  };

  try {
    worker = new Worker(new URL('./turnWorker.ts', import.meta.url), { type: 'module' });
    const post = (request: WorkerRequest): void => worker?.postMessage(request);
    post({ type: 'map', map });
    worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      const job = jobs.get(message.id);
      if (job === undefined) return;
      if (message.type === 'turn') {
        job.state = loadGame(message.save, map);
        job.left--;
        job.onTurn({ state: job.state, events: message.events, ms: message.ms });
      } else if (message.type === 'done') {
        jobs.delete(message.id);
        job.resolve();
      } else {
        fallBack();
      }
    });
    worker.addEventListener('error', fallBack);
    worker.addEventListener('messageerror', fallBack);
  } catch {
    worker = null;
  }

  return {
    run(state, turns, onTurn) {
      if (worker === null) return inline.run(state, turns, onTurn);
      const id = nextId++;
      const request: WorkerRequest = { type: 'run', id, save: saveGame(state), turns };
      return new Promise<void>((resolve, reject) => {
        jobs.set(id, { state, left: turns, onTurn, resolve, reject });
        worker?.postMessage(request);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      jobs.clear();
    },
  };
}
