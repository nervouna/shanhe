import { describe, expect, it } from 'vitest';
import { UNIQUE_UNIT_IDS, UNITS, UNIT_IDS } from '../core/data.ts';
import { labGame, SELF } from '../core/kitLab.ts';
import { setLanguage } from '../shared/i18n.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { builtUnit, itemName, regionOf, unitKey, unitName } from './names.ts';

describe('names', () => {
  it('has a string for every unit type', () => {
    for (const id of UNIT_IDS) expect(unitKey(id), id).not.toBeNull();
    expect(unitKey('constructor')).toBeNull();
    for (const id of UNIQUE_UNIT_IDS) expect(unitKey(id), id).not.toBeNull();
  });

  it('names what a nation really builds: its unique unit under the generic id', () => {
    const { map } = labGame('qi').state;
    expect(builtUnit(map, SELF, 'warrior')).toBe('jijiInfantry');
    expect(builtUnit(map, 1, 'warrior')).toBe('warrior');
    expect(builtUnit(map, -1, 'warrior')).toBe('warrior');
    expect(builtUnit(map, SELF, 'archer')).toBe('archer');
    expect(itemName(map, { kind: 'unit', unit: 'warrior' }, SELF)).toBe('技击士');
    expect(itemName(map, { kind: 'unit', unit: 'warrior' }, 1)).toBe('勇士');
    expect(itemName(map, { kind: 'unit', unit: 'warrior' })).toBe('勇士');
    expect(itemName(map, { kind: 'building', building: 'jixiaAcademy' }, SELF)).toBe('稷下学宫');
    setLanguage('en');
    expect(itemName(map, { kind: 'unit', unit: 'warrior' }, SELF)).toBe('Jiji infantry');
    setLanguage('zh');
    // every unique unit is reached through the generic unit it replaces
    for (const id of UNIQUE_UNIT_IDS) {
      const def = UNITS[id]!;
      const lab = labGame(def.nation).state.map;
      expect(builtUnit(lab, SELF, def.replaces!), id).toBe(id);
      expect(itemName(lab, { kind: 'unit', unit: def.replaces! }, SELF), id).toBe(unitName(id));
    }
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
