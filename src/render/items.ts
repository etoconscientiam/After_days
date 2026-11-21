// The three things (artifact_a/b/c) and the small relics of the old world, rasterised pixel by pixel.
// Placeholder art: shapes are plain and neutral, drawn the same way as any other object.
import { drawPattern } from './skins';

type Shape = (u: number, v: number) => number; // 0 = empty, 1 = body, 2 = detail

const SHAPES: Record<string, Shape> = {
  // a band with a small stone on top
  ring: (u, v) => {
    const r = Math.hypot(u, v - 0.12);
    if (Math.hypot(u, v + 0.78) < 0.16) return 2;
    return r > 0.5 && r < 0.72 ? 1 : 0;
  },
  // bow, shaft, teeth
  key: (u, v) => {
    const r = Math.hypot(u, v + 0.55);
    if (r < 0.38 && r > 0.17) return 1;
    if (Math.abs(u) < 0.09 && v > -0.2 && v < 0.88) return 1;
    if (u > 0.08 && u < 0.3 && ((v > 0.52 && v < 0.63) || (v > 0.72 && v < 0.83))) return 1;
    return 0;
  },
  // a handle and a round head
  wand: (u, v) => {
    if (Math.hypot(u, v + 0.58) < 0.33) return 1;
    if (Math.abs(u) < 0.13 && v > -0.32 && v < -0.18) return 1;
    if (Math.abs(u) < 0.2 && v > -0.2 && v < 0.82) return Math.hypot(u, v - 0.25) < 0.06 ? 2 : 1;
    if (Math.hypot(u, v - 0.82) < 0.2) return 1;
    return 0;
  },
};

const ITEM_SHAPE: Record<string, string> = { artifact_a: 'ring', artifact_b: 'key', artifact_c: 'wand' };

export type ItemStyle = 'silhouette' | 'hover' | 'glow';
const cache = new Map<string, HTMLCanvasElement>();

/**
 * Rasterise a thing. size = box in px. lying: rotated to lie in the ground. part: 0..2 draws only one third (a shard).
 */
export function itemCanvas(id: string, size: number, style: ItemStyle, lying = false, part = -1): HTMLCanvasElement {
  const key = `${id}|${size}|${style}|${lying}|${part}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d')!;
  const shape = SHAPES[ITEM_SHAPE[id] ?? 'ring'];
  const inside = (px: number, py: number) => {
    let u = ((px + 0.5) / size) * 2 - 1, v = ((py + 0.5) / size) * 2 - 1;
    if (lying) {
      if (ITEM_SHAPE[id] === 'ring') v *= 2.6; // a ring lying flat is a thin ellipse
      else { const t = u; u = v; v = -t; }
    }
    if (part >= 0) {
      const third = Math.floor(((lying ? -v : u) + 1) / (2 / 3));
      if (Math.min(2, third) !== part) return 0;
    }
    return shape(u, v);
  };
  const pal = style === 'glow'
    ? { body: '#c89040', rim: '#fff0c0', detail: '#8a5a20', edge: '#7a5020' }
    : style === 'hover'
      ? { body: '#4a3e34', rim: '#f2c14e', detail: '#2a2420', edge: '#2a2420' }
      : { body: '#2c2830', rim: '#6a6070', detail: '#1a181e', edge: '#1a181e' };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const k = inside(px, py);
      if (!k) continue;
      const rim = !inside(px - 1, py - 1);
      const edge = !inside(px + 1, py + 1);
      x.fillStyle = k === 2 ? pal.detail : rim ? pal.rim : edge ? pal.edge : pal.body;
      x.fillRect(px, py, 1, 1);
    }
  }
  cache.set(key, c);
  return c;
}

export function drawItem(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, size: number, style: ItemStyle, lying = false, part = -1, scale = 1): void {
  const c = itemCanvas(id, size, style, lying, part);
  const w = size * scale;
  ctx.drawImage(c, Math.round(cx - w / 2), Math.round(cy - w / 2), w, w);
}

const RELICS: Record<string, [string[], Record<string, string>]> = {
  coin: [['  aaa  ', ' abbba ', 'abbcbba', 'abcccba', 'abbcbba', ' abbba ', '  aaa  '], { a: '#8a7240', b: '#b8984a', c: '#d8bc6a' }],
  fork: [['a a a', 'a a a', 'a a a', 'aaaaa', ' aaa ', '  a  ', '  a  ', '  a  ', '  a  ', '  a  '], { a: '#9aa0a8' }],
  tile: [['aaaaaaa', 'abbcbba', 'abcccba', 'acc ccа', 'abcccba', 'abbcbba', 'aaaaaaa'].map((r) => r.replace('а', 'a')), { a: '#7a6a58', b: '#c8b8a0', c: '#4a7a9a' }],
  glasses: [[' aaa   aaa ', 'a   a a   a', 'a   aaa   a', 'a   a a   a', ' aaa   aaa '], { a: '#3a3438' }],
  chip: [['a a a a a', 'bbbbbbbbb', 'bcccccccb', 'bcbcbcbcb', 'bcccccccb', 'bbbbbbbbb', 'a a a a a'], { a: '#a8a8a0', b: '#2a3a2a', c: '#3a5a3a' }],
  button: [[' aaaa ', 'abbbba', 'ab bba', 'abb ba', 'abbbba', ' aaaa '], { a: '#6a4a5a', b: '#9a6a82' }],
};

export function drawRelic(ctx: CanvasRenderingContext2D, id: string, x: number, y: number): void {
  const r = RELICS[id];
  if (!r) return;
  drawPattern(ctx, Math.round(x - r[0][0].length / 2), Math.round(y - r[0].length / 2), r[0], r[1]);
}

export function relicIcon(id: string, have: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 12; cv.height = 12;
  const c = cv.getContext('2d')!;
  c.fillStyle = have ? '#241f1a' : '#141210';
  c.fillRect(0, 0, 12, 12);
  if (have) drawRelic(c, id, 6, 6);
  else { c.fillStyle = '#2a2622'; c.fillRect(4, 4, 4, 4); }
  return cv;
}
