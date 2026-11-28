/**
 * AI v1. Deterministic: it reads only the state, breaks ties by index and
 * keeps its one piece of memory (`PolityState.aiTarget`) in the state. Every
 * decision is issued as an action through the same validator a player uses.
 *
 * - Major nations research, develop, found their cities, keep an army their
 *   income can pay for, declare war on a weaker neighbour (by land or across
 *   the sea), march on one city at a time and make peace when the war goes
 *   badly. The one that leads in science builds the endgame project.
 * - Other nations and city-states develop and defend with the techs the
 *   world has in common.
 * - Every nation with a coast keeps warships in proportion to its coastal
 *   cities and to the threats at sea; at war they go with the embarked army
 *   or to the waters of the city it marches on, and fight what they meet.
 *   Units afloat that are held up step aside, so a landing spreads out.
 * - A leader's personality (`PERSONALITIES` in `kits.ts`) bends the weights:
 *   when to go to war, what to build and research first, which routes and
 *   agreements to seek, how large a navy to keep.
 */

import { hexRange, indexToOffset } from '../shared/hex.ts';
import { Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import {
  AI,
  AIR_STRIKE,
  BALANCE,
  BUILDINGS,
  BUILDING_IDS,
  buildingFor,
  isCityProject,
  POLICY_IDS,
  TECH_IDS,
  CITY,
  CITY_STATE,
  DIPLOMACY,
  FOCUS_WEIGHTS,
  FREE_UNITS_PER_CITY,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  improvementFor,
  POLICIES,
  PROJECT,
  ROSTER,
  SETTLER,
  supplyLimitFor,
  supplySurcharge,
  TRADE,
  UNIT_UPKEEP,
  WAR,
  unitDef,
} from './data.ts';
import type { BuildingId, CityProjectId, ImprovementDef, PolicyId } from './data.ts';
import { buyCost, checkStep, isSettleSite, militaryStrength, upgradePrice, validate } from './actions.ts';
import {
  canImprove,
  checkItem,
  cityProjectOf,
  hasBuilding,
  improvableHexes,
  itemCost,
  productionTowards,
  spawnHex,
} from './cities.ts';
import {
  amphibiousFactor,
  attackStrength,
  checkDemandVassalage,
  cityStrength,
  combatDamage,
  defenceStrength,
  hexesApart,
} from './combat.ts';
import { at, atWar, bordersOpen, cityAtHex, ownerOf, polityOf, relationOf, terrainAllows } from './context.ts';
import type { Ctx } from './context.ts';
import { dealPriceFrom, wantsResource } from './diplomacy.ts';
import { canSee, knowsCity } from './fog.ts';
import { AMBITION_STYLES, ambitionOf, styleFor } from './kits.ts';
import { balanceOfPower, boundTo } from './power.ts';
import type { Ambition, Personality } from './kits.ts';
import { nationOf } from './modifiers.ts';
import { openPolicies } from './policies.ts';
import { alliesOf, enemiesOf, favourOf, isNation, overlordOf, partnersIn, vassalsOf } from './relations.ts';
import { bestUnit, knows, ownsResource, pursuesScience, researches, suggestResearch, upgradeTargetFor } from './tech.ts';
import { checkPillage, checkRouteTarget, routeIncome, routeSlots, routesOf } from './trade.ts';
import { capitalsHeld } from './turn.ts';
import { NO_POLITY } from './types.ts';
import type { Action, BuildItem, City, RejectReason, RouteTarget, Unit } from './types.ts';

/** Applies an action if it is legal and says whether it was. */
export type Act = (action: Action) => boolean;

const UNREACHABLE = 32767;
/** Path costs beyond this are not explored. */
const PATH_LIMIT = 60;
/** Cost of a water hex on a land unit's path: crossing is possible but not preferred. */
const WATER_PATH_COST = 3;
/** Added to a hex on an army's path where somebody else's unit stands in the way: the army goes round. */
const BLOCKED_PATH_COST = 6;

function isMilitary(unit: Unit): boolean {
  const def = unitDef(unit.type);
  return def.strength > 0 && def.domain === 'land';
}

function isWarship(unit: Unit): boolean {
  const def = unitDef(unit.type);
  return def.strength > 0 && def.domain === 'sea';
}

/** What the polity's leader is out to win in this game. */
export function ambition(ctx: Ctx, polity: number): Ambition {
  return ambitionOf(ctx.state.seed, polity, nationOf(ctx, polity));
}

/** The style of the polity's leader: its personality, bent by its ambition in this game. */
function styleOf(ctx: Ctx, polity: number): Personality {
  return styleFor(nationOf(ctx, polity), ambition(ctx, polity));
}

// ----------------------------------------------------------------- the sea

const seaCache = new WeakMap<MapData, Map<number, readonly number[]>>();

/**
 * The zones whose city site lies within `AI.seaReach` hexes by water of the
 * site of `zone`: its neighbours by sea. It depends on the map alone.
 *
 * @param ocean cross ocean too; otherwise only coast and lake.
 */
export function seaNeighbours(ctx: Ctx, zone: number, ocean: boolean): readonly number[] {
  let cache = seaCache.get(ctx.map);
  if (cache === undefined) {
    cache = new Map();
    seaCache.set(ctx.map, cache);
  }
  const key = zone * 2 + (ocean ? 1 : 0);
  const known = cache.get(key);
  if (known !== undefined) return known;
  const { topo, map } = ctx;
  const sails = (hex: number): boolean =>
    topo.enterable[hex] === 1 && topo.water[hex] === 1 && (ocean || map.terrain[hex] !== Terrain.Ocean);
  const seen = new Set<number>();
  const found = new Set<number>();
  let frontier: number[] = [];
  const visit = (hex: number, into: number[]): void => {
    for (let d = 0; d < 6; d++) {
      const next = topo.neighbors[hex * 6 + d] as number;
      if (next < 0) continue;
      const site = topo.siteZone[next] as number;
      if (site >= 0 && site !== zone) found.add(site);
      if (seen.has(next) || !sails(next)) continue;
      seen.add(next);
      into.push(next);
    }
  };
  visit(at(map.zones, zone).siteHex, frontier);
  found.clear();
  for (let depth = 1; depth < AI.seaReach && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const hex of frontier) visit(hex, next);
    frontier = next;
  }
  for (const hex of frontier) visit(hex, []);
  const list = [...found].sort((a, b) => a - b);
  cache.set(key, list);
  return list;
}

/** True if no city of `cities` stands on the landmass of `zone`: an army can only get there by sea. */
export function overseas(ctx: Ctx, zone: number, cities: readonly City[]): boolean {
  const mass = ctx.topo.landmass[at(ctx.map.zones, zone).siteHex];
  return !cities.some((city) => ctx.topo.landmass[at(ctx.map.zones, city.zone).siteHex] === mass);
}

/**
 * Steps a ship of `polity` needs to reach one of `goals` (water hexes) from
 * every water hex in reach. `UNREACHABLE` where there is no way within `limit`.
 */
function seaField(ctx: Ctx, polity: number, goals: Iterable<number>, limit = PATH_LIMIT): Int16Array {
  const { topo } = ctx;
  const ship = unitDef(at(ROSTER.naval, 0));
  const cost = new Int16Array(topo.count).fill(UNREACHABLE);
  let frontier: number[] = [];
  for (const goal of goals) {
    if (cost[goal] === 0 || topo.water[goal] !== 1) continue;
    cost[goal] = 0;
    frontier.push(goal);
  }
  for (let depth = 1; depth <= limit && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const hex of frontier) {
      for (let d = 0; d < 6; d++) {
        const to = topo.neighbors[hex * 6 + d] as number;
        if (to < 0 || cost[to] !== UNREACHABLE || !terrainAllows(ctx, ship, to, polity)) continue;
        cost[to] = depth;
        next.push(to);
      }
    }
    frontier = next;
  }
  return cost;
}

/** The water hexes next to `hex`. */
function watersBy(ctx: Ctx, hex: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 6; d++) {
    const next = ctx.topo.neighbors[hex * 6 + d] as number;
    if (next >= 0 && ctx.topo.water[next] === 1 && ctx.topo.enterable[next] === 1) out.push(next);
  }
  return out;
}

/** Runs one polity's whole turn. */
export function runAi(ctx: Ctx, polity: number, act: Act): void {
  const { state, map } = ctx;
  const cities = state.cities.filter((city): city is City => city !== null && city.owner === polity);
  if (cities.length === 0) return;
  const kind = at(map.polities, polity).kind;
  const major = kind === 'nation' && state.majors.includes(polity);

  chooseResearch(ctx, polity, act);
  if (kind === 'nation') choosePolicies(ctx, polity, act);
  diplomacy(ctx, polity, major, cities, act);
  if (major) {
    statecraft(ctx, polity, cities, act);
    openRoutes(ctx, polity, cities, act);
    buyDefenders(ctx, polity, cities, act);
  }
  manageCities(ctx, polity, major, cities, act);
  if (major) spendGold(ctx, polity, cities, act);
  airStrikes(ctx, polity, cities, act);
  commandUnits(ctx, polity, major, cities, act);
}

