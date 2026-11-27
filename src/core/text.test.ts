import { describe, expect, it } from 'vitest';
import { dictionaries } from '../shared/i18n.ts';
import { AGREEMENT_KINDS, CITY_STATE_TYPES, POLICY_IDS } from './data.ts';
import type { EndReason, GameEvent, RejectReason } from './game.ts';

/** The events of policies, diplomacy, trade, roads, buying and city-states. */
const EVENTS = {
  policyUnlocked: true,
  policySlotted: true,
  offerMade: true,
  offerAnswered: true,
  agreementSigned: true,
  agreementEnded: true,
  warJoined: true,
  vassalized: true,
  vassalReleased: true,
  dealSigned: true,
  dealEnded: true,
  routeEstablished: true,
  routeEnded: true,
  routePillaged: true,
  improvementPillaged: true,
  roadsBuilt: true,
  itemBought: true,
  goldGifted: true,
  suzerainChanged: true,
} satisfies Partial<Record<GameEvent['type'], true>>;

/** The reject codes of the same rules. */
const REJECTS = {
  noPolicies: true,
  alreadyUnlocked: true,
  notEnoughCulture: true,
  notUnlocked: true,
  badSlot: true,
  alreadySlotted: true,
  swapCooldown: true,
  atWar: true,
  alreadyAgreed: true,
  alreadyOffered: true,
  noSuchAgreement: true,
  agreementTooYoung: true,
  tooManyAlliances: true,
  allied: true,
  vassal: true,
  notACapital: true,
  cityNotFallen: true,
  noSuchOffer: true,
  noSuchDeal: true,
  alreadyHasResource: true,
  badAmount: true,
  noRouteSlot: true,
  noRoute: true,
  duplicateRoute: true,
  noSuchRoute: true,
  portClosed: true,
  nothingToPillage: true,
  cannotBuy: true,
  inUnrest: true,
  noRoom: true,
} satisfies Partial<Record<RejectReason, true>>;

const END_REASONS: Record<EndReason, true> = {
  expired: true,
  cancelled: true,
  war: true,
  annexed: true,
  replaced: true,
  unpaid: true,
  lost: true,
  capitalLost: true,
  cityLost: true,
};

describe('text keys of the rules', () => {
  const keys = [
    ...POLICY_IDS.flatMap((id) => [`policy.${id}`, `policy.${id}.effect`]),
    ...AGREEMENT_KINDS.map((kind) => `agreement.${kind}`),
    ...CITY_STATE_TYPES.map((type) => `cityState.${type}`),
    ...Object.keys(END_REASONS).map((reason) => `endReason.${reason}`),
    ...Object.keys(EVENTS).map((type) => `event.${type}`),
    ...Object.keys(REJECTS).map((code) => `reject.${code}`),
  ];

  it('exist in Chinese and in English for every card, agreement, city-state type, event and reject code', () => {
    expect(keys.length).toBe(48 + 5 + 5 + 9 + 19 + 30);
    for (const language of ['zh', 'en'] as const) {
      const dictionary: Record<string, string> = dictionaries[language];
      for (const key of keys) expect(dictionary[key], `${language}:${key}`).toBeTruthy();
    }
  });

  it('are appended in one block at the end of each dictionary, in the same order', () => {
    const zh = Object.keys(dictionaries.zh);
    const en = Object.keys(dictionaries.en);
    // The block of these rules ends where the block of the nation kits (`kits.test.ts`) begins.
    const first = zh.indexOf('policy.wellField');
    const next = zh.indexOf('trait.yan');
    expect(zh.slice(first)).toEqual(en.slice(en.indexOf('policy.wellField')));
    expect([...zh.slice(first, next)].sort()).toEqual([...keys].sort());
  });
});
