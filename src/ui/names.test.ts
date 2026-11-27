import { describe, expect, it } from 'vitest';
import { UNIT_IDS } from '../core/data.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { regionOf, unitKey } from './names.ts';

describe('names', () => {
  it('has a string for every unit type', () => {
    for (const id of UNIT_IDS) expect(unitKey(id), id).not.toBeNull();
    expect(unitKey('constructor')).toBeNull();
  });

  it('puts the nations of the design under their region and any other nation under "other"', () => {
    expect(regionOf('qin')).toBe('north');
    expect(regionOf('shu')).toBe('central');
    expect(regionOf('lingnan')).toBe('east');
    expect(regionOf('yamato')).toBe('steppe');
    expect(regionOf('shepo')).toBe('southeast');
    for (const polity of createFixtureMap().polities) expect(regionOf(polity.id)).toBe('other');
  });
});
