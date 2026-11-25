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

/**
 * Sparks drawn as short streaks along their velocity: one-pixel lines that read as hot sparks at low res.
 * Fixed pool, no allocation after construction.
 */
export class Streaks {
  readonly lines: THREE.LineSegments;
  readonly n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private p: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private next = 0;
  private geo = new THREE.BufferGeometry();

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 6);
    this.vel = new Float32Array(n * 3);
    this.p = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
  }

  update(dt: number, floor: FloorFn): void {
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, k = i * 6;
      if (this.life[i] <= 0) {
        if (this.col[k] !== 0) for (let q = 0; q < 6; q++) this.col[k + q] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.max[i]);
      this.vel[j + 1] -= 9.8 * dt;
      this.vel[j] *= 1 - 0.8 * dt;
      this.vel[j + 2] *= 1 - 0.8 * dt;
      this.p[j] += this.vel[j] * dt;
      this.p[j + 1] += this.vel[j + 1] * dt;
      this.p[j + 2] += this.vel[j + 2] * dt;
      const fy = floor(this.p[j], this.p[j + 2]);
      if (this.p[j + 1] < fy) {
        this.p[j + 1] = fy;
        if (this.vel[j + 1] < 0) {
          this.vel[j + 1] *= -0.35;
          this.vel[j] *= 0.55;
          this.vel[j + 2] *= 0.55;
        }
      }
      // Tail: where the spark was a moment ago.
      const tl = 0.018 + 0.02 * t;
      this.pos[k] = this.p[j];
      this.pos[k + 1] = this.p[j + 1];
      this.pos[k + 2] = this.p[j + 2];
      this.pos[k + 3] = this.p[j] - this.vel[j] * tl;
      this.pos[k + 4] = this.p[j + 1] - this.vel[j + 1] * tl;
      this.pos[k + 5] = this.p[j + 2] - this.vel[j + 2] * tl;
      const e = t * t * 9 + t * 1.2;
      this.col[k] = e;
      this.col[k + 1] = e * (0.32 + 0.55 * t);
      this.col[k + 2] = e * (0.06 + 0.35 * t * t);
      this.col[k + 3] = e * 0.5;
      this.col[k + 4] = e * 0.5 * (0.2 + 0.3 * t);
      this.col[k + 5] = e * 0.05;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

const SMOKE_VERT = `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aAlpha > 0.0 ? clamp(aSize * uScale / -mv.z, 2.0, 48.0) : 0.0;
}`;
// Soft round puffs with a hard pixel edge.
const SMOKE_FRAG = `
varying float vAlpha;
uniform vec3 uColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(uColor * (0.85 + 0.3 * (0.5 - d.y)), vAlpha * (0.7 - 0.35 * r));
}`;

/** Rising welding fumes. */
export class Smoke {
  readonly points: THREE.Points;
  readonly n: number;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private next = 0;
  private geo = new THREE.BufferGeometry();
  readonly color: THREE.Color;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: { uScale: { value: 300 }, uColor: { value: new THREE.Color(0.12, 0.12, 0.13) } },
      transparent: true,
      depthWrite: false,
    });
    this.color = mat.uniforms.uColor.value;
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, rng: Rng): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = rng.signed() * 0.02;
    this.vel[i * 3 + 1] = 0.07 + rng.next() * 0.06;
    this.vel[i * 3 + 2] = rng.signed() * 0.02;
    this.life[i] = this.max[i] = 2.2 + rng.next() * 1.8;
  }

  update(dt: number, wind: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.max[i];
      const j = i * 3;
      this.vel[j] += wind * dt * 0.05;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = 0.012 + t * 0.07;
      this.alpha[i] = Math.max(0, Math.min(1, t * 6) * (1 - t) * 0.75);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Sparks, spatter, slag flakes and fumes around the bench. Uses its own seeded stream (never Math.random). */
export class Effects {
  readonly sparks = new Streaks(600);
  readonly debris = new Pool(360, false, 0.7);
  readonly smoke = new Smoke(70);
  readonly rng = new Rng(9001);
  readonly group = new THREE.Group();
  private smokeAcc = 0;

  constructor() {
    this.group.add(this.sparks.lines, this.debris.points, this.smoke.points);
  }

  /** Arc spatter: fast sparks that skitter off the bench and a few heavier balls. */
  spatter(x: number, y: number, z: number, n: number, long: number): void {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = r.next() * Math.PI * 2;
      const sp = 0.3 + r.next() * (1.0 + long * 1.4);
      this.sparks.spawn(x, y, z, Math.cos(a) * sp, 0.5 + r.next() * (1.3 + long), Math.sin(a) * sp, 0.25 + r.next() * 0.55);
      if (r.chance(0.1 + long * 0.2))
        this.debris.spawn(x, y, z, Math.cos(a) * sp * 0.5, 0.3 + r.next() * 0.8, Math.sin(a) * sp * 0.5, 1.2 + r.next(), 1.2, 1);
    }
  }

  /** Fumes rising from the pool while the arc burns. */
  fumes(x: number, y: number, z: number, dt: number, rate: number): void {
    this.smokeAcc += dt * rate;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      this.smoke.spawn(x + this.rng.signed() * 0.004, y + 0.006, z + this.rng.signed() * 0.004, this.rng);
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
    for (let i = 0; i < 30; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const sp = 0.2 + this.rng.next() * 0.9;
      this.sparks.spawn(x, y, z, Math.cos(a) * sp, 0.2 + this.rng.next() * 1.6, Math.sin(a) * sp, 0.4 + this.rng.next() * 0.6);
    }
  }

  update(dt: number, floor: FloorFn, arcLight: number): void {
    this.sparks.update(dt, floor);
    this.debris.update(dt, floor);
    // Fumes are dark in the room and lit blue-white while the arc burns.
    this.smoke.color.setRGB(0.1 + arcLight * 0.5, 0.1 + arcLight * 0.55, 0.11 + arcLight * 0.65);
    this.smoke.update(dt, 0.3);
  }
}
