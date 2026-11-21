// The section (срез): every pixel of every column is drawn from its material palette with noise + dither.
// Top rows are 1:1, deeper rows are log-compressed; compaction k makes rows thinner and darker.
import { CFG, NMAT, M } from '../config';
import type { Game } from '../core/game';
import { CAP, F_FOSSIL, F_FRAGMENT, F_RARE, F_GLOW } from '../world/World';
import { Layout, PAL_RGB, GRAIN_SCALE, NOISE, GRAIN, WW } from './common';

const DARK_LEVELS = 16;
const SHADES = 5;
/** SHADE[m][d * 5 + s] packed ABGR */
const SHADE: Uint32Array[] = PAL_RGB.map((pal) => {
  const a = new Uint32Array(DARK_LEVELS * SHADES);
  for (let d = 0; d < DARK_LEVELS; d++) {
    const f = 1 - d / (DARK_LEVELS - 1) * 0.62;
    for (let s = 0; s < SHADES; s++) {
      const [r, g, b] = pal[Math.min(s, pal.length - 1)];
      // deeper = darker and a touch more saturated/cooler
      const rr = r * f, gg = g * f, bb = b * (f * 0.96 + 0.04);
      a[d * SHADES + s] = (255 << 24) | (Math.min(255, bb) << 16) | (Math.min(255, gg) << 8) | Math.min(255, rr);
    }
  }
  return a;
});
const EMISSIVE = CFG.materials.map((m) => !!m.emissive);
const BANDED = CFG.materials.map((m) => !!m.banded);
const BASEMENT = [[24, 22, 28], [30, 27, 33], [36, 32, 39], [42, 38, 45], [50, 45, 54]];
const BASEMENT32 = BASEMENT.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);
const RELIC32 = [[90, 84, 96], [120, 96, 60], [70, 90, 96], [140, 120, 80]].map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);

export interface FossilMark { x: number; y: number; species: number; rare: boolean; fragment: boolean }
export interface ZoneMark { kind: string; pts: number[] }

