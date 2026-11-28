/** The trade part of the city panel: the route slots, the routes in force, and the picker of destinations. */

import type { GameState, RouteTarget, TradeRoute } from '../core/game.ts';
import { routeOptions, routeSlotsOf } from '../core/query.ts';
import type { RouteOption } from '../core/query.ts';
import { t } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import { button, el, iconOnly } from './dom.ts';
import { cityName, portName, rejectText } from './names.ts';
import { rankDestinations, targetKey } from './routes.ts';
import type { View } from './view.ts';

/** Destinations the picker shows: the best ones, so that the list stays readable on the real map. */
const MAX_DESTINATIONS = 12;

function targetName(map: MapData, to: RouteTarget): string {
  return to.kind === 'city' ? cityName(map, to.zone) : portName(map, to.port);
}

function routeTarget(route: Readonly<TradeRoute>): RouteTarget {
  return route.toCity >= 0 ? { kind: 'city', zone: route.toCity } : { kind: 'port', port: route.toPort };
}

export interface TradeSection {
  /** The section for the city in `zone`. */
  draw(view: View, zone: number): HTMLElement;
  /** The destination chosen in the picker, as a `data-route` key, or null. */
  readonly selected: string | null;
  /** Forgets the chosen destination and takes its path off the map. */
  clear(view: View): void;
}

export function createTradeSection(): TradeSection {
  /** Finding every destination's path takes a moment on the real map: once per state and city is enough. */
  const cache = new WeakMap<GameState, Map<number, RouteOption[]>>();
  let selected: { zone: number; key: string } | null = null;

  const optionsOf = (state: GameState, zone: number): RouteOption[] => {
    let perCity = cache.get(state);
    if (perCity === undefined) {
      perCity = new Map();
      cache.set(state, perCity);
    }
    let options = perCity.get(zone);
    if (options === undefined) {
      options = rankDestinations(routeOptions(state, zone));
      perCity.set(zone, options);
    }
    return options;
  };

  return {
    get selected() {
      return selected?.key ?? null;
    },
    clear(view) {
      if (selected === null) return;
      selected = null;
      view.previewPath(null);
    },
    draw(view, zone) {
      const { state, map, player: me } = view;
      const slots = routeSlotsOf(state, me);
      const ranked = optionsOf(state, zone);
      if (selected !== null && (selected.zone !== zone || !ranked.some((option) => targetKey(option.to) === selected?.key && option.reason === null))) {
        selected = null;
        view.previewPath(null);
      }

      const current = state.routes
        .filter((route) => route.owner === me)
        .map((route) =>
          el(
            'li',
            { data: { routeId: route.id, from: route.from } },
            el('span', {
              class: 'option-name',
              text: `${cityName(map, route.from)} → ${targetName(map, routeTarget(route))}`,
            }),
            route.pillagedUntil >= state.turn
              ? el('span', { class: 'status', text: t('trade.pillaged') })
              : el('span', { class: 'option-cost', text: t('trade.income', { gold: route.income }) }),
            iconOnly('close', t('trade.cancel'), () => {
              view.act({ type: 'cancelRoute', polity: me, route: route.id });
              view.refresh();
            }, { class: 'close', data: { cancelRoute: route.id }, disabled: view.busy }),
          ),
        );

      const picker = ranked.slice(0, MAX_DESTINATIONS).map((option) => {
        const key = targetKey(option.to);
        const active = selected?.key === key;
        const row = el(
          'button',
          {
            class: active ? 'option active' : 'option',
            data: { route: key, open: Number(option.reason === null), income: option.income },
            disabled: option.reason !== null || view.busy,
            onClick: () => {
              selected = active ? null : { zone, key };
              view.previewPath(active ? null : option.path);
              view.refresh();
            },
          },
          el('span', { class: 'option-name', text: targetName(map, option.to) }),
          option.reason !== null && el('span', { class: 'reason', text: rejectText(option.reason) }),
          option.path.length > 0 && el('span', { class: 'option-turns', text: option.sea ? t('trade.sea') : t('trade.land') }),
          option.path.length > 0 && el('span', { class: 'option-cost', text: t('trade.income', { gold: option.income }) }),
        );
        if (!active) return row;
        return el(
          'div',
          { class: 'option-row' },
          row,
          button(t('trade.open'), () => {
            if (view.act({ type: 'establishRoute', polity: me, city: zone, to: option.to })) {
              selected = null;
              view.previewPath(null);
            }
            view.refresh();
          }, { class: 'accent', id: 'trade-open', disabled: view.busy }),
        );
      });

      return el(
        'section',
        { id: 'city-trade' },
        el(
          'h3',
          {},
          t('city.trade'),
          el('span', { id: 'trade-slots', data: { used: slots.used, total: slots.total }, text: ` ${slots.used}/${slots.total}` }),
        ),
        current.length > 0 && el('ul', { class: 'facts-list', id: 'trade-routes' }, ...current),
        el('div', { id: 'trade-picker' }, ...picker),
      );
    },
  };
}
