// Pixel visualisations for the desktop info panel: the planet (what the surface and the air have become), the depth
// column (everything laid down, the visible strata and the archive below the thing), the income chart and the
// composition ring. All drawn small and scaled up pixelated, in the colours of the world.
import { CFG, NMAT } from '../config';
import type { Game } from '../core/game';
import { GW, GH } from '../world/Grid';
import { NS } from '../world/Strata';
import { ERA_COLORS } from '../render/section';

type RGB = [number, number, number];
const hex = (s: string): RGB => { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const WATER = CFG.matIndex.water ?? -1;
const matRGB: RGB[] = CFG.materials.map((m) => hex(((m as { px?: string[] }).px?.[0]) ?? '#000000'));

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** value noise, tiling in x with period px */
function vnoise(x: number, y: number, px: number, s: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(((x0 % px) + px) % px, y0, s), b = hash(((x0 + 1) % px + px) % px, y0, s);
  const c = hash(((x0 % px) + px) % px, y0 + 1, s), d = hash(((x0 + 1) % px + px) % px, y0 + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(lon: number, lat: number, s: number): number {
  let t = 0, amp = 0.5, f = 4;
  for (let o = 0; o < 4; o++) { t += amp * vnoise(lon * f, (lat + 1) * f * 0.5, f, s + o); amp *= 0.5; f *= 2; }
  return t;
}

// ---------------------------------------------------------------- the planet
const TW = 128, TH = 64;
export class Planet {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private land = new Float32Array(TW * TH);
  private wood = new Float32Array(TW * TH);
  private cloud = new Float32Array(TW * TH);
  private sortedLand: Float32Array;
  private sortedWood: Float32Array;
  private tex = new Uint8ClampedArray(TW * TH * 3);
  private texSig = '';
  private rot = 0;

  constructor(private S = 72) {
    this.canvas.width = this.canvas.height = S;
    this.canvas.className = 'pix dv-planet';
    this.ctx = this.canvas.getContext('2d')!;
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const lon = i / TW, lat = (j / TH) * 2 - 1;
      this.land[j * TW + i] = fbm(lon, lat, 11) - Math.abs(lat) * 0.12;
      this.wood[j * TW + i] = fbm(lon, lat, 37);
      this.cloud[j * TW + i] = fbm(lon * 1.0, lat * 1.6, 73);
    }
    this.sortedLand = Float32Array.from(this.land).sort();
    this.sortedWood = Float32Array.from(this.wood).sort();
  }

  /** the surface texture from the game: land share of the zone map, forest cover, the era's ice and barrenness */
  private texture(g: Game): void {
    const z = g.zoneMap;
    let landN = 0;
    for (let i = 0; i < z.length; i++) if (z[i] >= 1) landN++;
    const landK = Math.max(0.08, Math.min(0.85, landN / Math.max(1, z.length)));
    const forest = Math.max(0, Math.min(1, g.forestCover()));
    const era = g.run.era;
    const sig = `${landK.toFixed(2)}|${forest.toFixed(2)}|${era}`;
    if (sig === this.texSig) return;
    this.texSig = sig;
    const lt = this.sortedLand[Math.floor((1 - landK) * (this.sortedLand.length - 1))];
    const wt = this.sortedWood[Math.floor((1 - forest) * (this.sortedWood.length - 1))];
    const deep = hex('#173c66'), shallow = hex('#2f74a4'), sand = hex('#c9b27e');
    const rock = era < 2 ? hex('#7c6650') : hex('#8a7a58'), green = hex('#86a050'), forestC = hex('#3d6e36'), ice = hex('#e4ecef');
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = j * TW + i, lat = Math.abs((j / TH) * 2 - 1), v = this.land[k];
      let c: RGB;
      if (v < lt) c = mix(deep, shallow, Math.max(0, 1 - (lt - v) * 9));
      else if (v < lt + 0.012) c = sand;
      else if (forest > 0.005 && this.wood[k] >= wt && lat < 0.8) c = forestC;
      else c = era >= 3 ? mix(rock, green, Math.min(1, forest * 1.6)) : rock;
      if (lat > 0.86 - (era === 0 ? 0.04 : 0)) c = ice;
      this.tex[k * 3] = c[0]; this.tex[k * 3 + 1] = c[1]; this.tex[k * 3 + 2] = c[2];
    }
  }

  draw(g: Game, dt: number): void {
    this.texture(g);
    this.rot = (this.rot + dt * 0.012) % 1;
    const S = this.S, R = S / 2 - 4, cx = S / 2, cy = S / 2;
    const img = this.ctx.createImageData(S, S), d = img.data;
    const o2 = Math.max(0, Math.min(1, g.run.oxygen / 21));
    const air = mix(hex('#c8703c'), hex('#7ab8ff'), o2);
    const L = [-0.55, -0.45, 0.7];
    const cloudShift = this.rot * 1.7;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const dx = (px + 0.5 - cx) / R, dy = (py + 0.5 - cy) / R, r2 = dx * dx + dy * dy, o = (py * S + px) * 4;
      if (r2 > 1) {
        // the air: a thin rim fading out
        const r = Math.sqrt(r2), a = Math.max(0, 1 - (r - 1) * R / 3.2);
        if (a > 0) { d[o] = air[0]; d[o + 1] = air[1]; d[o + 2] = air[2]; d[o + 3] = 150 * a * a * (0.35 + 0.65 * o2); }
        continue;
      }
      const z = Math.sqrt(1 - r2);
      const lat = Math.asin(-dy), lon = Math.atan2(dx, z) / (Math.PI * 2) + this.rot;
      const ti = ((Math.floor(((lon % 1) + 1) % 1 * TW)) + TW) % TW, tj = Math.min(TH - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * TH)));
      const k = tj * TW + ti;
      let c: RGB = [this.tex[k * 3], this.tex[k * 3 + 1], this.tex[k * 3 + 2]];
      // clouds (with more air there is more weather)
      const ci = ((Math.floor((((lon + cloudShift) % 1) + 1) % 1 * TW)) + TW) % TW;
      const cl = this.cloud[tj * TW + ci];
      if (cl > 0.62) c = mix(c, [236, 238, 240], Math.min(0.75, (cl - 0.62) * 5) * (0.4 + 0.6 * o2));
      const lam = Math.max(0, dx * L[0] + dy * L[1] + z * L[2]);
      const sh = 0.16 + 0.84 * lam;
      c = [c[0] * sh, c[1] * sh * 0.98 + 4 * (1 - sh), c[2] * sh + 14 * (1 - sh)];
      // the air at the limb
      c = mix(c, air, Math.pow(1 - z, 2.2) * (0.35 + 0.4 * o2));
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    this.ctx.putImageData(img, 0, 0);
    // the thing: a warm point where it lies, when on the lit side of the turn
    const tl = (0.5 - this.rot + 1) % 1, ang = tl * Math.PI * 2;
    const tx = Math.sin(ang), tz = Math.cos(ang);
    if (tz > 0.05) {
      const x = cx + tx * R * 0.93, y = cy - Math.sin(0.15) * R;
      const c = this.ctx, a = Math.min(1, tz * 3);
      c.fillStyle = `rgba(255,200,110,${0.35 * a})`; c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
      c.fillStyle = `rgba(255,236,180,${a})`; c.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
}

// ---------------------------------------------------------------- the depth column
export interface DepthMark { y: number; era: number }
/** Everything laid down, top to bottom: the open strata above the thing, then the archive (youngest first).
 *  Returns where the eras change (for the labels) and where the thing lies. */
export function drawDepth(c: CanvasRenderingContext2D, w: number, h: number, g: Game): { marks: DepthMark[]; thing: number } {
  const grid = g.grid, mat = grid.mat;
  // the open strata: from the first row with anything in it down to the thing
  let top = 0;
  outer: for (; top < GH; top++) for (let x = 0; x < GW; x += 3) if (mat[top * GW + x]) break outer;
  const sink = Math.min(GH - 1, Math.max(top, grid.sinkRow));
  const gridRows = Math.max(1, sink - top + 1);
  const layers = g.archive.layers;
  const th = layers.map((L) => Math.max(0.2, g.archive.meanRows(L) / Math.max(1, L.k)));
  const archRows = th.reduce((a, b) => a + b, 0);
  // the open strata get a fixed share of the height (else a long archive would squash them to a line)
  const gridH = archRows > 0 ? Math.round(h * Math.min(0.45, Math.max(0.2, gridRows / (gridRows + archRows)))) : h;
  const img = c.createImageData(w, h), d = img.data;
  const put = (x: number, y: number, col: RGB, k = 1) => { const o = (y * w + x) * 4; d[o] = col[0] * k; d[o + 1] = col[1] * k; d[o + 2] = col[2] * k; d[o + 3] = 255; };
  const sky: RGB = [18, 16, 22];
  for (let y = 0; y < gridH; y++) {
    const gy = top + Math.floor((y / gridH) * gridRows);
    for (let x = 0; x < w; x++) {
      const m = mat[gy * GW + Math.floor((x / w) * GW)];
      put(x, y, m ? matRGB[m] : sky, 0.92 + 0.08 * hash(x, y, 5));
    }
  }
  const marks: DepthMark[] = [];
  if (archRows > 0) {
    const ah = h - gridH, minPx = 1;
    // pixel height per layer: proportional, at least one pixel (then scaled to fit)
    const raw = th.map((t) => Math.max(minPx, (t / archRows) * ah));
    const sum = raw.reduce((a, b) => a + b, 0);
    let y = gridH, prevEra = -1;
    for (let i = 0; i < layers.length && y < h; i++) {
      const L = layers[i], ph = (raw[i] / sum) * ah;
      const y1 = Math.min(h, Math.round(y + ph));
      if (L.era !== prevEra) { marks.push({ y: Math.round(y), era: L.era }); prevEra = L.era; }
      // the layer's main rock (by amount, water and air left out) where a segment shows nothing solid
      let dom = 0, best = 0;
      for (let m = 1; m < NMAT; m++) {
        if (m === WATER) continue;
        let a = 0; for (let s = 0; s < NS; s++) a += L.amt[s * NMAT + m];
        if (a > best) { best = a; dom = m; }
      }
      for (let yy = Math.round(y); yy < y1; yy++) for (let x = 0; x < w; x++) {
        const s = Math.min(NS - 1, Math.floor((x / w) * NS));
        const r = L.rock[s];
        const m = r && r !== WATER ? r : dom;
        // deeper is darker (pressure, age)
        put(x, yy, (m && matRGB[m]) || [60, 50, 45], (1 - 0.3 * (yy / h)) * (0.94 + 0.06 * hash(x >> 2, yy, 9)));
      }
      y += ph;
    }
  }
  c.putImageData(img, 0, 0);
  // era ribbon at the left edge
  for (let i = 0; i < marks.length; i++) {
    const y0 = marks[i].y, y1 = i + 1 < marks.length ? marks[i + 1].y : h;
    c.fillStyle = ERA_COLORS[marks[i].era] ?? '#888'; c.fillRect(0, y0, 2, y1 - y0);
  }
  // the thing at the bottom of the open strata
  const ty = gridH - 1;
  c.fillStyle = 'rgba(255,210,120,0.35)'; c.fillRect(0, ty - 1, w, 3);
  c.fillStyle = '#ffd884'; c.fillRect(Math.floor(w / 2) - 2, ty, 5, 1); c.fillRect(Math.floor(w / 2) - 1, ty - 1, 3, 3);
  return { marks, thing: ty };
}

// ---------------------------------------------------------------- history and the chart
export class History {
  t: number[] = []; life: number[] = []; absorb: number[] = [];
  private acc = 99;
  constructor(private every = 2, private max = 120) {}
  sample(dt: number, g: Game): boolean {
    this.acc += dt;
    if (this.acc < this.every) return false;
    this.acc = 0;
    const life = g.lifeIncome() * g.stats.energyMul, ab = g.absorbRate, tot = g.incomePerSec() + ab;
    this.t.push(tot); this.life.push(life); this.absorb.push(ab);
    if (this.t.length > this.max) { this.t.shift(); this.life.shift(); this.absorb.shift(); }
    return true;
  }
}

/** A pixel chart: the total as a dithered amber area, life as a green line, absorption as a blue one.
 *  Log scale when the range is wide (an idle game's numbers grow by orders). */
export function drawChart(c: CanvasRenderingContext2D, w: number, h: number, hs: History): number {
  c.clearRect(0, 0, w, h);
  const n = hs.t.length;
  c.fillStyle = 'rgba(255,240,210,0.06)';
  for (let y = 0; y < h; y += Math.round(h / 4)) c.fillRect(0, y, w, 1);
  if (n < 2) return 0;
  let max = 0, min = Infinity;
  for (const v of hs.t) { max = Math.max(max, v); if (v > 0) min = Math.min(min, v); }
  const log = max / Math.max(1e-9, min) > 30;
  const f = (v: number) => {
    if (max <= 0) return h - 1;
    const k = log ? Math.log10(Math.max(min, v) / min) / Math.log10(max / min) : v / max;
    return Math.round((h - 2) - Math.max(0, Math.min(1, k)) * (h - 4));
  };
  const X = (i: number) => Math.round((i / (n - 1)) * (w - 1));
  for (let i = 0; i < n - 1; i++) {
    for (let x = X(i); x <= X(i + 1); x++) {
      const k = (x - X(i)) / Math.max(1, X(i + 1) - X(i));
      const y = Math.round(f(hs.t[i]) + (f(hs.t[i + 1]) - f(hs.t[i])) * k);
      for (let yy = y + 1; yy < h; yy++) if ((x + yy) % 2 === 0) { c.fillStyle = `rgba(242,181,74,${0.32 - 0.22 * (yy - y) / h})`; c.fillRect(x, yy, 1, 1); }
    }
  }
  const line = (arr: number[], col: string) => {
    c.fillStyle = col;
    for (let i = 0; i < n - 1; i++) {
      const x0 = X(i), x1 = X(i + 1), y0 = f(arr[i]), y1 = f(arr[i + 1]);
      const steps = Math.max(x1 - x0, Math.abs(y1 - y0), 1);
      for (let s = 0; s <= steps; s++) c.fillRect(Math.round(x0 + (x1 - x0) * s / steps), Math.round(y0 + (y1 - y0) * s / steps), 1, 1);
    }
  };
  if (hs.absorb.some((v) => v > 0)) line(hs.absorb, '#6fb4e0');
  if (hs.life.some((v) => v > 0)) line(hs.life, '#9ccc5a');
  line(hs.t, '#ffd27a');
  return max;
}

/** A pixel ring of shares (the pile's composition): [share, colour][] */
export function drawRing(c: CanvasRenderingContext2D, S: number, parts: [number, string][]): void {
  c.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, R = S / 2 - 1, r = R * 0.58;
  const tot = parts.reduce((a, p) => a + p[0], 0) || 1;
  const cum: number[] = [];
  let acc = 0;
  for (const p of parts) { acc += p[0] / tot; cum.push(acc); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > R || d < r) continue;
    const a = ((Math.atan2(dx, -dy) / (Math.PI * 2)) + 1) % 1;
    let i = cum.findIndex((v) => a <= v); if (i < 0) i = parts.length - 1;
    const edge = d > R - 1 || d < r + 1;
    c.fillStyle = parts[i][1]; c.globalAlpha = edge ? 0.7 : 1; c.fillRect(x, y, 1, 1);
  }
  c.globalAlpha = 1;
}

/** An oxygen tube: the level and the marks of what it unlocks. */
export function drawTube(c: CanvasRenderingContext2D, w: number, h: number, v: number, need: number | null): void {
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#0f0c0a'; c.fillRect(0, 0, w, h);
  const k = Math.max(0, Math.min(1, v / 30));
  const fh = Math.round(k * (h - 2));
  for (let y = h - 1 - fh; y < h - 1; y++) {
    const t = (h - y) / h;
    c.fillStyle = `rgb(${80 + 40 * t},${150 + 60 * t},${200 + 40 * t})`;
    c.fillRect(1, y, w - 2, 1);
  }
  // bubbles
  for (let i = 0; i < 4; i++) { const by = h - 2 - ((performance.now() / 40 + i * 17) % Math.max(1, fh)); if (fh > 4) { c.fillStyle = 'rgba(230,245,255,0.7)'; c.fillRect(1 + ((i * 3) % (w - 2)), Math.round(by), 1, 1); } }
  if (need != null) { const ny = Math.round(h - 1 - Math.min(1, need / 30) * (h - 2)); c.fillStyle = '#f2b54a'; c.fillRect(0, ny, w, 1); }
}

export { ERA_COLORS };
