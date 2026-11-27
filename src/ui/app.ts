/**
 * The game's interface in plain DOM: start screen, HUD, panels, end screen
 * and the input on the map. It never changes the game state: every change
 * goes to the {@link Host} as an action, and the page is redrawn from the
 * state that comes back.
 */

import { BUILDINGS, FOCUSES, IMPROVEMENTS, PROJECT, SETTLER, unitDef } from '../core/data.ts';
import type { Yields } from '../core/data.ts';
import { NO_POLITY, currentEra, hexOwner, nextPolicyCost } from '../core/game.ts';
import type { Action, GameEvent, GameState, Unit } from '../core/game.ts';
import { airStrikeTargets, buyCostOf, hexDistance } from '../core/query.ts';
import { topologyOf } from '../core/topology.ts';
import type { HexHighlight, Renderer } from '../render/scene.ts';
import { indexToOffset } from '../shared/hex.ts';
import { getLanguage, setLanguage, t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import { playSpeed, visualEvents } from './animation.ts';
import { UNIT_CHARACTERS, sceneOf, wholeMapView } from './board.ts';
import { createTradeSection } from './cityTrade.ts';
import { standingWith } from './diplomacy.ts';
import { button, el, fill } from './dom.ts';
import { createHost } from './host.ts';
import type { Host, HostChange, RunReport } from './host.ts';
import { loadLanguage, saveLanguage } from './language.ts';
import { LENSES } from './lens.ts';
import type { Lens } from './lens.ts';
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
  resourceName,
  saveErrorText,
  techName,
  unitName,
  yieldName,
} from './names.ts';
import { policyOverlay, politiesOverlay, standingName, techOverlay, victoryOverlay } from './overlays.ts';
import type { OverlayKind, PolicyOverlayState, PolitiesOverlayState } from './overlays.ts';
import { attackReach, findPath, previewAttack, reachableHexes } from './path.ts';
import { mainButton } from './pending.ts';
import type { PendingItem, PendingKind } from './pending.ts';
import { offerText, polityPanel as polityPanelNodes } from './polityPanel.ts';
import { check, cityView, cityZoneAt, politySummary, ranking, relationView, researchView, upgradeView } from './rules.ts';
import type { BuildOption } from './rules.ts';
import { MAX_SAVE_BYTES, exportSave, importSave } from './saves.ts';
import { SCALE_SETTINGS, loadScaleSetting, saveScaleSetting, uiScale } from './scale.ts';
import type { ScaleSetting } from './scale.ts';
import { clearAutosave, readAutosave, writeAutosave } from './storage.ts';
import type { MapSource } from './storage.ts';
import { createWorkerRunner } from './turnRunner.ts';
import { cssColor, signed } from './view.ts';
import type { View } from './view.ts';

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
  /**
   * False to show every change at once, without animating what happened.
   * The page passes false under automation, where a frame takes seconds.
   * Default true.
   */
  readonly animate?: boolean;
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

export type MainButtonKind = 'none' | 'busy' | 'observer' | 'nextTurn' | PendingKind;

/** What the interface shows, for automated checks. */
export interface UiSnapshot {
  readonly screen: 'start' | 'game' | 'end';
  /** The panel that is open, the topmost if there are several. */
  readonly panel: 'menu' | 'city' | 'polity' | null;
  /** The full-screen overlay that is open: tech tree, policies, the list of polities or the victory progress. */
  readonly overlay: OverlayKind | null;
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
  /** The lens of the minimap. */
  readonly lens: Lens;
  /** The interface size setting and the factor it gives on this window. */
  readonly scale: { readonly setting: ScaleSetting; readonly factor: number };
  /** True while the board is playing what happened and has not caught up with the state yet. */
  readonly animating: boolean;
  /** What a click on the map does: selects, places an improvement, or picks the target of an air strike. */
  readonly targeting: 'select' | 'improvement' | 'airStrike';
  /** The destination chosen in the trade picker of the city panel, as its `data-route`, or null. */
  readonly routePreview: string | null;
  /** Presses of Enter during other polities' turns that were applied when the turn ended. */
  readonly enterApplied: number;
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
  /** The proposal to answer from the note, or null. */
  readonly offer: NoteOffer | null;
}

interface Placing {
  readonly city: number;
  readonly improvement: keyof typeof IMPROVEMENTS;
  readonly hexes: readonly number[];
}

/** A proposal the note stands for: one of `state.offers` by id, or the peace offer of a polity. */
type NoteOffer = { readonly kind: 'offer'; readonly id: number } | { readonly kind: 'peace'; readonly from: number };

