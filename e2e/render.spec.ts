/**
 * Smoke tests in headless Chromium: the render demo and the default page
 * must start without any console error and keep rendering frames. The demo
 * also plays a move and a melee animation to their end and turns into the
 * political map at the far zoom.
 *
 * Set `SHANHE_CAPTURE_DIR` to a folder outside the repository to also save
 * screenshots of the demo at the near, the middle and the political zoom
 * and in the middle of both animations.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const MIN_FRAMES = 30;
const captureDir = process.env.SHANHE_CAPTURE_DIR;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`page: ${error.message}`);
  });
  return errors;
}

async function waitForFrames(page: Page, frames: number): Promise<void> {
  await page.waitForFunction(
    (wanted) => (window.__shanhe?.render.stats.frames ?? 0) >= wanted,
    frames,
    { timeout: 150_000 },
  );
}

test('the render demo draws frames without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?demo=render');
  await waitForFrames(page, MIN_FRAMES);

  const report = await page.evaluate(() => {
    const shanhe = window.__shanhe;
    if (shanhe === undefined) throw new Error('window.__shanhe is not set');
    const canvas = document.querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    const bounds = canvas.getBoundingClientRect();
    return {
      backend: shanhe.backend,
      stats: shanhe.render.stats,
      camera: shanhe.render.camera,
      hexes: shanhe.state.map.width * shanhe.state.map.height,
      centreHex: shanhe.render.pickHex(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
      outsideHex: shanhe.render.pickHex(bounds.left - 10, bounds.top - 10),
      readout: document.querySelector('#frame-time')?.textContent ?? null,
    };
  });
  console.log(
    `backend ${report.backend}, ${report.stats.frames} frames, ` +
      `${report.stats.frameMs.toFixed(1)} ms per frame (${report.stats.cpuMs.toFixed(1)} ms in the frame callback), ` +
      `${report.stats.drawCalls} draw calls, ${report.stats.triangles} triangles`,
  );

  expect(report.stats.frames).toBeGreaterThanOrEqual(MIN_FRAMES);
  expect(report.stats.drawCalls).toBeGreaterThan(0);
  expect(report.stats.triangles).toBeGreaterThan(0);
  expect(['webgpu', 'webgl']).toContain(report.backend);
  // the camera starts on the map, so the centre of the view is a hex
  expect(report.centreHex).not.toBeNull();
  expect(report.centreHex).toBeGreaterThanOrEqual(0);
  expect(report.centreHex).toBeLessThan(report.hexes);
  expect(report.outsideHex).toBeNull();
  expect(report.camera.distance).toBeGreaterThan(0);
  expect(report.readout).toMatch(/^\d+(\.\d)? ms$/);

  // the page opens on whole provinces, drawn as terrain
  expect(report.stats.politicalMap).toBe(false);
  expect(report.stats.political).toBe(0);
  expect(report.stats.renderScale).toBeGreaterThan(0);
  expect(report.stats.renderScale).toBeLessThanOrEqual(1);

  const capture = async (name: string): Promise<void> => {
    if (captureDir !== undefined) await page.screenshot({ path: path.join(captureDir, `${name}.png`) });
  };
  /** Waits until the camera has stopped and a few more frames are drawn. */
  const settle = async (): Promise<void> => {
    let last = '';
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() => JSON.stringify(window.__shanhe?.render.camera));
          const still = now === last;
          last = now;
          return still;
        },
        { timeout: 60_000, intervals: [600] },
      )
      .toBe(true);
    const frames = await page.evaluate(() => window.__shanhe?.render.stats.frames ?? 0);
    await waitForFrames(page, frames + 3);
  };

  // the animations are only shown for hexes in view: look at the demo's actors first
  await page.click('#demo-zoom-near');
  await settle();
  const stageHex = Number(await page.getAttribute('#demo-controls', 'data-stage-hex'));
  expect(Number.isInteger(stageHex)).toBe(true);
  expect(report.camera.distance).toBeGreaterThan((await page.evaluate(() => window.__shanhe?.render.camera.distance)) ?? Infinity);
  await capture('near');

  /** Plays one of the demo's animations to its end. Returns how long it ran, in milliseconds. */
  const play = async (button: string, name: string): Promise<number> => {
    const played = Number(await page.getAttribute('#demo-controls', 'data-played'));
    if (captureDir !== undefined) {
      // slowly, so that the capture catches it under way
      await page.evaluate(() => window.__shanhe?.render.renderer.setAnimationSpeed(0.12));
    }
    const started = Date.now();
    await page.click(button);
    await page.waitForFunction(() => window.__shanhe?.render.stats.animating === true, null, { timeout: 30_000 });
    if (captureDir !== undefined) {
      await page.waitForTimeout(2500);
      await capture(name);
      await page.evaluate(() => window.__shanhe?.render.renderer.setAnimationSpeed(1));
    }
    await page.waitForFunction(
      (before) => Number(document.querySelector<HTMLElement>('#demo-controls')?.dataset.played) > before,
      played,
      { timeout: 60_000 },
    );
    const elapsed = Date.now() - started;
    expect(await page.evaluate(() => window.__shanhe?.render.stats.animating)).toBe(false);
    return elapsed;
  };
  // a move over three hexes takes 0.9 s and a melee attack 0.55 s: neither ends at once
  const moveMs = await play('#demo-move', 'move');
  expect(moveMs).toBeGreaterThan(600);
  const meleeMs = await play('#demo-melee', 'melee');
  expect(meleeMs).toBeGreaterThan(350);
  console.log(`move animation ${moveMs} ms, melee animation ${meleeMs} ms`);

  await page.click('#demo-zoom-middle');
  await settle();
  await capture('middle');

  // at the far zoom the view is the political map
  await page.click('#demo-zoom-political');
  await page.waitForFunction(() => window.__shanhe?.render.stats.politicalMap === true, null, { timeout: 60_000 });
  await settle();
  const far = await page.evaluate(() => window.__shanhe?.render.stats);
  expect(far?.political).toBe(1);
  expect(far?.politicalMap).toBe(true);
  // the names of the polities, none of them overlapping
  expect(far?.labels).toBeGreaterThan(0);
  console.log(`political map: ${far?.labels} labels, ${far?.drawCalls} draw calls, ${far?.triangles} triangles`);
  await capture('political');

  expect(errors).toEqual([]);
});

test('the default page draws frames and follows the language switch', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForFrames(page, MIN_FRAMES);
  const before = await page.evaluate(() => window.__shanhe?.render.stats.frames ?? 0);
  await page.click('#language');
  await waitForFrames(page, before + 10);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(errors).toEqual([]);
});
