/**
 * What the interface says about the supply limit, the capital's bonus and
 * the balance of power: texts and rows worked out from the rules' queries.
 */

import type { Yields } from '../core/data.ts';
import type { GameState } from '../core/game.ts';
import { capitalBonus, powerStandings, supplyStanding, takesSupply } from '../core/query.ts';
import type { PowerRow, SupplyStanding } from '../core/query.ts';
import { t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import { yieldName } from './names.ts';

export interface SupplyView {
  /** Units against the limit, as the top bar shows it: with the surcharge once there is one. */
  readonly value: string;
  /** The same in words, for the tooltip and for assistive technology. */
  readonly text: string;
  /** True with more units than the limit supplies. */
  readonly over: boolean;
}

/** The supply as the top bar shows it. */
export function supplyView(supply: Pick<SupplyStanding, 'limit' | 'used' | 'surcharge'>): SupplyView {
  const { limit, used, surcharge } = supply;
  const count = `${used}/${limit}`;
  if (used <= limit) return { value: count, text: t('supply.status', { used, limit }), over: false };
  return { value: `${count} −${surcharge}`, text: t('supply.over', { used, limit, gold: surcharge }), over: true };
}

/** {@link supplyView} of a polity in a game. */
export function supplyOf(state: GameState, polity: number): SupplyView & SupplyStanding {
  const standing = supplyStanding(state, polity);
  return { ...standing, ...supplyView(standing) };
}

/**
 * The warning the build list carries when the next fighting unit would stand
 * beyond the supply limit, with what it would add to the surcharge. Null
 * while there is room for it.
 */
export function supplyWarning(supply: Pick<SupplyStanding, 'nextUnit'>): string | null {
  return supply.nextUnit > 0 ? t('supply.next', { gold: supply.nextUnit }) : null;
}

/** True if building a unit of this type now would put it beyond the supply limit. */
export function beyondSupply(supply: Pick<SupplyStanding, 'nextUnit'>, type: string): boolean {
  return supply.nextUnit > 0 && takesSupply(type);
}

export interface CapitalLine {
  readonly yield: keyof Yields;
  readonly percent: number;
  /** The yield's name with the percentage. */
  readonly text: string;
}

const YIELDS: readonly (keyof Yields)[] = ['food', 'production', 'gold', 'science', 'culture'];

/**
 * What the city in `zone` gains for being its nation's capital, one line per
 * yield in the order the panel lists the yields. Empty for any other city.
 */
export function capitalLines(state: GameState, zone: number): CapitalLine[] {
  const bonus = capitalBonus(state, zone);
  const lines: CapitalLine[] = [];
  for (const name of YIELDS) {
    const percent = bonus[name] ?? 0;
    if (percent !== 0) lines.push({ yield: name, percent, text: `${yieldName(name)} +${percent}%` });
  }
  return lines;
}

export interface BalanceRow extends PowerRow {
  /** The name of the track it leads on, or null for a nation nobody fears. */
  readonly leadName: string | null;
}

/** The nations in the race, the most feared first, each with how much it is feared and the track it leads on. */
export function balanceRows(state: GameState): BalanceRow[] {
  return powerStandings(state)
    .map((row): BalanceRow => {
      const key: TranslationKey | null = row.lead === null ? null : `track.${row.lead}`;
      return { ...row, leadName: key === null ? null : t(key) };
    })
    .sort((x, y) => y.fear - x.fear || x.polity - y.polity);
}
