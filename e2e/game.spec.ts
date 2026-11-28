/**
 * Whole games in headless Chromium, driven through the page and
 * `window.__shanhe`. Nothing here waits for frames: software rendering is
 * slow, and the game must not depend on it.
 *
 * Set `SHANHE_CAPTURE_DIR` to a folder outside the repository to also save
 * screenshots of the start screen, the overlays, the panels and the end
 * screen, and `SHANHE_VIEWPORT` (for example `1280x720`) to take them at
 * another window size than the configuration's.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const captureDir = process.env.SHANHE_CAPTURE_DIR;
const viewportSize = /^(\d+)x(\d+)$/.exec(process.env.SHANHE_VIEWPORT ?? '');
const viewport = viewportSize === null ? null : { width: Number(viewportSize[1]), height: Number(viewportSize[2]) };

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
  // an observer sees the whole map: as far out as the renderer lets the camera go
  const distances = await page.evaluate(() => {
    const handle = window.__shanhe;
    const opened = handle?.render.camera.distance ?? 0;
    handle?.render.renderer.setCamera({ distance: 1e9 }, true);
    return { opened, farthest: handle?.render.camera.distance ?? -1 };
  });
  expect(distances.opened).toBeCloseTo(distances.farthest, 3);
  // research and policies are the player's: an observer has neither overlay
  await page.keyboard.press('t');
  expect(await page.evaluate(() => window.__shanhe?.ui.overlay)).toBeNull();
  // the observer's clock redraws the HUD every turn: the click is sent without waiting for the button to stand still
  await page.locator('#victory-button').dispatchEvent('click');
  expect(await page.evaluate(() => window.__shanhe?.ui.overlay)).toBe('victory');
  expect(await page.locator('#victory tbody tr').count()).toBe(3);
  await page.keyboard.press('Escape');

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

test('a player game: research, policies, a trade route, an offer and twelve turns', async ({ page }) => {
  const errors = collectErrors(page);
  if (viewport !== null) await page.setViewportSize(viewport);
  // a long run of small steps: nothing is drawn, unless pictures are wanted (see "Machine load" in CLAUDE.md)
  const url = captureDir === undefined ? '/?map=fixture&render=off' : '/?map=fixture';
  await open(page, url);
  await page.click('[data-nation="jia"]');
  await page.click('#play');
  await expect(page.locator('#topbar')).toBeVisible();
  await expect(page.locator('#player-nation')).toHaveText('甲国');
  // the same game every time: the flow below meets the same offers on the same turns
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'jia', seed: 1, map: 'fixture' }));
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', '1');
  await expect(page.locator('#minimap canvas')).toBeVisible();
  await expect(page.locator('#majors .major')).toHaveCount(4);
  await expect(page.locator('#majors .major[data-standing="self"]')).toHaveCount(1);

  const turnOf = (): Promise<number> => page.evaluate(() => window.__shanhe?.state.turn ?? 0);
  const ui = (): Promise<NonNullable<Window['__shanhe']>['ui']> =>
    page.evaluate(() => {
      const handle = window.__shanhe;
      if (handle === undefined) throw new Error('window.__shanhe is not set');
      return handle.ui;
    });
  /** The player's own polity state. */
  const self = (): Promise<{ research: string | null; policies: string[]; slots: (string | null)[] }> =>
    page.evaluate(() => {
      const state = window.__shanhe?.state;
      const polity = state?.polities[state.player];
      if (polity === undefined) throw new Error('no player');
      return { research: polity.research, policies: [...polity.policies], slots: [...polity.slots] };
    });
  const main = async (): Promise<string> => (await ui()).mainButton.kind;

  // the interface is scaled to the window, and the game opens on the capital, closer than the whole map
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  const scale = Math.round(Math.max(0.8, Math.min(2, Math.min(size.width / 1280, size.height / 720))) * 20) / 20;
  expect((await ui()).scale).toEqual({ setting: 'auto', factor: scale });
  expect(await page.locator('#ui').evaluate((node) => getComputedStyle(node).zoom)).toBe(String(scale));

  // Enter is the main button. It ends the turn only when nothing is pending:
  // every kind of pending item is answered the way a player would.
  const done = { research: 0, unlocked: 0, slotted: 0, routes: 0, offers: 0, enterKept: 0 };
  for (let step = 0; (await turnOf()) < 13; step++) {
    expect(step, 'the main button never offered the next turn').toBeLessThan(300);
    const kind = await main();
    if (kind === 'city') {
      await page.keyboard.press('Enter');
      expect((await ui()).panel).toBe('city');
      await expect(page.locator('#city-panel')).toBeVisible();
      if (done.routes === 0) {
        // the best destination comes first; choosing it previews the path, the button opens the route
        await expect(page.locator('#trade-slots')).toHaveAttribute('data-used', '0');
        const best = page.locator('#trade-picker .option[data-open="1"]').first();
        const key = await best.getAttribute('data-route');
        await best.click();
        expect((await ui()).routePreview).toBe(key);
        await capture(page, 'trade');
        await page.click('#trade-open');
        const routes = await page.evaluate(() => {
          const state = window.__shanhe?.state;
          return (state?.routes ?? []).filter((route) => route.owner === state?.player);
        });
        expect(routes).toHaveLength(1);
        expect(`city:${routes[0]?.toCity}`).toBe(key);
        expect((await ui()).routePreview).toBeNull();
        await expect(page.locator('#trade-slots')).toHaveAttribute('data-used', '1');
        await expect(page.locator('#trade-routes li')).toHaveCount(1);
        done.routes++;
      }
      await page.click('#city-panel [data-build="unit:warrior"]');
      await page.click('#city-panel [data-build="unit:warrior"]');
      await expect(page.locator('#city-queue li')).toHaveCount(2);
      await expect(page.locator('#city-panel [data-buy="unit:warrior"]')).toBeVisible();
      await page.click('#city-close');
    } else if (kind === 'unit') {
      await page.keyboard.press('Enter');
      await expect(page.locator('#selection')).toBeVisible();
      await page.click('#selection [data-action="sleep"]');
    } else if (kind === 'research') {
      await expect(page.locator('#main-action')).toHaveText('选择研究');
      await page.keyboard.press('Enter');
      expect((await ui()).overlay).toBe('tech');
      await expect(page.locator('#tech-overlay')).toBeVisible();
      await expect(page.locator('#tech-tree .tech')).toHaveCount(40);
      if (done.research === 0) await capture(page, 'tech');
      const open = page.locator('#tech-tree .tech[data-status="open"]').first();
      const tech = await open.getAttribute('data-tech');
      await open.click();
      expect((await self()).research).toBe(tech);
      expect((await ui()).overlay).toBeNull();
      done.research++;
    } else if (kind === 'policy') {
      await page.keyboard.press('Enter');
      expect((await ui()).overlay).toBe('policy');
      await expect(page.locator('#policy-overlay')).toBeVisible();
      await expect(page.locator('#policy-cards .policy-card')).toHaveCount(24);
      const open = page.locator('.policy-card[data-status="open"]').first();
      if ((await open.count()) > 0) {
        const card = await open.getAttribute('data-policy');
        await open.click();
        expect((await self()).policies).toContain(card);
        done.unlocked++;
      }
      // an unlocked card goes into the first empty slot
      const unlocked = page.locator('.policy-card[data-status="unlocked"]').first();
      if ((await unlocked.count()) > 0 && (await page.locator('#policy-slots .policy-slot.empty').count()) > 0) {
        const card = await unlocked.getAttribute('data-policy');
        await unlocked.click();
        expect((await self()).slots).toContain(card);
        await expect(page.locator(`#policy-slots [data-card="${card}"]`)).toBeVisible();
        done.slotted++;
      }
      await capture(page, 'policy');
      await page.keyboard.press('Escape');
      expect((await ui()).overlay).toBeNull();
      expect(await main()).not.toBe('policy');
    } else if (kind === 'offer' || kind === 'peace') {
      await page.keyboard.press('Enter');
      expect((await ui()).panel).toBe('polity');
      const from = (await ui()).polity;
      await expect(page.locator('#polity-offers .offer').first()).toBeVisible();
      await expect(page.locator('#polity-controls .control').first()).toBeVisible();
      if (done.offers === 0) await capture(page, 'diplomacy');
      const offer = await page.evaluate(
        (polity) => window.__shanhe?.state.offers.find((entry) => entry.from === polity) ?? null,
        from,
      );
      await page.locator('#polity-offers [data-answer="accept"]').first().click();
      if (kind === 'offer') {
        expect(offer).not.toBeNull();
        expect(await page.evaluate(() => window.__shanhe?.state.offers.map((entry) => entry.id))).not.toContain(offer?.id);
        await expect(page.locator('#polity-favour')).toBeVisible();
        if (offer?.type === 'agreement' && offer.agreement !== 'vassalage') {
          // what was offered is in force, listed with its term, and too young to be ended: the button says why
          const agreement = offer.agreement;
          await expect(page.locator(`#polity-agreements [data-agreement="${agreement}"]`)).toBeVisible();
          const cancel = page.locator(`#polity-controls [data-control="cancel:${agreement}"]`);
          await expect(cancel).toBeDisabled();
          await expect(cancel).toHaveAttribute('data-refused', 'agreementTooYoung');
          await expect(cancel.locator('.reason')).not.toBeEmpty();
        }
      }
      await page.click('#polity-close');
      done.offers++;
    } else {
      expect(kind).toBe('nextTurn');
      await expect(page.locator('#main-action')).toHaveAttribute('data-kind', 'nextTurn');
      const before = await turnOf();
      if (done.enterKept === 0) {
        // two presses in a row: the second comes while the others move, and is applied when they are done
        await page.evaluate(() => {
          for (let i = 0; i < 2; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await page.waitForFunction(() => window.__shanhe?.ui.enterApplied === 1, undefined, { timeout: 60_000 });
        done.enterKept++;
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForFunction(
        (turn) => {
          const handle = window.__shanhe;
          return handle !== undefined && handle.state.turn > turn && !handle.ui.busy;
        },
        before,
        { timeout: 60_000 },
      );
      expect(await turnOf()).toBeGreaterThan(before);
    }
  }
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', '13');
  console.log(`player flow: ${JSON.stringify(done)}`);
  expect(done.research).toBeGreaterThan(0);
  expect(done.routes).toBe(1);
  expect(done.unlocked).toBeGreaterThan(0);
  expect(done.slotted).toBeGreaterThan(0);
  expect(done.offers).toBeGreaterThan(0);
  expect((await ui()).enterApplied).toBe(1);
  // under automation the board shows every change at once: nothing was played
  const played = await page.evaluate(() =>
    Object.values(window.__shanhe?.render.renderer.getAnimationCounts() ?? {}).reduce(
      (sum, count) => sum + count.animated + count.instant,
      0,
    ),
  );
  expect(played).toBe(0);
  expect((await ui()).animating).toBe(false);

  // overlays from the top bar and from the keyboard
  await page.click('#victory-button');
  expect((await ui()).overlay).toBe('victory');
  await expect(page.locator('#victory tbody tr')).toHaveCount(3);
  await capture(page, 'victory');
  await page.keyboard.press('Escape');
  expect((await ui()).overlay).toBeNull();
  await page.click('#polities-button');
  expect((await ui()).overlay).toBe('polities');
  const rows = await page.evaluate(
    () => (window.__shanhe?.state.polities.filter((polity) => polity.alive).length ?? 0) - 1,
  );
  await expect(page.locator('#polities tbody tr')).toHaveCount(rows);
  await page.click('#polities [data-sort="distance"]');
  await expect(page.locator('#polities')).toHaveAttribute('data-sort', 'distance');
  await capture(page, 'polities');
  const nearest = await page.locator('#polities tbody tr').first().getAttribute('data-polity');
  await page.locator('#polities tbody tr').first().click();
  expect((await ui()).overlay).toBeNull();
  expect((await ui()).polity).toBe(Number(nearest));
  await expect(page.locator('#polity-controls [data-control="declareWar"]')).toBeVisible();
  await page.click('#polity-close');
  await page.keyboard.press('t');
  expect((await ui()).overlay).toBe('tech');
  await page.keyboard.press('p');
  expect((await ui()).overlay).toBe('policy');
  await page.keyboard.press('p');
  expect((await ui()).overlay).toBeNull();

  // the lenses of the minimap
  await page.click('#lenses [data-lens="diplomacy"]');
  expect((await ui()).lens).toBe('diplomacy');
  await page.click('#lenses [data-lens="resources"]');
  expect((await ui()).lens).toBe('resources');

  // the menu: interface size and language
  await page.click('#menu-button');
  await page.click('#menu-scale [data-scale="large"]');
  expect((await ui()).scale).toEqual({ setting: 'large', factor: 1.3 });
  expect(await page.locator('#ui').evaluate((node) => getComputedStyle(node).zoom)).toBe('1.3');
  await page.click('#menu-scale [data-scale="small"]');
  expect((await ui()).scale.factor).toBe(0.85);
  await page.click('#menu-language');
  await expect(page.locator('#turn-counter')).toHaveText('Turn 13 / 150');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.locator('#polities-button')).toHaveText('Nations');
  await page.click('#menu-close');

  // the autosave brings the game back after a reload, and the settings with it
  await open(page, url);
  await expect(page.locator('#continue')).toBeVisible();
  await page.click('#continue');
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', '13');
  expect(await page.evaluate(() => window.__shanhe?.state.player)).toBe(0);
  expect((await ui()).scale.setting).toBe('small');
  expect(await page.evaluate(() => window.__shanhe?.state.routes.length)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a player game opens on the capital, framed with its zone', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture');
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'jia', seed: 1, map: 'fixture' }));
  const view = await page.evaluate(() => {
    const handle = window.__shanhe;
    if (handle === undefined) throw new Error('window.__shanhe is not set');
    const { state } = handle;
    const capital = state.map.zones[state.polities[state.player]?.capital ?? -1]?.siteHex ?? -1;
    const { size, originX, originZ } = state.map.projection.hexLayout;
    const col = capital % state.map.width;
    const row = Math.floor(capital / state.map.width);
    const opened = handle.render.camera;
    handle.render.renderer.setCamera({ distance: 1e9 }, true);
    return {
      opened,
      farthest: handle.render.camera.distance,
      // the centre of the capital's hex on the ground
      x: originX + Math.sqrt(3) * size * (col + (row % 2 === 1 ? 0.5 : 0)),
      z: originZ + 1.5 * size * row,
    };
  });
  expect(view.opened.x).toBeCloseTo(view.x, 3);
  expect(view.opened.z).toBeCloseTo(view.z, 3);
  // close enough to show one zone, not the whole map
  expect(view.opened.distance).toBeLessThan(view.farthest * 0.8);
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
