/**
 * Pixel animations on the marked words of the intro. They are drawn on two canvases laid over the
 * text band (one behind the words, one over them) at the font's own pixel: a letter of the HUD font is
 * drawn on a 16-unit grid, so one unit of these canvases is one pixel of a letter. Nothing is blended
 * soft: transparency is an ordered dither, as in the pictures.
 *
 *   fire      flames licking the tops of the letters (the old "doom fire" spread), embers going up
 *   arc       a live current: bolts jumping between the letters and off them, blue-white sparks
 *   artifact  a thing from before: four-point glints and slow motes in shifting pale colours
 *   weld      an arc runs under the word and leaves a bead that cools from white to grey, sparks bounce
 *   light     a glare too bright to look at: a halo and turning rays behind the word
 *   smoke     wisps rising off the word, curling and thinning out
 *   cold      frost: needles of ice growing off the letters, glints, a few flakes going down
 *   cough     a puff out of the word as it comes
 */

export interface WordRun {
  /** Stable for the life of the run on screen. */
  id: string;
  mark: string;
  strength: number;
  /** The typed part of the run, one box per line it lies on, in canvas units (top of the line box). */
  boxes: Box[];
  /** All of it typed. */
  full: boolean;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FxEnv {
  /** The frame's arc light now, 0..1, or −1 if the frame has no arc. */
  arc: number;
  /** The torches' flicker, −1..1. */
  warm: number;
  /** A bolt struck: the words lit by it flash. */
  zap: () => void;
  sfx: (kind: 'zap' | 'hiss') => void;
}

export const FX_MARKS = new Set(['fire', 'arc', 'artifact', 'weld', 'light', 'smoke', 'cold', 'cough']);

const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// Where in a line box the letters stand (the HUD font: caps from about a quarter down, the baseline at 3/4).
const capY = (b: Box) => b.y + b.h * 0.26;
const baseY = (b: Box) => b.y + b.h * 0.76;

class Painter {
  constructor(public c: CanvasRenderingContext2D) {}
  /** One pixel; `a` below 1 in a few hard steps (pixel-art transparency, never a smooth ramp). */
  px(x: number, y: number, col: string, a = 1): void {
    if (a <= 0.06) return;
    const q = a >= 1 ? 1 : Math.ceil(a * 5) / 5;
    this.c.globalAlpha = q;
    this.c.fillStyle = col;
    this.c.fillRect(Math.round(x), Math.round(y), 1, 1);
    this.c.globalAlpha = 1;
  }
  /** One pixel, dithered (for the ragged edge of a flame). */
  dpx(x: number, y: number, col: string, a = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (a <= 0) return;
    if (a < 1 && a <= (B4[(y & 3) * 4 + (x & 3)] + 0.5) / 16) return;
    this.c.fillStyle = col;
    this.c.fillRect(x, y, 1, 1);
  }
  line(x0: number, y0: number, x1: number, y1: number, col: string, a = 1, halo?: string, ha = 0.5): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (let n = 0; n < 400; n++) {
      if (halo) {
        this.px(x0 + 1, y0, halo, ha);
        this.px(x0 - 1, y0, halo, ha);
        this.px(x0, y0 + 1, halo, ha);
        this.px(x0, y0 - 1, halo, ha);
      }
      this.px(x0, y0, col, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) {
        e += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        e += dx;
        y0 += sy;
      }
    }
  }
  /** A soft blob: dithered, densest at the middle. */
  blob(cx: number, cy: number, rx: number, ry: number, col: string, a: number, fall = 1): void {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const u = (x - cx) / rx, v = (y - cy) / ry, d = u * u + v * v;
        if (d < 1) this.px(x, y, col, a * Math.pow(1 - d, fall));
      }
  }
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  seed: number;
  r?: number;
  r1?: number;
  a?: number;
}

