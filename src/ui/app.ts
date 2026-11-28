/**
 * The game's interface in plain DOM: start screen, HUD, panels, end screen
 * and the input on the map. It never changes the game state: every change
 * goes to the {@link Host} as an action, and the page is redrawn from the
 * state that comes back.
 */

import { BUILDINGS, DEFAULT_DIFFICULTY, DIFFICULTY_LEVELS, FOCUSES, IMPROVEMENTS, PROJECT, SETTLER, unitDef } from '../core/data.ts';
import type { DifficultyLevel, Yields } from '../core/data.ts';
import { NO_POLITY, currentEra, hexOwner, nextPolicyCost } from '../core/game.ts';
import type { Action, GameEvent, GameState, Unit } from '../core/game.ts';
import { buyCostOf, hexDistance, offerObstacle } from '../core/query.ts';
import type { HexHighlight, Renderer, SelectionAids } from '../render/scene.ts';
import { indexToOffset } from '../shared/hex.ts';
import { getLanguage, setLanguage, t } from '../shared/i18n.ts';
import type { TranslationKey } from '../shared/i18n.ts';
import type { MapData } from '../shared/mapData.ts';
import { orderAids } from './aids.ts';
import { playSpeed, visualEvents } from './animation.ts';
import { pieceOf, remember, sceneOf, wholeMapView } from './board.ts';
import type { BoardMemory, BoardView } from './board.ts';
import { createTradeSection } from './cityTrade.ts';
import { levelEffect, levelName } from './difficulty.ts';
import { cardLines, hexCard } from './hexCard.ts';
import type { HexCard, Knowledge } from './hexCard.ts';
import { standingWith, vassalRoomText } from './diplomacy.ts';
import { button, el, fill, fillWhen, iconButton, iconOnly, stat } from './dom.ts';
import { focusMove, trapIndex } from './focus.ts';
import { createHost } from './host.ts';
import type { Host, HostChange, RunReport } from './host.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import { NATION_SORTS, kitViewOf, listNations, nationEntries, regionsOf } from './kit.ts';
import type { NationEntry, NationSort } from './kit.ts';
import { beyondSupply, capitalLines, supplyOf, supplyWarning } from './balance.ts';
import { difficultyMark, kitRows } from './kitPanel.ts';
import { LENSES } from './lens.ts';
import type { Lens } from './lens.ts';
import { createMinimap } from './minimap.ts';
import type { Minimap } from './minimap.ts';
import {
  buildingName,
  cityName,
  eraName,
  focusName,
  improvementName,
  itemName,
  polityName,
  regionName,
  rejectText,
  saveErrorText,
  techName,
  unitName,
  yieldName,
} from './names.ts';
import { canPoint, keepNotes, noteDrafts, pendingDrafts } from './notes.ts';
import { createWatcher, followTarget } from './observer.ts';
import type { NoteOffer } from './notes.ts';
import { policyOverlay, politiesOverlay, standingName, techOverlay, victoryOverlay } from './overlays.ts';
import type { OverlayKind, PolicyOverlayState, PolitiesOverlayState } from './overlays.ts';
import { attackReach, findPath, previewAttack, reachableHexes } from './path.ts';
import type { Path } from './path.ts';
import { mainButton } from './pending.ts';
import type { PendingItem, PendingKind } from './pending.ts';
import { polityPanel as polityPanelNodes } from './polityPanel.ts';
import {
  check,
  cityView,
  cityZoneAt,
  demandAction,
  pillageAction,
  politySummary,
  ranking,
  relationView,
  researchView,
  upgradeView,
} from './rules.ts';
import type { BuildOption } from './rules.ts';
import type { Region } from './names.ts';
import { MAX_SAVE_BYTES, exportSave, importSave } from './saves.ts';
import { SCALE_SETTINGS, uiScale } from './scale.ts';
import { settlerSites } from './settle.ts';
import type { SettlerSite } from './settle.ts';
import type { ScaleSetting } from './scale.ts';
import { ANIMATION_SPEEDS, QUALITY_OPTIONS, VOLUME_STEP, browserStorage, createSettingsStore } from './settings.ts';
import type { Settings } from './settings.ts';
import { browserAudio, createSoundEngine, cuesFor, gameSound } from './sound.ts';
import { inSight, knownState, sightOf, strikeTargets } from './sight.ts';
import { clearAutosave, readAutosave, readMemory, writeAutosave, writeMemory } from './storage.ts';
import { conversionText, counted, gainText, majorRows, perTurnText, turnsText } from './text.ts';
import type { MapSource } from './storage.ts';
import { LONG_PRESS_MS, isTap, tapTarget } from './touchOrder.ts';
import type { Press } from './touchOrder.ts';
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
  /**
   * False to make no sound at all: the page passes false under automation,
   * and the interface then never creates an audio context. Default true.
   */
  readonly sound?: boolean;
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
  /** The difficulty level. Default: the one chosen on the start screen, which starts at the middle one. */
  readonly difficulty?: DifficultyLevel;
}

export type MainButtonKind = 'none' | 'busy' | 'observer' | 'nextTurn' | PendingKind;

