/**
 * Save files. A save is the JSON that the rules write; reading one back never
 * trusts it: the text is parsed as data only, every field is checked against
 * the map and the rules' tables, and the state is rebuilt from the checked
 * values, so nothing else in the file survives.
 */

import { BUILDING_IDS, CITY, ERAS, FOCUSES, IMPROVEMENT_IDS, PROJECT, TECH_IDS, UNITS, unitDef } from '../core/data.ts';
import type { BuildingId, Focus, ImprovementId, TechId, Yields } from '../core/data.ts';
import { STATE_VERSION, saveGame } from '../core/game.ts';
import type {
  BuildItem,
  City,
  GameResult,
  GameState,
  GameStats,
  PolityState,
  Relation,
  Unit,
  UnitStatus,
} from '../core/game.ts';
import type { MapData } from '../shared/mapData.ts';

/** Longest save text that is read, in characters. A real save is well under a megabyte. */
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;

export type ImportError = 'tooLarge' | 'notJson' | 'notASave' | 'badVersion' | 'wrongMap' | 'corrupt';

export type ImportResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: ImportError };

/** The text of a save file for the game. */
export function exportSave(state: GameState): string {
  return saveGame(state);
}

class Corrupt extends Error {}

function fail(what: string): never {
  throw new Corrupt(what);
}

type Json = Record<string, unknown>;

function record(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(what);
  return value as Json;
}

function list(value: unknown, what: string, maxLength = 100_000): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) fail(what);
  return value;
}

function int(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(what);
  return value;
}

function num(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(what);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') fail(what);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) fail(what);
  return value as T;
}

const BIG = 1e12;
const MAX_TURNS = 100_000;
const UINT32 = 0xffffffff;
const STATUSES: readonly UnitStatus[] = ['ready', 'fortified', 'asleep'];

function yields(value: unknown, what: string): Yields {
  const data = record(value, what);
  return {
    food: num(data.food, -BIG, BIG, what),
    production: num(data.production, -BIG, BIG, what),
    gold: num(data.gold, -BIG, BIG, what),
    science: num(data.science, -BIG, BIG, what),
    culture: num(data.culture, -BIG, BIG, what),
  };
}

function unitType(value: unknown, what: string): string {
  if (typeof value !== 'string' || !Object.hasOwn(UNITS, value)) fail(what);
  return value;
}

/** Sizes of the map a save is checked against. */
interface Bounds {
  readonly hexes: number;
  readonly zones: number;
  readonly polities: number;
}

function buildItem(value: unknown, bounds: Bounds): BuildItem {
  const data = record(value, 'queue item');
  switch (data.kind) {
    case 'unit':
      return { kind: 'unit', unit: unitType(data.unit, 'queued unit') };
    case 'building':
      return { kind: 'building', building: oneOf<BuildingId>(data.building, BUILDING_IDS, 'queued building') };
    case 'improvement':
      return {
        kind: 'improvement',
        improvement: oneOf<ImprovementId>(data.improvement, IMPROVEMENT_IDS, 'queued improvement'),
        hex: int(data.hex, 0, bounds.hexes - 1, 'queued improvement hex'),
      };
    case 'city':
      return { kind: 'city', zone: int(data.zone, 0, bounds.zones - 1, 'queued city zone') };
    case 'project':
      return { kind: 'project', project: oneOf(data.project, [PROJECT.id], 'queued project') };
    default:
      return fail('queue item kind');
  }
}

function city(value: unknown, zone: number, bounds: Bounds): City | null {
  if (value === null) return null;
  const data = record(value, 'city');
  const buildings = list(data.buildings, 'buildings', BUILDING_IDS.length).map((id) =>
    oneOf<BuildingId>(id, BUILDING_IDS, 'building'),
  );
  if (new Set(buildings).size !== buildings.length) fail('building listed twice');
  return {
    zone: int(data.zone, zone, zone, 'city zone'),
    owner: int(data.owner, 0, bounds.polities - 1, 'city owner'),
    originalOwner: int(data.originalOwner, -1, bounds.polities - 1, 'city original owner'),
    pop: int(data.pop, 1, CITY.maxPop, 'city population'),
    food: num(data.food, 0, BIG, 'city food'),
    hp: num(data.hp, 0, 100_000, 'city hp'),
    focus: oneOf<Focus>(data.focus, FOCUSES, 'city focus'),
    buildings,
    queue: list(data.queue, 'city queue', 256).map((item) => buildItem(item, bounds)),
    progress: num(data.progress, 0, BIG, 'city progress'),
    unrest: int(data.unrest, 0, MAX_TURNS, 'city unrest'),
    morale: num(data.morale, 0, 100, 'city morale'),
    struck: bool(data.struck, 'city struck'),
    airStruck: bool(data.airStruck, 'city air struck'),
    attackedOn: int(data.attackedOn, 0, MAX_TURNS, 'city attacked on'),
    worked: list(data.worked, 'worked hexes', bounds.hexes).map((hex) => int(hex, 0, bounds.hexes - 1, 'worked hex')),
    yields: yields(data.yields, 'city yields'),
  };
}

