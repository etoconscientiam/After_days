// The section (срез), drawn as a geological outcrop you can read at a glance (brief 6).
// History is cut into layers: time spans with one dominant material. Depth is drawn in perspective (log scale):
// fresh layers at the top are thick and detailed, older ones thinner; nothing is thinner than MIN_PX — thin runs
// merge into a striped belt of their epoch. Grain and texture are drawn in 2×2 blocks, the size of a creature's
// pixel. Every rock family has its own look (sandstone grain, limestone blocks, clay with cracks, coal glints,
// shale laminae); neighbours differ clearly in brightness; edges wave; 1–3 inclusions per layer catch the eye
// (ammonites, shells, bones, roots, amber). Earthquakes leave a fault: older layers shifted and bent.
// Under the strata: foundation (epochs), the technogenic horizon with the thing, and bedrock to the bottom — always.
// An open drawer crops the section: the top keeps its scale, the depth folds into a ribbon of epochs.
import { CFG, NMAT, M, eraOfYear } from '../config';
import type { Game } from '../core/game';
import { CAP, F_FOSSIL, F_FRAGMENT, F_RARE, F_GLOW } from '../world/World';
import { Layout, PAL_RGB, GRAIN_SCALE, NOISE, WW, WH, makeValueNoise } from './common';
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
const GLINT = pack32(226, 232, 244);
const HR = 6; // horizon rows on screen
const BEDROCK_MIN = 8;
const MAX_ROW_PX = 5;
const LOG_C = 4;      // perspective: smaller = the fresh top drawn larger, the deep past thinner
const RIB_MAX = 16;   // the history ribbon above an open drawer

/** Epoch colours: the era ruler, the history ribbon, the belts. */
export const ERA_COLORS = ['#8a7f9a', '#5aa58a', '#4d8fc4', '#78b454', '#c99a4a', '#c4703c', '#e0a43a', '#f2d58a'];
const ERA_RGB = ERA_COLORS.map((h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });

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
/** One epoch's span on screen (middle column), for the era ruler. */
export interface EraSpan { era: number; y0: number; y1: number }

const NB = 240;          // time bins between now and the oldest deposit
const BIN_POW = 2;       // bin spacing: finer near the present
const XS = 2;            // column step for the time–depth table (interpolated between)
const TOPMAX = 6;        // how far the cut's top edge follows the surface relief
const MIN_PX = 6;        // no layer is thinner on screen: thinner runs merge (into a belt of their epoch)
const BED_PX = 40;       // thicker layers are split into beds
/** soft large-scale noise (cells of 64 and 48 world px): brightness and hue drift that hides the tile grid */
const LOW_A = makeValueNoise(91, 64), LOW_B = makeValueNoise(97, 48);
const low = (n: Float32Array, x: number, y: number) => n[((y & 255) << 8) | (x & 255)];

// ---------- rock families: each has a pattern you recognise ----------
type Fam = 'grain' | 'block' | 'smooth' | 'coal' | 'lam' | 'soil' | 'plain';
const FAM: Record<string, Fam> = {
  sand: 'grain', sandstone: 'grain', quartzite: 'grain', glassSand: 'grain', moraine: 'grain', dust: 'grain', tuff: 'grain', ash: 'grain', phosphorite: 'grain',
  limestone: 'block', chalk: 'block', marble: 'block', shellOoze: 'block', limeCrust: 'block', stromatolite: 'block',
  clay: 'smooth', silt: 'smooth', mudstone: 'smooth',
  coal: 'coal', lignite: 'coal', anthracite: 'coal', graphite: 'coal', obsidian: 'coal', oil: 'coal',
  shale: 'lam', slate: 'lam', orgMarine: 'lam',
  soil: 'soil', peat: 'soil', orgLand: 'soil', dung: 'soil', guano: 'soil', hearth: 'soil',
};
const famOf = (m: number): Fam => FAM[CFG.materials[m].id] ?? 'plain';

/** Brightness multiplier of a family's pattern at world coords (X, Y) relative to the layer; res = size of one
 *  output pixel in world px (1 on the screen, 1/3 in the lens). -1 = a glint. */
