import * as THREE from 'three';
import { Rng } from '../core/rng';
import { SKIN } from '../skin/default';

/**
 * Procedural low-res textures, painted the way hand-made PS1-era textures were: flat colour blocks,
 * one-pixel bevels, a few brush streaks. Seeded, so the workshop looks the same every time.
 */
const P = SKIN.palette;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, wrap = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(c: string, k: number, hue = 0): string {
  const [r, g, b] = rgb(c);
  return `rgb(${clamp(r * k + hue)},${clamp(g * k)},${clamp(b * k - hue)})`;
}

const clamp = (v: number) => Math.max(0, Math.min(255, v | 0));

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rng, amt: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r.next() - 0.5) * amt;
    img.data[i] = clamp(img.data[i] + n);
    img.data[i + 1] = clamp(img.data[i + 1] + n);
    img.data[i + 2] = clamp(img.data[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

/** Text with hard pixel edges: drawn, then thresholded so no anti-aliasing survives. */
export function crispText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center'): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const [c, t] = canvas(w, h);
  t.font = `bold ${size}px "Courier New", monospace`;
  t.textAlign = align;
  t.textBaseline = 'middle';
  t.fillStyle = '#fff';
  t.fillText(text, x, y);
  const img = t.getImageData(0, 0, w, h);
  const [r, g, b] = rgb(color);
  for (let i = 0; i < img.data.length; i += 4) {
    const on = img.data[i + 3] > 110;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = on ? 255 : 0;
  }
  t.putImageData(img, 0, 0);
  ctx.drawImage(c, 0, 0);
}

/** 3x5 pixel digits, for gauges and price tags: crisp at any size. */
const DIGITS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
};

export function pixDigits(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, k: number, color: string): void {
  const w = s.length * 4 * k - k;
  let x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - 2.5 * k);
  ctx.fillStyle = color;
  for (const ch of s) {
    const g = DIGITS[ch];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(x0 + (i % 3) * k, y0 + Math.floor(i / 3) * k, k, k);
    x0 += 4 * k;
  }
}

