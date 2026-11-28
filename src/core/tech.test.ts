import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { dictionaries } from '../shared/i18n.ts';
import { Feature, NO_RESOURCE, Terrain } from '../shared/mapData.ts';
import {
  AIR_STRIKE,
  BUILDINGS,
  GENERIC_BUILDING_IDS,
  isCityProject,
  GENERIC_IMPROVEMENT_IDS,
  UNIT_IDS,
  ERAS,
  IMPROVEMENTS,
  PROJECT,
  RESEARCH,
  STRATEGIC_RESOURCES,
  TECHS,
  TECH_IDS,
  UNITS,
} from './data.ts';
import type { TechId } from './data.ts';
import {
  NO_POLITY,
  applyAction,
  createGame,
  currentEra,
  endTurn,
  getLegalActions,
  hashState,
  hexOwner,
  loadGame,
  polityEra,
  polityHasResource,
  researchCost,
  resourceOnHex,
  saveGame,
} from './game.ts';
import type { Action, BuildItem, City, GameEvent, GameState, MutableGameState } from './game.ts';
import { apply, applyWithEvents, around, edit, findPair, isPlainGround, learn, put, withResource } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const YI = 1;
const BING = 2;
const DING = 3;
const WUCHENG = 4;
const site = (zone: number): number => map.zones[zone]!.siteHex;
const apart = (a: number, b: number): number => hexDistance(indexToOffset(a, map.width), indexToOffset(b, map.width));
const ANCIENT = TECH_IDS.filter((tech) => TECHS[tech].era === 0);
const PROJECT_ITEM: BuildItem = { kind: 'project', project: PROJECT.id };
const FARM_TERRAINS: readonly number[] = IMPROVEMENTS.farm.terrains;
const CANAL_TERRAINS: readonly number[] = IMPROVEMENTS.irrigationCanal.terrains;

/** Jia is the human player and the only polity that researches; nobody declares war. */
const base = createGame(map, { seed: 3, player: 'jia', majors: [] });
const reason = (state: GameState, action: Action): string => {
  const result = applyAction(state, action);
  return result.ok ? 'ok' : result.reason;
};
const build = (state: GameState, item: BuildItem, city = 0): string =>
  reason(state, { type: 'queueBuild', polity: state.cities[city]!.owner, city, item });
const research = (state: GameState, tech: TechId, polity = JIA): string =>
  reason(state, { type: 'setResearch', polity, tech });
const war = (state: GameState, a: number, b: number): GameState => apply(state, { type: 'declareWar', polity: a, target: b });
/** Gives `owner` a city on the site of `zone`, copied from Jia's capital. */
const addCity = (draft: MutableGameState, zone: number, owner: number): void => {
  draft.cities[zone] = { ...(JSON.parse(JSON.stringify(draft.cities[0])) as City), zone, owner };
  draft.zoneOwner[zone] = owner;
};

