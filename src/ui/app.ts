/**
 * The game's interface in plain DOM: start screen, HUD, panels, end screen
 * and the input on the map. It never changes the game state: every change
 * goes to the {@link Host} as an action, and the page is redrawn from the
 * state that comes back.
 */

import { FOCUSES, IMPROVEMENTS, PROJECT, SETTLER, unitDef } from '../core/data.ts';
import type { Yields } from '../core/data.ts';
import { NO_POLITY, currentEra, hexOwner } from '../core/game.ts';
import type { Action, GameEvent, GameState, Unit } from '../core/game.ts';
import type { HexHighlight, Renderer } from '../render/scene.ts';
import { getLanguage, setLanguage, t } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import { UNIT_CHARACTERS, sceneOf } from './board.ts';
import { button, el, fill } from './dom.ts';
import { createHost } from './host.ts';
import type { Host, HostChange, RunReport } from './host.ts';
import { loadLanguage, saveLanguage } from './language.ts';
import { createMinimap } from './minimap.ts';
import type { Minimap } from './minimap.ts';
import {
  REGIONS,
  buildingName,
  cityName,
  eraName,
  focusName,
  improvementName,
  itemName,
  polityName,
  regionName,
  regionOf,
  rejectText,
  saveErrorText,
  techName,
  unitName,
  yieldName,
} from './names.ts';
import { attackReach, findPath, previewAttack, reachableHexes } from './path.ts';
import { mainButton } from './pending.ts';
import type { PendingItem } from './pending.ts';
import { check, cityView, cityZoneAt, politySummary, ranking, relationView, researchView, upgradeView } from './rules.ts';
import type { BuildOption } from './rules.ts';
import { MAX_SAVE_BYTES, exportSave, importSave } from './saves.ts';
import { clearAutosave, readAutosave, writeAutosave } from './storage.ts';
import type { MapSource } from './storage.ts';
import { createWorkerRunner } from './turnRunner.ts';

/** A map with the renderer that draws it. */
export interface Board {
  readonly map: MapData;
  readonly source: MapSource;
  readonly renderer: Renderer;
  readonly canvas: HTMLCanvasElement;
}

export interface AppOptions {
  /** The element the interface is built in. */
  readonly root: HTMLElement;
  readonly board: Board;
  /** Replaces the board by one for another map. The old renderer is disposed by the callee. */
  readonly loadBoard: (source: MapSource) => Promise<Board>;
  /** True if the renderer is to stay paused for good (`?render=off`). */
  readonly renderOff?: boolean;
  /** Called after the board was replaced. */
  readonly onBoard?: (board: Board) => void;
}

export interface StartOptions {
  /** `MapPolity.id` of the nation to play. Without one the game is observed. */
  readonly nation?: string | null;
  /** True for observer mode, whatever `nation` says. */
  readonly observe?: boolean;
  /** Seed of the game. Default: a random one. */
  readonly seed?: number;
  /** The map to play on. Default: the one that is loaded. */
  readonly map?: 'real' | 'fixture';
}

export type MainButtonKind = 'none' | 'busy' | 'observer' | 'unit' | 'city' | 'nextTurn';

/** What the interface shows, for automated checks. */
export interface UiSnapshot {
  readonly screen: 'start' | 'game' | 'end';
  /** The panel that is open, the topmost if there are several. */
  readonly panel: 'menu' | 'city' | 'polity' | null;
  /** Zone of the city in the city panel, or null. */
  readonly city: number | null;
  /** Polity in the war and peace panel, or null. */
  readonly polity: number | null;
  /** Id of the selected unit, or null. */
  readonly selectedUnit: number | null;
  /** True while turns are being played. */
  readonly busy: boolean;
  /** Observer mode's controls, or null in a player's game. */
  readonly observer: { readonly paused: boolean; readonly speed: number } | null;
  /** `kind` is a stable code; `label` is the text on the button in the current language. */
  readonly mainButton: { readonly kind: MainButtonKind; readonly label: string };
  readonly notifications: number;
  readonly map: MapSource;
}

export interface App {
  readonly state: GameState;
  readonly ui: UiSnapshot;
  /** Starts a new game, loading another map first if asked to. */
  startGame(options?: StartOptions): Promise<void>;
  /** Ends the current turn. Resolves to false if there is no running game. */
  endTurn(): Promise<boolean>;
  /** Ends up to `turns` turns as fast as the rules go; resolves when they are done. */
  runTurns(turns: number): Promise<RunReport>;
  /** Hides the whole interface (for the render demo). */
  hide(): void;
}

const VERMILION = 0xc8402d;
const PAPER = 0xf2eee4;
/** Pointer travel, in pixels, below which a press is a click and not a drag. */
const CLICK_SLOP = 6;
/** Milliseconds between two turns in observer mode, by speed. */
const OBSERVER_DELAY: Readonly<Record<number, number>> = { 1: 1200, 2: 500, 4: 120 };
const SPEEDS = [1, 2, 4] as const;
const MAX_NOTES = 7;
/** A notification leaves after this many turns. */
const NOTE_TURNS = 3;
/** During a run of many turns the page is redrawn this often, in milliseconds. */
const BURST_REFRESH = 250;
const YIELD_ORDER: readonly (keyof Yields)[] = ['food', 'production', 'gold', 'science', 'culture'];

interface Note {
  readonly id: number;
  readonly turn: number;
  /** Built on every redraw, so that it follows the language. */
  readonly text: () => string;
  /** The hex to fly to, or -1. */
  readonly hex: number;
  /** The polity whose peace offer this is, or -1. */
  readonly offerFrom: number;
}