export function makeTextures() {
  const r = new Rng(424242);

  /** Dressed stone blocks, cold grey-blue, bevelled, with soot running down from the top. */
  const stone = (() => {
    const S = 128;
    const [c, x] = canvas(S, S);
    x.fillStyle = P.mortar;
    x.fillRect(0, 0, S, S);
    let y = 0;
    while (y < S) {
      const bh = r.int(14, 20);
      let bx = -r.int(0, 20);
      while (bx < S) {
        const bw = r.int(22, 40);
        const base = r.chance(0.15) ? P.stoneDark : P.stone;
        const k = r.range(0.78, 1.12);
        x.fillStyle = shade(base, k);
        x.fillRect(bx + 1, y + 1, bw - 2, bh - 2);
        x.fillStyle = shade(base, k * 1.25);
        x.fillRect(bx + 1, y + 1, bw - 2, 1);
        x.fillRect(bx + 1, y + 1, 1, bh - 2);
        x.fillStyle = shade(base, k * 0.62);
        x.fillRect(bx + 1, y + bh - 2, bw - 2, 1);
        x.fillRect(bx + bw - 2, y + 1, 1, bh - 2);
        // Chips and pits.
        for (let i = 0; i < 3; i++) {
          x.fillStyle = shade(base, k * r.range(0.6, 0.85));
          x.fillRect(bx + r.int(2, bw - 4), y + r.int(2, bh - 4), r.int(1, 3), 1);
        }
        bx += bw;
      }
      y += bh;
    }
    // Soot streaks from above.
    for (let i = 0; i < 10; i++) {
      x.globalAlpha = 0.18;
      x.fillStyle = '#000';
      x.fillRect(r.int(0, S), 0, r.int(2, 6), r.int(20, 70));
    }
    x.globalAlpha = 1;
    noise(x, S, S, r, 14);
    return tex(c);
  })();

  const floor = (() => {
    const S = 64;
    const [c, x] = canvas(S, S);
    x.fillStyle = P.mortar;
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const k = r.range(0.75, 1.15);
        x.fillStyle = shade(P.floor, k);
        x.fillRect(i * 16 + 1, j * 16 + 1, 14, 14);
        x.fillStyle = shade(P.floor, k * 1.2);
        x.fillRect(i * 16 + 1, j * 16 + 1, 14, 1);
      }
    noise(x, S, S, r, 18);
    return tex(c);
  })();

  /** Planks with wavy grain and dark seams. */
  const plank = (base: string, w = 64, h = 64) => {
    const [c, x] = canvas(w, h);
    const n = 4;
    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const k = r.range(0.8, 1.12);
      x.fillStyle = shade(base, k);
      x.fillRect(i * pw, 0, pw, h);
      for (let g = 0; g < 5; g++) {
        const gx = i * pw + r.int(2, pw - 3);
        const ph = r.next() * 6;
        x.fillStyle = shade(base, k * r.range(0.62, 0.8));
        for (let yy = 0; yy < h; yy++) x.fillRect(gx + Math.round(Math.sin(yy * 0.18 + ph) * 1.2), yy, 1, 1);
      }
      x.fillStyle = shade(base, k * 1.2);
      x.fillRect(i * pw + 1, 0, 1, h);
      x.fillStyle = shade(base, 0.35);
      x.fillRect(i * pw, 0, 1, h);
      if (r.chance(0.6)) {
        x.fillStyle = shade(base, 0.45);
        x.fillRect(i * pw + r.int(3, pw - 6), r.int(4, h - 8), 3, 2);
      }
    }
    noise(x, w, h, r, 12);
    return tex(c);
  };
  const wood = plank(P.wood);
  const woodDark = plank(P.woodDark);

  /** Rusty steel: the bench plate and old iron. */
  const rusty = (base: string, rustAmt: number, S = 64) => {
    const [c, x] = canvas(S, S);
    x.fillStyle = base;
    x.fillRect(0, 0, S, S);
    for (let k = 0; k < 60 * rustAmt; k++) {
      x.globalAlpha = r.range(0.25, 0.7);
      x.fillStyle = shade(P.rust, r.range(0.7, 1.3), 10);
      const s = r.int(1, 6);
      x.fillRect(r.int(0, S), r.int(0, S), s, Math.max(1, s - r.int(0, 2)));
    }
    x.globalAlpha = 1;
    for (let k = 0; k < 30; k++) {
      x.fillStyle = shade(base, r.range(1.2, 1.6));
      x.fillRect(r.int(0, S), r.int(0, S), r.int(2, 10), 1);
    }
    noise(x, S, S, r, 16);
    return tex(c);
  };
  const plate = rusty(P.steelDark, 0.7);
  const iron = rusty(P.iron, 0.1, 32);
  const steel = rusty(P.steel, 0.15);

  /** Tan leather glove with creases and stitching. */
  const leather = (() => {
    const [c, x] = canvas(32, 32);
    x.fillStyle = P.leather;
    x.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 9; i++) {
      x.fillStyle = shade(P.leather, r.range(0.6, 0.8));
      x.fillRect(r.int(0, 28), r.int(0, 30), r.int(3, 8), 1);
    }
    for (let i = 0; i < 6; i++) {
      x.fillStyle = shade(P.leather, 1.3);
      x.fillRect(r.int(0, 30), r.int(0, 30), 2, 1);
    }
    x.fillStyle = shade(P.leather, 0.5);
    for (let yy = 1; yy < 32; yy += 4) x.fillRect(30, yy, 1, 2);
    noise(x, 32, 32, r, 22);
    return tex(c);
  })();

  const wool = (() => {
    const [c, x] = canvas(16, 16);
    x.fillStyle = P.cloth;
    x.fillRect(0, 0, 16, 16);
    for (let yy = 0; yy < 16; yy += 2) {
      x.fillStyle = shade(P.cloth, 0.75);
      x.fillRect(0, yy, 16, 1);
    }
    noise(x, 16, 16, r, 20);
    return tex(c);
  })();

  const paper = (() => {
    const [c, x] = canvas(16, 16);
    x.fillStyle = P.paper;
    x.fillRect(0, 0, 16, 16);
    x.fillStyle = shade(P.paper, 0.55);
    for (let k = 0; k < 4; k++) x.fillRect(2, 3 + k * 3, r.int(6, 12), 1);
    noise(x, 16, 16, r, 14);
    return tex(c);
  })();

  const chalk = (() => {
    const [c, x] = canvas(48, 40);
    x.fillStyle = '#1c2220';
    x.fillRect(0, 0, 48, 40);
    x.globalAlpha = 0.25;
    x.fillStyle = '#c8ccc4';
    for (let i = 0; i < 18; i++) x.fillRect(r.int(2, 44), r.int(2, 36), r.int(3, 12), 1);
    x.globalAlpha = 1;
    noise(x, 48, 40, r, 10);
    return tex(c);
  })();

  const sky = (() => {
    const [c, x] = canvas(4, 64);
    const g = x.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, P.sky[0]);
    g.addColorStop(0.45, P.sky[1]);
    g.addColorStop(1, P.sky[2]);
    x.fillStyle = g;
    x.fillRect(0, 0, 4, 64);
    return tex(c, false);
  })();

  /** Worked iron for the jobs: calm mottling, a darker rim, a few rust spots. Reads well under the bead. */
  const part = (() => {
    const S = 32;
    const [c, x] = canvas(S, S);
    x.fillStyle = '#56585c';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      x.fillStyle = shade('#56585c', r.range(0.82, 1.15));
      x.fillRect(r.int(0, S - 2), r.int(0, S - 2), 2, 2);
    }
    for (let i = 0; i < 5; i++) {
      x.globalAlpha = 0.5;
      x.fillStyle = shade(P.rust, r.range(0.8, 1.1));
      x.fillRect(r.int(0, S - 3), r.int(0, S - 3), r.int(1, 3), r.int(1, 3));
    }
    x.globalAlpha = 1;
    noise(x, S, S, r, 8);
    return tex(c);
  })();

  /** Old machine paint, sage green, chipped down to rust at the edges and scuffed. */
  const paint = (() => {
    const S = 32;
    const [c, x] = canvas(S, S);
    x.fillStyle = P.paint;
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) {
      x.fillStyle = shade(P.paint, r.range(0.85, 1.12));
      x.fillRect(r.int(0, S - 3), r.int(0, S - 3), r.int(1, 4), r.int(1, 3));
    }
    for (let i = 0; i < 14; i++) {
      x.fillStyle = shade(P.rust, r.range(0.8, 1.2));
      x.fillRect(r.int(0, S - 2), r.int(0, S - 2), r.int(1, 3), r.int(1, 2));
    }
    x.fillStyle = shade(P.rust, 0.9);
    x.fillRect(0, S - 2, S, 2);
    noise(x, S, S, r, 10);
    return tex(c);
  })();

  /** Plywood pegboard: a grid of dark holes. */
  const peg = (() => {
    const S = 32;
    const [c, x] = canvas(S, S);
    x.fillStyle = '#9a8264';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      x.fillStyle = shade('#9a8264', r.range(0.88, 1.08));
      x.fillRect(0, r.int(0, S - 1), S, 1);
    }
    x.fillStyle = '#3a2e22';
    for (let j = 2; j < S; j += 4) for (let i = 2; i < S; i += 4) x.fillRect(i, j, 1, 1);
    noise(x, S, S, r, 8);
    return tex(c);
  })();

  return { stone, floor, wood, woodDark, plate, iron, steel, leather, wool, paper, chalk, sky, part, paint, peg };
}

