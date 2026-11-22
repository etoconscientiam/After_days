// The section (срез), drawn as a geological outcrop.
// History is cut into layers: time spans with one dominant material. Each layer is a band whose thickness follows
// what was really deposited in each column (thicker under the sea, thinner on land), smoothed so it never steps.
// Neighbours contrast in brightness, the top edge of every layer waves by a pixel or two and is underlined one tone
// darker, a few inclusions sit inside (pebbles, lenses, shells, roots). Deeper is darker, colder and thinner.
// Under the strata: foundation (epochs), the technogenic horizon with the thing, and bedrock to the bottom — always.
import { CFG, NMAT, M } from '../config';
import type { Game } from '../core/game';
import { CAP, F_FOSSIL, F_FRAGMENT, F_RARE, F_GLOW } from '../world/World';
import { Layout, PAL_RGB, GRAIN_SCALE, NOISE, GRAIN, WW, WH, makeValueNoise } from './common';
import { hash2 } from '../core/rng';
import { skinPixels, SkinPixels } from './assets';

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
const MAX_ROW_PX = 5;
const LOG_C = 10;
const FOUND_K = CFG.B.physics.foundationK;

/** Scale a packed ABGR colour by f (and optionally tint it by an RGB colour, using the texel's brightness). */
function shadePx(c: number, f: number, tint?: number[], mean = 128): number {
  let r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
  if (tint) { const l = (r * 0.3 + g * 0.59 + b * 0.11) / mean; r = tint[0] * l; g = tint[1] * l; b = tint[2] * l; }
  r *= f; g *= f; b *= f * 0.95 + 0.05;
  return (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
}
/** Materials without a painted texture borrow a related one, tinted with their own colour. */
const TEX_ALIAS: Record<string, string> = {
  mudstone: 'silt', orgMarine: 'silt', chalk: 'sand', glassSand: 'sand', shellOoze: 'limestone', limeCrust: 'limestone',
  marble: 'limestone', stromatolite: 'limestone', quartzite: 'sandstone', phosphorite: 'sandstone', slate: 'shale',
  lignite: 'peat', orgLand: 'peat', anthracite: 'coal', graphite: 'coal', obsidian: 'coal', guano: 'soil', dung: 'soil',
  hearth: 'soil', ash: 'dust', tuff: 'dust', moraine: 'dust', basalt: 'bedrock', granite: 'bedrock', gneiss: 'bedrock',
  concrete: 'technogenic',
};
const meanLum = new WeakMap<SkinPixels, number>();
function lumOf(t: SkinPixels): number {
  let m = meanLum.get(t);
  if (m === undefined) {
    let s = 0;
    for (let i = 0; i < t.px.length; i++) { const c = t.px[i]; s += (c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11; }
    m = Math.max(8, s / t.px.length);
    meanLum.set(t, m);
  }
  return m;
}
const texAt = (t: SkinPixels, x: number, y: number) => t.px[(((y % t.h) + t.h) % t.h) * t.w + (((x % t.w) + t.w) % t.w)];

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

const NB = 240;          // time bins between now and the oldest deposit
const BIN_POW = 2;       // bin spacing: finer near the present
const XS = 2;            // column step for the time–depth table (interpolated between)
const TOPMAX = 6;        // how far the cut's top edge follows the surface relief
const MIN_PX = 3;        // thinner layers join a neighbour
const BED_PX = 15;       // thicker layers are split into beds
/** soft large-scale noise (cells of 64 and 48 world px): brightness and hue drift that hides the tile grid */
const LOW_A = makeValueNoise(91, 64), LOW_B = makeValueNoise(97, 48);
const low = (n: Float32Array, x: number, y: number) => n[((y & 255) << 8) | (x & 255)];

type Incl = { kind: 'pebble' | 'lens' | 'shell' | 'root' | 'speck'; x: number; f: number; w: number; col: number };
interface Layer {
  kTop: number; kBot: number;  // bin indices of the top and bottom boundaries (kTop < kBot)
  mat: number; k: number;
  tone: number; warm: number;  // brightness factor and warm shift against the neighbours
  tex: SkinPixels | null; own: boolean; tinted: boolean;
  ox: number; oy: number; seed: number;
  top: Int16Array;             // screen row of the layer's top edge per column
  inc: Incl[];
}

const FAMILY: Record<string, Incl['kind']> = {
  soil: 'root', orgLand: 'root', peat: 'root', dung: 'root', guano: 'root', hearth: 'speck',
  sand: 'pebble', sandstone: 'pebble', moraine: 'pebble', dust: 'pebble', quartzite: 'pebble', glassSand: 'pebble', tuff: 'pebble', ash: 'speck',
  limestone: 'shell', chalk: 'shell', shellOoze: 'shell', limeCrust: 'shell', stromatolite: 'shell', marble: 'shell',
  silt: 'lens', clay: 'lens', mudstone: 'lens', shale: 'lens', slate: 'lens', orgMarine: 'lens', phosphorite: 'lens',
  coal: 'speck', lignite: 'speck', anthracite: 'speck',
};

function scale(c: number, f: number, warm: number, cold: number, hue: number): number {
  let r = (c & 255) * f, g = ((c >> 8) & 255) * f, b = ((c >> 16) & 255) * f;
  if (warm) { r *= 1 + 0.07 * warm; g *= 1 + 0.02 * warm; b *= 1 - 0.07 * warm; }
  r *= 1 - 0.16 * cold + hue; g *= 1 - 0.07 * cold; b *= 1 + 0.05 * cold - hue;
  return (255 << 24) | ((b > 255 ? 255 : b < 0 ? 0 : b) << 16) | ((g > 255 ? 255 : g < 0 ? 0 : g) << 8) | (r > 255 ? 255 : r < 0 ? 0 : r);
}

export class SectionRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  buf: Uint32Array;
  fossils: FossilMark[] = [];
  zones: ZoneMark[] = [];
  glowPts: number[] = [];
  horizonTop = new Float32Array(WW);
  /** row where the cut begins in each column (it follows the relief of the surface) */
  topD = new Int16Array(WW);
  /** ground height per column from the renderer, so the cut's top edge follows the land */
  relief: Float32Array | null = null;
  foundationPx = 0;
  strataH = 0;                       // the lowest strata row (from the section top)
  layers: Layer[] = [];
  private strataBot = new Int16Array(WW);
  private bG = new Float64Array(NB + 1);
  private VS = new Float32Array((NB + 1) * WW);   // smoothed visual depth per bin per column
  private YG = new Float32Array((NB + 1) * WW);   // its screen row
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

  // ---------- depth ↔ screen ----------
  yOfV(v: number): number {
    const Hs = this.Hs, Dt = this.Dt;
    if (Dt <= 0) return 0;
    if (Dt * MAX_ROW_PX <= Hs) return v * MAX_ROW_PX;
    return (Hs * Math.log(1 + v / LOG_C)) / Math.log(1 + Dt / LOG_C);
  }

  vOfY(y: number): number {
    const Hs = this.Hs, Dt = this.Dt;
    if (Hs <= 0) return 0;
    if (Dt * MAX_ROW_PX <= Hs) return y / MAX_ROW_PX;
    return LOG_C * (Math.exp((y / Hs) * Math.log(1 + Dt / LOG_C)) - 1);
  }

  /** Screen row (from the section top) of birth year b in column x. */
  yAt(x: number, b: number): number {
    const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
    const bG = this.bG;
    if (!(bG[0] > bG[NB])) return this.topD[xi];
    if (b >= bG[0]) return this.YG[xi];
    if (b <= bG[NB]) return this.YG[NB * WW + xi];
    const u = Math.pow((bG[0] - b) / (bG[0] - bG[NB]), 1 / BIN_POW) * NB;
    const k = Math.min(NB - 1, Math.floor(u));
    const t = (bG[k] - b) / Math.max(1e-9, bG[k] - bG[k + 1]);
    return this.YG[k * WW + xi] + (this.YG[Math.min(NB, k + 1) * WW + xi] - this.YG[k * WW + xi]) * t;
  }

  /** Birth year shown at (x, y) inside the strata (inverse of yAt). */
  bAt(x: number, y: number): number {
    const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
    const YG = this.YG, bG = this.bG;
    let lo = 0, hi = NB;
    if (y <= YG[xi]) return bG[0];
    if (y >= YG[NB * WW + xi]) return bG[NB];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (YG[m * WW + xi] < y) lo = m; else hi = m; }
    const a = YG[lo * WW + xi], c = YG[hi * WW + xi];
    const t = c > a ? (y - a) / (c - a) : 0;
    return bG[lo] + (bG[hi] - bG[lo]) * t;
  }

  /** Screen row for a birth year in the middle column (glints, fossils, era lines). */
  yOfBirth(b: number): number { return this.yAt(WW / 2, b); }

  /** What lies at section-local (x, y). */
  locateAt(g: Game, x: number, y: number): Loc {
    const w = g.world;
    const xi = Math.max(0, Math.min(WW - 1, Math.floor(x)));
    if (y < this.topD[xi]) return { kind: 'bedrock' };
    if (y >= this.horizonTop[xi] + HR) return { kind: 'bedrock' };
    if (y >= this.horizonTop[xi]) return { kind: 'horizon' };
    if (y >= this.strataBot[xi]) return { kind: 'foundation' };
    const b = this.bAt(xi, y);
    const base = xi * CAP;
    let i = w.len[xi] - 1;
    while (i > 0 && w.birth[base + i] > b) i--;
    if (w.len[xi] && w.birth[base + i] <= b) return { kind: 'cell', i, depth: w.len[xi] - 1 - i };
    for (let p = 0; p < w.packs.length; p++) {
      const pk = w.packs[p];
      if (b >= pk.ageMin && b <= pk.ageMax + 1) return { kind: 'pack', p, frac: (pk.ageMax - b) / Math.max(1e-6, pk.ageMax - pk.ageMin), depth: w.len[xi] };
    }
    if (w.len[xi]) return { kind: 'cell', i: 0, depth: w.len[xi] - 1 };
    return { kind: 'horizon' };
  }

  /** Birth-year range covered by rows y0..y1 of column x (for underground targets). */
  birthRange(y0: number, y1: number, x = WW / 2): [number, number] {
    const a = this.bAt(x, y0), b = this.bAt(x, y1);
    return [Math.min(a, b), Math.max(a, b)];
  }

  // ---------- the time–depth table ----------
  /** Visual depth (Σ 1/k) of everything younger than each time bin, per column; and what each bin is made of. */
  private buildTable(g: Game, hist: Float32Array, cnt: Float32Array): void {
    const w = g.world;
    const now = g.run.year;
    let bMin = now;
    for (let x = 0; x < WW; x += XS) if (w.len[x]) bMin = Math.min(bMin, w.birth[x * CAP]);
    for (const pk of w.packs) bMin = Math.min(bMin, pk.ageMin);
    const bG = this.bG;
    // bins get finer toward the present (the top of the cut is drawn large), so young layers can split into beds
    for (let k = 0; k <= NB; k++) bG[k] = now - (now - bMin) * Math.pow(k / NB, BIN_POW);
    const span = Math.max(1e-6, now - bMin);
    const binOf = (b: number) => Math.max(1, Math.min(NB, Math.ceil(Math.pow(Math.max(0, (now - b) / span), 1 / BIN_POW) * NB)));
    const VS = this.VS;
    VS.fill(0);
    const nCols = Math.ceil(WW / XS);
    // cells, sampled columns
    for (let x = 0; x < WW; x += XS) {
      const base = x * CAP;
      let i = w.len[x] - 1, acc = 0;
      for (let k = 0; k <= NB; k++) {
        const b = bG[k];
        while (i >= 0 && w.birth[base + i] > b) {
          const kk = w.k[base + i], m = w.mat[base + i];
          acc += 1 / kk;
          const bin = binOf(w.birth[base + i]);
          hist[bin * NMAT + m] += 1 / kk / nCols;
          cnt[bin] += 1 / nCols;
          i--;
        }
        VS[k * WW + x] = acc;
      }
    }
    // packs are full width
    for (const pk of w.packs) {
      const t = pk.rows / pk.k;
      let tot = 0;
      for (let m = 0; m < NMAT; m++) tot += pk.amt[m];
      const frac = (b: number) => (b >= pk.ageMax ? 0 : b <= pk.ageMin ? 1 : (pk.ageMax - b) / Math.max(1e-6, pk.ageMax - pk.ageMin));
      let prev = 0;
      for (let k = 0; k <= NB; k++) {
        const f = frac(bG[k]);
        const add = f * t;
        for (let x = 0; x < WW; x += XS) VS[k * WW + x] += add;
        if (k > 0 && f > prev) {
          const part = (f - prev) * t;
          for (let m = 0; m < NMAT; m++) if (pk.amt[m] > 0) hist[k * NMAT + m] += part * (pk.amt[m] / Math.max(1e-6, tot));
          cnt[k] += part * pk.k;
        }
        prev = f;
      }
    }
    // fill the columns between samples, then smooth across x so thickness changes gently (no steps)
    const tmp = new Float32Array(WW);
    for (let k = 0; k <= NB; k++) {
      const row = k * WW;
      for (let x = 0; x < WW; x++) {
        if (x % XS === 0) continue;
        const a = x - (x % XS), b = Math.min(WW - 1 - ((WW - 1) % XS), a + XS);
        const t = b > a ? (x - a) / (b - a) : 0;
        VS[row + x] = VS[row + a] + (VS[row + b] - VS[row + a]) * t;
      }
      for (let pass = 0; pass < 2; pass++) {
        const R = 9;
        let s = 0, n = 0;
        for (let x = -R; x < WW + R; x++) {
          const xin = x + R, xout = x - R - 1;
          if (xin < WW && xin >= 0) { s += VS[row + xin]; n++; }
          if (xout >= 0 && xout < WW) { s -= VS[row + xout]; n--; }
          if (x >= 0 && x < WW) tmp[x] = s / Math.max(1, n);
        }
        VS.set(tmp, row);
      }
      // keep the lateral difference, but gentle: half of it (layers swell under the sea, never fold into waves)
      let mean = 0;
      for (let x = 0; x < WW; x++) mean += VS[row + x];
      mean /= WW;
      for (let x = 0; x < WW; x++) VS[row + x] = mean + (VS[row + x] - mean) * 0.4;
    }
  }

  // ---------- layers ----------
  private buildLayers(g: Game, hist: Float32Array, cnt: Float32Array): void {
    const YG = this.YG;
    const avgY = (k: number) => { let s = 0, n = 0; for (let x = 0; x < WW; x += 6) { s += YG[k * WW + x]; n++; } return s / n; };
    const dom = (k0: number, k1: number) => {
      let best = -1, bm = M.soil;
      for (let m = 0; m < NMAT; m++) { let s = 0; for (let k = k0 + 1; k <= k1; k++) s += hist[k * NMAT + m]; if (s > best) { best = s; bm = m; } }
      return bm;
    };
    // 1) runs of bins with the same dominant material
    type Run = { k0: number; k1: number; mat: number };
    let runs: Run[] = [];
    for (let k = 1; k <= NB; k++) {
      let best = 0, bm = -1;
      for (let m = 0; m < NMAT; m++) { const v = hist[k * NMAT + m]; if (v > best) { best = v; bm = m; } }
      const last = runs[runs.length - 1];
      if (bm < 0 || (last && last.mat === bm)) { if (last) last.k1 = k; else runs.push({ k0: 0, k1: k, mat: M.dust }); continue; }
      runs.push({ k0: last ? last.k1 : 0, k1: k, mat: bm });
    }
    // 2) layers thinner than MIN_PX join their thinner-boundary neighbour (same material first)
    const px = (r: Run) => avgY(r.k1) - avgY(r.k0);
    for (let guard = 0; guard < 400 && runs.length > 1; guard++) {
      let wi = -1, wpx = MIN_PX;
      for (let i = 0; i < runs.length; i++) { const p = px(runs[i]); if (p < wpx) { wpx = p; wi = i; } }
      if (wi < 0) break;
      const a = runs[wi - 1], b = runs[wi + 1];
      const into = !a ? wi + 1 : !b ? wi - 1 : a.mat === runs[wi].mat ? wi - 1 : b.mat === runs[wi].mat ? wi + 1 : px(a) < px(b) ? wi - 1 : wi + 1;
      const lo = Math.min(wi, into), hi = Math.max(wi, into);
      const merged = { k0: runs[lo].k0, k1: runs[hi].k1, mat: 0 };
      merged.mat = dom(merged.k0, merged.k1);
      runs.splice(lo, 2, merged);
    }
    // 3) thick layers split into beds of ~8–12 px (one material: alternating tone below)
    const out: Run[] = [];
    for (const r of runs) {
      const p = px(r);
      const n = p > BED_PX ? Math.min(8, Math.round(p / 10)) : 1;
      if (n <= 1) { out.push(r); continue; }
      let k0 = r.k0;
      const y0 = avgY(r.k0);
      for (let s = 1; s <= n; s++) {
        let k1 = r.k1;
        if (s < n) {
          const target = y0 + (p * s) / n + (hash2(r.k0 + s, 33) - 0.5) * 3;
          k1 = k0 + 1;
          while (k1 < r.k1 - 1 && avgY(k1) < target) k1++;
        }
        if (k1 > k0) out.push({ k0, k1, mat: r.mat });
        k0 = k1;
      }
    }
    runs = out;
    // 4) the layers themselves: texture, tone against the neighbours, inclusions
    const K = CFG.B.physics.foundationK;
    const texCompacted = skinPixels('world/tex/compacted.png');
    const MID = PAL_RGB.map((pal) => pal[Math.min(2, pal.length - 1)]);
    const lum = (m: number) => MID[m][0] * 0.3 + MID[m][1] * 0.59 + MID[m][2] * 0.11;
    this.layers = [];
    let prevL = -1, prevLight = false;
    runs.forEach((r, j) => {
      let c = 0, wsum = 0;
      for (let k = r.k0 + 1; k <= r.k1; k++) { let s = 0; for (let m = 0; m < NMAT; m++) s += hist[k * NMAT + m]; wsum += s; c += cnt[k]; }
      const kAvg = wsum > 0 ? Math.max(1, c / wsum) : 1;
      const id = CFG.materials[r.mat].id;
      const own = EMISSIVE[r.mat] ? null : skinPixels(`world/tex/${id}.png`);
      let tex = own ?? (TEX_ALIAS[id] ? skinPixels(`world/tex/${TEX_ALIAS[id]}.png`) : null);
      let tinted = !own && !!tex;
      if (kAvg >= K && texCompacted) { tex = texCompacted; tinted = true; }
      // brightness against the layer above: at least 15% apart, alternating light — dark
      const depthK = 1 - 0.35 * Math.min(1, avgY(r.k0) / Math.max(1, this.Hs));
      const L = lum(r.mat) * depthK;
      let tone = 1, warm = 0;
      if (prevL > 0) {
        const ratio = L / prevL;
        if (Math.abs(1 - ratio) < 0.15) {
          if (prevLight) tone = (prevL * 0.83) / L;
          else { tone = (prevL * 1.17) / L; warm = 1; }
        }
      }
      tone = Math.max(0.62, Math.min(1.45, tone));
      prevLight = L * tone > prevL;
      prevL = L * tone;
      const seed = (hash2(r.mat * 31 + Math.floor(this.bG[r.k0] / 97), 11) * 1e6) | 0;
      const layer: Layer = {
        kTop: r.k0, kBot: r.k1, mat: r.mat, k: kAvg, tone, warm, tex, own: !!own, tinted,
        ox: seed % 64, oy: (seed >> 6) % 64, seed, top: new Int16Array(WW), inc: [],
      };
      // a couple of inclusions, never more
      const kind = FAMILY[id];
      const nInc = kind ? (hash2(seed, 5) < 0.55 ? 1 : 2) : 0;
      for (let q = 0; q < nInc; q++) {
        const ik = kind === 'root' && g.run.era < 3 ? 'pebble' : kind;
        const lensMat = r.mat === M.sand ? M.silt : M.sand;
        layer.inc.push({ kind: ik, x: 8 + Math.floor(hash2(seed, 20 + q) * (WW - 16)), f: 0.3 + hash2(seed, 40 + q) * 0.45, w: 6 + Math.floor(hash2(seed, 60 + q) * 10), col: lensMat });
      }
      this.layers.push(layer);
      void j;
    });
    // 5) boundaries per column: the smoothed depth, a 1–2 px wave, never crossing
    for (let j = 0; j < this.layers.length; j++) {
      const L = this.layers[j];
      for (let x = 0; x < WW; x++) {
        let y = YG[L.kTop * WW + x];
        if (j > 0) y += (low(LOW_B, x * 3 + j * 37, j * 53) - 0.5) * 3.2 + (NOISE[((j * 13) & 255) * 256 + ((x * 4) & 255)] - 0.5) * 1.2;
        let yi = Math.round(y);
        if (j === 0) yi = this.topD[x];
        else yi = Math.max(this.layers[j - 1].top[x] + 1, yi);
        L.top[x] = Math.min(this.strataBot[x], yi);
      }
    }
  }

  // ---------- render ----------
  render(g: Game, lay: Layout, revealY = Infinity): void {
    const w = g.world;
    const H = Math.min(this.canvas.height, lay.sectionH);
    const buf = this.buf;
    const f = g.meta.foundation;
    const fpx = f > 0 ? Math.round(Math.min(10, 2 + Math.sqrt(f))) : 0;
    this.foundationPx = fpx;
    this.Hs = Math.max(4, H - HR - BEDROCK_MIN - fpx - TOPMAX);
    // the cut's top edge follows the land: higher ground starts the cut higher
    if (this.relief) {
      let mn = 1e9;
      for (let x = 0; x < WW; x++) mn = Math.min(mn, this.relief[x]);
      for (let x = 0; x < WW; x++) this.topD[x] = Math.max(0, Math.min(TOPMAX, Math.round((this.relief[x] - mn) * 0.16)));
    } else this.topD.fill(0);
    // time–depth table
    const hist = new Float32Array((NB + 1) * NMAT), cnt = new Float32Array(NB + 1);
    this.buildTable(g, hist, cnt);
    let Dt = 0;
    for (let x = 0; x < WW; x++) Dt = Math.max(Dt, this.VS[NB * WW + x]);
    this.Dt = Dt;
    for (let k = 0; k <= NB; k++) for (let x = 0; x < WW; x++) this.YG[k * WW + x] = this.topD[x] + this.yOfV(this.VS[k * WW + x]);
    let sH = 0;
    for (let x = 0; x < WW; x++) {
      this.strataBot[x] = Math.round(this.YG[NB * WW + x]);
      sH = Math.max(sH, this.strataBot[x]);
      this.horizonTop[x] = this.strataBot[x] + fpx;
    }
    this.strataH = sH;
    this.buildLayers(g, hist, cnt);
    this.fossils.length = 0;
    this.glowPts.length = 0;
    const targets = g.run.targets;
    this.zones = targets.map((t) => ({ kind: t.kind, pts: [] as number[] }));
    const texBedrock = skinPixels('world/tex/bedrock.png');
    const texTechno = skinPixels('world/tex/technogenic.png');
    const texCompacted = skinPixels('world/tex/compacted.png');
    const MIDL = PAL_RGB.map((pal) => { const c = pal[Math.min(2, pal.length - 1)]; return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; });
    const layers = this.layers;

    for (let x = 0; x < WW; x++) {
      const top0 = this.topD[x], bot = this.strataBot[x], hTop = this.horizonTop[x];
      for (let y = 0; y < top0 && y < H; y++) buf[y * WW + x] = 0;   // above the cut: the ground plane shows
      // strata
      let j = 0;
      for (let y = top0; y < bot && y < H; y++) {
        const o = y * WW + x;
        while (j < layers.length - 1 && y >= layers[j + 1].top[x]) j++;
        const L = layers[j];
        if (!L) { buf[o] = FOUND[1]; continue; }
        if (y > revealY) { buf[o] = FOUND[(hash2(x, y) * 2) | 0]; continue; }
        const rel = y - L.top[x];
        const m = L.mat;
        let c: number, norm = 1;
        if (L.tex) {
          // one texture pixel = one world pixel; each layer has its own offset, each 64-px block its own mirror
          const tx = L.tex, bx = Math.floor((x + L.ox) / tx.w), by = Math.floor((rel + L.oy) / tx.h);
          const v = hash2(bx * 7 + L.seed, by);
          let u = (x + L.ox) % tx.w, vv = Math.floor((rel * (1 + Math.max(0, L.k - 1) * 0.3) + L.oy)) % tx.h;
          if (v < 0.5) u = tx.w - 1 - u;
          if (v > 0.25 && v < 0.75) vv = tx.h - 1 - vv;
          c = tx.px[vv * tx.w + u];
          const lm = lumOf(tx);
          if (L.tinted) {
            const mid = PAL_RGB[m][Math.min(2, PAL_RGB[m].length - 1)];
            const l = ((c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11) / lm;
            c = pack32(Math.min(255, mid[0] * l), Math.min(255, mid[1] * l), Math.min(255, mid[2] * l));
          } else norm = Math.max(0.6, Math.min(1.6, MIDL[m] / lm));
        } else {
          const gs = GRAIN_SCALE[m];
          const n = NOISE[((((y * 9) / gs) | 0) & 255) * 256 + ((((x * 9) / gs) | 0) & 255)] * 0.75 + GRAIN[((y & 255) << 8) | (x & 255)] * 0.25;
          c = SHADE[m][Math.min(4, (n * SH) | 0)];
        }
        // depth: darker and colder; soft large noise; the layer's own tone; the underlined top edge
        const dep = Math.min(1, y / Math.max(1, sH));
        let fct = norm * L.tone * (1 - 0.38 * dep) * (0.9 + 0.2 * low(LOW_A, x, y));
        if (EMISSIVE[m]) fct = 1;
        else if (rel === 0 && j > 0) fct *= 0.68;
        else if (rel === 1 && j > 0) fct *= 0.9;
        if (L.k >= CFG.B.physics.foundationK && ((rel + j) % 3 === 0)) fct *= 0.8;   // dense laminae in compacted rock
        c = scale(c, fct, L.warm, dep, (low(LOW_B, x + 50, y) - 0.5) * 0.06);
        if (targets.length) c = this.tint(g, c, x, this.bAt(x, y), y);
        buf[o] = c;
      }
      // foundation (with the glowing lines of past epochs), horizon, bedrock — always, also during a reveal
      for (let y = Math.max(bot, top0); y < H; y++) {
        const o = y * WW + x;
        if (y < hTop) {
          const n = NOISE[((y * 7) & 255) * 256 + ((x * 7) & 255)];
          let c = texCompacted ? shadePx(texAt(texCompacted, x, y), 1, [52, 46, 66], lumOf(texCompacted)) : FOUND[Math.min(3, (n * 4) | 0)];
          if (((y - bot) % 2) === 0) c = scale(c, 0.85, 0, 0, 0);
          for (const lv of g.meta.foundationLines) if (Math.round(hTop - (lv / Math.max(f, 1e-6)) * fpx) === y) c = EPOCH;
          buf[o] = c;
        } else if (y < hTop + HR) {
          const r = y - hTop;
          buf[o] = texTechno ? texAt(texTechno, x, Math.floor(((r + 0.5) * texTechno.h) / HR)) | 0xff000000 : HORIZON32[x * HR + r];
          if (hash2(x, r + 50) < g.glow[x] * 0.12) this.glowPts.push(x, y);
        } else {
          const ny = y - hTop - HR;
          const dk = Math.max(0.62, 1 - ny * 0.004);
          if (texBedrock) { buf[o] = scale(texAt(texBedrock, x + 17, ny), dk * (0.92 + 0.16 * low(LOW_A, x + 90, y)), 0, 0.4, 0); continue; }
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
    if (revealY === Infinity || revealY > sH) this.paintInclusions(H);
    this.collectFossils(g, H);
    this.ctx.putImageData(this.img, 0, 0, 0, 0, WW, H);
  }

  /** Pebbles, lenses of another material, shells, roots: a couple per layer. */
  private paintInclusions(H: number): void {
    const buf = this.buf;
    const layers = this.layers;
    const put = (x: number, y: number, c: number) => { if (x >= 0 && x < WW && y >= 0 && y < H) buf[y * WW + x] = c; };
    const shade = (x: number, y: number, f: number) => { if (x >= 0 && x < WW && y >= 0 && y < H) buf[y * WW + x] = scale(buf[y * WW + x], f, 0, 0, 0); };
    for (let j = 0; j < layers.length; j++) {
      const L = layers[j];
      const next = layers[j + 1];
      for (const inc of L.inc) {
        const x = inc.x;
        const t0 = L.top[x], t1 = next ? next.top[x] : this.strataBot[x];
        const th = t1 - t0;
        if (th < (inc.kind === 'root' ? 4 : 3)) continue;
        const y = Math.round(t0 + 1 + (th - 2) * inc.f);
        const d = Math.min(1, y / Math.max(1, this.strataH));
        const f = 1 - 0.38 * d;
        if (inc.kind === 'pebble') {
          const base = scale(pack32(128, 118, 104), f, 0, d, 0), hi = scale(pack32(178, 168, 150), f, 0, d, 0), lo = scale(pack32(70, 62, 56), f, 0, d, 0);
          put(x, y, base); put(x + 1, y, base); put(x, y - 1, hi); put(x + 1, y + 1, lo);
          if (inc.w > 10) { put(x + 2, y, base); put(x + 2, y + 1, lo); put(x + 1, y - 1, hi); }
        } else if (inc.kind === 'shell') {
          const c = scale(pack32(232, 222, 196), f, 0, d, 0), dk = scale(pack32(120, 106, 86), f, 0, d, 0);
          put(x - 1, y, c); put(x, y - 1, c); put(x + 1, y, c); put(x, y, dk); put(x - 1, y + 1, dk); put(x + 1, y + 1, dk);
        } else if (inc.kind === 'root') {
          const c = scale(pack32(54, 38, 28), f, 0, d, 0);
          let xx = x;
          for (let yy = t0; yy < Math.min(t1, t0 + 3 + (inc.w >> 1)); yy++) { put(xx, yy, c); if (hash2(xx, yy) > 0.6) xx += hash2(yy, xx) > 0.5 ? 1 : -1; }
        } else if (inc.kind === 'speck') {
          const c = scale(pack32(226, 160, 70), f, 0, d * 0.5, 0);
          put(x, y, c); put(x + 1, y, scale(c, 0.7, 0, 0, 0));
        } else {
          // a lens: a flat lentil of another material, thicker in the middle, edged one tone darker
          const mid = PAL_RGB[inc.col][Math.min(2, PAL_RGB[inc.col].length - 1)];
          const half = inc.w;
          for (let dx = -half; dx <= half; dx++) {
            const hgt = Math.round((1 - (dx / half) ** 2) * Math.min(2.6, th * 0.35));
            for (let dy = 0; dy < hgt; dy++) {
              const n = GRAIN[(((y + dy) & 255) << 8) | ((x + dx) & 255)];
              put(x + dx, y - (hgt >> 1) + dy, scale(pack32(mid[0], mid[1], mid[2]), f * (0.85 + 0.25 * n), 0, d, 0));
            }
            if (hgt > 0) shade(x + dx, y - (hgt >> 1) + hgt, 0.75);
          }
        }
      }
    }
  }

  /** Fossils and fragments at their own depth in their own column. */
  private collectFossils(g: Game, H: number): void {
    const w = g.world;
    for (let x = 0; x < WW; x++) {
      const base = x * CAP;
      let last = -9;
      for (let i = w.len[x] - 1; i >= 0; i--) {
        const fl = w.flags[base + i];
        if (!(fl & (F_FOSSIL | F_FRAGMENT))) continue;
        const y = Math.round(this.yAt(x, w.birth[base + i]));
        if (y === last || y >= H || y >= this.strataBot[x]) continue;
        last = y;
        if (fl & F_FOSSIL) this.fossils.push({ x, y, species: w.spec[base + i] - 1, rare: !!(fl & F_RARE), fragment: false });
        else if ((x + i) % 2 === 0) this.fossils.push({ x, y, species: w.spec[base + i] - 1, rare: false, fragment: true });
      }
    }
    void F_GLOW;
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
}
