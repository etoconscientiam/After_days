// Creatures 16–32 px: each is a little rig of rectangles drawn with a dark outline, so silhouettes read clearly
// and poses (grazing, alert, walking, flying, perched) are cheap to animate. Placeholder art via the same skin hook.
type C = CanvasRenderingContext2D;
type R = [number, number, number, number, string]; // x, y, w, h, colour (relative to the anchor at the feet)

const OUT = '#16121a';

export interface Pose {
  t: number;        // seconds (for cycles)
  i: number;        // individual index (variation)
  flip: boolean;    // facing left
  alert: number;    // 0..1 heads up
  walk: number;     // 0..1 walking amount
  season: number;   // 0..1 (spring .. winter)
  tint?: string;
  glow?: boolean;
}

function stamp(c: C, ax: number, ay: number, rects: R[], flip: boolean, outline = true): void {
  ax = Math.round(ax); ay = Math.round(ay);
  const X = (r: R) => (flip ? ax - r[0] - r[2] : ax + r[0]);
  if (outline) {
    c.fillStyle = OUT;
    for (const r of rects) c.fillRect(X(r) - 1, ay + r[1] - 1, r[2] + 2, r[3] + 2);
  }
  for (const r of rects) { c.fillStyle = r[4]; c.fillRect(X(r), ay + r[1], r[2], r[3]); }
}

function shadow(c: C, x: number, y: number, w: number): void {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(Math.round(x - w / 2), Math.round(y), w, 1);
}

const legs = (xs: number[], top: number, h: number, phase: number, walk: number, col: string): R[] =>
  xs.map((lx, k) => [lx, top - (walk > 0 && ((k + Math.floor(phase)) % 2 === 0) ? 1 : 0), 1, h - (walk > 0 && ((k + Math.floor(phase)) % 2 === 0) ? 1 : 0), col] as R);

export function herd(c: C, x: number, y: number, p: Pose): void {
  const body = ['#7a5638', '#6a5a44', '#8a6a44'][p.i % 3], dark = '#4e3622', light = '#a07c56';
  const ph = p.t * 6 + p.i;
  const r: R[] = [
    ...legs([-6, -4, 3, 5], -5, 5, ph, p.walk, dark),
    [-7, -11, 14, 6, body], [-5, -13, 7, 2, body], [-6, -6, 12, 1, light], [-8, -11, 1, 4, dark],
  ];
  if (p.alert > 0.5 || p.walk > 0.5) r.push([6, -13, 2, 4, body], [7, -15, 4, 3, body], [10, -14, 1, 1, light], [7, -16, 1, 1, '#e8dcc0'], [9, -14, 1, 1, OUT]);
  else r.push([6, -9, 2, 3, body], [7, -6, 4, 3, body], [10, -5, 1, 1, light], [7, -7, 1, 1, '#e8dcc0'], [9, -6, 1, 1, OUT]);
  shadow(c, x, y, 16);
  stamp(c, x, y, r, p.flip);
}

export function predator(c: C, x: number, y: number, p: Pose): void {
  const body = '#5c5c66', dark = '#3e3e46', light = '#80808a';
  const ph = p.t * 9 + p.i;
  const head = p.alert > 0.5 ? -12 : -10;
  const r: R[] = [
    ...legs([-5, -3, 3, 5], -5, 5, ph, Math.max(p.walk, 0.6), dark),
    [-6, -9, 12, 4, body], [-5, -6, 10, 1, light], [-10, -10, 4, 1, body], [-11, -11, 2, 1, dark],
    [5, head, 4, 3, body], [9, head + 1, 2, 2, light], [6, head - 2, 1, 2, body], [8, head - 2, 1, 2, body], [8, head, 1, 1, '#e8c060'],
  ];
  shadow(c, x, y, 14);
  stamp(c, x, y, r, p.flip);
}

