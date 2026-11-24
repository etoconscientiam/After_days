// World renderer at 180×320, scaled up with nearest-neighbour. Everything here is the pixel world:
// sky, three parallax planes, a living surface, the section, the thing, light and atmosphere.
// Reads core state only; never mutates it.
import { CFG, eraOfYear } from '../config';
import type { Game } from '../core/game';
import { totalPop } from '../core/life';
import { skin, preloadSkins } from './assets';
import { tintedCanvas, drawTinted, tintInto } from './sprites';
import { forecastParticle, conditionsAt, Forecast } from '../core/forecast';
import { GW, KIND, K_MARKER, K_ROCK, K_NONE, K_SOLID } from '../world/Grid';
import { hash2 } from '../core/rng';
import { Layout, WW, WH, NOISE, GRAIN, lerp, lerp3, hex3, rgb, ACCENT } from './common';
import { SectionRenderer, ERA_COLORS, particlePx } from './section';
import { drawFossil, fossilKind } from './skins';
import { CREATURES, Pose, birdFlying, hominid, treeSmall, mossSmall, personSmall, matFilm } from './creatures';
import { drawItem } from './items';
import { renderEcho, EW, EH } from './echoes';
import { drawScene, pictogram, VW, VH } from './ritual';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; kind?: 'mote' | 'firefly' | 'spark' | 'drop' }
interface Flyer { x: number; y: number; vx: number; vy: number; tx: number; ty: number; t: number; color: string; done?: () => void }
/** Sprites that do not stand on the strata: drawn as background life (drawBackdropLife, drawFlyingBirds). */
const M_BONE = () => CFG.matIndex.bone;
const BACKDROP = new Set(['fish', 'plankton', 'bird', 'herd', 'predator']);
/** A swarm of insects: n specks circling a point, wings catching the light now and then. */
function swarm(c: CanvasRenderingContext2D, x: number, y: number, t: number, n: number, col: string): void {
  for (let j = 0; j < n; j++) {
    const a = t * (2 + j * 0.37) + j * 2.1;
    const X = Math.round(x + Math.sin(a) * (3 + (j % 3) * 2)), Y = Math.round(y + Math.cos(a * 1.3) * (2 + (j % 2)));
    c.fillStyle = Math.sin(t * 30 + j * 5) > 0.7 ? 'rgba(230,240,240,0.9)' : col;
    c.fillRect(X, Y, 1, 1);
  }
}
type AbsorbFx = 'dust' | 'crumble' | 'ember' | 'oil' | 'gas' | 'steam' | 'bone' | 'amber' | 'gem' | 'marker';
interface AbsorbBit { kind: 'dot' | 'ember' | 'bubble' | 'star'; x: number; y: number; vx: number; vy: number; g: number; t: number; max: number; color: string; a: number }
/** How a line goes into the thing, by its most valuable material (by kind when the material has no way of its own). */
const FX_MAT: Record<string, AbsorbFx> = {
  peat: 'ember', lignite: 'ember', coal: 'ember', anthracite: 'ember', graphite: 'ember', hearth: 'ember', magma: 'ember',
  oil: 'oil', gas: 'gas', water: 'steam', bone: 'bone', phosphorite: 'bone', shards: 'bone',
  amber: 'amber', amberInsect: 'amber', resin: 'amber',
  diamond: 'gem', ruby: 'gem', sapphire: 'gem', glowstone: 'gem', iridium: 'gem', meteor: 'gem', obsidian: 'gem',
};
function absorbFxOf(id: string): AbsorbFx {
  const f = FX_MAT[id];
  if (f) return f;
  const i = CFG.matIndex[id];
  if (i === undefined) return 'dust';
  const k = KIND[i];
  return k === K_MARKER ? 'marker' : k === K_ROCK ? 'crumble' : 'dust';
}
type Sky = { top: number[]; hor: number[]; light: number };

const SKY = {
  night: { top: hex3('#060914'), hor: hex3('#18203a') },
  twilight: { top: hex3('#262a52'), hor: hex3('#d8805a') },
  day: { top: hex3('#3a74c0'), hor: hex3('#a8cfee') },
};
const RUST = { top: hex3('#3a2a2a'), hor: hex3('#b07850') };
/** Colour grade per era: Silence cold grey-lilac, primal blue-green, sea turquoise, land warm green,
 *  beasts golden, hominids & tribes ochre, the Finding deep night with fire. */