/** A paper price tag with a number inked on it. */
export function priceTag(n: number): THREE.CanvasTexture {
  const [c, x] = canvas(24, 14);
  x.fillStyle = P.paper;
  x.fillRect(0, 0, 24, 14);
  x.fillStyle = shade(P.paper, 0.7);
  x.fillRect(0, 13, 24, 1);
  x.fillRect(23, 0, 1, 14);
  x.fillStyle = '#2a1e14';
  x.fillRect(2, 2, 2, 2);
  pixDigits(x, String(n), 14, 7, 2, '#2a1e14');
  return tex(c, false);
}

/** A wooden sign with painted letters. */
export function signTex(text: string): THREE.CanvasTexture {
  const w = Math.max(64, text.length * 9 + 16);
  const [c, x] = canvas(w, 20);
  x.fillStyle = P.woodDark;
  x.fillRect(0, 0, w, 20);
  x.fillStyle = shade(P.wood, 1.1);
  x.fillRect(1, 1, w - 2, 18);
  x.fillStyle = shade(P.wood, 0.7);
  x.fillRect(1, 9, w - 2, 1);
  x.fillStyle = '#e8dcc0';
  x.fillRect(3, 3, w - 6, 14);
  crispText(x, text, w / 2, 10.5, 12, '#2a1e14');
  return tex(c, false);
}