interface Placing {
  readonly city: number;
  readonly improvement: keyof typeof IMPROVEMENTS;
  readonly hexes: readonly number[];
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function createApp(options: AppOptions): App {
  const { root } = options;
  setLanguage(loadLanguage());

  let board = options.board;
  let runner = createWorkerRunner(board.map);
  let host: Host = createHost(board.map, runner);
  let minimap: Minimap | null = null;
  let detach: (() => void) | null = null;
  /** The camera distance the renderer starts with: the whole map in view. */
  let farDistance = board.renderer.getCamera().distance;

  let screen: 'start' | 'game' | 'end' = 'start';
  let chosenNation: string | null = null;
  let selection: number | null = null;
  let cityPanel: number | null = null;
  let polityPanel: number | null = null;
  let menuOpen = false;
  let placing: Placing | null = null;
  let focus: PendingItem | null = null;
  let notes: Note[] = [];
  let nextNoteId = 1;
  let paused = false;
  let speed: (typeof SPEEDS)[number] = 1;
  let observerTimer: number | null = null;
  /** Turns are being run by a caller of {@link App.runTurns}: observer mode's own clock stands still. */
  let automated = false;
  let hoverHex: number | null = null;
  let hoverPath: number[] = [];
  let reach: number[] = [];
  let reachKey = '';
  let touchTarget: number | null = null;
  let lastBurstRefresh = 0;
  let toastTimer: number | null = null;

  // ------------------------------------------------------------ skeleton

  const startScreen = el('div', { id: 'start', class: 'overlay' });
  const endScreen = el('div', { id: 'end', class: 'overlay' });
  const topbar = el('div', { id: 'topbar', class: 'panel' });
  const slots = el('div', { id: 'slots' });
  const notesBox = el('div', { id: 'notifications' });
  const minimapBox = el('div', { id: 'minimap-box', class: 'panel' });
  const selectionBox = el('div', { id: 'selection', class: 'panel' });
  const cityBox = el('aside', { id: 'city-panel', class: 'panel' });
  const polityBox = el('aside', { id: 'polity-panel', class: 'panel' });
  const menuBox = el('div', { id: 'menu', class: 'panel' });
  const actionBox = el('div', { id: 'action-box' });
  const game = el('div', { id: 'game' }, topbar, slots, notesBox, minimapBox, selectionBox, cityBox, polityBox, menuBox, actionBox);
  const toast = el('div', { id: 'toast', class: 'panel' });
  const tooltip = el('div', { id: 'tooltip', class: 'panel' });
  const fileInput = el('input', { id: 'import-file' });
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fill(root, game, startScreen, endScreen, toast, tooltip, fileInput);
  toast.hidden = true;
  tooltip.hidden = true;

  // ------------------------------------------------------------- helpers

  const state = (): GameState => host.state;
  const map = (): MapData => board.map;
  const player = (): number => state().player;
  const observing = (): boolean => player() === NO_POLITY;
  const unitById = (id: number | null): Unit | undefined =>
    id === null ? undefined : state().units.find((unit) => unit.id === id);
  const siteOf = (zone: number): number => map().zones[zone]?.siteHex ?? -1;

  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  };

  const flyTo = (hex: number, distance?: number): void => {
    if (hex < 0) return;
    board.renderer.focusHex(hex, distance === undefined ? {} : { distance });
  };

  /** Sends an action of the player and says why if the rules refuse it. */
  const act = (action: Action): boolean => {
    const result = host.act(action);
    if (!result.ok) showToast(rejectText(result.reason));
    return result.ok;
  };

  // -------------------------------------------------------- notifications

  const addNote = (text: () => string, hex: number, offerFrom = -1): void => {
    notes.push({ id: nextNoteId++, turn: state().turn, text, hex, offerFrom });
    if (notes.length > MAX_NOTES) notes = notes.slice(notes.length - MAX_NOTES);
  };

  const capitalHex = (polity: number): number => {
    const zone = state().polities[polity]?.capital ?? -1;
    return siteOf(zone >= 0 ? zone : (map().polities[polity]?.capitalZone ?? -1));
  };

  /** Turns the events that matter to whoever is watching into notifications. */
  const collect = (events: readonly GameEvent[]): void => {
    const me = player();
    const all = me === NO_POLITY;
    const m = map();
    for (const event of events) {
      switch (event.type) {
        case 'warDeclared':
          if (all || event.by === me || event.on === me) {
            addNote(() => t('note.war', { a: polityName(m, event.by), b: polityName(m, event.on) }), capitalHex(event.on));
          }
          break;
        case 'peaceMade':
          if (all || event.a === me || event.b === me) {
            notes = notes.filter((note) => note.offerFrom !== event.a && note.offerFrom !== event.b);
            addNote(() => t('note.peace', { a: polityName(m, event.a), b: polityName(m, event.b) }), capitalHex(event.a === me ? event.b : event.a));
          }
          break;
        case 'peaceOffered':
          if (event.to === me) {
            notes = notes.filter((note) => note.offerFrom !== event.from);
            addNote(() => t('note.offer', { a: polityName(m, event.from) }), capitalHex(event.from), event.from);
          }
          break;
        case 'cityCaptured':
          if (all || event.from === me || event.to === me) {
            addNote(() => t('note.captured', { a: polityName(m, event.to), city: cityName(m, event.city) }), siteOf(event.city));
          }
          break;
        case 'polityAnnexed':
          if (all || event.by === me || event.polity === me) {
            addNote(() => t('note.annexed', { a: polityName(m, event.by), b: polityName(m, event.polity) }), capitalHex(event.by));
          }
          break;
        case 'cityFounded':
          if (event.owner === me) addNote(() => t('note.founded', { city: cityName(m, event.city) }), siteOf(event.city));
          break;
        case 'cityPopulation':
          if (state().cities[event.city]?.owner === me) {
            addNote(() => t('note.grew', { city: cityName(m, event.city), pop: event.pop }), siteOf(event.city));
          }
          break;
        case 'cityBuilt':
          if (state().cities[event.city]?.owner === me) {
            addNote(() => t('note.built', { city: cityName(m, event.city), item: itemName(m, event.item) }), siteOf(event.city));
          }
          break;
        case 'unitKilled':
          if (event.owner === me) addNote(() => t('note.lost', { unit: unitName(event.unitType) }), event.hex);
          break;
        case 'researchFinished':
          if (event.polity === me) addNote(() => t('note.research', { tech: techName(event.tech) }), -1);
          break;
        case 'projectStageFinished':
          if (all || event.polity === me) {
            addNote(
              () => t('note.stage', { a: polityName(m, event.polity), name: t('project.tiangong'), stage: event.stage }),
              siteOf(event.city),
            );
          }
          break;
        case 'eraStarted':
          addNote(() => t('note.era', { era: eraName(event.era) }), -1);
          break;
        default:
          break;
      }
    }
  };

