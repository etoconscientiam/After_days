/**
 * Pixel squircles for every plate and button of the interface. Each framed element gets its own picture,
 * drawn at its own size in whole screen pixels ("frame pixels", the same size as the scene's pixels): a
 * superellipse (|x|^3 + |y|^3 = 1 in the corners: at these few pixels power 4 reads as a bevel) whose corner radius is half the short side for buttons,
 * keys and labels (they are true squircles end to end) and a big soft corner for panels and sheets.
 * Dark outline, a rim, an inner bevel lit from above, the fill. Redrawn when the element changes size or
 * class; pictures are cached by size and palette.
 */
interface Pal {
  out: string;
  rim: string;
  hi: string;
  lo: string;
  fill: string;
}

const PALS: Record<string, Pal> = {
  panel: { out: '#050302', rim: '#8a6638', hi: '#4a3620', lo: '#1a1208', fill: 'rgba(22, 15, 9, 0.94)' },
  paper: { out: '#140c06', rim: '#5a3e22', hi: '#f0e4c4', lo: '#a8946c', fill: '#d4c49c' },
  btn: { out: '#050302', rim: '#c8944a', hi: '#6a4a28', lo: '#24180c', fill: '#3a2816' },
  hot: { out: '#050302', rim: '#ffd27a', hi: '#8a6a38', lo: '#3a2810', fill: '#5a3e1e' },
  dark: { out: '#050302', rim: '#3a2e20', hi: '#2a2016', lo: '#0a0704', fill: '#140e08' },
  key: { out: '#050302', rim: '#e0cfa8', hi: '#4a3a28', lo: '#120c06', fill: '#2a1e12' },
  good: { out: '#050302', rim: '#9ad070', hi: '#2a3a1c', lo: '#0c1208', fill: 'rgba(14, 18, 9, 0.9)' },
  bad: { out: '#050302', rim: '#e0603a', hi: '#3a1a10', lo: '#120806', fill: 'rgba(20, 10, 7, 0.9)' },
  gold: { out: '#050302', rim: '#f0c860', hi: '#4a3a18', lo: '#140e06', fill: 'rgba(20, 15, 8, 0.92)' },
};

/** Which frame each element wears: [selector, palette, palette on hover, big]. The last matching rule wins. */
type Rule = [string, string, string | null, boolean];
const RULES: Rule[] = [
  ['#tip, .toast, #app-status, #rod', 'panel', null, false],
  ['#rod.low', 'bad', null, false],
  ['#tour', 'gold', null, false],
  ['#stages, #craft, #board, #end .panel', 'panel', null, true],
  ['#money, #job, #craft .item, #board .card', 'paper', null, true],
  ['#craft .item.owned', 'good', null, true],
  ['#stamp', 'gold', null, true],
  ['#stamp.bad', 'bad', null, true],
  ['#craft-btn, #lang-btn, #craft .buy, #job .take, #start .go, #end .go', 'btn', 'hot', false],
  ['#craft-btn.glow', 'hot', null, false],
  ['#job .later, #board .close, #craft .close, #start .links span', 'dark', 'btn', false],
  ['#ctrl .k', 'key', null, false],
];
const ALL = RULES.map((r) => r[0]).join(', ');

const cache = new Map<string, string>();

