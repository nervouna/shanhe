import { describe, expect, it } from 'vitest';
import { createFixtureMap } from '../shared/fixtureMap.ts';
import { cityYieldParts } from './cities.ts';
import { cityStrength, combatFactor } from './combat.ts';
import { cloneState, createCtx } from './context.ts';
import type { Ctx } from './context.ts';
import { DEFAULT_DIFFICULTY, DIFFICULTY, DIFFICULTY_LEVELS, scienceBonus, techCostBonus } from './data.ts';
import type { DifficultyLevel } from './data.ts';
import { createGame, endTurn, hashState, researchCost } from './game.ts';
import type { GameState } from './game.ts';
import { YIELD_KEYS } from './cities.ts';

const map = createFixtureMap();
const JIA = 0;
const YI = 1;
const BING = 2;
/** Jia plays, Yi is the AI's major nation, Bing is a nation on the simplified AI. */
const game = (difficulty?: DifficultyLevel): GameState =>
  createGame(map, difficulty === undefined ? { seed: 3, player: 'jia', majors: ['yi'] } : { seed: 3, player: 'jia', majors: ['yi'], difficulty });
const ctxOf = (state: GameState): Ctx => createCtx(cloneState(state));
const NONE = { yieldPercent: 0, strengthPercent: 0 };

/**
 * What the level adds for `polity`: the percentage on each city yield of its capital beyond what the same city
 * has at the middle level, and the factors on a unit's and the capital's strength.
 */
function measured(state: GameState, polity: number): { yields: number[]; unit: number; city: number } {
  const ctx = ctxOf(state);
  const city = ctx.state.cities[map.polities[polity]!.capitalZone]!;
  const unit = ctx.state.units.find((entry) => entry.owner === polity)!;
  const plain = ctxOf(game('standard'));
  const plainCity = plain.state.cities[city.zone]!;
  const yields = YIELD_KEYS.map((key) => cityYieldParts(ctx, city).percent[key] - cityYieldParts(plain, plainCity).percent[key]);
  const factor = combatFactor(ctx, unit, -1);
  // The city's own strength, without what a garrison adds to it.
  ctx.unitAt.clear();
  plain.unitAt.clear();
  return { yields, unit: factor, city: cityStrength(ctx, city) / cityStrength(plain, plain.state.cities[city.zone]!) };
}

