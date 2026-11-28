/**
 * Bookkeeping for a scene that is set again and again and mostly stays the
 * same: what was built for each item is kept by the item's id and built
 * again only when the item's key changes. Parts are sorted into square
 * regions of the map, so that a change touches the meshes of one region.
 * Plain data, no Three.js.
 */

import { PART_SHAPE_COUNT } from './cityGen.ts';
import type { Part } from './cityGen.ts';

/** What one call of {@link KeyedCache.update} did. */
export interface KeyedUpdate<Id> {
  /** Ids built in this call: new items and items whose key changed. */
  readonly built: readonly Id[];
  /** Ids that were there before and are not any more. */
  readonly removed: readonly Id[];
}

export interface KeyedCache<In, Out, Id extends number | string = number> {
  /** Replaces the items. Only new and changed ones are built. */
  update(items: readonly In[]): KeyedUpdate<Id>;
  get(id: Id): Out | undefined;
  readonly size: number;
  /** Items built since the cache was made. Only grows. */
  readonly builds: number;
  clear(): void;
}

/**
 * @param idOf names an item; of two items with one id the later counts.
 * @param keyOf everything `build` depends on, as a string.
 */
export function createKeyedCache<In, Out, Id extends number | string = number>(
  idOf: (item: In) => Id,
  keyOf: (item: In) => string,
  build: (item: In) => Out,
): KeyedCache<In, Out, Id> {
  let entries = new Map<Id, { readonly key: string; readonly value: Out }>();
  let builds = 0;
  return {
    update(items) {
      const next = new Map<Id, { readonly key: string; readonly value: Out }>();
      const built = new Set<Id>();
      for (const item of items) {
        const id = idOf(item);
        const key = keyOf(item);
        const old = next.get(id) ?? entries.get(id);
        if (old !== undefined && old.key === key) {
          next.set(id, old);
          continue;
        }
        next.set(id, { key, value: build(item) });
        builds++;
        built.add(id);
      }
      const removed: Id[] = [];
      for (const id of entries.keys()) if (!next.has(id)) removed.push(id);
      entries = next;
      return { built: [...built], removed };
    },
    get(id) {
      return entries.get(id)?.value;
    },
    get size() {
      return entries.size;
    },
    get builds() {
      return builds;
    },
    clear() {
      entries = new Map();
    },
  };
}

/** A circle on the ground. */
export interface GroundArea {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface PartRegions {
  /**
   * Gives items their parts (in world coordinates) or, with `null`, takes
   * them away. Items that are not named keep what they have.
   *
   * @returns the regions whose parts changed.
   */
  apply(changes: Iterable<readonly [id: number, parts: readonly Part[] | null]>): string[];
  /** The parts of a region, by shape. */
  byShape(region: string): Part[][];
  /** Parts of all items. */
  readonly count: number;
  /** Regions that hold an item. */
  readonly regions: number;
}

/**
 * Sorts the parts of items into square regions. An item belongs to one
 * region as a whole: the one its first part stands in.
 *
 * @param side of a region, in world units.
 */
export function createPartRegions(side: number): PartRegions {
  const items = new Map<number, { readonly region: string; readonly parts: readonly Part[] }>();
  const regions = new Map<string, Set<number>>();
  let count = 0;
  return {
    apply(changes) {
      const dirty = new Set<string>();
      for (const [id, parts] of changes) {
        const old = items.get(id);
        if (old !== undefined) {
          count -= old.parts.length;
          items.delete(id);
          const members = regions.get(old.region);
          members?.delete(id);
          if (members?.size === 0) regions.delete(old.region);
          dirty.add(old.region);
        }
        const first = parts?.[0];
        if (parts === null || first === undefined) continue;
        const region = `${Math.floor(first.x / side)}:${Math.floor(first.z / side)}`;
        items.set(id, { region, parts });
        count += parts.length;
        let members = regions.get(region);
        if (members === undefined) {
          members = new Set();
          regions.set(region, members);
        }
        members.add(id);
        dirty.add(region);
      }
      return [...dirty];
    },
    byShape(region) {
      const lists: Part[][] = [];
      for (let shape = 0; shape < PART_SHAPE_COUNT; shape++) lists.push([]);
      for (const id of regions.get(region) ?? []) {
        for (const part of items.get(id)?.parts ?? []) (lists[part.shape] as Part[]).push(part);
      }
      return lists;
    },
    get count() {
      return count;
    },
    get regions() {
      return regions.size;
    },
  };
}
