// Placeholder skins: tiny procedural pixel sprites. Swap this file (or register new skins) to replace art without touching logic.
export type Ctx = CanvasRenderingContext2D;

export interface SpriteOpts { t: number; i: number; season: number; tint?: string; flip?: boolean; scale?: number }
export type SkinFn = (c: Ctx, x: number, y: number, o: SpriteOpts) => void;

function px(c: Ctx, x: number, y: number, w = 1, h = 1) { c.fillRect(Math.round(x), Math.round(y), w, h); }

/** Draw a sprite from rows of chars; each char maps to a color (space = transparent). */
export function drawPattern(c: Ctx, x: number, y: number, rows: string[], colors: Record<string, string>, flip = false): void {
  const w = rows[0].length;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let k = 0; k < row.length; k++) {
      const ch = row[k];
      if (ch === ' ') continue;
      c.fillStyle = colors[ch];
      px(c, x + (flip ? w - 1 - k : k), y + r);
    }
  }
}

const seasonLeaf = (s: number) => {
  // 0 spring, 1 summer, 2 autumn, 3 winter
  const t = s * 4;
  if (t < 1) return ['#5f9a3a', '#7fb84a'];
  if (t < 2) return ['#3f7a2a', '#5a9a38'];
  if (t < 3) return ['#b8742a', '#d89a3a'];
  return ['#6a6a5a', '#8a8a7a'];
};

export const SKINS: Record<string, SkinFn> = {
  mat: (c, x, y, o) => {
    c.fillStyle = (o.i & 1) ? '#5a7a3a' : '#6a8a42';
    px(c, x, y, 3 + (o.i % 3), 1);
    c.fillStyle = '#7a9a52';
    px(c, x + 1, y - 1, 1, 1);
  },
  plankton: (c, x, y, o) => {
    c.fillStyle = (o.i % 3) ? 'rgba(170,220,200,0.8)' : 'rgba(220,240,190,0.9)';
    px(c, x + Math.sin(o.t * 0.7 + o.i) * 3, y + Math.cos(o.t * 0.5 + o.i * 1.3) * 2);
  },
  mollusc: (c, x, y, o) => drawPattern(c, x, y - 2, [' aa', 'aba', 'aa '], { a: '#d8c8a8', b: '#9a8a6a' }, o.flip),
  fish: (c, x, y, o) => {
    const dx = Math.sin(o.t * 0.4 + o.i * 2.1) * 30;
    const flip = Math.cos(o.t * 0.4 + o.i * 2.1) < 0;
    drawPattern(c, x + dx, y + Math.sin(o.t * 1.3 + o.i) * 1.5, [' bb ', 'bbbbt', ' bb '], { b: '#8ab0c8', t: '#6a90a8' }, flip);
  },
  moss: (c, x, y, o) => {
    const [a, b] = seasonLeaf(o.season);
    c.fillStyle = a; px(c, x, y - 1, 3, 1);
    c.fillStyle = b; px(c, x + 1, y - 2, 1, 1);
    if (o.i % 2) { c.fillStyle = '#4a7a3a'; px(c, x + 2, y - 3, 1, 2); }
  },
  tree: (c, x, y, o) => {
    const h = 9 + (o.i * 7) % 7;
    const sway = Math.sin(o.t * 0.8 + o.i) * 0.6;
    c.fillStyle = '#4a3424';
    px(c, x, y - h, 1, h);
    const [a, b] = seasonLeaf(o.season);
    const winter = o.season > 0.75;
    if (winter) {
      c.fillStyle = '#5a4434';
      px(c, x - 2, y - h + 2, 2, 1); px(c, x + 1, y - h + 3, 2, 1);
      c.fillStyle = 'rgba(240,240,250,0.8)'; px(c, x - 1, y - h - 1, 3, 1);
      return;
    }
    const r = 3 + (o.i % 3);
    for (let dy = -r; dy <= r; dy++) {
      const ww = Math.round(Math.sqrt(r * r - dy * dy) * 1.1);
      c.fillStyle = dy < 0 ? b : a;
      px(c, x - ww + sway, y - h + dy, ww * 2 + 1, 1);
    }
  },
  insect: (c, x, y, o) => {
    if (((o.t * 6 + o.i) | 0) % 3 === 0) return;
    c.fillStyle = '#e8e0a0';
    px(c, x + Math.sin(o.t * 5 + o.i) * 4, y - 4 + Math.cos(o.t * 7 + o.i) * 3);
  },
  bird: (c, x, y, o) => {
    const flap = Math.sin(o.t * 10 + o.i) > 0;
    c.fillStyle = '#2a2a32';
    if (flap) { px(c, x - 1, y - 1); px(c, x, y); px(c, x + 1, y - 1); }
    else { px(c, x - 1, y); px(c, x, y); px(c, x + 1, y); }
  },
  herd: (c, x, y, o) => {
    const step = Math.sin(o.t * 3 + o.i) > 0 ? 0 : 1;
    drawPattern(c, x, y - 4, [' hhhh ', 'hhhhhhe', 'hhhhhh ', step ? 'l  l l' : ' l  l '], { h: '#8a6a4a', e: '#6a4a2a', l: '#4a3a2a' }, o.flip);
  },
  predator: (c, x, y, o) => {
    const step = Math.sin(o.t * 4 + o.i) > 0 ? 0 : 1;
    drawPattern(c, x, y - 4, ['    ee', 'pppppp', 'ppppp ', step ? 'l l l ' : ' l l l'], { p: '#4a4a52', e: '#6a6a72', l: '#2a2a32' }, o.flip);
  },
  hominid: (c, x, y, o) => {
    const step = Math.sin(o.t * 3 + o.i) > 0;
    const tint = o.tint ?? '#c8a070';
    drawPattern(c, x, y - 6, [' h ', 'bbb', ' b ', ' b ', step ? 'l l' : ' l ', step ? 'l l' : ' l '], { h: tint, b: tint, l: '#3a2a1a' }, o.flip);
  },
  tribe: (c, x, y, o) => {
    const step = Math.sin(o.t * 2 + o.i) > 0;
    drawPattern(c, x, y - 6, [' h ', 'bbb', 'bbb', ' b ', step ? 'l l' : ' l ', step ? 'l l' : ' l '], { h: '#d8b080', b: '#8a5a3a', l: '#3a2a1a' }, o.flip);
  },
  glow: (c, x, y, o) => {
    c.fillStyle = `rgba(120,255,190,${0.5 + 0.5 * Math.sin(o.t * 3 + o.i)})`;
    px(c, x, y);
  },
};

