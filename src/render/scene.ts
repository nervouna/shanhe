/**
 * The types of the renderer's public API. `api.ts` re-exports all of them;
 * they live here so that the renderer's own modules can use them without
 * importing `api.ts`.
 */

import type { RenderBackend } from '../shared/types.ts';
import type { CameraState } from './cameraRig.ts';

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
}

/** A hex to mark, for selections, move ranges and the like. */
export interface HexHighlight {
  readonly hex: number;
  /** Colour as `0xRRGGBB`. */
  readonly color: number;
  /** From 0 to 1; 0.45 if omitted. */
  readonly opacity?: number;
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
}

export interface FocusOptions {
  /** Zoom distance to move to; the current one if omitted. */
  readonly distance?: number;
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
