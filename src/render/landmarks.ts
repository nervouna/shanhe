/**
 * The 50 nations' unique buildings as landmarks: each is put together
 * from a small set of parametric pieces (a hall, a tiered tower, a stupa, a
 * wall, an arch, a terrace, a round house, a pond, stilts, chimneys, ...),
 * so that fifty different models cost a few lines each and are drawn with
 * the same handful of shapes as the cities. No Three.js.
 *
 * Landmarks are named by the id of their nation in the map's polity list
 * (`yan`, `jin`, ...), in the order of `docs/design/02-nations.md`.
 */

import { PartShape } from './cityGen.ts';
import type { Part, PartShapeId } from './cityGen.ts';

/** A landmark under construction: pieces are added around its own origin. */
class Kit {
  readonly parts: Part[] = [];

  add(shape: PartShapeId, x: number, y: number, z: number, w: number, h: number, d: number, color: number, yaw = 0, glow = 0): this {
    this.parts.push(glow > 0 ? { shape, x, y, z, w, h, d, yaw, color, glow } : { shape, x, y, z, w, h, d, yaw, color });
    return this;
  }

  /** Walls under a roof. `roof` is the roof's shape; its height is `rise` times the walls'. */
  hall(x: number, z: number, w: number, d: number, h: number, wall: number, roofColor: number, roof: PartShapeId = PartShape.Hip, rise = 0.7, y = 0, yaw = 0): this {
    this.add(PartShape.Box, x, y, z, w, h, d, wall, yaw);
    return this.add(roof, x, y + h, z, w * 1.22, h * rise, d * 1.22, roofColor, yaw);
  }

  /** Storeys that shrink towards the top, each under its own roof: a pagoda, a keep. */
  tower(x: number, z: number, tiers: number, w: number, tierHeight: number, shrink: number, wall: number, roofColor: number, y = 0): this {
    let level = y;
    for (let tier = 0; tier < tiers; tier++) {
      const width = w * (1 - shrink * tier);
      this.add(PartShape.Box, x, level, z, width * 0.74, tierHeight, width * 0.74, wall);
      level += tierHeight;
      this.add(PartShape.Hip, x, level, z, width * 1.2, tierHeight * 0.55, width * 1.2, roofColor);
      level += tierHeight * 0.22;
    }
    return this;
  }

  /** A dome under a spire, on a square base. */
  stupa(x: number, z: number, w: number, h: number, body: number, spire: number, y = 0): this {
    this.add(PartShape.Box, x, y, z, w, h * 0.16, w, body);
    this.add(PartShape.Dome, x, y + h * 0.16, z, w * 0.8, h * 0.34, w * 0.8, body);
    return this.add(PartShape.Cone, x, y + h * 0.42, z, w * 0.3, h * 0.58, w * 0.3, spire);
  }

  /** A straight wall from one point to another. */
  wall(x0: number, z0: number, x1: number, z1: number, h: number, thickness: number, color: number): this {
    const length = Math.hypot(x1 - x0, z1 - z0);
    return this.add(PartShape.Box, (x0 + x1) / 2, 0, (z0 + z1) / 2, length, h, thickness, color, -Math.atan2(z1 - z0, x1 - x0));
  }

  /** A closed wall with `sides` sides around a point. */
  ring(x: number, z: number, radius: number, sides: number, h: number, color: number, turn = 0): this {
    for (let s = 0; s < sides; s++) {
      const a0 = turn + (s / sides) * Math.PI * 2;
      const a1 = turn + ((s + 1) / sides) * Math.PI * 2;
      this.wall(x + Math.cos(a0) * radius, z + Math.sin(a0) * radius, x + Math.cos(a1) * radius, z + Math.sin(a1) * radius, h, 0.014, color);
    }
    return this;
  }

  /** Posts carrying `beams` lintels: a memorial arch, a torii, a rack. */
  arch(x: number, z: number, w: number, h: number, posts: number, beams: number, color: number, yaw = 0, beamColor = color): this {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (let p = 0; p < posts; p++) {
      const along = posts === 1 ? 0 : (p / (posts - 1) - 0.5) * w;
      this.add(PartShape.Box, x + cos * along, 0, z - sin * along, w * 0.07, h, w * 0.07, color, yaw);
    }
    for (let b = 0; b < beams; b++) {
      this.add(PartShape.Box, x, h * (1 - 0.2 * b) - h * 0.04, z, w * (1.24 - 0.12 * b), h * 0.08, w * 0.09, beamColor, yaw);
    }
    return this;
  }

  /** A stepped platform. */
  terrace(x: number, z: number, w: number, d: number, steps: number, stepHeight: number, color: number, shrink = 0.16): this {
    for (let s = 0; s < steps; s++) {
      const k = 1 - shrink * s;
      this.add(PartShape.Box, x, s * stepHeight, z, w * k, stepHeight, d * k, color);
    }
    return this;
  }

  /** A sheet of water, level with the ground. */
  pond(x: number, z: number, w: number, d: number, yaw = 0): this {
    return this.add(PartShape.Box, x, 0, z, w, 0.006, d, 0x3f8fa8, yaw);
  }

  /** A round building: a drum under a conical roof. */
  round(x: number, z: number, w: number, h: number, wall: number, roofColor: number, rise = 0.6): this {
    this.add(PartShape.Cylinder, x, 0, z, w, h, w, wall);
    return this.add(PartShape.Cone, x, h, z, w * 1.12, h * rise, w * 1.12, roofColor);
  }

