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

import { readFile } from 'node:fs/promises';
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
  // nor does the observer's HUD show a control that does nothing
  await expect(page.locator('#slots')).toBeHidden();
  await expect(page.locator('#lenses button')).toHaveCount(2);
  await expect(page.locator('#lenses [data-lens="diplomacy"]')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('#game button:disabled')].filter((node) => node.getClientRects().length > 0).length)).toBe(0);
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
  // The game goes on for twelve turns, and then until the capital, with Ritual learned, has taken up a city project.
  const done = { research: 0, unlocked: 0, slotted: 0, routes: 0, offers: 0, enterKept: 0, aids: 0, projects: 0 };
  const capitalOf = (): Promise<{ queue: unknown[]; repeat: boolean }> =>
    page.evaluate(() => {
      const state = window.__shanhe?.state;
      const city = state?.cities[state.polities[state.player]?.capital ?? -1];
      if (city === undefined || city === null) throw new Error('no capital');
      return { queue: [...city.queue], repeat: city.repeat };
    });
  for (let step = 0; (await turnOf()) < 13 || done.projects === 0; step++) {
    expect(step, 'the main button never offered the next turn').toBeLessThan(900);
    expect(await turnOf(), 'the capital never took up a city project').toBeLessThan(60);
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
      const festival = page.locator('#build-conversions [data-build="building:festival"]');
      if ((await festival.count()) === 0) {
        await page.click('#city-panel [data-build="unit:warrior"]');
        await page.click('#city-panel [data-build="unit:warrior"]');
        await expect(page.locator('#city-queue li')).toHaveCount(2);
        await expect(page.locator('#city-panel [data-buy="unit:warrior"]')).toBeVisible();
      } else {
        // Ritual is known. The city projects are a group of their own: what production becomes and at what rate,
        // no cost, nothing to buy
        await expect(festival).toHaveAttribute('data-converts', 'culture');
        await expect(festival).toHaveAttribute('data-percent', '25');
        await expect(festival.locator('.option-cost')).toHaveText('每 4 工 → 1 文');
        await expect(page.locator('#build-buildings [data-build="building:festival"]')).toHaveCount(0);
        await expect(page.locator('#city-panel [data-buy="building:festival"]')).toHaveCount(0);
        // a warrior first, the project behind it: it goes on once the warrior is built
        await page.click('#city-panel [data-build="unit:warrior"]');
        await festival.click();
        const withProject = await capitalOf();
        expect(withProject.queue).toEqual([{ kind: 'unit', unit: 'warrior' }, { kind: 'building', building: 'festival' }]);
        await expect(page.locator('#city-queue li[data-converts="culture"]')).toHaveCount(1);
        await expect(page.locator('#city-queue li[data-converts="culture"] .option-turns')).toHaveCount(0);
        await expect(festival).toBeDisabled();
        // the switch sends setRepeat and shows the city's state
        const repeat = page.locator('#city-repeat');
        await expect(repeat).toHaveAttribute('aria-checked', 'false');
        expect(withProject.repeat).toBe(false);
        await repeat.click();
        expect((await capitalOf()).repeat).toBe(true);
        await expect(repeat).toHaveAttribute('aria-checked', 'true');
        await expect(repeat).toHaveAttribute('data-on', '1');
        await capture(page, 'city-project');
        done.projects++;
      }
      await page.click('#city-close');
      expect(await main()).not.toBe('city');
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
      // Ritual first, for the city project it opens; after it whatever is open
      const ritual = page.locator('#tech-tree .tech[data-tech="ritual"][data-status="open"]');
      const open = (await ritual.count()) > 0 ? ritual : page.locator('#tech-tree .tech[data-status="open"]').first();
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
      // a peace offer is answered in its row: a war has no other control, and no second peace button while the offer waits
      if (kind === 'peace') await expect(page.locator('#polity-controls .control')).toHaveCount(0);
      else await expect(page.locator('#polity-controls .control').first()).toBeVisible();
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
  const reached = await turnOf();
  expect(reached).toBeGreaterThanOrEqual(13);
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', String(reached));
  console.log(`player flow: ${JSON.stringify(done)}, turn ${reached}`);
  // the project and the switch are in the state, and the capital asks for nothing any more
  expect(done.projects).toBe(1);
  const capital = await capitalOf();
  expect(capital.repeat).toBe(true);
  expect(capital.queue.at(-1)).toEqual({ kind: 'building', building: 'festival' });
  expect(await main()).not.toBe('city');
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

  // an overlay holds the focus. Opened from the keyboard, the focus goes into it
  await page.locator('#victory-button').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('polities-button');
  await page.keyboard.press('Enter');
  expect((await ui()).overlay).toBe('polities');
  const inside = (): Promise<boolean> => page.evaluate(() => document.activeElement?.closest('#overlay') !== null);
  expect(await inside()).toBe(true);
  // Tab goes through every control of the overlay and wraps; it never reaches what lies behind
  const controls = await page.locator('#overlay button:not(:disabled)').count();
  expect(controls).toBeGreaterThan(3);
  const visited = new Set<string>();
  for (let press = 0; press < controls + 2; press++) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
    visited.add(
      await page.evaluate(() => {
        const node = document.activeElement;
        return `${node?.id ?? ''}|${node?.closest('tr')?.getAttribute('data-polity') ?? ''}|${node?.getAttribute('data-sort') ?? ''}`;
      }),
    );
  }
  expect(visited.size).toBe(controls);
  await page.keyboard.press('Shift+Tab');
  expect(await inside()).toBe(true);
  // the HUD behind it takes neither the focus nor a press
  const behind = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('#main-action');
    button?.focus();
    const focused = document.activeElement === button;
    button?.click();
    return { focused, inert: [...document.querySelectorAll<HTMLElement>('#game > *')].filter((node) => node.id !== 'overlay' && !node.inert).length };
  });
  expect(behind).toEqual({ focused: false, inert: 0 });
  const held = await page.evaluate(() => ({ turn: window.__shanhe?.state.turn, ui: window.__shanhe?.ui }));
  // nor does Enter reach the main button from an overlay
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => ({ turn: window.__shanhe?.state.turn, ui: window.__shanhe?.ui }))).toEqual(held);
  // Escape closes it, and the focus is back on what opened it
  await page.keyboard.press('Escape');
  expect((await ui()).overlay).toBeNull();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('polities-button');
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#game > *')].filter((node) => node.inert).length)).toBe(0);

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
  await expect(page.locator('#turn-counter')).toHaveText(`Turn ${reached} / 150`);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page.locator('#polities-button')).toHaveText('Nations');
  await page.click('#menu-close');

  // the autosave brings the game back after a reload, and the settings with it
  await open(page, url);
  await expect(page.locator('#continue')).toBeVisible();
  await page.click('#continue');
  await expect(page.locator('#turn-counter')).toHaveAttribute('data-turn', String(reached));
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
  // the AI's bonus leaves science out and its techs cost more: the numbers are the table's
  await expect(page.locator('#level-effect')).toHaveText('AI 主要国家的城市产出 +30%，单位与城市战力 +20%，科研产出不加成，科技花费 +60%');
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