describe('tech table', () => {
  it('has the 40 techs of the design, seven in each of the first four eras and six in the last two', () => {
    expect(TECH_IDS).toHaveLength(40);
    expect(ERAS.map((_, era) => TECH_IDS.filter((tech) => TECHS[tech].era === era).length)).toEqual([7, 7, 7, 7, 6, 6]);
    for (const tech of TECH_IDS) expect(TECHS[tech].cost, tech).toBeGreaterThan(0);
  });

  it('gives every tech after the ancient era one or two prerequisites from earlier eras', () => {
    for (const tech of TECH_IDS) {
      const def = TECHS[tech];
      if (def.era === 0) {
        expect(def.requires, tech).toHaveLength(0);
        continue;
      }
      expect(def.requires.length, tech).toBeGreaterThanOrEqual(1);
      expect(def.requires.length, tech).toBeLessThanOrEqual(2);
      for (const id of def.requires) expect(TECHS[id].era, `${tech} <- ${id}`).toBeLessThan(def.era);
    }
  });

  it('lets every tech be reached under the four-techs-per-era rule', () => {
    const known: TechId[] = [];
    let era = 0;
    for (;;) {
      const next = TECH_IDS.find(
        (tech) => !known.includes(tech) && TECHS[tech].era <= era && TECHS[tech].requires.every((id) => known.includes(id)),
      );
      if (next === undefined) break;
      known.push(next);
      while (era < ERAS.length - 1 && known.filter((tech) => TECHS[tech].era === era).length >= RESEARCH.techsToAdvance) era++;
    }
    expect(known).toHaveLength(40);
  });

  it('unlocks what doc 04 lists', () => {
    const expected: Record<TechId, string[]> = {
      farming: ['farm', 'granary'],
      husbandry: ['pasture', 'chariot'],
      mining: ['mine'],
      archery: ['archer'],
      fortification: ['walls', 'batteringRam'],
      ritual: ['temple', 'festival'],
      boats: ['fishery', 'galley'],
      writing: ['academy', 'compilation'],
      currency: ['market', 'minting'],
      ironworking: ['swordsman'],
      riding: ['horseman'],
      irrigation: ['irrigationCanal', 'canal'],
      crossbow: ['crossbowman', 'catapult'],
      shipbuilding: ['harbour', 'warJunk'],
      paper: ['printShop'],
      stirrup: ['heavyCavalry'],
      steel: ['heavyInfantry'],
      compass: ['junk'],
      machinery: ['workshop', 'trebuchet'],
      guilds: [],
      gunpowder: ['rocketArcher'],
      printing: ['university'],
      firearms: ['musketeer', 'dragoon'],
      gunCasting: ['heavyCannon', 'fieldGun'],
      oceanNavigation: ['shipOfTheLine'],
      banking: ['bank'],
      astronomy: ['observatory'],
      newCrops: [],
      steamEngine: ['factory'],
      railway: [],
      rifling: ['rifleman', 'mountedRifleman'],
      steelmaking: ['ironclad', 'howitzer', 'machineGun'],
      electricity: ['powerPlant'],
      publicHealth: ['hospital'],
      combustion: ['tank'],
      aviation: ['airfield'],
      electronics: ['researchInstitute', 'missileLauncher'],
      petrochemicals: ['mechInfantry', 'destroyer'],
      rocketry: ['rocketArtillery'],
      informationNetworks: [],
    };
    for (const tech of TECH_IDS) {
      const unlocked = [
        ...GENERIC_IMPROVEMENT_IDS.filter((id) => IMPROVEMENTS[id].tech === tech),
        ...GENERIC_BUILDING_IDS.filter((id) => BUILDINGS[id].tech === tech),
        ...UNIT_IDS.filter((id) => UNITS[id]!.tech === tech),
      ];
      expect(unlocked.sort(), tech).toEqual([...expected[tech]].sort());
    }
    expect(UNITS.warrior!.tech).toBeNull();
    // What a tech does besides.
    expect(STRATEGIC_RESOURCES).toEqual({
      horses: 'husbandry', iron: 'ironworking', coal: 'steamEngine', oil: 'combustion', 'rare-earths': 'electronics',
    });
    expect(TECHS.boats.sea).toBe('coast');
    expect(TECHS.compass.sea).toBe('ocean');
    expect(TECH_IDS.filter((tech) => TECHS[tech].tradeRoutes === 1)).toEqual(['currency', 'guilds', 'banking']);
    expect(TECHS.currency.ports).toBe('land');
    expect(TECHS.oceanNavigation.ports).toBe('sea');
    expect(TECHS.railway.railways).toBe(true);
    expect(TECHS.newCrops.hillFarms).toBe(true);
    expect(PROJECT.stages.map((stage) => stage.tech)).toEqual(['rocketry', 'electronics', 'informationNetworks']);
  });

  it('gates units by strategic resource as doc 04 says', () => {
    const needing = (resource: string): string[] =>
      UNIT_IDS.filter((id) => UNITS[id]!.resource === resource).sort();
    expect(needing('horses')).toEqual(['chariot', 'dragoon', 'heavyCavalry', 'horseman', 'mountedRifleman']);
    expect(needing('iron')).toEqual(['heavyInfantry', 'swordsman']);
    expect(needing('coal')).toEqual(['ironclad']);
    expect(needing('oil')).toEqual(['destroyer', 'mechInfantry', 'tank']);
    expect(needing('rare-earths')).toEqual(['missileLauncher']);
  });

  it('has the 16 generic buildings, each with an effect, an upkeep and a tech of its era', () => {
    // The city projects are listed with the buildings but are none: they have their own test.
    const buildings = GENERIC_BUILDING_IDS.filter((id) => !isCityProject(id));
    expect([...buildings].sort()).toEqual([
      'academy', 'airfield', 'bank', 'factory', 'granary', 'harbour', 'hospital', 'market', 'observatory', 'powerPlant',
      'printShop', 'researchInstitute', 'temple', 'university', 'walls', 'workshop',
    ]);
    expect(GENERIC_BUILDING_IDS.filter(isCityProject).sort()).toEqual(['compilation', 'festival', 'minting']);
    for (const id of buildings) {
      const def = BUILDINGS[id];
      const effects =
        Object.keys(def.yields).length + Object.keys(def.percent).length + Object.keys(def.waterYields).length +
        (def.cityHp > 0 ? 1 : 0) + (def.counterStrike ? 1 : 0) + (def.airStrike ? 1 : 0);
      expect(effects, id).toBeGreaterThan(0);
      expect(def.upkeep, id).toBeGreaterThanOrEqual(0);
      expect(def.cost, id).toBeGreaterThan(0);
      expect(def.era, id).toBe(TECHS[def.tech].era);
    }
  });

  it('has a Chinese and an English name for every tech', () => {
    for (const tech of TECH_IDS) {
      expect(dictionaries.zh[`tech.${tech}`], tech).toBeTruthy();
      expect(dictionaries.en[`tech.${tech}`], tech).toBeTruthy();
    }
    expect(dictionaries.zh['tech.boats']).toBe('舟楫');
    expect(dictionaries.en['tech.informationNetworks']).toBe('Information Networks');
    expect(dictionaries.zh['project.tiangong']).toBe('天宫工程');
  });
});

