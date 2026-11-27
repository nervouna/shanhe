/**
 * Smoke tests in headless Chromium: the render demo and the default page
 * must start without any console error and keep rendering frames.
 *
 * Set `SHANHE_CAPTURE_DIR` to a folder outside the repository to also save
 * screenshots of the demo at the near and the far zoom.
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

  if (captureDir !== undefined) {
    for (const [name, zoom] of [
      ['near', 0],
      ['far', Infinity],
    ] as const) {
      const before = await page.evaluate((distance) => {
        const render = window.__shanhe?.render;
        if (render === undefined) throw new Error('window.__shanhe is not set');
        render.renderer.setCamera({ distance }, true);
        return render.stats.frames;
      }, zoom);
      await waitForFrames(page, before + 20);
      await page.screenshot({ path: path.join(captureDir, `${name}.png`) });
    }
  }

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