// --------------------------------------------------------------- research

function chooseResearch(ctx: Ctx, polity: number, act: Act): void {
  if (!researches(ctx.state, polity) || polityOf(ctx, polity).research !== null) return;
  const tech = suggestResearch(ctx, polity);
  if (tech !== null) act({ type: 'setResearch', polity, tech });
}

// ------------------------------------------------------------ air strikes

/** Every airfield strikes the enemy unit it hurts most, or failing that an enemy city that still stands. */
function airStrikes(ctx: Ctx, polity: number, cities: City[], act: Act): void {
  const { map } = ctx;
  for (const city of cities) {
    if (city.airStruck || !hasBuilding(city, (building) => building.airStrike)) continue;
    let best = -1;
    let bestScore = 0;
    for (const offset of hexRange(indexToOffset(at(map.zones, city.zone).siteHex, map.width), AIR_STRIKE.range)) {
      if (offset.col < 0 || offset.col >= map.width || offset.row < 0 || offset.row >= map.height) continue;
      const hex = offset.row * map.width + offset.col;
      if (validate(ctx, { type: 'airStrike', polity, city: city.zone, target: hex }) !== null) continue;
      const enemyCity = cityAtHex(ctx, hex);
      let score: number;
      if (enemyCity !== null && enemyCity.owner !== polity) {
        score = enemyCity.hp > 0 ? 50 : 0;
      } else {
        const defender = ctx.unitAt.get(hex);
        if (defender === undefined || defender.owner === NO_POLITY) continue;
        const dealt = combatDamage(AIR_STRIKE.strength, defenceStrength(ctx, defender), 1);
        score = 100 + Math.min(dealt, defender.hp) + (dealt >= defender.hp ? 100 : 0);
      }
      if (score > bestScore) {
        bestScore = score;
        best = hex;
      }
    }
    if (best >= 0) act({ type: 'airStrike', polity, city: city.zone, target: best });
  }
}

// -------------------------------------------------------------- diplomacy

function diplomacy(ctx: Ctx, polity: number, major: boolean, cities: City[], act: Act): void {
  const { state, topo, map } = ctx;
  const self = polityOf(ctx, polity);
  const strength = militaryStrength(ctx, polity);
  const enemies = enemiesOf(ctx, polity);

  const conquering = major && ambition(ctx, polity) === 'conquest';
  const marchingOn = self.aiTarget >= 0 ? (state.cities[self.aiTarget]?.owner ?? NO_POLITY) : NO_POLITY;
  for (const enemy of enemies) {
    const relation = relationOf(ctx, polity, enemy);
    if (relation === undefined || state.turn - relation.since < WAR.minTurns) continue;
    // A war in which the enemy keeps losing cities is no stalemate.
    const progress = Math.max(relation.since, polityOf(ctx, enemy).cityLostOn);
    const losing =
      self.warWeariness >= (conquering ? AI.conquestPeaceWeariness : AI.peaceWeariness) ||
      state.turn - progress >= AI.stalemateTurns ||
      strength < militaryStrength(ctx, enemy) * AI.peaceStrengthRatio;
    // A leader out for conquest lets go of an enemy that holds no capital of a major nation and is not the one it marches on.
    const sideshow = conquering && enemy !== marchingOn && capitalsHeld(ctx, enemy) === 0;
    if (major && !losing && !sideshow) continue;
    // To the player it offers once: the offer stands for a while, and after it has lapsed it waits as long again.
    const offered = relation.a === polity ? relation.offerA : relation.offerB;
    if (enemy === state.player && (offered > 0 || (offered < 0 && state.turn + offered < DIPLOMACY.offerTurns))) continue;
    act({ type: 'makePeace', polity, target: enemy });
  }

  if (!major || state.turn < AI.firstWarTurn || enemiesOf(ctx, polity).length > 0) return;
  if (self.overlord !== NO_POLITY) return;

  // Whoever it could march on: the nations whose land its armies can reach, with war on a vassal declared on its overlord.
  const vassals = vassalsOf(ctx, polity);
  const reach = (through: readonly number[]): Set<number> => {
    const neighbours = new Set<number>();
    for (const city of state.cities) {
      if (city === null || !through.includes(city.owner)) continue;
      for (const zone of at(topo.zoneNeighbors, city.zone)) {
        const owner = at(state.zoneOwner, zone);
        if (owner !== NO_POLITY) neighbours.add(owner);
      }
    }
    // Once its units can embark, the cities across the water are neighbours too.
    const seaLevel = ctx.seaLevel[polity] as number;
    if (seaLevel >= 1) {
      for (const city of cities) {
        if (topo.coastal[city.zone] !== true) continue;
        for (const zone of seaNeighbours(ctx, city.zone, seaLevel >= 2)) {
          const owner = at(state.zoneOwner, zone);
          if (owner !== NO_POLITY && state.cities[zone] !== null) neighbours.add(owner);
        }
      }
    }
    const foes = new Set<number>();
    for (const other of neighbours) {
      const lord = overlordOf(ctx, other);
      const foe = lord === NO_POLITY ? other : lord;
      if (foe !== polity && !vassals.includes(foe)) foes.add(foe);
    }
    return foes;
  };
  /** What stands against an attack on `other`: its army, those of its allies and vassals, and its cities. */
  const defenceOf = (other: number): number => {
    let defence = militaryStrength(ctx, other);
    for (const friend of [...alliesOf(ctx, other), ...vassalsOf(ctx, other)]) defence += militaryStrength(ctx, friend);
    for (const city of state.cities) if (city !== null && city.owner === other) defence += cityStrength(ctx, city) / 2;
    return defence;
  };

  // The balance of power: whatever its ambition, it joins the war on a leader the world has come to fear,
  // once it dislikes it enough and the leader's enemies are together strong enough. Its allies' land is open to it.
  const balance = balanceOfPower(ctx);
  if (self.warWeariness <= AI.containmentWeariness) {
    const within = reach([polity, ...vassals, ...alliesOf(ctx, polity)]);
    let threat = -1;
    for (const other of [...within].sort((a, b) => a - b)) {
      if (at(balance.fear, other) < BALANCE.warAt || at(balance.fear, other) <= at(balance.fear, polity)) continue;
      if (boundTo(ctx, polity, other) || favourOf(ctx, polity, other) > BALANCE.warFavour) continue;
      if (validate(ctx, { type: 'declareWar', polity, target: other }) !== null) continue;
      if (threat < 0 || at(balance.fear, other) > at(balance.fear, threat)) threat = other;
    }
    if (threat >= 0) {
      let side = strength;
      for (const friend of [...alliesOf(ctx, polity), ...vassals]) side += militaryStrength(ctx, friend);
      for (const enemy of enemiesOf(ctx, threat)) {
        if (enemy !== polity && !vassals.includes(enemy) && !alliesOf(ctx, polity).includes(enemy)) side += militaryStrength(ctx, enemy);
      }
      if (side >= defenceOf(threat) * BALANCE.warRatio) {
        act({ type: 'declareWar', polity, target: threat });
        return;
      }
    }
  }

  // A leader out for learning or wealth starts no other wars.
  if (!AMBITION_STYLES[ambition(ctx, polity)].startsWars) return;
  // A leader out for conquest goes from one war to the next; an all-rounder waits until the last one is forgotten.
  const conqueror = ambition(ctx, polity) === 'conquest';
  if (self.warWeariness > (conqueror ? AI.conquestWeariness : 0)) return;
  let field = -cities.length;
  for (const unit of state.units) if (unit.owner === polity && isMilitary(unit)) field++;
  if (field < AI.minFieldUnits) return;

  // Its neighbours: whoever borders its land or that of its vassals, whose land its armies may cross.
  const foes = reach([polity, ...vassals]);
  const ratio = AI.warStrengthRatio * styleOf(ctx, polity).warRatio;
  /** How far the nearest capital of a major nation that `foe` holds lies from the polity's cities; Infinity if it holds none. */
  const prizeDistance = (foe: number): number => {
    let nearest = Infinity;
    for (const seat of state.majors) {
      const city = state.cities[at(map.polities, seat).capitalZone];
      if (city === undefined || city === null) continue;
      if (city.owner !== foe && overlordOf(ctx, city.owner) !== foe) continue;
      const site = at(map.zones, city.zone).siteHex;
      for (const own of cities) nearest = Math.min(nearest, hexesApart(ctx, site, at(map.zones, own.zone).siteHex));
    }
    return nearest;
  };
  let target = -1;
  let weakest = Infinity;
  let nearest = Infinity;
  let feared = 0;
  for (const other of [...foes].sort((a, b) => a - b)) {
    if (validate(ctx, { type: 'declareWar', polity, target: other }) !== null) continue;
    // Its allies and vassals would stand by it, and a friend is not attacked.
    if (favourOf(ctx, polity, other) >= AI.allianceFavour) continue;
    const defence = defenceOf(other);
    if (strength < defence * ratio) continue;
    // A leader the world fears comes first, the most feared first of all. Then the weakest it can beat;
    // a leader out for conquest first goes for the nearest capital of a major nation.
    const fear = at(balance.fear, other) > at(balance.fear, polity) && at(balance.fear, other) >= BALANCE.warAt ? at(balance.fear, other) : 0;
    const distance = conqueror ? prizeDistance(other) : Infinity;
    if (fear > feared || (fear === feared && (distance < nearest || (distance === nearest && defence < weakest)))) {
      feared = fear;
      nearest = distance;
      weakest = defence;
      target = other;
    }
  }
  if (target >= 0) act({ type: 'declareWar', polity, target });
}

