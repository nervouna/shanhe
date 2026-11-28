/**
 * The five difficulty levels as the interface shows them: a name and what
 * the level changes, in words whose numbers come from the rules' table. No
 * DOM here.
 */

import { DIFFICULTY, DIFFICULTY_LEVELS, scienceBonus, techCostBonus } from '../core/data.ts';
import type { DifficultyBonus, DifficultyLevel } from '../core/data.ts';
import { t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';

export interface LevelView {
  readonly level: DifficultyLevel;
  readonly name: string;
  /** What the level changes. */
  readonly effect: string;
}

type Table = Readonly<Record<DifficultyLevel, { readonly player: DifficultyBonus; readonly ai: DifficultyBonus }>>;

export function levelName(level: DifficultyLevel): string {
  const key: TranslationKey = `level.${level}`;
  return t(key);
}

function helps(bonus: DifficultyBonus): boolean {
  return bonus.yieldPercent !== 0 || bonus.strengthPercent !== 0 || scienceBonus(bonus) !== 0 || techCostBonus(bonus) !== 0;
}

/**
 * One side's bonus in words: yields and strength, then science where the
 * table gives it a figure of its own (left out, or another percentage), then
 * what the table puts on the cost of techs.
 */
function sideEffect(key: 'level.player' | 'level.ai', bonus: DifficultyBonus): string {
  const parts = [t(key, { yield: bonus.yieldPercent, strength: bonus.strengthPercent })];
  const science = scienceBonus(bonus);
  if (science !== bonus.yieldPercent) parts.push(science === 0 ? t('level.scienceOut') : t('level.science', { science }));
  const cost = techCostBonus(bonus);
  if (cost !== 0) parts.push(t('level.techCost', { cost }));
  return parts.join(t('level.join'));
}

/**
 * What a level changes: the bonus of the player, of the AI's major nations,
 * or that there is none.
 *
 * @param table the rules' table; a test passes another to see the numbers follow it.
 */
export function levelEffect(level: DifficultyLevel, table: Table = DIFFICULTY): string {
  const { player, ai } = table[level];
  const parts: string[] = [];
  if (helps(player)) parts.push(sideEffect('level.player', player));
  if (helps(ai)) parts.push(sideEffect('level.ai', ai));
  return parts.length === 0 ? t('level.even') : parts.join(' · ');
}

/** The five levels, easiest first. */
export function levelViews(): LevelView[] {
  return DIFFICULTY_LEVELS.map((level) => ({ level, name: levelName(level), effect: levelEffect(level) }));
}