  /** Observer mode's camera goes to where a city fell, or else where a war began. */
  const followEvents = (events: readonly GameEvent[]): void => {
    let hex = -1;
    for (const event of events) {
      if (event.type === 'cityCaptured') {
        hex = siteOf(event.city);
        break;
      }
      if (event.type === 'warDeclared' && hex < 0) hex = capitalHex(event.on);
    }
    flyTo(hex);
  };

  // --------------------------------------------------------------- scene

  const drawHighlights = (): void => {
    const list: HexHighlight[] = [];
    const unit = unitById(selection);
    if (placing !== null) {
      for (const hex of placing.hexes) list.push({ hex, color: PAPER, opacity: 0.5 });
    } else if (unit !== undefined && screen === 'game') {
      for (const hex of reach) list.push({ hex, color: PAPER, opacity: 0.22 });
      const order = host.orders.get(unit.id);
      if (order !== undefined) list.push({ hex: order.target, color: VERMILION, opacity: 0.3 });
      for (const hex of hoverPath) list.push({ hex, color: VERMILION, opacity: 0.5 });
      if (hoverHex !== null && !hoverPath.includes(hoverHex) && tooltip.hidden === false) {
        list.push({ hex: hoverHex, color: VERMILION, opacity: 0.6 });
      }
      list.push({ hex: unit.hex, color: VERMILION, opacity: 0.65 });
    }
    board.renderer.setHighlights(list);
  };

  const drawScene = (): void => {
    board.renderer.setScene(sceneOf(state(), getLanguage()));
    const unit = unitById(selection);
    const key = unit === undefined || host.busy ? '' : `${unit.id}:${unit.hex}:${unit.moves}:${state().turn}:${state().units.length}`;
    if (key !== reachKey) {
      reachKey = key;
      reach = unit === undefined || host.busy ? [] : reachableHexes(state(), unit.id);
    }
    drawHighlights();
  };

  // ----------------------------------------------------------- selection

  const clearHover = (): void => {
    hoverHex = null;
    hoverPath = [];
    touchTarget = null;
    tooltip.hidden = true;
  };

  const select = (unit: number | null): void => {
    selection = unit;
    clearHover();
  };

  /** After a unit has done something: stay on it while it can do more, otherwise go on to the next idle unit. */
  const afterUnitActed = (id: number): void => {
    const unit = unitById(id);
    const done = unit === undefined || unit.moves <= 0 || unit.status !== 'ready' || host.orders.has(id);
    if (!done) return;
    const next = host.pending().find((item) => item.kind === 'unit' && item.unit !== id);
    if (next !== undefined && next.kind === 'unit') {
      focus = next;
      select(next.unit);
      flyTo(next.hex);
    } else if (unit === undefined) {
      select(null);
    }
  };

  const unitAction = (action: Action & { unit: number }): void => {
    if (act(action)) afterUnitActed(action.unit);
    refresh();
  };

  const orderTo = (hex: number): void => {
    if (selection === null) return;
    const result = host.order(selection, hex);
    if (!result.ok) showToast(rejectText(result.reason));
    else afterUnitActed(selection);
    clearHover();
    refresh();
  };

  /** Works out what a move or an attack of the selected unit onto `hex` would be, and shows it. */
  const preview = (hex: number | null, clientX: number, clientY: number): void => {
    hoverHex = hex;
    hoverPath = [];
    tooltip.hidden = true;
    const unit = unitById(selection);
    if (hex !== null && unit !== undefined && !host.busy && placing === null && hex !== unit.hex && unit.owner === player()) {
      let text = '';
      const attack = previewAttack(state(), unit.id, hex);
      if (attack !== null) {
        const path = findPath(state(), unit.id, hex, attackReach(state(), unit.id));
        if (path !== null) {
          hoverPath = path.hexes;
          const from = path.hexes.at(-1) ?? unit.hex;
          const exact = previewAttack(state(), unit.id, hex, from) ?? attack;
          text = exact.capture
            ? t('preview.capture')
            : t('preview.attack', { theirs: exact.toDefender, ours: exact.toAttacker });
          if (path.total > 1) text += ` · ${t('count.turns', { turns: path.total })}`;
        }
      } else {
        const path = findPath(state(), unit.id, hex);
        if (path !== null && path.total > 0) {
          hoverPath = path.hexes;
          text = t('count.turns', { turns: path.total });
        }
      }
      if (text !== '') {
        tooltip.textContent = text;
        tooltip.hidden = false;
        tooltip.style.left = `${clientX + 16}px`;
        tooltip.style.top = `${clientY + 16}px`;
      }
    }
    drawHighlights();
  };

  const clickHex = (hex: number, touch: boolean, clientX: number, clientY: number): void => {
    if (screen !== 'game' || host.busy) return;
    menuOpen = false;
    if (placing !== null) {
      const { city, improvement, hexes } = placing;
      placing = null;
      if (hexes.includes(hex)) {
        act({ type: 'queueBuild', polity: player(), city, item: { kind: 'improvement', improvement, hex } });
      }
      refresh();
      return;
    }
    const me = player();
    const unit = state().units.find((candidate) => candidate.hex === hex);
    const zone = cityZoneAt(state(), hex);
    const ownUnit = unit !== undefined && me !== NO_POLITY && unit.owner === me;
    const ownCity = zone >= 0 && me !== NO_POLITY && state().cities[zone]?.owner === me;

    if (touch && selection !== null && !ownUnit && !ownCity) {
      // touch has no right button: the first tap previews, the second one on the same hex orders
      if (touchTarget === hex) orderTo(hex);
      else {
        preview(hex, clientX, clientY);
        touchTarget = tooltip.hidden ? null : hex;
        if (touchTarget === null) {
          select(null);
          refresh();
        }
      }
      return;
    }

    polityPanel = null;
    if (ownUnit || ownCity) {
      select(ownUnit ? unit.id : null);
      cityPanel = ownCity ? zone : null;
      focus = ownUnit ? { kind: 'unit', unit: unit.id, hex } : { kind: 'city', city: zone, hex };
    } else {
      select(null);
      cityPanel = null;
      focus = null;
      const owner = zone >= 0 ? (state().cities[zone]?.owner ?? NO_POLITY) : unit !== undefined ? unit.owner : hexOwner(state(), hex);
      if (owner !== NO_POLITY && owner !== me) polityPanel = owner;
    }
    refresh();
  };

