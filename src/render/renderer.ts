// World renderer at 180×320, scaled up with nearest-neighbour. Everything here is the pixel world:
// sky, three parallax planes, a living surface, the section, the thing, light and atmosphere.
// Reads core state only; never mutates it.
import { CFG } from '../config';
import type { Game } from '../core/game';
import { totalPop } from '../core/life';
import { skin, preloadSkins } from './assets';
import { tintedCanvas, drawTinted, tintInto } from './sprites';
import { hash2 } from '../core/rng';
import { Layout, WW, WH, NOISE, GRAIN, lerp, lerp3, hex3, rgb, ACCENT } from './common';
import { SectionRenderer } from './section';
import { drawFossil, fossilKind } from './skins';
import { CREATURES, Pose, birdFlying, hominid } from './creatures';
import { drawItem } from './items';
import { renderEcho, EW, EH } from './echoes';
import { drawScene, pictogram, VW, VH } from './ritual';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; kind?: 'mote' | 'firefly' | 'spark' }
interface Flyer { x: number; y: number; vx: number; vy: number; tx: number; ty: number; t: number; color: string; done?: () => void }
interface Ring { t: number; x: number }
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

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lay = new Layout();
  section = new SectionRenderer();
  dayPhase = 0.3;
  seasonPhase = 0.2;
  daySeconds = 6;
  skyDim = 0;
  flash = 0;
  shake = 0;
  particles: Particle[] = [];
  flyers: Flyer[] = [];
  rings: Ring[] = [];
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
  /** A click: a ring of light rises from the layer, sparks fly to the Energy counter, life nearby looks up. */
  onClick(x: number = WW / 2): void {
    this.rings.push({ t: 0, x });
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
  onExtinction(): void { this.skyDim = 1; this.shake = Math.min(3, this.shake + 2); this.alarm = this.t; }
  onQuake(): void { this.shake = 4; this.alarm = this.t; }
  onEra(era: number): void { if (era === 1) this.seedThread = 0; }

  /** A soft flash where a new creature comes up from the ground. */
  spawnFlash(zi: number, g: Game): void {
    const xs: number[] = [];
    for (let x = 0; x < WW; x++) if (g.zoneMap[x] === zi) xs.push(x);
    if (!xs.length) return;
    const x = xs[Math.floor(Math.random() * xs.length)];
    const y = zi === 0 ? this.gy[x] : this.gy[x] + 3 + Math.random() * (this.lay.sectionTop - this.gy[x] - 6);
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
    const yps = g.state.phase === 'play' ? g.yps() : 0.02;
    this.daySeconds = g.state.phase !== 'play' ? 24 : Math.max(6, Math.min(24, 20 * Math.sqrt(0.1 / Math.max(1e-3, yps))));
    const lapse = this.timelapse > 0 ? 14 : 1;
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
    this.section.maybeRender(g, this.lay, now, this.reveal);
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
    this.drawLife(g);
    this.drawFinaleWorld(g);
    this.drawShift(dt);
    this.drawHorizon(g);
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
      const left = (v.until - g.run.year) / 30;
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
      if (!drawTinted(c, 'world/sky/sun.png', x, y, core)) disc(x, y, R, (dx, dy) => (dx * dx + dy * dy > (R - 1) * (R - 1) ? rgb(core[0], core[1] * 0.92, core[2] * 0.8) : rgb(core[0], core[1], core[2])));
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

  private drawFlyingBirds(g: Game): void {
    const n = Math.min(12, Math.ceil(totalPop(g, 'birds') / 3));
    if (n <= 0) return;
    const c = this.ctx, t = this.t;
    const pose: Pose = { t, i: 0, flip: false, alert: 0, walk: 0, season: this.seasonPhase };
    const lx = ((t * 7 + 40) % (WW + 80)) - 40;
    const ly = this.lay.surfaceTop - 22 + Math.sin(t * 0.4) * 5;
    for (let i = 0; i < n; i++) {
      const row = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
      birdFlying(c, lx - row * 11 + Math.sin(t * 2 + i) * 1.2, ly + row * 4 * side + Math.cos(t * 1.7 + i) * 1.2, { ...pose, i });
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
  private computeGround(g: Game): void {
    const lay = this.lay;
    const seabed = lay.sectionTop - 2;
    // distance from each column to the nearest water column
    const dist = new Float32Array(WW).fill(999);
    for (let x = 0; x < WW; x++) if (g.zoneMap[x] === 0) dist[x] = 0;
    for (let x = 1; x < WW; x++) dist[x] = Math.min(dist[x], dist[x - 1] + 1);
    for (let x = WW - 2; x >= 0; x--) dist[x] = Math.min(dist[x], dist[x + 1] + 1);
    const bare = Math.min(1, (totalPop(g, 'mosses') + totalPop(g, 'trees')) / 30) < 0.05;
    for (let x = 0; x < WW; x++) {
      // bare land: calm dunes (long smooth swells); with life the hills get a little more texture
      const hill = bare
        ? NOISE[(40 << 8) | ((x * 1) & 255)] * 6 + Math.sin(x * 0.05 + 1) * 3 + 4
        : NOISE[(40 << 8) | ((x * 2) & 255)] * 7 + NOISE[(44 << 8) | ((x * 5) & 255)] * 2 + Math.sin(x * 0.045 + 1) * 3.5 + 3;
      const land = lay.groundBase - hill;
      const t = Math.max(0, Math.min(1, (dist[x] + 3) / (bare ? 34 : 26)));
      const s = t * t * (3 - 2 * t);
      this.gy[x] = Math.round(seabed + (land - seabed) * s);
      if (g.mods.shards) for (const rx of [g.shardXs()[0] + 22, g.shardXs()[1] + 22]) {
        const d = Math.abs(x - rx);
        if (d < 7) this.gy[x] = Math.min(this.gy[x], Math.round(lay.groundBase - 12 * Math.pow(1 - d / 7, 1.3)));
      }
    }
  }

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
      const cut = bottom + this.section.topD[x];
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
      if (gy > sea) {
        for (let y = sea; y < gy; y++) {
          const k = (y - sea) / Math.max(1, bottom - sea);
          const shaft = Math.max(0, Math.sin(x * 0.12 + y * 0.25 - t * 0.6)) ** 6 * 0.25 * sky.light;
          const base = lerp3(lerp3(sky.hor, [46, 96, 124], 0.55), [12, 36, 58], k);
          const a = Math.min(1, 0.55 + (y - sea) * 0.08);
          c.fillStyle = rgb(base[0] * nf(0.5) + shaft * 120, base[1] * nf(0.5) + shaft * 140, base[2] * nf(0.45) + shaft * 120, a);
          c.fillRect(x, y, 1, 1);
        }
      } else if (g.zoneMap[x] === 2 && green > 0.15 && !winter) {
        for (let q = 0; q < 2; q++) {
          if (hash2(x, 50 + q) > 0.18 + green * 0.25) continue;
          const ty = Math.round(gy + 2 + hash2(x, 60 + q) * (bottom - gy - 4));
          const hgt = 1 + Math.round(hash2(x, 70 + q) * 3 * green);
          const sw = Math.sin(t * 2 + x * 0.3 + q) > 0.4 ? 1 : 0;
          c.fillStyle = rgb(top[0] * 0.62 * nf(0.55), top[1] * 0.8 * nf(0.55), top[2] * 0.5);
          c.fillRect(x + sw, ty - hgt, 1, hgt);
          if (this.seasonPhase < 0.3 && hash2(x, 80 + q) > 0.8) { c.fillStyle = q ? '#f0e080' : '#e890b0'; c.fillRect(x + sw, ty - hgt - 1, 1, 1); }
        }
      }
    }
    // 2) painted top edges of the zones: barren (era 0, before land life) → grass with it; beach at the shore;
    //    the water surface strip. Zones blend over ~20 px, so no vertical walls.
    this.drawSurfaceEdges(g, sea, night, green, glacier || winter);
    // 3) water life on top: ripples, the sun's glitter, surf foam, ice
    for (let x = 0; x < WW; x++) {
      const gy = this.gy[x];
      if (gy <= sea) continue;
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
      if (gy > sea + 1) {
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

  /** Living surface: a sample of each species with idle behaviour; wolves stalk the herds; everyone looks up when startled. */
  private drawLife(g: Game): void {
    const c = this.ctx;
    const t = this.t;
    const lay = this.lay;
    const segs = this.segments(g);
    const since = t - this.alarm;
    const caps: Record<string, number> = { mat: 6, plankton: 14, mollusc: 6, fish: 7, moss: 12, tree: 9, insect: 8, bird: 5, herd: 6, predator: 4, hominid: 4, tribe: 7 };
    const queue: { y: number; draw: () => void }[] = [];
    const herdXs: number[] = [];
    for (const pass of [0, 1]) for (const sp of CFG.species) {
      if ((sp.sprite === 'predator') !== (pass === 1)) continue;
      const p = g.run.pop[sp.id];
      for (let zi = 0; zi < 3; zi++) {
        if (p[zi] <= 0) continue;
        const cap = this.quality === 'high' ? caps[sp.sprite] ?? 5 : Math.ceil((caps[sp.sprite] ?? 5) / 2);
        const n = Math.min(cap, Math.ceil(p[zi] / (sp.sprite === 'plankton' ? 1 : 3)));
        const zsegs = segs.filter((s) => s.zi === zi);
        const width = zsegs.reduce((a, s) => a + s.x1 - s.x0 + 1, 0);
        for (let i = 0; i < n; i++) {
          let u = hash2(i * 13 + zi, sp.idx * 7 + 1) * width;
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
          const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
          let y = this.gy[xi];
          if (zi !== 0 && sp.sprite !== 'tree') y = Math.round(y + 3 + hash2(i, sp.idx + 99) * Math.max(1, lay.sectionTop - y - 6));
          else if (sp.sprite === 'tree') y = Math.round(y + 1 + hash2(i, sp.idx + 99) * 5);
          if (zi === 0) {
            if (sp.sprite === 'fish') {
              const depth = Math.max(4, this.gy[xi] - lay.waterLevel - 3);
              y = lay.waterLevel + 3 + h * depth;
              x = bx + Math.sin(t * (0.4 + h * 0.3) + h * 9) * 16 + (since < 1.5 ? (h > 0.5 ? 1 : -1) * since * 20 : 0);
              pose.flip = Math.cos(t * (0.4 + h * 0.3) + h * 9) < 0;
            } else if (sp.sprite === 'plankton') y = lay.waterLevel + 3 + h * Math.max(3, this.gy[xi] - lay.waterLevel - 4);
          }
          if (sp.sprite === 'herd') herdXs.push(x);
          if (sp.sprite === 'bird' && since < 5) {
            const k = since / 5;
            const fx = x + (h - 0.5) * 60 * k, fy = y - 4 - Math.sin(k * Math.PI) * 40;
            queue.push({ y: 999, draw: () => birdFlying(c, fx, fy, pose) });
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
    const gy = this.gy[x] + 6;
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
    const hh = lay.sectionH;
    c.drawImage(sec.canvas, 0, 0, WW, hh, 0, top, WW, hh);
    // era boundaries: faint golden curves along the layers where an era began
    for (let e = 1; e <= g.run.era; e++) {
      const b = CFG.eras[e].start;
      c.fillStyle = 'rgba(242,181,74,0.16)';
      for (let x = 0; x < WW; x++) {
        const y = sec.yAt(x, b);
        if (y <= sec.topD[x] + 1 || y >= sec.strataH - 1) continue;
        c.fillRect(x, Math.round(top + y), 1, 1);
      }
    }
    let drawn = 0;
    for (const f of sec.fossils) {
      if (f.fragment) { c.fillStyle = 'rgba(240,230,200,0.9)'; c.fillRect(f.x, top + f.y, 1, 1); continue; }
      if (drawn++ > 60) break;
      const sp = CFG.species[f.species];
      drawFossil(c, f.x, top + f.y, sp ? fossilKind(sp.id) : 'bone', f.rare, this.t);
    }
    for (const z of sec.zones) for (let i = 0; i < z.pts.length; i += 2) {
      const ph = Math.sin(this.t * 3 + i * 1.7);
      if (ph < 0.3) continue;
      c.fillStyle = z.kind === 'water' ? rgb(140, 200, 255, ph * 0.8) : rgb(255, 140 + 60 * ph, 60, ph * 0.7);
      c.fillRect(z.pts[i], top + z.pts[i + 1], 1, 1);
    }
    for (const gl of g.glints) {
      c.globalAlpha = Math.min(1, gl.t * 2);
      c.fillStyle = gl.color;
      for (let x = 0; x < WW; x++) {
        // the whole layer line flashes briefly, following its curve
        const y = top + (gl.birth !== undefined ? sec.yAt(x, gl.birth) : Math.min(sec.strataH, gl.depth * 2));
        c.fillRect(x, Math.round(y), 1, 1);
      }
      const gy = top + (gl.birth !== undefined ? sec.yAt(gl.x, gl.birth) : Math.min(sec.strataH, gl.depth * 2));
      c.fillRect(gl.x - 1, gy - 1, 3, 3);
      c.globalAlpha = 1;
    }
    if (this.hover && !this.targeting) {
      const b = sec.bAt(this.hover.x, this.hover.y);
      c.fillStyle = 'rgba(242,181,74,0.3)';
      if (this.hover.y < sec.strataH) for (let x = 0; x < WW; x++) c.fillRect(x, Math.round(top + sec.yAt(x, b)), 1, 1);
      c.fillStyle = 'rgba(242,181,74,0.9)'; c.fillRect(this.hover.x, top + this.hover.y - 1, 1, 3);
    }
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

  // ---------- horizon & the thing ----------
  /** Screen y of the middle of the technogenic horizon (the thing lies there, bottom centre). */
  ayAt(x: number): number {
    const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
    return this.lay.sectionTop + this.section.horizonTop[xi] + HR / 2;
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
    // the column of light above the thing
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    const boost = Math.min(1, g.run.boost / 3);
    // a narrow beam (≈12 px) with soft edges, bright at the thing and melting upward, added on top;
    // the layers right beside it catch a little warm light
    c.globalCompositeOperation = 'lighter';
    for (const x of xs) {
      const ay = this.ayAt(x);
      const y0 = lay.sectionTop - 14, len = ay - y0;
      if (len <= 2) continue;
      const pulse = 0.9 + 0.1 * Math.sin(this.t * 1.7);
      const halo = c.createLinearGradient(0, ay, 0, y0);
      halo.addColorStop(0, rgb(255, 170, 80, 0.16 + boost * 0.08)); halo.addColorStop(0.5, rgb(255, 150, 70, 0.05)); halo.addColorStop(1, 'rgba(255,150,70,0)');
      c.fillStyle = halo;
      for (let dx = -18; dx <= 18; dx++) {
        c.globalAlpha = Math.exp(-((dx / 11) ** 2));
        c.fillRect(Math.round(x) + dx, y0, 1, len);
      }
      const beam = c.createLinearGradient(0, ay, 0, y0);
      beam.addColorStop(0, rgb(255, 226, 150, 0.55 + boost * 0.25)); beam.addColorStop(0.35, rgb(250, 190, 96, 0.22 + boost * 0.12)); beam.addColorStop(1, 'rgba(242,181,74,0)');
      c.fillStyle = beam;
      for (let dx = -6; dx <= 6; dx++) {
        c.globalAlpha = Math.exp(-((dx / 3.3) ** 2)) * pulse;
        c.fillRect(Math.round(x) + dx, y0, 1, len);
      }
      c.globalAlpha = 1;
    }
    c.globalCompositeOperation = 'source-over';
    const item = g.currentItem() ?? 'artifact_a';
    const ph = g.state.phase;
    xs.forEach((x, idx) => {
      if (ph === 'newWorld' || ph === 'end') return;
      if (ph === 'temple' && g.state.ritualChoice !== 'bury') return;
      let ay = this.ayAt(x);
      if (ph === 'temple') ay += Math.min(1, g.state.templeProgress * 3) * 3;
      drawItem(c, item, x, ay, 9, 'glow', true, g.mods.shards ? idx : -1);
    });
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t += dt;
      const k = rg.t / 0.9;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const ay = this.ayAt(rg.x);
      const y = ay - k * (ay - lay.groundBase);
      c.strokeStyle = rgb(242, 181, 74, (1 - k) * 0.7);
      c.beginPath(); c.ellipse(rg.x, y, 14 + k * 34, 2 + k * 4, 0, 0, Math.PI * 2); c.stroke();
    }
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
    if (era === 3 && sky.light > 0.6 && Math.random() < dt * 6) this.particles.push({ x: Math.random() * WW, y: lay.groundBase + Math.random() * 20, vx: (Math.random() - 0.5) * 4, vy: -1 - Math.random() * 2, life: 0, max: 6, color: 'rgba(255,236,140,0.8)', size: 1, kind: 'mote' });
    if (era >= 3 && sky.light < 0.45 && Math.random() < dt * 5) {
      const x = g.zoneMap.findIndex((z) => z === 2);
      const x0 = x >= 0 ? x : 0;
      this.particles.push({ x: x0 + Math.random() * (WW - x0), y: lay.groundBase + Math.random() * 24, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, life: 0, max: 4 + Math.random() * 3, color: '#d8ff70', size: 1, kind: 'firefly' });
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
    c.fillRect(0, lay.surfaceTop - 60, WW, lay.sectionTop - lay.surfaceTop + 60);
    c.globalCompositeOperation = 'soft-light';
    const golden = Math.max(0, 1 - Math.abs(alt - 0.08) / 0.25);
    if (golden > 0) { c.fillStyle = rgb(255, 140, 60, 0.45 * golden); c.fillRect(0, 0, WW, lay.sectionTop); }
    c.globalCompositeOperation = 'lighter';
    if (night > 0.5) { c.fillStyle = rgb(60, 70, 110, 0.12 * night); c.fillRect(0, lay.waterLevel - 20, WW, lay.sectionTop - lay.waterLevel + 20); }
    // sun rays: volumetric light, not geometry. A quarter-resolution field around the sun: soft angular noise makes
    // broad shafts and gaps of uneven width, fading with distance; smoothed up to the world, so no edge anywhere.
    if (this.sunPos && this.sunPos.up && alt > 0.1 && this.quality === 'high') this.drawRays(lay, alt);
    // the section: lit by the thing, the far layers in shadow
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    c.globalCompositeOperation = 'multiply';
    const ay = this.ayAt(WW / 2);
    const shadow = c.createRadialGradient(WW / 2, ay, 8, WW / 2, ay, 150);
    shadow.addColorStop(0, 'rgb(255,250,240)');
    shadow.addColorStop(0.45, 'rgb(190,180,190)');
    shadow.addColorStop(1, 'rgb(110,100,120)');
    c.fillStyle = shadow;
    c.fillRect(0, lay.sectionTop, WW, lay.sectionH);
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

  private rayCanvas = document.createElement('canvas');
  private rayImg: ImageData | null = null;
  private drawRays(lay: Layout, alt: number): void {
    const sp = this.sunPos!;
    const Q = 4;
    const w = Math.ceil(WW / Q), h = Math.ceil((lay.groundBase + 10) / Q);
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
    c.globalCompositeOperation = 'soft-light';
    c.fillStyle = rgb(col[0], col[1], col[2], 0.45);
    c.fillRect(0, 0, WW, WH);
    c.globalCompositeOperation = 'multiply';
    const m = lerp3([255, 255, 255], col, 0.18);
    c.fillStyle = rgb(m[0], m[1], m[2]);
    c.fillRect(0, 0, WW, WH);
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
    c.fillStyle = v; c.fillRect(0, 0, WW, WH);
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
    const y = wy - this.lay.sectionTop;
    if (y < 0 || y >= this.lay.sectionH) return null;
    return y;
  }

  isArtifact(wx: number, wy: number, g: Game, reach = 1): number {
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    for (let i = 0; i < xs.length; i++) if (Math.abs(wx - xs[i]) < 9 * reach && Math.abs(wy - this.ayAt(xs[i])) < 8 * reach) return i;
    return -1;
  }
}

function ease(k: number): number { return k * k * (3 - 2 * k); }
