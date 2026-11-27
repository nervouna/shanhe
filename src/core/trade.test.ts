import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { NO_ZONE, OWNER_SEA, Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { BUY, CITY_STATE, IMPROVEMENTS, PILLAGE, ROADS, TRADE, UNITS } from './data.ts';
import type { CityStateType } from './data.ts';
import {
  NO_POLITY,
  applyAction,
  buyPrice,
  createGame,
  endTurn,
  hashState,
  hexOwner,
  loadGame,
  saveGame,
  tradeRoutePath,
  tradeRouteSlots,
} from './game.ts';
import type { Action, GameEvent, GameState, RouteTarget, Unit } from './game.ts';
import {
  apply,
  applyWithEvents,
  around,
  edit,
  isPlainGround,
  learn,
  put,
  withAgreement,
  withCity,
  withResource,
  yieldsOf,
} from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const WUCHENG = 4;
const JIADU = 0;
const JIABEI = 1;
const YIDU = 3;
const WUCHENG_ZONE = 8;
const site = (zone: number): number => map.zones[zone]!.siteHex;

/** Jia is the human player; nobody is a major, so no AI starts a war or a route for Jia. */
const base = createGame(map, { seed: 3, player: 'jia', majors: [] });
const reason = (state: GameState, action: Action): string => {
  const result = applyAction(state, action);
  return result.ok ? 'ok' : result.reason;
};
const turns = (state: GameState, count: number): { state: GameState; events: GameEvent[] } => {
  let current = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) {
    const step = endTurn(current);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
};
const war = (state: GameState, by: number, on: number): GameState => apply(state, { type: 'declareWar', polity: by, target: on });
const toCity = (zone: number): RouteTarget => ({ kind: 'city', zone });
const routeTo = (zone: number, from = JIADU): Action => ({ type: 'establishRoute', polity: JIA, city: from, to: toCity(zone) });
const adjacent = (a: number, b: number): boolean => around(map, a).includes(b);
const rich = (state: GameState, polity: number, gold = 1000): GameState =>
  edit(state, (draft) => {
    draft.polities[polity]!.gold = gold;
  });
const unitOf = (state: GameState, id: number): Unit => state.units.find((unit) => unit.id === id)!;

describe('trade routes', () => {
  it('fill slots that come from the base, techs and buildings', () => {
    expect(TRADE.baseRoutes).toBe(1);
    expect(tradeRouteSlots(base, JIA)).toBe(1);
    expect(tradeRouteSlots(learn(base, JIA, ['currency']), JIA)).toBe(2);
    expect(tradeRouteSlots(learn(base, JIA, ['currency', 'guilds', 'banking']), JIA)).toBe(4);
    // The first harbour adds a slot; a second one does not.
    const harbours = edit(withCity(base, JIABEI, JIA), (draft) => {
      draft.cities[JIADU]!.buildings.push('harbour');
    });
    expect(tradeRouteSlots(harbours, JIA)).toBe(2);
    expect(tradeRouteSlots(edit(harbours, (draft) => {
      draft.cities[JIABEI]!.buildings.push('harbour');
    }), JIA)).toBe(2);
  });

  it('link a city to a foreign city at peace along a land path stored on the map', () => {
    const { state, events } = applyWithEvents(base, routeTo(YIDU));
    expect(state.routes).toHaveLength(1);
    const route = state.routes[0]!;
    expect(route).toMatchObject({ id: 1, owner: JIA, from: JIADU, toCity: YIDU, toPort: -1, sea: false, pillagedUntil: 0 });
    expect(route.path[0]).toBe(site(JIADU));
    expect(route.path[route.path.length - 1]).toBe(site(YIDU));
    for (let i = 1; i < route.path.length; i++) {
      expect(adjacent(route.path[i - 1]!, route.path[i]!)).toBe(true);
      expect(topo.water[route.path[i]!]).toBe(0);
    }
    expect(route.path).toEqual(tradeRoutePath(base, JIA, JIADU, toCity(YIDU))!.path);
    expect(events[0]).toEqual({ type: 'routeEstablished', route });
    expect(state.stats.routesEstablished).toBe(1);
    // A land route lays a road along its path.
    for (const hex of route.path) expect(state.roads[hex]).toBe(1);
    expect(events).toContainEqual({ type: 'roadsBuilt', hexes: route.path, level: 1 });
  });

  it('are refused without a slot, twice to the same place, to an enemy, or to nowhere', () => {
    const one = apply(base, routeTo(YIDU));
    expect(reason(one, routeTo(7))).toBe('noRouteSlot');
    const two = learn(one, JIA, ['currency']);
    expect(reason(two, routeTo(YIDU))).toBe('duplicateRoute');
    expect(reason(two, routeTo(7))).toBe('ok');
    expect(reason(base, routeTo(JIADU))).toBe('badTarget');
    expect(reason(base, routeTo(JIABEI))).toBe('badTarget'); // no city there yet
    expect(reason(war(base, JIA, YI), routeTo(YIDU))).toBe('atWar');
    expect(reason(base, { type: 'establishRoute', polity: JIA, city: YIDU, to: toCity(JIADU) })).toBe('notYourCity');
    expect(reason(base, { type: 'establishRoute', polity: JIA, city: JIADU, to: { kind: 'port', port: 5 } })).toBe('badTarget');
  });

  it('reach an off-map land port once Currency opens it', () => {
    const port: Action = { type: 'establishRoute', polity: JIA, city: JIADU, to: { kind: 'port', port: 0 } };
    expect(reason(base, port)).toBe('portClosed');
    const open = learn(base, JIA, ['currency']);
    expect(open.polities[JIA]!.landPorts).toBe(true);
    const state = apply(open, port);
    const route = state.routes[0]!;
    expect(route).toMatchObject({ toCity: -1, toPort: 0, sea: false });
    expect(adjacent(route.path[route.path.length - 1]!, map.offMapPorts[0]!.hex)).toBe(true);
    const length = route.path.length - 1;
    expect(route.income).toBe(
      TRADE.baseGold + Math.floor(length / TRADE.hexesPerGold) + Math.floor(1 / TRADE.popPerGold) + TRADE.portGold,
    );
  });

  it('earn by distance, both cities\' sizes and specialties, and pay every turn', () => {
    const state = apply(base, routeTo(YIDU));
    const route = state.routes[0]!;
    const length = route.path.length - 1;
    expect(route.income).toBe(TRADE.baseGold + Math.floor(length / TRADE.hexesPerGold) + Math.floor(2 / TRADE.popPerGold));
    const after = endTurn(state).state;
    const plain = endTurn(base).state;
    expect(after.polities[JIA]!.routeIncome).toBe(route.income);
    expect(after.polities[JIA]!.gold).toBe(plain.polities[JIA]!.gold + route.income);
    expect(after.polities[JIA]!.grossIncome).toBe(plain.polities[JIA]!.grossIncome + route.income);
    // Bigger cities trade more.
    const big = edit(state, (draft) => {
      draft.cities[JIADU]!.pop = 9;
      draft.cities[YIDU]!.pop = 11;
    });
    expect(endTurn(big).state.routes[0]!.income).toBeGreaterThanOrEqual(route.income + Math.floor(20 / TRADE.popPerGold));
    // A farther city is worth more than a nearer one of the same size.
    const far = apply(base, routeTo(WUCHENG_ZONE)).routes[0]!;
    expect(far.path.length).toBeGreaterThan(route.path.length + TRADE.hexesPerGold);
    expect(far.income).toBeGreaterThan(route.income);
    // A specialty in one of the two zones adds to it.
    const silkHex = topo.zoneHexes[YIDU]!.find((hex) => isPlainGround(map, hex) && map.resource[hex] === -1)!;
    const silk = createGame(withResource(map, 'silk', [silkHex]), { seed: 3, player: 'jia', majors: [] });
    expect(apply(silk, routeTo(YIDU)).routes[0]!.income).toBe(route.income + TRADE.specialtyGold);
    // A strategic resource is no specialty.
    const iron = createGame(withResource(map, 'iron', [silkHex]), { seed: 3, player: 'jia', majors: [] });
    expect(apply(iron, routeTo(YIDU)).routes[0]!.income).toBe(route.income);
  });

  it('earn half between two cities of the same polity and half as much again with a trade pact', () => {
    const home = withCity(base, JIABEI, JIA);
    const domestic = apply(home, routeTo(JIABEI)).routes[0]!;
    const length = domestic.path.length - 1;
    const full = TRADE.baseGold + Math.floor(length / TRADE.hexesPerGold) + Math.floor(2 / TRADE.popPerGold);
    expect(domestic.income).toBe(Math.floor((full * TRADE.domesticPercent) / 100));
    const foreign = apply(base, routeTo(YIDU)).routes[0]!.income;
    const pact = apply(withAgreement(base, 'tradePact', JIA, YI), routeTo(YIDU)).routes[0]!.income;
    expect(pact).toBe(Math.floor((foreign * (100 + TRADE.pactPercent)) / 100));
  });

  it('are pillaged by an enemy unit standing on the path', () => {
    const state = apply(base, routeTo(YIDU));
    const route = state.routes[0]!;
    const onPath = route.path[4]!;
    let raider = 0;
    const raided = edit(war(state, BING, JIA), (draft) => {
      raider = put(draft, 'warrior', BING, onPath).id;
    });
    const before = raided.polities[BING]!.gold;
    const { state: after, events } = applyWithEvents(raided, { type: 'pillage', polity: BING, unit: raider });
    const gold = route.income * TRADE.pillageIncomeTurns;
    expect(events).toEqual([{ type: 'routePillaged', route: 1, owner: JIA, by: BING, unit: raider, hex: onPath, gold }]);
    expect(after.polities[BING]!.gold).toBe(before + gold);
    expect(after.routes[0]!.pillagedUntil).toBe(after.turn + TRADE.pillageTurns - 1);
    expect(unitOf(after, raider).moves).toBe(0);
    // No income while it is cut, and none to take a second time.
    const next = endTurn(after).state;
    expect(next.polities[JIA]!.routeIncome).toBe(0);
    expect(next.routes[0]!.income).toBe(0);
    expect(reason(next, { type: 'pillage', polity: BING, unit: raider })).toBe('nothingToPillage');
    // It recovers by itself.
    const peaceful = edit(next, (draft) => {
      draft.units.splice(draft.units.findIndex((unit) => unit.id === raider), 1);
    });
    const later = turns(peaceful, TRADE.pillageTurns).state;
    expect(later.routes[0]!.income).toBeGreaterThan(0);
    expect(later.polities[JIA]!.routeIncome).toBe(later.routes[0]!.income);

    // A unit at peace with the owner, or off the path, finds nothing.
    const bystander = edit(state, (draft) => {
      put(draft, 'warrior', DING, onPath, { id: 800 });
    });
    expect(reason(bystander, { type: 'pillage', polity: DING, unit: 800 })).toBe('nothingToPillage');
    const off = topo.zoneHexes[JIADU]!.find((hex) => isPlainGround(map, hex) && !route.path.includes(hex))!;
    const elsewhere = edit(war(state, BING, JIA), (draft) => {
      put(draft, 'warrior', BING, off, { id: 801 });
    });
    expect(reason(elsewhere, { type: 'pillage', polity: BING, unit: 801 })).toBe('nothingToPillage');
  });

  it('end with a war against the destination, with the loss of a city, or when cancelled', () => {
    const state = apply(base, routeTo(YIDU));
    const fighting = applyWithEvents(state, { type: 'declareWar', polity: YI, target: JIA });
    expect(fighting.state.routes).toHaveLength(0);
    expect(fighting.events).toContainEqual({ type: 'routeEnded', route: 1, owner: JIA, reason: 'war' });
    const cancelled = applyWithEvents(state, { type: 'cancelRoute', polity: JIA, route: 1 });
    expect(cancelled.state.routes).toHaveLength(0);
    expect(cancelled.events).toEqual([{ type: 'routeEnded', route: 1, owner: JIA, reason: 'cancelled' }]);
    expect(reason(state, { type: 'cancelRoute', polity: YI, route: 1 })).toBe('noSuchRoute');
    // Jia loses the city the route starts from.
    const home = apply(withCity(base, JIABEI, JIA), { type: 'establishRoute', polity: JIA, city: JIABEI, to: toCity(YIDU) });
    const falling = edit(war(home, BING, JIA), (draft) => {
      draft.cities[JIABEI]!.hp = 0;
      const beside = around(map, site(JIABEI)).find((hex) => isPlainGround(map, hex))!;
      put(draft, 'swordsman', BING, beside, { id: 802 });
    });
    const fallen = applyWithEvents(falling, { type: 'attack', polity: BING, unit: 802, target: site(JIABEI) });
    expect(fallen.state.cities[JIABEI]!.owner).toBe(BING);
    expect(fallen.state.routes).toHaveLength(0);
    expect(fallen.events).toContainEqual({ type: 'routeEnded', route: 1, owner: JIA, reason: 'cityLost' });
  });

  describe('by sea', () => {
    // A sea exit on the south-west corner of the fixture, and Jia holding the one coastal city.
    const exitHex = 16 * map.width + 2;
    const seaMap: MapData = {
      ...map,
      offMapPorts: [
        ...map.offMapPorts,
        { hex: exitHex, kind: 'sea', nameZh: '南洋', nameEn: 'South Sea' },
        { hex: exitHex, kind: 'sea', nameZh: '大东洋', nameEn: 'Great Eastern Ocean' },
      ],
    };
    const coastal = edit(createGame(seaMap, { seed: 3, player: 'jia', majors: [] }), (draft) => {
      draft.cities[WUCHENG_ZONE]!.owner = JIA;
      draft.zoneOwner[WUCHENG_ZONE] = JIA;
      draft.polities[WUCHENG]!.alive = false;
      draft.units.splice(draft.units.findIndex((unit) => unit.owner === WUCHENG), 1);
    });
    const exit = (port: number): Action => ({ type: 'establishRoute', polity: JIA, city: WUCHENG_ZONE, to: { kind: 'port', port } });

    it('run over water the polity can sail, to a sea exit that Ocean Navigation opens', () => {
      expect(reason(learn(coastal, JIA, ['boats']), exit(1))).toBe('portClosed');
      // Without Boats nothing sails.
      expect(reason(learn(coastal, JIA, ['oceanNavigation']), exit(1))).toBe('noRoute');
      const sailing = learn(coastal, JIA, ['boats', 'oceanNavigation']);
      expect(sailing.polities[JIA]!.seaExits).toBe(true);
      const state = apply(sailing, exit(1));
      const route = state.routes[0]!;
      expect(route.sea).toBe(true);
      expect(route.path.length).toBeGreaterThan(10);
      expect(adjacent(route.path[0]!, site(WUCHENG_ZONE))).toBe(true);
      expect(adjacent(route.path[route.path.length - 1]!, exitHex)).toBe(true);
      for (let i = 0; i < route.path.length; i++) {
        expect(topo.water[route.path[i]!]).toBe(1);
        // Jia does not know Compass: the route keeps to the coast.
        expect(seaMap.terrain[route.path[i]!]).toBe(Terrain.Coast);
        if (i > 0) expect(adjacent(route.path[i - 1]!, route.path[i]!)).toBe(true);
      }
      // A sea route lays no road.
      expect(Object.keys(state.roads)).toHaveLength(0);
    });

    it('leave the Pacific exit to its one nation', () => {
      const sailing = learn(coastal, JIA, ['boats', 'oceanNavigation']);
      expect(reason(sailing, exit(2))).toBe('portClosed');
    });

    it('are pillaged by a ship on the path', () => {
      const sailing = apply(learn(coastal, JIA, ['boats', 'oceanNavigation']), exit(1));
      const onPath = sailing.routes[0]!.path[3]!;
      const raided = edit(learn(war(sailing, BING, JIA), BING, ['boats']), (draft) => {
        put(draft, 'galley', BING, onPath, { id: 803 });
      });
      const after = apply(raided, { type: 'pillage', polity: BING, unit: 803 });
      expect(after.routes[0]!.pillagedUntil).toBeGreaterThanOrEqual(after.turn);
    });
  });
});

describe('roads', () => {
  const two = withCity(base, JIABEI, JIA);

  it('form by themselves between a polity\'s connected cities', () => {
    expect(Object.keys(base.roads)).toHaveLength(0);
    // One city: nothing to connect.
    expect(Object.keys(endTurn(base).state.roads)).toHaveLength(0);
    const { state, events } = endTurn(two);
    const built = events.filter((event): event is Extract<GameEvent, { type: 'roadsBuilt' }> => event.type === 'roadsBuilt');
    expect(built).toHaveLength(1);
    const road = built[0]!.hexes;
    expect(built[0]!.level).toBe(1);
    expect(road).toContain(site(JIADU));
    expect(road).toContain(site(JIABEI));
    for (let i = 1; i < road.length; i++) expect(adjacent(road[i - 1]!, road[i]!)).toBe(true);
    for (const hex of road) {
      expect(state.roads[hex]).toBe(1);
      expect(topo.water[hex]).toBe(0);
    }
    expect(state.roadLinks).toEqual({ [`${JIADU}:${JIABEI}`]: 1 });
    // Once built it is not built again.
    expect(endTurn(state).events.some((event) => event.type === 'roadsBuilt')).toBe(false);
  });

  it('lower the cost of movement, over hills and rivers too', () => {
    expect(ROADS.roadCost).toBe(0.5);
    // A hill hex next to open ground in Jia's land.
    const hill = topo.zoneHexes[JIADU]!.find(
      (hex) => topo.moveCost[hex] === 2 && topo.siteZone[hex] === -1 && around(map, hex).some((n) => isPlainGround(map, n)),
    )!;
    const from = around(map, hill).find((n) => isPlainGround(map, n))!;
    let walker = 0;
    const placed = edit(base, (draft) => {
      walker = put(draft, 'warrior', JIA, from).id;
    });
    const step: Action = { type: 'move', polity: JIA, unit: walker, to: hill };
    expect(unitOf(apply(placed, step), walker).moves).toBe(0);
    const paved = edit(placed, (draft) => {
      draft.roads[from] = 1;
      draft.roads[hill] = 1;
    });
    expect(unitOf(apply(paved, step), walker).moves).toBe(1.5);
    // A road on one of the two hexes only is no road.
    const half = edit(placed, (draft) => {
      draft.roads[hill] = 1;
    });
    expect(unitOf(apply(half, step), walker).moves).toBe(0);
    // Across a river.
    const [a, b] = (() => {
      for (let hex = 0; hex < map.width * map.height; hex++) {
        if (!isPlainGroundOrRiver(hex)) continue;
        for (let d = 0; d < 6; d++) {
          const next = topo.neighbors[hex * 6 + d]!;
          if (next >= 0 && (map.riverEdges[hex]! & (1 << d)) !== 0 && isPlainGroundOrRiver(next)) return [hex, next];
        }
      }
      throw new Error('no river crossing on the fixture');
    })();
    const river = edit(base, (draft) => {
      put(draft, 'chariot', hexOwner(base, a!) === NO_POLITY ? JIA : hexOwner(base, a!), a!, { id: 810 });
    });
    const owner = unitOf(river, 810).owner;
    const cross: Action = { type: 'move', polity: owner, unit: 810, to: b! };
    if (reason(river, cross) === 'ok') {
      expect(unitOf(apply(river, cross), 810).moves).toBe(0);
      const bridged = edit(river, (draft) => {
        draft.roads[a!] = 1;
        draft.roads[b!] = 1;
      });
      expect(unitOf(apply(bridged, cross), 810).moves).toBe(UNITS.chariot!.moves - 0.5);
    }
  });

  it('become railways with the Railway tech and lower the cost further', () => {
    expect(ROADS.railCost).toBe(0.25);
    const roads = endTurn(two).state;
    const railed = endTurn(learn(roads, JIA, ['railway']));
    const upgraded = railed.events.filter((event): event is Extract<GameEvent, { type: 'roadsBuilt' }> => event.type === 'roadsBuilt');
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]!.level).toBe(2);
    const hexes = Object.keys(railed.state.roads).map(Number);
    expect(hexes.length).toBeGreaterThan(1);
    for (const hex of hexes) expect(railed.state.roads[hex]).toBe(2);
    // A unit rides the rails.
    const start = hexes.find((hex) => hex !== site(JIADU) && hex !== site(JIABEI) && hexes.some((other) => other !== site(JIADU) && other !== site(JIABEI) && adjacent(hex, other)));
    if (start !== undefined) {
      const next = hexes.find((other) => other !== site(JIADU) && other !== site(JIABEI) && adjacent(start, other))!;
      const placed = edit(railed.state, (draft) => {
        put(draft, 'warrior', JIA, start, { id: 811 });
      });
      expect(unitOf(apply(placed, { type: 'move', polity: JIA, unit: 811, to: next }), 811).moves).toBe(1.75);
    }
    // Only on the land of the nation that knows the tech. (Bing is the one that researches here, so nobody copies Yi.)
    const other = createGame(map, { seed: 3, majors: ['bing'] });
    const mixed = endTurn(learn(withCity(withCity(other, JIABEI, JIA), 4, YI), YI, ['railway'])).state;
    const all = Object.keys(mixed.roads).map(Number);
    expect(all.some((hex) => hexOwner(mixed, hex) === YI)).toBe(true);
    expect(all.some((hex) => hexOwner(mixed, hex) === JIA)).toBe(true);
    for (const hex of all) expect(mixed.roads[hex]).toBe(hexOwner(mixed, hex) === YI ? 2 : 1);
  });
});

