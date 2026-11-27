/**
 * Research: what a polity knows, what that costs and unlocks, the strategic
 * resources it can draw on, and the tech set of the polities that do not
 * research.
 */

import { NO_RESOURCE } from '../shared/mapData.ts';
import {
  AI,
  ERAS,
  PROJECT,
  RESEARCH,
  ROSTER,
  SETTLER,
  STRATEGIC_RESOURCES,
  TECHS,
  TECH_IDS,
  isTechId,
  unitDef,
} from './data.ts';
import type { TechId, UnitDef } from './data.ts';
import { at, atWar, polityOf, seaLevelOf } from './context.ts';
import type { Ctx } from './context.ts';
import { NO_POLITY } from './types.ts';
import type { GameState, RejectReason, Unit } from './types.ts';

// ------------------------------------------------------------- who and what

/** True if the polity researches for itself: a major nation or the player. Everybody else follows the world. */
export function researches(state: GameState, polity: number): boolean {
  return polity === state.player || state.majors.includes(polity);
}

/** The living polities that research, ascending. */
export function researchers(state: GameState): number[] {
  const list: number[] = [];
  state.polities.forEach((polity, index) => {
    if (polity.alive && researches(state, index)) list.push(index);
  });
  return list;
}

export function knows(ctx: Ctx, polity: number, tech: TechId | null): boolean {
  if (tech === null) return true;
  return polity !== NO_POLITY && polityOf(ctx, polity).techs.includes(tech);
}

/** Index into `ERAS` of the polity's era. Tribes stay in the first. */
export function eraOf(ctx: Ctx, polity: number): number {
  return polity === NO_POLITY ? 0 : polityOf(ctx, polity).era;
}

/**
 * The era of the game as a whole: the player's, or that of the most advanced
 * living major nation when nobody plays.
 */
export function worldEra(state: GameState): number {
  if (state.player !== NO_POLITY) return at(state.polities, state.player).era;
  let era = 0;
  for (const major of state.majors) {
    const polity = at(state.polities, major);
    if (polity.alive) era = Math.max(era, polity.era);
  }
  return era;
}

// ------------------------------------------------------------------- cost

/**
 * Science `polity` needs for `tech`: the tech's cost, less the catch-up
 * discount when any other living polity already knows it.
 */
export function techCost(state: GameState, polity: number, tech: TechId): number {
  const def = TECHS[tech];
  const known = state.polities.some((other, index) => index !== polity && other.alive && other.techs.includes(tech));
  return known ? Math.ceil((def.cost * (100 - RESEARCH.catchUpPercent)) / 100) : def.cost;
}

/** Why `polity` cannot research `tech` now, or null. */
export function checkResearch(ctx: Ctx, polity: number, tech: unknown): RejectReason | null {
  if (!isTechId(tech)) return 'badItem';
  if (!researches(ctx.state, polity)) return 'doesNotResearch';
  const self = polityOf(ctx, polity);
  if (self.techs.includes(tech)) return 'alreadyKnown';
  const def = TECHS[tech];
  if (def.era > self.era) return 'eraTooEarly';
  return def.requires.every((id) => self.techs.includes(id)) ? null : 'missingPrerequisite';
}

/** The techs `polity` could research now, in table order. */
export function openTechs(ctx: Ctx, polity: number): TechId[] {
  return TECH_IDS.filter((tech) => checkResearch(ctx, polity, tech) === null);
}

// --------------------------------------------------------------- learning

/**
 * Adds a tech to what the polity knows, records what it opens, and moves the
 * polity into the next era once it knows enough techs of its current one.
 */
