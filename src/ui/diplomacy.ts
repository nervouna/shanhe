/**
 * What the player can do with another polity: every proposal, cancellation,
 * gift and deal, each with the rules' reason when it is refused now.
 */

import type { AgreementKind } from '../core/data.ts';
import { NO_POLITY, agreementsOf } from '../core/game.ts';
import type { Action, Agreement, Deal, GameState, Offer, RejectReason } from '../core/game.ts';
import { ambitionOf } from '../core/kits.ts';
import type { Ambition } from '../core/kits.ts';
import { atWarWith, checkAction, dealOptions, peaceMakesVassal, vassalRoom } from '../core/query.ts';
import { t } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import { agreementName, rejectText, resourceName } from './names.ts';

/** The agreements a polity can propose and cancel, in the order the panel lists them. */
export const PROPOSABLE: readonly Exclude<AgreementKind, 'truce'>[] = ['tradePact', 'openBorders', 'alliance', 'vassalage'];

/** Gold of the gifts the panel offers. */
export const GIFTS: readonly number[] = [20, 100];

export type DiplomaticControl = {
  /** Stable name of the control, also its `data-control` in the page. */
  readonly id: string;
  /** The action a click sends. */
  readonly action: Action;
  /** Why the rules refuse it now, or null. */
  readonly reason: RejectReason | null;
} & (
  | { readonly kind: 'declareWar' | 'makePeace' }
  | { readonly kind: 'propose' | 'cancel'; readonly agreement: Exclude<AgreementKind, 'truce'> }
  | { readonly kind: 'gift'; readonly amount: number }
  /** `resource` is a `MapResource.id`; the player buys when `buying`, sells otherwise. */
  | { readonly kind: 'deal'; readonly resource: string; readonly goldPerTurn: number; readonly buying: boolean }
  | { readonly kind: 'cancelDeal'; readonly deal: Readonly<Deal> }
);

function kindOf(state: GameState, polity: number): string {
  return state.map.polities[polity]?.kind ?? '';
}

/**
 * The controls of the polity panel for `me` towards `other`, in display
 * order. War or peace comes first; between two nations follow the
 * agreements (a proposal for each one not in force, a cancellation for each
 * one `me` may end), the gifts, and the resource deals both ways. A
 * city-state gets war or peace and the gifts. At war there is nothing to
 * propose but peace.
 */
export function diplomaticControls(state: GameState, me: number, other: number): DiplomaticControl[] {
  if (me === NO_POLITY || me === other) return [];
  if (state.polities[me]?.alive !== true || state.polities[other]?.alive !== true) return [];
  const mine = kindOf(state, me);
  const theirs = kindOf(state, other);
  if (mine !== 'nation' || (theirs !== 'nation' && theirs !== 'cityState')) return [];

  const controls: DiplomaticControl[] = [];
  const reason = (action: Action): RejectReason | null => checkAction(state, action);
  const war = atWarWith(state, me, other);
  if (war) {
    const action: Action = { type: 'makePeace', polity: me, target: other };
    controls.push({ id: 'makePeace', kind: 'makePeace', action, reason: reason(action) });
    return controls;
  }
  const declare: Action = { type: 'declareWar', polity: me, target: other };
  controls.push({ id: 'declareWar', kind: 'declareWar', action: declare, reason: reason(declare) });

  if (theirs === 'nation') {
    const between = agreementsBetween(state, me, other);
    for (const agreement of PROPOSABLE) {
      const inForce = between.find((entry) => entry.kind === agreement);
      if (inForce === undefined) {
        const action: Action = { type: 'propose', polity: me, target: other, agreement };
        controls.push({ id: `propose:${agreement}`, kind: 'propose', agreement, action, reason: reason(action) });
      } else if (agreement !== 'vassalage' || inForce.a === me) {
        // a vassal cannot end its vassalage: there is no control for it
        const action: Action = { type: 'cancelAgreement', polity: me, target: other, agreement };
        controls.push({ id: `cancel:${agreement}`, kind: 'cancel', agreement, action, reason: reason(action) });
      }
    }
  }

  for (const amount of GIFTS) {
    const action: Action = { type: 'gift', polity: me, target: other, amount };
    controls.push({ id: `gift:${amount}`, kind: 'gift', amount, action, reason: reason(action) });
  }

  if (theirs === 'nation') {
    for (const option of dealOptions(state, me, other)) {
      const buying = option.buyer === me;
      const action: Action = {
        type: 'proposeDeal',
        polity: me,
        target: other,
        seller: option.seller,
        resource: option.resource,
        goldPerTurn: option.goldPerTurn,
      };
      controls.push({
        id: `deal:${buying ? 'buy' : 'sell'}:${option.resource}`,
        kind: 'deal',
        resource: option.resource,
        goldPerTurn: option.goldPerTurn,
        buying,
        action,
        reason: reason(action),
      });
    }
    for (const deal of dealsBetween(state, me, other)) {
      const action: Action = { type: 'cancelDeal', polity: me, deal: deal.id };
      controls.push({ id: `cancelDeal:${deal.id}`, kind: 'cancelDeal', deal, action, reason: reason(action) });
    }
  }
  return controls;
}