function stepParts(ps: P[], dt: number, g = 0): P[] {
  for (const p of ps) {
    p.age += dt;
    p.vy += g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  return ps.filter((p) => p.age < p.life);
}

abstract class Sys {
  t = 0;
  gone = false;
  boxes: Box[] = [];
  full = false;
  strength = 1;
  /** When the whole word first stood typed. */
  fullAt = -1;
  abstract step(dt: number, env: FxEnv): void;
  abstract draw(back: Painter, front: Painter, env: FxEnv): void;
  abstract alive(): boolean;
  /** Spawn `rate` a second, fairly (carrying the fraction over). */
  private acc: Record<string, number> = {};
  protected count(key: string, rate: number, dt: number): number {
    const v = (this.acc[key] ?? Math.random()) + rate * dt;
    const n = Math.floor(v);
    this.acc[key] = v - n;
    return n;
  }
}

// ---------------------------------------------------------------------------------------------- fire

const FIRE = ['#3a1410', '#6a2012', '#a8340e', '#e05a14', '#ff8a24', '#ffb840', '#ffe07a', '#fff6cc'];

class Fire extends Sys {
  private grids: { w: number; h: number; heat: Float32Array }[] = [];
  private tick = 0;
  private embers: P[] = [];
  step(dt: number, env: FxEnv): void {
    this.t += dt;
    this.tick += dt;
    while (this.tick >= 1 / 30) {
      this.tick -= 1 / 30;
      this.spread(env);
    }
    if (!this.gone)
      for (const b of this.boxes)
        for (let n = this.count('e', 4 * (b.w / 20), dt); n > 0; n--)
          this.embers.push({ x: b.x + rnd(0, b.w), y: capY(b), vx: rnd(-3, 3), vy: rnd(-16, -9), age: 0, life: rnd(1, 2), seed: Math.random() * 9 });
    this.embers = stepParts(this.embers, dt, -2);
    for (const p of this.embers) p.x += Math.sin(this.t * 3 + p.seed) * 6 * dt;
  }
  /** The classic spread: each cell takes the heat of the one below, a little cooler, a little aside. */
  private spread(env: FxEnv): void {
    this.boxes.forEach((b, i) => {
      const w = Math.max(2, Math.round(b.w) + 4), h = Math.max(10, Math.round(b.h * 1.35));
      let g = this.grids[i];
      if (!g || g.w !== w || g.h !== h) {
        const heat = new Float32Array(w * h);
        if (g) for (let y = 0; y < Math.min(h, g.h); y++) for (let x = 0; x < Math.min(w, g.w); x++) heat[(h - 1 - y) * w + x] = g.heat[(g.h - 1 - y) * g.w + x];
        g = this.grids[i] = { w, h, heat };
      }
      const I = this.gone ? 0 : (0.82 + 0.18 * env.warm) * Math.min(1, this.t / 0.4);
      for (let x = 0; x < w; x++) {
        // Tongues: the source breathes along the word, with a ragged edge.
        const tongue = Math.max(0, 0.35 + 0.65 * Math.sin(x * 0.62 + this.t * 4.6 + Math.sin(this.t * 1.3 + x) * 0.8));
        const ends = Math.min(1, (x + 1) / 4, (w - x) / 4);
        g.heat[(h - 1) * w + x] = I * ends * Math.min(1.1, rnd(0.75, 1.2) * (0.35 + 0.75 * tongue));
      }
      const decay = 1.3 / h;
      for (let y = 0; y < h - 1; y++)
        for (let x = 0; x < w; x++) {
          const r = Math.random();
          const dst = Math.min(w - 1, Math.max(0, x - Math.round(r * 2) + 1));
          g.heat[y * w + dst] = Math.max(0, g.heat[(y + 1) * w + x] - r * decay);
        }
    });
  }
  draw(back: Painter, f: Painter): void {
    if (!this.gone)
      this.boxes.forEach((b, i) => {
        const g = this.grids[i];
        if (!g) return;
        // Behind the letters, from their feet up: the word stands dark against its own fire.
        const x0 = Math.round(b.x) - 2, y0 = Math.round(baseY(b)) + 1;
        for (let y = 0; y < g.h; y++)
          for (let x = 0; x < g.w; x++) {
            const v = g.heat[y * g.w + x];
            if (v < 0.06) continue;
            const k = Math.min(FIRE.length - 1, Math.floor(Math.sqrt(v) * FIRE.length));
            back.dpx(x0 + x, y0 - (g.h - 1 - y), FIRE[k], v < 0.22 ? v / 0.22 : 1);
          }
      });
    for (const p of this.embers) {
      const k = p.age / p.life;
      const fl = Math.sin(this.t * 20 + p.seed * 7) > -0.3;
      f.px(p.x, p.y, k < 0.4 ? '#ffe08a' : fl ? '#ff9a30' : '#c84a18', 1 - k * k);
    }
  }
  alive(): boolean {
    return !this.gone || this.embers.length > 0;
  }
}

// ---------------------------------------------------------------------------------------------- arc

interface Bolt {
  pts: [number, number][];
  age: number;
  life: number;
}

class Arc extends Sys {
  private bolts: Bolt[] = [];
  private sparks: P[] = [];
  private next = 0.05;
  private crawl: Bolt[] = [];
  private crawlAt = 0;
  step(dt: number, env: FxEnv): void {
    this.t += dt;
    // The current crawling over the letters: short arcs between them, redrawn every few frames.
    if (!this.gone && this.boxes.length && this.t >= this.crawlAt) {
      this.crawlAt = this.t + rnd(0.04, 0.08);
      this.crawl = [];
      for (const b of this.boxes)
        for (let i = 0, n = 1 + Math.round((b.w / 30) * Math.random()); i < n; i++) {
          const x0 = b.x + rnd(0, b.w), y0 = rnd(capY(b), baseY(b));
          const x1 = Math.min(b.x + b.w, Math.max(b.x, x0 + rnd(-9, 9)));
          this.crawl.push({ pts: this.jag([x0, y0], [x1, rnd(capY(b), baseY(b))], 2), age: 0, life: 1 });
        }
    }
    if (this.gone) this.crawl = [];
    if (!this.gone && this.boxes.length && this.t >= this.next) {
      const n = Math.random() < 0.3 ? 2 : 1;
      for (let i = 0; i < n; i++) this.strike();
      env.zap();
      env.sfx('zap');
      const busy = env.arc >= 0 ? 0.6 : 1;
      this.next = this.t + (Math.random() < 0.25 ? rnd(0.03, 0.07) : rnd(0.14, 0.5) * busy) / this.strength;
    }
    for (const b of this.bolts) b.age += dt;
    this.bolts = this.bolts.filter((b) => b.age < b.life);
    this.sparks = stepParts(this.sparks, dt, 90);
  }
  private strike(): void {
    const b = this.boxes[Math.floor(Math.random() * this.boxes.length)];
    const top = capY(b), bot = baseY(b);
    let p0: [number, number], p1: [number, number];
    const r = Math.random();
    if (r < 0.55) {
      // Across the letters.
      const x0 = b.x + rnd(0, b.w);
      const x1 = Math.min(b.x + b.w + 2, Math.max(b.x - 2, x0 + (Math.random() < 0.5 ? -1 : 1) * rnd(8, 20)));
      p0 = [x0, rnd(top, bot)];
      p1 = [x1, rnd(top, bot)];
    } else if (r < 0.85) {
      // Up off a letter into the air.
      const x0 = b.x + rnd(0, b.w);
      p0 = [x0, top];
      p1 = [x0 + rnd(-7, 7), top - rnd(7, 16)];
    } else {
      // Down to the line under it.
      const x0 = b.x + rnd(0, b.w);
      p0 = [x0, bot];
      p1 = [x0 + rnd(-5, 5), bot + rnd(4, 7)];
    }
    const pts = this.jag(p0, p1, 3);
    this.bolts.push({ pts, age: 0, life: rnd(0.07, 0.14) });
    // A branch off it now and then.
    if (Math.random() < 0.35 && pts.length > 3) {
      const m = pts[1 + Math.floor(Math.random() * (pts.length - 2))];
      this.bolts.push({ pts: this.jag(m, [m[0] + rnd(-8, 8), m[1] + rnd(-8, 4)], 2), age: 0, life: rnd(0.04, 0.08) });
    }
    const e = pts[pts.length - 1];
    for (let i = 0, n = 3 + Math.floor(Math.random() * 4); i < n; i++)
      this.sparks.push({ x: e[0], y: e[1], vx: rnd(-26, 26), vy: rnd(-28, 4), age: 0, life: rnd(0.2, 0.45), seed: 0 });
  }
  private jag(a: [number, number], b: [number, number], depth: number): [number, number][] {
    let pts: [number, number][] = [a, b];
    for (let d = 0; d < depth; d++) {
      const out: [number, number][] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
        const off = (Math.random() - 0.5) * len * 0.55;
        out.push([(p[0] + q[0]) / 2 - (dy / len) * off, (p[1] + q[1]) / 2 + (dx / len) * off], q);
      }
      pts = out;
    }
    return pts;
  }
  draw(back: Painter, f: Painter): void {
    for (const b of this.crawl)
      for (let i = 1; i < b.pts.length; i++) {
        const p = b.pts[i - 1], q = b.pts[i];
        f.line(p[0], p[1], q[0], q[1], '#d8eeff', 0.85, '#4f8cff', 0.3);
      }
    for (const b of this.bolts) {
      const fresh = b.age < b.life * 0.5;
      for (let i = 1; i < b.pts.length; i++) {
        const p = b.pts[i - 1], q = b.pts[i];
        back.blob(q[0], q[1], 3, 3, '#3a6cff', fresh ? 0.5 : 0.25);
        f.line(p[0], p[1], q[0], q[1], fresh ? '#ffffff' : '#bfe2ff', 1, '#79b8ff', fresh ? 0.55 : 0.3);
      }
    }
    for (const p of this.sparks) {
      const k = p.age / p.life;
      f.px(p.x, p.y, k < 0.3 ? '#ffffff' : k < 0.65 ? '#a8d8ff' : '#4a7cff', 1 - k * 0.6);
    }
  }
  alive(): boolean {
    return !this.gone || this.sparks.length > 0 || this.bolts.length > 0;
  }
}

