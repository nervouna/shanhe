import { describe, expect, it } from 'vitest';
import { applyAction, createGame, endTurn } from '../core/game.ts';
import type { GameEvent, GameState } from '../core/game.ts';
import { around, edit, put } from '../core/testUtil.ts';
import { topologyOf } from '../core/topology.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { playSpeed, visualEvents } from './animation.ts';

const map = createFixtureMap();
const topo = topologyOf(map);
const everywhere = (): boolean => true;
const capital = map.polities[0]!.capitalZone;
const site = map.zones[capital]!.siteHex;

/** A game with a warrior (id `a`), an archer (`b`) and a catapult (`c`) of polity 0 on free hexes of its capital zone. */
function board(): { state: GameState; a: number; b: number; c: number; hexes: number[] } {
  const base = createGame(map, { seed: 3, player: 'jia' });
  const hexes = topo.zoneHexes[capital]!.filter((hex) => hex !== site && !base.units.some((unit) => unit.hex === hex));
  let a = 0;
  let b = 0;
  let c = 0;
  const state = edit(base, (draft) => {
    a = put(draft, 'warrior', 0, hexes[0]!).id;
    b = put(draft, 'archer', 0, hexes[1]!).id;
    c = put(draft, 'catapult', 0, hexes[2]!).id;
  });
  return { state, a, b, c, hexes };
}

function moved(unit: number, from: number, to: number): GameEvent {
  return { type: 'unitMoved', unit, owner: 0, from, to };
}

function combat(unit: number, from: number, target: number, ranged: boolean): GameEvent {
  return {
    type: 'combat', unit, owner: 0, from, target, ranged,
    defenderUnit: -1, defenderCity: -1, damageToDefender: 10, damageToAttacker: 0,
  };
}

