import * as THREE from 'three';
import { Rng } from '../core/rng';

const VERT = `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize > 0.0 ? clamp(aSize * uScale / -mv.z, 1.0, 3.0) : 0.0;
}`;
const FRAG = `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`;

export type FloorFn = (x: number, z: number) => number;

/**
 * A fixed pool of point particles (no allocation after construction). Sparks are additive and HDR-bright;
 * debris (spatter balls, slag flakes) is opaque. Both bounce on whatever floor function they are given.
 */
export class Pool {
  readonly points: THREE.Points;
  readonly n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private kind: Uint8Array;
  private base: Float32Array;
  private next = 0;
  alive = 0;
  private geo: THREE.BufferGeometry;

  constructor(n: number, additive: boolean, scale: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.base = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: scale } },
      transparent: additive,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  /** kind 0 = spark (cools white→red), 1 = hot spatter ball (cools to dark), 2 = cold debris (fixed colour). */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, kind: number, r = 1, g = 1, b = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.base[j] = r;
    this.base[j + 1] = g;
    this.base[j + 2] = b;
  }

  update(dt: number, floor: FloorFn, gravity = 9.8): void {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      alive++;
      const j = i * 3;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.max[i]);
      const k = this.kind[i];
      this.vel[j + 1] -= gravity * dt;
      const drag = k === 0 ? 0.6 : 0.2;
      this.vel[j] *= 1 - drag * dt;
      this.vel[j + 2] *= 1 - drag * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const fy = floor(this.pos[j], this.pos[j + 2]);
      if (this.pos[j + 1] < fy) {
        this.pos[j + 1] = fy;
        if (this.vel[j + 1] < 0) {
          const bounce = k === 2 ? 0.2 : 0.35;
          this.vel[j + 1] = -this.vel[j + 1] * bounce;
          this.vel[j] *= 0.6;
          this.vel[j + 2] *= 0.6;
          if (Math.abs(this.vel[j + 1]) < 0.05) this.vel[j + 1] = 0;
        }
      }
      if (k === 0) {
        // Spark: white-yellow while fresh, fading through orange to a dull red.
        const e = t * t * 14 + t * 1.5;
        this.col[j] = e * 1.0;
        this.col[j + 1] = e * (0.25 + 0.6 * t);
        this.col[j + 2] = e * (0.05 + 0.4 * t * t);
      } else if (k === 1) {
        const e = Math.max(0, t - 0.35) * 7;
        this.col[j] = 0.09 + e;
        this.col[j + 1] = 0.085 + e * 0.35;
        this.col[j + 2] = 0.08 + e * 0.05;
      } else {
        this.col[j] = this.base[j];
        this.col[j + 1] = this.base[j + 1];
        this.col[j + 2] = this.base[j + 2];
      }
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    this.alive = alive;
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Sparks, spatter and slag flakes around the bench. Uses its own seeded stream (never Math.random). */
export class Effects {
  readonly sparks = new Pool(700, true, 0.5);
  readonly debris = new Pool(360, false, 0.7);
  readonly rng = new Rng(9001);
  readonly group = new THREE.Group();

  constructor() {
    this.group.add(this.sparks.points, this.debris.points);
  }

  /** Arc spatter: fast sparks that skitter off the bench and a few heavier balls. */
  spatter(x: number, y: number, z: number, n: number, long: number): void {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = r.next() * Math.PI * 2;
      const sp = 0.25 + r.next() * (0.9 + long * 1.4);
      this.sparks.spawn(x, y, z, Math.cos(a) * sp, 0.4 + r.next() * (1.2 + long), Math.sin(a) * sp, 0.25 + r.next() * 0.6, 1 + r.next() * 1.2, 0);
      if (r.chance(0.12 + long * 0.2))
        this.debris.spawn(x, y, z, Math.cos(a) * sp * 0.5, 0.3 + r.next() * 0.8, Math.sin(a) * sp * 0.5, 1.2 + r.next(), 1.2, 1);
    }
  }

  /** Slag breaks off in flakes; the bigger the piece, the more crumbs. */
  slag(x: number, y: number, z: number, amount: number): void {
    const r = this.rng;
    const n = Math.min(40, 6 + Math.round(amount * 2.5));
    for (let i = 0; i < n; i++) {
      const a = r.next() * Math.PI * 2;
      const sp = 0.1 + r.next() * 0.5;
      const g = 0.025 + r.next() * 0.035;
      this.debris.spawn(x + (r.next() - 0.5) * 0.01, y + 0.002, z + (r.next() - 0.5) * 0.01, Math.cos(a) * sp, 0.4 + r.next() * 0.9, Math.sin(a) * sp, 0.8 + r.next() * 1.2, 1.5 + r.next() * 1.5, 2, g, g * 0.88, g * 0.8);
    }
  }

  /** Burn-through: a gout of molten metal. */
  burst(x: number, y: number, z: number): void {
    for (let i = 0; i < 24; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const sp = 0.2 + this.rng.next() * 0.8;
      this.sparks.spawn(x, y, z, Math.cos(a) * sp, 0.2 + this.rng.next() * 1.5, Math.sin(a) * sp, 0.4 + this.rng.next() * 0.6, 1.5, 0);
    }
  }

  update(dt: number, floor: FloorFn): void {
    this.sparks.update(dt, floor);
    this.debris.update(dt, floor);
  }
}
