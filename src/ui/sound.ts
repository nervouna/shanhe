/**
 * Sound, synthesised with the Web Audio API: there are no audio files. Each
 * sound is a few layers of an oscillator or of filtered noise with a short
 * envelope; the ambient bed is a quiet drone with wind that follows the era.
 *
 * Nothing sounds before the player's first gesture (browsers do not allow
 * it, and neither does the game), and an engine made silent, as under
 * automation, never creates an audio context at all.
 */

import type { GameEvent } from '../core/game.ts';
import type { VisualEvent, VisualEventType } from '../render/scene.ts';

export const SOUND_IDS = ['place', 'melee', 'ranged', 'siege', 'capture', 'turn', 'research', 'click'] as const;
export type SoundId = (typeof SOUND_IDS)[number];

/** One layer of a sound. */
export interface Tone {
  /** An oscillator's wave, or `noise` for white noise through a band-pass filter. */
  readonly source: 'sine' | 'triangle' | 'square' | 'noise';
  /** Frequency in Hz at the start and at the end: of the oscillator, or of the filter for noise. */
  readonly from: number;
  readonly to: number;
  /** Seconds after the sound begins. */
  readonly start: number;
  /** Seconds to the peak, and seconds the layer lasts in all. */
  readonly attack: number;
  readonly length: number;
  /** Peak gain, from 0 to 1, before the master volume. */
  readonly gain: number;
}

const tone = (
  source: Tone['source'], from: number, to: number, start: number, length: number, gain: number, attack = 0.005,
): Tone => ({ source, from, to, start, attack, length, gain });

/** What each sound is made of. */
export const VOICES: Readonly<Record<SoundId, readonly Tone[]>> = {
  // a piece set down on a wooden board: a click and a short thump
  place: [tone('noise', 1900, 800, 0, 0.05, 0.3, 0.002), tone('triangle', 190, 95, 0, 0.11, 0.4, 0.003)],
  // blades: a scrape of noise, a clank and a ring
  melee: [
    tone('noise', 2800, 700, 0, 0.14, 0.34, 0.004),
    tone('square', 230, 120, 0.01, 0.09, 0.14),
    tone('triangle', 1250, 980, 0.02, 0.22, 0.1),
  ],
  // a volley: three arrows leave, then land
  ranged: [
    tone('noise', 900, 3300, 0, 0.09, 0.2, 0.02),
    tone('noise', 1000, 3600, 0.06, 0.09, 0.18, 0.02),
    tone('noise', 850, 3000, 0.12, 0.09, 0.18, 0.02),
    tone('triangle', 150, 75, 0.3, 0.1, 0.26, 0.003),
  ],
  // a heavy shot: the crack, the boom and its rumble
  siege: [
    tone('noise', 3200, 1100, 0, 0.05, 0.3, 0.002),
    tone('sine', 92, 38, 0.01, 0.55, 0.55, 0.008),
    tone('noise', 420, 110, 0.03, 0.5, 0.3, 0.02),
  ],
  // a city falls: three drum beats and a gong
  capture: [
    tone('sine', 118, 58, 0, 0.2, 0.5),
    tone('sine', 118, 58, 0.22, 0.2, 0.5),
    tone('sine', 104, 50, 0.44, 0.32, 0.55),
    tone('triangle', 196, 194, 0.44, 1.3, 0.22, 0.01),
    tone('sine', 294, 291, 0.44, 1.1, 0.12, 0.01),
  ],
  // the turn begins: two soft notes, a fifth apart
  turn: [tone('sine', 392, 392, 0, 0.22, 0.16, 0.02), tone('sine', 587.3, 587.3, 0.12, 0.34, 0.14, 0.02)],
  // research finished: a pentatonic run upwards
  research: [
    tone('sine', 523.3, 523.3, 0, 0.26, 0.15, 0.01),
    tone('sine', 587.3, 587.3, 0.09, 0.26, 0.15, 0.01),
    tone('sine', 784, 784, 0.18, 0.26, 0.15, 0.01),
    tone('triangle', 1046.5, 1046.5, 0.27, 0.5, 0.13, 0.01),
  ],
  // a button: one tick
  click: [tone('triangle', 900, 640, 0, 0.035, 0.12, 0.002)],
};

/** How long a sound lasts, in seconds. */
export function soundLength(sound: SoundId): number {
  return Math.max(...VOICES[sound].map((layer) => layer.start + layer.length));
}

/** The ambient bed of an era: a drone on `root` with these partials, and wind through a low-pass filter. */
export interface AmbientSpec {
  /** Hz. */
  readonly root: number;
  /** Frequencies of the drone's voices as multiples of the root. Always three. */
  readonly partials: readonly [number, number, number];
  /** Cut-off of the wind, in Hz. */
  readonly wind: number;
}

