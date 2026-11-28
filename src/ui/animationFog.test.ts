import { describe, expect, it } from 'vitest';
import { createGame } from '../core/game.ts';
import type { GameEvent } from '../core/game.ts';
import { around, edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { visualEvents } from './animation.ts';
import { knownState, sightOf } from './sight.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const everywhere = (): boolean => true;
const JIA = 0;
const YI = 1;
const yiZone = map.polities[YI]!.capitalZone;

describe('visualEvents under fog', () => {
  it('plays nothing of a unit the fog hides, and nothing that happens out of sight', () => {
    const base = createGame(map, { seed: 3, player: 'jia' });
    const home = topo.zoneHexes[map.polities[JIA]!.capitalZone]!.find(
      (hex) => sightOf(base)!.visible[hex] === 1 && !base.units.some((unit) => unit.hex === hex),
    )!;
    // the far corner of the map from the player's capital
    const dark = sightOf(base)!.visible.findLastIndex(
      (flag, hex) =>
        flag === 0 && topo.enterable[hex] === 1 && !base.units.some((unit) => unit.hex === hex) &&
        around(map, hex).some((next) => sightOf(base)!.visible[next] === 0),
    );
    const darker = around(map, dark).find((hex) => sightOf(base)!.visible[hex] === 0)!;
    let own = 0;
    let hidden = 0;
    const state = edit(base, (draft) => {
      own = put(draft, 'warrior', JIA, home).id;
      hidden = put(draft, 'warrior', YI, dark).id;
    });
    const sight = sightOf(state)!;
    const sighted = (hex: number): boolean => sight.visible[hex] === 1;
    expect(sighted(home)).toBe(true);
    expect(sighted(dark) || sighted(darker) || sighted(map.zones[yiZone]!.siteHex)).toBe(false);
    const known = knownState(state);
    expect(known.units.some((unit) => unit.id === hidden)).toBe(false);
    expect(known.units.some((unit) => unit.id === own)).toBe(true);

    const strike = (unit: number, owner: number, from: number, target: number): GameEvent => ({
      type: 'combat', unit, owner, from, target, ranged: false,
      defenderUnit: -1, defenderCity: -1, damageToDefender: 10, damageToAttacker: 0,
    });
    const events: GameEvent[] = [
      // a hidden unit walks, strikes and falls in the dark
      { type: 'unitMoved', unit: hidden, owner: YI, from: dark, to: darker },
      strike(hidden, YI, darker, dark),
      { type: 'unitKilled', unit: hidden, owner: YI, hex: darker, unitType: 'warrior' },
      // a city falls out of sight, and one strikes a hex out of sight from the air
      { type: 'cityCaptured', city: yiZone, from: YI, to: 2 },
      { type: 'airStrike', city: yiZone, owner: YI, target: dark, defenderUnit: -1, defenderCity: -1, damage: 10 },
      // the player's own piece walks into the dark and on: the walk is played as far as its first hex out of sight
      { type: 'unitMoved', unit: own, owner: JIA, from: home, to: dark },
      { type: 'unitMoved', unit: own, owner: JIA, from: dark, to: darker },
      // and strikes at a hex out of sight
      strike(own, JIA, darker, dark),
      // a piece that was on the board when it left is promoted and falls out of sight
      { type: 'unitPromoted', unit: own, level: 1 },
      { type: 'unitKilled', unit: own, owner: JIA, hex: darker, unitType: 'warrior' },
    ];
    expect(visualEvents(known, events, everywhere, sighted)).toEqual([{ type: 'move', unit: own, path: [home, dark] }]);
    // the observer is shown all of it
    expect(visualEvents(state, events, everywhere).map((event) => event.type)).toEqual([
      'move', 'melee', 'destroy', 'capture', 'cityStrike', 'move', 'melee', 'promote', 'destroy',
    ]);
    // in sight, a piece of the board is seen to fall
    const fall: GameEvent = { type: 'unitKilled', unit: own, owner: JIA, hex: home, unitType: 'warrior' };
    expect(visualEvents(known, [fall], everywhere, sighted)).toEqual([{ type: 'destroy', unit: own }]);
  });
});