/** Fossil sprites drawn into the section (8–12 px). */
export function drawFossil(c: Ctx, x: number, y: number, kind: string, rare: boolean, t: number): void {
  const col = rare ? '#fff4c8' : '#e8dcc0';
  const shadow = rare ? '#c8a050' : '#8a8068';
  const P: Record<string, string[]> = {
    shell: [' sss ', 's  ss', 's s s', 's   s', ' sss '],
    fish: ['  s   ', 's sss s', ' sssss ', 's sss s', '  s   '],
    bone: ['s    s', ' ssss ', 's    s'],
    skull: [' sss ', 's s s', 'sssss', ' s s '],
    leaf: ['  s ', ' sss', 'ssss', ' ss ', 's   '],
  };
  const rows = P[kind] ?? P.bone;
  const ox = x - (rows[0].length >> 1), oy = y - (rows.length >> 1);
  drawPattern(c, ox + 1, oy + 1, rows, { s: shadow });
  drawPattern(c, ox, oy, rows, { s: col });
  if (rare && Math.sin(t * 3 + x) > 0.6) {
    c.fillStyle = 'rgba(255,240,200,0.9)';
    c.fillRect(ox + rows[0].length, oy - 1, 1, 1);
  }
}

export function fossilKind(speciesId: string): string {
  switch (speciesId) {
    case 'molluscs': return 'shell';
    case 'fish': return 'fish';
    case 'fossor': case 'vigil': case 'litoralis': case 'lapis': case 'tribe': return 'skull';
    case 'trees': case 'mosses': return 'leaf';
    default: return 'bone';
  }
}

/** The artifact: a faceted warm object. Its nature is never shown clearly. */
export function drawArtifact(c: Ctx, x: number, y: number, t: number, glow: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
  const rows = ['  aaaa  ', ' abbbba ', 'abccccba', 'abcddcba', 'abccccba', ' abbbba ', '  aaaa  '];
  const k = glow * (0.7 + 0.3 * pulse);
  const cols = {
    a: `rgb(${120 + 40 * k},${84 + 30 * k},${40 + 10 * k})`,
    b: `rgb(${190 + 40 * k},${140 + 40 * k},${60 + 20 * k})`,
    c: `rgb(242,${193 + 30 * pulse},${78 + 60 * pulse})`,
    d: '#fff6d8',
  };
  drawPattern(c, x - 4, y - 3, rows, cols);
}
