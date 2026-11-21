// Echo pictures: tiny wordless scenes of the old world (placeholder pixel art, 44×30), faded like memory.
// Each picture is a function of time so some of them move a little (a swing, steam, a curtain).
export const EW = 44;
export const EH = 30;

type C = CanvasRenderingContext2D;
const D = '#2b2530', M = '#6d6168', L = '#d9ccb4', A = '#f2c14e', S = '#8fa3b8', G = '#7da36a', SKIN = '#c8a898';

function r(c: C, x: number, y: number, w: number, h: number, col: string) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function p(c: C, x: number, y: number, col: string) { r(c, x, y, 1, 1, col); }
function line(c: C, x0: number, y0: number, x1: number, y1: number, col: string) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  c.fillStyle = col;
  for (let i = 0; i < 200; i++) {
    c.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
function circ(c: C, cx: number, cy: number, rad: number, col: string, fill = true) {
  c.fillStyle = col;
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
    const d = Math.hypot(x, y);
    if (fill ? d <= rad + 0.3 : Math.abs(d - rad) < 0.6) c.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
  }
}
function grad(c: C, top: string, bottom: string) {
  const g = c.createLinearGradient(0, 0, 0, EH);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  c.fillStyle = g; c.fillRect(0, 0, EW, EH);
}
function figure(c: C, x: number, y: number, col: string, h = 7) {
  circ(c, x, y - h + 1, 1, col);
  r(c, x - 1, y - h + 3, 3, h - 5, col);
  r(c, x - 1, y - 2, 1, 2, col); r(c, x + 1, y - 2, 1, 2, col);
}
function palm(c: C, x: number, y: number, col: string, mirror = false) {
  r(c, x, y + 8, 11, 10, col);
  for (let f = 0; f < 4; f++) r(c, x + f * 3, y + (f === 0 || f === 3 ? 3 : 0) + (f === 3 ? 1 : 0), 2, 9, col);
  r(c, mirror ? x + 11 : x - 3, y + 11, 3, 2, col);
  r(c, mirror ? x + 12 : x - 4, y + 9, 2, 3, col);
}
function windowFrame(c: C, x: number, y: number, w: number, h: number, col: string) {
  r(c, x, y, w, 1, col); r(c, x, y + h - 1, w, 1, col); r(c, x, y, 1, h, col); r(c, x + w - 1, y, 1, h, col);
}

