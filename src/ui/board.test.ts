import { describe, expect, it } from 'vitest';
import { UNIT_IDS } from '../core/data.ts';
import { createGame } from '../core/game.ts';
import { edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { OWNER_UNOWNED } from '../shared/mapData.ts';
import { UNIT_CHARACTERS, sceneOf } from './board.ts';

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
});