export function hominid(c: C, x: number, y: number, p: Pose, torch = false): void {
  const skin = p.tint ?? '#c8a070', cloth = torch ? '#7a4a30' : '#6a5440', hair = '#3a2a1e';
  const ph = p.t * 5 + p.i;
  const sw = p.walk > 0.3 ? (Math.sin(ph) > 0 ? 1 : -1) : 0;
  const look = p.alert > 0.5 ? -1 : 0;
  const r: R[] = [
    [-1 + (sw > 0 ? 0 : -1), -6, 1, 6, cloth], [1 + (sw > 0 ? 1 : 0), -6, 1, 6, cloth],
    [-1, -12, 3, 6, cloth], [-1 + look, -16, 3, 4, skin], [-1 + look, -17, 3, 1, hair],
    [-2, -11 + (sw > 0 ? 1 : 0), 1, 5, skin], [2, -11 + (sw < 0 ? 1 : 0), 1, 5, skin],
  ];
  if (p.alert > 0.5) r.push([1 + look, -15, 1, 1, '#2a1a10']);
  else r.push([2, -15, 1, 1, '#2a1a10']);
  if (torch) r.push([3, -15, 1, 6, '#5a3a20']);
  shadow(c, x, y, 6);
  stamp(c, x, y, r, p.flip);
  if (torch) {
    const f = 0.7 + 0.3 * Math.sin(p.t * 12 + p.i * 3);
    const tx = Math.round(p.flip ? x - 4 : x + 3), ty = Math.round(y - 17);
    c.fillStyle = `rgba(255,${150 + 60 * f},50,${0.9})`; c.fillRect(tx, ty, 1, 2);
    c.fillStyle = `rgba(255,230,140,${f})`; c.fillRect(tx, ty + 1, 1, 1);
  }
}

export function birdFlying(c: C, x: number, y: number, p: Pose): void {
  const up = Math.sin(p.t * 11 + p.i * 1.7) > 0;
  const col = '#2a262e';
  c.fillStyle = col;
  const X = Math.round(x), Y = Math.round(y);
  c.fillRect(X - 1, Y, 3, 1);
  if (up) { c.fillRect(X - 4, Y - 2, 1, 1); c.fillRect(X - 3, Y - 1, 2, 1); c.fillRect(X + 2, Y - 1, 2, 1); c.fillRect(X + 4, Y - 2, 1, 1); }
  else { c.fillRect(X - 4, Y + 1, 1, 1); c.fillRect(X - 3, Y, 2, 1); c.fillRect(X + 2, Y, 2, 1); c.fillRect(X + 4, Y + 1, 1, 1); }
}

export function birdPerched(c: C, x: number, y: number, p: Pose): void {
  const peck = Math.sin(p.t * 3 + p.i * 2.3) > 0.6;
  const body = '#5a5866', light = '#8a8896';
  const r: R[] = [[-2, -4, 4, 3, body], [-2, -2, 3, 1, light], [-3, -4, 1, 2, body], [0, -1, 1, 1, '#c8a050']];
  if (peck) r.push([2, -3, 2, 2, body], [4, -2, 1, 1, '#d8b060']);
  else r.push([1, -6, 2, 2, body], [3, -5, 1, 1, '#d8b060']);
  stamp(c, x, y, r, p.flip);
}

export function fish(c: C, x: number, y: number, p: Pose): void {
  const cols = [['#8ab0c8', '#5a80a0'], ['#c8a86a', '#9a7a40'], ['#a0b8a0', '#6a8a6a']][p.i % 3];
  const tail = Math.sin(p.t * 10 + p.i) > 0 ? 0 : 1;
  const r: R[] = [[-4, -2, 8, 3, cols[0]], [-3, -3, 6, 1, cols[0]], [-3, 1, 6, 1, cols[1]], [-6, -2 - tail, 2, 1, cols[1]], [-6, 0 + tail, 2, 1, cols[1]], [-5, -1, 1, 1, cols[1]], [2, -2, 1, 1, OUT]];
  stamp(c, x, y, r, p.flip);
}

export function mollusc(c: C, x: number, y: number, p: Pose): void {
  const a = ['#e0c8a0', '#c8a8c0', '#d8b890'][p.i % 3], b = '#8a6248';
  stamp(c, x, y, [[-2, -3, 5, 3, a], [-1, -4, 3, 1, a], [-1, -3, 1, 2, b], [0, -2, 2, 1, b], [1, -3, 1, 1, b]], p.flip);
}

export function mat(c: C, x: number, y: number, p: Pose): void {
  const w = 6 + (p.i % 3) * 2, h = 2 + (p.i % 3);
  const layers = ['#3a5a2a', '#5a8a3a', '#7ab84a', '#4a7a32'];
  for (let row = 0; row < h; row++) {
    const ww = Math.round(w * Math.sqrt(1 - (row / (h + 0.5)) ** 2));
    c.fillStyle = layers[row % 4];
    c.fillRect(Math.round(x - ww / 2), Math.round(y - 1 - row), ww, 1);
  }
}