describe('research', () => {
  it('starts everybody in the ancient era knowing nothing', () => {
    for (const polity of base.polities) {
      expect(polity).toMatchObject({ techs: [], research: null, researchProgress: 0, era: 0, projectStage: 0 });
    }
    expect(currentEra(base)).toBe(0);
  });

  it('takes one tech at a time, whose prerequisites are known and whose era has been entered', () => {
    const chosen = apply(base, { type: 'setResearch', polity: JIA, tech: 'farming' });
    expect(chosen.polities[JIA]!.research).toBe('farming');
    expect(apply(chosen, { type: 'setResearch', polity: JIA, tech: 'mining' }).polities[JIA]!.research).toBe('mining');
    // Classical techs wait for the classical era, whatever is known.
    expect(research(base, 'writing')).toBe('eraTooEarly');
    expect(research(learn(base, JIA, ['ritual']), 'writing')).toBe('eraTooEarly');
    const classical = learn(base, JIA, ['farming', 'husbandry', 'mining', 'archery']);
    expect(polityEra(classical, JIA)).toBe(1);
    expect(research(classical, 'currency')).toBe('ok');
    expect(research(classical, 'writing')).toBe('missingPrerequisite');
    expect(research(classical, 'crossbow')).toBe('missingPrerequisite');
    expect(research(learn(classical, JIA, ['fortification']), 'crossbow')).toBe('ok');
    expect(research(classical, 'paper')).toBe('eraTooEarly');
    expect(research(classical, 'farming')).toBe('alreadyKnown');
    expect(reason(base, { type: 'setResearch', polity: JIA, tech: 'alchemy' as TechId })).toBe('badItem');
  });

  it('offers exactly the open techs as legal actions', () => {
    const offered = (state: GameState): string[] =>
      getLegalActions(state, JIA).flatMap((action) => (action.type === 'setResearch' ? [action.tech] : []));
    expect(offered(base)).toEqual(ANCIENT);
    const classical = learn(base, JIA, ['farming', 'husbandry', 'mining', 'archery']);
    expect(offered(classical).sort()).toEqual(['boats', 'currency', 'fortification', 'ironworking', 'irrigation', 'riding', 'ritual']);
  });

  it('turns science into the tech and reports it', () => {
    const cost = TECHS.farming.cost;
    expect(researchCost(base, JIA, 'farming')).toBe(cost);
    const chosen = apply(base, { type: 'setResearch', polity: JIA, tech: 'farming' });
    const first = endTurn(chosen);
    const science = first.state.polities[JIA]!.yields.science;
    expect(science).toBeGreaterThan(0);
    expect(first.state.polities[JIA]).toMatchObject({ research: 'farming', researchProgress: science, techs: [] });
    const almost = edit(chosen, (draft) => {
      draft.polities[JIA]!.researchProgress = cost - 1;
    });
    const done = endTurn(almost);
    expect(done.events).toContainEqual({ type: 'researchFinished', polity: JIA, tech: 'farming' });
    expect(done.state.polities[JIA]).toMatchObject({ techs: ['farming'], research: null, researchProgress: science - 1 });
  });

  it('picks a tech for a player who has chosen none', () => {
    const next = endTurn(base).state;
    expect(next.polities[JIA]!.research).not.toBeNull();
    expect(ANCIENT).toContain(next.polities[JIA]!.research);
  });

  it('enters the next era with four techs of the current one', () => {
    const three = learn(base, JIA, ['farming', 'mining', 'ritual']);
    expect(polityEra(three, JIA)).toBe(0);
    const researching = edit(apply(three, { type: 'setResearch', polity: JIA, tech: 'boats' }), (draft) => {
      draft.polities[JIA]!.researchProgress = TECHS.boats.cost;
    });
    const result = endTurn(researching);
    expect(result.events).toContainEqual({ type: 'eraEntered', polity: JIA, era: 1 });
    expect(result.events).toContainEqual({ type: 'eraStarted', era: 1 });
    expect(polityEra(result.state, JIA)).toBe(1);
    expect(currentEra(result.state)).toBe(1);
    // The era is the highest entered: later techs of an old era change nothing.
    expect(polityEra(learn(result.state, JIA, ['husbandry', 'archery', 'fortification']), JIA)).toBe(1);
    expect(polityEra(learn(base, JIA), JIA)).toBe(5);
  });

  it('follows the most advanced major in observer mode', () => {
    const observed = createGame(map, { majors: ['jia', 'yi'] });
    expect(currentEra(learn(observed, YI, ANCIENT.slice(0, 4)))).toBe(1);
    expect(currentEra(learn(observed, DING, ANCIENT.slice(0, 4)))).toBe(0);
  });

  it('charges 20% less for a tech another polity knows', () => {
    const cost = TECHS.farming.cost;
    const known = learn(base, YI, ['farming']);
    const discounted = Math.ceil(cost * 0.8);
    expect(researchCost(known, JIA, 'farming')).toBe(discounted);
    expect(researchCost(known, JIA, 'mining')).toBe(TECHS.mining.cost);
    // Knowing it oneself gives no discount, and neither does a polity that is gone.
    expect(researchCost(learn(base, JIA, ['farming']), JIA, 'farming')).toBe(cost);
    const gone = edit(known, (draft) => {
      draft.polities[YI]!.alive = false;
    });
    expect(researchCost(gone, JIA, 'farming')).toBe(cost);
    const almost = edit(apply(known, { type: 'setResearch', polity: JIA, tech: 'farming' }), (draft) => {
      draft.polities[JIA]!.researchProgress = discounted - 1;
    });
    expect(endTurn(almost).state.polities[JIA]!.techs).toContain('farming');
  });

  it('records trade routes and off-map ports per polity', () => {
    expect(base.polities[JIA]).toMatchObject({ tradeRoutes: 0, landPorts: false, seaExits: false });
    expect(learn(base, JIA, ['currency']).polities[JIA]).toMatchObject({ tradeRoutes: 1, landPorts: true, seaExits: false });
    expect(learn(base, JIA, ['currency', 'guilds', 'banking', 'oceanNavigation']).polities[JIA]).toMatchObject({
      tradeRoutes: 3, landPorts: true, seaExits: true,
    });
  });
});

