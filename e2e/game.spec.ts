/**
 * Whole games in headless Chromium, driven through the page and
 * `window.__shanhe`. Nothing here waits for frames: software rendering is
 * slow, and the game must not depend on it.
 *
 * Set `SHANHE_CAPTURE_DIR` to a folder outside the repository to also save
 * screenshots of the start screen, the HUD, the city panel and the end screen.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__shanhe !== undefined, undefined, { timeout: 150_000 });
}

async function capture(page: Page, name: string): Promise<void> {
  if (captureDir === undefined) return;
  // let the renderer draw the new scene first; only the pictures need this
  const frames = await page.evaluate(() => window.__shanhe?.render.stats.frames ?? 0);
  await page.waitForFunction((wanted) => (window.__shanhe?.render.stats.frames ?? 0) >= wanted, frames + 3, {
    timeout: 60_000,
  });
  await page.screenshot({ path: path.join(captureDir, `${name}.png`) });
}

test('an observer game on the fixture map runs to its end', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture');
  await expect(page.locator('#start')).toBeVisible();
  expect(await page.evaluate(() => window.__shanhe?.ui.screen)).toBe('start');
  await capture(page, 'start');

  await page.evaluate(() => window.__shanhe?.startGame({ observe: true, seed: 1, map: 'fixture' }));
  const started = await page.evaluate(() => {
    const shanhe = window.__shanhe;
    if (shanhe === undefined) throw new Error('window.__shanhe is not set');
    return { ui: shanhe.ui, player: shanhe.state.player, hexes: shanhe.state.map.width * shanhe.state.map.height };
  });
  expect(started.ui.screen).toBe('game');
  expect(started.ui.map).toBe('fixture');
  expect(started.ui.observer).not.toBeNull();
  expect(started.player).toBe(-1);
  expect(started.hexes).toBe(28 * 18);
  await expect(page.locator('#observer-badge')).toBeVisible();
  await expect(page.locator('#speed')).toBeVisible();

  const report = await page.evaluate(() => window.__shanhe?.runTurns(400));
  if (report === undefined) throw new Error('runTurns returned nothing');
  console.log(
    `fixture observer game: ${report.turns} turns in ${report.ms.toFixed(0)} ms, ` +
      `longest turn ${report.longestTurnMs.toFixed(1)} ms, result ${JSON.stringify(report.result)}`,
  );
  expect(report.result).not.toBeNull();
  expect(report.turns).toBeGreaterThan(0);
  // the turns were played off the page's thread
  expect(page.workers().length).toBeGreaterThan(0);
  // and nothing was drawn meanwhile: the renderer is back on afterwards
  expect(await page.evaluate(() => window.__shanhe?.render.renderer.paused)).toBe(false);

  const ended = await page.evaluate(() => {
    const shanhe = window.__shanhe;
    if (shanhe === undefined) throw new Error('window.__shanhe is not set');
    return { ui: shanhe.ui, result: shanhe.state.result };
  });
  expect(ended.result).toEqual(report.result);
  expect(ended.ui.screen).toBe('end');
  await expect(page.locator('#end')).toBeVisible();
  await expect(page.locator('#end-result')).toHaveAttribute('data-winner', String(report.result?.winner));
  expect(await page.locator('#ranking tbody tr').count()).toBeGreaterThan(1);
  await expect(page.locator('#ranking tbody tr').first()).toHaveClass(/winner/);
  await capture(page, 'end');

  await page.click('#new-game');
  await expect(page.locator('#start')).toBeVisible();
  expect(await page.evaluate(() => window.__shanhe?.ui.screen)).toBe('start');
  expect(errors).toEqual([]);
});

test('a player game advances five turns on Enter and is autosaved', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture');
  await page.click('[data-nation="jia"]');
  await page.click('#play');
  await expect(page.locator('#topbar')).toBeVisible();
  await expect(page.locator('#player-nation')).toHaveText('甲国');
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', '1');
  await expect(page.locator('#slot-research')).toBeVisible();
  await expect(page.locator('#minimap canvas')).toBeVisible();

  // Enter is the main button. It ends the turn only when nothing is pending,
  // so a city without a project gets one and an idle unit is put to sleep.
  const turnOf = (): Promise<number> => page.evaluate(() => window.__shanhe?.state.turn ?? 0);
  const main = (): Promise<string> => page.evaluate(() => window.__shanhe?.ui.mainButton.kind ?? 'none');
  for (let step = 0; (await turnOf()) < 6; step++) {
    expect(step, 'the main button never offered the next turn').toBeLessThan(80);
    const kind = await main();
    if (kind === 'city') {
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.__shanhe?.ui.panel)).toBe('city');
      await expect(page.locator('#city-panel')).toBeVisible();
      await capture(page, 'city');
      await page.click('#city-panel [data-build="unit:warrior"]');
      await page.click('#city-panel [data-build="unit:warrior"]');
      await expect(page.locator('#city-queue li')).toHaveCount(2);
      // with a project in the queue nothing is pending any more
      expect(await main()).toBe('nextTurn');
    } else if (kind === 'unit') {
      await page.keyboard.press('Enter');
      await page.click('#selection [data-action="sleep"]');
    } else {
      expect(kind).toBe('nextTurn');
      await expect(page.locator('#main-action')).toHaveAttribute('data-kind', 'nextTurn');
      const before = await turnOf();
      await page.keyboard.press('Enter');
      await page.waitForFunction(
        (turn) => {
          const shanhe = window.__shanhe;
          return shanhe !== undefined && shanhe.state.turn > turn && !shanhe.ui.busy;
        },
        before,
        { timeout: 60_000 },
      );
      expect(await turnOf()).toBe(before + 1);
    }
  }
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', '6');
  await expect(page.locator('#turn-counter')).toContainText('6');

  // the warrior queued on turn 1 is there now and asks for orders
  expect(await main()).toBe('unit');
  await expect(page.locator('#main-action')).toHaveText('待命：勇士');
  await page.keyboard.press('Enter');
  const warrior = await page.evaluate(() => {
    const shanhe = window.__shanhe;
    const id = shanhe?.ui.selectedUnit ?? null;
    return shanhe?.state.units.find((unit) => unit.id === id) ?? null;
  });
  expect(warrior).toMatchObject({ type: 'warrior', owner: 0, status: 'ready' });
  await expect(page.locator('#selection')).toBeVisible();
  await expect(page.locator('#unit-name')).toHaveText('勇士');
  await capture(page, 'hud');
  await page.click('#selection [data-action="fortify"]');
  expect(
    await page.evaluate((id) => window.__shanhe?.state.units.find((unit) => unit.id === id)?.status, warrior?.id),
  ).toBe('fortified');
  expect(await main()).toBe('nextTurn');

  // the language switch in the menu reaches the HUD
  await page.click('#menu-button');
  await page.click('#menu-language');
  await expect(page.locator('#turn-counter')).toHaveText('Turn 6 / 150');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await page.click('#menu-close');

  // the autosave brings the game back after a reload
  await open(page, '/?map=fixture');
  await expect(page.locator('#continue')).toBeVisible();
  await page.click('#continue');
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', '6');
  expect(await page.evaluate(() => window.__shanhe?.state.player)).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * Acceptance check of issue #9, not part of the regular run: it is the only
 * flow on the real map. `SHANHE_REAL_MAP=1` turns it on. The page draws
 * nothing (`?render=off`), so the time is the game's own.
 */
test('an observer game on the real map ends within 150 turns', async ({ page }) => {
  test.skip(process.env.SHANHE_REAL_MAP !== '1', 'set SHANHE_REAL_MAP=1 to run the real-map game');
  const errors = collectErrors(page);
  await open(page, '/?render=off');
  expect(await page.evaluate(() => window.__shanhe?.ui.map)).toBe('file');
  expect(await page.evaluate(() => window.__shanhe?.render.renderer.paused)).toBe(true);
  await page.evaluate(() => window.__shanhe?.startGame({ observe: true, seed: 1 }));
  const report = await page.evaluate(() => window.__shanhe?.runTurns(150));
  if (report === undefined) throw new Error('runTurns returned nothing');
  console.log(
    `real map observer game: ${report.turns} turns in ${(report.ms / 1000).toFixed(1)} s wall-clock, ` +
      `longest turn ${report.longestTurnMs.toFixed(1)} ms, result ${JSON.stringify(report.result)}`,
  );
  expect(report.result).not.toBeNull();
  expect(report.turns).toBeLessThanOrEqual(150);
  await expect(page.locator('#end')).toBeVisible();
  expect(await page.evaluate(() => window.__shanhe?.render.stats.frames)).toBe(0);
  expect(errors).toEqual([]);
});
