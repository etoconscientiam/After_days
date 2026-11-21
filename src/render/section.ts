// The section (срез), drawn as readable horizontal layers.
// Vertical axis = time: every column is sampled at the same deposition year for a given screen row, so layers run
// straight across the width. Top layers are large, depth is log-compressed, bands are at least 3 px tall and get a
// boundary line one tone darker. Under the strata: foundation (epochs), the technogenic horizon with the thing at
// the bottom centre, and bedrock to the bottom edge. The section always fills the space down to the tabs.
import { CFG, NMAT, M } from '../config';
import type { Game } from '../core/game';
import { CAP, F_FOSSIL, F_FRAGMENT, F_RARE, F_GLOW } from '../world/World';
import { Layout, PAL_RGB, GRAIN_SCALE, NOISE, GRAIN, WW, WH } from './common';
import { hash2 } from '../core/rng';

const DARK = 16, SH = 5;
const SHADE: Uint32Array[] = PAL_RGB.map((pal) => {
  const a = new Uint32Array(DARK * SH);
  for (let d = 0; d < DARK; d++) {
    const f = 1 - (d / (DARK - 1)) * 0.66;
    for (let s = 0; s < SH; s++) {
      const [r, g, b] = pal[Math.min(s, pal.length - 1)];
      a[d * SH + s] = (255 << 24) | (Math.min(255, b * (f * 0.95 + 0.05)) << 16) | (Math.min(255, g * f) << 8) | Math.min(255, r * f);
    }
  }
  return a;
});
const EMISSIVE = CFG.materials.map((m) => !!m.emissive);
const pack32 = (r: number, g: number, b: number) => (255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
/** Bedrock: dark grey-blue, coarse texture, never pure black. */
const BEDROCK = [[38, 42, 54], [46, 50, 63], [54, 58, 72], [62, 67, 82], [72, 78, 94]].map(([r, g, b]) => pack32(r, g, b));
const CRACK = pack32(22, 24, 32), VEIN = pack32(120, 128, 140), SPECK = pack32(150, 120, 80);
const FOUND = [[22, 18, 26], [28, 24, 34], [34, 30, 42], [40, 36, 50]].map(([r, g, b]) => pack32(r, g, b));
const EPOCH = pack32(242, 181, 74);
const HR = 6; // horizon rows on screen
const BEDROCK_MIN = 8;
const MAX_ROW_PX = 8;
const LOG_C = 10;

/** The technogenic horizon pattern (concrete crumbs, glass sand, plastic dots, straight metal veins). */
const HORIZON32: Uint32Array = (() => {
  const a = new Uint32Array(WW * HR);
  const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return pack32((n >> 16) & 255, (n >> 8) & 255, n & 255); };
  const pal = (id: string) => CFG.materials.find((m) => m.id === id)!.palette;
  const concrete = pal('concrete'), glass = pal('glassSand'), plastic = pal('plastic'), metal = pal('metal'), soil = pal('soil');
  for (let x = 0; x < WW; x++) for (let r = 0; r < HR; r++) {
    const u = hash2(x, r * 7 + 3);
    let c: string;
    if ((r === 1 || r === 4) && hash2(x >> 3, r) > 0.2) c = metal[1 + (x % 2)];
    else if (u > 0.965) c = plastic[(hash2(x, r + 99) * 5) | 0];
    else if (u > 0.84) c = glass[(hash2(x, r + 7) * 3) | 0];
    else if (u > 0.74) c = soil[(hash2(x, r + 5) * 3) | 0];
    else c = concrete[(hash2(x, r + 11) * 3) | 0];
    a[x * HR + r] = hex(c);
  }
  return a;
})();

export interface FossilMark { x: number; y: number; species: number; rare: boolean; fragment: boolean }
export interface ZoneMark { kind: string; pts: number[] }
export type Loc = { kind: 'cell'; i: number; depth: number } | { kind: 'pack'; p: number; frac: number; depth: number } | { kind: 'horizon' } | { kind: 'foundation' } | { kind: 'bedrock' };

