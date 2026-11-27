/** Read-only questions the interface asks the rules. Nothing here changes a state. */

import { maxCityHp } from '../core/cities.ts';
import { BUILDING_IDS, IMPROVEMENT_IDS, PROJECT, UNIT_IDS, WAR, noYields } from '../core/data.ts';
import type { ImprovementId, TechId, Yields } from '../core/data.ts';
import { NO_POLITY, researchCost } from '../core/game.ts';
import type { Action, BuildItem, City, GameState, RejectReason } from '../core/game.ts';
import {
  buildCost,
  capitalDistance,
  capitalsHeldBy,
  checkAction,
  favourStanding,
  strengthOf,
  unitUpgrade,
  victoryContenders,
  victoryStandings,
} from '../core/query.ts';
import { topologyOf } from '../core/topology.ts';

/** Why the rules would refuse the action, or null if they would accept it. */
export function check(state: GameState, action: Action): RejectReason | null {
  return checkAction(state, action);
}

/** A thing a city can build, or is building. */
export interface BuildOption {
  readonly item: BuildItem;
  /** Production cost. */
  readonly cost: number;
  /** Turns until it is done at the city's current production, or null if the city produces nothing. */
  readonly turns: number | null;
}

function turnsFor(cost: number, production: number): number | null {
  return production <= 0 ? null : Math.max(1, Math.ceil(cost / production));
}

export interface CityView {
  readonly city: City;
  readonly maxHp: number;
  /** The queue; the first entry already has the city's stored production counted in. */
  readonly queue: readonly BuildOption[];
  readonly units: readonly BuildOption[];
  readonly buildings: readonly BuildOption[];
  /** Improvements that have at least one hex to stand on, with those hexes. */
  readonly improvements: readonly (BuildOption & { readonly improvement: ImprovementId; readonly hexes: readonly number[] })[];
  /** The nation's own empty city sites. */
  readonly sites: readonly BuildOption[];
  /** The next stage of the endgame project, where the city can build it. */
  readonly projects: readonly BuildOption[];
}

/** Everything the city panel shows for the city of `zone`, or null if there is no city. */
export function cityView(state: GameState, zone: number): CityView | null {
  const city = state.cities[zone];
  if (city === undefined || city === null) return null;
  const polity = city.owner;
  const topo = topologyOf(state.map);
  const production = city.yields.production;
  const option = (item: BuildItem): BuildOption => {
    const cost = buildCost(state, zone, item);
    return { item, cost, turns: turnsFor(cost, production) };
  };
  const legal = (item: BuildItem): boolean =>
    checkAction(state, { type: 'queueBuild', polity, city: zone, item }) === null;

  const units = UNIT_IDS.map((unit): BuildItem => ({ kind: 'unit', unit })).filter(legal).map(option);
  const buildings = BUILDING_IDS.map((building): BuildItem => ({ kind: 'building', building })).filter(legal).map(option);
  const improvements = IMPROVEMENT_IDS.flatMap((improvement) => {
    const hexes = (topo.workHexes[zone] ?? []).filter((hex) => legal({ kind: 'improvement', improvement, hex }));
    const first = hexes[0];
    return first === undefined ? [] : [{ ...option({ kind: 'improvement', improvement, hex: first }), improvement, hexes }];
  });
  const sites: BuildOption[] = [];
  state.zoneOwner.forEach((owner, other) => {
    const item: BuildItem = { kind: 'city', zone: other };
    if (owner === polity && state.cities[other] === null && legal(item)) sites.push(option(item));
  });
  const project: BuildItem = { kind: 'project', project: PROJECT.id };
  const projects = legal(project) ? [option(project)] : [];
  const queue = city.queue.map((item, index): BuildOption => {
    const cost = buildCost(state, zone, item);
    return { item, cost, turns: turnsFor(index === 0 ? Math.max(1, cost - city.progress) : cost, production) };
  });
  return { city, maxHp: maxCityHp(city), queue, units, buildings, improvements, sites, projects };
}

