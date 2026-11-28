/** Trade routes and their paths, the roads that form by themselves, and pillaging. */

import type { MapData } from '../shared/mapData.ts';
import { Terrain } from '../shared/mapData.ts';
import {
  BUILDINGS,
  CITY_STATE,
  IMPROVEMENTS,
  PILLAGE,
  ROADS,
  TECHS,
  TRADE,
  baseBuilding,
  unitDef,
} from './data.ts';
import { KIT, portOwner } from './kits.ts';
import { assignCitizens } from './cities.ts';
import { addInfluence, suzerainCount } from './cityStates.ts';
import { hexesApart } from './combat.ts';
import { at, atWar, isEmbarked, ownerOf, polityOf } from './context.ts';
import type { Ctx } from './context.ts';
import { cityMods, modsOf, percentOf, routeMatches, unitMatches } from './modifiers.ts';
import { hasAgreement, isCityState } from './relations.ts';
import { isStrategic } from './tech.ts';
import { NO_POLITY } from './types.ts';
import type { ModifierOf } from './mods.ts';
import type { City, EndReason, RejectReason, RouteTarget, TradeRoute, Unit } from './types.ts';

// ------------------------------------------------------------------ slots

/**
 * Trade route slots of a polity: the base, its techs, its first building of
 * each kind that adds one, and the commerce city-states it is suzerain of.
 */
export function routeSlots(ctx: Ctx, polity: number): number {
  const self = polityOf(ctx, polity);
  let slots = TRADE.baseRoutes + self.tradeRoutes;
  // One building of each kind counts: the one that adds most, where a replacement stands beside the plain one.
  const counted = new Map<string, number>();
  for (const city of ctx.state.cities) {
    if (city === null || city.owner !== polity) continue;
    for (const id of city.buildings) {
      const routes = BUILDINGS[id].tradeRoutes;
      if (routes === 0) continue;
      const kind = baseBuilding(id);
      counted.set(kind, Math.max(counted.get(kind) ?? 0, routes));
    }
  }
  for (const routes of counted.values()) slots += routes;
  return slots + CITY_STATE.commerceRoutes * suzerainCount(ctx, polity, 'commerce');
}

export function routesOf(ctx: Ctx, polity: number): TradeRoute[] {
  return ctx.state.routes.filter((route) => route.owner === polity);
}

/** Longest land path of a route of `owner`, in hexes. */
export function landRange(ctx: Ctx, owner: number): number {
  return Math.floor((TRADE.landRange * (100 + percentOf(ctx, owner, 'routeRange'))) / 100);
}

// ------------------------------------------------------------------ paths

export interface RoutePath {
  path: number[];
  sea: boolean;
}

function trace(previous: Map<number, number>, end: number): number[] {
  const path = [end];
  let hex = end;
  for (;;) {
    const before = previous.get(hex);
    if (before === undefined || before < 0) break;
    path.push(before);
    hex = before;
  }
  return path.reverse();
}

/**
 * The cheapest land path for a trade route of `owner` from `start` to one of
 * `goals`: over land nobody at war with the owner holds, counting a hex
 * without a road as `TRADE.offRoadFactor` hexes, so that it follows roads.
 */
function landPath(ctx: Ctx, owner: number, start: number, goals: ReadonlySet<number>): number[] | null {
  const { topo, state } = ctx;
  const range = landRange(ctx, owner);
  const limit = range * TRADE.offRoadFactor;
  const cost = new Map<number, number>([[start, 0]]);
  const previous = new Map<number, number>([[start, -1]]);
  const buckets: number[][] = [[start]];
  for (let here = 0; here < buckets.length && here <= limit; here++) {
    const bucket = buckets[here];
    if (bucket === undefined) continue;
    for (const hex of bucket) {
      if (cost.get(hex) !== here) continue;
      if (goals.has(hex) && hex !== start) {
        const path = trace(previous, hex);
        return path.length - 1 <= range ? path : null;
      }
      for (let d = 0; d < 6; d++) {
        const next = topo.neighbors[hex * 6 + d] as number;
        if (next < 0 || topo.enterable[next] !== 1 || topo.water[next] === 1) continue;
        const holder = ownerOf(ctx, next);
        if (holder !== NO_POLITY && holder !== owner && atWar(ctx, owner, holder)) continue;
        const total = here + (state.roads[next] !== undefined ? 1 : TRADE.offRoadFactor);
        if (total >= (cost.get(next) ?? Infinity)) continue;
        cost.set(next, total);
        previous.set(next, hex);
        let target = buckets[total];
        if (target === undefined) {
          target = [];
          buckets[total] = target;
        }
        target.push(next);
      }
    }
  }
  return null;
}

