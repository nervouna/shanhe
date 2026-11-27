/**
 * Plays visual events on the board: turns each event into a clip that moves
 * pieces, launches projectiles and spawns particles, and runs the clips one
 * after the other on a timeline.
 *
 * The timeline follows the clock. Frames only show where it is; a timer ends
 * it when no frame is drawn, so the promise of `play` always resolves.
 */

import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import type { MapData } from '../shared/mapData.ts';
import {
  MELEE_IMPACT,
  arcHeight,
  createTimeline,
  destroyPose,
  eventSeconds,
  meleeReach,
  movePose,
  promoteFlash,
} from './animationTimeline.ts';
import type { Timeline } from './animationTimeline.ts';
import type { Effects, ProjectileSpec } from './effects.ts';
import { surfaceHeightAt } from './heightField.ts';
import type { Surface } from './heightField.ts';
import type { Overlays } from './overlays.ts';
import type { PiecePose, Pieces } from './pieces.ts';
import type { VisualEvent } from './scene.ts';

export interface AnimatorHost {
  readonly surface: Surface;
  readonly pieces: Pieces;
  readonly effects: Effects;
  readonly overlays: Overlays;
  /** Whether any of the hexes is in the view. */
  inView(hexes: readonly number[]): boolean;
  /** The owner of every hex as it is drawn; the animator changes it in place. */
  owners(): Int16Array;
  /**
   * Draws the owners again after a change.
   *
   * @param final false while a sweep is running: only the ground colour
   *   follows. True at its end: borders and names follow too.
   */
  paintOwners(final: boolean): void;
}

export interface Animator {
  /**
   * @param speed of these events, on top of the general speed.
   * @param immediate true to apply the events without showing them.
   */
  play(events: readonly VisualEvent[], speed: number, immediate: boolean): Promise<void>;
  setSpeed(factor: number): void;
  /** Ends every clip at once, leaving what each one leaves behind. */
  skip(): void;
  /**
   * Drops every clip without applying it, for when the scene is replaced.
   *
   * @returns whether a clip had changed the owners of hexes.
   */
  reset(): boolean;
  /**
   * Shows the timeline at clock time `now`.
   *
   * @returns whether anything is still moving, particles included.
   */
  frame(now: number): boolean;
  /** Whether events are playing or queued. */
  readonly playing: boolean;
  dispose(): void;
}

interface Clip {
  readonly seconds: number;
  started: boolean;
  /** Shows the clip at a progress from 0 to 1. Only called for clips that take time. */
  update(progress: number): void;
  /** Leaves the board as it is after the event. Called once, also for clips that were never shown. */
  end(): void;
}

