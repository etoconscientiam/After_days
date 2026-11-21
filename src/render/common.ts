// Shared render helpers: tileable value noise, palettes, and the world layout (which squeezes when the drawer opens).
import { CFG } from '../config';

export const WW = CFG.B.world.width;   // 360
export const WH = CFG.B.world.height;  // 640
const L = CFG.B.layout;

// ---------- noise ----------
const N = 256;
function makeValueNoise(seed: number, cell: number): Float32Array {
  const g = Math.ceil(N / cell);
  const grid = new Float32Array(g * g);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(N * N);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) {
    const gy = y / cell, y0 = Math.floor(gy), fy = sm(gy - y0);
    for (let x = 0; x < N; x++) {
      const gx = x / cell, x0 = Math.floor(gx), fx = sm(gx - x0);
      const a = grid[(y0 % g) * g + (x0 % g)], b = grid[(y0 % g) * g + ((x0 + 1) % g)];
      const c = grid[((y0 + 1) % g) * g + (x0 % g)], d = grid[((y0 + 1) % g) * g + ((x0 + 1) % g)];
      out[y * N + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

/** fbm noise tile 256×256, values 0..1. */
export const NOISE = (() => {
  const o1 = makeValueNoise(11, 32), o2 = makeValueNoise(23, 16), o3 = makeValueNoise(37, 8), o4 = makeValueNoise(51, 4);
  const out = new Float32Array(N * N);
  let mn = 9, mx = -9;
  for (let i = 0; i < out.length; i++) {
    const v = o1[i] * 0.45 + o2[i] * 0.28 + o3[i] * 0.17 + o4[i] * 0.1;
    out[i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
  return out;
})();
/** fine grain noise 256×256 (cell 2), values 0..1 */
export const GRAIN = makeValueNoise(77, 2);

export function noise(x: number, y: number): number {
  return NOISE[((y & 255) << 8) | (x & 255)];
}

// ---------- palettes ----------
/** Packed RGBA (little-endian ABGR) per material per shade. */
export const PAL32: Uint32Array[] = CFG.materials.map((m) => {
  const a = new Uint32Array(m.rgb.length);
  m.rgb.forEach(([r, g, b], i) => (a[i] = (255 << 24) | (b << 16) | (g << 8) | r));
  return a;
});
export const PAL_RGB = CFG.materials.map((m) => m.rgb);
export const GRAIN_SCALE = CFG.materials.map((m) => Math.max(1, m.grain));

export function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function lerp3(a: number[], b: number[], t: number): number[] { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
export function hex3(h: string): number[] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

export const ACCENT = '#f2c14e';

// ---------- layout ----------
export class Layout {
  drawer = 0;          // drawer height in world px
  shift = 0;           // how far the world is pushed up
  sectionTop = L.sectionTop;
  sectionH = L.sectionH;
  artifactY = L.sectionTop + L.sectionH + L.artifactH / 2;
  surfaceY = L.skyH;   // top of the surface strip
  linear = L.linearPx;
  logS = L.logScale;
  vMax = L.linearPx * Math.exp((L.sectionH - L.linearPx) / L.logScale);
  vOf = new Float32Array(WH);
  version = 0;

  constructor() { this.update(0); }

  update(drawerPx: number): void {
    const D = Math.max(0, Math.min(WH * L.drawerMax, drawerPx));
    if (Math.abs(D - this.drawer) < 0.01 && this.version > 0) return;
    this.drawer = D;
    this.shift = L.drawerShift * (D / (WH * L.drawerMax));
    this.surfaceY = L.skyH - this.shift;
    this.sectionTop = L.sectionTop - this.shift;
    const bottom = WH - L.tabBarH - D - L.artifactH;
    this.sectionH = Math.max(40, Math.round(bottom - this.sectionTop));
    this.artifactY = this.sectionTop + this.sectionH + L.artifactH / 2;
    const vMaxDefault = L.linearPx * Math.exp((L.sectionH - L.linearPx) / L.logScale);
    this.linear = Math.min(L.linearPx, this.sectionH * (L.linearPx / L.sectionH));
    this.logS = (this.sectionH - this.linear) / Math.log(vMaxDefault / this.linear);
    this.vMax = vMaxDefault;
    for (let y = 0; y < this.sectionH; y++) this.vOf[y] = this.yToV(y);
    this.version++;
  }

  /** section-local y -> visual depth (compacted rows) */
  yToV(y: number): number {
    if (y < this.linear) return y * (L.linearPx / this.linear) * (this.linear / L.linearPx);
    return this.linear * Math.exp((y - this.linear) / this.logS);
  }

  /** visual depth -> section-local y */
  vToY(v: number): number {
    if (v < this.linear) return v;
    return this.linear + this.logS * Math.log(v / this.linear);
  }
}