/** True if `owner`'s trade may sail the water hex: coast and lake with Boats, ocean with Compass. */
function sails(ctx: Ctx, owner: number, hex: number): boolean {
  if (ctx.topo.enterable[hex] !== 1 || ctx.topo.water[hex] !== 1) return false;
  const level = ctx.seaLevel[owner] as number;
  return ctx.map.terrain[hex] === Terrain.Ocean ? level >= 2 : level >= 1;
}

/** The shortest sea path from the water next to `start` to one of `goals`, over water the owner can sail. */
function seaPath(ctx: Ctx, owner: number, start: number, goals: ReadonlySet<number>): number[] | null {
  const { topo } = ctx;
  const previous = new Map<number, number>();
  let frontier: number[] = [];
  for (let d = 0; d < 6; d++) {
    const hex = topo.neighbors[start * 6 + d] as number;
    if (hex >= 0 && sails(ctx, owner, hex) && !previous.has(hex)) {
      previous.set(hex, -1);
      frontier.push(hex);
    }
  }
  for (let depth = 1; frontier.length > 0 && depth <= TRADE.seaRange; depth++) {
    const next: number[] = [];
    for (const hex of frontier) {
      if (goals.has(hex)) return trace(previous, hex);
      for (let d = 0; d < 6; d++) {
        const to = topo.neighbors[hex * 6 + d] as number;
        if (to < 0 || previous.has(to) || !sails(ctx, owner, to)) continue;
        previous.set(to, hex);
        next.push(to);
      }
    }
    frontier = next;
  }
  return null;
}

function around(ctx: Ctx, hex: number, water: boolean): Set<number> {
  const set = new Set<number>();
  for (let d = 0; d < 6; d++) {
    const next = ctx.topo.neighbors[hex * 6 + d] as number;
    if (next >= 0 && ctx.topo.enterable[next] === 1 && (ctx.topo.water[next] === 1) === water) set.add(next);
  }
  return set;
}

/**
 * The path of a trade route of `owner` from its city in `from` (a zone) to
 * the target, or null when there is none in range. Between two cities a land
 * path is taken if there is one, a sea path otherwise.
 */
export function findRoutePath(ctx: Ctx, owner: number, from: number, to: RouteTarget): RoutePath | null {
  const start = at(ctx.map.zones, from).siteHex;
  if (to.kind === 'port') {
    const port = ctx.map.offMapPorts[to.port];
    if (port === undefined) return null;
    if (hexesApart(ctx, start, port.hex) > Math.max(landRange(ctx, owner), TRADE.seaRange) + 1) return null;
    if (port.kind === 'land') {
      const goals = around(ctx, port.hex, false);
      if (goals.has(start)) return { path: [start], sea: false };
      const path = landPath(ctx, owner, start, goals);
      return path === null ? null : { path, sea: false };
    }
    const path = seaPath(ctx, owner, start, around(ctx, port.hex, true));
    return path === null ? null : { path, sea: true };
  }
  const end = ctx.map.zones[to.zone]?.siteHex;
  if (end === undefined) return null;
  const apart = hexesApart(ctx, start, end);
  if (apart <= landRange(ctx, owner)) {
    const path = landPath(ctx, owner, start, new Set([end]));
    if (path !== null) return { path, sea: false };
  }
  if (apart > TRADE.seaRange + 2) return null;
  const path = seaPath(ctx, owner, start, around(ctx, end, true));
  return path === null ? null : { path, sea: true };
}

// ----------------------------------------------------------------- income

function zoneSpecialties(ctx: Ctx, zone: number): string[] {
  return at(ctx.topo.zoneResources, zone)
    .map((index) => at(ctx.map.resources, index).id)
    .filter((id) => !isStrategic(id));
}

/**
 * Gold per turn the route gives its owner: a base, plus its length, the two
 * cities' populations and the specialties only one of the two zones has. A
 * route inside one polity earns a share of that; a trade pact, an alliance
 * with the Regional cooperation card and the Open seas card add to it. A
 * pillaged route earns nothing.
 */