// ---------------------------------------------------------------------------------------------- artifact

const GLINT = ['#d2bcff', '#a2ecff', '#ffcaf0', '#fff4c8', '#bfffe4'];

class Artifact extends Sys {
  private stars: P[] = [];
  private motes: P[] = [];
  step(dt: number): void {
    this.t += dt;
    if (!this.gone)
      for (const b of this.boxes) {
        for (let n = this.count('s' + b.y, 4.5 * (b.w / 40) + 1.5, dt); n > 0; n--)
          this.stars.push({ x: b.x + rnd(-2, b.w + 2), y: rnd(capY(b) - 3, baseY(b) + 1), vx: 0, vy: 0, age: 0, life: rnd(0.45, 0.9), seed: Math.floor(Math.random() * GLINT.length) });
        for (let n = this.count('m' + b.y, 4 * (b.w / 40) + 1, dt); n > 0; n--)
          this.motes.push({ x: b.x + rnd(0, b.w), y: rnd(capY(b), baseY(b)), vx: rnd(-1.5, 1.5), vy: rnd(-6, -2.5), age: 0, life: rnd(1.4, 2.6), seed: Math.random() * 9 });
      }
    this.stars = stepParts(this.stars, dt);
    this.motes = stepParts(this.motes, dt);
    for (const p of this.motes) p.x += Math.sin(this.t * 1.7 + p.seed) * 3 * dt;
  }
  draw(back: Painter, f: Painter): void {
    for (const p of this.motes) {
      const k = p.age / p.life;
      const col = GLINT[Math.floor(p.seed + this.t * 1.5) % GLINT.length];
      back.px(p.x, p.y, col, Math.sin(Math.PI * k) * 0.9);
    }
    for (const s of this.stars) {
      const k = Math.sin((Math.PI * s.age) / s.life);
      const arm = Math.round(k * 4.2);
      const col = GLINT[s.seed];
      f.px(s.x, s.y, '#ffffff', k > 0.25 ? 1 : k * 4);
      for (let i = 1; i <= arm; i++) {
        const a = (1 - (i - 1) / (arm + 0.5)) * k;
        f.px(s.x + i, s.y, col, a);
        f.px(s.x - i, s.y, col, a);
        f.px(s.x, s.y + i, col, a);
        f.px(s.x, s.y - i, col, a);
      }
      if (arm >= 2) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) f.px(s.x + dx, s.y + dy, col, 0.4 * k);
    }
  }
  alive(): boolean {
    return !this.gone || this.stars.length + this.motes.length > 0;
  }
}

