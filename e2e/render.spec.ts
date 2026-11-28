/**
 * Smoke tests in headless Chromium: the render demo and the default page
 * must start without any console error and draw frames. The demo also
 * shows its gallery, switches every effect of the finish and the fog of war,
 * plays a move and a melee animation to their end, which draws the shadow
 * maps of the pieces again, and is the political map, under clouds, at the
 * far zoom.
 *
 * A software renderer on a small machine can take seconds per frame, so
 * nothing here waits for a moment to be caught: the checks read promises,
 * counters that only grow and states that stay. Both tests use the fixture
 * map and a small canvas to keep the frames cheap.
 *
 * Set `SHANHE_CAPTURE_DIR` to a folder outside the repository to also save
 * screenshots of the demo at the near, the middle and the political zoom,
 * of the gallery with and without fog of war, and in the middle of both
 * animations.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 640, height: 360 } });

const MIN_FRAMES = 5;
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

/** Waits until `count` more frames are drawn: what was set before is on screen then. */
async function drawFrames(page: Page, count: number): Promise<void> {
  const frames = await page.evaluate(() => window.__shanhe?.render.stats.frames ?? 0);
  await waitForFrames(page, frames + count);
}

test('the render demo draws frames without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?demo=render&map=fixture');
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

  // the page opens on the ground drawn as terrain
  expect(report.stats.politicalMap).toBe(false);
  expect(report.stats.political).toBe(0);
  expect(report.stats.renderScale).toBeGreaterThan(0);
  expect(report.stats.renderScale).toBeLessThanOrEqual(1);

  const capture = async (name: string): Promise<void> => {
    if (captureDir !== undefined) await page.screenshot({ path: path.join(captureDir, `${name}.png`) });
  };

  // the finish: what runs follows the tier and the backend, and says so
  const finish = await page.evaluate(() => {
    const renderer = window.__shanhe?.render.renderer;
    if (renderer === undefined) throw new Error('window.__shanhe is not set');
    return { quality: renderer.quality, effects: renderer.getEffects(), stats: renderer.getStats() };
  });
  expect(finish.quality).toBe('auto');
  expect(finish.effects.toneMapping).toBe(true);
  expect(finish.effects.tiltShift).toBe(true);
  expect(finish.effects.antialiasing).toBe(true);
  // ambient occlusion and bloom switch themselves off on the WebGL fallback
  expect(finish.effects.ambientOcclusion).toBe(report.backend === 'webgpu');
  expect(finish.effects.bloom).toBe(report.backend === 'webgpu');
  // the shadow cascades have been drawn: per cascade a map of the ground and one of the pieces
  expect(finish.stats.pieceShadowDraws).toBeGreaterThanOrEqual(2);
  expect(finish.stats.shadowDraws).toBeGreaterThanOrEqual(finish.stats.pieceShadowDraws + 2);
  expect(finish.stats.shadowTriangles).toBeGreaterThanOrEqual(0);
  expect(finish.stats.shadowTriangles).toBeLessThanOrEqual(finish.stats.triangles);
  expect(finish.stats.trees).toBeGreaterThanOrEqual(0);

  // the gallery: a city of every family in every era, pieces, improvements, roads and routes
  const gallery = JSON.parse((await page.getAttribute('#demo-controls', 'data-gallery')) ?? 'null') as {
    cities: number;
    firstCity: number | null;
    units: number;
    improvements: number;
    roads: number;
    routes: number;
  } | null;
  expect(gallery).not.toBeNull();
  expect(gallery?.cities).toBe(42);
  expect(gallery?.units).toBe(12);
  expect(gallery?.improvements).toBeGreaterThanOrEqual(12);
  expect(gallery?.roads).toBeGreaterThan(0);
  expect(gallery?.routes).toBeGreaterThanOrEqual(2);

  // every effect has a switch: it turns the effect off and on again, except where the backend keeps it off
  const effectsShown = async (): Promise<Record<string, boolean>> =>
    JSON.parse((await page.getAttribute('#demo-controls', 'data-effects')) ?? '{}') as Record<string, boolean>;
  expect(await effectsShown()).toEqual(finish.effects);
  for (const effect of ['ambientOcclusion', 'tiltShift', 'bloom', 'toneMapping', 'antialiasing'] as const) {
    const before = finish.effects[effect];
    await page.click(`#demo-fx-${effect}`);
    const carried = report.backend === 'webgpu' || (effect !== 'ambientOcclusion' && effect !== 'bloom');
    expect((await effectsShown())[effect]).toBe(carried ? !before : false);
    await page.click(`#demo-fx-${effect}`);
    expect((await effectsShown())[effect]).toBe(before);
  }
  // the low tier draws without any finish, and frames keep coming
  await page.click('#demo-quality-low');
  expect(Object.values(await effectsShown())).toEqual([false, false, false, false, false]);
  await drawFrames(page, 2);
  await page.click('#demo-quality-auto');
  expect(await effectsShown()).toEqual(finish.effects);
  await page.evaluate(() => window.__shanhe?.render.renderer.setEffects(null));
  await drawFrames(page, 2);

  // fog of war on and off: the scene is drawn either way
  await page.click('#demo-fog');
  expect(await page.getAttribute('#demo-controls', 'data-fog')).toBe('on');
  await drawFrames(page, 2);
  if (captureDir !== undefined && gallery?.firstCity != null) {
    await page.evaluate((hex) => {
      window.__shanhe?.render.renderer.focusHex(hex, { distance: 8, immediate: true });
    }, gallery.firstCity);
    await drawFrames(page, 3);
    await capture('gallery-fog');
  }
  await page.click('#demo-fog');
  expect(await page.getAttribute('#demo-controls', 'data-fog')).toBe('off');
  if (captureDir !== undefined) {
    await drawFrames(page, 2);
    await capture('gallery');
  }

  // an event is animated only if its hexes are in view: jump to the demo's actors
  const stage = JSON.parse((await page.getAttribute('#demo-controls', 'data-stage')) ?? 'null') as {
    attacker: number;
    defender: number;
    defenderHex: number;
    path: number[];
  } | null;
  expect(stage).not.toBeNull();
  if (stage === null) return;
  const destination = stage.path[stage.path.length - 1];
  await page.evaluate((hex) => {
    window.__shanhe?.render.renderer.focusHex(hex, { distance: 0, immediate: true });
  }, stage.path[0] as number);
  await drawFrames(page, 2);
  await capture('near');

  if (captureDir !== undefined) {
    // for the captures only: play slowly and catch both animations under way
    for (const [name, event] of [
      ['move', { type: 'move', unit: stage.attacker, path: stage.path }],
      ['melee', { type: 'melee', unit: stage.attacker, targetHex: stage.defenderHex }],
    ] as const) {
      await page.evaluate((visual) => {
        const renderer = window.__shanhe?.render.renderer;
        renderer?.setAnimationSpeed(0.1);
        void renderer?.play([visual]);
      }, event);
      await page.waitForTimeout(2500);
      await capture(name);
      await page.evaluate(() => {
        const renderer = window.__shanhe?.render.renderer;
        renderer?.skip();
        renderer?.setAnimationSpeed(1);
      });
    }
  }

  // a move and a melee attack, each played to its end: the promises resolve,
  // the counters grow and the piece stands where the move took it
  const played = await page.evaluate(async (actors) => {
    const renderer = window.__shanhe?.render.renderer;
    if (renderer === undefined) throw new Error('window.__shanhe is not set');
    const before = renderer.getAnimationCounts();
    const shadowsBefore = renderer.getStats();
    const startHex = renderer.getUnitHex(actors.attacker);
    await renderer.play([{ type: 'move', unit: actors.attacker, path: actors.path }]);
    const afterMove = renderer.getAnimationCounts();
    const movedTo = renderer.getUnitHex(actors.attacker);
    await renderer.play([{ type: 'melee', unit: actors.attacker, targetHex: actors.defenderHex }]);
    // an event for a unit that does not exist is ignored and still resolves
    await renderer.play([{ type: 'promote', unit: -1 }]);
    return {
      before,
      afterMove,
      after: renderer.getAnimationCounts(),
      startHex,
      movedTo,
      endHex: renderer.getUnitHex(actors.attacker),
      defenderHex: renderer.getUnitHex(actors.defender),
      missing: renderer.getUnitHex(-1),
      animating: renderer.getStats().animating,
      shadowsBefore,
    };
  }, stage);
  // pieces that moved cast their shadows elsewhere: once a frame is drawn, their shadow maps were drawn again
  await drawFrames(page, 2);
  const shadowsAfter = await page.evaluate(() => window.__shanhe?.render.stats);
  expect(shadowsAfter?.pieceShadowDraws).toBeGreaterThan(played.shadowsBefore.pieceShadowDraws);
  expect(shadowsAfter?.shadowDraws).toBeGreaterThan(played.shadowsBefore.shadowDraws);
  console.log(
    `shadow maps drawn over both animations: ${(shadowsAfter?.pieceShadowDraws ?? 0) - played.shadowsBefore.pieceShadowDraws} of the pieces, ` +
      `${(shadowsAfter?.shadowDraws ?? 0) - (shadowsAfter?.pieceShadowDraws ?? 0) - played.shadowsBefore.shadowDraws + played.shadowsBefore.pieceShadowDraws} of the ground, ` +
      `in ${(shadowsAfter?.frames ?? 0) - played.shadowsBefore.frames} frames`,
  );
  if (captureDir === undefined) expect(played.startHex).toBe(stage.path[0]);
  expect(played.afterMove.move.animated).toBe(played.before.move.animated + 1);
  expect(played.afterMove.move.finished).toBe(played.before.move.finished + 1);
  expect(played.afterMove.move.instant).toBe(played.before.move.instant);
  expect(played.movedTo).toBe(destination);
  expect(played.after.melee.animated).toBe(played.before.melee.animated + 1);
  expect(played.after.melee.finished).toBe(played.before.melee.finished + 1);
  expect(played.after.melee.instant).toBe(played.before.melee.instant);
  expect(played.after.promote.ignored).toBe(played.before.promote.ignored + 1);
  expect(played.after.promote.finished).toBe(played.before.promote.finished);
  // the attacker comes home from its strike; the defender has not moved
  expect(played.endHex).toBe(destination);
  expect(played.defenderHex).toBe(stage.defenderHex);
  expect(played.missing).toBeNull();
  expect(played.animating).toBe(false);
  console.log(
    `animations: move ${JSON.stringify(played.after.move)}, melee ${JSON.stringify(played.after.melee)}`,
  );

  if (captureDir !== undefined) {
    await page.evaluate(() => {
      const renderer = window.__shanhe?.render.renderer;
      if (renderer === undefined) return;
      renderer.setCamera({ distance: 0 }, true);
      const near = renderer.getCamera().distance;
      renderer.setCamera({ distance: Infinity }, true);
      renderer.setCamera({ distance: Math.sqrt(near * renderer.getCamera().distance) }, true);
    });
    await drawFrames(page, 2);
    await capture('middle');
  }

  // at the farthest zoom the view is the political map
  await page.evaluate(() => {
    window.__shanhe?.render.renderer.setCamera({ distance: Infinity }, true);
  });
  await drawFrames(page, 2);
  const far = await page.evaluate(() => window.__shanhe?.render.stats);
  expect(far?.political).toBe(1);
  expect(far?.politicalMap).toBe(true);
  // the names of the polities are shown
  expect(far?.labels).toBeGreaterThan(0);
  // from up here the clouds are in view and the forests are colour and relief only
  expect(far?.cloudLayer).toBeGreaterThan(0);
  expect(far?.trees).toBe(0);
  console.log(`political map: ${far?.labels} labels, ${far?.drawCalls} draw calls, ${far?.triangles} triangles`);
  await capture('political');

  // and nearer it is terrain again
  await page.evaluate(() => {
    window.__shanhe?.render.renderer.setCamera({ distance: 0 }, true);
  });
  await drawFrames(page, 2);
  const near = await page.evaluate(() => window.__shanhe?.render.stats);
  expect(near?.politicalMap).toBe(false);
  expect(near?.cloudLayer).toBe(0);

  expect(errors).toEqual([]);
});

test('the default page draws frames and follows the language switch', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?map=fixture');
  await waitForFrames(page, MIN_FRAMES);
  await page.click('#language');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  // the page keeps drawing after the switch
  await drawFrames(page, 2);
  expect(errors).toEqual([]);
});
