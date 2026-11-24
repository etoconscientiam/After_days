import type { SeamDef } from '../data/types';

/** Ripple flags. */
export const F_PORE = 1;
export const F_COLD = 2;
export const F_HOT = 4;
export const F_LONG = 8;
export const F_SHORT = 16;
export const F_OFF = 32;
export const F_BACK = 64;

export interface Proj {
  s: number;
  d: number;
  dist: number;
  seam: number;
}

export interface SeamPoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/**
 * One seam being welded: a 1D field of cells along the joint (heat, metal, fusion, slag...) plus the bead
 * itself as a list of ripple points. The view rebuilds the bead purely from these numbers.
 */
export class SeamRun {
  readonly def: SeamDef;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly cum: Float32Array;
  readonly len: number;
  readonly cell: number;
  readonly n: number;

  readonly heat: Float32Array;
  readonly metal: Float32Array;
  /** Peak heat each cell has seen while holding filler: decides fusion. */
  readonly peak: Float32Array;
  readonly slag: Float32Array;
  readonly dev: Float32Array;
  readonly hole: Uint8Array;
  readonly pores: Uint8Array;
  private readonly tmp: Float32Array;
  maxHeat = 0;

  // Bead ripples, struct of arrays.
  readonly cap: number;
  count = 0;
  readonly rS: Float32Array; // position along the seam, mm
  readonly rD: Float32Array; // lateral offset from the joint, mm (the hand's wobble)
  readonly rW: Float32Array; // width, mm
  readonly rH: Float32Array; // height, mm
  readonly rV: Float32Array; // travel speed at the time, mm/s
  readonly rL: Float32Array; // arc length, mm
  readonly rQ: Float32Array; // heat at the pool
  readonly rI: Float32Array; // current
  readonly rF: Uint8Array; // flags

  // Spatter balls stuck to the part around the seam.
  readonly spCap: number;
  spN = 0;
  readonly spX: Float32Array;
  readonly spZ: Float32Array;

  filled = false;
  quality = 0;

  constructor(def: SeamDef, cellMM: number, rippleCap: number, spatterCap: number) {
    this.def = def;
    const m = def.pts.length;
    this.px = new Float32Array(m);
    this.pz = new Float32Array(m);
    this.cum = new Float32Array(m);
    let L = 0;
    for (let i = 0; i < m; i++) {
      this.px[i] = def.pts[i][0];
      this.pz[i] = def.pts[i][1];
      if (i > 0) L += Math.hypot(this.px[i] - this.px[i - 1], this.pz[i] - this.pz[i - 1]);
      this.cum[i] = L;
    }
    this.len = L;
    this.n = Math.max(2, Math.ceil(L / cellMM));
    this.cell = L / this.n;
    const n = this.n;
    this.heat = new Float32Array(n);
    this.metal = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.slag = new Float32Array(n);
    this.dev = new Float32Array(n);
    this.hole = new Uint8Array(n);
    this.pores = new Uint8Array(n);
    this.tmp = new Float32Array(n);
    this.cap = rippleCap;
    this.rS = new Float32Array(rippleCap);
    this.rD = new Float32Array(rippleCap);
    this.rW = new Float32Array(rippleCap);
    this.rH = new Float32Array(rippleCap);
    this.rV = new Float32Array(rippleCap);
    this.rL = new Float32Array(rippleCap);
    this.rQ = new Float32Array(rippleCap);
    this.rI = new Float32Array(rippleCap);
    this.rF = new Uint8Array(rippleCap);
    this.spCap = spatterCap;
    this.spX = new Float32Array(spatterCap);
    this.spZ = new Float32Array(spatterCap);
  }

  cellAt(s: number): number {
    const c = Math.floor(s / this.cell);
    return c < 0 ? 0 : c >= this.n ? this.n - 1 : c;
  }