const GRADE = ['#8a84b0', '#5aa098', '#3aa8b8', '#9cc060', '#d8b048', '#c88a40', '#c87a38', '#4a4a90'].map(hex3);
const L = CFG.B.layout;
const HR = 6;
const SUN_R = 7;   // the sun's radius in world px (the size of the painted sprite it replaces)

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lay = new Layout();
  section = new SectionRenderer();
  dayPhase = 0.3;
  seasonPhase = 0.2;
  daySeconds = 6;
  /** how much faster than real time the game runs now (debug speed, slow motion); the sky follows */
  timeMul = 1;
  private sunCv: HTMLCanvasElement | null = null;
  private sunKey = '';
  /** The sun's disc, radially symmetric (cached per colour). */
  private sunDisc(core: number[], low: number): HTMLCanvasElement {
    const key = core.map((v) => Math.round(v / 4)).join(',') + '|' + Math.round(low * 8);
    if (this.sunCv && key === this.sunKey) return this.sunCv;
    const S = SUN_R * 2 + 3;
    const cv = this.sunCv ?? document.createElement('canvas');
    cv.width = cv.height = S;
    const x = cv.getContext('2d')!;
    x.clearRect(0, 0, S, S);
    const o = SUN_R + 1;
    for (let dy = -o; dy <= o; dy++) for (let dx = -o; dx <= o; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy) / (SUN_R + 0.35);
      if (d > 1.12) continue;
      let r = core[0], g = core[1], b = core[2], a = 1;
      if (d < 0.45) { r = 255; g = Math.min(255, g + 14); b = Math.min(255, b + 40); }          // white-hot middle
      else if (d > 0.82 && d <= 1) { g *= 0.93 - 0.06 * low; b *= 0.82 - 0.1 * low; }          // warmer rim, all round
      else if (d > 1) { g *= 0.85; b *= 0.7; a = 0.45; }                                         // soft edge
      x.fillStyle = rgb(r, g, b, a);
      x.fillRect(o + dx, o + dy, 1, 1);
    }
    this.sunCv = cv; this.sunKey = key;
    return cv;
  }
  /** debug: the sun and moon stand still */
  skyFrozen = false;
  skyDim = 0;
  flash = 0;
  shake = 0;
  particles: Particle[] = [];
  flyers: Flyer[] = [];
  hover: { x: number; y: number } | null = null;
  targeting: { rx: number; ry: number; x: number; y: number; kind: string } | null = null;
  reveal = Infinity;
  quality: 'high' | 'low' = 'high';
  chooseHover = -1;
  /** canvas point the click sparks fly to (the Energy counter), set by the UI */
  sparkTarget: () => { x: number; y: number } | null = () => null;
  onSparkArrive: () => void = () => {};
  private t = 0;
  private dt = 1 / 60;
  private alarm = -99;
  private dayCount = 3;
  private timelapse = 0;
  private grade = GRADE[0].slice();
  private clouds: HTMLCanvasElement[] = [];
  private planes: Float32Array[] = [];
  private stars: { x: number; y: number; b: number }[] = [];
  private gy = new Float32Array(WW);              // ground / seabed height per column this frame
  private shiftFx: { img: HTMLCanvasElement; t: number; top: number; h: number } | null = null;
  private echo: { picture: string; t: number; x: number; alpha: number; canvas: HTMLCanvasElement } | null = null;
  private echoQueue: { picture: string; alpha: number }[] = [];
  private seedThread = -1;
  private sinkFx: { id: string; x0: number; t: number } | null = null;
  private meteorFxSeen = new Set<number>();
  private spawns: { x: number; y: number; t: number }[] = [];
  private bloomSmall = document.createElement('canvas');
  private bloomCtx: CanvasRenderingContext2D;
  private sceneCanvas = document.createElement('canvas');
  private maskCanvas = document.createElement('canvas');
  private zoom = 1;
  private cloudsSkinned = false;
  /** Geologist view (brief 5, A3): heat, groundwater and transformation windows over a dimmed section */
  geologist = false;
  /** transformation glow per column (eases toward the game's hotNow, fades when the transformation ends) */
  private hot = new Float32Array(WW);
  private hotY = new Float32Array(WW);
  /** per layer: where to put its plate and what it is becoming (refreshed twice a second) */
  geoLayers: { j: number; x: number; y: number; h: number; f: Forecast | null }[] = [];
  private geoCells: { x: number; y: number; w: number; h: number; T: number; f: Forecast | null; prog: number }[] = [];
  private geoAge = 99;
  /** the finger pressing the layers (world coords), set by the input */
  press: { x: number; y: number; r: number; t0: number; power: number } | null = null;
  /** world y where the header text ends (events in the sky appear below it) */
  skyTop = 66;
  /** a tap landed in the world here (a small flash where the finger touched) */
  private taps: { x: number; y: number; t: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = WW;
    canvas.height = WH;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    preloadSkins('world/');
    for (let i = 0; i < 80; i++) this.stars.push({ x: hash2(i, 1) * WW, y: 30 + hash2(i, 2) * 80, b: 0.3 + hash2(i, 3) * 0.7 });
    for (let l = 0; l < 3; l++) this.clouds.push(this.makeClouds(l));
    // three planes: far mountains, middle hills, near hills (heights above their baselines)
    for (let l = 0; l < 3; l++) {
      const h = new Float32Array(WW);
      for (let x = 0; x < WW; x++) {
        const a = NOISE[((l * 60 + 20) << 8) | ((x * [2, 3, 4][l]) & 255)];
        const b = NOISE[((l * 60 + 90) << 8) | ((x * [7, 9, 11][l]) & 255)];
        h[x] = [30, 16, 9][l] * a + [8, 5, 3][l] * b;
      }
      this.planes.push(h);
    }
    this.bloomSmall.width = WW / 4; this.bloomSmall.height = WH / 4;
    this.bloomCtx = this.bloomSmall.getContext('2d', { willReadFrequently: true })!;
    this.sceneCanvas.width = VW; this.sceneCanvas.height = VH;
    this.maskCanvas.width = VW; this.maskCanvas.height = VH;
  }

  private makeClouds(layer: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = WW; c.height = 40;
    const x = c.getContext('2d')!;
    const sprites = [1, 2, 3, 4].map((n) => skin(`world/sky/cloud_${n}.png`)).filter((im): im is HTMLImageElement => !!im);
    if (sprites.length) {
      // painted clouds: far layer small and few, near layer large; wrapped so the strip tiles
      x.imageSmoothingEnabled = false;
      const n = [4, 3, 2][layer], sc = [0.55, 0.8, 1][layer];
      for (let i = 0; i < n; i++) {
        const im = sprites[Math.floor(hash2(i, layer + 70) * sprites.length)];
        const w = Math.round(im.naturalWidth * sc), h = Math.round(im.naturalHeight * sc);
        const cx = (i + 0.2 + hash2(i, layer + 71) * 0.6) * (WW / n), cy = 6 + hash2(i, layer + 72) * Math.max(1, 34 - h);
        for (const ox of [0, -WW, WW]) x.drawImage(im, Math.round(cx - w / 2 + ox), Math.round(cy), w, h);
      }
      return c;
    }
    const n = [5, 4, 3][layer], size = [0.6, 1, 1.5][layer];
    for (let i = 0; i < n; i++) {
      const cx = (i + hash2(i, layer + 40) * 0.6) * (WW / n), cy = 22 + hash2(i, layer + 41) * 10;
      const w = (12 + hash2(i, layer + 42) * 16) * size;
      const puffs = 3 + Math.floor(hash2(i, layer + 43) * 3);
      for (let k = 0; k < puffs; k++) {
        const px = cx - w / 2 + (k / Math.max(1, puffs - 1)) * w;
        const r = (3 + hash2(i * 7 + k, layer + 44) * 4) * size * (1 - 0.6 * Math.abs(k / Math.max(1, puffs - 1) - 0.5));
        const py = cy - r * 0.5;
        for (let yy = -Math.round(r); yy <= r; yy++) {
          const hw = Math.round(Math.sqrt(Math.max(0, r * r - yy * yy)));
          for (const ox of [0, -WW, WW]) {
            x.fillStyle = yy > r * 0.3 ? 'rgba(190,198,222,0.95)' : 'rgba(246,248,255,0.95)';
            x.fillRect(Math.round(px - hw + ox), Math.round(py + yy), hw * 2, 1);
          }
        }
      }
    }
    return c;
  }

  // ---------- events ----------
  /** A click: the thing flashes, sparks fly to the Energy counter, life nearby looks up. */
  onClick(x: number = WW / 2): void {
    this.flash = Math.min(1, this.flash + 0.25);
    this.alarm = this.t;
    const ay = this.ayAt(x);
    const target = this.sparkTarget();
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 40 + Math.random() * 40;
      if (target) this.flyers.push({ x, y: ay, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, tx: target.x, ty: target.y, t: 0, color: i % 2 ? ACCENT : '#fff2c0', done: i === 0 ? () => this.onSparkArrive() : undefined });
    }
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4, sp = 8 + Math.random() * 14;
      this.particles.push({ x, y: ay, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5 + Math.random() * 0.4, color: ACCENT, size: 1 });
    }
  }
  /** The thing absorbed a line of the strata: it glows in the line's colour, a spark flies to the counter
   *  (a dearer line — brighter, more sparks), and the line goes in its own way by what it is made of
   *  (absorbFx: rock crumbles, coal smoulders, oil ripples dark, gas puffs, bone flashes white, amber glows…). */
  onAbsorb(matId: string, value: number, mats?: Uint8Array, looks?: Uint8Array): void {
    const m = CFG.materials[CFG.matIndex[matId]];
    const col = m ? m.palette[Math.min(4, m.palette.length - 1)] : ACCENT;
    const k = Math.min(1, value / 400);
    const fx = absorbFxOf(matId);
    this.absorb = { t: 0, color: col, k: Math.max(this.absorb && this.absorb.t < 0.3 ? this.absorb.k : 0, 0.35 + 0.65 * k), long: fx === 'amber' };
    const xs = this.lastAbsorbX = (this.lastAbsorbX + 1) % 3;
    const x = WW / 2 + (xs - 1) * 3, ay = this.ayAt(WW / 2) - 2;
    const target = this.sparkTarget();
    const n = value > 250 ? 2 : 1;
    for (let i = 0; i < n && target && this.flyers.length < 40; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = 30 + Math.random() * 30;
      this.flyers.push({ x, y: ay, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, tx: target.x, ty: target.y, t: 0, color: col });
    }
    this.spawnAbsorbFx(fx, col, k);
    if (mats && looks) this.startSuck(mats, looks);
  }

  /** The line the thing takes: its own pixels, drawn on the bottom of the squeeze and drawn in toward the thing —
   *  the near ones first, the far ones later and faster, warming as they go, each gone into the thing. */
  private sucks: { t: number; x0: Int16Array; c: Uint32Array; n: number }[] = [];
  private startSuck(mats: Uint8Array, looks: Uint8Array): void {
    if (this.sucks.length >= 3) this.sucks.shift();
    const x0 = new Int16Array(WW), c = new Uint32Array(WW), px = [0, 0, 0, 0];
    let n = 0;
    for (let x = 0; x < mats.length; x++) {
      const m = mats[x];
      if (!m || KIND[m] === K_NONE || KIND[m] === K_SOLID) continue;
      particlePx(m, looks[x], px);
      for (let d = 0; d < 2; d++) { x0[n] = x * 2 + d; c[n] = px[d]; n++; }
    }
    if (n) this.sucks.push({ t: 0, x0, c, n });
  }

  private drawSucks(): void {
    const c = this.ctx, dt = this.dt, y = this.bandBottom - 1;
    const cx = (this.thingX0 + this.thingX1) / 2, half = (this.thingX1 - this.thingX0) / 2;
    const far = Math.max(cx, WW - cx);
    for (let k = this.sucks.length - 1; k >= 0; k--) {
      const S = this.sucks[k];
      S.t += dt;
      let alive = false;
      for (let j = 0; j < S.n; j++) {
        const x0 = S.x0[j], dx = x0 - cx, dist = Math.abs(dx);
        // reaching the thing's edge takes longer from farther off; it speeds up as it goes (drawn in)
        const ta = 0.2 + 0.7 * Math.pow(dist / far, 0.7);
        const p = Math.min(1, (S.t / ta) ** 2);
        if (p >= 1) continue;
        alive = true;
        const edge = Math.sign(dx) * Math.min(dist, half * 0.6);
        const x = cx + edge + (dx - edge) * (1 - p);
        const col = S.c[j];
        // it warms as soon as it is taken (a thread of light running into the thing), more so near the end
        const w = 0.35 + 0.55 * p;
        const r = (col & 255) + (255 - (col & 255)) * w, gg = ((col >> 8) & 255) + (206 - ((col >> 8) & 255)) * w, b = ((col >> 16) & 255) + (120 - ((col >> 16) & 255)) * w;
        const X = Math.round(x), Y = Math.round(y + p * p * 2);
        c.fillStyle = rgb(r, gg, b, 0.95 - p * 0.25);
        c.fillRect(X, Y, 1, 1);
        // its glow above and below, and a short streak behind a fast one
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = rgb(255, 170, 80, 0.16 + 0.2 * p);
        c.fillRect(X, Y - 1, 1, 1); c.fillRect(X, Y + 1, 1, 1);
        if (p > 0.25) { c.fillStyle = rgb(255, 190, 100, 0.3 * (1 - p)); c.fillRect(X + Math.sign(dx) * (1 + Math.round(p * 3)), Y, 1, 1); }
        c.globalCompositeOperation = 'source-over';
      }
      if (!alive) this.sucks.splice(k, 1);
    }
  }

  /** Gas seeped out at the surface: a few bubbles (under water) or a shimmer of haze (in the air). Oil: a dark
   *  slick that spreads on the ground, or rises and spreads into a sheen on the water. */
  onSeep(x: number, y: number, oil = false): void {
    if (this.afx.length > 140) return;
    const X = x * 2 + 1, Y = this.lay.sectionTop + this.section.yOfRow(y);
    const wet = Y > this.lay.waterLevel + 1;
    if (oil) {
      const sy = wet ? this.lay.waterLevel : Y - 1;
      for (let i = 0; i < 3; i++) {
        const sheen = wet && i === 2;
        this.afx.push({ kind: 'dot', x: X + (i - 1), y: sy, vx: (i - 1) * (wet ? 5 : 2), vy: 0, g: 0, t: 0, max: wet ? 2.2 : 1.6,
          color: sheen ? '#8a7ab8' : '#1a120c', a: sheen ? 0.5 : 0.8 });
      }
      return;
    }
    for (let i = 0; i < (this.quality === 'low' ? 2 : 4); i++) {
      this.afx.push({ kind: 'bubble', x: X + (Math.random() - 0.5) * 3, y: Y - 1, vx: (Math.random() - 0.5) * 3, vy: wet ? -10 - Math.random() * 8 : -5 - Math.random() * 4,
        g: 0, t: 0, max: wet ? Math.max(0.4, (Y - this.lay.waterLevel) / 14) : 0.9, color: wet ? '#d8f0f4' : '#c8ccd0', a: wet ? 0.7 : 0.35 });
    }
  }

  /** A buried lens broke out: a jet of water and steam from the vent, the channel it took lit for a moment. */
  onGeyser(x: number, y0: number, y1: number, n: number): void {
    this.geysers.push({ x: x * 2 + 1, y0: this.lay.sectionTop + this.section.yOfRow(y0), y1: this.lay.sectionTop + this.section.yOfRow(y1), n, t: 0 });
    if (n > 20) this.shake = Math.max(this.shake, 1.5);
  }
  private geysers: { x: number; y0: number; y1: number; n: number; t: number }[] = [];

  private drawGeysers(): void {
    const c = this.ctx, dt = this.dt;
    for (let k = this.geysers.length - 1; k >= 0; k--) {
      const G = this.geysers[k];
      G.t += dt;
      const D = Math.min(3.5, 1.6 + G.n / 40);
      if (G.t > D + 1) { this.geysers.splice(k, 1); continue; }
      const gy = this.gy[Math.max(0, Math.min(WW - 1, G.x))];
      // the channel through the strata, lit for a moment
      if (G.t < 0.9 && G.y0 > gy) {
        c.fillStyle = rgb(190, 225, 250, 0.55 * (1 - G.t / 0.9));
        c.fillRect(G.x, gy, 1, G.y0 - gy);
      }
      if (G.t > D) continue;
      const env = Math.min(1, G.t / 0.25) * Math.min(1, (D - G.t) / 0.6);
      const H = (14 + Math.min(60, G.n) * 0.7) * env * (0.92 + 0.08 * Math.sin(G.t * 23));
      // the jet: a white core, blue sides, a ragged crown
      for (let py = 0; py < H; py++) {
        const y = gy - 1 - py, f = py / Math.max(1, H);
        const wob = Math.sin(G.t * 17 + py * 0.7) > 0.3 ? 1 : 0;
        c.fillStyle = rgb(236, 246, 252, 0.9 - f * 0.4);
        c.fillRect(G.x + (f > 0.7 ? wob - 1 + (py & 1) : 0), y, 1, 1);
        c.fillStyle = rgb(150, 200, 235, 0.7 - f * 0.4);
        if (f < 0.85) { c.fillRect(G.x - 1, y, 1, 1); c.fillRect(G.x + 1, y, 1, 1); }
      }
      // drops thrown from the crown, steam drifting off
      const low = this.quality === 'low';
      if (this.particles.length < (low ? 160 : 320)) {
        const top = gy - H;
        for (let q = 0; q < (low ? 1 : 3); q++) {
          this.particles.push({ x: G.x + (Math.random() - 0.5) * 3, y: top + Math.random() * 4, vx: (Math.random() - 0.5) * 30, vy: -8 - Math.random() * 14, life: 0, max: 1.6, color: Math.random() < 0.5 ? '#e8f4fa' : '#9cc8e6', size: 1, kind: 'drop' });
        }
        if (Math.random() < (low ? 0.3 : 0.7)) this.particles.push({ x: G.x + (Math.random() - 0.5) * 6, y: top + Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 6 + 3, vy: -4 - Math.random() * 4, life: 0, max: 2.2, color: 'rgba(240,244,248,0.5)', size: 2 });
      }
    }
  }

  /** The pieces of an absorption effect, drawn over the night (they glow). */
  private afx: AbsorbBit[] = [];
  private absorbRing: { t: number; color: string; kind: 'oil' | 'marker'; k: number } | null = null;

  private spawnAbsorbFx(fx: AbsorbFx, col: string, k: number): void {
    const x0 = this.thingX0, x1 = this.thingX1, y = this.bandBottom;
    const low = this.quality === 'low';
    const N = (a: number) => Math.max(1, Math.round(a * (low ? 0.5 : 1) * (0.6 + 0.8 * k)));
    if (this.afx.length > 120) return;
    const rx = () => x0 + Math.random() * (x1 - x0);
    const add = (b: Omit<AbsorbBit, 't'>) => this.afx.push({ ...b, t: 0 });
    switch (fx) {
      case 'dust':
        for (let i = 0; i < N(4); i++) add({ kind: 'dot', x: rx(), y: y - 1, vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 4, g: 0, max: 0.7, color: col, a: 0.5 });
        break;
      case 'crumble':
        for (let i = 0; i < N(6); i++) add({ kind: 'dot', x: rx(), y: y - 2, vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 10, g: 70, max: 0.55, color: i % 3 ? col : '#e8dcc8', a: 0.9 });
        break;
      case 'ember':
        for (let i = 0; i < N(6); i++) add({ kind: 'ember', x: rx(), y: y - 1, vx: (Math.random() - 0.5) * 8, vy: -10 - Math.random() * 14, g: 0, max: 0.6 + Math.random() * 0.5, color: i % 2 ? '#ff9a3a' : '#ff5a2a', a: 1 });
        break;
      case 'oil':
        this.absorbRing = { t: 0, color: '#1a120e', kind: 'oil', k };
        for (let i = 0; i < N(3); i++) add({ kind: 'dot', x: rx(), y: y - 1, vx: (Math.random() - 0.5) * 4, vy: 4, g: 10, max: 0.8, color: '#2a1e16', a: 0.9 });
        break;
      case 'gas':
        for (let i = 0; i < N(4); i++) add({ kind: 'bubble', x: rx(), y: y - 2, vx: (Math.random() - 0.5) * 5, vy: -8 - Math.random() * 8, g: 0, max: 0.9 + Math.random() * 0.4, color: '#d8eef0', a: 0.55 });
        break;
      case 'steam':
        for (let i = 0; i < N(5); i++) add({ kind: 'bubble', x: rx(), y: y - 2, vx: (Math.random() - 0.5) * 8, vy: -14 - Math.random() * 10, g: 0, max: 1.1, color: '#f4f8fa', a: 0.45 });
        break;
      case 'bone':
        this.absorb = { t: 0, color: '#ffffff', k: Math.max(0.8, this.absorb?.k ?? 0), long: false };
        for (let i = 0; i < N(5); i++) add({ kind: 'star', x: rx(), y: y - 2 - Math.random() * 3, vx: 0, vy: -3, g: 0, max: 0.5, color: '#ffffff', a: 1 });
        break;
      case 'amber':
        for (let i = 0; i < N(5); i++) add({ kind: 'ember', x: rx(), y: y - 1, vx: (Math.random() - 0.5) * 4, vy: -4 - Math.random() * 5, g: 0, max: 1.2 + Math.random() * 0.6, color: i % 2 ? '#ffc850' : '#ffe090', a: 0.9 });
        break;
      case 'gem':
        for (let i = 0; i < N(3); i++) add({ kind: 'star', x: rx(), y: y - 2 - Math.random() * 4, vx: 0, vy: 0, g: 0, max: 0.7 + Math.random() * 0.3, color: i % 2 ? col : '#ffffff', a: 1 });
        break;
      case 'marker':
        this.absorbRing = { t: 0, color: col, kind: 'marker', k };
        break;
    }
  }

  private drawAbsorbFx(): void {
    const c = this.ctx, dt = this.dt, y = this.bandBottom;
    if (this.absorbRing) {
      const R = this.absorbRing;
      R.t += dt;
      const dur = R.kind === 'oil' ? 0.9 : 0.6;
      const f = R.t / dur;
      if (f >= 1) this.absorbRing = null;
      else if (R.kind === 'oil') {
        // a dark ripple spreading along the line from the thing
        const cx = (this.thingX0 + this.thingX1) / 2, rx = 8 + f * (30 + 30 * R.k);
        c.globalAlpha = 0.55 * (1 - f);
        c.strokeStyle = R.color; c.lineWidth = 1;
        c.beginPath(); c.ellipse(cx, y - 0.5, rx, 1.5 + f * 2, 0, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
      } else {
        // a marker bed: the whole line flashes in its colour, running out from the thing
        const cx = (this.thingX0 + this.thingX1) / 2, w = f * WW;
        c.globalAlpha = 0.7 * (1 - f) * (0.5 + 0.5 * R.k);
        c.fillStyle = R.color;
        c.fillRect(Math.round(cx - w), y - 1, Math.round(w * 2), 1);
        c.globalAlpha = 1;
      }
    }
    for (let i = this.afx.length - 1; i >= 0; i--) {
      const b = this.afx[i];
      b.t += dt;
      if (b.t >= b.max) { this.afx.splice(i, 1); continue; }
      b.vy += b.g * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      // a chip that falls lands on the thing
      if (b.g > 0 && b.y > y + 2) { b.y = y + 2; b.vy = 0; b.vx *= 0.5; }
      const f = b.t / b.max;
      let a = b.a * (1 - f);
      if (b.kind === 'ember') a *= 0.6 + 0.4 * Math.sin(b.t * 30 + i);
      c.globalAlpha = Math.max(0, a);
      c.fillStyle = b.color;
      const X = Math.round(b.x), Y = Math.round(b.y);
      if (b.kind === 'bubble') {
        // a small bubble: a pixel with a lit top, a little wider as it rises
        c.fillRect(X, Y, 1, 1);
        if (f > 0.4) { c.globalAlpha = Math.max(0, a * 0.5); c.fillRect(X - 1, Y, 1, 1); c.fillRect(X + 1, Y, 1, 1); }
      } else if (b.kind === 'star') {
        const s = f < 0.5 ? 1 : 0;
        c.fillRect(X, Y, 1, 1);
        if (s) { c.fillRect(X - 1, Y, 3, 1); c.fillRect(X, Y - 1, 1, 3); }
      } else c.fillRect(X, Y, 1, 1);
    }
    c.globalAlpha = 1;
  }

  private absorb: { t: number; color: string; k: number; long: boolean } | null = null;
  /** Where the thing takes the strata (screen): the bottom of the squeeze, the thing's span (set every frame). */
  private bandBottom = 0;
  private thingX0 = WW / 2 - 8;
  private thingX1 = WW / 2 + 8;
  private lastAbsorbX = 0;

  onExtinction(): void { this.skyDim = 1; this.shake = Math.min(3, this.shake + 2); this.alarm = this.t; }
  onQuake(): void { this.shake = 4; this.alarm = this.t; }
  onEra(era: number): void { if (era === 1) this.seedThread = 0; }

  /** A soft flash where a new creature comes up from the ground. */
  spawnFlash(zi: number, g: Game): void {
    const xs: number[] = [];
    for (let x = 0; x < WW; x++) if (g.zoneMap[x] === zi) xs.push(x);
    if (!xs.length) return;
    const x = xs[Math.floor(Math.random() * xs.length)];
    const y = this.gy[x] - 2;
    this.spawns.push({ x, y, t: 0 });
  }

  /** Flying light from a canvas point to another (prices into the world, fossils to the Book, rocks to resources). */
  fly(x0: number, y0: number, x1: number, y1: number, color: string, done?: () => void): void {
    this.flyers.push({ x: x0, y: y0, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 20, tx: x1, ty: y1, t: 0, color, done });
  }

  burst(x: number, y: number, color: string, n = 6): void {
    if (this.quality === 'low') n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 14;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6, life: 0, max: 0.5 + Math.random() * 0.5, color, size: 1 });
    }
  }

  beginShift(): void {
    const h = this.section.canvas.height;
    const c = document.createElement('canvas');
    c.width = WW; c.height = h;
    c.getContext('2d')!.drawImage(this.section.canvas, 0, 0);
    this.shiftFx = { img: c, t: 0, top: this.lay.sectionTop, h };
    this.reveal = Infinity;
  }

  /** Offline return: a few seconds of timelapse (days flicker, the section grows back in). */
  startTimelapse(sec: number): void { this.timelapse = sec; this.reveal = 0; }

  showEcho(picture: string, alpha: number): void {
    if (this.echo) { if (this.echoQueue.length < 3) this.echoQueue.push({ picture, alpha }); return; }
    const canvas = document.createElement('canvas');
    canvas.width = EW; canvas.height = EH;
    this.echo = { picture, t: 0, x: 10 + Math.random() * (WW - EW - 20), alpha, canvas };
  }

  beginSink(id: string, index: number, n: number): void {
    this.sinkFx = { id, x0: this.chooseXs(n)[index] ?? WW / 2, t: 0 };
  }

  // ---------- frame ----------
  draw(g: Game, dt: number, now: number): void {
    const c = this.ctx;
    this.t += dt;
    this.dt = dt;
    // the sun, moon and stars turn with the flow of time: a slower era has longer days, a boost or a faster
    // clock (debug speed) spins them faster, the slow motion at an era change almost stops them
    let dayTarget = 24;
    if (g.state.phase === 'play') {
      const base = g.yps(false);
      const boost = g.yps() / Math.max(1e-9, base);
      const perDay = 24 / Math.pow(Math.max(1e-3, base) / 0.1, 0.25);     // 24 s at 0.1 years/s … ~4 s at 150
      dayTarget = Math.max(0.8, Math.min(120, perDay / Math.max(1e-3, boost * this.timeMul)));
    }
    // ease into the new speed (no jumps when a boost starts or ends)
    const rate = 1 / this.daySeconds, want = 1 / dayTarget;
    this.daySeconds = 1 / (rate + (want - rate) * Math.min(1, dt * 2.5));
    const lapse = this.skyFrozen ? 0 : this.timelapse > 0 ? 14 : 1;
    this.timelapse = Math.max(0, this.timelapse - dt);
    this.dayPhase += (dt * lapse) / this.daySeconds;
    if (this.dayPhase >= 1) { this.dayPhase -= 1; this.dayCount++; }
    this.seasonPhase = (this.seasonPhase + (dt * lapse) / (this.daySeconds * 10)) % 1;
    this.skyDim = Math.max(0, this.skyDim - dt * 0.5);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 5);
    if (this.reveal !== Infinity) this.reveal += (dt * this.lay.sectionH) / (this.timelapse > 0 ? 4 : 2.2);
    if (this.reveal > this.lay.sectionH) this.reveal = Infinity;
    // era colour grade drifts to the new tone over ~3 s
    const target = GRADE[Math.min(7, g.run.era)];
    for (let k = 0; k < 3; k++) this.grade[k] += (target[k] - this.grade[k]) * Math.min(1, dt / 1.2);

    this.computeGround(g);
    this.section.relief = this.gy;
    // an open drawer: the history ribbon stands right above it
    this.section.cut = this.lay.drawer > 1 ? WH - CFG.B.layout.tabBarH - this.lay.drawer - RIBBON_H - this.lay.sectionTop : Infinity;
    this.section.maybeRender(g, this.lay, now, this.reveal, dt);
    this.lay.artifactY = this.ayAt(WW / 2);
    if (g.state.phase === 'choose') { this.drawChoose(g); this.drawSink(dt); return; }

    // the camera leans in on the temple during the finale
    const tz = g.state.phase === 'temple' ? 1 + 0.32 * ease(Math.min(1, Math.max(0, (g.state.templeProgress - 0.4) / 0.5))) : g.state.phase === 'newWorld' || g.state.phase === 'end' ? 1.32 : 1;
    this.zoom += (tz - this.zoom) * Math.min(1, dt * 2);
    const sky = this.skyColors(g);
    c.save();
    if (this.shake > 0.05) c.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    if (this.zoom > 1.001) {
      const fx = WW / 2, fy = this.lay.groundBase;
      c.translate(fx, fy); c.scale(this.zoom, this.zoom); c.translate(-fx, -fy);
    }
    c.fillStyle = '#0e0c10';
    c.fillRect(-4, -4, WW + 8, WH + 8);
    this.drawSky(g, sky);
    this.drawPlanes(g, sky);
    this.drawEcho(dt);
    this.drawSection(g);
    this.drawGround(g, sky);
    this.drawBackdropLife(g, sky);
    this.drawSurfaceBones(g, sky);
    this.drawLife(g);
    this.drawGeysers();
    this.drawCompactLine(g);
    this.drawFinaleWorld(g);
    this.drawShift(dt);
    this.drawHorizon(g);
    this.drawPress(dt);
    this.drawRare(g);
    this.drawBurialMarker(g);
    this.drawTaps(dt);
    this.drawAmbient(g, sky);
    this.drawParticles(dt);
    this.drawWorldLight(g, sky);
    this.drawGrade(sky);
    c.restore();
    this.drawBloom();
    this.drawVision(g);
    this.drawFlyers(dt);
    this.drawVignette(sky);
  }

  // ---------- sky ----------
  private sunAlt(): number { return Math.sin((this.dayPhase - 0.25) * Math.PI * 2); }

  winterAmount(): number {
    const s = this.seasonPhase;
    const d = Math.min(Math.abs(s - 0.875), 1 - Math.abs(s - 0.875));
    return Math.max(0, 1 - d / 0.15);
  }

  private skyColors(g: Game): Sky {
    const alt = this.sunAlt();
    let top: number[], hor: number[];
    if (alt < -0.3) { top = SKY.night.top; hor = SKY.night.hor; }
    else if (alt < 0.12) { const k = (alt + 0.3) / 0.42; top = lerp3(SKY.night.top, SKY.twilight.top, k); hor = lerp3(SKY.night.hor, SKY.twilight.hor, k); }
    else if (alt < 0.5) { const k = (alt - 0.12) / 0.38; top = lerp3(SKY.twilight.top, SKY.day.top, k); hor = lerp3(SKY.twilight.hor, SKY.day.hor, k * k); }
    else { top = SKY.day.top; hor = SKY.day.hor; }
    const rust = Math.max(0, 1 - g.run.oxygen / 16) * 0.75;
    const light = Math.max(0.22, Math.min(1, (alt + 0.3) / 0.7));
    top = lerp3(top, RUST.top.map((v) => v * light), rust);
    hor = lerp3(hor, RUST.hor.map((v) => v * light), rust);
    const dim = 1 - this.skyDim * 0.6;
    if (g.run.active.some((a) => a.id === 'volcanoFx' || a.id === 'meteorFx')) { top = lerp3(top, [40, 30, 30], 0.4); hor = lerp3(hor, [120, 70, 50], 0.4); }
    return { top: top.map((v) => v * dim), hor: hor.map((v) => v * dim), light: light * dim };
  }

  private drawSky(g: Game, sky: Sky): void {
    const c = this.ctx;
    const lay = this.lay;
    const bottom = lay.waterLevel + 2;
    for (let y = -4; y < bottom; y++) {
      const k = Math.max(0, Math.min(1, (y + lay.shift) / (bottom + lay.shift)));
      const col = lerp3(sky.top, sky.hor, k * k);
      c.fillStyle = rgb(col[0], col[1], col[2]);
      c.fillRect(0, y, WW, 1);
    }
    const alt = this.sunAlt();
    const starA = Math.max(0, Math.min(1, -alt * 2.5));
    if (starA > 0.02) for (const s of this.stars) {
      c.fillStyle = rgb(230, 230, 255, starA * s.b * (0.6 + 0.4 * Math.sin(this.t * 2 + s.x)));
      c.fillRect(Math.round(s.x), Math.round(s.y - lay.shift * 0.5), 1, 1);
    }
    this.drawSatellites(g, alt);
    this.drawSunMoon(sky);
    if (!this.cloudsSkinned && skin('world/sky/cloud_1.png')) {
      this.cloudsSkinned = true;
      this.clouds = [0, 1, 2].map((l) => this.makeClouds(l));
    }
    const cloudA = (this.cloudsSkinned ? 0.55 + 0.4 * sky.light : 0.35 + 0.5 * sky.light) * (g.run.oxygen > 5 ? 1 : 0.5);
    // clouds take the colour of the hour: white by day, peach at sunset, grey-blue at night
    const low = this.sunPos?.up ? this.sunPos.low : 0;
    const ct = lerp3(lerp3([255, 255, 255], [255, 186, 150], low * Math.min(1, sky.light * 1.6)), [96, 106, 150], 1 - sky.light);
    for (let l = 0; l < this.clouds.length; l++) {
      const speed = [1.2, 2.6, 5][l];
      const off = (this.t * speed) % WW;
      const y = [62, 50, 38][l] - lay.shift * (0.4 + l * 0.2);
      const cl = tintedCanvas(this.clouds[l], WW, this.clouds[l].height, lerp3(ct, sky.hor, [0.35, 0.18, 0][l]));
      c.globalAlpha = cloudA * [0.45, 0.6, 0.75][l];
      c.drawImage(cl, 0, 0, WW, this.clouds[l].height, -Math.round(off), Math.round(y), WW, this.clouds[l].height);
      c.drawImage(cl, 0, 0, WW, this.clouds[l].height, WW - Math.round(off), Math.round(y), WW, this.clouds[l].height);
    }
    c.globalAlpha = 1;
    // sun rays: volumetric light in the air of the sky only — drawn before the hills, land, water and life,
    // so everything standing in front of the sky covers them. A quarter-resolution field of soft angular noise
    // around the sun (broad shafts and gaps), fading with distance, smoothed up: no edge anywhere.
    if (this.sunPos && this.sunPos.up && alt > 0.1 && this.quality === 'high') this.drawRays(lay, alt);
    if (g.run.active.some((a) => a.id === 'rain' || a.id === 'flood')) {
      c.fillStyle = 'rgba(30,40,60,0.25)'; c.fillRect(0, 0, WW, bottom);
      c.fillStyle = 'rgba(170,190,220,0.55)';
      for (let i = 0; i < (this.quality === 'high' ? 80 : 30); i++) {
        const x = (hash2(i, 5) * WW + this.t * 20) % WW, y = (hash2(i, 6) * bottom + this.t * 150) % bottom;
        c.fillRect(Math.round(x), Math.round(y), 1, 2);
      }
    }
    if (this.winterAmount() > 0.3 && g.run.era >= 3) {
      c.fillStyle = 'rgba(240,244,255,0.85)';
      for (let i = 0; i < 50; i++) c.fillRect(Math.round((hash2(i, 8) * WW + Math.sin(this.t + i) * 4) % WW), Math.round((hash2(i, 9) * bottom + this.t * 10) % bottom), 1, 1);
    }
    const v = g.run.active.find((a) => a.id === 'volcanoFx');
    if (v && v.x !== undefined) {
      const left = (v.until - g.run.clock) / 30;
      const gy = this.gy[Math.max(0, Math.min(WW - 1, v.x))];
      for (let i = 0; i < 40; i++) {
        const k = i / 40;
        c.fillStyle = rgb(60 + 30 * k, 55 + 25 * k, 55 + 25 * k, 0.5 * left * (1 - k * 0.6));
        c.beginPath(); c.arc(v.x + Math.sin(this.t * 2 + i * 0.4) * (2 + k * 12) + k * 15, gy - 12 - k * 90, 2 + k * 8, 0, 7); c.fill();
      }
    }
    const m = g.run.active.find((a) => a.id === 'meteorFx');
    if (m && m.x !== undefined && !this.meteorFxSeen.has(m.until)) { this.meteorFxSeen.add(m.until); this.flash = 1; this.shake = 5; this.skyDim = 1; this.alarm = this.t; }
    this.drawFlyingBirds(g);
  }

  private drawSunMoon(sky: Sky): void {
    const c = this.ctx;
    const lay = this.lay;
    const horizon = lay.groundBase - 2;
    const peak = Math.max(44, 58 - lay.shift * 0.4);
    const arc = (u: number) => ({ x: -8 + u * (WW + 16), y: horizon - Math.sin(u * Math.PI) * (horizon - peak) });
    const disc = (cx: number, cy: number, r: number, col: (dx: number, dy: number) => string | null) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r * 0.6) continue;
        const k = col(dx, dy);
        if (k) { c.fillStyle = k; c.fillRect(Math.round(cx) + dx, Math.round(cy) + dy, 1, 1); }
      }
    };
    const su = (this.dayPhase - 0.25) / 0.5;
    if (su > -0.05 && su < 1.05) {
      const { x, y } = arc(Math.max(0, Math.min(1, su)));
      const low = Math.max(0, 1 - (horizon - y) / 40);
      const core = lerp3([255, 248, 214], [255, 150, 70], low);
      const R = 4 + Math.round(low * 1.5);
      const glow = c.createRadialGradient(x, y, 1, x, y, 26 + low * 14);
      glow.addColorStop(0, rgb(core[0], core[1], core[2], 0.55));
      glow.addColorStop(1, rgb(core[0], core[1] * 0.8, core[2] * 0.6, 0));
      c.fillStyle = glow; c.fillRect(x - 40, y - 40, 80, 80);
      if (low > 0.3) {
        const band = c.createRadialGradient(x, horizon, 2, x, horizon, 90);
        band.addColorStop(0, rgb(255, 140, 70, 0.35 * low)); band.addColorStop(1, 'rgba(255,120,60,0)');
        c.fillStyle = band; c.fillRect(x - 90, horizon - 60, 180, 70);
      }
      // the sun shines by itself: a disc lit evenly from its middle (no shaded side like a ball), a warmer rim
      // and a soft one-pixel edge; low over the horizon it grows a little and reddens
      void R; void disc;
      c.drawImage(this.sunDisc(core, low), Math.round(x) - SUN_R - 1, Math.round(y) - SUN_R - 1);
      this.sunPos = { x, y, up: su > 0 && su < 1, low };
    } else this.sunPos = null;
    const mu = ((this.dayPhase + 0.25) % 1) / 0.5;
    if (mu > -0.05 && mu < 1.05) {
      const { x, y } = arc(Math.max(0, Math.min(1, mu)));
      const phase = ((this.dayCount % 10) + mu * 0.1) / 10;
      const glow = c.createRadialGradient(x, y, 1, x, y, 16);
      glow.addColorStop(0, `rgba(210,220,255,${0.25 * Math.sin(phase * Math.PI) + 0.05})`); glow.addColorStop(1, 'rgba(200,210,255,0)');
      c.fillStyle = glow; c.fillRect(x - 16, y - 16, 32, 32);
      const moonImg = skin('world/sky/moon.png');
      const R = moonImg ? Math.floor(moonImg.naturalWidth / 2) : 3, term = Math.cos(phase * 2 * Math.PI);
      const shadow = rgb(sky.top[0] * 1.15 + 8, sky.top[1] * 1.15 + 8, sky.top[2] * 1.15 + 12);
      if (moonImg) {
        // the painted moon, cooled by the night, with its phase shadow on top
        drawTinted(c, 'world/sky/moon.png', x, y, [225, 230, 250]);
        c.globalAlpha = 0.88;
        disc(x, y, R - 1, (dx, dy) => {
          const w = Math.sqrt(Math.max(0, R * R - dy * dy)) || 1;
          const lit = phase < 0.5 ? dx / w > term : dx / w < -term;
          return lit ? null : shadow;
        });
        c.globalAlpha = 1;
      } else disc(x, y, R, (dx, dy) => {
        const w = Math.sqrt(Math.max(0, R * R - dy * dy)) || 1;
        const lit = phase < 0.5 ? dx / w > term : dx / w < -term;
        return lit ? (dx < 0 && dy < 0 ? '#f4f6fb' : '#dde2ee') : rgb(sky.top[0] * 1.15 + 8, sky.top[1] * 1.15 + 8, sky.top[2] * 1.15 + 12);
      });
    }
  }
  private sunPos: { x: number; y: number; up: boolean; low: number } | null = null;

  private drawSatellites(g: Game, alt: number): void {
    const r = g.run;
    if (g.meta.prestiges > 0 || r.era > 1 || g.state.phase !== 'play') return;
    const c = this.ctx;
    const S = CFG.story.satellites;
    const rt = r.realTime;
    const dark = Math.max(0.35, Math.min(1, -alt * 2.5 + 0.4));
    const sh = this.lay.shift * 0.5;
    for (let i = 0; i < S.low; i++) {
      const tf = S.firstFallSec + i * S.fallEverySec;
      const speed = 2 + hash2(i, 22) * 4;
      const posX = (tt: number) => ((hash2(i, 21) * (WW + 10) + tt * speed) % (WW + 10)) - 5;
      const y = 50 + hash2(i, 23) * 40 - sh;
      if (rt < tf) { c.fillStyle = rgb(235, 238, 255, dark * 0.85); c.fillRect(Math.round(posX(rt)), Math.round(y), 1, 1); }
      else if (rt < tf + 1.3) {
        const k = (rt - tf) / 1.3, x0 = posX(tf);
        for (let q = 0; q < 6; q++) {
          const kk = Math.max(0, k - q * 0.04);
          c.fillStyle = q < 2 ? rgb(255, 240, 200, 1 - k) : rgb(255, 140 - q * 10, 40, (1 - k) * (1 - q / 6));
          c.fillRect(Math.round(x0 + kk * 24), Math.round(y + kk * 36), 1, 1);
        }
      }
    }
    for (let j = 0; j < S.high; j++) {
      let a = dark;
      if (j < S.high - 1) a *= Math.max(0, Math.min(1, (CFG.startYear + ((j + 1) / S.high) * (CFG.eras[0].end - CFG.startYear) - r.year) / 60));
      else if (r.era >= 1) a *= Math.max(0, 1 - (rt - (r.timeAtEra[1] ?? rt)) / 1.5);
      if (a <= 0.01) continue;
      c.fillStyle = rgb(255, 250, 235, a);
      c.fillRect(12 + j * 29 + Math.round(hash2(j, 41) * 10), Math.round(54 + hash2(j, 42) * 24 - sh), 1, 1);
    }
  }

  /** Birds as flocks across the sky: more birds — more flocks, at different heights; the far ones are specks. */
  private drawFlyingBirds(g: Game): void {
    const pop = totalPop(g, 'birds');
    if (pop <= 0) return;
    const c = this.ctx, t = this.t;
    const flocks = Math.min(this.quality === 'low' ? 2 : 5, Math.ceil(pop / 8));
    const pose: Pose = { t, i: 0, flip: false, alert: 0, walk: 0, season: this.seasonPhase };
    const flee = t - this.alarm < 3 ? (t - this.alarm) * 2.5 : 0;   // startled: the flocks hurry off
    for (let f = 0; f < flocks; f++) {
      const h = hash2(f, 77), far = f > 0 && h > 0.45;
      const n = Math.max(3, Math.min(9, Math.round(pop / flocks / 2)));
      const dir = f % 2 ? -1 : 1, sp = (far ? 4 : 7) + h * 4;
      const span = WW + 120;
      const run = (t + flee) * sp + h * span;
      const lx = dir > 0 ? (run % span) - 60 : WW + 60 - (run % span);
      const ly = this.lay.surfaceTop - 16 - h * 46 + Math.sin(t * 0.4 + f) * 4;
      for (let i = 0; i < n; i++) {
        const row = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
        const bx = lx - dir * row * (far ? 5 : 9) + Math.sin(t * 2 + i + f) * 1.2, by = ly + row * (far ? 2 : 3.5) * side + Math.cos(t * 1.7 + i) * 1.2;
        if (far) {
          // a far bird: a flicker of two wings
          const up = Math.sin(t * 9 + i * 1.7 + f) > 0;
          c.fillStyle = 'rgba(42,38,46,0.6)';
          c.fillRect(Math.round(bx) - 1, Math.round(by) + (up ? -1 : 0), 1, 1); c.fillRect(Math.round(bx), Math.round(by), 1, 1); c.fillRect(Math.round(bx) + 1, Math.round(by) + (up ? -1 : 0), 1, 1);
        } else birdFlying(c, bx, by, { ...pose, i: i + f * 9, flip: dir < 0 });
      }
    }
  }

  /** Bones that lie on the surface now (bone particles in the top row of their column, or one row under it):
   *  a bleached skeleton for a moment of geological time, until the next laminae bury it. */
  private drawSurfaceBones(g: Game, sky: Sky): void {
    const grid = g.grid, c = this.ctx, BONE = M_BONE();
    const light = 0.55 + 0.45 * sky.light;
    let n = 0;
    for (let x = 0; x < GW && n < 10; x++) {
      const top = grid.surf[x];
      for (let k = 0; k < 2; k++) {
        const y = top + k;
        if (y >= grid.floor) break;
        const i = y * GW + x;
        if (grid.mat[i] !== BONE) continue;
        const sp = CFG.species[grid.spec[i] - 1];
        if (!sp || sp.sprite === 'mollusc') continue;
        n++;
        const X = x * 2, Y = this.gy[Math.min(WW - 1, X)] - 1;
        const a = (k ? 0.55 : 1) * (1 - grid.decay[i] / 400);
        const hi = rgb(248 * light, 244 * light, 230 * light, a), lo = rgb(196 * light, 188 * light, 168 * light, a);
        const sh = rgb(30, 22, 18, 0.45 * a), eye = rgb(40, 30, 26, a);
        const flip = (x * 7 + y) & 1 ? 1 : -1;
        // at the scale of the strata (a tree is 6–10 px): a carcass a few pixels, a fish 4, a skull 2
        if (sp.groups.includes('marine')) {
          c.fillStyle = sh; c.fillRect(X - 2, Y + 1, 4, 1);
          c.fillStyle = hi; c.fillRect(X - 2, Y, 3, 1);
          c.fillStyle = lo; c.fillRect(X - 1, Y - 1, 1, 1);
          c.fillStyle = hi; c.fillRect(X + (flip > 0 ? 1 : -2), Y - 1, 1, 1);
        } else if (sp.groups.includes('hominid') || sp.groups.includes('tribe')) {
          c.fillStyle = sh; c.fillRect(X - 1, Y + 1, 2, 1);
          c.fillStyle = hi; c.fillRect(X - 1, Y, 2, 1);
          c.fillStyle = eye; c.fillRect(X + (flip > 0 ? 0 : -1), Y, 1, 1);
        } else {
          // ribs over a spine, the skull at one end
          c.fillStyle = sh; c.fillRect(X - 2, Y + 1, 5, 1);
          c.fillStyle = hi; c.fillRect(X - 2, Y, 4, 1);
          c.fillStyle = lo; c.fillRect(X - 1, Y - 1, 1, 1); c.fillRect(X + 1, Y - 1, 1, 1);
          c.fillStyle = hi; c.fillRect(X + (flip > 0 ? 2 : -3), Y - 1, 1, 1);
        }
      }
    }
  }

  /** The compaction line (as in the prototype): a dashed amber line across the world; when a column of the strata
   *  reaches it, its bottom starts to turn to rock and the thing starts to take the oldest rows. Clear while the
   *  strata are still below it, faint after. */
  compactLineY = 0;
  private drawCompactLine(g: Game): void {
    const c = this.ctx;
    const y = Math.round(this.lay.sectionTop + this.section.yOfRow(g.lineRow()));
    this.compactLineY = y;
    const reached = g.run.sink.rows > 0;
    c.fillStyle = rgb(242, 181, 74, reached ? 0.16 : 0.45 + 0.1 * Math.sin(this.t * 2));
    for (let x = 0; x < WW; x += 4) c.fillRect(x, y, 2, 1);
    if (!reached) { c.fillStyle = rgb(242, 181, 74, 0.9); c.fillRect(WW - 4, y, 4, 1); }
  }

  /** Life as the background of geological time: the sea blooms with plankton and flashes with shoals, mats
   *  breathe bubbles, herds cross the land far off as a line of small silhouettes with their hunters behind. */
  private drawBackdropLife(g: Game, sky: Sky): void {
    const c = this.ctx, t = this.t, lay = this.lay, sea = lay.waterLevel;
    const low = this.quality === 'low';
    const wetX: number[] = [];
    for (let x = 0; x < WW; x++) if (g.water.col[x >> 1] === 1 && this.gy[x] > sea + 1) wetX.push(x);
    const day = 0.35 + 0.65 * sky.light;
    if (wetX.length) {
      // plankton: the water greens, and specks drift and glint just under the surface
      const P = totalPop(g, 'plankton');
      if (P > 0) {
        const bloom = Math.min(1, P / 30);
        c.fillStyle = rgb(70, 170, 120, 0.16 * bloom);
        for (const x of wetX) c.fillRect(x, sea + 1, 1, this.gy[x] - sea - 1);
        const n = Math.min(low ? 16 : 36, Math.ceil(P * 1.5));
        for (let i = 0; i < n; i++) {
          const x = wetX[Math.floor(hash2(i, 501) * wetX.length)] + Math.sin(t * 0.3 + i) * 3;
          const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
          if (g.water.col[xi >> 1] !== 1) continue;
          const room = this.gy[xi] - sea - 2;
          if (room < 1) continue;
          const y = sea + 1 + ((hash2(i, 502) * Math.min(8, room) + Math.sin(t * 0.5 + i * 1.3)) % room + room) % room;
          c.fillStyle = rgb(190, 245, 215, (0.25 + 0.5 * Math.max(0, Math.sin(t * 2 + i))) * day);
          c.fillRect(xi, Math.round(y), 1, 1);
        }
      }
      // fish: shoals in the deeper water — a moving cloud of dark specks that flashes silver as it turns
      const F = totalPop(g, 'fish');
      const runs: { x0: number; x1: number }[] = [];
      for (let k = 0; k < wetX.length;) {
        let k1 = k;
        while (k1 + 1 < wetX.length && wetX[k1 + 1] === wetX[k1] + 1) k1++;
        if (wetX[k1] - wetX[k] >= 10) runs.push({ x0: wetX[k], x1: wetX[k1] });
        k = k1 + 1;
      }
      if (F > 0 && runs.length) {
        const shoals = Math.min(low ? 2 : 4, Math.ceil(F / 5));
        for (let sI = 0; sI < shoals; sI++) {
          const run = runs[sI % runs.length], h = hash2(sI, 511);
          const w = run.x1 - run.x0;
          const cx = run.x0 + w / 2 + Math.sin(t * (0.15 + h * 0.1) + h * 9) * (w / 2 - 4);
          const turn = Math.cos(t * (0.15 + h * 0.1) + h * 9);
          const n = 5 + Math.round(h * 4);
          for (let j = 0; j < n; j++) {
            const a = j * 2.4 + t * 0.8;
            const x = Math.round(cx + Math.cos(a) * (2 + (j % 3)) * 1.6);
            const xi = Math.max(0, Math.min(WW - 1, x));
            const bot = this.gy[xi];
            if (g.water.col[xi >> 1] !== 1 || bot - sea < 5) continue;
            const mid = sea + 2 + (bot - sea - 4) * (0.35 + 0.3 * h);
            const y = Math.round(Math.max(sea + 2, Math.min(bot - 2, mid + Math.sin(a) * 1.5)));
            const flash = Math.abs(turn) < 0.25 && Math.sin(t * 7 + j * 2) > 0.2;
            c.fillStyle = flash ? rgb(230, 240, 250, 0.85 * day) : rgb(20, 40, 56, 0.45);
            c.fillRect(x, y, 1, 1);
          }
          // the shoal at the top now and then: a ring on the surface
          const ph = (t * 0.2 + h) % 1;
          if (ph < 0.12) {
            const r = 1 + ph * 30;
            c.fillStyle = rgb(220, 240, 250, 0.5 * (1 - ph / 0.12));
            c.fillRect(Math.round(cx - r), sea, 1, 1); c.fillRect(Math.round(cx + r), sea, 1, 1);
          }
        }
      }
      // bacterial mats under water breathe: small bubbles rise to the surface
      const M = totalPop(g, 'mats');
      if (M > 0) {
        const n = Math.min(low ? 4 : 8, Math.ceil(M / 2));
        for (let i = 0; i < n; i++) {
          const x = wetX[Math.floor(hash2(i, 521) * wetX.length)];
          const bot = this.gy[x], room = bot - sea - 1;
          if (room < 3) continue;
          const ph = (t * (0.25 + hash2(i, 522) * 0.2) + hash2(i, 523)) % 1;
          c.fillStyle = rgb(210, 240, 240, 0.55 * (1 - ph * 0.6));
          c.fillRect(x + (Math.sin(t * 3 + i) > 0.6 ? 1 : 0), Math.round(bot - 1 - ph * room), 1, 1);
        }
      }
    }
    // herds and their hunters: a far line of small silhouettes migrating over the dry land
    const H = totalPop(g, 'herds'), Pd = totalPop(g, 'predators');
    if (H <= 0 && Pd <= 0) return;
    let x0 = -1, x1 = -1;
    for (let x = 0; x < WW; x++) if (g.zoneMap[x] !== 0 && !(g.water.col[x >> 1] === 1 && this.gy[x] > sea + 1)) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 < 0 || x1 - x0 < 30) return;
    const span = x1 - x0;
    const startled = t - this.alarm < 2.5 ? 2.5 : 1;
    const col = lerp3([34, 26, 24], sky.hor, 0.12).map((v) => v * (1 - (1 - sky.light) * 0.5));
    const nH = Math.min(low ? 8 : 16, Math.ceil(H / 2)), nP = Math.min(4, Math.ceil(Pd / 2));
    const head = t * 2.2 + (t - this.alarm < 2.5 ? (t - this.alarm) * 4 : 0);
    const wrap = (v: number) => x0 + ((v % span) + span) % span;
    const beast = (x: number, kind: 'herd' | 'pred', i: number) => {
      if (x < x0 || x > x1) return;
      const xi = Math.round(x), gy = this.gy[xi] - 1;
      const step = Math.sin(t * (kind === 'pred' ? 9 : 6) * startled + i * 1.7) > 0;
      c.fillStyle = rgb(col[0], col[1], col[2], 0.95);
      if (kind === 'herd') {
        c.fillRect(xi - 2, gy - 3, 4, 2);                 // body
        c.fillRect(xi + 2, gy - 4, 1, 2);                 // neck and head
        c.fillRect(xi - 2 + (step ? 0 : 1), gy - 1, 1, 1); // legs
        c.fillRect(xi + 1 - (step ? 0 : 1), gy - 1, 1, 1);
        if (i % 5 === 0) c.fillRect(xi + 2, gy - 5, 1, 1); // a horn, a tall one
      } else {
        c.fillRect(xi - 2, gy - 2, 4, 1);
        c.fillRect(xi + 2, gy - 3, 1, 1);
        c.fillRect(xi - 2 + (step ? 0 : 1), gy - 1, 1, 1);
        c.fillRect(xi + 1 - (step ? 0 : 1), gy - 1, 1, 1);
      }
    };
    for (let i = 0; i < nH; i++) beast(wrap(head - i * 6 - (i % 2) * 2 + Math.sin(t * 0.7 + i) * 1.5), 'herd', i);
    for (let i = 0; i < nP; i++) {
      const lag = Math.max(0, Math.sin(t * 0.3 + i * 2)) * 14;
      beast(wrap(head - nH * 6 - 14 - i * 8 + lag), 'pred', i);
    }
  }

  // ---------- diorama ----------
  /** Three planes: far mountains (lighter, bluer, hazed), middle hills, near hills; each lags the camera differently. */
  private drawPlanes(g: Game, sky: Sky): void {
    const c = this.ctx;
    const lay = this.lay;
    const green = Math.min(1, (totalPop(g, 'mosses') + totalPop(g, 'trees')) / 30);
    const night = 1 - sky.light;
    const cols = [
      lerp3(sky.hor, [120, 130, 170], 0.35),
      lerp3(lerp3([110, 96, 84], [86, 112, 78], green), sky.hor, 0.35),
      lerp3(lerp3([84, 72, 62], [62, 92, 52], green), sky.hor, 0.15),
    ].map((col) => col.map((v) => v * (1 - night * 0.55)));
    const bases = [lay.groundBase - 8 + lay.shift * 0.5, lay.groundBase - 4 + lay.shift * 0.3, lay.groundBase + lay.shift * 0.1];
    // haze where the far mountains meet the sky
    const fogTop = bases[0] - 38, fogBot = bases[0] - 4;
    for (let l = 0; l < 3; l++) {
      const h = this.planes[l];
      const img = skin(`world/hills/${['far', 'mid', 'near'][l]}.png`);
      if (img) {
        // painted hills: multiplied by the air between us and them (far = more horizon colour) and by the night
        const iw = img.naturalWidth, ih = img.naturalHeight;
        // before land life the green hills are bare: multiplied toward ochre-brown, greening with mosses and trees
        const bare = l === 0 ? 0 : 1 - green;
        const base = lerp3([255, 255, 255], [214, 186, 150], bare * 0.8);
        const tint = lerp3(base, sky.hor, [0.5, 0.24, 0.08][l]).map((v) => v * (1 - night * 0.55));
        const t = tintedCanvas(img, iw, ih, tint, l === 0 ? 0.12 : 0);
        // far: sits on the horizon; mid and near: their crest only a little above the land, the rest behind it
        const top = Math.round(l === 0 ? bases[0] + 6 - ih : bases[l] - [0, 22, 18][l]);
        for (let ox = 0; ox < WW; ox += iw) c.drawImage(t, 0, 0, iw, ih, ox, top, iw, ih);
        // fill below the picture down to the ground line so no sky shows through
        const bot = top + ih;
        if (bot < lay.groundBase + 4) { c.fillStyle = rgb(cols[l][0], cols[l][1], cols[l][2]); c.fillRect(0, bot, WW, lay.groundBase + 4 - bot); }
      } else for (let x = 0; x < WW; x++) {
        const y = Math.round(bases[l] - h[x]);
        c.fillStyle = rgb(cols[l][0], cols[l][1], cols[l][2]);
        c.fillRect(x, y, 1, lay.groundBase + 4 - y);
        if (l === 0 && this.winterAmount() > 0.5 && g.run.era >= 3 && h[x] > 26) { c.fillStyle = 'rgba(236,240,248,0.7)'; c.fillRect(x, y, 1, 2); }
      }
      if (l === 0) {
        const fog = c.createLinearGradient(0, fogTop, 0, fogBot + 10);
        const fc = lerp3(sky.hor, [230, 232, 240], 0.3);
        fog.addColorStop(0, rgb(fc[0], fc[1], fc[2], 0));
        fog.addColorStop(0.7, rgb(fc[0], fc[1], fc[2], 0.35 * (0.5 + 0.5 * sky.light)));
        fog.addColorStop(1, rgb(fc[0], fc[1], fc[2], 0.1));
        c.fillStyle = fog; c.fillRect(0, fogTop, WW, fogBot + 10 - fogTop);
      }
    }
  }

  /** Ground profile: seabed under the water, a gentle slope water → sand → grass, rolling hills on land. */
  /** How the land swells where more is being laid down now (eased): fresh thickness per column against the mean. */
  private swell = new Float32Array(WW);
  private swellAge = 9;
  /** The ground line: the top of the particles, smoothed across ±3 columns and eased in time, so creatures and
   *  plants stand on it without jumping when a pile lands. */
  private computeGround(g: Game): void {
    const lay = this.lay;
    const sec = this.section;
    const dy = lay.sectionTop;
    const raw = new Float32Array(WW);
    for (let x = 0; x < WW; x++) raw[x] = dy + sec.topD[x];
    const k = this.gyInit ? Math.min(1, this.dt * 3) : 1;
    this.gyInit = true;
    for (let x = 0; x < WW; x++) {
      let s2 = 0, n = 0;
      for (let d = -3; d <= 3; d++) { const xx = x + d; if (xx >= 0 && xx < WW) { s2 += raw[xx]; n++; } }
      const t = Math.min(raw[x], s2 / n);
      this.gyF[x] += (t - this.gyF[x]) * k;
      this.gy[x] = Math.round(this.gyF[x]);
    }
    lay.seaY = g.water.level * 2 + (dy - CFG.B.layout.sectionTop);
  }
  private gyF = new Float32Array(WW);
  private gyInit = false;

  groundY(x: number, g?: Game): number { void g; return this.gy[Math.max(0, Math.min(WW - 1, Math.round(x)))]; }

  private drawGround(g: Game, sky: Sky): void {
    const c = this.ctx;
    const lay = this.lay;
    const r = g.run;
    const sea = lay.waterLevel;
    const bottom = lay.sectionTop;
    const night = 1 - sky.light;
    const drought = r.active.some((a) => a.id === 'drought');
    const glacier = r.active.some((a) => a.id === 'glacier');
    const green = Math.min(1, (totalPop(g, 'mosses') + totalPop(g, 'trees')) / 30) * (drought ? 0.3 : 1);
    const winter = this.winterAmount() > 0.5 && r.era >= 3;
    const t = this.t;
    const s4 = this.seasonPhase * 4;
    const grass = s4 < 1 ? [112, 168, 72] : s4 < 2 ? [84, 136, 52] : s4 < 3 ? [176, 132, 60] : [120, 110, 80];
    const dust = drought ? [200, 170, 120] : r.era < 3 ? [146, 126, 102] : [150, 130, 100];
    const sand = [206, 180, 124];
    const nf = (k: number) => 1 - night * k;
    // 1) the ground plane and the water body
    for (let x = 0; x < WW; x++) {
      const gy = this.gy[x];
      const wet = Math.max(0, Math.min(1, (gy - sea + 8) / 10));
      let top = lerp3(r.era < 3 || green < 0.05 ? dust : lerp3(dust, grass, green), sand, wet);
      if (glacier || winter) top = lerp3(top, [232, 238, 246], gy < sea ? 0.9 : 0.4);
      const cut = gy; // the particles are the ground now: no painted ground plane under them
      void bottom;
      const bare = green < 0.05 || glacier || winter;
      for (let y = gy; y < cut; y++) {
        const rel = y - gy;
        const under = y > sea ? 0.65 : 1;
        let col: number[];
        if (bare) {
          // calm dunes: a lit rim on top, then a smooth fall into darker ground; the grain stays quiet
          const lit = rel < 1 ? 1.1 : 1;
          const grad = 1 - 0.42 * Math.min(1, rel / 16);
          const q = (GRAIN[((y & 255) << 8) | ((x * 3) & 255)] - 0.5) * 0.06;
          const f = grad * lit + q;
          col = [top[0] * f, top[1] * f, top[2] * f];
        } else {
          // soil profile: dark humus under the grass, lighter subsoil below; sand toward the water
          const n = NOISE[((y * 7) & 255) * 256 + ((x * 5 + y * 3) & 255)];
          const prof = lerp3([66, 48, 34], [158, 126, 90], Math.min(1, Math.max(0, rel - 2) / 20));
          col = lerp3(prof, sand.map((v) => v * (0.8 + 0.2 * (1 - rel / 30))), wet).map((v) => v * (0.94 + (n - 0.5) * 0.12));
        }
        if (y >= cut - 1) col = col.map((v) => v * 0.6);
        c.fillStyle = rgb(col[0] * nf(0.55) * under, col[1] * nf(0.55) * (under + (1 - under) * 0.1), col[2] * nf(0.5) * (under + (1 - under) * 0.3));
        c.fillRect(x, y, 1, 1);
      }
      if (g.water.col[x >> 1] === 1 && gy > sea) {
        for (let y = sea; y < gy; y++) {
          const k = (y - sea) / Math.max(1, bottom - sea);
          const shaft = Math.max(0, Math.sin(x * 0.12 + y * 0.25 - t * 0.6)) ** 6 * 0.25 * sky.light;
          const base = lerp3(lerp3(sky.hor, [46, 96, 124], 0.55), [12, 36, 58], k);
          // translucent: what sinks through the water (a tapped pile) shows through it, tinted; the section paints
          // the open water itself, darker with depth
          const a = Math.min(0.5, 0.3 + (y - sea) * 0.01);
          c.fillStyle = rgb(base[0] * nf(0.5) + shaft * 120, base[1] * nf(0.5) + shaft * 140, base[2] * nf(0.45) + shaft * 120, a);
          c.fillRect(x, y, 1, 1);
        }
      }
      // (no grass blades scattered under the surface: below the ground line are the strata now)
    }
    // 2) painted top edges of the zones: barren (era 0, before land life) → grass with it; beach at the shore;
    //    the water surface strip. Zones blend over ~20 px, so no vertical walls.
    this.drawSurfaceEdges(g, sea, night, green, glacier || winter);
    // 3) water life on top: ripples, the sun's glitter, surf foam, ice
    for (let x = 0; x < WW; x++) {
      const gy = this.gy[x];
      if (g.water.col[x >> 1] !== 1 || gy <= sea) continue;
      const wave = Math.sin(x * 0.5 + t * 2) + Math.sin(x * 0.2 - t * 1.3);
      c.fillStyle = rgb(200, 230, 245, 0.45 + wave * 0.15);
      c.fillRect(x, sea + (wave > 1 ? -1 : 0), 1, 1);
      if (this.sunPos && this.sunPos.up && Math.abs(x - this.sunPos.x) < 6 + this.sunPos.low * 10 && Math.sin(t * 7 + x * 1.7) > 0.4) {
        c.fillStyle = rgb(255, 240, 200, 0.75 - this.sunPos.low * 0.2);
        c.fillRect(x, sea + 1 + ((x * 3) % 3), 1, 1);
      }
      if (glacier) { c.fillStyle = 'rgba(220,235,245,0.85)'; c.fillRect(x, sea, 1, 2); }
      if (gy - sea <= 3 && (x === 0 || this.gy[x - 1] > sea + 3 || this.gy[x + 1] > sea + 3 || gy - sea <= 1)) {
        const fm = Math.sin(t * 2.4 + x * 0.9);
        if (fm > -0.3) { c.fillStyle = rgb(240, 246, 250, 0.55 + fm * 0.35); c.fillRect(x, sea + (fm > 0.5 ? 0 : 1), 1, 1); }
      }
    }
    this.drawTraces(g);
    const vfx = r.active.find((a) => a.id === 'volcanoFx');
    if (vfx && vfx.x !== undefined) {
      const gy = this.gy[Math.max(0, Math.min(WW - 1, vfx.x))];
      for (let k = 0; k < 10; k++) { c.fillStyle = k < 2 ? '#ff7a2a' : '#4a3a34'; c.fillRect(Math.round(vfx.x - 10 + k), gy - k, Math.round(20 - k * 2), 1); }
    }
  }

  /** Zone edge weights, blurred over ±10 columns (recomputed when the zones change). */
  private edgeW: { sig: string; land: Float32Array } = { sig: '', land: new Float32Array(WW) };

  private drawSurfaceEdges(g: Game, sea: number, night: number, green: number, snow: boolean): void {
    const imgs = { grass: skin('world/surface/grass.png'), beach: skin('world/surface/beach.png'), water: skin('world/surface/water.png'), barren: skin('world/surface/barren.png') };
    if (!imgs.grass && !imgs.beach && !imgs.water && !imgs.barren) return;
    const c = this.ctx;
    let sig = '';
    for (let x = 0; x < WW; x += 6) sig += g.zoneMap[x];
    if (sig !== this.edgeW.sig) {
      this.edgeW.sig = sig;
      for (let x = 0; x < WW; x++) {
        let n = 0, k = 0;
        for (let d = -10; d <= 10; d++) { const xx = x + d; if (xx < 0 || xx >= WW) continue; n++; if (g.zoneMap[xx] === 2) k++; }
        this.edgeW.land[x] = n ? k / n : 0;
      }
    }
    const LIFT = 3; // tile rows that stand above the ground line (blades, pebbles)
    // the strips take the night and the snow like the rest of the ground (tinted copies, so the sky behind is untouched)
    const f = 1 - night * 0.55;
    const tint = snow ? [235, 240, 250].map((v) => v * f) : [255 * f, 255 * f, 255 * (1 - night * 0.45)];
    const T: Record<string, HTMLCanvasElement | null> = {};
    for (const k of ['grass', 'beach', 'water', 'barren'] as const) {
      const im = imgs[k];
      T[k] = im ? (this.edgeTiles[k] = tintInto(this.edgeTiles[k], im, tint)) : null;
    }
    const col = (img: HTMLCanvasElement | null, x: number, y: number, a: number, limit: number) => {
      if (!img || a <= 0.01) return;
      const h = Math.min(img.height, limit - y);
      if (h <= 0) return;
      c.globalAlpha = Math.min(1, a);
      c.drawImage(img, x % img.width, 0, 1, h, x, y, 1, h);
    };
    const floorAt = (x: number) => this.lay.sectionTop + this.section.topD[x];
    for (let x = 0; x < WW; x++) {
      const gy = this.gy[x];
      if (g.water.col[x >> 1] === 1 && gy > sea + 1) {
        // under water: the surface strip of the water itself (ripples and glints go on top)
        col(T.water, x, sea - 1, Math.min(1, (gy - sea) / 4) * 0.8, gy);
        continue;
      }
      const lw = this.edgeW.land[x];
      col(T.beach ?? T.barren, x, gy - LIFT, green < 0.05 ? 1 - lw * 0.85 : 1, floorAt(x));
      col(T.barren ?? T.grass, x, gy - LIFT, lw * (green < 0.05 ? 0.22 : 1), floorAt(x));
      if (!snow) col(T.grass, x, gy - LIFT, lw * green, floorAt(x));
    }
    c.globalAlpha = 1;
  }
  private edgeTiles: Record<string, HTMLCanvasElement | undefined> = {};

  private drawTraces(g: Game): void {
    const r = g.run;
    const T = CFG.story.traces;
    if (g.meta.prestiges > 0 || r.year >= T.endYear) return;
    const c = this.ctx;
    for (let i = 0; i < T.count; i++) {
      const erase = CFG.startYear + ((i + 1) / T.count) * (T.endYear - CFG.startYear);
      const a = Math.max(0, Math.min(1, (erase - r.year) / 1800)) * 0.8;
      if (a <= 0) continue;
      const x0 = Math.round(r.waterEnd + 10 + hash2(i, 31) * (WW - r.waterEnd - 34));
      const len = Math.round(8 + hash2(i, 32) * 18);
      const yb = this.gy[Math.min(WW - 1, x0)] + 3 + Math.round(hash2(i, 33) * 16);
      if (i % 3 === 0) {
        const w = Math.round(len * 0.6);
        c.fillStyle = rgb(176, 170, 160, a);
        c.fillRect(x0, yb - 3, w, 1); c.fillRect(x0, yb - 3, 1, 3); c.fillRect(x0 + w - 1, yb - 3, 1, 3);
      } else {
        c.fillStyle = rgb(120, 120, 118, a); c.fillRect(x0, yb, len, 1);
        c.fillStyle = rgb(210, 206, 190, a * 0.6);
        for (let x = x0 + 1; x < x0 + len; x += 4) c.fillRect(x, yb, 2, 1);
      }
    }
  }

  private segments(g: Game): { zi: number; x0: number; x1: number }[] {
    const segs: { zi: number; x0: number; x1: number }[] = [];
    let s = 0;
    for (let x = 1; x <= WW; x++) if (x === WW || g.zoneMap[x] !== g.zoneMap[s]) { segs.push({ zi: g.zoneMap[s], x0: s, x1: x - 1 }); s = x; }
    return segs;
  }

  /** Each drawn plant or person: its generation (a new one after a burial), its ground, when it was born, until
   *  when it lies buried. */
  private lifeAt = new Map<string, { gen: number; y0: number; born: number; until: number; scare?: number }>();

  /** A puff of dust where a pile buried something living. */
  private burialPuff(x: number, y: number): void {
    if (this.particles.length > 300) return;
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 6 + Math.random() * 10;
      this.particles.push({ x: x + (Math.random() - 0.5) * 3, y: y - 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.6 + Math.random() * 0.4, color: k % 2 ? '#8a7a64' : '#b8a888', size: 1 });
    }
  }

  /** Living surface: a sample of each species with idle behaviour; wolves stalk the herds; everyone looks up when startled. */
  private drawLife(g: Game): void {
    const c = this.ctx;
    const t = this.t;
    const lay = this.lay;
    const segs = this.segments(g);
    const since = t - this.alarm;
    const caps: Record<string, number> = { mat: 8, plankton: 14, mollusc: 6, fish: 7, moss: 18, tree: 24, insect: 8, bird: 5, herd: 6, predator: 4, hominid: 5, tribe: 8 };
    const queue: { y: number; draw: () => void }[] = [];
    const herdXs: number[] = [];
    // where there is water now (the sea and the flooded lowland) and how deep: piles can fill the sea, the sea
    // can flood the lowland, so life finds its place by the real surface, not by the zone map
    const sea = lay.waterLevel;
    const wet = new Uint8Array(WW);
    for (let x = 0; x < WW; x++) wet[x] = g.water.col[x >> 1] === 1 && this.gy[x] > sea + 1 ? 1 : 0;
    const swim: { x0: number; x1: number }[] = [];
    for (let x = 0; x < WW;) {
      if (!wet[x] || this.gy[x] < sea + 7) { x++; continue; }
      let x1 = x;
      while (x1 + 1 < WW && wet[x1 + 1] && this.gy[x1 + 1] >= sea + 7) x1++;
      if (x1 - x >= 7) swim.push({ x0: x, x1 });
      x = x1 + 1;
    }
    const swimW = swim.reduce((a, r) => a + r.x1 - r.x0 + 1, 0);
    /** The nearest dry column of zone zi to x (or -1). */
    const dryNear = (x: number, zi: number): number => {
      for (let d = 0; d < 48; d++) for (const xx of [x - d, x + d]) {
        if (xx < 0 || xx >= WW) continue;
        if (!wet[xx] && g.zoneMap[xx] === zi) return xx;
      }
      return -1;
    };
    for (const pass of [0, 1]) for (const sp of CFG.species) {
      if ((sp.sprite === 'predator') !== (pass === 1)) continue;
      // a thousand years a second: no single fish or deer stays long enough to be seen; the sea, the sky and the
      // far land show them as a whole (drawBackdropLife, drawFlyingBirds)
      if (BACKDROP.has(sp.sprite)) continue;
      const p = g.run.pop[sp.id];
      for (let zi = 0; zi < 3; zi++) {
        if (p[zi] <= 0) continue;
        const cap = this.quality === 'high' ? caps[sp.sprite] ?? 5 : Math.ceil((caps[sp.sprite] ?? 5) / 2);
        // small plants stand thick (a forest reads as a forest); animals and people are a sample
        const n = Math.min(cap, Math.ceil(p[zi] / (sp.sprite === 'plankton' || sp.sprite === 'moss' ? 1 : sp.sprite === 'tree' ? 1.3 : 3)));
        const zsegs = segs.filter((s) => s.zi === zi);
        const width = zsegs.reduce((a, s) => a + s.x1 - s.x0 + 1, 0);
        for (let i = 0; i < n; i++) {
          // each one drawn has its own place; when it is buried, the next one grows elsewhere (gen)
          const key = sp.id + ':' + zi + ':' + i;
          const gen = this.lifeAt.get(key)?.gen ?? 0;
          let u = hash2(i * 13 + zi + gen * 101, sp.idx * 7 + 1 + gen) * width;
          let bx = 0;
          for (const s of zsegs) { const w = s.x1 - s.x0 + 1; if (u < w) { bx = s.x0 + u; break; } u -= w; }
          if (sp.id === 'mats' && zi === 0 && !g.mods.shards) bx = Math.max(1, Math.min(g.run.waterEnd - 3, CFG.story.horizon.lifeSeedX + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 6));
          const h = hash2(i, sp.idx);
          const mobile = sp.sprite === 'herd' || sp.sprite === 'predator' || sp.sprite === 'hominid' || sp.sprite === 'tribe';
          const cycle = (t * 0.07 + h) % 1;
          const walking = mobile && cycle > 0.6 ? 1 : 0;
          let x = bx + (walking || sp.sprite === 'fish' ? Math.sin(t * 0.05 + h * 6) * 10 : 0);
          let flip = Math.cos(t * 0.05 + h * 6) < 0;
          // now and then someone stops and looks up
          const curious = Math.sin(t * 0.31 + h * 40) > 0.96;
          const alert = since < 1.8 || curious ? 1 : 0;
          if (sp.sprite === 'predator' && herdXs.length) {
            // a slow stalk toward the nearest herd animal, then back off
            const prey = herdXs.reduce((a, b) => (Math.abs(b - bx) < Math.abs(a - bx) ? b : a), herdXs[0]);
            const k = 0.5 + 0.5 * Math.sin(t * 0.08 + h * 5);
            x = lerp(bx, prey + (bx < prey ? -12 : 12), k);
            flip = prey < x;
          }
          const pose: Pose = { t: t + h * 10, i, flip, alert, walk: walking || sp.sprite === 'predator' ? 1 : 0, season: this.seasonPhase, tint: sp.tint };
          const swimmer = sp.sprite === 'fish' || sp.sprite === 'plankton';
          const bed = sp.sprite === 'mollusc' || (sp.sprite === 'mat' && zi === 0);
          let y: number;
          if (swimmer) {
            // in open water only: a run of water deep enough, never through the ground
            if (!swimW) continue;
            let u2 = hash2(i * 13 + zi, sp.idx * 7 + 1) * swimW;
            let run = swim[0];
            for (const r of swim) { const w = r.x1 - r.x0 + 1; if (u2 < w) { run = r; break; } u2 -= w; }
            const cx = run.x0 + 3 + h * Math.max(1, run.x1 - run.x0 - 6);
            const amp = Math.min(16, (run.x1 - run.x0) / 2 - 3);
            x = sp.sprite === 'fish'
              ? cx + Math.sin(t * (0.4 + h * 0.3) + h * 9) * amp + (since < 1.5 ? (h > 0.5 ? 1 : -1) * since * 20 : 0)
              : cx + Math.sin(t * 0.05 + h * 6) * amp * 0.3;
            x = Math.max(run.x0 + 3, Math.min(run.x1 - 3, x));
            if (sp.sprite === 'fish') pose.flip = Math.cos(t * (0.4 + h * 0.3) + h * 9) < 0;
            // between the surface and the bed under it (and the bed a few pixels around: the fish is 8 px long)
            const xi2 = Math.round(x);
            let bot = this.gy[xi2];
            for (let d = -4; d <= 4; d++) bot = Math.min(bot, this.gy[Math.max(0, Math.min(WW - 1, xi2 + d))]);
            const room = bot - sea - 7;
            if (room < 0) continue;
            y = Math.round(sea + 4 + hash2(i, sp.idx + 99) * room);
          } else if (bed) {
            // on the sea floor, in water if there is any
            if (zi === 0 && !wet[Math.round(bx)] && swimW) {
              let u2 = hash2(i * 17 + 3, sp.idx) * swimW;
              for (const r of swim) { const w = r.x1 - r.x0 + 1; if (u2 < w) { bx = r.x0 + u2; break; } u2 -= w; }
            }
            x = bx;
            y = this.gy[Math.max(0, Math.min(WW - 1, Math.round(x)))];
          } else if (sp.sprite === 'bird' && wet[Math.round(bx)]) {
            // over the water a bird flies (it does not sit on the sea floor)
            const fx = bx + Math.sin(t * 0.3 + h * 7) * 20, fy = sea - 10 - h * 26 + Math.sin(t * 1.3 + h * 4) * 2;
            queue.push({ y: 999, draw: () => birdFlying(c, fx, fy, pose) });
            continue;
          } else {
            // on dry ground: never under the water and never inside the strata
            const home = wet[Math.round(bx)] ? dryNear(Math.round(bx), zi) : Math.round(bx);
            if (home < 0) continue;
            if (home !== Math.round(bx)) { x += home - bx; bx = home; }
            if (x < 0 || x >= WW || wet[Math.round(x)]) x = bx;
            const xi2 = Math.max(0, Math.min(WW - 1, Math.round(x)));
            // a pixel or two of depth for a crowd (who stands in front), the roots of a tree a little deeper
            const sink = sp.sprite === 'tree' ? 1 + Math.round(hash2(i, sp.idx + 99) * 2) : Math.round(hash2(i, sp.idx + 99) * 2);
            y = this.gy[xi2] + sink;
          }
          // rooted life and people keep their own ground: a pile (or the drizzle) that covers them buries them — a puff
          // of dust, gone — and later a new one sprouts (plants grow up from nothing) or walks in elsewhere. When the
          // ground goes down (the conveyor), they go down with it. They never ride a pile up.
          let grow = 1;
          const rooted = sp.sprite === 'tree' || sp.sprite === 'moss' || sp.sprite === 'mat';
          const walker = sp.sprite === 'hominid' || sp.sprite === 'tribe';
          if (rooted || walker) {
            const ax = Math.max(0, Math.min(WW - 1, Math.round(rooted ? bx : x)));
            const raw = lay.sectionTop + this.section.topD[ax];
            let st = this.lifeAt.get(key);
            if (!st) { st = { gen, y0: raw, born: t - 60, until: 0 }; this.lifeAt.set(key, st); }
            if (st.until > 0) {
              if (t < st.until) continue;
              st.until = 0; st.born = t; st.y0 = raw;
            } else if (rooted && raw < st.y0 - 2) {
              // buried where it stood (core/sources.ts buryLife turns a share of them into sealed organics)
              st.until = t + (sp.sprite === 'tree' ? 5 + h * 6 : sp.sprite === 'moss' ? 2 + h * 3 : 2.5);
              st.gen++;
              this.burialPuff(ax, st.y0);
              continue;
            } else if (walker && raw < st.y0 - 4) {
              // a pile came down by a person: they jump aside and climb onto it — people are never buried
              st.scare = t;
              st.y0 = raw;
            } else if (raw > st.y0 || walker) st.y0 = raw;
            grow = Math.min(1, (t - st.born) / (sp.sprite === 'tree' ? 8 : sp.sprite === 'moss' ? 2.5 : 0.6));
            y = st.y0;
            if (walker && t - (st.scare ?? -9) < 1.6) { pose.alert = 1; pose.walk = 1; x += (h > 0.5 ? 1 : -1) * Math.min(6, (t - st.scare!) * 10); if (t - st.scare! < 0.3) y -= 2; }
          }
          if (sp.sprite === 'herd') herdXs.push(x);
          if (sp.sprite === 'bird' && since < 5) {
            const k = since / 5;
            const fx = x + (h - 0.5) * 60 * k, fy = y - 4 - Math.sin(k * Math.PI) * 40;
            queue.push({ y: 999, draw: () => birdFlying(c, fx, fy, pose) });
            continue;
          }
          if (sp.sprite === 'mollusc') {
            // shells on the bed: a pale fleck or two, no animal
            const sx = Math.round(x), sy = Math.round(y) - 1, shell = ['#e6d2ae', '#d0b4c8', '#dcc09a'][i % 3];
            queue.push({ y: sy, draw: () => { c.fillStyle = shell; c.fillRect(sx, sy, 2, 1); if (h > 0.5) c.fillRect(sx + 3, sy, 1, 1); } });
            continue;
          }
          if (sp.sprite === 'insect') {
            // a swarm over the plants: a cloud of specks that drifts and hums
            const sx = x, sy = y - 9 - h * 6;
            queue.push({ y: 999, draw: () => swarm(c, sx, sy, t + h * 10, 6, '#2e3a40') });
            continue;
          }
          // at the scale of the strata (creatures.ts): a tree is at most two piles tall
          const small = sp.sprite === 'tree' ? (gx: number, gy2: number) => treeSmall(c, gx, gy2, pose, grow)
            : sp.sprite === 'moss' ? (gx: number, gy2: number) => mossSmall(c, gx, gy2, pose, grow)
            : sp.sprite === 'hominid' ? (gx: number, gy2: number) => personSmall(c, gx, gy2, pose)
            : sp.sprite === 'tribe' ? (gx: number, gy2: number) => personSmall(c, gx, gy2, pose, i % 3 === 0)
            : sp.sprite === 'mat' ? (gx: number, gy2: number) => matFilm(c, gx, gy2, pose) : null;
          if (small) {
            const fx2 = x, fy2 = y, glowIt = g.mods.living && i % 3 === 0;
            queue.push({ y: fy2, draw: () => { small(fx2, fy2); if (glowIt) CREATURES.glow(c, fx2 + 1, fy2 - 3, pose); } });
            continue;
          }
          const fn = CREATURES[sp.sprite] ?? CREATURES.glow;
          const fx = x, fy = y, living = g.mods.living && i % 3 === 0;
          const shadow = zi !== 0 && !['tree', 'herd', 'predator', 'hominid', 'tribe', 'insect'].includes(sp.sprite);
          queue.push({ y: fy + (sp.sprite === 'tree' ? -0.5 : 0), draw: () => {
            if (shadow) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(Math.round(fx) - 3, Math.round(fy), 7, 1); }
            fn(c, fx, fy, pose);
            if (living) CREATURES.glow(c, fx + 2, fy - 5, pose);
          } });
        }
      }
    }
    queue.sort((a, b) => a.y - b.y);
    for (const q of queue) q.draw();
    // new creatures come up from the ground with a soft flash
    for (let i = this.spawns.length - 1; i >= 0; i--) {
      const s = this.spawns[i];
      s.t += this.dt;
      if (s.t > 0.7) { this.spawns.splice(i, 1); continue; }
      const a = 1 - s.t / 0.7;
      c.fillStyle = rgb(255, 236, 170, a * 0.8);
      c.fillRect(Math.round(s.x) - 1, Math.round(s.y) - Math.round(s.t * 10), 3, 2 + Math.round(s.t * 8));
    }
    if (g.run.era >= 6 && g.state.phase === 'play') this.drawCamp(g);
  }

  private drawCamp(g: Game): void {
    const c = this.ctx;
    const x = WW / 2;
    const gy = this.gy[x] + 1;
    if (!(g.run.era >= 7 || g.settlePop() > 0)) return;
    const f = 0.6 + 0.4 * Math.sin(this.t * 9) * Math.sin(this.t * 13);
    c.fillStyle = rgb(255, 180, 60, f); c.fillRect(x + 9, gy - 3, 3, 2);
    c.fillStyle = '#ffe080'; c.fillRect(x + 10, gy - 4, 1, 1);
    for (const dx of [-16, 22]) {
      c.fillStyle = '#16121a'; c.beginPath(); c.moveTo(x + dx - 6, gy + 1); c.lineTo(x + dx, gy - 10); c.lineTo(x + dx + 6, gy + 1); c.fill();
      c.fillStyle = '#7a5a3c'; c.beginPath(); c.moveTo(x + dx - 5, gy); c.lineTo(x + dx, gy - 9); c.lineTo(x + dx + 5, gy); c.fill();
      c.fillStyle = '#2a1e14'; c.fillRect(x + dx - 1, gy - 3, 2, 3);
    }
    if (Math.random() < this.dt * 8) this.particles.push({ x: x + 10, y: gy - 4, vx: (Math.random() - 0.5) * 4, vy: -10 - Math.random() * 8, life: 0, max: 0.8 + Math.random() * 0.6, color: Math.random() < 0.5 ? '#ffb040' : '#ff7020', size: 1, kind: 'spark' });
    if (g.run.era >= 7) this.drawShaft(g, Math.min(1, g.run.excavation / Math.max(1, g.run.excavationNeed)));
  }

  private drawShaft(g: Game, k: number): void {
    const c = this.ctx;
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    xs.forEach((x, idx) => {
      const gy = this.gy[x];
      const prog = g.mods.shards ? Math.min(1, g.run.excavationShards[idx] / Math.max(1, g.run.excavationNeed)) : k;
      const depth = (this.ayAt(x) - 4 - gy) * prog;
      c.fillStyle = 'rgba(10,8,8,0.92)'; c.fillRect(x - 3, gy, 7, depth);
      c.fillStyle = 'rgba(120,90,60,0.6)';
      for (let y = gy; y < gy + depth; y += 5) c.fillRect(x - 3, y, 7, 1);
      const f = 0.7 + 0.3 * Math.sin(this.t * 11 + idx);
      c.fillStyle = rgb(255, 150, 50, 0.3 * f); c.beginPath(); c.arc(x, gy + depth - 3, 6, 0, 7); c.fill();
      c.fillStyle = rgb(255, 200, 90, f); c.fillRect(x, gy + depth - 4, 1, 2);
    });
  }

  // ---------- section ----------
  private drawSection(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const top = lay.sectionTop;
    const sec = this.section;
    // the grid has a fixed place in the world; an open drawer lifts the whole world (and the grid with it)
    const gdy = top - CFG.B.layout.sectionTop;
    c.drawImage(sec.canvas, 0, gdy);
    if (sec.cut !== Infinity) this.drawRibbon(g);
    const SW = sec.SW;
    // era boundaries: faint golden curves along the layers where an era began
    for (let e = 1; e <= g.run.era; e++) {
      const b = CFG.eras[e].start;
      c.fillStyle = 'rgba(242,181,74,0.16)';
      for (let x = 0; x < SW; x++) {
        const y = sec.yAt(x, b);
        if (y <= sec.topD[x] + 1 || y >= sec.strataH - 1 || y >= sec.cut) continue;
        c.fillRect(x, Math.round(top + y), 1, 1);
      }
    }
    this.drawSparks();
    // the heat windows (where heat is making rock now: a glow and wandering cracks) belong to the Geologist's view:
    // in the plain view they read as worms crawling in the strata
    if (this.geologist) this.drawHot(g);
    let drawn = 0;
    for (const f of sec.fossils) {
      if (f.fragment) { c.fillStyle = 'rgba(240,230,200,0.9)'; c.fillRect(f.x, top + f.y, 1, 1); continue; }
      if (drawn++ > 60) break;
      const sp = CFG.species[f.species];
      drawFossil(c, f.x, top + f.y, sp ? fossilKind(sp.id) : 'bone', f.rare, this.t);
    }
    // pixels that turned to rock under a press (or a glowing-layer event) flash
    let pfShown = 0;
    for (const pf of g.pressFlashes) {
      if (pfShown++ >= (this.quality === 'low' ? 8 : 24)) break;
      const y = Math.round(pf.y + gdy);
      const a = Math.min(1, pf.t * 1.6) * 0.7;
      c.fillStyle = pf.color; c.globalAlpha = a; c.fillRect(pf.x, y, 1, 1);
      c.fillStyle = 'rgba(255,240,200,1)'; c.globalAlpha = a * 0.4;
      c.fillRect(pf.x - 1, y, 1, 1); c.fillRect(pf.x + 1, y, 1, 1); c.fillRect(pf.x, y - 1, 1, 1); c.fillRect(pf.x, y + 1, 1, 1);
      c.globalAlpha = 1;
    }
    for (const z of sec.zones) for (let i = 0; i < z.pts.length; i += 2) {
      const ph = Math.sin(this.t * 3 + i * 1.7);
      if (ph < 0.3) continue;
      c.fillStyle = z.kind === 'water' ? rgb(140, 200, 255, ph * 0.8) : rgb(255, 140 + 60 * ph, 60, ph * 0.7);
      c.fillRect(z.pts[i], top + z.pts[i + 1], 1, 1);
    }
    // a rock is born: a spark where it happened — a white-hot core and arms in the colour of the new rock
    // (low quality: none)
    for (const gl of this.quality === 'low' ? [] : g.glints) {
      if (gl.x >= SW) continue;
      const gy = Math.round(gl.y + gdy);
      if (gy - top >= sec.cut) continue;
      const a = Math.min(1, gl.t / 0.3);
      c.globalAlpha = a;
      c.fillStyle = gl.color;
      c.fillRect(gl.x - 1, gy, 1, 1); c.fillRect(gl.x + 1, gy, 1, 1);
      c.fillRect(gl.x, gy - 1, 1, 1); c.fillRect(gl.x, gy + 1, 1, 1);
      c.fillStyle = '#fffaE6';
      c.fillRect(gl.x, gy, 1, 1);
      c.globalAlpha = 1;
    }
    if (this.hover && !this.targeting) {
      // only a small marker: a year does not lie on one line across the particles, so no band across the section
      c.fillStyle = 'rgba(242,181,74,0.9)'; c.fillRect(this.hover.x, top + this.hover.y - 1, 1, 3);
    }
    if (this.geologist) this.drawGeologist(g);
    if (this.targeting) {
      // a ghostly glow over the layers under the finger
      const tg = this.targeting;
      const cx = tg.x, cy = top + tg.y;
      const col = tg.kind === 'groundwater' ? [120, 190, 255] : [255, 140, 60];
      const grd = c.createRadialGradient(cx, cy, 2, cx, cy, tg.rx * 1.3);
      grd.addColorStop(0, rgb(col[0], col[1], col[2], 0.35 + 0.1 * Math.sin(this.t * 4)));
      grd.addColorStop(1, rgb(col[0], col[1], col[2], 0));
      c.fillStyle = grd; c.fillRect(cx - tg.rx * 1.3, cy - tg.rx * 1.3, tg.rx * 2.6, tg.rx * 2.6);
    }
  }

  /** Above an open drawer: the history ribbon — everything below the cut (the strata, the archive of the depth,
   *  the thing) squeezed into a thin strip, real colours of the beds; ticks of the epochs at its left edge. */
  private drawRibbon(g: Game): void {
    const c = this.ctx, sec = this.section, lay = this.lay;
    const y0 = Math.round(lay.sectionTop + sec.cut), H = RIBBON_H;
    c.fillStyle = '#14110f';
    c.fillRect(0, y0, WW, H);
    // the section canvas lies with its local y at canvas y + layout.sectionTop
    const sy = Math.max(0, Math.round(sec.cut + CFG.B.layout.sectionTop));
    const sh = Math.max(1, WH - sy);
    c.imageSmoothingEnabled = true;
    c.drawImage(sec.canvas, 0, sy, sec.SW, sh, 0, y0 + 1, sec.SW, H - 2);
    c.imageSmoothingEnabled = false;
    // epochs below the cut: how much of each lies there (particles of the middle column, then the archive)
    const amount = new Float64Array(CFG.eras.length);
    const grid = g.grid;
    const cx = Math.max(0, (GW >> 1) - 8);
    for (let r = Math.max(grid.surf[cx], sec.rowOfY(sec.cut)); r < grid.floor; r++) {
      const i = r * GW + cx;
      if (grid.mat[i] && grid.mat[i] !== CFG.matIndex.artifact) amount[eraOfYear(grid.birth[i])] += 2;
    }
    for (const L of g.archive.layers) amount[L.era] += Math.sqrt(g.archive.meanRows(L) / Math.max(1, L.k)) * 2;
    let tot = 0;
    for (const a of amount) tot += a;
    let y = y0 + 1;
    const inner = H - 2;
    for (let e = CFG.eras.length - 1; e >= 0 && tot > 0; e--) {
      if (amount[e] <= 0) continue;
      const h = Math.max(1, Math.round((amount[e] / tot) * inner));
      c.fillStyle = ERA_COLORS[e];
      c.fillRect(0, y, 2, Math.min(h, y0 + H - 1 - y));
      y += h;
    }
    // the thing glows at the bottom of history
    const ax = WW / 2, ay = y0 + H - 2;
    const grd = c.createRadialGradient(ax, ay, 0, ax, ay, 10);
    grd.addColorStop(0, 'rgba(255,214,120,0.8)'); grd.addColorStop(1, 'rgba(255,180,80,0)');
    c.fillStyle = grd; c.fillRect(ax - 10, ay - 10, 20, 12);
    c.fillStyle = 'rgba(242,181,74,0.55)'; c.fillRect(0, y0, sec.SW, 1);
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, y0 + H - 1, WW, 1);
  }

  /** Coal glints and amber sparks: a slow twinkle. */
  private drawSparks(): void {
    const pts = this.section.sparks, c = this.ctx, top = this.lay.sectionTop;
    for (let i = 0; i < pts.length; i += 2) {
      const ph = Math.sin(this.t * (0.9 + ((i >> 1) % 5) * 0.37) + i * 2.3);
      if (ph < 0.82) continue;
      const a = (ph - 0.82) / 0.18;
      c.fillStyle = rgb(255, 246, 220, 0.85 * a);
      c.fillRect(pts[i], top + pts[i + 1], 1, 1);
      if (a > 0.6) { c.fillStyle = rgb(255, 236, 190, 0.35 * a); c.fillRect(pts[i] - 1, top + pts[i + 1], 3, 1); c.fillRect(pts[i], top + pts[i + 1] - 1, 1, 3); }
    }
  }

  /** Hot cracks and smouldering veins — only where a transformation under heat or deep pressure runs now
   *  (usually near the thing). They fade out when it ends; the section is calm otherwise. */
  private drawHot(g: Game): void {
    const sec = this.section, c = this.ctx, top = this.lay.sectionTop;
    const SW = sec.SW;
    const k = Math.min(1, this.dt * 1.6);
    let any = false;
    for (let x = 0; x < SW; x++) {
      const tgt = g.hotNow[x >> 1];
      if (tgt > 0.01) {
        const y = g.hotY[x >> 1] * 2 - CFG.B.layout.sectionTop;
        this.hotY[x] = this.hot[x] < 0.02 ? y : this.hotY[x] + (y - this.hotY[x]) * k;
      }
      // in fast, out slowly
      this.hot[x] += (tgt - this.hot[x]) * (tgt > this.hot[x] ? k * 1.5 : k * 0.35);
      if (this.hot[x] > 0.03) any = true;
    }
    if (!any) return;
    // soft glow: one ellipse per hot run of columns
    c.globalCompositeOperation = 'lighter';
    let x = 0;
    while (x < SW) {
      if (this.hot[x] <= 0.03) { x++; continue; }
      let x1 = x, sy = 0, mx = 0, n = 0;
      while (x1 < SW && this.hot[x1] > 0.03) { sy += this.hotY[x1]; mx = Math.max(mx, this.hot[x1]); n++; x1++; }
      const cx = (x + x1) / 2, cy = top + sy / n, rx = Math.max(6, (x1 - x) / 2 + 5);
      const fl = 0.85 + 0.15 * Math.sin(this.t * 5.3 + cx);
      c.save();
      c.translate(cx, cy); c.scale(1, 0.45);
      const grd = c.createRadialGradient(0, 0, 1, 0, 0, rx);
      grd.addColorStop(0, rgb(255, 120, 40, 0.42 * mx * fl));
      grd.addColorStop(1, rgb(255, 60, 20, 0));
      c.fillStyle = grd; c.fillRect(-rx, -rx, rx * 2, rx * 2);
      c.restore();
      x = x1;
    }
    c.globalCompositeOperation = 'source-over';
    // hot cracks: short branching veins that wander down from the hot depth; yellow at the core, red at the ends,
    // a dark lip beside them; they flicker and go out with the heat
    for (let x0 = 0; x0 < SW; x0 += 5) {
      const h0 = this.hot[x0];
      if (h0 <= 0.06 || hash2(x0, 71) < 0.3) continue;
      let x = x0 + Math.floor(hash2(x0, 72) * 4), y = Math.round(this.hotY[x0] - 5 + hash2(x0, 73) * 8);
      const len = 6 + Math.floor(hash2(x0, 74) * 9 * Math.min(1, h0 * 1.5));
      for (let st = 0; st < len; st++) {
        const hx = this.hot[Math.max(0, Math.min(SW - 1, x))];
        const k2 = 1 - st / (len + 2);
        const fl = 0.7 + 0.3 * Math.sin(this.t * 7 + x0 * 0.9 + st * 0.6);
        const a = Math.min(1, hx * 1.6) * fl;
        if (a > 0.05) {
          c.fillStyle = rgb(28, 10, 6, 0.55 * Math.min(1, hx * 2));
          c.fillRect(x - 1, top + y, 1, 1);
          c.fillStyle = k2 > 0.6 && hx > 0.4 ? rgb(255, 220, 120, a) : rgb(255, 90 + 90 * k2, 30, a);
          c.fillRect(x, top + y, 1, 1);
        }
        const r = hash2(x0 * 13 + st, 75);
        y += r < 0.75 ? 1 : 0;
        x += r < 0.3 ? -1 : r > 0.6 ? 1 : 0;
        if (st === 3 && hash2(x0, 76) > 0.45) {
          // a side branch
          let bx = x, by = y;
          for (let q = 0; q < 4; q++) { bx += hash2(x0, 77) > 0.5 ? 1 : -1; by += q & 1; c.fillStyle = rgb(255, 110, 40, a * 0.75); c.fillRect(bx, top + by, 1, 1); }
        }
      }
    }
  }

  // ---------- Geologist ----------
  /** Recompute forecasts and temperatures on a coarse grid of the strata (cheap enough twice a second). */
  private refreshGeo(g: Game): void {
    const sec = this.section;
    const grid = g.grid;
    const CW = 4, CH = 8;                       // cell of the coarse grid: 2×4 particles
    this.geoCells = [];
    this.geoLayers = [];
    for (let cx = 0; cx < GW; cx += CW / 2) {
      for (let r = grid.surf[cx]; r < grid.floor; r += CH / 2) {
        const i = r * GW + cx;
        if (!grid.mat[i]) continue;
        const c = conditionsAt(g, cx, r);
        const f = forecastParticle(g, cx, r);
        this.geoCells.push({ x: cx * 2, y: sec.yOfRow(r), w: CW, h: CH, T: c.T, f, prog: grid.prog[i] });
      }
    }
    // plates: down a column near the right edge, a few forecasts at different depths
    const px = Math.max(0, Math.min(GW - 1, Math.floor((sec.SW - 30) / 2)));
    let lastMat = -1;
    for (let r = grid.surf[px] + 2; r < grid.floor; r += 3) {
      const i = r * GW + px;
      if (!grid.mat[i] || grid.mat[i] === lastMat) continue;
      lastMat = grid.mat[i];
      this.geoLayers.push({ j: this.geoLayers.length, x: px * 2, y: sec.yOfRow(r) + 1, h: 6, f: forecastParticle(g, px, r) });
    }
  }

  private drawGeologist(g: Game): void {
    this.geoAge += this.dt;
    if (this.geoAge > 0.5) { this.geoAge = 0; this.refreshGeo(g); }
    const c = this.ctx;
    const sec = this.section;
    const top = this.lay.sectionTop;
    // the section dims to 40%
    c.fillStyle = 'rgba(10,8,12,0.6)';
    for (let x = 0; x < sec.SW; x++) c.fillRect(x, top + sec.topD[x], 1, sec.horizonTop[x] - sec.topD[x]);
    // heat: a warm orange that grows with temperature
    for (const cell of this.geoCells) {
      if (cell.x >= sec.SW) continue;
      const a = Math.max(0, Math.min(1, (cell.T - 25) / 240));
      if (a < 0.03) continue;
      c.fillStyle = rgb(255, 120 + 60 * (1 - a), 40, 0.12 + 0.5 * a);
      c.fillRect(cell.x, top + cell.y, cell.w, cell.h);
    }
    // groundwater: blue veins through the wet layers
    for (const tz of g.run.targets) {
      if (tz.kind !== 'water') continue;
      for (let x = Math.max(0, tz.x0); x <= Math.min(sec.SW - 1, tz.x1); x++) {
        const ya = sec.yAt(x, tz.b1), yb = sec.yAt(x, tz.b0);
        for (let k = 1; k <= 3; k++) {
          const y = ya + ((yb - ya) * k) / 4 + Math.sin(x * 0.35 + k * 2 + this.t * 0.8) * 1.5;
          c.fillStyle = rgb(130, 200, 255, 0.85);
          c.fillRect(x, Math.round(top + y), 1, 1);
        }
      }
    }
    // transformation windows: where rock is being made now, a slow amber pulse in the colour of the future rock
    const pulse = 0.45 + 0.35 * Math.sin(this.t * 3);
    for (const cell of this.geoCells) {
      if (!cell.f || !cell.f.ok || cell.prog <= 0 || cell.x >= sec.SW) continue;
      c.fillStyle = CFG.materials[cell.f.toMat].palette[3] ?? '#f2b54a';
      c.globalAlpha = pulse * 0.5;
      c.fillRect(cell.x + 1, top + cell.y + 3, 2, 2);
      c.globalAlpha = 1;
    }
  }

  // ---------- press, taps, rare events, burial window ----------
  /** A tap's touch point flashes softly (the impulse itself rises from the thing). */
  tapAt(x: number, y: number): void { this.taps.push({ x, y, t: 0 }); }

  private drawTaps(dt: number): void {
    const c = this.ctx;
    for (let i = this.taps.length - 1; i >= 0; i--) {
      const tp = this.taps[i];
      tp.t += dt;
      const k = tp.t / 0.35;
      if (k >= 1) { this.taps.splice(i, 1); continue; }
      c.strokeStyle = rgb(255, 226, 160, (1 - k) * 0.6);
      c.beginPath(); c.arc(tp.x, tp.y, 2 + k * 6, 0, Math.PI * 2); c.stroke();
    }
  }

  /** The press: the layers under the finger squeeze in a wave running down, a ring of pressure, warm sparks. */
  private drawPress(dt: number): void {
    const p = this.press;
    if (!p) return;
    const c = this.ctx;
    const sec = this.section;
    const top = this.lay.sectionTop;
    const held = (performance.now() - p.t0) / 1000;
    const amp = Math.min(1.6, 0.6 + held * 0.35) * Math.min(1.5, p.power);
    const r = p.r;
    // the squeeze: rows inside the circle are redrawn shifted by a wave travelling downward
    for (let yy = -r; yy <= r; yy += 2) {
      const sy = Math.round(p.y - top + yy);
      const cy = sy + CFG.B.layout.sectionTop;
      if (cy < 0 || cy >= WH - 1) continue;
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - yy * yy)));
      if (half < 2) continue;
      const fall = 1 - Math.abs(yy) / r;
      const dy = Math.round(Math.sin(yy * 0.45 - this.t * 9) * amp * fall);
      if (!dy) continue;
      const x0 = Math.max(0, p.x - half), w = Math.min(WW, p.x + half) - x0;
      c.drawImage(sec.canvas, x0, cy, w, 2, x0, top + sy + dy, w, 2);
    }
    // a gentle darkening of what is squeezed, and the ring of pressure
    const grd = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, r);
    grd.addColorStop(0, 'rgba(40,20,10,0.28)'); grd.addColorStop(0.8, 'rgba(40,20,10,0.12)'); grd.addColorStop(1, 'rgba(40,20,10,0)');
    c.fillStyle = grd; c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    // warm heat building inside, stronger the longer it holds
    c.globalCompositeOperation = 'lighter';
    const heat = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, r * 0.8);
    heat.addColorStop(0, rgb(255, 150, 60, Math.min(0.3, 0.08 + held * 0.05) * Math.min(1.4, p.power))); heat.addColorStop(1, 'rgba(255,150,60,0)');
    c.fillStyle = heat; c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    c.globalCompositeOperation = 'source-over';
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
    // the ring of pressure: a solid warm edge and a faint outer echo that closes in
    const shrink = (this.t * 1.6) % 1;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const x = Math.round(p.x + Math.cos(a) * r), y = Math.round(p.y + Math.sin(a) * r);
      c.fillStyle = rgb(255, 196, 110, 0.55 + 0.35 * pulse);
      c.fillRect(x, y, 1, 1);
      if (k % 2 === 0) {
        const r2 = r + 6 * (1 - shrink);
        c.fillStyle = rgb(255, 220, 160, 0.4 * shrink);
        c.fillRect(Math.round(p.x + Math.cos(a) * r2), Math.round(p.y + Math.sin(a) * r2), 1, 1);
      }
    }
    // warm sparks along the edge
    for (let q = 0; q < 2; q++) if (Math.random() < dt * 30) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6 - 4, life: 0, max: 0.5 + Math.random() * 0.5, color: Math.random() < 0.5 ? '#ffb060' : '#ffe0a0', size: 1 });
    }
  }

  /** Where the rare event is on screen. */
  rarePos(g: Game): { x: number; y: number } | null {
    const ev = g.rare;
    if (!ev) return null;
    const life = CFG.rare.lifetime - ev.t;
    switch (ev.def.place) {
      case 'sky': {
        const y0 = Math.max(40, this.skyTop + 8), room = Math.max(6, this.lay.groundBase - 26 - y0);
        return { x: ev.x - life * 1.2, y: y0 + ((ev.x * 7) % room) + life * 0.6 };
      }
      case 'shore': return { x: ev.x, y: this.groundY(ev.x) - 1 };
      case 'land': return { x: ev.x, y: this.groundY(ev.x) - 4 };
      case 'section': case 'strata': return { x: ev.x, y: this.lay.sectionTop + this.section.yAt(ev.x, ev.birth ?? 0) };
      case 'horizon': return { x: ev.x, y: this.ayAt(ev.x) };
    }
    return null;
  }

  rareHit(g: Game, x: number, y: number, reach = 1): boolean {
    const p = this.rarePos(g);
    if (!p) return false;
    const R = (g.rare!.def.place === 'land' ? 12 : 9) * reach;
    return Math.abs(x - p.x) < R && Math.abs(y - p.y) < R;
  }

  private drawRare(g: Game): void {
    const ev = g.rare;
    const p = this.rarePos(g);
    if (!ev || !p) return;
    const c = this.ctx;
    const fade = Math.min(1, ev.t / 2) * Math.min(1, (CFG.rare.lifetime - ev.t) / 0.6);
    const tw = 0.6 + 0.4 * Math.sin(this.t * 5.3) * Math.sin(this.t * 2.1 + 1);
    // a soft halo so it is found without being loud
    const halo = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, 20);
    halo.addColorStop(0, rgb(255, 230, 170, 0.6 * fade * tw)); halo.addColorStop(0.5, rgb(255, 210, 140, 0.18 * fade)); halo.addColorStop(1, 'rgba(255,230,170,0)');
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = halo; c.fillRect(p.x - 20, p.y - 20, 40, 40);
    c.globalCompositeOperation = 'source-over';
    // a ring that keeps opening, and four glints turning round it
    const rk = (this.t * 0.7) % 1;
    c.strokeStyle = rgb(255, 236, 190, (1 - rk) * 0.7 * fade);
    c.beginPath(); c.arc(p.x, p.y, 4 + rk * 14, 0, Math.PI * 2); c.stroke();
    for (let q = 0; q < 4; q++) {
      const a = this.t * 1.8 + (q * Math.PI) / 2, rr = 9 + Math.sin(this.t * 3 + q) * 1.5;
      c.fillStyle = rgb(255, 248, 220, 0.8 * fade);
      c.fillRect(Math.round(p.x + Math.cos(a) * rr), Math.round(p.y + Math.sin(a) * rr), 1, 1);
    }
    c.globalAlpha = fade;
    const x = Math.round(p.x), y = Math.round(p.y);
    const px = (dx: number, dy: number, col: string) => { c.fillStyle = col; c.fillRect(x + dx, y + dy, 1, 1); };
    switch (ev.def.id) {
      case 'star': {
        for (let k = 1; k < 8; k++) { c.fillStyle = rgb(255, 240, 200, (1 - k / 8) * 0.7); c.fillRect(x + k, y - Math.round(k * 0.6), 1, 1); }
        px(0, 0, '#ffffff'); px(-1, 0, '#fff2b0'); px(1, 0, '#fff2b0'); px(0, -1, '#fff2b0'); px(0, 1, '#fff2b0');
        if (tw > 0.8) { px(-2, 0, '#fff8d8'); px(2, 0, '#fff8d8'); px(0, -2, '#fff8d8'); px(0, 2, '#fff8d8'); }
        break;
      }
      case 'washed': {
        // a shell and a polished pebble at the waterline, a star-glint on top
        c.fillStyle = '#e8dcc8'; c.fillRect(x - 3, y - 1, 3, 2); c.fillStyle = '#c8a890'; c.fillRect(x - 3, y, 3, 1);
        c.fillStyle = '#f4ecd8'; c.fillRect(x - 2, y - 2, 1, 1);
        c.fillStyle = '#9a8a7a'; c.fillRect(x + 1, y - 1, 3, 2); c.fillStyle = '#cfc4b4'; c.fillRect(x + 1, y - 1, 1, 1);
        const gl = tw > 0.5 ? 2 : 1;
        c.fillStyle = '#ffffff'; c.fillRect(x, y - 4 - gl, 1, gl * 2 + 1); c.fillRect(x - gl, y - 4, gl * 2 + 1, 1);
        break;
      }
      case 'migration': {
        // a small herd running across, raising dust — at the scale of the strata (as the far herds: 4×3 px), with a
        // glint over the leader: it is a find, tap it
        const run = (this.t * 6) % 40;
        for (let k = 0; k < 5; k++) {
          const hx = Math.round(x - 10 + k * 5 + run * 0.15 + Math.sin(this.t * 3 + k)), hy = Math.round(this.groundY(hx + 2));
          c.fillStyle = k % 2 ? '#3a2818' : '#2e2014';
          c.fillRect(hx, hy - 3, 4, 2); c.fillRect(hx + 4, hy - 4, 1, 2);
          const leg = Math.floor(this.t * 12 + k) % 2;
          c.fillRect(hx + leg, hy - 1, 1, 1); c.fillRect(hx + 3 - leg, hy - 1, 1, 1);
          c.fillStyle = '#c8a070'; c.fillRect(hx, hy - 3, 3, 1);   // a light back: it reads on the brown ground
          c.fillStyle = 'rgba(220,200,160,0.55)'; c.fillRect(hx - 2, hy, 1, 1);
        }
        const lx = Math.round(x + 10 + run * 0.15), ly = Math.round(this.groundY(lx)) - 7, tw2 = Math.sin(this.t * 5) > 0;
        c.fillStyle = 'rgba(255,240,190,0.95)'; c.fillRect(lx, ly, 1, 1);
        if (tw2) { c.fillRect(lx - 1, ly, 3, 1); c.fillRect(lx, ly - 1, 1, 3); }
        break;
      }
      case 'bloom': {
        // a patch of flowers opening, with pollen in the air
        const cols = ['#f4a0c0', '#ffe070', '#ffffff', '#c8a0f0', '#ff9060'];
        for (let k = 0; k < 16; k++) {
          const fx = x - 10 + ((k * 7) % 21), fy = y + 2 - ((k * 3) % 5);
          c.fillStyle = '#4a8a3a'; c.fillRect(fx, fy, 1, 3);
          const col = cols[k % 5];
          c.fillStyle = col; c.fillRect(fx - 1, fy - 1, 3, 1); c.fillRect(fx, fy - 2, 1, 3);
          c.fillStyle = '#ffe890'; c.fillRect(fx, fy - 1, 1, 1);
        }
        for (let k = 0; k < 6; k++) { c.fillStyle = 'rgba(255,240,170,0.8)'; c.fillRect(Math.round(x - 8 + ((k * 5 + this.t * 3) % 16)), Math.round(y - 6 - ((this.t * 4 + k * 3) % 8)), 1, 1); }
        break;
      }
      case 'geode': {
        // a dark hollow in the rock lined with violet crystals that catch the light
        c.fillStyle = '#1c1420'; c.fillRect(x - 3, y - 2, 7, 5); c.fillRect(x - 2, y - 3, 5, 7);
        const cr = ['#b89ae8', '#8a64c8', '#e0d0ff'];
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.fillStyle = cr[k % 3]; c.fillRect(Math.round(x + Math.cos(a) * 2.6), Math.round(y + Math.sin(a) * 2.6), 1, 1); }
        if (tw > 0.7) { px(0, -1, '#ffffff'); px(-1, -1, '#e8dcff'); }
        break;
      }
      case 'fossilGleam': {
        // the curl of an ammonite showing through, its edge gleaming
        const sp = ['..ooo..', '.oLLLo.', 'oLdddLo', 'oLdLdLo', 'oLLdLLo', '.oLLLo.', '..ooo..'];
        const pal: Record<string, string> = { o: '#6a5a46', L: '#f0e2c0', d: '#a8885a' };
        for (let r = 0; r < 7; r++) for (let q = 0; q < 7; q++) { const col = pal[sp[r][q]]; if (col) { c.fillStyle = col; c.fillRect(x - 3 + q, y - 3 + r, 1, 1); } }
        const gx = Math.round(-3 + ((this.t * 6) % 7));
        c.fillStyle = 'rgba(255,255,240,0.9)'; c.fillRect(x + gx, y - 3, 1, 7);
        break;
      }
      case 'bubble': {
        // gas from the deep rising through the layers in a string of bubbles
        for (let k = 0; k < 5; k++) {
          const ph = (this.t * 0.8 + k / 5) % 1;
          const by = Math.round(y + 6 - ph * 16), bx = Math.round(x + Math.sin(ph * 9 + k) * 1.5);
          c.fillStyle = rgb(190, 225, 255, 0.85 * (1 - ph)); c.fillRect(bx - 1, by, 3, 1); c.fillRect(bx, by - 1, 1, 3);
          c.fillStyle = rgb(255, 255, 255, 0.9 * (1 - ph)); c.fillRect(bx, by - 1, 1, 1);
        }
        break;
      }
      case 'glowLayer': {
        const r2 = 2 + Math.round(tw * 2);
        c.strokeStyle = rgb(255, 210, 120, 0.8); c.beginPath(); c.arc(x, y, r2, 0, Math.PI * 2); c.stroke();
        px(0, 0, '#ffffff'); px(1, 0, '#ffe080'); px(-1, 0, '#ffe080');
        break;
      }
      case 'ancient': {
        // a worn object half out of the technogenic horizon, its metal catching the light
        c.fillStyle = '#5a6068'; c.fillRect(x - 3, y - 2, 6, 3);
        c.fillStyle = '#a8b0b8'; c.fillRect(x - 3, y - 2, 6, 1);
        c.fillStyle = '#d8e0e8'; c.fillRect(x - 2, y - 2, 2, 1);
        c.fillStyle = '#3a4048'; c.fillRect(x + 1, y - 1, 1, 1);
        const gl = tw > 0.5 ? 2 : 1;
        c.fillStyle = '#ffffff'; c.fillRect(x + 2, y - 4 - gl, 1, gl * 2 + 1); c.fillRect(x + 2 - gl, y - 4, gl * 2 + 1, 1);
        break;
      }
    }
    c.globalAlpha = 1;
  }

  /** The burial window: over the lowland a pulsing marker with the two elements that can catch it. */
  burialPos(g: Game): { x: number; y: number } {
    const x = g.lowlandX();
    return { x, y: this.groundY(x) - 12 };
  }

  burialHit(g: Game, x: number, y: number): boolean {
    if (g.run.burialWindow <= 0) return false;
    const p = this.burialPos(g);
    return Math.abs(x - p.x) < 14 && Math.abs(y - p.y) < 12;
  }

  private drawBurialMarker(g: Game): void {
    const w = g.run.burialWindow;
    if (w <= 0) return;
    const c = this.ctx;
    const p = this.burialPos(g);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
    const fade = Math.min(1, w / 0.6);
    c.globalAlpha = fade;
    // a ring on the ground, a beam of time running out
    const r = 13 + pulse * 3;
    c.strokeStyle = rgb(255, 200, 110, 0.6 + 0.4 * pulse);
    c.beginPath(); c.ellipse(p.x, p.y + 12, r, r * 0.32, 0, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = rgb(255, 220, 150, 0.3);
    c.beginPath(); c.ellipse(p.x, p.y + 12, r + 4, (r + 4) * 0.32, 0, 0, Math.PI * 2); c.stroke();
    const glow = c.createRadialGradient(p.x, p.y + 4, 1, p.x, p.y + 4, 18);
    glow.addColorStop(0, rgb(255, 200, 120, 0.35 * pulse)); glow.addColorStop(1, 'rgba(255,200,120,0)');
    c.globalCompositeOperation = 'lighter'; c.fillStyle = glow; c.fillRect(p.x - 18, p.y - 14, 36, 36); c.globalCompositeOperation = 'source-over';
    const k = w / CFG.B.burial.seconds;
    c.fillStyle = rgb(255, 214, 140, 0.18 + 0.15 * pulse);
    c.fillRect(Math.round(p.x) - 1, Math.round(p.y - 10 + (1 - k) * 18), 3, Math.round(k * 18));
    // the two elements: a wave (flood) and a cone with fire (volcano)
    const ix = Math.round(p.x), iy = Math.round(p.y) - 4;
    const s = pulse > 0.5 ? 1 : 0;
    c.fillStyle = '#7ac0e0';
    for (let dx = 0; dx < 6; dx++) c.fillRect(ix - 10 + dx, iy + Math.round(Math.sin(dx * 1.2 + this.t * 4)) - s, 1, 1);
    c.fillStyle = '#9fd8f0'; c.fillRect(ix - 9, iy + 2 - s, 4, 1);
    c.fillStyle = '#6a5a50'; c.fillRect(ix + 4, iy + 2 - s, 7, 1); c.fillRect(ix + 5, iy + 1 - s, 5, 1); c.fillRect(ix + 6, iy - s, 3, 1);
    c.fillStyle = pulse > 0.5 ? '#ffb040' : '#ff7a2a'; c.fillRect(ix + 7, iy - 1 - s, 1, 1); c.fillRect(ix + 6, iy - 2 - s, 1, 1);
    c.globalAlpha = 1;
  }

  // ---------- horizon & the thing ----------
  /** Screen y of the middle of the technogenic horizon (the thing lies there, bottom centre). */
  ayAt(x: number): number {
    const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
    return this.lay.sectionTop + this.section.horizonTop[xi] + this.section.hr / 2;
  }

  private drawHorizon(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const dt = this.dt;
    const top = lay.sectionTop;
    const pts = this.section.glowPts;
    for (let i = 0; i < pts.length; i += 2) {
      const ph = Math.sin(this.t * (1.1 + ((i >> 1) % 7) * 0.31) + i * 1.7);
      if (ph < 0.25) continue;
      c.fillStyle = rgb(255, 196 + 50 * ph, 110, ph * 0.95);
      c.fillRect(pts[i], top + pts[i + 1], 1, 1);
    }
    if (pts.length && this.quality === 'high' && Math.random() < dt * 7) {
      const i = Math.floor(Math.random() * (pts.length / 2)) * 2;
      this.particles.push({ x: pts[i], y: top + pts[i + 1], vx: (Math.random() - 0.5) * 2, vy: -4 - Math.random() * 5, life: 0, max: 2 + Math.random() * 2, color: Math.random() < 0.6 ? '#f2b54a' : '#ffe6a0', size: 1 });
    }
    const sx = CFG.story.horizon.lifeSeedX;
    const sy = this.ayAt(sx) - 1;
    c.fillStyle = rgb(120, 255, 170, 0.55 + 0.45 * Math.sin(this.t * 3.3));
    c.fillRect(sx, Math.round(sy), 1, 1);
    if (this.seedThread >= 0) {
      this.seedThread += dt;
      const k = Math.min(1, this.seedThread / 3);
      for (let y = sy; y > sy - (sy - lay.sectionTop) * k; y--) {
        c.fillStyle = rgb(120, 230, 150, 0.7 * (1 - this.seedThread / 6));
        c.fillRect(sx + Math.round(Math.sin(y * 0.4 + this.t)), Math.round(y), 1, 1);
      }
      if (this.seedThread > 6) this.seedThread = -1;
    }
    // no column of light over the strata (as in the prototype: the thing only glows, drawWorldLight)
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    const item = g.currentItem() ?? 'artifact_a';
    const ph = g.state.phase;
    xs.forEach((x, idx) => {
      if (ph === 'newWorld' || ph === 'end') return;
      if (ph === 'temple' && g.state.ritualChoice !== 'bury') return;
      let ay = this.ayAt(x);
      if (ph === 'temple') ay += Math.min(1, g.state.templeProgress * 3) * 3;
      drawItem(c, item, x, ay, 9, 'glow', true, g.mods.shards ? idx : -1);
    });
  }

  /** Ambient particles: dust in the Silence, pollen on the Land, fireflies at night. */
  private drawAmbient(g: Game, sky: Sky): void {
    if (this.quality === 'low') return;
    const era = g.run.era;
    const lay = this.lay;
    const dt = this.dt;
    const count = this.particles.filter((p) => p.kind === 'mote' || p.kind === 'firefly').length;
    if (count > 40) return;
    if (era === 0 && Math.random() < dt * 10) this.particles.push({ x: -2, y: lay.surfaceTop - 30 + Math.random() * 70, vx: 8 + Math.random() * 10, vy: (Math.random() - 0.5) * 2, life: 0, max: 20, color: 'rgba(220,200,170,0.6)', size: 1, kind: 'mote' });
    if (era === 3 && sky.light > 0.6 && Math.random() < dt * 6) { const mx = Math.random() * WW; this.particles.push({ x: mx, y: this.gy[Math.floor(mx)] - 2 - Math.random() * 16, vx: (Math.random() - 0.5) * 4, vy: -1 - Math.random() * 2, life: 0, max: 6, color: 'rgba(255,236,140,0.8)', size: 1, kind: 'mote' }); }
    if (era >= 3 && sky.light < 0.45 && Math.random() < dt * 5) {
      const x = g.zoneMap.findIndex((z) => z === 2);
      const x0 = x >= 0 ? x : 0;
      const fx = x0 + Math.random() * (WW - x0);
      this.particles.push({ x: fx, y: this.gy[Math.min(WW - 1, Math.floor(fx))] - 3 - Math.random() * 20, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, life: 0, max: 4 + Math.random() * 3, color: '#d8ff70', size: 1, kind: 'firefly' });
    }
  }

  private drawParticles(dt: number): void {
    const c = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max || p.x > WW + 4) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (!p.kind) p.vy -= 6 * dt;
      if (p.kind === 'mote') p.vy += Math.sin(this.t * 2 + i) * dt * 2;
      if (p.kind === 'drop') {
        // a drop of a geyser: falls back and is gone where it meets the ground or the water
        p.vy += 80 * dt;
        const gx = Math.max(0, Math.min(WW - 1, Math.round(p.x)));
        if (p.vy > 0 && (p.y >= this.gy[gx] - 1 || p.y >= this.lay.waterLevel && this.gy[gx] > this.lay.waterLevel)) { this.particles.splice(i, 1); continue; }
      }
      let a = 1 - p.life / p.max;
      if (p.kind === 'firefly') a = Math.max(0, Math.sin(p.life * 3 + i)) * (1 - p.life / p.max);
      c.globalAlpha = a;
      c.fillStyle = p.color;
      c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    c.globalAlpha = 1;
  }

  /**
   * World light: the whole world darkens at night and warms at sunset (not just the sky); the moon lights water
   * and creatures a little; the thing lights the section around it, far layers fall into shadow; faint sun rays.
   */
  private drawWorldLight(g: Game, sky: Sky): void {
    const c = this.ctx;
    const lay = this.lay;
    const night = 1 - sky.light;
    const alt = this.sunAlt();
    // surface: night blue multiply, sunset warmth
    c.globalCompositeOperation = 'multiply';
    const nc = lerp3([255, 255, 255], [90, 100, 150], night * 0.85);
    c.fillStyle = rgb(nc[0], nc[1], nc[2]);
    const fade0 = lay.sectionTop - 10, fade1 = lay.sectionTop + 24;
    c.fillRect(0, lay.surfaceTop - 60, WW, fade0 - lay.surfaceTop + 60);
    // a pile that rises above that band gets the same night (column by column, from its real top)
    this.fillAboveBand(lay.surfaceTop - 60);
    // the strata below are lit by the thing: the night fades out with depth, no hard edge
    const fade = c.createLinearGradient(0, fade0, 0, fade1);
    fade.addColorStop(0, rgb(nc[0], nc[1], nc[2]));
    fade.addColorStop(1, 'rgb(255,255,255)');
    c.fillStyle = fade;
    c.fillRect(0, fade0, WW, fade1 - fade0);
    c.globalCompositeOperation = 'soft-light';
    const golden = Math.max(0, 1 - Math.abs(alt - 0.08) / 0.25);
    if (golden > 0) { c.fillStyle = rgb(255, 140, 60, 0.45 * golden); c.fillRect(0, 0, WW, lay.sectionTop); }
    c.globalCompositeOperation = 'lighter';
    if (night > 0.5) {
      c.fillStyle = rgb(60, 70, 110, 0.12 * night);
      c.fillRect(0, lay.waterLevel - 20, WW, lay.sectionTop - lay.waterLevel + 20);
      this.fillAboveBand(lay.waterLevel - 20);
    }
    // the section is lit evenly, as in the prototype (no shadow of the far layers): the thing only glows
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    c.globalCompositeOperation = 'lighter';
    const boost = Math.min(1, g.run.boost / 3);
    for (const x of xs) {
      const a = this.ayAt(x);
      const R = 30 + boost * 14 + Math.sin(this.t * 2.2) * 2;
      const grd = c.createRadialGradient(x, a, 1, x, a, R);
      grd.addColorStop(0, rgb(242, 181, 74, 0.5 + this.flash * 0.3));
      grd.addColorStop(0.4, rgb(200, 120, 40, 0.15));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd; c.fillRect(x - R, a - R, R * 2, R * 2);
    }
    // a line just absorbed: the thing glows in its colour for a moment
    if (this.absorb) {
      const ab = this.absorb;
      ab.t += this.dt;
      const f = Math.max(0, 1 - ab.t / (ab.long ? 1.4 : 0.6)) * ab.k;
      if (f <= 0) this.absorb = null;
      else {
        const a = this.ayAt(WW / 2) - 3, R = 12 + 10 * ab.k;
        const grd = c.createRadialGradient(WW / 2, a, 1, WW / 2, a, R);
        const [cr, cg, cb] = hex3(ab.color);
        grd.addColorStop(0, rgb(cr, cg, cb, 0.55 * f));
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd; c.fillRect(WW / 2 - R, a - R, R * 2, R * 2);
      }
    }
    {
      const grid = g.grid;
      this.bandBottom = this.lay.sectionTop + this.section.yOfRow(grid.sinkRow + 1);
      if (grid.artifacts.length) { this.thingX0 = grid.artifacts[0] * 2; this.thingX1 = this.thingX0 + CFG.B.sand.artifactW * 2; }
      this.drawSucks();
      this.drawAbsorbFx();
    }
    for (let x = 0; x < WW; x += 3) {
      c.fillStyle = rgb(242, 170, 70, g.glow[x] * (0.1 + 0.03 * Math.sin(this.t * 1.7 + x * 0.1)));
      c.fillRect(x, this.ayAt(x) - 5, 3, 7);
    }
    g.run.targets.forEach((tz, ti) => {
      if (tz.kind === 'water') return;
      const z = this.section.zones[ti];
      if (!z || z.pts.length < 2) return;
      let sx = 0, sy = 0;
      for (let i = 0; i < z.pts.length; i += 2) { sx += z.pts[i]; sy += z.pts[i + 1]; }
      const n = z.pts.length / 2, cx = sx / n, cy = lay.sectionTop + sy / n;
      const grd = c.createRadialGradient(cx, cy, 1, cx, cy, 22);
      grd.addColorStop(0, rgb(255, 90, 30, tz.kind === 'magma' ? 0.35 : 0.18)); grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd; c.fillRect(cx - 22, cy - 22, 44, 44);
    });
    if (this.flash > 0) { c.fillStyle = rgb(255, 230, 170, this.flash * 0.08); c.fillRect(0, 0, WW, WH); }
    c.globalCompositeOperation = 'source-over';
  }

  /** Fill (with the current style and blend) the particles of every column that stand above the row `band`. */
  private fillAboveBand(band: number): void {
    const c = this.ctx;
    for (let x = 0; x < WW; x++) {
      const top = this.section.topD[x] + this.lay.sectionTop;
      if (top < band) c.fillRect(x, top, 1, band - top);
    }
  }

  private rayCanvas = document.createElement('canvas');
  private rayImg: ImageData | null = null;
  private drawRays(lay: Layout, alt: number): void {
    const sp = this.sunPos!;
    const Q = 4;
    const w = Math.ceil(WW / Q), h = Math.ceil((lay.waterLevel + 4) / Q);
    const rc = this.rayCanvas;
    if (rc.width !== w || rc.height !== h) { rc.width = w; rc.height = h; this.rayImg = null; }
    const rx = rc.getContext('2d')!;
    if (!this.rayImg) this.rayImg = rx.createImageData(w, h);
    const d = this.rayImg.data;
    const strength = Math.min(1, (alt - 0.1) / 0.3) * (1 - this.skyDim) * (1 - 0.5 * sp.low);
    const warm = lerp3([255, 232, 184], [255, 184, 120], sp.low);
    const t = this.t;
    // angular noise: 28 lattice points round the circle, smoothly interpolated, two octaves, slow drift
    const ang = (u: number, oct: number, drift: number) => {
      const n = 28 * oct, f = ((u / (Math.PI * 2)) * n + drift) % n, i = Math.floor(f), fr = f - i, s2 = fr * fr * (3 - 2 * fr);
      return hash2((i + n) % n, 900 + oct) * (1 - s2) + hash2((i + 1) % n, 900 + oct) * s2;
    };
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const x = px * Q + Q / 2, y = py * Q + Q / 2;
      const dx = x - sp.x, dy = y - sp.y;
      const dist = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) + Math.PI;
      const shaft = ang(a, 1, t * 0.05) * 0.7 + ang(a, 2, -t * 0.03) * 0.3;
      const beam = Math.max(0, (shaft - 0.42) / 0.58);                                  // gaps between the shafts
      const near = Math.min(1, Math.max(0, (dist - 8) / 14));                           // the disc has its own glow
      const fall = Math.exp(-dist / 70);
      const down = dy > 0 ? 1 : 0.45;                                                   // brighter toward the land
      const v = beam * beam * near * fall * down * strength;
      const o = (py * w + px) * 4;
      d[o] = warm[0]; d[o + 1] = warm[1]; d[o + 2] = warm[2]; d[o + 3] = Math.min(255, v * 120);
    }
    rx.putImageData(this.rayImg, 0, 0);
    const c = this.ctx;
    c.save();
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.globalCompositeOperation = 'screen';
    c.drawImage(rc, 0, 0, w, h, 0, 0, w * Q, h * Q);
    c.restore();
    c.imageSmoothingEnabled = false;
  }

  /** The era tone, multiplied over the world; drifts to the new era over ~3 s. */
  private drawGrade(sky: Sky): void {
    const c = this.ctx;
    const col = this.grade;
    // the sky and the background only: the strata keep their own colours, as in the prototype
    c.globalCompositeOperation = 'soft-light';
    c.fillStyle = rgb(col[0], col[1], col[2], 0.45);
    for (let x = 0; x < WW; x++) c.fillRect(x, 0, 1, this.gy[x]);
    c.globalCompositeOperation = 'multiply';
    const m = lerp3([255, 255, 255], col, 0.18);
    c.fillStyle = rgb(m[0], m[1], m[2]);
    for (let x = 0; x < WW; x++) c.fillRect(x, 0, 1, this.gy[x]);
    c.globalCompositeOperation = 'source-over';
    void sky;
  }

  /** Bloom: a blurred copy of the bright pixels, added on top. */
  private drawBloom(): void {
    if (this.quality === 'low') return;
    const b = this.bloomCtx;
    const w = this.bloomSmall.width, h = this.bloomSmall.height;
    b.imageSmoothingEnabled = true;
    b.globalCompositeOperation = 'copy';
    b.drawImage(this.canvas, 0, 0, w, h);
    const img = b.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      const k = Math.max(0, (l - 170) / 85);
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
    b.putImageData(img, 0, 0);
    const c = this.ctx;
    c.save();
    c.imageSmoothingEnabled = true;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.55;
    c.filter = 'blur(2px)';
    c.drawImage(this.bloomSmall, 0, 0, WW, WH);
    c.restore();
    c.imageSmoothingEnabled = false;
  }

  /** Vignette over the whole world (about 18 %). */
  private drawVignette(sky: Sky): void {
    const c = this.ctx;
    const v = c.createRadialGradient(WW / 2, WH * 0.5, WW * 0.42, WW / 2, WH * 0.5, WH * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(8,6,12,${0.34 + (1 - sky.light) * 0.08})`);
    // over the sky and the background, not over the strata
    c.fillStyle = v;
    for (let x = 0; x < WW; x++) c.fillRect(x, 0, 1, this.gy[x]);
  }

  private drawShift(dt: number): void {
    const fx = this.shiftFx;
    if (!fx) return;
    fx.t += dt;
    const c = this.ctx;
    const k = Math.min(1, fx.t / 2.6);
    // follow the live layout (the drawer may be closing while the column sinks)
    fx.top = this.lay.sectionTop; fx.h = this.lay.sectionH;
    const sink = k * k * fx.h;
    c.save();
    c.beginPath(); c.rect(0, fx.top, WW, fx.h); c.clip();
    c.globalAlpha = 1 - k * 0.85;
    c.drawImage(fx.img, 0, fx.top + sink);
    c.fillStyle = `rgba(6,4,10,${0.25 + k * 0.6})`; c.fillRect(0, fx.top + sink, WW, fx.h);
    // the stamped line of light in the foundation
    c.fillStyle = rgb(242, 181, 74, Math.sin(k * Math.PI));
    c.fillRect(0, fx.top + fx.h - 12, WW, 1);
    c.restore();
    c.globalAlpha = 1;
    if (k < 0.8 && this.quality === 'high') for (let i = 0; i < 4; i++) {
      this.particles.push({ x: Math.random() * WW, y: fx.top + sink + Math.random() * 4, vx: (Math.random() - 0.5) * 5, vy: -5 - Math.random() * 10, life: 0, max: 1 + Math.random(), color: Math.random() < 0.5 ? '#d8ceb8' : '#a89e88', size: 1 });
    }
    if (k >= 1) { this.shiftFx = null; this.flash = 0.6; this.reveal = 0; this.dayPhase = 0.2; }
  }

  /** Echoes: no frame — the picture dissolves at the edges and trembles a little, like a memory. */
  private drawEcho(dt: number): void {
    const e = this.echo;
    if (!e) return;
    e.t += dt;
    const dur = CFG.echoes.duration;
    if (e.t >= dur) {
      this.echo = null;
      const next = this.echoQueue.shift();
      if (next) setTimeout(() => this.showEcho(next.picture, next.alpha), 600);
      return;
    }
    const env = Math.min(1, e.t / 0.8) * Math.min(1, (dur - e.t) / 1.2);
    renderEcho(e.canvas, e.picture, e.t);
    // no frame: the picture dissolves into the sky through a round vignette with a pixel dither at its edge
    {
      const ec = e.canvas.getContext('2d')!;
      const W2 = e.canvas.width, H2 = e.canvas.height, R = Math.min(W2, H2) * 0.52;
      ec.globalCompositeOperation = 'destination-in';
      const grd = ec.createRadialGradient(W2 / 2, H2 / 2, R * 0.35, W2 / 2, H2 / 2, R);
      grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      ec.fillStyle = grd; ec.fillRect(0, 0, W2, H2);
      ec.globalCompositeOperation = 'destination-out';
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
        const d = Math.hypot((x - W2 / 2) / (W2 / 2), (y - H2 / 2) / (H2 / 2));
        if (d > 0.55 && hash2(x + Math.floor(e.t * 6), y) < (d - 0.55) * 1.6) ec.fillRect(x, y, 1, 1);
      }
      ec.globalCompositeOperation = 'source-over';
    }
    const jx = Math.sin(this.t * 9.3) * 0.6, jy = Math.cos(this.t * 7.1) * 0.5;
    this.ctx.globalAlpha = env * e.alpha * (0.85 + 0.15 * Math.sin(this.t * 13));
    this.ctx.drawImage(e.canvas, Math.round(e.x + jx), Math.round(Math.max(50, this.lay.surfaceTop - 40) + jy - (1 - env) * 2));
    this.ctx.globalAlpha = 1;
  }

  // ---------- the opening choice ----------
  chooseXs(n: number): number[] { return n === 3 ? [36, 90, 144] : n === 2 ? [60, 120] : [90]; }

  private drawChoose(g: Game): void {
    const c = this.ctx;
    c.fillStyle = '#0e0c10'; c.fillRect(0, 0, WW, WH);
    for (let i = 0; i < 80; i++) { c.fillStyle = `rgba(255,255,255,${0.02 + 0.02 * Math.sin(this.t + i)})`; c.fillRect((i * 97) % WW, (i * 53) % WH, 1, 1); }
    const items = g.availableItems();
    const xs = this.chooseXs(items.length);
    items.forEach((id, i) => {
      const hover = this.chooseHover === i;
      const y = 160 + Math.sin(this.t * 0.8 + i * 2) * 1;
      if (hover) {
        const grd = c.createRadialGradient(xs[i], y, 2, xs[i], y, 30);
        grd.addColorStop(0, 'rgba(242,181,74,0.18)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd; c.fillRect(xs[i] - 30, y - 30, 60, 60);
      }
      drawItem(c, id, xs[i], y, 32, hover ? 'hover' : 'silhouette');
    });
  }

  /** After the choice: the thing falls, goes under the ground and the layers close over it. */
  private drawSink(dt: number): void {
    const s = this.sinkFx;
    if (!s) return;
    s.t += dt;
    const k = Math.min(1, s.t / 2.8);
    const c = this.ctx;
    c.fillStyle = `rgba(14,12,16,${1 - k})`; c.fillRect(0, 0, WW, WH);
    const x = s.x0 + (WW / 2 - s.x0) * Math.min(1, k * 1.6);
    const y = 160 + (this.ayAt(WW / 2) - 160) * k * k;
    c.globalAlpha = 1 - Math.max(0, (k - 0.75) / 0.25);
    drawItem(c, s.id, x, y, k < 0.5 ? 32 : 16, 'hover');
    c.globalAlpha = 1;
    if (k > 0.6) {
      // the layers close over it
      const cl = (k - 0.6) / 0.4;
      c.fillStyle = `rgba(74,52,36,${cl * 0.6})`;
      c.fillRect(0, this.lay.sectionTop, WW, Math.max(0, (this.ayAt(WW / 2) - this.lay.sectionTop) * cl));
    }
    if (k >= 1) this.sinkFx = null;
  }

  // ---------- finale ----------
  private drawFinaleWorld(g: Game): void {
    const ph = g.state.phase;
    if (ph !== 'finale' && ph !== 'temple' && ph !== 'newWorld' && ph !== 'end') return;
    const c = this.ctx;
    const x = WW / 2;
    const gy = this.gy[x];
    c.fillStyle = 'rgba(4,3,8,0.35)'; c.fillRect(0, 0, WW, WH);
    this.drawShaft(g, 1);
    for (let i = 0; i < 4; i++) {
      const k = ph === 'finale' ? Math.min(1, (this.t * 0.08 + i * 0.12) % 1.2) : 0.9 - i * 0.05;
      const yy = gy + (this.ayAt(x) - 10 - gy) * k;
      hominid(c, x + (i % 2 ? 2 : -2), yy, { t: this.t, i, flip: i % 2 === 0, alert: 0, walk: 0, season: 0 }, true);
    }
    if (ph === 'temple' || ph === 'newWorld' || ph === 'end') {
      const p = ph === 'temple' ? g.state.templeProgress : 1;
      this.drawTemple(g, x, gy, Math.max(0, (p - 0.45) / 0.55));
    }
  }

  /** The temple rises over the shaft: stone ring → altar → walls → dome; the tradition appears on its facade. */
  private drawTemple(g: Game, x: number, gy: number, p: number): void {
    const c = this.ctx;
    if (p <= 0) return;
    const stage = p < 0.25 ? 1 : p < 0.45 ? 2 : p < 0.75 ? 3 : 4;
    const img = skin(`world/temple_${stage}.png`);
    if (img) c.drawImage(img, Math.round(x - img.width / 2), Math.round(gy - img.height + 2));
    else {
      const ring = Math.min(1, p / 0.25);
      for (let i = 0; i < 10; i++) {
        if (i / 10 > ring) break;
        const a = (i / 10) * Math.PI * 2;
        c.fillStyle = '#16121a'; c.fillRect(Math.round(x + Math.cos(a) * 22) - 2, Math.round(gy + Math.sin(a) * 2) - 6, 4, 6);
        c.fillStyle = '#aaa08c'; c.fillRect(Math.round(x + Math.cos(a) * 22) - 1, Math.round(gy + Math.sin(a) * 2) - 5, 2, 5);
      }
      if (p > 0.25) { c.fillStyle = '#9a907c'; c.fillRect(x - 5, gy - 5, 11, 5); c.fillStyle = ACCENT; c.fillRect(x, gy - 7, 1, 2); }
      if (p > 0.45) {
        const h = Math.round(26 * Math.min(1, (p - 0.45) / 0.3));
        c.fillStyle = '#16121a'; c.fillRect(x - 24, gy - h - 1, 49, h + 1);
        c.fillStyle = '#8c826e'; c.fillRect(x - 23, gy - h, 47, h);
        c.fillStyle = '#a09680';
        for (let yy = 0; yy < h; yy += 4) for (let xx = (yy / 4) % 2 ? 0 : 4; xx < 46; xx += 8) c.fillRect(x - 23 + xx, gy - h + yy, 7, 3);
        c.fillStyle = '#2a2016'; c.fillRect(x - 3, gy - Math.min(h, 10), 7, Math.min(h, 10));
      }
      if (p > 0.75) {
        const a = Math.min(1, (p - 0.75) / 0.25);
        c.fillStyle = rgb(176, 164, 140, a);
        c.beginPath(); c.ellipse(x + 0.5, gy - 26, 24, 14 * a, 0, Math.PI, Math.PI * 2); c.fill();
        c.fillStyle = ACCENT; c.fillRect(x, Math.round(gy - 26 - 14 * a - 3), 1, 3);
      }
    }
    // the tradition, in glowing ochre on the facade, line by line
    if (p > 0.55) {
      const rituals = g.state.phase === 'end' ? g.legacy.rituals : [g.state.ritualChoice ?? g.legacy.rituals[g.legacy.rituals.length - 1]];
      const k = Math.min(1, (p - 0.55) / 0.35);
      rituals.forEach((rit, idx) => {
        if (!rit) return;
        const ox = x - 12 + (idx - (rituals.length - 1) / 2) * 16;
        const oy = gy - 24;
        const legend = skin(`world/legend_${rit}.png`);
        c.globalCompositeOperation = 'lighter';
        if (legend) {
          const hgt = Math.round(legend.height * k);
          c.drawImage(legend, 0, 0, legend.width, hgt, Math.round(ox), oy, legend.width * 0.6, hgt * 0.6);
        } else {
          const st = pictogram(rit);
          const n = Math.floor(st.length * k);
          c.fillStyle = rgb(240, 150, 70, 0.9);
          for (let i = 0; i < n; i++) {
            const [x0, y0, x1, y1] = st[i];
            const steps = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 0.5));
            for (let s = 0; s <= steps; s++) c.fillRect(Math.round(ox + (x0 + ((x1 - x0) * s) / steps) * 0.5), Math.round(oy + (y0 + ((y1 - y0) * s) / steps) * 0.5), 1, 1);
          }
        }
        c.globalCompositeOperation = 'source-over';
      });
    }
  }

  /** Ritual scene as a vision in the sky: no frame, edges dissolve. */
  private drawVision(g: Game): void {
    if (g.state.phase !== 'temple' || g.state.templeProgress >= 0.45) return;
    const p = g.state.templeProgress / 0.45;
    const v = this.sceneCanvas.getContext('2d')!;
    v.imageSmoothingEnabled = false;
    drawScene(v, g.state.ritualChoice ?? 'eat', p, this.t, g.currentItem() ?? 'artifact_a');
    // an elliptical vignette that dissolves into the sky (no frame), dithered at the rim
    v.globalCompositeOperation = 'destination-in';
    v.save();
    v.translate(VW / 2, VH / 2); v.scale(1, VH / VW);
    const m = v.createRadialGradient(0, 0, VW * 0.12, 0, 0, VW * 0.5);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.55, 'rgba(0,0,0,0.85)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    v.fillStyle = m; v.fillRect(-VW / 2, -VW / 2, VW, VW);
    v.restore();
    v.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < VH; y += 1) for (let x = 0; x < VW; x += 1) {
      const d = Math.hypot((x - VW / 2) / (VW / 2), (y - VH / 2) / (VH / 2));
      if (d > 0.6 && hash2(x + Math.floor(this.t * 5), y + 300) < (d - 0.6) * 1.8) v.fillRect(x, y, 1, 1);
    }
    v.globalCompositeOperation = 'source-over';
    const a = Math.min(1, p * 6) * Math.min(1, (1 - p) * 6);
    this.ctx.globalAlpha = a;
    this.ctx.drawImage(this.sceneCanvas, Math.round((WW - VW) / 2), 52);
    this.ctx.globalAlpha = 1;
  }

  /** Sparks and other light that flies to a point (Energy counter, the Book, resources). */
  private drawFlyers(dt: number): void {
    const c = this.ctx;
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt;
      const pull = Math.min(1, f.t * 1.6);
      const ax = (f.tx - f.x) * 14 * pull, ay = (f.ty - f.y) * 14 * pull;
      f.vx = (f.vx + ax * dt) * (1 - dt * 3.5);
      f.vy = (f.vy + ay * dt) * (1 - dt * 3.5);
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (Math.hypot(f.tx - f.x, f.ty - f.y) < 3 || f.t > 1.6) { this.flyers.splice(i, 1); f.done?.(); continue; }
      c.fillStyle = f.color;
      c.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
      c.fillStyle = 'rgba(255,220,140,0.35)';
      c.fillRect(Math.round(f.x - f.vx * 0.02), Math.round(f.y - f.vy * 0.02), 1, 1);
    }
  }

  // ---------- picking ----------
  sectionY(wy: number): number | null {
    // the strata rise above the old top of the section now: everything from the top of the world down counts
    const y = wy - this.lay.sectionTop;
    if (wy < 0 || y >= this.lay.sectionH) return null;
    return y;
  }

  isArtifact(wx: number, wy: number, g: Game, reach = 1): number {
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    for (let i = 0; i < xs.length; i++) if (Math.abs(wx - xs[i]) < 9 * reach && Math.abs(wy - this.ayAt(xs[i])) < 8 * reach) return i;
    return -1;
  }
}

/** height of the history ribbon above an open drawer (world px) */
const RIBBON_H = 14;

function ease(k: number): number { return k * k * (3 - 2 * k); }
