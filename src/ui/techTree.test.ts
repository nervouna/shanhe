import { describe, expect, it } from 'vitest';
import { BUILDING_IDS, ERAS, IMPROVEMENT_IDS, TECHS, TECH_IDS, UNITS } from '../core/data.ts';
import { applyAction, createGame } from '../core/game.ts';
import { learn } from '../core/testUtil.ts';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { layoutTechTree, techUnlocks, techViews } from './techTree.ts';

const map = createFixtureMap();

describe('layoutTechTree', () => {
  const layout = layoutTechTree();
  const byTech = new Map(layout.nodes.map((node) => [node.tech, node]));

  it('places every tech once, in the column of its era', () => {
    expect(layout.nodes).toHaveLength(TECH_IDS.length);
    expect([...byTech.keys()].sort()).toEqual([...TECH_IDS].sort());
    expect(layout.columns).toBe(ERAS.length);
    for (const node of layout.nodes) {
      expect(node.era).toBe(TECHS[node.tech].era);
      expect(node.row).toBeGreaterThanOrEqual(0);
      expect(node.row).toBeLessThan(layout.rows);
    }
  });

  it('puts no two techs in the same cell and leaves no gap in a column', () => {
    for (let era = 0; era < ERAS.length; era++) {
      const rows = layout.nodes.filter((node) => node.era === era).map((node) => node.row).sort((a, b) => a - b);
      expect(rows).toEqual(rows.map((_, index) => index));
    }
  });

  it('draws one line per prerequisite, between nodes that exist, from an earlier era to a later one', () => {
    const expected = TECH_IDS.reduce((sum, tech) => sum + TECHS[tech].requires.length, 0);
    expect(layout.edges).toHaveLength(expected);
    for (const edge of layout.edges) {
      const from = byTech.get(edge.from);
      const to = byTech.get(edge.to);
      expect(from, edge.from).toBeDefined();
      expect(to, edge.to).toBeDefined();
      expect(TECHS[edge.to].requires).toContain(edge.from);
      expect(from!.era).toBeLessThan(to!.era);
    }
    const keys = layout.edges.map((edge) => `${edge.from}>${edge.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps a tech with one prerequisite near it', () => {
    // every single-prerequisite tech sits within two rows of what it needs
    for (const node of layout.nodes) {
      const requires = TECHS[node.tech].requires;
      if (requires.length !== 1) continue;
      expect(Math.abs(node.row - byTech.get(requires[0]!)!.row), node.tech).toBeLessThanOrEqual(2);
    }
  });
});

describe('techUnlocks', () => {
  it('lists every buildable unit, building and improvement under its tech, once', () => {
    const all = TECH_IDS.flatMap((tech) => techUnlocks(tech));
    const units = all.flatMap((entry) => (entry.kind === 'unit' ? [entry.unit] : []));
    const wanted = Object.values(UNITS).filter((def) => def.buildable && def.tech !== null).map((def) => def.id);
    expect(units.sort()).toEqual(wanted.sort());
    expect(all.flatMap((entry) => (entry.kind === 'building' ? [entry.building] : [])).sort()).toEqual([...BUILDING_IDS].sort());
    expect(all.flatMap((entry) => (entry.kind === 'improvement' ? [entry.improvement] : [])).sort()).toEqual(
      [...IMPROVEMENT_IDS].sort(),
    );
  });

  it('lists what a tech does by itself', () => {
    expect(techUnlocks('husbandry')).toContainEqual({ kind: 'resource', resource: 'horses' });
    expect(techUnlocks('currency')).toEqual(expect.arrayContaining([{ kind: 'tradeRoute' }, { kind: 'landPorts' }]));
    expect(techUnlocks('boats')).toContainEqual({ kind: 'coast' });
    expect(techUnlocks('compass')).toContainEqual({ kind: 'ocean' });
    expect(techUnlocks('oceanNavigation')).toContainEqual({ kind: 'seaExits' });
    expect(techUnlocks('railway')).toContainEqual({ kind: 'railways' });
    expect(techUnlocks('newCrops')).toContainEqual({ kind: 'hillFarms' });
    expect(techUnlocks('rocketry')).toContainEqual({ kind: 'project' });
  });
});

describe('techViews', () => {
  it('tells known, current, open and locked techs apart', () => {
    const start = createGame(map, { seed: 1, player: 'jia' });
    const fresh = techViews(start, 0);
    expect(fresh.get('farming')).toMatchObject({ status: 'open', reason: null });
    expect(fresh.get('writing')).toMatchObject({ status: 'locked', reason: 'eraTooEarly' });
    expect(fresh.get('farming')!.turns).toBeGreaterThan(0);

    const chosen = applyAction(start, { type: 'setResearch', polity: 0, tech: 'farming' }).state;
    expect(techViews(chosen, 0).get('farming')!.status).toBe('current');
    expect(techViews(chosen, 0).get('mining')!.status).toBe('open');

    const learned = learn(start, 0, ['farming', 'mining', 'ritual', 'archery']);
    const views = techViews(learned, 0);
    expect(views.get('farming')).toMatchObject({ status: 'known', turns: null });
    expect(views.get('writing')!.status).toBe('open');
    expect(views.get('crossbow')).toMatchObject({ status: 'locked', reason: 'missingPrerequisite' });
    expect(views.size).toBe(TECH_IDS.length);
  });
});
