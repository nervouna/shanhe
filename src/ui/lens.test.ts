import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../core/game.ts';
import { learn } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { OWNER_OFF_MAP } from '../shared/mapData.ts';
import { LENSES, STANDING_COLORS, lensColor } from './lens.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const state = createGame(map, { seed: 3, player: 'jia' });
const own = map.zones[map.polities[0]!.capitalZone]!.siteHex;
const theirs = map.zones[map.polities[1]!.capitalZone]!.siteHex;

describe('lensColor', () => {
  it('shows the owner under the political lens', () => {
    expect(lensColor(state, own, 'political', 0)).toBe(`#${map.polities[0]!.color.toString(16).padStart(6, '0')}`);
    expect(lensColor(state, own, 'political', 0)).not.toBe(lensColor(state, theirs, 'political', 0));
  });

  it('shows the relation to the player under the diplomacy lens, and follows it', () => {
    expect(lensColor(state, own, 'diplomacy', 0)).toBe(STANDING_COLORS.self);
    expect(lensColor(state, theirs, 'diplomacy', 0)).toBe(STANDING_COLORS.peace);
    const war = applyAction(state, { type: 'declareWar', polity: 0, target: 1 }).state;
    expect(lensColor(war, theirs, 'diplomacy', 0)).toBe(STANDING_COLORS.war);
    // nobody to relate to in observer mode
    expect(lensColor(state, theirs, 'diplomacy', -1)).toBe(lensColor(state, theirs, 'political', -1));
  });

  it('marks the resources the viewer can see under the resources lens', () => {
    const horses = map.resource.findIndex((resource) => resource >= 0 && map.resources[resource]!.id === 'horses');
    const jade = map.resource.findIndex((resource) => resource >= 0 && map.resources[resource]!.id === 'jade');
    const plain = topo.zoneHexes[map.polities[0]!.capitalZone]!.find((hex) => map.resource[hex]! < 0)!;
    const hidden = lensColor(state, horses, 'resources', 0);
    const shown = lensColor(learn(state, 0, ['husbandry']), horses, 'resources', 0);
    expect(shown).not.toBe(hidden);
    expect(lensColor(state, jade, 'resources', 0)).not.toBe(shown);
    expect(lensColor(state, jade, 'resources', 0)).not.toBe(lensColor(state, plain, 'resources', 0));
  });

  it('gives every hex a colour under every lens, the same off the map whatever the lens', () => {
    const offMap = map.owner.findIndex((owner) => owner === OWNER_OFF_MAP);
    for (const lens of LENSES) {
      for (let hex = 0; hex < map.width * map.height; hex++) {
        expect(lensColor(state, hex, lens, 0)).toMatch(/^#[0-9a-f]{6}$/);
      }
      if (offMap >= 0) expect(lensColor(state, offMap, lens, 0)).toBe(lensColor(state, offMap, 'political', 0));
    }
  });
});
