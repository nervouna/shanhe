import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/game.ts';
import type { VisualEvent, VisualEventType } from '../render/scene.ts';
import {
  AMBIENT,
  CUE_SPACING,
  EVENT_SOUNDS,
  MAX_CUES,
  SOUND_IDS,
  VOICES,
  ambientFor,
  createSoundEngine,
  cuesFor,
  gameSound,
  soundLength,
} from './sound.ts';
import type { SoundId } from './sound.ts';

// ------------------------------------------------------- a counting context

class Param {
  value = 0;
  readonly targets: number[] = [];
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.targets.push(value);
  }
  exponentialRampToValueAtTime(value: number): void {
    this.targets.push(value);
  }
  setTargetAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  readonly gain = new Param();
  readonly frequency = new Param();
  readonly Q = new Param();
  type = '';
  loop = false;
  buffer: unknown = null;
  started: number | null = null;
  stopped: number | null = null;
  readonly outputs: unknown[] = [];
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect(target: unknown): void {
    this.outputs.push(target);
  }
  start(at = 0): void {
    this.started = at;
  }
  stop(at = 0): void {
    this.stopped = at;
  }
}

class FakeContext {
  currentTime = 10;
  readonly sampleRate = 8000;
  readonly destination = new FakeNode('destination');
  state = 'suspended';
  resumed = 0;
  closed = 0;
  readonly nodes: FakeNode[] = [];
  private make(kind: string): FakeNode {
    const node = new FakeNode(kind);
    this.nodes.push(node);
    return node;
  }
  createGain(): FakeNode {
    return this.make('gain');
  }
  createOscillator(): FakeNode {
    return this.make('oscillator');
  }
  createBiquadFilter(): FakeNode {
    return this.make('filter');
  }
  createBufferSource(): FakeNode {
    return this.make('source');
  }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed++;
    return Promise.resolve();
  }
  count(kind: string): number {
    return this.nodes.filter((node) => node.kind === kind).length;
  }
}

function engine(options: { silent?: boolean; volume?: number; muted?: boolean } = {}) {
  const made: FakeContext[] = [];
  const sound = createSoundEngine({
    ...options,
    createContext: () => {
      const context = new FakeContext();
      made.push(context);
      return context as unknown as AudioContext;
    },
  });
  return { sound, made };
}

/** The gain node everything goes through: the one connected to the destination. */
function master(context: FakeContext): FakeNode {
  return context.nodes.find((node) => node.outputs.includes(context.destination))!;
}

// ------------------------------------------------------------------ voices

describe('the voices', () => {
  it('has a voice for every sound of the issue', () => {
    expect([...SOUND_IDS].sort()).toEqual(['capture', 'click', 'melee', 'place', 'ranged', 'research', 'siege', 'turn']);
    for (const id of SOUND_IDS) expect(VOICES[id].length, id).toBeGreaterThan(0);
  });

  it('is made of audible, short layers that cannot clip together', () => {
    for (const id of SOUND_IDS) {
      let peak = 0;
      for (const layer of VOICES[id]) {
        for (const frequency of [layer.from, layer.to]) {
          expect(frequency, id).toBeGreaterThanOrEqual(30);
          expect(frequency, id).toBeLessThanOrEqual(8000);
        }
        expect(layer.length, id).toBeGreaterThan(0);
        expect(layer.attack, id).toBeLessThan(layer.length);
        expect(layer.start, id).toBeGreaterThanOrEqual(0);
        expect(layer.gain, id).toBeGreaterThan(0);
        // the layers that sound at the moment this one peaks
        const at = layer.start + layer.attack;
        const together = VOICES[id].filter((other) => other.start <= at && at < other.start + other.length);
        peak = Math.max(peak, together.reduce((sum, other) => sum + other.gain, 0));
      }
      expect(peak, id).toBeLessThanOrEqual(1);
      expect(soundLength(id), id).toBeLessThanOrEqual(2);
    }
    expect(soundLength('click')).toBeLessThan(0.05);
    expect(soundLength('capture')).toBeGreaterThan(soundLength('melee'));
    // a button is much quieter than a battle
    expect(VOICES.click[0]!.gain).toBeLessThan(VOICES.melee[0]!.gain / 2);
  });

  it('tells the sounds apart by what they are made of', () => {
    const shape = (id: SoundId): string => VOICES[id].map((layer) => `${layer.source}:${layer.from}>${layer.to}@${layer.start}`).join('|');
    expect(new Set(SOUND_IDS.map(shape)).size).toBe(SOUND_IDS.length);
    // siege is the lowest, the research chime the highest
    const lowest = (id: SoundId): number => Math.min(...VOICES[id].filter((layer) => layer.source !== 'noise').map((layer) => layer.to));
    expect(lowest('siege')).toBeLessThan(lowest('melee'));
    expect(lowest('research')).toBeGreaterThan(lowest('capture'));
    expect(VOICES.ranged.filter((layer) => layer.source === 'noise' && layer.to > layer.from)).toHaveLength(3);
  });
});

