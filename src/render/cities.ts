/**
 * Cities on the board: each is generated from its population, era,
 * architectural family, walls, buildings and landmark (`cityGen.ts`,
 * `landmarks.ts`), laid out in the northern part of its hex at a size that
 * holds its own beside a piece (`cityLayout.ts`) and drawn as parts
 * (`partBatch.ts`). From far away a square marker in the owner's colour
 * takes the place of the houses. The names are drawn by the label batch
 * (`labels.ts`); this module says what they name.
 */

import { abs, attribute, color, dot, float, max, mix, positionGeometry, positionLocal, smoothstep, step, uniform, vec3 } from 'three/tsl';
import { Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import { CityFamily, cityRadius, generateCity, partsHeight } from './cityGen.ts';
import type { Part } from './cityGen.ts';
import { CAPITAL_MARKER_FACTOR, cityFootprint, cityMarkerHalf, cityMarkerShare, cityScale, layOutCity } from './cityLayout.ts';
import { surfaceHeightAt, surfaceHeightAtHex } from './heightField.ts';
import type { Surface } from './heightField.ts';
import { cityTier } from './labelLayout.ts';
import type { CityLabel } from './labels.ts';
import { generateLandmark, placeParts } from './landmarks.ts';
import { createPartBatch } from './partBatch.ts';
import { KEYLINE_DARK, KEYLINE_PALE, KEYLINE_SWITCH } from './pieceStyle.ts';
import { releaseMesh } from './release.ts';
import type { RenderCity } from './scene.ts';
import type { MapUniforms } from './shaderLib.ts';

export interface Cities {
  /** The houses, and the markers that stand in for them from far away. */
  readonly object: Group;
  /**
   * Fits the cities to the view: models near, markers far.
   *
   * @param distance of the camera from the point it looks at.
   * @param viewportHeight height of the canvas in CSS pixels.
   * @param political how far the view has turned into the political map, 0 to 1.
   * @returns how far the cities have turned into markers, 0 to 1, and half the side of a marker in world units.
   */
  setView(distance: number, viewportHeight: number, political: number): { readonly markerShare: number; readonly markerHalf: number };
  /**
   * Replaces the cities.
   *
   * @returns what the name of each city names, or `null` if the cities
   *   are the same as before.
   */
  setCities(cities: readonly RenderCity[]): CityLabel[] | null;
  /** Parts now drawn, landmarks included. */
  readonly parts: number;
  dispose(): void;
}

/** A landmark is drawn at this share of its size (before the city is enlarged), behind the houses. */
const LANDMARK_SCALE = 0.72;
/** The markers are drawn after the cloud layer (order 8) and before the pieces (order 9). */
const MARKER_ORDER = 8.5;

interface MarkerSite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly capital: boolean;
}

