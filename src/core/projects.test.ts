/** City projects and "repeat last item" (issue #38, item 9). */

import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { chooseProject } from './ai.ts';
import { cityProjectOf } from './cities.ts';
import { cloneState, createCtx } from './context.ts';
import { AI, BUILDINGS, CITY_PROJECT_IDS, POLICY_IDS, TECH_IDS, isCityProject } from './data.ts';
import { applyAction, createGame, endTurn, getLegalActions } from './game.ts';
import type { Action, BuildItem, GameState } from './game.ts';
import { SELF, labMap } from './kitLab.ts';
import { KIT_NATIONS, ambitionOf } from './kits.ts';
import type { Ambition } from './kits.ts';
import { apply, edit, isPlainGround, learn, put } from './testUtil.ts';
import { topologyOf } from './topology.ts';

const map = createFixtureMap();
const JIA = 0;
const YI = 1;
const HOME = map.polities[JIA]!.capitalZone;
const reason = (state: GameState, action: Action): string => {
  const result = applyAction(state, action);
  return result.ok ? 'ok' : result.reason;
};
const project = (building: 'festival' | 'minting' | 'compilation'): BuildItem => ({ kind: 'building', building });
const queue = (item: BuildItem): Action => ({ type: 'queueBuild', polity: JIA, city: HOME, item });
/** Jia plays and knows every tech; nobody else is a major nation, so nothing but the player's choices differs between runs. */
const base = learn(createGame(map, { seed: 3, player: 'jia', majors: [] }), JIA);

describe('the three city projects', () => {
  it('turn production into culture, gold and science at a reduced rate, and need their tech', () => {
    expect(CITY_PROJECT_IDS).toEqual(['festival', 'minting', 'compilation']);
    expect(BUILDINGS.festival).toMatchObject({ tech: 'ritual', cost: 0, upkeep: 0, converts: { to: 'culture', percent: 25 } });
    expect(BUILDINGS.minting).toMatchObject({ tech: 'currency', cost: 0, upkeep: 0, converts: { to: 'gold', percent: 50 } });
    expect(BUILDINGS.compilation).toMatchObject({ tech: 'writing', cost: 0, upkeep: 0, converts: { to: 'science', percent: 25 } });
    for (const id of CITY_PROJECT_IDS) expect(BUILDINGS[id].converts!.percent, id).toBeLessThan(100);
    expect(isCityProject('granary')).toBe(false);
    expect(cityProjectOf({ kind: 'building', building: 'granary' })).toBeNull();
    expect(cityProjectOf({ kind: 'unit', unit: 'warrior' })).toBeNull();
    const fresh = createGame(map, { seed: 3, player: 'jia', majors: [] });
    for (const id of CITY_PROJECT_IDS) {
      expect(reason(fresh, queue(project(id))), id).toBe('needsTech');
      expect(reason(learn(fresh, JIA, [BUILDINGS[id].tech]), queue(project(id))), id).toBe('ok');
      // A human finds them among what the city can build, and cannot buy them.
      expect(getLegalActions(base, JIA)).toContainEqual(queue(project(id)));
      expect(reason(edit(base, (draft) => void (draft.polities[JIA]!.gold = 10_000)), { type: 'buy', polity: JIA, city: HOME, item: project(id) })).toBe('cannotBuy');
    }
  });

  it('give the yield every turn, on top of what the city yields, and are never finished', () => {
    const plain = endTurn(base);
    const production = plain.state.cities[HOME]!.yields.production;
    expect(production).toBeGreaterThanOrEqual(4);
    const self = (state: GameState): GameState['polities'][number] => state.polities[JIA]!;

    const minted = endTurn(apply(base, queue(project('minting'))));
    expect(self(minted.state).gold - self(plain.state).gold).toBe(Math.floor(production * 0.5));
    // Minted gold is income: it counts for the Economic victory.
    expect(self(minted.state).grossIncome - self(plain.state).grossIncome).toBe(Math.floor(production * 0.5));

    // Science goes to the research at hand and into the total; with every tech known it only adds up.
    const student = learn(createGame(map, { seed: 3, player: 'jia', majors: [] }), JIA, ['writing']);
    const studied = endTurn(apply(student, queue(project('compilation'))));
    const unstudied = endTurn(student);
    const sum = (state: GameState): number => self(state).science;
    expect(sum(studied.state) - sum(unstudied.state)).toBe(Math.floor(unstudied.state.cities[HOME]!.yields.production * 0.25));
    // No tech is finished in this turn, so the research at hand shows the same gain.
    expect(studied.state.polities[JIA]!.techs).toEqual(unstudied.state.polities[JIA]!.techs);
    expect(studied.state.polities[JIA]!.researchProgress - unstudied.state.polities[JIA]!.researchProgress).toBe(
      Math.floor(unstudied.state.cities[HOME]!.yields.production * 0.25),
    );

    const feasted = endTurn(apply(base, queue(project('festival'))));
    expect(self(feasted.state).culture - self(plain.state).culture).toBe(Math.floor(production * 0.25));
    expect(self(feasted.state).cultureProgress - self(plain.state).cultureProgress).toBe(Math.floor(production * 0.25));

    // The project is still the city's item, nothing was built, and only what makes no whole point yet is stored.
    for (const [result, percent] of [[minted, 50], [feasted, 25]] as const) {
      const city = result.state.cities[HOME]!;
      expect(city.queue).toHaveLength(1);
      expect(city.buildings.filter(isCityProject)).toEqual([]);
      expect(city.progress).toBe(production - (Math.floor((production * percent) / 100) * 100) / percent);
      expect(result.events.filter((event) => event.type === 'cityBuilt')).toEqual([]);
    }
    // And the next turn it gives again: over the two turns, half of all the production, rounded down once.
    const twice = endTurn(minted.state);
    expect(self(twice.state).grossIncome - self(endTurn(plain.state).state).grossIncome).toBe(
      Math.floor((production + twice.state.cities[HOME]!.yields.production) * 0.5),
    );
  });

  it('make way for whatever is queued behind them', () => {
    let state = apply(base, queue(project('minting')));
    state = apply(state, queue({ kind: 'unit', unit: 'warrior' }));
    // It cannot be queued twice, but another project can wait behind it.
    expect(reason(state, queue(project('minting')))).toBe('alreadyQueued');
    const next = endTurn(state).state;
    expect(next.cities[HOME]!.queue).toEqual([{ kind: 'unit', unit: 'warrior' }]);
    // Removing it by hand works like any item.
    const removed = apply(apply(base, queue(project('festival'))), { type: 'unqueueBuild', polity: JIA, city: HOME, index: 0 });
    expect(removed.cities[HOME]!.queue).toEqual([]);
  });

  it('are not sped up by what speeds up buildings', () => {
    // Industrial planning: buildings +15%. A granary gets it, a city project does not.
    const planned = edit(base, (draft) => {
      draft.polities[JIA]!.policies = ['industrialPlanning'];
      draft.polities[JIA]!.slots[0] = 'industrialPlanning';
    });
    const production = endTurn(planned).state.cities[HOME]!.yields.production;
    const minted = endTurn(apply(planned, queue(project('minting')))).state;
    expect(minted.polities[JIA]!.gold - endTurn(planned).state.polities[JIA]!.gold).toBe(Math.floor(production * 0.5));
  });
});

