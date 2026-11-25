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

  /**
   * Old brick, each brick its own: eight clay and stone shades, chipped corners, hairline cracks, white
   * bloom of salt, rust-brown water stains running down, a few broken bricks set deep. 256 px tiles 1.8 m,
   * so the pattern doesn't repeat across a wall.
   */
  const stone = (() => {
    const S = 256;
    const [c, x] = canvas(S, S);
    x.fillStyle = P.mortar;
    x.fillRect(0, 0, S, S);
    // Mortar is not one colour either.
    for (let i = 0; i < 400; i++) {
      x.fillStyle = shade(P.mortar, r.range(0.75, 1.25));
      x.fillRect(r.int(0, S), r.int(0, S), r.int(1, 3), 1);
    }
    const clay = ['#8c6a56', '#7c5e4c', '#957660', '#6c5e54', '#8a7a68', '#7a5848', '#9c8268', '#6a5a4e'];
    let y = 0;
    while (y < S) {
      const bh = y + 18 > S ? S - y : r.int(14, 17);
      let bx = -r.int(0, 30);
      while (bx < S) {
        const bw = r.int(26, 44);
        const base = clay[r.int(0, clay.length - 1)];
        const k = r.range(0.78, 1.1);
        const deep = r.chance(0.05);
        const kk = deep ? k * 0.55 : k;
        // Body with a soft vertical variation (fired unevenly).
        for (let yy = 1; yy < bh - 1; yy++) {
          x.fillStyle = shade(base, kk * (1 - 0.06 * Math.abs(yy - bh / 2) / bh));
          x.fillRect(bx + 1, y + yy, bw - 2, 1);
        }
        // Blotches.
        for (let i = 0; i < 4; i++) {
          x.fillStyle = shade(base, kk * r.range(0.82, 1.08));
          x.fillRect(bx + r.int(2, bw - 7), y + r.int(2, bh - 5), r.int(2, 6), r.int(1, 3));
        }
        if (!deep) {
          // Bevel: light top edge, dark bottom and right.
          x.fillStyle = shade(base, kk * 1.22);
          x.fillRect(bx + 1, y + 1, bw - 2, 1);
          x.fillStyle = shade(base, kk * 0.6);
          x.fillRect(bx + 1, y + bh - 2, bw - 2, 1);
          x.fillRect(bx + bw - 2, y + 1, 1, bh - 2);
        }
        // Chipped corner.
        if (r.chance(0.3)) {
          x.fillStyle = shade(P.mortar, 0.9);
          const cx0 = r.chance(0.5) ? bx + 1 : bx + bw - 5, cy0 = r.chance(0.5) ? y + 1 : y + bh - 4;
          x.fillRect(cx0, cy0, 4, 2);
          x.fillRect(cx0 + (cx0 === bx + 1 ? 0 : 2), cy0 + (cy0 === y + 1 ? 2 : -1), 2, 1);
        }
        // Hairline crack.
        if (r.chance(0.16)) {
          x.fillStyle = shade(base, 0.42);
          let cx = bx + r.int(4, bw - 6), cy = y + 1;
          while (cy < y + bh - 1) {
            x.fillRect(cx, cy, 1, 1);
            cy++;
            cx += r.int(-1, 1);
          }
        }
        // Salt bloom.
        if (r.chance(0.12)) {
          x.globalAlpha = 0.28;
          x.fillStyle = '#e8e2d4';
          x.fillRect(bx + r.int(2, bw - 10), y + r.int(2, bh - 5), r.int(4, 9), r.int(2, 4));
          x.globalAlpha = 1;
        }
        bx += bw;
      }
      y += bh;
    }
    // Water stains running down from a few points.
    for (let i = 0; i < 7; i++) {
      const sx = r.int(0, S - 6), sy = r.int(0, S - 60), len = r.int(40, 150), w = r.int(2, 5);
      for (let yy = 0; yy < len; yy++) {
        x.globalAlpha = 0.22 * (1 - yy / len);
        x.fillStyle = '#2a1c12';
        x.fillRect(sx + Math.round(Math.sin(yy * 0.08 + i) * 1.5), (sy + yy) % S, w, 1);
      }
    }
    x.globalAlpha = 1;
    noise(x, S, S, r, 5);
    return tex(c);
  })();

  /** Flagstones of different sizes, worn smooth, dirt in the gaps, a few cracked. */
  const floor = (() => {
    const S = 128;
    const [c, x] = canvas(S, S);
    x.fillStyle = '#241e18';
    x.fillRect(0, 0, S, S);
    const rows = [0, 30, 58, 92, 128];
    for (let ri = 0; ri < rows.length - 1; ri++) {
      const y0 = rows[ri], y1 = rows[ri + 1];
      let fx = -r.int(0, 20);
      while (fx < S) {
        const fw = r.int(28, 52);
        const k = r.range(0.72, 1.08);
        const base = r.chance(0.3) ? '#6e6658' : P.floor;
        x.fillStyle = shade(base, k);
        x.fillRect(fx + 2, y0 + 2, fw - 3, y1 - y0 - 3);
        // Worn, lighter middle; darker rim.
        x.fillStyle = shade(base, k * 1.1);
        x.fillRect(fx + 6, y0 + 6, fw - 11, y1 - y0 - 11);
        x.fillStyle = shade(base, k * 0.7);
        x.fillRect(fx + 2, y1 - 2, fw - 3, 1);
        for (let i = 0; i < 6; i++) {
          x.fillStyle = shade(base, k * r.range(0.8, 1.05));
          x.fillRect(fx + r.int(3, fw - 8), y0 + r.int(3, y1 - y0 - 6), r.int(2, 6), r.int(1, 3));
        }
        if (r.chance(0.25)) {
          x.fillStyle = '#2a221a';
          let cx = fx + r.int(5, fw - 5), cy = y0 + 3;
          while (cy < y1 - 3) {
            x.fillRect(cx, cy, 1, 1);
            cy++;
            if (r.chance(0.4)) cx += r.int(-1, 1);
          }
        }
        fx += fw;
      }
    }
    noise(x, S, S, r, 6);
    return tex(c);
  })();

  /** Planks: long wavy grain, knots with rings, plank ends with nails, a worn lighter streak. */
  const plank = (base: string, w = 128, h = 128) => {
    const [c, x] = canvas(w, h);
    const n = 5;
    const pw = Math.floor(w / n);
    for (let i = 0; i < n; i++) {
      const x0 = i * pw, ww = i === n - 1 ? w - x0 : pw;
      // Each plank is made of two lengths butted at a random point.
      const cut = r.int(20, h - 20);
      for (const [ya, yb] of [[0, cut], [cut, h]] as [number, number][]) {
        const k = r.range(0.78, 1.12);
        x.fillStyle = shade(base, k);
        x.fillRect(x0, ya, ww, yb - ya);
        // Grain: long wavy lines of different darkness.
        for (let g = 0; g < 9; g++) {
          const gx = x0 + r.int(1, ww - 2), ph = r.next() * 6, amp = r.range(0.6, 2.2), kd = r.range(0.66, 0.9);
          x.fillStyle = shade(base, k * kd);
          for (let yy = ya; yy < yb; yy++) x.fillRect(gx + Math.round(Math.sin(yy * 0.06 + ph) * amp), yy, 1, 1);
        }
        // A knot with a ring of grain around it.
        if (r.chance(0.45)) {
          const kx = x0 + r.int(5, ww - 6), ky = r.int(ya + 6, Math.max(ya + 7, yb - 6));
          x.fillStyle = shade(base, k * 0.45);
          x.fillRect(kx - 1, ky - 2, 3, 4);
          x.fillStyle = shade(base, k * 0.68);
          x.fillRect(kx - 3, ky - 4, 1, 8);
          x.fillRect(kx + 3, ky - 4, 1, 8);
        }
        // Nails at the plank end.
        x.fillStyle = '#2a2420';
        x.fillRect(x0 + 4, ya + 3, 2, 2);
        x.fillRect(x0 + ww - 6, ya + 3, 2, 2);
        // The butt joint.
        x.fillStyle = shade(base, 0.3);
        x.fillRect(x0, ya, ww, 1);
      }
      // Gap between planks, with a lit edge.
      x.fillStyle = shade(base, 0.25);
      x.fillRect(x0, 0, 1, h);
      x.fillStyle = shade(base, 1.18);
      x.fillRect(x0 + 1, 0, 1, h);
      // Worn streak where hands and feet go.
      if (r.chance(0.5)) {
        x.globalAlpha = 0.18;
        x.fillStyle = shade(base, 1.6);
        x.fillRect(x0 + r.int(3, ww - 10), 0, r.int(4, 8), h);
        x.globalAlpha = 1;
      }
    }
    noise(x, w, h, r, 5);
    return tex(c);
  };
  const wood = plank(P.wood);
  const woodDark = plank(P.woodDark);

  /**
   * Worked steel: soft mottling, scratches in all directions, rust creeping in from spots, and for the bench
   * plate (`worn`) the marks of years of welding on it: heat-tint rings, spatter, chalk.
   */
  const rusty = (base: string, rustAmt: number, S = 64, worn = false) => {
    const [c, x] = canvas(S, S);
    x.fillStyle = base;
    x.fillRect(0, 0, S, S);
    for (let k = 0; k < S / 3; k++) {
      x.globalAlpha = 0.18;
      x.fillStyle = shade(base, r.range(0.75, 1.25));
      const s = r.int(4, 12);
      x.fillRect(r.int(0, S), r.int(0, S), s, s);
    }
    x.globalAlpha = 1;
    for (let k = 0; k < 22 * rustAmt; k++) {
      const cx = r.int(0, S), cy = r.int(0, S), s = r.int(2, 7);
      for (let i = 0; i < s * 2; i++) {
        x.globalAlpha = r.range(0.3, 0.75);
        x.fillStyle = shade(P.rust, r.range(0.7, 1.3), 10);
        x.fillRect(cx + r.int(-s, s), cy + r.int(-s, s), r.int(1, 3), 1);
      }
    }
    x.globalAlpha = 1;
    for (let k = 0; k < (worn ? 40 : 14); k++) {
      x.fillStyle = shade(base, r.range(1.15, 1.45));
      const len = r.int(4, 16), ang = r.next() * Math.PI;
      let sx = r.int(0, S), sy = r.int(0, S);
      for (let i = 0; i < len; i++) {
        x.fillRect(Math.round(sx), Math.round(sy), 1, 1);
        sx += Math.cos(ang);
        sy += Math.sin(ang);
      }
    }
    if (worn) {
      // Heat tint: straw and blue rings where welds were laid on the plate.
      for (let k = 0; k < 5; k++) {
        const cx = r.int(8, S - 8), cy = r.int(8, S - 8);
        for (const [rad, col, a] of [[9, '#6a6090', 0.22], [6, '#9a7a40', 0.25], [3, '#3a3030', 0.35]] as [number, string, number][]) {
          x.globalAlpha = a;
          x.fillStyle = col;
          x.beginPath();
          x.ellipse(cx, cy, rad, rad * 0.6, r.next(), 0, Math.PI * 2);
          x.fill();
        }
      }
      x.globalAlpha = 1;
      // Spatter balls.
      for (let k = 0; k < 40; k++) {
        const sx = r.int(0, S), sy = r.int(0, S);
        x.fillStyle = '#2a2826';
        x.fillRect(sx, sy, 1, 1);
        x.fillStyle = shade(base, 1.5);
        x.fillRect(sx, sy - 1, 1, 1);
      }
      // Old chalk marks.
      x.globalAlpha = 0.35;
      x.fillStyle = '#d8d4c8';
      for (let k = 0; k < 3; k++) {
        const sx = r.int(4, S - 20), sy = r.int(4, S - 6);
        x.fillRect(sx, sy, r.int(8, 18), 1);
        x.fillRect(sx + r.int(0, 6), sy - r.int(2, 5), 1, r.int(3, 6));
      }
      x.globalAlpha = 1;
    }
    noise(x, S, S, r, 6);
    return tex(c);
  };
  const plate = rusty(P.steelDark, 0.7, 128, true);
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

  /** Worked iron for the jobs: calm, large soft mottling and a few rust spots, so light, not texture, shows the form. */
  const part = (() => {
    const S = 64;
    const [c, x] = canvas(S, S);
    x.fillStyle = '#5a5c60';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      x.globalAlpha = 0.14;
      x.fillStyle = shade('#5a5c60', r.range(0.8, 1.2));
      const s2 = r.int(6, 16);
      x.fillRect(r.int(0, S), r.int(0, S), s2, s2);
    }
    x.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      x.globalAlpha = 0.45;
      x.fillStyle = shade(P.rust, r.range(0.8, 1.1));
      x.fillRect(r.int(0, S - 3), r.int(0, S - 3), r.int(1, 3), r.int(1, 2));
    }
    x.globalAlpha = 1;
    noise(x, S, S, r, 3);
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
  // Painted board: dark wood, cream letters with a dark shadow so they read from across the room.
  const w = Math.max(88, text.length * 13 + 24);
  const H = 28;
  const [c, x] = canvas(w, H);
  x.fillStyle = '#1e1610';
  x.fillRect(0, 0, w, H);
  x.fillStyle = shade(P.woodDark, 0.9);
  x.fillRect(1, 1, w - 2, H - 2);
  x.fillStyle = shade(P.woodDark, 0.7);
  x.fillRect(1, 9, w - 2, 1);
  x.fillRect(1, 19, w - 2, 1);
  crispText(x, text, w / 2 + 1, H / 2 + 1.5, 18, '#0e0a08');
  crispText(x, text, w / 2, H / 2 + 0.5, 18, '#f0dca8');
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