/** Ammeter dial: cream face, scale over 240°, red zone where the arc sputters. */
export function dialTex(redTo: number, max: number): THREE.CanvasTexture {
  const S = 48;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#2a2620';
  x.fillRect(0, 0, S, S);
  x.fillStyle = '#e4d8b8';
  x.beginPath();
  x.arc(S / 2, S / 2, 21, 0, Math.PI * 2);
  x.fill();
  const a0 = Math.PI * (0.5 + 2 / 3);
  const span = (Math.PI * 4) / 3;
  x.lineWidth = 3;
  x.strokeStyle = '#b03a20';
  x.beginPath();
  x.arc(S / 2, S / 2, 16, a0, a0 + span * (redTo / max));
  x.stroke();
  x.fillStyle = '#2a1e14';
  for (let i = 0; i <= 6; i++) {
    const a = a0 + (span * i) / 6;
    for (let k = 14; k < 19; k++) x.fillRect(Math.round(S / 2 + Math.cos(a) * k), Math.round(S / 2 + Math.sin(a) * k), 1, 1);
  }
  crispText(x, 'A', S / 2, S / 2 + 9, 9, '#2a1e14');
  // Hard-edge the circle.
  const img = x.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = 255;
  x.putImageData(img, 0, 0);
  return tex(c, false);
}

/** Black counter window with light digits; redraw() repaints in place. */
export function counterTex(): { tex: THREE.CanvasTexture; redraw: (s: string) => void } {
  const [c, x] = canvas(40, 14);
  const t = tex(c, false);
  const redraw = (s: string) => {
    x.fillStyle = '#121212';
    x.fillRect(0, 0, 40, 14);
    x.fillStyle = '#2a2a2a';
    x.fillRect(0, 0, 40, 1);
    pixDigits(x, s, 20, 7, 2, '#e8dcc0');
    t.needsUpdate = true;
  };
  redraw('000');
  return { tex: t, redraw };
}

export type Textures = ReturnType<typeof makeTextures>;

/** A small canvas texture that can be repainted in place (painted numbers, chalk). */
export function dynTex(w: number, h: number): { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; flush: () => void } {
  const [c, x] = canvas(w, h);
  const t = tex(c, false);
  return { tex: t, ctx: x, flush: () => (t.needsUpdate = true) };
}

/** Fired clay with soot at the rim. */
export function clayTex(): THREE.CanvasTexture {
  const r = new Rng(77);
  const [c, x] = canvas(32, 32);
  x.fillStyle = '#8a5236';
  x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = shade('#8a5236', r.range(0.75, 1.2));
    x.fillRect(r.int(0, 31), r.int(0, 31), r.int(1, 4), 1);
  }
  x.globalAlpha = 0.5;
  x.fillStyle = '#2a1810';
  x.fillRect(0, 0, 32, 4);
  x.globalAlpha = 1;
  noise(x, 32, 32, r, 16);
  return tex(c);
}

/** Barrel staves with two iron hoops. */
export function barrelTex(): THREE.CanvasTexture {
  const r = new Rng(78);
  const [c, x] = canvas(64, 64);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = shade(P.wood, r.range(0.75, 1.1));
    x.fillRect(i * 8, 0, 8, 64);
    x.fillStyle = shade(P.wood, 0.4);
    x.fillRect(i * 8, 0, 1, 64);
  }
  for (const y of [8, 52]) {
    x.fillStyle = '#2a2a2c';
    x.fillRect(0, y, 64, 5);
    x.fillStyle = '#4a4a4c';
    x.fillRect(0, y, 64, 1);
  }
  noise(x, 64, 64, r, 14);
  return tex(c);
}

