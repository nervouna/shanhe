/**
 * Every label on the map in one draw call: city names, the names of the
 * polities on the political map, and the numbered turn markers of a path.
 *
 * The texts are drawn once into one canvas, the atlas. Each label is an
 * instance of one quad: city names and markers face the camera at a fixed
 * size on screen, polity names lie on the ground along their territory.
 * Which labels are shown is decided again only when the camera or the
 * labels changed; labels that would overlap a more important one are hidden.
 */

import { attribute, texture, uv, vec2 } from 'three/tsl';
import {
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu';
import type { PerspectiveCamera } from 'three/webgpu';
import {
  PRIORITY_MARKER,
  PRIORITY_POLITICAL,
  cityLabelPriority,
  cityLabelShown,
  declutter,
} from './labelLayout.ts';
import type { CityTierId, LabelBox } from './labelLayout.ts';
import { fitName } from './politicalNames.ts';
import type { NamePlacement } from './politicalNames.ts';

export interface CityLabel {
  readonly name: string;
  /** Colour of the dot in front of the name, as `0xRRGGBB`. */
  readonly color: number;
  /** The point the label stands on. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tier: CityTierId;
  readonly population: number;
}

export interface NameLabel {
  readonly name: string;
  readonly placement: NamePlacement;
  /** Height of the ground at the placement. */
  readonly y: number;
  /** Drawn fainter: a region nobody rules. */
  readonly muted: boolean;
}

export interface MarkerLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Labels {
  readonly object: InstancedMesh;
  setCities(cities: readonly CityLabel[]): void;
  setNames(names: readonly NameLabel[]): void;
  setMarkers(markers: readonly MarkerLabel[]): void;
  /**
   * Lays the labels out for a view. Does nothing if neither the view nor
   * the labels changed since the last call.
   *
   * @param width of the canvas in CSS pixels.
   * @param height of the canvas in CSS pixels.
   * @param zoom zoom fraction, 0 nearest and 1 farthest.
   * @param political how far the view has turned into the political map, 0 to 1.
   * @returns the number of labels shown.
   */
  update(camera: PerspectiveCamera, width: number, height: number, zoom: number, political: number): number;
  dispose(): void;
}

/** From this share of the political map on, polity names replace city names. */
export const POLITICAL_NAMES_FROM = 0.5;

/** Heights on screen, in CSS pixels. */
const CITY_HEIGHT = 24;
const MARKER_HEIGHT = 22;
const NAME_MIN_HEIGHT = 20;
const NAME_MAX_HEIGHT = 54;
/** Atlas pixels per CSS pixel for the labels of fixed size. */
const ATLAS_SCALE = 2;
/** Height of a polity name in the atlas, in pixels. */
const NAME_PIXELS = 72;
const ATLAS_WIDTH = 2048;
const ATLAS_MAX_HEIGHT = 4096;
const GAP = 4;

const CITY_FONT = '600 15px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
const MARKER_FONT = '700 13px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
const NAME_FAMILY = '"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif';

interface Sprite {
  /** Size in atlas pixels. */
  readonly width: number;
  readonly height: number;
  draw(context: CanvasRenderingContext2D, x: number, y: number): void;
}

interface Slot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

let measureContext: CanvasRenderingContext2D | null = null;
function measure(font: string, text: string): number {
  if (measureContext === null) {
    measureContext = document.createElement('canvas').getContext('2d');
    if (measureContext === null) throw new Error('2D canvas is not available');
  }
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function citySprite(name: string, color: number): Sprite {
  const dot = 8;
  const padding = 9;
  const width = Math.ceil(measure(CITY_FONT, name)) + padding * 2 + dot + 6;
  return {
    width: width * ATLAS_SCALE,
    height: CITY_HEIGHT * ATLAS_SCALE,
    draw(context, x, y) {
      context.save();
      context.translate(x, y);
      context.scale(ATLAS_SCALE, ATLAS_SCALE);
      context.fillStyle = 'rgb(16 21 28 / 78%)';
      context.beginPath();
      context.roundRect(0, 0, width, CITY_HEIGHT, CITY_HEIGHT / 2);
      context.fill();
      context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      context.beginPath();
      context.arc(padding + dot / 2, CITY_HEIGHT / 2, dot / 2, 0, Math.PI * 2);
      context.fill();
      context.font = CITY_FONT;
      context.fillStyle = '#f2ede2';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillText(name, padding + dot + 6, CITY_HEIGHT / 2 + 1);
      context.restore();
    },
  };
}

function markerSprite(text: string): Sprite {
  const width = Math.max(MARKER_HEIGHT, Math.ceil(measure(MARKER_FONT, text)) + 12);
  return {
    width: width * ATLAS_SCALE,
    height: MARKER_HEIGHT * ATLAS_SCALE,
    draw(context, x, y) {
      context.save();
      context.translate(x, y);
      context.scale(ATLAS_SCALE, ATLAS_SCALE);
      context.fillStyle = '#f2ede2';
      context.beginPath();
      context.roundRect(0, 0, width, MARKER_HEIGHT, MARKER_HEIGHT / 2);
      context.fill();
      context.strokeStyle = '#b3382a';
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(1, 1, width - 2, MARKER_HEIGHT - 2, MARKER_HEIGHT / 2 - 1);
      context.stroke();
      context.font = MARKER_FONT;
      context.fillStyle = '#1c1a17';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, width / 2, MARKER_HEIGHT / 2 + 1);
      context.restore();
    },
  };
}

/** A polity name: widely spaced letters, light with a dark outline. */
function nameSprite(name: string, muted: boolean): Sprite {
  const cjk = /[⺀-鿿]/u.test(name);
  const text = cjk ? name : name.toUpperCase();
  const size = NAME_PIXELS * (cjk ? 0.8 : 0.62);
  const font = `${cjk ? 900 : 700} ${size}px ${NAME_FAMILY}`;
  const tracking = size * (cjk ? 0.42 : 0.16);
  const letters = [...text];
  const widths = letters.map((letter) => measure(font, letter));
  const margin = 10;
  const width = Math.ceil(widths.reduce((sum, w) => sum + w, 0) + tracking * (letters.length - 1)) + margin * 2;
  return {
    width,
    height: NAME_PIXELS,
    draw(context, x, y) {
      context.save();
      context.font = font;
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.lineWidth = size * 0.14;
      context.strokeStyle = muted ? 'rgb(20 22 26 / 45%)' : 'rgb(20 22 26 / 80%)';
      context.fillStyle = muted ? 'rgb(246 240 226 / 70%)' : '#fbf6e8';
      let at = x + margin;
      letters.forEach((letter, i) => {
        context.strokeText(letter, at, y + NAME_PIXELS / 2 + 2);
        at += (widths[i] as number) + tracking;
      });
      at = x + margin;
      letters.forEach((letter, i) => {
        context.fillText(letter, at, y + NAME_PIXELS / 2 + 2);
        at += (widths[i] as number) + tracking;
      });
      context.restore();
    },
  };
}

export function createLabels(): Labels {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas is not available');

  const makeTexture = (): CanvasTexture => {
    const created = new CanvasTexture(canvas);
    created.colorSpace = SRGBColorSpace;
    created.magFilter = LinearFilter;
    created.minFilter = LinearMipmapLinearFilter;
    created.generateMipmaps = true;
    return created;
  };
  let atlas = makeTexture();

  // per label: where its picture is in the atlas, and its opacity
  const region = attribute('labelRegion', 'vec4');
  const opacity = attribute('labelOpacity', 'float');
  const sample = texture(atlas, vec2(region.x.add(uv().x.mul(region.z)), region.y.add(uv().y.mul(region.w))));
  const material = new MeshBasicNodeMaterial();
  material.colorNode = sample.rgb;
  material.opacityNode = sample.a.mul(opacity);
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;

  const geometry = new PlaneGeometry(1, 1);
  let capacity = 0;
  let mesh = allocate(256);

  function allocate(size: number): InstancedMesh {
    capacity = size;
    geometry.setAttribute('labelRegion', new InstancedBufferAttribute(new Float32Array(size * 4), 4));
    geometry.setAttribute('labelOpacity', new InstancedBufferAttribute(new Float32Array(size), 1));
    const created = new InstancedMesh(geometry, material, size);
    created.name = 'labels';
    created.count = 0;
    created.frustumCulled = false;
    created.renderOrder = 10;
    return created;
  }

  let cities: readonly CityLabel[] = [];
  let names: readonly NameLabel[] = [];
  let markers: readonly MarkerLabel[] = [];
  let slots = new Map<string, Slot>();
  let atlasDirty = true;
  let layoutDirty = true;
  let shown = 0;
  const lastView = new Float64Array(37);

  const cityKey = (label: CityLabel): string => `c:${label.color}:${label.name}`;
  const nameKey = (label: NameLabel): string => `n:${label.muted ? 1 : 0}:${label.name}`;
  const markerKey = (label: MarkerLabel): string => `m:${label.text}`;

  const rebuildAtlas = (): void => {
    const sprites = new Map<string, Sprite>();
    for (const label of names) {
      if (!sprites.has(nameKey(label))) sprites.set(nameKey(label), nameSprite(label.name, label.muted));
    }
    for (const label of cities) {
      if (!sprites.has(cityKey(label))) sprites.set(cityKey(label), citySprite(label.name, label.color));
    }
    for (const label of markers) {
      if (!sprites.has(markerKey(label))) sprites.set(markerKey(label), markerSprite(label.text));
    }
    // shelves: sprites side by side, a new row when one is full
    const placed: { sprite: Sprite; slot: Slot }[] = [];
    slots = new Map();
    let x = GAP;
    let y = GAP;
    let rowHeight = 0;
    for (const [key, sprite] of sprites) {
      const width = Math.min(sprite.width, ATLAS_WIDTH - GAP * 2);
      if (x + width + GAP > ATLAS_WIDTH) {
        x = GAP;
        y += rowHeight + GAP;
        rowHeight = 0;
      }
      // what does not fit any more goes without a label
      if (y + sprite.height + GAP > ATLAS_MAX_HEIGHT) continue;
      const slot = { x, y, width, height: sprite.height };
      slots.set(key, slot);
      placed.push({ sprite, slot });
      x += width + GAP;
      rowHeight = Math.max(rowHeight, sprite.height);
    }
    let height = 256;
    while (height < y + rowHeight + GAP) height *= 2;
    if (canvas.height !== height) {
      canvas.height = height;
      // a texture keeps the size it was first uploaded with
      atlas.dispose();
      atlas = makeTexture();
      sample.value = atlas;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const { sprite, slot } of placed) sprite.draw(context, slot.x, slot.y);
    atlas.needsUpdate = true;
    atlasDirty = false;
  };

  const matrix = new Matrix4();
  const point = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const forward = new Vector3();
  const xAxis = new Vector3();
  const yAxis = new Vector3();
  const zAxis = new Vector3();

  interface Candidate {
    readonly slot: Slot;
    readonly opacity: number;
    /** Writes the label's matrix. */
    place(): void;
  }

  return {
    get object() {
      return mesh;
    },
    setCities(next) {
      cities = next;
      atlasDirty = true;
      layoutDirty = true;
    },
    setNames(next) {
      names = next;
      atlasDirty = true;
      layoutDirty = true;
    },
    setMarkers(next) {
      markers = next;
      atlasDirty = true;
      layoutDirty = true;
    },
    update(camera, width, height, zoom, political) {
      // the same view and the same labels: nothing to do
      let same = !layoutDirty;
      const view = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, width, height, zoom, political, 0];
      for (let i = 0; i < view.length; i++) {
        if (lastView[i] !== view[i]) same = false;
        lastView[i] = view[i] as number;
      }
      if (same) return shown;
      layoutDirty = false;
      if (atlasDirty) rebuildAtlas();

      const total = cities.length + names.length + markers.length;
      if (total > capacity) {
        const parent = mesh.parent;
        parent?.remove(mesh);
        mesh.dispose();
        let size = capacity;
        while (size < total) size *= 2;
        mesh = allocate(size);
        parent?.add(mesh);
      }

      camera.matrixWorld.extractBasis(right, up, forward);
      const perPixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / height;
      /** A world point on screen in CSS pixels, with its depth; `null` behind the camera. */
      const project = (x: number, y: number, z: number): { x: number; y: number; depth: number } | null => {
        point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        const depth = -point.z;
        if (depth <= camera.near) return null;
        point.applyMatrix4(camera.projectionMatrix);
        return { x: (point.x * 0.5 + 0.5) * width, y: (0.5 - point.y * 0.5) * height, depth };
      };
      const onScreen = (box: LabelBox): boolean =>
        box.maxX > 0 && box.minX < width && box.maxY > 0 && box.minY < height;

      const boxes: LabelBox[] = [];
      const candidates: Candidate[] = [];

      /** A label that faces the camera, standing on a point, `pixels` high. */
      const billboard = (key: string, x: number, y: number, z: number, pixels: number, lift: number, priority: number, alpha: number): void => {
        const slot = slots.get(key);
        const at = project(x, y, z);
        if (slot === undefined || at === null || alpha <= 0.01) return;
        const widthPixels = (pixels * slot.width) / slot.height;
        const box = {
          minX: at.x - widthPixels / 2,
          maxX: at.x + widthPixels / 2,
          minY: at.y - lift - pixels,
          maxY: at.y - lift,
          priority,
        };
        if (!onScreen(box)) return;
        boxes.push(box);
        candidates.push({
          slot,
          opacity: alpha,
          place() {
            const scale = perPixel * at.depth;
            xAxis.copy(right).multiplyScalar(widthPixels * scale);
            yAxis.copy(up).multiplyScalar(pixels * scale);
            matrix.makeBasis(xAxis, yAxis, forward);
            matrix.setPosition(
              x + up.x * (lift + pixels / 2) * scale,
              y + up.y * (lift + pixels / 2) * scale,
              z + up.z * (lift + pixels / 2) * scale,
            );
          },
        });
      };

      const politicalNames = political >= POLITICAL_NAMES_FROM;
      if (politicalNames) {
        const alpha = Math.min(1, (political - POLITICAL_NAMES_FROM) / 0.3 + 0.25);
        for (const label of names) {
          const slot = slots.get(nameKey(label));
          const { placement } = label;
          const centre = project(placement.x, label.y, placement.z);
          if (slot === undefined || centre === null) continue;
          // as large as the territory allows, within what is readable
          const pixel = perPixel * centre.depth;
          const fitted = fitName(placement, slot.width / slot.height);
          const tall = Math.min(Math.max(fitted.height, NAME_MIN_HEIGHT * pixel), NAME_MAX_HEIGHT * pixel);
          const wide = (tall * slot.width) / slot.height;
          // written so that it reads from left to right on screen
          let dx = Math.cos(placement.angle);
          let dz = Math.sin(placement.angle);
          if (dx * right.x + dz * right.z < 0) {
            dx = -dx;
            dz = -dz;
          }
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let visible = true;
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            const corner = project(
              placement.x + (dx * a * wide) / 2 + (dz * b * tall) / 2,
              label.y,
              placement.z + (dz * a * wide) / 2 - (dx * b * tall) / 2,
            );
            if (corner === null) {
              visible = false;
              break;
            }
            minX = Math.min(minX, corner.x);
            maxX = Math.max(maxX, corner.x);
            minY = Math.min(minY, corner.y);
            maxY = Math.max(maxY, corner.y);
          }
          const box = { minX, minY, maxX, maxY, priority: PRIORITY_POLITICAL + Math.min(placement.hexes, 900) };
          if (!visible || !onScreen(box)) continue;
          boxes.push(box);
          candidates.push({
            slot,
            opacity: alpha,
            place() {
              xAxis.set(dx * wide, 0, dz * wide);
              yAxis.set(dz * tall, 0, -dx * tall);
              zAxis.set(0, 1, 0);
              matrix.makeBasis(xAxis, yAxis, zAxis);
              matrix.setPosition(placement.x, label.y, placement.z);
            },
          });
        }
      }
      // city names fade as the political map comes up
      const cityAlpha = Math.min(1, Math.max(0, 1 - (political - 0.15) / (POLITICAL_NAMES_FROM - 0.15)));
      for (const label of cities) {
        if (!cityLabelShown(label.tier, zoom, politicalNames)) continue;
        billboard(
          cityKey(label),
          label.x,
          label.y,
          label.z,
          CITY_HEIGHT,
          4,
          cityLabelPriority(label.tier, label.population),
          cityAlpha,
        );
      }
      markers.forEach((label, i) => {
        billboard(markerKey(label), label.x, label.y, label.z, MARKER_HEIGHT, -MARKER_HEIGHT / 2, PRIORITY_MARKER - i, 1);
      });

      const keep = declutter(boxes);
      const regions = geometry.getAttribute('labelRegion') as InstancedBufferAttribute;
      const opacities = geometry.getAttribute('labelOpacity') as InstancedBufferAttribute;
      let count = 0;
      candidates.forEach((candidate, i) => {
        if (keep[i] !== true) return;
        candidate.place();
        mesh.setMatrixAt(count, matrix);
        const { slot } = candidate;
        // the canvas is flipped on upload: its top row is at v = 1
        regions.setXYZW(
          count,
          slot.x / canvas.width,
          1 - (slot.y + slot.height) / canvas.height,
          slot.width / canvas.width,
          slot.height / canvas.height,
        );
        opacities.setX(count, candidate.opacity);
        count++;
      });
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      regions.needsUpdate = true;
      opacities.needsUpdate = true;
      shown = count;
      return shown;
    },
    dispose() {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
}