// ---------------------------------------------------------------- policies

/** True if the card would do something for the polity as it stands now. */
function policyApplies(ctx: Ctx, polity: number, id: PolicyId): boolean {
  const def = POLICIES[id];
  if (def.allyStrengthPercent !== undefined || def.allyRouteMultiplier !== undefined) {
    return alliesOf(ctx, polity).length > 0;
  }
  if (def.tradePactGoldPercent !== undefined) return partnersIn(ctx, 'tradePact', polity).length > 0;
  if (def.seaRouteGold !== undefined) return routesOf(ctx, polity).some((route) => route.sea);
  if (def.tributePercent !== undefined || def.influencePercent !== undefined) {
    const courted = ctx.state.polities.some(
      (other) => other.alive && other.cityStateType !== null && (other.influence[polity] ?? 0) > 0,
    );
    return courted || (def.tributePercent !== undefined && vassalsOf(ctx, polity).length > 0);
  }
  return true;
}

/** How much the polity wants the card: by its kind at peace or at war, a little more for a later era, far less if it does nothing now. */
function policyScore(ctx: Ctx, polity: number, id: PolicyId, fighting: boolean): number {
  const def = POLICIES[id];
  const weights = fighting ? AI.policyAtWar : AI.policyAtPeace;
  const liking = styleOf(ctx, polity).policy[def.kind] ?? 0;
  return weights[def.kind] + liking + def.era * AI.policyEraWeight - (policyApplies(ctx, polity, id) ? 0 : 10);
}

/**
 * Unlocks the best card the polity can afford, fills its empty slots with
 * its best unlocked cards, and swaps a card out when a clearly better one is
 * waiting and the swap is free or the cooldown is over.
 */
function choosePolicies(ctx: Ctx, polity: number, act: Act): void {
  const self = polityOf(ctx, polity);
  const fighting = enemiesOf(ctx, polity).length > 0;
  const score = (id: PolicyId): number => policyScore(ctx, polity, id, fighting);
  const best = (list: readonly PolicyId[]): PolicyId | null => {
    let pick: PolicyId | null = null;
    for (const id of list) if (pick === null || score(id) > score(pick)) pick = id;
    return pick;
  };
  for (;;) {
    const policy = best(openPolicies(ctx, polity));
    if (policy === null || !act({ type: 'unlockPolicy', polity, policy })) break;
  }
  for (let guard = 0; guard < self.slots.length + 1; guard++) {
    const waiting = best(self.policies.filter((id) => !self.slots.includes(id)));
    if (waiting === null) return;
    let slot = self.slots.indexOf(null);
    if (slot < 0) {
      // No room: the weakest card makes way if the new one is clearly better.
      slot = 0;
      self.slots.forEach((id, index) => {
        const worst = at(self.slots, slot);
        if (id !== null && worst !== null && score(id) < score(worst)) slot = index;
      });
      const worst = at(self.slots, slot);
      if (worst === null || score(waiting) < score(worst) + 1) return;
    }
    if (!act({ type: 'slotPolicy', polity, policy: waiting, slot })) return;
  }
}

// -------------------------------------------------------------- statecraft

