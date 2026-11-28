/** A nation's kit drawn in DOM: at nation select, as the player's own kit view and in another nation's panel. */

import { t } from '../shared/i18n.ts';
import { el } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import type { KitView } from './kit.ts';
import { eraName, techName } from './names.ts';

/** The difficulty rating: four pips, as many filled as the nation is hard, with its name. */
export function difficultyMark(view: Pick<KitView, 'difficulty' | 'difficultyLevel' | 'difficultyName'>): HTMLElement {
  const pips = el('span', { class: 'pips' });
  for (let level = 1; level <= 4; level++) pips.append(el('span', { class: level <= view.difficultyLevel ? 'pip on' : 'pip' }));
  return el(
    'span',
    { class: 'difficulty', title: `${t('kit.difficulty')} · ${view.difficultyName}`, data: { difficulty: view.difficulty } },
    pips,
    el('span', { class: 'difficulty-name', text: view.difficultyName }),
  );
}

function row(name: IconName, label: string, id: string, ...content: (Node | string | null | false)[]): HTMLElement {
  return el(
    'div',
    { class: 'kit-row', data: { kit: id } },
    el('div', { class: 'kit-label' }, icon(name), el('span', { text: label })),
    el('div', { class: 'kit-body' }, ...content),
  );
}

/**
 * The five parts of a kit, one row each: trait, leader, unique unit, unique
 * building and specialty.
 *
 * @param personality true to say how the leader plays: for a nation the player meets, not for their own.
 */
export function kitRows(view: KitView, personality: boolean): HTMLElement {
  const piece = el('span', { class: 'piece small unique', text: view.unit.piece, title: view.unit.name });
  return el(
    'div',
    { class: 'kit', data: { nation: view.nation } },
    row(
      'trait',
      t('kit.trait'),
      'trait',
      el('div', { class: 'kit-name', text: view.trait.name }),
      el('div', { class: 'kit-effect', text: view.trait.effect }),
    ),
    row(
      'leader',
      t('kit.leader'),
      'leader',
      el(
        'div',
        { class: 'kit-name' },
        view.leader.name,
        el('span', { class: 'kit-aside', text: view.leader.archetype }),
        personality && el('span', { class: 'tag', text: view.leader.personalityName, data: { personality: view.leader.personality } }),
      ),
      el('div', { class: 'kit-effect', text: view.leader.effect }),
    ),
    row(
      'unit',
      t('kit.unit'),
      'unit',
      el(
        'div',
        { class: 'kit-name with-piece' },
        piece,
        view.unit.name,
        el('span', { class: 'kit-aside', text: `${eraName(view.unit.era)} · ${view.unit.className}` }),
      ),
    ),
    row(
      'building',
      view.building.kindName,
      'building',
      el(
        'div',
        { class: 'kit-name' },
        view.building.name,
        view.building.tech !== null && el('span', { class: 'kit-aside', text: techName(view.building.tech) }),
      ),
    ),
    row('specialty', t('kit.specialty'), 'specialty', el('div', { class: 'kit-name', text: view.specialty.name })),
  );
}