// ---------------------------------------------------------------------------------------------- weld

/** The bead cooling: white, straw, orange, cherry, dull red, then grey metal. */
function beadCol(age: number, top: boolean): string | null {
  if (age < 0.12) return '#ffffff';
  if (age < 0.35) return top ? '#ffffff' : '#fff0b0';
  if (age < 0.8) return top ? '#ffe9a0' : '#ffc050';
  if (age < 1.5) return top ? '#ffb060' : '#f07a28';
  if (age < 2.4) return top ? '#e0703a' : '#b8401c';
  if (age < 3.4) return top ? '#9a5a44' : '#6e3424';
  return null;
}

class Weld extends Sys {
  private head = -1;
  private born: number[] = [];
  private sparks: P[] = [];
  private puffs: P[] = [];
  private flick = 1;
  private get total(): number {
    return this.boxes.reduce((s, b) => s + Math.round(b.w), 0);
  }
  /** Column i of the bead: where it lies. */
  private at(i: number): [number, number] {
    for (const b of this.boxes) {
      const w = Math.round(b.w);
      if (i < w) return [Math.round(b.x) + i, Math.round(baseY(b)) + 2];
      i -= w;
    }
    const b = this.boxes[this.boxes.length - 1];
    return [Math.round(b.x + b.w), Math.round(baseY(b)) + 2];
  }
  step(dt: number, env: FxEnv): void {
    this.t += dt;
    if (!this.gone && this.full && this.head < 0 && this.t - this.fullAt > 0.15) this.head = 0;
    const total = this.total;
    if (!this.gone && this.head >= 0 && this.head < total) {
      this.head = Math.min(total, this.head + 24 * dt);
      for (let i = this.born.length; i < Math.floor(this.head); i++) this.born[i] = this.t;
      const [hx, hy] = this.at(Math.floor(this.head));
      for (let n = this.count('sp', 55, dt); n > 0; n--)
        this.sparks.push({ x: hx, y: hy - 1, vx: rnd(-30, 45), vy: rnd(-48, -12), age: 0, life: rnd(0.3, 0.7), seed: hy });
      for (let n = this.count('pf', 5, dt); n > 0; n--)
        this.puffs.push({ x: hx, y: hy - 2, vx: rnd(-1, 2), vy: rnd(-7, -4), age: 0, life: rnd(1, 1.6), seed: Math.random() * 9, r: 0.8, r1: rnd(1.8, 2.8), a: 0.45 });
      this.flick = rnd(0.7, 1.15);
      if (Math.random() < 0.5) env.sfx('hiss');
    }
    this.sparks = stepParts(this.sparks, dt, 150);
    for (const p of this.sparks)
      if (p.y > p.seed && p.vy > 0) {
        p.y = p.seed;
        p.vy *= -0.35;
        p.vx *= 0.6;
      }
    this.puffs = stepParts(this.puffs, dt);
  }
  draw(back: Painter, f: Painter): void {
    if (!this.gone) {
      for (let i = 0; i < this.born.length; i++) {
        const [x, y] = this.at(i);
        const age = this.t - this.born[i];
        const ripple = i % 3;
        const lo = beadCol(age, false), hi = beadCol(age, true);
        // The ripples of the bead: a scallop every three pixels, the top lit.
        if (lo) {
          f.px(x, y, lo);
          if (ripple !== 2) f.px(x, y - 1, ripple === 0 ? hi! : lo);
        } else {
          f.px(x, y, '#6c6760');
          if (ripple !== 2) f.px(x, y - 1, ripple === 0 ? '#aaa298' : '#878178');
        }
      }
      if (this.head >= 0 && this.head < this.total) {
        const [hx, hy] = this.at(Math.floor(this.head));
        back.blob(hx, hy - 1, 6 * this.flick, 4 * this.flick, '#cfe6ff', 0.55);
        f.px(hx, hy - 1, '#ffffff');
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.px(hx + dx, hy - 1 + dy, '#ffffff');
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, 1], [1, -1], [-1, -1]]) f.px(hx + dx, hy - 1 + dy, '#a8d4ff', 0.6 * this.flick);
      }
    }
    for (const p of this.puffs) {
      const k = p.age / p.life;
      f.blob(p.x, p.y, p.r! + (p.r1! - p.r!) * k, p.r! + (p.r1! - p.r!) * k, '#8e8984', p.a! * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8));
    }
    for (const p of this.sparks) {
      const k = p.age / p.life;
      f.px(p.x, p.y, k < 0.25 ? '#fff6c8' : k < 0.6 ? '#ffc040' : '#e05a18', 1 - k * 0.5);
    }
  }
  alive(): boolean {
    return !this.gone || this.sparks.length + this.puffs.length > 0;
  }
}