test('observer mode: the camera goes to where a war begins or a city falls, and comes back', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture&render=off');
  await page.evaluate(() => window.__shanhe?.startGame({ observe: true, seed: 1, map: 'fixture' }));
  // paused, so that only this test ends turns
  await page.click('#main-action');
  expect(await page.evaluate(() => window.__shanhe?.ui.observer)).toEqual({ paused: true, speed: 1, watching: null, returns: 0 });
  let watching: number | null = null;
  for (let turn = 0; turn < 150 && watching === null; turn++) {
    watching = await page.evaluate(async () => {
      await window.__shanhe?.endTurn();
      return window.__shanhe?.ui.observer?.watching ?? null;
    });
  }
  expect(watching, 'the game had no war and no fallen city').not.toBeNull();
  // it went to a city: the capital of the polity attacked, or the city that fell
  expect(await page.evaluate((hex) => window.__shanhe?.state.map.zones.some((zone) => zone.siteHex === hex), watching)).toBe(true);
  // nobody touches the camera: after its stay it goes back to the view it left
  await page.waitForFunction(() => window.__shanhe?.ui.observer?.returns === 1);
  expect(await page.evaluate(() => window.__shanhe?.ui.observer?.watching)).toBeNull();
  expect(errors).toEqual([]);
});