export function routeIncome(ctx: Ctx, route: TradeRoute): number {
  const { state } = ctx;
  if (route.pillagedUntil >= state.turn) return 0;
  const from = state.cities[route.from];
  if (from === undefined || from === null) return 0;
  let gold = TRADE.baseGold + Math.floor(Math.max(0, route.path.length - 1) / TRADE.hexesPerGold);
  if (route.toCity < 0) {
    gold += Math.floor(from.pop / TRADE.popPerGold) + TRADE.portGold;
  } else {
    const to = state.cities[route.toCity];
    if (to === undefined || to === null) return 0;
    gold += Math.floor((from.pop + to.pop) / TRADE.popPerGold);
    const here = zoneSpecialties(ctx, from.zone);
    const there = zoneSpecialties(ctx, to.zone);
    const different = here.filter((id) => !there.includes(id)).length + there.filter((id) => !here.includes(id)).length;
    gold += Math.floor((TRADE.specialtyGold * different * (100 + percentOf(ctx, route.owner, 'specialtySale'))) / 100);
    if (to.owner === route.owner) {
      gold = Math.floor((gold * TRADE.domesticPercent) / 100);
    } else if (hasAgreement(ctx, 'tradePact', route.owner, to.owner)) {
      gold = Math.floor((gold * (100 + TRADE.pactPercent)) / 100);
    }
  }
  // Modifiers of the owner and of the buildings of the city it starts from: multipliers, then percentages, then flat gold.
  const modifiers = from.owner === route.owner ? cityMods(ctx, from, 'routeGold') : modsOf(ctx, route.owner, 'routeGold');
  let percent = 0;
  let flat = 0;
  for (const modifier of modifiers) {
    if (!routeMatches(ctx, modifier.route, route)) continue;
    if (modifier.multiplier !== undefined) gold *= modifier.multiplier;
    percent += modifier.percent ?? 0;
    if (modifier.gold === undefined) continue;
    if (modifier.perRiverHexes === undefined) {
      flat += modifier.gold;
    } else {
      let rivers = 0;
      for (const hex of route.path) if (ctx.map.riverEdges[hex] !== 0) rivers++;
      flat += modifier.gold * Math.min(KIT.maxRiverGold, Math.floor(rivers / modifier.perRiverHexes));
    }
  }
  if (percent !== 0) gold = Math.floor((gold * (100 + percent)) / 100);
  return gold + flat;
}

/** Percentage modifiers add to what `unit` gets for pillaging a route or an improvement. */
function pillagePercent(ctx: Ctx, unit: Unit, what: 'route' | 'improvement'): number {
  const def = unitDef(unit.type);
  let percent = 0;
  for (const modifier of modsOf(ctx, unit.owner, 'pillage')) {
    if ((modifier.what === undefined || modifier.what === what) && unitMatches(modifier.unit, def)) percent += modifier.percent;
  }
  for (const ability of def.abilities) {
    if (ability.type === 'pillage' && (ability.what === undefined || ability.what === what)) percent += ability.percent;
  }
  return percent;
}

// ------------------------------------------------------- establish and end

function sameTarget(route: TradeRoute, to: RouteTarget): boolean {
  return to.kind === 'city' ? route.toCity === to.zone : route.toPort === to.port;
}

/** Why the target is no destination for a route of `polity`, or null. Slots and the path are not checked. */
export function checkRouteTarget(ctx: Ctx, polity: number, from: number, to: unknown): RejectReason | null {
  if (typeof to !== 'object' || to === null) return 'badTarget';
  const target = to as Partial<{ kind: string; zone: number; port: number }>;
  if (target.kind === 'city') {
    if (typeof target.zone !== 'number' || !Number.isInteger(target.zone) || target.zone === from) return 'badTarget';
    const city = ctx.state.cities[target.zone];
    if (city === undefined || city === null) return 'badTarget';
    return atWar(ctx, polity, city.owner) ? 'atWar' : null;
  }
  if (target.kind === 'port') {
    const port = typeof target.port === 'number' ? ctx.map.offMapPorts[target.port] : undefined;
    if (port === undefined) return 'badTarget';
    const self = polityOf(ctx, polity);
    if (port.kind === 'land' ? !self.landPorts : !self.seaExits) return 'portClosed';
    // A port a nation's trait keeps to itself (`EXCLUSIVE_PORTS` lists the same ports).
    const reserved = portOwner(port.nameEn);
    return reserved !== null && reserved !== at(ctx.map.polities, polity).id ? 'portClosed' : null;
  }
  return 'badTarget';
}

