/**
 * City markers: a procedural cluster of houses that grows with the
 * population. All houses of all cities are two instanced meshes. The names
 * are drawn by the label batch (`labels.ts`); this module says where they
 * stand.
 */

import { attribute, positionWorld, vec3 } from 'three/tsl';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type { BufferGeometry } from 'three/webgpu';
import { hexToWorld, indexToOffset } from '../shared/hex.ts';
import { sampleHeight, surfaceHeightAtHex } from './heightField.ts';
import type { Surface } from './heightField.ts';
import { cityTier } from './labelLayout.ts';
import type { CityLabel } from './labels.ts';
import type { RenderCity } from './scene.ts';
import { noise } from './shaderLib.ts';

export interface Cities {
  readonly object: Group;
  /**
   * Replaces the cities.
   *
   * @returns where the name of each city stands, or `null` if the cities
   *   are the same as before.
   */
  setCities(cities: readonly RenderCity[]): CityLabel[] | null;
  dispose(): void;
}

const WALL_COLORS = [0xd9ccb2, 0xcfc0a3, 0xe4dac6, 0xbfae92];
const ROOF_COLOR = 0x4b4540;
const MAX_HOUSES = 28;

function hash(value: number): number {
  let h = Math.imul(value + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A deterministic sequence of numbers in 0..1 for a seed. */
function randomFrom(seed: number): () => number {
  let state = hash(seed);
  return () => {
    state = hash(state);
    return state / 4294967296;
  };
}

function instanced(geometry: BufferGeometry, material: MeshStandardNodeMaterial, count: number): InstancedMesh {
  const owned = geometry.clone();
  owned.setAttribute('blockColor', new InstancedBufferAttribute(new Float32Array(Math.max(count, 1) * 3), 3));
  const mesh = new InstancedMesh(owned, material, Math.max(count, 1));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function createCities(surface: Surface): Cities {
  const { map, field } = surface;
  const layout = map.projection.hexLayout;
  const size = layout.size;
  const object = new Group();
  object.name = 'cities';

  // a unit box standing on y = 0, and a four-sided roof with flat faces
  const boxGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const roofGeometry = new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0).toNonIndexed();
  roofGeometry.computeVertexNormals();

  const material = new MeshStandardNodeMaterial();
  const weathering = noise(positionWorld.mul(40 / size)).mul(0.08).add(0.96);
  material.colorNode = vec3(attribute('blockColor', 'vec3').mul(weathering));
  material.roughness = 0.85;
  material.metalness = 0;

  let walls: InstancedMesh | null = null;
  let roofs: InstancedMesh | null = null;
  let shownKey = '';
  const capitalSites = new Set(map.zones.filter((zone) => zone.capital).map((zone) => zone.siteHex));

  const clearMeshes = (): void => {
    for (const mesh of [walls, roofs]) {
      if (mesh === null) continue;
      object.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    walls = null;
    roofs = null;
  };

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const position = new Vector3();
  const scale = new Vector3();
  const tint = new Color();

  return {
    object,
    setCities(cities) {
      const key = JSON.stringify(cities.map((c) => [c.hex, c.polity, c.population, c.name, c.capital]));
      if (key === shownKey) return null;
      shownKey = key;
      clearMeshes();

      // lay out every house first, to know how many instances are needed
      interface House {
        x: number;
        y: number;
        z: number;
        w: number;
        d: number;
        h: number;
        turn: number;
        wall: number;
        roof: number;
      }
      const houses: House[] = [];
      const labels: CityLabel[] = [];
      for (const city of cities) {
        if (city.hex < 0 || city.hex >= map.width * map.height) continue;
        const centre = hexToWorld(indexToOffset(city.hex, map.width), layout);
        const random = randomFrom(city.hex);
        const population = Math.max(1, city.population);
        const count = Math.min(MAX_HOUSES, Math.round(3 + population * 1.5));
        const spread = size * Math.min(0.6, 0.17 + 0.075 * Math.sqrt(population));
        const grid = random() * Math.PI;
        const polityColor = map.polities[city.polity]?.color ?? 0x888888;
        let tallest = 0;
        for (let i = 0; i < count; i++) {
          // a sunflower spiral fills the disc evenly; the first house is the centre
          const r = spread * Math.sqrt(i / count);
          const a = i * 2.39996 + grid;
          const x = centre.x + Math.cos(a) * r;
          const z = centre.z + Math.sin(a) * r;
          const inner = 1 - r / spread;
          const h = size * (0.045 + 0.02 * Math.sqrt(population) * inner + 0.03 * random());
          const house: House = {
            x,
            y: sampleHeight(field, x, z),
            z,
            w: size * (0.075 + 0.05 * random()) * (i === 0 ? 1.5 : 1),
            d: size * (0.075 + 0.05 * random()) * (i === 0 ? 1.5 : 1),
            h: i === 0 ? h * 1.5 : h,
            turn: grid + (random() < 0.5 ? 0 : Math.PI / 2),
            wall: WALL_COLORS[Math.floor(random() * WALL_COLORS.length)] as number,
            // the hall in the middle carries the polity colour
            roof: i === 0 ? polityColor : ROOF_COLOR,
          };
          houses.push(house);
          tallest = Math.max(tallest, house.y + house.h * 1.6);
        }

        const ground = Math.max(surfaceHeightAtHex(surface, city.hex), tallest);
        labels.push({
          name: city.name,
          color: polityColor,
          x: centre.x,
          y: ground + 0.06 * size,
          z: centre.z,
          tier: cityTier(city.capital ?? capitalSites.has(city.hex), city.population),
          population: city.population,
        });
      }

      const newWalls = instanced(boxGeometry, material, houses.length);
      const newRoofs = instanced(roofGeometry, material, houses.length);
      const wallColors = newWalls.geometry.getAttribute('blockColor') as InstancedBufferAttribute;
      const roofColors = newRoofs.geometry.getAttribute('blockColor') as InstancedBufferAttribute;
      houses.forEach((house, i) => {
        rotation.setFromAxisAngle(up, house.turn);
        matrix.compose(position.set(house.x, house.y, house.z), rotation, scale.set(house.w, house.h, house.d));
        newWalls.setMatrixAt(i, matrix);
        tint.setHex(house.wall);
        wallColors.setXYZ(i, tint.r, tint.g, tint.b);
        // the roof overhangs the walls a little
        matrix.compose(
          position.set(house.x, house.y + house.h, house.z),
          rotation,
          scale.set(house.w * 1.15, house.h * 0.6, house.d * 1.15),
        );
        newRoofs.setMatrixAt(i, matrix);
        tint.setHex(house.roof);
        roofColors.setXYZ(i, tint.r, tint.g, tint.b);
      });
      walls = newWalls;
      roofs = newRoofs;
      object.add(newWalls, newRoofs);
      return labels;
    },
    dispose() {
      clearMeshes();
      boxGeometry.dispose();
      roofGeometry.dispose();
      material.dispose();
    },
  };
}
