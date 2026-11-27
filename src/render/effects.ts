/**
 * Procedural effects for the board animations: soft round particles for
 * dust, smoke and sparks, and small bodies for arrows and shells. Each kind
 * is one instanced mesh; both are hidden while nothing is in the air.
 */

import { attribute, float, length, smoothstep, uv, vec2 } from 'three/tsl';
import {
  BoxGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type { PerspectiveCamera } from 'three/webgpu';

export interface ParticleSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** Seconds the particle lives. */
  readonly life: number;
  /** Diameter at birth and at death, in world units. */
  readonly size: number;
  readonly endSize: number;
  /** Colour as `0xRRGGBB`. */
  readonly color: number;
  readonly opacity: number;
  /** Downward acceleration; negative for smoke that rises faster. */
  readonly gravity?: number;
  /** Share of the speed lost per second. */
  readonly drag?: number;
}

export interface Effects {
  readonly object: Group;
  spawn(spec: ParticleSpec): void;
  /**
   * Shows the projectiles of the current volley. The list replaces the one
   * of the last call; an empty list hides them all.
   */
  setProjectiles(projectiles: readonly ProjectileSpec[]): void;
  /** Whether anything is in the air. */
  readonly active: boolean;
  /** Advances the particles by `seconds` and turns them to the camera. */
  update(seconds: number, camera: PerspectiveCamera): void;
  /** Removes every particle and projectile. */
  clear(): void;
  dispose(): void;
}

export interface ProjectileSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Direction of flight; need not be of unit length. */
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /** Length along the flight and thickness, in world units. */
  readonly length: number;
  readonly thickness: number;
  /** Colour as `0xRRGGBB`. */
  readonly color: number;
}

const MAX_PARTICLES = 512;
const MAX_PROJECTILES = 48;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  spec: ParticleSpec;
}

export function createEffects(): Effects {
  const object = new Group();
  object.name = 'effects';

  // particles: quads turned to the camera, round and soft in the shader
  const tint = attribute('particleTint', 'vec4');
  const fromCentre = length(uv().sub(vec2(0.5, 0.5)));
  const particleMaterial = new MeshBasicNodeMaterial();
  particleMaterial.colorNode = tint.rgb;
  particleMaterial.opacityNode = tint.a.mul(float(1).sub(smoothstep(0.18, 0.5, fromCentre)));
  particleMaterial.transparent = true;
  particleMaterial.depthWrite = false;
  const particleGeometry = new PlaneGeometry(1, 1);
  const tints = new InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4);
  particleGeometry.setAttribute('particleTint', tints);
  const particleMesh = new InstancedMesh(particleGeometry, particleMaterial, MAX_PARTICLES);
  particleMesh.name = 'particles';
  particleMesh.count = 0;
  particleMesh.frustumCulled = false;
  particleMesh.renderOrder = 6;
  particleMesh.visible = false;

  // projectiles: thin boxes along their flight
  const bodyColor = attribute('projectileColor', 'vec3');
  const projectileMaterial = new MeshStandardNodeMaterial();
  projectileMaterial.colorNode = bodyColor;
  projectileMaterial.roughness = 0.6;
  projectileMaterial.metalness = 0.1;
  const projectileGeometry = new BoxGeometry(1, 1, 1);
  const bodyColors = new InstancedBufferAttribute(new Float32Array(MAX_PROJECTILES * 3), 3);
  projectileGeometry.setAttribute('projectileColor', bodyColors);
  const projectileMesh = new InstancedMesh(projectileGeometry, projectileMaterial, MAX_PROJECTILES);
  projectileMesh.name = 'projectiles';
  projectileMesh.count = 0;
  projectileMesh.frustumCulled = false;
  projectileMesh.visible = false;
  object.add(particleMesh, projectileMesh);

  const particles: Particle[] = [];
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const direction = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const color = new Color();

  return {
    object,
    spawn(spec) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      particles.push({ x: spec.x, y: spec.y, z: spec.z, vx: spec.vx, vy: spec.vy, vz: spec.vz, age: 0, spec });
    },
    setProjectiles(projectiles) {
      const count = Math.min(projectiles.length, MAX_PROJECTILES);
      for (let i = 0; i < count; i++) {
        const p = projectiles[i] as ProjectileSpec;
        direction.set(p.dx, p.dy, p.dz);
        if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);
        rotation.setFromUnitVectors(zAxis, direction.normalize());
        matrix.compose(position.set(p.x, p.y, p.z), rotation, scale.set(p.thickness, p.thickness, p.length));
        projectileMesh.setMatrixAt(i, matrix);
        color.setHex(p.color);
        bodyColors.setXYZ(i, color.r, color.g, color.b);
      }
      projectileMesh.count = count;
      projectileMesh.visible = count > 0;
      projectileMesh.instanceMatrix.needsUpdate = true;
      bodyColors.needsUpdate = true;
    },
    get active() {
      return particles.length > 0 || projectileMesh.count > 0;
    },
    update(seconds, camera) {
      if (particles.length === 0) {
        if (particleMesh.visible) {
          particleMesh.visible = false;
          particleMesh.count = 0;
        }
        return;
      }
      let alive = 0;
      for (const particle of particles) {
        particle.age += seconds;
        const { spec } = particle;
        if (particle.age >= spec.life) continue;
        const slow = Math.max(0, 1 - (spec.drag ?? 0) * seconds);
        particle.vx *= slow;
        particle.vy = particle.vy * slow - (spec.gravity ?? 0) * seconds;
        particle.vz *= slow;
        particle.x += particle.vx * seconds;
        particle.y += particle.vy * seconds;
        particle.z += particle.vz * seconds;
        const t = particle.age / spec.life;
        const size = spec.size + (spec.endSize - spec.size) * t;
        matrix.compose(position.set(particle.x, particle.y, particle.z), camera.quaternion, scale.set(size, size, size));
        particleMesh.setMatrixAt(alive, matrix);
        color.setHex(spec.color);
        // quick in, slow out
        const fade = Math.min(1, t * 8) * (1 - t) ** 1.5;
        tints.setXYZW(alive, color.r, color.g, color.b, spec.opacity * fade);
        particles[alive] = particle;
        alive++;
      }
      particles.length = alive;
      particleMesh.count = alive;
      particleMesh.visible = alive > 0;
      particleMesh.instanceMatrix.needsUpdate = true;
      tints.needsUpdate = true;
    },
    clear() {
      particles.length = 0;
      particleMesh.count = 0;
      particleMesh.visible = false;
      projectileMesh.count = 0;
      projectileMesh.visible = false;
    },
    dispose() {
      particleMesh.dispose();
      projectileMesh.dispose();
      particleGeometry.dispose();
      projectileGeometry.dispose();
      particleMaterial.dispose();
      projectileMaterial.dispose();
    },
  };
}