const DUST = 0xcdbb94;
const SMOKE_DARK = 0x4f4b47;
const SMOKE_LIGHT = 0x9a948b;
const SPARK = 0xffd76a;
const ARROW = 0x3a2c1c;
const SHELL = 0x25262a;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createAnimator(map: MapData, host: AnimatorHost): Animator {
  const { surface, pieces, effects, overlays } = host;
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const hexCount = map.width * map.height;
  const validHex = (hex: number): boolean => Number.isInteger(hex) && hex >= 0 && hex < hexCount;

  let timeline: Timeline | null = null;
  let clips: Clip[] = [];
  /** Clips whose `end` has run. */
  let ended = 0;
  let waiters: { readonly after: number; readonly resolve: () => void }[] = [];
  let speed = 1;
  let timer: number | null = null;
  let ownersTouched = false;
  /** Where pieces stand after the clips that have ended. */
  const homes = new Map<number, PiecePose>();
  const gone = new Set<number>();

  let seed = 12345;
  const random = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const homeOf = (unit: number): PiecePose | null => {
    if (gone.has(unit)) return null;
    const known = homes.get(unit);
    if (known !== undefined) return known;
    const hex = pieces.hexOf(unit);
    return hex === null ? null : pieces.standOn(hex);
  };

  const dust = (x: number, y: number, z: number, amount: number, strength: number): void => {
    for (let i = 0; i < amount; i++) {
      const a = (i / amount) * Math.PI * 2 + random();
      const v = size * (0.5 + random() * 0.5) * strength;
      effects.spawn({
        x: x + Math.cos(a) * size * 0.3,
        y: y + size * 0.04,
        z: z + Math.sin(a) * size * 0.3,
        vx: Math.cos(a) * v,
        vy: size * (0.12 + random() * 0.2) * strength,
        vz: Math.sin(a) * v,
        life: 0.5 + random() * 0.35,
        size: size * 0.16,
        endSize: size * 0.5 * strength,
        color: DUST,
        opacity: 0.55,
        drag: 2.6,
      });
    }
  };

  const smoke = (x: number, y: number, z: number, amount: number, strength: number): void => {
    for (let i = 0; i < amount; i++) {
      const a = random() * Math.PI * 2;
      const v = size * random() * 0.35 * strength;
      effects.spawn({
        x: x + Math.cos(a) * size * 0.15,
        y: y + size * (0.1 + random() * 0.15),
        z: z + Math.sin(a) * size * 0.15,
        vx: Math.cos(a) * v,
        vy: size * (0.35 + random() * 0.5) * strength,
        vz: Math.sin(a) * v,
        life: 0.8 + random() * 0.7,
        size: size * 0.2,
        endSize: size * (0.55 + random() * 0.35) * strength,
        color: random() < 0.5 ? SMOKE_DARK : SMOKE_LIGHT,
        opacity: 0.6,
        drag: 1.2,
      });
    }
  };

  const sparks = (x: number, y: number, z: number, amount: number, rise: number): void => {
    for (let i = 0; i < amount; i++) {
      const a = (i / amount) * Math.PI * 2 + random() * 0.4;
      const v = size * (0.5 + random() * 0.6);
      effects.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * v,
        vy: size * (rise + random() * 0.8),
        vz: Math.sin(a) * v,
        life: 0.35 + random() * 0.3,
        size: size * 0.1,
        endSize: size * 0.03,
        color: SPARK,
        opacity: 0.95,
        gravity: size * 2.5,
        drag: 1.5,
      });
    }
  };

  const idle: Clip = { seconds: 0, started: false, update() {}, end() {} };

  const moveClip = (unit: number, path: readonly number[], seconds: number): Clip => {
    const points = path.map((hex) => pieces.standOn(hex));
    const steps = points.length - 1;
    const destination = points[steps] as PiecePose;
    return {
      seconds,
      started: false,
      update(progress) {
        if (gone.has(unit)) return;
        const pose = movePose(steps, progress);
        const i = Math.min(Math.floor(pose.along), steps - 1);
        const a = points[i] as PiecePose;
        const b = points[i + 1] as PiecePose;
        const t = pose.along - i;
        const x = lerp(a.x, b.x, t);
        const z = lerp(a.z, b.z, t);
        // carried over whatever lies between the two hexes
        const y = Math.max(lerp(a.y, b.y, t), surfaceHeightAt(surface, x, z)) + pose.lift * 0.42 * size;
        pieces.setPose(unit, { x, y, z });
      },
      end() {
        if (gone.has(unit)) return;
        homes.set(unit, destination);
        pieces.setPose(unit, destination);
        if (this.started) dust(destination.x, destination.y, destination.z, 9, 1);
      },
    };
  };

  const meleeClip = (unit: number, targetHex: number, seconds: number): Clip => {
    const target = pieces.standOn(targetHex);
    let hit = false;
    return {
      seconds,
      started: false,
      update(progress) {
        const home = homeOf(unit);
        if (home === null) return;
        // the pieces touch rim to rim, a little short of the other's centre
        const reach = meleeReach(progress) * 0.58;
        const hop = Math.sin(Math.PI * Math.min(progress / MELEE_IMPACT, 1)) * 0.14 * size;
        pieces.setPose(unit, {
          x: lerp(home.x, target.x, reach),
          y: lerp(home.y, target.y, reach) + hop,
          z: lerp(home.z, target.z, reach),
        });
        if (!hit && progress >= MELEE_IMPACT) {
          hit = true;
          const x = lerp(home.x, target.x, 0.8);
          const z = lerp(home.z, target.z, 0.8);
          sparks(x, target.y + 0.25 * size, z, 10, 0.6);
          dust(target.x, target.y, target.z, 6, 0.8);
        }
      },
      end() {
        const home = homeOf(unit);
        if (home !== null) pieces.setPose(unit, home);
      },
    };
  };

  /** A volley from a point to a hex: arrows, or a few heavy shells. */
  const volleyClip = (
    origin: () => PiecePose | null,
    targetHex: number,
    seconds: number,
    kind: 'arrows' | 'shells',
    count: number,
  ): Clip => {
    const target = pieces.standOn(targetHex);
    const FLIGHT = 0.58;
    const stagger = (1 - FLIGHT - 0.08) / Math.max(count - 1, 1);
    const landed: boolean[] = new Array<boolean>(count).fill(false);
    const spread = Array.from({ length: count }, () => [random() - 0.5, random() - 0.5] as const);
    return {
      seconds,
      started: false,
      update(progress) {
        const from = origin();
        if (from === null) return;
        const startY = from.y + 0.35 * size;
        const endY = target.y + 0.15 * size;
        const distance = Math.hypot(target.x - from.x, target.z - from.z);
        const apex = kind === 'arrows' ? 0.7 * size + 0.18 * distance : 1.2 * size + 0.3 * distance;
        const at = (k: number, u: number): [number, number, number] => {
          const [sx, sz] = spread[k] as readonly [number, number];
          return [
            lerp(from.x, target.x + sx * 0.5 * size, u),
            lerp(startY, endY, u) + arcHeight(u, apex),
            lerp(from.z, target.z + sz * 0.5 * size, u),
          ];
        };
        const flying: ProjectileSpec[] = [];
        for (let k = 0; k < count; k++) {
          const u = (progress - k * stagger) / FLIGHT;
          if (u <= 0) continue;
          if (u >= 1) {
            if (!landed[k]) {
              landed[k] = true;
              const [x, y, z] = at(k, 1);
              if (kind === 'arrows') dust(x, y, z, 3, 0.6);
              else {
                smoke(x, y, z, 9, 1.2);
                sparks(x, y, z, 6, 1.2);
              }
            }
            continue;
          }
          const [x, y, z] = at(k, u);
          const [nx, ny, nz] = at(k, u + 0.01);
          flying.push({
            x,
            y,
            z,
            dx: nx - x,
            dy: ny - y,
            dz: nz - z,
            length: kind === 'arrows' ? 0.34 * size : 0.13 * size,
            thickness: kind === 'arrows' ? 0.028 * size : 0.11 * size,
            color: kind === 'arrows' ? ARROW : SHELL,
          });
          // shells leave a trail
          if (kind === 'shells' && random() < 0.5) {
            effects.spawn({ x, y, z, vx: 0, vy: size * 0.1, vz: 0, life: 0.4, size: size * 0.08, endSize: size * 0.2, color: SMOKE_LIGHT, opacity: 0.4 });
          }
        }
        effects.setProjectiles(flying);
      },
      end() {
        effects.setProjectiles([]);
      },
    };
  };

  const destroyClip = (unit: number, seconds: number): Clip => {
    const angle = (unit * 2.399963) % (Math.PI * 2);
    let fell = false;
    return {
      seconds,
      started: false,
      update(progress) {
        const home = homeOf(unit);
        if (home === null) return;
        const pose = destroyPose(progress);
        pieces.setEffect(unit, 0, pose.crack);
        pieces.setPose(unit, {
          x: home.x,
          y: home.y + Math.sin(pose.fall * Math.PI) * 0.1 * size - (1 - pose.scale) * 0.1 * size,
          z: home.z,
          tilt: pose.fall * 1.35,
          tiltX: Math.cos(angle),
          tiltZ: Math.sin(angle),
          scale: pose.scale,
        });
        if (!fell && pose.fall >= 0.95) {
          fell = true;
          dust(home.x + Math.cos(angle) * 0.3 * size, home.y, home.z + Math.sin(angle) * 0.3 * size, 10, 1.1);
        }
      },
      end() {
        const home = homeOf(unit);
        if (home === null) return;
        pieces.setPose(unit, { ...home, scale: 0 });
        gone.add(unit);
      },
    };
  };

  const promoteClip = (unit: number, seconds: number): Clip => {
    let lit = false;
    return {
      seconds,
      started: false,
      update(progress) {
        const home = homeOf(unit);
        if (home === null) return;
        pieces.setEffect(unit, promoteFlash(progress), 0);
        if (!lit) {
          lit = true;
          sparks(home.x, home.y + 0.3 * size, home.z, 16, 1.6);
        }
      },
      end() {
        if (!gone.has(unit)) pieces.setEffect(unit, 0, 0);
      },
    };
  };

  const captureClip = (cityHex: number, hexes: readonly number[], polity: number, seconds: number): Clip => {
    const centre = hexToWorld(indexToOffset(cityHex, map.width), layout);
    const distance = (hex: number): number => {
      const p = hexToWorld(indexToOffset(hex, map.width), layout);
      return Math.hypot(p.x - centre.x, p.z - centre.z);
    };
    const ordered = hexes.filter(validHex).sort((a, b) => distance(a) - distance(b));
    const tint = map.polities[polity]?.color ?? 0xffffff;
    let painted = 0;
    const paintTo = (count: number): boolean => {
      if (count <= painted) return false;
      const owner = host.owners();
      for (let i = painted; i < count; i++) owner[ordered[i] as number] = polity;
      painted = count;
      ownersTouched = true;
      return true;
    };
    return {
      seconds,
      started: false,
      update(progress) {
        // the colour spreads out from the city, then the glow of the sweep fades
        const spread = Math.min(1, progress / 0.7);
        const count = Math.ceil(ordered.length * spread * spread * (3 - 2 * spread));
        if (paintTo(count)) host.paintOwners(false);
        overlays.setSweep(ordered.slice(0, painted), tint, 0.6 * Math.min(1, (1 - progress) / 0.3));
      },
      end() {
        paintTo(ordered.length);
        host.paintOwners(true);
        overlays.setSweep([], tint, 0);
      },
    };
  };

  /** The clip of an event, or the idle clip if the event names nothing on the board. */
  const clipOf = (event: VisualEvent, factor: number, immediate: boolean): Clip => {
    const seconds = (hexes: readonly number[]): number =>
      immediate ? 0 : eventSeconds(event, host.inView(hexes)) / factor;
    const hexOfUnit = (unit: number): number | null => (pieces.has(unit) ? pieces.hexOf(unit) : null);
    switch (event.type) {
      case 'move': {
        if (!pieces.has(event.unit) || event.path.length < 2 || !event.path.every(validHex)) return idle;
        return moveClip(event.unit, event.path, seconds(event.path));
      }
      case 'melee':
      case 'ranged':
      case 'siege': {
        const hex = hexOfUnit(event.unit);
        if (hex === null || !validHex(event.targetHex)) return idle;
        const { unit, targetHex } = event;
        const length = seconds([hex, targetHex]);
        if (event.type === 'melee') return meleeClip(unit, targetHex, length);
        return volleyClip(() => homeOf(unit), targetHex, length, event.type === 'ranged' ? 'arrows' : 'shells', event.type === 'ranged' ? 6 : 3);
      }
      case 'cityStrike': {
        if (!validHex(event.cityHex) || !validHex(event.targetHex)) return idle;
        const city = pieces.standOn(event.cityHex);
        const from = { ...city, y: city.y + 0.3 * size };
        return volleyClip(() => from, event.targetHex, seconds([event.cityHex, event.targetHex]), 'arrows', 8);
      }
      case 'destroy': {
        const hex = hexOfUnit(event.unit);
        return hex === null ? idle : destroyClip(event.unit, seconds([hex]));
      }
      case 'promote': {
        const hex = hexOfUnit(event.unit);
        return hex === null ? idle : promoteClip(event.unit, seconds([hex]));
      }
      case 'capture': {
        if (!validHex(event.cityHex) || map.polities[event.polity] === undefined) return idle;
        return captureClip(event.cityHex, event.hexes, event.polity, seconds([event.cityHex, ...event.hexes.filter(validHex)]));
      }
    }
  };

  const disarm = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  /** Brings the board to where the timeline is at `now`. */
  const pump = (now: number): void => {
    if (timeline === null) return;
    const state = timeline.at(now);
    while (ended < state.completed) {
      (clips[ended] as Clip).end();
      ended++;
    }
    if (state.active >= 0) {
      const clip = clips[state.active] as Clip;
      clip.started = true;
      clip.update(state.progress);
    }
    if (waiters.length > 0) {
      const done = waiters.filter((waiter) => waiter.after <= ended);
      waiters = waiters.filter((waiter) => waiter.after > ended);
      for (const waiter of done) waiter.resolve();
    }
    disarm();
    if (state.active >= 0) {
      // ends the timeline even if no frame is drawn any more
      timer = window.setTimeout(() => {
        timer = null;
        pump(performance.now());
      }, timeline.remainingMs(now) + 30);
    } else {
      timeline = null;
      clips = [];
      ended = 0;
    }
  };

  return {
    play(events, factor, immediate) {
      const now = performance.now();
      const rate = Number.isFinite(factor) && factor > 0 ? factor : 1;
      const added = events.map((event) => clipOf(event, rate, immediate));
      const lengths = added.map((clip) => clip.seconds);
      if (timeline === null) {
        timeline = createTimeline(lengths, now, speed);
        clips = added;
        ended = 0;
      } else {
        timeline.append(lengths, now);
        clips.push(...added);
      }
      const after = clips.length;
      return new Promise<void>((resolve) => {
        waiters.push({ after, resolve });
        pump(now);
      });
    },
    setSpeed(factor) {
      speed = Number.isFinite(factor) && factor > 0 ? factor : 1;
      const now = performance.now();
      timeline?.setSpeed(speed, now);
      pump(now);
    },
    skip() {
      if (timeline === null) return;
      timeline.skip();
      pump(performance.now());
      effects.clear();
    },
    reset() {
      disarm();
      timeline = null;
      clips = [];
      ended = 0;
      homes.clear();
      gone.clear();
      effects.clear();
      overlays.setSweep([], 0, 0);
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) waiter.resolve();
      const touched = ownersTouched;
      ownersTouched = false;
      return touched;
    },
    frame(now) {
      pump(now);
      return timeline !== null || effects.active;
    },
    get playing() {
      return timeline !== null;
    },
    dispose() {
      this.reset();
    },
  };
}