test('the main button names a newly built unit before the city that built it', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture&render=off');
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'jia', seed: 3, map: 'fixture' }));
  const look = () =>
    page.evaluate(() => {
      const handle = window.__shanhe;
      if (handle === undefined) throw new Error('window.__shanhe is not set');
      const { state, ui } = handle;
      const mine = state.units.filter((unit) => unit.owner === state.player);
      const idle = mine.filter((unit) => unit.status === 'ready' && unit.moves > 0).map((unit) => unit.id);
      const capital = state.cities[state.polities[state.player]?.capital ?? -1];
      return { main: ui.mainButton.kind, selected: ui.selectedUnit, panel: ui.panel, units: mine.length, idle, queue: capital?.queue.length ?? -1, turn: state.turn };
    });
  // the capital is told to build one warrior, and nothing after it
  expect((await look()).main).toBe('city');
  await page.keyboard.press('Enter');
  await page.click('#city-panel [data-build="unit:warrior"]');
  await page.click('#city-close');
  const before = await look();
  expect(before).toMatchObject({ queue: 1, idle: [] });
  // turns end until the warrior stands there: the turn begins with a unit that has no order and a city without a project
  let now = before;
  for (let turn = 0; turn < 40 && now.units === before.units; turn++) {
    await page.evaluate(() => window.__shanhe?.endTurn());
    await page.waitForFunction((last) => (window.__shanhe?.state.turn ?? 0) > last && window.__shanhe?.ui.busy === false, now.turn);
    now = await look();
  }
  expect(now.units).toBe(before.units + 1);
  expect(now.queue).toBe(0);
  expect(now.idle).toHaveLength(1);
  // nothing was pressed yet: the button names the unit, and nothing is selected by itself
  expect(now).toMatchObject({ main: 'unit', selected: null });
  await expect(page.locator('#main-action')).toHaveAttribute('data-kind', 'unit');
  // one press goes to the unit; only then is the city next
  await page.keyboard.press('Enter');
  expect(await look()).toMatchObject({ selected: now.idle[0], main: 'city', panel: null });
  await page.keyboard.press('Enter');
  expect(await look()).toMatchObject({ selected: null, panel: 'city' });
  // the city gets its project while the unit still waits: the button is back on the unit
  await page.click('#city-panel [data-build="unit:warrior"]');
  expect(await look()).toMatchObject({ main: 'unit', queue: 1 });
  expect(errors).toEqual([]);
});

/** A save as the file holds it, as far as these tests change it. */
interface SaveData {
  turn: number;
  nextId: number;
  offers: Record<string, unknown>[];
  relations: Record<string, { a: number; b: number; atWar: boolean; since: number; offerA: number; offerB: number }>;
  polities: { gold: number }[];
}