function unit(value: unknown, bounds: Bounds): Unit {
  const data = record(value, 'unit');
  const type = unitType(data.type, 'unit type');
  return {
    id: int(data.id, 1, Number.MAX_SAFE_INTEGER, 'unit id'),
    type,
    owner: int(data.owner, -1, bounds.polities - 1, 'unit owner'),
    hex: int(data.hex, 0, bounds.hexes - 1, 'unit hex'),
    hp: num(data.hp, 0, 100, 'unit hp'),
    moves: num(data.moves, 0, unitDef(type).moves, 'unit moves'),
    xp: num(data.xp, 0, BIG, 'unit xp'),
    level: int(data.level, 0, 3, 'unit level'),
    status: oneOf(data.status, STATUSES, 'unit status'),
    acted: bool(data.acted, 'unit acted'),
  };
}

function polity(value: unknown, bounds: Bounds): PolityState {
  const data = record(value, 'polity');
  const techs = list(data.techs, 'techs', TECH_IDS.length).map((tech) => oneOf<TechId>(tech, TECH_IDS, 'tech'));
  if (new Set(techs).size !== techs.length) fail('tech listed twice');
  return {
    alive: bool(data.alive, 'polity alive'),
    gold: num(data.gold, -BIG, BIG, 'gold'),
    grossIncome: num(data.grossIncome, 0, BIG, 'gross income'),
    science: num(data.science, 0, BIG, 'science'),
    culture: num(data.culture, 0, BIG, 'culture'),
    techs,
    research: data.research === null ? null : oneOf<TechId>(data.research, TECH_IDS, 'research'),
    researchProgress: num(data.researchProgress, 0, BIG, 'research progress'),
    era: int(data.era, 0, ERAS.length - 1, 'polity era'),
    projectStage: int(data.projectStage, 0, PROJECT.stages.length, 'project stage'),
    tradeRoutes: int(data.tradeRoutes, 0, MAX_TURNS, 'trade routes'),
    landPorts: bool(data.landPorts, 'land ports'),
    seaExits: bool(data.seaExits, 'sea exits'),
    yields: yields(data.yields, 'polity yields'),
    upkeep: num(data.upkeep, 0, BIG, 'upkeep'),
    warWeariness: num(data.warWeariness, 0, 1000, 'war weariness'),
    settlersBuilt: int(data.settlersBuilt, 0, MAX_TURNS, 'settlers built'),
    capital: int(data.capital, -1, bounds.zones - 1, 'capital'),
    aiTarget: int(data.aiTarget, -1, bounds.zones - 1, 'ai target'),
  };
}

function relations(value: unknown, bounds: Bounds): Record<string, Relation> {
  const out: Record<string, Relation> = {};
  for (const [key, entry] of Object.entries(record(value, 'relations'))) {
    const data = record(entry, 'relation');
    const b = int(data.b, 1, bounds.polities - 1, 'relation b');
    const a = int(data.a, 0, b - 1, 'relation a');
    if (key !== `${a}:${b}`) fail('relation key');
    out[key] = {
      a,
      b,
      atWar: bool(data.atWar, 'relation at war'),
      since: int(data.since, 0, MAX_TURNS, 'relation since'),
      offerA: int(data.offerA, 0, MAX_TURNS, 'relation offer'),
      offerB: int(data.offerB, 0, MAX_TURNS, 'relation offer'),
    };
  }
  return out;
}

function improvements(value: unknown, bounds: Bounds): Record<string, ImprovementId> {
  const out: Record<string, ImprovementId> = {};
  for (const [key, id] of Object.entries(record(value, 'improvements'))) {
    const hex = Number(key);
    if (String(hex) !== key) fail('improvement key');
    int(hex, 0, bounds.hexes - 1, 'improvement hex');
    out[key] = oneOf<ImprovementId>(id, IMPROVEMENT_IDS, 'improvement');
  }
  return out;
}

