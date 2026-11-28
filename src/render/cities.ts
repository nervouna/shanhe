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
import { createKeyedCache } from './keyed.ts';
import type { GroundArea } from './keyed.ts';
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
   * Replaces the cities. Only the cities that are new or changed are
   * generated and drawn again; the others keep their models.
   *
   * @returns `null` if the cities are the same as before.
   */
  setCities(cities: readonly RenderCity[]): CitiesUpdate | null;
  /** Parts now drawn, landmarks included. */
  readonly parts: number;
  /** City models generated since the start. Only grows. */
  readonly builds: number;
  /** Instanced meshes made for the houses since the start. Only grows. */
  readonly meshBuilds: number;
  dispose(): void;
}

export interface CitiesUpdate {
  /** What the name of each city names, for all cities now on the board. */
  readonly labels: CityLabel[];
  /** Cities generated in this call: the new ones and the ones that changed. */
  readonly built: number;
  /** Cities taken off the board in this call. */
  readonly removed: number;
  /** The ground on which houses went or came: their shadows changed. */
  readonly areas: readonly GroundArea[];
}

/** A landmark is drawn at this share of its size (before the city is enlarged), behind the houses. */
const LANDMARK_SCALE = 0.72;
/** The markers are drawn after the cloud layer (order 8) and before the pieces (order 9). */
const MARKER_ORDER = 8.5;

interface CityModel {
  readonly parts: readonly Part[];
  readonly label: CityLabel;
  readonly site: MarkerSite;
}

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
  const capitalSites = new Set(map.zones.filter((zone) => zone.capital).map((zone) => zone.siteHex));
  let markersKey = '';

  /** A city as it stands on the board: its parts in world coordinates, what its name names and its marker. */
  const buildModel = (city: RenderCity): CityModel => {
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
    const world: Part[] = [];
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
    return {
      parts: world,
      label: {
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
      },
      site: { x: centre.x, y: ground, z: centre.z, color: polityColor, capital: isCapital },
    };
  };
  const models = createKeyedCache<RenderCity, CityModel>(
    (city) => city.hex,
    (c) => JSON.stringify([c.polity, c.population, c.name, c.capital, c.family, c.era, c.walls, c.buildings, c.landmark]),
    buildModel,
  );

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
  /** Instances the marker mesh has room for; it is made anew only when the cities outgrow it. */
  let markerCapacity = 0;
  const showMarkers = (sites: readonly MarkerSite[]): void => {
    if (markers === null || sites.length > markerCapacity) {
      if (markers !== null) releaseMesh(markers);
      markerCapacity = 64;
      while (markerCapacity < sites.length) markerCapacity *= 2;
      const geometry = markerGeometry.clone();
      geometry.setAttribute('markerColor', new InstancedBufferAttribute(new Float32Array(markerCapacity * 3), 3));
      geometry.setAttribute('markerCapital', new InstancedBufferAttribute(new Float32Array(markerCapacity), 1));
      markers = new InstancedMesh(geometry, markerMaterial, markerCapacity);
      markers.name = 'cityMarkers';
      markers.frustumCulled = false;
      markers.renderOrder = MARKER_ORDER;
      object.add(markers);
    }
    const mesh = markers;
    const colors = mesh.geometry.getAttribute('markerColor') as InstancedBufferAttribute;
    const capitals = mesh.geometry.getAttribute('markerCapital') as InstancedBufferAttribute;
    sites.forEach((site, i) => {
      matrix.makeTranslation(site.x, site.y, site.z);
      mesh.setMatrixAt(i, matrix);
      tint.setHex(site.color);
      colors.setXYZ(i, tint.r, tint.g, tint.b);
      capitals.setX(i, site.capital ? 1 : 0);
    });
    mesh.count = sites.length;
    mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    capitals.needsUpdate = true;
    mesh.visible = sites.length > 0 && markerShare.value > 0.002;
  };

  return {
    object,
    get parts() {
      return batch.count;
    },
    get builds() {
      return models.builds;
    },
    get meshBuilds() {
      return batch.meshBuilds;
    },
    setView(distance, viewportHeight, political) {
      const share = cityMarkerShare(distance, viewportHeight, size);
      const half = cityMarkerHalf(distance, viewportHeight, size, political);
      markerShare.value = share;
      markerHalf.value = half;
      if (markers !== null) markers.visible = markers.count > 0 && share > 0.002;
      // behind the marker the houses are specks: they are not drawn
      batch.object.visible = share < 0.998;
      return { markerShare: share, markerHalf: half };
    },
    setCities(cities) {
      const { built: changed, removed } = models.update(cities.filter((city) => city.hex >= 0 && city.hex < map.width * map.height));
      if (changed.length === 0 && removed.length === 0) return null;
      const changes: [number, readonly Part[] | null][] = removed.map((hex) => [hex, null]);
      for (const hex of changed) changes.push([hex, models.get(hex)?.parts ?? null]);
      const update = batch.update(changes);

      const labels: CityLabel[] = [];
      const sites: MarkerSite[] = [];
      const seen = new Set<number>();
      for (const city of cities) {
        const model = models.get(city.hex);
        if (model === undefined || seen.has(city.hex)) continue;
        seen.add(city.hex);
        labels.push(model.label);
        sites.push(model.site);
      }
      // the markers change with the sites, their owners and their rank, not with what a city has built
      const sitesKey = sites.map((site) => `${site.x},${site.z},${site.color},${site.capital ? 1 : 0}`).join(';');
      if (sitesKey !== markersKey) {
        markersKey = sitesKey;
        showMarkers(sites);
      }
      return { labels, built: changed.length, removed: removed.length, areas: update.areas };
    },
    dispose() {
      batch.dispose();
      if (markers !== null) releaseMesh(markers);
      markerGeometry.dispose();
      markerMaterial.dispose();
    },
  };
}