describe('repeat last item', () => {
  const repeat = (on: boolean): Action => ({ type: 'setRepeat', polity: JIA, city: HOME, repeat: on });
  const rich = edit(base, (draft) => void (draft.cities[HOME]!.progress = 10_000));

  it('is a switch of the city, off at the start', () => {
    expect(base.cities[HOME]!.repeat).toBe(false);
    expect(getLegalActions(base, JIA)).toContainEqual(repeat(true));
    expect(reason(base, repeat(false))).toBe('alreadySet');
    expect(reason(base, { type: 'setRepeat', polity: YI, city: HOME, repeat: true })).toBe('notYourCity');
    expect(reason(base, { type: 'setRepeat', polity: JIA, city: 999, repeat: true })).toBe('noSuchCity');
    const on = apply(base, repeat(true));
    expect(on.cities[HOME]!.repeat).toBe(true);
    expect(getLegalActions(on, JIA)).toContainEqual(repeat(false));
    expect(apply(on, repeat(false)).cities[HOME]!.repeat).toBe(false);
  });

  it('queues the item the city has just finished again when its queue is empty', () => {
    const warrior: BuildItem = { kind: 'unit', unit: 'warrior' };
    const once = endTurn(apply(rich, queue(warrior))).state;
    expect(once.cities[HOME]!.queue).toEqual([]);
    const again = endTurn(apply(apply(rich, repeat(true)), queue(warrior))).state;
    expect(again.cities[HOME]!.queue).toEqual([warrior]);
    // With something else waiting, the queue goes on with that.
    const granary: BuildItem = { kind: 'building', building: 'granary' };
    const busy = endTurn(apply(apply(apply(rich, repeat(true)), queue(warrior)), queue(granary))).state;
    expect(busy.cities[HOME]!.queue).toEqual([granary]);
  });

  it('does not queue again what the city may not build again', () => {
    const granary: BuildItem = { kind: 'building', building: 'granary' };
    const built = endTurn(apply(apply(rich, repeat(true)), queue(granary))).state;
    expect(built.cities[HOME]!.buildings).toContain('granary');
    expect(built.cities[HOME]!.queue).toEqual([]);
  });
});