function draw(p: Pal, W: number, H: number, big: boolean): string {
  const key = `${W}x${H}:${big}:${p.rim}${p.fill}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Corner radius in frame pixels; the corner follows a superellipse of power 3 (a squircle).
  const R = Math.max(2, big ? Math.min(12, Math.floor(Math.min(W, H) / 2)) : Math.floor(Math.min(W, H) / 2));
  const inset = new Int32Array(R);
  for (let i = 0; i < R; i++) {
    const dy = (R - i - 0.5) / R;
    inset[i] = Math.round(R - R * Math.pow(1 - Math.pow(dy, 3), 1 / 3));
  }
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const cy = Math.min(y, H - 1 - y), cx = Math.min(x, W - 1 - x);
    if (cy >= R || cx >= R) return true;
    // In a corner square: both the row's and the column's inset must clear (keeps the curve symmetric).
    return cx >= inset[cy] && cy >= inset[cx];
  };
  // Distance in pixels from the outside (1 = the outline).
  const d = new Int32Array(W * H);
  const q: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        d[y * W + x] = 1;
        q.push(x, y);
      }
    }
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i], y = q[i + 1], v = d[y * W + x];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || d[ny * W + nx]) continue;
      d[ny * W + nx] = v + 1;
      q.push(nx, ny);
    }
  }
  const rim = big ? 3 : 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x2 = c.getContext('2d')!;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = d[y * W + x];
      if (!v) continue;
      x2.fillStyle = v === 1 ? p.out : v <= rim ? p.rim : v === rim + 1 ? (y < H / 2 ? p.hi : p.lo) : p.fill;
      x2.fillRect(x, y, 1, 1);
    }
  const url = `url(${c.toDataURL()})`;
  cache.set(key, url);
  return url;
}

let unit = 2;
const sized = new WeakMap<HTMLElement, string>();

function paint(el: HTMLElement): void {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  let rule: Rule | null = null;
  for (const r of RULES) if (el.matches(r[0])) rule = r;
  if (!rule) return;
  const W = Math.max(4, Math.round(w / unit)), H = Math.max(4, Math.round(h / unit));
  const stamp = `${W}x${H}:${rule[1]}:${rule[2]}:${unit}`;
  if (sized.get(el) === stamp) return;
  sized.set(el, stamp);
  el.dataset.sq = '';
  el.style.setProperty('--sqn', draw(PALS[rule[1]], W, H, rule[3]));
  if (rule[2]) el.style.setProperty('--sqh', draw(PALS[rule[2]], W, H, rule[3]));
  else el.style.removeProperty('--sqh');
  el.classList.toggle('sq-hov', !!rule[2]);
}

const ro = new ResizeObserver((es) => {
  for (const e of es) paint(e.target as HTMLElement);
});
const seen = new WeakSet<Element>();
function adopt(el: Element): void {
  if (seen.has(el)) return;
  seen.add(el);
  ro.observe(el);
  paint(el as HTMLElement);
}
function scan(root: ParentNode): void {
  if (root instanceof Element && root.matches(ALL)) adopt(root);
  root.querySelectorAll(ALL).forEach(adopt);
}

/** Start framing: everything that matches now, and whatever appears or changes class later. */
export function installFrames(): void {
  scan(document);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'attributes') {
        const el = m.target as HTMLElement;
        if (el.matches(ALL)) {
          adopt(el);
          paint(el);
        }
      } else m.addedNodes.forEach((n) => n instanceof Element && scan(n));
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

/** Frame pixel size in screen pixels: whole pixels only, a bit finer than the scene's so the curves read. */
export function setFrameUnit(px: number): void {
  const u = Math.max(2, Math.round(px * 0.7));
  if (u === unit) return;
  unit = u;
  document.documentElement.style.setProperty('--fu', u + 'px');
  document.querySelectorAll<HTMLElement>('[data-sq]').forEach(paint);
}

/**
 * Pixel cursors in the game's style, for wherever the system cursor would show (over windows and buttons):
 * an arrow in cream, and the same arrow in gold over things you can press. Drawn at 2x, hot spot at the tip.
 */
const ARROW = [
  'X..........',
  'XX.........',
  'XoX........',
  'XooX.......',
  'XoooX......',
  'XooooX.....',
  'XoooooX....',
  'XooooooX...',
  'XoooooooX..',
  'XooooooooX.',
  'XoooooXXXXX',
  'XooXooX....',
  'XoX.XooX...',
  'XX..XooX...',
  'X....XooX..',
  '.....XXXX..',
];

function cursor(fill: string, shade: string, k = 2): string {
  const w = ARROW[0].length, h = ARROW.length;
  const c = document.createElement('canvas');
  c.width = w * k;
  c.height = h * k;
  const x = c.getContext('2d')!;
  for (let y = 0; y < h; y++)
    for (let i = 0; i < w; i++) {
      const ch = ARROW[y][i];
      if (ch === '.') continue;
      // Outline dark; fill lit on the left edge, shaded toward the right.
      x.fillStyle = ch === 'X' ? '#0a0604' : i <= 2 ? fill : i > 5 ? shade : fill;
      x.fillRect(i * k, y * k, k, k);
    }
  return `url(${c.toDataURL()}) 0 0`;
}

export function installCursors(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--cur', `${cursor('#f0e0b8', '#b8a07a')}, default`);
  root.style.setProperty('--cur-hot', `${cursor('#ffd27a', '#c8944a')}, pointer`);
}
