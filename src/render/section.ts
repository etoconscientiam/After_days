// The section (срез): the particles of the strata, drawn as they lie. Every particle is a 2×2 block with its own
// look from birth (a shade and, for loose ones, an accent pixel); rock is drawn smoother than loose sediment. The
// renderer decides nothing: no binning, no merging, no memory of past frames — a particle's colour changes only when
// the simulation changes its material (a transformation, a marker bed). Under the strata: the technogenic horizon
// where the thing lies, the foundation of past epochs, the bedrock.
//
// Coordinates: «section-local» y = world y − layout.sectionTop, as before (the rest of the game adds
// lay.sectionTop). The grid sits at a fixed place in the world: local y of grid row r = 2r − BASE; when the drawer
// lifts the world, lay.sectionTop moves and the grid moves with it.
import { CFG, eraOfYear } from '../config';
import type { Game } from '../core/game';
import { GW, GH, KIND, K_NONE, K_ROCK, K_SOLID, K_MARKER, P_FOSSIL, P_FRAGMENT, P_RARE } from '../world/Grid';
import { Layout, PAL_RGB, WW, WH } from './common';
import { hash2 } from '../core/rng';

const BASE = CFG.B.layout.sectionTop;
const HR = 6; // rows of the technogenic horizon (the thing lies in it)
const pack32 = (r: number, g: number, b: number) => (255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);

/** Epoch colours: the era ruler, the history ribbon, the belts. */
export const ERA_COLORS = ['#8a7f9a', '#5aa58a', '#4d8fc4', '#78b454', '#c99a4a', '#c4703c', '#e0a43a', '#f2d58a'];

export interface ZoneMark { kind: string; pts: number[] }
/** A fossil or a fragment in the strata (section-local), drawn as a small sprite by the renderer. */
export interface FossilMark { x: number; y: number; species: number; rare: boolean; fragment: boolean }
/** What lies at a point of the section. */
export type Loc =
  | { kind: 'particle'; i: number; x: number; y: number; depth: number }
  | { kind: 'archive' }
  | { kind: 'horizon' } | { kind: 'foundation' } | { kind: 'bedrock' } | { kind: 'none' };
/** One epoch's span on screen (section-local rows, middle column), for the era ruler. */
export interface EraSpan { era: number; y0: number; y1: number }

// per material: two close main shades, two accents (darker, lighter)
const MAIN0 = PAL_RGB.map((p) => pack32(...(p[Math.min(1, p.length - 1)] as [number, number, number])));
const MAIN1 = PAL_RGB.map((p) => pack32(...(p[Math.min(2, p.length - 1)] as [number, number, number])));
const ACC0 = PAL_RGB.map((p) => pack32(...(p[0] as [number, number, number])));
const ACC1 = PAL_RGB.map((p) => pack32(...(p[Math.min(3, p.length - 1)] as [number, number, number])));
const GLINTY = CFG.materials.map((m) => !!m.glint);
/** Bedrock: dark grey-blue, coarse, never pure black; the foundation of past epochs darker still. */
const BEDROCK = [[38, 42, 54], [46, 50, 63], [54, 58, 72], [62, 67, 82]].map(([r, g, b]) => pack32(r, g, b));
const FOUND = [[22, 18, 26], [28, 24, 34], [34, 30, 42], [40, 36, 50]].map(([r, g, b]) => pack32(r, g, b));
const EPOCH = pack32(242, 181, 74);

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

/** The four pixels of a particle's 2×2 block. */
function particlePx(m: number, look: number, out: number[]): void {
  const k = KIND[m];
  const main = look & 1 ? MAIN1[m] : MAIN0[m];
  out[0] = out[1] = out[2] = out[3] = main;
  // rock is compacted: one even tone; loose grains and beds get a darker or lighter grain in one corner
  if (k !== K_ROCK && (look & 0x40)) out[(look >> 2) & 3] = (look >> 4) & 1 ? ACC1[m] : ACC0[m];
}

