import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { hexDistance, indexToOffset } from '../shared/hex.ts';
import { Terrain, isWaterTerrain } from '../shared/mapData.ts';
import { createDemoScene, createDemoStage } from './demo.ts';
import { createFlatMap } from './testMaps.ts';

describe('createDemoScene', () => {
  const map = createFixtureMap();
  const scene = createDemoScene(map);

  it('places about 60 pieces of several polities and eras', () => {
    expect(scene.units.length).toBeGreaterThanOrEqual(55);
    expect(scene.units.length).toBeLessThanOrEqual(65);
    expect(new Set(scene.units.map((unit) => unit.polity)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(scene.units.map((unit) => unit.era)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(scene.units.map((unit) => unit.id)).size).toBe(scene.units.length);
    expect(scene.units.some((unit) => unit.unique)).toBe(true);
    expect(scene.units.some((unit) => unit.hp < 1)).toBe(true);
    for (const unit of scene.units) {
      expect([...unit.character]).toHaveLength(1);
      expect(unit.hp).toBeGreaterThan(0);
      expect(unit.hp).toBeLessThanOrEqual(1);
      expect(map.polities[unit.polity]).toBeDefined();
    }
  });

  it('puts armies on open land, fleets on the coast and nothing on a city', () => {
    const cityHexes = new Set(scene.cities.map((city) => city.hex));
    let fleets = 0;
    for (const unit of scene.units) {
      expect(cityHexes.has(unit.hex)).toBe(false);
      const terrain = map.terrain[unit.hex] as number;
      expect(terrain).not.toBe(Terrain.Mountain);
      if (isWaterTerrain(terrain)) fleets++;
    }
    expect(fleets).toBeGreaterThan(0);
    expect(new Set(scene.units.map((unit) => unit.hex)).size).toBe(scene.units.length);
  });

  it('shows a few cities on city sites', () => {
    expect(scene.cities.length).toBeGreaterThanOrEqual(3);
    expect(scene.cities.length).toBeLessThanOrEqual(8);
    const sites = new Set(map.zones.map((zone) => zone.siteHex));
    for (const city of scene.cities) expect(sites.has(city.hex)).toBe(true);
  });

  it('copes with a map that has no polities', () => {
    const empty = createDemoScene(createFlatMap({ width: 5, height: 4, metres: 10 }));
    expect(empty.units).toEqual([]);
    expect(empty.cities).toEqual([]);
  });
});

describe('createDemoStage', () => {
  const map = createFixtureMap();
  const scene = createDemoScene(map);
  const stage = createDemoStage(map, scene);

  it('finds room for the actors next to a city', () => {
    expect(stage).not.toBeNull();
    if (stage === null) return;
    const at = (hex: number) => indexToOffset(hex, map.width);
    expect(scene.cities.some((city) => city.hex === stage.city.hex)).toBe(true);
    expect(hexDistance(at(stage.attacker.hex), at(stage.defender.hex))).toBe(1);
    expect(stage.attacker.id).not.toBe(stage.defender.id);
    expect(scene.units.every((unit) => unit.id !== stage.attacker.id && unit.id !== stage.defender.id)).toBe(true);
    expect(stage.zoneHexes).toContain(stage.city.hex);
    expect(stage.reachable).toContain(stage.attacker.hex);
  });

  it('lays a path of adjacent land hexes that starts at the attacker and avoids the defender', () => {
    if (stage === null) return;
    expect(stage.path).toHaveLength(4);
    expect(stage.path[0]).toBe(stage.attacker.hex);
    expect(new Set(stage.path).size).toBe(4);
    expect(stage.path).not.toContain(stage.defender.hex);
    for (let i = 1; i < stage.path.length; i++) {
      const a = indexToOffset(stage.path[i - 1] as number, map.width);
      const b = indexToOffset(stage.path[i] as number, map.width);
      expect(hexDistance(a, b)).toBe(1);
    }
    for (const hex of [...stage.path, stage.defender.hex]) {
      const terrain = map.terrain[hex] as number;
      expect(isWaterTerrain(terrain)).toBe(false);
      expect(terrain).not.toBe(Terrain.Mountain);
    }
  });

  it('has no stage on a map without cities', () => {
    const empty = createFlatMap({ width: 5, height: 4, metres: 10 });
    expect(createDemoStage(empty, createDemoScene(empty))).toBeNull();
  });
});
