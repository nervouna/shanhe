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
  // the observer sees everything: no fog, and every unit of the state is on the board
  const watched = await page.evaluate(() => {
    const handle = window.__shanhe;
    if (handle === undefined) throw new Error('window.__shanhe is not set');
    return { fog: handle.ui.fog, units: handle.state.units.length, level: handle.state.difficulty };
  });
  expect(watched.units).toBeGreaterThan(0);
  expect(watched.fog).toEqual({ on: false, hiddenUnits: 0, foreignUnits: watched.units });
  expect(watched.level).toBe('standard');
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
  // the observer's clock redraws the HUD every turn, but the buttons of the top bar and the speed
  // control are not rebuilt: they are the same nodes turns later, and an ordinary click lands on them
  await page.evaluate(() => {
    for (const id of ['#victory-button', '#polities-button', '#menu-button', '#speed [data-speed="2"]']) {
      const node = document.querySelector<HTMLElement>(id);
      if (node === null) throw new Error(`${id} is missing`);
      node.dataset.kept = '1';
    }
  });
  expect((await page.evaluate(() => window.__shanhe?.runTurns(3)))?.turns).toBe(3);
  for (const id of ['#victory-button', '#polities-button', '#menu-button', '#speed [data-speed="2"]']) {
    await expect(page.locator(id)).toHaveAttribute('data-kept', '1');
  }
  await page.click('#victory-button');
  expect(await page.evaluate(() => window.__shanhe?.ui.overlay)).toBe('victory');
  expect(await page.locator('#victory tbody tr').count()).toBe(3);
  // the balance of power lists every nation in the race
  const rated = await page.evaluate(() => {
    const state = window.__shanhe?.state;
    return (state?.majors ?? []).filter((polity) => state?.polities[polity]?.alive === true).length;
  });
  expect(rated).toBeGreaterThan(0);
  expect(await page.locator('#balance tbody tr[data-fear]').count()).toBe(rated);
  await page.keyboard.press('Escape');
  await page.click('#speed [data-speed="2"]');
  expect(await page.evaluate(() => window.__shanhe?.ui.observer?.speed)).toBe(2);
  // the menu stays put under the observer's clock too: its controls take ordinary clicks
  await page.click('#menu-button');
  await page.click('#menu-quality [data-quality="medium"]');
  expect(await page.evaluate(() => window.__shanhe?.ui.settings.quality)).toBe('medium');
  await page.click('#menu-quality [data-quality="auto"]');
  await page.click('#menu-close');
  expect(await page.evaluate(() => window.__shanhe?.ui.panel)).toBeNull();
  // nothing sounds under automation: the engine never starts
  expect(await page.evaluate(() => window.__shanhe?.ui.sound)).toMatchObject({ silent: true, unlocked: false });

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

  // fog of war: the board has fewer foreign units than the state, and the difference is what the fog hides
  const sight = await page.evaluate(() => {
    const handle = window.__shanhe;
    if (handle === undefined) throw new Error('window.__shanhe is not set');
    const { state } = handle;
    return { fog: handle.ui.fog, foreign: state.units.filter((unit) => unit.owner !== state.player).length, level: state.difficulty };
  });
  expect(sight.fog.on).toBe(true);
  expect(sight.fog.foreignUnits).toBeLessThan(sight.foreign);
  expect(sight.fog.hiddenUnits).toBe(sight.foreign - sight.fog.foreignUnits);
  // a game started without a word about difficulty is at the middle level
  expect(sight.level).toBe('standard');

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

  // the supply in the top bar: the player's fighting units against what its cities keep
  const supply = await page.locator('#stat-supply').evaluate((node) => ({
    used: Number(node.dataset.used),
    limit: Number(node.dataset.limit),
    surcharge: Number(node.dataset.surcharge),
    units: window.__shanhe?.state.units.filter((unit) => unit.owner === window.__shanhe?.state.player).length ?? -1,
  }));
  expect(supply.limit).toBeGreaterThan(0);
  expect(supply.used).toBeGreaterThan(0);
  expect(supply.used).toBeLessThanOrEqual(supply.units);
  expect(supply.surcharge > 0).toBe(supply.used > supply.limit);

  // Enter is the main button. It ends the turn only when nothing is pending:
  // every kind of pending item is answered the way a player would.
  const done = { research: 0, unlocked: 0, slotted: 0, routes: 0, offers: 0, enterKept: 0, aids: 0 };
  for (let step = 0; (await turnOf()) < 13; step++) {
    expect(step, 'the main button never offered the next turn').toBeLessThan(300);
    const kind = await main();
    if (kind === 'city') {
      await page.keyboard.press('Enter');
      expect((await ui()).panel).toBe('city');
      await expect(page.locator('#city-panel')).toBeVisible();
      if (done.routes === 0) {
        // the first city is the capital: its panel lists what the seat adds
        await expect(page.locator('#city-capital [data-yield]')).toHaveCount(2);
        await expect(page.locator('#city-capital [data-yield="gold"]')).toHaveAttribute('data-percent', '50');
        await expect(page.locator('#city-capital [data-yield="science"]')).toHaveAttribute('data-percent', '50');
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
      // the reach of the selected piece goes to the renderer as selection aids
      const aids = (await ui()).aids;
      expect(aids).not.toBeNull();
      expect(aids?.reachable ?? 0).toBeGreaterThan(0);
      done.aids++;
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
  expect(done.aids).toBeGreaterThan(0);
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
  const inRace = await page.evaluate(() => {
    const state = window.__shanhe?.state;
    const listed = new Set([...(state?.majors ?? []), state?.player ?? -1]);
    return [...listed].filter((polity) => state?.polities[polity]?.alive === true).length;
  });
  await expect(page.locator('#balance tbody tr[data-fear]')).toHaveCount(inRace);
  await expect(page.locator('#balance tbody tr.mine')).toHaveCount(1);
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
  // a card can be taken out of its slot; the slot then waits for nothing
  const filled = (await self()).slots.findIndex((card) => card !== null);
  expect(filled).toBeGreaterThanOrEqual(0);
  const waiting = await main();
  await page.click(`#policy-slots [data-clear="${filled}"]`);
  expect((await self()).slots[filled]).toBeNull();
  await expect(page.locator(`#policy-slots .policy-slot[data-slot="${filled}"]`)).toHaveClass(/empty/);
  await page.keyboard.press('p');
  expect((await ui()).overlay).toBeNull();
  // unless a card was waiting to be unlocked anyway, the emptied slot asks for nothing
  console.log(`policies before the slot was emptied: main button "${waiting}"`);
  if (waiting !== 'policy') expect(await main()).not.toBe('policy');
  // the keyboard reaches every control: Tab moves the focus, and Enter then presses what has it, not the main button
  await page.locator('#victory-button').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('menu-button');
  await page.keyboard.press('Enter');
  expect((await ui()).panel).toBe('menu');
  await page.keyboard.press('Escape');
  expect((await ui()).panel).toBeNull();

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

test('nation select shows a kit, a unique unit is in the build menu, and the settings survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  if (viewport !== null) await page.setViewportSize(viewport);
  // the kits belong to the nations of the real map; nothing is drawn, unless pictures are wanted
  const url = captureDir === undefined ? '/?render=off' : '/';
  await open(page, url);
  const ui = (): Promise<NonNullable<Window['__shanhe']>['ui']> =>
    page.evaluate(() => {
      const handle = window.__shanhe;
      if (handle === undefined) throw new Error('window.__shanhe is not set');
      return handle.ui;
    });

  // nation select: 50 nations, the 12 default majors marked, no kit until one is highlighted
  const before = await ui();
  expect(before.start).toMatchObject({ region: 'all', sort: 'region', chosen: null });
  expect(before.start?.nations).toHaveLength(50);
  expect(before.kit).toBeNull();
  expect(before.sound).toMatchObject({ silent: true, unlocked: false });
  await expect(page.locator('#nations .nation')).toHaveCount(50);
  await expect(page.locator('#nations .nation[data-major="1"]')).toHaveCount(12);
  await expect(page.locator('#kit-card')).toHaveCount(0);

  await page.click('[data-nation="qi"]');
  expect((await ui()).kit).toEqual({ nation: 'qi', where: 'start' });
  const card = page.locator('#kit-card');
  await expect(card).toHaveAttribute('data-nation', 'qi');
  await expect(card.locator('[data-kit="trait"] .kit-name')).toHaveText('鱼盐之利');
  // the numbers in the effect texts come from the rules' data
  await expect(card.locator('[data-kit="trait"] .kit-effect')).toHaveText(/^近海格与滨水陆地格金 \+\d+$/);
  await expect(card.locator('[data-kit="leader"] .kit-name')).toContainText('仲父');
  await expect(card.locator('[data-kit="leader"] .kit-name')).toContainText('管仲');
  await expect(card.locator('[data-kit="leader"] .kit-effect')).toHaveText(/^每座市集金 \+\d+$/);
  await expect(card.locator('[data-kit="unit"] .kit-name')).toContainText('技击士');
  await expect(card.locator('[data-kit="unit"] .piece')).toHaveText('技');
  await expect(card.locator('[data-kit="building"] .kit-name')).toContainText('稷下学宫');
  await expect(card.locator('[data-kit="specialty"] .kit-name')).toHaveText('海盐');
  await expect(card.locator('.difficulty')).toHaveAttribute('data-difficulty', /^(easy|normal|hard|veryHard)$/);
  await capture(page, 'kit-start');

  // filter by region, sort by difficulty
  await page.click('#regions [data-region="north"]');
  expect((await ui()).start).toMatchObject({ region: 'north', chosen: 'qi' });
  await expect(page.locator('#nations .nation')).toHaveCount(8);
  await page.click('#regions [data-region="all"]');
  await page.click('#nation-sort [data-sort="hard"]');
  const order = ['easy', 'normal', 'hard', 'veryHard'];
  const ranks = await page
    .locator('#nations .nation')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.difficulty ?? ''));
  expect(ranks).toHaveLength(50);
  for (let i = 1; i < ranks.length; i++) {
    expect(order.indexOf(ranks[i] ?? '')).toBeLessThanOrEqual(order.indexOf(ranks[i - 1] ?? ''));
  }
  expect((await ui()).start?.sort).toBe('hard');
  // the other language
  await page.click('#language');
  await expect(card.locator('[data-kit="trait"] .kit-name')).toHaveText('Fish and Salt');
  await expect(card.locator('[data-kit="unit"] .kit-name')).toContainText('Jiji infantry');
  await page.click('#language');

  // the difficulty picker: five levels, the middle one chosen, each described by what it changes
  await expect(page.locator('#level-picker button')).toHaveCount(5);
  await expect(page.locator('#level-picker')).toHaveAttribute('data-value', 'standard');
  await expect(page.locator('#level-picker [data-level="standard"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await ui()).start?.difficulty).toBe('standard');
  await expect(page.locator('#level-effect')).not.toHaveText(/\d/);
  await page.click('#level-picker [data-level="severe"]');
  expect((await ui()).start?.difficulty).toBe('severe');
  await expect(page.locator('#level-picker [data-level="severe"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#level-effect')).toHaveText(/AI.*\+30%.*\+20%/);
  await capture(page, 'difficulty');

  // play 齐, whose unique unit is of the Ancient era: it is the garrison, and the build menu names it
  await page.click('#play');
  await expect(page.locator('#player-nation')).toHaveText('齐');
  // a game started at the hardest level carries it in its state
  expect(await page.evaluate(() => window.__shanhe?.state.difficulty)).toBe('severe');
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'qi', seed: 1 }));
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', '1');
  expect(await page.evaluate(() => window.__shanhe?.state.difficulty)).toBe('severe');
  expect((await ui()).fog).toMatchObject({ on: true });
  expect((await ui()).fog.hiddenUnits).toBeGreaterThan(0);
  expect((await ui()).kit).toBeNull();
  const garrison = await page.evaluate(() => {
    const state = window.__shanhe?.state;
    return (state?.units ?? []).filter((unit) => unit.owner === state?.player).map((unit) => unit.type);
  });
  expect(garrison).toContain('jijiInfantry');

  // the nation's name in the top bar opens its kit
  await page.click('#player-nation');
  expect(await ui()).toMatchObject({ panel: 'kit', kit: { nation: 'qi', where: 'own' } });
  await expect(page.locator('#kit-panel')).toHaveAttribute('data-nation', 'qi');
  await expect(page.locator('#kit-panel [data-kit="unit"] .kit-name')).toContainText('技击士');
  await capture(page, 'kit-own');
  await page.keyboard.press('Escape');
  expect((await ui()).panel).toBeNull();

  // the game opens on the capital: a click in the middle of the map selects its garrison and opens the city
  const middle = await page.evaluate(() => {
    const handle = window.__shanhe;
    if (handle === undefined) throw new Error('window.__shanhe is not set');
    const { state } = handle;
    const x = Math.round(window.innerWidth / 2);
    const y = Math.round(window.innerHeight / 2);
    return {
      x,
      y,
      picked: handle.render.pickHex(x, y),
      capital: state.map.zones[state.polities[state.player]?.capital ?? -1]?.siteHex ?? -1,
    };
  });
  expect(middle.picked).toBe(middle.capital);
  await page.mouse.click(middle.x, middle.y);
  expect((await ui()).panel).toBe('city');
  // the unit panel names the unique unit and shows its own character, engraved in gold
  await expect(page.locator('#unit-name')).toHaveText('技击士');
  await expect(page.locator('#selection .piece')).toHaveText('技');
  await expect(page.locator('#selection .piece')).toHaveAttribute('data-unique', '1');
  expect((await ui()).aids?.reachable ?? 0).toBeGreaterThan(0);
  // the build menu: the item is the generic unit's, the name the unique unit's; so in the queue
  const option = page.locator('#city-panel [data-build="unit:warrior"]');
  await expect(option.locator('.option-name')).toHaveText('技击士');
  await expect(page.locator('#city-panel [data-buy="unit:warrior"]')).toBeVisible();
  await option.click();
  await expect(page.locator('#city-queue li .option-name')).toHaveText('技击士');
  await capture(page, 'kit-city');
  await page.click('#city-close');

  // the tech tree is the nation's own: its unique building stands where the academy would
  await page.keyboard.press('t');
  await expect(page.locator('#tech-tree .tech[data-tech="writing"] .unique')).toHaveText('稷下学宫');
  await page.keyboard.press('Escape');

  // another nation's panel shows its kit and how its leader plays
  const yan = await page.evaluate(() => window.__shanhe?.state.map.polities.findIndex((polity) => polity.id === 'yan') ?? -1);
  await page.click(`#majors .major[data-polity="${yan}"]`);
  expect(await ui()).toMatchObject({ panel: 'polity', polity: yan, kit: { nation: 'yan', where: 'polity' } });
  await expect(page.locator('#polity-personality')).toHaveAttribute('data-personality', /^[a-z]+$/);
  // what its leader is out for is hidden from a nation that is neither its ally nor its overlord
  await expect(page.locator('#polity-ambition')).toHaveCount(0);
  await expect(page.locator('#polity-controls [data-control="propose:vassalage"] #vassal-room')).toHaveText('藩属 0/1');
  await expect(page.locator('#polity-kit')).toHaveAttribute('data-nation', 'yan');
  await expect(page.locator('#polity-kit [data-kit="unit"] .kit-name')).toContainText('幽州突骑');
  await page.click('#polity-close');

  // the settings: each control changes its setting, and all of them are there after a reload
  expect((await ui()).settings).toEqual({ quality: 'auto', scale: 'auto', language: 'zh', animationSpeed: 1, volume: 0.6, muted: false });
  await page.click('#menu-button');
  expect((await ui()).panel).toBe('menu');
  await expect(page.locator('#menu-level')).toHaveAttribute('data-level', 'severe');
  await expect(page.locator('#menu-level')).toContainText('严酷');
  await page.click('#menu-quality [data-quality="low"]');
  expect(await page.evaluate(() => window.__shanhe?.render.renderer.quality)).toBe('low');
  await page.click('#menu-speed [data-speed="2"]');
  await page.click('#menu-mute');
  await expect(page.locator('#menu-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#menu-volume').fill('0.25');
  await page.click('#menu-scale [data-scale="large"]');
  await capture(page, 'settings');
  await page.click('#menu-language');
  const changed = { quality: 'low', scale: 'large', language: 'en', animationSpeed: 2, volume: 0.25, muted: true };
  expect((await ui()).settings).toEqual(changed);
  expect((await ui()).sound).toMatchObject({ silent: true, unlocked: false, volume: 0.25, muted: true });
  await expect(page.locator('#menu h3').first()).toHaveText('Difficulty');

  await open(page, url);
  const after = await ui();
  expect(after.settings).toEqual(changed);
  expect(after.scale).toEqual({ setting: 'large', factor: 1.3 });
  expect(await page.evaluate(() => window.__shanhe?.render.renderer.quality)).toBe('low');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.locator('#continue')).toBeVisible();
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
