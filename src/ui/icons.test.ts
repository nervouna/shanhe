import { describe, expect, it } from 'vitest';
import { ICON_NAMES, ICON_PATHS } from './icons.ts';

describe('the icons', () => {
  it('are path data on the 16 × 16 grid and nothing else', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    for (const name of ICON_NAMES) {
      const data = ICON_PATHS[name];
      // absolute commands only: move, line, horizontal, vertical, curve, arc, close
      expect(data, name).toMatch(/^[MLHVCAZ0-9. ]+$/);
      expect(data.startsWith('M'), name).toBe(true);
      const numbers = data
        .split(/[MLHVCZ ]+/)
        .filter((part) => part !== '' && !part.includes('A'))
        .map(Number);
      for (const value of numbers) {
        expect(Number.isFinite(value), `${name}: ${data}`).toBe(true);
        expect(value, name).toBeGreaterThanOrEqual(0);
        expect(value, name).toBeLessThanOrEqual(16);
      }
    }
  });

  it('are all different', () => {
    expect(new Set(Object.values(ICON_PATHS)).size).toBe(ICON_NAMES.length);
  });
});