describe('unlocks', () => {
  it('opens a unit with its tech', () => {
    expect(build(base, { kind: 'unit', unit: 'warrior' })).toBe('ok');
    expect(build(base, { kind: 'unit', unit: 'archer' })).toBe('needsTech');
    expect(build(learn(base, JIA, ['archery']), { kind: 'unit', unit: 'archer' })).toBe('ok');
    expect(build(learn(base, JIA, ['archery']), { kind: 'unit', unit: 'crossbowman' })).toBe('needsTech');
    expect(build(learn(base, JIA, ['rocketry']), { kind: 'unit', unit: 'rocketArtillery' })).toBe('ok');
  });

  it('opens the settler with the classical era', () => {
    expect(build(base, { kind: 'unit', unit: 'settler' })).toBe('eraTooEarly');
    expect(build(learn(base, JIA, ANCIENT.slice(0, 4)), { kind: 'unit', unit: 'settler' })).toBe('ok');
  });

  it('opens a building with its tech', () => {
    expect(build(base, { kind: 'building', building: 'granary' })).toBe('needsTech');
    expect(build(learn(base, JIA, ['farming']), { kind: 'building', building: 'granary' })).toBe('ok');
    for (const id of GENERIC_BUILDING_IDS) {
      if (BUILDINGS[id].coastal) continue;
      const item: BuildItem = { kind: 'building', building: id };
      expect(build(learn(base, JIA, TECH_IDS.filter((tech) => tech !== BUILDINGS[id].tech)), item), id).toBe('needsTech');
      expect(build(learn(base, JIA, [BUILDINGS[id].tech]), item), id).toBe('ok');
    }
  });

  it('opens an improvement with its tech', () => {
    const hex = topo.workHexes[0]!.find(
      (candidate) => map.terrain[candidate] === Terrain.Grassland && map.hills[candidate] === 0 && map.feature[candidate] === Feature.None,
    )!;
    const farm: BuildItem = { kind: 'improvement', improvement: 'farm', hex };
    expect(build(base, farm)).toBe('needsTech');
    expect(build(learn(base, JIA, ['farming']), farm)).toBe('ok');
  });

  it('offers no locked item as a legal action', () => {
    const items = getLegalActions(base, JIA).flatMap((action) => (action.type === 'queueBuild' ? [action.item] : []));
    expect(items.filter((item) => item.kind === 'unit')).toEqual([{ kind: 'unit', unit: 'warrior' }]);
    expect(items.filter((item) => item.kind === 'building' || item.kind === 'improvement' || item.kind === 'project')).toEqual([]);
  });

  it('lets farms climb the hills with New Crops', () => {
    const zone = [0, 3, 5, 7].find((candidate) =>
      topo.workHexes[candidate]!.some((hex) => map.hills[hex] === 1 && map.feature[hex] === Feature.None && FARM_TERRAINS.includes(map.terrain[hex]!)),
    )!;
    const hex = topo.workHexes[zone]!.find(
      (candidate) => map.hills[candidate] === 1 && map.feature[candidate] === Feature.None && FARM_TERRAINS.includes(map.terrain[candidate]!),
    )!;
    const owner = base.cities[zone]!.owner;
    const farm: BuildItem = { kind: 'improvement', improvement: 'farm', hex };
    expect(build(learn(base, owner, ['farming']), farm, zone)).toBe('badHex');
    expect(build(learn(base, owner, ['farming', 'newCrops']), farm, zone)).toBe('ok');
  });

  it('has the irrigation canal and the canal on flat river land after Irrigation', () => {
    const fits = (hex: number): boolean =>
      map.hills[hex] === 0 && map.feature[hex] === Feature.None && CANAL_TERRAINS.includes(map.terrain[hex]!);
    const zone = [0, 3, 5, 7].find((candidate) => topo.workHexes[candidate]!.some((hex) => fits(hex) && map.riverEdges[hex] !== 0))!;
    const wet = topo.workHexes[zone]!.find((hex) => fits(hex) && map.riverEdges[hex] !== 0)!;
    const dry = topo.workHexes[zone]!.find((hex) => fits(hex) && map.riverEdges[hex] === 0)!;
    const owner = base.cities[zone]!.owner;
    const known = learn(base, owner, ['irrigation']);
    for (const improvement of ['irrigationCanal', 'canal'] as const) {
      expect(build(base, { kind: 'improvement', improvement, hex: wet }, zone)).toBe('needsTech');
      expect(build(known, { kind: 'improvement', improvement, hex: wet }, zone)).toBe('ok');
      expect(build(known, { kind: 'improvement', improvement, hex: dry }, zone)).toBe('badHex');
    }
    expect(TECHS.railway.railways).toBe(true);
  });
});

