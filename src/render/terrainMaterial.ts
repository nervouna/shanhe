/**
 * The ground material, entirely shader code: rock, grass, forest floor,
 * desert, snow and tundra are blended by land cover, slope, altitude and
 * latitude and broken up with noise. Improvements (fields, terraces,
 * pasture, mine spoil) and features (volcano, oasis, marsh) are drawn into
 * the ground; cloud shadows drift over it; territory tint, the political
 * map, the hex grid and the fog of war are laid over the result.
 *
 * Noise comes from one small repeating texture (`noiseTile.ts`), read at a
 * few scales, not from per-pixel noise functions.
 */

import {
  abs,
  atan,
  attribute,
  cameraPosition,
  color,
  cos,
  dot,
  float,
  floor,
  fract,
  max,
  min,
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
import { SNOW_LINE_DROP, SNOW_LINE_FROM, SNOW_LINE_TOP } from './climate.ts';
import { CITY_DEEP, CITY_NORTH, CITY_WIDE, cityDrawnRadius } from './cityLayout.ts';
import { VOLCANO_CRATER } from './heightField.ts';
import { GARRISON_OFFSET } from './pieceLayout.ts';
import {
  bumpedNormal,
  cloudShade,
  gridLineAt,
  hexEdgeDistance,
  hexLocal,
  mapUv,
  noiseTile,
  sinLatitude,
  withFogOfWar,
} from './shaderLib.ts';
import type { MapUniforms } from './shaderLib.ts';

/** The built-up ground of a city of middling size, in hex sizes. */
const TOWN_HALF_WIDTH = cityDrawnRadius(6) * CITY_WIDE;
const TOWN_HALF_DEPTH = cityDrawnRadius(6) * CITY_DEEP;

export function createTerrainMaterial(u: MapUniforms): MeshStandardNodeMaterial {
  const xz = positionWorld.xz;
  // one unit of `p` is one hex size, whatever the scale of the map
  const p = xz.div(u.hexSize);
  // the mesh carries the surface height, which also holds on chunk skirts
  const metres = attribute('altitude', 'float').div(u.unitsPerMetre);
  const slope = float(1).sub(normalWorld.y);

  // the noise texture at four scales; the second is turned, so that the two
  // broad ones never line up into a visible repeat
  const wide = noiseTile(u, p.div(9));
  const wider = noiseTile(u, vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8))).div(23.7));
  const mid = noiseTile(u, p.div(1.4).add(0.37));
  const small = noiseTile(u, p.div(0.43));
  const broad = saturate(wide.r.mul(0.6).add(wider.g.mul(0.4)).sub(0.5).mul(1.5).add(0.5));
  const fine = mid.r;
  const grain = small.b;

  // land cover, read well off-position so that hex outlines dissolve
  const warp = vec2(wide.g, wide.b).sub(0.5).mul(1.3).add(vec2(mid.g, mid.b).sub(0.5).mul(0.3));
  const coverUv = mapUv(u, vec2(xz.add(warp.mul(u.hexSize))));
  const coverA = texture(u.textures.coverA, coverUv);
  const coverB = texture(u.textures.coverB, coverUv);
  const hereUv = mapUv(u, xz);
  const improved = texture(u.textures.improvement, hereUv);
  const feature = texture(u.textures.feature, hereUv);
  // where the point lies in its hex; 0 in the middle of the hex, 1 on its edge
  const within = hexLocal(u, xz);
  const edge = hexEdgeDistance(u, xz, within);

  const viewDistance = cameraPosition.sub(positionWorld).length().div(u.hexSize);
  const nearby = float(1).sub(smoothstep(8, 40, viewDistance));

  // open plains: broad swells of colour, drier and greener stretches, and scrub close by
  const scrub = smoothstep(0.74, 0.86, small.g).mul(nearby);
  let plains = mix(color(0x8a9152), color(0xaba568), broad);
  plains = mix(plains, color(0x6f8a45), smoothstep(0.45, 0.8, wider.b).mul(0.45));
  plains = mix(plains, color(0xb9ad78), smoothstep(0.55, 0.85, mid.a).mul(0.3));
  plains = mix(plains.mul(mix(float(0.92), float(1.06), fine)), color(0x556f38), scrub.mul(0.4));
  const grass = mix(color(0x3f6d2c), color(0x6f9440), broad);
  const dunes = sin(p.x.mul(9).add(p.y.mul(5)).add(broad.mul(9))).mul(0.5).add(0.5);
  const desert = mix(color(0xc9a66b), color(0xe3c88c), dunes.mul(0.5).add(fine.mul(0.5)));
  const tundra = mix(color(0x6f7458), color(0xa39c7e), fine);
  const snow = mix(color(0xdfe8f2), color(0xffffff), fine);
  const forest = mix(color(0x1f4a22), color(0x3a6a2e), grain);
  const jungle = mix(color(0x12401f), color(0x2b6a2c), grain);
  const marsh = mix(color(0x41603a), color(0x74904e), fine.mul(0.6).add(grain.mul(0.4)));
  // warm grey with a trace of olive: no violet in it under any territory tint
  const rock = mix(color(0x5d5b50), color(0x9c9884), fine.mul(0.65).add(grain.mul(0.35)));
  const sand = mix(color(0xcdbb8d), color(0xe6d7ac), fine);

  let ground = mix(plains, grass, coverA.r);
  ground = mix(ground, desert, coverA.g);
  // the ground under the snow of the snow fields is bare and cold, and shows through where the snow is thin
  ground = mix(ground, tundra, saturate(coverA.b.add(coverA.a)));
  // forest stands in patches, not as a flat coat
  const patches = smoothstep(0.3, 0.55, fine.add(broad.mul(0.4)));
  ground = mix(ground, forest, coverB.r.mul(patches.mul(0.75).add(0.25)));
  ground = mix(ground, jungle, coverB.g.mul(patches.mul(0.4).add(0.6)));
  ground = mix(ground, marsh, coverB.a);
  // marsh: winding pools of dark standing water between the reeds, large and small
  const pooling = mid.g.mul(0.55).add(wide.a.mul(0.25)).add(small.r.mul(0.2));
  const pools = smoothstep(0.5, 0.58, pooling).mul(coverB.a);
  ground = mix(ground, color(0x2a4a48), pools.mul(0.8));
  // low ground by the sea and in the deltas: lush and wet, threaded by creeks
  const lowland = float(1)
    .sub(smoothstep(3, 16, metres))
    .mul(smoothstep(0.3, 1.5, metres))
    .mul(float(1).sub(saturate(coverA.g.add(coverA.b).add(coverA.a))));
  ground = mix(ground, mix(color(0x3d7a36), color(0x6ea046), fine), lowland.mul(0.5));
  const creeks = float(1).sub(smoothstep(0.012, 0.035, abs(mid.b.sub(0.5)))).mul(lowland).mul(nearby.mul(0.6).add(0.4));
  ground = mix(ground, color(0x2f5f5c), creeks.mul(0.55));

  // farmland: a patchwork of small fields, each with its own crop and its
  // furrows in its own direction; on slopes the furrows follow the contours
  // as terraces
  const fieldGrid = p.mul(2.3).add(vec2(mid.g, mid.b).sub(0.5).mul(0.35));
  const fieldCell = floor(fieldGrid);
  const fieldIn = fract(fieldGrid);
  const fieldSeed = texture(u.textures.noise, fieldCell.add(0.5).div(256)).level(float(0));
  const fieldAngle = fieldSeed.r.mul(Math.PI);
  const furrow = sin(dot(p, vec2(cos(fieldAngle), sin(fieldAngle))).mul(75)).mul(0.5).add(0.5);
  const terrace = sin(metres.mul(0.11)).mul(0.5).add(0.5);
  const sloped = smoothstep(0.012, 0.05, slope);
  const rows = mix(float(0.5), mix(furrow, terrace, sloped), nearby);
  const crop = mix(mix(color(0x86a03c), color(0xc2ab52), smoothstep(0.35, 0.65, fieldSeed.g)), color(0x5f8a36), smoothstep(0.6, 0.8, fieldSeed.b));
  const fieldEdge = min(min(fieldIn.x, fieldIn.y), min(float(1).sub(fieldIn.x), float(1).sub(fieldIn.y)));
  const balk = float(1).sub(smoothstep(0.03, 0.07, fieldEdge));
  let farmland = crop.mul(mix(float(0.78), float(1.08), rows));
  farmland = mix(farmland, color(0x6e6442), balk.mul(0.7));
  const inside = float(1).sub(smoothstep(0.86, 1, edge.add(fine.sub(0.5).mul(0.12))));
  const farmed = improved.r.mul(inside);
  ground = mix(ground, farmland, farmed.mul(0.92));

  // pasture: cropped grass inside fences, with a herd as pale dots
  const paddock = fract(p.mul(1.15).add(vec2(mid.b, mid.g).sub(0.5).mul(0.2)));
  const paddockEdge = min(min(paddock.x, paddock.y), min(float(1).sub(paddock.x), float(1).sub(paddock.y)));
  const fence = float(1).sub(smoothstep(0.012, 0.03, paddockEdge));
  const herd = smoothstep(0.9, 0.95, small.r).mul(nearby);
  let pastureGround = mix(color(0x7fa24c), color(0xa3b866), fine);
  pastureGround = mix(pastureGround, color(0x5a4630), fence.mul(0.8));
  pastureGround = mix(pastureGround, color(0xe9e4d6), herd.mul(0.85));
  const grazed = improved.g.mul(inside);
  ground = mix(ground, pastureGround, grazed.mul(0.9));

  // a city: trodden, built-up ground under the houses, cut by lanes, and a
  // bare yard before the gate where the garrison stands (`cityLayout.ts`)
  const fromTown = vec2(within.x.div(TOWN_HALF_WIDTH), within.y.add(CITY_NORTH).div(TOWN_HALF_DEPTH)).length();
  const town = feature.b.mul(float(1).sub(smoothstep(0.82, 1.12, fromTown.add(fine.sub(0.5).mul(0.3)))));
  const fromYard = vec2(within.x, within.y.sub(GARRISON_OFFSET)).length();
  const yard = feature.b.mul(float(1).sub(smoothstep(0.34, 0.6, fromYard.add(fine.sub(0.5).mul(0.25))))).mul(0.55);
  const lanes = abs(fract(within.mul(6.5).add(vec2(mid.g, mid.b).mul(0.6))).sub(0.5));
  const lane = float(1).sub(smoothstep(0.03, 0.09, min(lanes.x, lanes.y)));
  let townGround = mix(color(0x9d8f76), color(0xb7a98c), fine);
  townGround = mix(townGround, color(0x6f6452), lane.mul(0.55).mul(nearby.mul(0.7).add(0.3)));
  const built = max(town, yard);
  ground = mix(ground, townGround, built.mul(0.9));

  // rock on steep ground and on mountains
  const steep = smoothstep(0.1, 0.32, slope.add(fine.sub(0.5).mul(0.08)));
  const rocky = saturate(steep.add(coverB.b.mul(smoothstep(0.02, 0.12, slope).mul(0.8).add(0.2))));
  ground = mix(ground, rock, rocky.mul(float(1).sub(max(farmed, grazed).mul(0.8))));

  // a mine: tipped earth and broken rock around the pit head, a ragged patch and not a disc
  // from the middle distances on it is only a trace: a hill is read by its relief, not by a patch per hex
  const spoil = improved.b
    .mul(float(1).sub(smoothstep(0.12, 0.42, edge.add(fine.sub(0.5).mul(0.6)).add(mid.a.sub(0.5).mul(0.3)))))
    .mul(mix(float(0.25), float(1), nearby));
  ground = mix(ground, mix(color(0x5f553f), color(0x8c7c5c), grain), spoil.mul(0.75));

  // a volcano (its cone and crater are in the height field): tongues of dark lava run
  // down from the rim and spread into a field of basalt, a few of them still glowing
  const fromVent = within.length();
  const bearing = atan(within.y, within.x);
  const tongues = sin(bearing.mul(7).add(fine.mul(5)).add(wide.r.mul(9))).mul(0.5).add(0.5);
  const lavaReach = mix(float(0.55), float(1.05), tongues).add(fine.sub(0.5).mul(0.25));
  const lava = feature.r.mul(float(1).sub(smoothstep(lavaReach.sub(0.18), lavaReach, fromVent)));
  ground = mix(ground, mix(color(0x1f1c1b), color(0x4a403a), grain.mul(0.6).add(fine.mul(0.4))), lava.mul(0.9));
  const crater = feature.r.mul(float(1).sub(smoothstep(VOLCANO_CRATER * 0.55, VOLCANO_CRATER * 0.95, fromVent.add(mid.g.sub(0.5).mul(0.04)))));
  const flows = feature.r
    .mul(smoothstep(0.86, 0.97, tongues))
    .mul(float(1).sub(smoothstep(0.2, 0.62, fromVent)))
    .mul(smoothstep(VOLCANO_CRATER * 0.8, VOLCANO_CRATER * 1.3, fromVent))
    .mul(smoothstep(0.35, 0.6, mid.r));

  // an oasis: a pond in a ring of green
  const lush = feature.g.mul(float(1).sub(smoothstep(0.5, 0.8, edge.add(fine.sub(0.5).mul(0.2)))));
  ground = mix(ground, mix(color(0x4f8a35), color(0x7aa846), grain), lush);
  const pond = feature.g.mul(float(1).sub(smoothstep(0.2, 0.27, edge.add(fine.sub(0.5).mul(0.08)))));
  ground = mix(ground, color(0x2c7f8a), pond);

  // snow by land cover, and above the snow line where it is not too steep;
  // the snow line sinks towards the north
  const snowLine = float(SNOW_LINE_TOP)
    .sub(max(sinLatitude(u, xz).sub(SNOW_LINE_FROM), 0).mul(SNOW_LINE_DROP))
    .add(broad.sub(0.5).mul(900));
  const high = smoothstep(snowLine.sub(350), snowLine.add(650), metres);
  // snow lies where the relief lets it: thick on gentle ground, thin and broken on
  // steep faces, with a ragged edge that gives way to bare ground little by little
  const snowfall = coverA.a
    .mul(0.72)
    .add(high.mul(1.1))
    .sub(smoothstep(0.06, 0.45, slope).mul(0.8))
    .add(fine.sub(0.5).mul(0.5))
    .add(grain.sub(0.5).mul(0.24))
    .add(broad.sub(0.5).mul(0.55))
    .add(wider.r.sub(0.5).mul(0.4));
  const snowy = smoothstep(0.3, 0.8, snowfall).mul(float(1).sub(max(crater, lava.mul(0.6))));
  ground = mix(ground, snow, snowy);

  // a strip of sand at sea level, and paler ground under water
  const beach = float(1)
    .sub(smoothstep(0.3, 2.4, metres.add(fine.sub(0.5).mul(1.2))))
    .mul(float(1).sub(saturate(coverA.a.add(coverB.b).add(coverB.a))));
  ground = mix(ground, sand, beach);
  ground = ground.mul(mix(float(0.86), float(1.08), grain));

  const territory = texture(u.textures.territory, hereUv);
  // the tint stays off the sea floor and is weaker on rock and snow
  const tintable = smoothstep(-2, 2, metres).mul(float(1).sub(saturate(rocky.add(snowy)).mul(0.8)));
  let surface = mix(ground, territory.rgb, territory.a.mul(u.tintStrength).mul(tintable));
  // the political map: every polity filled with its colour, land nobody owns
  // pale; the relief still shows through the lighting and a trace of the ground
  const brightness = dot(ground, vec3(0.2126, 0.7152, 0.0722));
  const filled = mix(territory.rgb, vec3(brightness), 0.16);
  // land nobody owns: a pale relief map, tinted by altitude and shaded by slope
  const altitude = mix(mix(color(0xaab59a), color(0xcbbf9c), smoothstep(150, 1600, metres)), color(0xe2dccd), smoothstep(2200, 4800, metres));
  const hillshade = float(1).sub(smoothstep(0.004, 0.16, slope).mul(0.42)).mul(mix(float(0.9), float(1.06), broad));
  const unclaimed = mix(vec3(brightness), altitude, 0.72).mul(hillshade);
  const politicalColor = mix(unclaimed, filled, territory.a);
  surface = mix(surface, politicalColor, u.political.mul(smoothstep(-2, 2, metres)));
  // clouds shade the terrain, and only faintly the political map
  surface = surface.mul(mix(cloudShade(u, xz), float(1), u.political.mul(0.75)));
  surface = mix(surface, vec3(0.04, 0.05, 0.06), gridLineAt(u, edge).mul(0.42));
  surface = withFogOfWar(surface, texture(u.textures.fog, hereUv).r);

  // small relief the mesh is too coarse for: tree crowns, broken rock, dunes,
  // furrows. It fades out with distance, where it would only shimmer.
  const canopy = saturate(coverB.r.mul(patches).add(coverB.g));
  const relief = fine
    .mul(canopy.mul(0.9).add(rocky.mul(1.2)).add(0.15))
    .add(grain.mul(canopy.mul(0.5).add(rocky.mul(0.4)).add(0.05)))
    .add(dunes.mul(coverA.g).mul(0.25))
    .add(rows.mul(farmed).mul(0.12))
    .mul(float(1).sub(saturate(snowy.add(beach).add(pond))));

  const wet = saturate(pools.add(pond).add(creeks.mul(0.7)));
  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(surface);
  material.normalNode = bumpedNormal(float(relief.mul(nearby).mul(u.hexSize).mul(0.035)));
  material.roughnessNode = mix(mix(float(0.95), float(0.55), snowy), float(0.12), wet);
  material.emissiveNode = vec3(
    color(0xff5a14).mul(crater.mul(abs(mid.r.sub(0.5)).mul(2).add(0.6)).mul(2.2).add(flows.mul(1.6))),
  );
  material.metalness = 0;
  return material;
}