/** The nations whose land touches the polity's, ascending. */
function neighbourNations(ctx: Ctx, polity: number, cities: City[]): number[] {
  const found = new Set<number>();
  for (const city of cities) {
    for (const zone of at(ctx.topo.zoneNeighbors, city.zone)) {
      const owner = at(ctx.state.zoneOwner, zone);
      if (owner !== NO_POLITY && owner !== polity && isNation(ctx, owner)) found.add(owner);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Every few turns a major nation looks at its neighbours: it offers a trade
 * pact, open borders and an alliance where favour allows, takes a far weaker
 * one as a vassal, sells a resource a neighbour lacks, and courts the
 * nearest city-state with a gift. One of each per look. It writes to a human
 * player a third as often, so that a refusal is not repeated at once.
 */
function statecraft(ctx: Ctx, polity: number, cities: City[], act: Act): void {
  const { state, map } = ctx;
  if ((state.turn + polity) % AI.diplomacyInterval !== 0) return;
  const self = polityOf(ctx, polity);
  const style = styleOf(ctx, polity);
  const toPlayer = (state.turn + polity) % (AI.diplomacyInterval * 3) === 0;
  const neighbours = neighbourNations(ctx, polity, cities)
    .filter((other) => other !== state.player || toPlayer)
    .sort((a, b) => favourOf(ctx, polity, b) - favourOf(ctx, polity, a) || a - b);
  const first = (make: (target: number) => Action | null): void => {
    for (const target of neighbours) {
      const action = make(target);
      if (action !== null && act(action)) return;
    }
  };

  first((target) => ({ type: 'propose', polity, target, agreement: 'tradePact' }));
  first((target) =>
    favourOf(ctx, polity, target) >= AI.openBordersFavour + style.favour
      ? { type: 'propose', polity, target, agreement: 'openBorders' }
      : null,
  );
  if (self.overlord === NO_POLITY) {
    first((target) =>
      favourOf(ctx, polity, target) >= AI.allianceFavour + style.favour
        ? { type: 'propose', polity, target, agreement: 'alliance' }
        : null,
    );
    const places = vassalPlaces(ctx, polity) - (ambition(ctx, polity) === 'conquest' ? 1 : 0);
    if (vassalsOf(ctx, polity).length < AI.maxVassals && places > 0) {
      first((target) =>
        state.majors.includes(target) ? null : { type: 'propose', polity, target, agreement: 'vassalage' },
      );
    }
  }
  // A resource of its own for a neighbour that has a use for it.
  first((target) => {
    for (const resource of map.resources) {
      if (!ownsResource(ctx, polity, resource.id) || !wantsResource(ctx, target, resource.id)) continue;
      return {
        type: 'proposeDeal', polity, target, seller: polity, resource: resource.id,
        goldPerTurn: dealPriceFrom(ctx, polity, resource.id),
      };
    }
    return null;
  });

  // The nearest city-state at peace, until it is safely won.
  if (self.gold < AI.goldReserve + AI.giftGold || self.capital < 0) return;
  const home = at(map.zones, self.capital).siteHex;
  let nearest = -1;
  let nearestApart: number = AI.courtRange + 1;
  state.polities.forEach((other, index) => {
    if (!other.alive || other.cityStateType === null || other.capital < 0 || atWar(ctx, polity, index)) return;
    if (other.suzerain === polity && (other.influence[polity] ?? 0) >= CITY_STATE.suzerainInfluence + AI.giftGold) return;
    const apart = hexesApart(ctx, home, at(map.zones, other.capital).siteHex);
    if (apart < nearestApart) {
      nearestApart = apart;
      nearest = index;
    }
  });
  // A full treasury gives more.
  const rich = self.gold >= AI.goldReserve + AI.giftGold * AI.richGiftFactor * 2;
  if (nearest >= 0) act({ type: 'gift', polity, target: nearest, amount: rich ? AI.giftGold * AI.richGiftFactor : AI.giftGold });
}

/**
 * Fills one free route slot per turn with the destination that promises the
 * most: every city and open port in reach is rated by what a route of that
 * length would earn, and the best few are tried until one has a path.
 */
function openRoutes(ctx: Ctx, polity: number, cities: City[], act: Act): void {
  const { state, map } = ctx;
  const own = routesOf(ctx, polity);
  if (own.length >= routeSlots(ctx, polity)) return;
  const reach = Math.max(TRADE.landRange, TRADE.seaRange);
  const style = styleOf(ctx, polity);
  const options: { income: number; city: number; to: RouteTarget }[] = [];
  /** What the leader's style adds to a destination: another polity's city, or one over the sea. */
  const liking = (city: City, to: RouteTarget): number => {
    if (to.kind === 'port') return at(map.offMapPorts, to.port).kind === 'sea' ? style.routeSea : 0;
    const other = state.cities[to.zone];
    const foreign = other !== null && other !== undefined && other.owner !== polity ? style.routeForeign : 0;
    return foreign + (overseas(ctx, to.zone, [city]) ? style.routeSea : 0);
  };
  const rate = (city: City, to: RouteTarget, apart: number): void => {
    if (checkRouteTarget(ctx, polity, city.zone, to) !== null) return;
    if (own.some((route) => (to.kind === 'city' ? route.toCity === to.zone : route.toPort === to.port))) return;
    const income = liking(city, to) + routeIncome(ctx, {
      id: 0,
      owner: polity,
      from: city.zone,
      toCity: to.kind === 'city' ? to.zone : -1,
      toPort: to.kind === 'port' ? to.port : -1,
      sea: false,
      path: Array.from({ length: apart + 1 }, () => 0),
      income: 0,
      pillagedUntil: 0,
    });
    options.push({ income, city: city.zone, to });
  };
  for (const city of cities) {
    const site = at(map.zones, city.zone).siteHex;
    for (const other of state.cities) {
      if (other === null || other === city) continue;
      const apart = hexesApart(ctx, site, at(map.zones, other.zone).siteHex);
      if (apart <= reach) rate(city, { kind: 'city', zone: other.zone }, apart);
    }
    map.offMapPorts.forEach((port, index) => {
      const apart = hexesApart(ctx, site, port.hex);
      if (apart <= reach) rate(city, { kind: 'port', port: index }, apart);
    });
  }
  options.sort(
    (a, b) =>
      b.income - a.income ||
      a.city - b.city ||
      (a.to.kind === 'city' ? a.to.zone : 10000 + a.to.port) - (b.to.kind === 'city' ? b.to.zone : 10000 + b.to.port),
  );
  for (const option of options.slice(0, AI.routeTries)) {
    if (act({ type: 'establishRoute', polity, city: option.city, to: option.to })) return;
  }
}

/** At war, a city with an enemy at its gates and nobody inside buys the best infantry it can pay for. */
function buyDefenders(ctx: Ctx, polity: number, cities: City[], act: Act): void {
  if (enemiesOf(ctx, polity).length === 0) return;
  const { state, map } = ctx;
  for (const city of cities) {
    const site = at(map.zones, city.zone).siteHex;
    const holder = ctx.unitAt.get(site);
    if (holder !== undefined && holder.owner === polity && isMilitary(holder)) continue;
    const threatened = state.units.some(
      (unit) =>
        unit.owner !== NO_POLITY &&
        unit.owner !== polity &&
        atWar(ctx, polity, unit.owner) &&
        isMilitary(unit) &&
        hexesApart(ctx, unit.hex, site) <= AI.threatRange &&
        canSee(ctx, polity, unit.hex),
    );
    if (threatened) act({ type: 'buy', polity, city: city.zone, item: infantry(ctx, polity) });
  }
}

/**
 * A major nation does not sit on its gold: what is left above a reserve buys
 * what its cities are building, the slowest item first. A unit that was
 * bought leaves the queue, so the city does not build a second one.
 */
function spendGold(ctx: Ctx, polity: number, cities: City[], act: Act): void {
  const self = polityOf(ctx, polity);
  const reserve = AI.goldReserve + self.upkeep * AI.buyReserveTurns;
  const nation = nationOf(ctx, polity);
  const order = [...new Set([...(styleOf(ctx, polity).buildFirst as readonly BuildingId[]), ...AI.buildingOrder])].map(
    (building) => buildingFor(nation, building),
  );
  /** What gold would buy in the city: the unit or building it is working on, or else the next building of the order. */
  const wanted = (city: City): { item: BuildItem; queued: boolean } | null => {
    const current = city.queue[0];
    const real = current !== undefined && cityProjectOf(current) === null;
    if (real && (current.kind === 'unit' || current.kind === 'building')) return { item: current, queued: true };
    for (const building of order) {
      const item: BuildItem = { kind: 'building', building };
      if (checkItem(ctx, city, item) === null) return { item, queued: false };
    }
    return null;
  };
  const tried = new Set<number>();
  for (let bought = 0; bought < AI.buysPerTurn; ) {
    let best: { city: City; item: BuildItem; queued: boolean } | null = null;
    let longest: number = AI.buyMinTurns;
    for (const city of cities) {
      if (city.unrest > 0 || tried.has(city.zone)) continue;
      const want = wanted(city);
      if (want === null || buyCost(ctx, city, want.item) > self.gold - reserve) continue;
      const done = want.queued ? city.progress : 0;
      const turns = (itemCost(ctx, city, want.item) - done) / Math.max(1, productionTowards(ctx, city, want.item));
      if (turns > longest) {
        longest = turns;
        best = { city, ...want };
      }
    }
    if (best === null) return;
    tried.add(best.city.zone);
    if (!act({ type: 'buy', polity, city: best.city.zone, item: best.item })) continue;
    bought++;
    if (best.item.kind === 'unit') act({ type: 'unqueueBuild', polity, city: best.city.zone, index: 0 });
  }
}

/** Vassals `polity` could still take in its era. */
function vassalPlaces(ctx: Ctx, polity: number): number {
  return (DIPLOMACY.vassalsByEra[polityOf(ctx, polity).era] ?? 0) - vassalsOf(ctx, polity).length;
}

/**
 * True if the unit should demand vassalage at `target` instead of taking
 * the city: a fallen capital of a nation much weaker than its own, while it
 * still has room for vassals.
 */
function prefersVassal(ctx: Ctx, unit: Unit, target: number): boolean {
  const city = cityAtHex(ctx, target);
  if (city === null || city.hp > 0 || checkDemandVassalage(ctx, unit, target) !== null) return false;
  // A leader out for conquest wants the capitals of the major nations, and a vassal's capital counts at once.
  const conqueror = ambition(ctx, unit.owner) === 'conquest';
  if (conqueror && ctx.state.majors.includes(city.owner)) return true;
  if (vassalsOf(ctx, unit.owner).length >= AI.maxVassals) return false;
  // It keeps its last place for a holder of a capital.
  if (conqueror && vassalPlaces(ctx, unit.owner) <= 1) return false;
  // A fresh army takes the city; a weary one, or one with another war to fight, settles for a vassal.
  const weary = polityOf(ctx, unit.owner).warWeariness >= AI.vassalWeariness;
  if (!weary && enemiesOf(ctx, unit.owner).length < 2) return false;
  return militaryStrength(ctx, unit.owner) >= militaryStrength(ctx, city.owner) * AI.demandVassalRatio;
}

// ----------------------------------------------------------------- cities

interface Plans {
  /** Military land units, alive or queued. */
  military: number;
  /** Units the polity wants. */
  wanted: number;
  /** Units per class, alive or queued. */
  byClass: Record<string, number>;
  settler: boolean;
  atWar: boolean;
  /** One per city. */
  garrisons: number;
  /** Cities busy with a unit. At most half of them are, so that the others develop. */
  barracks: number;
  maxBarracks: number;
  /** Warships, alive or queued, and how many the polity wants. */
  navy: number;
  navyWanted: number;
  style: Personality;
}

function armyTarget(ctx: Ctx, polity: number, major: boolean, cities: City[]): number {
  const kind = at(ctx.map.polities, polity).kind;
  if (kind === 'cityState') return 1;
  // Nobody plans an army beyond its supply limit: the units past it cost far more than they are worth.
  let pop = 0;
  for (const city of cities) pop += city.pop;
  const limit = supplyLimitFor(cities.length, pop);
  // A nation on the simplified AI keeps a garrison in every city and a small field force.
  if (!major) return Math.min(limit, cities.length + AI.simpleFieldUnits);
  const free = FREE_UNITS_PER_CITY * cities.length;
  let buildingUpkeep = 0;
  for (const city of cities) for (const id of city.buildings) buildingUpkeep += BUILDINGS[id].upkeep;
  const spare = Math.max(0, polityOf(ctx, polity).yields.gold - buildingUpkeep);
  const affordable = free + Math.floor((spare * AI.armyIncomeShare * styleOf(ctx, polity).armyShare) / UNIT_UPKEEP);
  const style = AMBITION_STYLES[ambition(ctx, polity)];
  // At peace a leader keeps the share of the limit its ambition asks for, and never less than its garrisons and a guard.
  if (enemiesOf(ctx, polity).length === 0) {
    return Math.min(affordable, Math.max(Math.ceil(limit * style.peaceArmy), Math.min(limit, cities.length + AI.simpleFieldUnits)));
  }
  // At war it fills the limit, and a leader out for conquest pays for some units beyond it.
  let beyond = 0;
  while (supplySurcharge(beyond + 1) <= spare * style.overSupply) beyond++;
  return Math.min(affordable, limit + beyond);
}

/**
 * Warships the polity wants: in proportion to its coastal cities, more for
 * every enemy warship afloat and while its army marches on a city it can only
 * reach by sea, and never more than its share of the `budget` of units.
 */
function navyTarget(ctx: Ctx, polity: number, cities: City[], budget: number): number {
  const { state, topo } = ctx;
  const coastal = cities.filter((city) => topo.coastal[city.zone] === true).length;
  if (coastal === 0 || bestUnit(ctx, polity, 'naval') === null) return 0;
  let wanted = coastal * AI.shipsPerCoastalCity;
  for (const unit of state.units) {
    if (unit.owner === NO_POLITY || unit.owner === polity || !atWar(ctx, polity, unit.owner) || !isWarship(unit)) continue;
    // Only the ships it can see.
    if (canSee(ctx, polity, unit.hex)) wanted += AI.shipsPerEnemyShip;
  }
  const focus = polityOf(ctx, polity).aiTarget;
  if (focus >= 0 && state.cities[focus] !== null && overseas(ctx, focus, cities)) wanted += AI.shipsForSeaTarget;
  // One ship is always allowed beside the garrisons, so that a one-city island has a navy at all.
  const cap = Math.max(Math.min(1, budget - cities.length), Math.floor(budget * AI.navyShare));
  return Math.max(0, Math.min(Math.ceil(wanted * styleOf(ctx, polity).navy), cap));
}

function manageCities(ctx: Ctx, polity: number, major: boolean, cities: City[], act: Act): void {
  const budget = armyTarget(ctx, polity, major, cities);
  const navyWanted = at(ctx.map.polities, polity).kind === 'nation' ? navyTarget(ctx, polity, cities, budget) : 0;
  const plans: Plans = {
    military: 0,
    wanted: budget - navyWanted,
    byClass: {},
    settler: false,
    atWar: enemiesOf(ctx, polity).length > 0,
    garrisons: cities.length,
    barracks: 0,
    maxBarracks: Math.ceil(cities.length / 2),
    navy: 0,
    navyWanted,
    style: styleOf(ctx, polity),
  };
  const count = (type: string): void => {
    const def = unitDef(type);
    if (def.id === SETTLER) plans.settler = true;
    if (def.strength > 0 && def.domain === 'sea') plans.navy++;
    if (def.strength <= 0 || def.domain !== 'land') return;
    plans.military++;
    plans.byClass[def.unitClass] = (plans.byClass[def.unitClass] ?? 0) + 1;
  };
  const uncount = (type: string): void => {
    const def = unitDef(type);
    if (def.strength > 0 && def.domain === 'sea') plans.navy--;
    if (def.strength <= 0 || def.domain !== 'land') return;
    plans.military--;
    plans.byClass[def.unitClass] = (plans.byClass[def.unitClass] ?? 1) - 1;
    plans.barracks--;
  };
  for (const unit of ctx.state.units) if (unit.owner === polity) count(unit.type);
  for (const city of cities) {
    for (const item of city.queue) if (item.kind === 'unit') count(item.unit);
    if (city.queue[0]?.kind === 'unit') plans.barracks++;
  }

  // The most productive cities get the first pick, so they are the ones that recruit.
  const byProduction = [...cities].sort((a, b) => b.yields.production - a.yields.production || a.zone - b.zone);
  for (const city of byProduction) {
    manageFocus(polity, city, AMBITION_STYLES[ambition(ctx, polity)].surplusFocus, act);
    // A finished unit that has nowhere to stand is given up, and so is whatever keeps the capital from the project.
    const head = city.queue[0];
    const stuck =
      head !== undefined &&
      head.kind === 'unit' &&
      city.progress >= itemCost(ctx, city, head) &&
      spawnHex(ctx, city, unitDef(head.unit)) < 0;
    const project: BuildItem = { kind: 'project', project: PROJECT.id };
    const waiting =
      head !== undefined &&
      head.kind !== 'project' &&
      polityOf(ctx, polity).capital === city.zone &&
      pursuesScience(ctx, polity) &&
      checkItem(ctx, city, project) === null;
    if (stuck || waiting) {
      if (head.kind === 'unit') uncount(head.unit);
      act({ type: 'unqueueBuild', polity, city: city.zone, index: 0 });
    }
    // A city on a city project looks every turn for something better to do.
    const current = city.queue[0];
    const filler = city.queue.length === 1 && current !== undefined && cityProjectOf(current) !== null ? current : null;
    if (city.queue.length > 0 && filler === null) continue;
    const item = chooseBuild(ctx, polity, city, cities, plans);
    if (filler !== null) {
      if (item !== null && item.kind === 'building' && filler.kind === 'building' && item.building === filler.building) continue;
      act({ type: 'unqueueBuild', polity, city: city.zone, index: 0 });
    }
    if (item === null) continue;
    if (act({ type: 'queueBuild', polity, city: city.zone, item }) && item.kind === 'unit') {
      count(item.unit);
      plans.barracks++;
    }
  }
}

/**
 * A city with food to spare turns to production (to gold under a leader out
 * for wealth); one that has stopped growing turns back.
 */
function manageFocus(polity: number, city: City, spare: 'production' | 'gold', act: Act): void {
  const surplus = city.yields.food - city.pop * CITY.foodPerCitizen;
  // A leader out for wealth turns a city to gold as soon as it feeds itself.
  const enough = spare === 'gold' ? AI.balancedFocusSurplus : AI.productionFocusSurplus;
  if (city.focus === 'balanced' && surplus >= enough) {
    act({ type: 'setFocus', polity, city: city.zone, focus: spare });
  } else if (city.focus !== 'balanced' && city.focus !== 'food' && surplus < (spare === 'gold' ? 0 : AI.balancedFocusSurplus) && city.pop < CITY.maxPop) {
    act({ type: 'setFocus', polity, city: city.zone, focus: 'balanced' });
  }
}

/** The best infantry the polity can build: the warrior at the least. */
function infantry(ctx: Ctx, polity: number): BuildItem {
  return { kind: 'unit', unit: bestUnit(ctx, polity, 'infantry')?.id ?? at(ROSTER.infantry, 0) };
}

/** The best unit of the class furthest below its share of the army, among the classes the polity can build. */
function fieldUnit(ctx: Ctx, polity: number, plans: Plans): BuildItem {
  let best: BuildItem = infantry(ctx, polity);
  let lowest = Infinity;
  for (const [unitClass, share] of AI.armyMix) {
    const def = bestUnit(ctx, polity, unitClass);
    if (def === null) continue;
    // The garrisons are infantry that never take the field.
    const serving = (plans.byClass[unitClass] ?? 0) - (unitClass === 'infantry' ? plans.garrisons : 0);
    const filled = Math.max(0, serving) / share;
    if (filled < lowest) {
      lowest = filled;
      best = { kind: 'unit', unit: def.id };
    }
  }
  return best;
}

function chooseImprovement(ctx: Ctx, city: City, hexes: readonly number[]): BuildItem | null {
  const weights = FOCUS_WEIGHTS.balanced;
  const nation = nationOf(ctx, city.owner);
  let best: BuildItem | null = null;
  let bestGain = 0;
  for (const hex of hexes) {
    if (ctx.state.improvements[hex] !== undefined) continue;
    for (const improvement of IMPROVEMENT_IDS) {
      const def: ImprovementDef = IMPROVEMENTS[improvement];
      // Its own unique improvements, and never the generic one it replaces.
      if (def.nation !== undefined && def.nation !== nation) continue;
      if (improvementFor(nation, improvement) !== improvement) continue;
      if (!knows(ctx, city.owner, def.tech)) continue;
      if (!canImprove(ctx, city.owner, improvement, hex)) continue;
      const gain =
        def.yields.food * weights.food + def.yields.production * weights.production + def.yields.gold * weights.gold;
      if (gain > bestGain) {
        bestGain = gain;
        best = { kind: 'improvement', improvement, hex };
      }
    }
  }
  return best !== null && checkItem(ctx, city, best) === null ? best : null;
}

function settleTargetNear(ctx: Ctx, from: number, polity: number): number {
  const { state, map } = ctx;
  let best = -1;
  let bestDistance = AI.settleRange + styleOf(ctx, polity).settleRange + 1;
  for (let zone = 0; zone < state.cities.length; zone++) {
    if (state.zoneOwner[zone] !== NO_POLITY || state.cities[zone] !== null) continue;
    const site = at(map.zones, zone).siteHex;
    // A tribe on the site keeps settlers away, where it has been seen.
    if (ctx.unitAt.get(site)?.owner === NO_POLITY && canSee(ctx, polity, site)) continue;
    const distance = hexesApart(ctx, from, site);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = zone;
    }
  }
  return best;
}

function chooseBuild(ctx: Ctx, polity: number, city: City, cities: City[], plans: Plans): BuildItem | null {
  const { state, map } = ctx;
  const nation = at(map.polities, polity).kind === 'nation';
  const can = (item: BuildItem): boolean => checkItem(ctx, city, item) === null;

  // A city with no room for another land unit recruits none.
  const room = spawnHex(ctx, city, unitDef(at(ROSTER.infantry, 0))) >= 0;
  // A garrison for every city comes first.
  if (room && plans.military < Math.min(plans.wanted, cities.length)) return infantry(ctx, polity);
  // The leader in science builds the project in its capital as soon as a stage is open.
  const project: BuildItem = { kind: 'project', project: PROJECT.id };
  if (polityOf(ctx, polity).capital === city.zone && can(project) && pursuesScience(ctx, polity)) return project;
  if (nation && city.pop >= AI.expandPop) {
    for (let zone = 0; zone < state.cities.length; zone++) {
      const item: BuildItem = { kind: 'city', zone };
      if (state.zoneOwner[zone] === polity && state.cities[zone] === null && can(item)) return item;
    }
  }
  // A coastal city builds the next warship: at once in a war, after its first buildings at peace.
  const ship = bestUnit(ctx, polity, 'naval');
  const shipyard =
    ship !== null &&
    plans.navy < plans.navyWanted &&
    plans.barracks < plans.maxBarracks &&
    ctx.topo.coastal[city.zone] === true &&
    can({ kind: 'unit', unit: ship.id });
  if (shipyard && ship !== null && plans.atWar) return { kind: 'unit', unit: ship.id };
  // At war, a city near the enemy gets its airfield before anything else it would build.
  const airfield: BuildItem = { kind: 'building', building: buildingFor(nationOf(ctx, polity), 'airfield') };
  if (plans.atWar && can(airfield)) {
    const site = at(map.zones, city.zone).siteHex;
    const front = state.cities.some(
      (other) =>
        other !== null &&
        atWar(ctx, polity, other.owner) &&
        hexesApart(ctx, site, at(map.zones, other.zone).siteHex) <= AI.airfieldFrontRange &&
        knowsCity(ctx, polity, other),
    );
    if (front) return airfield;
  }
  const recruiting = room && plans.military < plans.wanted && plans.barracks < plans.maxBarracks;
  if (recruiting && (plans.atWar || plans.military < plans.wanted * AMBITION_STYLES[ambition(ctx, polity)].armyFirst)) {
    return fieldUnit(ctx, polity, plans);
  }
  const worked = chooseImprovement(ctx, city, city.worked);
  if (worked !== null) return worked;
  const settler = (): BuildItem | null => {
    if (!nation || plans.settler || city.pop < AI.expandPop || !can({ kind: 'unit', unit: SETTLER })) return null;
    if (settleTargetNear(ctx, at(map.zones, city.zone).siteHex, polity) < 0) return null;
    plans.settler = true;
    return { kind: 'unit', unit: SETTLER };
  };
  if (plans.style.settleFirst) {
    const item = settler();
    if (item !== null) return item;
  }
  // The buildings its leader favours come first, then the common order.
  const own = nationOf(ctx, polity);
  const favoured = plans.style.buildFirst as readonly BuildingId[];
  const order = [...new Set([...favoured, ...AI.buildingOrder])].map((building) => buildingFor(own, building));
  for (const building of order.slice(0, AI.coreBuildings)) {
    const item: BuildItem = { kind: 'building', building };
    if (can(item)) return item;
  }
  if (shipyard && ship !== null) return { kind: 'unit', unit: ship.id };
  if (recruiting) return fieldUnit(ctx, polity, plans);
  const item = settler();
  if (item !== null) return item;
  for (const building of order) {
    const item: BuildItem = { kind: 'building', building };
    if (can(item)) return item;
  }
  for (const building of BUILDING_IDS) {
    if (isCityProject(building)) continue;
    const item: BuildItem = { kind: 'building', building };
    if (can(item)) return item;
  }
  const improvement = chooseImprovement(ctx, city, improvableHexes(ctx, city));
  if (improvement !== null) return improvement;
  // With nothing left to build, the city recruits whatever the army still lacks, and then turns to a city project.
  if (room && plans.military < plans.wanted) return fieldUnit(ctx, polity, plans);
  return chooseProject(ctx, polity, city);
}

/**
 * The city project a city with nothing left to build takes up, or null if it
 * knows none. A leader out for learning has books compiled and one out for
 * wealth mints; a leader out for conquest mints for its army until its
 * treasury is full, then compiles. A nation on the simplified AI, which does
 * not research, holds festivals while it has cards to unlock, and mints
 * otherwise. A project that would do nothing (science with every tech
 * known, culture with every card unlocked) is passed over.
 */
export function chooseProject(ctx: Ctx, polity: number, city: City): BuildItem | null {
  const self = polityOf(ctx, polity);
  const nation = at(ctx.map.polities, polity).kind === 'nation';
  const learns = researches(ctx.state, polity) && self.techs.length < TECH_IDS.length;
  const cards = nation && self.policies.length < POLICY_IDS.length;
  const income = self.yields.gold + self.routeIncome + self.tributeReceived;
  const rich = self.gold > income * AI.mintTreasuryTurns;
  const goal = ambition(ctx, polity);
  let order: readonly CityProjectId[];
  if (!researches(ctx.state, polity)) order = ['festival', 'minting'];
  else if (goal === 'wealth') order = ['minting', 'compilation', 'festival'];
  else if (goal === 'conquest') order = rich ? ['compilation', 'festival', 'minting'] : ['minting', 'compilation', 'festival'];
  else order = ['compilation', 'festival', 'minting'];
  for (const building of order) {
    if (building === 'compilation' && !learns) continue;
    if (building === 'festival' && !cards) continue;
    const item: BuildItem = { kind: 'building', building };
    // It may be the one the city is already on.
    if (checkItem(ctx, city, item, true) === null) return item;
  }
  return null;
}

// ------------------------------------------------------------------ units

/**
 * The hexes on which a unit stands that an army of `polity` cannot fight its
 * way through and that will not make way: the units it sees of polities it
 * is not at war with (vassals, allies, neutrals whose land is open to it).
 */
function standingInTheWay(ctx: Ctx, polity: number): Uint8Array {
  const blocked = new Uint8Array(ctx.topo.count);
  for (const unit of ctx.state.units) {
    if (unit.owner === polity || atWar(ctx, polity, unit.owner) || !canSee(ctx, polity, unit.hex)) continue;
    blocked[unit.hex] = 1;
  }
  return blocked;
}

/**
 * Cost for one of `polity`'s land units to walk to `goal` from every hex in
 * reach, ignoring other units except those on `blocked` hexes, which the
 * path avoids where it can. `UNREACHABLE` where there is no way within
 * `limit`.
 */
function pathField(ctx: Ctx, polity: number, goal: number, limit = PATH_LIMIT, blocked: Uint8Array | null = null): Int16Array {
  const { topo } = ctx;
  const walker = unitDef(at(ROSTER.infantry, 0));
  const cost = new Int16Array(topo.count).fill(UNREACHABLE);
  // Costs are small integers, so one bucket per cost keeps the frontier in order.
  const buckets: number[][] = [[goal]];
  cost[goal] = 0;
  for (let here = 0; here < buckets.length && here < limit; here++) {
    const bucket = buckets[here];
    if (bucket === undefined) continue;
    for (const hex of bucket) {
      if (cost[hex] !== here) continue; // reached more cheaply since it was queued
      const total =
        here +
        (topo.water[hex] === 1 ? WATER_PATH_COST : (topo.moveCost[hex] as number)) +
        (blocked !== null && blocked[hex] === 1 ? BLOCKED_PATH_COST : 0);
      for (let d = 0; d < 6; d++) {
        const next = topo.neighbors[hex * 6 + d] as number;
        if (next < 0 || total >= (cost[next] as number)) continue;
        if (!terrainAllows(ctx, walker, next, polity) || !bordersOpen(ctx, polity, next)) continue;
        cost[next] = total;
        let target = buckets[total];
        if (target === undefined) {
          target = [];
          buckets[total] = target;
        }
        target.push(next);
      }
    }
  }
  return cost;
}

/** True if a unit stands on the hex and `polity` sees it. A unit it does not see is not there for its plans. */
function seesUnitOn(ctx: Ctx, polity: number, hex: number): boolean {
  return ctx.unitAt.has(hex) && canSee(ctx, polity, hex);
}

/**
 * Why the AI believes `unit` cannot step onto `to`, or null: the rules'
 * own check, except that a unit its polity does not see does not stand in
 * the way. If the rules then refuse the step, the unit stays where it is for
 * the turn and looks for no other way: it has learned nothing from the
 * refusal.
 */
export function stepKnown(ctx: Ctx, unit: Unit, to: number): RejectReason | null {
  const reason = checkStep(ctx, unit, to);
  if (reason !== 'hexOccupied' || seesUnitOn(ctx, unit.owner, to)) return reason;
  // What is left of `hexOccupied` without the unit: somebody else's city.
  const city = cityAtHex(ctx, to);
  return city !== null && city.owner !== unit.owner ? reason : null;
}

/** Steps the unit down the field while it has movement. Returns true if it moved at all. */
function advanceAlong(ctx: Ctx, unit: Unit, field: Int16Array, act: Act, stopAt: number): boolean {
  let moved = false;
  while (ctx.unitById.has(unit.id) && unit.moves > 0 && (field[unit.hex] as number) > stopAt) {
    let best = -1;
    let bestCost = field[unit.hex] as number;
    for (let d = 0; d < 6; d++) {
      const next = ctx.topo.neighbors[unit.hex * 6 + d] as number;
      if (next < 0 || (field[next] as number) >= bestCost) continue;
      if (stepKnown(ctx, unit, next) !== null) continue;
      best = next;
      bestCost = field[next] as number;
    }
    if (best < 0 || !act({ type: 'move', polity: unit.owner, unit: unit.id, to: best })) break;
    moved = true;
  }
  return moved;
}

/**
 * The best target for the unit from where it stands, as a hex, or -1.
 *
 * @param resting the unit is badly hurt: it only shoots, or walks into a fallen city.
 */
function chooseTarget(ctx: Ctx, unit: Unit, focus: number, resting: boolean): number {
  const { map } = ctx;
  const def = unitDef(unit.type);
  const ranged = def.range > 0;
  let best = -1;
  let bestScore = 0;
  for (const offset of hexRange(indexToOffset(unit.hex, map.width), Math.max(1, def.range))) {
    if (offset.col < 0 || offset.col >= map.width || offset.row < 0 || offset.row >= map.height) continue;
    const hex = offset.row * map.width + offset.col;
    if (hex === unit.hex) continue;
    if (validate(ctx, { type: 'attack', polity: unit.owner, unit: unit.id, target: hex }) !== null) continue;
    let score: number;
    const city = cityAtHex(ctx, hex);
    if (city !== null && city.owner !== unit.owner) {
      if (!ranged && city.hp <= 0) {
        score = def.domain === 'land' ? 1000 : 0;
      } else if (ranged) {
        score = 150 + def.cityAttackPercent;
      } else {
        const taken = combatDamage(
          cityStrength(ctx, city),
          attackStrength(unit, false, false, false) * amphibiousFactor(ctx, unit),
          1,
        );
        score = taken >= unit.hp ? 0 : 100;
      }
      if (score > 0 && city.zone === focus) score += 20;
    } else {
      const defender = ctx.unitAt.get(hex);
      if (defender === undefined) continue;
      if (defender.owner === NO_POLITY && !ranged) continue; // tribes are left alone
      const defence = defenceStrength(ctx, defender);
      if (unitDef(defender.type).strength === 0) {
        score = 300;
      } else {
        const attack = attackStrength(unit, ranged, false, false) * amphibiousFactor(ctx, unit);
        const dealt = combatDamage(attack, defence, 1);
        const taken = ranged ? 0 : combatDamage(defence, attack, 1);
        const kills = dealt >= defender.hp;
        if (taken >= unit.hp && !kills) score = 0;
        else if (!kills && taken > dealt * 1.5) score = 0;
        else score = 120 + (kills ? 200 : 0) + dealt - taken / 2;
      }
    }
    if (resting && !ranged && score < 1000) continue;
    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }
  return best;
}

/**
 * The enemy city the army marches on: the one already chosen, or the nearest
 * to one of its own cities among those it knows of. With none known it
 * marches on the nearest city site in enemy land: sites and borders are on
 * the map.
 */
function chooseFocus(ctx: Ctx, polity: number, cities: City[]): number {
  const { state, map } = ctx;
  const self = polityOf(ctx, polity);
  const current = self.aiTarget >= 0 ? state.cities[self.aiTarget] : null;
  if (current !== undefined && current !== null && atWar(ctx, polity, current.owner)) return self.aiTarget;
  // A leader out for conquest goes for whoever holds a capital of a major nation, and for the capital itself,
  // if they are not much farther than the nearest city.
  const conqueror = ambition(ctx, polity) === 'conquest';
  const seats = new Set(state.majors.map((major) => at(map.polities, major).capitalZone));
  const prizes = new Map<number, boolean>();
  const holdsPrize = (owner: number): boolean => {
    let held = prizes.get(owner);
    if (held === undefined) {
      held = capitalsHeld(ctx, owner) > 0;
      prizes.set(owner, held);
    }
    return held;
  };
  let best = -1;
  let bestDistance = Infinity;
  let bestKnown = false;
  for (const city of state.cities) {
    if (city === null || !atWar(ctx, polity, city.owner)) continue;
    const known = knowsCity(ctx, polity, city);
    if (bestKnown && !known) continue;
    const site = at(map.zones, city.zone).siteHex;
    const pull = !conqueror
      ? 0
      : (holdsPrize(city.owner) ? AI.prizeDetour : 0) + (seats.has(city.zone) ? AI.capitalDetour : 0);
    for (const own of cities) {
      const distance = hexesApart(ctx, site, at(map.zones, own.zone).siteHex) - pull;
      if (distance < bestDistance || (known && !bestKnown)) {
        bestDistance = distance;
        best = city.zone;
        bestKnown = known;
      }
    }
  }
  self.aiTarget = best;
  return best;
}

function commandUnits(ctx: Ctx, polity: number, major: boolean, cities: City[], act: Act): void {
  const { state, map } = ctx;
  const self = polityOf(ctx, polity);
  const units = state.units.filter((unit) => unit.owner === polity);
  const alive = (unit: Unit): boolean => ctx.unitById.has(unit.id);

  // One garrison per city: the unit on the site, or the nearest free one walks there.
  const garrison = new Set<number>();
  const reinforcing = new Map<number, number>();
  for (const city of cities) {
    const site = at(map.zones, city.zone).siteHex;
    const holder = ctx.unitAt.get(site);
    if (holder !== undefined && holder.owner === polity && isMilitary(holder)) {
      garrison.add(holder.id);
      continue;
    }
    let nearest: Unit | null = null;
    let nearestDistance = Infinity;
    for (const unit of units) {
      if (!isMilitary(unit) || garrison.has(unit.id) || reinforcing.has(unit.id)) continue;
      if (ctx.topo.water[unit.hex] === 1) continue;
      const distance = hexesApart(ctx, unit.hex, site);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = unit;
      }
    }
    if (nearest !== null) reinforcing.set(nearest.id, site);
  }

  const focus = major && enemiesOf(ctx, polity).length > 0 ? chooseFocus(ctx, polity, cities) : -1;
  if (focus < 0) self.aiTarget = -1;
  const field =
    focus >= 0 ? pathField(ctx, polity, at(map.zones, focus).siteHex, PATH_LIMIT, standingInTheWay(ctx, polity)) : null;
  if (field !== null) units.sort((a, b) => (field[a.hex] as number) - (field[b.hex] as number) || a.id - b.id);
  const warships = units.some(isWarship);
  const fleet = warships ? fleetField(ctx, polity, cities, units, focus) : null;
  // Where a battered ship goes to mend: the waters of its own coastal cities.
  const harbours = warships
    ? cities.filter((city) => ctx.topo.coastal[city.zone] === true).flatMap((city) => watersBy(ctx, at(map.zones, city.zone).siteHex))
    : [];
  const home = fleet !== null && harbours.length > 0 ? seaField(ctx, polity, harbours) : null;

  /** Where idle units camp, worked out when the first of them needs it. */
  let camps: Int16Array | null = null;

  for (const unit of units) {
    if (!alive(unit)) continue;
    const def = unitDef(unit.type);

    if (def.id === SETTLER) {
      commandSettler(ctx, unit, act);
      continue;
    }
    if (def.strength <= 0) {
      if (unit.status === 'ready') act({ type: 'sleep', polity, unit: unit.id });
      continue;
    }

    const upgrade = upgradeTargetFor(ctx, unit);
    if (
      upgrade !== null &&
      self.gold >= upgradePrice(ctx, unit, upgrade) + AI.upgradeReserve &&
      act({ type: 'upgrade', polity, unit: unit.id })
    ) {
      continue;
    }

    if (def.domain === 'sea') {
      commandShip(ctx, unit, fleet, home, focus, act);
      continue;
    }

    const site = reinforcing.get(unit.id);
    if (site !== undefined) {
      const home = pathField(ctx, polity, site, 2 * hexesApart(ctx, unit.hex, site) + 8);
      advanceAlong(ctx, unit, home, act, 0);
      continue;
    }

    const holding = garrison.has(unit.id);
    const resting = unit.hp < AI.restHp;
    // A garrison never leaves its city, so it only strikes from a distance.
    for (let step = 0; step < 8 && alive(unit) && unit.moves > 0; step++) {
      const target = holding && def.range === 0 ? -1 : chooseTarget(ctx, unit, focus, resting);
      if (target >= 0) {
        if (!(major && prefersVassal(ctx, unit, target) && act({ type: 'demandVassalage', polity, unit: unit.id, target }))) {
          act({ type: 'attack', polity, unit: unit.id, target });
        }
        break;
      }
      if (holding || resting || field === null) break;
      if (!advanceOneStep(ctx, unit, field, act)) break;
    }
    // With nothing to fight, an army in enemy land lives off it.
    if (major && !holding && alive(unit) && unit.moves > 0 && checkPillage(ctx, unit) === null) {
      act({ type: 'pillage', polity, unit: unit.id });
    }
    // A unit with no orders does not stand at the gates of its city, where the next recruits must muster.
    if (field === null && !holding && !resting && alive(unit) && unit.moves > 0 && !unit.acted) {
      if (nearGates(ctx, unit.hex, cities)) {
        camps ??= campField(ctx, polity, cities);
        advanceAlong(ctx, unit, camps, act, 0);
      }
    }
    if (alive(unit) && !unit.acted && unit.status !== 'fortified') act({ type: 'fortify', polity, unit: unit.id });
  }
}

/** How close to one of its cities an idle unit may not stay: new units muster there. */
const GATES_RADIUS = 1;
/** How far an idle unit looks for a place to camp. */
const CAMP_SEARCH = 14;

/** True if the hex lies within `GATES_RADIUS` of one of the cities. */
function nearGates(ctx: Ctx, hex: number, cities: City[]): boolean {
  return cities.some((city) => hexesApart(ctx, hex, at(ctx.map.zones, city.zone).siteHex) <= GATES_RADIUS);
}

/**
 * Steps to the nearest place an idle land unit of `polity` can camp: free
 * land of its own outside the gates of its cities. `UNREACHABLE` where there
 * is none within `CAMP_SEARCH` steps over its own land.
 */
function campField(ctx: Ctx, polity: number, cities: City[]): Int16Array {
  const { topo } = ctx;
  const cost = new Int16Array(topo.count).fill(UNREACHABLE);
  const own = (hex: number): boolean => topo.water[hex] !== 1 && topo.enterable[hex] === 1 && ownerOf(ctx, hex) === polity;
  let frontier: number[] = [];
  for (let hex = 0; hex < topo.count; hex++) {
    if (!own(hex) || seesUnitOn(ctx, polity, hex) || cityAtHex(ctx, hex) !== null || nearGates(ctx, hex, cities)) continue;
    cost[hex] = 0;
    frontier.push(hex);
  }
  for (let depth = 1; depth <= CAMP_SEARCH && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const hex of frontier) {
      for (let d = 0; d < 6; d++) {
        const to = topo.neighbors[hex * 6 + d] as number;
        if (to < 0 || cost[to] !== UNREACHABLE || !own(to)) continue;
        cost[to] = depth;
        next.push(to);
      }
    }
    frontier = next;
  }
  return cost;
}

