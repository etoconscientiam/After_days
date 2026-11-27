/**
 * The opening: a story told over still pictures, before the first shift. A module of its own: it draws on its
 * own canvas over the page, takes the input while it plays, and hands over to the game when it ends (or is
 * skipped). The words and their pacing live in intro-script.json.
 *
 * Each picture is drawn into a small buffer (INTRO_W × INTRO_H) with a slow camera move, sprinkled with pixel
 * particles, dithered down to a few bits a channel, and blown up to the screen without smoothing. The words
 * are not in the buffer: they are typed in crisp HTML over a dark band at the bottom of the picture.
 */
import SCRIPT from './intro-script.json';

/** The picture's own resolution (4:3). */
export const INTRO_W = 320;
export const INTRO_H = 240;
/** Ordered 4×4 dithering down to DITHER_BITS bits a channel. */
export const INTRO_DITHER = true;
const DITHER_BITS = 5;

const CPS = 35; // typed characters per second
const LINE_PAUSE = 1.5; // after a line is typed
const FRAME_EXTRA = 1; // a frame lasts its lines plus this
const FRAME_MIN = 5;
const XFADE = 0.8; // cross-fade within an act
const ACT_FADE = 1.5; // through black between acts
const SKIP_AFTER = 2; // the skip button shows after this (at once if seen before)
const FLASH = 0.4; // the final white flash of the arc
const REVEAL = 1.2; // the game showing through the white
const SEEN_KEY = 'welder.introSeen';

