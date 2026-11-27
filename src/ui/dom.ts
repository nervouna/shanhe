/** A small helper for building DOM trees. Text always goes in as text, never as markup. */

export interface ElementProps {
  readonly id?: string;
  readonly class?: string;
  readonly text?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  /** `data-*` attributes. */
  readonly data?: Readonly<Record<string, string | number>>;
  readonly onClick?: (event: MouseEvent) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.id !== undefined) node.id = props.id;
  if (props.class !== undefined) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title !== undefined) node.title = props.title;
  if (props.disabled === true && node instanceof HTMLButtonElement) node.disabled = true;
  if (node instanceof HTMLButtonElement) node.type = 'button';
  for (const [name, value] of Object.entries(props.data ?? {})) node.dataset[name] = String(value);
  if (props.onClick !== undefined) (node as HTMLElement).addEventListener('click', props.onClick);
  for (const child of children) {
    if (child !== null && child !== false) node.append(child);
  }
  return node;
}

export function button(text: string, onClick: () => void, props: Omit<ElementProps, 'text' | 'onClick'> = {}): HTMLButtonElement {
  return el('button', { ...props, text, onClick });
}

/** Replaces everything inside `parent`. */
export function fill(parent: HTMLElement, ...children: (Node | string | null | false)[]): void {
  parent.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== false));
}