describe('the AI and the city projects', () => {
  /** The first seed in which the leader of `nation` sets out for `ambition`. */
  const seedFor = (nation: string, ambition: Ambition): number => {
    for (let seed = 1; seed < 500; seed++) if (ambitionOf(seed, SELF, nation) === ambition) return seed;
    throw new Error(`no seed gives ${nation} the ambition ${ambition}`);
  };
  const nation = KIT_NATIONS[0]!;
  const lab = labMap(nation);
  const home = lab.polities[SELF]!.capitalZone;
  /** The project the AI picks for the capital of `nation`, a major nation that knows the techs of all three. */
  const pick = (ambition: Ambition, change: (draft: Parameters<Parameters<typeof edit>[1]>[0]) => void = () => {}): string | null => {
    const state = edit(
      learn(createGame(lab, { seed: seedFor(nation, ambition), majors: [nation] }), SELF, ['ritual', 'currency', 'writing']),
      change,
    );
    const ctx = createCtx(cloneState(state));
    const item = chooseProject(ctx, SELF, ctx.state.cities[home]!);
    return item === null ? null : item.kind === 'building' ? item.building : item.kind;
  };

  it('chooses by the leader’s ambition', () => {
    expect(pick('learning')).toBe('compilation');
    expect(pick('wealth')).toBe('minting');
    // A leader out for conquest mints for its army until its treasury is full, then has books compiled.
    expect(pick('conquest')).toBe('minting');
    expect(pick('conquest', (draft) => void (draft.polities[SELF]!.gold = 100_000))).toBe('compilation');
    expect(AI.mintTreasuryTurns).toBeGreaterThan(0);
  });

  it('passes over a project that would do nothing', () => {
    // Every tech known: no science is wanted; every card unlocked: no culture.
    const allTechs = (draft: Parameters<Parameters<typeof edit>[1]>[0]): void => void (draft.polities[SELF]!.techs = [...TECH_IDS]);
    expect(pick('learning', allTechs)).toBe('festival');
    expect(
      pick('learning', (draft) => {
        allTechs(draft);
        draft.polities[SELF]!.policies = [...POLICY_IDS];
      }),
    ).toBe('minting');
  });

  it('gives a nation that does not research festivals, and then the mint', () => {
    const state = learn(createGame(map, { seed: 3, majors: ['jia'] }), YI, ['ritual', 'currency', 'writing']);
    const ctx = createCtx(cloneState(state));
    const capital = ctx.state.cities[map.polities[YI]!.capitalZone]!;
    expect(chooseProject(ctx, YI, capital)).toEqual(project('festival'));
    ctx.state.polities[YI]!.policies = [...POLICY_IDS];
    expect(chooseProject(ctx, YI, capital)).toEqual(project('minting'));
  });

  it('puts an idle city on a project in its turn, and takes it off again when there is something to build', () => {
    // Yi, on the simplified AI, knows Ritual alone, has its temple and its two units: nothing is left to build.
    const zone = map.polities[YI]!.capitalZone;
    const idle = edit(createGame(map, { seed: 3, majors: ['jia'] }), (draft) => {
      draft.polities[YI]!.techs = ['ritual'];
      draft.cities[zone]!.buildings = ['temple'];
      const spare = topologyOf(map).zoneHexes[zone]!.find((hex) => isPlainGround(map, hex) && !draft.units.some((unit) => unit.hex === hex))!;
      put(draft, 'warrior', YI, spare);
    });
    const festive = endTurn(idle).state;
    expect(festive.cities[zone]!.queue).toEqual([project('festival')]);
    // The festival takes the production of the very turn it was chosen in, and gives culture as it adds up.
    expect(festive.cities[zone]!.progress).toBe(festive.cities[zone]!.yields.production % 4);
    let state = festive;
    for (let i = 0; i < 3; i++) state = endTurn(state).state;
    let quiet = edit(idle, (draft) => void (draft.polities[YI]!.techs = []));
    for (let i = 0; i < 4; i++) quiet = endTurn(quiet).state;
    expect(state.polities[YI]!.culture).toBeGreaterThan(quiet.polities[YI]!.culture);
    // A new tech brings something to build: the city drops the festival for it.
    const busy = endTurn(edit(festive, (draft) => void draft.polities[YI]!.techs.push('farming'))).state;
    const head = busy.cities[zone]!.queue[0]!;
    expect(cityProjectOf(head)).toBeNull();
    expect(busy.cities[zone]!.buildings.filter(isCityProject)).toEqual([]);
  });
});