export function learnTech(ctx: Ctx, polity: number, tech: TechId): void {
  const self = polityOf(ctx, polity);
  if (self.techs.includes(tech)) return;
  self.techs.push(tech);
  const def = TECHS[tech];
  self.tradeRoutes += def.tradeRoutes ?? 0;
  if (def.ports === 'land') self.landPorts = true;
  if (def.ports === 'sea') self.seaExits = true;
  ctx.seaLevel[polity] = seaLevelOf(self);
  while (self.era < ERAS.length - 1) {
    const known = self.techs.filter((id) => TECHS[id].era === self.era).length;
    if (known < RESEARCH.techsToAdvance) break;
    self.era++;
    ctx.events.push({ type: 'eraEntered', polity, era: self.era });
  }
}

// -------------------------------------------------------------- resources

/** True if a source of the resource lies in the polity's territory and the polity can see it. */
export function hasResource(ctx: Ctx, polity: number, resource: string): boolean {
  if (polity === NO_POLITY) return false;
  const reveal = STRATEGIC_RESOURCES[resource];
  if (reveal !== undefined && !knows(ctx, polity, reveal)) return false;
  const index = ctx.map.resources.findIndex((entry) => entry.id === resource);
  if (index < 0) return false;
  for (const hex of at(ctx.topo.resourceHexes, index)) {
    // Territory: the hexes of its zones, and the water their cities work.
    const zone = (ctx.map.zone[hex] as number) >= 0 ? (ctx.map.zone[hex] as number) : (ctx.topo.workZone[hex] as number);
    if (zone >= 0 && ctx.state.zoneOwner[zone] === polity) return true;
  }
  return false;
}

/**
 * The resource `polity` sees on a hex, as an index into `map.resources`, or
 * `NO_RESOURCE`. A strategic resource stays hidden until its tech is known.
 */
export function visibleResource(state: GameState, polity: number, hex: number): number {
  const index = state.map.resource[hex];
  if (index === undefined || index < 0) return NO_RESOURCE;
  const reveal = STRATEGIC_RESOURCES[at(state.map.resources, index).id];
  if (reveal === undefined) return index;
  return polity !== NO_POLITY && at(state.polities, polity).techs.includes(reveal) ? index : NO_RESOURCE;
}

// ------------------------------------------------------------------ units

/** Why `polity` cannot build or upgrade to the unit type, or null. Coasts and cities are not checked. */
export function checkUnit(ctx: Ctx, polity: number, def: UnitDef): RejectReason | null {
  if (!def.buildable) return 'badItem';
  if (def.id === SETTLER && eraOf(ctx, polity) < def.era) return 'eraTooEarly';
  if (!knows(ctx, polity, def.tech)) return 'needsTech';
  if (def.resource !== null && !hasResource(ctx, polity, def.resource)) return 'needsResource';
  return null;
}

/** The most modern unit of the class that `polity` can build, or null. */
export function bestUnit(ctx: Ctx, polity: number, unitClass: keyof typeof ROSTER): UnitDef | null {
  const roster = ROSTER[unitClass];
  for (let era = roster.length - 1; era >= 0; era--) {
    const def = unitDef(at(roster, era));
    if (checkUnit(ctx, polity, def) === null) return def;
  }
  return null;
}

/**
 * The unit a unit upgrades to: the nearest later unit of its class that its
 * owner can build, or null. A unit whose next step needs a resource the
 * owner lacks skips that step.
 */
export function upgradeTargetFor(ctx: Ctx, unit: Unit): UnitDef | null {
  const def = unitDef(unit.type);
  if (def.unitClass === 'civilian' || def.unitClass === 'tribe') return null;
  const roster = ROSTER[def.unitClass];
  for (let era = def.era + 1; era < roster.length; era++) {
    const target = unitDef(at(roster, era));
    if (checkUnit(ctx, unit.owner, target) === null) return target;
  }
  return null;
}

// -------------------------------------------------------- research choice

/** The first tech `polity` still lacks for the stages of the project it has not built, or null. */
function nextProjectTech(ctx: Ctx, polity: number): TechId | null {
  const self = polityOf(ctx, polity);
  for (let stage = self.projectStage; stage < PROJECT.stages.length; stage++) {
    const tech = at(PROJECT.stages, stage).tech;
    if (!self.techs.includes(tech)) return tech;
  }
  return null;
}