function isPlainGroundOrRiver(hex: number): boolean {
  return topo.enterable[hex] === 1 && topo.water[hex] === 0 && topo.moveCost[hex] === 1 && topo.siteZone[hex] === -1;
}

describe('pillaging an improvement', () => {
  // One citizen under the food focus works the farm.
  const farmHex = topo.workHexes[YIDU]!.find((hex) => isPlainGround(map, hex) && map.terrain[hex] === Terrain.Grassland)!;
  const farmed = edit(base, (draft) => {
    draft.improvements[farmHex] = 'farm';
    draft.cities[YIDU]!.focus = 'food';
    put(draft, 'warrior', JIA, farmHex, { id: 820 });
  });
  const raid: Action = { type: 'pillage', polity: JIA, unit: 820 };

  it('needs a war with its owner', () => {
    expect(reason(farmed, raid)).toBe('nothingToPillage');
    expect(reason(war(farmed, JIA, YI), raid)).toBe('ok');
    const own = edit(base, (draft) => {
      const hex = topo.workHexes[JIADU]!.find((candidate) => isPlainGround(map, candidate))!;
      draft.improvements[hex] = 'farm';
      put(draft, 'warrior', JIA, hex, { id: 821 });
    });
    expect(reason(own, { type: 'pillage', polity: JIA, unit: 821 })).toBe('nothingToPillage');
  });

  it('disables it for some turns and gives the pillager gold', () => {
    const fighting = war(farmed, JIA, YI);
    const food = yieldsOf(fighting, YIDU).food;
    const { state, events } = applyWithEvents(fighting, raid);
    const gold = Math.floor((IMPROVEMENTS.farm.cost * PILLAGE.goldPercentOfCost) / 100);
    expect(gold).toBeGreaterThan(0);
    expect(events).toEqual([{ type: 'improvementPillaged', hex: farmHex, owner: YI, by: JIA, unit: 820, gold }]);
    expect(state.polities[JIA]!.gold).toBe(fighting.polities[JIA]!.gold + gold);
    expect(state.pillaged[farmHex]).toBe(state.turn + PILLAGE.turns - 1);
    expect(state.improvements[farmHex]).toBe('farm');
    expect(yieldsOf(state, YIDU).food).toBe(food - IMPROVEMENTS.farm.yields.food);
    expect(state.cities[YIDU]!.yields.food).toBe(food - IMPROVEMENTS.farm.yields.food);
    expect(unitOf(state, 820).moves).toBe(0);
    // Once is enough.
    const fresh = edit(state, (draft) => {
      draft.units.find((unit) => unit.id === 820)!.moves = 2;
    });
    expect(reason(fresh, raid)).toBe('nothingToPillage');
    // It is repaired by itself.
    const gone = edit(state, (draft) => {
      draft.units.splice(draft.units.findIndex((unit) => unit.id === 820), 1);
    });
    const still = turns(gone, PILLAGE.turns - 1).state;
    expect(still.pillaged[farmHex]).toBeDefined();
    const repaired = turns(still, 1).state;
    expect(repaired.pillaged[farmHex]).toBeUndefined();
    expect(yieldsOf(edit(repaired, (draft) => {
      draft.cities[YIDU]!.pop = 1;
    }), YIDU).food).toBe(food);
  });
});

