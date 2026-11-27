import { Raster, dither } from './raster';
import type { ShopKind } from '../../data/estate';

/**
 * The estate's pixel art, drawn in code in the game's own look (the intro's pictures): a winter valley at
 * dusk — snow over frozen earth, dark spruce, a slate-blue river; log houses with the gable to the road,
 * carved barge boards and a horse-head ridge, slate or shingle roofs under snow, windows warm against the
 * blue; smoke, a turning water wheel, the town's stone wall with its gate and the market under striped
 * awnings. Buildings are drawn in an oblique 3/4 view (depth goes up and to the right).
 */

export const P = {
  ink: '#16110f',
  inkSoft: '#2a2024',
  snow: '#e6ecf2',
  snowL: '#f6f8fa',
  snowS: '#bcc8d6',
  snowD: '#8e9cb2',
  earth: '#5e4e40',
  earthD: '#463a30',
  grass: '#6e6c46',
  grassD: '#54543a',
  road: '#8c7658',
  roadD: '#6c5a44',
  roadL: '#a8926e',
  water: '#2e4862',
  waterM: '#3a5c7c',
  waterL: '#6f94b2',
  ice: '#a6bed2',
  logL: '#8a5c3a',
  log: '#6c4429',
  logD: '#4a2e1c',
  logEnd: '#b08860',
  plank: '#9c7448',
  plankD: '#7a5636',
  carve: '#d8c4a0',
  stone: '#7c7c84',
  stoneL: '#9c9ca4',
  stoneD: '#55555e',
  slate: '#4a5468',
  slateL: '#5e6a82',
  slateD: '#333a4a',
  shingle: '#6a5038',
  shingleL: '#846648',
  shingleD: '#4c3828',
  glow: '#ffc860',
  glowD: '#e08a30',
  fire: '#ff7a28',
  fireL: '#ffd878',
  copper: '#c87a40',
  copperL: '#e8a868',
  relic: '#5ad0e0',
  relicL: '#b8f4fa',
  red: '#a8402a',
  redD: '#7a2a1c',
  cream: '#e8dcc0',
  spruce: '#2e4434',
  spruceD: '#1e3026',
  spruceL: '#3e5a42',
  birch: '#d8d2c4',
  skin: '#d8a582',
  coat: '#5a4a6a',
  coatD: '#3e3250',
  horse: '#6a4a30',
  horseD: '#4a3220',
  gold: '#e8b040',
  goldD: '#a87020',
  night: '#101830',
};

/** The direction depth goes on screen (per unit of depth). */
const OX = 0.5, OY = -0.55;

export interface HouseOpts {
  /** Front left corner on the ground (screen px), front width, depth, wall height, roof rise. */
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  rise: number;
  wall: 'log' | 'stone' | 'plank';
  roof: 'slate' | 'shingle';
  /** Windows in the front wall (lit at night), a door, a chimney, the carved horse on the ridge. */
  windows: number;
  door?: boolean;
  chimney?: boolean;
  horse?: boolean;
  /** A second storey: an upper row of windows. */
  tall?: boolean;
  /** How lit the windows are (0 dark .. 1), and their colour. */
  lit: number;
  litColor?: string;
}

/** Where the lit windows and the chimney top of the last house drawn are (for glows and smoke). */
export interface HouseMarks {
  windows: [number, number][];
  chimney: [number, number] | null;
}

/**
 * A log house with its gable to the road, in the oblique view: the side wall, the roof slope under snow,
 * the front wall with windows in carved frames and a door, the gable boards, the barge boards and ridge.
 */
