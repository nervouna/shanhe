/** The full-screen overlays: the tech tree, the policy cards, the list of polities and the victory progress. */

import { ERAS, POLICIES, POLICY_IDS } from '../core/data.ts';
import type { PolicyId, PolicyKind, TechId } from '../core/data.ts';
import { NO_POLITY, nextPolicyCost } from '../core/game.ts';
import { dictionaries, getLanguage, t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import { standingWith } from './diplomacy.ts';
import type { Standing } from './diplomacy.ts';
import { button, el, iconOnly, stat } from './dom.ts';
import {
  buildingName,
  eraName,
  improvementName,
  policyEffect,
  policyName,
  polityName,
  rejectText,
  resourceName,
  techName,
  unitName,
  yieldName,
} from './names.ts';
import { balanceRows } from './balance.ts';
import { POLITY_SORTS, check, polityRows, politySummary, sortPolityRows, victoryView } from './rules.ts';
import type { PolitySort, VictoryLine } from './rules.ts';
import { layoutTechTree, techUnlocks, techViews } from './techTree.ts';
import type { TechUnlock } from './techTree.ts';
import { cssColor, signed } from './view.ts';
import type { View } from './view.ts';

export type OverlayKind = 'tech' | 'policy' | 'polities' | 'victory';

export function standingName(standing: Standing): string {
  const key: TranslationKey = `standing.${standing}`;
  return t(key);
}

function sheet(id: string, title: string, view: View, extra: (Node | null)[], body: Node): HTMLElement {
  return el(
    'div',
    { class: 'panel sheet', id },
    el(
      'header',
      {},
      el('h1', { text: title }),
      el('div', { class: 'stats' }, ...extra),
      iconOnly('close', t('menu.close'), () => {
        view.closeOverlay();
      }, { class: 'close', id: 'overlay-close' }),
    ),
    body,
  );
}

// ------------------------------------------------------------------- techs

/** Size of a node of the tree and the space between nodes, in CSS pixels at scale 1. */
const NODE = { width: 150, height: 66, gapX: 44, gapY: 10, top: 26 } as const;

function unlockText(view: View, unlock: TechUnlock): string {
  switch (unlock.kind) {
    case 'unit':
      return unitName(unlock.unit);
    case 'building':
      return buildingName(unlock.building);
    case 'improvement':
      return improvementName(unlock.improvement);
    case 'road': {
      const key = `road.${unlock.road}`;
      return Object.hasOwn(dictionaries.zh, key) ? t(key as TranslationKey) : unlock.road;
    }
    case 'resource':
      return t('unlock.resource', { name: resourceName(view.map, unlock.resource) });
    default: {
      const key: TranslationKey = `unlock.${unlock.kind}`;
      return t(key);
    }
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/** The tech tree: eras as columns, prerequisites as lines; a click sets the research and closes the overlay. */
export function techOverlay(view: View): HTMLElement {
  const { state, player } = view;
  const layout = layoutTechTree();
  const views = techViews(state, player);
  const x = (era: number): number => era * (NODE.width + NODE.gapX);
  const y = (row: number): number => NODE.top + row * (NODE.height + NODE.gapY);
  const width = x(layout.columns - 1) + NODE.width;
  const height = y(layout.rows - 1) + NODE.height;
  const position = new Map(layout.nodes.map((node) => [node.tech, node]));
  const separator = getLanguage() === 'zh' ? '、' : ', ';
  // the tree is the player's own: their nation's unique items stand in it, nobody else's
  const nation = view.map.polities[player]?.id ?? '';

  const lines = document.createElementNS(SVG, 'svg');
  lines.setAttribute('class', 'tree-lines');
  lines.setAttribute('viewBox', `0 0 ${width} ${height}`);
  lines.setAttribute('width', String(width));
  lines.setAttribute('height', String(height));
  for (const edge of layout.edges) {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const x1 = x(from.era) + NODE.width;
    const y1 = y(from.row) + NODE.height / 2;
    const x2 = x(to.era);
    const y2 = y(to.row) + NODE.height / 2;
    const bend = (x2 - x1) / 2;
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`);
    path.dataset.from = edge.from;
    path.dataset.to = edge.to;
    if (views.get(edge.from)?.status === 'known') path.setAttribute('class', 'known');
    lines.append(path);
  }

  const tree = el('div', { class: 'tree', id: 'tech-tree' });
  tree.style.width = `${width}px`;
  tree.style.height = `${height}px`;
  tree.append(lines);
  ERAS.forEach((_, era) => {
    const heading = el('div', { class: 'tree-era', text: eraName(era) });
    heading.style.left = `${x(era)}px`;
    heading.style.width = `${NODE.width}px`;
    tree.append(heading);
  });
  for (const node of layout.nodes) {
    const tech: TechId = node.tech;
    const info = views.get(tech);
    if (info === undefined) continue;
    const unlocked = techUnlocks(tech, nation);
    const unlocks = unlocked.map((unlock) => unlockText(view, unlock)).join(separator);
    const gains = el('span', { class: 'tech-unlocks', title: unlocks });
    unlocked.forEach((unlock, index) => {
      if (index > 0) gains.append(separator);
      const unique = 'unique' in unlock && unlock.unique;
      gains.append(unique ? el('span', { class: 'unique', text: unlockText(view, unlock), data: { unique: unlock.kind } }) : unlockText(view, unlock));
    });
    const meta = t('tech.cost', { cost: info.cost }) + (info.turns === null ? '' : ` · ${t('count.turns', { turns: info.turns })}`);
    const chosen = info.status === 'open' || info.status === 'current';
    const item = el(
      'button',
      {
        class: 'tech',
        data: { tech, status: info.status },
        disabled: !chosen || view.busy,
        ...(info.reason === null ? {} : { title: rejectText(info.reason) }),
        onClick: () => {
          if (info.status === 'open' && !view.act({ type: 'setResearch', polity: player, tech })) {
            view.refresh();
            return;
          }
          view.closeOverlay();
        },
      },
      el('span', { class: 'tech-name', text: techName(tech) }),
      info.status !== 'known' && el('span', { class: 'tech-meta', text: meta }),
      gains,
    );
    item.style.left = `${x(node.era)}px`;
    item.style.top = `${y(node.row)}px`;
    item.style.width = `${NODE.width}px`;
    item.style.height = `${NODE.height}px`;
    tree.append(item);
  }
  const science = politySummary(state, player).yields.science;
  return sheet(
    'tech-overlay',
    t('hud.research'),
    view,
    [stat('science', yieldName('science'), signed(science), 'tech-science')],
    el('div', { class: 'scroll sheet-body' }, tree),
  );
}

// ----------------------------------------------------------------- policies

const POLICY_KINDS: readonly PolicyKind[] = ['economy', 'military', 'civil', 'diplomacy'];

export interface PolicyOverlayState {
  /** The unlocked card waiting to be put into a slot, or null. */
  picked: PolicyId | null;
}

/**
 * The policy cards: the slots on top, then every card by era and kind. A
 * click unlocks a card that can be unlocked, and puts an unlocked one into
 * the first empty slot; with every slot full it picks the card up, and a
 * click on a slot swaps it in.
 */
export function policyOverlay(view: View, local: PolicyOverlayState): HTMLElement {
  const { state, player } = view;
  const self = state.polities[player];
  if (self === undefined) return el('div');
  const cost = nextPolicyCost(state, player);
  if (local.picked !== null && (!self.policies.includes(local.picked) || self.slots.includes(local.picked))) {
    local.picked = null;
  }
  const picked = local.picked;

  const slots = el(
    'div',
    { id: 'policy-slots' },
    ...self.slots.map((card, slot) => {
      const reason = picked === null ? null : check(state, { type: 'slotPolicy', polity: player, policy: picked, slot });
      const place = el(
        'button',
        {
          class: `policy-slot${card === null ? ' empty' : ''}`,
          data: { slot, card: card ?? '' },
          disabled: picked === null || reason !== null || view.busy,
          onClick: () => {
            if (picked === null) return;
            if (view.act({ type: 'slotPolicy', polity: player, policy: picked, slot })) local.picked = null;
            view.refresh();
          },
        },
        el('span', { class: 'card-name', text: card === null ? t('policy.empty') : policyName(card) }),
        card !== null && el('span', { class: 'card-effect', text: policyEffect(card) }),
        picked !== null && reason !== null && el('span', { class: 'reason', text: rejectText(reason) }),
      );
      // a card can be taken out again: the slot then stays empty until the player fills it
      const empty = { type: 'slotPolicy', polity: player, policy: null, slot } as const;
      return el(
        'div',
        { class: 'slot-wrap' },
        place,
        card !== null &&
          iconOnly('close', t('policy.clear'), () => {
            view.act(empty);
            view.refresh();
          }, { class: 'slot-clear', data: { clear: slot }, disabled: view.busy || check(state, empty) !== null }),
      );
    }),
  );

  const grid = el('div', { id: 'policy-cards' });
  grid.append(el('span'));
  ERAS.forEach((_, era) => grid.append(el('div', { class: 'tree-era', text: eraName(era) })));
  for (const kind of POLICY_KINDS) {
    const kindKey: TranslationKey = `policyKind.${kind}`;
    grid.append(el('div', { class: 'card-kind', text: t(kindKey) }));
    ERAS.forEach((_, era) => {
      const card = POLICY_IDS.find((id) => POLICIES[id].era === era && POLICIES[id].kind === kind);
      if (card === undefined) {
        grid.append(el('span'));
        return;
      }
      const slotted = self.slots.includes(card);
      const unlocked = self.policies.includes(card);
      const reason = unlocked ? null : check(state, { type: 'unlockPolicy', polity: player, policy: card });
      const status = slotted ? 'slotted' : unlocked ? 'unlocked' : reason === null ? 'open' : 'locked';
      const empty = self.slots.indexOf(null);
      grid.append(
        el(
          'button',
          {
            class: `policy-card${picked === card ? ' active' : ''}`,
            data: { policy: card, status },
            disabled: slotted || status === 'locked' || view.busy,
            ...(reason === null ? {} : { title: rejectText(reason) }),
            onClick: () => {
              if (status === 'open') view.act({ type: 'unlockPolicy', polity: player, policy: card });
              else if (status === 'unlocked' && empty >= 0) {
                view.act({ type: 'slotPolicy', polity: player, policy: card, slot: empty });
              } else if (status === 'unlocked') local.picked = picked === card ? null : card;
              view.refresh();
            },
          },
          el('span', { class: 'card-name', text: policyName(card) }),
          el('span', { class: 'card-effect', text: policyEffect(card) }),
          !unlocked && reason !== 'eraTooEarly' && el('span', { class: 'card-cost', text: t('policy.cost', { cost }) }),
        ),
      );
    });
  }

  const swaps =
    self.freeSwaps > 0
      ? t('policy.freeSwaps', { count: self.freeSwaps })
      : state.turn < self.swapReadyOn
        ? t('policy.cooldown', { turn: self.swapReadyOn })
        : '';
  return sheet(
    'policy-overlay',
    t('hud.policy'),
    view,
    [
      stat('culture', yieldName('culture'), `${Math.floor(self.cultureProgress)}/${cost}`, 'policy-culture'),
      swaps === '' ? null : el('span', { class: 'stat', id: 'policy-swaps', text: swaps }),
    ],
    el('div', { class: 'scroll sheet-body' }, slots, grid),
  );
}

// ----------------------------------------------------------------- polities

export interface PolitiesOverlayState {
  sort: PolitySort;
  descending: boolean;
}

/** Every living polity with its relation to the player, sortable by favour, strength and distance. */
export function politiesOverlay(view: View, local: PolitiesOverlayState): HTMLElement {
  const { state, map, player } = view;
  const rows = sortPolityRows(polityRows(state, player), local.sort, local.descending);
  const heading = (sort: PolitySort): HTMLElement => {
    const key: TranslationKey = `polities.${sort}`;
    const active = local.sort === sort;
    return el(
      'th',
      {},
      button(`${t(key)}${active ? (local.descending ? ' ↓' : ' ↑') : ''}`, () => {
        if (active) local.descending = !local.descending;
        else {
          local.sort = sort;
          // the nearest first, but the friendliest and the strongest first
          local.descending = sort !== 'distance';
        }
        view.refresh();
      }, { class: active ? 'active' : '', data: { sort } }),
    );
  };
  const table = el(
    'table',
    { id: 'polities', class: 'list', data: { sort: local.sort, descending: Number(local.descending) } },
    el(
      'thead',
      {},
      el('tr', {}, el('th', { text: t('end.nation') }), el('th', { text: t('polities.relation') }), ...POLITY_SORTS.map(heading)),
    ),
    el(
      'tbody',
      {},
      ...rows.map((row) => {
        const entry = map.polities[row.polity];
        const standing = player === NO_POLITY ? null : standingWith(state, player, row.polity);
        // a button, so that the row can be opened from the keyboard; its click is the row's
        const name = el('button', { class: 'swatch row-open', text: polityName(map, row.polity) });
        name.style.setProperty('--nation', cssColor(entry?.color ?? 0x888888));
        const kind = entry?.kind === 'cityState' ? ` · ${t('polity.cityState')}` : '';
        return el(
          'tr',
          {
            data: { polity: row.polity, standing: standing ?? '' },
            onClick: () => {
              view.closeOverlay();
              view.openPolity(row.polity);
            },
          },
          el('td', {}, name, kind),
          el('td', { class: 'standing', text: standing === null ? '' : standingName(standing) }),
          el('td', { text: row.favour === null ? '—' : signed(row.favour) }),
          el('td', { text: String(row.strength) }),
          el('td', { text: row.distance === null ? '—' : String(row.distance) }),
        );
      }),
    ),
  );
  return sheet('polities-overlay', t('hud.polities'), view, [], el('div', { class: 'scroll sheet-body' }, table));
}

// ------------------------------------------------------------------ victory

function victoryValue(line: VictoryLine, value: number): string {
  if (line.kind === 'conquest') return t('victory.capitals', { count: value, needed: line.needed ?? 0 });
  if (line.kind === 'science') return t('victory.stages', { count: value, needed: line.needed ?? 0 });
  return t('victory.income', { income: Math.round(value) });
}

/** For each of the three victories: who leads and with what, and the player's own standing. */
export function victoryOverlay(view: View): HTMLElement {
  const { state, map, player } = view;
  const progress = victoryView(state);
  const playing = player !== NO_POLITY;
  const table = el(
    'table',
    { id: 'victory', class: 'list' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { text: '' }),
        el('th', { text: t('victory.leader') }),
        el('th', { text: '' }),
        playing && el('th', { text: t('victory.you') }),
      ),
    ),
    el(
      'tbody',
      {},
      ...progress.lines.map((line) => {
        const key: TranslationKey = `victory.${line.kind}`;
        const leader = el('span', { class: 'swatch', text: polityName(map, line.leader) });
        leader.style.setProperty('--nation', cssColor(map.polities[line.leader]?.color ?? 0x888888));
        return el(
          'tr',
          { class: line.leader === player ? 'mine' : '', data: { victory: line.kind, leader: line.leader } },
          el('td', { class: 'title', text: t(key) }),
          el('td', {}, leader),
          el('td', { text: victoryValue(line, line.leaderValue) }),
          playing && el('td', { text: line.playerValue === null ? '—' : victoryValue(line, line.playerValue) }),
        );
      }),
    ),
  );
  // the balance of power: who is feared for a lead, and on which of the three tracks
  const balance = el(
    'table',
    { id: 'balance', class: 'list' },
    el(
      'thead',
      {},
      el('tr', {}, el('th', { text: t('balance.title') }), el('th', { text: t('balance.lead') }), el('th', { text: t('balance.fear') })),
    ),
    el(
      'tbody',
      {},
      ...balanceRows(state).map((row) => {
        const nation = el('span', { class: 'swatch', text: polityName(map, row.polity) });
        nation.style.setProperty('--nation', cssColor(map.polities[row.polity]?.color ?? 0x888888));
        return el(
          'tr',
          { class: row.polity === player ? 'mine' : '', data: { polity: row.polity, fear: row.fear, lead: row.lead ?? '' } },
          el('td', {}, nation),
          el('td', { text: row.leadName ?? '—' }),
          el('td', { text: String(row.fear) }),
        );
      }),
    ),
  );
  balance.style.marginTop = 'var(--s5)';
  return sheet(
    'victory-overlay',
    t('hud.victory'),
    view,
    [el('span', { class: 'stat', id: 'victory-turns', text: t('victory.turnsLeft', { turns: progress.turnsLeft }) })],
    el('div', { class: 'scroll sheet-body' }, table, balance),
  );
}