describe('buying with gold', () => {
  const warrior: Action = { type: 'buy', polity: JIA, city: JIADU, item: { kind: 'unit', unit: 'warrior' } };
  const granary: Action = { type: 'buy', polity: JIA, city: JIADU, item: { kind: 'building', building: 'granary' } };

  it('puts a unit in the city at once for three gold per point of production', () => {
    const price = UNITS.warrior!.cost * BUY.goldPerProduction;
    expect(buyPrice(base, JIADU, { kind: 'unit', unit: 'warrior' })).toBe(price);
    expect(reason(rich(base, JIA, price - 1), warrior)).toBe('notEnoughGold');
    const { state, events } = applyWithEvents(rich(base, JIA, price), warrior);
    expect(state.polities[JIA]!.gold).toBe(0);
    const bought = state.units[state.units.length - 1]!;
    expect(bought).toMatchObject({ type: 'warrior', owner: JIA });
    expect(around(map, site(JIADU))).toContain(bought.hex);
    expect(events.map((event) => event.type)).toEqual(['unitCreated', 'itemBought']);
    expect(events[1]).toEqual({ type: 'itemBought', city: JIADU, item: { kind: 'unit', unit: 'warrior' }, gold: price });
  });

  it('puts a building in the city at once and takes it off the queue', () => {
    const ready = rich(learn(base, JIA, ['farming']), JIA);
    const queued = apply(ready, { type: 'queueBuild', polity: JIA, city: JIADU, item: { kind: 'building', building: 'granary' } });
    const state = apply(queued, granary);
    expect(state.cities[JIADU]!.buildings).toContain('granary');
    expect(state.cities[JIADU]!.queue).toHaveLength(0);
    expect(state.polities[JIA]!.gold).toBe(1000 - 40 * BUY.goldPerProduction);
    expect(state.cities[JIADU]!.yields.food).toBe(queued.cities[JIADU]!.yields.food + 2);
    expect(reason(state, granary)).toBe('alreadyBuilt');
  });

  it('is for units and buildings the city could build, and not for a city in unrest', () => {
    const wealthy = rich(base, JIA);
    expect(reason(wealthy, granary)).toBe('needsTech');
    expect(reason(wealthy, { type: 'buy', polity: JIA, city: JIADU, item: { kind: 'unit', unit: 'tank' } })).toBe('needsTech');
    expect(reason(wealthy, { type: 'buy', polity: JIA, city: JIADU, item: { kind: 'city', zone: JIABEI } })).toBe('cannotBuy');
    expect(reason(wealthy, { type: 'buy', polity: JIA, city: JIADU, item: { kind: 'project', project: 'tiangong' } })).toBe('cannotBuy');
    expect(reason(wealthy, { type: 'buy', polity: JIA, city: YIDU, item: { kind: 'unit', unit: 'warrior' } })).toBe('notYourCity');
    const unrest = edit(wealthy, (draft) => {
      draft.cities[JIADU]!.unrest = 3;
    });
    expect(reason(unrest, warrior)).toBe('inUnrest');
  });
});

