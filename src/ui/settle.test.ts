import { describe, expect, it } from 'vitest';
import { createGame } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { settleSites } from '../core/query.ts';
import { edit, put, withCity } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { findPath } from './path.ts';
import { SETTLE_SITES, settlerSites } from './settle.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const JIA = 0;
const base = createGame(map, { seed: 2, player: 'jia' });
/** Free land of the fixture's wasteland, which anybody may walk into, away from its city sites. */
const sitesAtStart = settleSites(base);
const free = map.zone.reduce<number[]>((list, zone, hex) => {
  const open = zone >= 0 && base.zoneOwner[zone] === -1 && topo.enterable[hex] === 1 && topo.water[hex] === 0;
  return open && !sitesAtStart.includes(hex) && !base.units.some((unit) => unit.hex === hex) ? [...list, hex] : list;
}, []);

function withUnit(type: string, hex: number, from: GameState = base): { state: GameState; id: number } {
  let id = 0;
  const state = edit(from, (draft) => {
    id = put(draft, type, JIA, hex).id;
  });
  return { state, id };
}

describe('settlerSites', () => {
  it('lists the free sites the settler has a way to, with the turns it takes, the quickest first', () => {
    const { state, id } = withUnit('settler', free[0]!);
    const sites = settlerSites(state, id);
    const all = settleSites(state);
    expect(all.length).toBeGreaterThan(0);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThanOrEqual(SETTLE_SITES);
    for (const site of sites) {
      expect(all).toContain(site.hex);
      expect(findPath(state, id, site.hex)?.total).toBe(site.turns);
      expect(site.turns).toBeGreaterThan(0);
    }
    expect(sites.map((site) => site.turns)).toEqual([...sites.map((site) => site.turns)].sort((a, b) => a - b));
    // every free site of the small fixture it can walk to is on the list
    const walkable = all.filter((hex) => findPath(state, id, hex) !== null);
    expect(sites.map((site) => site.hex).sort((a, b) => a - b)).toEqual(walkable.slice(0, SETTLE_SITES));
  });

  it('counts the site the settler stands on as zero turns away, and puts it first', () => {
    const hex = settleSites(base)[0]!;
    const { state, id } = withUnit('settler', hex);
    expect(settlerSites(state, id)[0]).toEqual({ hex, turns: 0 });
  });

  it('drops a site that has been settled', () => {
    const { state, id } = withUnit('settler', free[0]!);
    const first = settlerSites(state, id)[0]!;
    const zone = map.zones.findIndex((entry) => entry.siteHex === first.hex);
    const taken = withCity(state, zone, 1);
    expect(settlerSites(taken, id).map((site) => site.hex)).not.toContain(first.hex);
  });

  it('has nothing for a unit that is no settler, or for no unit', () => {
    const { state, id } = withUnit('warrior', free[0]!);
    expect(settlerSites(state, id)).toEqual([]);
    expect(settlerSites(state, 9999)).toEqual([]);
  });
});