export function plankton(c: C, x: number, y: number, p: Pose): void {
  const a = 0.5 + 0.5 * Math.sin(p.t * 2 + p.i);
  c.fillStyle = `rgba(190,240,215,${0.4 + 0.5 * a})`;
  c.fillRect(Math.round(x + Math.sin(p.t * 0.6 + p.i) * 4), Math.round(y + Math.cos(p.t * 0.5 + p.i * 1.3) * 2), 1, 1);
}

function leaf(season: number): [string, string] {
  const s = season * 4;
  if (s < 1) return ['#5f9a3a', '#86c050'];
  if (s < 2) return ['#3f7a2a', '#5e9e3a'];
  if (s < 3) return ['#b8742a', '#e0a040'];
  return ['#6a6a5a', '#8a8a7a'];
}

export function fern(c: C, x: number, y: number, p: Pose): void {
  const [d, l] = leaf(p.season);
  const h = 6 + (p.i % 4) * 2;
  const sway = Math.sin(p.t * 1.5 + p.i) * 1;
  for (let k = 0; k < h; k++) {
    const bx = Math.round(x + (sway * k) / h), by = Math.round(y - k);
    c.fillStyle = d; c.fillRect(bx, by, 1, 1);
    if (k % 2 === 0 && k > 1) {
      const len = Math.max(1, Math.round((h - k) / 2.5));
      c.fillStyle = k % 4 ? l : d;
      c.fillRect(bx - len, by, len, 1); c.fillRect(bx + 1, by - 1, len, 1);
    }
  }
}

export function tree(c: C, x: number, y: number, p: Pose): void {
  const h = 18 + (p.i * 7) % 11;
  const winter = p.season > 0.75;
  const [d, l] = leaf(p.season);
  const sway = Math.sin(p.t * 0.9 + p.i) * 1.2;
  const X = Math.round(x), Y = Math.round(y);
  c.fillStyle = OUT; c.fillRect(X - 2, Y - h, 4, h);
  c.fillStyle = '#5a4030'; c.fillRect(X - 1, Y - h, 2, h);
  c.fillStyle = '#3a2a1e'; c.fillRect(X, Y - h, 1, h);
  c.fillStyle = '#5a4030';
  c.fillRect(X + 1, Y - h + 5, 3, 1); c.fillRect(X - 4, Y - h + 7, 3, 1);
  shadow(c, x, y, 10);
  if (winter) {
    c.fillStyle = 'rgba(236,240,248,0.9)'; c.fillRect(X - 3, Y - h - 1, 6, 1); c.fillRect(X + 2, Y - h + 4, 2, 1);
    return;
  }
  const clumps: [number, number, number][] = [[0, -h, 6 + (p.i % 3)], [-5, -h + 4, 5], [5, -h + 3, 5], [0, -h - 5, 4]];
  for (const [cx, cy, rad] of clumps) {
    const ox = X + cx + Math.round(sway * (1 - (cy + h) / 10)), oy = Y + cy;
    for (let yy = -rad - 1; yy <= rad + 1; yy++) {
      const ww = Math.round(Math.sqrt(Math.max(0, (rad + 1) ** 2 - yy * yy)));
      c.fillStyle = OUT; c.fillRect(ox - ww, oy + yy, ww * 2 + 1, 1);
    }
    for (let yy = -rad; yy <= rad; yy++) {
      const ww = Math.round(Math.sqrt(Math.max(0, rad * rad - yy * yy)));
      c.fillStyle = yy < -rad / 3 ? l : d;
      c.fillRect(ox - ww, oy + yy, ww * 2 + 1, 1);
    }
    c.fillStyle = l; c.fillRect(ox - Math.round(rad / 2), oy - Math.round(rad / 2), 2, 1);
  }
}

export function insect(c: C, x: number, y: number, p: Pose): void {
  const fx = x + Math.sin(p.t * 3 + p.i * 2) * 8, fy = y - 10 + Math.cos(p.t * 4.3 + p.i) * 4;
  c.fillStyle = '#3a5a6a'; c.fillRect(Math.round(fx) - 1, Math.round(fy), 3, 1);
  if (Math.sin(p.t * 40 + p.i) > 0) { c.fillStyle = 'rgba(220,235,240,0.8)'; c.fillRect(Math.round(fx), Math.round(fy) - 1, 1, 1); c.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 1, 1); }
}