export interface PolitySummary {
  /** Per turn, from the cities as they are now. */
  readonly yields: Yields;
  /** Gold per turn after upkeep, as of the last turn. */
  readonly net: number;
  /** Mean morale of the cities, or null without a city. */
  readonly morale: number | null;
  readonly cities: number;
}

export function politySummary(state: GameState, polity: number): PolitySummary {
  const yields = noYields();
  let morale = 0;
  let cities = 0;
  for (const city of state.cities) {
    if (city === null || city.owner !== polity) continue;
    cities++;
    morale += city.morale;
    yields.food += city.yields.food;
    yields.production += city.yields.production;
    yields.gold += city.yields.gold;
    yields.science += city.yields.science;
    yields.culture += city.yields.culture;
  }
  return {
    yields,
    net: yields.gold - (state.polities[polity]?.upkeep ?? 0),
    morale: cities === 0 ? null : Math.round(morale / cities),
    cities,
  };
}

export type RelationView =
  | { readonly kind: 'war'; readonly since: number }
  /** At peace, and neither side may declare war before turn `until`. */
  | { readonly kind: 'truce'; readonly until: number }
  | { readonly kind: 'peace' };

export function relationView(state: GameState, a: number, b: number): RelationView {
  const relation = state.relations[a < b ? `${a}:${b}` : `${b}:${a}`];
  if (relation === undefined) return { kind: 'peace' };
  if (relation.atWar) return { kind: 'war', since: relation.since };
  const until = relation.since + WAR.truceTurns;
  return state.turn < until ? { kind: 'truce', until } : { kind: 'peace' };
}

export interface RankingRow {
  readonly polity: number;
  /** Original capitals of major nations it holds. */
  readonly capitals: number;
  readonly cities: number;
  /** Cumulative gross income: what the economic victory ranks. */
  readonly income: number;
  readonly alive: boolean;
}

/** The nations that can win, the winner first, then by cumulative income. */
export function ranking(state: GameState): RankingRow[] {
  const listed = new Set<number>([...state.majors, ...victoryContenders(state)]);
  if (state.player !== NO_POLITY) listed.add(state.player);
  const winner = state.result?.winner ?? NO_POLITY;
  return [...listed]
    .map((polity): RankingRow => ({
      polity,
      capitals: capitalsHeldBy(state, polity),
      cities: state.cities.filter((city) => city !== null && city.owner === polity).length,
      income: state.polities[polity]?.grossIncome ?? 0,
      alive: state.polities[polity]?.alive === true,
    }))
    .sort(
      (x, y) =>
        Number(y.polity === winner) - Number(x.polity === winner) ||
        Number(y.alive) - Number(x.alive) ||
        y.income - x.income ||
        x.polity - y.polity,
    );
}

/** The city (its zone) on a hex, or -1. */
export function cityZoneAt(state: GameState, hex: number): number {
  const zone = topologyOf(state.map).siteZone[hex];
  return zone !== undefined && zone >= 0 && state.cities[zone] !== null && state.cities[zone] !== undefined ? zone : -1;
}

/** What a unit would upgrade to and the gold it costs, or null if it has no upgrade now. */
export function upgradeView(state: GameState, unitId: number): { readonly type: string; readonly gold: number } | null {
  return unitUpgrade(state, unitId);
}

/** What a polity is researching and how long it still takes, or null if it researches nothing now. */
export function researchView(state: GameState, polity: number): { readonly tech: TechId; readonly turns: number | null } | null {
  const self = state.polities[polity];
  if (self === undefined || self.research === null) return null;
  const left = Math.max(0, researchCost(state, polity, self.research) - self.researchProgress);
  let science = 0;
  for (const city of state.cities) if (city !== null && city.owner === polity) science += city.yields.science;
  return { tech: self.research, turns: science <= 0 ? null : Math.max(1, Math.ceil(left / science)) };
}

export type VictoryKind = 'conquest' | 'science' | 'economic';

export interface VictoryLine {
  readonly kind: VictoryKind;
  /** The polity that is ahead, or `NO_POLITY` if nobody can win. Ties go to the lower index, as in the rules. */
  readonly leader: number;
  /** Capitals held, project stages done, or cumulative income. */
  readonly leaderValue: number;
  /** The player's value, or null in observer mode. */
  readonly playerValue: number | null;
  /** What the victory takes: capitals or stages. Null for the Economic victory, which the last turn decides. */
  readonly needed: number | null;
}

