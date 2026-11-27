/**
 * The ground material, entirely shader code: rock, grass, forest floor,
 * desert, snow and tundra are blended by land cover, slope and altitude and
 * broken up with procedural noise. Territory tint, the hex grid and the fog
 * of war are laid over the result.
 */

import {
  attribute,
  cameraPosition,
  color,
  float,
  mix,
  normalWorld,
  positionWorld,
  saturate,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { bumpedNormal, fbm, mapUv, noise, withFogOfWar, withGrid } from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

/** Altitude in metres above which bare ground turns to snow. */
const SNOW_LINE_METRES = 4300;

export function createTerrainMaterial(u: MapUniforms): MeshStandardNodeMaterial {
  const xz = positionWorld.xz;
  // one unit of `p` is one hex size, whatever the scale of the map
  const p = xz.div(u.hexSize);
  // the mesh carries the surface height, which also holds on chunk skirts
  const metres = attribute('altitude', 'float').div(u.unitsPerMetre);
  const slope = float(1).sub(normalWorld.y);

  const broad = fbm(p.mul(0.9), 3).mul(0.5).add(0.5);
  const fine = fbm(p.mul(6.5), 4).mul(0.5).add(0.5);
  const grain = noise(p.mul(19)).mul(0.5).add(0.5);

  // land cover, read a little off-position so hex outlines dissolve
  const warp = vec2(noise(p.mul(1.7)), noise(p.mul(1.7).add(vec2(31.4, 7.9)))).mul(0.3);
  const coverUv = mapUv(u, vec2(xz.add(warp.mul(u.hexSize))));
  const coverA = texture(u.textures.coverA, coverUv);
  const coverB = texture(u.textures.coverB, coverUv);

  const plains = mix(color(0x8f9455), color(0xa9a468), broad);
  const grass = mix(color(0x3f6d2c), color(0x6f9440), broad);
  const dunes = sin(p.x.mul(9).add(p.y.mul(5)).add(broad.mul(9))).mul(0.5).add(0.5);
  const desert = mix(color(0xc9a66b), color(0xe3c88c), dunes.mul(0.5).add(fine.mul(0.5)));
  const tundra = mix(color(0x6f7458), color(0xa39c7e), fine);
  const snow = mix(color(0xdfe8f2), color(0xffffff), fine);
  const forest = mix(color(0x1f4a22), color(0x3a6a2e), grain);
  const jungle = mix(color(0x12401f), color(0x2b6a2c), grain);
  const marsh = mix(color(0x4a5a3a), color(0x6d7a4c), fine);
  const rock = mix(color(0x5f5950), color(0x978d7f), fine.mul(0.65).add(grain.mul(0.35)));
  const sand = mix(color(0xcdbb8d), color(0xe6d7ac), fine);

  let ground = mix(plains, grass, coverA.r);
  ground = mix(ground, desert, coverA.g);
  ground = mix(ground, tundra, coverA.b);
  // forest stands in patches, not as a flat coat
  const patches = smoothstep(0.3, 0.55, fine.add(broad.mul(0.4)));
  ground = mix(ground, forest, coverB.r.mul(patches.mul(0.75).add(0.25)));
  ground = mix(ground, jungle, coverB.g.mul(patches.mul(0.4).add(0.6)));
  ground = mix(ground, marsh, coverB.a);

  // rock on steep ground and on mountains
  const steep = smoothstep(0.1, 0.32, slope.add(fine.sub(0.5).mul(0.08)));
  const rocky = saturate(steep.add(coverB.b.mul(smoothstep(0.02, 0.12, slope).mul(0.8).add(0.2))));
  ground = mix(ground, rock, rocky);

  // snow by land cover, and above the snow line where it is not too steep
  const snowLine = float(SNOW_LINE_METRES).add(broad.sub(0.5).mul(900));
  const high = smoothstep(snowLine, snowLine.add(500), metres);
  const snowy = saturate(coverA.a.add(high)).mul(float(1).sub(smoothstep(0.3, 0.55, slope)));
  ground = mix(ground, snow, snowy);

  // a strip of sand at sea level, and paler ground under water
  const beach = float(1).sub(smoothstep(1, 7, metres)).mul(float(1).sub(saturate(coverA.a.add(coverB.b))));
  ground = mix(ground, sand, beach);
  ground = ground.mul(mix(float(0.86), float(1.08), grain));

  const territory = texture(u.textures.territory, mapUv(u, xz));
  // the tint stays off the sea floor and is weaker on rock and snow
  const tintable = smoothstep(-2, 2, metres).mul(float(1).sub(saturate(rocky.add(snowy)).mul(0.6)));
  let surface = mix(ground, territory.rgb, territory.a.mul(u.tintStrength).mul(tintable));
  surface = withGrid(u, surface, xz);
  surface = withFogOfWar(surface, texture(u.textures.fog, mapUv(u, xz)).r);

  // small relief the mesh is too coarse for: tree crowns, broken rock, dunes.
  // It fades out with distance, where it would only shimmer.
  const canopy = saturate(coverB.r.mul(patches).add(coverB.g));
  const relief = fine
    .mul(canopy.mul(0.9).add(rocky.mul(1.2)).add(0.15))
    .add(grain.mul(canopy.mul(0.5).add(rocky.mul(0.4)).add(0.05)))
    .add(dunes.mul(coverA.g).mul(0.25))
    .mul(float(1).sub(saturate(snowy.add(beach))));
  const viewDistance = cameraPosition.sub(positionWorld).length().div(u.hexSize);
  const nearby = float(1).sub(smoothstep(8, 40, viewDistance));

  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(surface);
  material.normalNode = bumpedNormal(float(relief.mul(nearby).mul(u.hexSize).mul(0.035)));
  material.roughnessNode = mix(float(0.95), float(0.55), snowy);
  material.metalness = 0;
  return material;
}
