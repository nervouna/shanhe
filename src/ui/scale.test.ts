import { describe, expect, it } from 'vitest';
import { SCALE_SETTINGS, isScaleSetting, uiScale } from './scale.ts';

describe('uiScale', () => {
  it('is 1 on the window the layout is drawn for', () => {
    expect(uiScale('auto', 1280, 720)).toBe(1);
  });

  it('grows with the window, by the tighter of the two sides', () => {
    expect(uiScale('auto', 2560, 1300)).toBe(1.8);
    expect(uiScale('auto', 2472, 1200)).toBe(1.65);
    expect(uiScale('auto', 1920, 1080)).toBe(1.5);
    expect(uiScale('auto', 3000, 720)).toBe(1);
    expect(uiScale('auto', 1280, 2000)).toBe(1);
  });

  it('stays within its limits on very small and very large windows', () => {
    expect(uiScale('auto', 960, 540)).toBe(0.8);
    expect(uiScale('auto', 320, 200)).toBe(0.8);
    expect(uiScale('auto', 7680, 4320)).toBe(2);
    expect(uiScale('auto', 0, 0)).toBe(1);
  });

  it('never shrinks as the window grows', () => {
    let last = 0;
    for (let width = 600; width <= 4000; width += 40) {
      const scale = uiScale('auto', width, (width * 9) / 16);
      expect(scale).toBeGreaterThanOrEqual(last);
      last = scale;
    }
  });

  it('holds a fixed size for the other settings, whatever the window', () => {
    expect(uiScale('small', 2560, 1300)).toBe(0.85);
    expect(uiScale('normal', 2560, 1300)).toBe(1);
    expect(uiScale('large', 960, 540)).toBe(1.3);
    expect(uiScale('small', 1280, 720)).toBeLessThan(uiScale('normal', 1280, 720));
    expect(uiScale('normal', 1280, 720)).toBeLessThan(uiScale('large', 1280, 720));
  });

  it('knows its settings', () => {
    for (const setting of SCALE_SETTINGS) expect(isScaleSetting(setting)).toBe(true);
    expect(isScaleSetting('huge')).toBe(false);
    expect(isScaleSetting(null)).toBe(false);
  });
});
