// Ritual scenes (no words) and the tradition pictograms that appear on the temple wall.
// Drawn into a 160×90 vignette; the people work with the thing AND the glowing earth around it, so any thing fits.
import { drawItem } from './items';

export const VW = 160;
export const VH = 90;
type C = CanvasRenderingContext2D;

function r(c: C, x: number, y: number, w: number, h: number, col: string) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function line(c: C, x0: number, y0: number, x1: number, y1: number, col: string) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  c.fillStyle = col;
  for (let i = 0; i <= n; i++) c.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}
function grad(c: C, top: string, bottom: string, h = VH) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  c.fillStyle = g; c.fillRect(0, 0, VW, h);
}
function person(c: C, x: number, y: number, col: string, opts: { kneel?: boolean; arm?: number; eyes?: boolean; scale?: number } = {}) {
  const s = opts.scale ?? 1;
  const h = (opts.kneel ? 8 : 12) * s;
  r(c, x - 1 * s, y - h, 3 * s, 3 * s, col);                       // head
  r(c, x - 1 * s, y - h + 3 * s, 3 * s, (opts.kneel ? 4 : 6) * s, col); // body
  if (!opts.kneel) { r(c, x - 1 * s, y - 3 * s, 1 * s, 3 * s, col); r(c, x + 1 * s, y - 3 * s, 1 * s, 3 * s, col); }
  else r(c, x - 1 * s, y - 1 * s, 5 * s, 1 * s, col);
  const a = opts.arm ?? 0;
  line(c, x + 2 * s, y - h + 4 * s, x + 2 * s + Math.cos(a) * 4 * s, y - h + 4 * s - Math.sin(a) * 4 * s, col);
  if (opts.eyes) { r(c, x - 1 * s, y - h + 1 * s, 1, 1, '#ffe080'); r(c, x + 1 * s, y - h + 1 * s, 1, 1, '#ffe080'); }
}
function glowAt(c: C, x: number, y: number, rad: number, a: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, `rgba(242,193,78,${a})`);
  g.addColorStop(1, 'rgba(242,193,78,0)');
  c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}
function stars(c: C, t: number) {
  for (let i = 0; i < 40; i++) r(c, (i * 37) % VW, (i * 17) % 40, 1, 1, `rgba(230,230,255,${0.4 + 0.3 * Math.sin(t * 2 + i)})`);
}