/**
 * The text shown with a refused control, or null for one the rules accept.
 * `refused` means the other side would say no: for peace that has its own
 * sentence, for a proposal or a deal a general one.
 */
export function controlReasonText(control: DiplomaticControl): string | null {
  if (control.reason === null) return null;
  if (control.reason === 'refused' && control.kind !== 'makePeace') return t('reason.declined');
  return rejectText(control.reason);
}

/** The agreements in force between the two, truces included, in the order they were signed. */
export function agreementsBetween(state: GameState, a: number, b: number): Readonly<Agreement>[] {
  return agreementsOf(state, a).filter((agreement) => agreement.a === b || agreement.b === b);
}

/** The resource deals in force between the two. */
export function dealsBetween(state: GameState, a: number, b: number): Readonly<Deal>[] {
  return state.deals.filter(
    (deal) => (deal.seller === a && deal.buyer === b) || (deal.seller === b && deal.buyer === a),
  );
}

/** The proposals of `from` that wait for the player's answer. */
export function offersFrom(state: GameState, from: number): Readonly<Offer>[] {
  return state.offers.filter((offer) => offer.to === state.player && offer.from === from);
}

/** How `other` stands to `me`, the strongest tie first. */
export type Standing = 'self' | 'war' | 'overlord' | 'vassal' | 'alliance' | 'friendly' | 'truce' | 'peace';

export const STANDINGS: readonly Standing[] = ['self', 'war', 'overlord', 'vassal', 'alliance', 'friendly', 'truce', 'peace'];

/**
 * The one word for the relation of `other` to `me`: at war, my overlord, my
 * vassal, an ally, a partner in a trade pact or open borders, under a truce,
 * or simply at peace.
 */
export function standingWith(state: GameState, me: number, other: number): Standing {
  if (me === other) return 'self';
  if (me === NO_POLITY || other === NO_POLITY) return 'peace';
  if (atWarWith(state, me, other)) return 'war';
  if (state.polities[me]?.overlord === other) return 'overlord';
  if (state.polities[other]?.overlord === me) return 'vassal';
  const kinds = agreementsBetween(state, me, other).map((agreement) => agreement.kind);
  if (kinds.includes('alliance')) return 'alliance';
  if (kinds.includes('tradePact') || kinds.includes('openBorders')) return 'friendly';
  if (kinds.includes('truce')) return 'truce';
  return 'peace';
}

/** What a proposal asks for, as a phrase that follows the proposer's name. */
export function offerText(map: MapData, offer: Readonly<Offer>): string {
  if (offer.type === 'agreement') {
    return offer.agreement === 'vassalage' ? t('offer.vassalage') : agreementName(offer.agreement);
  }
  const values = { resource: resourceName(map, offer.resource), gold: offer.goldPerTurn };
  return offer.seller === offer.from ? t('offer.sell', values) : t('offer.buy', values);
}

/**
 * What the leader of `other` has set out to win in this game, as far as the
 * viewer knows it. An ambition is hidden: only an ally and an overlord learn
 * it from the nation itself. The observer sees everybody's. Null where it is
 * not known, and for a nation that is not a major one: only those follow an
 * ambition.
 */
export function knownAmbition(state: GameState, viewer: number, other: number): Ambition | null {
  const id = state.map.polities[other]?.id;
  if (id === undefined || viewer === other || !state.majors.includes(other)) return null;
  if (viewer !== NO_POLITY) {
    const standing = standingWith(state, viewer, other);
    if (standing !== 'alliance' && standing !== 'vassal') return null;
  }
  return ambitionOf(state.seed, other, id);
}

/** The vassals the polity holds against what its era allows, as the text shown where a vassal is asked for. */
export function vassalRoomText(state: GameState, polity: number): string {
  const { used, cap } = vassalRoom(state, polity);
  return t('vassals.room', { used, cap });
}

/**
 * What accepting peace with `other` is called: a plain peace, or a peace
 * that makes `other` the player's vassal (doc 03, "Submission").
 */
export function peaceText(state: GameState, me: number, other: number): string {
  return peaceMakesVassal(state, me, other) ? t('offer.submission') : t('polity.makePeace');
}
