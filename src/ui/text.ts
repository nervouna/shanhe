/** Wording that depends on a number or on the language: plural forms, yields, and the names on the majors strip. No DOM here. */

import type { Yields } from '../core/data.ts';
import { dictionaries, getLanguage, t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import { yieldName } from './names.ts';
import { signed } from './view.ts';

/** The strings that count something and have a form of their own for one of it. */
export type CountedKey = 'count.turns' | 'city.unrest' | 'hud.researching' | 'victory.turnsLeft' | 'policy.freeSwaps' | 'polity.cities';

/**
 * A string that counts something, in the form its language has for that
 * number: English says "1 turn" and "2 turns", Chinese says both the same way.
 *
 * @param count the number the form depends on; it must also be among `params` under the name the string uses.
 */
export function counted(key: CountedKey, count: number, params: Readonly<Record<string, string | number>>): string {
  const one: TranslationKey = `${key}.one`;
  return t(count === 1 && Object.hasOwn(dictionaries[getLanguage()], one) ? one : key, params);
}

/** "3 turns", "1 turn". */
export function turnsText(turns: number): string {
  return counted('count.turns', turns, { turns });
}

/** What something adds to a yield, as it is written after a name: "+2 food", "+2粮". */
export function gainText(name: keyof Yields, value: number): string {
  const word = yieldName(name);
  return t('yield.gain', { value: signed(value), name: getLanguage() === 'en' ? word.toLowerCase() : word });
}

/**
 * What a city project does, from its entry in the rules' table: "4 production → 1 culture"
 * where the rate is a whole number of production for a point, the
 * percentage otherwise.
 */
export function conversionText(converts: { readonly to: keyof Yields; readonly percent: number }): string {
  const lower = (word: string): string => (getLanguage() === 'en' ? word.toLowerCase() : word);
  const from = lower(yieldName('production'));
  const to = lower(yieldName(converts.to));
  const every = 100 / converts.percent;
  return Number.isInteger(every)
    ? t('city.convertsEvery', { every, from, to })
    : t('city.convertsPercent', { percent: converts.percent, from, to });
}

/** What something gives every turn: "+3 culture a turn", "+3文/回合". */
export function perTurnText(name: keyof Yields, value: number): string {
  return t('city.perTurn', { gain: gainText(name, value) });
}

/**
 * The rows of the strip of major nations in the top right. Every name is
 * shown whole: Chinese names are short and stand in one row; English ones
 * run to ten letters, so more than six of them stand in two rows.
 */
export function majorRows(count: number): 1 | 2 {
  return getLanguage() === 'en' && count > 6 ? 2 : 1;
}