describe('difficulty', () => {
  it('has five levels around a middle one that changes nothing', () => {
    expect(DIFFICULTY_LEVELS).toHaveLength(5);
    expect(DIFFICULTY_LEVELS[2]).toBe(DEFAULT_DIFFICULTY);
    expect(DIFFICULTY[DEFAULT_DIFFICULTY]).toEqual({ player: NONE, ai: NONE });
    // Below the middle only the player is helped, and more the lower the level; above it only the AI's majors.
    DIFFICULTY_LEVELS.forEach((level, index) => {
      const { player, ai } = DIFFICULTY[level];
      if (index < 2) {
        expect(player.yieldPercent).toBeGreaterThan(0);
        expect(player.strengthPercent).toBeGreaterThan(0);
        expect(ai).toEqual(NONE);
        // The player's bonus is on every yield, science included.
        expect(scienceBonus(player)).toBe(player.yieldPercent);
      }
      if (index > 2) {
        expect(ai.yieldPercent).toBeGreaterThan(0);
        expect(ai.strengthPercent).toBeGreaterThan(0);
        expect(player).toEqual(NONE);
        // The AI's bonus leaves science out: a harder AI does not learn faster.
        expect(scienceBonus(ai)).toBe(0);
      }
    });
    expect(DIFFICULTY.relaxed.player.yieldPercent).toBeGreaterThan(DIFFICULTY.easy.player.yieldPercent);
    expect(DIFFICULTY.severe.ai.yieldPercent).toBeGreaterThan(DIFFICULTY.hard.ai.yieldPercent);
    expect(DIFFICULTY.relaxed.player.strengthPercent).toBeGreaterThan(DIFFICULTY.easy.player.strengthPercent);
    expect(DIFFICULTY.severe.ai.strengthPercent).toBeGreaterThan(DIFFICULTY.hard.ai.strengthPercent);
  });

  it('is the middle level unless the setup says otherwise, and is kept in the state', () => {
    expect(game().difficulty).toBe('standard');
    expect(game('hard').difficulty).toBe('hard');
    expect(endTurn(game('hard')).state.difficulty).toBe('hard');
    expect(() => createGame(map, { difficulty: 'impossible' as DifficultyLevel })).toThrow(/difficulty/);
  });

  it('at the middle level plays exactly the game a setup without a level plays', () => {
    let plain = game();
    let standard = game('standard');
    for (let i = 0; i < 30; i++) {
      plain = endTurn(plain).state;
      standard = endTurn(standard).state;
    }
    expect(hashState(standard)).toBe(hashState(plain));
    for (const polity of [JIA, YI, BING]) {
      expect(measured(game('standard'), polity)).toEqual({ yields: [0, 0, 0, 0, 0], unit: 1, city: 1 });
    }
  });

  it.each(DIFFICULTY_LEVELS)('at level %s gives the player and the AI majors the numbers of the table', (level) => {
    const state = game(level);
    const { player, ai } = DIFFICULTY[level];
    const jia = measured(state, JIA);
    expect(jia.yields).toEqual(YIELD_KEYS.map((key) => (key === 'science' ? scienceBonus(player) : player.yieldPercent)));
    expect(jia.unit).toBeCloseTo(1 + player.strengthPercent / 100, 10);
    expect(jia.city).toBeCloseTo(1 + player.strengthPercent / 100, 2);
    const yi = measured(state, YI);
    // Science exactly as at the middle level, the other four yields at the level's percentage.
    expect(yi.yields).toEqual(YIELD_KEYS.map((key) => (key === 'science' ? 0 : ai.yieldPercent)));
    expect(yi.unit).toBeCloseTo(1 + ai.strengthPercent / 100, 10);
    expect(yi.city).toBeCloseTo(1 + ai.strengthPercent / 100, 2);
    // A nation on the simplified AI is never touched.
    expect(measured(state, BING)).toEqual({ yields: [0, 0, 0, 0, 0], unit: 1, city: 1 });
  });

  it('shows in what a city yields and in how a game goes', () => {
    const yieldsOf = (state: GameState, polity: number): number => {
      const city = endTurn(state).state.cities[map.polities[polity]!.capitalZone]!;
      return city.yields.food + city.yields.production + city.yields.gold + city.yields.science + city.yields.culture;
    };
    expect(yieldsOf(game('relaxed'), JIA)).toBeGreaterThan(yieldsOf(game('standard'), JIA));
    expect(yieldsOf(game('severe'), YI)).toBeGreaterThan(yieldsOf(game('standard'), YI));
    expect(yieldsOf(game('severe'), JIA)).toBe(yieldsOf(game('standard'), JIA));
    // In an observer game every major is the AI's.
    const watched = createGame(map, { seed: 3, difficulty: 'severe' });
    for (const major of watched.majors) {
      expect(measured(watched, major).yields).toEqual(YIELD_KEYS.map((key) => (key === 'science' ? 0 : DIFFICULTY.severe.ai.yieldPercent)));
    }
  });

  it('gives the AI no science: its cities yield the science of the middle level at Hard and Severe', () => {
    const scienceOf = (level: DifficultyLevel, polity: number): number => endTurn(game(level)).state.cities[map.polities[polity]!.capitalZone]!.yields.science;
    for (const level of ['hard', 'severe'] as const) {
      expect(DIFFICULTY[level].ai).toMatchObject({ sciencePercent: 0 });
      expect(DIFFICULTY[level].ai.yieldPercent).toBeGreaterThan(0);
      expect(scienceOf(level, YI)).toBe(scienceOf('standard', YI));
    }
    // And what it learns costs it more, by the level's percentage; the player and the others pay the plain cost.
    for (const level of DIFFICULTY_LEVELS) {
      const state = game(level);
      const plain = researchCost(game('standard'), YI, 'farming');
      expect(researchCost(state, YI, 'farming')).toBe(Math.ceil((plain * (100 + techCostBonus(DIFFICULTY[level].ai))) / 100));
      expect(researchCost(state, JIA, 'farming')).toBe(researchCost(game('standard'), JIA, 'farming'));
      expect(techCostBonus(DIFFICULTY[level].player)).toBe(0);
    }
    // The surcharge is at least the yield bonus, and grows with the level.
    expect(techCostBonus(DIFFICULTY.standard.ai)).toBe(0);
    expect(techCostBonus(DIFFICULTY.hard.ai)).toBeGreaterThanOrEqual(DIFFICULTY.hard.ai.yieldPercent);
    expect(techCostBonus(DIFFICULTY.severe.ai)).toBeGreaterThan(techCostBonus(DIFFICULTY.hard.ai));
    // The player's bonus below the middle level does include science.
    expect(scienceBonus(DIFFICULTY.relaxed.player)).toBe(30);
    expect(scienceBonus(DIFFICULTY.easy.player)).toBe(15);
  });
});
