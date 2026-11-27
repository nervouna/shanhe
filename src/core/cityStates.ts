/** City-states: influence, the suzerain and what being suzerain gives. */

import { CITY_STATE } from './data.ts';
import type { CityStateType } from './data.ts';
import { dropKey, polityOf } from './context.ts';
import type { Ctx } from './context.ts';
import { policySum } from './policies.ts';
import { isCityState } from './relations.ts';
import { NO_POLITY } from './types.ts';

/** Influence of `polity` with the city-state. */
export function influenceOf(ctx: Ctx, cityState: number, polity: number): number {
  return polityOf(ctx, cityState).influence[polity] ?? 0;
}

/** Number of living city-states of the type that `polity` is suzerain of. */
export function suzerainCount(ctx: Ctx, polity: number, type: CityStateType): number {
  let count = 0;
  for (const other of ctx.state.polities) {
    if (other.alive && other.suzerain === polity && other.cityStateType === type) count++;
  }
  return count;
}

/**
 * The suzerain the city-state should have: the polity with the most
 * influence, if that reaches the threshold. The current suzerain keeps a
 * tie; otherwise the lower index wins it.
 */
function rightfulSuzerain(ctx: Ctx, cityState: number): number {
  const self = polityOf(ctx, cityState);
  let best = NO_POLITY;
  let most = CITY_STATE.suzerainInfluence - 1;
  for (const key of Object.keys(self.influence)) {
    const polity = Number(key);
    const value = self.influence[key] ?? 0;
    if (!polityOf(ctx, polity).alive) continue;
    if (value > most || (value === most && best !== NO_POLITY && polity === self.suzerain)) {
      most = value;
      best = polity;
    }
  }
  return best;
}

/** Sets the city-state's suzerain to the one its influence now gives, and reports a change. */
export function updateSuzerain(ctx: Ctx, cityState: number): void {
  const self = polityOf(ctx, cityState);
  const next = self.alive ? rightfulSuzerain(ctx, cityState) : NO_POLITY;
  if (next === self.suzerain) return;
  ctx.events.push({ type: 'suzerainChanged', cityState, from: self.suzerain, to: next });
  self.suzerain = next;
}

/**
 * Adds influence of `polity` with the city-state. A gain grows with the
 * polity's cards (Covenant); the total stays within 0 and the maximum.
 */
export function addInfluence(ctx: Ctx, cityState: number, polity: number, amount: number): void {
  if (!isCityState(ctx, cityState) || polity === cityState) return;
  const self = polityOf(ctx, cityState);
  if (!self.alive) return;
  const gain = amount > 0 ? Math.floor((amount * (100 + policySum(ctx, polity, 'influencePercent'))) / 100) : amount;
  const value = Math.max(0, Math.min(CITY_STATE.maxInfluence, (self.influence[polity] ?? 0) + gain));
  if (value === 0) dropKey(self.influence, polity);
  else self.influence[polity] = value;
  updateSuzerain(ctx, cityState);
}

/** Removes every trace of `polity` from the city-states' influence: it went to war with them all, or is gone. */
export function forgetInfluence(ctx: Ctx, polity: number, cityState = NO_POLITY): void {
  ctx.state.polities.forEach((other, index) => {
    if (other.cityStateType === null || (cityState !== NO_POLITY && index !== cityState)) return;
    if (other.influence[polity] === undefined) return;
    dropKey(other.influence, polity);
    updateSuzerain(ctx, index);
  });
}

/** One turn: every polity's influence with every city-state fades a little, then suzerains are set. */
export function processInfluence(ctx: Ctx): void {
  ctx.state.polities.forEach((self, index) => {
    if (self.cityStateType === null) return;
    if (!self.alive) {
      if (self.suzerain !== NO_POLITY || Object.keys(self.influence).length > 0) {
        self.influence = {};
        updateSuzerain(ctx, index);
      }
      return;
    }
    for (const key of Object.keys(self.influence)) {
      const value = (self.influence[key] ?? 0) - CITY_STATE.decay;
      if (value <= 0 || !polityOf(ctx, Number(key)).alive) dropKey(self.influence, key);
      else self.influence[key] = value;
    }
    updateSuzerain(ctx, index);
  });
}