/**
 * True if the polity goes for the Science victory: it has started the
 * project, or it has gathered more science than every other researching
 * nation.
 */
export function pursuesScience(ctx: Ctx, polity: number): boolean {
  const { state } = ctx;
  if (!researches(state, polity) || at(ctx.map.polities, polity).kind !== 'nation') return false;
  const self = polityOf(ctx, polity);
  if (self.projectStage > 0) return true;
  for (const other of researchers(state)) {
    if (other === polity) continue;
    const science = polityOf(ctx, other).science;
    if (science > self.science || (science === self.science && other < polity)) return false;
  }
  return true;
}

/**
 * The tech the AI researches next, or null when nothing is open. It is also
 * what a player who has chosen nothing gets.
 *
 * The oldest era still open comes first. Within it military techs lead at
 * war and science and economy techs at peace. A polity that goes for the
 * Science victory takes the project's techs as soon as they are open.
 */
export function suggestResearch(ctx: Ctx, polity: number): TechId | null {
  const open = openTechs(ctx, polity);
  if (open.length === 0) return null;
  if (pursuesScience(ctx, polity)) {
    const wanted = nextProjectTech(ctx, polity);
    if (wanted !== null && open.includes(wanted)) return wanted;
  }
  let fighting = false;
  for (let other = 0; other < ctx.n && !fighting; other++) fighting = other !== polity && atWar(ctx, polity, other);
  const weights = fighting ? AI.researchAtWar : AI.researchAtPeace;
  let coastal = false;
  for (const city of ctx.state.cities) {
    if (city !== null && city.owner === polity && ctx.topo.coastal[city.zone] === true) coastal = true;
  }
  const oldest = Math.min(...open.map((tech) => TECHS[tech].era));
  let best: TechId | null = null;
  let bestScore = -Infinity;
  for (const tech of open) {
    const def = TECHS[tech];
    const kind = def.kind === 'naval' && coastal ? 'economy' : def.kind;
    const score = weights[kind] - AI.researchEraStep * (def.era - oldest);
    if (score > bestScore) {
      bestScore = score;
      best = tech;
    }
  }
  return best;
}

// --------------------------------------------------------- turn processing

/**
 * One turn of research. Every researching polity adds its science of the
 * turn to its store and learns its tech when the store covers the cost, one
 * tech per turn. A player who has chosen nothing gets the AI's choice.
 */
export function processResearch(ctx: Ctx): void {
  const { state } = ctx;
  for (const polity of researchers(state)) {
    const self = polityOf(ctx, polity);
    if (self.research !== null && checkResearch(ctx, polity, self.research) !== null) self.research = null;
    if (self.research === null && polity === state.player) self.research = suggestResearch(ctx, polity);
    self.researchProgress += self.yields.science;
    if (self.research === null) continue;
    const cost = techCost(state, polity, self.research);
    if (self.researchProgress < cost) continue;
    const tech = self.research;
    self.researchProgress -= cost;
    self.research = null;
    learnTech(ctx, polity, tech);
    ctx.events.push({ type: 'researchFinished', polity, tech });
  }
}

/**
 * The polities on the simplified AI do not research: they know a tech once
 * the set share of the living researching nations does.
 */
export function followWorld(ctx: Ctx): void {
  const { state } = ctx;
  const leaders = researchers(state);
  if (leaders.length === 0) return;
  const needed = Math.max(1, Math.ceil(leaders.length * RESEARCH.followShare));
  const common = TECH_IDS.filter(
    (tech) => leaders.filter((polity) => polityOf(ctx, polity).techs.includes(tech)).length >= needed,
  );
  if (common.length === 0) return;
  state.polities.forEach((polity, index) => {
    if (!polity.alive || researches(state, index)) return;
    for (const tech of common) if (!polity.techs.includes(tech)) learnTech(ctx, index, tech);
  });
}
