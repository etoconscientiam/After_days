// World renderer: sky, surface, section, foundation, artifact, particles, light, finale & temple scenes.
// Reads core state only; never mutates it.
import { CFG, ZONES } from '../config';
import type { Game } from '../core/game';
import { totalPop } from '../core/life';
import { hash2 } from '../core/rng';
import { Layout, WW, WH, NOISE, lerp, lerp3, hex3, rgb, ACCENT } from './common';
import { SectionRenderer } from './section';
import { SKINS, drawArtifact, drawFossil, fossilKind } from './skins';

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
      this.particles.push({ x, y: this.lay.artifactY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.6 + Math.random() * 0.6, color: Math.random() < 0.5 ? ACCENT : '#fff2c0', size: 1 });
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

    c.save();
    if (this.shake > 0.05) c.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    c.fillStyle = '#0d0b0e';
    c.fillRect(-4, -4, WW + 8, WH + 8);
    this.drawSky(g);
    this.drawSection(g);
    this.drawSurface(g);
    this.drawArtifactZone(g);
    this.drawParticles(dt);
    this.drawLight(g);
    if (g.state.phase === 'finale' || g.state.phase === 'temple' || g.state.phase === 'newWorld' || g.state.phase === 'end') this.drawFinale(g);
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
    if (g.mods.shards && (Math.abs(x - 120) < 7 || Math.abs(x - 240) < 7)) {
      return Math.round(lay.surfaceY + 20 + Math.abs(x % 120 > 60 ? 120 - (x % 120) : x % 120) * 1.8);
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
    // life sprites
    this.drawLife(g, sea, bottom);
    // excavation shaft and camp
    if (r.era >= 6 && g.state.phase === 'play') this.drawCamp(g);
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
      const depth = (lay.artifactY - 6 - gy) * prog;
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
    c.drawImage(this.section.canvas, 0, 0, WW, lay.sectionH, 0, top, WW, lay.sectionH);
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
    const grd = c.createLinearGradient(0, top, 0, top + lay.sectionH);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(5,3,8,0.35)');
    c.fillStyle = grd;
    c.fillRect(0, top, WW, lay.sectionH);
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

  // ---------- foundation & artifact ----------
  private drawArtifactZone(g: Game): void {
    const c = this.ctx;
    const lay = this.lay;
    const yTop = lay.sectionTop + lay.sectionH;
    const h = CFG.B.layout.artifactH;
    // old ground around the artifact
    c.fillStyle = '#141117';
    c.fillRect(0, yTop, WW, h + 2);
    for (let x = 0; x < WW; x += 2) {
      const n = NOISE[((x * 3) & 255) * 256 + 17];
      c.fillStyle = rgb(26 + n * 14, 22 + n * 12, 30 + n * 14);
      c.fillRect(x, yTop + ((n * h) | 0), 2, 1);
    }
    // foundation band right above the artifact
    const f = g.meta.foundation;
    if (f > 0) {
      const th = Math.min(16, 2 + Math.sqrt(f) * 1.2);
      const y0 = yTop - th;
      c.fillStyle = 'rgba(14,10,16,0.92)';
      c.fillRect(0, y0, WW, th);
      for (let x = 0; x < WW; x++) {
        const n = NOISE[((x * 7) & 255) * 256 + 99];
        c.fillStyle = rgb(30 + n * 18, 26 + n * 14, 34 + n * 18, 0.7);
        c.fillRect(x, y0 + ((n * th) | 0), 1, 1);
      }
      const lines = g.meta.foundationLines;
      for (let i = 0; i < lines.length; i++) {
        const ly = Math.round(yTop - (lines[i] / Math.max(f, 1e-6)) * th);
        const glow = 0.35 + 0.25 * Math.sin(this.t * 1.5 + i);
        c.fillStyle = rgb(242, 193, 78, glow);
        c.fillRect(0, Math.min(yTop - 1, Math.max(y0, ly)), WW, 1);
      }
    }
    const xs = g.mods.shards ? g.shardXs() : [WW / 2];
    const glow = 0.6 + Math.min(1, g.run.boost / 3) * 0.4;
    let ay = lay.artifactY;
    if (g.state.phase === 'temple' && g.state.ritualChoice === 'bury') ay += Math.min(1, g.state.templeProgress * 3) * 8;
    for (const x of xs) {
      if (g.state.phase === 'temple' && g.state.ritualChoice === 'shatter' && g.state.templeProgress > 0.15) continue;
      if (g.state.phase === 'temple' && g.state.ritualChoice === 'eat' && g.state.templeProgress > 0.3) continue;
      drawArtifact(c, x, ay, this.t, glow);
    }
    // click rings travel up through the layers
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t += 1 / 60;
      const k = rg.t / 0.9;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const y = lay.artifactY - k * (lay.artifactY - lay.surfaceY - 30);
      c.strokeStyle = rgb(242, 193, 78, (1 - k) * 0.7);
      c.beginPath();
      c.ellipse(rg.x, y, 10 + k * 70, 3 + k * 8, 0, 0, Math.PI * 2);
      c.stroke();
    }
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
      const grd = c.createRadialGradient(x, lay.artifactY, 1, x, lay.artifactY, R);
      grd.addColorStop(0, rgb(242, 193, 78, 0.45 + this.flash * 0.3));
      grd.addColorStop(0.4, rgb(200, 120, 40, 0.12));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.fillRect(x - R, lay.artifactY - R, R * 2, R * 2);
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
    // ritual act
    if (g.state.phase === 'temple' || g.state.phase === 'newWorld' || g.state.phase === 'end') {
      const p = g.state.phase === 'temple' ? g.state.templeProgress : 1;
      const rit = g.state.ritualChoice ?? g.legacy.rituals[g.legacy.rituals.length - 1];
      const act = Math.min(1, p / 0.3);
      if (rit === 'shatter' && act > 0.4) {
        for (let s = 0; s < 3; s++) {
          const ang = -Math.PI / 2 + (s - 1) * 0.8;
          const d = (act - 0.4) * 140;
          const sx = x + Math.cos(ang) * d, sy = lay.artifactY + Math.sin(ang) * d;
          c.fillStyle = ACCENT; c.fillRect(sx - 1, sy - 1, 3, 3);
        }
      }
      if (rit === 'eat' && act < 1) {
        for (let i = 0; i < 20; i++) {
          const k = (act + i / 20) % 1;
          c.fillStyle = rgb(242, 193, 78, 1 - k);
          c.fillRect(x + Math.sin(i * 7) * 6 * k, lay.artifactY - k * 40, 1, 1);
        }
      }
      // the temple rises over the artifact
      const tp = Math.max(0, (p - 0.3) / 0.7);
      this.drawTemple(x, gy, tp);
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
    for (let i = 0; i < xs.length; i++) if (Math.abs(wx - xs[i]) < 14 && Math.abs(wy - this.lay.artifactY) < 14) return i;
    return -1;
  }

  zoneLabel(x: number, g: Game): string { return ZONES[g.zoneMap[x]]; }
}