  // ------------------------------------------------------------ the HUD

  const stat = (label: string, value: string, id: string): HTMLElement =>
    el('span', { class: 'stat', id }, el('span', { class: 'stat-label', text: label }), value);

  const drawTopbar = (): void => {
    const s = state();
    const left = el('div', { class: 'stats' });
    if (observing()) {
      left.append(el('span', { class: 'stat', id: 'observer-badge', text: t('hud.observer') }));
    } else {
      const polity = s.polities[player()];
      const summary = politySummary(s, player());
      left.append(
        el('span', { class: 'swatch', id: 'player-nation', text: polityName(map(), player()) }),
        stat(yieldName('gold'), `${Math.floor(polity?.gold ?? 0)} ${signed(summary.net)}`, 'stat-gold'),
        stat(yieldName('science'), signed(summary.yields.science), 'stat-science'),
        stat(yieldName('culture'), signed(summary.yields.culture), 'stat-culture'),
        stat(t('hud.morale'), summary.morale === null ? '—' : String(summary.morale), 'stat-morale'),
      );
      const swatch = left.firstElementChild as HTMLElement;
      swatch.style.borderColor = cssColor(map().polities[player()]?.color ?? 0x888888);
    }
    const middle = el(
      'div',
      { id: 'turn' },
      el('span', { id: 'era', text: eraName(currentEra(s)) }),
      el('span', { id: 'turn-counter', text: t('hud.turnOf', { turn: s.turn, last: s.lastTurn }), data: { turn: s.turn } }),
    );
    const menuButton = button(t('hud.menu'), () => {
      menuOpen = !menuOpen;
      refresh();
    }, { id: 'menu-button' });
    fill(topbar, left, middle, menuButton);
  };

  /** The player's current research: its name and the turns it still takes. The player does not choose it yet. */
  const researchText = (): string => {
    const research = observing() ? null : researchView(state(), player());
    if (research === null) return '—';
    return research.turns === null
      ? techName(research.tech)
      : t('hud.researching', { tech: techName(research.tech), turns: research.turns });
  };

  const drawSlots = (): void => {
    fill(
      slots,
      el('div', { class: 'panel slot', id: 'slot-research' }, el('span', { class: 'stat-label', text: t('hud.research') }), researchText()),
      el('div', { class: 'panel slot', id: 'slot-policy' }, el('span', { class: 'stat-label', text: t('hud.policy') }), '—'),
    );
  };

  const drawNotes = (): void => {
    fill(
      notesBox,
      ...notes.map((note) => {
        const row = el('div', { class: 'panel note', data: { note: note.id } });
        row.append(
          button(note.text(), () => {
            flyTo(note.hex);
          }, { class: 'note-text' }),
        );
        if (note.offerFrom >= 0) {
          row.append(
            button(t('note.accept'), () => {
              act({ type: 'makePeace', polity: player(), target: note.offerFrom });
              notes = notes.filter((other) => other.id !== note.id);
              refresh();
            }, { class: 'accent', data: { offer: 'accept' } }),
            button(t('note.decline'), () => {
              notes = notes.filter((other) => other.id !== note.id);
              refresh();
            }, { data: { offer: 'decline' } }),
          );
        } else {
          row.append(
            button('×', () => {
              notes = notes.filter((other) => other.id !== note.id);
              refresh();
            }, { class: 'note-close' }),
          );
        }
        return row;
      }),
    );
  };

  const drawSelection = (): void => {
    const unit = unitById(selection);
    selectionBox.hidden = unit === undefined;
    if (unit === undefined) return;
    const def = unitDef(unit.type);
    const me = player();
    const piece = el('div', { class: 'piece', text: UNIT_CHARACTERS[unit.type] ?? '' });
    piece.style.borderColor = cssColor(map().polities[unit.owner]?.color ?? 0x888888);
    const status = host.orders.has(unit.id)
      ? t('status.travelling')
      : unit.status === 'fortified'
        ? t('status.fortified')
        : unit.status === 'asleep'
          ? t('status.asleep')
          : '';
    const facts = el(
      'div',
      { class: 'facts' },
      el('div', { class: 'title', id: 'unit-name', text: unitName(unit.type) }),
      el(
        'div',
        { class: 'line' },
        el('span', { text: t('unit.hp', { hp: unit.hp }) }),
        el('span', { text: t('unit.moves', { moves: unit.moves, max: def.moves }) }),
        unit.level > 0 && el('span', { text: t('unit.level', { level: unit.level }) }),
        status !== '' && el('span', { class: 'status', text: status }),
      ),
    );
    const actions = el('div', { class: 'actions' });
    const add = (name: string, label: string, action: Action & { unit: number }): void => {
      const reason = check(state(), action);
      const props = { data: { action: name }, disabled: reason !== null || host.busy, ...(reason === null ? {} : { title: rejectText(reason) }) };
      actions.append(button(label, () => {
        unitAction(action);
      }, props));
    };
    if (def.strength > 0) add('fortify', t('action.fortify'), { type: 'fortify', polity: me, unit: unit.id });
    add('sleep', t('action.sleep'), { type: 'sleep', polity: me, unit: unit.id });
    actions.append(
      button(t('action.skip'), () => {
        host.skip(unit.id);
        const next = host.pending().find((item) => item.kind === 'unit');
        if (next !== undefined && next.kind === 'unit') {
          focus = next;
          select(next.unit);
          flyTo(next.hex);
        } else select(null);
        refresh();
      }, { data: { action: 'skip' }, disabled: host.busy || unit.moves <= 0 }),
    );
    const upgrade = upgradeView(state(), unit.id);
    if (upgrade !== null) {
      add('upgrade', t('action.upgrade', { gold: upgrade.gold }), { type: 'upgrade', polity: me, unit: unit.id });
    }
    if (unit.type === SETTLER) add('settle', t('action.settle'), { type: 'settle', polity: me, unit: unit.id });
    fill(selectionBox, piece, facts, actions);
  };

