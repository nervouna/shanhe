/**
 * Fog of war: what a polity sees and what it remembers.
 *
 * - A polity sees the hexes within the vision of its units and cities, and
 *   of those of its allies and its vassals.
 * - The major nations and the player remember every hex they have seen
 *   (`GameState.explored`, one encoded set per polity). Everybody else lives
 *   in the present: what they remember is what they see.
 * - Terrain, borders and the preset city sites are on the map and always
 *   known. What fog hides is what stands on a hex: units, and whether a site
 *   has a city.
 *
 * The rules use it in two places: an attack or an air strike needs a target
 * its owner can see, and the AI plans only with what its polity sees or
 * remembers.
 */

import { hexRange, indexToOffset } from '../shared/hex.ts';
import { at } from './context.ts';
import type { Ctx } from './context.ts';
import { KIT } from './kits.ts';
import { visionRange } from './modifiers.ts';
import { alliesOf, vassalsOf } from './relations.ts';
import { NO_POLITY } from './types.ts';
import type { City, GameState } from './types.ts';

// ---------------------------------------------------------------- encoding

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUE_OF = new Map<string, number>([...ALPHABET].map((char, value) => [char, value]));

/**
 * A set of hexes (1 per hex in the set) as text: six hexes per character,
 * the lowest index in the lowest bit, with the empty tail left off. The
 * empty set is the empty string.
 */
export function encodeHexSet(flags: Uint8Array): string {
  const chars: string[] = [];
  let last = -1;
  for (let i = 0; i < flags.length; i += 6) {
    let value = 0;
    for (let bit = 0; bit < 6 && i + bit < flags.length; bit++) if (flags[i + bit] === 1) value |= 1 << bit;
    if (value !== 0) last = chars.length;
    chars.push(ALPHABET[value] as string);
  }
  return chars.slice(0, last + 1).join('');
}

/**
 * The set {@link encodeHexSet} wrote, for a map of `count` hexes, or null if
 * the text is not one it would write for such a map.
 */
export function decodeHexSet(text: string, count: number): Uint8Array | null {
  if (text.length > Math.ceil(count / 6)) return null;
  const flags = new Uint8Array(count);
  for (let i = 0; i < text.length; i++) {
    const value = VALUE_OF.get(text[i] as string);
    if (value === undefined) return null;
    for (let bit = 0; bit < 6; bit++) {
      if ((value & (1 << bit)) === 0) continue;
      const hex = i * 6 + bit;
      if (hex >= count) return null;
      flags[hex] = 1;
    }
  }
  // The empty tail is never written.
  return text.endsWith(ALPHABET[0] as string) ? null : flags;
}

// ------------------------------------------------------------------- sight

/** True if the polity keeps a memory of what it has seen: a major nation or the player. */
export function remembers(state: GameState, polity: number): boolean {
  return polity === state.player || state.majors.includes(polity);
}

function reveal(ctx: Ctx, seen: Uint8Array, hex: number, range: number): void {
  const { width, height } = ctx.map;
  for (const offset of hexRange(indexToOffset(hex, width), range)) {
    if (offset.col < 0 || offset.col >= width || offset.row < 0 || offset.row >= height) continue;
    seen[offset.row * width + offset.col] = 1;
  }
}

/** The polities whose sight `polity` shares: itself, its allies and its vassals. */
export function sightSharers(ctx: Ctx, polity: number): number[] {
  return [polity, ...alliesOf(ctx, polity), ...vassalsOf(ctx, polity)];
}

/** What `polity` sees right now, worked out afresh: 1 per visible hex. Nobody (`NO_POLITY`) sees everything. */
export function computeSight(ctx: Ctx, polity: number): Uint8Array {
  const seen = new Uint8Array(ctx.topo.count);
  if (polity === NO_POLITY) return seen.fill(1);
  const sharers = sightSharers(ctx, polity);
  for (const unit of ctx.state.units) if (sharers.includes(unit.owner)) reveal(ctx, seen, unit.hex, visionRange(ctx, unit));
  for (const city of ctx.state.cities) {
    if (city !== null && sharers.includes(city.owner)) reveal(ctx, seen, at(ctx.map.zones, city.zone).siteHex, KIT.cityVision);
  }
  return seen;
}