describe('strategic resources', () => {
  const horses = map.resources.findIndex((resource) => resource.id === 'horses');
  const jade = map.resources.findIndex((resource) => resource.id === 'jade');
  const horseHex = topo.resourceHexes[horses]!.find((hex) => hexOwner(base, hex) === JIA)!;
  const chariot: BuildItem = { kind: 'unit', unit: 'chariot' };

  it('stay hidden until their tech', () => {
    expect(horseHex).toBeGreaterThanOrEqual(0);
    expect(resourceOnHex(base, JIA, horseHex)).toBe(NO_RESOURCE);
    expect(resourceOnHex(learn(base, JIA, ['husbandry']), JIA, horseHex)).toBe(horses);
    expect(resourceOnHex(learn(base, JIA, ['husbandry']), YI, horseHex)).toBe(NO_RESOURCE);
    // A specialty is no secret.
    expect(resourceOnHex(base, JIA, topo.resourceHexes[jade]![0]!)).toBe(jade);
    expect(polityHasResource(base, JIA, 'horses')).toBe(false);
    expect(polityHasResource(learn(base, JIA, ['husbandry']), JIA, 'horses')).toBe(true);
  });

  it('gate a unit: a source inside the territory is enough, improved or not', () => {
    expect(hexOwner(base, topo.resourceHexes[horses]!.find((hex) => hexOwner(base, hex) === DING) ?? -1)).toBe(NO_POLITY);
    expect(base.improvements[horseHex]).toBeUndefined();
    expect(build(learn(base, JIA, ['husbandry']), chariot)).toBe('ok');
    // Ding knows how, but has no horses.
    expect(build(learn(base, DING, ['husbandry']), chariot, map.polities[DING]!.capitalZone)).toBe('needsResource');
    // The source goes with the zone it lies in.
    const lost = edit(learn(base, JIA, ['husbandry']), (draft) => {
      draft.zoneOwner[map.zone[horseHex]!] = YI;
    });
    if (map.zone[horseHex] !== 0) expect(build(lost, chariot)).toBe('needsResource');
  });

  it('gate iron, coal, oil and rare earths the same way', () => {
    const cases: [resource: string, unit: string, techs: TechId[]][] = [
      ['iron', 'swordsman', ['ironworking']],
      ['iron', 'heavyInfantry', ['ironworking', 'steel']],
      ['oil', 'tank', ['combustion']],
      ['oil', 'mechInfantry', ['combustion', 'petrochemicals']],
      ['rare-earths', 'missileLauncher', ['electronics']],
    ];
    const spot = topo.zoneHexes[0]!.find((hex) => isPlainGround(map, hex) && map.resource[hex] === NO_RESOURCE)!;
    for (const [resource, unit, techs] of cases) {
      const item: BuildItem = { kind: 'unit', unit };
      expect(build(learn(base, JIA, techs), item), unit).toBe('needsResource');
      const rich = withResource(map, resource, [spot]);
      const game = learn(createGame(rich, { seed: 3, player: 'jia', majors: [] }), JIA, techs);
      expect(build(game, item), unit).toBe('ok');
      expect(build(createGame(rich, { seed: 3, player: 'jia', majors: [] }), item), unit).toBe('needsTech');
    }
    // Coal gates a ship: with coal Jia's inland capital only lacks a coast.
    const ironclad: BuildItem = { kind: 'unit', unit: 'ironclad' };
    expect(build(learn(base, JIA, ['steamEngine', 'steelmaking']), ironclad)).toBe('needsResource');
    const coaly = createGame(withResource(map, 'coal', [spot]), { seed: 3, player: 'jia', majors: [] });
    expect(build(learn(coaly, JIA, ['steamEngine', 'steelmaking']), ironclad)).toBe('needsCoast');
    expect(build(learn(coaly, JIA, ['steelmaking']), ironclad)).toBe('needsResource');
    // Petrochemicals alone does not reveal the oil its units need.
    const oily = createGame(withResource(map, 'oil', [spot]), { seed: 3, player: 'jia', majors: [] });
    expect(build(learn(oily, JIA, ['petrochemicals']), { kind: 'unit', unit: 'mechInfantry' })).toBe('needsResource');
  });

  it('send an upgrade past the unit that needs a missing resource', () => {
    const home = around(map, site(0)).find((hex) => isPlainGround(map, hex) && hexOwner(base, hex) === JIA)!;
    let id = 0;
    const armed = edit(learn(base, JIA, ['ironworking']), (draft) => {
      draft.polities[JIA]!.gold = 1000;
      id = put(draft, 'warrior', JIA, home).id;
    });
    // No iron on this map: no swordsman, and nothing later is known yet.
    expect(reason(armed, { type: 'upgrade', polity: JIA, unit: id })).toBe('noUpgrade');
    const later = apply(learn(armed, JIA, ['firearms']), { type: 'upgrade', polity: JIA, unit: id });
    expect(later.units.find((unit) => unit.id === id)!.type).toBe('musketeer');
    expect(later.polities[JIA]!.gold).toBe(1000 - (UNITS.musketeer!.cost - UNITS.warrior!.cost) * 2);
  });
});

