/** The panel of another polity: how it stands to the player, what is agreed, and everything the player can propose. */

import { CITY_STATE } from '../core/data.ts';
import { NO_POLITY } from '../core/game.ts';
import type { Offer } from '../core/game.ts';
import { favourStanding } from '../core/query.ts';
import type { FavourCause } from '../core/query.ts';
import { t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import { agreementsBetween, controlReasonText, dealsBetween, diplomaticControls, offersFrom } from './diplomacy.ts';
import type { DiplomaticControl } from './diplomacy.ts';
import { button, el } from './dom.ts';
import { agreementName, polityName, resourceName } from './names.ts';
import { peaceOffers } from './pending.ts';
import { relationView } from './rules.ts';
import { cssColor, signed } from './view.ts';
import type { View } from './view.ts';

/** What a proposal asks for, as a phrase that follows the proposer's name. */
export function offerText(map: MapData, offer: Readonly<Offer>): string {
  if (offer.type === 'agreement') {
    return offer.agreement === 'vassalage' ? t('offer.vassalage') : agreementName(offer.agreement);
  }
  const values = { resource: resourceName(map, offer.resource), gold: offer.goldPerTurn };
  return offer.seller === offer.from ? t('offer.sell', values) : t('offer.buy', values);
}

function causeName(cause: FavourCause): string {
  if (cause === 'border' || cause === 'war' || cause === 'sharedEnemy' || cause === 'deal' || cause === 'route') {
    const key: TranslationKey = `cause.${cause}`;
    return t(key);
  }
  return agreementName(cause);
}

function controlLabel(map: MapData, control: DiplomaticControl): string {
  switch (control.kind) {
    case 'declareWar':
      return t('polity.declareWar');
    case 'makePeace':
      return t('polity.makePeace');
    case 'propose':
      return t('diplomacy.propose', { agreement: agreementName(control.agreement) });
    case 'cancel':
      return t('diplomacy.cancel', { agreement: agreementName(control.agreement) });
    case 'gift':
      return t('diplomacy.gift', { amount: control.amount });
    case 'deal':
      return t(control.buying ? 'diplomacy.buy' : 'diplomacy.sell', {
        resource: resourceName(map, control.resource),
        gold: control.goldPerTurn,
      });
    case 'cancelDeal':
      return t('diplomacy.cancelDeal', { resource: resourceName(map, control.deal.resource) });
  }
}

function term(until: number): string {
  return until > 0 ? t('term.until', { turn: until }) : t('term.open');
}

function section(id: string, title: string, rows: HTMLElement[]): HTMLElement | null {
  return rows.length === 0 ? null : el('section', { id }, el('h3', { text: title }), ...rows);
}

/** The children of the polity panel for `polity`, or null if there is no such polity. */
export function polityPanel(view: View, polity: number, onClose: () => void): HTMLElement[] | null {
  const { state, map, player: me } = view;
  const entry = map.polities[polity];
  const self = state.polities[polity];
  if (entry === undefined || self === undefined) return null;

  const title = el('h2', { id: 'polity-name', text: polityName(map, polity) });
  title.style.borderColor = cssColor(entry.color);
  const header = el('header', {}, title, button('×', onClose, { class: 'close', id: 'polity-close' }));
  const kind =
    entry.kind === 'cityState' ? t('polity.cityState') : state.majors.includes(polity) ? t('polity.major') : t('polity.nation');
  const cities = state.cities.filter((city) => city !== null && city.owner === polity).length;
  const body = el(
    'div',
    { class: 'scroll' },
    el('div', { class: 'line' }, el('span', { text: kind }), el('span', { text: t('polity.cities', { count: cities }) })),
  );

  const playing = me !== NO_POLITY && self.alive && state.polities[me]?.alive === true;
  if (playing) {
    const relation = relationView(state, me, polity);
    const text =
      relation.kind === 'war'
        ? t('relation.war', { turn: relation.since })
        : relation.kind === 'truce'
          ? t('relation.truce', { turn: relation.until })
          : t('relation.peace');
    body.append(el('div', { class: 'line', id: 'polity-relation', data: { relation: relation.kind }, text }));
  }

  if (self.cityStateType !== null) {
    const typeKey: TranslationKey = `cityState.${self.cityStateType}`;
    const bonusKey: TranslationKey = `cityState.bonus.${self.cityStateType}`;
    const influence = Object.entries(self.influence)
      .map(([key, value]) => ({ polity: Number(key), value }))
      .sort((a, b) => b.value - a.value || a.polity - b.polity);
    body.append(
      el(
        'section',
        { id: 'citystate', data: { type: self.cityStateType, suzerain: self.suzerain } },
        el('div', { class: 'line' }, el('span', { class: 'title', id: 'citystate-type', text: t(typeKey) }), el('span', { id: 'citystate-bonus', text: t(bonusKey) })),
        el('div', {
          class: 'line',
          id: 'citystate-suzerain',
          text: self.suzerain === NO_POLITY ? t('cityState.noSuzerain') : t('cityState.suzerain', { name: polityName(map, self.suzerain) }),
        }),
      ),
    );
    const rows = influence.map((item) =>
      el(
        'li',
        { class: item.polity === self.suzerain ? 'lead' : '', data: { polity: item.polity } },
        el('span', { class: 'option-name', text: polityName(map, item.polity) }),
        el('span', { class: 'option-cost', text: `${item.value} / ${CITY_STATE.suzerainInfluence}` }),
      ),
    );
    const list = section('citystate-influence', t('cityState.influence'), rows.length === 0 ? [] : [el('ul', { class: 'facts-list' }, ...rows)]);
    if (list !== null) body.append(list);
  }

  if (playing) {
    const standing = favourStanding(state, me, polity);
    if (standing !== null) {
      body.append(
        el(
          'section',
          { id: 'polity-favour', data: { favour: standing.favour, target: standing.target } },
          el(
            'h3',
            {},
            t('polities.favour'),
            el('span', { class: 'favour-value', text: ` ${signed(standing.favour)} → ${signed(standing.target)}` }),
          ),
          el(
            'ul',
            { class: 'facts-list' },
            ...standing.terms.map((item) =>
              el(
                'li',
                { data: { cause: item.cause } },
                el('span', { class: 'option-name', text: causeName(item.cause) }),
                el('span', { class: 'option-cost', text: signed(item.value) }),
              ),
            ),
          ),
        ),
      );
    }

    const agreements = agreementsBetween(state, me, polity).map((agreement) =>
      el(
        'li',
        { data: { agreement: agreement.kind } },
        el('span', { class: 'option-name', text: agreementName(agreement.kind) }),
        el('span', { class: 'option-cost', text: term(agreement.until) }),
      ),
    );
    const deals = dealsBetween(state, me, polity).map((deal) =>
      el(
        'li',
        { data: { deal: deal.id } },
        el('span', {
          class: 'option-name',
          text: t(deal.buyer === me ? 'deal.buying' : 'deal.selling', {
            resource: resourceName(map, deal.resource),
            gold: deal.goldPerTurn,
          }),
        }),
        el('span', { class: 'option-cost', text: term(deal.until) }),
      ),
    );
    if (agreements.length + deals.length > 0) {
      body.append(el('ul', { class: 'facts-list', id: 'polity-agreements' }, ...agreements, ...deals));
    }

    const answer = (accept: boolean, onClick: () => void): HTMLButtonElement =>
      button(accept ? t('note.accept') : t('note.decline'), () => {
        onClick();
        view.refresh();
      }, { class: accept ? 'accent' : '', data: { answer: accept ? 'accept' : 'decline' }, disabled: view.busy });
    const offers = offersFrom(state, polity).map((offer) =>
      el(
        'div',
        { class: 'offer', data: { offer: offer.id } },
        el('span', { class: 'option-name', text: offerText(map, offer) }),
        answer(true, () => view.act({ type: 'respond', polity: me, offer: offer.id, accept: true })),
        answer(false, () => view.act({ type: 'respond', polity: me, offer: offer.id, accept: false })),
      ),
    );
    if (peaceOffers(state).includes(polity)) {
      offers.push(
        el(
          'div',
          { class: 'offer', data: { offer: 'peace' } },
          el('span', { class: 'option-name', text: t('polity.makePeace') }),
          answer(true, () => view.act({ type: 'makePeace', polity: me, target: polity })),
          answer(false, () => {
            view.declinePeace(polity);
          }),
        ),
      );
    }
    if (offers.length > 0) body.append(el('section', { id: 'polity-offers' }, ...offers));

    const controls = diplomaticControls(state, me, polity).map((control) => {
      const reason = controlReasonText(control);
      return el(
        'button',
        {
          class: `control${control.kind === 'declareWar' || control.kind === 'makePeace' ? ' accent' : ''}`,
          data: { control: control.id, action: control.kind, refused: control.reason ?? '' },
          disabled: control.reason !== null || view.busy,
          onClick: () => {
            view.act(control.action);
            view.refresh();
          },
        },
        el('span', { class: 'option-name', text: controlLabel(map, control) }),
        reason !== null && el('span', { class: 'reason', text: reason }),
      );
    });
    if (controls.length > 0) body.append(el('section', { id: 'polity-controls' }, ...controls));
  }
  return [header, body];
}