export interface VictoryView {
  readonly lines: readonly VictoryLine[];
  /** Turns until the Economic victory is decided. */
  readonly turnsLeft: number;
}

/** For each of the three victories: who leads, and where the player stands. */
export function victoryView(state: GameState): VictoryView {
  const standings = victoryStandings(state);
  const mine = standings.rows.find((row) => row.polity === state.player);
  const line = (kind: VictoryKind, key: 'capitals' | 'stages' | 'income', needed: number | null): VictoryLine => {
    let leader = NO_POLITY;
    let best = -1;
    for (const row of standings.rows) {
      if (row[key] > best) {
        best = row[key];
        leader = row.polity;
      }
    }
    return { kind, leader, leaderValue: Math.max(0, best), playerValue: mine === undefined ? null : mine[key], needed };
  };
  return {
    lines: [
      line('conquest', 'capitals', standings.capitalsNeeded),
      line('science', 'stages', standings.stagesNeeded),
      line('economic', 'income', null),
    ],
    turnsLeft: standings.turnsLeft,
  };
}

export interface PolityRow {
  readonly polity: number;
  /** Favour with the viewer, or null where there is none: a city-state, or observer mode. */
  readonly favour: number | null;
  readonly strength: number;
  /** Hexes between the capitals, or null in observer mode. */
  readonly distance: number | null;
}

export const POLITY_SORTS = ['favour', 'strength', 'distance'] as const;
export type PolitySort = (typeof POLITY_SORTS)[number];

/** Every living nation and city-state but the viewer, in the order of the map. */
export function polityRows(state: GameState, viewer: number): PolityRow[] {
  const rows: PolityRow[] = [];
  state.polities.forEach((polity, index) => {
    if (!polity.alive || index === viewer) return;
    rows.push({
      polity: index,
      favour: viewer === NO_POLITY ? null : (favourStanding(state, viewer, index)?.favour ?? null),
      strength: Math.round(strengthOf(state, index)),
      distance: viewer === NO_POLITY ? null : capitalDistance(state, viewer, index),
    });
  });
  return rows;
}

/**
 * Sorts the list of polities. Rows without a value come last whichever way
 * the list is sorted; equal rows keep the order of the map.
 *
 * @param descending the highest value first.
 */
export function sortPolityRows(rows: readonly PolityRow[], key: PolitySort, descending: boolean): PolityRow[] {
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null || y === null) return Number(x === null) - Number(y === null) || a.polity - b.polity;
    return (descending ? y - x : x - y) || a.polity - b.polity;
  });
}

/**
 * The pillage a unit can do where it stands, or null if there is nothing to
 * pillage there now. A unit without moves gets none: the rules name the
 * missing moves before they look at the hex.
 */
export function pillageAction(state: GameState, unitId: number): (Action & { type: 'pillage' }) | null {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (unit === undefined) return null;
  const action = { type: 'pillage', polity: unit.owner, unit: unit.id } as const;
  return checkAction(state, action) === null ? action : null;
}

/**
 * The demand for vassalage a unit can make at the gates of an enemy capital
 * next to it: the one the rules accept, or else one they refuse only because
 * the city has not fallen yet, which the panel shows disabled with that
 * reason. Null away from an enemy capital, and for a unit without moves.
 */
export function demandAction(state: GameState, unitId: number): (Action & { type: 'demandVassalage' }) | null {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (unit === undefined) return null;
  const topo = topologyOf(state.map);
  let later: (Action & { type: 'demandVassalage' }) | null = null;
  for (let d = 0; d < 6; d++) {
    const hex = topo.neighbors[unit.hex * 6 + d] as number;
    if (hex < 0 || cityZoneAt(state, hex) < 0) continue;
    const action = { type: 'demandVassalage', polity: unit.owner, unit: unit.id, target: hex } as const;
    const refused = checkAction(state, action);
    if (refused === null) return action;
    if (refused === 'cityNotFallen') later ??= action;
  }
  return later;
}