describe('city-states', () => {
  const gift = (polity: number, amount: number): Action => ({ type: 'gift', polity, target: WUCHENG, amount });
  /** Wucheng of the given type with Jia as its suzerain. */
  const suzerain = (state: GameState, type: CityStateType): GameState =>
    edit(state, (draft) => {
      const self = draft.polities[WUCHENG]!;
      self.cityStateType = type;
      self.influence[JIA] = CITY_STATE.suzerainInfluence + 20;
      self.suzerain = JIA;
    });
  const grown = (state: GameState, zone: number, focus: 'gold' | 'production'): GameState =>
    edit(state, (draft) => {
      draft.cities[zone]!.pop = 18;
      draft.cities[zone]!.focus = focus;
    });

  it('have a type from the design, or one by their position on another map', () => {
    expect(base.polities[WUCHENG]!.cityStateType).toBe('finance');
    expect(base.polities[JIA]!.cityStateType).toBeNull();
    expect(base.polities[WUCHENG]!.suzerain).toBe(NO_POLITY);
  });

  it('take the polity with the most influence above the threshold as suzerain', () => {
    const wealthy = rich(rich(base, JIA), YI);
    const some = applyWithEvents(wealthy, gift(JIA, 40));
    expect(some.state.polities[WUCHENG]!.influence).toEqual({ [JIA]: 40 / CITY_STATE.goldPerInfluence });
    expect(some.state.polities[WUCHENG]!.suzerain).toBe(NO_POLITY);
    expect(some.events).toEqual([{ type: 'goldGifted', from: JIA, to: WUCHENG, amount: 40 }]);
    const need = CITY_STATE.suzerainInfluence * CITY_STATE.goldPerInfluence;
    const enough = applyWithEvents(wealthy, gift(JIA, need));
    expect(enough.state.polities[WUCHENG]!.suzerain).toBe(JIA);
    expect(enough.events).toContainEqual({ type: 'suzerainChanged', cityState: WUCHENG, from: NO_POLITY, to: JIA });
    // A tie leaves the suzerain in place; more influence takes its place.
    const tie = apply(enough.state, gift(YI, need));
    expect(tie.polities[WUCHENG]!.suzerain).toBe(JIA);
    const over = applyWithEvents(tie, gift(YI, CITY_STATE.goldPerInfluence));
    expect(over.state.polities[WUCHENG]!.suzerain).toBe(YI);
    expect(over.events).toContainEqual({ type: 'suzerainChanged', cityState: WUCHENG, from: JIA, to: YI });
    // Influence is capped.
    const capped = apply(wealthy, gift(JIA, 1000));
    expect(capped.polities[WUCHENG]!.influence[JIA]).toBe(CITY_STATE.maxInfluence);
  });

  it('forget a polity that does not keep courting them, and one that attacks them', () => {
    const need = CITY_STATE.suzerainInfluence * CITY_STATE.goldPerInfluence;
    const courted = apply(rich(base, JIA), gift(JIA, need));
    const next = endTurn(courted);
    expect(next.state.polities[WUCHENG]!.influence[JIA]).toBe(CITY_STATE.suzerainInfluence - CITY_STATE.decay);
    expect(next.state.polities[WUCHENG]!.suzerain).toBe(NO_POLITY);
    expect(next.events).toContainEqual({ type: 'suzerainChanged', cityState: WUCHENG, from: JIA, to: NO_POLITY });
    const attacked = war(courted, JIA, WUCHENG);
    expect(attacked.polities[WUCHENG]!.influence).toEqual({});
    expect(attacked.polities[WUCHENG]!.suzerain).toBe(NO_POLITY);
    expect(reason(rich(attacked, JIA), gift(JIA, 10))).toBe('atWar');
  });

  it('gain influence from a trade route to them', () => {
    const state = apply(base, routeTo(WUCHENG_ZONE));
    const after = turns(state, 3).state;
    expect(after.polities[WUCHENG]!.influence[JIA]).toBe(3 * (CITY_STATE.influencePerRoute - CITY_STATE.decay));
    const suzerainTurns = Math.ceil(CITY_STATE.suzerainInfluence / (CITY_STATE.influencePerRoute - CITY_STATE.decay));
    expect(turns(state, suzerainTurns).state.polities[WUCHENG]!.suzerain).toBe(JIA);
  });

  it('finance: a percentage of gold for the suzerain', () => {
    const big = grown(base, JIADU, 'gold');
    const without = yieldsOf(big, JIADU).gold;
    expect(without).toBeGreaterThanOrEqual(10);
    expect(yieldsOf(suzerain(big, 'finance'), JIADU).gold).toBe(
      Math.floor((without * (100 + CITY_STATE.financeGoldPercent)) / 100),
    );
  });

  it('culture: bonus culture', () => {
    const two = withCity(base, JIABEI, JIA);
    const held = suzerain(two, 'culture');
    expect(yieldsOf(held, JIADU).culture).toBe(yieldsOf(two, JIADU).culture + CITY_STATE.cultureInCapital);
    expect(yieldsOf(held, JIABEI).culture).toBe(yieldsOf(two, JIABEI).culture);
  });

  it('industry: bonus production in the capital', () => {
    const two = grown(grown(withCity(base, JIABEI, JIA), JIADU, 'production'), JIABEI, 'production');
    const without = yieldsOf(two, JIADU).production;
    expect(without).toBeGreaterThanOrEqual(10);
    const held = suzerain(two, 'industry');
    expect(yieldsOf(held, JIADU).production).toBe(
      Math.floor((without * (100 + CITY_STATE.industryCapitalProductionPercent)) / 100),
    );
    expect(yieldsOf(held, JIABEI).production).toBe(yieldsOf(two, JIABEI).production);
  });

  it('commerce: one extra trade route', () => {
    expect(tradeRouteSlots(suzerain(base, 'commerce'), JIA)).toBe(tradeRouteSlots(base, JIA) + 1);
    expect(tradeRouteSlots(suzerain(base, 'finance'), JIA)).toBe(tradeRouteSlots(base, JIA));
    // A route that only the extra slot allowed ends with the suzerainty.
    let state = apply(suzerain(base, 'commerce'), routeTo(YIDU));
    state = apply(state, routeTo(7));
    expect(state.routes).toHaveLength(2);
    const lost = endTurn(edit(state, (draft) => {
      draft.polities[WUCHENG]!.influence = {};
      draft.polities[WUCHENG]!.suzerain = NO_POLITY;
    }));
    expect(lost.state.routes).toHaveLength(1);
    expect(lost.events).toContainEqual({ type: 'routeEnded', route: 2, owner: JIA, reason: 'lost' });
  });

  it('naval: experience for newly built ships', () => {
    // A coast hex next to Jia's capital, so that it can launch ships.
    const bay = around(map, site(JIADU)).find((hex) => isPlainGround(map, hex))!;
    const terrain = Uint8Array.from(map.terrain);
    const zone = Int16Array.from(map.zone);
    const owner = Int16Array.from(map.owner);
    terrain[bay] = Terrain.Coast;
    zone[bay] = NO_ZONE;
    owner[bay] = OWNER_SEA;
    const bayMap: MapData = { ...map, terrain, zone, owner };
    const start = rich(learn(createGame(bayMap, { seed: 3, player: 'jia', majors: [] }), JIA, ['boats']), JIA);
    const galley: Action = { type: 'buy', polity: JIA, city: JIADU, item: { kind: 'unit', unit: 'galley' } };
    const plain = apply(start, galley);
    expect(plain.units[plain.units.length - 1]).toMatchObject({ type: 'galley', xp: 0, level: 0 });
    const held = apply(suzerain(start, 'naval'), galley);
    expect(held.units[held.units.length - 1]).toMatchObject({ type: 'galley', xp: CITY_STATE.navalXp, level: 1 });
    // Built, not bought, is the same; a land unit gets nothing.
    const queued = apply(suzerain(start, 'naval'), { type: 'queueBuild', polity: JIA, city: JIADU, item: { kind: 'unit', unit: 'galley' } });
    const built = turns(edit(queued, (draft) => {
      draft.cities[JIADU]!.progress = 1000;
    }), 1).state;
    expect(built.units.find((unit) => unit.type === 'galley')).toMatchObject({ xp: CITY_STATE.navalXp, level: 1 });
    const warrior = apply(suzerain(start, 'naval'), { type: 'buy', polity: JIA, city: JIADU, item: { kind: 'unit', unit: 'warrior' } });
    expect(warrior.units[warrior.units.length - 1]).toMatchObject({ type: 'warrior', xp: 0, level: 0 });
  });

  it('pay their suzerain a share of their gold', () => {
    const held = suzerain(grown(base, WUCHENG_ZONE, 'gold'), 'finance');
    const after = endTurn(held).state;
    const income = after.polities[WUCHENG]!.yields.gold;
    const tribute = Math.floor((income * CITY_STATE.tributePercent) / 100);
    expect(tribute).toBeGreaterThan(0);
    expect(after.polities[JIA]!.tributeReceived).toBe(tribute);
    expect(after.polities[WUCHENG]!.tributePaid).toBe(tribute);
  });

  it('take the bonus from everyone when they are conquered', () => {
    const big = grown(base, JIADU, 'gold');
    const held = suzerain(big, 'finance');
    const falling = edit(war(held, BING, WUCHENG), (draft) => {
      draft.cities[WUCHENG_ZONE]!.hp = 0;
      for (const unit of draft.units.filter((entry) => entry.owner === WUCHENG)) draft.units.splice(draft.units.indexOf(unit), 1);
      const beside = around(map, site(WUCHENG_ZONE)).find((hex) => isPlainGround(map, hex))!;
      put(draft, 'swordsman', BING, beside, { id: 830 });
    });
    const fallen = applyWithEvents(falling, { type: 'attack', polity: BING, unit: 830, target: site(WUCHENG_ZONE) });
    expect(fallen.state.cities[WUCHENG_ZONE]!.owner).toBe(BING);
    expect(fallen.state.polities[WUCHENG]!.alive).toBe(false);
    expect(fallen.state.polities[WUCHENG]!.suzerain).toBe(NO_POLITY);
    expect(fallen.events).toContainEqual({ type: 'suzerainChanged', cityState: WUCHENG, from: JIA, to: NO_POLITY });
    expect(yieldsOf(fallen.state, JIADU).gold).toBe(yieldsOf(big, JIADU).gold);
    // The conqueror does not inherit it.
    const bingCapital = 5;
    expect(yieldsOf(fallen.state, bingCapital).gold).toBe(yieldsOf(falling, bingCapital).gold);
  });
});

