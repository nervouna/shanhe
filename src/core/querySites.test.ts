import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { NO_ZONE } from '../shared/mapData.ts';
import { applyAction, createGame, hashState } from './game.ts';
import { checkAction, settleSites } from './query.ts';
import { edit, put, withCity } from './testUtil.ts';

const map = createFixtureMap();
const JIA = 0;
const base = createGame(map, { seed: 2, player: 'jia' });
/** The zones of the fixture's wasteland: nobody owns them at the start. */
const waste = map.zones.map((_, zone) => zone).filter((zone) => base.zoneOwner[zone] === -1);

describe('settleSites', () => {
  it('lists the empty sites of unsettled wasteland, ascending, and changes nothing', () => {
    expect(waste.length).toBeGreaterThan(0);
    const before = hashState(base);
    const sites = settleSites(base);
    expect(sites).toEqual(waste.map((zone) => map.zones[zone]!.siteHex).sort((a, b) => a - b));
    expect(hashState(base)).toBe(before);
    // no site of a polity is among them, with a city or without
    for (const polity of map.polities) {
      if (polity.capitalZone !== NO_ZONE) expect(sites).not.toContain(map.zones[polity.capitalZone]!.siteHex);
    }
  });

  it('is exactly where the rules let a settler settle', () => {
    const sites = settleSites(base);
    for (const zone of map.zones) {
      const hex = zone.siteHex;
      if (base.units.some((unit) => unit.hex === hex)) continue;
      let id = 0;
      const state = edit(base, (draft) => {
        id = put(draft, 'settler', JIA, hex).id;
      });
      const legal = checkAction(state, { type: 'settle', polity: JIA, unit: id }) === null;
      expect(sites.includes(hex), `site ${hex}`).toBe(legal);
    }
  });

  it('drops a site once a city stands on it', () => {
    const zone = waste[0]!;
    const hex = map.zones[zone]!.siteHex;
    expect(settleSites(withCity(base, zone, JIA))).not.toContain(hex);
    // and once a settler has settled there
    let id = 0;
    const state = edit(base, (draft) => {
      id = put(draft, 'settler', JIA, hex).id;
    });
    const settled = applyAction(state, { type: 'settle', polity: JIA, unit: id });
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(settleSites(settled.state)).not.toContain(hex);
  });
});