  const optionButton = (label: string, option: BuildOption, key: string, onClick: () => void, active = false): HTMLButtonElement => {
    const node = el(
      'button',
      { class: active ? 'option active' : 'option', data: { build: key }, onClick, disabled: host.busy },
      el('span', { class: 'option-name', text: label }),
      el('span', { class: 'option-cost', text: t('city.cost', { cost: option.cost }) }),
      option.turns !== null && el('span', { class: 'option-turns', text: t('count.turns', { turns: option.turns }) }),
    );
    return node;
  };

  const drawCityPanel = (): void => {
    const view = cityPanel === null ? null : cityView(state(), cityPanel);
    cityBox.hidden = view === null;
    if (view === null || cityPanel === null) return;
    const zone = cityPanel;
    const { city } = view;
    const me = player();
    const queue = (item: BuildOption['item']) => (): void => {
      act({ type: 'queueBuild', polity: me, city: zone, item });
      refresh();
    };

    const header = el(
      'header',
      {},
      el('h2', { id: 'city-name', text: cityName(map(), zone) }),
      button('×', () => {
        cityPanel = null;
        placing = null;
        refresh();
      }, { class: 'close', id: 'city-close' }),
    );
    const facts = el(
      'div',
      { class: 'line' },
      el('span', { text: t('city.pop', { pop: city.pop }) }),
      el('span', { text: t('city.hp', { hp: Math.round(city.hp), max: view.maxHp }) }),
      el('span', { text: `${t('hud.morale')} ${Math.round(city.morale)}` }),
      city.unrest > 0 && el('span', { class: 'status', text: t('city.unrest', { turns: city.unrest }) }),
    );
    const yieldsRow = el(
      'div',
      { class: 'yields', id: 'city-yields' },
      ...YIELD_ORDER.map((name) => stat(yieldName(name), signed(city.yields[name]), `city-${name}`)),
    );
    const focusRow = el(
      'div',
      { class: 'segmented', id: 'city-focus' },
      ...FOCUSES.map((entry) =>
        button(focusName(entry), () => {
          if (entry !== city.focus) act({ type: 'setFocus', polity: me, city: zone, focus: entry });
          refresh();
        }, { class: entry === city.focus ? 'active' : '', data: { focus: entry }, disabled: host.busy }),
      ),
    );
    const queueList = el(
      'ol',
      { id: 'city-queue' },
      ...view.queue.map((entry, index) =>
        el(
          'li',
          {},
          el('span', { class: 'option-name', text: itemName(map(), entry.item) }),
          el('span', {
            class: 'option-cost',
            text: index === 0 ? `${Math.floor(city.progress)}/${entry.cost}` : String(entry.cost),
          }),
          entry.turns !== null && el('span', { class: 'option-turns', text: t('count.turns', { turns: entry.turns }) }),
          button('×', () => {
            act({ type: 'unqueueBuild', polity: me, city: zone, index });
            refresh();
          }, { class: 'close', data: { unqueue: index }, disabled: host.busy }),
        ),
      ),
    );
    if (view.queue.length === 0) queueList.append(el('li', { class: 'empty', text: '—' }));

    const group = (title: string, id: string, nodes: HTMLElement[]): HTMLElement | null =>
      nodes.length === 0 ? null : el('section', { id }, el('h3', { text: title }), ...nodes);

    const body = el(
      'div',
      { class: 'scroll' },
      facts,
      yieldsRow,
      el('h3', { text: t('city.focus') }),
      focusRow,
      el('h3', { text: t('city.queue') }),
      queueList,
      group(t('city.units'), 'build-units', view.units.map((option) =>
        optionButton(itemName(map(), option.item), option, `unit:${option.item.kind === 'unit' ? option.item.unit : ''}`, queue(option.item)),
      )),
      group(t('city.buildings'), 'build-buildings', view.buildings.map((option) =>
        optionButton(
          option.item.kind === 'building' ? buildingName(option.item.building) : '',
          option,
          `building:${option.item.kind === 'building' ? option.item.building : ''}`,
          queue(option.item),
        ),
      )),
      group(t('city.improvements'), 'build-improvements', view.improvements.map((option) => {
        const gains = IMPROVEMENTS[option.improvement].yields;
        const gain = (['food', 'production', 'gold'] as const)
          .filter((name) => gains[name] !== 0)
          .map((name) => `${signed(gains[name])}${yieldName(name)}`)
          .join(' ');
        const active = placing !== null && placing.city === zone && placing.improvement === option.improvement;
        return optionButton(`${improvementName(option.improvement)} ${gain}`, option, `improvement:${option.improvement}`, () => {
          placing = active ? null : { city: zone, improvement: option.improvement, hexes: option.hexes };
          clearHover();
          refresh();
        }, active);
      })),
      group(t('city.project'), 'build-project', view.projects.map((option) =>
        optionButton(
          t('city.projectStage', { name: t('project.tiangong'), stage: (state().polities[me]?.projectStage ?? 0) + 1 }),
          option,
          `project:${PROJECT.id}`,
          queue(option.item),
        ),
      )),
      group(t('city.sites'), 'build-sites', view.sites.map((option) =>
        optionButton(itemName(map(), option.item), option, `city:${option.item.kind === 'city' ? option.item.zone : ''}`, queue(option.item)),
      )),
    );
    fill(cityBox, header, body);
  };