  /** A house on posts. */
  stilt(x: number, z: number, w: number, d: number, h: number, wall: number, roofColor: number, yaw = 0): this {
    this.add(PartShape.Box, x, 0, z, w * 0.8, h * 0.5, d * 0.7, 0x3c2e22, yaw);
    this.add(PartShape.Box, x, h * 0.5, z, w, h * 0.5, d, wall, yaw);
    return this.add(PartShape.Gable, x, h, z, w * 1.15, h * 0.7, d * 1.2, roofColor, yaw);
  }

  /** A shed with chimneys beside it. */
  works(x: number, z: number, w: number, chimneys: number, wall: number, stack: number, yaw = 0): this {
    this.hall(x, z, w, w * 0.5, w * 0.3, wall, 0x4f4c48, PartShape.Gable, 0.4, 0, yaw);
    for (let c = 0; c < chimneys; c++) {
      this.add(PartShape.Cylinder, x + (c - (chimneys - 1) / 2) * w * 0.4, 0, z + w * 0.42, w * 0.14, w * 0.95, w * 0.14, stack);
    }
    return this;
  }

  /** A boat: a hull and, with `mast`, a mast and a sail. */
  boat(x: number, z: number, length: number, color: number, yaw = 0, mast = false): this {
    this.add(PartShape.Box, x, 0.004, z, length, length * 0.18, length * 0.3, color, yaw);
    if (mast) {
      this.add(PartShape.Box, x, 0.004, z, length * 0.04, length * 0.9, length * 0.04, 0x4a3a2a, yaw);
      this.add(PartShape.Box, x, length * 0.3, z, length * 0.03, length * 0.5, length * 0.5, 0xe9dfc8, yaw);
    }
    return this;
  }

  /** A row of small trees. */
  grove(x: number, z: number, count: number, spacing: number, h: number, color: number, yaw = 0): this {
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * spacing;
      this.add(PartShape.Cone, x + Math.cos(yaw) * along, 0, z - Math.sin(yaw) * along, h * 0.6, h, h * 0.6, color);
    }
    return this;
  }
}

const GREY_TILE = 0x4b4a48;
const BLACK_TILE = 0x2b2b2e;
const RED_PILLAR = 0xa63a2e;
const WHITE_WALL = 0xeeeae0;
const BRICK = 0x9c5a40;
const STONE = 0x9a958a;
const TIMBER = 0x6b4a2e;
const GOLD = 0xe0b23c;
const THATCH = 0x8c6a3a;
const GREEN = 0x3f7a35;

/** Hip, gable and the rest, shorter to write below. */
const { Box, Hip, Gable, Cylinder, Cone, Dome } = PartShape;