export function house(r: Raster, o: HouseOpts): HouseMarks {
  const { x, y, w, d, h, rise } = o;
  const dx = d * OX, dy = d * OY;
  const marks: HouseMarks = { windows: [], chimney: null };
  const wallC = o.wall === 'stone' ? [P.stoneL, P.stone, P.stoneD] : o.wall === 'plank' ? [P.plank, P.plank, P.plankD] : [P.logL, P.log, P.logD];
  const roofC = o.roof === 'slate' ? [P.slateL, P.slate, P.slateD] : [P.shingleL, P.shingle, P.shingleD];
  // Shadow on the snow, behind and to the right.
  r.poly([[x + 2, y + 1], [x + w + 3, y + 1], [x + w + 3 + dx, y + dy + 1], [x + 2 + dx, y + dy + 1]], '#9aa8bc');
  // Side wall: a parallelogram running back, darker; logs along the depth.
  const side: [number, number][] = [[x + w, y], [x + w, y - h], [x + w + dx, y - h + dy], [x + w + dx, y + dy]];
  r.poly(side, wallC[2], (px, py) => {
    const t = (px - (x + w)) / (dx || 1);
    const ly = py - t * dy;
    if (o.wall === 'log') return (y - ly) % 3 < 1 ? P.ink : wallC[2];
    if (o.wall === 'stone') return ((y - ly) % 4 < 1 || ((px + Math.floor((y - ly) / 4) * 3) % 6 === 0)) ? P.stoneD : '#666670';
    return px % 3 === 0 ? P.ink : wallC[2];
  });
  // Roof: the right slope from the front gable's apex back along the ridge.
  const ov = 2;
  const apex: [number, number] = [x + w / 2, y - h - rise];
  const eaveR: [number, number] = [x + w + ov, y - h + 1];
  const eaveL: [number, number] = [x - ov, y - h + 1];
  const slope: [number, number][] = [apex, eaveR, [eaveR[0] + dx + 1, eaveR[1] + dy - 1], [apex[0] + dx + 1, apex[1] + dy - 1]];
  r.poly(slope, roofC[1], (px, py) => {
    // Rows of shingles across the slope; snow on its upper half.
    const t = (px - apex[0]) / (eaveR[0] - apex[0] || 1);
    const k = Math.max(0, Math.min(1, t));
    const row = Math.floor((py - (apex[1] + (eaveR[1] - apex[1]) * k)) * 1.2);
    if (k < 0.55) return k < 0.5 || dither(px, py, 0.5) ? (row % 3 === 0 ? P.snowS : P.snow) : roofC[1];
    return (px + row) % 4 === 0 ? roofC[2] : row % 2 ? roofC[1] : roofC[0];
  });
  r.line(apex[0], apex[1], apex[0] + dx + 1, apex[1] + dy - 1, P.snowL);
  r.line(eaveR[0], eaveR[1], eaveR[0] + dx + 1, eaveR[1] + dy - 1, P.ink);
  // Chimney on the slope, its top for the smoke.
  if (o.chimney) {
    const cx = Math.round(apex[0] + (eaveR[0] - apex[0]) * 0.45 + dx * 0.6), cy = Math.round(apex[1] + (eaveR[1] - apex[1]) * 0.45 + dy * 0.6);
    r.rect(cx - 1, cy - 6, 4, 7, P.stoneD);
    r.rect(cx - 1, cy - 6, 3, 6, P.stone);
    r.rect(cx - 2, cy - 7, 5, 1, P.ink);
    r.rect(cx - 1, cy - 8, 3, 1, P.snow);
    marks.chimney = [cx, cy - 9];
  }
  // Front wall.
  r.rect(x, y - h, w, h, wallC[1]);
  if (o.wall === 'log') {
    for (let j = y - h + 1; j < y; j += 3) {
      r.line(x, j, x + w - 1, j, P.logD);
      r.line(x, j - 1, x + w - 1, j - 1, P.logL);
      // Log ends standing out at the corners.
      r.px(x - 1, j - 1, P.logEnd);
      r.px(x + w, j - 1, P.logEnd);
      r.px(x - 1, j, P.logD);
      r.px(x + w, j, P.logD);
    }
  } else if (o.wall === 'stone') {
    for (let j = y - h; j < y; j++) for (let i = x; i < x + w; i++) {
      const row = Math.floor((j - (y - h)) / 3);
      if ((j - (y - h)) % 3 === 2 || (i + row * 3) % 7 === 0) r.px(i, j, P.stoneD);
      else if ((i * 7 + j * 3) % 11 === 0) r.px(i, j, P.stoneL);
    }
  } else {
    for (let i = x; i < x + w; i += 3) r.line(i, y - h, i, y - 1, P.plankD);
  }
  // Gable: vertical boards in the triangle, a little window, carved barge boards and the towel at the apex.
  r.poly([[x, y - h], [x + w, y - h], apex], P.plank, (px) => ((px - x) % 3 === 0 ? P.plankD : P.plank));
  r.rect(Math.round(apex[0]) - 1, Math.round(y - h - rise * 0.45) - 1, 3, 3, P.ink);
  r.px(Math.round(apex[0]), Math.round(y - h - rise * 0.45), o.lit > 0.2 ? P.glow : P.inkSoft);
  r.line(eaveL[0], eaveL[1], apex[0], apex[1], P.carve);
  r.line(eaveR[0], eaveR[1], apex[0], apex[1], P.carve);
  r.line(eaveL[0], eaveL[1] + 1, apex[0], apex[1] + 1, P.logD);
  r.line(eaveR[0], eaveR[1] + 1, apex[0], apex[1] + 1, P.logD);
  r.rect(Math.round(apex[0]), Math.round(apex[1]) + 1, 1, 4, P.carve);
  // Snow on the front of the roof edge.
  r.line(eaveL[0] + 1, eaveL[1] - 1, apex[0], apex[1] - 1, P.snow);
  r.line(apex[0], apex[1] - 1, eaveR[0] - 1, eaveR[1] - 1, P.snowS);
  // The carved horse at the ridge's end.
  if (o.horse) {
    const ax = Math.round(apex[0]), ay = Math.round(apex[1]);
    r.px(ax, ay - 1, P.logD);
    r.px(ax - 1, ay - 2, P.logD);
    r.px(ax - 2, ay - 2, P.logD);
    r.px(ax - 2, ay - 3, P.logD);
    r.px(ax - 1, ay - 3, P.log);
  }
  // Windows in carved frames, and the door.
  const rows = o.tall ? [y - h + 3, y - Math.round(h / 2) + 1] : [y - Math.round(h / 2) - 1];
  for (const wy of rows) {
    for (let k = 0; k < o.windows; k++) {
      const wx = Math.round(x + ((k + 1) * w) / (o.windows + 1)) - 2 + (o.door && o.windows === 1 && wy === rows[rows.length - 1] ? -Math.round(w / 5) : 0);
      r.rect(wx - 1, wy - 1, 6, 6, P.carve);
      r.rect(wx, wy, 4, 4, o.lit > 0.15 ? (o.litColor ?? P.glow) : P.inkSoft);
      r.line(wx + 2, wy, wx + 2, wy + 3, P.logD);
      r.line(wx, wy + 2, wx + 3, wy + 2, P.logD);
      r.rect(wx - 1, wy - 2, 6, 1, P.snow);
      marks.windows.push([wx + 2, wy + 2]);
    }
  }
  if (o.door) {
    const dw = Math.max(4, Math.round(w / 6));
    const dxp = Math.round(x + w * 0.62);
    r.rect(dxp - 1, y - 8, dw + 2, 8, P.carve);
    r.rect(dxp, y - 7, dw, 7, P.logD);
    r.px(dxp + dw - 2, y - 4, P.gold);
  }
  // Outline: the dark edge round the whole house reads it against the snow.
  r.line(x - 1, y, x + w, y, P.ink);
  r.line(x - 1, y - h, x - 1, y, P.ink);
  r.line(eaveL[0] - 1, eaveL[1], apex[0], apex[1] - 2, P.ink);
  r.line(apex[0], apex[1] - 2, apex[0] + dx + 1, apex[1] + dy - 3, P.ink);
  r.line(apex[0] + dx + 1, apex[1] + dy - 2, eaveR[0] + dx + 2, eaveR[1] + dy - 1, P.ink);
  r.line(x + w + dx, y + dy, x + w + dx, eaveR[1] + dy, P.ink);
  return marks;
}