  const drawPolityPanel = (): void => {
    const polity = polityPanel;
    const entry = polity === null ? undefined : map().polities[polity];
    polityBox.hidden = entry === undefined;
    if (entry === undefined || polity === null) return;
    const s = state();
    const me = player();
    const header = el(
      'header',
      {},
      el('h2', { id: 'polity-name', text: polityName(map(), polity) }),
      button('×', () => {
        polityPanel = null;
        refresh();
      }, { class: 'close', id: 'polity-close' }),
    );
    (header.firstElementChild as HTMLElement).style.borderColor = cssColor(entry.color);
    const kind = entry.kind === 'cityState' ? t('polity.cityState') : s.majors.includes(polity) ? t('polity.major') : t('polity.nation');
    const cities = s.cities.filter((city) => city !== null && city.owner === polity).length;
    const lines = el('div', { class: 'line' }, el('span', { text: kind }), el('span', { text: t('polity.cities', { count: cities }) }));
    const nodes: HTMLElement[] = [header, lines];
    if (me !== NO_POLITY && s.polities[polity]?.alive === true && s.polities[me]?.alive === true) {
      const relation = relationView(s, me, polity);
      const text =
        relation.kind === 'war'
          ? t('relation.war', { turn: relation.since })
          : relation.kind === 'truce'
            ? t('relation.truce', { turn: relation.until })
            : t('relation.peace');
      nodes.push(el('div', { class: 'line', id: 'polity-relation', data: { relation: relation.kind }, text }));
      const atWar = relation.kind === 'war';
      nodes.push(
        button(atWar ? t('polity.makePeace') : t('polity.declareWar'), () => {
          act({ type: atWar ? 'makePeace' : 'declareWar', polity: me, target: polity });
          refresh();
        }, { class: 'accent', id: 'polity-action', data: { action: atWar ? 'makePeace' : 'declareWar' }, disabled: host.busy }),
      );
    }
    fill(polityBox, ...nodes);
  };

  /** What the main action button is right now. */
  const mainState = (): { kind: MainButtonKind; label: string; item: PendingItem | null } => {
    if (screen !== 'game') return { kind: 'none', label: '', item: null };
    if (observing()) {
      if (host.busy && automated) return { kind: 'busy', label: t('main.aiTurn'), item: null };
      return { kind: 'observer', label: paused ? t('main.resume') : t('main.pause'), item: null };
    }
    if (host.busy) return { kind: 'busy', label: t('main.aiTurn'), item: null };
    const next = mainButton(host.pending(), focus);
    if (next.kind === 'nextTurn') return { kind: 'nextTurn', label: t('main.nextTurn'), item: null };
    const { item } = next;
    const label =
      item.kind === 'unit'
        ? t('main.unit', { name: unitName(unitById(item.unit)?.type ?? '') })
        : t('main.city', { name: cityName(map(), item.city) });
    return { kind: next.kind, label, item };
  };

  const scheduleObserver = (): void => {
    if (observerTimer !== null) {
      window.clearTimeout(observerTimer);
      observerTimer = null;
    }
    if (screen !== 'game' || !observing() || paused || automated || host.busy || state().result !== null) return;
    observerTimer = window.setTimeout(() => {
      observerTimer = null;
      void host.endTurn();
    }, OBSERVER_DELAY[speed]);
  };

  const mainAction = (): void => {
    const current = mainState();
    switch (current.kind) {
      case 'observer':
        paused = !paused;
        scheduleObserver();
        break;
      case 'nextTurn':
        placing = null;
        clearHover();
        void host.endTurn();
        return;
      case 'unit':
      case 'city': {
        const { item } = current;
        if (item === null) return;
        focus = item;
        polityPanel = null;
        placing = null;
        if (item.kind === 'unit') {
          select(item.unit);
          cityPanel = null;
        } else {
          select(null);
          cityPanel = item.city;
        }
        flyTo(item.hex);
        break;
      }
      default:
        return;
    }
    refresh();
  };

  const drawAction = (): void => {
    const current = mainState();
    const nodes: HTMLElement[] = [];
    if (observing() && screen === 'game') {
      nodes.push(
        el(
          'div',
          { class: 'segmented panel', id: 'speed' },
          ...SPEEDS.map((value) =>
            button(t('observer.speed', { speed: value }), () => {
              speed = value;
              scheduleObserver();
              refresh();
            }, { class: value === speed ? 'active' : '', data: { speed: value } }),
          ),
        ),
      );
    }
    if (current.kind !== 'none') nodes.push(
      button(current.label, mainAction, {
        id: 'main-action',
        class: current.kind === 'busy' ? 'busy' : current.kind === 'nextTurn' ? 'accent' : '',
        data: { kind: current.kind },
        disabled: current.kind === 'busy',
      }),
    );
    fill(actionBox, ...nodes);
  };

  // -------------------------------------------------------- saves and menu

  const enterGame = (): void => {
    screen = state().result === null ? 'game' : 'end';
    select(null);
    cityPanel = null;
    polityPanel = null;
    menuOpen = false;
    placing = null;
    focus = null;
    notes = [];
    paused = false;
    if (state().result === null) writeAutosave(board.source, state());
    if (!observing()) flyTo(capitalHex(player()), farDistance * 0.3);
    else board.renderer.setCamera({ distance: farDistance });
    refresh();
    scheduleObserver();
  };