export const ECHO_PICTURES: Record<string, (c: C, t: number) => void> = {
  palmGlass: (c) => {
    grad(c, '#7f909c', '#5a6874');
    for (let i = -30; i < 50; i += 9) line(c, i, 30, i + 18, 0, 'rgba(230,240,250,0.18)');
    palm(c, 16, 4, SKIN);
    r(c, 18, 14, 6, 4, '#e0c4b4');
  },
  palmGlassOther: (c) => {
    grad(c, '#4a5460', '#2e343c');
    for (let i = -30; i < 50; i += 9) line(c, i + 18, 30, i, 0, 'rgba(230,240,250,0.12)');
    palm(c, 17, 4, '#4a3c3e', true);
    r(c, 19, 14, 6, 4, '#5a4a4a');
  },
  litWindow: (c) => {
    grad(c, '#161a2c', '#262a40');
    r(c, 12, 2, 20, 28, '#2a2832');
    for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) r(c, 14 + col * 4, 4 + row * 4, 2, 2, row === 3 && col === 2 ? A : '#3a3846');
    for (let i = 0; i < 10; i++) p(c, (i * 7) % 44, 27 + (i % 3), 'rgba(242,193,78,0.35)');
  },
  swing: (c, t) => {
    grad(c, '#9aaabc', '#c8c0b0');
    line(c, 8, 28, 14, 4, M); line(c, 20, 28, 14, 4, M);
    line(c, 24, 28, 30, 4, M); line(c, 36, 28, 30, 4, M);
    line(c, 14, 4, 30, 4, D);
    const a = Math.sin(t * 2.2) * 0.55;
    const ex = Math.sin(a) * 16, ey = Math.cos(a) * 16;
    line(c, 19, 4, 19 + ex, 4 + ey, D); line(c, 25, 4, 25 + ex, 4 + ey, D);
    r(c, 18 + ex, 4 + ey, 8, 1, '#5a4030');
    r(c, 0, 28, 44, 2, '#8a8070');
  },
  pigeons: (c, t) => {
    grad(c, '#b8c4cc', '#d8d0c0');
    r(c, 0, 25, 44, 5, '#8a8078');
    for (let x = 0; x < 44; x += 6) line(c, x, 25, x - 3, 30, '#7a7068');
    for (let i = 0; i < 7; i++) {
      const y = 24 - ((t * 9 + i * 6) % 24), x = 6 + i * 5 + Math.sin(t * 3 + i) * 2;
      const up = Math.sin(t * 14 + i) > 0;
      p(c, x, y, D); p(c, x - 1, y - (up ? 1 : 0), D); p(c, x + 1, y - (up ? 1 : 0), D);
    }
  },
  cupSteam: (c, t) => {
    grad(c, '#6a5048', '#4a3a36');
    r(c, 0, 24, 44, 6, '#3a2c28');
    r(c, 16, 16, 10, 8, L); r(c, 17, 17, 8, 1, '#a89884');
    circ(c, 28, 19, 2, L, false);
    for (let s = 0; s < 3; s++) for (let k = 0; k < 9; k++) {
      const y = 14 - k - ((t * 6) % 2), x = 18 + s * 3 + Math.sin(t * 2 + k * 0.7 + s) * 1.5;
      p(c, x, y, `rgba(240,232,220,${0.6 - k * 0.06})`);
    }
  },
  tram: (c, t) => {
    grad(c, '#a0a6ae', '#7a7e86');
    r(c, 0, 3, 44, 1, D);
    const dx = Math.sin(t * 0.6) * 2;
    r(c, 8 + dx, 12, 28, 12, '#c8a050');
    for (let w = 0; w < 5; w++) r(c, 10 + dx + w * 5, 14, 4, 4, '#3a4048');
    line(c, 20 + dx, 12, 24 + dx, 4, D);
    r(c, 8 + dx, 23, 28, 1, '#6a5030');
    for (let x = 0; x < 44; x++) { p(c, x, 27 + Math.round(Math.sin(x / 9) * 0.8), M); p(c, x, 29 + Math.round(Math.sin(x / 9) * 0.8), M); }
  },
  dog: (c, t) => {
    grad(c, '#a8c0d0', '#c8d4c4');
    r(c, 0, 22, 44, 8, '#6a8a52');
    for (let x = 1; x < 44; x += 3) p(c, x, 21, '#5a7a42');
    const x = ((t * 10) % 54) - 8, leg = Math.sin(t * 14) > 0;
    r(c, x, 16, 10, 4, '#5a4030'); r(c, x + 9, 13, 4, 4, '#5a4030'); p(c, x + 10, 12, '#5a4030');
    line(c, x, 16, x - 2, 13, '#5a4030');
    r(c, x + (leg ? 1 : 2), 20, 1, 2, '#4a3020'); r(c, x + (leg ? 8 : 7), 20, 1, 2, '#4a3020');
  },
  seedlings: (c) => {
    grad(c, '#9ab0c4', '#c0ccd4');
    windowFrame(c, 2, 1, 40, 22, L); r(c, 21, 1, 2, 22, L);
    r(c, 0, 23, 44, 7, '#b8a890');
    for (let i = 0; i < 3; i++) {
      const x = 8 + i * 12;
      r(c, x, 18, 6, 5, '#a8643a');
      line(c, x + 3, 18, x + 3, 13, G); p(c, x + 2, 13, G); p(c, x + 4, 14, G); p(c, x + 1, 12, G); p(c, x + 5, 13, G);
    }
  },
  satellites: (c, t) => {
    grad(c, '#101428', '#1a2038');
    c.strokeStyle = 'rgba(160,170,200,0.15)';
    c.beginPath(); c.ellipse(22, 16, 20, 7, -0.2, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 26; i++) {
      const a = i * 0.7 + t * (0.1 + (i % 4) * 0.05);
      const x = 22 + Math.cos(a) * (8 + (i % 5) * 3), y = 15 + Math.sin(a) * (3 + (i % 3) * 3);
      p(c, x, y, i % 6 ? L : A);
    }
  },
  crowdUp: (c, t) => {
    grad(c, '#3a3048', '#5a4858');
    circ(c, 22, 4, 1, A); p(c, 22, 4, '#fff8e0');
    if (Math.sin(t * 4) > 0) { p(c, 20, 4, 'rgba(242,193,78,0.5)'); p(c, 24, 4, 'rgba(242,193,78,0.5)'); }
    for (let i = 0; i < 10; i++) {
      const x = 2 + i * 4.3, y = 22 + (i % 2) * 2;
      circ(c, x, y - 2, 1, '#2a2228');
      r(c, x - 1, y, 3, 8, '#2a2228');
    }
  },
  chalkHand: (c, t) => {
    grad(c, '#4c4c52', '#3e3e44');
    for (let i = 0; i < 30; i++) p(c, (i * 13) % 44, (i * 7) % 30, '#56565c');
    circ(c, 20, 14, 5, L, false);
    const rays = Math.min(8, Math.floor((t * 2.5) % 11));
    let ex = 20, ey = 14;
    for (let k = 0; k < rays; k++) {
      const a = (k / 8) * Math.PI * 2;
      ex = 20 + Math.cos(a) * 11; ey = 14 + Math.sin(a) * 9;
      line(c, 20 + Math.cos(a) * 7, 14 + Math.sin(a) * 6, ex, ey, L);
    }
    r(c, ex + 1, ey + 1, 5, 3, SKIN); r(c, ex, ey, 2, 1, '#f4f0e8');
  },
  ticker: (c, t) => {
    r(c, 0, 0, 44, 30, '#2a2830');
    windowFrame(c, 3, 4, 38, 22, M);
    r(c, 4, 5, 36, 20, '#0e1014');
    c.save(); c.beginPath(); c.rect(4, 5, 36, 20); c.clip();
    const off = (t * 14) % 60;
    for (let i = 0; i < 14; i++) r(c, 40 - off + i * 5 - (i % 3), 13, 2 + (i % 3), 3, i % 5 ? '#c8d0b0' : A);
    c.restore();
    for (let y = 5; y < 25; y += 2) r(c, 4, y, 36, 1, 'rgba(0,0,0,0.25)');
    if (Math.sin(t * 20) > 0.7) r(c, 4, 5 + ((t * 40) % 20), 36, 1, 'rgba(200,210,220,0.2)');
  },
  road: (c) => {
    grad(c, '#b8c0c8', '#d4ccbc');
    r(c, 0, 12, 44, 18, '#8a8e6a');
    for (let y = 12; y < 30; y++) {
      const k = (y - 12) / 18, hw = 1 + k * 17;
      r(c, 22 - hw, y, hw * 2, 1, '#5a5a60');
      if (y % 3 === 0) p(c, 22, y, L);
    }
    r(c, 0, 12, 44, 1, '#a8a890');
  },
  emptySquare: (c) => {
    grad(c, '#c4c8cc', '#d8d2c4');
    r(c, 0, 11, 44, 19, '#bab2a2');
    for (let i = -6; i <= 6; i++) line(c, 22 + i * 1.5, 11, 22 + i * 9, 30, 'rgba(120,110,100,0.35)');
    for (let k = 0, y = 12; y < 30; k++, y += 1 + k) r(c, 0, y, 44, 1, 'rgba(120,110,100,0.3)');
    r(c, 31, 7, 1, 4, M); p(c, 30, 7, M); p(c, 32, 7, M);
  },
  openWindow: (c, t) => {
    grad(c, '#c8d4dc', '#e0dccc');
    windowFrame(c, 6, 1, 32, 28, M);
    const s = Math.sin(t * 1.6), s2 = Math.sin(t * 1.3 + 1);
    for (let y = 2; y < 28; y++) {
      const wv = Math.sin(y * 0.4 + t * 2) * 1.2;
      r(c, 7, y, 7 + s * 2 + wv, 1, y % 4 ? L : '#c8bca8');
      r(c, 37 - (7 + s2 * 2 - wv), y, 7 + s2 * 2 - wv, 1, y % 4 ? L : '#c8bca8');
    }
  },
  capsule: (c, t) => {
    grad(c, '#b4c8d4', '#c8d0c0');
    r(c, 0, 18, 44, 12, '#7a6a4a');
    r(c, 18, 18, 8, 12, '#3a2e22');
    const y = 10 + Math.min(1, (t % 4) / 3) * 12;
    r(c, 19, y, 6, 9, '#a8acb4'); r(c, 19, y, 6, 1, '#d0d4dc'); p(c, 21, y + 3, A);
    figure(c, 7, 18, '#c86a4a', 6); figure(c, 12, 18, '#4a7ab0', 6); figure(c, 31, 18, '#e0b040', 6); figure(c, 36, 18, '#6a9a5a', 6);
  },
  festiveTable: (c) => {
    grad(c, '#5a3a32', '#3a2622');
    for (let i = 0; i < 9; i++) p(c, 3 + i * 5, 3 + (i % 2), A);
    r(c, 0, 22, 44, 8, '#e0d8c8');
    for (let i = 0; i < 3; i++) {
      const x = 11 + i * 10;
      line(c, x - 3, 10, x - 1, 16, L); line(c, x + 3, 10, x + 1, 16, L); r(c, x - 3, 10, 7, 1, L);
      r(c, x - 2, 12, 5, 3, 'rgba(180,60,60,0.7)');
      r(c, x, 16, 1, 5, L); r(c, x - 2, 21, 5, 1, L);
    }
  },
  handsRing: (c) => {
    grad(c, '#6a5048', '#5a403a');
    r(c, 2, 16, 18, 6, SKIN);
    for (let f = 0; f < 4; f++) r(c, 20, 15 + f * 2, 8 - Math.abs(f - 1.5), 1, SKIN);
    r(c, 30, 10, 12, 6, '#b8988a');
    r(c, 26, 12, 4, 2, '#b8988a');
    circ(c, 27, 17, 1, A, false);
  },
  oldPhoto: (c) => {
    r(c, 0, 0, 44, 30, '#4a3a2e');
    r(c, 6, 2, 32, 26, '#8a6a48'); r(c, 8, 4, 28, 22, '#c0a682');
    for (let i = 0; i < 40; i++) p(c, 8 + (i * 11) % 28, 4 + (i * 7) % 22, 'rgba(120,90,60,0.25)');
    figure(c, 17, 24, '#5a4030', 12); figure(c, 26, 24, '#5a4030', 13);
    circ(c, 17, 13, 2, '#5a4030'); circ(c, 26, 12, 2, '#5a4030');
  },
  nightKitchen: (c, t) => {
    grad(c, '#1a1e2c', '#14161e');
    windowFrame(c, 4, 3, 16, 14, '#3a3e4c');
    circ(c, 15, 7, 2, '#d8dce8');
    r(c, 0, 22, 44, 1, '#3a3e4c'); r(c, 0, 23, 44, 7, '#20232e');
    r(c, 20, 18, 5, 4, L); circ(c, 26, 20, 1, L, false);
    r(c, 34, 6, 6, 2, M); r(c, 34, 8, 2, 3, M);
    const dy = (t * 9) % 14;
    p(c, 34, 11 + dy, '#9ab8d8');
  },
  entranceDoor: (c) => {
    r(c, 0, 0, 44, 30, '#6a6068');
    for (let y = 2; y < 30; y += 4) r(c, 0, y, 44, 1, '#5e555c');
    r(c, 14, 8, 14, 22, '#2a2a32'); r(c, 26, 18, 1, 2, L);
    r(c, 31, 14, 5, 7, '#3a3a42'); for (let i = 0; i < 6; i++) p(c, 32 + (i % 2) * 2, 15 + Math.floor(i / 2) * 2, L);
    circ(c, 21, 4, 2, A); c.fillStyle = 'rgba(242,193,78,0.15)'; c.fillRect(12, 6, 18, 4);
  },
  stairsLight: (c) => {
    r(c, 0, 0, 44, 30, '#1e1c22');
    c.fillStyle = 'rgba(242,193,78,0.18)';
    c.beginPath(); c.moveTo(30, 2); c.lineTo(20, 14); c.lineTo(42, 14); c.fill();
    p(c, 30, 2, A);
    for (let k = 0; k < 6; k++) { r(c, 4 + k * 4, 26 - k * 3, 4, 1, M); r(c, 8 + k * 4, 26 - k * 3, 1, 3, M); }
    r(c, 28, 14, 16, 1, L);
  },
  yardSandbox: (c) => {
    grad(c, '#b0c8d8', '#c8d0b8');
    r(c, 0, 20, 44, 10, '#7a9a5a');
    r(c, 14, 21, 16, 6, '#c8a868'); windowFrame(c, 13, 20, 18, 8, '#8a6a3a');
    line(c, 20, 23, 23, 25, '#c84a3a');
    r(c, 5, 12, 2, 9, '#5a4030'); circ(c, 6, 9, 4, '#5a8a42');
    line(c, 34, 20, 37, 10, M); line(c, 40, 20, 37, 10, M); line(c, 36, 11, 36, 17, D); r(c, 35, 17, 3, 1, D);
  },
  keyLight: (c) => {
    r(c, 0, 0, 44, 30, '#2a2630');
    r(c, 12, 2, 20, 28, '#4a3e38');
    c.fillStyle = 'rgba(255,236,180,0.9)';
    c.beginPath(); c.moveTo(30, 2); c.lineTo(34, 2); c.lineTo(38, 30); c.lineTo(30, 30); c.fill();
    c.fillStyle = 'rgba(242,193,78,0.2)';
    c.beginPath(); c.moveTo(34, 30); c.lineTo(44, 30); c.lineTo(44, 18); c.fill();
    r(c, 26, 15, 3, 1, L); r(c, 25, 14, 1, 3, L);
  },
  curtainedRoom: (c, t) => {
    r(c, 0, 0, 44, 30, '#241f28');
    for (let x = 4; x < 40; x++) r(c, x, 2, 1, 18, x % 3 ? '#3a3040' : '#2e2634');
    r(c, 0, 22, 44, 1, '#4a4050');
    r(c, 16, 14, 12, 8, '#1a1a22'); r(c, 17, 15, 10, 6, `rgba(140,170,210,${0.6 + 0.1 * Math.sin(t * 3)})`);
    r(c, 21, 22, 2, 2, '#4a4050');
  },
  eveningCity: (c) => {
    grad(c, '#3a3050', '#c07050');
    const hs = [12, 8, 16, 10, 20, 7, 14, 11];
    for (let i = 0; i < hs.length; i++) {
      const x = i * 5.5, h = hs[i];
      r(c, x, 30 - h, 5, h, '#2a2838');
      for (let k = 0; k < h - 2; k += 2) if ((i * 7 + k) % 3 === 0) p(c, x + 1 + (k % 3), 30 - h + k + 1, A);
    }
    windowFrame(c, 0, 0, 44, 30, '#1a1820'); r(c, 21, 0, 2, 30, '#1a1820');
  },
  bedLight: (c) => {
    r(c, 0, 0, 44, 30, '#1e1a22');
    r(c, 2, 18, 40, 8, '#3a3240');
    for (let x = 2; x < 42; x++) p(c, x, 17 + Math.round(Math.sin(x * 0.6) * 1.2 + Math.sin(x * 0.23) * 1.5), '#8a7e90');
    r(c, 4, 15, 8, 3, '#9a8ea0');
    c.fillStyle = 'rgba(242,210,140,0.3)';
    c.beginPath(); c.moveTo(18, 0); c.lineTo(24, 0); c.lineTo(36, 30); c.lineTo(30, 30); c.fill();
  },
  quietCity: (c) => {
    grad(c, '#c8d0d8', '#dcd8cc');
    const hs = [10, 14, 8, 18, 12, 9, 15];
    for (let i = 0; i < hs.length; i++) r(c, i * 6.5, 30 - hs[i], 6, hs[i], '#9a9aa0');
    windowFrame(c, 0, 0, 44, 30, M);
    line(c, 22, 0, 30, 6, M); line(c, 30, 6, 30, 30, M);
  },
};

/** Render an echo picture with soft, faded edges into a canvas of EW×EH. */
export function renderEcho(target: HTMLCanvasElement, picture: string, t: number): void {
  const c = target.getContext('2d')!;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, EW, EH);
  (ECHO_PICTURES[picture] ?? ECHO_PICTURES.road)(c, t);
  // memory tint: a warm, faded wash
  c.fillStyle = 'rgba(210,190,160,0.18)';
  c.fillRect(0, 0, EW, EH);
  c.globalCompositeOperation = 'destination-in';
  const g = c.createRadialGradient(EW / 2, EH / 2, 6, EW / 2, EH / 2, EW * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.85)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, EW, EH);
  c.globalCompositeOperation = 'source-over';
}