/**
 * Where the fleet goes, as a field of steps over water, or null when it
 * stays in port. At war it goes with the army: to the embarked unit nearest
 * the city the army marches on, or failing that to the waters of that city;
 * with neither, it hunts enemy ships and embarked units near its own coast.
 */
function fleetField(ctx: Ctx, polity: number, cities: City[], units: Unit[], focus: number): Int16Array | null {
  const { state, map, topo } = ctx;
  if (enemiesOf(ctx, polity).length === 0) return null;
  const goals = new Set<number>();
  if (focus >= 0) {
    const site = at(map.zones, focus).siteHex;
    // The escort: the embarked unit that has come farthest.
    let lead: Unit | null = null;
    for (const unit of units) {
      if (!ctx.unitById.has(unit.id) || !isMilitary(unit) || topo.water[unit.hex] !== 1) continue;
      if (lead === null || hexesApart(ctx, unit.hex, site) < hexesApart(ctx, lead.hex, site)) lead = unit;
    }
    if (lead !== null) for (const hex of watersBy(ctx, lead.hex)) goals.add(hex);
    else for (const hex of watersBy(ctx, site)) goals.add(hex);
  }
  if (goals.size === 0) {
    const ports = cities.filter((city) => topo.coastal[city.zone] === true).map((city) => at(map.zones, city.zone).siteHex);
    for (const unit of state.units) {
      if (unit.owner === NO_POLITY || unit.owner === polity || !atWar(ctx, polity, unit.owner)) continue;
      if (topo.water[unit.hex] !== 1 || unitDef(unit.type).strength <= 0 || !canSee(ctx, polity, unit.hex)) continue;
      if (!ports.some((port) => hexesApart(ctx, port, unit.hex) <= AI.patrolRange)) continue;
      for (const hex of watersBy(ctx, unit.hex)) goals.add(hex);
    }
  }
  return goals.size === 0 ? null : seaField(ctx, polity, goals);
}