  const leaveGame = (): void => {
    host.reset();
    screen = 'start';
    chosenNation = null;
    select(null);
    cityPanel = null;
    polityPanel = null;
    menuOpen = false;
    placing = null;
    notes = [];
    board.renderer.setCamera({ distance: farDistance });
    refresh();
    scheduleObserver();
  };

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([exportSave(state())], { type: 'application/json' }));
    const link = el('a');
    link.href = url;
    link.download = `shanhe-turn-${state().turn}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /** Loads a save from text: validated as data, never run. */
  const loadText = (text: string): void => {
    const result = importSave(text, map());
    if (!result.ok) {
      showToast(saveErrorText(result.error));
      return;
    }
    host.resume(result.state);
    enterGame();
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file === undefined) return;
    if (file.size > MAX_SAVE_BYTES) {
      showToast(saveErrorText('tooLarge'));
      return;
    }
    void file.text().then(loadText, () => {
      showToast(saveErrorText('notJson'));
    });
  });

  const switchLanguage = (): void => {
    const next = getLanguage() === 'zh' ? 'en' : 'zh';
    setLanguage(next);
    saveLanguage(next);
    refresh();
  };

  const drawMenu = (): void => {
    menuBox.hidden = !menuOpen || screen !== 'game';
    if (menuBox.hidden) return;
    fill(
      menuBox,
      button(t('menu.export'), download, { id: 'menu-export' }),
      button(t('menu.import'), () => {
        fileInput.click();
      }, { id: 'menu-import' }),
      button(t('language.switch'), switchLanguage, { id: 'menu-language' }),
      button(t('menu.newGame'), leaveGame, { id: 'menu-new-game' }),
      button(t('menu.close'), () => {
        menuOpen = false;
        refresh();
      }, { id: 'menu-close' }),
      el('div', { class: 'footnote', id: 'backend', text: t('hud.backend', { backend: t(`backend.${board.renderer.backend}`) }) }),
    );
  };

  // ------------------------------------------------------- start and end

  const drawStart = (): void => {
    startScreen.hidden = screen !== 'start';
    if (startScreen.hidden) return;
    const m = map();
    const zh = getLanguage() === 'zh';
    const majors = new Set(state().majors);
    const groups = REGIONS.map((region) => {
      const members = m.polities
        .map((polity, index) => ({ polity, index }))
        .filter(({ polity }) => polity.kind === 'nation' && regionOf(polity.id) === region);
      if (members.length === 0) return null;
      return el(
        'section',
        { class: 'region', data: { region } },
        el('h3', { text: regionName(region) }),
        el(
          'div',
          { class: 'nations' },
          ...members.map(({ polity, index }) => {
            const node = el(
              'button',
              {
                class: `nation${chosenNation === polity.id ? ' active' : ''}${majors.has(index) ? ' major' : ''}`,
                data: { nation: polity.id },
                onClick: () => {
                  chosenNation = polity.id;
                  refresh();
                },
              },
              el('span', { class: 'nation-name', text: zh ? polity.nameZh : polity.nameEn }),
              el('span', { class: 'nation-other', text: zh ? polity.nameEn : polity.nameZh }),
            );
            node.style.borderLeftColor = cssColor(polity.color);
            return node;
          }),
        ),
      );
    });
    const saved = readAutosave(board.source, m);
    const card = el(
      'div',
      { class: 'panel card' },
      el(
        'header',
        {},
        el('h1', { text: t('app.title') }),
        button(t('language.switch'), switchLanguage, { id: 'language' }),
      ),
      el('div', { class: 'scroll', id: 'nations' }, ...groups),
      el(
        'footer',
        {},
        saved !== null &&
          button(t('start.continue'), () => {
            host.resume(saved);
            enterGame();
          }, { id: 'continue' }),
        button(t('menu.import'), () => {
          fileInput.click();
        }, { id: 'start-import' }),
        button(t('start.observe'), () => {
          void startGame({ observe: true });
        }, { id: 'observe' }),
        button(t('start.play'), () => {
          if (chosenNation !== null) void startGame({ nation: chosenNation });
        }, { id: 'play', class: 'accent', disabled: chosenNation === null }),
      ),
    );
    fill(startScreen, card);
  };

  const drawEnd = (): void => {
    const result = state().result;
    endScreen.hidden = screen !== 'end' || result === null;
    if (endScreen.hidden || result === null) return;
    const m = map();
    const me = player();
    const title = me === NO_POLITY ? t('end.over') : result.winner === me ? t('end.victory') : t('end.defeat');
    const line = t(result.kind === 'conquest' ? 'end.conquest' : result.kind === 'science' ? 'end.science' : 'end.economic', {
      name: polityName(m, result.winner),
      turn: result.turn,
    });
    const table = el(
      'table',
      { id: 'ranking' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: '' }),
          el('th', { text: t('end.nation') }),
          el('th', { text: t('end.capitals') }),
          el('th', { text: t('end.cities') }),
          el('th', { text: t('end.income') }),
        ),
      ),
      el(
        'tbody',
        {},
        ...ranking(state()).map((row, index) =>
          el(
            'tr',
            { class: `${row.polity === result.winner ? 'winner' : ''}${row.polity === me ? ' mine' : ''}${row.alive ? '' : ' gone'}`, data: { polity: row.polity } },
            el('td', { text: String(index + 1) }),
            el('td', { text: polityName(m, row.polity) }),
            el('td', { text: String(row.capitals) }),
            el('td', { text: String(row.cities) }),
            el('td', { text: String(Math.round(row.income)) }),
          ),
        ),
      ),
    );
    fill(
      endScreen,
      el(
        'div',
        { class: 'panel card' },
        el('header', {}, el('h1', { id: 'end-title', text: title })),
        el('p', { id: 'end-result', data: { kind: result.kind, winner: result.winner }, text: line }),
        el('div', { class: 'scroll' }, table),
        el('footer', {}, button(t('menu.newGame'), leaveGame, { id: 'new-game', class: 'accent' })),
      ),
    );
  };

  // ------------------------------------------------------------- refresh

  function refresh(): void {
    document.documentElement.lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
    document.title = t('app.title');
    game.hidden = screen === 'start';
    root.dataset.screen = screen;
    root.dataset.side = screen === 'game' && (cityPanel !== null || polityPanel !== null) ? 'open' : 'closed';
    drawScene();
    drawStart();
    drawEnd();
    if (screen === 'start') return;
    drawTopbar();
    drawSlots();
    drawNotes();
    drawSelection();
    drawCityPanel();
    drawPolityPanel();
    drawMenu();
    drawAction();
    minimap?.draw(state());
  }

  /** Drops what the new state no longer has, and moves to the end screen once there is a result. */
  const settle = (): void => {
    const s = state();
    const me = player();
    if (selection !== null && unitById(selection)?.owner !== me) select(null);
    if (cityPanel !== null && s.cities[cityPanel]?.owner !== me) cityPanel = null;
    if (placing !== null && cityPanel !== placing.city) placing = null;
    if (polityPanel !== null && s.polities[polityPanel]?.alive !== true) polityPanel = null;
    notes = notes.filter((note) =>
      note.offerFrom >= 0 ? relationView(s, me, note.offerFrom).kind === 'war' : s.turn - note.turn < NOTE_TURNS,
    );
    if (s.result !== null && screen === 'game') {
      screen = 'end';
      menuOpen = false;
      clearAutosave(board.source);
    }
  };

  const onChange = (change: HostChange): void => {
    switch (change.kind) {
      case 'started':
        return;
      case 'action':
        collect(change.events);
        settle();
        return;
      case 'turn':
        focus = null;
        clearHover();
        collect(change.events);
        settle();
        if (change.burst) {
          const now = performance.now();
          if (now - lastBurstRefresh >= BURST_REFRESH) {
            lastBurstRefresh = now;
            refresh();
          }
          return;
        }
        if (observing()) followEvents(change.events);
        refresh();
        return;
      case 'busy':
        if (!host.busy && host.playing) {
          if (state().result === null) writeAutosave(board.source, state());
          settle();
        }
        refresh();
        scheduleObserver();
        return;
      case 'attention':
        refresh();
        return;
    }
  };

  // ------------------------------------------------------------ the board

  const attach = (): void => {
    const { canvas, renderer } = board;
    const control = new AbortController();
    const { signal } = control;
    let press: { id: number; x: number; y: number; button: number } | null = null;

    canvas.addEventListener('pointerdown', (event) => {
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button };
    }, { signal });
    canvas.addEventListener('pointerup', (event) => {
      const start = press;
      press = null;
      if (start === null || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return;
      const hex = renderer.pickHex(event.clientX, event.clientY);
      if (hex === null) return;
      if (start.button === 2) {
        if (screen === 'game' && !host.busy && placing === null) orderTo(hex);
      } else if (start.button === 0) {
        clickHex(hex, event.pointerType === 'touch', event.clientX, event.clientY);
      }
    }, { signal });
    canvas.addEventListener('pointercancel', () => {
      press = null;
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || event.buttons !== 0 || selection === null || screen !== 'game') return;
      const hex = renderer.pickHex(event.clientX, event.clientY);
      if (hex === hoverHex) {
        tooltip.style.left = `${event.clientX + 16}px`;
        tooltip.style.top = `${event.clientY + 16}px`;
        return;
      }
      preview(hex, event.clientX, event.clientY);
    }, { signal });
    canvas.addEventListener('pointerleave', () => {
      if (hoverHex === null) return;
      clearHover();
      drawHighlights();
    }, { signal });

    minimap = createMinimap(board.map, (hex) => {
      flyTo(hex);
    });
    fill(minimapBox, minimap.element);
    const view = minimap;
    const stopFrames = renderer.onFrame(() => {
      const camera = renderer.getCamera();
      view.setCamera(camera.x, camera.z);
    });
    const unsubscribe = host.subscribe(onChange);
    farDistance = renderer.getCamera().distance;
    detach = () => {
      control.abort();
      stopFrames();
      unsubscribe();
    };
  };

  const idle = (): Promise<void> =>
    new Promise((resolve) => {
      if (!host.busy) {
        resolve();
        return;
      }
      const stop = host.subscribe(() => {
        if (host.busy) return;
        stop();
        resolve();
      });
    });

  async function startGame(start: StartOptions = {}): Promise<void> {
    const wanted: MapSource | undefined = start.map === undefined ? undefined : start.map === 'fixture' ? 'fixture' : 'file';
    if (wanted !== undefined && wanted !== board.source) {
      if (observerTimer !== null) window.clearTimeout(observerTimer);
      observerTimer = null;
      detach?.();
      board = await options.loadBoard(wanted);
      runner.dispose();
      runner = createWorkerRunner(board.map);
      host = createHost(board.map, runner);
      attach();
      options.onBoard?.(board);
    }
    const observe = start.observe === true || start.nation === undefined || start.nation === null;
    const seed = start.seed ?? Math.floor(Math.random() * 0x7fffffff);
    host.start({ seed, player: observe ? null : (start.nation ?? null) });
    enterGame();
  }

  window.addEventListener(
    'keydown',
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        screen !== 'game'
      ) {
        return;
      }
      if (event.key === 'Enter') {
        // Enter is the main button wherever the focus is, and only once per press
        event.preventDefault();
        if (!event.repeat) mainAction();
      } else if (event.key === 'Escape') {
        if (placing !== null) placing = null;
        else if (menuOpen) menuOpen = false;
        else if (cityPanel !== null || polityPanel !== null) {
          cityPanel = null;
          polityPanel = null;
        } else select(null);
        refresh();
      }
    },
    { capture: true },
  );

  attach();
  refresh();

  return {
    get state() {
      return state();
    },
    get ui(): UiSnapshot {
      const current = mainState();
      return {
        screen,
        panel: screen !== 'game' ? null : menuOpen ? 'menu' : cityPanel !== null ? 'city' : polityPanel !== null ? 'polity' : null,
        city: cityPanel,
        polity: polityPanel,
        selectedUnit: selection,
        busy: host.busy,
        observer: screen === 'game' && observing() ? { paused, speed } : null,
        mainButton: { kind: current.kind, label: current.label },
        notifications: notes.length,
        map: board.source,
      };
    },
    startGame,
    async endTurn() {
      await idle();
      return host.endTurn();
    },
    async runTurns(turns) {
      automated = true;
      scheduleObserver();
      // nothing is drawn while the turns run; the board is drawn once at the end
      board.renderer.setPaused(true);
      try {
        await idle();
        refresh();
        return await host.runTurns(turns);
      } finally {
        automated = false;
        board.renderer.setPaused(options.renderOff === true);
        refresh();
        scheduleObserver();
      }
    },
    hide() {
      root.hidden = true;
    },
  };
}
