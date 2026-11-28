import { describe, expect, it } from 'vitest';
import { QUALITY_TIERS } from '../render/scene.ts';
import {
  ANIMATION_SPEEDS,
  DEFAULT_SETTINGS,
  QUALITY_OPTIONS,
  SETTINGS_KEYS,
  createSettingsStore,
  normaliseVolume,
  parseStored,
} from './settings.ts';
import type { SettingsStorage } from './settings.ts';

function memory(initial: Record<string, string> = {}): SettingsStorage & { readonly data: Map<string, string>; writes: number } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    writes: 0,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      this.writes++;
      data.set(key, value);
    },
  };
}

describe('the settings store', () => {
  it('starts from the defaults', () => {
    const store = createSettingsStore(memory());
    expect(store.current).toEqual(DEFAULT_SETTINGS);
    expect(store.current).toEqual({ quality: 'auto', scale: 'auto', language: 'zh', animationSpeed: 1, volume: 0.6, muted: false });
  });

  it('offers the renderer’s quality tiers, auto first', () => {
    expect([...QUALITY_OPTIONS].sort()).toEqual([...QUALITY_TIERS].sort());
    expect(QUALITY_OPTIONS[0]).toBe('auto');
    expect(ANIMATION_SPEEDS).toContain(1);
  });

  it('stores every change and reads it back in another visit', () => {
    const storage = memory();
    const store = createSettingsStore(storage);
    const changed = store.set({ quality: 'low', scale: 'large', language: 'en', animationSpeed: 2, volume: 0.25, muted: true });
    expect(changed).toEqual({ quality: 'low', scale: 'large', language: 'en', animationSpeed: 2, volume: 0.25, muted: true });
    expect(store.current).toBe(changed);
    expect(storage.data.get(SETTINGS_KEYS.scale)).toBe('large');
    expect(storage.data.get(SETTINGS_KEYS.language)).toBe('en');
    expect(JSON.parse(storage.data.get(SETTINGS_KEYS.rest)!)).toEqual({ quality: 'low', animationSpeed: 2, volume: 0.25, muted: true });
    expect(createSettingsStore(storage).current).toEqual(changed);
  });

  it('keeps the keys the interface size and the language had before', () => {
    const store = createSettingsStore(memory({ 'shanhe.uiScale': 'small', 'shanhe.language': 'en' }));
    expect(store.current).toMatchObject({ scale: 'small', language: 'en', quality: 'auto' });
  });

  it('writes only what changed', () => {
    const storage = memory();
    const store = createSettingsStore(storage);
    store.set({ volume: 0.6, quality: 'auto' });
    expect(storage.writes).toBe(0);
    store.set({ muted: true });
    expect(storage.writes).toBe(1);
    expect([...storage.data.keys()]).toEqual([SETTINGS_KEYS.rest]);
    store.set({ scale: 'normal' });
    expect(storage.writes).toBe(2);
  });

  it('ignores values it does not know, in a change and in storage', () => {
    const store = createSettingsStore(memory());
    const bad = { quality: 'ultra', scale: 'huge', language: 'fr', animationSpeed: 3, volume: Number.NaN, muted: 'yes' };
    expect(store.set(bad as never)).toEqual(DEFAULT_SETTINGS);
    expect(store.set({ volume: 7 }).volume).toBe(1);
    expect(store.set({ volume: -3 }).volume).toBe(0);
    expect(store.set({ volume: 0.33 }).volume).toBe(0.35);

    const stored = memory({
      'shanhe.uiScale': '<script>',
      'shanhe.language': 'xx',
      'shanhe.settings': JSON.stringify({ quality: 'high', animationSpeed: 9, volume: 'loud', muted: 1, __proto__: { muted: true } }),
    });
    expect(createSettingsStore(stored).current).toEqual({ ...DEFAULT_SETTINGS, quality: 'high' });
    for (const text of ['', 'null', '[]', '"low"', '{', '{"quality":{}}', '{"volume":null}']) {
      expect(parseStored(text), text).toEqual({});
    }
    expect(parseStored(null)).toEqual({});
    expect(parseStored('{"volume":0.5,"muted":true,"other":1}')).toEqual({ volume: 0.5, muted: true });
  });

  it('works without storage, and with storage that throws', () => {
    const none = createSettingsStore(null);
    expect(none.set({ quality: 'medium' }).quality).toBe('medium');
    const broken: SettingsStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('full');
      },
    };
    const store = createSettingsStore(broken);
    expect(store.current).toEqual(DEFAULT_SETTINGS);
    expect(store.set({ animationSpeed: 4, muted: true })).toMatchObject({ animationSpeed: 4, muted: true });
  });
});

describe('normaliseVolume', () => {
  it('keeps a volume on the slider’s steps within 0 and 1', () => {
    expect(normaliseVolume(0.6)).toBe(0.6);
    expect(normaliseVolume(0.61)).toBe(0.6);
    expect(normaliseVolume(2)).toBe(1);
    expect(normaliseVolume(-1)).toBe(0);
    expect(normaliseVolume('0.5')).toBeNull();
    expect(normaliseVolume(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