/**
 * One warship's turn: strike what is in reach, else follow the fleet, pillage
 * sea routes, or wait in port. A battered ship sails home instead, which
 * also clears the water by the enemy city for the units that storm it.
 */
function commandShip(
  ctx: Ctx,
  unit: Unit,
  fleet: Int16Array | null,
  home: Int16Array | null,
  focus: number,
  act: Act,
): void {
  const polity = unit.owner;
  const alive = (): boolean => ctx.unitById.has(unit.id);
  const resting = unit.hp < AI.restHp;
  const course = resting ? home : fleet;
  for (let step = 0; step < 8 && alive() && unit.moves > 0; step++) {
    const target = resting ? -1 : chooseTarget(ctx, unit, focus, false);
    if (target >= 0) {
      act({ type: 'attack', polity, unit: unit.id, target });
      break;
    }
    if (course === null || !advanceOneStep(ctx, unit, course, act)) break;
  }
  if (!alive()) return;
  if (unit.moves > 0 && checkPillage(ctx, unit) === null) act({ type: 'pillage', polity, unit: unit.id });
  if (fleet === null && !unit.acted && unit.status === 'ready') act({ type: 'sleep', polity, unit: unit.id });
}

/** One step towards the focus, stopping short of the city itself. */
function advanceOneStep(ctx: Ctx, unit: Unit, field: Int16Array, act: Act): boolean {
  const here = field[unit.hex] as number;
  if (here === UNREACHABLE) return false;
  let best = -1;
  let bestCost = here;
  for (let d = 0; d < 6; d++) {
    const next = ctx.topo.neighbors[unit.hex * 6 + d] as number;
    if (next < 0 || (field[next] as number) >= bestCost) continue;
    if (stepKnown(ctx, unit, next) !== null) continue;
    best = next;
    bestCost = field[next] as number;
  }
  if (best < 0) best = sidestep(ctx, unit, field);
  return best >= 0 && act({ type: 'move', polity: unit.owner, unit: unit.id, to: best });
}