function result(value: unknown, bounds: Bounds): GameResult | null {
  if (value === null) return null;
  const data = record(value, 'result');
  return {
    kind: oneOf(data.kind, ['conquest', 'science', 'economic'] as const, 'result kind'),
    winner: int(data.winner, 0, bounds.polities - 1, 'winner'),
    turn: int(data.turn, 1, MAX_TURNS, 'result turn'),
  };
}

function stats(value: unknown): GameStats {
  const data = record(value, 'stats');
  return {
    citiesCaptured: int(data.citiesCaptured, 0, BIG, 'stats'),
    citiesFounded: int(data.citiesFounded, 0, BIG, 'stats'),
    warsDeclared: int(data.warsDeclared, 0, BIG, 'stats'),
    politiesAnnexed: int(data.politiesAnnexed, 0, BIG, 'stats'),
  };
}

/** The state in `data`, rebuilt field by field in the rules' own field order. */
function rebuild(data: Json, map: MapData): GameState {
  const bounds: Bounds = { hexes: map.width * map.height, zones: map.zones.length, polities: map.polities.length };

  const lastTurn = int(data.lastTurn, 1, MAX_TURNS, 'last turn');
  const majors = list(data.majors, 'majors', bounds.polities).map((entry) => int(entry, 0, bounds.polities - 1, 'major'));
  if (majors.some((major, i) => i > 0 && major <= (majors[i - 1] as number))) fail('majors order');

  const polities = list(data.polities, 'polities', bounds.polities).map((entry) => polity(entry, bounds));
  if (polities.length !== bounds.polities) fail('polity count');
  const zoneOwner = list(data.zoneOwner, 'zone owners', bounds.zones).map((entry) =>
    int(entry, -1, bounds.polities - 1, 'zone owner'),
  );
  if (zoneOwner.length !== bounds.zones) fail('zone owner count');
  const cities = list(data.cities, 'cities', bounds.zones).map((entry, zone) => city(entry, zone, bounds));
  if (cities.length !== bounds.zones) fail('city count');

  const units = list(data.units, 'units').map((entry) => unit(entry, bounds));
  const nextUnitId = int(data.nextUnitId, 1, Number.MAX_SAFE_INTEGER, 'next unit id');
  if (new Set(units.map((entry) => entry.id)).size !== units.length) fail('unit id used twice');
  if (new Set(units.map((entry) => entry.hex)).size !== units.length) fail('two units on one hex');
  if (units.some((entry) => entry.id >= nextUnitId)) fail('next unit id');

  return {
    map,
    version: STATE_VERSION,
    turn: int(data.turn, 1, lastTurn, 'turn'),
    lastTurn,
    seed: int(data.seed, 0, UINT32, 'seed'),
    rng: int(data.rng, 0, UINT32, 'rng'),
    player: int(data.player, -1, bounds.polities - 1, 'player'),
    majors,
    polities,
    zoneOwner,
    cities,
    units,
    nextUnitId,
    improvements: improvements(data.improvements, bounds),
    relations: relations(data.relations, bounds),
    stats: stats(data.stats),
    result: result(data.result, bounds),
  };
}

/**
 * Reads a save for a game on `map`. The text is only ever parsed as JSON;
 * anything that is not a well-formed save of this version for this map is
 * refused with the reason.
 */
export function importSave(text: string, map: MapData): ImportResult {
  if (text.length > MAX_SAVE_BYTES) return { ok: false, error: 'tooLarge' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'notJson' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: 'notASave' };
  const data = parsed as Json;
  if (data.format !== 'shanhe-save') return { ok: false, error: 'notASave' };
  if (data.version !== STATE_VERSION) return { ok: false, error: 'badVersion' };
  const size = [map.width, map.height, map.zones.length, map.polities.length];
  const saved: unknown = data.mapSize;
  if (!Array.isArray(saved) || saved.length !== size.length || size.some((n, i) => saved[i] !== n)) {
    return { ok: false, error: 'wrongMap' };
  }
  try {
    return { ok: true, state: rebuild(data, map) };
  } catch (error) {
    if (error instanceof Corrupt) return { ok: false, error: 'corrupt' };
    throw error;
  }
}