/** One bed per era, ancient to modern: the drone rises through the ages and drops to a hum with the machines. */
export const AMBIENT: readonly AmbientSpec[] = [
  { root: 73.4, partials: [1, 1.5, 2], wind: 380 },
  { root: 82.4, partials: [1, 1.5, 2.25], wind: 460 },
  { root: 98, partials: [1, 1.335, 2], wind: 540 },
  { root: 110, partials: [1, 1.25, 1.5], wind: 640 },
  { root: 61.7, partials: [1, 2, 3], wind: 300 },
  { root: 55, partials: [1, 2.005, 4], wind: 900 },
];

export function ambientFor(era: number): AmbientSpec {
  const index = Math.max(0, Math.min(AMBIENT.length - 1, Math.floor(Number.isFinite(era) ? era : 0)));
  return AMBIENT[index] as AmbientSpec;
}

// ---------------------------------------------------------------- mapping

/** The sound of each thing the board plays; null for what makes none. */
export const EVENT_SOUNDS: Readonly<Record<VisualEventType, SoundId | null>> = {
  move: 'place',
  melee: 'melee',
  ranged: 'ranged',
  siege: 'siege',
  cityStrike: 'ranged',
  capture: 'capture',
  destroy: null,
  promote: null,
};

export interface SoundCue {
  readonly sound: SoundId;
  /** Seconds after the batch begins. */
  readonly at: number;
}

/** A batch of events sounds at most this many times, however long an AI turn was. */
export const MAX_CUES = 6;
/** Seconds between two sounds of a batch. */
export const CUE_SPACING = 0.16;

/**
 * The sounds for what the board is about to play, in order. A run of the
 * same sound counts once, and a batch is cut to {@link MAX_CUES}; a city
 * that falls is always heard.
 */
export function cuesFor(events: readonly VisualEvent[]): SoundCue[] {
  const sounds: SoundId[] = [];
  for (const event of events) {
    const sound = EVENT_SOUNDS[event.type];
    if (sound === null || sounds.at(-1) === sound) continue;
    if (sounds.length < MAX_CUES) sounds.push(sound);
    else if (sound === 'capture' && !sounds.includes('capture')) sounds[MAX_CUES - 1] = sound;
  }
  return sounds.map((sound, index) => ({ sound, at: index * CUE_SPACING }));
}

/** The sound of something the rules report that the board does not play: the player's research. */
export function gameSound(event: GameEvent, player: number): SoundId | null {
  return event.type === 'researchFinished' && event.polity === player ? 'research' : null;
}

// ----------------------------------------------------------------- engine

export interface SoundStatus {
  /** True if the engine was made silent: it never creates an audio context. */
  readonly silent: boolean;
  /** True once a gesture has started the audio context. */
  readonly unlocked: boolean;
  readonly volume: number;
  readonly muted: boolean;
  /** The era the ambient bed is set to. */
  readonly era: number;
  /** How often each sound was started. The numbers only grow. */
  readonly played: Readonly<Record<SoundId, number>>;
}

export interface SoundEngine {
  /** Starts the audio. Call it from the handler of a user gesture; later calls do nothing. */
  unlock(): void;
  /** Plays a sound `delay` seconds from now. Nothing happens before {@link unlock}. */
  play(sound: SoundId, delay?: number): void;
  /** Plays the cues of a batch; `speed` shortens the gaps between them. */
  playCues(cues: readonly SoundCue[], speed?: number): void;
  /** Master volume, from 0 to 1. */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Moves the ambient bed to an era (0 ancient to 5 modern). */
  setEra(era: number): void;
  readonly status: SoundStatus;
  /** Stops everything and frees the audio context. */
  dispose(): void;
}

export interface SoundOptions {
  /** Makes the audio context, or null where the browser has none. Called at most once, inside {@link SoundEngine.unlock}. */
  readonly createContext: (() => AudioContext) | null;
  /** True to never make a sound: under automation. */
  readonly silent?: boolean;
  readonly volume?: number;
  readonly muted?: boolean;
}

/** Layers sounding at once; a sound that would go over is dropped. */
const MAX_LAYERS = 28;
/** Gain of the ambient bed against the master volume. */
const AMBIENT_GAIN = 0.045;
const DRONE_GAINS = [0.5, 0.28, 0.16] as const;
const WIND_GAIN = 0.55;

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
}

