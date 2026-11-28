/**
 * The leak test: memory stays bounded however far the camera travels.
 *
 * A tour of 45 near views that ends at the far view is flown three times,
 * then a new game is started. After each, the memory of live typed arrays
 * (the backing stores V8 reports after a forced garbage collection) must be
 * within 15% of its value after the first tour, and so must the renderer's
 * own count of render objects and geometries.
 *
 * It needs a real GPU, so it is opt-in:
 *
 *     SHANHE_LEAK_TEST=webgpu npm run e2e -- leak
 *     SHANHE_LEAK_TEST=webgl  npm run e2e -- leak
 *
 * `webgl` hides `navigator.gpu`, which puts the renderer on its WebGL 2
 * backend. Both run headless with GPU-backed Chromium.
 *
 * Nothing waits for a moment: every view is held for a number of drawn
 * frames, read from a counter that only grows.
 */

import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

const mode = process.env.SHANHE_LEAK_TEST;
const backend = mode === 'webgl' ? 'webgl' : 'webgpu';

const TOURS = 3;
const VIEWS = 45;
/** The distance of a near view: trees and fine terrain are built around it. */
const NEAR = 14;
/** The far view the tour ends at: everything built for the near views is out of range. */
const FAR = 420;
/** Frames a near view is held for, and the far view at the end of a tour. */
const VIEW_FRAMES = 18;
const REST_FRAMES = 90;
/** Memory after a later tour may exceed the memory after the first by this share. */
const MARGIN = 0.15;

test.skip(mode === undefined || mode === '', 'opt-in: set SHANHE_LEAK_TEST=webgpu or SHANHE_LEAK_TEST=webgl');
test.setTimeout(600_000);
test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    args: [
      '--enable-unsafe-webgpu',
      '--enable-gpu',
      '--use-angle=metal',
      '--enable-features=WebGPU',
      // without the automation flag the page does not cap its frame rate
      '--disable-blink-features=AutomationControlled',
    ],
  },
});

async function drawFrames(page: Page, count: number): Promise<void> {
  const frames = await page.evaluate(() => window.__shanhe?.render.stats.frames ?? 0);
  await page.waitForFunction((wanted) => (window.__shanhe?.render.stats.frames ?? 0) >= wanted, frames + count, {
    timeout: 120_000,
  });
}

/** Megabytes of typed-array memory alive after a forced garbage collection. */
async function liveArrayMemory(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const usage = (await cdp.send('Runtime.getHeapUsage')) as { backingStorageSize?: number };
  if (usage.backingStorageSize === undefined) throw new Error('Runtime.getHeapUsage reports no backingStorageSize');
  return usage.backingStorageSize / 1e6;
}

test('memory stays bounded over three camera tours and a new game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (backend === 'webgl') {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
    });
  }
  await page.goto('/');
  await page.waitForFunction(() => (window.__shanhe?.render.stats.frames ?? 0) > 2, null, { timeout: 150_000 });
  expect(await page.evaluate(() => window.__shanhe?.backend)).toBe(backend);
  const cdp = await page.context().newCDPSession(page);

  // a player's game: nothing moves by itself
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'qi', seed: 3, map: 'real' }));
  const sites = await page.evaluate(
    (views) =>
      (window.__shanhe?.state.map.zones ?? [])
        .filter((_, i) => i % 3 === 0)
        .slice(0, views)
        .map((zone) => zone.siteHex),
    VIEWS,
  );
  expect(sites).toHaveLength(VIEWS);

  const counters = (): Promise<{ renderObjects?: number; geometries?: number; trees: number }> =>
    page.evaluate(() => {
      const stats = window.__shanhe?.render.stats;
      if (stats === undefined) throw new Error('window.__shanhe is not set');
      return { renderObjects: stats.renderObjects, geometries: stats.geometries, trees: stats.trees };
    });

  const memory: number[] = [];
  const objects: (number | undefined)[] = [];
  const geometries: (number | undefined)[] = [];
  let treesSeen = 0;
  const rest = async (label: string): Promise<void> => {
    await page.evaluate((distance) => window.__shanhe?.render.renderer.setCamera({ distance }, true), FAR);
    await drawFrames(page, REST_FRAMES);
    const megabytes = await liveArrayMemory(cdp);
    const live = await counters();
    memory.push(megabytes);
    objects.push(live.renderObjects);
    geometries.push(live.geometries);
    console.log(
      `${backend}: ${label}: ${megabytes.toFixed(1)} MB of live typed arrays, ` +
        `${live.renderObjects ?? '?'} render objects, ${live.geometries ?? '?'} geometries`,
    );
  };

  console.log(`${backend}: before the tours: ${(await liveArrayMemory(cdp)).toFixed(1)} MB of live typed arrays`);
  for (let tour = 1; tour <= TOURS; tour++) {
    for (const hex of sites) {
      await page.evaluate(
        ([h, distance]) => window.__shanhe?.render.renderer.focusHex(h as number, { distance: distance as number, immediate: true }),
        [hex, NEAR],
      );
      await drawFrames(page, VIEW_FRAMES);
      treesSeen = Math.max(treesSeen, (await counters()).trees);
    }
    await rest(`after tour ${tour}`);
  }
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'qi', seed: 4, map: 'real' }));
  await rest('after a new game');

  // the tour did build forests: without them it would prove nothing
  expect(treesSeen).toBeGreaterThan(1000);
  expect(errors).toEqual([]);

  const first = memory[0] as number;
  for (const [index, megabytes] of memory.entries()) {
    expect(megabytes, `memory at measurement ${index + 1} of ${memory.join(', ')} MB`).toBeLessThanOrEqual(first * (1 + MARGIN));
  }
  // what the renderer itself holds is bounded too
  for (const series of [objects, geometries]) {
    const start = series[0];
    expect(start).toBeGreaterThan(0);
    for (const value of series) expect(value).toBeLessThanOrEqual((start as number) * (1 + MARGIN));
  }
});