/**
 * What `polity` sees, kept for the life of the context. Whatever moves the
 * polity's own units adds to it with {@link lookAround}; whoever lets other
 * polities act in the same context calls {@link forgetSight} in between.
 */
export function sightOf(ctx: Ctx, polity: number): Uint8Array {
  let seen = ctx.sight.get(polity);
  if (seen === undefined) {
    seen = computeSight(ctx, polity);
    ctx.sight.set(polity, seen);
  }
  return seen;
}

/** Drops every kept sight: the units have moved. */
export function forgetSight(ctx: Ctx): void {
  ctx.sight.clear();
}

/** True if `polity` sees the hex right now. */
export function canSee(ctx: Ctx, polity: number, hex: number): boolean {
  return polity === NO_POLITY || sightOf(ctx, polity)[hex] === 1;
}

// ------------------------------------------------------------------ memory

/** The hexes `polity` has seen, as the working copy of its entry in `GameState.explored`. */
function memoryOf(ctx: Ctx, polity: number): { flags: Uint8Array; dirty: boolean } {
  let memory = ctx.explored.get(polity);
  if (memory === undefined) {
    const flags = decodeHexSet(ctx.state.explored[polity] ?? '', ctx.topo.count) ?? new Uint8Array(ctx.topo.count);
    memory = { flags, dirty: false };
    ctx.explored.set(polity, memory);
  }
  return memory;
}

/** True if `polity` sees the hex or, having a memory, has seen it before. */
export function hasSeen(ctx: Ctx, polity: number, hex: number): boolean {
  if (canSee(ctx, polity, hex)) return true;
  return remembers(ctx.state, polity) && memoryOf(ctx, polity).flags[hex] === 1;
}

/**
 * True if `polity` knows that the city stands: it has seen its site, or the
 * site is the seat some polity started the game with (those are common
 * knowledge, like the borders).
 */
export function knowsCity(ctx: Ctx, polity: number, city: City): boolean {
  if (polity === NO_POLITY || city.owner === polity) return true;
  const first = at(ctx.map.zones, city.zone).polity;
  if (at(ctx.map.polities, first).capitalZone === city.zone) return true;
  return hasSeen(ctx, polity, at(ctx.map.zones, city.zone).siteHex);
}

/**
 * The polity looks around from `hex` as far as `range`: what it sees there
 * joins its kept sight and its memory. Called when one of its units has
 * moved or appeared, so that what a unit passes is remembered.
 */
export function lookAround(ctx: Ctx, polity: number, hex: number, range: number): void {
  if (polity === NO_POLITY) return;
  const seen = ctx.sight.get(polity);
  if (seen !== undefined) reveal(ctx, seen, hex, range);
  if (!remembers(ctx.state, polity)) return;
  const memory = memoryOf(ctx, polity);
  reveal(ctx, memory.flags, hex, range);
  memory.dirty = true;
}

/** Every polity with a memory adds what it sees now to it. Called when a game starts and when a turn ends. */
export function rememberSight(ctx: Ctx): void {
  forgetSight(ctx);
  for (let polity = 0; polity < ctx.n; polity++) {
    if (!remembers(ctx.state, polity) || !at(ctx.state.polities, polity).alive) continue;
    const seen = computeSight(ctx, polity);
    const memory = memoryOf(ctx, polity);
    for (let hex = 0; hex < seen.length; hex++) {
      if (seen[hex] === 1 && memory.flags[hex] !== 1) {
        memory.flags[hex] = 1;
        memory.dirty = true;
      }
    }
  }
}

/** Writes the memories that changed back into the state. Every entry point calls it before it hands the state out. */
export function flushFog(ctx: Ctx): void {
  for (const [polity, memory] of ctx.explored) {
    if (!memory.dirty) continue;
    ctx.state.explored[polity] = encodeHexSet(memory.flags);
    memory.dirty = false;
  }
}

/** What `polity` remembers: 1 per hex it sees or has seen. */
export function memoryFlags(ctx: Ctx, polity: number): Uint8Array {
  const seen = computeSight(ctx, polity);
  if (polity === NO_POLITY || !remembers(ctx.state, polity)) return seen;
  const flags = memoryOf(ctx, polity).flags;
  for (let hex = 0; hex < seen.length; hex++) if (flags[hex] === 1) seen[hex] = 1;
  return seen;
}
