/**
 * The types of the renderer's public API. `api.ts` re-exports all of them;
 * they live here so that the renderer's own modules can use them without
 * importing `api.ts`.
 */

import type { Language } from '../shared/i18n.ts';
import type { RenderBackend } from '../shared/types.ts';
import type { CameraState } from './cameraRig.ts';
import type { CityFamilyId } from './cityGen.ts';
import type { PostEffect, PostEffectState } from './postEffects.ts';
import type { Quality } from './renderScale.ts';

export { CityFamily } from './cityGen.ts';
export type { CityFamilyId } from './cityGen.ts';
export { LANDMARK_IDS } from './landmarks.ts';
export { POST_EFFECTS } from './postEffects.ts';
export type { PostEffect, PostEffectState } from './postEffects.ts';
export { QUALITY_TIERS } from './renderScale.ts';
export type { Quality } from './renderScale.ts';

/** The material a piece is made of, one per era. */
export const PieceEra = {
  /** Pottery and wood. */
  Ancient: 0,
  /** Bronze. */
  Classical: 1,
  /** Lacquer. */
  Medieval: 2,
  /** Jade. */
  EarlyModern: 3,
  /** Brass. */
  Industrial: 4,
  /** Steel. */
  Modern: 5,
} as const;
export type PieceEraId = (typeof PieceEra)[keyof typeof PieceEra];

/** One unit piece on the board. */
export interface RenderUnit {
  /** Stable identifier, unique among the units of a scene. */
  readonly id: number;
  /** Hex the piece stands on. */
  readonly hex: number;
  /** Polity whose colour the side band takes. */
  readonly polity: number;
  /** The one Chinese character engraved on top. */
  readonly character: string;
  /** Unique units have the engraving filled with gold. */
  readonly unique: boolean;
  readonly era: PieceEraId;
  /** Remaining hit points, from 0 to 1. */
  readonly hp: number;
}

/** One city marker. */
export interface RenderCity {
  readonly hex: number;
  readonly polity: number;
  /** Sets the size of the marker. */
  readonly population: number;
  /** Shown as the label, as given. */
  readonly name: string;
  /**
   * Capitals keep their label longest when zooming out. If omitted, a city
   * on the site of a capital zone of the map counts as one.
   */
  readonly capital?: boolean;
  /**
   * The architectural family the city is built in. If omitted, the family
   * of the owner: by the id of the polity, Central Plains for an id the
   * renderer does not know.
   */
  readonly family?: CityFamilyId;
  /**
   * How far the city has come, 0 (ancient) to 5 (modern), as {@link PieceEra}:
   * from the industrial era on it has works with chimneys, in the modern
   * era towers. 0 if omitted.
   */
  readonly era?: PieceEraId;
  /** Whether the city has walls. None if omitted. */
  readonly walls?: boolean;
  /** How many buildings the city has built: every third adds a public building. 0 if omitted. */
  readonly buildings?: number;
  /**
   * The unique building that stands in the city: the id of its nation in
   * the map's polity list, one of {@link LANDMARK_IDS}. None if omitted or
   * for an id without a landmark.
   */
  readonly landmark?: string;
}

/** What has been built on a hex. Values of `RenderScene.improvements`. */
export const Improvement = {
  /** Fields with furrows; terraces on slopes. */
  Farm: 1,
  /** Fenced grazing land with a herd. */
  Pasture: 2,
  /** A pit head with its spoil heap. */
  Mine: 3,
  /** Boats and fish traps, on a water hex. */
  Fishery: 4,
} as const;
export type ImprovementId = (typeof Improvement)[keyof typeof Improvement];

/** One trade route, drawn as a faint dotted line in its owner's colour. */
export interface RenderRoute {
  /** The hexes the route passes, in order. */
  readonly path: readonly number[];
  /** The polity that owns the route. */
  readonly polity: number;
  /** Whether it is a sea route: drawn over the water instead of on the ground. */
  readonly sea: boolean;
}

