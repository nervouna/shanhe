/** A small helper for building DOM trees. Text always goes in as text, never as markup. */

import { icon } from './icons.ts';
import type { IconName } from './icons.ts';

export interface ElementProps {
  readonly id?: string;
  readonly class?: string;
  readonly text?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  /** `data-*` attributes. */
  readonly data?: Readonly<Record<string, string | number>>;
  /** The name of a control that shows no text of its own (`aria-label`). */
  readonly label?: string;
  /** For a button that is on or off (`aria-pressed`). */
  readonly pressed?: boolean;
  readonly onClick?: (event: MouseEvent) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.id !== undefined) node.id = props.id;
  if (props.class !== undefined && props.class !== '') node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title !== undefined) node.title = props.title;
  if (props.disabled === true && node instanceof HTMLButtonElement) node.disabled = true;
  if (node instanceof HTMLButtonElement) node.type = 'button';
  if (props.label !== undefined) node.setAttribute('aria-label', props.label);
  if (props.pressed !== undefined) node.setAttribute('aria-pressed', String(props.pressed));
  for (const [name, value] of Object.entries(props.data ?? {})) node.dataset[name] = String(value);
  if (props.onClick !== undefined) (node as HTMLElement).addEventListener('click', props.onClick);
  for (const child of children) {
    if (child !== null && child !== false) node.append(child);
  }
  return node;
}

type ButtonProps = Omit<ElementProps, 'text' | 'onClick'>;

export function button(text: string, onClick: () => void, props: ButtonProps = {}): HTMLButtonElement {
  return el('button', { ...props, text, onClick });
}

/** A button with an icon in front of its text. */
export function iconButton(name: IconName, text: string, onClick: () => void, props: ButtonProps = {}): HTMLButtonElement {
  return el('button', { ...props, onClick }, icon(name), el('span', { class: 'label', text }));
}

/** A button that shows an icon alone; `label` names it for the tooltip and for assistive technology. */
export function iconOnly(name: IconName, label: string, onClick: () => void, props: ButtonProps = {}): HTMLButtonElement {
  return el('button', { ...props, class: `icon-only${props.class === undefined ? '' : ` ${props.class}`}`, title: label, label, onClick }, icon(name));
}

/** A number with the icon of what it counts; `label` says what that is. */
export function stat(name: IconName, label: string, value: string, id?: string): HTMLElement {
  return el(
    'span',
    { class: 'stat', title: label, label: `${label} ${value}`, ...(id === undefined ? {} : { id }) },
    icon(name),
    el('span', { class: 'stat-value', text: value }),
  );
}

/** Replaces everything inside `parent`. */
export function fill(parent: HTMLElement, ...children: (Node | string | null | false)[]): void {
  parent.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== false));
}

const signatures = new WeakMap<HTMLElement, string>();

/**
 * Replaces everything inside `parent` only if `signature` differs from the
 * one of the last call: what did not change keeps its nodes, so a button
 * under the pointer is still the same button after a redraw.
 */
export function fillWhen(parent: HTMLElement, signature: string, build: () => (Node | string | null | false)[]): void {
  if (signatures.get(parent) === signature) return;
  signatures.set(parent, signature);
  fill(parent, ...build());
}