/** Exports the game from the menu, lets `change` edit the save, and imports the result through the menu's file input. */
async function reimport(page: Page, change: (save: SaveData) => void): Promise<void> {
  await page.click('#menu-button');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#menu-export')]);
  const save = JSON.parse(await readFile(await download.path(), 'utf8')) as SaveData;
  change(save);
  await page.setInputFiles('#import-file', { name: 'edited.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(save)) });
  await page.waitForFunction((turn) => window.__shanhe?.state.turn === turn && window.__shanhe.ui.panel === null, save.turn);
}

/** The fixture's polities by index. */
const YI = 1;
const DING = 3;

/** Yi proposes open borders; Ding, at war with the player (Jia) for twelve turns, offered peace last turn. */
function withOffers(save: SaveData): void {
  save.turn = Math.max(save.turn, 14);
  save.relations[`0:${DING}`] = { a: 0, b: DING, atWar: true, since: save.turn - 12, offerA: 0, offerB: save.turn - 1 };
  save.offers.push({ id: save.nextId, type: 'agreement', from: YI, to: 0, turn: save.turn, agreement: 'openBorders' });
  save.nextId += 1;
}

test('a game that is imported or continued has a notification for every proposal and peace offer that waits', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture&render=off');
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'jia', seed: 1, map: 'fixture' }));
  const waiting = () =>
    page.evaluate(() => {
      const handle = window.__shanhe;
      if (handle === undefined) throw new Error('window.__shanhe is not set');
      return {
        notifications: handle.ui.notifications,
        kinds: [...document.querySelectorAll<HTMLElement>('#notifications .note')].map((note) => note.dataset.offerKind ?? ''),
        answers: document.querySelectorAll('#notifications .note [data-offer="accept"]').length,
        offers: handle.state.offers.length,
      };
    });
  expect(await waiting()).toEqual({ notifications: 0, kinds: [], answers: 0, offers: 0 });
  await reimport(page, withOffers);
  const imported = { notifications: 2, kinds: ['offer', 'peace'], answers: 2, offers: 1 };
  expect(await waiting()).toEqual(imported);
  // the import was stored: after a reload, Continue brings the game back, and the two notifications with it
  await open(page, '/?map=fixture&render=off');
  await page.click('#continue');
  expect(await page.evaluate(() => window.__shanhe?.ui.screen)).toBe('game');
  expect(await waiting()).toEqual(imported);
  // they answer as the ones the events made: accepting the proposal signs the agreement
  await page.click('#notifications .note[data-offer-kind="offer"] [data-offer="accept"]');
  expect(await page.evaluate(() => window.__shanhe?.state.agreements.filter((entry) => entry.kind === 'openBorders').length)).toBe(1);
  expect((await waiting()).kinds).not.toContain('offer');
  expect(errors).toEqual([]);
});

test('a peace offer is one row of the panel, and a declined one leaves the panel, the notifications and the main button', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture&render=off');
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'jia', seed: 1, map: 'fixture' }));
  await reimport(page, withOffers);
  const atWar = (): Promise<boolean | undefined> => page.evaluate((key) => window.__shanhe?.state.relations[key]?.atWar, `0:${DING}`);
  const kinds = (): Promise<string[]> =>
    page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#notifications .note')].map((note) => note.dataset.offerKind ?? ''));
  await page.click(`#majors .major[data-polity="${DING}"]`);
  expect(await page.evaluate(() => window.__shanhe?.ui.polity)).toBe(DING);
  const row = page.locator('#polity-offers .offer[data-offer="peace"]');
  const peaceButton = page.locator('#polity-controls [data-control="makePeace"]');
  // the offer is answered in its row; nothing else in the panel says "make peace"
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-answer="accept"]')).toBeEnabled();
  await expect(peaceButton).toHaveCount(0);
  await expect(page.locator('#polity-panel').getByText('议和', { exact: true })).toHaveCount(1);
  expect(await kinds()).toEqual(['offer', 'peace']);

  await row.locator('[data-answer="decline"]').click();
  // declined: no row with live buttons, no notification; the war goes on and peace can still be made by its button
  await expect(row).toHaveCount(0);
  await expect(page.locator('#polity-offers')).toHaveCount(0);
  expect(await kinds()).toEqual(['offer']);
  expect(await atWar()).toBe(true);
  await expect(peaceButton).toHaveCount(1);
  await expect(page.locator('#polity-panel').getByText('议和', { exact: true })).toHaveCount(1);
  // the main button goes round everything that waits: the other nation's proposal is among it, the declined offer is not
  await page.click('#polity-close');
  const asked: string[] = [];
  for (let press = 0; press < 12; press++) {
    asked.push(await page.evaluate(() => window.__shanhe?.ui.mainButton.kind ?? ''));
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  }
  expect(asked).toContain('offer');
  expect(asked).not.toContain('peace');
  expect(asked).not.toContain('nextTurn');

  // the same from the notification: the row leaves the panel with it
  await reimport(page, () => undefined);
  await page.click(`#majors .major[data-polity="${DING}"]`);
  await expect(row).toHaveCount(1);
  await page.click('#notifications .note[data-offer-kind="peace"] [data-offer="decline"]');
  await expect(row).toHaveCount(0);
  expect(await kinds()).toEqual(['offer']);
  // and the one button that is left makes the peace
  await expect(peaceButton).toBeEnabled();
  await peaceButton.click();
  expect(await atWar()).toBe(false);
  expect(errors).toEqual([]);
});