/** k = 0..1 progress of the scene, t = seconds (for flicker). */
export function drawScene(c: C, ritual: string, k: number, t: number, item: string): void {
  c.clearRect(0, 0, VW, VH);
  if (ritual === 'eat') {
    // night, a fire, the elder grinds the thing with glowing earth; a bowl goes round; eyes flash
    grad(c, '#0a0c1c', '#1a1628', 62); stars(c, t);
    r(c, 0, 62, VW, 28, '#1e1814');
    glowAt(c, 80, 56, 40, 0.25);
    const f = 0.7 + 0.3 * Math.sin(t * 13) * Math.sin(t * 7);
    for (let i = 0; i < 5; i++) r(c, 77 + i, 60 - (3 + ((i * 3 + Math.floor(t * 10)) % 5)) * f, 1, 3 + ((i * 3 + Math.floor(t * 10)) % 5) * f, i % 2 ? '#ffb040' : '#ff7020');
    const ring = 7;
    const pos = (j: number) => { const a = (j / ring) * Math.PI * 2 + 0.4; return [80 + Math.cos(a) * 34, 64 + Math.sin(a) * 9] as const; };
    const bowlK = Math.max(0, (k - 0.5) / 0.5);
    const at = Math.min(ring - 1, Math.floor(bowlK * ring));
    for (let j = 0; j < ring; j++) {
      const [x, y] = pos(j);
      const flash = bowlK > 0 && j <= at && Math.abs(bowlK * ring - j - 0.5) < 0.5;
      person(c, x, y, '#2a2224', { eyes: flash || (bowlK >= 1 && Math.sin(t * 5 + j) > 0.95) });
    }
    // the elder at the grinding stone
    r(c, 52, 64, 14, 3, '#4a4440');
    if (k < 0.4) {
      drawItem(c, item, 58, 62, 8, 'glow', true);
      glowAt(c, 58, 63, 10, 0.5 * (1 - k / 0.4));
    }
    person(c, 48, 66, '#3a2a26', { kneel: true, arm: k < 0.4 ? -0.3 + Math.sin(t * 8) * 0.5 : 0.2 });
    if (k < 0.45) for (let i = 0; i < 6; i++) r(c, 56 + Math.sin(t * 9 + i) * 4, 62 - ((t * 10 + i * 3) % 6), 1, 1, '#f2c14e');
    // the bowl
    if (k >= 0.35) {
      let bx = 60, by = 63;
      if (bowlK > 0) { const [x, y] = pos(at); bx = x + 3; by = y - 6; }
      r(c, bx - 2, by, 5, 2, '#b8a890'); r(c, bx - 1, by - 1, 3, 1, k < 0.5 ? '#f2c14e' : '#9ab8d8');
    }
  } else if (ritual === 'bury') {
    // dawn; the thing is lowered back into the shaft, deeper, and buried; the ground warms, steam rises
    grad(c, '#2a2a4a', '#e09060', 58);
    r(c, 0, 58, VW, 32, '#4a3626');
    const lower = Math.min(1, k / 0.4), fill = Math.max(0, Math.min(1, (k - 0.4) / 0.25)), warm = Math.max(0, (k - 0.65) / 0.35);
    r(c, 74, 58, 12, 32 * (1 - fill), '#140e0a');
    if (fill < 1) {
      const iy = 50 + lower * 34;
      line(c, 66, 50, 80, iy - 4, '#8a7050'); line(c, 94, 50, 80, iy - 4, '#8a7050');
      drawItem(c, item, 80, iy, 8, 'glow', true);
      glowAt(c, 80, iy, 10, 0.5);
    }
    r(c, 98, 58 - 6 * (1 - fill), 16, 6 * (1 - fill), '#5a4430');
    person(c, 64, 58, '#2a2026', { kneel: warm > 0, arm: warm > 0 ? 0.6 : -0.6 });
    person(c, 96, 58, '#2a2026', { kneel: warm > 0, arm: warm > 0 ? 2.5 : 3.7 });
    if (warm > 0) person(c, 50, 58, '#2a2026', { kneel: true, arm: 0.7 });
    if (warm > 0) {
      c.fillStyle = `rgba(255,120,40,${0.18 * warm * (0.7 + 0.3 * Math.sin(t * 3))})`;
      c.fillRect(0, 58, VW, 32);
      for (let s = 0; s < 6; s++) {
        const sx = 20 + s * 24;
        r(c, sx, 58, 1, 3, '#2a1c14');
        for (let i = 0; i < 8; i++) r(c, sx + Math.sin(t * 2 + i * 0.6 + s) * 2, 57 - i * 2 - ((t * 6) % 2), 1, 1, `rgba(230,230,230,${(0.5 - i * 0.06) * warm})`);
      }
    }
  } else {
    // day; the thing with a lump of glowing earth is split on a flat stone into three; three people walk away
    grad(c, '#7aa8d0', '#c8d8d0', 64);
    r(c, 0, 64, VW, 26, '#6a7a4a');
    r(c, 68, 62, 24, 5, '#8a8880');
    const strike = k > 0.3;
    if (!strike) {
      glowAt(c, 80, 60, 10, 0.5);
      r(c, 76, 58, 8, 4, '#c8a050');
      drawItem(c, item, 80, 59, 8, 'glow', true);
      person(c, 96, 64, '#2a2026', { arm: 1.2 + (k / 0.3) * 0.8 });
      r(c, 98 + Math.cos(1.2 + (k / 0.3) * 0.8) * 4, 52 - Math.sin(1.2 + (k / 0.3) * 0.8) * 4, 3, 3, '#6a6a68');
    } else {
      if (k < 0.36) { c.fillStyle = 'rgba(255,240,200,0.6)'; c.fillRect(0, 0, VW, VH); }
      const walk = Math.max(0, (k - 0.4) / 0.6);
      const dirs: [number, number, number][] = [[-1, 0, 1], [1, 0, 1], [0, -1, 0.5]];
      dirs.forEach(([dx, dy, sc], i) => {
        const x = 80 + dx * (6 + walk * 70), y = 64 + dy * walk * 14;
        const s = 1 - (dy ? walk * 0.5 : 0);
        if (walk === 0) { drawItem(c, item, 72 + i * 8, 60, 8, 'glow', true, i); glowAt(c, 72 + i * 8, 60, 6, 0.5); }
        else { person(c, x, y, '#2a2026', { arm: 1.2, scale: s * sc > 0.6 ? 1 : 1 }); glowAt(c, x + 3, y - 9, 6, 0.6); r(c, x + 3, y - 9, 1, 1, '#ffe8a0'); }
      });
      if (walk === 0) person(c, 96, 64, '#2a2026', { arm: 0.2 });
    }
  }
}