function pattern(fam: Fam, X: number, Y: number, res: number, seed: number): number {
  const gs = res < 1 ? 1 : 2;
  const t = res < 1 ? 0.34 : 1;
  switch (fam) {
    case 'grain': {
      const h = hash2(Math.floor(X / gs) * 3 + seed, Math.floor(Y / gs));
      return h > 0.86 ? 1.2 : h < 0.13 ? 0.8 : 1;
    }
    case 'block': {
      // light blocks: courses 6 px high, blocks 10–16 px long, staggered, with darker joints
      const row = Math.floor(Y / 6), v = Y - row * 6;
      const u = X + hash2(row, seed) * 16;
      const bw = 10 + Math.floor(hash2(row + 7, seed) * 6);
      const bi = Math.floor(u / bw), uu = u - bi * bw;
      if (v >= 6 - t || uu < t) return 0.74;
      const face = 0.94 + 0.12 * hash2(bi + seed, row);
      if (v < t) return face * 1.08;
      const h = hash2(Math.floor(X / gs) + seed * 3, Math.floor(Y / gs) * 7);
      return h > 0.93 ? face * 0.9 : face;
    }
    case 'smooth': {
      // clay: smooth, with a few short zigzag cracks
      const ci = Math.floor(X / 14), ri = Math.floor(Y / 8);
      if (hash2(ci * 5 + seed, ri * 3) > 0.5) {
        const yy = Math.floor(Y), r0 = ri * 8 + 1, r1 = r0 + 3 + Math.floor(hash2(ci, ri + 3) * 3);
        if (yy >= r0 && yy < r1) {
          let cx = ci * 14 + 3 + Math.floor(hash2(ci, ri + 7) * 8);
          for (let q = r0; q <= yy; q++) { const hh = hash2(q, ci * 13 + seed); cx += hh < 0.3 ? -1 : hh > 0.7 ? 1 : 0; }
          if (X >= cx && X < cx + (res < 1 ? 0.67 : 1)) return 0.66;
        }
      }
      return 1;
    }
    case 'coal': {
      const qx = Math.floor(X / gs), qy = Math.floor(Y / gs);
      if (hash2(qx * 5 + seed, qy * 3) > 0.976) return -1;
      if ((qx + (qy >> 2)) % 9 === 0) return 0.84;      // cleat joints
      return 1;
    }
    case 'lam': {
      // shale: thin laminae every 3 px, slightly wavy
      const yw = Y + 0.9 * Math.sin(X * 0.13 + seed);
      const ph = ((yw % 3) + 3) % 3;
      if (ph < (res < 1 ? 0.67 : 1)) return 0.8;
      if (ph >= 1.5 && ph < 1.5 + (res < 1 ? 0.67 : 1)) return 1.07;
      return 1;
    }
    case 'soil': {
      const h = hash2(Math.floor(X / gs) * 7 + seed, Math.floor(Y / gs) * 5);
      return h > 0.84 ? 0.8 : h < 0.1 ? 1.16 : 1;
    }
    default: return 1;
  }
}

// ---------- inclusions: small sprites, 1 sprite px = 1 world px (like the creatures) ----------
type InclKind = 'ammonite' | 'shell' | 'bone' | 'pebble' | 'amber' | 'root';
type Spr = { rows: string[]; pal: Record<string, number[]> };
const SPRITES: Record<Exclude<InclKind, 'root'>, Spr> = {
  ammonite: {
    rows: ['..ooo..', '.oLLLo.', 'oLdddLo', 'oLdLdLo', 'oLLdLLo', '.oLLLo.', '..ooo..'],
    pal: { o: [96, 82, 64], L: [222, 204, 166], d: [138, 114, 84] },
  },
  shell: {
    rows: ['..o..', '.oLo.', 'oLlLo', 'LlLlL', 'ooooo'],
    pal: { o: [120, 104, 84], L: [236, 226, 200], l: [190, 174, 146] },
  },
  bone: {
    rows: ['LL...LL', '.LlllL.', 'LL...LL'],
    pal: { L: [234, 228, 208], l: [198, 190, 168] },
  },
  pebble: {
    rows: ['.hb.', 'hbbd', '.dd.'],
    pal: { h: [178, 168, 150], b: [128, 118, 104], d: [74, 66, 58] },
  },
  amber: {
    rows: ['.a.', 'aAa', '.a.'],
    pal: { a: [204, 112, 30], A: [255, 204, 96] },
  },
};
type Incl = { kind: InclKind; x: number; f: number; w: number; ax: number; ay: number };

const INCL_BY_FAM = (fam: Fam, era: number): InclKind[] => {
  switch (fam) {
    case 'block': return era >= 2 ? ['ammonite', 'shell', 'ammonite'] : ['shell', 'pebble'];
    case 'lam': return era >= 2 ? ['ammonite', 'pebble'] : ['pebble'];
    case 'grain': return era >= 4 ? ['bone', 'shell', 'pebble'] : era >= 2 ? ['shell', 'pebble'] : ['pebble'];
    case 'smooth': return era >= 4 ? ['bone', 'shell'] : era >= 2 ? ['shell', 'pebble'] : ['pebble'];
    case 'soil': return era >= 4 ? ['root', 'bone', 'root'] : era >= 3 ? ['root', 'pebble'] : ['pebble'];
    case 'coal': return era >= 3 ? ['amber', 'amber', 'pebble'] : ['pebble'];
    default: return ['pebble'];
  }
};

interface Layer {
  kTop: number; kBot: number;  // bin indices of the top and bottom boundaries (kTop < kBot)
  mat: number; k: number;
  fam: Fam; era: number;
  belt: number[] | null;       // a belt of an epoch: thin runs merged, drawn as stripes of these materials
  bed: boolean;                // a bed of the same rock as the layer above: only a faint parting line
  tone: number; warm: number;  // brightness factor and warm shift against the neighbours
  tex: SkinPixels | null; own: boolean; tinted: boolean;
  ox: number; oy: number; seed: number;
  top: Int16Array;             // screen row of the layer's top edge per column
  anchor: Int16Array;          // texture anchor (the edge without its wave), per column pair
  inc: Incl[];
}

function scale(c: number, f: number, warm: number, cold: number, hue: number): number {
  let r = (c & 255) * f, g = ((c >> 8) & 255) * f, b = ((c >> 16) & 255) * f;
  if (warm) { r *= 1 + 0.07 * warm; g *= 1 + 0.02 * warm; b *= 1 - 0.07 * warm; }
  r *= 1 - 0.16 * cold + hue; g *= 1 - 0.07 * cold; b *= 1 + 0.05 * cold - hue;
  return (255 << 24) | ((b > 255 ? 255 : b < 0 ? 0 : b) << 16) | ((g > 255 ? 255 : g < 0 ? 0 : g) << 8) | (r > 255 ? 255 : r < 0 ? 0 : r);
}

const ease = (t: number) => t * t * (3 - 2 * t);