describe('the Economic victory', () => {
  it('ranks only the major nations and the player', () => {
    const last = edit(createGame(map, { seed: 3, player: 'jia', majors: ['yi'], turns: 1 }), (draft) => {
      draft.polities[DING]!.grossIncome = 1_000_000;
      draft.polities[WUCHENG]!.grossIncome = 2_000_000;
      draft.polities[YI]!.grossIncome = 500;
    });
    expect(endTurn(last).state.result).toEqual({ kind: 'economic', winner: YI, turn: 1 });
    const player = edit(last, (draft) => {
      draft.polities[JIA]!.grossIncome = 900;
    });
    expect(endTurn(player).state.result).toEqual({ kind: 'economic', winner: JIA, turn: 1 });
  });

  it('counts trade, tribute and deals as income', () => {
    const state = apply(withAgreement(base, 'vassalage', JIA, YI), routeTo(7));
    const after = endTurn(state).state.polities[JIA]!;
    expect(after.grossIncome).toBe(after.yields.gold + after.routeIncome + after.tributeReceived);
    expect(after.routeIncome).toBeGreaterThan(0);
  });
});

describe('trade, roads and city-states in a saved game', () => {
  it('survive a round trip and continue to the same state', () => {
    let state = apply(rich(withCity(base, JIABEI, JIA), JIA), routeTo(WUCHENG_ZONE));
    state = apply(state, { type: 'gift', polity: JIA, target: WUCHENG, amount: 200 });
    state = turns(state, 4).state;
    expect(Object.keys(state.roads).length).toBeGreaterThan(5);
    const loaded = loadGame(saveGame(state), map);
    expect(loaded).toEqual(state);
    expect(hashState(loaded)).toBe(hashState(state));
    expect(hashState(turns(loaded, 5).state)).toBe(hashState(turns(state, 5).state));
  });
});