// ---------- pictograms ----------
type Stroke = [number, number, number, number];
function stick(cx: number, cy: number, kneel = false): Stroke[] {
  const s: Stroke[] = [[cx - 1, cy - 9, cx + 1, cy - 9], [cx - 1, cy - 8, cx + 1, cy - 8], [cx, cy - 7, cx, cy - 3], [cx - 3, cy - 6, cx + 3, cy - 6]];
  if (kneel) s.push([cx, cy - 3, cx + 3, cy - 3], [cx + 3, cy - 3, cx + 3, cy]);
  else s.push([cx, cy - 3, cx - 2, cy], [cx, cy - 3, cx + 2, cy]);
  return s;
}
function circleStrokes(cx: number, cy: number, rad: number, n = 16): Stroke[] {
  const out: Stroke[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, cx + Math.cos(b) * rad, cy + Math.sin(b) * rad]);
  }
  return out;
}

/** Strokes of a tradition pictogram in a 50×40 box at (0,0). */
export function pictogram(ritual: string): Stroke[] {
  const s: Stroke[] = [];
  if (ritual === 'eat') {
    s.push(...circleStrokes(25, 22, 3, 8));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = 25 + Math.cos(a) * 18, y = 24 + Math.sin(a) * 13;
      s.push([25 + Math.cos(a) * 5, 22 + Math.sin(a) * 4, 25 + Math.cos(a) * 12, 22 + Math.sin(a) * 9]);
      s.push(...stick(x, y + 5));
    }
  } else if (ritual === 'bury') {
    s.push([2, 18, 48, 18]);
    s.push(...circleStrokes(25, 30, 4, 10));
    for (let w = 0; w < 3; w++) for (let i = 0; i < 6; i++) {
      const y = 25 + w * 5, x0 = 8 + i * 6;
      if (x0 > 18 && x0 < 30) continue;
      s.push([x0, y, x0 + 3, y - 1], [x0 + 3, y - 1, x0 + 6, y]);
    }
    s.push(...stick(12, 17, true), ...stick(25, 17, true), ...stick(38, 17, true));
  } else {
    s.push(...circleStrokes(25, 16, 8, 14));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      s.push([25, 16, 25 + Math.cos(a) * 8, 16 + Math.sin(a) * 8]);
      const b = a + Math.PI / 3;
      for (let d = 10; d < 24; d += 4) s.push([25 + Math.cos(b) * d, 16 + Math.sin(b) * d * 0.8 + 6, 25 + Math.cos(b) * (d + 2), 16 + Math.sin(b) * (d + 2) * 0.8 + 6]);
    }
  }
  return s;
}

export function drawPictogram(c: C, ritual: string, ox: number, oy: number, k: number, col = '#b8602e'): void {
  const st = pictogram(ritual);
  const n = Math.floor(st.length * Math.max(0, Math.min(1, k)));
  for (let i = 0; i < n; i++) line(c, ox + st[i][0], oy + st[i][1], ox + st[i][2], oy + st[i][3], col);
}

/** The temple wall with the traditions painted on it. */
export function drawWall(c: C, rituals: string[], newest: string | null, k: number, t: number): void {
  c.clearRect(0, 0, VW, VH);
  r(c, 0, 0, VW, VH, '#7a6e5e');
  for (let row = 0; row < 9; row++) {
    const y = row * 10, off = row % 2 ? 10 : 0;
    r(c, 0, y, VW, 1, '#5e5446');
    for (let x = -off; x < VW; x += 20) r(c, x, y, 1, 10, '#5e5446');
  }
  for (let i = 0; i < 160; i++) r(c, (i * 53) % VW, (i * 29) % VH, 1, 1, i % 2 ? '#86796a' : '#6c6152');
  const list = rituals.slice();
  if (newest && !list.includes(newest)) list.push(newest);
  const n = list.length;
  list.forEach((rit, i) => {
    const ox = n === 1 ? 55 : 6 + i * 52 + (3 - n) * 26;
    drawPictogram(c, rit, ox, 22, rit === newest ? k : 1);
  });
  // torchlight
  const g = c.createRadialGradient(VW / 2, VH / 2, 10, VW / 2, VH / 2, 100);
  g.addColorStop(0, 'rgba(255,190,110,0.12)');
  g.addColorStop(1, `rgba(10,6,4,${0.55 + 0.05 * Math.sin(t * 6)})`);
  c.fillStyle = g; c.fillRect(0, 0, VW, VH);
}