/** What the interface shows, for automated checks. */
export interface UiSnapshot {
  readonly screen: 'start' | 'game' | 'end';
  /** The panel that is open, the topmost if there are several. `kit` is the player's own kit view. */
  readonly panel: 'menu' | 'kit' | 'city' | 'polity' | null;
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
  /**
   * Observer mode's controls, or null in a player's game. `watching` is the
   * hex its camera went to for an event and has not come back from, or null;
   * `returns` counts the times it came back to the view it had left.
   */
  readonly observer: {
    readonly paused: boolean;
    readonly speed: number;
    readonly watching: number | null;
    readonly returns: number;
  } | null;
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
  /**
   * The kit on screen, by the nation's `MapPolity.id`, and where it is shown:
   * on the start screen for the highlighted nation, in the player's own kit
   * view, or in the panel of another nation. Null if none is shown.
   */
  readonly kit: { readonly nation: string; readonly where: 'start' | 'own' | 'polity' } | null;
  /**
   * Nation select: the region filter, the order, the nations listed, the
   * highlighted one and the difficulty level a game would start at. Null
   * away from the start screen.
   */
  readonly start: {
    readonly region: Region | 'all';
    readonly sort: NationSort;
    readonly nations: readonly string[];
    readonly chosen: string | null;
    readonly difficulty: DifficultyLevel;
  } | null;
  /** The settings in force. */
  readonly settings: Settings;
  /** The sound engine: silent under automation, locked until the first gesture. */
  readonly sound: { readonly silent: boolean; readonly unlocked: boolean; readonly volume: number; readonly muted: boolean; readonly era: number };
  /**
   * The aids drawn for ordering the selected piece: how many hexes it can
   * reach, the length of the path under the pointer with the turns marked on
   * it, and the hex an order would attack. Null without a selected piece.
   */
  readonly aids: {
    readonly reachable: number;
    readonly path: number;
    readonly turnEnds: number;
    readonly attackTarget: number | null;
  } | null;
  /**
   * Fog of war on the board as the renderer has it: whether the scene has
   * fog (a player's game; never the observer's), how many units of the
   * state it leaves out because the player does not see them, and how many
   * units of other polities are on it.
   */
  readonly fog: { readonly on: boolean; readonly hiddenUnits: number; readonly foreignUnits: number };
  /**
   * The details card on screen: the hex it is about, how well the player
   * knows the hex, the ids of the units and the zone of the city it names,
   * what brought it up (the pointer at rest, or a long press) and its text.
   * Null while no card is shown.
   */
  readonly card: {
    readonly hex: number;
    readonly knowledge: Knowledge;
    readonly units: readonly number[];
    readonly city: number | null;
    readonly by: 'hover' | 'press';
    readonly text: string;
  } | null;
  /** The hex a first tap left pending as the target of an order (touch), or null. */
  readonly touchTarget: number | null;
  /** Orders given by a confirming second tap since the page was loaded. */
  readonly touchOrders: number;
  /**
   * The free city sites marked on the map and on the minimap for the
   * selected settler, with the turns it needs to each. Null unless a
   * settler of the player is selected.
   */
  readonly settleSites: readonly { readonly hex: number; readonly turns: number }[] | null;
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
/** The map's own gold, as on a unique unit's piece: it marks the sites a settler can settle. */
const GOLD = 0xf3cb52;
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

/** Milliseconds the pointer must rest on a hex before its details are shown. */
const REST_MS = 350;
/** How much faster animations run while Space is held. */
const HURRY = 4;
/** The view is sampled at this many points a side to find the hexes in it. */
const VIEW_SAMPLES = 5;
/** Observer mode's camera has this many hexes around its target in view once it has moved there. */
const FOLLOW_RADIUS = 8;

/** True if two camera states show the same view. */
function sameView(a: ReturnType<Renderer['getCamera']>, b: ReturnType<Renderer['getCamera']>): boolean {
  return a.x === b.x && a.z === b.z && a.distance === b.distance && a.yaw === b.yaw;
}

export function createApp(options: AppOptions): App {
  const { root } = options;
  const settings = createSettingsStore(browserStorage());
  setLanguage(settings.current.language);
  const sound = createSoundEngine({
    createContext: browserAudio(),
    silent: options.sound === false,
    volume: settings.current.volume,
    muted: settings.current.muted,
  });

  let board = options.board;
  let runner = createWorkerRunner(board.map);
  let host: Host = createHost(board.map, runner);
  let minimap: Minimap | null = null;
  let detach: (() => void) | null = null;

  let screen: 'start' | 'game' | 'end' = 'start';
  let chosenNation: string | null = null;
  let startRegion: Region | 'all' = 'all';
  let startSort: NationSort = 'region';
  /** The difficulty level picked on the start screen. */
  let startLevel: DifficultyLevel = DEFAULT_DIFFICULTY;
  /** The player's own kit view. */
  let kitOpen = false;
  /** True while the player moves through the controls with the keyboard: Enter and Space then press the control in focus. */
  let keyboardNav = false;
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
  let scale = 1;
  const animate = options.animate !== false;
  /** The state the board shows, or will show once the animations that are running have ended. */
  let boardState: GameState | null = null;
  let boardLanguage = getLanguage();
  /** What the player remembers of the board out of their sight; null until they have looked, and for the observer. */
  let memory: BoardMemory | null = null;
  /** The scene the renderer was last given: whether it had fog, and how many units of its state it left out. */
  let shown = { fog: false, hidden: 0, foreign: 0 };
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
  /** The camera as the last frame drew it, and whether that differed from the frame before: it is moving. */
  let lastCamera: ReturnType<Renderer['getCamera']> | null = null;
  let cameraMoving = false;
  /** Turns are being run by a caller of {@link App.runTurns}: observer mode's own clock stands still. */
  let automated = false;
  let hoverHex: number | null = null;
  /** The order under the pointer: the way there and the hex it would attack. */
  let hoverPlan: { readonly path: Path | null; readonly attack: number | null } | null = null;
  let aidsShown: UiSnapshot['aids'] = null;
  let reach: number[] = [];
  let reachKey = '';
  /** The free city sites in reach of the selected settler; null unless a settler of the player is selected. */
  let sites: SettlerSite[] | null = null;
  let touchTarget: number | null = null;
  let touchOrders = 0;
  /** The details card on screen. */
  let cardShown: { readonly card: HexCard; readonly by: 'hover' | 'press'; readonly text: string } | null = null;
  let restTimer: number | null = null;
  /** The layer that held the focus at the last redraw: an overlay's kind, `end` for the end screen, or null. */
  let heldLayer: string | null = null;
  /** The control that had the focus when that layer opened: it gets the focus back when the layer closes. */
  let opener: string | null = null;
  let lastBurstRefresh = 0;
  let toastTimer: number | null = null;

  // ------------------------------------------------------------ skeleton

  const startScreen = el('div', { id: 'start', class: 'cover' });
  const endScreen = el('div', { id: 'end', class: 'overlay' });
  const topbar = el('div', { id: 'topbar', class: 'panel' });
  const topLeft = el('div', { class: 'stats' });
  const topMiddle = el('div', { id: 'turn' });
  // the buttons of the top bar are made once: a redraw changes their text and state, never the nodes
  const politiesButton = iconButton('polities', '', () => {
    toggleOverlay('polities');
  }, { id: 'polities-button' });
  const victoryButton = iconButton('victory', '', () => {
    toggleOverlay('victory');
  }, { id: 'victory-button' });
  const menuButton = iconButton('menu', '', () => {
    menuOpen = !menuOpen;
    refresh();
  }, { id: 'menu-button' });
  topbar.append(topLeft, topMiddle, el('div', { class: 'topbar-buttons' }, politiesButton, victoryButton, menuButton));
  const slots = el('div', { id: 'slots' });
  const kitBox = el('aside', { id: 'kit-panel', class: 'panel' });
  const majorsBox = el('div', { id: 'majors', class: 'panel' });
  const notesBox = el('div', { id: 'notifications' });
  const overlayBox = el('div', { id: 'overlay', class: 'overlay' });
  const minimapBox = el('div', { id: 'minimap-box', class: 'panel' });
  const selectionBox = el('div', { id: 'selection', class: 'panel' });
  const cityBox = el('aside', { id: 'city-panel', class: 'panel' });
  const polityBox = el('aside', { id: 'polity-panel', class: 'panel' });
  const menuBox = el('div', { id: 'menu', class: 'panel' });
  const speedButtons = SPEEDS.map((value) =>
    button('', () => {
      speed = value;
      scheduleObserver();
      refresh();
    }, { data: { speed: value } }),
  );
  const speedBox = el('div', { class: 'segmented panel', id: 'speed' }, ...speedButtons);
  const mainNode = button('', () => {
    mainAction();
  }, { id: 'main-action' });
  const actionBox = el('div', { id: 'action-box' }, speedBox, mainNode);
  const game = el(
    'div',
    { id: 'game' },
    topbar, slots, majorsBox, notesBox, minimapBox, selectionBox, kitBox, cityBox, polityBox, menuBox, actionBox, overlayBox,
  );
  const toast = el('div', { id: 'toast', class: 'panel' });
  const tooltip = el('div', { id: 'tooltip', class: 'panel' });
  const cardBox = el('div', { id: 'hex-card', class: 'panel' });
  const fileInput = el('input', { id: 'import-file' });
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fill(root, game, startScreen, endScreen, toast, tooltip, cardBox, fileInput);
  toast.hidden = true;
  tooltip.hidden = true;
  cardBox.hidden = true;
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

  /**
   * Observer mode's camera at the events (see {@link createWatcher}). The
   * board is read at each call: another map brings another renderer.
   */
  const watcher = createWatcher<ReturnType<Renderer['getCamera']>>(
    {
      view: () => board.renderer.getCamera(),
      // a paused renderer draws no frame and its camera stands still
      moving: () => cameraMoving && !board.renderer.paused,
      goTo(hex) {
        board.renderer.focusHex(hex, { frame: 'zone' });
      },
      restore(view) {
        board.renderer.setCamera(view);
      },
    },
    { set: (callback, ms) => window.setTimeout(callback, ms), clear: (id) => window.clearTimeout(id) },
  );

  /** The viewer moves the camera themselves: observer mode does not take it back from there. */
  const takeCamera = (): void => {
    watcher.take();
    // on its way from the next frame on: until it has come to rest, its view is not one to return to
    cameraMoving = true;
  };

  const flyTo = (hex: number): void => {
    if (hex < 0) return;
    takeCamera();
    board.renderer.focusHex(hex);
  };

  /**
   * Moves the camera by itself, to show the player something: under fog
   * never to a hex they have not seen. Where the player looks of their own
   * accord (the minimap, a drag) is theirs to choose.
   */
  const pointAt = (hex: number): void => {
    if (canPoint(state(), sightOf(state()), hex)) flyTo(hex);
  };

  /** The whole map in view, from a distance worked out from the map itself. */
  const showWholeMap = (): void => {
    board.renderer.setCamera(wholeMapView(map()), true);
  };

  /** Scales the whole interface to the window and the player's setting. */
  const applyScale = (): void => {
    scale = uiScale(settings.current.scale, window.innerWidth, window.innerHeight);
    root.style.setProperty('zoom', String(scale));
    root.dataset.scale = String(scale);
    // the styles size touch targets in pixels of the screen: they divide by the scale
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  };

  /** Puts the settings in force: on the renderer of the current board, on the sound and on the interface. */
  const applySettings = (): void => {
    const now = settings.current;
    setLanguage(now.language);
    sound.setVolume(now.volume);
    sound.setMuted(now.muted);
    applyScale();
    // hidden, the renderer belongs to somebody else (the render demo)
    if (hidden) return;
    const { renderer } = board;
    // the names on the political map follow the interface
    renderer.setLanguage(now.language);
    if (renderer.quality !== now.quality) renderer.setQuality(now.quality);
    renderer.setAnimationSpeed(now.animationSpeed);
  };

  const changeSettings = (change: Partial<Settings>): void => {
    settings.set(change);
    applySettings();
    refresh();
  };

  /** The close button of a panel or an overlay. */
  const closeButton = (id: string, onClick: () => void): HTMLButtonElement =>
    iconOnly('close', t('menu.close'), onClick, { class: 'close', id });

  /** Puts the tooltip next to a point of the page. The interface is scaled, the pointer is not. */
  const placeTooltip = (clientX: number, clientY: number): void => {
    tooltip.style.left = `${(clientX + 16) / scale}px`;
    tooltip.style.top = `${(clientY + 16) / scale}px`;
  };

  const hideCard = (): void => {
    if (restTimer !== null) window.clearTimeout(restTimer);
    restTimer = null;
    if (cardShown === null) return;
    cardShown = null;
    cardBox.hidden = true;
  };

  /**
   * Shows the details of a hex next to a point of the page: under the
   * pointer at rest, above the finger of a long press. Only what the player
   * knows goes on it.
   */
  const showCard = (hex: number, clientX: number, clientY: number, by: 'hover' | 'press'): void => {
    writeCard(hex, by);
    // beside the pointer and clear of the order preview; above a finger, which would cover it
    const width = cardBox.offsetWidth;
    const height = cardBox.offsetHeight;
    const maxX = window.innerWidth / scale - width - 8;
    const maxY = window.innerHeight / scale - height - 8;
    const x = by === 'press' ? clientX / scale - width / 2 : clientX / scale + 16;
    const below = (clientY + 16) / scale + (tooltip.hidden ? 0 : tooltip.offsetHeight + 4);
    const above = clientY / scale - height - 28;
    const y = by === 'hover' ? below : above < 8 ? clientY / scale + 28 : above;
    cardBox.style.left = `${Math.max(8, Math.min(maxX, x))}px`;
    cardBox.style.top = `${Math.max(8, Math.min(maxY, y))}px`;
  };

  /** Fills the card with what the player knows about `hex` now, and shows it where it is. */
  const writeCard = (hex: number, by: 'hover' | 'press'): void => {
    const card = hexCard(state(), hex, viewOf(state()));
    const lines = cardLines(card, map(), host.orders);
    cardShown = { card, by, text: lines.map((line) => line.parts.join(' · ')).join('\n') };
    fill(
      cardBox,
      ...lines.map((line) => {
        const row = el('div', { class: `card-line card-${line.kind}`, data: { line: line.kind } });
        if (line.unit !== undefined) {
          const look = pieceOf(line.unit.type);
          row.append(
            el('span', { class: `piece mini${look.unique ? ' unique' : ''}`, text: look.character, data: { era: look.era } }),
          );
        }
        line.parts.forEach((part, index) => {
          const named = index === 0 && (line.kind === 'unit' || line.kind === 'city');
          row.append(el('span', { class: named ? 'title' : line.kind === 'owner' || index > 0 ? 'card-aside' : '', text: part }));
        });
        if (line.polity !== undefined) row.style.setProperty('--nation', cssColor(map().polities[line.polity]?.color ?? 0x888888));
        return row;
      }),
    );
    cardBox.dataset.hex = String(hex);
    cardBox.dataset.knowledge = card.knowledge;
    cardBox.dataset.by = by;
    cardBox.hidden = false;
  };

  /** Sends an action of the player and says why if the rules refuse it. */
  const act = (action: Action): boolean => {
    const result = host.act(action);
    if (!result.ok) showToast(rejectText(result.reason));
    // the rules took the answer and refused the deal: the proposal still waits, and the player is told why
    else for (const event of result.events) if (event.type === 'offerRefused') showToast(rejectText(event.reason));
    return result.ok;
  };

  // -------------------------------------------------------- notifications

  const addNote = (text: () => string, hex: number, offer: NoteOffer | null = null): void => {
    notes.push({ id: nextNoteId++, turn: state().turn, text, hex, offer });
    notes = keepNotes(notes, MAX_NOTES);
  };

  const capitalHex = (polity: number): number => {
    const zone = state().polities[polity]?.capital ?? -1;
    return siteOf(zone >= 0 ? zone : (map().polities[polity]?.capitalZone ?? -1));
  };

  /** Turns the events that matter to whoever is watching, and that they can know of, into notifications. */
  const collect = (events: readonly GameEvent[]): void => {
    for (const draft of noteDrafts(state(), events, sightOf(state()), state)) {
      const { settles } = draft;
      if (settles.length > 0) {
        notes = notes.filter((note) => note.offer?.kind !== 'peace' || !settles.includes(note.offer.from));
      }
      addNote(draft.text, draft.hex, draft.offer);
    }
  };

  /**
   * Observer mode's camera follows the action: it goes to where a city fell,
   * or else where a war began, close enough to show the city and its land,
   * stays a moment and goes back to the view it left. Returns the hex it
   * went to, or -1: also while the observer is moving the camera themselves,
   * which is then left to them.
   */
  const followEvents = (events: readonly GameEvent[]): number => {
    const hex = followTarget(events, siteOf, capitalHex);
    return hex >= 0 && watcher.follow(hex) ? hex : -1;
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
      const order = host.orders.get(unit.id);
      if (order !== undefined) list.push({ hex: order.target, color: VERMILION, opacity: 0.3 });
      // where a selected settler can found a city
      for (const site of sites ?? []) list.push({ hex: site.hex, color: GOLD, opacity: 0.6 });
      list.push({ hex: unit.hex, color: VERMILION, opacity: 0.65 });
    }
    board.renderer.setHighlights(list);

    // one set of aids at a time: the trade route being chosen, or else the order of the selected piece
    let aids: SelectionAids | null = null;
    aidsShown = null;
    if (screen === 'game' && routePath !== null) {
      aids = { path: { hexes: routePath }, color: VERMILION };
    } else if (screen === 'game' && unit !== undefined && unit.owner === player() && placing === null && striking === null) {
      aids = orderAids({ unitHex: unit.hex, reach, path: hoverPlan?.path ?? null, attackTarget: hoverPlan?.attack ?? null });
      aidsShown = {
        reachable: aids.reachable?.length ?? 0,
        path: aids.path?.hexes.length ?? 0,
        turnEnds: aids.path?.turnEnds?.length ?? 0,
        attackTarget: aids.attackTarget ?? null,
      };
    }
    board.renderer.setSelectionAids(aids);
  };