/** An open shed on four posts with a sloped roof: the first year of a workshop. A forge glows under it. */
export function shed(r: Raster, x: number, y: number, w: number, lit: number, fire: boolean): [number, number] | null {
  r.poly([[x + 2, y + 1], [x + w + 4, y + 1], [x + w + 8, y - 4], [x + 6, y - 4]], '#9aa8bc');
  for (const px of [x, x + w - 1]) r.rect(px, y - 9, 1, 9, P.logD);
  // Roof boards sloping back, snow on them.
  r.poly([[x - 2, y - 9], [x + w + 2, y - 9], [x + w + 5, y - 14], [x + 1, y - 14]], P.plank, (px, py) => (py < y - 11 ? P.snow : (px % 3 === 0 ? P.plankD : P.plank)));
  r.line(x - 2, y - 9, x + w + 2, y - 9, P.ink);
  let f: [number, number] | null = null;
  if (fire) {
    // A forge of stones and an anvil on a stump.
    r.rect(x + 2, y - 4, 6, 4, P.stoneD);
    r.rect(x + 3, y - 5, 4, 2, P.stone);
    r.rect(x + 4, y - 5, 2, 1, lit > 0 ? P.fire : P.inkSoft);
    f = [x + 5, y - 6];
    r.rect(x + w - 7, y - 2, 3, 2, P.logD);
    r.rect(x + w - 8, y - 4, 5, 2, P.stoneD);
    r.rect(x + w - 9, y - 4, 1, 1, P.stoneD);
  }
  return f;
}

