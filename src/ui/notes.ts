/**
 * Which events become notifications, for whom, and where each one points on
 * the map. No DOM here.
 *
 * The observer is told of everything that changes the map. A player is told
 * of what their nation is a party to, of what the whole world knows (a new
 * era, a stage of the endgame project), and of a city that falls where they
 * can see it. Nothing else that happens out of their sight is reported, and
 * no notification points at a hex they have never seen.
 */

import { NO_POLITY } from '../core/game.ts';
import type { GameEvent, GameState, Offer } from '../core/game.ts';
import { peaceMakesVassal } from '../core/query.ts';
import { FogState } from '../render/scene.ts';
import { t } from '../shared/i18n.ts';
import { NO_ZONE } from '../shared/mapData.ts';
import { offerText } from './diplomacy.ts';
import { cityName, eraName, itemName, polityName, resourceName, techName, unitName } from './names.ts';
import { peaceOffers } from './pending.ts';
import { inSight } from './sight.ts';
import type { Sight } from './sight.ts';

/** A proposal a notification stands for: one of `state.offers` by id, or the peace offer of a polity. */
export type NoteOffer = { readonly kind: 'offer'; readonly id: number } | { readonly kind: 'peace'; readonly from: number };

export interface NoteDraft {
  /** Built on every redraw, so that it follows the language. */
  readonly text: () => string;
  /** The hex a click flies to, or -1. */
  readonly hex: number;
  /** The proposal to answer from the notification, or null. */
  readonly offer: NoteOffer | null;
  /** Polities whose earlier peace offers this event has overtaken: their notifications go. */
  readonly settles: readonly number[];
}

/**
 * The notifications that stay when there is room for `limit` of them: the
 * newest, and every one that stands for a proposal, however many there are.
 * A proposal waits for an answer, so news never pushes its notification out.
 */
export function keepNotes<T extends { readonly offer: NoteOffer | null }>(notes: readonly T[], limit: number): T[] {
  let plain = Math.max(0, limit - notes.filter((note) => note.offer !== null).length);
  const kept: T[] = [];
  for (let index = notes.length - 1; index >= 0; index--) {
    const note = notes[index] as T;
    if (note.offer === null && plain-- <= 0) continue;
    kept.unshift(note);
  }
  return kept;
}

/**
 * True if the interface may point the player at the hex: one they see or
 * have seen, or the site of a capital the map starts a polity with, which
 * everybody knows. The observer may be pointed anywhere.
 */
export function canPoint(state: GameState, sight: Sight | null, hex: number): boolean {
  if (hex < 0) return false;
  if (sight === null || sight.fog[hex] !== FogState.Unseen) return true;
  const { map } = state;
  return map.polities.some((polity) => polity.capitalZone !== NO_ZONE && map.zones[polity.capitalZone]?.siteHex === hex);
}

/** The hex of a polity's capital, or of the capital the map starts it with; -1 without one. */
function capitalOf(state: GameState, polity: number): number {
  const { map } = state;
  const zone = state.polities[polity]?.capital ?? -1;
  return map.zones[zone >= 0 ? zone : (map.polities[polity]?.capitalZone ?? -1)]?.siteHex ?? -1;
}

/** The notification of a proposal that waits for the player's answer. */
function proposalDraft(state: GameState, sight: Sight | null, offer: Readonly<Offer>): NoteDraft {
  const { map } = state;
  const hex = capitalOf(state, offer.from);
  return {
    text: () => t('event.offerMade', { from: polityName(map, offer.from), what: offerText(map, offer) }),
    hex: canPoint(state, sight, hex) ? hex : -1,
    offer: { kind: 'offer', id: offer.id },
    settles: [],
  };
}

/** The notification of a peace offer of `from` to the player. */
function peaceDraft(state: GameState, sight: Sight | null, from: number, now: () => GameState): NoteDraft {
  const { map, player } = state;
  const hex = capitalOf(state, from);
  return {
    // an offer that would make the other a vassal says so, for as long as that is what accepting it does
    text: () => t(peaceMakesVassal(now(), player, from) ? 'note.offerVassal' : 'note.offer', { a: polityName(map, from) }),
    hex: canPoint(state, sight, hex) ? hex : -1,
    offer: { kind: 'peace', from },
    settles: [from],
  };
}