describe('embarking', () => {
  const [shore, coast] = findPair(map, (a, b) => isPlainGround(map, a) && hexOwner(base, a) === YI && map.terrain[b] === Terrain.Coast);
  const [shallows, deep] = findPair(map, (a, b) => map.terrain[a] === Terrain.Coast && map.terrain[b] === Terrain.Ocean && topo.enterable[b] === 1);

  it('lets land units onto coastal water with Boats and onto ocean with Compass', () => {
    let walker = 0;
    const ashore = edit(base, (draft) => {
      walker = put(draft, 'warrior', YI, shore).id;
    });
    const step: Action = { type: 'move', polity: YI, unit: walker, to: coast };
    expect(reason(ashore, step)).toBe('impassable');
    expect(reason(learn(ashore, JIA, ['boats']), step)).toBe('impassable');
    const afloat = apply(learn(ashore, YI, ['boats']), step);
    expect(afloat.units.find((unit) => unit.id === walker)).toMatchObject({ hex: coast, moves: 0 });

    let swimmer = 0;
    const offshore = edit(learn(base, YI, ['boats']), (draft) => {
      swimmer = put(draft, 'warrior', YI, shallows).id;
    });
    const out: Action = { type: 'move', polity: YI, unit: swimmer, to: deep };
    expect(reason(offshore, out)).toBe('impassable');
    expect(reason(learn(offshore, YI, ['compass']), out)).toBe('ok');
  });

  it('keeps ships off the ocean before Compass', () => {
    let ship = 0;
    const launched = edit(learn(base, YI, ['boats']), (draft) => {
      ship = put(draft, 'galley', YI, shallows).id;
    });
    const out: Action = { type: 'move', polity: YI, unit: ship, to: deep };
    expect(reason(launched, out)).toBe('impassable');
    expect(reason(learn(launched, YI, ['compass']), out)).toBe('ok');
    const along = around(map, shallows).find((hex) => map.terrain[hex] === Terrain.Coast && topo.enterable[hex] === 1);
    if (along !== undefined) expect(reason(launched, { type: 'move', polity: YI, unit: ship, to: along })).toBe('ok');
  });
});