const IMAGES = import.meta.glob('../../assets/intro/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

type Style = 'voice' | 'dialog' | 'inner';
type FxType = 'embers' | 'sparks' | 'arcFlicker' | 'dust' | 'snow' | 'torchFlicker';
interface Fx {
  type: FxType;
  x?: number;
  y?: number;
  area?: number[];
  strength?: number;
  after?: string;
}
interface Line {
  text: string;
  who?: string;
  voice?: string;
  event?: string;
  /** Seconds of silence before the line begins. */
  wait?: number;
}
interface FrameDef {
  image: string;
  cam: { from: number[]; to: number[] };
  fx?: Fx[];
  lines: Line[];
  brightness?: number;
}
interface ActDef {
  style: Style;
  ambient?: string;
  frames: FrameDef[];
}
interface ScriptDef {
  sounds?: { type?: string; arc?: string; ignite?: string };
  acts: ActDef[];
}

interface Shot {
  act: number;
  style: Style;
  def: FrameDef;
  img: HTMLImageElement;
  /** Seconds the frame lasts (its lines' typing and pauses, plus a little), counted from when its words begin. */
  dur: number;
  parts: Particle[];
  spawn: number[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  kind: FxType;
  seed: number;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

/** What the shown text of a line is, by the act's style. */
function shown(style: Style, l: Line): string {
  return style === 'voice' ? `«${l.text}»` : l.text;
}

export interface IntroOptions {
  /** Called once, when the game should start (the picture then turns to white or black over it). */
  onDone: (fromWhite: boolean) => void;
}

export function introSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export class Intro {
  private root = document.createElement('div');
  private screen = document.createElement('canvas');
  private sctx = this.screen.getContext('2d')!;
  private buf = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private band = document.createElement('div');
  private textEl = document.createElement('div');
  private skipEl = document.createElement('div');
  private white = document.createElement('div');
  private shots: Shot[] = [];
  /** When each picture began to show (intro clock). */
  private starts: number[] = [];
  private vign = new Float32Array(INTRO_W * INTRO_H);

  private clock = 0;
  private cur = 0;
  private prev = -1;
  private transKind: 'x' | 'black' | '' = '';
  private curStart = 0;
  private li = 0;
  private typed = 0;
  private doneAt = -1;
  private lineStarted = false;
  private waitFrom = -1;
  private ignited = false;
  private igniteAt = -1;
  private phase: 'play' | 'flash' | 'reveal' | 'gone' = 'play';
  private phaseAt = 0;
  private finished = false;
  private last = 0;
  private raf = 0;
  private flick = { arc: 1, arcNext: 0, torch: 0 };
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private audio: AudioContext | null = null;
  private ambient: HTMLAudioElement | null = null;
  private ambientAct = -1;
  private arcLoop: HTMLAudioElement | null = null;
  private script = SCRIPT as unknown as ScriptDef;

  constructor(private opts: IntroOptions) {
    this.buf.width = INTRO_W;
    this.buf.height = INTRO_H;
    this.ctx = this.buf.getContext('2d', { willReadFrequently: true })!;
    for (let y = 0; y < INTRO_H; y++)
      for (let x = 0; x < INTRO_W; x++) {
        const dx = x / INTRO_W - 0.5, dy = y / INTRO_H - 0.5;
        this.vign[y * INTRO_W + x] = 1 - 0.55 * Math.pow(dx * dx + dy * dy, 1.1) * 2.2;
      }
    this.script.acts.forEach((a, ai) =>
      a.frames.forEach((f) => {
        const img = new Image();
        const url = IMAGES[`../../assets/intro/${f.image}.webp`];
        if (url) img.src = url;
        let d = 0;
        for (const l of f.lines) d += shown(a.style, l).length / CPS + LINE_PAUSE;
        this.shots.push({ act: ai, style: a.style, def: f, img, dur: Math.max(FRAME_MIN, d + FRAME_EXTRA), parts: [], spawn: (f.fx ?? []).map(() => 0) });
      }),
    );

    this.root.id = 'intro';
    this.screen.className = 'intro-pic';
    this.band.className = 'intro-band';
    this.textEl.className = 'intro-text';
    this.band.append(this.textEl);
    this.skipEl.className = 'intro-skip';
    this.skipEl.textContent = 'Пропустить ▸';
    this.white.className = 'intro-white';
    this.root.append(this.screen, this.band, this.skipEl, this.white);
  }

  /** Put the intro over the page and run it. */
  start(): void {
    document.body.append(this.root);
    if (introSeen()) this.skipEl.classList.add('on');
    for (const ev of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu'] as const) addEventListener(ev, this.trap, true);
    addEventListener('resize', this.layout);
    this.layout();
    this.starts[0] = 0;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ input

  /** Everything the player does goes to the intro while it plays (and never to the game underneath). */
  private trap = (e: Event): void => {
    if (this.phase === 'gone') return;
    e.stopPropagation();
    if (e.type === 'contextmenu' || e.type === 'wheel') {
      e.preventDefault();
      return;
    }
    if (e.type === 'pointerdown') {
      this.wakeAudio();
      if (this.skipEl.classList.contains('on') && (e.target as HTMLElement)?.closest?.('.intro-skip')) this.skip();
      else this.advance();
      return;
    }
    if (e.type !== 'keydown') return;
    const k = e as KeyboardEvent;
    this.wakeAudio();
    if (k.code === 'Escape') this.skip();
    else if ((k.code === 'Space' || k.code === 'Enter' || k.code === 'NumpadEnter') && !k.repeat) {
      k.preventDefault();
      this.advance();
    }
  };

  /** A click: finish the line being typed, else the next line (or the next picture). */
  private advance(): void {
    if (this.phase !== 'play' || this.inTransition()) return;
    const s = this.shots[this.cur];
    const l = s.def.lines[this.li];
    if (!l || !this.lineStarted) return;
    const len = shown(s.style, l).length;
    if (this.typed < len) {
      this.typed = len;
      this.doneAt = this.clock;
    } else if (this.li < s.def.lines.length - 1) this.nextLine();
    else this.nextShot();
  }

  private skip(): void {
    if (this.finished) return;
    this.finish(false);
  }

  // ------------------------------------------------------------------ flow

  private tIn(): number {
    return this.transKind === 'black' ? ACT_FADE : this.cur === 0 ? 0.6 : XFADE;
  }

  private inTransition(): boolean {
    return this.clock - this.curStart < this.tIn();
  }

  private nextLine(): void {
    this.li++;
    this.typed = 0;
    this.doneAt = -1;
    this.lineStarted = false;
  }

  private nextShot(): void {
    if (this.cur >= this.shots.length - 1) {
      this.phase = 'flash';
      this.phaseAt = this.clock;
      this.textEl.innerHTML = '';
      return;
    }
    this.prev = this.cur;
    this.cur++;
    this.transKind = this.shots[this.cur].act !== this.shots[this.prev].act ? 'black' : 'x';
    this.curStart = this.clock;
    this.starts[this.cur] = this.clock;
    this.li = 0;
    this.typed = 0;
    this.doneAt = -1;
    this.lineStarted = false;
    this.textEl.innerHTML = '';
  }

  /** A line begins: its voice, its event. */
  private beginLine(): void {
    this.lineStarted = true;
    const s = this.shots[this.cur];
    const l = s.def.lines[this.li];
    if (l.voice) this.playFile(l.voice);
    if (l.event === 'ignite') {
      this.ignited = true;
      this.igniteAt = this.clock;
      this.blip(1400, 0.06, 0.25, 'square');
      if (this.script.sounds?.ignite) this.playFile(this.script.sounds.ignite);
    }
  }

  private update(dt: number): void {
    this.clock += dt;
    const s = this.shots[this.cur];
    // Act sound.
    if (s.act !== this.ambientAct) {
      this.ambientAct = s.act;
      this.ambient?.pause();
      const a = this.script.acts[s.act].ambient;
      this.ambient = a ? this.loopFile(a) : null;
    }
    const arcOn = (s.def.fx ?? []).some((f) => f.type === 'arcFlicker' && (f.after !== 'ignite' || this.ignited));
    if (arcOn && this.script.sounds?.arc && !this.arcLoop) this.arcLoop = this.loopFile(this.script.sounds.arc);
    if (!arcOn && this.arcLoop) {
      this.arcLoop.pause();
      this.arcLoop = null;
    }

    if (this.phase === 'flash') {
      if (this.clock - this.phaseAt >= FLASH) this.finish(true);
      return;
    }
    if (this.phase !== 'play') return;
    const ft = this.clock - this.curStart;
    if (ft < this.tIn()) return;
    const l = s.def.lines[this.li];
    if (!l) {
      if (ft - this.tIn() >= s.dur) this.nextShot();
      return;
    }
    if (!this.lineStarted) {
      // A line may hold back a moment first (the dark before the arc catches).
      if (this.waitFrom < 0) this.waitFrom = this.clock;
      if (this.clock - this.waitFrom < (l.wait ?? 0)) return;
      this.waitFrom = -1;
      this.beginLine();
    }
    const text = shown(s.style, l);
    if (this.typed < text.length) {
      const before = Math.floor(this.typed);
      this.typed = Math.min(text.length, this.typed + CPS * dt);
      const after = Math.floor(this.typed);
      if (after > before && /\S/.test(text.slice(before, after))) this.typeClick();
      if (this.typed >= text.length) this.doneAt = this.clock;
    } else if (this.clock - this.doneAt >= LINE_PAUSE) {
      if (this.li < s.def.lines.length - 1) this.nextLine();
      else if (ft - this.tIn() >= s.dur) this.nextShot();
    }
    if (this.clock > SKIP_AFTER) this.skipEl.classList.add('on');
  }

  /** Hand over to the game: once. From the final flash the picture turns white and the bench shows through it. */
  private finish(fromWhite: boolean): void {
    if (this.finished) return;
    this.finished = true;
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
    this.ambient?.pause();
    this.arcLoop?.pause();
    this.textEl.innerHTML = '';
    this.skipEl.classList.remove('on');
    this.white.style.background = fromWhite ? '#fff' : '#000';
    this.white.style.transition = 'none';
    this.white.style.opacity = '1';
    this.phase = 'reveal';
    this.phaseAt = this.clock;
    this.opts.onDone(fromWhite);
    // Let the game draw its first frames under the white (or black), then let it show through.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.screen.style.visibility = 'hidden';
        this.band.style.visibility = 'hidden';
        // Only the white (or black) veil is left over the game, and it thins away.
        this.root.style.background = 'transparent';
        this.white.style.transition = `opacity ${fromWhite ? REVEAL : 0.4}s ease-out`;
        this.white.style.opacity = '0';
        setTimeout(() => this.remove(), (fromWhite ? REVEAL : 0.4) * 1000 + 100);
      }),
    );
  }

  private remove(): void {
    this.phase = 'gone';
    cancelAnimationFrame(this.raf);
    for (const ev of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu'] as const) removeEventListener(ev, this.trap, true);
    removeEventListener('resize', this.layout);
    this.root.remove();
    this.audio?.close().catch(() => undefined);
  }

  // ------------------------------------------------------------------ drawing

  private layout = (): void => {
    const W = innerWidth, H = innerHeight;
    let w = W, h = (W * 3) / 4;
    if (h > H) {
      h = H;
      w = (H * 4) / 3;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    const x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
    this.rect = { x, y, w, h };
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.screen.width = Math.round(w * dpr);
    this.screen.height = Math.round(h * dpr);
    Object.assign(this.screen.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    // The band for the words: the bottom fifth of the picture at most.
    const bh = Math.floor(h * 0.2);
    Object.assign(this.band.style, { left: x + 'px', top: y + h - bh + 'px', width: w + 'px', height: bh + 'px' });
    // The HUD's pixel font, on its own 16 px grid, never under 20 px.
    const fs = h >= 600 ? 48 : 32;
    this.band.style.fontSize = fs + 'px';
    this.skipEl.style.fontSize = (fs >= 48 ? 32 : 16) + 'px';
    this.band.style.lineHeight = fs * 1.25 + 'px';
  };

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    if (this.phase === 'play' || this.phase === 'flash') {
      this.draw(dt);
      this.drawText();
    }
    if (this.phase !== 'gone') this.raf = requestAnimationFrame(this.frame);
  };

  /** The camera rect in the picture (pixels of its own) at progress p. */
  private camRect(s: Shot, p: number): [number, number, number, number] {
    const iw = s.img.naturalWidth || 1280, ih = s.img.naturalHeight || 960;
    const a = s.def.cam.from, b = s.def.cam.to;
    const e = p * p * (3 - 2 * p);
    const cx = (a[0] + (b[0] - a[0]) * e) / 100, cy = (a[1] + (b[1] - a[1]) * e) / 100, z = Math.max(1, a[2] + (b[2] - a[2]) * e);
    const sw = iw / z, sh = ih / z;
    const sx = Math.min(iw - sw, Math.max(0, cx * iw - sw / 2)), sy = Math.min(ih - sh, Math.max(0, cy * ih - sh / 2));
    return [sx, sy, sw, sh];
  }

  /** Picture % → buffer pixels, through the camera. */
  private toBuf(s: Shot, r: number[], px: number, py: number): [number, number] {
    const iw = s.img.naturalWidth || 1280, ih = s.img.naturalHeight || 960;
    return [(((px / 100) * iw - r[0]) / r[2]) * INTRO_W, (((py / 100) * ih - r[1]) / r[3]) * INTRO_H];
  }

  /** How far the camera has moved on a picture: over its whole time on screen, fades included. */
  private progress(i: number): number {
    const s = this.shots[i];
    const start = this.starts[i] ?? this.curStart;
    return Math.min(1, Math.max(0, (this.clock - start) / (s.dur + ACT_FADE + XFADE)));
  }

  private draw(dt: number): void {
    const c = this.ctx;
    c.globalAlpha = 1;
    c.fillStyle = '#000';
    c.fillRect(0, 0, INTRO_W, INTRO_H);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    // Which pictures are on screen and how much.
    const ft = this.clock - this.curStart;
    const layers: [number, number][] = [];
    if (this.prev >= 0 && ft < this.tIn()) {
      if (this.transKind === 'black') {
        const h = ACT_FADE / 2;
        if (ft < h) layers.push([this.prev, 1 - ft / h]);
        else layers.push([this.cur, (ft - h) / h]);
      } else {
        layers.push([this.prev, 1]);
        layers.push([this.cur, ft / XFADE]);
      }
    } else layers.push([this.cur, this.cur === 0 ? Math.min(1, ft / 0.6) : 1]);

    let bright = 1, warm = 0;
    for (const [i, a] of layers) {
      const s = this.shots[i];
      if (!s.img.complete || !s.img.naturalWidth) continue;
      const r = this.camRect(s, this.progress(i));
      c.globalAlpha = Math.max(0, Math.min(1, a));
      c.drawImage(s.img, r[0], r[1], r[2], r[3], 0, 0, INTRO_W, INTRO_H);
      this.particles(s, r, dt, i === this.cur);
      if (i === this.cur || a > 0.5) {
        const fx = (s.def.fx ?? []).filter((f) => f.after !== 'ignite' || this.ignited);
        // Before the ignition the last frame stays dark.
        const base = s.def.brightness !== undefined && !(this.ignited && i === this.cur) ? s.def.brightness : 1;
        bright = base;
        for (const f of fx) {
          const k = f.strength ?? 1;
          if (f.type === 'arcFlicker') {
            if (this.clock >= this.flick.arcNext) {
              this.flick.arc = 1 + (Math.random() * 2 - 1) * 0.15 * k;
              this.flick.arcNext = this.clock + 0.04 + Math.random() * 0.1;
            }
            bright *= this.flick.arc;
          }
          if (f.type === 'torchFlicker') {
            const t = this.clock;
            warm = (Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.1 + 1) * 0.3 + Math.sin(t * 3.1) * 0.2) * k;
          }
        }
        if (this.ignited && i === this.cur && this.igniteAt >= 0) bright += 2.2 * Math.exp(-(this.clock - this.igniteAt) / 0.25);
      }
    }
    c.globalAlpha = 1;
    // The final flash: the arc whites the picture out.
    let white = 0;
    if (this.phase === 'flash') white = Math.min(1, (this.clock - this.phaseAt) / FLASH);
    this.post(bright, warm, white);
    const sc = this.sctx;
    sc.imageSmoothingEnabled = false;
    sc.drawImage(this.buf, 0, 0, this.screen.width, this.screen.height);
  }

  /** Brightness, warm flicker, vignette, white-out, then the dither down to few colours. */
  private post(bright: number, warm: number, white: number): void {
    const im = this.ctx.getImageData(0, 0, INTRO_W, INTRO_H);
    const d = im.data;
    const mr = bright * (1 + 0.05 * warm), mg = bright * (1 + 0.025 * warm), mb = bright * (1 - 0.02 * warm);
    const levels = (1 << DITHER_BITS) - 1;
    const step = 255 / levels;
    for (let y = 0, p = 0, i = 0; y < INTRO_H; y++)
      for (let x = 0; x < INTRO_W; x++, p += 4, i++) {
        const v = this.vign[i];
        let r = d[p] * mr * v, g = d[p + 1] * mg * v, b = d[p + 2] * mb * v;
        if (white > 0) {
          r += (255 - r) * white;
          g += (255 - g) * white;
          b += (255 - b) * white;
        }
        if (INTRO_DITHER) {
          const o = BAYER[((y & 3) << 2) | (x & 3)];
          r = Math.round(r / step + o) * step;
          g = Math.round(g / step + o) * step;
          b = Math.round(b / step + o) * step;
        }
        d[p] = r;
        d[p + 1] = g;
        d[p + 2] = b;
      }
    this.ctx.putImageData(im, 0, 0);
  }

  /** Spawn, move and draw a picture's particles (single buffer pixels). */
  private particles(s: Shot, r: number[], dt: number, live: boolean): void {
    const c = this.ctx;
    const fx = s.def.fx ?? [];
    if (live)
      fx.forEach((f, k) => {
        if (f.after === 'ignite' && !this.ignited) return;
        const str = f.strength ?? 1;
        const rate = { embers: 14, sparks: 70, dust: 10, snow: 45, arcFlicker: 0, torchFlicker: 0 }[f.type] * str;
        if (!rate) return;
        s.spawn[k] += rate * dt;
        const area = f.area ?? [0, 0, 100, 100];
        while (s.spawn[k] >= 1 && s.parts.length < 600) {
          s.spawn[k] -= 1;
          let px: number, py: number;
          if (f.type === 'sparks') [px, py] = this.toBuf(s, r, f.x ?? 50, f.y ?? 50);
          else {
            const ax = area[0] + Math.random() * area[2], ay = f.type === 'snow' ? area[1] : area[1] + Math.random() * area[3];
            [px, py] = this.toBuf(s, r, ax, ay);
            if (f.type === 'snow') py -= Math.random() * 4;
          }
          const p: Particle = { x: px, y: py, vx: 0, vy: 0, life: 1, age: 0, kind: f.type, seed: Math.random() };
          if (f.type === 'embers') {
            p.vx = (Math.random() - 0.5) * 8;
            p.vy = -(14 + Math.random() * 22);
            p.life = 1.4 + Math.random() * 1.8;
          } else if (f.type === 'sparks') {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6, v = 40 + Math.random() * 110;
            p.vx = Math.cos(a) * v;
            p.vy = Math.sin(a) * v;
            p.life = 0.25 + Math.random() * 0.55;
          } else if (f.type === 'dust') {
            p.vx = (Math.random() - 0.3) * 4;
            p.vy = (Math.random() - 0.5) * 3;
            p.life = 4 + Math.random() * 5;
          } else if (f.type === 'snow') {
            p.vx = 7 + Math.random() * 8;
            p.vy = 18 + Math.random() * 16;
            const hBuf = (area[3] / 100) * INTRO_H * (r[3] > 0 ? (s.img.naturalHeight || 960) / r[3] : 1);
            p.life = Math.max(0.6, hBuf / p.vy);
          }
          s.parts.push(p);
        }
      });
    const out: Particle[] = [];
    for (const p of s.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.kind === 'sparks') p.vy += 90 * dt;
      if (p.kind === 'embers') p.vx += Math.sin(p.age * 3 + p.seed * 6) * 6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -2 || p.x > INTRO_W + 2 || p.y < -2 || p.y > INTRO_H + 2) continue;
      out.push(p);
      const u = p.age / p.life;
      let col = '', a = 1, sz = 1;
      if (p.kind === 'embers') {
        a = (1 - u) * (0.6 + 0.4 * Math.sin(p.age * 18 + p.seed * 40));
        col = u < 0.4 ? '255,190,80' : '255,120,40';
      } else if (p.kind === 'sparks') {
        a = 1 - u * u;
        col = p.seed < 0.5 ? '255,255,255' : '190,225,255';
        sz = p.seed < 0.2 ? 2 : 1;
      } else if (p.kind === 'dust') {
        a = Math.sin(u * Math.PI) * (0.35 + 0.4 * p.seed);
        col = '225,225,240';
      } else if (p.kind === 'snow') {
        a = Math.min(1, (1 - u) * 3) * (0.6 + 0.4 * p.seed);
        col = '240,245,255';
      }
      c.fillStyle = `rgba(${col},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
      c.fillRect(Math.round(p.x), Math.round(p.y), sz, 1);
    }
    s.parts = out;
  }

  /** The words, typed: what is typed shown, the rest laid out but invisible (so lines never re-wrap). */
  private drawText(): void {
    if (this.phase !== 'play' || this.inTransition() || !this.lineStarted) {
      if (this.textEl.innerHTML) this.textEl.innerHTML = '';
      return;
    }
    const s = this.shots[this.cur];
    const l = s.def.lines[this.li];
    if (!l) return;
    const text = shown(s.style, l);
    const n = Math.floor(this.typed);
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const who = s.style === 'dialog' && l.who ? `<span class="who">${esc(l.who)}:</span> ` : '';
    const html = `<span class="${s.style}">${who}${esc(text.slice(0, n))}<span class="rest">${esc(text.slice(n))}</span></span>`;
    if (html !== this.textEl.innerHTML) this.textEl.innerHTML = html;
  }

  // ------------------------------------------------------------------ sound (hooks; missing files are skipped)

  private wakeAudio(): void {
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') this.audio.resume().catch(() => undefined);
    } catch {
      this.audio = null;
    }
  }

  /** A soft tick for each typed letter (a file if the script names one, else a tiny synthetic click). */
  private typeClick(): void {
    if (this.script.sounds?.type) return this.playFile(this.script.sounds.type, 0.35);
    this.blip(2200 + Math.random() * 600, 0.012, 0.035, 'square');
  }

  private blip(freq: number, len: number, vol: number, type: OscillatorType): void {
    const a = this.audio;
    if (!a || a.state !== 'running') return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + len);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + len + 0.01);
  }

  private playFile(src: string, vol = 1): void {
    try {
      const el = new Audio(src);
      el.volume = vol;
      el.addEventListener('error', () => undefined);
      el.play().catch(() => undefined);
    } catch {
      /* no file, no sound */
    }
  }

  private loopFile(src: string): HTMLAudioElement | null {
    try {
      const el = new Audio(src);
      el.loop = true;
      el.volume = 0.6;
      el.addEventListener('error', () => undefined);
      el.play().catch(() => undefined);
      return el;
    } catch {
      return null;
    }
  }
}