describe('the ambient bed', () => {
  it('has one bed per era, each different, quiet and low', () => {
    expect(AMBIENT).toHaveLength(6);
    expect(new Set(AMBIENT.map((spec) => spec.root)).size).toBe(6);
    for (const spec of AMBIENT) {
      expect(spec.root).toBeGreaterThanOrEqual(40);
      expect(spec.root).toBeLessThanOrEqual(120);
      expect(spec.partials[0]).toBe(1);
      expect(spec.wind).toBeGreaterThan(100);
    }
    expect(ambientFor(0)).toBe(AMBIENT[0]);
    expect(ambientFor(5)).toBe(AMBIENT[5]);
    expect(ambientFor(99)).toBe(AMBIENT[5]);
    expect(ambientFor(-3)).toBe(AMBIENT[0]);
    expect(ambientFor(Number.NaN)).toBe(AMBIENT[0]);
  });
});

// ----------------------------------------------------------------- mapping

describe('events to sounds', () => {
  const event = (type: VisualEventType): VisualEvent => {
    switch (type) {
      case 'move':
        return { type, unit: 1, path: [1, 2] };
      case 'melee':
      case 'ranged':
      case 'siege':
        return { type, unit: 1, targetHex: 2 };
      case 'cityStrike':
        return { type, cityHex: 1, targetHex: 2 };
      case 'destroy':
      case 'promote':
        return { type, unit: 1 };
      case 'capture':
        return { type, cityHex: 1, hexes: [1], polity: 0 };
    }
  };

  it('gives each thing the board plays its sound', () => {
    expect(EVENT_SOUNDS).toEqual({
      move: 'place',
      melee: 'melee',
      ranged: 'ranged',
      siege: 'siege',
      cityStrike: 'ranged',
      capture: 'capture',
      destroy: null,
      promote: null,
    });
    expect(cuesFor([event('move'), event('melee'), event('destroy'), event('capture')])).toEqual([
      { sound: 'place', at: 0 },
      { sound: 'melee', at: CUE_SPACING },
      { sound: 'capture', at: 2 * CUE_SPACING },
    ]);
    expect(cuesFor([])).toEqual([]);
    expect(cuesFor([event('destroy'), event('promote')])).toEqual([]);
  });

  it('counts a run of the same sound once', () => {
    expect(cuesFor([event('move'), event('move'), event('move'), event('ranged'), event('cityStrike'), event('move')]).map((cue) => cue.sound)).toEqual([
      'place', 'ranged', 'place',
    ]);
  });

  it('cuts a long turn short but always lets a falling city be heard', () => {
    const long: VisualEvent[] = [];
    for (let i = 0; i < 20; i++) long.push(event('move'), event('melee'));
    const cues = cuesFor([...long, event('capture')]);
    expect(cues).toHaveLength(MAX_CUES);
    expect(cues.at(-1)!.sound).toBe('capture');
    expect(cues.map((cue) => cue.at)).toEqual(cues.map((_, index) => index * CUE_SPACING));
    expect(cuesFor(long)).toHaveLength(MAX_CUES);
  });

  it('chimes for the player’s own research only', () => {
    const finished: GameEvent = { type: 'researchFinished', polity: 2, tech: 'farming' };
    expect(gameSound(finished, 2)).toBe('research');
    expect(gameSound(finished, 1)).toBeNull();
    expect(gameSound(finished, -1)).toBeNull();
    expect(gameSound({ type: 'warDeclared', by: 1, on: 2 }, 2)).toBeNull();
  });
});