  /** Nearest point of the joint to (x, z). d > 0 is to the left of the travel direction start→end. */
  project(x: number, z: number, out: Proj): void {
    let best = Infinity;
    for (let i = 1; i < this.px.length; i++) {
      const ax = this.px[i - 1], az = this.pz[i - 1];
      const bx = this.px[i], bz = this.pz[i];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let u = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + dx * u, qz = az + dz * u;
      const dist = Math.hypot(x - qx, z - qz);
      if (dist < best) {
        best = dist;
        const l = Math.sqrt(l2) || 1;
        out.s = this.cum[i - 1] + u * l;
        out.d = (dx * (z - qz) - dz * (x - qx)) / l;
        out.dist = dist;
      }
    }
  }

  pointAt(s: number, out: SeamPoint): SeamPoint {
    const m = this.px.length;
    if (s <= 0) s = 0;
    if (s >= this.len) s = this.len;
    let i = 1;
    while (i < m - 1 && this.cum[i] < s) i++;
    const l = this.cum[i] - this.cum[i - 1] || 1;
    const u = (s - this.cum[i - 1]) / l;
    const dx = this.px[i] - this.px[i - 1], dz = this.pz[i] - this.pz[i - 1];
    out.x = this.px[i - 1] + dx * u;
    out.z = this.pz[i - 1] + dz * u;
    out.tx = dx / l;
    out.tz = dz / l;
    return out;
  }

  /** Spread `total` into a field around s with a gaussian; weights sum to ~1 across cells. */
  addGauss(field: Float32Array, s: number, sigma: number, total: number): void {
    const c0 = Math.floor((s - 3 * sigma) / this.cell);
    const c1 = Math.ceil((s + 3 * sigma) / this.cell);
    const norm = this.cell / (2.5066 * sigma);
    const inv = 1 / (2 * sigma * sigma);
    for (let c = c0 < 0 ? 0 : c0; c <= c1 && c < this.n; c++) {
      const x = (c + 0.5) * this.cell - s;
      field[c] += total * norm * Math.exp(-x * x * inv);
    }
  }

  /** Cooling and conduction along the joint. */
  stepHeat(dt: number, cool: number, diffuse: number): void {
    if (this.maxHeat < 0.002) return;
    const n = this.n, h = this.heat, t = this.tmp;
    const k = Math.min(0.24, (diffuse * dt) / (this.cell * this.cell));
    const f = Math.exp(-cool * dt);
    let mx = 0;
    for (let i = 0; i < n; i++) {
      const l = h[i > 0 ? i - 1 : i], r = h[i < n - 1 ? i + 1 : i];
      t[i] = (h[i] + k * (l + r - 2 * h[i])) * f;
    }
    for (let i = 0; i < n; i++) {
      h[i] = t[i];
      if (t[i] > mx) mx = t[i];
    }
    this.maxHeat = mx;
  }

  /** Number of cells not yet filled, ignoring the very ends of the joint. */
  /** Cells at each end that need not be filled (the arc can't start exactly on the edge). */
  static EDGE = 2;

  gaps(fillMin: number): number {
    let g = 0;
    const e = SeamRun.EDGE;
    for (let i = e; i < this.n - e; i++) if (this.metal[i] < fillMin && !this.hole[i]) g++;
    return g;
  }

  firstGap(fillMin: number): number {
    const e = SeamRun.EDGE;
    for (let i = e; i < this.n - e; i++) if (this.metal[i] < fillMin && !this.hole[i]) return (i + 0.5) * this.cell;
    return -1;
  }

  coverage(fillMin: number): number {
    return 1 - this.gaps(fillMin) / Math.max(1, this.n - 2 * SeamRun.EDGE);
  }

  slagTotal(): number {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.slag[i];
    return s;
  }

  addRipple(s: number, d: number, w: number, h: number, v: number, L: number, q: number, I: number, f: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.rS[i] = s;
    this.rD[i] = d;
    this.rW[i] = w;
    this.rH[i] = h;
    this.rV[i] = v;
    this.rL[i] = L;
    this.rQ[i] = q;
    this.rI[i] = I;
    this.rF[i] = f;
  }

  addSpatter(x: number, z: number): void {
    if (this.spN >= this.spCap) return;
    this.spX[this.spN] = x;
    this.spZ[this.spN] = z;
    this.spN++;
  }
}