export class SectionRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  buf: Uint32Array;
  fossils: FossilMark[] = [];
  zones: ZoneMark[] = [];
  strataBottom = new Float32Array(WW); // section-local y where strata end per column
  private lastRender = -1;
  private lastLayout = -1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WW;
    this.canvas.height = CFG.B.layout.sectionH;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(WW, this.canvas.height);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  /** Re-render at most ~10 times a second, or at once when the layout changes. */
  maybeRender(g: Game, lay: Layout, now: number, revealY = Infinity): boolean {
    if (lay.version === this.lastLayout && now - this.lastRender < 100 && revealY === Infinity) return false;
    this.render(g, lay, revealY);
    this.lastRender = now;
    this.lastLayout = lay.version;
    return true;
  }

  render(g: Game, lay: Layout, revealY = Infinity): void {
    const w = g.world;
    const H = lay.sectionH;
    const buf = this.buf;
    const vOf = lay.vOf;
    const r = g.run;
    this.fossils.length = 0;
    const targets = r.targets;
    this.zones = targets.map((t) => ({ kind: t.kind, pts: [] as number[] }));
    // pack lookup tables
    const packs = w.packs;
    const pcum: { mats: number[]; cum: number[] }[] = packs.map((pk) => {
      let tot = 0;
      const list: [number, number][] = [];
      for (let m = 0; m < NMAT; m++) if (pk.amt[m] > 0.05) { list.push([m, pk.amt[m]]); tot += pk.amt[m]; }
      list.sort((a, b) => b[1] - a[1]);
      let c = 0;
      return { mats: list.map((l) => l[0]), cum: list.map((l) => (c += l[1] / Math.max(1e-6, tot))) };
    });
    const darkStep = (DARK_LEVELS - 1) / Math.max(1, H);
    const hMax = Math.min(H, this.canvas.height);

    for (let x = 0; x < WW; x++) {
      const base = x * CAP;
      let i = w.len[x] - 1;          // current cell (top first)
      let acc = 0;                    // visual depth at top of current cell
      let p = 0;                      // current pack
      let pAcc = 0;                   // visual depth at top of current pack
      const fold = w.fold[x];
      let cellTopV = 0;
      // advance helpers
      let bottomSet = false;
      let lastFossilI = -1;
      for (let y = 0; y < hMax; y++) {
        const o = y * WW + x;
        if (y > revealY) { buf[o] = 0xff0d0b0e; continue; }
        let v = vOf[y];
        if (fold) v = Math.max(0, v + fold * (v / (v + 30)));
        // walk cells
        while (i >= 0 && acc + 1 / w.k[base + i] <= v) { acc += 1 / w.k[base + i]; i--; }
        const dark = Math.min(DARK_LEVELS - 1, Math.floor(y * darkStep * 0.85));
        if (i >= 0) {
          const j = base + i;
          const m = w.mat[j];
          const k = w.k[j];
          const ser = w.serial[x] - w.len[x] + i;
          // texture rows follow deposition time, so neighbouring columns share laminae
          const tv = (w.birth[j] / 45) | 0;
          const gs = GRAIN_SCALE[m];
          let n: number;
          if (BANDED[m]) n = 0.5 + 0.5 * Math.sin(tv * 1.7 + NOISE[((tv * 3) & 255) * 256 + ((x * 4) & 255)] * 5);
          else n = NOISE[(((tv * 16 / gs) | 0) & 255) * 256 + (((x * 16 / gs) | 0) & 255)] * 0.78 + GRAIN[((ser & 255) << 8) | (x & 255)] * 0.22;
          let s = (n * SHADES + (((x ^ ser) & 1) ? 0.18 : -0.18)) | 0;
          if (s < 0) s = 0; else if (s > 4) s = 4;
          let d = EMISSIVE[m] ? 0 : Math.min(DARK_LEVELS - 1, dark + Math.floor((k - 1) * 0.9));
          const fl = w.flags[j];
          if (fl & (F_FOSSIL | F_FRAGMENT)) {
            if (i !== lastFossilI) {
              lastFossilI = i;
              if (fl & F_FOSSIL) this.fossils.push({ x, y, species: w.spec[j] - 1, rare: !!(fl & F_RARE), fragment: false });
              else if ((x + i) % 2 === 0) this.fossils.push({ x, y, species: w.spec[j] - 1, rare: false, fragment: true });
            }
            s = 4; d = Math.max(0, d - 4);
          }
          if (fl & F_GLOW) d = 0;
          let c = SHADE[m][d * SHADES + s];
          if (targets.length) c = this.tintTargets(g, c, x, w.birth[j], y);
          buf[o] = c;
          cellTopV = acc;
          continue;
        }
        // packs
        const vp = v - acc;
        while (p < packs.length && pAcc + packs[p].rows / packs[p].k <= vp) { pAcc += packs[p].rows / packs[p].k; p++; }
        if (p < packs.length) {
          const pk = packs[p];
          const t = pcum[p];
          const frac = (vp - pAcc) / (pk.rows / pk.k);
          const row = (frac * pk.rows) | 0;
          const u = NOISE[(((pk.serial * 37 + row * 2) & 255) << 8) | ((x * 3 + pk.serial * 11) & 255)];
          let m = t.mats.length ? t.mats[t.mats.length - 1] : M.silt;
          for (let q = 0; q < t.cum.length; q++) if (u <= t.cum[q]) { m = t.mats[q]; break; }
          const n2 = GRAIN[(((row * 7 + pk.serial) & 255) << 8) | (x & 255)];
          const s = Math.min(4, (n2 * 5) | 0);
          const d = EMISSIVE[m] ? 0 : Math.min(DARK_LEVELS - 1, dark + Math.floor((pk.k - 1) * 0.9));
          let c = SHADE[m][d * SHADES + s];
          if (targets.length) c = this.tintTargets(g, c, x, pk.ageMax - (pk.ageMax - pk.ageMin) * frac, y);
          buf[o] = c;
          continue;
        }
        // below the strata: the ground of the old world
        if (!bottomSet) { this.strataBottom[x] = y; bottomSet = true; }
        // faint, tilted strata of the world before, with rare relic flecks
        const yy = y + ((x * 0.08) | 0);
        const band = NOISE[((yy * 2) & 255) * 256 + ((x >> 3) & 255)];
        const n3 = NOISE[((y * 5) & 255) * 256 + ((x * 5) & 255)] * 0.6 + band * 0.4;
        const bs = Math.min(4, (n3 * 4.5 + (((x + y) & 1) ? 0.2 : 0)) | 0);
        const fleck = GRAIN[((y * 3) & 255) * 256 + ((x * 7 + y) & 255)];
        buf[o] = fleck > 0.985 && ((x * 31 + y * 17) % 7 === 0) ? RELIC32[(x + y) % RELIC32.length] : BASEMENT32[bs];
      }
      if (!bottomSet) this.strataBottom[x] = hMax;
      // pack finds (fossils folded into deep packs)
      void cellTopV;
    }
    // fossil marks inside packs
    let pv = 0;
    let avgCellV = 0;
    for (let x = 0; x < WW; x += 9) avgCellV += w.len[x];
    avgCellV /= Math.ceil(WW / 9);
    pv = avgCellV;
    for (const pk of packs) {
      const thick = pk.rows / pk.k;
      for (const f of pk.finds) {
        const y = Math.round(lay.vToY(pv + thick * (1 - f.f)));
        if (y >= 0 && y < hMax && this.fossils.length < 400) this.fossils.push({ x: f.x, y, species: f.species, rare: f.rare, fragment: false });
      }
      pv += thick;
      if (pv > lay.vMax) break;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  private tintTargets(g: Game, c: number, x: number, birth: number, y: number): number {
    const ts = g.run.targets;
    for (let ti = 0; ti < ts.length; ti++) {
      const t = ts[ti];
      if (x < t.x0 || x > t.x1 || birth < t.b0 || birth > t.b1) continue;
      let r = c & 255, gg = (c >> 8) & 255, b = (c >> 16) & 255;
      if (t.kind === 'water') { r = r * 0.7 + 20; gg = gg * 0.75 + 45; b = b * 0.7 + 85; }
      else { const h = Math.min(1, t.heat / 120); r = r * (1 - 0.3 * h) + 140 * h; gg = gg * (1 - 0.25 * h) + 40 * h; b = b * (1 - 0.35 * h); }
      if (((x * 7 + y * 3) & 15) === 0) this.zones[ti].pts.push(x, y);
      c = (255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, gg) << 8) | Math.min(255, r);
    }
    return c;
  }
}