/** A barn on low posts (a store), plank-walled, no windows. */
export function barn(r: Raster, x: number, y: number, w: number, d: number, roof: 'slate' | 'shingle'): void {
  house(r, { x, y, w, d, h: 7, rise: 6, wall: 'plank', roof, windows: 0, door: true, lit: 0 });
}

/** A spruce under snow, tiered; or a bare birch. */
export function spruce(r: Raster, x: number, y: number, s: number): void {
  r.ellipse(x + 2, y + 1, s * 0.9, 1.5, '#9aa8bc');
  r.rect(x - 1, y - 2, 2, 3, P.logD);
  for (let k = 0; k < 3; k++) {
    const ty = y - 2 - k * s * 0.7, hw = s * (1 - k * 0.28);
    r.poly([[x - hw, ty], [x + hw, ty], [x, ty - s * 1.1]], P.spruce, (px, py) => (py > ty - 2 && dither(px, py, 0.6) ? P.snow : px > x + 1 ? P.spruceD : (px + py) % 5 === 0 ? P.spruceL : P.spruce));
  }
  r.px(x, Math.round(y - 2 - 2 * s * 0.7 - s * 1.1), P.snowL);
}

export function birch(r: Raster, x: number, y: number, s: number): void {
  r.rect(x, y - s * 2.5, 1, s * 2.5, P.birch);
  for (let j = 0; j < s * 2.5; j += 3) r.px(x, y - j, P.ink);
  r.line(x, y - s * 1.6, x - s * 0.8, y - s * 2.4, P.logD);
  r.line(x, y - s * 1.9, x + s * 0.9, y - s * 2.7, P.logD);
  r.line(x, y - s * 2.3, x - s * 0.4, y - s * 2.9, P.logD);
}

/** A wattle fence (woven withies between stakes) round a plot. */
export function wattle(r: Raster, x: number, y: number, w: number, h: number): void {
  const side = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const px = Math.round(x0 + ((x1 - x0) * i) / n), py = Math.round(y0 + ((y1 - y0) * i) / n);
      r.px(px, py - 2, i % 2 ? P.log : P.logL);
      r.px(px, py - 1, i % 2 ? P.logL : P.log);
      if (i % 5 === 0) {
        r.px(px, py - 3, P.logD);
        r.px(px, py, P.logD);
        r.px(px, py - 4, P.snow);
      }
    }
  };
  side(x, y, x + w, y);
  side(x, y + h, x + w, y + h);
  side(x, y, x, y + h);
  side(x + w, y, x + w, y + h);
}

/** A stake with a little board: the price of a plot for sale. */
export function signpost(r: Raster, x: number, y: number, locked: boolean): void {
  r.rect(x, y - 8, 1, 8, P.logD);
  r.rect(x - 6, y - 12, 13, 6, P.logD);
  r.rect(x - 5, y - 11, 11, 4, locked ? '#8a7a68' : P.plank);
  r.rect(x - 6, y - 13, 13, 1, P.snow);
  if (locked) {
    r.line(x - 5, y - 11, x + 5, y - 8, P.redD);
    r.line(x - 5, y - 8, x + 5, y - 11, P.redD);
  }
}