// ---------------------------------------------------------------------------------------------- light

class Light extends Sys {
  private motes: P[] = [];
  private level = 0;
  step(dt: number, env: FxEnv): void {
    this.t += dt;
    const want = this.gone ? 0 : env.arc >= 0 ? 0.7 + 0.45 * env.arc : 0.9 + 0.1 * Math.sin(this.t * 3);
    this.level += (want - this.level) * Math.min(1, dt * (this.gone ? 12 : 3));
    const b = this.boxes[0];
    if (b && !this.gone)
      for (let n = this.count('m', 5, dt); n > 0; n--) {
        const a = rnd(0, Math.PI * 2), r = rnd(0.5, 1.6);
        this.motes.push({ x: b.x + b.w / 2 + Math.cos(a) * b.w * 0.6 * r, y: (capY(b) + baseY(b)) / 2 + Math.sin(a) * b.h * 0.6 * r, vx: rnd(-1.2, 1.2), vy: rnd(-1.5, 0.5), age: 0, life: rnd(1.2, 2.4), seed: Math.random() * 9 });
      }
    this.motes = stepParts(this.motes, dt);
  }
  draw(back: Painter, f: Painter): void {
    const b = this.boxes[0];
    if (!b || this.level < 0.02) return;
    const L = this.level;
    const cx = b.x + b.w / 2, cy = (capY(b) + baseY(b)) / 2;
    back.blob(cx, cy, b.w * 0.85 + 4, b.h * 0.8, '#fff4d0', 0.2 * L, 2);
    back.blob(cx, cy, b.w * 0.55 + 1, b.h * 0.5, '#fff8e8', 0.3 * L, 2);
    // Rays, turning slowly, each breathing on its own.
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + this.t * 0.22;
      const len = (b.h * 0.9 + b.h * 0.7 * Math.sin(this.t * 2.1 + i * 1.9)) * L + (i % 2 ? 0 : b.h * 0.4 * L);
      const ex = Math.cos(a) * 1.7, ey = Math.sin(a);
      const r0x = b.w * 0.5, r0y = b.h * 0.42;
      for (let s = 0; s < len; s += 0.7) {
        const k = s / len;
        back.px(cx + ex * (r0x / 1.7 + s), cy + ey * (r0y + s * 0.8), k < 0.35 ? '#ffffff' : '#ffe9a8', (1 - k) * 0.85 * L);
      }
    }
    for (const p of this.motes) {
      const k = p.age / p.life;
      f.px(p.x, p.y, '#fff8e0', Math.sin(Math.PI * k) * 0.8 * L);
    }
  }
  alive(): boolean {
    return !this.gone || this.level > 0.02;
  }
}