/** One recipe per nation: the pieces of its landmark, within about 0.3 hex sizes of its origin. */
const RECIPES: Readonly<Record<string, (kit: Kit) => void>> = {
  // 长城关隘 Great Wall pass: a wall across the valley with a gate tower and two watchtowers
  yan: (k) => {
    k.wall(-0.3, 0.03, -0.07, 0, 0.07, 0.035, STONE).wall(0.07, 0, 0.3, -0.03, 0.07, 0.035, STONE);
    k.add(Box, 0, 0, 0, 0.14, 0.1, 0.07, STONE).hall(0, 0, 0.11, 0.055, 0.04, RED_PILLAR, GREY_TILE, Hip, 0.7, 0.1);
    k.add(Box, -0.3, 0, 0.03, 0.05, 0.11, 0.05, STONE).add(Box, 0.3, 0, -0.03, 0.05, 0.11, 0.05, STONE);
  },
  // 票号 draft bank: a walled compound of counting houses around a court
  jin: (k) => {
    k.ring(0, 0, 0.2, 4, 0.05, 0x8d8676, Math.PI / 4);
    k.hall(0, -0.08, 0.2, 0.06, 0.05, 0xa89c88, GREY_TILE, Gable, 0.5).hall(0, 0.08, 0.2, 0.06, 0.05, 0xa89c88, GREY_TILE, Gable, 0.5);
    k.hall(-0.09, 0, 0.05, 0.09, 0.04, 0xa89c88, GREY_TILE, Gable, 0.5).hall(0.09, 0, 0.05, 0.09, 0.07, 0xa89c88, GREY_TILE, Hip);
  },
  // 稷下学宫 Jixia academy: a lecture hall on a terrace between two pavilions
  qi: (k) => {
    k.terrace(0, 0, 0.3, 0.2, 2, 0.02, 0xcfc6b2).hall(0, 0, 0.2, 0.1, 0.06, RED_PILLAR, GREY_TILE, Hip, 0.8, 0.04);
    k.hall(-0.19, 0.06, 0.06, 0.06, 0.04, RED_PILLAR, GREY_TILE).hall(0.19, 0.06, 0.06, 0.06, 0.04, RED_PILLAR, GREY_TILE);
  },
  // 常平仓 ever-normal granary: round granaries on a platform
  zhongzhou: (k) => {
    k.add(Box, 0, 0, 0, 0.34, 0.015, 0.2, 0xb8ad9a);
    for (let i = 0; i < 4; i++) k.round(-0.12 + i * 0.08, i % 2 === 0 ? -0.03 : 0.04, 0.07, 0.07, 0xd9c9a0, THATCH, 0.7);
    k.hall(0.02, -0.12, 0.1, 0.04, 0.035, 0xa89c88, GREY_TILE, Gable, 0.5);
  },
  // 驰道 imperial highway: a paved road under a gate, with a watchtower
  qin: (k) => {
    k.add(Box, 0, 0, 0, 0.6, 0.006, 0.07, 0xb5a98c).arch(0, 0, 0.11, 0.11, 2, 2, 0x4a4038, Math.PI / 2, 0x2b2b2e);
    k.tower(0.14, 0.09, 2, 0.07, 0.05, 0.2, 0x8d8676, 0x2b2b2e);
  },
  // 驿站 relay station: a walled yard, stables and a beacon tower
  longyou: (k) => {
    k.ring(0, 0, 0.18, 4, 0.04, 0xcbb890, Math.PI / 4).hall(-0.04, -0.03, 0.12, 0.05, 0.04, 0xcbb890, 0x7a6a4a, Gable, 0.4);
    k.add(Box, 0.1, 0, 0.08, 0.06, 0.14, 0.06, 0xbfae84).add(Cone, 0.1, 0.14, 0.08, 0.03, 0.04, 0.03, 0xff7a2a, 0, 1.2);
  },
  // 引黄渠 Yellow River canal: a channel with a sluice and its keeper's house
  xixia: (k) => {
    k.pond(0, 0, 0.46, 0.05, 0.3).add(Box, 0, 0, 0, 0.03, 0.05, 0.1, STONE, 0.3).add(Box, 0, 0.05, 0, 0.04, 0.012, 0.13, TIMBER, 0.3);
    k.hall(0.1, 0.1, 0.07, 0.05, 0.04, 0xcbb890, 0x7a6a4a, Gable, 0.5).grove(-0.12, -0.09, 3, 0.05, 0.06, GREEN, 0.3);
  },
  // 茶马互市 tea-horse market: rows of stalls and a trader's tent
  qingtang: (k) => {
    for (let i = 0; i < 6; i++) {
      k.hall(-0.15 + (i % 3) * 0.1, i < 3 ? -0.06 : 0.04, 0.07, 0.04, 0.025, 0x8a6a45, [0xb5463a, 0x3f6a8a, 0xd9a93a][i % 3] as number, Hip, 0.9);
    }
    k.round(0.18, 0, 0.09, 0.04, 0xece7da, 0xd8d0bd).add(Box, 0.02, 0, 0.13, 0.3, 0.012, 0.012, TIMBER);
  },
  // 都江堰 Dujiangyan weir: the fish-mouth levee that splits the river, and a temple above it
  shu: (k) => {
    k.pond(0, 0, 0.46, 0.16).add(Box, 0.03, 0, 0, 0.36, 0.022, 0.035, 0xb8ad9a).add(Cone, -0.17, 0, 0, 0.05, 0.03, 0.05, 0xb8ad9a);
    k.hall(0.12, -0.15, 0.09, 0.06, 0.045, RED_PILLAR, GREY_TILE, Hip, 0.8).add(Box, 0, 0.022, 0.05, 0.012, 0.012, 0.1, TIMBER);
  },
  // 吊脚楼 diaojiaolou: stilt houses climbing a slope in steps
  ba: (k) => {
    k.terrace(0, 0.04, 0.3, 0.24, 3, 0.035, 0x7d735f, 0.24);
    k.stilt(-0.07, 0.11, 0.09, 0.06, 0.08, 0x7a5636, BLACK_TILE).stilt(0.06, 0.02, 0.09, 0.06, 0.1, 0x7a5636, BLACK_TILE);
    k.stilt(-0.02, -0.07, 0.08, 0.05, 0.12, 0x7a5636, BLACK_TILE);
  },
  // 茶马古道 tea-horse road: a caravan inn by a bridge, with tea terraces behind
  dian: (k) => {
    k.terrace(0.1, -0.1, 0.24, 0.16, 3, 0.018, 0x4f8a35, 0.2).hall(-0.1, 0.06, 0.12, 0.07, 0.045, 0xd9c9a0, GREY_TILE, Gable, 0.5);
    k.add(Box, 0.09, 0, 0.12, 0.16, 0.03, 0.035, STONE).pond(0.09, 0.12, 0.05, 0.14);
  },
  // 屯堡 fortified village: stone houses inside a wall, under a watchtower
  yelang: (k) => {
    k.ring(0, 0, 0.19, 6, 0.055, 0x8a8478).tower(0, 0, 2, 0.07, 0.07, 0.15, 0x8a8478, 0x55524c);
    k.hall(-0.09, 0.04, 0.07, 0.05, 0.035, 0x9a958a, 0x55524c, Gable, 0.5).hall(0.09, -0.03, 0.07, 0.05, 0.035, 0x9a958a, 0x55524c, Gable, 0.5);
  },
  // 宗堡 dzong fortress: white battered walls on a rock, a red upper storey and gilded roofs
  tubo: (k) => {
    k.terrace(0, 0, 0.3, 0.2, 2, 0.04, 0x8a8478, 0.15).add(Box, 0, 0.08, 0, 0.22, 0.11, 0.13, 0xf1ece0);
    k.add(Box, 0, 0.19, 0, 0.2, 0.035, 0.12, 0x7a2a22).add(Hip, 0, 0.225, 0, 0.12, 0.03, 0.08, GOLD);
    k.add(Box, -0.13, 0.04, 0.04, 0.07, 0.1, 0.07, 0xf1ece0).add(Box, 0.13, 0.04, 0.04, 0.07, 0.1, 0.07, 0xf1ece0);
  },
  // 章华台 Zhanghua terrace: a high stepped terrace with a palace on top
  chu: (k) => {
    k.terrace(0, 0, 0.34, 0.26, 4, 0.03, 0xb39a6e, 0.18).hall(0, 0, 0.13, 0.08, 0.05, 0x8a2a22, 0x2b2b2e, Hip, 0.9, 0.12);
    k.add(Box, 0, 0, 0.16, 0.05, 0.06, 0.1, 0xb39a6e);
  },
  // 书院 shuyuan: a gate, a lecture hall and a library in a row, among trees
  xiaoxiang: (k) => {
    k.arch(0, 0.17, 0.09, 0.07, 2, 1, STONE).hall(0, 0.05, 0.16, 0.07, 0.045, WHITE_WALL, BLACK_TILE, Gable, 0.55);
    k.hall(0, -0.09, 0.12, 0.07, 0.07, WHITE_WALL, BLACK_TILE, Hip, 0.6).grove(-0.14, -0.02, 3, 0.07, 0.07, GREEN, Math.PI / 2);
  },
  // 御窑 imperial kiln: a long dragon kiln up the slope, with chimneys and drying sheds
  yuzhang: (k) => {
    k.add(Gable, 0, 0, 0, 0.36, 0.05, 0.07, BRICK, 0.4).add(Cylinder, 0.17, 0, -0.08, 0.04, 0.15, 0.04, BRICK);
    k.add(Cone, 0.17, 0.15, -0.08, 0.02, 0.02, 0.02, 0xff7a2a, 0, 1.4);
    k.hall(-0.1, 0.13, 0.12, 0.06, 0.035, 0xd9d2c0, GREY_TILE, Gable, 0.4).add(Box, 0.08, 0, 0.14, 0.1, 0.012, 0.06, 0xf4f1e8);
  },
  // 牌坊 memorial arch: a stone arch of three bays, with carved roofs
  huainan: (k) => {
    k.arch(0, 0, 0.3, 0.16, 4, 3, 0xb8b2a4, 0, 0x8d8676);
    k.add(Hip, 0, 0.165, 0, 0.14, 0.03, 0.05, BLACK_TILE).add(Hip, -0.12, 0.13, 0, 0.09, 0.025, 0.045, BLACK_TILE).add(Hip, 0.12, 0.13, 0, 0.09, 0.025, 0.045, BLACK_TILE);
    k.add(Box, 0, 0, 0, 0.4, 0.008, 0.12, 0xb5a98c);
  },
  // 园林 classical garden: a pond with a pavilion, rockery, a covered walk and a moon gate wall
  wu: (k) => {
    k.pond(0, 0, 0.22, 0.16).hall(0.05, 0.02, 0.05, 0.05, 0.035, RED_PILLAR, BLACK_TILE, Hip, 1).ring(0, 0, 0.22, 4, 0.035, WHITE_WALL, Math.PI / 4);
    k.add(Dome, -0.1, 0, -0.09, 0.07, 0.06, 0.05, 0x8a8478).hall(0, 0.14, 0.2, 0.03, 0.03, WHITE_WALL, BLACK_TILE, Gable, 0.5).grove(-0.12, 0.07, 2, 0.06, 0.07, GREEN);
  },
  // 海塘 seawall: a long stone dyke against the tide, with a tide-watching pavilion
  yue: (k) => {
    k.add(Gable, 0, 0, 0, 0.6, 0.045, 0.07, STONE).pond(0, 0.1, 0.46, 0.12).tower(0.12, -0.03, 2, 0.06, 0.04, 0.2, RED_PILLAR, BLACK_TILE, 0.03);
  },
  // 土楼 tulou: a great round earthen house around a court
  min: (k) => {
    k.add(Cylinder, 0, 0, 0, 0.3, 0.1, 0.3, 0xc9a66b).add(Cylinder, 0, 0.1, 0, 0.33, 0.012, 0.33, BLACK_TILE);
    k.add(Cylinder, 0, 0.1, 0, 0.2, 0.014, 0.2, 0x6e6442).round(0, 0, 0.07, 0.04, 0xc9a66b, BLACK_TILE).hall(0.2, 0.1, 0.06, 0.05, 0.035, 0xc9a66b, BLACK_TILE, Gable, 0.5);
  },
  // 糖廍 sugar mill: an ox-driven crusher under a round roof, a boiling house and cane
  dongning: (k) => {
    k.round(-0.08, 0, 0.14, 0.035, TIMBER, THATCH, 1.2).works(0.1, 0, 0.14, 1, 0xa89c88, BRICK);
    k.grove(0, 0.16, 6, 0.045, 0.05, 0x8fae3a);
  },
  // 十三行 Thirteen Hongs: a waterfront row of arcaded trading houses under flags
  lingnan: (k) => {
    for (let i = 0; i < 5; i++) {
      k.add(Box, -0.2 + i * 0.1, 0, 0, 0.085, 0.085, 0.09, 0xf1ece0).add(Hip, -0.2 + i * 0.1, 0.085, 0, 0.09, 0.025, 0.095, 0x7a3b24);
      k.add(Box, -0.2 + i * 0.1, 0, 0.09, 0.006, 0.17, 0.006, 0x4a3a2a).add(Box, -0.185 + i * 0.1, 0.14, 0.09, 0.03, 0.02, 0.004, [0xb5463a, 0x3f6a8a, 0xe8e2d0, 0xd9a93a, 0x3f7a35][i] as number);
    }
    k.pond(0, 0.17, 0.46, 0.1).boat(0.08, 0.17, 0.12, TIMBER, 0, true);
  },
  // 灵渠 Lingqu canal: a canal over the watershed, with a plough-share weir and a bridge
  luoyue: (k) => {
    k.pond(0, 0, 0.46, 0.045, -0.25).add(Box, -0.1, 0, 0.03, 0.14, 0.02, 0.025, STONE, 0.6).add(Box, -0.1, 0, -0.03, 0.14, 0.02, 0.025, STONE, -0.9);
    k.add(Box, 0.12, 0.02, -0.03, 0.04, 0.012, 0.13, STONE).add(Box, 0.12, 0, -0.085, 0.04, 0.03, 0.02, STONE).add(Box, 0.12, 0, 0.025, 0.04, 0.03, 0.02, STONE);
    k.hall(0.2, 0.11, 0.07, 0.05, 0.04, 0xd9c9a0, GREY_TILE, Gable, 0.5);
  },
  // 骑楼 arcade house: a street of shophouses with arcades below
  qiongya: (k) => {
    for (let i = 0; i < 4; i++) {
      const x = -0.15 + i * 0.1;
      k.add(Box, x, 0.035, -0.06, 0.09, 0.075, 0.09, [0xf1ece0, 0xe8d9a8, 0xd9e2e0, 0xf0d9c4][i] as number).add(Box, x, 0, -0.07, 0.09, 0.035, 0.06, 0x3c3a36);
      k.add(Box, x, 0.11, -0.02, 0.09, 0.012, 0.012, 0xd0c8b4);
    }
    k.add(Box, 0, 0, 0.02, 0.42, 0.005, 0.05, 0xb5a98c).grove(0, 0.09, 4, 0.1, 0.09, 0x3f8a45);
  },
  // 铁西工坊 Tiexi works: blast furnaces, long sheds and a forest of chimneys
  liaodong: (k) => {
    k.works(-0.1, -0.04, 0.2, 3, 0x7d4a3a, 0x6a3d30).works(0.13, 0.08, 0.16, 2, 0x8a8478, 0x6a3d30);
    k.add(Cylinder, 0.13, 0, -0.1, 0.07, 0.13, 0.07, 0x3c3a38).add(Cone, 0.13, 0.13, -0.1, 0.05, 0.03, 0.05, 0xff6a1a, 0, 1.5);
  },
  // 参场 ginseng farm: rows of low shade roofs over the beds, and a drying house
  fuyu: (k) => {
    for (let i = 0; i < 5; i++) k.add(Gable, 0, 0.012, -0.14 + i * 0.06, 0.3, 0.02, 0.04, 0x8c7a4a).add(Box, 0, 0, -0.14 + i * 0.06, 0.3, 0.012, 0.03, 0x4a3a26);
    k.hall(0.21, 0, 0.07, 0.1, 0.045, TIMBER, 0x39424a, Gable, 0.8);
  },
  // 林场 forestry: stacked logs, a sawmill and a fire watchtower
  heishui: (k) => {
    for (let i = 0; i < 3; i++) k.add(Box, -0.14, i * 0.024, -0.02 + (i % 2) * 0.012, 0.2, 0.024, 0.05 - i * 0.012, 0x7a5636);
    k.add(Box, -0.14, 0, 0.06, 0.16, 0.05, 0.05, 0x6b4a2e).hall(0.07, 0.03, 0.14, 0.08, 0.05, TIMBER, 0x39424a, Gable, 0.7);
    k.add(Box, 0.2, 0, -0.1, 0.02, 0.17, 0.02, TIMBER).hall(0.2, -0.1, 0.05, 0.05, 0.03, TIMBER, 0x39424a, Hip, 0.8, 0.17).grove(0, -0.15, 4, 0.07, 0.1, 0x1f4a2a);
  },
  // 板升 baishin settlement: a walled farming town on the steppe, with a temple
  monan: (k) => {
    k.ring(0, 0, 0.22, 4, 0.045, 0xbfae84, Math.PI / 4).tower(0, 0, 2, 0.09, 0.045, 0.2, 0xf1ece0, 0xb5463a);
    k.hall(-0.1, 0.07, 0.07, 0.05, 0.03, 0xbfae84, 0x8c7a4a, Gable, 0.4).hall(0.1, -0.07, 0.07, 0.05, 0.03, 0xbfae84, 0x8c7a4a, Gable, 0.4).round(0.1, 0.08, 0.06, 0.03, 0xece7da, 0xd8d0bd);
  },
  // 斡耳朵 ordo: the khan's great tent in a ring of yurts, under a standard
  mobei: (k) => {
    k.round(0, 0, 0.17, 0.06, 0xf3efe4, 0xc9a44a, 0.8).add(Cylinder, 0, 0.1, 0, 0.03, 0.02, 0.03, 0xb5463a);
    for (let i = 0; i < 6; i++) k.round(Math.cos(i * 1.047 + 0.3) * 0.2, Math.sin(i * 1.047 + 0.3) * 0.2, 0.06, 0.03, 0xece7da, 0xd8d0bd);
    k.add(Box, 0, 0, 0.12, 0.01, 0.2, 0.01, 0x4a3a2a).add(Box, 0.02, 0.15, 0.12, 0.04, 0.045, 0.004, 0xf3efe4);
  },
  // 集贤殿 Hall of Worthies: a broad hall with a deep hipped roof on a stone terrace
  goryeo: (k) => {
    k.terrace(0, 0, 0.32, 0.2, 2, 0.02, 0xb8b2a4, 0.1).hall(0, 0, 0.22, 0.1, 0.055, 0x8a3a2e, 0x3d4650, Hip, 0.9, 0.04);
    k.add(Box, 0, 0.04, 0.062, 0.2, 0.05, 0.008, 0x3f7a6a).arch(0, 0.17, 0.08, 0.06, 2, 1, 0x8a3a2e);
  },
  // 鲑鱼渔场 salmon fishery: drying racks hung with fish, a hut and boats on the river
  ezo: (k) => {
    k.pond(0, 0.13, 0.46, 0.1).boat(-0.1, 0.13, 0.1, TIMBER).boat(0.12, 0.14, 0.08, TIMBER, 0.4);
    for (let i = 0; i < 3; i++) k.arch(-0.13 + i * 0.12, -0.02, 0.09, 0.06, 2, 2, 0x7a5636, 0, 0xc98a6a);
    k.hall(0.02, -0.14, 0.09, 0.06, 0.03, 0x8c7a4a, THATCH, Gable, 1.3);
  },
  // 城下町 castle town: a keep of white storeys on a stone base, behind a moat
  togoku: (k) => {
    k.pond(0, 0, 0.36, 0.36).add(Box, 0, 0, 0, 0.26, 0.06, 0.26, 0x8a8d8c).add(Box, 0, 0.06, 0, 0.2, 0.03, 0.2, 0x9a9d9c);
    k.tower(0, 0, 3, 0.14, 0.05, 0.22, 0xf1ece0, 0x343c45, 0.09).add(Box, 0.11, 0.06, 0.11, 0.05, 0.05, 0.05, 0xf1ece0).add(Hip, 0.11, 0.11, 0.11, 0.065, 0.025, 0.065, 0x343c45);
  },
  // 神社 shrine: a vermilion torii before a shrine hall, among cedars
  yamato: (k) => {
    k.arch(0, 0.14, 0.13, 0.14, 2, 2, 0xc8402a).hall(0, -0.06, 0.12, 0.08, 0.05, 0x7a5636, 0x4a4038, Gable, 1.1, 0.015).add(Box, 0, 0, -0.06, 0.15, 0.015, 0.11, STONE);
    k.grove(-0.14, -0.05, 3, 0.08, 0.14, 0x1f4a2a, Math.PI / 2).grove(0.14, -0.05, 3, 0.08, 0.14, 0x1f4a2a, Math.PI / 2);
  },
  // 出岛商馆 Dejima trading post: a fan-shaped island with warehouses, a bridge and a flag
  tsukushi: (k) => {
    k.pond(0, 0, 0.5, 0.36).add(Cylinder, 0, 0, 0, 0.36, 0.02, 0.2, 0xb8ad9a).add(Box, 0, 0.012, -0.14, 0.03, 0.012, 0.1, TIMBER);
    for (let i = 0; i < 4; i++) k.hall(-0.12 + i * 0.08, 0, 0.06, 0.09, 0.04, i % 2 === 0 ? WHITE_WALL : 0x5a4636, 0x3d4650, Gable, 0.6, 0.02);
    k.add(Box, 0.16, 0.02, 0.05, 0.008, 0.18, 0.008, 0x4a3a2a).add(Box, 0.18, 0.17, 0.05, 0.04, 0.025, 0.004, 0xe8e2d0);
  },
  // 御城 gusuku: curving limestone walls on a hilltop around a red hall
  ryukyu: (k) => {
    k.add(Dome, 0, 0, 0, 0.44, 0.05, 0.34, 0x8a9a62).ring(0, 0, 0.19, 9, 0.085, 0xd0c8b4).ring(0.03, 0.02, 0.11, 7, 0.1, 0xd0c8b4, 0.4);
    k.hall(0.03, 0.02, 0.1, 0.06, 0.05, 0xb5362a, 0x9c4a3a, Hip, 0.8, 0.05);
  },
  // 冰上驿道 ice road: a marked track over the frozen lake, with a relay hut and sledges
  beihai: (k) => {
    k.add(Box, 0, 0, 0, 0.5, 0.006, 0.14, 0xc9dbe6).add(Box, 0, 0.006, 0, 0.5, 0.003, 0.04, 0xa9bfcc);
    for (let i = 0; i < 6; i++) k.add(Box, -0.21 + i * 0.084, 0, i % 2 === 0 ? 0.035 : -0.035, 0.008, 0.06, 0.008, 0x3c2e22);
    k.hall(0.12, -0.14, 0.08, 0.06, 0.04, TIMBER, 0xe8eef2, Gable, 0.9).boat(-0.1, 0, 0.07, 0x6b4a2e);
  },
  // 船坞 dockyard: a slipway with a hull on it, a crane and sheds by the water
  shuaibin: (k) => {
    k.pond(0, 0.14, 0.46, 0.14).add(Box, 0, 0, 0.05, 0.1, 0.012, 0.22, 0x8a8478).boat(0, 0.05, 0.2, 0x7a5636, Math.PI / 2, true);
    k.add(Box, 0.12, 0, 0.02, 0.02, 0.18, 0.02, 0x55524c).add(Box, 0.08, 0.17, 0.02, 0.12, 0.012, 0.012, 0x55524c).hall(-0.15, -0.06, 0.14, 0.08, 0.05, TIMBER, 0x39424a, Gable, 0.6);
  },
  // 水上戏台 water puppet stage: a pavilion standing in a pond, with a viewing bank
  jiaozhi: (k) => {
    k.pond(0, 0, 0.3, 0.24).add(Box, 0, 0, -0.04, 0.12, 0.012, 0.08, TIMBER).hall(0, -0.04, 0.11, 0.07, 0.045, 0xa63a2e, 0x7a3b24, Hip, 1.1, 0.012);
    k.add(Hip, 0, 0.09, -0.04, 0.08, 0.035, 0.05, 0x8c4a2c).terrace(0, 0.16, 0.3, 0.06, 2, 0.015, 0xb5a98c, 0.2);
  },
  // 占婆塔 Cham tower: a tall brick sanctuary tower with a stepped roof, and two smaller ones
  champa: (k) => {
    k.add(Box, 0, 0, 0, 0.3, 0.02, 0.2, 0xb39a6e).tower(0, 0, 4, 0.1, 0.06, 0.17, 0xa6553a, 0x8a4630, 0.02);
    k.tower(-0.11, 0.03, 2, 0.06, 0.045, 0.2, 0xa6553a, 0x8a4630, 0.02).tower(0.11, 0.03, 2, 0.06, 0.045, 0.2, 0xa6553a, 0x8a4630, 0.02);
  },
  // 佛寺 wat: a hall under steep stacked roofs, beside a gilded stupa
  lanxang: (k) => {
    k.add(Box, -0.05, 0, 0, 0.2, 0.05, 0.09, WHITE_WALL).add(Gable, -0.05, 0.05, 0, 0.24, 0.07, 0.13, 0x9c3a2a);
    k.add(Gable, -0.05, 0.085, 0, 0.17, 0.06, 0.1, 0xb5463a).add(Gable, -0.05, 0.12, 0, 0.1, 0.05, 0.07, 0xc8562e).stupa(0.15, 0, 0.09, 0.2, GOLD, 0xe8bf4a);
  },
  // 巴莱水库 baray: a vast rectangular reservoir with an island temple in the middle
  chenla: (k) => {
    k.add(Box, 0, 0, 0, 0.6, 0.012, 0.36, 0x9a8a5a).add(Box, 0, 0.012, 0, 0.55, 0.004, 0.31, 0x3f8fa8);
    k.add(Box, 0, 0.012, 0, 0.1, 0.02, 0.1, 0x8a8478).tower(0, 0, 3, 0.06, 0.035, 0.22, 0x8a8478, 0x6e6a5e, 0.03);
  },
  // 水上市场 floating market: boats laden with goods between stilt houses on a canal
  siam: (k) => {
    k.pond(0, 0, 0.46, 0.16);
    for (let i = 0; i < 5; i++) k.boat(-0.2 + i * 0.1, i % 2 === 0 ? -0.03 : 0.035, 0.07, 0x6b4a2e).add(Box, -0.2 + i * 0.1, 0.016, i % 2 === 0 ? -0.03 : 0.035, 0.035, 0.012, 0.016, [0xd9a93a, 0xb5463a, 0x6fa53c, 0xe8e2d0, 0xc8562e][i] as number);
    k.stilt(-0.14, -0.14, 0.09, 0.06, 0.07, 0x8a6a45, 0x7a3b24).stilt(0.12, 0.14, 0.09, 0.06, 0.07, 0x8a6a45, 0x7a3b24);
  },
  // 佛塔 pagoda: a great bell-shaped stupa on terraces, gilded, with four small ones at the corners
  pagan: (k) => {
    k.terrace(0, 0, 0.3, 0.3, 3, 0.022, 0xa6553a, 0.2).add(Dome, 0, 0.066, 0, 0.17, 0.12, 0.17, GOLD).add(Cone, 0, 0.16, 0, 0.07, 0.17, 0.07, 0xe8bf4a);
    for (let i = 0; i < 4; i++) k.stupa(i < 2 ? -0.12 : 0.12, i % 2 === 0 ? -0.12 : 0.12, 0.045, 0.09, 0xf1ece0, GOLD, 0.022);
  },
  // 港务司 harbourmaster's office: a customs house on the quay, a signal tower and a pier
  malacca: (k) => {
    k.pond(0, 0.15, 0.46, 0.14).add(Box, 0, 0, 0.14, 0.03, 0.012, 0.16, TIMBER).hall(-0.07, -0.04, 0.16, 0.09, 0.06, 0xf1ece0, 0x9c4a3a, Hip, 0.6);
    k.add(Cylinder, 0.14, 0, -0.02, 0.05, 0.17, 0.05, 0xf1ece0).add(Cone, 0.14, 0.17, -0.02, 0.06, 0.035, 0.06, 0x9c4a3a).add(Dome, 0.14, 0.15, -0.02, 0.03, 0.02, 0.03, 0xffd27a, 0, 1.5).boat(0.1, 0.19, 0.11, TIMBER, 0.2, true);
  },
  // 佛学院 Buddhist college: monks' cells around a court of stupas
  srivijaya: (k) => {
    k.ring(0, 0, 0.21, 4, 0.03, 0xa6553a, Math.PI / 4).stupa(0, 0, 0.1, 0.17, 0xb8ad9a, 0x8a8478);
    for (let i = 0; i < 4; i++) k.stupa(Math.cos(i * 1.571 + 0.785) * 0.11, Math.sin(i * 1.571 + 0.785) * 0.11, 0.045, 0.08, 0xb8ad9a, 0x8a8478);
    k.hall(0, -0.14, 0.24, 0.04, 0.035, 0xa6553a, 0x7a3b24, Gable, 0.6);
  },
  // 陵庙 candi: a stepped stone pyramid of galleries crowned by a bell
  shepo: (k) => {
    k.terrace(0, 0, 0.34, 0.34, 5, 0.026, 0x6e6a5e, 0.15).add(Dome, 0, 0.13, 0, 0.08, 0.06, 0.08, 0x7d786a).add(Cone, 0, 0.17, 0, 0.025, 0.06, 0.025, 0x7d786a);
    for (let i = 0; i < 4; i++) k.add(Dome, Math.cos(i * 1.571) * 0.085, 0.104, Math.sin(i * 1.571) * 0.085, 0.035, 0.03, 0.035, 0x7d786a);
  },
  // 长屋 longhouse: one roof for a whole village, on stilts along the river bank
  boni: (k) => {
    k.add(Box, 0, 0, 0, 0.44, 0.045, 0.06, 0x3c2e22).add(Box, 0, 0.045, 0, 0.48, 0.04, 0.085, 0x8a6a45).add(Gable, 0, 0.085, 0, 0.5, 0.06, 0.11, THATCH);
    k.add(Box, 0, 0.04, 0.065, 0.48, 0.006, 0.04, 0x7a5c3c).pond(0, 0.17, 0.46, 0.09).boat(0.1, 0.17, 0.09, TIMBER).grove(-0.1, -0.12, 4, 0.08, 0.12, 0x1f5a2a);
  },
  // 高山梯田 highland rice terrace: flooded terraces stepping up a mountainside
  luzon: (k) => {
    for (let s = 0; s < 6; s++) {
      const k2 = 1 - s * 0.14;
      k.add(Cylinder, 0, s * 0.022, -s * 0.02, 0.4 * k2, 0.022, 0.3 * k2, s % 2 === 0 ? 0x6fa53c : 0x8fbf5a).add(Cylinder, 0, s * 0.022 + 0.022, -s * 0.02, 0.36 * k2, 0.002, 0.26 * k2, 0x6fb3b8);
    }
    k.stilt(0.17, 0.12, 0.06, 0.05, 0.06, 0x8a6a45, THATCH);
  },
  // 高脚屋 sea stilt house: a village on stilts over the shallows, joined by walkways
  sulu: (k) => {
    k.pond(0, 0, 0.5, 0.4).add(Box, 0, 0.035, 0, 0.36, 0.006, 0.02, 0x7a5c3c).add(Box, 0, 0.035, 0, 0.02, 0.006, 0.28, 0x7a5c3c);
    for (let i = 0; i < 5; i++) k.stilt([-0.14, 0.13, -0.08, 0.1, 0][i] as number, [-0.07, -0.06, 0.1, 0.11, -0.13][i] as number, 0.08, 0.055, 0.075, 0x9a7850, i % 2 === 0 ? THATCH : 0x7a3b24, i * 0.5);
    k.boat(0.17, 0.02, 0.07, 0x3f6a8a, 1);
  },
  // 香料园 spice garden: rows of clove and nutmeg trees, and a shed where the spice dries
  maluku: (k) => {
    for (let row = 0; row < 4; row++) k.grove(0, -0.13 + row * 0.07, 6, 0.065, 0.1 - (row % 2) * 0.02, row % 2 === 0 ? 0x2a6a35 : 0x3f7a2a);
    k.hall(0.02, 0.17, 0.14, 0.06, 0.035, 0x8a6a45, THATCH, Gable, 1).add(Box, -0.14, 0, 0.17, 0.1, 0.008, 0.06, 0x7a3b24);
  },
};