/** Points of the page, one for each hex of the list that is on the canvas and under no part of the interface. */
async function hexPoints(page: Page, hexes: readonly number[]): Promise<Record<number, { x: number; y: number }>> {
  return page.evaluate((wanted) => {
    const handle = window.__shanhe;
    if (handle === undefined) throw new Error('window.__shanhe is not set');
    const sums = new Map<number, { x: number; y: number; count: number }>();
    for (let y = 48; y < window.innerHeight - 8; y += 4) {
      for (let x = 8; x < window.innerWidth - 8; x += 4) {
        const hex = handle.render.pickHex(x, y);
        if (hex === null || !wanted.includes(hex) || document.elementFromPoint(x, y)?.id !== 'map') continue;
        const sum = sums.get(hex) ?? { x: 0, y: 0, count: 0 };
        sums.set(hex, { x: sum.x + x, y: sum.y + y, count: sum.count + 1 });
      }
    }
    const points: Record<number, { x: number; y: number }> = {};
    for (const [hex, sum] of sums) {
      const point = { x: Math.round(sum.x / sum.count), y: Math.round(sum.y / sum.count) };
      // the middle of the samples must be the hex itself, on the bare canvas
      if (handle.render.pickHex(point.x, point.y) === hex && document.elementFromPoint(point.x, point.y)?.id === 'map') points[hex] = point;
    }
    return points;
  }, hexes);
}

test('resting the pointer on a hex shows its details, in both languages and with a piece selected', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?map=fixture&render=off');
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'jia', seed: 3, map: 'fixture' }));
  const card = () => page.evaluate(() => window.__shanhe?.ui.card ?? null);
  const setup = await page.evaluate(() => {
    const state = window.__shanhe?.state;
    if (state === undefined) throw new Error('no state');
    const unit = state.units.find((entry) => entry.owner === state.player);
    if (unit === undefined) throw new Error('the player has no unit');
    const zone = state.polities[state.player]?.capital ?? -1;
    const land = state.map.zone.reduce<number[]>((list, value, hex) => (value === zone && hex !== unit.hex ? [...list, hex] : list), []);
    return { unit: { id: unit.id, hex: unit.hex, hp: unit.hp }, zone, site: state.map.zones[zone]?.siteHex ?? -1, land };
  });
  // the garrison stands in the capital: one hex with a piece and a city
  expect(setup.unit.hex).toBe(setup.site);
  const points = await hexPoints(page, [setup.unit.hex, ...setup.land]);
  const onUnit = points[setup.unit.hex];
  const groundHex = setup.land.find((hex) => points[hex] !== undefined);
  if (onUnit === undefined || groundHex === undefined) throw new Error('the capital is not on screen');
  const onGround = points[groundHex] as { x: number; y: number };

  // nothing is selected: the pointer comes to rest on the piece, and the card names it
  expect(await card()).toBeNull();
  await page.mouse.move(onUnit.x, onUnit.y);
  await page.waitForFunction(() => window.__shanhe?.ui.card !== null);
  const first = await card();
  expect(first).toMatchObject({ hex: setup.unit.hex, knowledge: 'visible', units: [setup.unit.id], city: setup.zone, by: 'hover' });
  expect(first?.text).toContain('勇士 · 甲国');
  expect(first?.text).toContain(`生命 ${setup.unit.hp}`);
  expect(first?.text).toContain('甲都 · 甲国');
  await expect(page.locator('#hex-card')).toBeVisible();
  await expect(page.locator('#hex-card [data-line="unit"] .piece')).toHaveText('兵');
  await expect(page.locator('#hex-card [data-line="city"]')).toHaveCount(1);
  expect((await page.evaluate(() => window.__shanhe?.ui.selectedUnit)) ?? null).toBeNull();
  await capture(page, 'card-zh');

  // on bare ground it names the ground and whose land it is
  await page.mouse.move(onGround.x, onGround.y);
  await page.waitForFunction((hex) => window.__shanhe?.ui.card?.hex === hex, groundHex);
  const ground = await card();
  expect(ground).toMatchObject({ units: [], city: null, knowledge: 'visible' });
  expect(ground?.text.split('\n').at(-1)).toBe('甲国');
  await expect(page.locator('#hex-card [data-line="unit"]')).toHaveCount(0);

  // a key or a press takes the card away
  await page.keyboard.press('Shift');
  expect(await card()).toBeNull();
  await expect(page.locator('#hex-card')).toBeHidden();

  // in English the piece keeps its character and the card names it
  await page.click('#menu-button');
  await page.click('#menu-language');
  await page.click('#menu-close');
  await page.mouse.move(onGround.x, onGround.y);
  await page.mouse.move(onUnit.x, onUnit.y);
  await page.waitForFunction((hex) => window.__shanhe?.ui.card?.hex === hex, setup.unit.hex);
  const english = await card();
  expect(english?.text).toContain('Warrior · Jia');
  expect(english?.text).toContain(`HP ${setup.unit.hp}`);
  await expect(page.locator('#hex-card [data-line="unit"] .piece')).toHaveText('兵');
  await capture(page, 'card-en');

  // a turn ends under the pointer: the card stays on its hex and says what is there now
  const turnBefore = await page.evaluate(() => window.__shanhe?.state.turn ?? 0);
  expect(await page.evaluate(() => window.__shanhe?.endTurn())).toBe(true);
  await page.waitForFunction((turn) => (window.__shanhe?.state.turn ?? 0) > turn && window.__shanhe?.ui.busy === false, turnBefore);
  expect(await card()).toMatchObject({ hex: setup.unit.hex, units: [setup.unit.id], by: 'hover' });
  await expect(page.locator('#hex-card')).toBeVisible();

  // with the piece selected the order preview still comes, and the card with it
  await page.mouse.click(onUnit.x, onUnit.y);
  expect(await page.evaluate(() => window.__shanhe?.ui.selectedUnit)).toBe(setup.unit.id);
  expect(await card()).toBeNull();
  await page.mouse.move(onGround.x, onGround.y);
  const aids = await page.evaluate(() => window.__shanhe?.ui.aids);
  expect(aids?.path).toBeGreaterThan(1);
  await expect(page.locator('#tooltip')).toBeVisible();
  await page.waitForFunction((hex) => window.__shanhe?.ui.card?.hex === hex, groundHex);
  await expect(page.locator('#tooltip')).toBeVisible();
  await page.click('#menu-button');
  await page.click('#menu-language');
  expect(errors).toEqual([]);
});