export class SectionRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  buf: Uint32Array;
  fossils: FossilMark[] = [];
  zones: ZoneMark[] = [];
  glowPts: number[] = [];
  horizonTop = new Float32Array(WW);
  foundationPx = 0;
  strataH = 0;                       // px of strata (from the section top)
  /** birth year shown at each section-local row (NaN outside the strata) */
  bOfY = new Float64Array(WH);
  private matAll = new Int16Array(0);
  private kAll = new Float32Array(0);
  private vGrid = new Float64Array(0);  // visual depth at each birth bin
  private bGrid = new Float64Array(0);  // birth year of each bin
  private Dt = 0;
  private Hs = 0;
  private lastRender = -1;
  private lastLayout = -1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WW;
    this.canvas.height = WH;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(WW, WH);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  maybeRender(g: Game, lay: Layout, now: number, revealY = Infinity): boolean {
    if (lay.version === this.lastLayout && now - this.lastRender < 100 && revealY === Infinity) return false;
    this.render(g, lay, revealY);
    this.lastRender = now;
    this.lastLayout = lay.version;
    return true;
  }

  // ---------- time ↔ depth ↔ screen ----------
  /** Average visual depth (Σ 1/k) of everything younger than each birth bin, over sampled columns. */
  private buildTimeDepth(g: Game): void {
    const w = g.world;
    const now = g.run.year;
    let bMin = now;
    for (let x = 0; x < WW; x += 3) if (w.len[x]) bMin = Math.min(bMin, w.birth[x * CAP]);
    for (const pk of w.packs) bMin = Math.min(bMin, pk.ageMin);
    const N = 240;
    const bG = new Float64Array(N + 1), vG = new Float64Array(N + 1);
    for (let k = 0; k <= N; k++) bG[k] = now - ((now - bMin) * k) / N;
    let cols = 0;
    for (let x = 1; x < WW; x += 3) {
      cols++;
      const base = x * CAP;
      let i = w.len[x] - 1, acc = 0;
      for (let k = 0; k <= N; k++) {
        const b = bG[k];
        while (i >= 0 && w.birth[base + i] > b) { acc += 1 / w.k[base + i]; i--; }
        vG[k] += acc;
      }
    }
    for (let k = 0; k <= N; k++) vG[k] /= Math.max(1, cols);
    // packs are full width: add each pack's share younger than b
    let pkAcc = 0;
    const cellsEnd = vG[N];
    for (const pk of w.packs) {
      const t = pk.rows / pk.k;
      for (let k = 0; k <= N; k++) {
        const b = bG[k];
        if (b >= pk.ageMax) continue;
        const f = b <= pk.ageMin ? 1 : (pk.ageMax - b) / Math.max(1e-6, pk.ageMax - pk.ageMin);
        vG[k] += f * t;
      }
      pkAcc += t;
    }
    void cellsEnd; void pkAcc;
    this.bGrid = bG;
    this.vGrid = vG;
    this.Dt = vG[N];
  }

  /** screen row (from section top) for a visual depth */
  yOfV(v: number): number {
    const Hs = this.Hs, Dt = this.Dt;
    if (Dt <= 0) return 0;
    if (Dt * MAX_ROW_PX <= Hs) return v * MAX_ROW_PX;
    return (Hs * Math.log(1 + v / LOG_C)) / Math.log(1 + Dt / LOG_C);
  }

  vOfY(y: number): number {
    const Hs = this.Hs, Dt = this.Dt;
    if (Dt * MAX_ROW_PX <= Hs) return y / MAX_ROW_PX;
    return LOG_C * (Math.exp((y / Hs) * Math.log(1 + Dt / LOG_C)) - 1);
  }

  /** birth year at visual depth v (inverse of the time-depth table) */
  private bOfV(v: number): number {
    const vG = this.vGrid, bG = this.bGrid;
    const N = vG.length - 1;
    if (N < 1) return 0;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (vG[m] < v) lo = m; else hi = m; }
    const dv = vG[hi] - vG[lo];
    const f = dv > 1e-9 ? (v - vG[lo]) / dv : 0;
    return bG[lo] + (bG[hi] - bG[lo]) * Math.max(0, Math.min(1, f));
  }

  /** screen row for a birth year (for glints, fossils, era lines) */
  yOfBirth(b: number): number {
    const vG = this.vGrid, bG = this.bGrid;
    const N = vG.length - 1;
    if (N < 1) return 0;
    if (b >= bG[0]) return 0;
    if (b <= bG[N]) return this.strataH;
    const k = ((bG[0] - b) / (bG[0] - bG[N])) * N;
    const k0 = Math.floor(k), f = k - k0;
    return this.yOfV(vG[k0] + (vG[Math.min(N, k0 + 1)] - vG[k0]) * f);
  }

  /** What lies at section-local (x, y). */
  locateAt(g: Game, x: number, y: number): Loc {
    const w = g.world;
    if (y >= this.horizonTop[x] + HR) return { kind: 'bedrock' };
    if (y >= this.horizonTop[x]) return { kind: 'horizon' };
    if (y >= this.strataH) return { kind: 'foundation' };
    const b = this.bOfY[Math.max(0, Math.floor(y))];
    const base = x * CAP;
    let i = w.len[x] - 1;
    while (i > 0 && w.birth[base + i] > b) i--;
    if (w.len[x] && w.birth[base + i] <= b) return { kind: 'cell', i, depth: w.len[x] - 1 - i };
    for (let p = 0; p < w.packs.length; p++) {
      const pk = w.packs[p];
      if (b >= pk.ageMin && b <= pk.ageMax + 1) return { kind: 'pack', p, frac: (pk.ageMax - b) / Math.max(1e-6, pk.ageMax - pk.ageMin), depth: w.len[x] };
    }
    if (w.len[x]) return { kind: 'cell', i: 0, depth: w.len[x] - 1 };
    return { kind: 'horizon' };
  }

  // ---------- render ----------
  render(g: Game, lay: Layout, revealY = Infinity): void {
    const w = g.world;
    const H = Math.min(this.canvas.height, lay.sectionH);
    const buf = this.buf;
    const f = g.meta.foundation;
    const fpx = f > 0 ? Math.round(Math.min(10, 2 + Math.sqrt(f))) : 0;
    this.foundationPx = fpx;
    this.Hs = Math.max(4, H - HR - BEDROCK_MIN - fpx);
    this.buildTimeDepth(g);
    this.strataH = Math.min(this.Hs, Math.round(this.yOfV(this.Dt)));
    const sH = this.strataH;
    const hTop = sH + fpx;
    this.horizonTop.fill(hTop);
    this.fossils.length = 0;
    this.glowPts.length = 0;
    const targets = g.run.targets;
    this.zones = targets.map((t) => ({ kind: t.kind, pts: [] as number[] }));
    // birth year of every strata row
    for (let y = 0; y < H; y++) this.bOfY[y] = y < sH ? this.bOfV(this.vOfY(y + 0.5)) : NaN;
    const packs = w.packs;
    const pcum = packs.map((pk) => {
      let tot = 0;
      const list: [number, number][] = [];
      for (let m = 0; m < NMAT; m++) if (pk.amt[m] > 0.05) { list.push([m, pk.amt[m]]); tot += pk.amt[m]; }
      list.sort((a, b) => b[1] - a[1]);
      let c = 0;
      return { mats: list.map((l) => l[0]), cum: list.map((l) => (c += l[1] / Math.max(1e-6, tot))) };
    });
    const matCol = new Int16Array(sH);
    const kCol = new Float32Array(sH);
    const cellCol = new Int32Array(sH);
    const darkStep = (DARK - 1) / Math.max(1, sH);
    if (this.matAll.length < WW * sH) { this.matAll = new Int16Array(WW * sH); this.kAll = new Float32Array(WW * sH); }
    const matAll = this.matAll, kAll = this.kAll;

    // 1) material at every strata row of every column (walk cells by birth, then packs)
    for (let x = 0; x < WW; x++) {
      const base = x * CAP;
      let i = w.len[x] - 1, p = 0;
      for (let y = 0; y < sH; y++) {
        const b = this.bOfY[y];
        while (i > 0 && w.birth[base + i] > b) i--;
        if (w.len[x] && i >= 0 && w.birth[base + i] <= b + 1e-3) {
          matAll[x * sH + y] = w.mat[base + i]; kAll[x * sH + y] = w.k[base + i];
          continue;
        }
        while (p < packs.length - 1 && b < packs[p].ageMin) p++;
        if (p < packs.length) {
          const pk = packs[p];
          const row = ((pk.ageMax - b) / Math.max(1e-6, pk.ageMax - pk.ageMin)) * pk.rows;
          const u = NOISE[((((pk.serial * 37 + (row | 0) * 2) & 255) << 8) | ((x * 3 + pk.serial * 11) & 255))];
          const t = pcum[p];
          let m = t.mats.length ? t.mats[t.mats.length - 1] : M.silt;
          for (let q = 0; q < t.cum.length; q++) if (u <= t.cum[q]) { m = t.mats[q]; break; }
          matAll[x * sH + y] = m; kAll[x * sH + y] = pk.k;
        } else { matAll[x * sH + y] = w.len[x] ? w.mat[base] : M.soil; kAll[x * sH + y] = 1; }
      }
    }
    // zone boundaries interfinger: each band (by deposition time) shifts the lateral boundary a little,
    // so the shore reads as tongues of sand in mud — horizontal bands, never a vertical pillar
    const jit = new Int16Array(sH);
    // band height ≈ 4 px of the current section; the time step snaps to powers of two so bands stay put
    const span = sH > 1 ? Math.abs(this.bOfY[0] - this.bOfY[sH - 1]) : 1;
    const step = Math.pow(2, Math.ceil(Math.log2(Math.max(1, span / Math.max(1, sH / 4)))));
    for (let y = 0; y < sH; y++) {
      const band = Math.floor(this.bOfY[y] / step) & 255;
      jit[y] = Math.round((hash2(band, 77) - 0.5) * 84 + (NOISE[(((band * 7) & 255) << 8) | 131] - 0.5) * 12);
    }

    for (let x = 0; x < WW; x++) {
      const base = x * CAP;
      let i = w.len[x] - 1;
      const fold = w.fold[x] ? Math.round(w.fold[x] * 0.3) : 0;
      for (let y = 0; y < sH; y++) {
        const yy = Math.max(0, Math.min(sH - 1, y + (y > 6 ? fold : 0)));
        const xs = Math.max(0, Math.min(WW - 1, x + jit[yy] + ((NOISE[((yy * 5) & 255) * 256 + ((x * 3) & 255)] * 5) | 0) - 2));
        matCol[y] = matAll[xs * sH + yy]; kCol[y] = kAll[xs * sH + yy];
        const b = this.bOfY[yy];
        while (i > 0 && w.birth[base + i] > b) i--;
        cellCol[y] = w.len[x] && i >= 0 && w.birth[base + i] <= b + 1e-3 ? i : -1;
      }
      // 2) bands thinner than 3 px join the band above
      let runStart = 0;
      for (let y = 1; y <= sH; y++) {
        if (y < sH && matCol[y] === matCol[runStart]) continue;
        if (y - runStart < 3 && runStart > 0) for (let q = runStart; q < y; q++) matCol[q] = matCol[runStart - 1];
        runStart = y;
      }
      // 3) paint: palette + noise inside the band, boundary line one tone darker, deeper and denser = darker
      let lastFossilCell = -2;
      for (let y = 0; y < sH; y++) {
        const o = y * WW + x;
        if (y > revealY) { buf[o] = 0xff0d0b0e; continue; }
        const m = matCol[y];
        const gs = GRAIN_SCALE[m];
        const n = NOISE[((((y * 9) / gs) | 0) & 255) * 256 + ((((x * 9) / gs) | 0) & 255)] * 0.75 + GRAIN[((y & 255) << 8) | (x & 255)] * 0.25;
        let s = (n * SH + ((x + y) & 1 ? 0.15 : -0.15)) | 0;
        s = s < 0 ? 0 : s > 4 ? 4 : s;
        let d = EMISSIVE[m] ? 0 : Math.min(DARK - 1, Math.floor(y * darkStep * 0.8 + (kCol[y] - 1) * 0.8));
        if (y > 0 && matCol[y - 1] !== m) { d = Math.min(DARK - 1, d + 3); s = Math.max(0, s - 1); }
        const ci = cellCol[y];
        if (ci >= 0) {
          const j = base + ci;
          const fl = w.flags[j];
          if ((fl & (F_FOSSIL | F_FRAGMENT)) && ci !== lastFossilCell) {
            lastFossilCell = ci;
            if (fl & F_FOSSIL) this.fossils.push({ x, y, species: w.spec[j] - 1, rare: !!(fl & F_RARE), fragment: false });
            else if ((x + ci) % 2 === 0) this.fossils.push({ x, y, species: w.spec[j] - 1, rare: false, fragment: true });
          }
          if (fl & F_GLOW) d = 0;
        }
        let c = SHADE[m][d * SH + s];
        if (targets.length) c = this.tint(g, c, x, this.bOfY[y], y);
        buf[o] = c;
      }
      // 4) foundation, horizon, bedrock
      for (let y = sH; y < H; y++) {
        const o = y * WW + x;
        if (y > revealY) { buf[o] = 0xff0d0b0e; continue; }
        if (y < hTop) {
          const n = NOISE[((y * 7) & 255) * 256 + ((x * 7) & 255)];
          let c = FOUND[Math.min(3, (n * 4) | 0)];
          for (const lv of g.meta.foundationLines) if (Math.round(hTop - (lv / Math.max(f, 1e-6)) * fpx) === y) c = EPOCH;
          buf[o] = c;
        } else if (y < hTop + HR) {
          const r = y - hTop;
          buf[o] = HORIZON32[x * HR + r];
          if (hash2(x, r + 50) < g.glow[x] * 0.12) this.glowPts.push(x, y);
        } else {
          // bedrock: coarse grey-blue blocks, rare cracks, veins and inclusions
          const ny = y - hTop - HR;
          const n = NOISE[((((ny + 40) * 3) & 255) << 8) | ((x * 3) & 255)] * 0.7 + NOISE[(((ny * 11) & 255) << 8) | ((x * 11 + 50) & 255)] * 0.3;
          let c = BEDROCK[Math.min(4, (n * 5) | 0)];
          const crack = Math.abs(Math.sin(x * 0.21 + ny * 0.6 + NOISE[((ny * 5) & 255) * 256 + ((x * 2) & 255)] * 6)) < 0.04;
          if (crack && hash2(x >> 2, ny >> 2) > 0.55) c = CRACK;
          const h = hash2(x * 3 + 7, ny + 1000);
          if (h > 0.992) c = VEIN; else if (h > 0.986) c = SPECK;
          buf[o] = c;
        }
      }
    }
    this.ctx.putImageData(this.img, 0, 0, 0, 0, WW, H);
  }

  private tint(g: Game, c: number, x: number, birth: number, y: number): number {
    const ts = g.run.targets;
    for (let ti = 0; ti < ts.length; ti++) {
      const t = ts[ti];
      if (x < t.x0 || x > t.x1 || birth < t.b0 || birth > t.b1) continue;
      let r = c & 255, gg = (c >> 8) & 255, b = (c >> 16) & 255;
      if (t.kind === 'water') { r = r * 0.7 + 20; gg = gg * 0.75 + 45; b = b * 0.7 + 85; }
      else { const h = Math.min(1, t.heat / 120); r = r * (1 - 0.3 * h) + 140 * h; gg = gg * (1 - 0.25 * h) + 40 * h; b = b * (1 - 0.35 * h); }
      if (((x * 7 + y * 3) & 15) === 0) this.zones[ti].pts.push(x, y);
      c = pack32(Math.min(255, r), Math.min(255, gg), Math.min(255, b));
    }
    return c;
  }

  /** Birth-year range covered by section rows y0..y1 (for underground targets). */
  birthRange(y0: number, y1: number): [number, number] {
    const a = this.bOfY[Math.max(0, Math.min(this.strataH - 1, Math.floor(y0)))];
    const b = this.bOfY[Math.max(0, Math.min(this.strataH - 1, Math.floor(y1)))];
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return [isNaN(lo) ? -1e9 : lo, isNaN(hi) ? 1e9 : hi];
  }
}