/** How much faster animations run while Space is held. */
const HURRY = 4;
/** The view is sampled at this many points a side to find the hexes in it. */
const VIEW_SAMPLES = 5;
/** Observer mode's camera has this many hexes around its target in view once it has moved there. */
const FOLLOW_RADIUS = 8;

export function createApp(options: AppOptions): App {
  const { root } = options;
  setLanguage(loadLanguage());

  let board = options.board;
  let runner = createWorkerRunner(board.map);
  let host: Host = createHost(board.map, runner);
  let minimap: Minimap | null = null;
  let detach: (() => void) | null = null;

  let screen: 'start' | 'game' | 'end' = 'start';
  let chosenNation: string | null = null;
  let selection: number | null = null;
  let cityPanel: number | null = null;
  let polityPanel: number | null = null;
  let menuOpen = false;
  let overlay: OverlayKind | null = null;
  const policyState: PolicyOverlayState = { picked: null };
  const politiesState: PolitiesOverlayState = { sort: 'favour', descending: true };
  const trade = createTradeSection();
  let routePath: readonly number[] | null = null;
  let lens: Lens = 'political';
  let scaleSetting: ScaleSetting = loadScaleSetting();
  let scale = 1;
  const animate = options.animate !== false;
  /** The state the board shows, or will show once the animations that are running have ended. */
  let boardState: GameState | null = null;
  let boardLanguage = getLanguage();
  /** The state as of the last change the host reported: what the next change's events start from. */
  let lastState: GameState | null = null;
  let animating = false;
  /** Bumped whenever the running animations stop counting: a newer change, a skip, another game. */
  let playToken = 0;
  /** True once {@link App.hide} was called: the interface then leaves the renderer alone. */
  let hidden = false;
  let enterQueued = false;
  let enterApplied = 0;
  let placing: Placing | null = null;
  /** The city (its zone) whose air strike is being aimed, with the hexes it can hit. */
  let striking: { readonly city: number; readonly hexes: readonly number[] } | null = null;
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
  const majorsBox = el('div', { id: 'majors', class: 'panel' });
  const notesBox = el('div', { id: 'notifications' });
  const overlayBox = el('div', { id: 'overlay', class: 'overlay' });
  const minimapBox = el('div', { id: 'minimap-box', class: 'panel' });
  const selectionBox = el('div', { id: 'selection', class: 'panel' });
  const cityBox = el('aside', { id: 'city-panel', class: 'panel' });
  const polityBox = el('aside', { id: 'polity-panel', class: 'panel' });
  const menuBox = el('div', { id: 'menu', class: 'panel' });
  const actionBox = el('div', { id: 'action-box' });
  const game = el(
    'div',
    { id: 'game' },
    topbar, slots, majorsBox, notesBox, minimapBox, selectionBox, cityBox, polityBox, menuBox, actionBox, overlayBox,
  );
  const toast = el('div', { id: 'toast', class: 'panel' });
  const tooltip = el('div', { id: 'tooltip', class: 'panel' });
  const fileInput = el('input', { id: 'import-file' });
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fill(root, game, startScreen, endScreen, toast, tooltip, fileInput);
  toast.hidden = true;
  tooltip.hidden = true;
  overlayBox.hidden = true;

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

  const flyTo = (hex: number): void => {
    if (hex < 0) return;
    board.renderer.focusHex(hex);
  };

  /** The whole map in view, from a distance worked out from the map itself. */
  const showWholeMap = (): void => {
    board.renderer.setCamera(wholeMapView(map()), true);
  };

  /** Scales the whole interface to the window and the player's setting. */
  const applyScale = (): void => {
    scale = uiScale(scaleSetting, window.innerWidth, window.innerHeight);
    root.style.setProperty('zoom', String(scale));
    root.dataset.scale = String(scale);
  };

  /** Puts the tooltip next to a point of the page. The interface is scaled, the pointer is not. */
  const placeTooltip = (clientX: number, clientY: number): void => {
    tooltip.style.left = `${(clientX + 16) / scale}px`;
    tooltip.style.top = `${(clientY + 16) / scale}px`;
  };

  /** Sends an action of the player and says why if the rules refuse it. */
  const act = (action: Action): boolean => {
    const result = host.act(action);
    if (!result.ok) showToast(rejectText(result.reason));
    return result.ok;
  };

  // -------------------------------------------------------- notifications

  const addNote = (text: () => string, hex: number, offer: NoteOffer | null = null): void => {
    notes.push({ id: nextNoteId++, turn: state().turn, text, hex, offer });
    if (notes.length > MAX_NOTES) notes = notes.slice(notes.length - MAX_NOTES);
  };

  const resourceLabel = (id: string): string => resourceName(map(), id);

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
            notes = notes.filter(
              (note) => note.offer?.kind !== 'peace' || (note.offer.from !== event.a && note.offer.from !== event.b),
            );
            addNote(() => t('note.peace', { a: polityName(m, event.a), b: polityName(m, event.b) }), capitalHex(event.a === me ? event.b : event.a));
          }
          break;
        case 'peaceOffered':
          if (event.to === me) {
            notes = notes.filter((note) => note.offer?.kind !== 'peace' || note.offer.from !== event.from);
            addNote(() => t('note.offer', { a: polityName(m, event.from) }), capitalHex(event.from), {
              kind: 'peace',
              from: event.from,
            });
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
        case 'warJoined':
          if (all || event.polity === me || event.against === me) {
            addNote(
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
            addNote(
              () => t('event.vassalized', { vassal: polityName(m, event.vassal), overlord: polityName(m, event.overlord) }),
              capitalHex(event.vassal),
            );
          }
          break;
        case 'agreementSigned':
          if (event.agreement !== 'vassalage' && (event.a === me || event.b === me)) {
            addNote(
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
            addNote(
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
          addNote(() => t('note.era', { era: eraName(event.era) }), -1);
          break;
        case 'offerMade': {
          const { offer } = event;
          if (offer.to !== me) break;
          addNote(
            () => t('event.offerMade', { from: polityName(m, offer.from), what: offerText(m, offer) }),
            capitalHex(offer.from),
            { kind: 'offer', id: offer.id },
          );
          break;
        }
        case 'vassalReleased':
          if (event.vassal === me || event.overlord === me) {
            addNote(
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
          addNote(
            () =>
              t('event.dealSigned', {
                seller: polityName(m, deal.seller),
                buyer: polityName(m, deal.buyer),
                resource: resourceLabel(deal.resource),
                gold: deal.goldPerTurn,
              }),
            capitalHex(deal.seller === me ? deal.buyer : deal.seller),
          );
          break;
        }
        case 'dealEnded':
          if (event.seller === me || event.buyer === me) {
            addNote(
              () =>
                t('event.dealEnded', {
                  seller: polityName(m, event.seller),
                  buyer: polityName(m, event.buyer),
                  resource: resourceLabel(event.resource),
                  reason: t(`endReason.${event.reason}`),
                }),
              capitalHex(event.seller === me ? event.buyer : event.seller),
            );
          }
          break;
        case 'routeEnded':
          if (event.owner === me && event.reason !== 'cancelled') {
            addNote(
              () => t('event.routeEnded', { owner: polityName(m, event.owner), reason: t(`endReason.${event.reason}`) }),
              -1,
            );
          }
          break;
        case 'routePillaged':
          if (event.owner === me || event.by === me) {
            addNote(
              () => t('event.routePillaged', { by: polityName(m, event.by), owner: polityName(m, event.owner), gold: event.gold }),
              event.hex,
            );
          }
          break;
        case 'improvementPillaged':
          if (event.owner === me || event.by === me) {
            addNote(
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
            addNote(
              () => t('event.suzerainChanged', { cityState: polityName(m, event.cityState), to: polityName(m, event.to) }),
              capitalHex(event.cityState),
            );
          }
          break;
        default:
          break;
      }
    }
  };

  /**
   * Observer mode's camera follows the action: it goes to where a city fell,
   * or else where a war began. Returns the hex it went to, or -1.
   */
  const followEvents = (events: readonly GameEvent[]): number => {
    let hex = -1;
    for (const event of events) {
      if (event.type === 'cityCaptured') {
        hex = siteOf(event.city);
        break;
      }
      if (event.type === 'warDeclared' && hex < 0) hex = capitalHex(event.on);
    }
    flyTo(hex);
    return hex;
  };

  // --------------------------------------------------------------- scene

  const drawHighlights = (): void => {
    const list: HexHighlight[] = [];
    const unit = unitById(selection);
    if (striking !== null) {
      for (const hex of striking.hexes) list.push({ hex, color: VERMILION, opacity: 0.55 });
    } else if (placing !== null) {
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
    board.renderer.setSelectionAids(
      routePath === null || screen !== 'game' ? null : { path: { hexes: routePath }, color: VERMILION },
    );
  };

  /** Puts the current state on the board, ending whatever was playing. */
  const showBoard = (): void => {
    playToken++;
    animating = false;
    boardState = state();
    boardLanguage = getLanguage();
    board.renderer.setScene(sceneOf(boardState, boardLanguage));
  };

  /**
   * A test for the hexes the player is looking at: the box of columns and
   * rows around what the corners and the middle of the canvas show. A view
   * that reaches beyond the map counts as the whole map: the renderer itself
   * leaves out what is not on screen.
   */
  const viewTest = (): ((hex: number) => boolean) => {
    const bounds = board.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return () => false;
    const { width } = map();
    let minCol = Infinity;
    let maxCol = -Infinity;
    let minRow = Infinity;
    let maxRow = -Infinity;
    for (let i = 0; i < VIEW_SAMPLES; i++) {
      for (let j = 0; j < VIEW_SAMPLES; j++) {
        const hex = board.renderer.pickHex(
          bounds.left + ((i + 0.5) / VIEW_SAMPLES) * bounds.width,
          bounds.top + ((j + 0.5) / VIEW_SAMPLES) * bounds.height,
        );
        if (hex === null) return () => true;
        const { col, row } = indexToOffset(hex, width);
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
      }
    }
    return (hex) => {
      const { col, row } = indexToOffset(hex, width);
      return col >= minCol - 2 && col <= maxCol + 2 && row >= minRow - 2 && row <= maxRow + 2;
    };
  };

  /**
   * Shows on the board what the events did, starting from the state they
   * began in, and puts the new state on it when they have played. A newer
   * change, a skip or another game ends them at once.
   *
   * @param around a hex the camera is moving to, or -1: what happens near it counts as in view.
   */
  const present = (before: GameState | null, events: readonly GameEvent[], around = -1): void => {
    const { renderer } = board;
    if (!animate || automated || renderer.paused || before === null || screen !== 'game') {
      showBoard();
      return;
    }
    if (animating) renderer.skip();
    if (animating || boardState !== before) {
      playToken++;
      animating = false;
      boardState = before;
      boardLanguage = getLanguage();
      renderer.setScene(sceneOf(before, boardLanguage));
    }
    const seen = viewTest();
    const visual = visualEvents(before, events, (hex) =>
      seen(hex) || (around >= 0 && hexDistance(before, hex, around) <= FOLLOW_RADIUS),
    );
    if (visual.length === 0) {
      showBoard();
      return;
    }
    const token = ++playToken;
    animating = true;
    boardState = state();
    void renderer.play(visual, { speed: playSpeed(visual.length) * (observing() ? speed : 1) }).then(() => {
      if (token !== playToken) return;
      showBoard();
      drawScene();
      scheduleObserver();
    });
  };

  /** Ends the animations that are playing. Returns false if there were none. */
  const skipAnimations = (): boolean => {
    if (!animating) return false;
    board.renderer.skip();
    showBoard();
    refresh();
    scheduleObserver();
    return true;
  };

  const drawScene = (): void => {
    // while events are playing the board is theirs; it gets the state when they end
    if (!animating && (boardState !== state() || boardLanguage !== getLanguage())) showBoard();
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
    if (
      hex !== null && unit !== undefined && !host.busy && placing === null && striking === null &&
      hex !== unit.hex && unit.owner === player()
    ) {
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
        placeTooltip(clientX, clientY);
      }
    }
    drawHighlights();
  };

  const clickHex = (hex: number, touch: boolean, clientX: number, clientY: number): void => {
    if (screen !== 'game' || host.busy) return;
    menuOpen = false;
    if (striking !== null) {
      const { city, hexes } = striking;
      striking = null;
      if (hexes.includes(hex)) act({ type: 'airStrike', polity: player(), city, target: hex });
      refresh();
      return;
    }
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
    trade.clear(appView);
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
    const right = el(
      'div',
      { class: 'topbar-buttons' },
      button(t('hud.polities'), () => {
        toggleOverlay('polities');
      }, { id: 'polities-button', class: overlay === 'polities' ? 'active' : '' }),
      button(t('hud.victory'), () => {
        toggleOverlay('victory');
      }, { id: 'victory-button', class: overlay === 'victory' ? 'active' : '' }),
      button(t('hud.menu'), () => {
        menuOpen = !menuOpen;
        refresh();
      }, { id: 'menu-button' }),
    );
    fill(topbar, left, middle, right);
  };

  const toggleOverlay = (kind: OverlayKind): void => {
    overlay = overlay === kind ? null : kind;
    menuOpen = false;
    refresh();
  };

  /** The player's current research: its name and the turns it still takes. */
  const researchText = (): string => {
    const research = observing() ? null : researchView(state(), player());
    if (research === null) return '—';
    return research.turns === null
      ? techName(research.tech)
      : t('hud.researching', { tech: techName(research.tech), turns: research.turns });
  };

  /** Culture stored towards the next policy card, over what the card costs. */
  const policyText = (): string => {
    const self = observing() ? undefined : state().polities[player()];
    if (self === undefined) return '—';
    return `${Math.floor(self.cultureProgress)}/${nextPolicyCost(state(), player())}`;
  };

  const drawSlots = (): void => {
    const slot = (id: string, kind: OverlayKind, label: string, value: string): HTMLElement =>
      el(
        'button',
        {
          class: `panel slot${overlay === kind ? ' active' : ''}`,
          id,
          disabled: observing(),
          onClick: () => {
            toggleOverlay(kind);
          },
        },
        el('span', { class: 'stat-label', text: label }),
        value,
      );
    fill(
      slots,
      slot('slot-research', 'tech', t('hud.research'), researchText()),
      slot('slot-policy', 'policy', t('hud.policy'), policyText()),
    );
  };

  /** The major nations, each with its relation to the player; a click opens its panel. */
  const drawMajors = (): void => {
    const s = state();
    const me = player();
    const zh = getLanguage() === 'zh';
    fill(
      majorsBox,
      ...s.majors.map((polity) => {
        const entry = map().polities[polity];
        const name = polityName(map(), polity);
        const alive = s.polities[polity]?.alive === true;
        const standing = me === NO_POLITY || !alive ? null : standingWith(s, me, polity);
        const node = el('button', {
          class: `major${alive ? '' : ' gone'}${polityPanel === polity ? ' active' : ''}`,
          title: standing === null || standing === 'self' ? name : `${name} · ${standingName(standing)}`,
          text: zh ? name.slice(0, 2) : name.slice(0, 3),
          data: { polity, standing: standing ?? '' },
          onClick: () => {
            if (polity === me) flyTo(capitalHex(polity));
            else appView.openPolity(polity);
          },
        });
        node.style.borderTopColor = cssColor(entry?.color ?? 0x888888);
        return node;
      }),
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
        const { offer } = note;
        if (offer !== null) {
          const answer = (accept: boolean): void => {
            if (offer.kind === 'offer') act({ type: 'respond', polity: player(), offer: offer.id, accept });
            else if (accept) act({ type: 'makePeace', polity: player(), target: offer.from });
            else host.declinePeace(offer.from);
            notes = notes.filter((other) => other.id !== note.id);
            refresh();
          };
          row.dataset.offerKind = offer.kind;
          row.append(
            button(t('note.accept'), () => {
              answer(true);
            }, { class: 'accent', data: { offer: 'accept' }, disabled: host.busy }),
            button(t('note.decline'), () => {
              answer(false);
            }, { data: { offer: 'decline' }, disabled: host.busy }),
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
    if (def.strength > 0) {
      const pillage: Action & { unit: number } = { type: 'pillage', polity: me, unit: unit.id };
      const refused = check(state(), pillage);
      // offered where there is something to pillage, even if the unit has no moves left for it
      if (refused === null || refused === 'noMovesLeft') add('pillage', t('action.pillage'), pillage);
      const gates = demandTarget(unit);
      if (gates !== null) add('demandVassalage', t('action.demandVassalage'), gates);
    }
    fill(selectionBox, piece, facts, actions);
  };

  /**
   * The demand a unit can make at the gates of an enemy capital next to it:
   * the one the rules accept, or else the one they refuse only for now (the
   * city has not fallen, the unit has no moves left). Null away from a capital.
   */
  const demandTarget = (unit: Unit): (Action & { unit: number }) | null => {
    const topo = topologyOf(map());
    let later: (Action & { unit: number }) | null = null;
    for (let d = 0; d < 6; d++) {
      const hex = topo.neighbors[unit.hex * 6 + d] as number;
      if (hex < 0 || cityZoneAt(state(), hex) < 0) continue;
      const action = { type: 'demandVassalage', polity: unit.owner, unit: unit.id, target: hex } as const;
      const refused = check(state(), action);
      if (refused === null) return action;
      if (refused === 'cityNotFallen' || refused === 'noMovesLeft') later ??= action;
    }
    return later;
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
    /** A build option with the button that buys it outright next to it. */
    const buyable = (option: BuildOption, key: string, node: HTMLElement): HTMLElement => {
      const action: Action = { type: 'buy', polity: me, city: zone, item: option.item };
      const refused = check(state(), action);
      return el(
        'div',
        { class: 'option-row' },
        node,
        button(t('city.buy', { gold: buyCostOf(state(), zone, option.item) }), () => {
          act(action);
          refresh();
        }, {
          class: 'buy',
          data: { buy: key },
          disabled: refused !== null || host.busy,
          ...(refused === null ? {} : { title: rejectText(refused) }),
        }),
      );
    };
    const strikes = city.buildings.some((id) => BUILDINGS[id].airStrike);
    const strikeHexes = strikes ? airStrikeTargets(state(), zone) : [];
    const aiming = striking !== null && striking.city === zone;

    const header = el(
      'header',
      {},
      el('h2', { id: 'city-name', text: cityName(map(), zone) }),
      button('×', () => {
        cityPanel = null;
        placing = null;
        striking = null;
        trade.clear(appView);
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
      strikes &&
        button(t('city.airStrike'), () => {
          striking = aiming ? null : { city: zone, hexes: strikeHexes };
          placing = null;
          clearHover();
          refresh();
        }, {
          id: 'city-airstrike',
          class: aiming ? 'active' : '',
          data: { targets: strikeHexes.length },
          disabled: host.busy || strikeHexes.length === 0,
          ...(city.airStruck ? { title: rejectText('alreadyStruck') } : strikeHexes.length === 0 ? { title: rejectText('noTarget') } : {}),
        }),
      el('h3', { text: t('city.focus') }),
      focusRow,
      el('h3', { text: t('city.queue') }),
      queueList,
      group(t('city.units'), 'build-units', view.units.map((option) => {
        const key = `unit:${option.item.kind === 'unit' ? option.item.unit : ''}`;
        return buyable(option, key, optionButton(itemName(map(), option.item), option, key, queue(option.item)));
      })),
      group(t('city.buildings'), 'build-buildings', view.buildings.map((option) => {
        const key = `building:${option.item.kind === 'building' ? option.item.building : ''}`;
        const name = option.item.kind === 'building' ? buildingName(option.item.building) : '';
        return buyable(option, key, optionButton(name, option, key, queue(option.item)));
      })),
      group(t('city.improvements'), 'build-improvements', view.improvements.map((option) => {
        const gains = IMPROVEMENTS[option.improvement].yields;
        const gain = (['food', 'production', 'gold'] as const)
          .filter((name) => gains[name] !== 0)
          .map((name) => `${signed(gains[name])}${yieldName(name)}`)
          .join(' ');
        const active = placing !== null && placing.city === zone && placing.improvement === option.improvement;
        return optionButton(`${improvementName(option.improvement)} ${gain}`, option, `improvement:${option.improvement}`, () => {
          placing = active ? null : { city: zone, improvement: option.improvement, hexes: option.hexes };
          striking = null;
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
      trade.draw(appView, zone),
    );
    // redrawing must not throw the player back to the top of a long panel
    const scrolled = cityBox.querySelector('.scroll')?.scrollTop ?? 0;
    fill(cityBox, header, body);
    body.scrollTop = scrolled;
  };

  const drawPolityPanel = (): void => {
    const nodes =
      polityPanel === null
        ? null
        : polityPanelNodes(appView, polityPanel, () => {
            polityPanel = null;
            refresh();
          });
    polityBox.hidden = nodes === null;
    if (nodes === null) return;
    const scrolled = polityBox.querySelector('.scroll')?.scrollTop ?? 0;
    fill(polityBox, ...nodes);
    const body = polityBox.querySelector('.scroll');
    if (body !== null) body.scrollTop = scrolled;
  };

  const drawOverlay = (): void => {
    if (screen !== 'game' || (observing() && (overlay === 'tech' || overlay === 'policy'))) overlay = null;
    overlayBox.hidden = overlay === null;
    overlayBox.dataset.overlay = overlay ?? '';
    if (overlay === null) {
      fill(overlayBox);
      return;
    }
    const scrolled = overlayBox.querySelector('.scroll');
    const top = scrolled?.scrollTop ?? 0;
    const left = scrolled?.scrollLeft ?? 0;
    const node =
      overlay === 'tech'
        ? techOverlay(appView)
        : overlay === 'policy'
          ? policyOverlay(appView, policyState)
          : overlay === 'polities'
            ? politiesOverlay(appView, politiesState)
            : victoryOverlay(appView);
    fill(overlayBox, node);
    const body = node.querySelector('.scroll');
    if (body !== null) {
      body.scrollTop = top;
      body.scrollLeft = left;
    }
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
    return { kind: next.kind, label: pendingLabel(item), item };
  };

  const pendingLabel = (item: PendingItem): string => {
    switch (item.kind) {
      case 'unit':
        return t('main.unit', { name: unitName(unitById(item.unit)?.type ?? '') });
      case 'city':
        return t('main.city', { name: cityName(map(), item.city) });
      case 'research':
        return t('main.research');
      case 'policy':
        return t('main.policy');
      case 'offer':
        return t('main.offer', { name: polityName(map(), item.from) });
      case 'peace':
        return t('main.peace', { name: polityName(map(), item.from) });
    }
  };

  const scheduleObserver = (): void => {
    if (observerTimer !== null) {
      window.clearTimeout(observerTimer);
      observerTimer = null;
    }
    if (screen !== 'game' || !observing() || paused || automated || animating || host.busy || state().result !== null) return;
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
        striking = null;
        overlay = null;
        trade.clear(appView);
        clearHover();
        void host.endTurn();
        return;
      case 'none':
      case 'busy':
        return;
      default: {
        const { item } = current;
        if (item === null) return;
        focus = item;
        polityPanel = null;
        placing = null;
        striking = null;
        overlay = null;
        menuOpen = false;
        trade.clear(appView);
        switch (item.kind) {
          case 'unit':
            select(item.unit);
            cityPanel = null;
            flyTo(item.hex);
            break;
          case 'city':
            select(null);
            cityPanel = item.city;
            flyTo(item.hex);
            break;
          case 'research':
            overlay = 'tech';
            break;
          case 'policy':
            overlay = 'policy';
            break;
          case 'offer':
          case 'peace':
            select(null);
            cityPanel = null;
            polityPanel = item.from;
            flyTo(capitalHex(item.from));
            break;
        }
      }
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
    overlay = null;
    policyState.picked = null;
    placing = null;
    striking = null;
    routePath = null;
    focus = null;
    notes = [];
    paused = false;
    enterQueued = false;
    lastState = state();
    if (state().result === null) writeAutosave(board.source, state());
    // the game opens on the player's capital with its zone in view; an observer sees the whole map
    const home = observing() ? -1 : capitalHex(player());
    if (home >= 0) board.renderer.focusHex(home, { frame: 'zone', immediate: true });
    else showWholeMap();
    showBoard();
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
    overlay = null;
    placing = null;
    striking = null;
    routePath = null;
    notes = [];
    lastState = null;
    showWholeMap();
    showBoard();
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
    // the names on the political map follow the interface
    board.renderer.setLanguage(next);
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
      el('h3', { text: t('menu.scale') }),
      el(
        'div',
        { class: 'segmented', id: 'menu-scale', data: { scale } },
        ...SCALE_SETTINGS.map((setting) => {
          const key: TranslationKey = `scale.${setting}`;
          return button(t(key), () => {
            scaleSetting = setting;
            saveScaleSetting(setting);
            applyScale();
            refresh();
          }, { class: setting === scaleSetting ? 'active' : '', data: { scale: setting } });
        }),
      ),
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
    drawMajors();
    drawNotes();
    drawSelection();
    drawCityPanel();
    drawPolityPanel();
    drawMenu();
    drawAction();
    drawOverlay();
    drawLenses();
    minimap?.draw(state(), lens, player());
  }

  const lensBar = el('div', { class: 'segmented', id: 'lenses' });
  const drawLenses = (): void => {
    fill(
      lensBar,
      ...LENSES.map((entry) => {
        const key: TranslationKey = `lens.${entry}`;
        return button(t(key), () => {
          lens = entry;
          refresh();
        }, { class: entry === lens ? 'active' : '', data: { lens: entry }, disabled: entry === 'diplomacy' && observing() });
      }),
    );
  };

  /** What the panels and overlays get from the application. */
  const appView: View = {
    get state() {
      return state();
    },
    get map() {
      return map();
    },
    get player() {
      return player();
    },
    get busy() {
      return host.busy;
    },
    act,
    declinePeace(polity) {
      host.declinePeace(polity);
    },
    refresh,
    flyTo,
    openPolity(polity) {
      select(null);
      cityPanel = null;
      placing = null;
      striking = null;
      trade.clear(appView);
      polityPanel = polity;
      flyTo(capitalHex(polity));
      refresh();
    },
    closeOverlay() {
      overlay = null;
      refresh();
    },
    previewPath(hexes) {
      routePath = hexes;
      const middle = hexes === null ? undefined : hexes[Math.floor(hexes.length / 2)];
      if (middle !== undefined) flyTo(middle);
      drawHighlights();
    },
  };

  /** Drops what the new state no longer has, and moves to the end screen once there is a result. */
  const settle = (): void => {
    const s = state();
    const me = player();
    if (selection !== null && unitById(selection)?.owner !== me) select(null);
    if (cityPanel !== null && s.cities[cityPanel]?.owner !== me) cityPanel = null;
    if (placing !== null && cityPanel !== placing.city) placing = null;
    if (striking !== null && cityPanel !== striking.city) striking = null;
    if (cityPanel === null) trade.clear(appView);
    if (polityPanel !== null && s.polities[polityPanel]?.alive !== true) polityPanel = null;
    notes = notes.filter((note) => {
      const { offer } = note;
      if (offer === null) return s.turn - note.turn < NOTE_TURNS;
      // a note with an answer stays for as long as the offer stands
      if (offer.kind === 'offer') return s.offers.some((entry) => entry.id === offer.id);
      return relationView(s, me, offer.from).kind === 'war' && s.turn - note.turn < NOTE_TURNS;
    });
    if (s.result !== null && screen === 'game') {
      screen = 'end';
      menuOpen = false;
      clearAutosave(board.source);
    }
  };

  const onChange = (change: HostChange): void => {
    const before = lastState;
    lastState = state();
    switch (change.kind) {
      case 'started':
        playToken++;
        animating = false;
        return;
      case 'action':
        collect(change.events);
        settle();
        present(before, change.events);
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
        present(before, change.events, observing() ? followEvents(change.events) : -1);
        refresh();
        return;
      case 'busy':
        if (!host.busy && host.playing) {
          if (state().result === null) writeAutosave(board.source, state());
          settle();
        }
        refresh();
        scheduleObserver();
        if (!host.busy && enterQueued) {
          // the press of Enter that came while the others were moving
          enterQueued = false;
          if (screen === 'game' && !observing()) {
            enterApplied++;
            mainAction();
          }
        }
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
        if (screen === 'game' && !host.busy && placing === null && striking === null) orderTo(hex);
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
        placeTooltip(event.clientX, event.clientY);
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
    fill(minimapBox, minimap.element, lensBar);
    const small = minimap;
    const stopFrames = renderer.onFrame(() => {
      const camera = renderer.getCamera();
      small.setCamera(camera.x, camera.z);
    });
    const unsubscribe = host.subscribe(onChange);
    renderer.setLanguage(getLanguage());
    boardState = null;
    lastState = null;
    playToken++;
    animating = false;
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
      trade.clear(appView);
      attach();
      options.onBoard?.(board);
    }
    const observe = start.observe === true || start.nation === undefined || start.nation === null;
    const seed = start.seed ?? Math.floor(Math.random() * 0x7fffffff);
    host.start({ seed, player: observe ? null : (start.nation ?? null) });
    enterGame();
  }

  const typing = (event: KeyboardEvent): boolean => {
    const target = event.target;
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    );
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (hidden || typing(event) || screen !== 'game') return;
      if (event.key === 'Enter') {
        // Enter is the main button wherever the focus is, and only once per press
        event.preventDefault();
        if (event.repeat) return;
        // while the others move, one press is kept and applied when they are done
        if (host.busy && !observing()) enterQueued = true;
        else mainAction();
      } else if (event.key === ' ') {
        // held, Space hurries the animations; it never presses the button that has the focus
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (!event.repeat) board.renderer.setAnimationSpeed(HURRY);
      } else if (event.key === 'Escape') {
        if (skipAnimations()) return;
        if (overlay !== null) overlay = null;
        else if (striking !== null) striking = null;
        else if (placing !== null) placing = null;
        else if (menuOpen) menuOpen = false;
        else if (trade.selected !== null) trade.clear(appView);
        else if (cityPanel !== null || polityPanel !== null) {
          cityPanel = null;
          polityPanel = null;
        } else select(null);
        refresh();
      } else if ((event.key === 't' || event.key === 'T') && !observing()) {
        toggleOverlay('tech');
      } else if ((event.key === 'p' || event.key === 'P') && !observing()) {
        toggleOverlay('policy');
      }
    },
    { capture: true },
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key !== ' ' || hidden || screen !== 'game') return;
      board.renderer.setAnimationSpeed(1);
      if (!typing(event)) event.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener('blur', () => {
    if (!hidden && screen === 'game') board.renderer.setAnimationSpeed(1);
  });
  window.addEventListener('resize', () => {
    // hidden, the renderer belongs to somebody else (the render demo)
    if (hidden) return;
    const before = scale;
    applyScale();
    if (scale !== before) refresh();
  });

  applyScale();
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
        overlay: screen === 'game' ? overlay : null,
        lens,
        scale: { setting: scaleSetting, factor: scale },
        animating,
        targeting: striking !== null ? 'airStrike' : placing !== null ? 'improvement' : 'select',
        routePreview: trade.selected,
        enterApplied,
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
        lastState = state();
        showBoard();
        refresh();
        scheduleObserver();
      }
    },
    hide() {
      hidden = true;
      root.hidden = true;
    },
  };
}