  /** The player's sight of a state with what they remember, or null for the observer, who sees everything. */
  const viewOf = (s: GameState): BoardView | null => {
    const sight = sightOf(s);
    if (sight === null) return null;
    memory ??= remember(null, s, sight);
    return { sight, memory };
  };

  /** The player looks at the current state: what is in sight joins what they remember. */
  const look = (): void => {
    const sight = sightOf(state());
    memory = sight === null ? null : remember(memory, state(), sight);
  };

  /** Hands the renderer the board of a state as the player knows it. */
  const drawBoard = (s: GameState): void => {
    boardState = s;
    boardLanguage = getLanguage();
    const scene = sceneOf(s, boardLanguage, viewOf(s));
    shown = {
      fog: scene.fog !== null,
      hidden: s.units.length - scene.units.length,
      // to the observer every unit is somebody else's, the tribes included
      foreign: scene.units.filter((unit) => s.player === NO_POLITY || unit.polity !== s.player).length,
    };
    board.renderer.setScene(scene);
  };

  /** Puts the current state on the board, ending whatever was playing. */
  const showBoard = (): void => {
    playToken++;
    animating = false;
    drawBoard(state());
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
      drawBoard(before);
    }
    const seen = viewTest();
    // under fog only what the player's nation saw happen is played, by the pieces that were on its board
    const was = sightOf(before);
    const now = sightOf(state());
    const visual = visualEvents(
      knownState(before),
      events,
      (hex) => seen(hex) || (around >= 0 && hexDistance(before, hex, around) <= FOLLOW_RADIUS),
      was === null ? undefined : (hex) => was.visible[hex] === 1 || now?.visible[hex] === 1,
    );
    if (visual.length === 0) {
      showBoard();
      return;
    }
    const token = ++playToken;
    animating = true;
    boardState = state();
    const pace = playSpeed(visual.length) * (observing() ? speed : 1);
    sound.playCues(cuesFor(visual), pace * settings.current.animationSpeed);
    void renderer.play(visual, { speed: pace }).then(() => {
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
      reach = unit === undefined || host.busy ? [] : reachableHexes(knownState(state()), unit.id);
      sites =
        unit === undefined || host.busy || unit.owner !== player() || unit.type !== SETTLER
          ? null
          : settlerSites(knownState(state()), unit.id);
    }
    drawHighlights();
  };

  // ----------------------------------------------------------- selection