/** What the player knows about a hex. Values of `RenderScene.fog`. */
export const FogState = {
  /** Never seen. */
  Unseen: 0,
  /** Seen before, not in view now. */
  Remembered: 1,
  /** In view. */
  Visible: 2,
} as const;
export type FogStateId = (typeof FogState)[keyof typeof FogState];

/**
 * Everything on the board that is not part of the map. The renderer draws
 * exactly what is listed: leaving out the units and cities that fog hides
 * is the caller's job.
 */
export interface RenderScene {
  readonly units: readonly RenderUnit[];
  readonly cities: readonly RenderCity[];
  /**
   * Hexes whose owner differs from `MapData.owner`: hex index to the new
   * owner, a polity index or one of the `OWNER_*` values.
   */
  readonly ownerOverrides: ReadonlyMap<number, number>;
  /**
   * Per hex: a {@link FogState} value, or `null` when the whole map is in
   * view. Terrain stays visible everywhere; hexes that are not in view are
   * drawn slightly desaturated.
   */
  readonly fog: Uint8Array | null;
  /** Improvements by hex index. None if omitted. */
  readonly improvements?: ReadonlyMap<number, ImprovementId>;
  /** Roads by hex index: 1 for a road, 2 for a railway. Drawn through the hex centres. None if omitted. */
  readonly roads?: ReadonlyMap<number, 1 | 2>;
  /** Trade routes. None if omitted. */
  readonly routes?: readonly RenderRoute[];
}

/** A hex to mark, for selections, move ranges and the like. */
export interface HexHighlight {
  readonly hex: number;
  /** Colour as `0xRRGGBB`. */
  readonly color: number;
  /** From 0 to 1; 0.45 if omitted. */
  readonly opacity?: number;
}

/**
 * Aids for giving an order to the selected piece, drawn over the hexes.
 * Every part is optional.
 */
export interface SelectionAids {
  /** Hexes the piece can reach: a tinted area with an outline around it. */
  readonly reachable?: readonly number[];
  /** The path of the order under the pointer. */
  readonly path?: {
    /** From the piece's hex to the target, both included. */
    readonly hexes: readonly number[];
    /**
     * Positions in `hexes` where a turn's movement ends, in order. Each gets
     * a marker with the number of turns it takes to get there.
     */
    readonly turnEnds?: readonly number[];
  };
  /** A hex to mark as the target of an attack. */
  readonly attackTarget?: number;
  /** Colour of the reachable area and the path as `0xRRGGBB`; a pale paper tone if omitted. */
  readonly color?: number;
}

/**
 * Something that happened on the board, to be shown by {@link Renderer.play}.
 * Units are named by `RenderUnit.id` and must be in the current scene; hexes
 * by their index.
 */
export type VisualEvent =
  /** The piece is lifted, slides along the path and is set down in a puff of dust. */
  | { readonly type: 'move'; readonly unit: number; /** From the piece's hex to its destination, both included. */ readonly path: readonly number[] }
  /** The piece strikes towards the target hex and bounces back. */
  | { readonly type: 'melee'; readonly unit: number; readonly targetHex: number }
  /** The piece stays put; a volley of arrows flies in an arc and lands in smoke. */
  | { readonly type: 'ranged'; readonly unit: number; readonly targetHex: number }
  /** As `ranged`, with a few heavy shells, a higher arc and more smoke. */
  | { readonly type: 'siege'; readonly unit: number; readonly targetHex: number }
  /** A city shoots at a hex. */
  | { readonly type: 'cityStrike'; readonly cityHex: number; readonly targetHex: number }
  /** The piece cracks, falls over and is taken off the board. */
  | { readonly type: 'destroy'; readonly unit: number }
  /** A flash of gold on the piece. */
  | { readonly type: 'promote'; readonly unit: number }
  /** The hexes of a zone take the colour of their new owner, sweeping out from the city. */
  | {
      readonly type: 'capture';
      readonly cityHex: number;
      /** The hexes that change hands. */
      readonly hexes: readonly number[];
      /** The new owner: a polity index. */
      readonly polity: number;
    };