/** The water wheel on the river: paddles round a hub, turning (angle in radians). */
export function waterWheel(r: Raster, cx: number, cy: number, rad: number, a: number): void {
  r.ellipse(cx, cy, rad + 1, rad + 1, P.ink);
  r.ellipse(cx, cy, rad, rad, P.logD);
  r.ellipse(cx, cy, rad - 2, rad - 2, P.waterM);
  for (let k = 0; k < 8; k++) {
    const t = a + (k * Math.PI) / 4;
    r.line(cx, cy, cx + Math.cos(t) * rad, cy + Math.sin(t) * rad, P.log);
    r.rect(Math.round(cx + Math.cos(t) * (rad + 1)) - 1, Math.round(cy + Math.sin(t) * (rad + 1)) - 1, 2, 2, P.logL);
  }
  r.rect(cx - 1, cy - 1, 2, 2, P.ink);
  // Spray where the paddles meet the water.
  for (let k = 0; k < 4; k++) r.px(cx - rad + k * 2 + Math.round(Math.sin(a * 3 + k) * 1.5), cy + rad - 1, P.snowL);
}

/** Things lying in a workshop's yard by its trade (and more of them as it grows). */
export function yardProps(r: Raster, kind: ShopKind, x: number, y: number, lvl: number, t: number): void {
  if (kind === 'wheel') {
    for (let k = 0; k < Math.min(3, lvl); k++) {
      const cx = x + k * 6, cy = y - 3;
      r.ellipse(cx, cy, 3, 3, P.logD);
      r.ellipse(cx, cy, 2, 2, P.snowS);
      r.line(cx - 2, cy, cx + 2, cy, P.log);
      r.line(cx, cy - 2, cx, cy + 2, P.log);
    }
    if (lvl >= 4) {
      // A cart waiting for its wheels.
      r.rect(x + 20, y - 6, 12, 4, P.plank);
      r.rect(x + 20, y - 7, 12, 1, P.snow);
      r.line(x + 32, y - 4, x + 37, y - 2, P.logD);
      r.ellipse(x + 23, y - 1, 2, 2, P.logD);
      r.ellipse(x + 29, y - 1, 2, 2, P.logD);
    }
  } else if (kind === 'pots') {
    for (let k = 0; k < Math.min(5, lvl + 1); k++) {
      const cx = x + (k % 3) * 5, cy = y - 2 - Math.floor(k / 3) * 4;
      r.ellipse(cx, cy, 2.5, 2, P.copper);
      r.px(cx - 1, cy - 1, P.copperL);
      r.rect(cx - 1, cy - 3, 3, 1, P.ink);
    }
    if (lvl >= 3) {
      // A kiln: a stone dome with a fire mouth.
      r.ellipse(x + 22, y - 4, 5, 4, P.stoneD);
      r.ellipse(x + 22, y - 5, 4, 3, P.stone);
      r.rect(x + 21, y - 3, 3, 2, Math.sin(t * 9) > -0.3 ? P.fire : P.glowD);
      r.rect(x + 19, y - 9, 6, 1, P.snow);
    }
  } else if (kind === 'arms') {
    // A rack of spears, a shield, and the town's banner at the higher levels.
    r.rect(x, y - 9, 10, 1, P.logD);
    for (let k = 0; k < Math.min(4, lvl + 1); k++) {
      r.line(x + 1 + k * 2, y, x + 1 + k * 2, y - 11, P.logD);
      r.px(x + 1 + k * 2, y - 12, P.stoneL);
    }
    r.ellipse(x + 15, y - 4, 3, 3, P.red);
    r.px(x + 15, y - 4, P.gold);
    if (lvl >= 4) {
      r.rect(x + 22, y - 18, 1, 18, P.logD);
      const wave = Math.round(Math.sin(t * 3));
      r.rect(x + 23, y - 18, 6, 8 + wave, P.red);
      r.rect(x + 25, y - 16, 2, 4, P.cream);
      r.px(x + 25, y - 17, P.cream);
      r.px(x + 26, y - 17, P.cream);
    }
  } else {
    // Standing stones with the river's cold light in their cuts.
    const pulse = 0.5 + 0.5 * Math.sin(t * 2);
    for (let k = 0; k < Math.min(3, lvl); k++) {
      const sx = x + k * 7, sy = y;
      r.rect(sx, sy - 9 + (k % 2), 4, 9 - (k % 2), P.stoneD);
      r.rect(sx + 1, sy - 9 + (k % 2), 2, 8 - (k % 2), P.stone);
      r.px(sx + 1, sy - 6, pulse > 0.4 ? P.relic : P.stoneD);
      r.px(sx + 2, sy - 4, pulse > 0.6 ? P.relicL : P.stoneD);
      r.rect(sx, sy - 10 + (k % 2), 4, 1, P.snow);
    }
  }
}