  const clearHover = (): void => {
    hoverHex = null;
    hoverPlan = null;
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
    hoverPlan = null;
    tooltip.hidden = true;
    const unit = unitById(selection);
    if (
      hex !== null && unit !== undefined && !host.busy && placing === null && striking === null &&
      hex !== unit.hex && unit.owner === player()
    ) {
      let text = '';
      // planned on what the player knows: a unit the fog hides is no target and stands in nobody's way
      const known = knownState(state());
      const attack = previewAttack(known, unit.id, hex);
      if (attack !== null) {
        const path = findPath(known, unit.id, hex, attackReach(known, unit.id));
        if (path !== null && inSight(sightOf(state()), hex)) {
          hoverPlan = { path, attack: hex };
          const from = path.hexes.at(-1) ?? unit.hex;
          const exact = previewAttack(known, unit.id, hex, from) ?? attack;
          text = exact.capture
            ? t('preview.capture')
            : t('preview.attack', { theirs: exact.toDefender, ours: exact.toAttacker });
          if (path.total > 1) text += ` · ${turnsText(path.total)}`;
        } else if (path !== null) {
          // a city out of sight: the way up to it, and nothing about a fight nobody can foresee
          hoverPlan = { path, attack: null };
          text = path.total > 0 ? turnsText(path.total) : rejectText('unseen');
        }
      } else {
        const path = findPath(known, unit.id, hex);
        if (path !== null && path.total > 0) {
          hoverPlan = { path, attack: null };
          text = turnsText(path.total);
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
    kitOpen = false;
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
    // a unit the fog hides is not there to be clicked
    const unit = knownState(state()).units.find((candidate) => candidate.hex === hex);
    const zone = cityZoneAt(state(), hex);
    const ownUnit = unit !== undefined && me !== NO_POLITY && unit.owner === me;
    const ownCity = zone >= 0 && me !== NO_POLITY && state().cities[zone]?.owner === me;

    if (touch && selection !== null && !ownUnit && !ownCity) {
      // touch has no right button: the first tap previews, the second one on the same hex orders
      const tap = tapTarget(touchTarget, hex, () => {
        preview(hex, clientX, clientY);
        return !tooltip.hidden;
      });
      if (tap.effect === 'confirm') {
        touchOrders++;
        orderTo(hex);
      } else if (tap.effect === 'deselect') {
        select(null);
        refresh();
      }
      // `orderTo` and `select` have cleared the target; a preview or a dropped target keeps the piece selected
      else touchTarget = tap.pending;
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

  const setLabel = (node: HTMLElement, text: string, active: boolean): void => {
    const label = node.querySelector('.label');
    if (label !== null && label.textContent !== text) label.textContent = text;
    node.classList.toggle('active', active);
    node.setAttribute('aria-pressed', String(active));
  };

  const drawTopbar = (): void => {
    const s = state();
    if (observing()) {
      fillWhen(topLeft, `observer|${getLanguage()}`, () => [
        el('span', { class: 'stat', id: 'observer-badge' }, icon('observe'), el('span', { text: t('hud.observer') })),
      ]);
    } else {
      const polity = s.polities[player()];
      const summary = politySummary(s, player());
      const gold = `${Math.floor(polity?.gold ?? 0)} ${signed(summary.net)}`;
      const morale = summary.morale === null ? '—' : String(summary.morale);
      const supply = supplyOf(s, player());
      const signature = [
        player(), getLanguage(), gold, summary.yields.science, summary.yields.culture, morale, kitOpen, supply.value,
      ].join('|');
      fillWhen(topLeft, signature, () => {
        // the nation's name opens its kit; a nation without one (a test map) has nothing to open
        const nation = el('button', {
          class: `swatch${kitOpen ? ' active' : ''}`,
          id: 'player-nation',
          text: polityName(map(), player()),
          disabled: kitViewOf(map(), player()) === null,
          pressed: kitOpen,
          onClick: () => {
            kitOpen = !kitOpen;
            menuOpen = false;
            refresh();
          },
        });
        nation.style.setProperty('--nation', cssColor(map().polities[player()]?.color ?? 0x888888));
        // the fighting units against what the cities supply, next to the gold the excess is paid from
        const supplied = stat('fortify', supply.text, supply.value, 'stat-supply');
        supplied.setAttribute('aria-label', supply.text);
        supplied.classList.toggle('status', supply.over);
        supplied.dataset.used = String(supply.used);
        supplied.dataset.limit = String(supply.limit);
        supplied.dataset.surcharge = String(supply.surcharge);
        return [
          nation,
          stat('gold', yieldName('gold'), gold, 'stat-gold'),
          supplied,
          stat('science', yieldName('science'), signed(summary.yields.science), 'stat-science'),
          stat('culture', yieldName('culture'), signed(summary.yields.culture), 'stat-culture'),
          stat('morale', t('hud.morale'), morale, 'stat-morale'),
        ];
      });
    }
    fill(
      topMiddle,
      el('span', { id: 'era', text: eraName(currentEra(s)) }),
      el('span', { id: 'turn-counter', text: t('hud.turnOf', { turn: s.turn, last: s.lastTurn }), data: { turn: s.turn } }),
    );
    setLabel(politiesButton, t('hud.polities'), overlay === 'polities');
    setLabel(victoryButton, t('hud.victory'), overlay === 'victory');
    setLabel(menuButton, t('hud.menu'), menuOpen);
  };

  const toggleOverlay = (kind: OverlayKind): void => {
    overlay = overlay === kind ? null : kind;
    menuOpen = false;
    kitOpen = false;
    refresh();
  };

  /** The player's current research: its name and the turns it still takes. */
  const researchText = (): string => {
    const research = observing() ? null : researchView(state(), player());
    if (research === null) return '—';
    return research.turns === null
      ? techName(research.tech)
      : counted('hud.researching', research.turns, { tech: techName(research.tech), turns: research.turns });
  };

  /** Culture stored towards the next policy card, over what the card costs. */
  const policyText = (): string => {
    const self = observing() ? undefined : state().polities[player()];
    if (self === undefined) return '—';
    return `${Math.floor(self.cultureProgress)}/${nextPolicyCost(state(), player())}`;
  };

  const drawSlots = (): void => {
    const slot = (id: string, kind: OverlayKind, name: IconName, label: string, value: string): HTMLElement =>
      el(
        'button',
        {
          class: `panel slot${overlay === kind ? ' active' : ''}`,
          id,
          disabled: observing(),
          pressed: overlay === kind,
          onClick: () => {
            toggleOverlay(kind);
          },
        },
        icon(name),
        el('span', { class: 'stat-label', text: label }),
        el('span', { class: 'slot-value', text: value }),
      );
    // research and policies are the player's: an observer has no use for the two buttons
    slots.hidden = observing();
    const research = researchText();
    const policy = policyText();
    fillWhen(slots, [getLanguage(), research, policy, overlay, observing()].join('|'), () => [
      slot('slot-research', 'tech', 'research', t('hud.research'), research),
      slot('slot-policy', 'policy', 'policy', t('hud.policy'), policy),
    ]);
  };

  /** The major nations, each with its relation to the player; a click opens its panel. */
  const drawMajors = (): void => {
    const s = state();
    const me = player();
    const rows = majorRows(s.majors.length);
    majorsBox.dataset.rows = String(rows);
    root.style.setProperty('--majors-rows', String(rows));
    const standings = s.majors.map((polity) => {
      const alive = s.polities[polity]?.alive === true;
      return { polity, alive, standing: me === NO_POLITY || !alive ? null : standingWith(s, me, polity) };
    });
    const signature = [getLanguage(), me, polityPanel, ...standings.map((item) => `${item.polity}:${item.alive}:${item.standing}`)].join('|');
    fillWhen(majorsBox, signature, () =>
      standings.map(({ polity, alive, standing }) => {
        const entry = map().polities[polity];
        const name = polityName(map(), polity);
        const node = el('button', {
          class: `major${alive ? '' : ' gone'}${polityPanel === polity ? ' active' : ''}`,
          title: standing === null || standing === 'self' ? name : `${name} · ${standingName(standing)}`,
          text: name,
          data: { polity, standing: standing ?? '' },
          onClick: () => {
            if (polity === me) flyTo(capitalHex(polity));
            else appView.openPolity(polity);
          },
        });
        node.style.setProperty('--nation', cssColor(entry?.color ?? 0x888888));
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
            // a deal the rules refused for want of gold still waits, and so does its notification
            const waits = offer.kind === 'offer' && state().offers.some((entry) => entry.id === offer.id);
            if (!waits) notes = notes.filter((other) => other.id !== note.id);
            refresh();
          };
          row.dataset.offerKind = offer.kind;
          // the rules take "accept" even when nothing can come of it: the button says why instead
          const obstacle = offer.kind === 'offer' ? offerObstacle(state(), offer.id) : null;
          row.append(
            button(t('note.accept'), () => {
              answer(true);
            }, {
              class: 'accent',
              data: { offer: 'accept', refused: obstacle ?? '' },
              disabled: host.busy || obstacle !== null,
              ...(obstacle === null ? {} : { title: rejectText(obstacle) }),
            }),
            button(t('note.decline'), () => {
              answer(false);
            }, { data: { offer: 'decline' }, disabled: host.busy }),
          );
        } else {
          row.append(
            iconOnly('close', t('note.dismiss'), () => {
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
    const look = pieceOf(unit.type);
    // the character is the piece's face in both languages; hovering it names the unit
    const piece = el('div', {
      class: `piece${look.unique ? ' unique' : ''}`,
      text: look.character,
      title: unitName(unit.type),
      data: { era: look.era, unique: Number(look.unique) },
    });
    piece.style.setProperty('--nation', cssColor(map().polities[unit.owner]?.color ?? 0x888888));
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
    const add = (name: string, label: string, action: Action & { unit: number }, sign: IconName): void => {
      const reason = check(state(), action);
      const props = { data: { action: name }, disabled: reason !== null || host.busy, ...(reason === null ? {} : { title: rejectText(reason) }) };
      actions.append(iconButton(sign, label, () => {
        unitAction(action);
      }, props));
    };
    if (def.strength > 0) add('fortify', t('action.fortify'), { type: 'fortify', polity: me, unit: unit.id }, 'fortify');
    add('sleep', t('action.sleep'), { type: 'sleep', polity: me, unit: unit.id }, 'sleep');
    actions.append(
      iconButton('skip', t('action.skip'), () => {
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
      add('upgrade', t('action.upgrade', { gold: upgrade.gold }), { type: 'upgrade', polity: me, unit: unit.id }, 'upgrade');
    }
    if (unit.type === SETTLER) add('settle', t('action.settle'), { type: 'settle', polity: me, unit: unit.id }, 'settle');
    const pillage = pillageAction(state(), unit.id);
    if (pillage !== null) add('pillage', t('action.pillage'), pillage, 'pillage');
    const gates = demandAction(state(), unit.id);
    // a vassal takes one of the places the era allows: the button says how many are taken
    if (gates !== null) add('demandVassalage', `${t('action.demandVassalage')} · ${vassalRoomText(state(), me)}`, gates, 'leader');
    fill(selectionBox, piece, facts, actions);
  };

  const optionButton = (label: string, option: BuildOption, key: string, onClick: () => void, active = false): HTMLButtonElement => {
    const node = el(
      'button',
      { class: active ? 'option active' : 'option', data: { build: key }, onClick, disabled: host.busy },
      el('span', { class: 'option-name', text: label }),
      el('span', { class: 'option-cost', text: t('city.cost', { cost: option.cost }) }),
      option.turns !== null && el('span', { class: 'option-turns', text: turnsText(option.turns) }),
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
    const strike = strikes ? strikeTargets(state(), zone) : { hexes: [], unseen: false };
    const strikeHexes = strike.hexes;
    const aiming = striking !== null && striking.city === zone;

    const header = el(
      'header',
      {},
      el('h2', { id: 'city-name', text: cityName(map(), zone) }),
      closeButton('city-close', () => {
        cityPanel = null;
        placing = null;
        striking = null;
        trade.clear(appView);
        refresh();
      }),
    );
    const facts = el(
      'div',
      { class: 'line' },
      el('span', { text: t('city.pop', { pop: city.pop }) }),
      el('span', { text: t('city.hp', { hp: Math.round(city.hp), max: view.maxHp }) }),
      el('span', { text: `${t('hud.morale')} ${Math.round(city.morale)}` }),
      city.unrest > 0 && el('span', { class: 'status', text: counted('city.unrest', city.unrest, { turns: city.unrest }) }),
    );
    const yieldsRow = el(
      'div',
      { class: 'yields', id: 'city-yields' },
      ...YIELD_ORDER.map((name) => stat(name, yieldName(name), signed(city.yields[name]), `city-${name}`)),
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
          el('span', { class: 'option-name', text: itemName(map(), entry.item, me) }),
          // a city project has neither a cost nor an end: the row says what it turns production into
          el('span', {
            class: 'option-cost',
            text:
              entry.converts !== null
                ? conversionText(entry.converts)
                : index === 0
                  ? `${Math.floor(city.progress)}/${entry.cost}`
                  : String(entry.cost),
          }),
          entry.turns !== null && el('span', { class: 'option-turns', text: turnsText(entry.turns) }),
          iconOnly('close', t('queue.remove'), () => {
            act({ type: 'unqueueBuild', polity: me, city: zone, index });
            refresh();
          }, { class: 'close', data: { unqueue: index }, disabled: host.busy }),
        ),
      ),
    );
    if (view.queue.length === 0) queueList.append(el('li', { class: 'empty', text: '—' }));
    for (const [index, entry] of view.queue.entries()) {
      const row = queueList.children[index];
      if (entry.converts !== null && row instanceof HTMLElement) row.dataset.converts = entry.converts.to;
    }
    const repeatSwitch = el(
      'button',
      {
        id: 'city-repeat',
        class: city.repeat ? 'switch active' : 'switch',
        data: { on: Number(city.repeat) },
        disabled: host.busy,
        onClick: () => {
          act({ type: 'setRepeat', polity: me, city: zone, repeat: !city.repeat });
          refresh();
        },
      },
      el('span', { class: 'switch-mark' }),
      el('span', { text: t('city.repeat') }),
    );
    repeatSwitch.setAttribute('role', 'switch');
    repeatSwitch.setAttribute('aria-checked', String(city.repeat));

    const group = (title: string, id: string, nodes: (HTMLElement | null)[]): HTMLElement | null =>
      nodes.length === 0 ? null : el('section', { id }, el('h3', { text: title }), ...nodes);
    // what makes this city's yields differ from another's: the seat of the nation
    const capital = capitalLines(state(), zone);
    const capitalRow =
      capital.length > 0 &&
      el(
        'div',
        { class: 'line', id: 'city-capital' },
        el('span', { class: 'tag', text: t('city.capital') }),
        ...capital.map((line) => el('span', { data: { yield: line.yield, percent: line.percent }, text: line.text })),
      );
    const supply = supplyOf(state(), city.owner);
    const warning = supplyWarning(supply);
    const fighting = view.units.filter((option) => option.item.kind === 'unit' && beyondSupply(supply, option.item.unit)).length;

    const body = el(
      'div',
      { class: 'scroll' },
      facts,
      yieldsRow,
      capitalRow,
      strikes &&
        button(t('city.airStrike'), () => {
          striking = aiming ? null : { city: zone, hexes: strikeHexes };
          placing = null;
          clearHover();
          refresh();
        }, {
          id: 'city-airstrike',
          class: aiming ? 'active' : '',
          data: { targets: strikeHexes.length, unseen: Number(strike.unseen) },
          disabled: host.busy || strikeHexes.length === 0,
          ...(city.airStruck
            ? { title: rejectText('alreadyStruck') }
            : strikeHexes.length === 0
              ? { title: rejectText(strike.unseen ? 'unseen' : 'noTarget') }
              : {}),
        }),
      el('h3', { text: t('city.focus') }),
      focusRow,
      el('h3', { text: t('city.queue') }),
      queueList,
      repeatSwitch,
      group(t('city.units'), 'build-units', [
        // one more fighting unit would stand beyond the supply limit: what that costs
        warning !== null && fighting > 0
          ? el('div', { class: 'reason', id: 'supply-warning', data: { gold: supply.nextUnit }, text: warning })
          : null,
        ...view.units.map((option) => {
          // the key is the item the rules take; the name is what the nation really builds
          const unit = option.item.kind === 'unit' ? option.item.unit : '';
          const key = `unit:${unit}`;
          const node = optionButton(itemName(map(), option.item, me), option, key, queue(option.item));
          if (beyondSupply(supply, unit)) node.dataset.supply = 'over';
          return buyable(option, key, node);
        }),
      ].filter((node) => node !== null)),
      group(t('city.buildings'), 'build-buildings', view.buildings.map((option) => {
        const key = `building:${option.item.kind === 'building' ? option.item.building : ''}`;
        const name = option.item.kind === 'building' ? buildingName(option.item.building) : '';
        return buyable(option, key, optionButton(name, option, key, queue(option.item)));
      })),
      // the city projects: no cost, no end and nothing to buy, only what production becomes and how much a turn
      group(t('city.conversions'), 'build-conversions', view.conversions.map((entry) =>
        el(
          'button',
          {
            class: entry.queued ? 'option active' : 'option',
            data: { build: `building:${entry.building}`, converts: entry.to, percent: entry.percent, perTurn: entry.perTurn },
            onClick: queue(entry.item),
            disabled: host.busy || entry.queued,
          },
          el('span', { class: 'option-name', text: buildingName(entry.building) }),
          el('span', { class: 'option-cost', text: conversionText(entry) }),
          el('span', { class: 'option-turns', text: perTurnText(entry.to, entry.perTurn) }),
        ),
      )),
      group(t('city.improvements'), 'build-improvements', view.improvements.map((option) => {
        const gains = IMPROVEMENTS[option.improvement].yields;
        const gain = (['food', 'production', 'gold'] as const)
          .filter((name) => gains[name] !== 0)
          .map((name) => gainText(name, gains[name]))
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
        optionButton(itemName(map(), option.item, me), option, `city:${option.item.kind === 'city' ? option.item.zone : ''}`, queue(option.item)),
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

  /** The player's own kit: what the nation's name in the top bar opens. */
  const drawKit = (): void => {
    const view = kitOpen && screen === 'game' && !observing() ? kitViewOf(map(), player()) : null;
    if (view === null) kitOpen = false;
    kitBox.hidden = view === null;
    kitBox.dataset.nation = view?.nation ?? '';
    if (view === null) {
      fill(kitBox);
      return;
    }
    const title = el('h2', { id: 'kit-name', text: polityName(map(), player()) });
    title.style.setProperty('--nation', cssColor(map().polities[player()]?.color ?? 0x888888));
    fill(
      kitBox,
      el(
        'header',
        {},
        title,
        difficultyMark(view),
        closeButton('kit-close', () => {
          kitOpen = false;
          refresh();
        }),
      ),
      el('div', { class: 'scroll' }, kitRows(view, false)),
    );
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
        kitOpen = false;
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
            pointAt(capitalHex(item.from));
            break;
        }
      }
    }
    refresh();
  };

  const drawAction = (): void => {
    const current = mainState();
    // an observer's clock redraws the page every turn: these buttons are updated in place, never rebuilt
    speedBox.hidden = !(observing() && screen === 'game');
    for (const node of speedButtons) {
      const value = Number(node.dataset.speed);
      const label = t('observer.speed', { speed: value });
      if (node.textContent !== label) node.textContent = label;
      node.classList.toggle('active', value === speed);
      node.setAttribute('aria-pressed', String(value === speed));
    }
    mainNode.hidden = current.kind === 'none';
    if (mainNode.textContent !== current.label) mainNode.textContent = current.label;
    mainNode.className = current.kind === 'busy' ? 'busy' : current.kind === 'nextTurn' ? 'accent' : '';
    mainNode.dataset.kind = current.kind;
    mainNode.disabled = current.kind === 'busy';
  };

  // -------------------------------------------------------- saves and menu

  /** Stores the game, and with it what the player remembers of the board. */
  const save = (): void => {
    writeAutosave(board.source, state());
    if (memory !== null) writeMemory(board.source, state(), memory);
  };

  const enterGame = (): void => {
    takeCamera();
    screen = state().result === null ? 'game' : 'end';
    select(null);
    cityPanel = null;
    polityPanel = null;
    menuOpen = false;
    kitOpen = false;
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
    // a game that is continued brings back what the player remembered of the board
    memory = sightOf(state()) === null ? null : readMemory(board.source, state());
    look();
    // what waited for an answer when the game was stored waits again: a loaded game has no events to tell of it
    for (const draft of pendingDrafts(state(), sightOf(state()), state)) addNote(draft.text, draft.hex, draft.offer);
    if (state().result === null) save();
    // the game opens on the player's capital with its zone in view; an observer sees the whole map
    const home = observing() ? -1 : capitalHex(player());
    if (home >= 0) board.renderer.focusHex(home, { frame: 'zone', immediate: true });
    else showWholeMap();
    showBoard();
    refresh();
    scheduleObserver();
  };

  const leaveGame = (): void => {
    takeCamera();
    host.reset();
    screen = 'start';
    chosenNation = null;
    select(null);
    cityPanel = null;
    polityPanel = null;
    menuOpen = false;
    kitOpen = false;
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
    changeSettings({ language: getLanguage() === 'zh' ? 'en' : 'zh' });
  };

  /** A row of buttons of which one is chosen. */
  const choice = <T extends string | number>(
    id: string,
    name: string,
    values: readonly T[],
    current: T,
    label: (value: T) => string,
    pick: (value: T) => void,
  ): HTMLElement =>
    el(
      'div',
      { class: 'segmented', id, data: { value: String(current) } },
      ...values.map((value) =>
        button(label(value), () => {
          pick(value);
        }, { class: value === current ? 'active' : '', data: { [name]: value }, pressed: value === current }),
      ),
    );

  const drawMenu = (): void => {
    menuBox.hidden = !menuOpen || screen !== 'game';
    if (menuBox.hidden) return;
    const now = settings.current;
    // rebuilt only when what it shows changed: an observer's clock redraws the page while the menu is open,
    // and the volume slider must stay under the pointer
    const signature = [
      now.quality, now.scale, now.language, now.animationSpeed, now.muted, scale, board.renderer.backend, state().difficulty, observing(),
    ].join('|');
    fillWhen(menuBox, signature, () => menuNodes());
  };

  const menuNodes = (): (HTMLElement | false)[] => {
    const now = settings.current;
    const volume = el('input', { id: 'menu-volume', label: t('menu.volume'), data: { value: now.volume } });
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = String(VOLUME_STEP);
    volume.value = String(now.volume);
    volume.addEventListener('input', () => {
      // no redraw while the slider is held: it would take the slider away from under the pointer
      settings.set({ volume: Number(volume.value) });
      sound.setVolume(settings.current.volume);
      volume.dataset.value = String(settings.current.volume);
    });
    const scaleRow = choice('menu-scale', 'scale', SCALE_SETTINGS, now.scale, (value: ScaleSetting) => {
      const key: TranslationKey = `scale.${value}`;
      return t(key);
    }, (value) => {
      changeSettings({ scale: value });
    });
    scaleRow.dataset.scale = String(scale);
    return [
      el(
        'div',
        { class: 'menu-actions' },
        iconButton('export', t('menu.export'), download, { id: 'menu-export' }),
        iconButton('import', t('menu.import'), () => {
          fileInput.click();
        }, { id: 'menu-import' }),
        iconButton('play', t('menu.newGame'), leaveGame, { id: 'menu-new-game' }),
      ),
      // the level the game was started at; an observer's game has none to speak of
      !observing() && el('h3', { text: t('menu.difficulty') }),
      !observing() &&
        el(
          'div',
          { id: 'menu-level', data: { level: state().difficulty } },
          el('div', { text: levelName(state().difficulty) }),
          el('div', { class: 'footnote', text: levelEffect(state().difficulty) }),
        ),
      el('h3', { text: t('menu.quality') }),
      choice('menu-quality', 'quality', QUALITY_OPTIONS, now.quality, (value) => {
        const key: TranslationKey = `quality.${value}`;
        return t(key);
      }, (value) => {
        changeSettings({ quality: value });
      }),
      el('h3', { text: t('menu.scale') }),
      scaleRow,
      el('h3', { text: t('menu.speed') }),
      choice('menu-speed', 'speed', ANIMATION_SPEEDS, now.animationSpeed, (value) => t('observer.speed', { speed: value }), (value) => {
        changeSettings({ animationSpeed: value });
      }),
      el('h3', { text: t('menu.volume') }),
      el(
        'div',
        { class: 'volume' },
        volume,
        iconOnly(now.muted ? 'mute' : 'sound', t('menu.mute'), () => {
          changeSettings({ muted: !settings.current.muted });
        }, { id: 'menu-mute', class: now.muted ? 'active' : '', pressed: now.muted }),
      ),
      el(
        'div',
        { class: 'menu-foot' },
        button(t('language.switch'), switchLanguage, { id: 'menu-language' }),
        button(t('menu.close'), () => {
          menuOpen = false;
          refresh();
        }, { id: 'menu-close' }),
      ),
      el('div', { class: 'footnote', id: 'backend', text: t('hud.backend', { backend: t(`backend.${board.renderer.backend}`) }) }),
    ];
  };

  // ------------------------------------------------------- start and end

  /** Highlights a nation at nation select; the map behind the list flies to it. */
  const chooseNation = (id: string): void => {
    chosenNation = id;
    const entry = map().polities.find((polity) => polity.id === id);
    const hex = siteOf(entry?.capitalZone ?? -1);
    if (hex >= 0) board.renderer.focusHex(hex, { frame: 'zone' });
    refresh();
  };

  const drawStart = (): void => {
    startScreen.hidden = screen !== 'start';
    if (startScreen.hidden) {
      fill(startScreen);
      return;
    }
    const m = map();
    const zh = getLanguage() === 'zh';
    const entries = nationEntries(m, state().majors);
    const regions = regionsOf(entries);
    if (startRegion !== 'all' && !regions.includes(startRegion)) startRegion = 'all';
    const rated = entries.some((entry) => entry.difficulty !== null);
    if (!rated) startSort = 'region';
    const shown = listNations(entries, startRegion, startSort);
    startScreen.dataset.region = startRegion;
    startScreen.dataset.sort = startSort;

    const nationButton = (entry: NationEntry): HTMLElement => {
      const polity = m.polities[entry.polity];
      const kit = kitViewOf(m, entry.polity);
      const node = el(
        'button',
        {
          class: `nation${chosenNation === entry.id ? ' active' : ''}${entry.major ? ' default-major' : ''}`,
          data: { nation: entry.id, difficulty: entry.difficulty ?? '', major: Number(entry.major) },
          pressed: chosenNation === entry.id,
          ...(entry.major ? { title: t('kit.major') } : {}),
          onClick: () => {
            chooseNation(entry.id);
          },
        },
        el('span', { class: 'nation-name', text: (zh ? polity?.nameZh : polity?.nameEn) ?? '' }),
        el('span', { class: 'nation-other', text: (zh ? polity?.nameEn : polity?.nameZh) ?? '' }),
        kit !== null && difficultyMark(kit),
      );
      node.style.setProperty('--nation', cssColor(polity?.color ?? 0x888888));
      return node;
    };
    // the list is grouped by what it is ordered by: regions, or the four ratings
    const groupOf = (entry: NationEntry): string => (startSort === 'region' ? entry.region : (entry.difficulty ?? ''));
    const groupName = (group: string): string => {
      if (group === '') return regionName('other');
      const key = (startSort === 'region' ? `region.${group}` : `difficulty.${group}`) as TranslationKey;
      return t(key);
    };
    const groups: HTMLElement[] = [];
    let members: HTMLElement | null = null;
    let last: string | null = null;
    for (const entry of shown) {
      const group = groupOf(entry);
      if (group !== last || members === null) {
        last = group;
        members = el('div', { class: 'nations' });
        groups.push(el('section', { class: 'region', data: { group } }, el('h3', { text: groupName(group) }), members));
      }
      members.append(nationButton(entry));
    }

    const filters = el(
      'div',
      { class: 'filters' },
      regions.length > 1 &&
        el(
          'div',
          { class: 'chips', id: 'regions' },
          ...(['all', ...regions] as const).map((region) =>
            button(region === 'all' ? t('start.all') : t(`region.short.${region}`), () => {
              startRegion = region;
              refresh();
            }, {
              class: region === startRegion ? 'chip active' : 'chip',
              data: { region },
              pressed: region === startRegion,
              ...(region === 'all' ? {} : { title: regionName(region) }),
            }),
          ),
        ),
      rated &&
        choice('nation-sort', 'sort', NATION_SORTS, startSort, (value) => {
          const key: TranslationKey = `start.sort.${value}`;
          return t(key);
        }, (value) => {
          startSort = value;
          refresh();
        }),
    );

    const saved = readAutosave(board.source, m);
    const list = el('div', { class: 'scroll', id: 'nations' }, ...groups);
    const cover = el(
      'div',
      { class: 'panel cover-list' },
      el(
        'header',
        { class: 'cover-title' },
        el('h1', { text: t('app.title') }),
        el('span', { class: 'seal', text: t('start.seal') }),
        button(t('language.switch'), switchLanguage, { id: 'language' }),
      ),
      filters,
      list,
      el(
        'footer',
        {},
        saved !== null &&
          iconButton('turn', t('start.continue'), () => {
            host.resume(saved);
            enterGame();
          }, { id: 'continue' }),
        iconButton('import', t('menu.import'), () => {
          fileInput.click();
        }, { id: 'start-import' }),
        iconButton('observe', t('start.observe'), () => {
          void startGame({ observe: true });
        }, { id: 'observe' }),
      ),
    );

    // the kit of the highlighted nation, with the button that starts the game
    const chosen = entries.find((entry) => entry.id === chosenNation);
    let card: HTMLElement | null = null;
    if (chosen !== undefined) {
      const polity = m.polities[chosen.polity];
      const kit = kitViewOf(m, chosen.polity);
      const title = el('h2', { id: 'kit-name', text: (zh ? polity?.nameZh : polity?.nameEn) ?? '' });
      title.style.setProperty('--nation', cssColor(polity?.color ?? 0x888888));
      card = el(
        'div',
        { class: 'panel cover-kit', id: 'kit-card', data: { nation: chosen.id, kit: Number(kit !== null) } },
        el('header', {}, title, el('span', { class: 'nation-other', text: (zh ? polity?.nameEn : polity?.nameZh) ?? '' })),
        (kit !== null || chosen.major) &&
          el(
            'div',
            { class: 'line' },
            kit !== null && difficultyMark(kit),
            chosen.major && el('span', { class: 'tag', id: 'kit-major', text: t('kit.major') }),
          ),
        kit !== null && el('div', { class: 'scroll' }, kitRows(kit, false)),
        el(
          'div',
          { id: 'levels' },
          choice('level-picker', 'level', DIFFICULTY_LEVELS, startLevel, levelName, (value) => {
            startLevel = value;
            refresh();
          }),
          el('div', { class: 'footnote', id: 'level-effect', text: levelEffect(startLevel) }),
        ),
        el(
          'footer',
          {},
          iconButton('play', t('start.play'), () => {
            void startGame({ nation: chosen.id });
          }, { id: 'play', class: 'accent' }),
        ),
      );
    }
    const scrolled = startScreen.querySelector('#nations')?.scrollTop ?? 0;
    fill(startScreen, cover, card);
    list.scrollTop = scrolled;
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

  /**
   * A selector that finds a control again after the page was redrawn: its
   * id, or its tag and `data-*` attributes under the nearest element with one.
   */
  const controlKey = (node: Element | null): string | null => {
    if (!(node instanceof HTMLElement) || !root.contains(node) || node === root) return null;
    if (node.id !== '') return `#${CSS.escape(node.id)}`;
    let key = node.tagName.toLowerCase();
    for (const [name, value] of Object.entries(node.dataset)) {
      const attribute = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      key += `[data-${attribute}="${CSS.escape(value ?? '')}"]`;
    }
    const home = node.parentElement?.closest('[id]');
    return home === null || home === undefined || home === root ? key : `#${CSS.escape(home.id)} ${key}`;
  };

  /** The first control of whatever lies on top, for a keyboard player whose control went away. */
  const firstControl = (): HTMLElement | null => {
    const layers = screen === 'start' ? [startScreen] : screen === 'end' ? [endScreen] : [overlayBox, menuBox, kitBox, cityBox, polityBox, actionBox];
    for (const layer of layers) {
      const control = layer.hidden ? null : layer.querySelector<HTMLElement>('button:not(:disabled)');
      if (control !== null) return control;
    }
    return null;
  };

  /** The layer that holds the focus: a full-screen overlay or the end screen. Null if nothing does. */
  const focusLayer = (): { readonly id: string; readonly box: HTMLElement } | null =>
    screen === 'end' ? { id: 'end', box: endScreen } : screen === 'game' && overlay !== null ? { id: overlay, box: overlayBox } : null;

  /** The controls of a layer that Tab stops at, in the order of the page. */
  const controlsOf = (box: HTMLElement): HTMLElement[] =>
    [...box.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(
      (node) => node.getClientRects().length > 0,
    );

  function refresh(): void {
    // a redraw rebuilds most controls: a keyboard player keeps the focus on the one they were on
    const focused = keyboardNav ? controlKey(document.activeElement) : null;
    // what has the focus when a layer opens gets it back when the layer closes
    if (heldLayer === null && focusLayer() !== null) opener = controlKey(document.activeElement);
    document.documentElement.lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
    document.title = t('app.title');
    game.hidden = screen === 'start';
    root.dataset.screen = screen;
    root.dataset.side = screen === 'game' && (cityPanel !== null || polityPanel !== null) ? 'open' : 'closed';
    sound.setEra(currentEra(state()));
    drawScene();
    drawStart();
    drawEnd();
    if (screen !== 'start') {
      drawTopbar();
      drawSlots();
      drawMajors();
      drawNotes();
      drawSelection();
      drawKit();
      drawCityPanel();
      drawPolityPanel();
      drawMenu();
      drawAction();
      drawOverlay();
      drawLenses();
      minimap?.draw(state(), lens, player(), sightOf(state())?.fog ?? null, screen === 'game' ? (sites ?? []).map((site) => site.hex) : []);
    }
    // a layer holds the focus: what lies behind it can be neither reached nor pressed
    const layer = focusLayer();
    for (const node of game.children) {
      if (node instanceof HTMLElement && node !== overlayBox) node.inert = layer !== null;
    }
    const move = focusMove({ was: heldLayer, now: layer?.id ?? null, keyboard: keyboardNav });
    heldLayer = layer?.id ?? null;
    if (move === 'into' && layer !== null) {
      controlsOf(layer.box)[0]?.focus({ preventScroll: true });
    } else if (move === 'back') {
      if (opener !== null) root.querySelector<HTMLElement>(opener)?.focus({ preventScroll: true });
      opener = null;
    } else if (focused !== null && !root.contains(document.activeElement)) {
      (root.querySelector<HTMLElement>(focused) ?? firstControl())?.focus({ preventScroll: true });
    }
  }

  const lensBar = el('div', { class: 'segmented', id: 'lenses' });
  const drawLenses = (): void => {
    // relations are the player's: an observer has no diplomacy lens
    if (observing() && lens === 'diplomacy') lens = 'political';
    fillWhen(lensBar, [getLanguage(), lens, observing()].join('|'), () =>
      LENSES.filter((entry) => entry !== 'diplomacy' || !observing()).map((entry) => {
        const key: TranslationKey = `lens.${entry}`;
        return button(t(key), () => {
          lens = entry;
          refresh();
        }, {
          class: entry === lens ? 'active' : '',
          data: { lens: entry },
          pressed: entry === lens,
        });
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
      kitOpen = false;
      placing = null;
      striking = null;
      trade.clear(appView);
      polityPanel = polity;
      pointAt(capitalHex(polity));
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
    // the card follows the state: it stays on its hex and says what is there now. A pointer that is
    // coming to rest is left to it, so that the card also comes up while an observer's game runs
    if (change.kind === 'started') hideCard();
    else if (cardShown !== null && screen === 'game') writeCard(cardShown.card.hex, cardShown.by);
    else if (cardShown !== null) hideCard();
    switch (change.kind) {
      case 'started':
        playToken++;
        animating = false;
        memory = null;
        return;
      case 'action':
        look();
        collect(change.events);
        settle();
        present(before, change.events);
        return;
      case 'turn':
        focus = null;
        clearHover();
        look();
        collect(change.events);
        settle();
        if (!change.burst && !observing() && screen === 'game') {
          // the player's turn begins; what they researched is done
          sound.play('turn');
          if (change.events.some((event) => gameSound(event, player()) === 'research')) sound.play('research', 0.35);
        }
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
          if (state().result === null) save();
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
    let press: (Press & { readonly button: number }) | null = null;
    let pressTimer: number | null = null;
    const endPress = (): void => {
      if (pressTimer !== null) window.clearTimeout(pressTimer);
      pressTimer = null;
      press = null;
    };

    canvas.addEventListener('pointerdown', (event) => {
      takeCamera();
      // a second finger makes it a pinch or a twist: no tap, no long press
      const second = press !== null && press.pointer !== event.pointerId;
      endPress();
      if (second) return;
      const { pointerId, clientX, clientY } = event;
      press = { pointer: pointerId, x: clientX, y: clientY, button: event.button, long: false };
      if (event.pointerType === 'mouse' || screen !== 'game') return;
      // a finger that rests shows the details of the hex under it; its release is then no tap
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        if (press === null || press.pointer !== pointerId || screen !== 'game') return;
        const hex = renderer.pickHex(clientX, clientY);
        if (hex === null) return;
        press = { ...press, long: true };
        showCard(hex, clientX, clientY, 'press');
      }, LONG_PRESS_MS);
    }, { signal });
    canvas.addEventListener('pointerup', (event) => {
      const start = press;
      const tapped = isTap(start, event.pointerId, event.clientX, event.clientY, CLICK_SLOP);
      if (start !== null && start.pointer === event.pointerId) endPress();
      if (start === null || !tapped) return;
      const hex = renderer.pickHex(event.clientX, event.clientY);
      if (hex === null) return;
      if (start.button === 2) {
        if (screen === 'game' && !host.busy && placing === null && striking === null) orderTo(hex);
      } else if (start.button === 0) {
        clickHex(hex, event.pointerType === 'touch', event.clientX, event.clientY);
      }
    }, { signal });
    canvas.addEventListener('pointercancel', () => {
      endPress();
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') {
        // a finger that travels is dragging the map
        if (
          press !== null && press.pointer === event.pointerId && !press.long &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP
        ) {
          endPress();
        }
        return;
      }
      if (event.buttons !== 0 || screen !== 'game') return;
      const { clientX, clientY } = event;
      const hex = selection !== null || cardShown !== null ? renderer.pickHex(clientX, clientY) : null;
      // the card is about one hex: it leaves when the pointer does, and comes once the pointer rests again
      if (cardShown === null || cardShown.card.hex !== hex) {
        hideCard();
        restTimer = window.setTimeout(() => {
          restTimer = null;
          if (screen !== 'game') return;
          const rested = renderer.pickHex(clientX, clientY);
          if (rested !== null) showCard(rested, clientX, clientY, 'hover');
        }, REST_MS);
      }
      if (selection === null) return;
      if (hex === hoverHex) {
        placeTooltip(clientX, clientY);
        return;
      }
      preview(hex, clientX, clientY);
    }, { signal });
    canvas.addEventListener('pointerleave', (event) => {
      // a finger leaves the canvas whenever it lifts: what its tap left pending stays
      if (event.pointerType !== 'mouse') return;
      hideCard();
      if (hoverHex === null) return;
      clearHover();
      drawHighlights();
    }, { signal });
    canvas.addEventListener('wheel', () => {
      hideCard();
      takeCamera();
    }, { signal, passive: true });

    minimap = createMinimap(board.map, (hex) => {
      flyTo(hex);
    });
    fill(minimapBox, minimap.element, lensBar);
    const small = minimap;
    const stopFrames = renderer.onFrame(() => {
      const camera = renderer.getCamera();
      small.setCamera(camera.x, camera.z);
      cameraMoving = lastCamera !== null && !sameView(lastCamera, camera);
      lastCamera = camera;
    });
    const unsubscribe = host.subscribe(onChange);
    // a new board has a new renderer: quality, language and animation speed go onto it
    applySettings();
    boardState = null;
    lastState = null;
    lastCamera = null;
    cameraMoving = false;
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
    // the camera of the game that ends is not brought back: its renderer may be gone by then
    takeCamera();
    hideCard();
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
    // the levels help the player or hold them back: with nobody playing, the middle one
    const difficulty = start.difficulty ?? (observe ? DEFAULT_DIFFICULTY : startLevel);
    host.start({ seed, player: observe ? null : (start.nation ?? null), difficulty });
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

  /** True if a keyboard player has a control in focus: Enter and Space then press it, as they do everywhere. */
  const onControl = (): boolean => {
    const focused = document.activeElement;
    return (
      keyboardNav &&
      focused instanceof HTMLElement &&
      root.contains(focused) &&
      focused.matches('button, input, select, a[href], [tabindex]') &&
      focused.id !== 'main-action'
    );
  };

  // the first gesture starts the sound; Tab means the player is moving through the controls with the keyboard
  window.addEventListener(
    'keydown',
    (event) => {
      if (hidden) return;
      if (event.key === 'Tab') {
        keyboardNav = true;
        // Tab stays inside the layer that holds the focus
        const layer = focusLayer();
        if (layer !== null) {
          const controls = controlsOf(layer.box);
          const active = document.activeElement;
          const at = active instanceof HTMLElement ? controls.indexOf(active) : -1;
          event.preventDefault();
          controls[trapIndex(controls.length, at, event.shiftKey)]?.focus({ preventScroll: true });
        }
      }
      hideCard();
      sound.unlock();
    },
    { capture: true },
  );
  window.addEventListener(
    'pointerdown',
    () => {
      if (hidden) return;
      keyboardNav = false;
      hideCard();
      sound.unlock();
    },
    { capture: true },
  );
  root.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button') !== null) sound.play('click');
  });

  window.addEventListener(
    'keydown',
    (event) => {
      if (hidden || typing(event) || screen !== 'game') return;
      // Q and E turn the camera (the renderer's own keys): the observer has taken it
      if (event.code === 'KeyQ' || event.code === 'KeyE') takeCamera();
      if ((event.key === 'Enter' || event.key === ' ') && onControl()) return;
      if (event.key === 'Enter') {
        // Enter is the main button wherever the mouse left the focus, and only once per press
        event.preventDefault();
        // the main button lies behind an open overlay: Enter does not reach it
        if (event.repeat || overlay !== null) return;
        // while the others move, one press is kept and applied when they are done
        if (host.busy && !observing()) enterQueued = true;
        else mainAction();
      } else if (event.key === ' ') {
        // held, Space hurries the animations; it never presses the button that has the focus
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (!event.repeat) board.renderer.setAnimationSpeed(HURRY * settings.current.animationSpeed);
      } else if (event.key === 'Escape') {
        if (skipAnimations()) return;
        if (overlay !== null) overlay = null;
        else if (striking !== null) striking = null;
        else if (placing !== null) placing = null;
        else if (menuOpen) menuOpen = false;
        else if (kitOpen) kitOpen = false;
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
      if (event.key !== ' ' || hidden || screen !== 'game' || onControl()) return;
      board.renderer.setAnimationSpeed(settings.current.animationSpeed);
      if (!typing(event)) event.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener('blur', () => {
    if (!hidden && screen === 'game') board.renderer.setAnimationSpeed(settings.current.animationSpeed);
  });
  window.addEventListener('resize', () => {
    // hidden, the renderer belongs to somebody else (the render demo)
    if (hidden) return;
    const before = scale;
    applyScale();
    if (scale !== before) refresh();
  });

  /** The kit that is on screen and where, for the snapshot. */
  const shownKit = (): UiSnapshot['kit'] => {
    const of = (index: number, where: 'start' | 'own' | 'polity'): UiSnapshot['kit'] => {
      const view = index < 0 ? null : kitViewOf(map(), index);
      return view === null ? null : { nation: view.nation, where };
    };
    if (screen === 'start') return of(map().polities.findIndex((polity) => polity.id === chosenNation), 'start');
    if (screen !== 'game') return null;
    if (kitOpen) return of(player(), 'own');
    return polityPanel === null ? null : of(polityPanel, 'polity');
  };

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
        panel:
          screen !== 'game'
            ? null
            : menuOpen
              ? 'menu'
              : kitOpen
                ? 'kit'
                : cityPanel !== null
                  ? 'city'
                  : polityPanel !== null
                    ? 'polity'
                    : null,
        city: cityPanel,
        polity: polityPanel,
        selectedUnit: selection,
        busy: host.busy,
        observer: screen === 'game' && observing() ? { paused, speed, watching: watcher.watching, returns: watcher.returns } : null,
        mainButton: { kind: current.kind, label: current.label },
        notifications: notes.length,
        map: board.source,
        overlay: screen === 'game' ? overlay : null,
        lens,
        scale: { setting: settings.current.scale, factor: scale },
        animating,
        targeting: striking !== null ? 'airStrike' : placing !== null ? 'improvement' : 'select',
        routePreview: trade.selected,
        enterApplied,
        kit: shownKit(),
        start:
          screen !== 'start'
            ? null
            : {
                region: startRegion,
                sort: startSort,
                nations: listNations(nationEntries(map(), state().majors), startRegion, startSort).map((entry) => entry.id),
                chosen: chosenNation,
                difficulty: startLevel,
              },
        settings: settings.current,
        sound: (() => {
          const { silent, unlocked, volume, muted, era } = sound.status;
          return { silent, unlocked, volume, muted, era };
        })(),
        aids: screen === 'game' ? aidsShown : null,
        fog: { on: shown.fog, hiddenUnits: shown.hidden, foreignUnits: shown.foreign },
        card:
          cardShown === null
            ? null
            : {
                hex: cardShown.card.hex,
                knowledge: cardShown.card.knowledge,
                units: cardShown.card.units.map((unit) => unit.id),
                city: cardShown.card.city?.zone ?? null,
                by: cardShown.by,
                text: cardShown.text,
              },
        touchTarget,
        touchOrders,
        settleSites: screen === 'game' ? sites : null,
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
      sound.dispose();
    },
  };
}
