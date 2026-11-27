/**
 * Per-hex map data as small textures, generated at run time: land cover for
 * the terrain shader, and the two layers that change during a game,
 * territory and fog of war.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import { Feature, Terrain } from '../shared/mapData.ts';
import type { MapData } from '../shared/mapData.ts';
import { FogState } from './scene.ts';
import type { HexRaster } from './hexRaster.ts';

export interface MapTextures {
  /** RGBA: weight of grassland, desert, tundra and snow. Plains are what is left. */
  readonly coverA: DataTexture;
  /** RGBA: weight of forest, jungle, mountain rock and marsh. */
  readonly coverB: DataTexture;
  /** RGB: the owning polity's colour. A: 1 where a polity owns the hex. */
  readonly territory: DataTexture;
  /** R: 1 where the hex is in view, lower where it is not. */
  readonly fog: DataTexture;
  /** Repaints the territory layer. `owner` is per hex, as in `MapData.owner`. */
  setOwners(owner: Int16Array): void;
  /** Repaints the fog layer. `null` puts the whole map in view. */
  setFog(fog: Uint8Array | null): void;
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
  const pixels = raster.width * raster.height;

  const a = bytes(coverA);
  const b = bytes(coverB);
  for (let p = 0; p < pixels; p++) {
    const hex = raster.hexAt[p] as number;
    if (hex < 0) continue;
    const terrain = map.terrain[hex] as number;
    const feature = map.feature[hex] as number;
    const o = p * 4;
    if (terrain === Terrain.Grassland || feature === Feature.Oasis) a[o] = 255;
    if (terrain === Terrain.Desert && feature !== Feature.Oasis) a[o + 1] = 255;
    if (terrain === Terrain.Tundra) a[o + 2] = 255;
    if (terrain === Terrain.Snow) a[o + 3] = 255;
    if (feature === Feature.Forest) b[o] = 255;
    if (feature === Feature.Jungle) b[o + 1] = 255;
    if (terrain === Terrain.Mountain || feature === Feature.Volcano) b[o + 2] = 255;
    if (feature === Feature.Marsh) b[o + 3] = 255;
  }

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
    },
  };
  textures.setOwners(map.owner);
  textures.setFog(null);
  return textures;
}