/** Sacks and crates of finished work by a door: how many there are, up to a heap. */
export function stockPile(r: Raster, x: number, y: number, n: number, full: boolean, blink: boolean): void {
  for (let k = 0; k < Math.min(n, 8); k++) {
    const px = x + (k % 4) * 4 - (Math.floor(k / 4) * 2), py = y - Math.floor(k / 4) * 3;
    const c = full && blink ? P.red : k % 3 === 2 ? P.plank : '#b0905a';
    r.rect(px, py - 3, 4, 3, P.ink);
    r.rect(px, py - 3, 3, 3, c);
    r.px(px + 1, py - 4, P.ink);
    r.px(px + 1, py - 3, P.snow);
  }
}

/** A bar on a little board under a building: how far the thing in hand is. */
export function bar(r: Raster, x: number, y: number, w: number, k: number, ok: boolean): void {
  r.rect(x - 1, y - 1, w + 2, 4, P.ink);
  r.rect(x, y, w, 2, P.logD);
  r.rect(x, y, Math.round(w * Math.max(0, Math.min(1, k))), 2, ok ? P.gold : P.red);
  r.px(x, y, ok ? '#fff0b0' : P.red);
}

/** Level marks: small hammers in gold for the levels reached. */
export function levelMarks(r: Raster, x: number, y: number, lvl: number): void {
  for (let k = 0; k < 5; k++) {
    const c = k < lvl ? P.gold : '#6a5a48';
    const px = x + k * 4;
    r.rect(px, y, 3, 1, c);
    r.px(px + 1, y + 1, c);
    r.px(px + 1, y + 2, k < lvl ? P.goldD : '#5a4a3a');
  }
}

/**
 * The courier on his round: a man in a fur hat walking (four frames), a sack on his back when he carries;
 * at level 3 he pushes a barrow, at 5 he drives a horse and cart. Facing left or right.
 */
export function courier(r: Raster, x: number, y: number, lvl: number, frame: number, carry: boolean, left: boolean): void {
  x = Math.round(x);
  y = Math.round(y);
  const f = (dx: number) => (left ? -dx : dx);
  const leg = [0, 1, 0, -1][frame & 3];
  r.ellipse(x, y + 1, 4, 1.2, '#9aa8bc');
  if (lvl >= 5) {
    // Horse in front, the cart behind with the man on it.
    const hx = x + f(7);
    r.rect(hx - 4, y - 6, 9, 4, P.horse);
    r.rect(hx + (left ? -6 : 4), y - 9, 3, 4, P.horse);
    r.rect(hx + (left ? -7 : 6), y - 9, 2, 2, P.horseD);
    for (const k of [-3, 3]) r.rect(hx + k + (k > 0 ? leg : -leg), y - 2, 1, 3, P.horseD);
    r.rect(x - 7, y - 6, 9, 4, P.plank);
    r.rect(x - 7, y - 7, 9, 1, carry ? '#b0905a' : P.plankD);
    r.ellipse(x - 3, y - 1, 2.5, 2.5, P.logD);
    r.px(x - 3, y - 1, P.logL);
    r.rect(x - 2, y - 13, 3, 6, P.coat);
    r.rect(x - 2, y - 15, 3, 2, P.skin);
    r.rect(x - 3, y - 16, 5, 1, '#6a5440');
    return;
  }
  // The man.
  r.rect(x - 1, y - 3, 1, 3 + (leg > 0 ? 0 : 0), P.ink);
  r.rect(x - 1 + leg, y - 3, 1, 3, P.coatD);
  r.rect(x + 1 - leg, y - 3, 1, 3, P.coatD);
  r.rect(x - 2, y - 8, 4, 5, P.coat);
  r.px(x + f(1), y - 7, P.coatD);
  r.rect(x - 1, y - 10, 3, 2, P.skin);
  r.rect(x - 2, y - 12, 4, 2, '#6a5440');
  r.px(x + f(1), y - 9, P.ink);
  if (lvl >= 3) {
    // A barrow pushed ahead.
    const bx = x + f(5);
    r.rect(bx - 3, y - 5, 6, 3, P.plank);
    if (carry) r.rect(bx - 2, y - 6, 4, 1, '#b0905a');
    r.ellipse(bx + f(2), y - 1, 1.6, 1.6, P.logD);
    r.line(x + f(1), y - 5, bx - f(2), y - 4, P.logD);
  } else if (carry) {
    r.rect(x + f(-3), y - 10, 3, 4, '#b0905a');
    r.px(x + f(-2), y - 11, P.ink);
  }
}