// ---------------------------------------------------------------------------------------------- smoke

class Smoke extends Sys {
  private puffs: P[] = [];
  /** A burst once, as the word comes (the cough). */
  burst = false;
  private burstDone = false;
  step(dt: number): void {
    this.t += dt;
    if (this.burst) {
      if (!this.burstDone && this.boxes.length) {
        this.burstDone = true;
        const b = this.boxes[0];
        for (let i = 0; i < 9; i++)
          this.puffs.push({ x: b.x + rnd(0, Math.min(6, b.w)), y: rnd(capY(b), baseY(b)), vx: rnd(-14, -4), vy: rnd(-7, -1), age: 0, life: rnd(1, 1.7), seed: Math.random() * 9, r: rnd(1.2, 2), r1: rnd(3.5, 5), a: 0.75 });
      }
    } else if (!this.gone)
      for (const b of this.boxes)
        for (let n = this.count('p' + b.y, (2.5 + b.w / 12) * this.strength, dt); n > 0; n--)
          this.puffs.push({ x: b.x + rnd(0, b.w), y: capY(b) + rnd(0, 2), vx: rnd(0.3, 2.2), vy: rnd(-8, -4), age: 0, life: rnd(2.4, 3.6), seed: Math.random() * 9, r: rnd(1, 1.6), r1: rnd(3.5, 5.5), a: 0.45 + 0.4 * this.strength });
    this.puffs = stepParts(this.puffs, dt);
    for (const p of this.puffs) {
      // A curl in the rising air, and the puff slowing as it spreads.
      p.x += Math.sin(p.age * 1.8 + p.seed) * 2.2 * dt;
      p.vx *= 1 - 0.6 * dt;
      p.vy *= 1 - 0.25 * dt;
    }
  }
  draw(_b: Painter, f: Painter): void {
    for (const p of this.puffs) {
      const k = p.age / p.life;
      const r = p.r! + (p.r1! - p.r!) * Math.sqrt(k);
      const a = p.a! * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      f.blob(p.x, p.y, r * 1.15, r, k < 0.4 ? '#b0aaa2' : '#8a857f', a);
    }
  }
  alive(): boolean {
    return (!this.gone && !this.burst) || this.puffs.length > 0 || (this.burst && !this.burstDone && !this.gone);
  }
}