/** Why `polity` cannot open a route from its city in `from` to the target, or null. */
export function checkRoute(ctx: Ctx, polity: number, from: number, to: unknown): RejectReason | null {
  const reason = checkRouteTarget(ctx, polity, from, to);
  if (reason !== null) return reason;
  const target = to as RouteTarget;
  const own = routesOf(ctx, polity);
  if (own.some((route) => sameTarget(route, target))) return 'duplicateRoute';
  if (own.length >= routeSlots(ctx, polity)) return 'noRouteSlot';
  return findRoutePath(ctx, polity, from, target) === null ? 'noRoute' : null;
}

/** Opens a route that {@link checkRoute} has passed. A land route lays roads along its path. */
export function establishRoute(ctx: Ctx, polity: number, from: number, to: RouteTarget): void {
  const { state } = ctx;
  const found = findRoutePath(ctx, polity, from, to);
  if (found === null) return;
  const route: TradeRoute = {
    id: state.nextId++,
    owner: polity,
    from,
    toCity: to.kind === 'city' ? to.zone : -1,
    toPort: to.kind === 'port' ? to.port : -1,
    sea: found.sea,
    path: found.path,
    income: 0,
    pillagedUntil: 0,
  };
  route.income = routeIncome(ctx, route);
  state.routes.push(route);
  state.stats.routesEstablished++;
  ctx.events.push({ type: 'routeEstablished', route: { ...route, path: [...route.path] } });
  if (!route.sea) addRoads(ctx, route.path);
}

export function endRoute(ctx: Ctx, route: TradeRoute, reason: EndReason): void {
  const index = ctx.state.routes.indexOf(route);
  if (index < 0) return;
  ctx.state.routes.splice(index, 1);
  ctx.events.push({ type: 'routeEnded', route: route.id, owner: route.owner, reason });
}

/** Ends the routes a change of a city's owner breaks: those that started there, and those of its new owner's enemies. */
export function routesAfterCapture(ctx: Ctx, city: City): void {
  for (const route of [...ctx.state.routes]) {
    if (route.from === city.zone && route.owner !== city.owner) endRoute(ctx, route, 'cityLost');
    else if (route.toCity === city.zone && atWar(ctx, route.owner, city.owner)) endRoute(ctx, route, 'war');
  }
}

/** True if the route's path comes within `range` hexes of a city of `polity`. */
function passesNear(ctx: Ctx, route: TradeRoute, polity: number, range: number): boolean {
  for (const city of ctx.state.cities) {
    if (city === null || city.owner !== polity) continue;
    const site = at(ctx.map.zones, city.zone).siteHex;
    for (const hex of route.path) if (hexesApart(ctx, hex, site) <= range) return true;
  }
  return false;
}

/**
 * One turn of trade: routes that lost a city or a slot end, the others pay
 * their owner and add to its influence with the city-state they reach.
 * Returns the income per polity.
 */
export function processRoutes(ctx: Ctx): number[] {
  const { state } = ctx;
  const income: number[] = state.polities.map(() => 0);
  const kept: number[] = state.polities.map(() => 0);
  const tolls: [number, ModifierOf<'routeToll'>][] = [];
  state.polities.forEach((polity, index) => {
    if (polity.alive) for (const modifier of modsOf(ctx, index, 'routeToll')) tolls.push([index, modifier]);
  });
  for (const route of [...state.routes]) {
    const from = state.cities[route.from];
    const to = route.toCity < 0 ? null : state.cities[route.toCity];
    if (from === undefined || from === null || from.owner !== route.owner || to === undefined) {
      endRoute(ctx, route, 'cityLost');
    } else if (route.toCity >= 0 && to === null) {
      endRoute(ctx, route, 'cityLost');
    } else if (to !== null && atWar(ctx, route.owner, to.owner)) {
      endRoute(ctx, route, 'war');
    } else if (at(kept, route.owner) >= routeSlots(ctx, route.owner)) {
      endRoute(ctx, route, 'lost');
    } else {
      kept[route.owner] = at(kept, route.owner) + 1;
      route.income = routeIncome(ctx, route);
      // Tolls: polities that tax what passes their cities take their share first.
      for (const [collector, toll] of tolls) {
        if (collector === route.owner || atWar(ctx, collector, route.owner)) continue;
        if (toll.sea === true && !route.sea) continue;
        if (!passesNear(ctx, route, collector, toll.range)) continue;
        const share = Math.floor((route.income * toll.percent) / 100);
        route.income -= share;
        income[collector] = at(income, collector) + share;
      }
      income[route.owner] = at(income, route.owner) + route.income;
      if (to !== null && to.owner !== route.owner && isCityState(ctx, to.owner)) {
        addInfluence(ctx, to.owner, route.owner, CITY_STATE.influencePerRoute);
      }
    }
  }
  return income;
}

