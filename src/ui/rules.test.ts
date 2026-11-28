import { describe, expect, it } from 'vitest';
import { BUILDINGS, CITY_PROJECT_IDS, UNITS } from '../core/data.ts';
import { createGame, endTurn } from '../core/game.ts';
import { HOME_ZONE, LAND, SELF, labGame } from '../core/kitLab.ts';
import { apply, edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { Terrain } from '../shared/mapData.ts';
import { itemName } from './names.ts';
import {
  check,
  cityView,
  cityZoneAt,
  demandAction,
  pillageAction,
  polityRows,
  politySummary,
  ranking,
  relationView,
  researchView,
  sortPolityRows,
  upgradeView,
  victoryView,
} from './rules.ts';

const map = createFixtureMap();
const JIA = 0;
const YI = 1;
const capital = map.polities[JIA]!.capitalZone;

describe('cityView for a nation with a kit', () => {
  it('lists the unique unit under the generic id and the unique building under its own', () => {
    const { state } = labGame('qi');
    const view = cityView(state, HOME_ZONE)!;
    const warrior = view.units.find((option) => option.item.kind === 'unit' && option.item.unit === 'warrior')!;
    expect(warrior).toBeDefined();
    expect(itemName(state.map, warrior.item, SELF)).toBe('技击士');
    expect(view.units.some((option) => option.item.kind === 'unit' && option.item.unit === 'jijiInfantry')).toBe(false);
    const buildings = view.buildings.map((option) => (option.item.kind === 'building' ? option.item.building : ''));
    expect(buildings).toContain('jixiaAcademy');
    expect(buildings).not.toContain('academy');
    // the cost is the unique unit's
    expect(warrior.cost).toBe(UNITS.jijiInfantry!.cost);
    const plain = cityView(labGame(null).state, HOME_ZONE)!;
    expect(plain.buildings.map((option) => (option.item.kind === 'building' ? option.item.building : ''))).toContain('academy');
    expect(plain.buildings.some((option) => option.item.kind === 'building' && BUILDINGS[option.item.building].nation !== null)).toBe(false);
  });

  it('offers every hex the rules let the city improve: 夜郎 farms its mountains', () => {
    const base = labGame('yelang').state;
    const topo = topologyOf(base.map);
    const hex = topo.workHexes[HOME_ZONE]!.find((candidate) => topo.water[candidate] === 0 && base.map.zone[candidate] === HOME_ZONE)!;
    const mountain = (nation: string | null) =>
      labGame(nation, {
        tweak: (m) => {
          m.terrain[hex] = Terrain.Mountain;
        },
      }).state;
    const farm = (nation: string | null) => cityView(mountain(nation), HOME_ZONE)!.improvements.find((option) => option.improvement === 'farm');
    expect(farm('yelang')!.hexes).toContain(hex);
    expect(farm(null)?.hexes ?? []).not.toContain(hex);
    // a nation's own improvement is offered to it alone
    const improvements = (nation: string | null) => cityView(labGame(nation).state, HOME_ZONE)!.improvements.map((option) => option.improvement);
    expect(improvements('chenla')).toContain('baray');
    expect(improvements(null)).not.toContain('baray');
  });

  it('shows the price of an upgrade as the rules take it', () => {
    const priced = (nation: string | null): number => {
      let id = 0;
      const state = edit(labGame(nation).state, (draft) => {
        draft.units = draft.units.filter((unit) => unit.hex !== LAND);
        id = put(draft, 'warrior', SELF, LAND).id;
      });
      return upgradeView(state, id)!.gold;
    };
    expect(priced('xiaoxiang')).toBeLessThan(priced(null));
    expect(priced('xiaoxiang')).toBe(Math.floor(priced(null) * 0.9));
  });
});

describe('cityView', () => {
  it('offers what the rules allow in the first era, with costs and turns', () => {
    const state = createGame(map, { player: 'jia' });
    const view = cityView(state, capital)!;
    expect(view.queue).toEqual([]);
    const units = view.units.map((option) => (option.item.kind === 'unit' ? option.item.unit : ''));
    expect(units).toContain('warrior');
    expect(units).not.toContain('swordsman');
    expect(units).not.toContain('settler');
    expect(units).not.toContain('tribe');
    const warrior = view.units.find((option) => option.item.kind === 'unit' && option.item.unit === 'warrior')!;
    expect(warrior.cost).toBe(24);
    expect(warrior.turns).toBe(Math.ceil(24 / view.city.yields.production));
    // buildings wait for their techs
    expect(view.buildings).toEqual([]);
    expect(view.projects).toEqual([]);
    const learned = edit(state, (draft) => {
      draft.polities[JIA]!.techs.push('farming');
    });
    expect(cityView(learned, capital)!.buildings.map((option) => (option.item.kind === 'building' ? option.item.building : ''))).toEqual(['granary']);
    // Jia has two more sites of its own to found cities on
    expect(view.sites).toHaveLength(2);
    for (const entry of view.improvements) {
      expect(entry.hexes.length).toBeGreaterThan(0);
      for (const hex of entry.hexes) {
        const item = { kind: 'improvement', improvement: entry.improvement, hex } as const;
        expect(check(state, { type: 'queueBuild', polity: JIA, city: capital, item })).toBeNull();
      }
    }
    expect(cityView(state, map.zones.findIndex((zone) => zone.id === 'jia-2'))).toBeNull();
  });

  it('lists the city projects apart from the buildings, with what each turns production into', () => {
    const state = edit(createGame(map, { player: 'jia' }), (draft) => {
      draft.polities[JIA]!.techs.push('farming', 'ritual', 'writing', 'currency');
    });
    const view = cityView(state, capital)!;
    const built = view.buildings.map((option) => (option.item.kind === 'building' ? option.item.building : ''));
    expect(built).toContain('granary');
    for (const id of CITY_PROJECT_IDS) expect(built).not.toContain(id);
    expect(view.conversions.map((entry) => entry.building)).toEqual(CITY_PROJECT_IDS);
    const production = view.city.yields.production;
    for (const entry of view.conversions) {
      const { converts } = BUILDINGS[entry.building];
      expect(entry.item).toEqual({ kind: 'building', building: entry.building });
      expect({ to: entry.to, percent: entry.percent }).toEqual(converts);
      expect(entry.perTurn).toBe(Math.floor((production * entry.percent) / 100));
      expect(entry.queued).toBe(false);
      expect(check(state, { type: 'queueBuild', polity: JIA, city: capital, item: entry.item })).toBeNull();
    }
    // each waits for its tech: a nation that knows none is offered none
    expect(cityView(createGame(map, { player: 'jia' }), capital)!.conversions).toEqual([]);
    const ritual = edit(createGame(map, { player: 'jia' }), (draft) => {
      draft.polities[JIA]!.techs.push(BUILDINGS.festival.tech);
    });
    expect(cityView(ritual, capital)!.conversions.map((entry) => entry.building)).toEqual(['festival']);
  });

  it('marks a city project in the queue: no cost, no end, the rate instead', () => {
    let state = edit(createGame(map, { player: 'jia' }), (draft) => {
      draft.polities[JIA]!.techs.push('ritual');
    });
    state = apply(state, { type: 'queueBuild', polity: JIA, city: capital, item: { kind: 'unit', unit: 'warrior' } });
    state = apply(state, { type: 'queueBuild', polity: JIA, city: capital, item: { kind: 'building', building: 'festival' } });
    const view = cityView(state, capital)!;
    expect(view.queue.map((entry) => entry.converts)).toEqual([null, { to: 'culture', percent: 25 }]);
    expect(view.queue[1]!.turns).toBeNull();
    // while it waits it stays in the list, marked: queueing it again is refused
    expect(view.conversions.map((entry) => [entry.building, entry.queued])).toEqual([['festival', true]]);
    expect(check(state, { type: 'queueBuild', polity: JIA, city: capital, item: view.conversions[0]!.item })).toBe('alreadyQueued');
  });

  it('counts stored production towards the first queue entry only', () => {
    let state = createGame(map, { player: 'jia' });
    const item = { kind: 'unit', unit: 'warrior' } as const;
    state = apply(state, { type: 'queueBuild', polity: JIA, city: capital, item });
    state = apply(state, { type: 'queueBuild', polity: JIA, city: capital, item });
    state = endTurn(state).state;
    const view = cityView(state, capital)!;
    const production = view.city.yields.production;
    expect(view.city.progress).toBeGreaterThan(0);
    expect(view.queue.map((entry) => entry.turns)).toEqual([
      Math.ceil((24 - view.city.progress) / production),
      Math.ceil(24 / production),
    ]);
  });
});

describe('summaries', () => {
  it('sums a polity\'s city yields and averages morale', () => {
    const state = createGame(map, { player: 'jia' });
    const summary = politySummary(state, JIA);
    const city = state.cities[capital]!;
    expect(summary).toEqual({ yields: city.yields, net: city.yields.gold, morale: 100, cities: 1 });
    expect(politySummary(state, 5).morale).toBeNull();
  });

  it('tells war, truce and peace apart', () => {
    let state = createGame(map, { player: 'jia' });
    expect(relationView(state, JIA, YI)).toEqual({ kind: 'peace' });
    state = apply(state, { type: 'declareWar', polity: JIA, target: YI });
    expect(relationView(state, YI, JIA)).toEqual({ kind: 'war', since: 1 });
    const peace = edit(state, (draft) => {
      draft.turn = 20;
      const relation = draft.relations['0:1']!;
      relation.atWar = false;
      relation.since = 15;
    });
    expect(relationView(peace, JIA, YI)).toEqual({ kind: 'truce', until: 25 });
    expect(check(peace, { type: 'declareWar', polity: JIA, target: YI })).toBe('truce');
    expect(relationView({ ...peace, turn: 25 }, JIA, YI)).toEqual({ kind: 'peace' });
  });

  it('ranks the winner first and the rest by income', () => {
    let state = createGame(map, { seed: 1 });
    while (state.result === null) state = endTurn(state).state;
    const rows = ranking(state);
    expect(rows[0]!.polity).toBe(state.result.winner);
    expect(rows.map((row) => row.polity).sort()).toEqual([...state.majors].sort());
    const rest = rows.slice(1).filter((row) => row.alive);
    for (let i = 1; i < rest.length; i++) expect(rest[i - 1]!.income).toBeGreaterThanOrEqual(rest[i]!.income);
  });

  it('shows the research under way with the turns it still takes', () => {
    const start = createGame(map, { player: 'jia' });
    expect(researchView(start, JIA)).toBeNull();
    // the rules pick a tech for a player who has chosen none
    const state = endTurn(start).state;
    const view = researchView(state, JIA)!;
    expect(view.tech).toBe(state.polities[JIA]!.research);
    expect(view.turns).toBeGreaterThanOrEqual(1);
    expect(researchView(state, 5)).toBeNull();
  });

  it('offers an upgrade only once its tech is known', () => {
    let id = 0;
    const state = edit(createGame(map, { player: 'jia' }), (draft) => {
      id = put(draft, 'archer', JIA, map.zones[capital]!.siteHex + 1).id;
    });
    expect(upgradeView(state, id)).toBeNull();
    const learned = edit(state, (draft) => {
      draft.polities[JIA]!.techs.push('crossbow');
    });
    expect(upgradeView(learned, id)).toEqual({ type: 'crossbowman', gold: 24 });
    expect(upgradeView(state, 99999)).toBeNull();
  });

  it('finds the city on a hex', () => {
    const state = createGame(map);
    expect(cityZoneAt(state, map.zones[capital]!.siteHex)).toBe(capital);
    expect(cityZoneAt(state, map.zones.find((zone) => zone.id === 'jia-2')!.siteHex)).toBe(-1);
    expect(cityZoneAt(state, 0)).toBe(-1);
  });
});

describe('victoryView', () => {
  it('names the leader of each victory and where the player stands', () => {
    const start = createGame(map, { seed: 3, player: 'jia' });
    const state = edit(start, (draft) => {
      draft.polities[1]!.projectStage = 2;
      draft.polities[2]!.grossIncome = 900;
      draft.polities[0]!.grossIncome = 300;
    });
    const view = victoryView(state);
    expect(view.turnsLeft).toBe(state.lastTurn - state.turn);
    expect(view.lines.map((line) => line.kind)).toEqual(['conquest', 'science', 'economic']);
    const [conquest, science, economic] = view.lines;
    // everybody holds its own capital: the tie goes to the first
    expect(conquest).toMatchObject({ leaderValue: 1, playerValue: 1 });
    expect(conquest!.needed).toBeGreaterThan(1);
    expect(science).toMatchObject({ leader: 1, leaderValue: 2, playerValue: 0, needed: 3 });
    expect(economic).toMatchObject({ leader: 2, leaderValue: 900, playerValue: 300, needed: null });
  });

  it('has no player value in observer mode', () => {
    const view = victoryView(createGame(map, { seed: 3 }));
    expect(view.lines.every((line) => line.playerValue === null)).toBe(true);
    expect(view.lines.every((line) => line.leader >= 0)).toBe(true);
  });
});

describe('polityRows', () => {
  const state = edit(createGame(map, { seed: 3, player: 'jia' }), (draft) => {
    draft.favour['0:1'] = 40;
    draft.favour['0:2'] = -25;
  });
  const rows = polityRows(state, 0);

  it('lists every living polity but the viewer', () => {
    const alive = state.polities.flatMap((polity, index) => (polity.alive && index !== 0 ? [index] : []));
    expect(rows.map((row) => row.polity)).toEqual(alive);
    expect(rows.find((row) => row.polity === 1)).toMatchObject({ favour: 40 });
    const cityState = map.polities.findIndex((polity) => polity.kind === 'cityState');
    expect(rows.find((row) => row.polity === cityState)!.favour).toBeNull();
    for (const row of rows) {
      expect(row.strength).toBeGreaterThan(0);
      expect(row.distance).toBeGreaterThan(0);
    }
  });

  it('sorts by favour, strength and distance, both ways, with missing values last', () => {
    const byFavour = sortPolityRows(rows, 'favour', true);
    expect(byFavour[0]!.polity).toBe(1);
    const numbered = byFavour.filter((row) => row.favour !== null);
    expect(numbered.at(-1)!.polity).toBe(2);
    expect(byFavour.slice(numbered.length).every((row) => row.favour === null)).toBe(true);
    const ascending = sortPolityRows(rows, 'favour', false);
    expect(ascending[0]!.polity).toBe(2);
    expect(ascending.slice(numbered.length).every((row) => row.favour === null)).toBe(true);

    const near = sortPolityRows(rows, 'distance', false);
    for (let i = 1; i < near.length; i++) expect(near[i - 1]!.distance!).toBeLessThanOrEqual(near[i]!.distance!);
    const strong = sortPolityRows(rows, 'strength', true);
    for (let i = 1; i < strong.length; i++) expect(strong[i - 1]!.strength).toBeGreaterThanOrEqual(strong[i]!.strength);
    expect(sortPolityRows(rows, 'strength', true)).toEqual(strong);
  });

  it('has neither favour nor distance in observer mode', () => {
    const watched = polityRows(createGame(map, { seed: 3 }), -1);
    expect(watched.every((row) => row.favour === null && row.distance === null)).toBe(true);
  });
});

describe('pillageAction and demandAction', () => {
  const topo = topologyOf(map);
  const own = map.zones[capital]!.siteHex;
  const enemyZone = map.polities[YI]!.capitalZone;
  const enemySite = map.zones[enemyZone]!.siteHex;
  const beside = (site: number): number => {
    for (let d = 0; d < 6; d++) {
      const hex = topo.neighbors[site * 6 + d]!;
      if (hex >= 0 && topo.water[hex] === 0 && topo.enterable[hex] === 1) return hex;
    }
    throw new Error('no land next to the site');
  };
  const war = (draft: Parameters<Parameters<typeof edit>[1]>[0]): void => {
    draft.relations['0:1'] = { a: 0, b: 1, atWar: true, since: 1, offerA: 0, offerB: 0 };
  };

  it('offer nothing to a unit beside its own capital, with or without moves', () => {
    for (const moves of [2, 0]) {
      let id = 0;
      const state = edit(createGame(map, { player: 'jia' }), (draft) => {
        id = put(draft, 'warrior', JIA, beside(own), { moves }).id;
      });
      expect(pillageAction(state, id), `moves ${moves}`).toBeNull();
      expect(demandAction(state, id), `moves ${moves}`).toBeNull();
    }
    expect(pillageAction(createGame(map), -3)).toBeNull();
    expect(demandAction(createGame(map), -3)).toBeNull();
  });

  it('offer the demand at an enemy capital: refused until the city has fallen, then accepted', () => {
    let id = 0;
    const siege = edit(createGame(map, { player: 'jia' }), (draft) => {
      war(draft);
      id = put(draft, 'warrior', JIA, beside(enemySite)).id;
    });
    const waiting = demandAction(siege, id)!;
    expect(waiting).toMatchObject({ type: 'demandVassalage', unit: id, target: enemySite });
    expect(check(siege, waiting)).toBe('cityNotFallen');
    const fallen = edit(siege, (draft) => {
      draft.cities[enemyZone]!.hp = 0;
    });
    expect(check(fallen, demandAction(fallen, id)!)).toBeNull();
    // at peace, or out of moves, there is no demand to show
    const peace = edit(fallen, (draft) => {
      draft.relations['0:1']!.atWar = false;
    });
    expect(demandAction(peace, id)).toBeNull();
    const spent = edit(fallen, (draft) => {
      draft.units.find((unit) => unit.id === id)!.moves = 0;
    });
    expect(demandAction(spent, id)).toBeNull();
  });

  it('offer pillage on an enemy improvement, and not once the unit has no moves', () => {
    const field = topo.zoneHexes[enemyZone]!.find((hex) => hex !== enemySite && topo.water[hex] === 0 && topo.enterable[hex] === 1)!;
    let id = 0;
    const raid = edit(createGame(map, { player: 'jia' }), (draft) => {
      war(draft);
      draft.improvements[field] = 'farm';
      for (const unit of draft.units) if (unit.hex === field) unit.hex = -1;
      draft.units = draft.units.filter((unit) => unit.hex !== -1);
      id = put(draft, 'warrior', JIA, field).id;
    });
    const action = pillageAction(raid, id)!;
    expect(action).toEqual({ type: 'pillage', polity: JIA, unit: id });
    expect(check(raid, action)).toBeNull();
    const spent = edit(raid, (draft) => {
      draft.units.find((unit) => unit.id === id)!.moves = 0;
    });
    expect(pillageAction(spent, id)).toBeNull();
  });
});

