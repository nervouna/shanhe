import { describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_IDS, IMPROVEMENT_IDS, UNIQUE_UNIT_IDS, UNITS, UNIT_IDS } from '../core/data.ts';
import { createGame } from '../core/game.ts';
import { HOME_ZONE, LAND, SELF, SITE, labGame } from '../core/kitLab.ts';
import { KIT_NATIONS, kitOfNation } from '../core/kits.ts';
import { edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { CityFamily, Improvement, LANDMARK_IDS, familyOfPolity } from '../render/scene.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { OWNER_UNOWNED } from '../shared/mapData.ts';
import { IMPROVEMENT_LOOK, UNIT_CHARACTERS, familyOf, pieceOf, sceneOf, wholeMapView } from './board.ts';

const map = createFixtureMap();

describe('sceneOf', () => {
  it('shows every unit and city of a new game, without overrides or fog', () => {
    const state = createGame(map, { seed: 3 });
    const scene = sceneOf(state, 'zh');
    expect(scene.units).toHaveLength(state.units.length);
    expect(scene.fog).toBeNull();
    expect(scene.ownerOverrides.size).toBe(0);

    const cities = state.cities.filter((city) => city !== null);
    expect(scene.cities).toHaveLength(cities.length);
    const capital = map.zones[map.polities[0]!.capitalZone]!;
    const shown = scene.cities.find((city) => city.hex === capital.siteHex)!;
    expect(shown).toEqual({
      hex: capital.siteHex, polity: 0, population: 1, name: capital.cityNameZh,
      family: CityFamily.CentralPlains, era: 0, walls: false, buildings: 0,
    });
    expect(sceneOf(state, 'en').cities.find((city) => city.hex === capital.siteHex)!.name).toBe(capital.cityNameEn);
  });

  it('derives a piece from a unit: character, era, health and owner', () => {
    const base = createGame(map, { seed: 3 });
    const free = topologyOf(map).zoneHexes[0]!.find((hex) => !base.units.some((unit) => unit.hex === hex))!;
    let id = 0;
    const state = edit(base, (draft) => {
      id = put(draft, 'crossbowman', 1, free, { hp: 40 }).id;
    });
    const piece = sceneOf(state, 'zh').units.find((unit) => unit.id === id)!;
    expect(piece).toEqual({ id, hex: free, polity: 1, character: '弩', unique: false, era: 1, hp: 0.4 });
    const tribe = state.units.find((unit) => unit.type === 'tribe')!;
    expect(sceneOf(state, 'zh').units.find((unit) => unit.id === tribe.id)!.polity).toBe(-1);
  });

  it('has a character for every unit type', () => {
    for (const id of UNIT_IDS) expect(UNIT_CHARACTERS[id], id).toMatch(/^.$/u);
  });

  it('gives every unique unit its own character with the gold fill, in its era’s material', () => {
    expect(UNIQUE_UNIT_IDS).toHaveLength(50);
    for (const id of UNIQUE_UNIT_IDS) {
      const def = UNITS[id]!;
      expect(pieceOf(id), id).toEqual({ character: def.piece, unique: true, era: def.era });
      expect(pieceOf(id).character, id).toMatch(/^.$/u);
    }
    expect(pieceOf('warrior')).toEqual({ character: '兵', unique: false, era: 0 });
    expect(pieceOf('tank')).toEqual({ character: '坦', unique: false, era: 5 });
    const { state } = labGame('qi');
    let id = 0;
    const scene = sceneOf(edit(state, (draft) => {
      draft.units = draft.units.filter((unit) => unit.hex !== LAND);
      id = put(draft, 'jijiInfantry', SELF, LAND).id;
    }), 'zh');
    expect(scene.units.find((unit) => unit.id === id)).toMatchObject({ character: '技', unique: true, era: 0 });
  });

  it('maps every improvement of the rules to what the renderer draws, and leaves out pillaged ones', () => {
    const looks = new Set<number | null>([Improvement.Farm, Improvement.Pasture, Improvement.Mine, Improvement.Fishery, null]);
    for (const id of IMPROVEMENT_IDS) expect(looks.has(IMPROVEMENT_LOOK[id]), id).toBe(true);
    expect(Object.keys(IMPROVEMENT_LOOK).sort()).toEqual([...IMPROVEMENT_IDS].sort());
    expect(IMPROVEMENT_LOOK.farm).toBe(Improvement.Farm);
    expect(IMPROVEMENT_LOOK.riceTerrace).toBe(Improvement.Farm);
    expect(IMPROVEMENT_LOOK.salmonFishery).toBe(Improvement.Fishery);
    const base = createGame(map, { seed: 3 });
    expect(sceneOf(base, 'zh').improvements.size).toBe(0);
    const state = edit(base, (draft) => {
      draft.improvements[12] = 'farm';
      draft.improvements[13] = 'mine';
      draft.improvements[14] = 'pasture';
      draft.improvements[15] = 'fishery';
      draft.improvements[16] = 'dujiangyan';
      draft.improvements[17] = 'iceRoad';
      draft.improvements[18] = 'farm';
      draft.pillaged[18] = draft.turn + 2;
      draft.improvements[19] = 'farm';
      draft.pillaged[19] = draft.turn - 1;
    });
    expect([...sceneOf(state, 'zh').improvements]).toEqual([
      [12, Improvement.Farm], [13, Improvement.Mine], [14, Improvement.Pasture], [15, Improvement.Fishery],
      [16, Improvement.Farm], [19, Improvement.Farm],
    ]);
  });

  it('gives a city the era of its owner, its walls and the number of its buildings', () => {
    const { state } = labGame(null);
    const scene = sceneOf(edit(state, (draft) => {
      draft.polities[SELF]!.era = 4;
      draft.cities[HOME_ZONE]!.buildings = ['granary', 'walls', 'market'];
    }), 'zh');
    expect(scene.cities.find((city) => city.hex === SITE)).toMatchObject({ era: 4, walls: true, buildings: 3 });
    // a unique building that replaces the walls is walls too
    const tulou = sceneOf(edit(labGame('min').state, (draft) => {
      draft.cities[HOME_ZONE]!.buildings = ['tulou'];
    }), 'zh');
    expect(tulou.cities.find((city) => city.hex === SITE)).toMatchObject({ walls: true, buildings: 1, landmark: 'min' });
  });

  it('builds a city in the family of the nation that founded it: the kit’s, or the renderer’s for a polity without one', () => {
    const families = Object.values(CityFamily);
    for (const nation of KIT_NATIONS) expect(families, nation).toContain(familyOf(nation));
    // doc 02 has the last word where the renderer's own table differs
    expect(familyOf('ezo')).toBe(CityFamily.Japanese);
    expect(familyOf('huainan')).toBe(CityFamily.CentralPlains);
    expect(familyOf('yelang')).toBe(CityFamily.SoutheastAsian);
    expect(familyOf('tubo')).toBe(CityFamily.Tibetan);
    expect(familyOf('mobei')).toBe(CityFamily.Steppe);
    expect(familyOf('beihai')).toBe(CityFamily.Siberian);
    expect(familyOf('wu')).toBe(CityFamily.Jiangnan);
    // a city-state has no kit
    expect(kitOfNation('tsushima')).toBeNull();
    expect(familyOf('tsushima')).toBe(familyOfPolity('tsushima'));
    expect(familyOf('jia')).toBe(CityFamily.CentralPlains);

    const { state } = labGame('siam');
    expect(sceneOf(state, 'zh').cities.find((city) => city.hex === SITE)!.family).toBe(CityFamily.SoutheastAsian);
    // the houses stay when the city changes hands
    const taken = edit(state, (draft) => {
      draft.cities[HOME_ZONE]!.owner = 1;
      draft.zoneOwner[HOME_ZONE] = 1;
    });
    expect(sceneOf(taken, 'zh').cities.find((city) => city.hex === SITE)).toMatchObject({ polity: 1, family: CityFamily.SoutheastAsian });
  });

  it('shows a nation’s landmark where its unique building stands, whoever holds the city', () => {
    const landmark = (state: ReturnType<typeof labGame>['state']): string | undefined =>
      sceneOf(state, 'zh').cities.find((city) => city.hex === SITE)!.landmark;
    // every unique building is a landmark the renderer has
    for (const id of BUILDING_IDS) {
      const { nation } = BUILDINGS[id];
      if (nation !== null) expect(LANDMARK_IDS, id).toContain(nation);
    }
    const wu = labGame('wu').state;
    expect(landmark(wu)).toBeUndefined();
    const garden = edit(wu, (draft) => {
      draft.cities[HOME_ZONE]!.buildings = ['granary', 'classicalGarden'];
    });
    expect(landmark(garden)).toBe('wu');
    expect(landmark(edit(garden, (draft) => {
      draft.cities[HOME_ZONE]!.owner = 1;
      draft.zoneOwner[HOME_ZONE] = 1;
    }))).toBe('wu');
    // a unique improvement on the land the city works
    const shu = labGame('shu').state;
    expect(landmark(shu)).toBeUndefined();
    const weir = edit(shu, (draft) => {
      draft.improvements[LAND] = 'dujiangyan';
    });
    expect(landmark(weir)).toBe('shu');
    expect(landmark(edit(weir, (draft) => {
      draft.pillaged[LAND] = draft.turn + 3;
    }))).toBeUndefined();
    // a road upgrade shows in the capital once the nation knows its tech
    expect(landmark(labGame('qin').state)).toBe('qin');
    expect(landmark(labGame('qin', { techs: [] }).state)).toBeUndefined();
    expect(landmark(labGame(null).state)).toBeUndefined();
  });

  it('overrides the owner of every hex of a zone that changed hands', () => {
    const base = createGame(map, { seed: 3 });
    const zone = map.polities[1]!.capitalZone;
    const wasteland = base.zoneOwner.findIndex((owner) => owner === -1);
    const state = edit(base, (draft) => {
      draft.zoneOwner[zone] = 0;
      draft.cities[zone]!.owner = 0;
      draft.zoneOwner[wasteland] = 2;
    });
    const scene = sceneOf(state, 'zh');
    const topo = topologyOf(map);
    for (const hex of topo.zoneHexes[zone]!) expect(scene.ownerOverrides.get(hex)).toBe(0);
    for (const hex of topo.zoneHexes[wasteland]!) {
      expect(map.owner[hex]).toBe(OWNER_UNOWNED);
      expect(scene.ownerOverrides.get(hex)).toBe(2);
    }
    expect(scene.ownerOverrides.size).toBe(topo.zoneHexes[zone]!.length + topo.zoneHexes[wasteland]!.length);
    expect(scene.cities.find((city) => city.hex === map.zones[zone]!.siteHex)!.polity).toBe(0);
  });

  it('passes on the roads with their level and the trade routes with their path', () => {
    const base = createGame(map, { seed: 3 });
    expect(sceneOf(base, 'zh').roads.size).toBe(0);
    const scene0 = sceneOf(base, 'zh');
    expect(scene0.routes).toEqual([]);
    expect(sceneOf(base, 'zh').routes).toEqual([]);
    const state = edit(base, (draft) => {
      draft.roads[12] = 1;
      draft.roads[40] = 2;
      draft.routes.push({
        id: 1, owner: 2, from: 0, toCity: 1, toPort: -1, sea: true, path: [5, 6, 7], income: 3, pillagedUntil: 0,
      });
    });
    const scene = sceneOf(state, 'zh');
    expect([...scene.roads]).toEqual([[12, 1], [40, 2]]);
    expect(scene.routes).toEqual([{ path: [5, 6, 7], polity: 2, sea: true }]);
  });
});

describe('wholeMapView', () => {
  it('looks at the middle of the map from a distance that grows with the map', () => {
    const view = wholeMapView(map);
    const { size, originX, originZ } = map.projection.hexLayout;
    expect(view.x).toBeGreaterThan(originX);
    expect(view.x).toBeLessThan(originX + Math.sqrt(3) * size * map.width);
    expect(view.z).toBeGreaterThan(originZ);
    expect(view.z).toBeLessThan(originZ + 1.5 * size * map.height);
    // far enough to see the taller side through the lens
    expect(view.distance).toBeGreaterThan(1.5 * size * map.height);
    const wider = wholeMapView({ ...map, width: map.width * 4 });
    expect(wider.distance).toBeGreaterThan(view.distance);
    expect(wider.x).toBeGreaterThan(view.x);
  });
});