describe('air strike', () => {
  const spot = topo.zoneHexes[0]!.find((hex) => isPlainGround(map, hex) && apart(hex, site(0)) === 3)!;
  let victim = 0;
  const armed = edit(war(base, JIA, YI), (draft) => {
    draft.cities[0]!.buildings.push('airfield');
    victim = put(draft, 'warrior', YI, spot).id;
  });
  const strike: Action = { type: 'airStrike', polity: JIA, city: 0, target: spot };

  it('hits an enemy unit in range once per turn, and nothing strikes back', () => {
    const result = applyWithEvents(armed, strike);
    const event = result.events.find((entry): entry is Extract<GameEvent, { type: 'airStrike' }> => entry.type === 'airStrike')!;
    expect(event).toMatchObject({ city: 0, owner: JIA, target: spot, defenderUnit: victim, defenderCity: -1 });
    expect(event.damage).toBeGreaterThan(30);
    const hit = result.state.units.find((unit) => unit.id === victim);
    if (event.damage >= 100) expect(hit).toBeUndefined();
    else expect(hit!.hp).toBe(100 - event.damage);
    expect(result.state.cities[0]).toMatchObject({ airStruck: true, hp: armed.cities[0]!.hp });
    expect(reason(result.state, strike)).toBe('alreadyStruck');
    expect(getLegalActions(result.state, JIA).some((action) => action.type === 'airStrike')).toBe(false);
    expect(endTurn(result.state).state.cities[0]!.airStruck).toBe(false);
  });

  it('is offered as a legal action', () => {
    expect(getLegalActions(armed, JIA).filter((action) => action.type === 'airStrike')).toEqual([strike]);
  });

  it('needs an airfield, a war and a target in range', () => {
    const bare = edit(armed, (draft) => {
      draft.cities[0]!.buildings = [];
    });
    expect(reason(bare, strike)).toBe('noAirfield');
    const peace = edit(base, (draft) => {
      draft.cities[0]!.buildings.push('airfield');
      put(draft, 'warrior', YI, spot);
    });
    expect(reason(peace, strike)).toBe('atPeace');
    const empty = topo.zoneHexes[0]!.find((hex) => isPlainGround(map, hex) && hex !== spot)!;
    expect(reason(armed, { ...strike, target: empty })).toBe('noTarget');
    const far = site(map.polities[YI]!.capitalZone);
    expect(apart(far, site(0))).toBeGreaterThan(AIR_STRIKE.range);
    expect(reason(armed, { ...strike, target: far })).toBe('outOfRange');
    expect(reason(armed, { ...strike, polity: YI })).toBe('notYourCity');
  });

  it('wears a city down without taking it', () => {
    const bingdu = map.polities[BING]!.capitalZone;
    const state = edit(war(base, JIA, BING), (draft) => {
      addCity(draft, 2, JIA);
      draft.cities[2]!.buildings = ['airfield'];
      draft.cities[bingdu]!.hp = 5;
    });
    expect(apart(site(2), site(bingdu))).toBeLessThanOrEqual(AIR_STRIKE.range);
    const result = applyWithEvents(state, { type: 'airStrike', polity: JIA, city: 2, target: site(bingdu) });
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'airStrike', defenderCity: bingdu, defenderUnit: -1 }));
    expect(result.state.cities[bingdu]).toMatchObject({ hp: 0, owner: BING });
  });
});

describe('the Tiangong project', () => {
  const cost = (stage: number): number => PROJECT.stages[stage]!.cost;
  /** Queues the next stage in Jia's capital, pays for it and ends the turn. */
  const buildStage = (state: GameState): { state: GameState; events: GameEvent[] } => {
    const queued = apply(state, { type: 'queueBuild', polity: JIA, city: 0, item: PROJECT_ITEM });
    return endTurn(
      edit(queued, (draft) => {
        draft.cities[0]!.progress = cost(draft.polities[JIA]!.projectStage);
      }),
    );
  };

  it('is built in the capital, one stage per tech', () => {
    expect(build(base, PROJECT_ITEM)).toBe('needsTech');
    const first = learn(base, JIA, ['rocketry']);
    expect(build(first, PROJECT_ITEM)).toBe('ok');
    expect(build(apply(first, { type: 'queueBuild', polity: JIA, city: 0, item: PROJECT_ITEM }), PROJECT_ITEM)).toBe('alreadyQueued');
    expect(build(first, { kind: 'project', project: 'babel' })).toBe('badItem');
    const second = edit(first, (draft) => addCity(draft, 1, JIA));
    expect(build(second, PROJECT_ITEM, 1)).toBe('notCapital');
    // A nation that cannot win cannot build it.
    expect(build(learn(base, YI, ['rocketry']), PROJECT_ITEM, map.polities[YI]!.capitalZone)).toBe('badItem');

    const staged = buildStage(first);
    expect(staged.events).toContainEqual({ type: 'projectStageFinished', polity: JIA, city: 0, stage: 1 });
    expect(staged.state.polities[JIA]!.projectStage).toBe(1);
    expect(staged.state.result).toBeNull();
    // The second stage waits for Electronics, whatever else is known.
    expect(build(learn(staged.state, JIA, ['informationNetworks']), PROJECT_ITEM)).toBe('needsTech');
    expect(build(learn(staged.state, JIA, ['electronics']), PROJECT_ITEM)).toBe('ok');
  });

  it('wins the game with its third stage: Science', () => {
    let state = learn(base, JIA, ['rocketry', 'electronics', 'informationNetworks']);
    const events: GameEvent[] = [];
    for (let stage = 1; stage <= 3; stage++) {
      expect(state.result).toBeNull();
      const result = buildStage(state);
      state = result.state;
      events.push(...result.events);
      expect(state.polities[JIA]!.projectStage).toBe(stage);
    }
    expect(state.result).toMatchObject({ kind: 'science', winner: JIA });
    expect(events.filter((event) => event.type === 'projectStageFinished')).toHaveLength(3);
    expect(events).toContainEqual({ type: 'gameEnded', result: state.result });
    expect(build(state, PROJECT_ITEM)).toBe('gameOver');
  });
});

