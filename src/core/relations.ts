/**
 * Reading the standing between polities: favour, the agreements in force,
 * allies, vassals and overlords. Nothing here changes the state except
 * {@link addFavour}; signing and ending agreements is in `diplomacy.ts`.
 */

import { DIPLOMACY, FAVOUR } from './data.ts';
import type { AgreementKind } from './data.ts';
import { at, polityOf, relationKey } from './context.ts';
import type { Ctx } from './context.ts';
import { NO_POLITY } from './types.ts';
import type { Agreement } from './types.ts';

/** True for a nation: the polities that have favour, agreements and deals. City-states and wasteland do not. */
export function isNation(ctx: Ctx, polity: number): boolean {
  return polity >= 0 && polity < ctx.n && at(ctx.map.polities, polity).kind === 'nation';
}

export function isCityState(ctx: Ctx, polity: number): boolean {
  return polity >= 0 && polity < ctx.n && at(ctx.map.polities, polity).kind === 'cityState';
}

/** Favour between two nations, from `-FAVOUR.max` to `FAVOUR.max`. */
export function favourOf(ctx: Ctx, a: number, b: number): number {
  return ctx.state.favour[relationKey(a, b)] ?? 0;
}

/** Changes the favour between two nations by `delta`, within the limits. Other polities have no favour. */
export function addFavour(ctx: Ctx, a: number, b: number, delta: number): void {
  if (a === b || !isNation(ctx, a) || !isNation(ctx, b)) return;
  const key = relationKey(a, b);
  const value = Math.max(-FAVOUR.max, Math.min(FAVOUR.max, (ctx.state.favour[key] ?? 0) + delta));
  ctx.state.favour[key] = value;
}

/** The agreement of the kind between the two, whichever way round, or undefined. */
export function findAgreement(ctx: Ctx, kind: AgreementKind, a: number, b: number): Agreement | undefined {
  for (const agreement of ctx.state.agreements) {
    if (agreement.kind !== kind) continue;
    if ((agreement.a === a && agreement.b === b) || (agreement.a === b && agreement.b === a)) return agreement;
  }
  return undefined;
}

export function hasAgreement(ctx: Ctx, kind: AgreementKind, a: number, b: number): boolean {
  return findAgreement(ctx, kind, a, b) !== undefined;
}

/** The polities `polity` has an agreement of the kind with, ascending. */
export function partnersIn(ctx: Ctx, kind: AgreementKind, polity: number): number[] {
  const list: number[] = [];
  for (const agreement of ctx.state.agreements) {
    if (agreement.kind !== kind) continue;
    if (agreement.a === polity) list.push(agreement.b);
    else if (agreement.b === polity) list.push(agreement.a);
  }
  return list.sort((x, y) => x - y);
}

export function alliesOf(ctx: Ctx, polity: number): number[] {
  return partnersIn(ctx, 'alliance', polity);
}

/** The polity it is a vassal of, or `NO_POLITY`. */
export function overlordOf(ctx: Ctx, polity: number): number {
  return polity === NO_POLITY ? NO_POLITY : polityOf(ctx, polity).overlord;
}

/** Its living vassals, ascending. */
export function vassalsOf(ctx: Ctx, polity: number): number[] {
  const list: number[] = [];
  ctx.state.polities.forEach((other, index) => {
    if (other.alive && other.overlord === polity) list.push(index);
  });
  return list;
}

/** True if `polity` holds as many vassals as its era lets it (`DIPLOMACY.vassalsByEra`). */
export function vassalsFull(ctx: Ctx, polity: number): boolean {
  const era = polityOf(ctx, polity).era;
  return vassalsOf(ctx, polity).length >= (DIPLOMACY.vassalsByEra[era] ?? 0);
}

/** The polities `polity` is at war with, ascending. */
export function enemiesOf(ctx: Ctx, polity: number): number[] {
  const list: number[] = [];
  for (let other = 0; other < ctx.n; other++) if (ctx.war[polity * ctx.n + other] === 1) list.push(other);
  return list;
}
