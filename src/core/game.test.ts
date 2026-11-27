import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { advanceTurn, createGame } from './game.ts';

describe('game state', () => {
  it('starts at turn 1 on the given map', () => {
    const map = createFixtureMap();
    const state = createGame(map);
    expect(state.turn).toBe(1);
    expect(state.map).toBe(map);
  });

  it('advances the turn counter by one without changing the previous state', () => {
    const first = createGame(createFixtureMap());
    const second = advanceTurn(first);
    expect(second.turn).toBe(2);
    expect(first.turn).toBe(1);
    expect(second.map).toBe(first.map);

    let state = first;
    for (let i = 0; i < 10; i++) state = advanceTurn(state);
    expect(state.turn).toBe(11);
  });
});