/** The town's stone wall down the east edge, its gate tower and roofs behind it. */
export function townWall(r: Raster, x: number, h: number, gateY: number, t: number, lit: number): [number, number][] {
  const lights: [number, number][] = [];
  // Roofs of the town beyond the wall.
  for (let k = 0; k < 9; k++) {
    const ry = 6 + k * 24 + ((k * 7) % 9), rx = x + 10 + ((k * 13) % 14);
    r.poly([[rx - 6, ry + 8], [rx + 6, ry + 8], [rx, ry]], P.slateD, (px, py) => (py < ry + 4 ? P.snowS : P.slateD));
    r.rect(rx - 5, ry + 8, 10, 6, P.logD);
    if ((k * 5) % 3 !== 0) {
      r.rect(rx - 1, ry + 10, 2, 2, lit > 0.15 ? P.glow : P.inkSoft);
      lights.push([rx, ry + 11]);
    }
  }
  // The wall: stone blocks with crenels on top, snow along them.
  for (let y = 0; y < h; y++) {
    if (y > gateY - 12 && y < gateY + 12) continue;
    for (let i = 0; i < 8; i++) r.px(x + i, y, (i + Math.floor(y / 3) * 3) % 7 === 0 || y % 3 === 0 ? P.stoneD : i < 2 ? P.stoneL : P.stone);
    r.px(x - 1, y, P.ink);
    if (y % 6 < 3) r.px(x - 2, y, P.stoneD);
    if (y % 6 === 0) r.px(x - 2, y, P.snow);
  }
  // The gate tower with its arch and a lantern.
  r.rect(x - 4, gateY - 16, 16, 32, P.stoneD);
  r.rect(x - 3, gateY - 15, 14, 30, P.stone);
  for (let j = gateY - 15; j < gateY + 15; j += 3) r.line(x - 3, j, x + 10, j, P.stoneD);
  r.poly([[x - 6, gateY - 16], [x + 14, gateY - 16], [x + 4, gateY - 30]], P.slate, (px, py) => (py < gateY - 23 ? P.snow : P.slate));
  r.rect(x - 2, gateY - 6, 10, 12, P.ink);
  r.rect(x - 1, gateY - 5, 8, 11, '#2a2026');
  r.ellipse(x + 3, gateY - 5, 5, 3, P.ink);
  r.rect(x - 3, gateY - 10, 2, 2, P.glow);
  lights.push([x - 2, gateY - 9]);
  void t;
  return lights;
}

/** The market before the gate: stalls under red-and-cream awnings, goods on the boards. */
export function market(r: Raster, x: number, y: number): void {
  for (let k = 0; k < 3; k++) {
    const sx = x + k * 11 - (k === 1 ? 2 : 0), sy = y + (k === 1 ? 14 : 0);
    r.rect(sx + 1, sy, 1, 8, P.logD);
    r.rect(sx + 8, sy, 1, 8, P.logD);
    for (let i = 0; i < 10; i++) r.rect(sx + i, sy - 3, 1, 3, i % 2 ? P.cream : P.red);
    r.rect(sx, sy - 4, 10, 1, P.snow);
    r.rect(sx + 1, sy + 4, 8, 2, P.plank);
    r.px(sx + 3, sy + 3, P.copper);
    r.px(sx + 5, sy + 3, P.relic);
    r.px(sx + 6, sy + 3, P.gold);
  }
}