export function glowling(c: C, x: number, y: number, p: Pose): void {
  c.fillStyle = `rgba(120,255,190,${0.5 + 0.5 * Math.sin(p.t * 3 + p.i)})`;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

export const CREATURES: Record<string, (c: C, x: number, y: number, p: Pose) => void> = {
  mat, plankton, mollusc, fish, moss: fern, tree, insect, bird: birdPerched, herd, predator,
  hominid: (c, x, y, p) => hominid(c, x, y, p, false),
  tribe: (c, x, y, p) => hominid(c, x, y, p, p.i % 3 === 0),
  glow: glowling,
};

/** A 24×24 icon of a species for the UI. */
export function creatureIcon(sprite: string, tint?: string, water = false): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 24; cv.height = 24;
  const c = cv.getContext('2d')!;
  c.fillStyle = water ? '#16303e' : '#2a2219';
  c.fillRect(0, 0, 24, 24);
  const pose: Pose = { t: 0.4, i: 1, flip: false, alert: 1, walk: 0, season: 0.3, tint };
  const fn = CREATURES[sprite] ?? glowling;
  switch (sprite) {
    case 'tree': fn(c, 12, 23, { ...pose, i: 0 }); break;
    case 'plankton': for (let i = 0; i < 9; i++) { c.fillStyle = i % 3 ? '#aadcc8' : '#e0f4c0'; c.fillRect(4 + (i * 7) % 16, 5 + (i * 5) % 14, 1, 1); } break;
    case 'fish': fn(c, 12, 13, pose); break;
    case 'mat': fn(c, 8, 21, { ...pose, i: 2 }); fn(c, 17, 21, pose); break;
    case 'insect': insect(c, 12, 20, { ...pose, t: 0 }); insect(c, 8, 22, { ...pose, i: 3, t: 0 }); break;
    case 'bird': birdFlying(c, 8, 8, pose); birdFlying(c, 16, 12, { ...pose, i: 3 }); birdPerched(c, 12, 22, pose); break;
    case 'herd': fn(c, 11, 21, pose); break;
    case 'predator': fn(c, 11, 20, pose); break;
    case 'mollusc': fn(c, 12, 20, pose); break;
    case 'moss': fern(c, 8, 22, pose); fern(c, 15, 22, { ...pose, i: 3 }); break;
    default: fn(c, 12, 22, pose);
  }
  return cropIcon(cv, water ? '#16303e' : '#2a2219');
}

/** Crop an icon to its drawn pixels (square, 1 px margin) so small sprites fill their tile. */
function cropIcon(cv: HTMLCanvasElement, bg: string): HTMLCanvasElement {
  const c = cv.getContext('2d')!;
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  const n = parseInt(bg.slice(1), 16), br = (n >> 16) & 255, bgc = (n >> 8) & 255, bb = n & 255;
  let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const o = (y * cv.width + x) * 4;
    if (Math.abs(d[o] - br) + Math.abs(d[o + 1] - bgc) + Math.abs(d[o + 2] - bb) < 6) continue;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  if (x1 < 0) return cv;
  const size = Math.max(10, Math.max(x1 - x0, y1 - y0) + 3);
  const out = document.createElement('canvas');
  out.width = size; out.height = size;
  const o = out.getContext('2d')!;
  o.fillStyle = bg; o.fillRect(0, 0, size, size);
  o.drawImage(cv, x0, y0, x1 - x0 + 1, y1 - y0 + 1, Math.floor((size - (x1 - x0 + 1)) / 2), Math.floor((size - (y1 - y0 + 1)) / 2), x1 - x0 + 1, y1 - y0 + 1);
  return out;
}

// ---------- life at the scale of the strata ----------
// One particle is 2×2 px and a pile some 10 px across, so life on the surface is a detail: a tree is at most two
// piles tall, a moss a tuft, a person a few pixels. No black outlines (they make things read big). `grow` 0..1:
// a plant sprouting after it was buried.