export type VisualEventType = VisualEvent['type'];

/** How many events of one type {@link Renderer.play} has taken so far. The numbers only grow. */
export interface AnimationCount {
  /** Events that were in view and got an animation. */
  readonly animated: number;
  /** Events applied without an animation: out of view, or played while rendering was paused. */
  readonly instant: number;
  /** Events of both kinds whose end state is on the board. */
  readonly finished: number;
  /** Events that named a unit that is not in the scene or a hex that is not on the map. */
  readonly ignored: number;
}

export interface PlayOptions {
  /** Multiplies the speed of these events, on top of {@link Renderer.setAnimationSpeed}. 1 if omitted. */
  readonly speed?: number;
}

export interface FrameStats {
  /** Frames rendered since the renderer started. */
  readonly frames: number;
  /** Time from one frame to the next in milliseconds, averaged over recent frames. */
  readonly frameMs: number;
  /** Time spent in the frame callback in milliseconds, averaged over recent frames. */
  readonly cpuMs: number;
  /** Draw calls of the last frame, shadow pass included. */
  readonly drawCalls: number;
  /** Triangles of the last frame, shadow pass included. */
  readonly triangles: number;
  /**
   * The render scale in use: 1 draws at the capped device pixel ratio, lower
   * values draw fewer pixels and stretch them over the canvas.
   */
  readonly renderScale: number;
  /** The pixel ratio frames are drawn at: the capped device pixel ratio times the render scale. */
  readonly pixelRatio: number;
  /** How far the view has turned into the political map: 0 terrain, 1 political map. */
  readonly political: number;
  /** Whether the political map with its polity names is shown. */
  readonly politicalMap: boolean;
  /** Labels shown in the last frame, after the ones that would overlap were hidden. */
  readonly labels: number;
  /** Whether an animation started by {@link Renderer.play} is running. */
  readonly animating: boolean;
  /**
   * Shadow cascades drawn since the renderer started. The number only grows,
   * and stands still while nothing that casts a shadow changes and the view
   * stays on the ground the cascades cover.
   */
  readonly shadowDraws: number;
  /** Trees drawn in the last frame; 0 from far away, where forests are colour and relief only. */
  readonly trees: number;
  /** Opacity of the cloud layer over the map: 0 near the ground, where only cloud shadows show. */
  readonly cloudLayer: number;
}

export interface RendererOptions {
  /**
   * Content of the map's heightmap file (`MapData.heightmap`). Without it
   * the relief is built from the hex elevations.
   */
  readonly heightmap?: Uint16Array;
  /**
   * Upper limit of frames per second. Without it every animation frame is
   * drawn. Software rendering under automation uses every core, so the page
   * caps it there.
   */
  readonly maxFps?: number;
  /** Start with rendering paused, see {@link Renderer.setPaused}. */
  readonly paused?: boolean;
  /** The quality tier to start with; `auto` if omitted. */
  readonly quality?: Quality;
  /** Language of the polity names on the political map; the current language of `i18n` if omitted. */
  readonly language?: Language;
}

export interface FocusOptions {
  /** Zoom distance to move to; the current one if omitted. */
  readonly distance?: number;
  /**
   * `zone` picks the distance that shows the whole zone the hex belongs to,
   * for example a city and its land. Ignored when `distance` is given, and
   * for a hex outside every zone.
   */
  readonly frame?: 'zone';
  /** Jump instead of gliding. */
  readonly immediate?: boolean;
}

