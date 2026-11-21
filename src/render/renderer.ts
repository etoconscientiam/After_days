// World renderer at 180×320 (scaled up with nearest-neighbour). Upper half: sky and a living diorama of the surface.
// Lower half: the section with the newest rows large and depth compressed, the glowing technogenic horizon and the thing.
// Reads core state only; never mutates it.
import { CFG } from '../config';
import type { Game } from '../core/game';
import { totalPop } from '../core/life';
import { hash2 } from '../core/rng';
import { Layout, WW, WH, NOISE, lerp, lerp3, hex3, rgb, ACCENT } from './common';
import { SectionRenderer } from './section';
import { drawFossil, fossilKind } from './skins';
import { CREATURES, Pose, birdFlying, hominid } from './creatures';
import { drawItem } from './items';
import { renderEcho, EW, EH } from './echoes';
import { drawScene, drawWall, VW, VH } from './ritual';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Ring { t: number; x: number }

const SKY = {
  night: { top: hex3('#060914'), hor: hex3('#18203a') },
  twilight: { top: hex3('#262a52'), hor: hex3('#d8805a') },
  day: { top: hex3('#3a74c0'), hor: hex3('#a8cfee') },
};
const RUST = { top: hex3('#3a2a2a'), hor: hex3('#b07850') };
/** Colour grade per era (soft-light wash): dusty rust, primal teal, sea blue, land green-gold, beasts amber, hominid ochre, tribes firelight, finding night blue. */
const GRADE = ['#c08060', '#60a090', '#5080b0', '#90b060', '#c0a060', '#c09050', '#d07040', '#5060a0'];
const L = CFG.B.layout;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lay = new Layout();
  section = new SectionRenderer();
  dayPhase = 0.3;
  seasonPhase = 0.2;
  daySeconds = 1;
  skyDim = 0;
  flash = 0;
  shake = 0;
  particles: Particle[] = [];
  rings: Ring[] = [];
  hover: { x: number; y: number } | null = null;
  targeting: { rx: number; ry: number; x: number; y: number; kind: string } | null = null;
  reveal = Infinity;
  quality: 'high' | 'low' = 'high';
  chooseHover = -1;
  private t = 0;
  private dt = 1 / 60;
  private depthTimer = 0;
  private alarm = -99;               // time of the last startle (click, catastrophe)
  private clouds: HTMLCanvasElement[] = [];
  private hills: Float32Array[] = [];
  private stars: { x: number; y: number; b: number }[] = [];
  private shiftFx: { img: HTMLCanvasElement; t: number; top: number; h: number } | null = null;
  private echo: { picture: string; t: number; x: number; alpha: number; canvas: HTMLCanvasElement } | null = null;
  private echoQueue: { picture: string; alpha: number }[] = [];
  private seedThread = -1;
  private vignette = document.createElement('canvas');
  private vignetteA = 0;
  private sinkFx: { id: string; x0: number; t: number } | null = null;
  private meteorFxSeen = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = WW;
    canvas.height = WH;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < 70; i++) this.stars.push({ x: hash2(i, 1) * WW, y: hash2(i, 2) * 110, b: 0.3 + hash2(i, 3) * 0.7 });
    for (let l = 0; l < 3; l++) this.clouds.push(this.makeClouds(l));
    // two hill silhouettes (heights above their baseline), tileable
    for (let l = 0; l < 2; l++) {
      const h = new Float32Array(WW);
      for (let x = 0; x < WW; x++) {
        const n = NOISE[((l * 70 + 20) << 8) | ((x * (l ? 3 : 2)) & 255)];
        const n2 = NOISE[((l * 70 + 90) << 8) | ((x * (l ? 9 : 6)) & 255)];
        h[x] = (l ? 12 : 30) * n + (l ? 4 : 8) * n2;
      }
      this.hills.push(h);
    }
  }

  /** Strip of pixel cloud puffs: flat light tops, shaded bellies. Three sizes for parallax. */
  private makeClouds(layer: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = WW; c.height = 40;
    const x = c.getContext('2d')!;
    const n = [5, 4, 3][layer];
    const size = [0.6, 1, 1.5][layer];
    for (let i = 0; i < n; i++) {
      const cx = (i + hash2(i, layer + 40) * 0.6) * (WW / n);
      const cy = 22 + hash2(i, layer + 41) * 10;
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
  onClick(x: number = WW / 2): void {
    this.rings.push({ t: 0, x });
    this.flash = Math.min(1, this.flash + 0.3);
    this.shake = Math.min(2, this.shake + 0.8);
    this.alarm = this.t;
    const n = this.quality === 'high' ? 10 : 4;
    const ay = this.ayAt(x);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 10 + Math.random() * 25;
      this.particles.push({ x, y: ay, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.6 + Math.random() * 0.6, color: Math.random() < 0.5 ? ACCENT : '#fff2c0', size: 1 });
    }
  }
  onExtinction(): void { this.skyDim = Math.min(1, this.skyDim + 0.6); this.shake = Math.min(3, this.shake + 1.5); this.alarm = this.t; }
  onQuake(): void { this.shake = 4; this.alarm = this.t; }
  onEra(era: number): void { if (era === 1) this.seedThread = 0; }

  burst(x: number, y: number, color: string, n = 6): void {
    if (this.quality === 'low') n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 14;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6, life: 0, max: 0.5 + Math.random() * 0.5, color, size: 1 });
    }
  }

  beginShift(): void {
    const c = document.createElement('canvas');
    c.width = WW; c.height = this.lay.sectionH;
    c.getContext('2d')!.drawImage(this.section.canvas, 0, 0, WW, this.lay.sectionH, 0, 0, WW, this.lay.sectionH);
    this.shiftFx = { img: c, t: 0, top: this.lay.sectionTop, h: this.lay.sectionH };
    this.reveal = Infinity;
  }

  showEcho(picture: string, alpha: number): void {
    if (this.echo) { if (this.echoQueue.length < 3) this.echoQueue.push({ picture, alpha }); return; }
    const canvas = document.createElement('canvas');
    canvas.width = EW; canvas.height = EH;
    this.echo = { picture, t: 0, x: 8 + Math.random() * (WW - EW - 16), alpha, canvas };
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
    this.daySeconds = g.state.phase !== 'play' ? 20 : Math.max(0.6, Math.min(20, 20 * Math.sqrt(0.1 / Math.max(1e-3, yps))));
    this.dayPhase = (this.dayPhase + dt / this.daySeconds) % 1;
    this.seasonPhase = (this.seasonPhase + dt / (this.daySeconds * 10)) % 1;
    this.skyDim = Math.max(0, this.skyDim - dt * 0.08);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 5);
    if (this.reveal !== Infinity) this.reveal += (dt * this.lay.sectionH) / 2.2;
    if (this.reveal > this.lay.sectionH + L.artifactH) this.reveal = Infinity;

    this.depthTimer -= dt;
    if (this.depthTimer <= 0) {
      this.depthTimer = 1;
      let deepest = 0;
      for (let x = 0; x < WW; x += 6) deepest = Math.max(deepest, g.world.visualDepth(x));
      this.lay.fitDepth(deepest);
    }
    this.section.maybeRender(g, this.lay, now, this.reveal);
    this.lay.artifactY = this.ayAt(WW / 2);
    if (g.state.phase === 'choose') { this.drawChoose(g); return; }

    c.save();
    if (this.shake > 0.05) c.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    c.fillStyle = '#0d0b0e';
    c.fillRect(-4, -4, WW + 8, WH + 8);
    const sky = this.skyColors(g);
    this.drawSky(g, sky);
    this.drawEcho(dt);
    this.drawHills(g, sky);
    this.drawSection(g);
    this.drawGround(g, sky);
    this.drawLife(g, sky);
    this.drawFog(g, sky);
    this.drawShift(dt);
    this.drawHorizon(g);
    this.drawParticles(dt);
    this.drawLight(g);
    this.drawGrade(g, sky);
    if (g.state.phase === 'finale' || g.state.phase === 'temple' || g.state.phase === 'newWorld' || g.state.phase === 'end') this.drawFinale(g);
    else this.vignetteA = 0;
    this.drawSink(dt);
    c.restore();
  }

  // ---------- sky ----------
  private sunAlt(): number { return Math.sin((this.dayPhase - 0.25) * Math.PI * 2); }

  winterAmount(): number {
    const s = this.seasonPhase;
    const d = Math.min(Math.abs(s - 0.875), 1 - Math.abs(s - 0.875));
    return Math.max(0, 1 - d / 0.15);
  }

  private skyColors(g: Game): { top: number[]; hor: number[]; light: number } {
    let alt = this.sunAlt();
    const fast = Math.max(0, Math.min(1, (2.5 - this.daySeconds) / 2));
    alt = lerp(alt, 0.35 + alt * 0.25, fast);
    let top: number[], hor: number[];
    if (alt < -0.25) { top = SKY.night.top; hor = SKY.night.hor; }
    else if (alt < 0.1) { const k = (alt + 0.25) / 0.35; top = lerp3(SKY.night.top, SKY.twilight.top, k); hor = lerp3(SKY.night.hor, SKY.twilight.hor, k); }
    else if (alt < 0.4) { const k = (alt - 0.1) / 0.3; top = lerp3(SKY.twilight.top, SKY.day.top, k); hor = lerp3(SKY.twilight.hor, SKY.day.hor, k); }
    else { top = SKY.day.top; hor = SKY.day.hor; }
    const rust = Math.max(0, 1 - g.run.oxygen / 16) * 0.75;
    const light = Math.max(0.25, Math.min(1, (alt + 0.3) / 0.7));
    top = lerp3(top, RUST.top.map((v) => v * light), rust);
    hor = lerp3(hor, RUST.hor.map((v) => v * light), rust);
    const dim = 1 - this.skyDim * 0.55;
    if (g.run.active.some((a) => a.id === 'volcanoFx' || a.id === 'meteorFx')) { top = lerp3(top, [40, 30, 30], 0.4); hor = lerp3(hor, [120, 70, 50], 0.4); }
    return { top: top.map((v) => v * dim), hor: hor.map((v) => v * dim), light: light * dim };
  }

  private drawSky(g: Game, sky: { top: number[]; hor: number[]; light: number }): void {
    const c = this.ctx;
    const lay = this.lay;
    const bottom = lay.waterLevel + 2;
    for (let y = 0; y < bottom; y++) {
      const k = Math.max(0, Math.min(1, (y + lay.shift) / (bottom + lay.shift)));
      const col = lerp3(sky.top, sky.hor, k * k);
      c.fillStyle = rgb(col[0], col[1], col[2]);
      c.fillRect(0, y, WW, 1);
    }
    const alt = this.sunAlt();
    const fast = this.daySeconds < 2.5;
    const starA = fast ? 0.15 : Math.max(0, Math.min(1, -alt * 2.5));
    if (starA > 0.02) for (const s of this.stars) {
      c.fillStyle = rgb(230, 230, 255, starA * s.b * (0.6 + 0.4 * Math.sin(this.t * 2 + s.x)));
      c.fillRect(Math.round(s.x), Math.round(s.y - lay.shift), 1, 1);
    }
    this.drawSatellites(g, alt, fast);
    // sun & moon with a soft glow
    const horizon = lay.groundBase - 6;
    if (!fast) {
      const ang = (this.dayPhase - 0.25) * Math.PI * 2;
      const sx = WW / 2 - Math.cos(ang) * WW * 0.45, sy = horizon - Math.sin(ang) * 70;
      if (sy < horizon + 4) {
        const grd = c.createRadialGradient(sx, sy, 1, sx, sy, 22);
        grd.addColorStop(0, 'rgba(255,230,170,0.5)'); grd.addColorStop(1, 'rgba(255,200,120,0)');
        c.fillStyle = grd; c.fillRect(sx - 22, sy - 22, 44, 44);
        c.fillStyle = '#ffe9b0'; c.beginPath(); c.arc(Math.round(sx), Math.round(sy), 3, 0, 7); c.fill();
      }
      const mx = WW / 2 + Math.cos(ang) * WW * 0.45, my = horizon + Math.sin(ang) * 64;
      if (my < horizon + 4) {
        c.fillStyle = '#dfe4f0'; c.beginPath(); c.arc(Math.round(mx), Math.round(my), 3, 0, 7); c.fill();
        c.fillStyle = rgb(sky.top[0], sky.top[1], sky.top[2]); c.beginPath(); c.arc(Math.round(mx) + 1.5, Math.round(my) - 1, 2.6, 0, 7); c.fill();
      }
    }
    // three cloud layers: far ones slow and small, near ones fast and large
    const cloudA = (0.35 + 0.5 * sky.light) * (g.run.oxygen > 5 ? 1 : 0.5);
    for (let l = 0; l < this.clouds.length; l++) {
      const speed = [1.2, 2.6, 5][l] * (fast ? 3 : 1);
      const off = (this.t * speed) % WW;
      const y = [26, 14, 2][l] - lay.shift * (0.6 + l * 0.2);
      c.globalAlpha = cloudA * [0.45, 0.6, 0.75][l];
      c.drawImage(this.clouds[l], -Math.round(off), Math.round(y));
      c.drawImage(this.clouds[l], WW - Math.round(off), Math.round(y));
    }
    c.globalAlpha = 1;
    // weather
    if (g.run.active.some((a) => a.id === 'rain' || a.id === 'flood')) {
      c.fillStyle = 'rgba(30,40,60,0.25)'; c.fillRect(0, 0, WW, bottom);
      c.fillStyle = 'rgba(170,190,220,0.55)';
      for (let i = 0; i < (this.quality === 'high' ? 80 : 30); i++) {
        const x = (hash2(i, 5) * WW + this.t * 20) % WW, y = (hash2(i, 6) * bottom + this.t * 150) % bottom;
        c.fillRect(Math.round(x), Math.round(y), 1, 2);
      }
    }
    if (!fast && this.winterAmount() > 0.3 && g.run.era >= 3) {
      c.fillStyle = 'rgba(240,244,255,0.85)';
      for (let i = 0; i < 50; i++) c.fillRect(Math.round((hash2(i, 8) * WW + Math.sin(this.t + i) * 4) % WW), Math.round((hash2(i, 9) * bottom + this.t * 10) % bottom), 1, 1);
    }
    const v = g.run.active.find((a) => a.id === 'volcanoFx');
    if (v && v.x !== undefined) {
      const left = (v.until - g.run.year) / 30;
      const gy = this.groundY(v.x, g);
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

  private drawSatellites(g: Game, alt: number, fast: boolean): void {
    const r = g.run;
    if (g.meta.prestiges > 0 || r.era > 1 || g.state.phase !== 'play') return;
    const c = this.ctx;
    const S = CFG.story.satellites;
    const rt = r.realTime;
    const dark = fast ? 0.55 : Math.max(0.35, Math.min(1, -alt * 2.5 + 0.4));
    const sh = this.lay.shift;
    for (let i = 0; i < S.low; i++) {
      const tf = S.firstFallSec + i * S.fallEverySec;
      const speed = 2 + hash2(i, 22) * 4;
      const posX = (tt: number) => ((hash2(i, 21) * (WW + 10) + tt * speed) % (WW + 10)) - 5;
      const y = 6 + hash2(i, 23) * 50 - sh;
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
      c.fillRect(12 + j * 29 + Math.round(hash2(j, 41) * 10), Math.round(10 + hash2(j, 42) * 24 - sh), 1, 1);
    }
  }

  private drawFlyingBirds(g: Game): void {
    const n = Math.min(12, Math.ceil(totalPop(g, 'birds') / 3));
    if (n <= 0) return;
    const c = this.ctx;
    const t = this.t;
    const pose: Pose = { t, i: 0, flip: false, alert: 0, walk: 0, season: this.seasonPhase };
    const lx = ((t * 7 + 40) % (WW + 80)) - 40;
    const ly = this.lay.surfaceTop - 6 + Math.sin(t * 0.4) * 5;
    for (let i = 0; i < n; i++) {
      // a loose V drifting across, each bird wobbling a little (boids-lite)
      const row = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
      birdFlying(c, lx - row * 11 + Math.sin(t * 2 + i) * 1.2, ly + row * 4 * side + Math.cos(t * 1.7 + i) * 1.2, { ...pose, i });
    }
  }

  // ---------- diorama ----------
  /** Distant mountains and nearer hills, hazed toward the sky colour. */
  private drawHills(g: Game, sky: { top: number[]; hor: number[]; light: number }): void {
    const c = this.ctx;
    const lay = this.lay;
    const green = Math.min(1, (totalPop(g, 'mosses') + totalPop(g, 'trees')) / 30);
    const night = 1 - sky.light;
    const far = lerp3(sky.hor, [70, 66, 86], 0.45);
    const nearBase = lerp3([96, 84, 74], [70, 96, 60], green);
    const near = lerp3(nearBase, sky.hor, 0.25).map((v) => v * (1 - night * 0.55));
    const winter = this.winterAmount() > 0.5 && g.run.era >= 3 && this.daySeconds > 2;
    for (let x = 0; x < WW; x++) {
      const xf = (x + Math.round(this.t * 0.5)) % WW;
      const hf = this.hills[0][xf];
      const yf = Math.round(lay.groundBase - 6 - hf);
      c.fillStyle = rgb(far[0], far[1], far[2]);
      c.fillRect(x, yf, 1, lay.groundBase - yf);
      if (winter && hf > 18) { c.fillStyle = 'rgba(236,240,248,0.7)'; c.fillRect(x, yf, 1, 2); }
      const hn = this.hills[1][x];
      const yn = Math.round(lay.groundBase - 1 - hn);
      c.fillStyle = rgb(near[0], near[1], near[2]);
      c.fillRect(x, yn, 1, lay.groundBase - yn + 2);
    }
  }

  groundY(x: number, g: Game): number {
    const lay = this.lay;
    const xi = Math.max(0, Math.min(WW - 1, x | 0));
    const zi = g.zoneMap[xi];
    if (g.mods.shards) {
      for (const rx of g.shardXs().slice(0, 2).map((v) => v + 30)) {
        const d = Math.abs(x - rx);
        if (d < 7) return Math.round(lay.groundBase - 10 * Math.pow(1 - d / 7, 1.3));
      }
    }
    if (zi === 0) return lay.sectionTop - 1;
    const n = NOISE[(40 << 8) | ((xi * 3) & 255)];
    if (zi === 1) {
      let edge = xi; while (edge > 0 && g.zoneMap[edge - 1] === 1) edge--;
      let end = xi; while (end < WW - 1 && g.zoneMap[end + 1] === 1) end++;
      const k = (xi - edge) / Math.max(1, end - edge + 1);
      const leftWater = edge > 0 && g.zoneMap[edge - 1] === 0;
      const kk = leftWater ? k : 1 - k;
      return Math.round(lay.waterLevel + 2 - kk * (lay.waterLevel + 2 - lay.groundBase));
    }
    return Math.round(lay.groundBase - n * 3 - Math.sin(xi * 0.08) * 1.5);
  }

  private drawGround(g: Game, sky: { top: number[]; hor: number[]; light: number }): void {
    const c = this.ctx;
    const lay = this.lay;
    const r = g.run;
    const sea = lay.waterLevel;
    const bottom = lay.sectionTop;
    const night = 1 - sky.light;
    const drought = r.active.some((a) => a.id === 'drought');
    const glacier = r.active.some((a) => a.id === 'glacier');
    const green = Math.min(1, (totalPop(g, 'mosses') + totalPop(g, 'trees')) / 30) * (drought ? 0.3 : 1);
    const winter = this.winterAmount() > 0.5 && r.era >= 3 && this.daySeconds > 2;
    const t = this.t;
    for (let x = 0; x < WW; x++) {
      const zi = g.zoneMap[x];
      const gy = this.groundY(x, g);
      if (zi === 0) {
        for (let y = sea; y < bottom; y++) {
          const k = (y - sea) / (bottom - sea);
          // sky reflected near the surface, deep teal below, slow light shafts
          const shaft = Math.max(0, Math.sin(x * 0.12 + y * 0.25 - t * 0.6)) ** 6 * 0.25 * sky.light;
          const base = lerp3(lerp3(sky.hor, [46, 96, 124], 0.6), [12, 36, 58], k);
          c.fillStyle = rgb(base[0] * (1 - night * 0.5) + shaft * 120, base[1] * (1 - night * 0.5) + shaft * 140, base[2] * (1 - night * 0.45) + shaft * 120);
          c.fillRect(x, y, 1, 1);
        }
        const wave = Math.sin(x * 0.5 + t * 2) + Math.sin(x * 0.2 - t * 1.3);
        c.fillStyle = rgb(200, 230, 245, 0.5 + wave * 0.15);
        c.fillRect(x, sea + (wave > 1 ? -1 : 0), 1, 1);
        if (glacier) { c.fillStyle = 'rgba(220,235,245,0.85)'; c.fillRect(x, sea, 1, 2); }
        continue;
      }
      if (zi === 1 && gy > sea) { c.fillStyle = 'rgb(46,90,116)'; c.fillRect(x, sea, 1, gy - sea); }
      let top: number[];
      if (glacier || winter) top = [232, 238, 246];
      else if (zi === 1) top = drought ? [214, 186, 130] : [206, 178, 122];
      else if (r.era < 3 || green < 0.05) top = drought ? [200, 170, 120] : [146, 126, 102];
      else {
        const s = this.seasonPhase * 4;
        top = lerp3([146, 126, 102], s < 1 ? [112, 168, 72] : s < 2 ? [84, 136, 52] : s < 3 ? [176, 132, 60] : [120, 110, 80], green);
      }
      // the field: a plane seen slightly from above, darker far away, lit near the front, with tufts
      for (let y = gy; y < bottom; y++) {
        const k = (y - gy) / Math.max(1, bottom - gy);
        const n = NOISE[((y * 7) & 255) * 256 + ((x * 5 + y * 3) & 255)];
        const shade = 0.72 + 0.28 * k + (n - 0.5) * 0.22;
        const lip = y >= bottom - 2 ? 0.55 : 1;
        c.fillStyle = rgb(top[0] * shade * lip * (1 - night * 0.55), top[1] * shade * lip * (1 - night * 0.55), top[2] * shade * lip * (1 - night * 0.5));
        c.fillRect(x, y, 1, 1);
      }
      // grass tufts and flowers scattered over the field, swaying
      if (zi === 2 && green > 0.15 && !winter) {
        for (let q = 0; q < 2; q++) {
          if (hash2(x, 50 + q) > 0.18 + green * 0.25) continue;
          const ty = Math.round(gy + 2 + hash2(x, 60 + q) * (bottom - gy - 4));
          const hgt = 1 + Math.round(hash2(x, 70 + q) * 3 * green);
          const sw = Math.sin(t * 2 + x * 0.3 + q) > 0.4 ? 1 : 0;
          c.fillStyle = rgb(top[0] * 0.62 * (1 - night * 0.55), top[1] * 0.8 * (1 - night * 0.55), top[2] * 0.5);
          c.fillRect(x + sw, ty - hgt, 1, hgt);
          if (this.seasonPhase < 0.3 && hash2(x, 80 + q) > 0.8) { c.fillStyle = q ? '#f0e080' : '#e890b0'; c.fillRect(x + sw, ty - hgt - 1, 1, 1); }
        }
      }
    }
    this.drawTraces(g);
    const vfx = r.active.find((a) => a.id === 'volcanoFx');
    if (vfx && vfx.x !== undefined) {
      const gy = this.groundY(vfx.x, g);
      for (let k = 0; k < 10; k++) { c.fillStyle = k < 2 ? '#ff7a2a' : '#4a3a34'; c.fillRect(Math.round(vfx.x - 10 + k), gy - k, Math.round(20 - k * 2), 1); }
    }
  }

  private drawTraces(g: Game): void {
    const r = g.run;
    const T = CFG.story.traces;
    if (g.meta.prestiges > 0 || r.year >= T.endYear) return;
    const c = this.ctx;
    for (let i = 0; i < T.count; i++) {
      const erase = CFG.startYear + ((i + 1) / T.count) * (T.endYear - CFG.startYear);
      const a = Math.max(0, Math.min(1, (erase - r.year) / 1800)) * 0.8;
      if (a <= 0) continue;
      const x0 = Math.round(r.waterEnd + 4 + hash2(i, 31) * (WW - r.waterEnd - 30));
      const len = Math.round(8 + hash2(i, 32) * 18);
      let gy = 999;
      for (let x = x0; x < Math.min(WW, x0 + len); x++) gy = Math.min(gy, this.groundY(x, g));
      if (i % 3 === 0) {
        const w = Math.round(len * 0.6);
        c.fillStyle = rgb(176, 170, 160, a);
        c.fillRect(x0, gy - 3, w, 1); c.fillRect(x0, gy - 3, 1, 3); c.fillRect(x0 + w - 1, gy - 3, 1, 3);
      } else {
        c.fillStyle = rgb(120, 120, 118, a); c.fillRect(x0, gy, len, 1);
        c.fillStyle = rgb(210, 206, 190, a * 0.6);
        for (let x = x0 + 1; x < x0 + len; x += 4) c.fillRect(x, gy, 2, 1);
      }
    }
  }

  private segments(g: Game): { zi: number; x0: number; x1: number }[] {
    const segs: { zi: number; x0: number; x1: number }[] = [];
    let s = 0;
    for (let x = 1; x <= WW; x++) if (x === WW || g.zoneMap[x] !== g.zoneMap[s]) { segs.push({ zi: g.zoneMap[s], x0: s, x1: x - 1 }); s = x; }
    return segs;
  }

  /** Living diorama: a sample of each species, with idle behaviour and a startle reaction. */
  private drawLife(g: Game, sky: { light: number }): void {
    const c = this.ctx;
    const t = this.t;
    const lay = this.lay;
    const segs = this.segments(g);
    const since = t - this.alarm;
    const alert = since < 1.8 ? 1 : 0;
    const caps: Record<string, number> = { mat: 6, plankton: 14, mollusc: 6, fish: 7, moss: 12, tree: 9, insect: 8, bird: 5, herd: 6, predator: 4, hominid: 4, tribe: 7 };
    const queue: { y: number; draw: () => void }[] = [];
    for (const sp of CFG.species) {
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
          // idle cycle: graze / wander
          const cycle = (t * 0.07 + h) % 1;
          const walking = sp.sprite === 'herd' || sp.sprite === 'predator' || sp.sprite === 'hominid' || sp.sprite === 'tribe' ? (cycle > 0.6 ? 1 : 0) : 0;
          const wander = Math.sin(t * 0.05 + h * 6) * 10;
          let x = bx + (walking || sp.sprite === 'fish' ? wander : 0);
          const flip = Math.cos(t * 0.05 + h * 6) < 0;
          const pose: Pose = { t: t + h * 10, i, flip, alert, walk: walking, season: this.seasonPhase, tint: sp.tint };
          let y = this.groundY(x, g);
          if (zi !== 0 && sp.sprite !== 'tree') y = Math.round(y + 3 + hash2(i, sp.idx + 99) * (lay.sectionTop - y - 6));
          else if (sp.sprite === 'tree') y = Math.round(y + 1 + hash2(i, sp.idx + 99) * 5);
          if (zi === 0) {
            if (sp.sprite === 'fish') {
              y = lay.waterLevel + 6 + h * (lay.sectionTop - lay.waterLevel - 10);
              x = bx + Math.sin(t * (0.4 + h * 0.3) + h * 9) * 16 + (alert ? (h > 0.5 ? 1 : -1) * since * 20 : 0);
              pose.flip = Math.cos(t * (0.4 + h * 0.3) + h * 9) < 0;
            } else if (sp.sprite === 'plankton') y = lay.waterLevel + 3 + h * (lay.sectionTop - lay.waterLevel - 6);
            else y = lay.sectionTop - 1;
          }
          if (sp.sprite === 'bird') {
            // perched birds take off when startled and come back later
            if (since < 5) {
              const k = since / 5;
              birdFlying(c, x + (h - 0.5) * 60 * k, y - 4 - Math.sin(k * Math.PI) * 40, pose);
              continue;
            }
          }
          const fn = CREATURES[sp.sprite] ?? CREATURES.glow;
          const fx = x, fy = y, living = g.mods.living && i % 3 === 0;
          queue.push({ y: fy + (sp.sprite === 'tree' ? -0.5 : 0), draw: () => { fn(c, fx, fy, pose); if (living) CREATURES.glow(c, fx + 2, fy - 5, pose); } });
        }
      }
    }
    // far to near, so the field reads as depth
    queue.sort((a, b) => a.y - b.y);
    for (const q of queue) q.draw();
    if (g.run.era >= 6 && g.state.phase === 'play') this.drawCamp(g);
    void sky;
  }

  private drawCamp(g: Game): void {
    const c = this.ctx;
    const x = WW / 2;
    const gy = this.groundY(x, g);
    if (!(g.run.era >= 7 || g.settlePop() > 0)) return;
    const f = 0.6 + 0.4 * Math.sin(this.t * 9) * Math.sin(this.t * 13);
    c.globalCompositeOperation = 'lighter';
    const grd = c.createRadialGradient(x + 10, gy - 2, 0, x + 10, gy - 2, 14);
    grd.addColorStop(0, rgb(255, 140, 40, 0.35 * f)); grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd; c.fillRect(x - 4, gy - 16, 28, 28);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = rgb(255, 180, 60, f); c.fillRect(x + 9, gy - 3, 3, 2);
    c.fillStyle = '#ffe080'; c.fillRect(x + 10, gy - 4, 1, 1);
    for (const dx of [-16, 20]) {
      c.fillStyle = '#16121a'; c.beginPath(); c.moveTo(x + dx - 6, gy + 1); c.lineTo(x + dx, gy - 10); c.lineTo(x + dx + 6, gy + 1); c.fill();
      c.fillStyle = '#7a5a3c'; c.beginPath(); c.moveTo(x + dx - 5, gy); c.lineTo(x + dx, gy - 9); c.lineTo(x + dx + 5, gy); c.fill();
      c.fillStyle = '#2a1e14'; c.fillRect(x + dx - 1, gy - 3, 2, 3);
    }
    if (g.run.era >= 7) this.drawShaft(g, Math.min(1, g.run.excavation / Math.max(1, g.run.excavationNeed)));
  }

  private drawShaft(g: Game, k: number): void {
    const c = this.ctx;
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    xs.forEach((x, idx) => {
      const gy = this.groundY(x, g);
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

  /** Mist lying in the hollows: thicker at dawn and in the early, wet eras. */
  private drawFog(g: Game, sky: { light: number }): void {
    const c = this.ctx;
    const lay = this.lay;
    const dawn = Math.max(0, 1 - Math.abs(this.sunAlt() - 0.05) * 3);
    const a = (0.07 + 0.14 * dawn + (g.run.era <= 2 ? 0.06 : 0)) * (this.daySeconds < 2.5 ? 0.6 : 1);
    const y0 = lay.groundBase - 16, y1 = lay.waterLevel + 2;
    for (let y = y0; y < y1; y++) {
      const k = (y - y0) / (y1 - y0);
      const drift = Math.sin(y * 0.7 + this.t * 0.3) * 0.04;
      c.fillStyle = rgb(220 * sky.light + 40, 222 * sky.light + 40, 230 * sky.light + 50, a * Math.sin(k * Math.PI) + drift);
      c.fillRect(0, y, WW, 1);
    }
  }

  // ---------- section ----------
  private drawSection(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const top = lay.sectionTop;
    const hh = lay.sectionH + L.artifactH;
    c.drawImage(this.section.canvas, 0, 0, WW, hh, 0, top, WW, hh);
    let drawn = 0;
    for (const f of this.section.fossils) {
      if (f.fragment) { c.fillStyle = 'rgba(240,230,200,0.9)'; c.fillRect(f.x, top + f.y, 1, 1); continue; }
      if (drawn++ > 80) break;
      const sp = CFG.species[f.species];
      drawFossil(c, f.x, top + f.y, sp ? fossilKind(sp.id) : 'bone', f.rare, this.t);
    }
    for (const z of this.section.zones) {
      for (let i = 0; i < z.pts.length; i += 2) {
        const ph = Math.sin(this.t * 3 + i * 1.7);
        if (ph < 0.3) continue;
        c.fillStyle = z.kind === 'water' ? rgb(140, 200, 255, ph * 0.8) : rgb(255, 140 + 60 * ph, 60, ph * 0.7);
        c.fillRect(z.pts[i], top + z.pts[i + 1], 1, 1);
      }
    }
    for (const gl of g.glints) {
      const y = top + lay.vToY(Math.max(0, gl.depth));
      if (y > top + lay.sectionH) continue;
      c.globalAlpha = Math.min(1, gl.t * 2);
      c.fillStyle = gl.color;
      c.fillRect(gl.x - 1, y, 3, 1); c.fillRect(gl.x, y - 1, 1, 3);
      c.globalAlpha = 1;
    }
    // a soft dark lip under the surface and darker depths
    const grd = c.createLinearGradient(0, top, 0, top + hh);
    grd.addColorStop(0, 'rgba(0,0,0,0.25)'); grd.addColorStop(0.06, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(5,3,8,0.45)');
    c.fillStyle = grd; c.fillRect(0, top, WW, hh);
    if (this.hover && !this.targeting) {
      c.fillStyle = 'rgba(242,193,78,0.35)'; c.fillRect(0, top + this.hover.y, WW, 1);
      c.fillStyle = 'rgba(242,193,78,0.9)'; c.fillRect(this.hover.x, top + this.hover.y - 1, 1, 3);
    }
    if (this.targeting) {
      const tg = this.targeting;
      const ry = Math.max(4, lay.vToY(tg.ry));
      c.strokeStyle = tg.kind === 'groundwater' ? 'rgba(120,190,255,0.9)' : 'rgba(255,140,50,0.95)';
      c.setLineDash([2, 2]); c.lineDashOffset = -this.t * 8;
      c.strokeRect(Math.round(tg.x - tg.rx) + 0.5, Math.round(top + tg.y - ry / 2) + 0.5, tg.rx * 2, ry);
      c.setLineDash([]);
    }
  }

  // ---------- horizon & the thing ----------
  ayAt(x: number): number {
    const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
    return this.lay.sectionTop + this.section.horizonTop[xi] + CFG.story.horizon.rows / 2;
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
      this.particles.push({ x: pts[i], y: top + pts[i + 1], vx: (Math.random() - 0.5) * 2, vy: -4 - Math.random() * 5, life: 0, max: 2 + Math.random() * 2, color: Math.random() < 0.6 ? '#f2c14e' : '#ffe6a0', size: 1 });
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
        c.fillRect(sx + Math.round(Math.sin(y * 0.4 + this.t) * 1), Math.round(y), 1, 1);
      }
      if (this.seedThread > 6) this.seedThread = -1;
    }
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    const item = g.currentItem() ?? 'artifact_a';
    const ph = g.state.phase;
    xs.forEach((x, idx) => {
      if (ph === 'newWorld' || ph === 'end') return;
      if (ph === 'temple' && g.state.ritualChoice !== 'bury') return;
      let ay = this.ayAt(x);
      if (ph === 'temple') ay += Math.min(1, g.state.templeProgress * 3) * 5;
      drawItem(c, item, x, ay, 9, 'glow', true, g.mods.shards ? idx : -1);
    });
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t += dt;
      const k = rg.t / 0.9;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const ay = this.ayAt(rg.x);
      const y = ay - k * (ay - lay.groundBase);
      c.strokeStyle = rgb(242, 193, 78, (1 - k) * 0.7);
      c.beginPath(); c.ellipse(rg.x, y, 12 + k * 30, 2 + k * 4, 0, 0, Math.PI * 2); c.stroke();
    }
  }

  private drawParticles(dt: number): void {
    const c = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 6 * dt;
      c.globalAlpha = 1 - p.life / p.max;
      c.fillStyle = p.color;
      c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    c.globalAlpha = 1;
  }

  /** Additive glows: the thing and its layer, heat zones, a flash on clicks. */
  private drawLight(g: Game): void {
    const c = this.ctx;
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    const boost = Math.min(1, g.run.boost / 3);
    c.globalCompositeOperation = 'lighter';
    for (const x of xs) {
      const ay = this.ayAt(x);
      const R = 26 + boost * 16 + Math.sin(this.t * 2.2) * 2;
      const grd = c.createRadialGradient(x, ay, 1, x, ay, R);
      grd.addColorStop(0, rgb(242, 193, 78, 0.5 + this.flash * 0.3));
      grd.addColorStop(0.4, rgb(200, 120, 40, 0.14));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd; c.fillRect(x - R, ay - R, R * 2, R * 2);
    }
    for (let x = 0; x < WW; x += 3) {
      c.fillStyle = rgb(242, 170, 70, g.glow[x] * (0.12 + 0.03 * Math.sin(this.t * 1.7 + x * 0.1)));
      c.fillRect(x, this.ayAt(x) - 5, 3, 7);
    }
    g.run.targets.forEach((t, ti) => {
      if (t.kind === 'water') return;
      const z = this.section.zones[ti];
      if (!z || z.pts.length < 2) return;
      let sx = 0, sy = 0;
      for (let i = 0; i < z.pts.length; i += 2) { sx += z.pts[i]; sy += z.pts[i + 1]; }
      const n = z.pts.length / 2, cx = sx / n, cy = this.lay.sectionTop + sy / n;
      const grd = c.createRadialGradient(cx, cy, 1, cx, cy, 22);
      grd.addColorStop(0, rgb(255, 90, 30, t.kind === 'magma' ? 0.35 : 0.18)); grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd; c.fillRect(cx - 22, cy - 22, 44, 44);
    });
    if (this.flash > 0) { c.fillStyle = rgb(255, 230, 170, this.flash * 0.1); c.fillRect(0, 0, WW, WH); }
    c.globalCompositeOperation = 'source-over';
  }

  /** Colour grade by era and a vignette: what separates a game from a program. */
  private drawGrade(g: Game, sky: { light: number }): void {
    const c = this.ctx;
    const col = hex3(GRADE[Math.min(7, g.run.era)]);
    c.globalCompositeOperation = 'soft-light';
    c.fillStyle = rgb(col[0], col[1], col[2], 0.35);
    c.fillRect(0, 0, WW, WH);
    c.globalCompositeOperation = 'source-over';
    const v = c.createRadialGradient(WW / 2, WH * 0.46, WW * 0.35, WW / 2, WH * 0.46, WH * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(6,4,10,${0.5 + (1 - sky.light) * 0.15})`);
    c.fillStyle = v; c.fillRect(0, 0, WW, WH);
  }

  private drawShift(dt: number): void {
    const fx = this.shiftFx;
    if (!fx) return;
    fx.t += dt;
    const c = this.ctx;
    const k = Math.min(1, fx.t / 2.6);
    const sink = k * k * fx.h;
    c.save();
    c.beginPath(); c.rect(0, fx.top, WW, fx.h); c.clip();
    c.globalAlpha = 1 - k * 0.85;
    c.drawImage(fx.img, 0, fx.top + sink);
    c.fillStyle = `rgba(6,4,10,${0.25 + k * 0.6})`; c.fillRect(0, fx.top + sink, WW, fx.h);
    c.restore();
    c.globalAlpha = 1;
    if (k < 0.8 && this.quality === 'high') for (let i = 0; i < 4; i++) {
      this.particles.push({ x: Math.random() * WW, y: fx.top + sink + Math.random() * 4, vx: (Math.random() - 0.5) * 5, vy: -5 - Math.random() * 10, life: 0, max: 1 + Math.random(), color: Math.random() < 0.5 ? '#b8ae98' : '#8a8070', size: 1 });
    }
    if (k >= 1) { this.shiftFx = null; this.flash = 0.8; this.reveal = 0; }
  }

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
    const env = Math.min(1, e.t / 0.7) * Math.min(1, (dur - e.t) / 1.1);
    renderEcho(e.canvas, e.picture, e.t);
    this.ctx.globalAlpha = env * e.alpha;
    this.ctx.drawImage(e.canvas, Math.round(e.x), Math.round(Math.max(42, this.lay.surfaceTop - 18) - (1 - env) * 2));
    this.ctx.globalAlpha = 1;
  }

  // ---------- the opening choice ----------
  chooseXs(n: number): number[] { return n === 3 ? [36, 90, 144] : n === 2 ? [60, 120] : [90]; }

  private drawChoose(g: Game): void {
    const c = this.ctx;
    c.fillStyle = '#08070a'; c.fillRect(0, 0, WW, WH);
    for (let i = 0; i < 80; i++) { c.fillStyle = `rgba(255,255,255,${0.02 + 0.02 * Math.sin(this.t + i)})`; c.fillRect((i * 97) % WW, (i * 53) % WH, 1, 1); }
    const items = g.availableItems();
    const xs = this.chooseXs(items.length);
    items.forEach((id, i) => {
      const hover = this.chooseHover === i;
      const y = 160 + Math.sin(this.t * 0.8 + i * 2) * 1;
      if (hover) {
        const grd = c.createRadialGradient(xs[i], y, 2, xs[i], y, 30);
        grd.addColorStop(0, 'rgba(242,193,78,0.18)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd; c.fillRect(xs[i] - 30, y - 30, 60, 60);
      }
      drawItem(c, id, xs[i], y, 32, hover ? 'hover' : 'silhouette');
    });
  }

  private drawSink(dt: number): void {
    const s = this.sinkFx;
    if (!s) return;
    s.t += dt;
    const k = Math.min(1, s.t / 2.8);
    const c = this.ctx;
    c.fillStyle = `rgba(8,7,10,${1 - k})`; c.fillRect(0, 0, WW, WH);
    const x = s.x0 + (WW / 2 - s.x0) * Math.min(1, k * 1.6);
    const y = 160 + (this.ayAt(WW / 2) - 160) * k * k;
    c.globalAlpha = 1 - Math.max(0, (k - 0.75) / 0.25);
    drawItem(c, s.id, x, y, k < 0.5 ? 32 : 16, 'silhouette');
    c.globalAlpha = 1;
    if (k >= 1) this.sinkFx = null;
  }

  // ---------- finale, ritual, temple ----------
  private drawFinale(g: Game): void {
    const c = this.ctx;
    const x = WW / 2;
    const gy = this.groundY(x, g);
    c.fillStyle = 'rgba(4,3,8,0.5)'; c.fillRect(0, 0, WW, WH);
    this.drawShaft(g, 1);
    for (let i = 0; i < 4; i++) {
      const k = g.state.phase === 'finale' ? Math.min(1, (this.t * 0.08 + i * 0.12) % 1.2) : 0.9 - i * 0.05;
      const yy = gy + (this.ayAt(x) - 10 - gy) * k;
      hominid(c, x + (i % 2 ? 2 : -2), yy, { t: this.t, i, flip: i % 2 === 0, alert: 0, walk: 0, season: 0 }, true);
    }
    if (g.state.phase === 'temple' || g.state.phase === 'newWorld' || g.state.phase === 'end') {
      const p = g.state.phase === 'temple' ? g.state.templeProgress : 1;
      const rit = g.state.ritualChoice ?? g.legacy.rituals[g.legacy.rituals.length - 1];
      this.drawTemple(x, gy, Math.max(0, (p - 0.45) / 0.55));
      const vc = this.vignette;
      vc.width = VW; vc.height = VH;
      const vx = vc.getContext('2d')!;
      vx.imageSmoothingEnabled = false;
      if (g.state.phase === 'temple' && p < 0.45) drawScene(vx, rit, p / 0.45, this.t, g.currentItem() ?? 'artifact_a');
      else if (g.state.phase === 'end') drawWall(vx, g.legacy.rituals, null, 1, this.t);
      else drawWall(vx, g.legacy.rituals.filter((r) => r !== rit), rit, g.state.phase === 'temple' ? (p - 0.45) / 0.4 : 1, this.t);
      this.vignetteA = Math.min(1, this.vignetteA + this.dt * 0.8);
      const ox = (WW - VW) / 2, oy = 44;
      c.globalAlpha = this.vignetteA;
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(ox - 1, oy - 1, VW + 2, VH + 2);
      c.drawImage(vc, ox, oy);
      c.strokeStyle = 'rgba(242,193,78,0.4)'; c.strokeRect(ox - 0.5, oy - 0.5, VW + 1, VH + 1);
      c.globalAlpha = 1;
    }
  }

  private drawTemple(x: number, gy: number, p: number): void {
    const c = this.ctx;
    if (p <= 0) return;
    const ring = Math.min(1, p / 0.25);
    for (let i = 0; i < 10; i++) {
      if (i / 10 > ring) break;
      const a = (i / 10) * Math.PI * 2;
      c.fillStyle = '#16121a'; c.fillRect(Math.round(x + Math.cos(a) * 18) - 2, Math.round(gy + Math.sin(a) * 2) - 5, 4, 5);
      c.fillStyle = '#aaa08c'; c.fillRect(Math.round(x + Math.cos(a) * 18) - 1, Math.round(gy + Math.sin(a) * 2) - 4, 2, 4);
    }
    if (p > 0.25) { c.fillStyle = '#9a907c'; c.fillRect(x - 4, gy - 4, 9, 4); c.fillStyle = ACCENT; c.fillRect(x, gy - 6, 1, 2); }
    if (p > 0.45) {
      const h = Math.round(18 * Math.min(1, (p - 0.45) / 0.3));
      c.fillStyle = '#16121a'; c.fillRect(x - 19, gy - h - 1, 6, h + 1); c.fillRect(x + 14, gy - h - 1, 6, h + 1);
      c.fillStyle = '#968a76'; c.fillRect(x - 18, gy - h, 4, h); c.fillRect(x + 15, gy - h, 4, h);
    }
    if (p > 0.75) {
      const a = Math.min(1, (p - 0.75) / 0.25);
      c.fillStyle = rgb(176, 164, 140, a);
      c.beginPath(); c.ellipse(x + 0.5, gy - 18, 19, 12 * a, 0, Math.PI, Math.PI * 2); c.fill();
      c.fillStyle = ACCENT; c.fillRect(x, Math.round(gy - 18 - 12 * a - 3), 1, 3);
    }
  }

  // ---------- picking ----------
  sectionY(wy: number): number | null {
    const y = wy - this.lay.sectionTop;
    if (y < 0 || y >= this.lay.sectionH + L.artifactH) return null;
    return y;
  }

  isArtifact(wx: number, wy: number, g: Game): number {
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    for (let i = 0; i < xs.length; i++) if (Math.abs(wx - xs[i]) < 9 && Math.abs(wy - this.ayAt(xs[i])) < 8) return i;
    return -1;
  }
}
