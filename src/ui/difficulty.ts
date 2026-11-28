/**
 * The five difficulty levels as the interface shows them: a name and what
 * the level changes, in words whose numbers come from the rules' table. No
 * DOM here.
 */

import { DIFFICULTY, DIFFICULTY_LEVELS } from '../core/data.ts';
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
  return bonus.yieldPercent !== 0 || bonus.strengthPercent !== 0;
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
  if (helps(player)) parts.push(t('level.player', { yield: player.yieldPercent, strength: player.strengthPercent }));
  if (helps(ai)) parts.push(t('level.ai', { yield: ai.yieldPercent, strength: ai.strengthPercent }));
  return parts.length === 0 ? t('level.even') : parts.join(' · ');
}

/** The five levels, easiest first. */
export function levelViews(): LevelView[] {
  return DIFFICULTY_LEVELS.map((level) => ({ level, name: levelName(level), effect: levelEffect(level) }));
}