export interface Renderer {
  readonly backend: RenderBackend;
  /** Replaces what is on the board. */
  setScene(scene: RenderScene): void;
  /**
   * The hex under a point of the page, or `null` if the point is outside
   * the canvas or the map.
   *
   * @param clientX as in `MouseEvent.clientX`.
   * @param clientY as in `MouseEvent.clientY`.
   */
  pickHex(clientX: number, clientY: number): number | null;
  /** Moves the camera so that it looks at a hex. */
  focusHex(hex: number, options?: FocusOptions): void;
  /** Replaces the marked hexes. */
  setHighlights(highlights: readonly HexHighlight[]): void;
  /**
   * Replaces the aids for ordering the selected piece: the reachable area,
   * the path with its turn markers and the attack target. `null` removes
   * them. Independent of {@link Renderer.setHighlights}.
   */
  setSelectionAids(aids: SelectionAids | null): void;
  /**
   * Sets the quality tier. `auto`, the default, lowers the render scale
   * when frames run long and restores it when they do not; the other tiers
   * hold a fixed resolution and level of detail. Each tier also has its set
   * of effects of the finish, none at `low`; switches set with
   * {@link Renderer.setEffects} are dropped.
   */
  setQuality(quality: Quality): void;
  readonly quality: Quality;
  /**
   * Switches effects of the finish on or off by hand, on top of what the
   * quality tier asks for. The switches add to the ones set before; `null`
   * clears them all, so that every effect follows the tier again, and so
   * does {@link Renderer.setQuality}. An effect the backend does not carry stays
   * off whatever is asked.
   */
  setEffects(overrides: Readonly<Partial<Record<PostEffect, boolean>>> | null): void;
  /** The effects of the finish that run now: tier, switches and backend taken together. */
  getEffects(): PostEffectState;
  /** Sets the language of the polity names on the political map. */
  setLanguage(language: Language): void;
  /**
   * Shows what happened on the board, one event after the other, and
   * resolves when the last one has finished.
   *
   * Call it while the scene still shows the board as it was before the
   * events, then call {@link Renderer.setScene} with the board after them.
   * Until that call, what an event leaves behind stays: a moved piece
   * stands on its destination, a destroyed piece is gone, a captured zone
   * has its new colour. `setScene` ends every running animation and draws
   * exactly the new scene.
   *
   * An event whose hexes are all outside the view takes no time. Events for
   * a unit that is not in the scene, or with a hex that is not on the map,
   * are skipped. While rendering is paused nothing is animated and the
   * promise resolves at once. Calls made while events are playing queue up
   * behind them.
   */
  play(events: readonly VisualEvent[], options?: PlayOptions): Promise<void>;
  /** Multiplies the speed of all animations; 1 is the normal speed. */
  setAnimationSpeed(factor: number): void;
  /** Finishes every playing and queued event at once; their promises resolve. */
  skip(): void;
  /**
   * What `play` has done since the renderer started, per event type. Unlike
   * `FrameStats.animating` these numbers do not depend on when they are read.
   */
  getAnimationCounts(): Readonly<Record<VisualEventType, AnimationCount>>;
  /**
   * The hex a unit's piece stands on as drawn: the hex of the scene, or where
   * the events played since have left it. `null` for a unit that is not in
   * the scene or was destroyed by an event.
   */
  getUnitHex(unit: number): number | null;
  /** Shows or hides the hex grid overlay. */
  setGridVisible(visible: boolean): void;
  /** The camera state being drawn. */
  getCamera(): CameraState;
  /** Moves the camera; missing fields keep their value. Out-of-range values are clamped. */
  setCamera(state: Partial<CameraState>, immediate?: boolean): void;
  getStats(): FrameStats;
  /** Calls `listener` after every frame. Returns a function that removes it. */
  onFrame(listener: (stats: FrameStats) => void): () => void;
  /**
   * Pauses or resumes drawing. While paused no frame is drawn and the camera
   * stands still; scene changes are kept and show in the first frame after.
   */
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  /** Stops rendering, removes the input listeners and frees the GPU resources. */
  dispose(): void;
}

/** A scene with nothing on the board. */
export const EMPTY_SCENE: RenderScene = {
  units: [],
  cities: [],
  ownerOverrides: new Map(),
  fog: null,
};