test('touch: a long press shows the details, a tap previews an order and a second tap gives it', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: viewport ?? { width: 960, height: 540 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await open(page, '/?map=fixture&render=off');
  await page.evaluate(() => window.__shanhe?.startGame({ nation: 'jia', seed: 3, map: 'fixture' }));
  const session = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchEnd', point?: { x: number; y: number }): Promise<unknown> =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: point === undefined ? [] : [{ x: point.x, y: point.y, id: 1 }] });
  const snapshot = () =>
    page.evaluate(() => {
      const handle = window.__shanhe;
      if (handle === undefined) throw new Error('window.__shanhe is not set');
      const { ui, state } = handle;
      const unit = state.units.find((entry) => entry.owner === state.player);
      return { selected: ui.selectedUnit, target: ui.touchTarget, orders: ui.touchOrders, aids: ui.aids, card: ui.card, hex: unit?.hex ?? -1, moves: unit?.moves ?? -1 };
    });
  const setup = await page.evaluate(() => {
    const state = window.__shanhe?.state;
    if (state === undefined) throw new Error('no state');
    const unit = state.units.find((entry) => entry.owner === state.player);
    if (unit === undefined) throw new Error('the player has no unit');
    const zone = state.polities[state.player]?.capital ?? -1;
    const land = state.map.zone.reduce<number[]>((list, value, hex) => (value === zone && hex !== unit.hex ? [...list, hex] : list), []);
    return { unit: { id: unit.id, hex: unit.hex }, land };
  });
  const points = await hexPoints(page, [setup.unit.hex, ...setup.land]);
  const onUnit = points[setup.unit.hex];
  const targets = setup.land.filter((hex) => points[hex] !== undefined);
  const [targetHex, otherHex] = targets;
  if (onUnit === undefined || targetHex === undefined || otherHex === undefined) throw new Error('the capital is not on screen');
  const onTarget = points[targetHex] as { x: number; y: number };
  const onOther = points[otherHex] as { x: number; y: number };
  // the pointer events of every touch on the map, in order
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { touchLog: string[] }).touchLog = log;
    const canvas = document.querySelector('#map');
    for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave']) {
      canvas?.addEventListener(name, (event) => log.push(`${name}:${(event as PointerEvent).pointerType}`));
    }
  });
  const events = () => page.evaluate(() => (window as unknown as { touchLog: string[] }).touchLog.splice(0));

  // a finger that rests shows the details; lifting it selects nothing and gives no order
  await touch('touchStart', onUnit);
  await page.waitForFunction(() => window.__shanhe?.ui.card?.by === 'press');
  expect((await snapshot()).card).toMatchObject({ hex: setup.unit.hex, units: [setup.unit.id], by: 'press' });
  await touch('touchEnd');
  expect(await snapshot()).toMatchObject({ selected: null, target: null, orders: 0 });
  await events();

  // a tap selects the piece
  await page.touchscreen.tap(onUnit.x, onUnit.y);
  expect(await snapshot()).toMatchObject({ selected: setup.unit.id, target: null, card: null });
  await events();

  // the first tap on a target previews the order. The finger lifts and leaves the canvas: the target stays
  await page.touchscreen.tap(onTarget.x, onTarget.y);
  expect(await events()).toEqual(['pointerdown:touch', 'pointerup:touch', 'pointerout:touch', 'pointerleave:touch']);
  const previewed = await snapshot();
  expect(previewed).toMatchObject({ selected: setup.unit.id, target: targetHex, orders: 0, hex: setup.unit.hex });
  expect(previewed.aids?.path).toBeGreaterThan(1);
  await expect(page.locator('#tooltip')).toBeVisible();
  await capture(page, 'touch-preview');

  // a tap elsewhere moves the target, and the piece stays where it is
  await page.touchscreen.tap(onOther.x, onOther.y);
  expect(await snapshot()).toMatchObject({ selected: setup.unit.id, target: otherHex, orders: 0, hex: setup.unit.hex });
  await page.touchscreen.tap(onTarget.x, onTarget.y);
  expect(await snapshot()).toMatchObject({ target: targetHex, orders: 0, hex: setup.unit.hex });

  // the second tap on the same hex gives the order
  await page.touchscreen.tap(onTarget.x, onTarget.y);
  const ordered = await snapshot();
  expect(ordered).toMatchObject({ target: null, orders: 1 });
  expect(ordered.hex).not.toBe(setup.unit.hex);
  expect(ordered.moves).toBeLessThan(previewed.moves);
  await expect(page.locator('#tooltip')).toBeHidden();
  await capture(page, 'touch-ordered');

  // on a touch device every control is at least 36 pixels of the screen, whatever the interface is scaled to
  expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
  const tooSmall = (): Promise<string[]> =>
    page.evaluate(() => {
      const found: string[] = [];
      for (const node of document.querySelectorAll<HTMLElement>('#ui button, #ui input[type="range"]')) {
        const box = node.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || node.closest('[inert]') !== null) continue;
        if (box.width < 35.9 || box.height < 35.9) found.push(`${node.id}|${node.className}|${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      return found;
    });
  expect(await page.evaluate(() => window.__shanhe?.ui.scale.factor)).toBeLessThan(1);
  expect(await tooSmall()).toEqual([]);
  await page.locator('#menu-button').tap();
  expect(await page.evaluate(() => window.__shanhe?.ui.panel)).toBe('menu');
  expect(await tooSmall()).toEqual([]);
  await page.locator('#menu-close').tap();
  await page.locator('#polities-button').tap();
  expect(await page.evaluate(() => window.__shanhe?.ui.overlay)).toBe('polities');
  expect(await tooSmall()).toEqual([]);
  await page.locator('#overlay-close').tap();
  await page.locator('#slot-policy').tap();
  expect(await page.evaluate(() => window.__shanhe?.ui.overlay)).toBe('policy');
  expect(await tooSmall()).toEqual([]);
  await page.locator('#overlay-close').tap();
  expect(errors).toEqual([]);
  await context.close();
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