/**
 * Where a unit that cannot get closer steps aside: a free hex no farther
 * from the goal from which the way on is open, so that a landing held up
 * behind one unit spreads out along the shore and a column held up on a road
 * spreads out over the country. -1 if there is none, or if the unit has
 * already moved this turn (it does not shuffle to and fro).
 */
function sidestep(ctx: Ctx, unit: Unit, field: Int16Array): number {
  if (unit.acted) return -1;
  const here = field[unit.hex] as number;
  for (let d = 0; d < 6; d++) {
    const next = ctx.topo.neighbors[unit.hex * 6 + d] as number;
    if (next < 0 || (field[next] as number) !== here || stepKnown(ctx, unit, next) !== null) continue;
    for (let e = 0; e < 6; e++) {
      const beyond = ctx.topo.neighbors[next * 6 + e] as number;
      if (beyond < 0 || (field[beyond] as number) >= here) continue;
      if (!seesUnitOn(ctx, unit.owner, beyond)) return next;
    }
  }
  return -1;
}

function commandSettler(ctx: Ctx, unit: Unit, act: Act): void {
  const polity = unit.owner;
  if (isSettleSite(ctx, unit.hex)) {
    act({ type: 'settle', polity, unit: unit.id });
    return;
  }
  const zone = settleTargetNear(ctx, unit.hex, polity);
  if (zone < 0) {
    if (unit.status === 'ready') act({ type: 'sleep', polity, unit: unit.id });
    return;
  }
  const field = pathField(ctx, polity, at(ctx.map.zones, zone).siteHex);
  advanceAlong(ctx, unit, field, act, 0);
  if (ctx.unitById.has(unit.id) && isSettleSite(ctx, unit.hex)) act({ type: 'settle', polity, unit: unit.id });
}