/** One second of white noise from a fixed sequence, so that every visit sounds the same. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 0x80000000 - 1;
  }
  return buffer;
}

export function createSoundEngine(options: SoundOptions): SoundEngine {
  const silent = options.silent === true || options.createContext === null;
  let volume = clampVolume(options.volume ?? 0.6);
  let muted = options.muted === true;
  let era = 0;
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let drones: OscillatorNode[] = [];
  let wind: BiquadFilterNode | null = null;
  let ambientSources: AudioScheduledSourceNode[] = [];
  /** When each sounding layer ends, in context time. */
  let endings: number[] = [];
  const played = Object.fromEntries(SOUND_IDS.map((id) => [id, 0])) as Record<SoundId, number>;

  const level = (): number => (muted ? 0 : volume);

  const applyLevel = (): void => {
    if (context === null || master === null) return;
    master.gain.setTargetAtTime(level(), context.currentTime, 0.02);
  };

  const applyEra = (immediate: boolean): void => {
    if (context === null) return;
    const spec = ambientFor(era);
    const now = context.currentTime;
    drones.forEach((drone, index) => {
      const frequency = spec.root * (spec.partials[index] ?? 1);
      if (immediate) drone.frequency.setValueAtTime(frequency, now);
      // the bed drifts into a new era over a few seconds
      else drone.frequency.setTargetAtTime(frequency, now, 1.5);
    });
    if (wind !== null) {
      if (immediate) wind.frequency.setValueAtTime(spec.wind, now);
      else wind.frequency.setTargetAtTime(spec.wind, now, 1.5);
    }
  };

  const startAmbient = (ctx: AudioContext, out: GainNode, buffer: AudioBuffer): void => {
    const bed = ctx.createGain();
    bed.gain.value = AMBIENT_GAIN;
    bed.connect(out);
    drones = DRONE_GAINS.map((gain, index) => {
      const drone = ctx.createOscillator();
      drone.type = index === 0 ? 'sine' : 'triangle';
      const voice = ctx.createGain();
      voice.gain.value = gain;
      drone.connect(voice);
      voice.connect(bed);
      drone.start();
      return drone;
    });
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.4;
    const windGain = ctx.createGain();
    windGain.gain.value = WIND_GAIN;
    source.connect(filter);
    filter.connect(windGain);
    windGain.connect(bed);
    source.start();
    wind = filter;
    // the bed breathes: a very slow swell
    const swell = ctx.createOscillator();
    swell.type = 'sine';
    swell.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = AMBIENT_GAIN * 0.35;
    swell.connect(depth);
    depth.connect(bed.gain);
    swell.start();
    ambientSources = [...drones, source, swell];
    applyEra(true);
  };

  const playLayer = (ctx: AudioContext, out: GainNode, buffer: AudioBuffer, layer: Tone, at: number): void => {
    const begin = at + layer.start;
    const end = begin + layer.length;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, begin);
    envelope.gain.linearRampToValueAtTime(layer.gain, begin + Math.min(layer.attack, layer.length / 2));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(out);
    let source: AudioScheduledSourceNode;
    if (layer.source === 'noise') {
      const hiss = ctx.createBufferSource();
      hiss.buffer = buffer;
      hiss.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(layer.from, begin);
      filter.frequency.exponentialRampToValueAtTime(layer.to, end);
      hiss.connect(filter);
      filter.connect(envelope);
      source = hiss;
    } else {
      const oscillator = ctx.createOscillator();
      oscillator.type = layer.source;
      oscillator.frequency.setValueAtTime(layer.from, begin);
      oscillator.frequency.exponentialRampToValueAtTime(layer.to, end);
      oscillator.connect(envelope);
      source = oscillator;
    }
    source.start(begin);
    source.stop(end + 0.02);
    endings.push(end);
  };

  const play = (sound: SoundId, delay = 0): void => {
    if (context === null || master === null || noise === null) return;
    const now = context.currentTime;
    endings = endings.filter((end) => end > now);
    const layers = VOICES[sound];
    if (endings.length + layers.length > MAX_LAYERS) return;
    const at = now + Math.max(0, delay) + 0.005;
    for (const layer of layers) playLayer(context, master, noise, layer, at);
    played[sound]++;
  };

  return {
    unlock() {
      if (silent || context !== null || options.createContext === null) return;
      let made: AudioContext;
      try {
        made = options.createContext();
      } catch {
        // no audio on this device: the game goes on without
        return;
      }
      context = made;
      master = made.createGain();
      master.gain.value = level();
      master.connect(made.destination);
      noise = noiseBuffer(made);
      if (made.state === 'suspended') void made.resume().catch(() => undefined);
      startAmbient(made, master, noise);
    },
    play,
    playCues(cues, speed = 1) {
      const factor = Math.max(1, speed);
      for (const cue of cues) play(cue.sound, cue.at / factor);
    },
    setVolume(next) {
      volume = clampVolume(next);
      applyLevel();
    },
    setMuted(next) {
      muted = next;
      applyLevel();
    },
    setEra(next) {
      const wanted = AMBIENT.indexOf(ambientFor(next));
      if (wanted === era) return;
      era = wanted;
      applyEra(false);
    },
    get status(): SoundStatus {
      return { silent, unlocked: context !== null, volume, muted, era, played: { ...played } };
    },
    dispose() {
      for (const source of ambientSources) {
        try {
          source.stop();
        } catch {
          // it never started
        }
      }
      ambientSources = [];
      drones = [];
      wind = null;
      void context?.close().catch(() => undefined);
      context = null;
      master = null;
      noise = null;
    },
  };
}

/** The browser's audio context constructor, or null where there is none. */
export function browserAudio(): (() => AudioContext) | null {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
  return Constructor === undefined ? null : () => new Constructor();
}