export function createCities(surface: Surface, u: MapUniforms): Cities {
  const { map } = surface;
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const batch = createPartBatch(u, size, 'cities');
  let shownKey = '';
  const capitalSites = new Set(map.zones.filter((zone) => zone.capital).map((zone) => zone.siteHex));

  // the marker: a square in the owner's colour inside a line, with the sign of a walled town in it
  const markerHalf = uniform(0.5 * size);
  const markerShare = uniform(0);
  const markerColor = attribute('markerColor', 'vec3');
  const capital = attribute('markerCapital', 'float');
  const markerMaterial = new MeshBasicNodeMaterial();
  const reach = max(abs(positionGeometry.x), abs(positionGeometry.z));
  const lineColor = mix(color(KEYLINE_DARK), color(KEYLINE_PALE), step(dot(markerColor, vec3(0.2126, 0.7152, 0.0722)), KEYLINE_SWITCH));
  const edge = smoothstep(0.74, 0.8, reach);
  // a wall around a keep; a capital's keep is filled
  const wall = smoothstep(0.34, 0.4, reach).mul(float(1).sub(smoothstep(0.5, 0.56, reach)));
  const keep = float(1).sub(smoothstep(0.12, 0.18, reach)).mul(capital);
  markerMaterial.colorNode = vec3(mix(markerColor, lineColor, max(edge, max(wall, keep))));
  markerMaterial.opacityNode = markerShare;
  const grown = markerHalf.mul(mix(float(1), float(CAPITAL_MARKER_FACTOR), capital));
  // north of the middle of the hex: the garrison's piece stands south of it
  // (the vertex has its instance's place already: the square grows around it)
  markerMaterial.positionNode = positionLocal.add(
    vec3(positionGeometry.x.mul(grown.sub(1)), 0, positionGeometry.z.mul(grown.sub(1)).sub(grown)),
  );
  markerMaterial.transparent = true;
  markerMaterial.depthWrite = false;
  // seen from far above only, where a flat square would otherwise sink into every hill
  markerMaterial.depthTest = false;
  markerMaterial.fog = false;
  const markerGeometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  let markers: InstancedMesh | null = null;
  const object = new Group();
  object.name = 'cityLayer';
  object.add(batch.object);
  const matrix = new Matrix4();
  const tint = new Color();
  const showMarkers = (sites: readonly MarkerSite[]): void => {
    if (markers !== null) {
      releaseMesh(markers);
      markers = null;
    }
    if (sites.length === 0) return;
    const geometry = markerGeometry.clone();
    const colors = new Float32Array(sites.length * 3);
    const capitals = new Float32Array(sites.length);
    const created = new InstancedMesh(geometry, markerMaterial, sites.length);
    sites.forEach((site, i) => {
      matrix.makeTranslation(site.x, site.y, site.z);
      created.setMatrixAt(i, matrix);
      tint.setHex(site.color);
      colors.set([tint.r, tint.g, tint.b], i * 3);
      capitals[i] = site.capital ? 1 : 0;
    });
    geometry.setAttribute('markerColor', new InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('markerCapital', new InstancedBufferAttribute(capitals, 1));
    created.name = 'cityMarkers';
    created.frustumCulled = false;
    created.renderOrder = MARKER_ORDER;
    created.visible = markerShare.value > 0.002;
    markers = created;
    object.add(created);
  };

  return {
    object,
    get parts() {
      return batch.count;
    },
    setView(distance, viewportHeight, political) {
      const share = cityMarkerShare(distance, viewportHeight, size);
      const half = cityMarkerHalf(distance, viewportHeight, size, political);
      markerShare.value = share;
      markerHalf.value = half;
      if (markers !== null) markers.visible = share > 0.002;
      // behind the marker the houses are specks: they are not drawn
      batch.object.visible = share < 0.998;
      return { markerShare: share, markerHalf: half };
    },
    setCities(cities) {
      const key = JSON.stringify(
        cities.map((c) => [c.hex, c.polity, c.population, c.name, c.capital, c.family, c.era, c.walls, c.buildings, c.landmark]),
      );
      if (key === shownKey) return null;
      shownKey = key;

      const world: Part[] = [];
      const labels: CityLabel[] = [];
      const sites: MarkerSite[] = [];
      for (const city of cities) {
        if (city.hex < 0 || city.hex >= map.width * map.height) continue;
        const centre = hexToWorld(indexToOffset(city.hex, map.width), layout);
        const polityColor = map.polities[city.polity]?.color ?? 0x888888;
        const family = city.family ?? CityFamily.CentralPlains;
        let parts = generateCity({
          seed: city.hex,
          population: city.population,
          era: city.era ?? 0,
          family,
          walls: city.walls ?? false,
          buildings: city.buildings ?? 0,
          polityColor,
        });
        if (city.landmark !== undefined) {
          const landmark = generateLandmark(city.landmark);
          if (landmark.length > 0) {
            // behind the houses as the board is usually seen, to the north-west or the north-east,
            // where neither a house nor the garrison stands before it; houses in its way make room
            const side = ((city.hex * 2654435761) >>> 0) / 4294967296 < 0.5 ? -1 : 1;
            const angle = -Math.PI / 2 + side * 0.75;
            const away = cityRadius(city.population, family) * 0.78;
            const lx = Math.cos(angle) * away;
            const lz = Math.sin(angle) * away;
            const room = 0.36 * LANDMARK_SCALE;
            parts = parts.filter((part) => Math.hypot(part.x - lx, part.z - lz) > room);
            parts = parts.concat(placeParts(landmark, lx, lz, 0, LANDMARK_SCALE));
          }
        }
        parts = layOutCity(parts, cityScale(city.population, family));
        for (const part of parts) {
          const x = centre.x + part.x * size;
          const z = centre.z + part.z * size;
          world.push({
            ...part,
            x,
            y: surfaceHeightAt(surface, x, z) + part.y * size,
            z,
            w: part.w * size,
            h: part.h * size,
            d: part.d * size,
          });
        }
        const isCapital = city.capital ?? capitalSites.has(city.hex);
        const ground = surfaceHeightAtHex(surface, city.hex);
        const footprint = cityFootprint(city.population);
        labels.push({
          name: city.name,
          color: polityColor,
          hex: city.hex,
          x: centre.x,
          y: ground,
          z: centre.z,
          footprint: { z: footprint.z * size, halfWidth: footprint.halfWidth * size, halfDepth: footprint.halfDepth * size },
          height: partsHeight(parts) * size,
          tier: cityTier(isCapital, city.population),
          population: city.population,
        });
        sites.push({ x: centre.x, y: ground, z: centre.z, color: polityColor, capital: isCapital });
      }
      batch.set(world);
      showMarkers(sites);
      return labels;
    },
    dispose() {
      batch.dispose();
      if (markers !== null) releaseMesh(markers);
      markerGeometry.dispose();
      markerMaterial.dispose();
    },
  };
}
