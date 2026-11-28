/** What the renderer draws to help order the selected piece: its reach, the path under the pointer and the attack target. */

import type { SelectionAids } from '../render/scene.ts';
import type { Path } from './path.ts';

/**
 * A planned path as the renderer wants it: from the piece's own hex to the
 * end, with the positions at which a turn's movement ends. The last hex
 * always ends a turn: its marker says how many turns the whole way takes.
 */
export function pathAids(start: number, path: Path): { readonly hexes: number[]; readonly turnEnds: number[] } {
  const hexes = [start, ...path.hexes];
  const turnEnds: number[] = [];
  path.turns.forEach((turn, index) => {
    // `hexes` has the start in front, so step `index` of the path sits at `index + 1`
    if (index === path.turns.length - 1 || path.turns[index + 1] !== turn) turnEnds.push(index + 1);
  });
  return { hexes, turnEnds };
}

export interface OrderPreview {
  /** The hex the selected piece stands on. */
  readonly unitHex: number;
  /** Every hex it can move to this turn. */
  readonly reach: readonly number[];
  /** The path of the order under the pointer, or null. */
  readonly path: Path | null;
  /** The hex the order would attack, or null. */
  readonly attackTarget: number | null;
}

/** The aids for the selected piece. Parts with nothing to show are left out. */
export function orderAids(preview: OrderPreview): SelectionAids {
  const { path } = preview;
  return {
    ...(preview.reach.length === 0 ? {} : { reachable: preview.reach }),
    ...(path === null || path.hexes.length === 0 ? {} : { path: pathAids(preview.unitHex, path) }),
    ...(preview.attackTarget === null ? {} : { attackTarget: preview.attackTarget }),
  };
}
