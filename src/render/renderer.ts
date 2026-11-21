// World renderer: sky, surface, section, foundation, artifact, particles, light, finale & temple scenes.
// Reads core state only; never mutates it.
import { CFG, ZONES } from '../config';
import type { Game } from '../core/game';
import { totalPop } from '../core/life';
import { hash2 } from '../core/rng';
import { Layout, WW, WH, NOISE, lerp, lerp3, hex3, rgb, ACCENT } from './common';
import { SectionRenderer } from './section';
import { SKINS, drawFossil, fossilKind } from './skins';
import { drawItem } from './items';
import { renderEcho, EW, EH } from './echoes';
import { drawScene, drawWall, VW, VH } from './ritual';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Ring { t: number; x: number }

const SKY_KEYS = {
  night: { top: hex3('#060914'), hor: hex3('#141c32') },
  twilight: { top: hex3('#262a52'), hor: hex3('#d8805a') },
  day: { top: hex3('#3a74c0'), hor: hex3('#a8cfee') },
};
const RUST = { top: hex3('#3a2a2a'), hor: hex3('#b07850') };

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
  private clouds: HTMLCanvasElement[] = [];
  private stars: { x: number; y: number; b: number }[] = [];
  private t = 0;
  private meteorFxSeen = new Set<number>();
  private shiftFx: { img: HTMLCanvasElement; t: number; top: number; h: number } | null = null;
  private echo: { picture: string; t: number; x: number; y: number; alpha: number; canvas: HTMLCanvasElement } | null = null;
  private seedThread = -1;
  private vignette = document.createElement('canvas');
  private vignetteA = 0;
  chooseHover = -1;
  private sinkFx: { id: string; x0: number; t: number } | null = null;
  private dt = 1 / 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = WW;
    canvas.height = WH;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < 90; i++) this.stars.push({ x: hash2(i, 1) * WW, y: hash2(i, 2) * 150, b: 0.3 + hash2(i, 3) * 0.7 });
    for (let l = 0; l < 2; l++) this.clouds.push(this.makeClouds(l));
  }

  /** A strip of pixel cloud puffs: flat light tops, shaded bellies. */
  private makeClouds(layer: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = WW; c.height = 70;
    const x = c.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    const n = layer ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const cx = (i + hash2(i, layer + 40) * 0.6) * (WW / n);
      const cy = 28 + hash2(i, layer + 41) * 22;
      const w = 18 + hash2(i, layer + 42) * (layer ? 26 : 40);
      const puffs = 4 + Math.floor(hash2(i, layer + 43) * 4);
      for (let k = 0; k < puffs; k++) {
        const px = cx - w / 2 + (k / Math.max(1, puffs - 1)) * w;
        const r = 4 + hash2(i * 7 + k, layer + 44) * (layer ? 5 : 8) * (1 - Math.abs(k / (puffs - 1) - 0.5));
        const py = cy - r * 0.5;
        for (let yy = -r; yy <= r; yy++) {
          const hw = Math.round(Math.sqrt(r * r - yy * yy));
          // wrap horizontally so the strip tiles
          for (const ox of [0, -WW, WW]) {
            x.fillStyle = yy > r * 0.35 ? 'rgba(196,204,226,0.9)' : 'rgba(244,246,255,0.92)';
            x.fillRect(Math.round(px - hw + ox), Math.round(py + yy), hw * 2, 1);
          }
        }
      }
      x.fillStyle = 'rgba(170,180,210,0.9)';
      for (const ox of [0, -WW, WW]) x.fillRect(Math.round(cx - w / 2 + ox), Math.round(cy), Math.round(w), 1);
    }
    return c;
  }

  // ---------- events from the game ----------
  onClick(x: number = WW / 2): void {
    this.rings.push({ t: 0, x });
    this.flash = Math.min(1, this.flash + 0.35);
    this.shake = Math.min(3, this.shake + 1.2);
    const n = this.quality === 'high' ? 14 : 5;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 20 + Math.random() * 50;
      this.particles.push({ x, y: this.ayAt(x), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.6 + Math.random() * 0.6, color: Math.random() < 0.5 ? ACCENT : '#fff2c0', size: 1 });
    }
  }
  /** Snapshot the section before an epoch shift; the snapshot then sinks, darkens and crumbles. */
  beginShift(): void {
    const c = document.createElement('canvas');
    c.width = WW; c.height = this.lay.sectionH;
    c.getContext('2d')!.drawImage(this.section.canvas, 0, 0, WW, this.lay.sectionH, 0, 0, WW, this.lay.sectionH);
    this.shiftFx = { img: c, t: 0, top: this.lay.sectionTop, h: this.lay.sectionH };
    this.reveal = Infinity;
  }

  private drawShift(dt: number): void {
    const fx = this.shiftFx;
    if (!fx) return;
    fx.t += dt;
    const c = this.ctx;
    const k = Math.min(1, fx.t / 2.6);
    const sink = k * k * fx.h;
    c.save();
    c.beginPath();
    c.rect(0, fx.top, WW, fx.h);
    c.clip();
    c.globalAlpha = 1 - k * 0.85;
    c.drawImage(fx.img, 0, fx.top + sink);
    c.fillStyle = `rgba(6,4,10,${0.25 + k * 0.6})`;
    c.fillRect(0, fx.top + sink, WW, fx.h);
    c.restore();
    c.globalAlpha = 1;
    // top layers lighten and fall apart into dust
    if (k < 0.8 && this.quality === 'high') {
      for (let i = 0; i < 6; i++) {
        const x = Math.random() * WW;
        this.particles.push({ x, y: fx.top + sink + Math.random() * 6, vx: (Math.random() - 0.5) * 8, vy: -8 - Math.random() * 18, life: 0, max: 1 + Math.random(), color: Math.random() < 0.5 ? '#b8ae98' : '#8a8070', size: 1 });
      }
    }
    if (k >= 1) {
      this.shiftFx = null;
      this.flash = 0.8;
      this.reveal = 0;
    }
  }

  onExtinction(): void { this.skyDim = Math.min(1, this.skyDim + 0.6); this.shake = Math.min(4, this.shake + 2); }
  onQuake(): void { this.shake = 5; }

  burst(x: number, y: number, color: string, n = 8): void {
    if (this.quality === 'low') n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 10 + Math.random() * 25;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, life: 0, max: 0.5 + Math.random() * 0.5, color, size: 1 });
    }
  }

  // ---------- frame ----------
  draw(g: Game, dt: number, now: number): void {
    const c = this.ctx;
    this.t += dt;
    const yps = g.state.phase === 'play' ? g.yps() : 0.02;
    // visual time is decoupled from game time
    this.daySeconds = Math.max(0.6, Math.min(20, 20 * Math.sqrt(0.1 / Math.max(1e-3, yps))));
    if (g.state.phase !== 'play') this.daySeconds = 20;
    this.dayPhase = (this.dayPhase + dt / this.daySeconds) % 1;
    this.seasonPhase = (this.seasonPhase + dt / (this.daySeconds * 10)) % 1;
    this.skyDim = Math.max(0, this.skyDim - dt * 0.08);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 6);
    if (this.reveal !== Infinity) this.reveal += dt * this.lay.sectionH / 2.2;
    if (this.reveal > this.lay.sectionH) this.reveal = Infinity;

    this.section.maybeRender(g, this.lay, now, this.reveal);
    this.lay.artifactY = this.ayAt(WW / 2);
    this.dt = dt;
    if (g.state.phase === 'choose') { this.drawChoose(g); return; }

    c.save();
    if (this.shake > 0.05) c.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    c.fillStyle = '#0d0b0e';
    c.fillRect(-4, -4, WW + 8, WH + 8);
    this.drawSky(g);
    this.drawEcho(dt);
    this.drawSection(g);
    this.drawSurface(g);
    this.drawShift(dt);
    this.drawArtifactZone(g);
    this.drawParticles(dt);
    this.drawLight(g);
    if (g.state.phase === 'finale' || g.state.phase === 'temple' || g.state.phase === 'newWorld' || g.state.phase === 'end') this.drawFinale(g);
    else this.vignetteA = 0;
    this.drawSink(g, dt);
    c.restore();
  }

  // ---------- sky ----------
  private sunAlt(): number { return Math.sin((this.dayPhase - 0.25) * Math.PI * 2); }

  private skyColors(g: Game): { top: number[]; hor: number[]; light: number } {
    let alt = this.sunAlt();
    // when days flicker by, soften the pulse instead of strobing
    const fast = Math.max(0, Math.min(1, (2.5 - this.daySeconds) / 2));
    alt = lerp(alt, 0.35 + alt * 0.25, fast);
    let top: number[], hor: number[];
    if (alt < -0.25) { top = SKY_KEYS.night.top; hor = SKY_KEYS.night.hor; }
    else if (alt < 0.1) {
      const k = (alt + 0.25) / 0.35;
      top = lerp3(SKY_KEYS.night.top, SKY_KEYS.twilight.top, k); hor = lerp3(SKY_KEYS.night.hor, SKY_KEYS.twilight.hor, k);
    } else if (alt < 0.4) {
      const k = (alt - 0.1) / 0.3;
      top = lerp3(SKY_KEYS.twilight.top, SKY_KEYS.day.top, k); hor = lerp3(SKY_KEYS.twilight.hor, SKY_KEYS.day.hor, k);
    } else { top = SKY_KEYS.day.top; hor = SKY_KEYS.day.hor; }
    // thin, oxygen-poor air is rusty
    const rust = Math.max(0, 1 - g.run.oxygen / 16) * 0.75;
    const light = Math.max(0.25, Math.min(1, (alt + 0.3) / 0.7));
    top = lerp3(top, RUST.top.map((v) => v * light), rust);
    hor = lerp3(hor, RUST.hor.map((v) => v * light), rust);
    // winter is paler, mass death darkens
    const winter = this.winterAmount();
    top = lerp3(top, [top[0] + 20, top[1] + 20, top[2] + 25], winter * 0.3);
    const dim = 1 - this.skyDim * 0.55;
    if (g.run.active.some((a) => a.id === 'volcanoFx' || a.id === 'meteorFx')) {
      top = lerp3(top, [40, 30, 30], 0.4); hor = lerp3(hor, [120, 70, 50], 0.4);
    }
    return { top: top.map((v) => v * dim), hor: hor.map((v) => v * dim), light: light * dim };
  }

  winterAmount(): number {
    // seasons: 0 spring .. 0.75 winter
    const s = this.seasonPhase;
    const d = Math.min(Math.abs(s - 0.875), 1 - Math.abs(s - 0.875));
    return Math.max(0, 1 - d / 0.15);
  }

  private drawSky(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const bottom = lay.surfaceY + 40;
    const { top, hor, light } = this.skyColors(g);
    for (let y = 0; y < bottom; y += 2) {
      const k = Math.max(0, Math.min(1, (y + lay.shift) / (bottom + lay.shift)));
      const col = lerp3(top, hor, k * k);
      c.fillStyle = rgb(col[0], col[1], col[2]);
      c.fillRect(0, y, WW, 2);
    }
    const alt = this.sunAlt();
    const fast = this.daySeconds < 2.5;
    // stars
    const starA = fast ? 0.15 : Math.max(0, Math.min(1, -alt * 2.5));
    if (starA > 0.02) {
      for (const s of this.stars) {
        const tw = 0.6 + 0.4 * Math.sin(this.t * 2 + s.x);
        c.fillStyle = rgb(230, 230, 255, starA * s.b * tw);
        c.fillRect(Math.round(s.x), Math.round(s.y - lay.shift), 1, 1);
      }
    }
    this.drawSatellites(g, alt, fast);
    // sun & moon along an arc
    if (!fast) {
      const ang = (this.dayPhase - 0.25) * Math.PI * 2;
      const sx = WW / 2 - Math.cos(ang) * WW * 0.45, sy = lay.surfaceY + 30 - Math.sin(ang) * 120;
      if (sy < lay.surfaceY + 34) {
        c.fillStyle = rgb(255, 230, 170, 0.25); c.beginPath(); c.arc(sx, sy, 9, 0, 7); c.fill();
        c.fillStyle = '#ffe6a8'; c.beginPath(); c.arc(sx, sy, 4.5, 0, 7); c.fill();
      }
      const mx = WW / 2 + Math.cos(ang) * WW * 0.45, my = lay.surfaceY + 30 + Math.sin(ang) * 110;
      if (my < lay.surfaceY + 34) {
        c.fillStyle = '#dfe4f0'; c.beginPath(); c.arc(mx, my, 4, 0, 7); c.fill();
        c.fillStyle = rgb(top[0], top[1], top[2]); c.beginPath(); c.arc(mx + 2, my - 1, 3.5, 0, 7); c.fill();
      }
    } else {
      // a soft pulsing glow where the sun keeps passing
      c.fillStyle = rgb(255, 220, 160, 0.08 + 0.05 * Math.sin(this.dayPhase * Math.PI * 2));
      c.beginPath(); c.arc(WW * 0.7, lay.surfaceY - 30, 30, 0, 7); c.fill();
    }
    // clouds
    const cloudA = (0.35 + 0.45 * light) * (g.run.oxygen > 5 ? 1 : 0.5);
    for (let l = 0; l < this.clouds.length; l++) {
      const speed = (3 + l * 5) * (fast ? 3 : 1);
      const off = (this.t * speed) % WW;
      const y = 10 + l * 35 - lay.shift;
      c.globalAlpha = cloudA * (l ? 0.7 : 0.5);
      c.drawImage(this.clouds[l], -off, y);
      c.drawImage(this.clouds[l], WW - off, y);
    }
    c.globalAlpha = 1;
    // precipitation
    const raining = g.run.active.some((a) => a.id === 'rain' || a.id === 'flood');
    if (raining) {
      c.fillStyle = 'rgba(30,40,60,0.25)';
      c.fillRect(0, 0, WW, bottom);
      c.fillStyle = 'rgba(170,190,220,0.55)';
      const n = this.quality === 'high' ? 140 : 50;
      for (let i = 0; i < n; i++) {
        const x = (hash2(i, 5) * WW + this.t * 40) % WW;
        const y = (hash2(i, 6) * bottom + this.t * 260) % bottom;
        c.fillRect(Math.round(x), Math.round(y), 1, 3);
      }
    }
    if (!fast && this.winterAmount() > 0.3 && g.run.era >= 3) {
      c.fillStyle = 'rgba(240,244,255,0.85)';
      for (let i = 0; i < 80; i++) {
        const x = (hash2(i, 8) * WW + Math.sin(this.t + i) * 6) % WW;
        const y = (hash2(i, 9) * bottom + this.t * 18) % bottom;
        c.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    // volcano plume
    const v = g.run.active.find((a) => a.id === 'volcanoFx');
    if (v && v.x !== undefined) {
      const left = (v.until - g.run.year) / 30;
      for (let i = 0; i < 60; i++) {
        const k = i / 60;
        const yy = lay.surfaceY + 30 - k * 170;
        const xx = v.x + Math.sin(this.t * 2 + i * 0.4) * (3 + k * 25) + k * 30;
        c.fillStyle = rgb(60 + 30 * k, 55 + 25 * k, 55 + 25 * k, 0.5 * left * (1 - k * 0.6));
        c.beginPath(); c.arc(xx, yy, 3 + k * 14, 0, 7); c.fill();
      }
      c.fillStyle = rgb(255, 120, 40, 0.6 * left);
      c.fillRect(v.x - 2, lay.surfaceY + 28, 5, 6);
    }
    const m = g.run.active.find((a) => a.id === 'meteorFx');
    if (m && m.x !== undefined) {
      const k = Math.max(0, Math.min(1, (m.until - g.run.year) / 60));
      if (!this.meteorFxSeen.has(m.until)) { this.meteorFxSeen.add(m.until); this.flash = 1; this.shake = 6; this.skyDim = 1; }
      c.fillStyle = rgb(255, 200, 140, 0.35 * k);
      c.beginPath(); c.arc(m.x, lay.surfaceY + 34, 30 * k + 6, 0, 7); c.fill();
    }
    // birds in the sky
    this.drawBirds(g);
  }

  /** Era 0: the last satellites crawl over the sky; low ones fall one by one, high ones go out. */
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
      const speed = 3 + hash2(i, 22) * 7;
      const posX = (tt: number) => ((hash2(i, 21) * (WW + 20) + tt * speed) % (WW + 20)) - 10;
      const y = 10 + hash2(i, 23) * 70 - sh;
      if (rt < tf) {
        c.fillStyle = rgb(235, 238, 255, dark * 0.85);
        c.fillRect(Math.round(posX(rt)), Math.round(y), 1, 1);
      } else if (rt < tf + 1.3) {
        const k = (rt - tf) / 1.3;
        const x0 = posX(tf);
        for (let q = 0; q < 7; q++) {
          const kk = Math.max(0, k - q * 0.03);
          c.fillStyle = q < 2 ? rgb(255, 240, 200, 1 - k) : rgb(255, 140 - q * 10, 40, (1 - k) * (1 - q / 7));
          c.fillRect(Math.round(x0 + kk * 40), Math.round(y + kk * 60), 1, 1);
        }
      }
    }
    for (let j = 0; j < S.high; j++) {
      const last = j === S.high - 1;
      let a = dark;
      if (!last) {
        const fadeYear = CFG.startYear + ((j + 1) / S.high) * (CFG.eras[0].end - CFG.startYear);
        a *= Math.max(0, Math.min(1, (fadeYear - r.year) / 60));
      } else if (r.era >= 1) {
        a *= Math.max(0, 1 - (rt - (r.timeAtEra[1] ?? rt)) / 1.5);
      }
      if (a <= 0.01) continue;
      c.fillStyle = rgb(255, 250, 235, a);
      c.fillRect(24 + j * 58 + Math.round(hash2(j, 41) * 20), Math.round(14 + hash2(j, 42) * 34 - sh), 1, 1);
    }
  }

  private drawBirds(g: Game): void {
    const n = Math.min(40, totalPop(g, 'birds'));
    if (n <= 0) return;
    const c = this.ctx;
    const lay = this.lay;
    const t = this.t;
    const flocks = Math.max(1, Math.ceil(n / 12));
    let k = 0;
    for (let f = 0; f < flocks; f++) {
      const lx = (t * (8 + f * 3) + f * 130) % (WW + 80) - 40;
      const ly = lay.surfaceY - 40 - f * 18 + Math.sin(t * 0.5 + f) * 10;
      for (let i = 0; i < 12 && k < n; i++, k++) {
        const bx = lx - (i % 4) * 5 - Math.floor(i / 4) * 3 + Math.sin(t * 2 + i) * 1.5;
        const by = ly + Math.abs((i % 4) - 1.5) * 3 + Math.floor(i / 4) * 4 + Math.cos(t * 1.7 + i) * 1.2;
        SKINS.bird(c, bx, by, { t, i, season: this.seasonPhase });
      }
    }
  }

  // ---------- surface ----------
  groundY(x: number, g: Game): number {
    const lay = this.lay;
    const zi = g.zoneMap[Math.max(0, Math.min(WW - 1, x | 0))];
    const sea = lay.surfaceY + 36;
    if (g.mods.shards) {
      // rocky ridges divide the three basins
      for (const rx of [120, 240]) {
        const d = Math.abs(x - rx);
        if (d < 14) return Math.round(lay.surfaceY + 33 - 16 * Math.pow(1 - d / 14, 1.4) + (hash2(x, 77) < 0.3 ? 1 : 0));
      }
    }
    if (zi === 0) return lay.surfaceY + 49;
    const n = NOISE[(40 << 8) | ((x * 2) & 255)];
    if (zi === 1) {
      // shore slope from the water toward the land
      let edge = x;
      while (edge > 0 && g.zoneMap[edge - 1] === 1) edge--;
      let end = x;
      while (end < WW - 1 && g.zoneMap[end + 1] === 1) end++;
      const k = (x - edge) / Math.max(1, end - edge + 1);
      const leftWater = edge > 0 && g.zoneMap[edge - 1] === 0;
      const kk = leftWater ? k : 1 - k;
      return Math.round(sea + 3 - kk * 6 + n * 1.5);
    }
    return Math.round(lay.surfaceY + 32 - n * 3 - Math.sin(x * 0.04) * 1.5);
  }

  private drawSurface(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const r = g.run;
    const sea = lay.surfaceY + 36;
    const bottom = lay.sectionTop;
    const night = 1 - this.skyColors(g).light;
    const winter = this.winterAmount();
    const drought = r.active.some((a) => a.id === 'drought');
    const glacier = r.active.some((a) => a.id === 'glacier');
    const plants = totalPop(g, 'mosses') + totalPop(g, 'trees');
    const green = Math.min(1, plants / 30) * (drought ? 0.3 : 1);
    const t = this.t;
    for (let x = 0; x < WW; x++) {
      const zi = g.zoneMap[x];
      const gy = this.groundY(x, g);
      if (zi === 0) {
        // water body
        for (let y = sea; y < bottom; y++) {
          const k = (y - sea) / (bottom - sea);
          c.fillStyle = rgb(lerp(46, 14, k) * (1 - night * 0.6), lerp(92, 40, k) * (1 - night * 0.6), lerp(120, 62, k) * (1 - night * 0.5));
          c.fillRect(x, y, 1, 1);
        }
        const wave = Math.sin(x * 0.35 + t * 2) + Math.sin(x * 0.13 - t * 1.3);
        c.fillStyle = rgb(170, 210, 230, 0.45 + wave * 0.15);
        c.fillRect(x, sea + (wave > 1 ? -1 : 0), 1, 1);
        if (glacier || (winter > 0.6 && r.era >= 4 && this.daySeconds > 2)) { c.fillStyle = 'rgba(220,235,245,0.8)'; c.fillRect(x, sea, 1, 2); }
      } else {
        if (zi === 1 && gy > sea) {
          c.fillStyle = 'rgb(40,80,110)';
          c.fillRect(x, sea, 1, gy - sea);
        }
        for (let y = gy; y < bottom; y++) {
          const k = (y - gy) / Math.max(1, bottom - gy);
          const base = zi === 1 ? [190, 160, 108] : (r.era < 3 ? [120, 104, 88] : [92, 66, 46]);
          c.fillStyle = rgb(lerp(base[0], 45, k) * (1 - night * 0.6), lerp(base[1], 36, k) * (1 - night * 0.6), lerp(base[2], 30, k) * (1 - night * 0.55));
          c.fillRect(x, y, 1, 1);
        }
        // top dressing: grass, dust, sand, snow
        let top: number[];
        if (glacier || (winter > 0.5 && r.era >= 3 && this.daySeconds > 2)) top = [230, 236, 244];
        else if (zi === 1) top = drought ? [214, 186, 130] : [204, 176, 120];
        else if (r.era < 3 || green < 0.05) top = drought ? [200, 170, 120] : [140, 122, 100];
        else {
          const s = this.seasonPhase * 4;
          const gcol = s < 1 ? [110, 160, 70] : s < 2 ? [80, 130, 50] : s < 3 ? [170, 130, 60] : [120, 110, 80];
          top = lerp3([140, 122, 100], gcol, green);
        }
        c.fillStyle = rgb(top[0] * (1 - night * 0.6), top[1] * (1 - night * 0.6), top[2] * (1 - night * 0.55));
        c.fillRect(x, gy, 1, 2);
      }
    }
    this.drawTraces(g);
    // life sprites
    this.drawLife(g, sea, bottom);
    // excavation shaft and camp
    if (r.era >= 6 && g.state.phase === 'play') this.drawCamp(g);
  }

  /** Straight roads and foundations of the old world, erased by erosion over the first millennia. */
  private drawTraces(g: Game): void {
    const r = g.run;
    const T = CFG.story.traces;
    if (g.meta.prestiges > 0 || r.year >= T.endYear) return;
    const c = this.ctx;
    for (let i = 0; i < T.count; i++) {
      const erase = CFG.startYear + ((i + 1) / T.count) * (T.endYear - CFG.startYear);
      const a = Math.max(0, Math.min(1, (erase - r.year) / 1800)) * 0.8;
      if (a <= 0) continue;
      const x0 = Math.round(r.waterEnd + 6 + hash2(i, 31) * (WW - r.waterEnd - 50));
      const len = Math.round(14 + hash2(i, 32) * 34);
      let gy = 999;
      for (let x = x0; x < Math.min(WW, x0 + len); x++) gy = Math.min(gy, this.groundY(x, g));
      if (i % 3 === 0) {
        const w = Math.round(len * 0.6), h = 4;
        c.fillStyle = rgb(176, 170, 160, a);
        c.fillRect(x0, gy - h, w, 1); c.fillRect(x0, gy - h, 1, h); c.fillRect(x0 + w - 1, gy - h, 1, h);
        c.fillRect(x0 + (w >> 1), gy - h, 1, h);
      } else {
        c.fillStyle = rgb(120, 120, 118, a);
        c.fillRect(x0, gy, len, 1);
        c.fillStyle = rgb(200, 196, 180, a * 0.6);
        for (let x = x0 + 2; x < x0 + len; x += 5) c.fillRect(x, gy, 2, 1);
      }
    }
  }

  private zoneSegments(g: Game): { zi: number; x0: number; x1: number }[] {
    const segs: { zi: number; x0: number; x1: number }[] = [];
    let s = 0;
    for (let x = 1; x <= WW; x++) {
      if (x === WW || g.zoneMap[x] !== g.zoneMap[s]) { segs.push({ zi: g.zoneMap[s], x0: s, x1: x - 1 }); s = x; }
    }
    return segs;
  }

  private drawLife(g: Game, sea: number, bottom: number): void {
    const c = this.ctx;
    const t = this.t;
    const segs = this.zoneSegments(g);
    const maxS = this.quality === 'high' ? CFG.spritesPerSpecies : 15;
    for (const sp of CFG.species) {
      if (sp.id === 'birds') continue;
      const p = g.run.pop[sp.id];
      for (let zi = 0; zi < 3; zi++) {
        const n = Math.min(maxS, Math.ceil(p[zi]));
        if (n <= 0) continue;
        const zsegs = segs.filter((s) => s.zi === zi);
        const width = zsegs.reduce((a, s) => a + s.x1 - s.x0 + 1, 0);
        for (let i = 0; i < n; i++) {
          let u = hash2(i * 13 + zi, sp.idx * 7 + 1) * width;
          let x = 0;
          for (const s of zsegs) { const w = s.x1 - s.x0 + 1; if (u < w) { x = s.x0 + u; break; } u -= w; }
          x = Math.round(x);
          if (sp.id === 'mats' && zi === 0 && !g.mods.shards) {
            const seed = CFG.story.horizon.lifeSeedX;
            x = Math.max(0, Math.min(g.run.waterEnd - 3, seed + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 3));
          }
          const gy = this.groundY(x, g);
          let y = gy;
          if (zi === 0) {
            if (sp.id === 'fish') y = sea + 4 + hash2(i, 9) * (bottom - sea - 8);
            else if (sp.id === 'plankton') y = sea + 2 + hash2(i, 4) * (bottom - sea - 4);
            else y = bottom - 1;
          }
          const fn = SKINS[sp.sprite] ?? SKINS.glow;
          fn(c, x, y, { t: t + hash2(i, sp.idx) * 10, i, season: this.seasonPhase, tint: sp.tint, flip: hash2(i, 3) > 0.5 });
          if (g.mods.living && i % 5 === 0) SKINS.glow(c, x + 2, y - 3, { t, i, season: 0 });
        }
      }
    }
  }

  private drawCamp(g: Game): void {
    const c = this.ctx;
    const x = WW / 2;
    const gy = this.groundY(x, g);
    const settled = g.run.era >= 7 || g.settlePop() > 0;
    if (!settled) return;
    // hearth glow and tents
    const f = 0.6 + 0.4 * Math.sin(this.t * 9) * Math.sin(this.t * 13);
    c.fillStyle = rgb(255, 140, 40, 0.25 * f);
    c.beginPath(); c.arc(x + 12, gy - 2, 8, 0, 7); c.fill();
    c.fillStyle = rgb(255, 180, 60, f);
    c.fillRect(x + 11, gy - 3, 3, 2);
    c.fillStyle = '#6a4a32';
    for (const dx of [-20, 26]) { c.beginPath(); c.moveTo(x + dx - 5, gy); c.lineTo(x + dx, gy - 8); c.lineTo(x + dx + 5, gy); c.fill(); }
    // excavation shaft
    if (g.run.era >= 7) this.drawShaft(g, Math.min(1, g.run.excavation / Math.max(1, g.run.excavationNeed)));
  }

  private drawShaft(g: Game, k: number): void {
    const c = this.ctx;
    const lay = this.lay;
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    xs.forEach((x, idx) => {
      const gy = this.groundY(x, g);
      const prog = g.mods.shards ? Math.min(1, g.run.excavationShards[idx] / Math.max(1, g.run.excavationNeed)) : k;
      const depth = (this.ayAt(x) - 6 - gy) * prog;
      c.fillStyle = 'rgba(10,8,8,0.92)';
      c.fillRect(x - 4, gy, 9, depth);
      c.fillStyle = 'rgba(120,90,60,0.6)';
      for (let y = gy; y < gy + depth; y += 6) c.fillRect(x - 4, y, 9, 1);
      // a torch at the bottom of the dig
      const f = 0.7 + 0.3 * Math.sin(this.t * 11 + idx);
      c.fillStyle = rgb(255, 150, 50, 0.3 * f);
      c.beginPath(); c.arc(x, gy + depth - 3, 7, 0, 7); c.fill();
      c.fillStyle = rgb(255, 200, 90, f);
      c.fillRect(x, gy + depth - 5, 1, 2);
    });
  }

  // ---------- section ----------
  private drawSection(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const top = lay.sectionTop;
    const hh = lay.sectionH + CFG.B.layout.artifactH;
    c.drawImage(this.section.canvas, 0, 0, WW, hh, 0, top, WW, hh);
    // fossil sprites
    let drawn = 0;
    for (const f of this.section.fossils) {
      if (f.fragment) { c.fillStyle = 'rgba(240,230,200,0.9)'; c.fillRect(f.x, top + f.y, 1, 1); continue; }
      if (drawn++ > 150) break;
      const sp = CFG.species[f.species];
      drawFossil(c, f.x, top + f.y, sp ? fossilKind(sp.id) : 'bone', f.rare, this.t);
    }
    // groundwater twinkles and heat shimmer
    for (const z of this.section.zones) {
      for (let i = 0; i < z.pts.length; i += 2) {
        const ph = Math.sin(this.t * 3 + i * 1.7);
        if (ph < 0.3) continue;
        if (z.kind === 'water') c.fillStyle = rgb(140, 200, 255, ph * 0.8);
        else c.fillStyle = rgb(255, 140 + 60 * ph, 60, ph * 0.7);
        c.fillRect(z.pts[i], top + z.pts[i + 1] + (z.kind === 'water' ? ((this.t * 4 + i) % 3) | 0 : 0), 1, 1);
      }
    }
    // transformation glints
    for (const gl of g.glints) {
      const y = top + lay.vToY(Math.max(0, gl.depth));
      if (y > top + lay.sectionH) continue;
      const a = Math.min(1, gl.t * 2);
      c.fillStyle = gl.color;
      c.globalAlpha = a;
      c.fillRect(gl.x - 2, y, 5, 1);
      c.fillRect(gl.x, y - 2, 1, 5);
      c.globalAlpha = 1;
    }
    // depth gradient: the deep is darker
    const grd = c.createLinearGradient(0, top, 0, top + hh);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(5,3,8,0.4)');
    c.fillStyle = grd;
    c.fillRect(0, top, WW, hh);
    // hover line
    if (this.hover && !this.targeting) {
      c.fillStyle = 'rgba(242,193,78,0.35)';
      c.fillRect(0, top + this.hover.y, WW, 1);
      c.fillStyle = 'rgba(242,193,78,0.8)';
      c.fillRect(this.hover.x - 1, top + this.hover.y - 1, 3, 3);
    }
    if (this.targeting) {
      const tg = this.targeting;
      c.strokeStyle = tg.kind === 'groundwater' ? 'rgba(120,190,255,0.9)' : tg.kind === 'magma' ? 'rgba(255,90,30,0.95)' : 'rgba(255,150,60,0.9)';
      c.setLineDash([2, 2]);
      c.lineDashOffset = -this.t * 10;
      c.strokeRect(Math.round(tg.x - tg.rx) + 0.5, Math.round(top + tg.y - tg.ry) + 0.5, tg.rx * 2, tg.ry * 2);
      c.setLineDash([]);
      c.fillStyle = tg.kind === 'groundwater' ? 'rgba(80,150,255,0.12)' : 'rgba(255,120,40,0.12)';
      c.fillRect(tg.x - tg.rx, top + tg.y - tg.ry, tg.rx * 2, tg.ry * 2);
    }
  }

  // ---------- horizon & the thing ----------
  /** Screen y of the middle of the technogenic horizon at column x (the thing lies there). */
  ayAt(x: number): number {
    const xi = Math.max(0, Math.min(WW - 1, Math.round(x)));
    return this.lay.sectionTop + this.section.horizonTop[xi] + CFG.story.horizon.rows / 2;
  }

  onEra(era: number): void { if (era === 1) this.seedThread = 0; }

  private drawArtifactZone(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const dt = this.dt;
    const top = lay.sectionTop;
    // the layer glows: rare warm pixels flicker and light drifts upward
    const pts = this.section.glowPts;
    for (let i = 0; i < pts.length; i += 2) {
      const ph = Math.sin(this.t * (1.1 + ((i >> 1) % 7) * 0.31) + i * 1.7);
      if (ph < 0.25) continue;
      c.fillStyle = rgb(255, 196 + 50 * ph, 110, ph * 0.95);
      c.fillRect(pts[i], top + pts[i + 1], 1, 1);
    }
    if (pts.length && this.quality === 'high' && Math.random() < dt * 9) {
      const i = (Math.floor(Math.random() * (pts.length / 2))) * 2;
      this.particles.push({ x: pts[i], y: top + pts[i + 1], vx: (Math.random() - 0.5) * 3, vy: -6 - Math.random() * 8, life: 0, max: 2 + Math.random() * 2, color: Math.random() < 0.6 ? '#f2c14e' : '#ffe6a0', size: 1 });
    }
    // the first life: a tiny point of another colour among the dead pixels
    const sx = CFG.story.horizon.lifeSeedX;
    const sy = this.ayAt(sx) - 1;
    const tw = 0.55 + 0.45 * Math.sin(this.t * 3.3);
    c.fillStyle = rgb(120, 255, 170, tw);
    c.fillRect(sx, Math.round(sy), 1, 1);
    if (this.seedThread >= 0) {
      this.seedThread += dt;
      const k = Math.min(1, this.seedThread / 3);
      const y0 = sy, y1 = lay.sectionTop;
      for (let y = y0; y > y0 - (y0 - y1) * k; y -= 1) {
        const xx = sx + Math.round(Math.sin(y * 0.3 + this.t) * 1.5);
        c.fillStyle = rgb(120, 230, 150, 0.7 * (1 - this.seedThread / 6));
        c.fillRect(xx, Math.round(y), 1, 1);
      }
      if (this.seedThread > 6) this.seedThread = -1;
    }
    // the thing itself lies in the middle of the glow
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    const item = g.currentItem() ?? 'artifact_a';
    const ph = g.state.phase;
    const p = g.state.templeProgress;
    xs.forEach((x, idx) => {
      if (ph === 'temple' || ph === 'newWorld' || ph === 'end') {
        const rit = g.state.ritualChoice;
        if (rit === 'eat' || rit === 'shatter' || ph !== 'temple') return;
      }
      let ay = this.ayAt(x);
      if (ph === 'temple' && g.state.ritualChoice === 'bury') ay += Math.min(1, p * 3) * 8;
      drawItem(c, item, x, ay, 13, 'glow', true, g.mods.shards ? idx : -1);
    });
    // click rings come out of the glowing layer around the thing
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t += dt;
      const k = rg.t / 0.9;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const ay = this.ayAt(rg.x);
      const y = ay - k * (ay - lay.surfaceY - 30);
      c.strokeStyle = rgb(242, 193, 78, (1 - k) * 0.7);
      c.beginPath();
      c.ellipse(rg.x, y, 26 + k * 60, 3 + k * 7, 0, 0, Math.PI * 2);
      c.stroke();
    }
  }

  // ---------- echoes ----------
  private echoQueue: { picture: string; alpha: number }[] = [];

  showEcho(picture: string, alpha: number): void {
    if (this.echo) { if (this.echoQueue.length < 3) this.echoQueue.push({ picture, alpha }); return; }
    const canvas = document.createElement('canvas');
    canvas.width = EW; canvas.height = EH;
    const x = 10 + Math.random() * (WW - EW - 20);
    this.echo = { picture, t: 0, x, y: 0, alpha, canvas };
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
    const y = Math.max(84, this.lay.surfaceY - 62);
    this.ctx.globalAlpha = env * e.alpha;
    this.ctx.drawImage(e.canvas, Math.round(e.x), Math.round(y - (1 - env) * 2));
    this.ctx.globalAlpha = 1;
  }

  // ---------- the opening choice ----------
  chooseXs(n: number): number[] {
    return n === 3 ? [72, 180, 288] : n === 2 ? [120, 240] : [180];
  }

  private drawChoose(g: Game): void {
    const c = this.ctx;
    c.fillStyle = '#08070a';
    c.fillRect(0, 0, WW, WH);
    for (let i = 0; i < 160; i++) {
      c.fillStyle = `rgba(255,255,255,${0.015 + 0.015 * Math.sin(this.t + i)})`;
      c.fillRect((i * 97) % WW, (i * 53) % WH, 1, 1);
    }
    const items = g.availableItems();
    const xs = this.chooseXs(items.length);
    items.forEach((id, i) => {
      const hover = this.chooseHover === i;
      const y = 320 + Math.sin(this.t * 0.8 + i * 2) * 1.5;
      if (hover) {
        const grd = c.createRadialGradient(xs[i], y, 4, xs[i], y, 60);
        grd.addColorStop(0, 'rgba(242,193,78,0.16)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd;
        c.fillRect(xs[i] - 60, y - 60, 120, 120);
      }
      drawItem(c, id, xs[i], y, 24, hover ? 'hover' : 'silhouette', false, -1, 3);
    });
  }

  /** The chosen thing goes down into the ground while the world appears. */
  beginSink(id: string, index: number, n: number): void {
    this.sinkFx = { id, x0: this.chooseXs(n)[index] ?? 180, t: 0 };
  }

  private drawSink(g: Game, dt: number): void {
    const s = this.sinkFx;
    if (!s) return;
    s.t += dt;
    const k = Math.min(1, s.t / 2.8);
    const c = this.ctx;
    c.fillStyle = `rgba(8,7,10,${1 - k})`;
    c.fillRect(0, 0, WW, WH);
    const e = k * k;
    const x = s.x0 + (WW / 2 - s.x0) * Math.min(1, k * 1.6);
    const y = 320 + (this.ayAt(WW / 2) - 320) * e;
    c.globalAlpha = 1 - Math.max(0, (k - 0.75) / 0.25);
    drawItem(c, s.id, x, y, 24, 'silhouette', false, -1, Math.max(0.6, 3 - k * 2.4));
    c.globalAlpha = 1;
    if (k >= 1) this.sinkFx = null;
  }

  private drawParticles(dt: number): void {
    const c = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 10 * dt;
      c.globalAlpha = 1 - p.life / p.max;
      c.fillStyle = p.color;
      c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    c.globalAlpha = 1;
  }

  private drawLight(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    const boost = Math.min(1, g.run.boost / 3);
    c.globalCompositeOperation = 'lighter';
    for (const x of xs) {
      const R = 46 + boost * 30 + Math.sin(this.t * 2.2) * 4;
      const ay = this.ayAt(x);
      const grd = c.createRadialGradient(x, ay, 1, x, ay, R);
      grd.addColorStop(0, rgb(242, 193, 78, 0.45 + this.flash * 0.3));
      grd.addColorStop(0.4, rgb(200, 120, 40, 0.12));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.fillRect(x - R, ay - R, R * 2, R * 2);
    }
    // a warm band along the technogenic horizon
    for (let x = 0; x < WW; x += 4) {
      const a = g.glow[x] * (0.12 + 0.03 * Math.sin(this.t * 1.7 + x * 0.05));
      c.fillStyle = rgb(242, 170, 70, a);
      c.fillRect(x, this.ayAt(x) - 7, 4, 10);
    }
    // heat zones glow from inside
    for (const t of g.run.targets) {
      if (t.kind === 'water') continue;
      const z = this.section.zones[g.run.targets.indexOf(t)];
      if (!z || z.pts.length < 2) continue;
      let sx = 0, sy = 0;
      for (let i = 0; i < z.pts.length; i += 2) { sx += z.pts[i]; sy += z.pts[i + 1]; }
      const n = z.pts.length / 2;
      const cx = sx / n, cy = lay.sectionTop + sy / n;
      const grd = c.createRadialGradient(cx, cy, 1, cx, cy, 40);
      grd.addColorStop(0, rgb(255, 90, 30, t.kind === 'magma' ? 0.35 : 0.18));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.fillRect(cx - 40, cy - 40, 80, 80);
    }
    if (this.flash > 0) {
      c.fillStyle = rgb(255, 230, 170, this.flash * 0.12);
      c.fillRect(0, 0, WW, WH);
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ---------- finale, ritual, temple ----------
  private drawFinale(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const x = WW / 2;
    const gy = this.groundY(x, g);
    // darkness falls; only the shaft and the artifact are lit
    c.fillStyle = 'rgba(4,3,8,0.55)';
    c.fillRect(0, 0, WW, WH);
    this.drawShaft(g, 1);
    // people with torches in the shaft
    const n = 5;
    for (let i = 0; i < n; i++) {
      const k = g.state.phase === 'finale' ? Math.min(1, ((this.t * 0.08 + i * 0.12) % 1.2)) : 0.9 - i * 0.05;
      const yy = gy + (lay.artifactY - 12 - gy) * k;
      const xx = x + (i % 2 ? 2 : -2);
      SKINS.tribe(c, xx - 1, yy, { t: this.t, i, season: 0 });
      const f = 0.7 + 0.3 * Math.sin(this.t * 10 + i * 3);
      c.fillStyle = rgb(255, 170, 60, f);
      c.fillRect(xx + 2, yy - 8, 1, 2);
      c.globalCompositeOperation = 'lighter';
      const grd = c.createRadialGradient(xx + 2, yy - 8, 0, xx + 2, yy - 8, 14);
      grd.addColorStop(0, rgb(255, 150, 50, 0.35 * f));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.fillRect(xx - 12, yy - 22, 28, 28);
      c.globalCompositeOperation = 'source-over';
    }
    // ritual scene, then the temple wall where the tradition appears
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
      const vy = g.state.phase === 'temple' ? 96 : 92;
      c.globalAlpha = this.vignetteA;
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(18, vy - 2, VW * 2 + 4, VH * 2 + 4);
      c.drawImage(vc, 20, vy, VW * 2, VH * 2);
      c.strokeStyle = 'rgba(242,193,78,0.35)';
      c.strokeRect(19.5, vy - 0.5, VW * 2 + 1, VH * 2 + 1);
      c.globalAlpha = 1;
    }
  }

  private drawTemple(x: number, gy: number, p: number): void {
    const c = this.ctx;
    if (p <= 0) return;
    const stone = (a: number) => rgb(170, 160, 140, a);
    // ring of stones
    const ring = Math.min(1, p / 0.25);
    for (let i = 0; i < 12; i++) {
      if (i / 12 > ring) break;
      const ang = (i / 12) * Math.PI * 2;
      const sx = x + Math.cos(ang) * 30, sy = gy + Math.sin(ang) * 3;
      c.fillStyle = stone(1);
      c.fillRect(Math.round(sx) - 1, Math.round(sy) - 4, 3, 4);
    }
    // altar
    if (p > 0.25) {
      const a = Math.min(1, (p - 0.25) / 0.2);
      c.fillStyle = stone(a);
      c.fillRect(x - 6, gy - 5, 13, 5);
      c.fillStyle = rgb(242, 193, 78, a * (0.6 + 0.4 * Math.sin(this.t * 2)));
      c.fillRect(x - 1, gy - 7, 3, 2);
    }
    // walls
    if (p > 0.45) {
      const a = Math.min(1, (p - 0.45) / 0.3);
      const h = Math.round(24 * a);
      c.fillStyle = rgb(150, 140, 122, 1);
      c.fillRect(x - 28, gy - h, 6, h);
      c.fillRect(x + 23, gy - h, 6, h);
      for (let y = 0; y < h; y += 4) { c.fillStyle = 'rgba(80,70,60,0.6)'; c.fillRect(x - 28, gy - y, 6, 1); c.fillRect(x + 23, gy - y, 6, 1); }
    }
    // dome
    if (p > 0.75) {
      const a = Math.min(1, (p - 0.75) / 0.25);
      c.fillStyle = rgb(178, 166, 140, a);
      c.beginPath();
      c.ellipse(x, gy - 24, 29, 18 * a, 0, Math.PI, Math.PI * 2);
      c.fill();
      c.fillStyle = rgb(242, 193, 78, a);
      c.fillRect(x, gy - 24 - 18 * a - 4, 1, 4);
    }
  }

  // ---------- picking ----------
  /** world coords -> section-local y or null */
  sectionY(wy: number): number | null {
    const y = wy - this.lay.sectionTop;
    if (y < 0 || y >= this.lay.sectionH) return null;
    return y;
  }

  isArtifact(wx: number, wy: number, g: Game): number {
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    for (let i = 0; i < xs.length; i++) if (Math.abs(wx - xs[i]) < 14 && Math.abs(wy - this.ayAt(xs[i])) < 12) return i;
    return -1;
  }

  zoneLabel(x: number, g: Game): string { return ZONES[g.zoneMap[x]]; }
}
