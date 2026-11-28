/** The tech tree as the overlay draws it: where each tech sits, the lines between them, and what each one gives. */

import {
  BUILDINGS,
  BUILDING_IDS,
  ERAS,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  TECHS,
  TECH_IDS,
  UNITS,
  UNIT_IDS,
  buildingFor,
  improvementFor,
  unitFor,
} from '../core/data.ts';
import type { BuildingId, ImprovementId, TechId } from '../core/data.ts';
import { researchCost } from '../core/game.ts';
import type { GameState, RejectReason } from '../core/game.ts';
import { checkAction } from '../core/query.ts';
import { ROAD_UPGRADES } from '../core/uniques.ts';

export interface TechNode {
  readonly tech: TechId;
  /** The column: an index into `ERAS`. */
  readonly era: number;
  /** The row within the column, from 0. */
  readonly row: number;
}

/** A prerequisite line: `from` must be known before `to`. */
export interface TechEdge {
  readonly from: TechId;
  readonly to: TechId;
}

export interface TechLayout {
  readonly nodes: readonly TechNode[];
  readonly edges: readonly TechEdge[];
  /** Number of columns: one per era. */
  readonly columns: number;
  /** Rows of the tallest column. */
  readonly rows: number;
}

/**
 * Places every tech: eras are columns, and within a column the techs are
 * ordered by the mean row of their prerequisites, so that the lines cross
 * as little as a simple pass can manage.
 */
export function layoutTechTree(): TechLayout {
  const rowOf = new Map<TechId, number>();
  const nodes: TechNode[] = [];
  let rows = 0;
  for (let era = 0; era < ERAS.length; era++) {
    const members = TECH_IDS.filter((tech) => TECHS[tech].era === era);
    const weight = (tech: TechId, index: number): number => {
      const placed = TECHS[tech].requires.flatMap((id) => {
        const row = rowOf.get(id);
        return row === undefined ? [] : [row];
      });
      return placed.length === 0 ? index : placed.reduce((sum, row) => sum + row, 0) / placed.length;
    };
    const ordered = members
      .map((tech, index) => ({ tech, index, weight: weight(tech, index) }))
      .sort((a, b) => a.weight - b.weight || a.index - b.index);
    ordered.forEach((entry, row) => {
      rowOf.set(entry.tech, row);
      nodes.push({ tech: entry.tech, era, row });
    });
    rows = Math.max(rows, ordered.length);
  }
  const edges: TechEdge[] = [];
  for (const tech of TECH_IDS) for (const from of TECHS[tech].requires) edges.push({ from, to: tech });
  return { nodes, edges, columns: ERAS.length, rows };
}

/** One thing a tech gives. `unique` marks what only the nation in question has. */
export type TechUnlock =
  | { readonly kind: 'unit'; readonly unit: string; readonly unique: boolean }
  | { readonly kind: 'building'; readonly building: BuildingId; readonly unique: boolean }
  | { readonly kind: 'improvement'; readonly improvement: ImprovementId; readonly unique: boolean }
  /** The nation's roads become this road upgrade (an id of `ROAD_UPGRADES`). */
  | { readonly kind: 'road'; readonly road: string; readonly unique: true }
  /** It reveals the strategic resource (`MapResource.id`). */
  | { readonly kind: 'resource'; readonly resource: string }
  | { readonly kind: 'tradeRoute' | 'landPorts' | 'seaExits' | 'coast' | 'ocean' | 'railways' | 'hillFarms' | 'project' };

/**
 * Everything the tech unlocks for a nation: the units, buildings and
 * improvements that name it, then its own effects. The nation's unique unit,
 * building or improvement stands where it replaces a generic one, its extra
 * ones and its road upgrade are added, and nobody else's are listed.
 *
 * @param nation `MapPolity.id` of the nation the tree is drawn for; without one, the generic tree.
 */
export function techUnlocks(tech: TechId, nation = ''): TechUnlock[] {
  const def = TECHS[tech];
  const list: TechUnlock[] = [];
  for (const generic of UNIT_IDS) {
    const unit = unitFor(nation, generic);
    const entry = UNITS[unit];
    if (entry !== undefined && entry.buildable && entry.tech === tech) list.push({ kind: 'unit', unit, unique: unit !== generic });
  }
  for (const building of BUILDING_IDS) {
    const entry = BUILDINGS[building];
    if (entry.tech !== tech) continue;
    // a generic building the nation replaces is not built by it; a unique one is only its nation's
    if (entry.nation === null ? buildingFor(nation, building) !== building : entry.nation !== nation) continue;
    list.push({ kind: 'building', building, unique: entry.nation !== null });
  }
  for (const improvement of IMPROVEMENT_IDS) {
    const entry = IMPROVEMENTS[improvement];
    if (entry.tech !== tech) continue;
    if (entry.nation === undefined ? improvementFor(nation, improvement) !== improvement : entry.nation !== nation) continue;
    list.push({ kind: 'improvement', improvement, unique: entry.nation !== undefined });
  }
  for (const [road, spec] of Object.entries(ROAD_UPGRADES)) {
    if (spec.nation === nation && spec.tech === tech) list.push({ kind: 'road', road, unique: true });
  }
  if (def.reveals !== undefined) list.push({ kind: 'resource', resource: def.reveals });
  if ((def.tradeRoutes ?? 0) > 0) list.push({ kind: 'tradeRoute' });
  if (def.ports === 'land') list.push({ kind: 'landPorts' });
  if (def.ports === 'sea') list.push({ kind: 'seaExits' });
  if (def.sea === 'coast') list.push({ kind: 'coast' });
  if (def.sea === 'ocean') list.push({ kind: 'ocean' });
  if (def.railways === true) list.push({ kind: 'railways' });
  if (def.hillFarms === true) list.push({ kind: 'hillFarms' });
  if (def.project === true) list.push({ kind: 'project' });
  return list;
}

export type TechStatus = 'known' | 'current' | 'open' | 'locked';

export interface TechView {
  readonly tech: TechId;
  readonly status: TechStatus;
  /** Science it costs the polity. */
  readonly cost: number;
  /** Turns until it would be done at the polity's science, or null if it is known or the polity has no science. */
  readonly turns: number | null;
  /** Why it cannot be chosen now; null for an open or the current tech. */
  readonly reason: RejectReason | null;
}

/** How each tech stands for `polity`: known, being researched, open to choose, or locked and why. */
export function techViews(state: GameState, polity: number): Map<TechId, TechView> {
  const self = state.polities[polity];
  const views = new Map<TechId, TechView>();
  if (self === undefined) return views;
  let science = 0;
  for (const city of state.cities) if (city !== null && city.owner === polity) science += city.yields.science;
  for (const tech of TECH_IDS) {
    const cost = researchCost(state, polity, tech);
    const known = self.techs.includes(tech);
    const reason = known ? 'alreadyKnown' : checkAction(state, { type: 'setResearch', polity, tech });
    const status: TechStatus = known ? 'known' : self.research === tech ? 'current' : reason === null ? 'open' : 'locked';
    const left = Math.max(0, cost - self.researchProgress);
    views.set(tech, {
      tech,
      status,
      cost,
      turns: known || science <= 0 ? null : Math.max(1, Math.ceil(left / science)),
      reason: status === 'locked' ? reason : null,
    });
  }
  return views;
}
