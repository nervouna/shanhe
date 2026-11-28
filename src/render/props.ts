/**
 * Small things that stand on a hex because of what it is or what was built
 * on it: a farmhouse among the fields, a barn on the pasture, the pit head
 * of a mine, the boats of a fishery, the cone of a volcano. Lists of parts
 * around the middle of the hex, in hex sizes. No Three.js.
 */

import { PartShape, randomFrom } from './cityGen.ts';
import type { Part } from './cityGen.ts';
import { Improvement } from './scene.ts';

const { Box, Gable, Hip, Cylinder, Cone } = PartShape;

/** The parts of an improvement. They keep off the middle of the hex, where a piece may stand. */
export function improvementParts(kind: number, seed: number): Part[] {
  const random = randomFrom(seed * 7 + kind);
  const angle = random() * Math.PI * 2;
  const reach = 0.56 + random() * 0.1;
  const x = Math.cos(angle) * reach;
  const z = Math.sin(angle) * reach;
  const yaw = random() * Math.PI;
  switch (kind) {
    case Improvement.Farm:
      return [
        { shape: Box, x, y: 0, z, w: 0.09, h: 0.04, d: 0.06, yaw, color: 0xd9c9a0 },
        { shape: Gable, x, y: 0.04, z, w: 0.1, h: 0.03, d: 0.07, yaw, color: 0x8c6a3a },
        { shape: Cylinder, x: x * 0.82, y: 0, z: z * 0.82, w: 0.035, h: 0.035, d: 0.035, yaw: 0, color: 0xd8c27a },
        { shape: Cone, x: x * 0.82, y: 0.035, z: z * 0.82, w: 0.04, h: 0.025, d: 0.04, yaw: 0, color: 0xb9a04f },
      ];
    case Improvement.Pasture:
      return [
        { shape: Box, x, y: 0, z, w: 0.11, h: 0.045, d: 0.07, yaw, color: 0x7a3b2a },
        { shape: Gable, x, y: 0.045, z, w: 0.12, h: 0.035, d: 0.08, yaw, color: 0x4f4c48 },
        { shape: Box, x: x * 0.8, y: 0, z: z * 0.8 + 0.08, w: 0.07, h: 0.012, d: 0.02, yaw, color: 0x6b4a2e },
      ];
    case Improvement.Mine:
      return [
        // the spoil heap, the winding tower over the shaft and the engine shed
        { shape: Cone, x: x * 0.6, y: 0, z: z * 0.6, w: 0.26, h: 0.07, d: 0.2, yaw, color: 0x57524b },
        { shape: Box, x, y: 0, z, w: 0.035, h: 0.13, d: 0.035, yaw, color: 0x4a3a2a },
        { shape: Hip, x, y: 0.13, z, w: 0.06, h: 0.025, d: 0.06, yaw, color: 0x3c3a36 },
        { shape: Box, x: x + 0.06, y: 0, z: z + 0.03, w: 0.08, h: 0.04, d: 0.05, yaw, color: 0x7d735f },
        { shape: Gable, x: x + 0.06, y: 0.04, z: z + 0.03, w: 0.085, h: 0.02, d: 0.055, yaw, color: 0x45433f },
      ];
    case Improvement.Fishery: {
      const parts: Part[] = [];
      // boats at their nets, and the stakes of a fish trap
      for (let i = 0; i < 3; i++) {
        const a = angle + i * 2.1;
        const r = 0.3 + random() * 0.3;
        const boatYaw = random() * Math.PI;
        parts.push({ shape: Box, x: Math.cos(a) * r, y: 0.002, z: Math.sin(a) * r, w: 0.11, h: 0.022, d: 0.035, yaw: boatYaw, color: 0x6b4a2e });
        parts.push({ shape: Box, x: Math.cos(a) * r, y: 0.024, z: Math.sin(a) * r, w: 0.035, h: 0.018, d: 0.025, yaw: boatYaw, color: 0xd9d2c0 });
      }
      for (let i = 0; i < 6; i++) {
        const a = angle + 1 + i * 0.22;
        parts.push({ shape: Box, x: Math.cos(a) * 0.5, y: 0, z: Math.sin(a) * 0.5, w: 0.008, h: 0.04, d: 0.008, yaw: 0, color: 0x3c2e22 });
      }
      return parts;
    }
    default:
      return [];
  }
}

/** The cone of a volcano: dark slopes, a crater rim and the glow inside it. */
export function volcanoParts(seed: number): Part[] {
  const random = randomFrom(seed);
  const yaw = random() * Math.PI;
  return [
    { shape: Cone, x: 0, y: 0, z: 0, w: 0.95, h: 0.34, d: 0.9, yaw, color: 0x3a3230 },
    { shape: Cylinder, x: 0, y: 0.2, z: 0, w: 0.3, h: 0.07, d: 0.28, yaw, color: 0x2c2625 },
    { shape: Cylinder, x: 0, y: 0.265, z: 0, w: 0.22, h: 0.008, d: 0.2, yaw, color: 0xff5a14, glow: 2.4 },
  ];
}