/** A tree, 6–10 px: a thin trunk and a crown of two or three blobs, by the season. */
export function treeSmall(c: C, x: number, y: number, p: Pose, grow = 1): void {
  const X = Math.round(x), Y = Math.round(y);
  const h = Math.max(2, Math.round((6 + ((p.i * 7) % 5)) * grow));
  const [d, l] = leaf(p.season);
  const winter = p.season > 0.75;
  c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(X - 1, Y, 3, 1);
  c.fillStyle = '#4a3424'; c.fillRect(X, Y - h, 1, h);
  if (grow < 0.35) { c.fillStyle = l; c.fillRect(X - 1, Y - h, 1, 1); c.fillRect(X + 1, Y - h + 1, 1, 1); return; }
  if (winter) { c.fillStyle = '#4a3424'; c.fillRect(X - 1, Y - h + 2, 1, 1); c.fillRect(X + 1, Y - h + 1, 1, 1); c.fillStyle = 'rgba(236,240,248,0.85)'; c.fillRect(X - 1, Y - h, 3, 1); return; }
  const sway = Math.sin(p.t * 0.9 + p.i) > 0.6 ? 1 : 0;
  const r = Math.max(1, Math.round((2 + (p.i % 2)) * grow));
  const blobs: [number, number, number][] = [[0, -h, r], [-r, -h + r, r - 1 || 1], [r, -h + r - 1, r - 1 || 1]];
  for (const [bx, by, rad] of blobs) {
    for (let yy = -rad; yy <= rad; yy++) {
      const ww = Math.round(Math.sqrt(Math.max(0, rad * rad - yy * yy)));
      c.fillStyle = yy < 0 ? l : d;
      c.fillRect(X + bx - ww + sway, Y + by + yy, ww * 2 + 1, 1);
    }
  }
}

/** A tuft of moss or fern, 2–4 px. */
export function mossSmall(c: C, x: number, y: number, p: Pose, grow = 1): void {
  const X = Math.round(x), Y = Math.round(y);
  const [d, l] = leaf(p.season * 0.7);
  const h = Math.max(1, Math.round((2 + (p.i % 3)) * grow));
  const sway = Math.sin(p.t * 1.5 + p.i) > 0.5 ? 1 : 0;
  c.fillStyle = d; c.fillRect(X - 1, Y - 1, 3, 1);
  c.fillStyle = l;
  for (let k = 1; k < h; k++) c.fillRect(X + (k === h - 1 ? sway : 0), Y - 1 - k, 1, 1);
  if (h > 2) { c.fillRect(X - 1, Y - 2, 1, 1); c.fillRect(X + 1, Y - 3, 1, 1); }
}

/** A person, 5 px tall; a torch for the tribe. */
export function personSmall(c: C, x: number, y: number, p: Pose, torch = false): void {
  const X = Math.round(x), Y = Math.round(y);
  const skin = p.tint ?? '#c8a070', cloth = torch ? '#7a4a30' : '#5e4a38';
  const step = p.walk > 0.3 && Math.sin(p.t * 6 + p.i) > 0 ? 1 : 0;
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(X - 1, Y, 3, 1);
  c.fillStyle = cloth; c.fillRect(X - step, Y - 2, 1, 2); c.fillRect(X + 1 - step, Y - 2, 1, 2);
  c.fillRect(X, Y - 4, 2, 2);
  c.fillStyle = skin; c.fillRect(X + (p.alert > 0.5 ? 0 : 1), Y - 5, 1, 1);
  if (torch) {
    const f = Math.sin(p.t * 12 + p.i * 3) > 0 ? '#ffb040' : '#ff7a2a';
    c.fillStyle = '#5a3a20'; c.fillRect(X + 2, Y - 5, 1, 2);
    c.fillStyle = f; c.fillRect(X + 2, Y - 6, 1, 1);
  }
}

/** A microbial mat on the floor: a thin green film, its edge a little lighter. */
export function matFilm(c: C, x: number, y: number, p: Pose): void {
  const X = Math.round(x), Y = Math.round(y);
  const w = 4 + (p.i % 3) * 2;
  c.fillStyle = '#3e6a34'; c.fillRect(X - (w >> 1), Y - 1, w, 1);
  c.fillStyle = '#6a9a48'; c.fillRect(X - (w >> 1) + 1, Y - 1, Math.max(1, w - 3), 1);
  if (p.i % 2) { c.fillStyle = '#6a5478'; c.fillRect(X + (w >> 1) - 1, Y - 1, 1, 1); }
}
