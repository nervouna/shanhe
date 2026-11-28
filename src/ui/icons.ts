/**
 * The interface's icons: line drawings on a 16 × 16 grid, built as inline
 * SVG. There are no image files; an icon is its path data, drawn with the
 * colour of the text around it.
 */

/** Path data of each icon: strokes only, nothing is filled. */
export const ICON_PATHS = {
  /** An ear of grain. */
  food: 'M8 14.5V4.5 M8 4.5C6.6 4 6 3 6 1.8C7.4 2.2 8 3.2 8 4.5Z M8 4.5C9.4 4 10 3 10 1.8C8.6 2.2 8 3.2 8 4.5Z M8 8C6 7.6 5 6.4 4.6 4.8 M8 8C10 7.6 11 6.4 11.4 4.8 M8 11.5C6 11.1 5 9.9 4.6 8.3 M8 11.5C10 11.1 11 9.9 11.4 8.3',
  /** A hammer. */
  production: 'M2.8 13.2L8.6 7.4 M6.8 5.2L9 3L13 7L10.8 9.2Z',
  /** A cash coin with its square hole. */
  gold: 'M8 2A6 6 0 1 0 8 14A6 6 0 1 0 8 2Z M6 6H10V10H6Z',
  /** An armillary sphere. */
  science: 'M8 2A6 6 0 1 0 8 14A6 6 0 1 0 8 2Z M2 8H14 M8 2C5.4 4 5.4 12 8 14 M8 2C10.6 4 10.6 12 8 14',
  /** A writing brush. */
  culture: 'M10.8 2.2L13.8 5.2L8.2 10.8L5.2 7.8Z M5.2 7.8C3.4 8.8 4 11 2.2 13.4C5 13.6 7.4 13 8.2 10.8',
  /** A heart: how the people feel. */
  morale: 'M8 13.4C3.4 10.2 2 7.8 2 5.6A3 3 0 0 1 8 4.6A3 3 0 0 1 14 5.6C14 7.8 12.6 10.2 8 13.4Z',
  menu: 'M2.5 4H13.5 M2.5 8H13.5 M2.5 12H13.5',
  close: 'M3.5 3.5L12.5 12.5 M12.5 3.5L3.5 12.5',
  /** A banner. */
  polities: 'M4 14.5V1.5 M4 2.5H12.5L10.5 5.2L12.5 8H4',
  /** A cup. */
  victory: 'M5 2H11V6A3 3 0 0 1 5 6Z M5 3.2H2.6C2.6 5.2 3.6 6.2 5 6.2 M11 3.2H13.4C13.4 5.2 12.4 6.2 11 6.2 M8 9V12 M5.5 14H10.5 M6.5 12H9.5',
  /** A retort. */
  research: 'M6 2H10 M7 2V6L3.6 12A1 1 0 0 0 4.5 13.5H11.5A1 1 0 0 0 12.4 12L9 6V2 M5.2 10.5H10.8',
  /** A tablet of law. */
  policy: 'M4 2H12V14H4Z M6 5H10 M6 8H10 M6 11H8.5',
  sound: 'M2.5 6H5L8.5 3V13L5 10H2.5Z M11 5.6C12 6.8 12 9.2 11 10.4 M12.8 3.8C14.8 6 14.8 10 12.8 12.2',
  mute: 'M2.5 6H5L8.5 3V13L5 10H2.5Z M11 6L14.5 10 M14.5 6L11 10',
  /** A shield. */
  fortify: 'M8 2L13 4V8C13 11 11 13 8 14C5 13 3 11 3 8V4Z',
  /** A crescent moon. */
  sleep: 'M12.6 10.4A5.5 5.5 0 0 1 5.8 3A5.5 5.5 0 1 0 12.6 10.4Z',
  skip: 'M3 4L8 8L3 12Z M9 4L14 8L9 12Z',
  upgrade: 'M4 8.5L8 4.5L12 8.5 M4 12.5L8 8.5L12 12.5',
  /** A house. */
  settle: 'M2.5 8L8 3L13.5 8 M4 7V13H12V7 M7 13V10H9V13',
  /** A flame. */
  pillage: 'M8 14C5 14 3.5 12 3.5 10C3.5 8 5 7 5.5 5C6.5 5.5 7 6.5 7 7.5C8 6 8.5 4.5 8 2C11 4 12.5 7 12.5 10C12.5 12 11 14 8 14Z',
  /** A crown. */
  leader: 'M2.5 12.5H13.5 M3 12.5L2.5 5L5.5 8L8 3.5L10.5 8L13.5 5L13 12.5',
  /** Mountains: the land a nation is made by. */
  trait: 'M1.5 13L6 5L9 10L11 7L14.5 13Z',
  /** A round piece. */
  unit: 'M8 2.5A5.5 5.5 0 1 0 8 13.5A5.5 5.5 0 1 0 8 2.5Z M8 5.5A2.5 2.5 0 1 0 8 10.5A2.5 2.5 0 1 0 8 5.5Z',
  /** A hall under a curved roof. */
  building: 'M2 7C5 7 7 5 8 3C9 5 11 7 14 7 M4 7V13H12V7 M7 13V10H9V13',
  /** A cut stone. */
  specialty: 'M5 3H11L14 6.5L8 14L2 6.5Z M2 6.5H14 M5 3L8 6.5L11 3',
  /** An eye. */
  observe: 'M1.5 8C3.5 4.5 5.5 3 8 3C10.5 3 12.5 4.5 14.5 8C12.5 11.5 10.5 13 8 13C5.5 13 3.5 11.5 1.5 8Z M8 6A2 2 0 1 0 8 10A2 2 0 1 0 8 6Z',
  play: 'M4.5 3L12.5 8L4.5 13Z',
  export: 'M8 2V10 M5 7L8 10L11 7 M3 13.5H13',
  import: 'M8 10V2 M5 5L8 2L11 5 M3 13.5H13',
  /** Crossed blades. */
  war: 'M3 3L11 11 M13 3L5 11 M3.5 12.5L5.5 10.5 M12.5 12.5L10.5 10.5',
  /** Sliders. */
  settings: 'M3 4H13 M3 8H13 M3 12H13 M6 2.5V5.5 M10.5 6.5V9.5 M5 10.5V13.5',
  /** A sundial's turn. */
  turn: 'M8 2A6 6 0 1 0 14 8 M8 4.5V8L10.5 9.5 M11 2H14V5',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

const SVG = 'http://www.w3.org/2000/svg';

/**
 * An icon as an SVG element. It carries no text and is hidden from
 * assistive technology: the control it sits in names itself.
 */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.icon = name;
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}
