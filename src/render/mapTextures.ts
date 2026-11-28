/**
 * Per-hex map data as small textures, generated at run time: land cover and
 * features for the terrain shader, the layers that change during a game
 * (territory, fog of war, improvements), and the noise the shaders read.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import { Feature, Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { FogState, Improvement } from './scene.ts';
import { blurLayer } from './hexRaster.ts';
import type { HexRaster } from './hexRaster.ts';
import { buildNoiseTile } from './noiseTile.ts';

/** Side of the noise texture in pixels. */
const NOISE_SIZE = 256;

export interface MapTextures {
  /** RGBA: weight of grassland, desert, tundra and snow. Plains are what is left. */
  readonly coverA: DataTexture;
  /** RGBA: weight of forest, jungle, mountain rock and marsh. */
  readonly coverB: DataTexture;
  /** RGB: the owning polity's colour. A: 1 where a polity owns the hex. */
  readonly territory: DataTexture;
  /** R: 1 where the hex is in view, lower where it is not. */
  readonly fog: DataTexture;
  /** RGBA: weight of farmland, pasture, mine and fishery. */
  readonly improvement: DataTexture;
  /** R: volcano, G: oasis, B: a city stands on the hex. */
  readonly feature: DataTexture;
  /** Four fractal noises that repeat without a seam, see `noiseTile.ts`. */
  readonly noise: DataTexture;
  /** Repaints the territory layer. `owner` is per hex, as in `MapData.owner`. */
  setOwners(owner: Int16Array): void;
  /** Repaints the fog layer. `null` puts the whole map in view. */
  setFog(fog: Uint8Array | null): void;
  /** Repaints the improvement layer: hex index to an `Improvement` value. */
  setImprovements(improvements: ReadonlyMap<number, number>): void;
  /** Marks the hexes that hold a city, whose ground is built up. */
  setCities(hexes: ReadonlySet<number>): void;
  dispose(): void;
}

function makeTexture(raster: HexRaster): DataTexture {
  const texture = new DataTexture(
    new Uint8Array(raster.width * raster.height * 4),
    raster.width,
    raster.height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  // row 0 is the north edge and is sampled at v = 0
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function bytes(texture: DataTexture): Uint8Array {
  return texture.image.data as Uint8Array;
}

export function createMapTextures(map: MapData, raster: HexRaster): MapTextures {
  const coverA = makeTexture(raster);
  const coverB = makeTexture(raster);
  const territory = makeTexture(raster);
  const fog = makeTexture(raster);
  const improvement = makeTexture(raster);
  const feature = makeTexture(raster);
  const pixels = raster.width * raster.height;

  const noise = new DataTexture(buildNoiseTile(NOISE_SIZE), NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  noise.wrapS = RepeatWrapping;
  noise.wrapT = RepeatWrapping;
  noise.magFilter = LinearFilter;
  noise.minFilter = LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;

  const a = bytes(coverA);
  const b = bytes(coverB);
  const f = bytes(feature);
  for (let p = 0; p < pixels; p++) {
    const hex = raster.hexAt[p] as number;
    if (hex < 0) continue;
    const terrain = map.terrain[hex] as number;
    const hexFeature = map.feature[hex] as number;
    const o = p * 4;
    if (terrain === Terrain.Grassland || hexFeature === Feature.Oasis) a[o] = 255;
    if (terrain === Terrain.Desert && hexFeature !== Feature.Oasis) a[o + 1] = 255;
    if (terrain === Terrain.Tundra) a[o + 2] = 255;
    if (terrain === Terrain.Snow) a[o + 3] = 255;
    if (hexFeature === Feature.Forest) b[o] = 255;
    if (hexFeature === Feature.Jungle) b[o + 1] = 255;
    if (terrain === Terrain.Mountain || hexFeature === Feature.Volcano) b[o + 2] = 255;
    if (hexFeature === Feature.Marsh) b[o + 3] = 255;
    if (hexFeature === Feature.Volcano) f[o] = 255;
    if (hexFeature === Feature.Oasis) f[o + 1] = 255;
  }
  blurLayer(a, raster.width, raster.height, 2);
  blurLayer(b, raster.width, raster.height, 2);

  // polity colours are stored as sRGB bytes; sampling returns linear colour
  territory.colorSpace = SRGBColorSpace;
  const polityBytes = map.polities.map(
    (polity) => [(polity.color >> 16) & 255, (polity.color >> 8) & 255, polity.color & 255] as const,
  );

  const textures: MapTextures = {
    coverA,
    coverB,
    territory,
    fog,
    improvement,
    feature,
    noise,
    setImprovements(improvements) {
      const data = bytes(improvement);
      data.fill(0);
      if (improvements.size > 0) {
        for (let p = 0; p < pixels; p++) {
          const hex = raster.hexAt[p] as number;
          if (hex < 0) continue;
          const kind = improvements.get(hex);
          if (kind === undefined) continue;
          if (kind === Improvement.Farm) data[p * 4] = 255;
          else if (kind === Improvement.Pasture) data[p * 4 + 1] = 255;
          else if (kind === Improvement.Mine) data[p * 4 + 2] = 255;
          else if (kind === Improvement.Fishery) data[p * 4 + 3] = 255;
        }
      }
      improvement.needsUpdate = true;
    },
    setCities(hexes) {
      for (let p = 0; p < pixels; p++) {
        const hex = raster.hexAt[p] as number;
        f[p * 4 + 2] = hex >= 0 && hexes.has(hex) ? 255 : 0;
      }
      feature.needsUpdate = true;
    },
    setOwners(owner) {
      const data = bytes(territory);
      for (let p = 0; p < pixels; p++) {
        const hex = raster.hexAt[p] as number;
        const rgb = hex < 0 ? undefined : polityBytes[owner[hex] as number];
        const o = p * 4;
        data[o] = rgb?.[0] ?? 0;
        data[o + 1] = rgb?.[1] ?? 0;
        data[o + 2] = rgb?.[2] ?? 0;
        data[o + 3] = rgb === undefined ? 0 : 255;
      }
      territory.needsUpdate = true;
    },
    setFog(state) {
      const data = bytes(fog);
      for (let p = 0; p < pixels; p++) {
        const hex = raster.hexAt[p] as number;
        const value = state === null || hex < 0 ? FogState.Visible : (state[hex] as number);
        data[p * 4] = value === FogState.Visible ? 255 : value === FogState.Remembered ? 110 : 0;
      }
      fog.needsUpdate = true;
    },
    dispose() {
      coverA.dispose();
      coverB.dispose();
      territory.dispose();
      fog.dispose();
      improvement.dispose();
      feature.dispose();
      noise.dispose();
    },
  };
  textures.setOwners(map.owner);
  textures.setFog(null);
  return textures;
}