/**
 * The notifications of everything that waits for the player's answer in
 * `state`: every proposal made to them and every peace offer that stands,
 * in that order. A game that is loaded (continued, imported) has no events
 * to tell of them, so its notifications are made from this.
 *
 * @param sight the player's sight in `state`, or null for the observer, who is offered nothing.
 * @param now the state at the time a text is drawn; `state` by default.
 */
export function pendingDrafts(state: GameState, sight: Sight | null, now: () => GameState = () => state): NoteDraft[] {
  const me = state.player;
  if (me === NO_POLITY) return [];
  return [
    ...state.offers.filter((offer) => offer.to === me).map((offer) => proposalDraft(state, sight, offer)),
    ...peaceOffers(state).map((from) => peaceDraft(state, sight, from, now)),
  ];
}

/**
 * The notifications for `events`, which led to `state`.
 *
 * @param sight the player's sight in `state`, or null for the observer.
 * @param now the state at the time a text is drawn; `state` by default.
 */
export function noteDrafts(
  state: GameState,
  events: readonly GameEvent[],
  sight: Sight | null,
  now: () => GameState = () => state,
): NoteDraft[] {
  const { map: m } = state;
  const me = state.player;
  const all = me === NO_POLITY;
  const siteOf = (zone: number): number => m.zones[zone]?.siteHex ?? -1;
  const capitalHex = (polity: number): number => {
    const zone = state.polities[polity]?.capital ?? -1;
    return siteOf(zone >= 0 ? zone : (m.polities[polity]?.capitalZone ?? -1));
  };
  const drafts: NoteDraft[] = [];
  const add = (text: () => string, hex: number, offer: NoteOffer | null = null, settles: readonly number[] = []): void => {
    drafts.push({ text, hex: canPoint(state, sight, hex) ? hex : -1, offer, settles });
  };

  /** Gold given to the player, by giver: a rich neighbour gives several times in one turn. */
  const gifts = new Map<number, number>();

  for (const event of events) {
    switch (event.type) {
      case 'goldGifted':
        if (event.to === me) gifts.set(event.from, (gifts.get(event.from) ?? 0) + event.amount);
        break;
      case 'warDeclared':
        if (all || event.by === me || event.on === me) {
          add(() => t('note.war', { a: polityName(m, event.by), b: polityName(m, event.on) }), capitalHex(event.on));
        }
        break;
      case 'peaceMade':
        if (all || event.a === me || event.b === me) {
          add(
            () => t('note.peace', { a: polityName(m, event.a), b: polityName(m, event.b) }),
            capitalHex(event.a === me ? event.b : event.a),
            null,
            [event.a, event.b],
          );
        }
        break;
      case 'peaceOffered':
        if (event.to === me) drafts.push(peaceDraft(state, sight, event.from, now));
        break;
      case 'cityCaptured':
        // a city that falls in the player's sight is news to them, whoever fought over it
        if (all || event.from === me || event.to === me || inSight(sight, siteOf(event.city))) {
          add(() => t('note.captured', { a: polityName(m, event.to), city: cityName(m, event.city) }), siteOf(event.city));
        }
        break;
      case 'polityAnnexed':
        if (all || event.by === me || event.polity === me) {
          add(() => t('note.annexed', { a: polityName(m, event.by), b: polityName(m, event.polity) }), capitalHex(event.by));
        }
        break;
      case 'cityFounded':
        if (event.owner === me) add(() => t('note.founded', { city: cityName(m, event.city) }), siteOf(event.city));
        break;
      case 'cityPopulation':
        if (state.cities[event.city]?.owner === me) {
          add(() => t('note.grew', { city: cityName(m, event.city), pop: event.pop }), siteOf(event.city));
        }
        break;
      case 'cityBuilt':
        if (state.cities[event.city]?.owner === me) {
          add(() => t('note.built', { city: cityName(m, event.city), item: itemName(m, event.item, me) }), siteOf(event.city));
        }
        break;
      case 'unitKilled':
        if (event.owner === me) add(() => t('note.lost', { unit: unitName(event.unitType) }), event.hex);
        break;
      case 'researchFinished':
        if (event.polity === me) add(() => t('note.research', { tech: techName(event.tech) }), -1);
        break;
      case 'projectStageFinished':
        if (all || event.polity === me) {
          add(
            () => t('note.stage', { a: polityName(m, event.polity), name: t('project.tiangong'), stage: event.stage }),
            siteOf(event.city),
          );
        }
        break;
      case 'warJoined':
        if (all || event.polity === me || event.against === me) {
          add(
            () =>
              t('event.warJoined', {
                polity: polityName(m, event.polity),
                with: polityName(m, event.with),
                against: polityName(m, event.against),
              }),
            capitalHex(event.polity === me ? event.against : event.polity),
          );
        }
        break;
      case 'vassalized':
        if (all || event.vassal === me || event.overlord === me) {
          add(
            () => t('event.vassalized', { vassal: polityName(m, event.vassal), overlord: polityName(m, event.overlord) }),
            capitalHex(event.vassal),
          );
        }
        break;
      case 'agreementSigned':
        if (event.agreement !== 'vassalage' && (event.a === me || event.b === me)) {
          add(
            () =>
              t('event.agreementSigned', {
                a: polityName(m, event.a),
                b: polityName(m, event.b),
                agreement: t(`agreement.${event.agreement}`),
              }),
            capitalHex(event.a === me ? event.b : event.a),
          );
        }
        break;
      case 'agreementEnded':
        if (event.a === me || event.b === me) {
          add(
            () =>
              t('event.agreementEnded', {
                a: polityName(m, event.a),
                b: polityName(m, event.b),
                agreement: t(`agreement.${event.agreement}`),
                reason: t(`endReason.${event.reason}`),
              }),
            capitalHex(event.a === me ? event.b : event.a),
          );
        }
        break;
      case 'eraStarted':
        add(() => t('note.era', { era: eraName(event.era) }), -1);
        break;
      case 'offerMade':
        if (event.offer.to === me) drafts.push(proposalDraft(state, sight, event.offer));
        break;
      case 'vassalReleased':
        if (event.vassal === me || event.overlord === me) {
          add(
            () =>
              t('event.vassalReleased', {
                vassal: polityName(m, event.vassal),
                overlord: polityName(m, event.overlord),
                reason: t(`endReason.${event.reason}`),
              }),
            capitalHex(event.vassal === me ? event.overlord : event.vassal),
          );
        }
        break;
      case 'dealSigned': {
        const { deal } = event;
        if (deal.seller !== me && deal.buyer !== me) break;
        add(
          () =>
            t('event.dealSigned', {
              seller: polityName(m, deal.seller),
              buyer: polityName(m, deal.buyer),
              resource: resourceName(m, deal.resource),
              gold: deal.goldPerTurn,
            }),
          capitalHex(deal.seller === me ? deal.buyer : deal.seller),
        );
        break;
      }
      case 'dealEnded':
        if (event.seller === me || event.buyer === me) {
          add(
            () =>
              t('event.dealEnded', {
                seller: polityName(m, event.seller),
                buyer: polityName(m, event.buyer),
                resource: resourceName(m, event.resource),
                reason: t(`endReason.${event.reason}`),
              }),
            capitalHex(event.seller === me ? event.buyer : event.seller),
          );
        }
        break;
      case 'routeEnded':
        if (event.owner === me && event.reason !== 'cancelled') {
          add(() => t('event.routeEnded', { owner: polityName(m, event.owner), reason: t(`endReason.${event.reason}`) }), -1);
        }
        break;
      case 'routePillaged':
        if (event.owner === me || event.by === me) {
          add(
            () => t('event.routePillaged', { by: polityName(m, event.by), owner: polityName(m, event.owner), gold: event.gold }),
            event.hex,
          );
        }
        break;
      case 'improvementPillaged':
        if (event.owner === me || event.by === me) {
          add(
            () =>
              t('event.improvementPillaged', {
                by: polityName(m, event.by),
                owner: polityName(m, event.owner),
                gold: event.gold,
              }),
            event.hex,
          );
        }
        break;
      case 'suzerainChanged':
        if (all || event.from === me || event.to === me) {
          add(
            () => t('event.suzerainChanged', { cityState: polityName(m, event.cityState), to: polityName(m, event.to) }),
            capitalHex(event.cityState),
          );
        }
        break;
      default:
        break;
    }
  }
  for (const [from, amount] of gifts) {
    add(() => t('event.goldGifted', { from: polityName(m, from), to: polityName(m, me), amount }), capitalHex(from));
  }
  return drafts;
}