/** The ids of the 50 landmarks: the nations, in the order of the design document. */
export const LANDMARK_IDS: readonly string[] = Object.keys(RECIPES);

/** Whether there is a landmark with this id. */
export function isLandmark(id: string): boolean {
  return Object.hasOwn(RECIPES, id);
}

/**
 * The parts of a landmark around its own origin, or an empty list for an
 * id that names none. A landmark keeps within 0.35 hex sizes of the origin
 * on the ground.
 */
export function generateLandmark(id: string): Part[] {
  const recipe = RECIPES[id];
  if (recipe === undefined || !isLandmark(id)) return [];
  const kit = new Kit();
  recipe(kit);
  return kit.parts;
}

/**
 * Moves and turns parts: `yaw` about the origin, then by (`dx`, `dz`), all
 * scaled by `scale`. For placing a landmark beside a city.
 */
export function placeParts(parts: readonly Part[], dx: number, dz: number, yaw: number, scale = 1): Part[] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return parts.map((part) => ({
    ...part,
    x: dx + (part.x * cos + part.z * sin) * scale,
    y: part.y * scale,
    z: dz + (part.z * cos - part.x * sin) * scale,
    w: part.w * scale,
    h: part.h * scale,
    d: part.d * scale,
    yaw: part.yaw + yaw,
  }));
}
