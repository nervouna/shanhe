import { describe, expect, it } from 'vitest';
import { UNIT_IDS } from '../core/data.ts';
import { createGame } from '../core/game.ts';
import { edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { OWNER_UNOWNED } from '../shared/mapData.ts';
import { UNIT_CHARACTERS, sceneOf, wholeMapView } from './board.ts';

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
    expect(shown).toEqual({ hex: capital.siteHex, polity: 0, population: 1, name: capital.cityNameZh });
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