// --------------------------------------------------------------- pillaging

/** The polity whose city works or could improve the hex, or `NO_POLITY`. */
function improvementOwner(ctx: Ctx, hex: number): number {
  const zone = ctx.topo.workZone[hex] as number;
  return zone < 0 ? NO_POLITY : (ctx.state.zoneOwner[zone] as number);
}

/** True if an improvement stands on the hex that `polity` could pillage: an enemy's, not yet pillaged. */
function pillageableImprovement(ctx: Ctx, polity: number, hex: number): boolean {
  if (ctx.state.improvements[hex] === undefined || (ctx.state.pillaged[hex] ?? 0) >= ctx.state.turn) return false;
  const owner = improvementOwner(ctx, hex);
  return owner !== NO_POLITY && owner !== polity && atWar(ctx, polity, owner);
}

/** The trade routes through the hex that `polity` could pillage: its enemies', not pillaged right now. */
function pillageableRoutes(ctx: Ctx, polity: number, hex: number): TradeRoute[] {
  return ctx.state.routes.filter(
    (route) =>
      route.owner !== polity &&
      route.pillagedUntil < ctx.state.turn &&
      atWar(ctx, polity, route.owner) &&
      route.path.includes(hex),
  );
}

/** Why the unit cannot pillage where it stands, or null. */
export function checkPillage(ctx: Ctx, unit: Unit): RejectReason | null {
  if (unit.moves <= 0) return 'noMovesLeft';
  if (unitDef(unit.type).strength <= 0 || isEmbarked(ctx, unit)) return 'cannotAttack';
  if (pillageableImprovement(ctx, unit.owner, unit.hex)) return null;
  return pillageableRoutes(ctx, unit.owner, unit.hex).length > 0 ? null : 'nothingToPillage';
}

/**
 * The unit pillages the enemy improvement it stands on or, if there is none,
 * the enemy trade routes that pass there. It takes the rest of its turn.
 */
export function pillage(ctx: Ctx, unit: Unit): void {
  const { state } = ctx;
  const self = polityOf(ctx, unit.owner);
  const hex = unit.hex;
  unit.moves = 0;
  unit.acted = true;
  unit.status = 'ready';
  const improvement = state.improvements[hex];
  if (improvement !== undefined && pillageableImprovement(ctx, unit.owner, hex)) {
    const gold = Math.floor(
      (Math.floor((IMPROVEMENTS[improvement].cost * PILLAGE.goldPercentOfCost) / 100) *
        (100 + pillagePercent(ctx, unit, 'improvement'))) /
        100,
    );
    state.pillaged[hex] = state.turn + PILLAGE.turns - 1;
    self.gold += gold;
    self.grossIncome += gold;
    ctx.events.push({
      type: 'improvementPillaged', hex, owner: improvementOwner(ctx, hex), by: unit.owner, unit: unit.id, gold,
    });
    const city = state.cities[ctx.topo.workZone[hex] as number];
    if (city !== undefined && city !== null) assignCitizens(ctx, city);
    return;
  }
  for (const route of pillageableRoutes(ctx, unit.owner, hex)) {
    const gold = Math.floor(
      (routeIncome(ctx, route) * TRADE.pillageIncomeTurns * (100 + pillagePercent(ctx, unit, 'route'))) / 100,
    );
    route.pillagedUntil = state.turn + TRADE.pillageTurns - 1;
    route.income = 0;
    self.gold += gold;
    self.grossIncome += gold;
    ctx.events.push({ type: 'routePillaged', route: route.id, owner: route.owner, by: unit.owner, unit: unit.id, hex, gold });
  }
}

// ------------------------------------------------------------------- roads

function knowsRailways(ctx: Ctx, polity: number): boolean {
  return polity !== NO_POLITY && polityOf(ctx, polity).techs.some((tech) => TECHS[tech].railways === true);
}