describe('nations on the simplified AI', () => {
  const observed = createGame(map, { seed: 4, majors: ['jia', 'yi', 'bing'] });

  it('do not research', () => {
    expect(research(observed, 'farming', DING)).toBe('doesNotResearch');
    expect(research(observed, 'farming', WUCHENG)).toBe('doesNotResearch');
    expect(getLegalActions(observed, DING).some((action) => action.type === 'setResearch')).toBe(false);
    const later = endTurn(observed).state;
    expect(later.polities[DING]).toMatchObject({ research: null, researchProgress: 0 });
  });

  it('know a tech once half the major nations do', () => {
    const one = endTurn(learn(observed, JIA, ['compass', 'steel'])).state;
    expect(one.polities[DING]!.techs).toEqual([]);
    const two = endTurn(learn(learn(observed, JIA, ['compass', 'steel']), YI, ['compass'])).state;
    expect(two.polities[DING]!.techs).toEqual(['compass']);
    expect(two.polities[WUCHENG]!.techs).toEqual(['compass']);
    expect(two.polities[BING]!.techs).not.toContain('compass');
  });

  it('enter the eras that follow from what they know', () => {
    const start = learn(learn(observed, JIA, ANCIENT.slice(0, 4)), YI, ANCIENT.slice(0, 4));
    const result = endTurn(start);
    expect(result.events).toContainEqual({ type: 'eraEntered', polity: DING, era: 1 });
    expect(polityEra(result.state, DING)).toBe(1);
  });

  it('learn nothing when nobody researches', () => {
    const idle = endTurn(endTurn(createGame(map, { majors: [] })).state).state;
    for (const polity of idle.polities) expect(polity.techs).toEqual([]);
  });
});

describe('AI', () => {
  it('researches: every major learns techs in an order the rules allow', () => {
    let state = createGame(map, { seed: 6 });
    const events: GameEvent[] = [];
    for (let i = 0; i < 40 && state.result === null; i++) {
      const result = endTurn(state);
      state = result.state;
      events.push(...result.events);
    }
    for (const major of state.majors) {
      const polity = state.polities[major]!;
      if (!polity.alive) continue;
      expect(polity.techs.length, `polity ${major}`).toBeGreaterThanOrEqual(4);
      polity.techs.forEach((tech, index) => {
        for (const id of TECHS[tech].requires) expect(polity.techs.indexOf(id)).toBeLessThan(index);
      });
    }
    expect(events.some((event) => event.type === 'researchFinished')).toBe(true);
    expect(events.some((event) => event.type === 'eraEntered')).toBe(true);
    expect(events.some((event) => event.type === 'eraStarted')).toBe(true);
  });

  it('goes for the Science victory when it leads in science, and only then', () => {
    const state = edit(learn(learn(createGame(map, { seed: 6, majors: ['jia', 'yi'] }), JIA), YI), (draft) => {
      draft.polities[JIA]!.science = 1000;
      draft.polities[YI]!.science = 900;
    });
    const next = endTurn(state).state;
    expect(next.cities[0]!.queue[0]).toEqual(PROJECT_ITEM);
    expect(next.cities[map.polities[YI]!.capitalZone]!.queue).not.toContainEqual(PROJECT_ITEM);
  });

  it('researches the project techs first when it leads in science', () => {
    const modern = TECH_IDS.filter((tech) => TECHS[tech].era < 5);
    const state = edit(learn(learn(createGame(map, { seed: 6, majors: ['jia', 'yi'] }), JIA, modern), YI, modern), (draft) => {
      draft.polities[JIA]!.science = 1000;
    });
    const next = endTurn(state).state;
    expect(next.polities[JIA]!.research).toBe('rocketry');
    expect(next.polities[YI]!.research).not.toBeNull();
  });

  it('uses its airfields', () => {
    const spot = topo.zoneHexes[0]!.find((hex) => isPlainGround(map, hex) && apart(hex, site(0)) === 3)!;
    const state = edit(war(createGame(map, { seed: 6, majors: ['jia'] }), JIA, YI), (draft) => {
      draft.cities[0]!.buildings.push('airfield');
      put(draft, 'warrior', YI, spot);
    });
    expect(endTurn(state).events).toContainEqual(expect.objectContaining({ type: 'airStrike', owner: JIA, city: 0 }));
  });
});

describe('determinism and saves with research', () => {
  const play = (state: GameState, turns: number): GameState => {
    let current = state;
    for (let i = 0; i < turns && current.result === null; i++) current = endTurn(current).state;
    return current;
  };

  it('gives the same state for the same seed', () => {
    const a = play(createGame(map, { seed: 21 }), 45);
    const b = play(createGame(map, { seed: 21 }), 45);
    expect(a.polities.some((polity) => polity.techs.length > 0)).toBe(true);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('round-trips techs, research and the project through a save', () => {
    const middle = edit(play(createGame(map, { seed: 21 }), 30), (draft) => {
      draft.polities[JIA]!.projectStage = 1;
    });
    const loaded = loadGame(saveGame(middle), createFixtureMap());
    expect(loaded.polities).toEqual(middle.polities);
    expect(hashState(play(loaded, 30))).toBe(hashState(play(middle, 30)));
  });
});