/** Plank door with a Z brace. */
export function doorTex(): THREE.CanvasTexture {
  const r = new Rng(79);
  const [c, x] = canvas(48, 96);
  for (let i = 0; i < 4; i++) {
    x.fillStyle = shade(P.wood, r.range(0.7, 0.95));
    x.fillRect(i * 12, 0, 12, 96);
    x.fillStyle = shade(P.wood, 0.35);
    x.fillRect(i * 12, 0, 1, 96);
    for (let g = 0; g < 3; g++) {
      x.fillStyle = shade(P.wood, 0.55);
      x.fillRect(i * 12 + r.int(2, 10), r.int(0, 90), 1, r.int(8, 20));
    }
  }
  x.fillStyle = shade(P.wood, 1.05);
  for (const y of [14, 74]) x.fillRect(0, y, 48, 7);
  for (let k = 0; k < 60; k++) x.fillRect(4 + (k / 60) * 40, 74 - (k / 60) * 53, 5, 3);
  x.fillStyle = shade(P.wood, 0.4);
  for (const y of [14, 74]) x.fillRect(0, y + 6, 48, 1);
  noise(x, 48, 96, r, 12);
  return tex(c);
}

/** Painted wooden post: a down arrow and a mask: the mask is lowered with SPACE. */
export function postTex(): THREE.CanvasTexture {
  const [c, x] = canvas(16, 48);
  x.fillStyle = shade(P.wood, 0.75);
  x.fillRect(0, 0, 16, 48);
  const ink = '#d8d0bc';
  x.fillStyle = ink;
  x.fillRect(7, 6, 2, 9);
  x.fillRect(4, 13, 8, 1);
  x.fillRect(5, 14, 6, 1);
  x.fillRect(6, 15, 4, 1);
  x.fillRect(7, 16, 2, 1);
  x.fillRect(4, 24, 8, 1);
  x.fillRect(4, 24, 1, 12);
  x.fillRect(11, 24, 1, 12);
  x.fillRect(5, 36, 6, 1);
  x.fillRect(6, 28, 4, 3);
  return tex(c, false);
}

/** Battery box with a lightning mark. */
export function batteryTex(): THREE.CanvasTexture {
  const [c, x] = canvas(24, 16);
  x.fillStyle = '#4a4c50';
  x.fillRect(0, 0, 24, 16);
  x.fillStyle = '#6a6c70';
  x.fillRect(0, 0, 24, 2);
  x.fillStyle = '#e8b830';
  for (const [px, py, w] of [[13, 3, 3], [12, 5, 3], [11, 7, 5], [13, 9, 3], [12, 11, 2]] as [number, number, number][]) x.fillRect(px, py, w, 2);
  return tex(c, false);
}

/** Wall ammeter: cream half-dial with a lightning mark. */
export function bigDialTex(): THREE.CanvasTexture {
  const S = 64;
  const [c, x] = canvas(S, 40);
  x.fillStyle = '#2a2420';
  x.fillRect(0, 0, S, 40);
  x.fillStyle = '#e6dcc0';
  x.beginPath();
  x.arc(S / 2, 38, 30, Math.PI, 0);
  x.fill();
  x.fillStyle = '#b03a20';
  x.fillRect(6, 24, 6, 3);
  x.fillStyle = '#2a1e14';
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (Math.PI * i) / 8;
    for (let k = 23; k < 28; k++) x.fillRect(Math.round(S / 2 + Math.cos(a) * k), Math.round(38 + Math.sin(a) * k), 1, 1);
  }
  x.fillStyle = '#c86a18';
  for (const [px, py, w] of [[33, 14, 3], [31, 17, 3], [29, 20, 6], [32, 23, 3], [31, 26, 2]] as [number, number, number][]) x.fillRect(px, py, w, 3);
  const img = x.getImageData(0, 0, S, 40);
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = 255;
  x.putImageData(img, 0, 0);
  return tex(c, false);
}