/** Lays a road on every hex of the list that has none: a railway where the hex's owner knows the tech. */
export function addRoads(ctx: Ctx, hexes: readonly number[]): void {
  const roads: number[] = [];
  const rails: number[] = [];
  for (const hex of hexes) {
    if (ctx.state.roads[hex] !== undefined || ctx.topo.water[hex] === 1) continue;
    const rail = knowsRailways(ctx, ownerOf(ctx, hex));
    ctx.state.roads[hex] = rail ? 2 : 1;
    (rail ? rails : roads).push(hex);
  }
  if (roads.length > 0) ctx.events.push({ type: 'roadsBuilt', hexes: roads, level: 1 });
  if (rails.length > 0) ctx.events.push({ type: 'roadsBuilt', hexes: rails, level: 2 });
}

/**
 * Movement points a land unit pays to step between two adjacent land hexes
 * that both carry a road, or null if one of them does not.
 */
export function roadStepCost(ctx: Ctx, from: number, to: number): number | null {
  const a = ctx.state.roads[from];
  const b = ctx.state.roads[to];
  if (a === undefined || b === undefined) return null;
  return a === 2 && b === 2 ? ROADS.railCost : ROADS.roadCost;
}

const linkCache = new WeakMap<MapData, Map<string, number[] | null>>();

/**
 * The shortest land path between the sites of two zones, at most
 * `ROADS.maxPath` hexes long, or null. It depends on the terrain alone, so it
 * is worked out once per map.
 */
function landLink(ctx: Ctx, zoneA: number, zoneB: number): number[] | null {
  let cache = linkCache.get(ctx.map);
  if (cache === undefined) {
    cache = new Map();
    linkCache.set(ctx.map, cache);
  }
  const key = `${zoneA}:${zoneB}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const { topo } = ctx;
  const start = at(ctx.map.zones, zoneA).siteHex;
  const goal = at(ctx.map.zones, zoneB).siteHex;
  const previous = new Map<number, number>([[start, -1]]);
  let frontier = [start];
  let found: number[] | null = null;
  for (let depth = 0; frontier.length > 0 && depth < ROADS.maxPath && found === null; depth++) {
    const next: number[] = [];
    for (const hex of frontier) {
      for (let d = 0; d < 6 && found === null; d++) {
        const to = topo.neighbors[hex * 6 + d] as number;
        if (to < 0 || previous.has(to) || topo.enterable[to] !== 1 || topo.water[to] === 1) continue;
        previous.set(to, hex);
        if (to === goal) found = trace(previous, to);
        else next.push(to);
      }
    }
    frontier = next;
  }
  cache.set(key, found);
  return found;
}

/**
 * One turn of road building. Every city is joined by road to its nearest
 * own cities in range, where a land path connects them; and the roads on the
 * land of a polity that knows Railway become railways.
 */
export function processRoads(ctx: Ctx): void {
  const { state, map } = ctx;
  const byOwner = new Map<number, City[]>();
  for (const city of state.cities) {
    if (city === null) continue;
    const list = byOwner.get(city.owner);
    if (list === undefined) byOwner.set(city.owner, [city]);
    else list.push(city);
  }
  for (const cities of byOwner.values()) {
    if (cities.length < 2) continue;
    for (const city of cities) {
      const site = at(map.zones, city.zone).siteHex;
      const near = cities
        .filter((other) => other !== city)
        .map((other) => ({ zone: other.zone, apart: hexesApart(ctx, site, at(map.zones, other.zone).siteHex) }))
        .filter((entry) => entry.apart <= ROADS.range)
        .sort((x, y) => x.apart - y.apart || x.zone - y.zone)
        .slice(0, ROADS.links);
      for (const other of near) {
        const a = Math.min(city.zone, other.zone);
        const b = Math.max(city.zone, other.zone);
        const key = `${a}:${b}`;
        if (state.roadLinks[key] !== undefined) continue;
        const path = landLink(ctx, a, b);
        state.roadLinks[key] = path === null ? 0 : 1;
        if (path !== null) addRoads(ctx, path);
      }
    }
  }

  const railways = state.polities.map((_, index) => knowsRailways(ctx, index));
  if (!railways.includes(true)) return;
  const upgraded: number[] = [];
  for (const key of Object.keys(state.roads)) {
    if (state.roads[key] !== 1) continue;
    const owner = ownerOf(ctx, Number(key));
    if (owner === NO_POLITY || railways[owner] !== true) continue;
    state.roads[key] = 2;
    upgraded.push(Number(key));
  }
  if (upgraded.length > 0) ctx.events.push({ type: 'roadsBuilt', hexes: upgraded, level: 2 });
}
