/** The panel of another polity: how it stands to the player, what is agreed, and everything the player can propose. */

import { CITY_STATE } from '../core/data.ts';
import { NO_POLITY } from '../core/game.ts';
import type { GameState } from '../core/game.ts';
import { favourStanding, offerObstacle } from '../core/query.ts';
import { t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import {
  agreementsBetween,
  causeText,
  controlReasonText,
  dealsBetween,
  favourRows,
  knownAmbition,
  offerText,
  offersFrom,
  panelControls,
  peaceRow,
  peaceText,
  vassalRoomText,
} from './diplomacy.ts';
import type { DiplomaticControl } from './diplomacy.ts';
import { button, el, iconOnly } from './dom.ts';
import { kitViewOf } from './kit.ts';
import { kitRows } from './kitPanel.ts';
import { agreementName, polityName, rejectText, resourceName } from './names.ts';
import { relationView } from './rules.ts';
import { counted } from './text.ts';
import { cssColor, signed } from './view.ts';
import type { View } from './view.ts';

function controlLabel(state: GameState, control: DiplomaticControl): string {
  const { map } = state;
  switch (control.kind) {
    case 'declareWar':
      return t('polity.declareWar');
    case 'makePeace':
      // taking up the offer of a nation that submits is named for what it does
      return control.action.type === 'makePeace' ? peaceText(state, control.action.polity, control.action.target) : t('polity.makePeace');
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
  title.style.setProperty('--nation', cssColor(entry.color));
  const header = el('header', {}, title, iconOnly('close', t('menu.close'), onClose, { class: 'close', id: 'polity-close' }));
  const kit = kitViewOf(map, polity);
  const ambition = knownAmbition(state, me, polity);
  const kind =
    entry.kind === 'cityState' ? t('polity.cityState') : state.majors.includes(polity) ? t('polity.major') : t('polity.nation');
  const cities = state.cities.filter((city) => city !== null && city.owner === polity).length;
  const body = el(
    'div',
    { class: 'scroll' },
    el(
      'div',
      { class: 'line' },
      el('span', { text: kind }),
      el('span', { text: counted('polity.cities', cities, { count: cities }) }),
      // who leads it and how they play, where it has a leader
      kit !== null && el('span', { id: 'polity-leader', text: kit.leader.name }),
      kit !== null &&
        el('span', { class: 'tag', id: 'polity-personality', text: kit.leader.personalityName, data: { personality: kit.leader.personality } }),
      // what the leader is out for is theirs to tell: an ally or a vassal has told the player
      ambition !== null && el('span', { class: 'tag', id: 'polity-ambition', text: t(`ambition.${ambition}`), data: { ambition } }),
    ),
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
            ...favourRows(standing).map((item) =>
              el(
                'li',
                { data: item.polity === NO_POLITY ? { cause: item.cause } : { cause: item.cause, polity: item.polity } },
                el('span', { class: 'option-name', text: causeText(map, item) }),
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

    const answer = (accept: boolean, onClick: () => void, refused = false): HTMLButtonElement =>
      button(accept ? t('note.accept') : t('note.decline'), () => {
        onClick();
        view.refresh();
      }, { class: accept ? 'accent' : '', data: { answer: accept ? 'accept' : 'decline' }, disabled: view.busy || refused });
    const offers = offersFrom(state, polity).map((offer) => {
      // the rules take "accept" even when nothing can come of it: the button says so instead
      const obstacle = offerObstacle(state, offer.id);
      return el(
        'div',
        { class: 'offer', data: { offer: offer.id, refused: obstacle ?? '' } },
        el(
          'span',
          { class: 'option-name' },
          offerText(map, offer),
          obstacle !== null && el('span', { class: 'reason', text: rejectText(obstacle) }),
        ),
        answer(true, () => view.act({ type: 'respond', polity: me, offer: offer.id, accept: true }), obstacle !== null),
        answer(false, () => view.act({ type: 'respond', polity: me, offer: offer.id, accept: false })),
      );
    });
    // the offer of peace is answered here: while it waits, the controls below have no second button for it
    const peace = peaceRow(state, me, polity, view.declined);
    if (peace !== null) {
      offers.push(
        el(
          'div',
          { class: 'offer', data: { offer: 'peace', vassal: Number(peace.vassal), refused: peace.reason ?? '' } },
          el(
            'span',
            { class: 'option-name' },
            peaceText(state, me, polity),
            peace.reason !== null && el('span', { class: 'reason', text: rejectText(peace.reason) }),
          ),
          answer(true, () => view.act(peace.action), peace.reason !== null),
          answer(false, () => {
            view.declinePeace(polity);
          }),
        ),
      );
    }
    if (offers.length > 0) body.append(el('section', { id: 'polity-offers' }, ...offers));

    const controls = panelControls(state, me, polity, view.declined).map((control) => {
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
        el('span', { class: 'option-name', text: controlLabel(state, control) }),
        // a vassal takes one of the places the player's era allows
        control.kind === 'propose' && control.agreement === 'vassalage' &&
          el('span', { class: 'option-cost', id: 'vassal-room', text: vassalRoomText(state, me) }),
        reason !== null && el('span', { class: 'reason', text: reason }),
      );
    });
    if (controls.length > 0) body.append(el('section', { id: 'polity-controls' }, ...controls));
  }
  if (kit !== null) body.append(el('section', { id: 'polity-kit', data: { nation: kit.nation } }, kitRows(kit, false)));
  return [header, body];
}