// ---------------------------------------------------------------------------------------------- frost

interface Needle {
  x: number;
  y: number;
  dx: number;
  dy: number;
  left: number;
  at: number;
}

class Frost extends Sys {
  /** The ice: pixels with when each formed. */
  private ice: { x: number; y: number; at: number }[] = [];
  private grow: Needle[] = [];
  private seeded: Record<number, number> = {};
  private flakes: P[] = [];
  private glints: { i: number; at: number }[] = [];
  private tick = 0;
  step(dt: number): void {
    this.t += dt;
    if (!this.gone)
      this.boxes.forEach((b) => {
        // Seed needles along the letters as they come: on top of them, and hanging under.
        const key = Math.round(b.y);
        const done = this.seeded[key] ?? Math.round(b.x);
        for (let x = done; x < b.x + b.w; x += rnd(1.6, 3)) {
          const up = Math.random() < 0.6;
          this.grow.push({ x: Math.round(x), y: Math.round(up ? capY(b) - 1 : baseY(b) + 1), dx: Math.round(rnd(-1, 1)), dy: up ? -1 : 1, left: Math.round(rnd(1, up ? 4 : 3)), at: this.t + rnd(0.05, 0.6) });
          this.seeded[key] = Math.round(x) + 2;
        }
      });
    this.tick += dt;
    while (this.tick >= 0.05) {
      this.tick -= 0.05;
      const next: Needle[] = [];
      for (const n of this.grow) {
        if (this.t < n.at) {
          next.push(n);
          continue;
        }
        this.ice.push({ x: n.x, y: n.y, at: this.t });
        if (--n.left > 0) {
          if (Math.random() < 0.3) next.push({ x: n.x + (Math.random() < 0.5 ? -1 : 1), y: n.y + n.dy, dx: 0, dy: n.dy, left: 1, at: this.t + 0.1 });
          next.push({ ...n, x: n.x + (Math.random() < 0.35 ? n.dx : 0), y: n.y + n.dy, at: this.t + rnd(0.04, 0.14) });
        }
      }
      this.grow = next;
      if (this.ice.length && Math.random() < 0.35) this.glints.push({ i: Math.floor(Math.random() * this.ice.length), at: this.t });
    }
    this.glints = this.glints.filter((g) => this.t - g.at < 0.18);
    const b = this.boxes[0];
    if (b && !this.gone)
      for (let n = this.count('f', 2.5, dt); n > 0; n--)
        this.flakes.push({ x: b.x + rnd(-6, b.w + 6), y: b.y - rnd(2, b.h), vx: rnd(-1, 1), vy: rnd(5, 9), age: 0, life: rnd(2, 3), seed: Math.random() * 9 });
    this.flakes = stepParts(this.flakes, dt);
    for (const p of this.flakes) p.x += Math.sin(this.t * 1.3 + p.seed) * 3 * dt;
  }
  draw(_b: Painter, f: Painter): void {
    if (!this.gone) {
      for (const p of this.ice) f.px(p.x, p.y, this.t - p.at < 0.12 ? '#ffffff' : '#b6dcf2', 0.9);
      for (const g of this.glints) {
        const p = this.ice[g.i];
        if (!p) continue;
        f.px(p.x, p.y, '#ffffff');
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.px(p.x + dx, p.y + dy, '#e6f6ff', 0.45);
      }
    }
    for (const p of this.flakes) f.px(p.x, p.y, '#e8f2ff', 0.85 * Math.min(1, (p.life - p.age) / 0.6));
  }
  alive(): boolean {
    return !this.gone || this.flakes.length > 0;
  }
}

