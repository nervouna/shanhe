/**
 * Turns mouse, keyboard and touch input on the canvas into camera states.
 *
 * - Mouse: drag pans, the wheel zooms about the pointer, right-drag rotates.
 * - Keyboard: Q and E rotate.
 * - Touch: one finger pans; two fingers pan, pinch-zoom and twist-rotate.
 *
 * Input moves a goal state; the state the camera uses follows it smoothly.
 */

import { CAMERA_FOV, cameraPose, clampCamera, rayAtHeight, screenRay } from './cameraRig.ts';
import type { CameraLimits, CameraState } from './cameraRig.ts';

export interface CameraController {
  /** The state to draw this frame. */
  readonly state: CameraState;
  /** Advances the smoothing by `seconds` and returns the new state. */
  update(seconds: number): CameraState;
  /** Moves the camera. Missing fields keep their value. */
  moveTo(target: Partial<CameraState>, immediate: boolean): void;
  dispose(): void;
}

const WHEEL_ZOOM = 0.0016;
const ROTATE_PER_PIXEL = 0.006;
const KEY_ROTATE_PER_SECOND = 1.6;
/** How fast the drawn state closes in on the goal, per second. */
const FOLLOW_RATE = 14;

interface Pointer {
  x: number;
  y: number;
  readonly button: number;
}

/**
 * @param groundY height of the ground under a camera target, used as the
 *   plane that dragging moves.
 */
export function createCameraController(
  canvas: HTMLCanvasElement,
  limits: CameraLimits,
  initial: CameraState,
  groundY: (x: number, z: number) => number,
): CameraController {
  let goal = clampCamera(initial, limits);
  let state = goal;
  const pointers = new Map<number, Pointer>();
  const keys = new Set<string>();

  /** The ground point under a client position for camera state `s`. */
  const groundPoint = (s: CameraState, clientX: number, clientY: number): { x: number; z: number } | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const y = groundY(s.x, s.z);
    const ray = screenRay(
      cameraPose(s, limits, y),
      CAMERA_FOV,
      rect.width / rect.height,
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
    );
    return rayAtHeight(ray, y);
  };

  /** Changes the goal so that the ground point at `from` appears at `to`. */
  const dragGround = (fromX: number, fromY: number, toX: number, toY: number): void => {
    const a = groundPoint(goal, fromX, fromY);
    const b = groundPoint(goal, toX, toY);
    if (a === null || b === null) return;
    goal = clampCamera({ ...goal, x: goal.x + a.x - b.x, z: goal.z + a.z - b.z }, limits);
  };

  /** Multiplies the zoom distance, keeping the ground under a client position in place. */
  const zoomAbout = (factor: number, clientX: number, clientY: number): void => {
    const before = groundPoint(goal, clientX, clientY);
    goal = clampCamera({ ...goal, distance: goal.distance * factor }, limits);
    const after = groundPoint(goal, clientX, clientY);
    if (before === null || after === null) return;
    goal = clampCamera({ ...goal, x: goal.x + before.x - after.x, z: goal.z + before.z - after.z }, limits);
  };

  const twoFingers = (): { x: number; y: number; spread: number; angle: number } | null => {
    if (pointers.size !== 2) return null;
    const [a, b] = [...pointers.values()] as [Pointer, Pointer];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      spread: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, button: event.button });
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const pointer = pointers.get(event.pointerId);
    if (pointer === undefined) return;
    const before = twoFingers();
    const fromX = pointer.x;
    const fromY = pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (before !== null) {
      const after = twoFingers();
      if (after === null) return;
      let twist = after.angle - before.angle;
      if (twist > Math.PI) twist -= 2 * Math.PI;
      if (twist < -Math.PI) twist += 2 * Math.PI;
      goal = clampCamera({ ...goal, yaw: goal.yaw + twist }, limits);
      if (before.spread > 0 && after.spread > 0) zoomAbout(before.spread / after.spread, after.x, after.y);
      dragGround(before.x, before.y, after.x, after.y);
    } else if (pointers.size === 1) {
      if (pointer.button === 2) {
        goal = clampCamera({ ...goal, yaw: goal.yaw - (pointer.x - fromX) * ROTATE_PER_PIXEL }, limits);
      } else {
        dragGround(fromX, fromY, pointer.x, pointer.y);
      }
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // lines and pages are turned into pixels
    const pixels = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 400 : 1);
    zoomAbout(Math.exp(pixels * WHEEL_ZOOM), event.clientX, event.clientY);
  };

  const onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  const typing = (event: KeyboardEvent): boolean => {
    const target = event.target;
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyQ' || event.code === 'KeyE') keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const onBlur = (): void => {
    keys.clear();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    get state() {
      return state;
    },
    update(seconds) {
      const turn = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
      if (turn !== 0) {
        goal = clampCamera({ ...goal, yaw: goal.yaw + turn * KEY_ROTATE_PER_SECOND * seconds }, limits);
      }
      const k = 1 - Math.exp(-FOLLOW_RATE * Math.max(0, seconds));
      let turnBy = goal.yaw - state.yaw;
      if (turnBy > Math.PI) turnBy -= 2 * Math.PI;
      if (turnBy < -Math.PI) turnBy += 2 * Math.PI;
      const next = {
        x: state.x + (goal.x - state.x) * k,
        z: state.z + (goal.z - state.z) * k,
        // zoom is smoothed on a log scale, like the wheel moves it
        distance: state.distance * (goal.distance / state.distance) ** k,
        yaw: state.yaw + turnBy * k,
      };
      const settled =
        Math.abs(goal.x - next.x) + Math.abs(goal.z - next.z) < 1e-5 * goal.distance &&
        Math.abs(goal.distance / next.distance - 1) < 1e-5 &&
        Math.abs(turnBy) < 1e-5;
      state = settled ? goal : clampCamera(next, limits);
      return state;
    },
    moveTo(target, immediate) {
      goal = clampCamera({ ...goal, ...target }, limits);
      if (immediate) state = goal;
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