describe('visualEvents', () => {
  it('joins the steps of one walk into one slide', () => {
    const { state, a, hexes } = board();
    const events = [moved(a, hexes[0]!, 100), moved(a, 100, 101), moved(a, 101, 102)];
    expect(visualEvents(state, events, everywhere)).toEqual([{ type: 'move', unit: a, path: [hexes[0]!, 100, 101, 102] }]);
  });

  it('keeps the walks of two units apart, and a walk that another event interrupts', () => {
    const { state, a, b, hexes } = board();
    const events = [
      moved(a, hexes[0]!, 100),
      moved(b, hexes[1]!, 200),
      moved(a, 100, 101),
      combat(a, 101, 102, false),
      moved(a, 101, 102),
    ];
    expect(visualEvents(state, events, everywhere)).toEqual([
      { type: 'move', unit: a, path: [hexes[0]!, 100] },
      { type: 'move', unit: b, path: [hexes[1]!, 200] },
      { type: 'move', unit: a, path: [100, 101] },
      { type: 'melee', unit: a, targetHex: 102 },
      { type: 'move', unit: a, path: [101, 102] },
    ]);
  });

  it('shows melee, ranged and siege attacks by the attacker', () => {
    const { state, a, b, c, hexes } = board();
    const events = [combat(a, hexes[0]!, 50, false), combat(b, hexes[1]!, 51, true), combat(c, hexes[2]!, 52, true)];
    expect(visualEvents(state, events, everywhere)).toEqual([
      { type: 'melee', unit: a, targetHex: 50 },
      { type: 'ranged', unit: b, targetHex: 51 },
      { type: 'siege', unit: c, targetHex: 52 },
    ]);
  });

  it('aims a city strike at where the unit stands after its moves', () => {
    const { state, a, hexes } = board();
    const events: GameEvent[] = [
      moved(a, hexes[0]!, 77),
      { type: 'cityStrike', city: capital, unit: a, damage: 12 },
      { type: 'airStrike', city: capital, owner: 0, target: 90, defenderUnit: -1, defenderCity: 3, damage: 20 },
    ];
    expect(visualEvents(state, events, everywhere).slice(1)).toEqual([
      { type: 'cityStrike', cityHex: site, targetHex: 77 },
      { type: 'cityStrike', cityHex: site, targetHex: 90 },
    ]);
  });

  it('takes a destroyed piece off the board and shows nothing for it afterwards', () => {
    const { state, a, hexes } = board();
    const events: GameEvent[] = [
      { type: 'unitKilled', unit: a, owner: 0, hex: hexes[0]!, unitType: 'warrior' },
      { type: 'unitPromoted', unit: a, level: 1 },
      moved(a, hexes[0]!, 100),
    ];
    expect(visualEvents(state, events, everywhere)).toEqual([{ type: 'destroy', unit: a }]);
  });

  it('flashes a promotion on a living unit', () => {
    const { state, b } = board();
    expect(visualEvents(state, [{ type: 'unitPromoted', unit: b, level: 2 }], everywhere)).toEqual([
      { type: 'promote', unit: b },
    ]);
  });

  it('leaves out units that are not on the board yet, and events that show nothing', () => {
    const { state, a, hexes } = board();
    const newcomer = 9999;
    const events: GameEvent[] = [
      { type: 'unitCreated', unit: newcomer, owner: 0, hex: 100, unitType: 'warrior' },
      moved(newcomer, 100, 101),
      combat(newcomer, 101, 102, false),
      { type: 'unitPromoted', unit: newcomer, level: 1 },
      { type: 'cityStrike', city: capital, unit: newcomer, damage: 5 },
      { type: 'unitDisbanded', unit: a, owner: 0, hex: hexes[0]! },
      moved(a, hexes[0]!, 100),
      { type: 'turnStarted', turn: 2 },
      { type: 'researchFinished', polity: 0, tech: 'farming' },
    ];
    expect(visualEvents(state, events, everywhere)).toEqual([]);
  });

  it('sweeps a captured zone once, in the colour of its new owner', () => {
    const { state } = board();
    const zone = map.polities[1]!.capitalZone;
    const events: GameEvent[] = [
      { type: 'cityCaptured', city: zone, from: 1, to: 0 },
      { type: 'zoneTransferred', zone, from: 1, to: 0 },
    ];
    expect(visualEvents(state, events, everywhere)).toEqual([
      { type: 'capture', cityHex: map.zones[zone]!.siteHex, hexes: topo.zoneHexes[zone], polity: 0 },
    ]);
    // a zone that goes to nobody has no colour to take
    expect(visualEvents(state, [{ type: 'zoneTransferred', zone, from: 1, to: -1 }], everywhere)).toEqual([]);
  });

  it('keeps only what touches the view', () => {
    const { state, a, b, hexes } = board();
    const events = [
      moved(a, hexes[0]!, 100),
      moved(a, 100, 101),
      moved(b, hexes[1]!, 300),
      combat(b, 300, 301, true),
    ];
    expect(visualEvents(state, events, () => false)).toEqual([]);
    // a walk is kept whole if any hex of it is in view, an attack if either end is
    expect(visualEvents(state, events, (hex) => hex === 101 || hex === 301)).toEqual([
      { type: 'move', unit: a, path: [hexes[0]!, 100, 101] },
      { type: 'ranged', unit: b, targetHex: 301 },
    ]);
  });

  it('translates the events of real actions and turns into events the board can play', () => {
    const { state, a, hexes } = board();
    const to = around(map, hexes[0]!).find(
      (hex) => applyAction(state, { type: 'move', polity: 0, unit: a, to: hex }).ok,
    )!;
    const result = applyAction(state, { type: 'move', polity: 0, unit: a, to });
    expect(visualEvents(state, result.events, everywhere)).toEqual([{ type: 'move', unit: a, path: [hexes[0]!, to] }]);

    // a few AI turns: every animation names a unit that is on the board before the turn
    let current = createGame(map, { seed: 2 });
    let seen = 0;
    for (let turn = 0; turn < 30 && current.result === null; turn++) {
      const next = endTurn(current);
      const ids = new Set(current.units.map((unit) => unit.id));
      for (const event of visualEvents(current, next.events, everywhere)) {
        seen++;
        if ('unit' in event) expect(ids.has(event.unit)).toBe(true);
        if (event.type === 'move') {
          expect(event.path.length).toBeGreaterThan(1);
          expect(event.path[0]).toBe(current.units.find((unit) => unit.id === event.unit)!.hex);
        }
      }
      current = next.state;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('playSpeed', () => {
  it('plays a few events at normal speed and many faster, within a limit', () => {
    expect(playSpeed(0)).toBe(1);
    expect(playSpeed(6)).toBe(1);
    expect(playSpeed(12)).toBe(2);
    expect(playSpeed(1000)).toBe(6);
  });
});
