import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/game.ts';
import { followTarget, goTo } from './observer.ts';

const siteOf = (zone: number): number => 100 + zone;
const capitalHex = (polity: number): number => 200 + polity;
const war = (on: number): GameEvent => ({ type: 'warDeclared', by: 0, on }) as GameEvent;
const fall = (city: number): GameEvent => ({ type: 'cityCaptured', city, from: 1, to: 0 }) as GameEvent;

describe('followTarget', () => {
  it('goes nowhere on a quiet turn', () => {
    expect(followTarget([], siteOf, capitalHex)).toBe(-1);
    expect(followTarget([{ type: 'roadsBuilt', hexes: [1], level: 1 }], siteOf, capitalHex)).toBe(-1);
  });

  it('goes to the capital of the polity a war was declared on, the first of several', () => {
    expect(followTarget([war(3), war(5)], siteOf, capitalHex)).toBe(203);
  });

  it('goes to a fallen city before any declaration of war', () => {
    expect(followTarget([war(3), fall(7), fall(8)], siteOf, capitalHex)).toBe(107);
  });
});

describe('goTo', () => {
  const whole = { x: 0, z: 0, distance: 90 };
  const near = { x: 4, z: 7, distance: 12 };

  it('remembers the view the camera left', () => {
    expect(goTo(null, 107, whole)).toEqual({ hex: 107, home: whole });
  });

  it('keeps that view when the camera goes on to another event before it came back', () => {
    const first = goTo(null, 107, whole);
    expect(goTo(first, 203, near)).toEqual({ hex: 203, home: whole });
  });
});