export class SectionRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  buf: Uint32Array;
  fossils: FossilMark[] = [];
  zones: ZoneMark[] = [];
  glowPts: number[] = [];
  /** coal glints and amber sparks that twinkle (x, y pairs) */
  sparks: number[] = [];
  horizonTop = new Float32Array(WW);
  /** row where the cut begins in each column (it follows the relief of the surface) */
  topD = new Int16Array(WW);
  /** ground height per column from the renderer, so the cut's top edge follows the land */
  relief: Float32Array | null = null;
  foundationPx = 0;
  strataH = 0;                       // the lowest strata row (from the section top)
  layers: Layer[] = [];
  /** horizon rows on screen (fewer in the history ribbon) */
  hr = HR;
  /** width of the section itself; the era ruler stands to its right */
  SW = WW;
  /** first row of the history ribbon (Infinity when the drawer is closed) */
  cut = Infinity;
  /** epoch spans on screen (middle column), youngest first */
  eras: EraSpan[] = [];
  /** the epoch zoomed in from the ruler (-1: none) and how far the zoom has gone (0..1) */
  focusEra = -1;
  focusT = 0;
  private strataBot = new Int16Array(WW);
  private bG = new Float64Array(NB + 1);
  private VS = new Float32Array((NB + 1) * WW);   // smoothed visual depth per bin per column
  private YG = new Float32Array((NB + 1) * WW);   // its screen row
  private Dt = 0;
  private Hs = 0;
  private sH = 1;
  private MIDL = PAL_RGB.map((pal) => { const c = pal[Math.min(2, pal.length - 1)]; return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; });
  private glint = false;
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

  /** Zoom to an epoch (from the ruler); -1 lets go. */
  focus(era: number): void { this.focusEra = era; }

  maybeRender(g: Game, lay: Layout, now: number, revealY = Infinity, dt = 0): boolean {
    // the zoom eases in and out; while it moves the section is redrawn every frame
    const want = this.focusEra >= 0 ? 1 : 0;
    const moving = Math.abs(want - this.focusT) > 1e-3;
    if (moving) this.focusT += Math.sign(want - this.focusT) * Math.min(Math.abs(want - this.focusT), dt * 2.2);
    if (!moving && lay.version === this.lastLayout && now - this.lastRender < 100 && revealY === Infinity) return false;
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
    if (y >= this.horizonTop[xi] + this.hr) return { kind: 'bedrock' };
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

  /** The layer drawn at section-local (x, y), with its index (null outside the strata or in the ribbon). */
  layerAt(x: number, y: number): { L: Layer; j: number } | null {
    const xi = Math.max(0, Math.min(WW - 1, Math.floor(x)));
    if (y < this.topD[xi] || y >= this.strataBot[xi] || y >= this.cut || xi >= this.SW) return null;
    const ls = this.layers;
    let j = 0;
    while (j < ls.length - 1 && y >= ls[j + 1].top[xi]) j++;
    return ls[j] ? { L: ls[j], j } : null;
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

  /** Zoom into an epoch: its span grows to at least ~60% of the strata, the rest gives way (per column). */
  private applyFocus(g: Game, t: number): void {
    const e = this.focusEra;
    if (e < 0 || e > g.run.era || t <= 0) return;
    const YG = this.YG;
    const k = ease(t);
    const yTop = new Float32Array(WW), yBot = new Float32Array(WW);
    for (let x = 0; x < WW; x++) {
      yTop[x] = e >= g.run.era ? this.topD[x] : this.yAt(x, CFG.eras[e + 1].start);
      yBot[x] = e === 0 ? YG[NB * WW + x] : this.yAt(x, CFG.eras[e].start);
    }
    for (let x = 0; x < WW; x++) {
      const y0 = this.topD[x], y1 = YG[NB * WW + x];
      const a0 = yTop[x], b0 = yBot[x], seg = b0 - a0, tot = y1 - y0;
      if (seg < 0.5 || tot < 4) continue;
      const S = Math.max(seg, tot * 0.6);
      const a = y0 + ((a0 - y0) * (tot - S)) / Math.max(1e-6, tot - seg), b = a + S;
      for (let kk = 0; kk <= NB; kk++) {
        const y = YG[kk * WW + x];
        const m = y < a0 ? y0 + ((y - y0) * (a - y0)) / Math.max(1e-6, a0 - y0)
          : y < b0 ? a + ((y - a0) * S) / seg
            : b + ((y - b0) * (y1 - b)) / Math.max(1e-6, y1 - b0);
        YG[kk * WW + x] = y + (m - y) * k;
      }
    }
  }

  // ---------- layers ----------
  private buildLayers(g: Game, hist: Float32Array, cnt: Float32Array): void {
    const YG = this.YG;
    const SW = this.SW;
    const avgY = (k: number) => { let s = 0, n = 0; for (let x = 0; x < SW; x += 6) { s += YG[k * WW + x]; n++; } return s / n; };
    const dom = (k0: number, k1: number) => {
      let best = -1, bm = M.soil;
      for (let m = 0; m < NMAT; m++) { let s = 0; for (let k = k0 + 1; k <= k1; k++) s += hist[k * NMAT + m]; if (s > best) { best = s; bm = m; } }
      return bm;
    };
    const eraOfRun = (r: { k0: number; k1: number }) => eraOfYear((this.bG[r.k0] + this.bG[r.k1]) / 2);
    // 1) runs of bins with the same dominant material
    type Run = { k0: number; k1: number; mat: number; merged: boolean; bed: boolean };
    let runs: Run[] = [];
    for (let k = 1; k <= NB; k++) {
      let best = 0, bm = -1;
      for (let m = 0; m < NMAT; m++) { const v = hist[k * NMAT + m]; if (v > best) { best = v; bm = m; } }
      const last = runs[runs.length - 1];
      if (bm < 0 || (last && last.mat === bm)) { if (last) last.k1 = k; else runs.push({ k0: 0, k1: k, mat: M.dust, merged: false, bed: false }); continue; }
      runs.push({ k0: last ? last.k1 : 0, k1: k, mat: bm, merged: false, bed: false });
    }
    // 2) runs thinner than MIN_PX join a neighbour: the same rock first, then the same epoch, then the thinner one
    const px = (r: Run) => avgY(r.k1) - avgY(r.k0);
    for (let guard = 0; guard < 600 && runs.length > 1; guard++) {
      let wi = -1, wpx = MIN_PX;
      for (let i = 0; i < runs.length; i++) { const p = px(runs[i]); if (p < wpx) { wpx = p; wi = i; } }
      if (wi < 0) break;
      const r = runs[wi], a = runs[wi - 1], b = runs[wi + 1];
      const er = eraOfRun(r);
      const into = !a ? wi + 1 : !b ? wi - 1
        : a.mat === r.mat ? wi - 1 : b.mat === r.mat ? wi + 1
          : eraOfRun(a) === er && eraOfRun(b) !== er ? wi - 1 : eraOfRun(b) === er && eraOfRun(a) !== er ? wi + 1
            : px(a) < px(b) ? wi - 1 : wi + 1;
      const lo = Math.min(wi, into), hi = Math.max(wi, into);
      const merged: Run = { k0: runs[lo].k0, k1: runs[hi].k1, mat: 0, merged: runs[lo].merged || runs[hi].merged || runs[lo].mat !== runs[hi].mat, bed: false };
      merged.mat = dom(merged.k0, merged.k1);
      runs.splice(lo, 2, merged);
    }
    // 3) thick layers split into beds of ~20 px (the same rock: only a faint parting between them)
    const out: Run[] = [];
    for (const r of runs) {
      const p = px(r);
      const n = p > BED_PX ? Math.min(4, Math.round(p / 20)) : 1;
      if (n <= 1) { out.push(r); continue; }
      let k0 = r.k0;
      const y0 = avgY(r.k0);
      for (let s = 1; s <= n; s++) {
        let k1 = r.k1;
        if (s < n) {
          const target = y0 + (p * s) / n + (hash2(r.k0 + s, 33) - 0.5) * 4;
          k1 = k0 + 1;
          while (k1 < r.k1 - 1 && avgY(k1) < target) k1++;
        }
        if (k1 > k0) out.push({ k0, k1, mat: r.mat, merged: r.merged, bed: s > 1 });
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
    let prevL = -1, prevLight = false, prevTone = 1;
    runs.forEach((r) => {
      let c = 0, wsum = 0;
      for (let k = r.k0 + 1; k <= r.k1; k++) { let s = 0; for (let m = 0; m < NMAT; m++) s += hist[k * NMAT + m]; wsum += s; c += cnt[k]; }
      const kAvg = wsum > 0 ? Math.max(1, c / wsum) : 1;
      const id = CFG.materials[r.mat].id;
      const own = EMISSIVE[r.mat] ? null : skinPixels(`world/tex/${id}.png`);
      let tex = own ?? (TEX_ALIAS[id] ? skinPixels(`world/tex/${TEX_ALIAS[id]}.png`) : null);
      let tinted = !own && !!tex;
      if (kAvg >= K && texCompacted && famOf(r.mat) === 'plain') { tex = texCompacted; tinted = true; }
      // a belt of an epoch: what was merged and is not one rock any more
      let belt: number[] | null = null;
      if (r.merged) {
        const sums: [number, number][] = [];
        let tot = 0;
        for (let m = 0; m < NMAT; m++) { let s = 0; for (let k = r.k0 + 1; k <= r.k1; k++) s += hist[k * NMAT + m]; if (s > 0) { sums.push([m, s]); tot += s; } }
        sums.sort((p, q) => q[1] - p[1]);
        const mats = sums.filter(([, s]) => s / Math.max(1e-9, tot) > 0.15).slice(0, 3).map(([m]) => m);
        // one rock still dominates: it stays that rock; only a real mix becomes a striped belt
        if (mats.length > 1 && sums[0][1] / Math.max(1e-9, tot) < 0.62) belt = mats;
      }
      // brightness against the layer above: clearly apart (≥ 22%), alternating light — dark; beds only a little
      const depthK = 1 - 0.35 * Math.min(1, avgY(r.k0) / Math.max(1, this.Hs));
      const L = lum(r.mat) * depthK;
      let tone = 1, warm = 0;
      if (r.bed && prevL > 0) tone = prevTone * (prevLight ? 0.93 : 1.06);
      else if (prevL > 0) {
        const ratio = L / prevL;
        if (Math.abs(1 - ratio) < 0.22) {
          if (prevLight) tone = (prevL * 0.76) / L;
          else { tone = (prevL * 1.26) / L; warm = 1; }
        }
      }
      tone = Math.max(0.58, Math.min(1.5, tone));
      if (!r.bed) prevLight = L * tone > prevL;
      prevL = L * tone;
      prevTone = tone;
      const seed = (hash2(r.mat * 31 + Math.floor(this.bG[r.k0] / 97), 11) * 1e6) | 0;
      const era = eraOfRun(r);
      const fam = famOf(r.mat);
      const layer: Layer = {
        kTop: r.k0, kBot: r.k1, mat: r.mat, k: kAvg, fam, era, belt, bed: r.bed, tone, warm, tex, own: !!own, tinted,
        ox: seed % 64, oy: (seed >> 6) % 64, seed, top: new Int16Array(WW), anchor: new Int16Array(WW), inc: [],
      };
      // inclusions as eye anchors: 1–3 per layer, only where the layer is thick enough
      const th = px(r);
      const nInc = th < 9 ? 0 : belt ? (th >= 12 ? 1 : 0) : th < 16 ? 1 : th < 26 ? (hash2(seed, 5) < 0.5 ? 1 : 2) : 2 + (hash2(seed, 6) < 0.4 ? 1 : 0);
      const kinds = INCL_BY_FAM(fam, era);
      for (let q = 0; q < nInc; q++) {
        const kind = kinds[Math.floor(hash2(seed, 70 + q) * kinds.length)];
        const x = Math.round(((q + 0.5) / nInc) * (SW - 20) + 10 + (hash2(seed, 20 + q) - 0.5) * (SW / nInc) * 0.6);
        layer.inc.push({ kind, x, f: 0.3 + hash2(seed, 40 + q) * 0.4, w: 6 + Math.floor(hash2(seed, 60 + q) * 10), ax: -1, ay: -1 });
      }
      this.layers.push(layer);
    });
    // 5) boundaries per column: the smoothed depth, a soft wave of ±2–3 px, a fault where the earth shook; never crossing
    const faults = g.run.faults.map((f) => ({
      x0: f.x * WW, b: f.b, up: f.up,
      thr: Math.min(6, 2 + f.lift * 0.15), amp: Math.min(4, f.amp * 0.35), lam: Math.max(30, f.lam * WW),
    }));
    for (let j = 0; j < this.layers.length; j++) {
      const L = this.layers[j];
      const bTop = this.bG[L.kTop];
      for (let x = 0; x < WW; x++) {
        let y = YG[L.kTop * WW + x];
        L.anchor[x] = Math.round(YG[L.kTop * WW + (x & ~1)]);
        if (j > 0) {
          y += (low(LOW_B, x * 2 + j * 37, j * 53) - 0.5) * 5 + (low(LOW_A, x * 5 + j * 11, j * 29) - 0.5) * 2;
          for (const f of faults) {
            if (bTop > f.b) continue;          // younger than the quake: it lies over the fault undisturbed
            const dx = x - f.x0;
            const side = f.up > 0 ? dx > 0 : dx < 0;
            y += (side ? -f.thr * Math.min(1, Math.abs(dx) / 2) : 0) + f.amp * Math.sin((2 * Math.PI * dx) / f.lam) * Math.exp(-Math.abs(dx) / 70);
          }
        }
        let yi = Math.round(y);
        if (j === 0) yi = this.topD[x];
        else yi = Math.max(this.layers[j - 1].top[x] + 2, yi);
        L.top[x] = Math.min(this.strataBot[x], yi);
      }
    }
  }

  /** The drawer is open: rows from `cut` down fold into a ribbon with one stripe per epoch and the thing at its bottom. */
  private applyFold(g: Game, Hv: number, Hg: number): void {
    const rib = Math.max(3, Math.min(RIB_MAX, Math.round(Hg - Hv)));
    const cut = Hv - rib;
    this.cut = cut;
    const hrF = rib >= 10 ? 3 : rib >= 6 ? 2 : 1;
    const bedF = rib >= 8 ? 1 : 0;
    const s0 = cut + 1, s1 = Hv - hrF - bedF;      // stripes
    this.hr = hrF;
    const YG = this.YG;
    const knots: number[] = [];
    for (let x = 0; x < WW; x++) {
      const bot = this.strataBot[x];
      knots.length = 0;
      knots.push(cut);
      for (let e = g.run.era; e >= 1; e--) {
        const y = this.yAt(x, CFG.eras[e].start);
        if (y > knots[knots.length - 1] + 0.01 && y < bot - 0.01) knots.push(y);
      }
      knots.push(Math.max(bot, knots[knots.length - 1] + 0.01));
      const nSeg = knots.length - 1;
      const slot = Math.max(0, s1 - s0) / nSeg;
      const map = (y: number) => {
        if (y <= cut) return y;
        if (y >= knots[nSeg]) return s1;
        let i = 0;
        while (i < nSeg - 1 && y >= knots[i + 1]) i++;
        const t = (y - knots[i]) / Math.max(1e-6, knots[i + 1] - knots[i]);
        return s0 + (i + t) * slot;
      };
      for (let k = 0; k <= NB; k++) YG[k * WW + x] = map(YG[k * WW + x]);
      for (const L of this.layers) L.top[x] = Math.round(map(L.top[x]));
      this.strataBot[x] = s1;
      this.horizonTop[x] = s1;
    }
    this.foundationPx = 0;
  }

  // ---------- render ----------
  render(g: Game, lay: Layout, revealY = Infinity): void {
    const H = Math.min(this.canvas.height, lay.sectionH);
    const Hg = Math.max(H, Math.min(this.canvas.height, lay.sectionFullH));
    const buf = this.buf;
    const SW = (this.SW = WW - lay.rulerW);
    const f = g.meta.foundation;
    const fpx = f > 0 ? Math.round(Math.min(10, 2 + Math.sqrt(f))) : 0;
    this.foundationPx = fpx;
    this.hr = HR;
    this.cut = Infinity;
    this.Hs = Math.max(4, Hg - HR - BEDROCK_MIN - fpx - TOPMAX);
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
    this.applyFocus(g, this.focusT);
    let sH = 0;
    for (let x = 0; x < WW; x++) {
      this.strataBot[x] = Math.round(this.YG[NB * WW + x]);
      sH = Math.max(sH, this.strataBot[x]);
      this.horizonTop[x] = this.strataBot[x] + fpx;
    }
    this.strataH = sH;
    this.sH = Math.max(1, sH);
    this.buildLayers(g, hist, cnt);
    if (H < Hg - 0.5) this.applyFold(g, H, Hg);
    // epoch spans in the middle column, for the ruler
    this.eras = [];
    for (let e = g.run.era; e >= 0; e--) {
      const y0 = e >= g.run.era ? this.topD[WW >> 1] : this.yAt(WW >> 1, CFG.eras[e + 1].start);
      const y1 = e === 0 ? this.strataBot[WW >> 1] : this.yAt(WW >> 1, CFG.eras[e].start);
      this.eras.push({ era: e, y0, y1: Math.max(y0, y1) });
    }
    this.fossils.length = 0;
    this.glowPts.length = 0;
    this.sparks.length = 0;
    const targets = g.run.targets;
    this.zones = targets.map((t) => ({ kind: t.kind, pts: [] as number[] }));
    const texBedrock = skinPixels('world/tex/bedrock.png');
    const texTechno = skinPixels('world/tex/technogenic.png');
    const texCompacted = skinPixels('world/tex/compacted.png');
    const layers = this.layers;
    const cut = this.cut, hr = this.hr;

    for (let x = 0; x < WW; x++) {
      if (x >= SW) { this.paintRulerStrip(x, H); continue; }
      const top0 = this.topD[x], bot = this.strataBot[x], hTop = this.horizonTop[x];
      for (let y = 0; y < top0 && y < H; y++) buf[y * WW + x] = 0;   // above the cut: the ground plane shows
      // strata
      let j = 0;
      for (let y = top0; y < bot && y < H; y++) {
        const o = y * WW + x;
        if (y >= cut) { buf[o] = this.ribbonPx(x, y); continue; }
        while (j < layers.length - 1 && y >= layers[j + 1].top[x]) j++;
        const L = layers[j];
        if (!L) { buf[o] = FOUND[1]; continue; }
        if (y > revealY) { buf[o] = FOUND[(hash2(x, y) * 2) | 0]; continue; }
        this.glint = false;
        let c = this.strataPx(L, j, x, y, 1);
        if (this.glint && this.sparks.length < 80) this.sparks.push(x, y);
        if (targets.length) c = this.tint(g, c, x, this.bAt(x, y), y);
        buf[o] = c;
      }
      // foundation (with the glowing lines of past epochs), horizon, bedrock — always, also during a reveal
      for (let y = Math.max(bot, top0); y < H; y++) {
        const o = y * WW + x;
        if (y < hTop) {
          const n = NOISE[((y * 7) & 255) * 256 + ((x * 7) & 255)];
          let c = texCompacted ? shadePx(texAt(texCompacted, x >> 1, y >> 1), 1, [52, 46, 66], lumOf(texCompacted)) : FOUND[Math.min(3, (n * 4) | 0)];
          if (((y - bot) % 2) === 0) c = scale(c, 0.85, 0, 0, 0);
          for (const lv of g.meta.foundationLines) if (Math.round(hTop - (lv / Math.max(f, 1e-6)) * fpx) === y) c = EPOCH;
          buf[o] = c;
        } else if (y < hTop + hr) {
          const r = y - hTop;
          const rr = Math.min(HR - 1, Math.floor(((r + 0.5) * HR) / hr));
          buf[o] = texTechno ? texAt(texTechno, x, Math.floor(((rr + 0.5) * texTechno.h) / HR)) | 0xff000000 : HORIZON32[x * HR + rr];
          if (hash2(x, r + 50) < g.glow[x] * 0.12) this.glowPts.push(x, y);
        } else {
          const ny = y - hTop - hr;
          const dk = Math.max(0.62, 1 - ny * 0.004);
          if (texBedrock) { buf[o] = scale(texAt(texBedrock, (x >> 1) + 17, ny >> 1), dk * (0.92 + 0.16 * low(LOW_A, x + 90, y)), 0, 0.4, 0); continue; }
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
    if (revealY === Infinity || revealY > sH) { this.paintFaults(g, H); this.paintInclusions(H); }
    this.collectFossils(g, H);
    this.ctx.putImageData(this.img, 0, 0, 0, 0, WW, H);
  }

  /** One pixel of a layer at world (xf, yf); res = size of the output pixel in world px (1 here, 1/3 in the lens). */
  strataPx(L: Layer, j: number, xf: number, yf: number, res: number): number {
    const x = Math.max(0, Math.min(WW - 1, Math.floor(xf)));
    const rel = yf - L.top[x];
    const ra = yf - L.anchor[x];
    let m = L.mat;
    let c: number, norm = 1;
    const tps = 0.5;                                // texels per world px: 2×2 blocks (the lens magnifies them; its pattern lines stay thin)
    if (L.belt) {
      // a belt of an epoch: thin stripes of what was laid down then, 2–3 px each
      const sy = Math.floor((ra + 1.2 * Math.sin(xf * 0.09 + L.seed)) / 2.5);
      m = L.belt[Math.floor(hash2(sy, L.seed) * L.belt.length)];
      const mid = PAL_RGB[m][Math.min(2, PAL_RGB[m].length - 1)];
      const n = hash2(Math.floor(xf * tps * 2) + L.seed, Math.floor(ra * tps * 2));
      const v = 0.9 + 0.2 * n;
      c = pack32(Math.min(255, mid[0] * v), Math.min(255, mid[1] * v), Math.min(255, mid[2] * v));
    } else if (L.tex) {
      // the painted texture in 2×2 blocks; each layer has its own offset, each tile its own mirror
      const tx = L.tex;
      const tu = Math.floor((xf + L.ox) * tps), tv = Math.floor((ra + L.oy) * tps);
      const bx = Math.floor(tu / tx.w), by = Math.floor(tv / tx.h);
      const v = hash2(bx * 7 + L.seed, by);
      let u = ((tu % tx.w) + tx.w) % tx.w, vv = ((tv % tx.h) + tx.h) % tx.h;
      if (v < 0.5) u = tx.w - 1 - u;
      if (v > 0.25 && v < 0.75) vv = tx.h - 1 - vv;
      c = tx.px[vv * tx.w + u];
      const lm = lumOf(tx);
      const mid = PAL_RGB[m][Math.min(2, PAL_RGB[m].length - 1)];
      if (L.tinted || L.fam === 'smooth') {
        let l = ((c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11) / lm;
        if (L.fam === 'smooth') l = 1 + (l - 1) * 0.45;      // clay is smooth: the texture is calmed down
        if (L.tinted || L.fam === 'smooth') c = pack32(Math.min(255, mid[0] * l), Math.min(255, mid[1] * l), Math.min(255, mid[2] * l));
      } else norm = Math.max(0.6, Math.min(1.6, this.MIDL[m] / lm));
    } else {
      const gs = GRAIN_SCALE[m];
      const qx = Math.floor(xf * tps), qy = Math.floor(yf * tps);
      const n = NOISE[((((qy * 9) / gs) | 0) & 255) * 256 + ((((qx * 9) / gs) | 0) & 255)];
      c = SHADE[m][Math.min(4, (n * SH) | 0)];
    }
    // the rock's own pattern
    const pf = L.belt ? 1 : pattern(L.fam, xf + L.ox, ra + L.oy, res, L.seed & 1023);
    const dep = Math.min(1, yf / this.sH);
    if (pf < 0) { this.glint = true; return scale(GLINT, 1 - 0.3 * dep, 0, dep * 0.5, 0); }
    // depth: darker and colder; soft large noise; the layer's tone; the edge underlined
    const qx = Math.floor(xf / 2) * 2, qy = Math.floor(yf / 2) * 2;
    let fct = norm * pf * L.tone * (1 - 0.36 * dep) * (0.92 + 0.16 * low(LOW_A, qx, qy));
    if (EMISSIVE[m]) fct = 1;
    else if (j > 0) {
      const line = res < 1 ? 0.67 : 1;
      if (rel < line) fct *= L.bed ? 0.86 : 0.62;
      else if (rel < line * 2 && !L.bed) fct *= 0.88;
      else if (rel < line * 3 && !L.bed) fct *= 1.06;              // a lit lip under the line
    }
    return scale(c, fct, L.warm, dep, (low(LOW_B, qx + 50, qy) - 0.5) * 0.06);
  }

  /** The history ribbon: one stripe per epoch, its colour, a crease at the fold. */
  private ribbonPx(x: number, y: number): number {
    const b = this.bAt(x, y + 0.5);
    const e = eraOfYear(b);
    const col = ERA_RGB[e];
    const n = hash2((x >> 1) + e * 31, (y >> 1) + 7);
    let f = 0.6 + 0.06 * n;
    if (y === this.cut) f *= 0.45 + 0.25 * (((x >> 1) & 1));
    else if (y === this.cut + 1) f *= 1.2;
    else if (eraOfYear(this.bAt(x, y - 0.5)) !== e) f *= 0.62;
    return pack32(Math.min(255, col[0] * f), Math.min(255, col[1] * f), Math.min(255, col[2] * f));
  }

  /** The strip at the right where the era ruler stands (the ruler itself is DOM, over it). */
  private paintRulerStrip(x: number, H: number): void {
    const buf = this.buf;
    const edge = x === this.SW, edge2 = x === this.SW + 1;
    for (let y = 0; y < H; y++) {
      const n = hash2(x, y >> 1) * 4;
      buf[y * WW + x] = edge ? pack32(10, 8, 12) : edge2 ? pack32(52, 44, 40) : pack32(22 + n, 18 + n, 24 + n);
    }
  }

  /** A fault line where an earthquake broke the older layers. */
  private paintFaults(g: Game, H: number): void {
    const buf = this.buf;
    for (const f of g.run.faults) {
      const x0 = Math.round(f.x * WW);
      if (x0 < 2 || x0 >= this.SW - 2) continue;
      // the oldest layer younger than the quake ends where the fault begins
      const j0 = this.layers.findIndex((L) => this.bG[L.kTop] <= f.b);
      if (j0 < 0) continue;
      const y0 = this.layers[j0].top[x0];
      const bot = Math.min(this.strataBot[x0], this.cut, H);
      for (let y = y0; y < bot; y++) {
        const x = x0 + Math.floor((y - y0) / 5) * (f.up > 0 ? 1 : -1);
        if (x < 1 || x >= this.SW - 1) break;
        const o = y * WW + x;
        buf[o] = scale(buf[o], 0.5, 0, 0, 0);
        const side = x + (f.up > 0 ? 1 : -1);
        buf[y * WW + side] = scale(buf[y * WW + side], 1.18, 0, 0, 0);
      }
    }
  }

  /** Inclusions: ammonites, shells, bones, pebbles, amber, roots — 1–3 per layer, sprites in world px. */
  private paintInclusions(H: number): void {
    const buf = this.buf;
    const layers = this.layers;
    const put = (x: number, y: number, c: number) => { if (x >= 0 && x < this.SW && y >= 0 && y < H && y < this.cut) buf[y * WW + x] = c; };
    for (let j = 0; j < layers.length; j++) {
      const L = layers[j];
      const next = layers[j + 1];
      for (const inc of L.inc) {
        inc.ax = -1;
        const x = inc.x;
        if (x < 0 || x >= this.SW) continue;
        const t0 = L.top[x], t1 = next ? next.top[x] : this.strataBot[x];
        const th = t1 - t0;
        if (th < 8 || t1 > this.cut) continue;
        const d = Math.min(1, t0 / this.sH);
        const f = 1 - 0.32 * d;
        if (inc.kind === 'root') {
          // a root from the layer's top: 2 px thick at first, thinning, wandering, a side branch
          const c = scale(pack32(70, 46, 30), f, 0, d, 0), c2 = scale(pack32(96, 66, 42), f, 0, d, 0);
          let xx = x;
          const len = Math.min(th - 2, 5 + (inc.w >> 1));
          for (let yy = t0 + 1; yy < t0 + 1 + len; yy++) {
            put(xx, yy, c);
            if (yy < t0 + 4) put(xx + 1, yy, c2);
            if (hash2(xx, yy) > 0.6) xx += hash2(yy, xx) > 0.5 ? 1 : -1;
            if (yy === t0 + 3) { let bx = xx + 1; for (let q = 0; q < 3; q++) put(bx++, yy + q, c); }
          }
          inc.ax = x; inc.ay = t0 + 1;
          continue;
        }
        const spr = SPRITES[inc.kind];
        const sw = spr.rows[0].length, sh = spr.rows.length;
        const y = Math.round(t0 + 2 + (th - 3 - sh) * inc.f);
        const ax = x - (sw >> 1);
        inc.ax = ax; inc.ay = y;
        for (let r = 0; r < sh; r++) for (let q = 0; q < sw; q++) {
          const p = spr.pal[spr.rows[r][q]];
          if (!p) continue;
          put(ax + q, y + r, scale(pack32(p[0], p[1], p[2]), inc.kind === 'amber' ? 1 : f, 0, inc.kind === 'amber' ? 0 : d, 0));
        }
        if (inc.kind === 'amber' && this.sparks.length < 80) this.sparks.push(ax + 1, y + 1);
      }
    }
  }

  /** Paint a magnified look at section-local (cx, cy) into a square buffer (lens). Returns the layer seen. */
  paintLens(out: Uint32Array, N: number, cx: number, cy: number, Z: number): Layer | null {
    const res = 1 / Z;
    const ls = this.layers;
    for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
      const xf = cx + (u - N / 2) * res, yf = cy + (v - N / 2) * res;
      const x = Math.max(0, Math.min(WW - 1, Math.floor(xf)));
      let c: number;
      if (xf < 0 || xf >= this.SW || yf < this.topD[x] || yf >= this.strataBot[x] || yf >= this.cut) {
        const yi = Math.max(0, Math.min(WH - 1, Math.floor(yf)));
        c = yf < this.topD[x] || xf >= this.SW ? pack32(20, 16, 22) : this.buf[yi * WW + x];
      } else {
        let j = 0;
        while (j < ls.length - 1 && yf >= ls[j + 1].top[x]) j++;
        c = this.strataPx(ls[j], j, xf, yf, res);
      }
      out[v * N + u] = c;
    }
    // the inclusions, magnified with the rock
    for (const L of ls) for (const inc of L.inc) {
      if (inc.ax < 0) continue;
      if (inc.kind === 'root') continue;
      const spr = SPRITES[inc.kind];
      for (let r = 0; r < spr.rows.length; r++) for (let q = 0; q < spr.rows[0].length; q++) {
        const p = spr.pal[spr.rows[r][q]];
        if (!p) continue;
        const u0 = Math.round((inc.ax + q - cx) * Z + N / 2), v0 = Math.round((inc.ay + r - cy) * Z + N / 2);
        for (let dv = 0; dv < Z; dv++) for (let du = 0; du < Z; du++) {
          const uu = u0 + du, vv = v0 + dv;
          if (uu >= 0 && uu < N && vv >= 0 && vv < N) out[vv * N + uu] = pack32(p[0], p[1], p[2]);
        }
      }
    }
    const hit = this.layerAt(cx, cy);
    return hit ? hit.L : null;
  }

  /** Fossils and fragments at their own depth in their own column. */
  private collectFossils(g: Game, H: number): void {
    const w = g.world;
    for (let x = 0; x < this.SW; x++) {
      const base = x * CAP;
      let last = -9;
      for (let i = w.len[x] - 1; i >= 0; i--) {
        const fl = w.flags[base + i];
        if (!(fl & (F_FOSSIL | F_FRAGMENT))) continue;
        const y = Math.round(this.yAt(x, w.birth[base + i]));
        if (y === last || y >= H || y >= this.strataBot[x] || y >= this.cut) continue;
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
      else { const h = 0.22 * Math.min(1, t.heat / 120); r = r * (1 - 0.1 * h) + 70 * h; gg = gg * (1 - 0.1 * h) + 18 * h; b = b * (1 - 0.3 * h); }   // only warmer: the glow is where rock transforms
      if (((x * 7 + y * 3) & 15) === 0) this.zones[ti].pts.push(x, y);
      c = pack32(Math.min(255, r), Math.min(255, gg), Math.min(255, b));
    }
    return c;
  }
}

/** Material id and epoch of a layer (for the lens label). */
export function layerInfo(L: { mat: number; era: number }): { mat: string; era: number } {
  return { mat: CFG.materials[L.mat].id, era: L.era };
}
