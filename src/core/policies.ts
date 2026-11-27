/** Policy cards: unlocking them with culture, the slots, and reading the effects of the slotted ones. */

import { POLICIES, POLICY, isPolicyId, policyCost } from './data.ts';
import type { PolicyDef, PolicyId } from './data.ts';
import { at, polityOf } from './context.ts';
import type { Ctx } from './context.ts';
import { kitOfNation } from './kits.ts';
import { forgetMods, modsOf } from './modifiers.ts';
import { NO_POLITY } from './types.ts';
import type { PolityState, RejectReason } from './types.ts';

/** Policy slots of a polity in era `era` (an index into `ERAS`). */
export function policySlots(era: number): number {
  return at(POLICY.slotsByEra, Math.max(0, Math.min(POLICY.slotsByEra.length - 1, era)));
}

/**
 * Policy slots of the nation with the id (`MapPolity.id`) in era `era`: those
 * of the era, plus what its kit adds.
 */
export function policySlotsFor(nation: string, era: number): number {
  let slots = policySlots(era);
  const kit = kitOfNation(nation);
  if (kit === null) return slots;
  for (const modifier of [...kit.trait, ...kit.leader]) if (modifier.type === 'policySlots') slots += modifier.slots;
  return slots;
}

/**
 * Gives a polity the empty slots its era adds. Called when it enters an era.
 *
 * @param id the polity's `MapPolity.id`, for the slots its kit adds.
 */
export function growSlots(polity: PolityState, nation: boolean, id = ''): void {
  if (!nation) return;
  while (polity.slots.length < policySlotsFor(id, polity.era)) polity.slots.push(null);
}

/** True if the polity has the card in a slot. */
export function hasPolicy(ctx: Ctx, polity: number, policy: PolicyId): boolean {
  return polity !== NO_POLITY && polityOf(ctx, polity).slots.includes(policy);
}

/** The cards in the polity's slots. */
export function slotted(ctx: Ctx, polity: number): PolicyDef[] {
  if (polity === NO_POLITY) return [];
  const list: PolicyDef[] = [];
  for (const id of polityOf(ctx, polity).slots) if (id !== null) list.push(POLICIES[id]);
  return list;
}

type NumericEffect = {
  [K in keyof PolicyDef]-?: NonNullable<PolicyDef[K]> extends number ? K : never;
}[keyof PolicyDef];

/** Sum of a numeric effect over the polity's slotted cards (0 when no card has it). */
export function policySum(ctx: Ctx, polity: number, effect: Exclude<NumericEffect, 'era'>): number {
  let total = 0;
  for (const def of slotted(ctx, polity)) total += def[effect] ?? 0;
  return total;
}

function hasPolicies(ctx: Ctx, polity: number): boolean {
  return at(ctx.map.polities, polity).kind === 'nation';
}

/** Why the polity cannot unlock the card now, or null. */
export function checkUnlock(ctx: Ctx, polity: number, policy: unknown): RejectReason | null {
  if (!isPolicyId(policy)) return 'badItem';
  if (!hasPolicies(ctx, polity)) return 'noPolicies';
  const self = polityOf(ctx, polity);
  if (self.policies.includes(policy)) return 'alreadyUnlocked';
  if (POLICIES[policy].era > self.era) return 'eraTooEarly';
  return self.cultureProgress >= policyCost(self.policies.length) ? null : 'notEnoughCulture';
}

/** The cards the polity could unlock now, in table order. */
export function openPolicies(ctx: Ctx, polity: number): PolicyId[] {
  return (Object.keys(POLICIES) as PolicyId[]).filter((policy) => checkUnlock(ctx, polity, policy) === null);
}

/** Unlocks a card that {@link checkUnlock} has passed: the culture is spent and one free swap is granted. */
export function unlockPolicy(ctx: Ctx, polity: number, policy: PolicyId): void {
  const self = polityOf(ctx, polity);
  self.cultureProgress -= policyCost(self.policies.length);
  self.policies.push(policy);
  self.freeSwaps++;
  ctx.events.push({ type: 'policyUnlocked', polity, policy });
}

/**
 * Why the polity cannot put the card into the slot (or empty the slot, with
 * `policy` null), or null. Filling an empty slot and emptying one are always
 * allowed; replacing a card is a swap, which takes a free swap or, without
 * one, starts the cooldown.
 */
export function checkSlot(ctx: Ctx, polity: number, policy: unknown, slot: unknown): RejectReason | null {
  if (!hasPolicies(ctx, polity)) return 'noPolicies';
  const self = polityOf(ctx, polity);
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= self.slots.length) return 'badSlot';
  const current = at(self.slots, slot);
  if (policy === null) return current === null ? 'alreadySlotted' : null;
  if (!isPolicyId(policy)) return 'badItem';
  if (!self.policies.includes(policy)) return 'notUnlocked';
  if (self.slots.includes(policy)) return 'alreadySlotted';
  if (current === null || self.freeSwaps > 0) return null;
  return ctx.state.turn >= self.swapReadyOn ? null : 'swapCooldown';
}

/** Turns before another paid swap after one. */
export function swapCooldown(ctx: Ctx, polity: number): number {
  let turns: number = POLICY.swapCooldown;
  for (const modifier of modsOf(ctx, polity, 'swapCooldown')) turns += modifier.turns;
  return Math.max(0, turns);
}

/** Carries out what {@link checkSlot} has passed. */
export function slotPolicy(ctx: Ctx, polity: number, policy: PolicyId | null, slot: number): void {
  const self = polityOf(ctx, polity);
  const replaced = at(self.slots, slot);
  if (policy !== null && replaced !== null) {
    if (self.freeSwaps > 0) self.freeSwaps--;
    else self.swapReadyOn = ctx.state.turn + swapCooldown(ctx, polity);
  }
  self.slots[slot] = policy;
  forgetMods(ctx, polity);
  ctx.events.push({ type: 'policySlotted', polity, slot, policy, replaced });
}
