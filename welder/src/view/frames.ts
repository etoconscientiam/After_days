/**
 * Pixel squircle frames for every plate and button of the interface: a 9-slice image drawn pixel by pixel
 * (dark outline, a two-pixel rim, an inner bevel lit from above, the fill), set as CSS variables and used as
 * border-image. Big frames (slice 7) for panels and sheets, small ones (slice 5) for labels and keys.
 */
interface Pal {
  out: string;
  rim: string;
  hi: string;
  lo: string;
  fill: string;
}

function frame(p: Pal, big: boolean): string {
  const slice = big ? 7 : 5;
  const S = slice * 2 + 2;
  // How far in the shape starts on each row of a corner (a superellipse, not a circle: flatter sides).
  const corner = big ? [4, 2, 1, 1, 0, 0, 0] : [2, 1, 0, 0, 0];
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return false;
    const cx = Math.min(x, S - 1 - x), cy = Math.min(y, S - 1 - y);
    return cy >= corner.length || cx >= corner[cy];
  };
  // Distance in pixels from the outside (1 = the outline).
  const d = new Int32Array(S * S);
  const q: number[] = [];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        d[y * S + x] = 1;
        q.push(x, y);
      }
    }
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i], y = q[i + 1], v = d[y * S + x];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || d[ny * S + nx]) continue;
      d[ny * S + nx] = v + 1;
      q.push(nx, ny);
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x2 = c.getContext('2d')!;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = d[y * S + x];
      if (!v) continue;
      x2.fillStyle = v === 1 ? p.out : v <= 3 ? p.rim : v === 4 ? (y < S / 2 ? p.hi : p.lo) : p.fill;
      x2.fillRect(x, y, 1, 1);
    }
  return `url(${c.toDataURL()})`;
}

const PALS: Record<string, Pal> = {
  panel: { out: '#050302', rim: '#8a6638', hi: '#4a3620', lo: '#1a1208', fill: 'rgba(22, 15, 9, 0.94)' },
  paper: { out: '#140c06', rim: '#5a3e22', hi: '#f0e4c4', lo: '#a8946c', fill: '#d4c49c' },
  btn: { out: '#050302', rim: '#c8944a', hi: '#6a4a28', lo: '#24180c', fill: '#3a2816' },
  hot: { out: '#050302', rim: '#ffd27a', hi: '#8a6a38', lo: '#3a2810', fill: '#5a3e1e' },
  dark: { out: '#050302', rim: '#2a2016', hi: '#1a140c', lo: '#0a0704', fill: '#140e08' },
  key: { out: '#050302', rim: '#e0cfa8', hi: '#4a3a28', lo: '#120c06', fill: '#2a1e12' },
  good: { out: '#050302', rim: '#9ad070', hi: '#2a3a1c', lo: '#0c1208', fill: 'rgba(14, 18, 9, 0.85)' },
  bad: { out: '#050302', rim: '#e0603a', hi: '#3a1a10', lo: '#120806', fill: 'rgba(20, 10, 7, 0.85)' },
  gold: { out: '#050302', rim: '#f0c860', hi: '#4a3a18', lo: '#140e06', fill: 'rgba(20, 15, 8, 0.9)' },
};

/** Draw every frame once and publish them as CSS variables (--sq-<name>-l / --sq-<name>-s). */
export function installFrames(root: HTMLElement = document.documentElement): void {
  for (const [name, p] of Object.entries(PALS)) {
    root.style.setProperty(`--sq-${name}-l`, frame(p, true));
    root.style.setProperty(`--sq-${name}-s`, frame(p, false));
  }
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