// ------------------------------------------------------------------ engine

describe('the sound engine', () => {
  it('makes no audio context and no sound before the first gesture', () => {
    const { sound, made } = engine();
    sound.play('melee');
    sound.playCues([{ sound: 'place', at: 0 }]);
    sound.setVolume(0.9);
    sound.setEra(3);
    expect(made).toHaveLength(0);
    expect(sound.status).toMatchObject({ unlocked: false, silent: false, volume: 0.9, era: 3 });
    expect(Object.values(sound.status.played).every((count) => count === 0)).toBe(true);
  });

  it('stays silent under automation whatever happens', () => {
    const { sound, made } = engine({ silent: true });
    sound.unlock();
    sound.play('capture');
    expect(made).toHaveLength(0);
    expect(sound.status).toMatchObject({ unlocked: false, silent: true });
    expect(sound.status.played.capture).toBe(0);
    const none = createSoundEngine({ createContext: null });
    none.unlock();
    none.play('click');
    expect(none.status).toMatchObject({ unlocked: false, silent: true });
  });

  it('starts the context and the ambient bed on the first gesture, once', () => {
    const { sound, made } = engine({ volume: 0.5 });
    sound.unlock();
    sound.unlock();
    expect(made).toHaveLength(1);
    const context = made[0]!;
    expect(context.resumed).toBe(1);
    expect(sound.status.unlocked).toBe(true);
    expect(master(context).gain.value).toBe(0.5);
    // three drones and the slow swell; one looping noise source through a low-pass filter
    expect(context.count('oscillator')).toBe(4);
    expect(context.count('source')).toBe(1);
    expect(context.nodes.find((node) => node.kind === 'source')).toMatchObject({ loop: true, started: 0 });
    expect(context.nodes.find((node) => node.kind === 'filter')).toMatchObject({ type: 'lowpass' });
    const drones = context.nodes.filter((node) => node.kind === 'oscillator').slice(0, 3);
    expect(drones.map((node) => node.frequency.value)).toEqual(AMBIENT[0]!.partials.map((ratio) => AMBIENT[0]!.root * ratio));
    // the bed is far quieter than a sound
    const bed = context.nodes.find((node) => node.kind === 'gain' && node.outputs.includes(master(context)))!;
    expect(bed.gain.value).toBeLessThan(0.06);
    expect(bed.gain.value).toBeGreaterThan(0);
  });

  it('builds each sound from its layers: an oscillator or filtered noise under an envelope', () => {
    for (const id of SOUND_IDS) {
      const { sound, made } = engine();
      sound.unlock();
      const context = made[0]!;
      const before = { oscillator: context.count('oscillator'), source: context.count('source'), filter: context.count('filter'), all: context.nodes.length };
      sound.play(id);
      const layers = VOICES[id];
      const noise = layers.filter((layer) => layer.source === 'noise').length;
      expect(context.count('oscillator') - before.oscillator, id).toBe(layers.length - noise);
      expect(context.count('source') - before.source, id).toBe(noise);
      expect(context.count('filter') - before.filter, id).toBe(noise);
      const fresh = context.nodes.slice(before.all);
      const sources = fresh.filter((node) => node.kind === 'oscillator' || node.kind === 'source');
      for (const node of sources) {
        expect(node.started, id).toBeGreaterThanOrEqual(context.currentTime);
        expect(node.stopped, id).toBeGreaterThan(node.started!);
      }
      const envelopes = fresh.filter((node) => node.kind === 'gain');
      expect(envelopes).toHaveLength(layers.length);
      expect(envelopes.map((node) => node.gain.targets[0]).sort()).toEqual(layers.map((layer) => layer.gain).sort());
      for (const node of envelopes) expect(node.outputs).toEqual([master(context)]);
      expect(sound.status.played[id]).toBe(1);
    }
  });

  it('follows the master volume and mute', () => {
    const { sound, made } = engine({ volume: 0.8, muted: true });
    sound.unlock();
    const out = master(made[0]!);
    expect(out.gain.value).toBe(0);
    sound.setMuted(false);
    expect(out.gain.value).toBe(0.8);
    sound.setVolume(0.3);
    expect(out.gain.value).toBe(0.3);
    sound.setVolume(5);
    expect(out.gain.value).toBe(1);
    sound.setMuted(true);
    expect(out.gain.value).toBe(0);
    expect(sound.status).toMatchObject({ volume: 1, muted: true });
  });

  it('moves the ambient bed with the era', () => {
    const { sound, made } = engine();
    sound.setEra(2);
    sound.unlock();
    const context = made[0]!;
    const drones = context.nodes.filter((node) => node.kind === 'oscillator').slice(0, 3);
    const wind = context.nodes.find((node) => node.kind === 'filter')!;
    expect(drones[0]!.frequency.value).toBe(AMBIENT[2]!.root);
    expect(wind.frequency.value).toBe(AMBIENT[2]!.wind);
    sound.setEra(4);
    expect(drones.map((node) => node.frequency.value)).toEqual(AMBIENT[4]!.partials.map((ratio) => AMBIENT[4]!.root * ratio));
    expect(wind.frequency.value).toBe(AMBIENT[4]!.wind);
    expect(sound.status.era).toBe(4);
    sound.setEra(40);
    expect(sound.status.era).toBe(5);
  });

  it('plays the cues of a batch one after the other, closer together when hurried', () => {
    const { sound, made } = engine();
    sound.unlock();
    const context = made[0]!;
    const before = context.nodes.length;
    sound.playCues([{ sound: 'click', at: 0 }, { sound: 'click', at: 0.4 }], 2);
    const starts = context.nodes.slice(before).filter((node) => node.kind === 'oscillator').map((node) => node.started!);
    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeCloseTo(0.2, 5);
    expect(sound.status.played.click).toBe(2);
  });

  it('drops sounds once too many layers are sounding, and takes them again later', () => {
    const { sound, made } = engine();
    sound.unlock();
    const context = made[0]!;
    for (let i = 0; i < 40; i++) sound.play('capture');
    const played = sound.status.played.capture;
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThan(40);
    expect(played * VOICES.capture.length).toBeLessThanOrEqual(28);
    context.currentTime += 5;
    sound.play('capture');
    expect(sound.status.played.capture).toBe(played + 1);
  });

  it('survives a device without audio, and frees the context when disposed', () => {
    const broken = createSoundEngine({
      createContext: () => {
        throw new Error('no audio device');
      },
    });
    broken.unlock();
    broken.play('click');
    expect(broken.status.unlocked).toBe(false);

    const { sound, made } = engine();
    sound.unlock();
    sound.dispose();
    expect(made[0]!.closed).toBe(1);
    expect(sound.status.unlocked).toBe(false);
    expect(made[0]!.nodes.filter((node) => node.kind === 'oscillator').every((node) => node.stopped !== null)).toBe(true);
    sound.play('click');
    expect(sound.status.played.click).toBe(0);
  });
});