export class SectionRenderer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private buf: Uint32Array;
  /** section-local row of the strata top per world column */
  topD = new Int16Array(WW);
  /** section-local row of the technogenic horizon (the thing lies in it) per world column */
  horizonTop = new Float32Array(WW);
  hr = HR;
  /** the lowest strata row (section-local) */
  strataH = 0;
  /** width of the section itself; the era ruler stands to its right */
  SW = WW;
  /** first row of the history ribbon above an open drawer (Infinity: none yet) */
  cut = Infinity;
  /** epoch spans on screen (middle column), youngest first */
  eras: EraSpan[] = [];
  /** the epoch picked on the ruler (-1: none) */
  focusEra = -1;
  /** points of the heat and water zones (section-local x, y pairs), for the Geologist and the light */
  zones: ZoneMark[] = [];
  /** points where the horizon glows around the thing (section-local x, y pairs) */
  glowPts: number[] = [];
  /** coal glints and amber sparks that twinkle (section-local x, y pairs) */
  sparks: number[] = [];
  /** fossils and fragments in the strata */
  fossils: FossilMark[] = [];
  /** kept for the renderer's interface (the ground line is the particles' top now) */
  relief: Float32Array | null = null;
  /** (kept for the debug panel and the Geologist: layers are not drawn as such any more) */
  layers: unknown[] = [];
  private lastVersion = -1;
  private lastLayout = -1;
  private lastRender = -1;
  private px = [0, 0, 0, 0];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WW;
    this.canvas.height = WH;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(WW, WH);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  /** Pick an epoch on the ruler; -1 lets go. */
  focus(era: number): void { this.focusEra = era; this.lastVersion = -1; }

  maybeRender(g: Game, lay: Layout, now: number, revealY = Infinity, dt = 0): boolean {
    void dt;
    const v = g.grid.version;
    if (v === this.lastVersion && lay.version === this.lastLayout && now - this.lastRender < 250 && revealY === Infinity) return false;
    this.render(g, lay, revealY);
    this.lastVersion = v;
    this.lastLayout = lay.version;
    this.lastRender = now;
    return true;
  }

  // ---------- coordinates ----------
  /** section-local y of grid row r (top of the row) */
  yOfRow(r: number): number { return r * 2 - BASE; }
  rowOfY(y: number): number { return Math.floor((y + BASE) / 2); }

  /** Screen row (section-local) where particles born in year b lie in world column x. */
  yAt(x: number, b: number): number {
    const grid = this.g?.grid;
    if (!grid) return 0;
    const cx = Math.max(0, Math.min(GW - 1, Math.floor(x / 2)));
    for (let r = grid.surf[cx]; r < grid.floor; r++) {
      const i = r * GW + cx;
      if (grid.mat[i] && KIND[grid.mat[i]] !== K_SOLID && grid.birth[i] <= b) return this.yOfRow(r) + 1;
    }
    return this.strataH;
  }

  /** Birth year at section-local (x, y), the nearest particle of the column. */
  bAt(x: number, y: number): number {
    const grid = this.g?.grid;
    if (!grid) return 0;
    const cx = Math.max(0, Math.min(GW - 1, Math.floor(x / 2)));
    let r = Math.max(grid.surf[cx], Math.min(grid.floor - 1, this.rowOfY(y)));
    while (r < grid.floor && !grid.mat[r * GW + cx]) r++;
    if (r >= grid.floor || KIND[grid.mat[r * GW + cx]] === K_SOLID) return this.g!.run.year;
    return grid.birth[r * GW + cx];
  }

  /** Depth (old rows, 2 per particle) of section-local row y below the strata top of world column x. */
  vOfY(y: number, x = WW / 2): number {
    return Math.max(0, y - this.topD[Math.max(0, Math.min(WW - 1, Math.floor(x)))]);
  }

  /** What lies at section-local (x, y). */
  locateAt(g: Game, x: number, y: number): Loc {
    const grid = g.grid;
    const cx = Math.max(0, Math.min(GW - 1, Math.floor(x / 2)));
    const r = this.rowOfY(y);
    if (r < 0 || r >= GH) return { kind: 'none' };
    if (r >= grid.floor + 3) return { kind: r >= GH - CFG.B.sand.bedRows ? 'bedrock' : 'foundation' };
    if (r >= grid.floor) return { kind: 'horizon' };
    const i = r * GW + cx, m = grid.mat[i];
    if (!m) return { kind: 'none' };
    if (KIND[m] === K_SOLID) return { kind: 'horizon' };
    return { kind: 'particle', i, x: cx, y: r, depth: Math.max(0, r - grid.surf[cx]) };
  }

  /** Birth-year range of the particles in section-local rows y0..y1 of world column x (underground targets). */
  birthRange(y0: number, y1: number, x = WW / 2): [number, number] {
    const grid = this.g?.grid;
    if (!grid) return [0, 0];
    const cx = Math.max(0, Math.min(GW - 1, Math.floor(x / 2)));
    let lo = Infinity, hi = -Infinity;
    for (let r = Math.max(0, this.rowOfY(Math.min(y0, y1))); r <= Math.min(grid.floor - 1, this.rowOfY(Math.max(y0, y1))); r++) {
      const i = r * GW + cx;
      if (!grid.mat[i] || KIND[grid.mat[i]] === K_SOLID) continue;
      lo = Math.min(lo, grid.birth[i]); hi = Math.max(hi, grid.birth[i]);
    }
    if (lo > hi) { const b = this.bAt(x, y0); return [b, b]; }
    return [lo, hi];
  }

  private g: Game | null = null;

  // ---------- drawing ----------
  render(g: Game, lay: Layout, revealY = Infinity): void {
    this.g = g;
    const grid = g.grid, buf = this.buf, px = this.px;
    this.SW = WW - lay.rulerW;
    buf.fill(0);
    const focus = this.focusEra;
    this.sparks.length = 0;
    this.fossils.length = 0;
    const BONE = CFG.matIndex.bone;
    // the strata
    for (let r = 0; r < grid.floor; r++) {
      const yPix = r * 2;
      if (yPix - BASE > revealY) break;
      for (let x = 0; x < GW; x++) {
        const i = r * GW + x, m = grid.mat[i];
        if (!m || KIND[m] === K_NONE) continue;
        if (KIND[m] === K_SOLID) {
          // the thing's cells: the horizon pattern (the renderer draws the thing itself on it)
          for (let d = 0; d < 4; d++) { const xx = x * 2 + (d & 1), yy = yPix + (d >> 1); buf[yy * WW + xx] = HORIZON32[xx * HR + ((yy - (grid.floor * 2 - HR)) % HR + HR) % HR]; }
          continue;
        }
        particlePx(m, grid.look[i], px);
        // an epoch picked on the ruler: its grains stay lit where they lie (folded by heaps and faults), the rest dims
        if (focus >= 0 && eraOfYear(grid.birth[i]) !== focus) { px[0] = shade(px[0], 0.4); px[1] = shade(px[1], 0.4); px[2] = shade(px[2], 0.4); px[3] = shade(px[3], 0.4); }
        const o = yPix * WW + x * 2;
        buf[o] = px[0]; buf[o + 1] = px[1]; buf[o + WW] = px[2]; buf[o + WW + 1] = px[3];
        if (GLINTY[m] && (grid.look[i] & 0x3f) === 7 && this.sparks.length < 160) this.sparks.push(x * 2, yPix - BASE);
        if (m === BONE && (grid.flags[i] & (P_FOSSIL | P_FRAGMENT)) && this.fossils.length < 120) {
          this.fossils.push({ x: x * 2, y: yPix - BASE, species: grid.spec[i] - 1, rare: !!(grid.flags[i] & P_RARE), fragment: !(grid.flags[i] & P_FOSSIL) });
        }
      }
    }
    // the technogenic horizon (the thing lies in it), the foundation of past epochs, the bedrock
    const hTop = grid.floor * 2;
    const bed = (GH - CFG.B.sand.bedRows) * 2;
    const lines = g.meta.foundationLines;
    const fmax = Math.max(1e-6, g.meta.foundation);
    for (let y = hTop; y < WH; y++) {
      if (y - BASE > revealY) break;
      for (let x = 0; x < WW; x++) {
        let c: number;
        if (y < hTop + HR) c = HORIZON32[x * HR + (y - hTop)];
        else if (y < bed) {
          c = FOUND[(hash2(x >> 1, y >> 1) * 4) | 0];
          for (const lv of lines) if (Math.round(hTop + HR + (1 - lv / fmax) * Math.max(0, bed - hTop - HR - 1)) === y) c = EPOCH;
        } else c = BEDROCK[(hash2(x >> 1, (y >> 1) + 7) * 4) | 0];
        buf[y * WW + x] = c;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    // the screen-side tables the rest of the game reads
    for (let x = 0; x < WW; x++) {
      const cx = x >> 1;
      this.topD[x] = this.yOfRow(grid.surf[cx]);
      this.horizonTop[x] = hTop - HR - BASE;
    }
    this.strataH = grid.floor * 2 - BASE;
    this.glowPts.length = 0;
    for (let x = 0; x < WW; x++) if (hash2(x, 41) < g.glow[x] * 0.12) this.glowPts.push(x, hTop + 2 + ((hash2(x, 43) * (HR - 3)) | 0) - BASE);
    this.buildEras(g);
    this.buildZones(g);
  }

  /** Epoch spans down the middle column (away from the thing), youngest first. */
  private buildEras(g: Game): void {
    const grid = g.grid;
    let cx = GW >> 1;
    while (grid.isArtifactCol(cx) && cx > 0) cx--;
    cx = Math.max(0, cx - 4);
    const spans: EraSpan[] = [];
    let cur: EraSpan | null = null;
    for (let r = grid.surf[cx]; r < grid.floor; r++) {
      const i = r * GW + cx;
      if (!grid.mat[i] || KIND[grid.mat[i]] === K_SOLID) continue;
      const e = eraOfYear(grid.birth[i]);
      const y = this.yOfRow(r);
      if (!cur || cur.era !== e) {
        if (cur && e > cur.era) continue;             // a younger grain lower down (a slope): keep the order of epochs
        cur = { era: e, y0: y, y1: y + 2 };
        spans.push(cur);
      } else cur.y1 = y + 2;
    }
    if (!spans.length) spans.push({ era: g.run.era, y0: this.topD[cx * 2], y1: this.strataH });
    // the archive of the depth below: its epochs, oldest last, sized by their (compacted) thickness, compressed
    const arcRows = new Float64Array(CFG.eras.length);
    for (const L of g.archive.layers) arcRows[L.era] += g.archive.meanRows(L) / Math.max(1, L.k);
    let y = this.strataH;
    const last = spans[spans.length - 1];
    for (let e = Math.min(last.era, CFG.eras.length - 1); e >= 0; e--) {
      if (arcRows[e] <= 0) continue;
      const h = Math.min(40, 4 + Math.sqrt(arcRows[e]) * 2);
      if (e === last.era && spans[spans.length - 1] === last) { last.y1 += h; y += h; continue; }
      spans.push({ era: e, y0: y, y1: y + h });
      y += h;
    }
    this.eras = spans;
  }

  /** Sample points of the heat and water zones (the particles whose years and columns they cover). */
  private buildZones(g: Game): void {
    const grid = g.grid;
    this.zones = g.run.targets.map((t) => {
      const pts: number[] = [];
      for (let x = Math.max(0, Math.floor(t.x0 / 2)); x <= Math.min(GW - 1, Math.floor(t.x1 / 2)); x++) {
        for (let r = grid.surf[x]; r < grid.floor; r++) {
          const i = r * GW + x;
          if (!grid.mat[i] || KIND[grid.mat[i]] === K_SOLID) continue;
          const b = grid.birth[i];
          if (b >= t.b0 && b <= t.b1 && ((x * 7 + r * 3) & 7) === 0) pts.push(x * 2 + 1, this.yOfRow(r) + 1);
        }
      }
      return { kind: t.kind, pts };
    });
  }

  /** Paint the lens: N×N pixels around section-local (cx, cy), magnified Z times. Returns what is at its centre. */
  paintLens(out: Uint32Array, N: number, cx: number, cy: number, Z: number): { mat: number; era: number } | null {
    const g = this.g;
    if (!g) return null;
    const grid = g.grid, px = this.px;
    for (let v = 0; v < N; v++) {
      for (let u = 0; u < N; u++) {
        const wx = cx + (u - N / 2) / Z, wy = cy + (v - N / 2) / Z + BASE;
        const x = Math.floor(wx / 2), r = Math.floor(wy / 2);
        let c = pack32(20, 16, 22);
        if (x >= 0 && x < GW && r >= 0 && r < grid.floor) {
          const i = r * GW + x, m = grid.mat[i];
          if (m && KIND[m] !== K_SOLID) {
            particlePx(m, grid.look[i], px);
            c = px[((Math.floor(wy) & 1) << 1) | (Math.floor(wx) & 1)];
            // the grain of the magnified particle: a soft edge between particles
            if (((u * 2) % (Z * 2) === 0 || (v * 2) % (Z * 2) === 0) && KIND[m] !== K_MARKER) c = shade(c, 0.9);
          } else if (m) c = this.buf[Math.max(0, Math.min(WH - 1, Math.floor(wy))) * WW + Math.max(0, Math.min(WW - 1, Math.floor(wx)))];
        } else if (r >= grid.floor && r < GH) c = this.buf[Math.max(0, Math.min(WH - 1, Math.floor(wy))) * WW + Math.max(0, Math.min(WW - 1, Math.floor(wx)))];
        out[v * N + u] = c;
      }
    }
    const x = Math.floor(cx / 2), r = Math.floor((cy + BASE) / 2);
    if (x < 0 || x >= GW || r < 0 || r >= grid.floor) return null;
    const i = r * GW + x;
    if (!grid.mat[i] || KIND[grid.mat[i]] === K_SOLID) return null;
    return { mat: grid.mat[i], era: eraOfYear(grid.birth[i]) };
  }
}

function shade(c: number, f: number): number {
  const r = (c & 255) * f, g = ((c >> 8) & 255) * f, b = ((c >> 16) & 255) * f;
  return pack32(r, g, b);
}