// ---------------------------------------------------------------------------------------------- the layer

export class WordFx {
  readonly back = document.createElement('canvas');
  readonly front = document.createElement('canvas');
  private pb: Painter;
  private pf: Painter;
  private sys = new Map<string, Sys>();
  /** Canvas units in CSS pixels, and where the canvas sits on the band. */
  unit = 2;
  ox = 0;
  oy = 0;

  constructor() {
    for (const c of [this.back, this.front]) {
      c.className = 'intro-wordfx';
      c.style.position = 'absolute';
      c.style.pointerEvents = 'none';
      c.style.imageRendering = 'pixelated';
    }
    this.back.style.zIndex = '0';
    this.front.style.zIndex = '2';
    this.pb = new Painter(this.back.getContext('2d')!);
    this.pf = new Painter(this.front.getContext('2d')!);
  }

  /** Over the band of `bw`×`bh` and as much again above it (smoke and flames go up into the picture). */
  layout(bw: number, bh: number, fs: number): void {
    this.unit = Math.max(1, fs / 16);
    const w = Math.ceil(bw / this.unit), h = Math.ceil((bh * 2) / this.unit);
    this.ox = 0;
    this.oy = -bh;
    for (const c of [this.back, this.front]) {
      c.width = w;
      c.height = h;
      Object.assign(c.style, { left: '0px', top: -bh + 'px', width: w * this.unit + 'px', height: h * this.unit + 'px' });
    }
    this.sys.clear();
  }

  frame(dt: number, runs: WordRun[], env: FxEnv): void {
    const seen = new Set<string>();
    for (const r of runs) {
      seen.add(r.id);
      let s = this.sys.get(r.id);
      if (!s) {
        const made = make(r.mark);
        if (!made) continue;
        s = made;
        s.strength = r.strength;
        this.sys.set(r.id, s);
      }
      s.boxes = merge(r.boxes);
      if (r.full && !s.full) s.fullAt = s.t;
      s.full = r.full;
    }
    for (const [id, s] of this.sys) {
      if (!seen.has(id)) s.gone = true;
      s.step(dt, env);
      if (!s.alive()) this.sys.delete(id);
    }
    for (const c of [this.pb.c, this.pf.c]) c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    for (const s of this.sys.values()) s.draw(this.pb, this.pf, env);
  }

  clear(): void {
    this.sys.clear();
    for (const c of [this.pb.c, this.pf.c]) c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  }
}

/** One box per line: a run's rects on the same line joined. */
function merge(bs: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of bs) {
    if (b.w < 0.5) continue;
    const o = out.find((q) => Math.abs(q.y - b.y) < b.h * 0.5);
    if (!o) out.push({ ...b });
    else {
      const x1 = Math.max(o.x + o.w, b.x + b.w);
      o.x = Math.min(o.x, b.x);
      o.w = x1 - o.x;
    }
  }
  return out;
}

function make(mark: string): Sys | null {
  switch (mark) {
    case 'fire':
      return new Fire();
    case 'arc':
      return new Arc();
    case 'artifact':
      return new Artifact();
    case 'weld':
      return new Weld();
    case 'light':
      return new Light();
    case 'smoke':
      return new Smoke();
    case 'cough': {
      const s = new Smoke();
      s.burst = true;
      return s;
    }
    case 'cold':
      return new Frost();
  }
  return null;
}
