import { describe, expect, it } from 'vitest';
import { createGame, endTurn, hashState, saveGame } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { apply } from '../core/testUtil.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { createSyntheticMap } from '../shared/syntheticMap.ts';
import { MAX_SAVE_BYTES, exportSave, importSave } from './saves.ts';

const map = createFixtureMap();

function played(turns: number): GameState {
  let state = createGame(map, { seed: 5, player: 'jia' });
  state = apply(state, {
    type: 'queueBuild',
    polity: 0,
    city: map.polities[0]!.capitalZone,
    item: { kind: 'unit', unit: 'warrior' },
  });
  for (let i = 0; i < turns; i++) state = endTurn(state).state;
  return state;
}

/** The exported save with one change made to its parsed JSON. */
function tampered(state: GameState, change: (data: Record<string, unknown>) => void): string {
  const data = JSON.parse(exportSave(state)) as Record<string, unknown>;
  change(data);
  return JSON.stringify(data);
}

describe('exportSave and importSave', () => {
  it('round-trips a game in progress', () => {
    const state = played(30);
    expect(state.units.length).toBeGreaterThan(0);
    expect(Object.keys(state.relations).length + Object.keys(state.improvements).length).toBeGreaterThan(0);
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.map).toBe(map);
    expect(hashState(result.state)).toBe(hashState(state));
    // and the game goes on from it exactly as from the original
    expect(hashState(endTurn(result.state).state)).toBe(hashState(endTurn(state).state));
  });

  it('round-trips a finished game', () => {
    let state = createGame(map, { seed: 1 });
    while (state.result === null) state = endTurn(state).state;
    const result = importSave(exportSave(state), map);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.result).toEqual(state.result);
  });

  it('rejects text that is not JSON, not a save, or too large', () => {
    expect(importSave('', map)).toEqual({ ok: false, error: 'notJson' });
    expect(importSave('{"format":', map)).toEqual({ ok: false, error: 'notJson' });
    expect(importSave('alert(1)', map)).toEqual({ ok: false, error: 'notJson' });
    expect(importSave('null', map)).toEqual({ ok: false, error: 'notASave' });
    expect(importSave('[1,2]', map)).toEqual({ ok: false, error: 'notASave' });
    expect(importSave('{"format":"something-else"}', map)).toEqual({ ok: false, error: 'notASave' });
    expect(importSave(' '.repeat(MAX_SAVE_BYTES + 1), map)).toEqual({ ok: false, error: 'tooLarge' });
  });

  it('rejects another version and another map', () => {
    const state = played(2);
    expect(importSave(tampered(state, (data) => (data.version = 99)), map)).toEqual({ ok: false, error: 'badVersion' });
    expect(importSave(exportSave(state), createSyntheticMap())).toEqual({ ok: false, error: 'wrongMap' });
    expect(importSave(saveGame(createGame(createSyntheticMap())), map)).toEqual({ ok: false, error: 'wrongMap' });
  });

  it('rejects a save whose content does not fit the map or the rules', () => {
    const state = played(12);
    const cases: Record<string, (data: Record<string, unknown>) => void> = {
      'missing units': (data) => delete data.units,
      'units not a list': (data) => (data.units = {}),
      'unit on a hex outside the map': (data) => ((data.units as { hex: number }[])[0]!.hex = map.width * map.height),
      'unit of an unknown type': (data) => ((data.units as { type: string }[])[0]!.type = 'deathStar'),
      'unit of a polity that does not exist': (data) => ((data.units as { owner: number }[])[0]!.owner = 64),
      'unit id as text': (data) => ((data.units as { id: unknown }[])[0]!.id = '1'),
      'two units with one id': (data) => {
        const units = data.units as { id: number }[];
        units[1]!.id = units[0]!.id;
      },
      'unit health out of range': (data) => ((data.units as { hp: number }[])[0]!.hp = 1e9),
      'unit status unknown': (data) => ((data.units as { status: string }[])[0]!.status = 'flying'),
      'too few polities': (data) => (data.polities as unknown[]).pop(),
      'gold not a number': (data) => ((data.polities as { gold: unknown }[])[0]!.gold = 'lots'),
      'gold not finite': (data) => ((data.polities as { gold: unknown }[])[0]!.gold = null),
      'zone owner out of range': (data) => ((data.zoneOwner as number[])[0] = 1000),
      'city in the wrong slot': (data) => ((data.cities as ({ zone: number } | null)[]).find((city) => city !== null)!.zone = 9),
      'city with an unknown building': (data) =>
        (data.cities as ({ buildings: string[] } | null)[]).find((city) => city !== null)!.buildings.push('deathRay'),
      'city with an unknown focus': (data) =>
        ((data.cities as ({ focus: string } | null)[]).find((city) => city !== null)!.focus = 'chaos'),
      'queue item of an unknown kind': (data) =>
        (data.cities as ({ queue: unknown[] } | null)[]).find((city) => city !== null)!.queue.push({ kind: 'wonder' }),
      'queue item with an unknown unit': (data) =>
        (data.cities as ({ queue: unknown[] } | null)[])
          .find((city) => city !== null)!
          .queue.push({ kind: 'unit', unit: '__proto__' }),
      'worked hex outside the map': (data) =>
        (data.cities as ({ worked: number[] } | null)[]).find((city) => city !== null)!.worked.push(-5),
      'improvement of an unknown kind': (data) => (data.improvements = { '40': 'casino' }),
      'improvement on a hex outside the map': (data) => (data.improvements = { '99999': 'farm' }),
      'relation under the wrong key': (data) =>
        (data.relations = { '0:1': { a: 0, b: 2, atWar: true, since: 1, offerA: 0, offerB: 0 } }),
      'relation of a polity with itself': (data) =>
        (data.relations = { '1:1': { a: 1, b: 1, atWar: true, since: 1, offerA: 0, offerB: 0 } }),
      'player out of range': (data) => (data.player = 50),
      'majors not a list of polities': (data) => (data.majors = [0, 'yi']),
      'turn zero': (data) => (data.turn = 0),
      'turn after the last': (data) => (data.turn = (data.lastTurn as number) + 5),
      'result of an unknown kind': (data) => (data.result = { kind: 'domination', winner: 0, turn: 3 }),
      'result with no such winner': (data) => (data.result = { kind: 'economic', winner: -4, turn: 3 }),
      'stats missing': (data) => (data.stats = {}),
      'next unit id below an existing id': (data) => (data.nextUnitId = 1),
      'rng not an integer': (data) => (data.rng = 0.5),
    };
    for (const [name, change] of Object.entries(cases)) {
      expect(importSave(tampered(state, change), map), name).toEqual({ ok: false, error: 'corrupt' });
    }
  });

  it('keeps only the fields of the format', () => {
    const state = played(3);
    const text = tampered(state, (data) => {
      data.onload = 'alert(1)';
      (data.units as Record<string, unknown>[])[0]!.extra = { nested: true };
      (data.polities as Record<string, unknown>[])[0]!.treasure = 'x';
    });
    const result = importSave(text, map);
    if (!result.ok) throw new Error(result.error);
    expect(Object.keys(result.state).sort()).toEqual(Object.keys(state).sort());
    expect(Object.keys(result.state.units[0]!).sort()).toEqual(Object.keys(state.units[0]!).sort());
    expect(Object.keys(result.state.polities[0]!).sort()).toEqual(Object.keys(state.polities[0]!).sort());
    expect(hashState(result.state)).toBe(hashState(state));
  });
});
