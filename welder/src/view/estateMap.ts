import type { Game } from '../sim/game';
import { ESTATE, SHOP_KINDS, SHOP_ORDER, ShopKind, PlotDef, riverX, RIVER_W } from '../data/estate';
import { placeAt, route, type Shop } from '../sim/estate';
import { BALANCE } from '../data/balance';
import { t } from '../i18n';
import { Raster, dither } from './estate/raster';
import { P, house, shed, barn, spruce, birch, wattle, signpost, waterWheel, yardProps, stockPile, bar, levelMarks, courier, townWall, market, HouseMarks } from './estate/art';

/**
 * The estate map, hung on the workshop wall and opened over the game: a pixel diorama of the land in the
 * game's own look (360×220 plan pixels, drawn three times as big) — the house and its mill on the river,
 * the bridge, the road to the town gate and its market, the plots round about with their workshops growing
 * by level, smoke, snow, lit windows after dark, the courier on his round. Beside it a page of the estate
 * book: what the chosen place is, with its picture, and what can be done there.
 */

const W = ESTATE.W, H = ESTATE.H, S = 3;

function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Rect = { x: number; y: number; w: number; h: number };
const inRect = (r: Rect, x: number, y: number, m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;

interface Puff {
  x: number;
  y: number;
  t: number;
  life: number;
  vx: number;
}

export class EstateMap {
  readonly el = document.createElement('div');
  private canvas = document.createElement('canvas');
  private cx: CanvasRenderingContext2D;
  private low = document.createElement('canvas');
  private lowCx: CanvasRenderingContext2D;
  private base = new Raster(W, H);
  private r = new Raster(W, H);
  private portrait = document.createElement('canvas');
  private panel = document.createElement('div');
  private side = document.createElement('div');
  private top = document.createElement('div');
  private panelHtml = '';
  private topHtml = '';
  private sel = 'home';
  private hover = '';
  private time = 0;
  private dtNow = 0;
  private wheelA = 0;
  private puffs: Puff[] = [];
  private flakes: { x: number; y: number; v: number }[] = [];
  private emit = new Map<string, number>();
  /** Where each place's pile of finished things is this frame (a click there sells it). */
  private piles = new Map<string, Rect>();
  /** Coins rising from where something was sold. */
  private pops: { x: number; y: number; t: number; text: string }[] = [];
  private lights: { x: number; y: number; r: number; c: string; a: number }[] = [];
  private townLights: [number, number][] = [];
  isOpen = false;
  onClose: () => void = () => {};

  constructor(private game: Game) {
    this.el.id = 'estate';
    this.el.className = 'pe';
    this.canvas.width = W * S;
    this.canvas.height = H * S;
    this.cx = this.canvas.getContext('2d')!;
    this.cx.imageSmoothingEnabled = false;
    this.low.width = W;
    this.low.height = H;
    this.lowCx = this.low.getContext('2d')!;
    this.portrait.width = 64 * 3;
    this.portrait.height = 44 * 3;
    this.drawBase();
    const R = rnd(3);
    for (let i = 0; i < 70; i++) this.flakes.push({ x: R() * W, y: R() * H, v: 6 + R() * 10 });

    this.el.innerHTML = `<div class="x" title="Esc"><svg viewBox="0 0 7 7" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${i}" y="${i}" width="1" height="1"/><rect x="${6 - i}" y="${i}" width="1" height="1"/>`).join('')}</svg></div>`;
    this.top.className = 'top';
    const body = document.createElement('div');
    body.className = 'body';
    const plan = document.createElement('div');
    plan.className = 'plan';
    plan.append(this.canvas);
    this.side.className = 'side';
    const pf = document.createElement('div');
    pf.className = 'portrait';
    pf.append(this.portrait);
    this.panel.className = 'page';
    this.side.append(pf, this.panel);
    body.append(plan, this.side);
    this.el.append(this.top, body);
    this.el.style.display = 'none';
    this.el.querySelector('.x')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const p = this.toPlan(e);
      for (const [id, rc] of this.piles) if (inRect(rc, p.x, p.y, 2) && this.game.estate.stockAt(id).length) return this.sell(id);
      const id = this.hit(p.x, p.y);
      if (!id) return;
      this.sel = id;
      this.panelHtml = '';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = this.toPlan(e);
      let over = this.hit(p.x, p.y);
      for (const [id, rc] of this.piles) if (inRect(rc, p.x, p.y, 2) && this.game.estate.stockAt(id).length) over = id;
      this.hover = over;
      this.canvas.classList.toggle('hot', !!over);
    });
    this.canvas.addEventListener('pointerleave', () => (this.hover = ''));
    this.panel.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || b.classList.contains('off')) return;
      const a = b.dataset.act!, arg = b.dataset.arg ?? '';
      const g = this.game;
      if (a === 'sell') this.sell(arg);
      else if (a === 'plot') g.queue({ type: 'plotBuy', id: arg });
      else if (a === 'build') g.queue({ type: 'shopBuild', id: this.sel, kind: arg as ShopKind });
      else if (a === 'up') g.queue({ type: 'shopUp', id: arg });
      else if (a === 'courier') g.queue({ type: 'courierBuy' });
      else if (a === 'courierUp') g.queue({ type: 'courierUp' });
      this.panelHtml = '';
    });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    game.bus.on('sold', (e) => {
      const p = e.at === 'market' ? ESTATE.market : placeAt(e.at);
      this.pops.push({ x: p.x, y: p.y - 8, t: 0, text: `+${e.amount} ◆` });
      this.panelHtml = '';
    });
    game.bus.on('estate', () => (this.panelHtml = ''));
    game.bus.on('money', () => (this.panelHtml = ''));
  }

  open(): void {
    this.isOpen = true;
    this.panelHtml = '';
    this.topHtml = '';
    this.el.style.display = 'flex';
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.style.display = 'none';
    this.onClose();
  }

  private sell(id: string): void {
    this.game.queue({ type: 'sell', at: id });
  }

  private toPlan(e: PointerEvent): { x: number; y: number } {
    const rc = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - rc.left) / rc.width) * W, y: ((e.clientY - rc.top) / rc.height) * H };
  }

  private hit(x: number, y: number): string {
    if (inRect(ESTATE.home, x, y)) return 'home';
    for (const p of ESTATE.plots) if (inRect(p, x, y)) return p.id;
    if (Math.abs(x - ESTATE.market.x) < 16 && Math.abs(y - ESTATE.market.y) < 16) return 'market';
    return '';
  }

  // ------------------------------------------------------------------ the land, drawn once

  /** Is a point taken (a plot, the house, the river, the road, the town) — no trees there. */
  private taken(x: number, y: number, m: number): boolean {
    if (inRect(ESTATE.home, x, y, m + 4)) return true;
    for (const p of ESTATE.plots) if (inRect(p, x, y, m)) return true;
    if (Math.abs(x - riverX(y)) < RIVER_W / 2 + m + 4) return true;
    if (x > ESTATE.wallX - 40 - m) return true;
    if (Math.abs(y - ESTATE.market.y) < 10 + m && x > ESTATE.home.x) return true;
    if (Math.abs(y - ESTATE.bridgeY) < 6 + m && x < ESTATE.home.x + 10) return true;
    return false;
  }

  private drawBase(): void {
    const r = this.base;
    const R = rnd(11);
    // Snow over frozen ground: drifts with a lit crest, bare patches of earth with a dark rim, sparkle.
    const field = (x: number, y: number) => Math.sin(x * 0.07 + Math.sin(y * 0.05) * 2) + Math.sin(y * 0.11 + x * 0.03) * 0.8 + Math.sin(x * 0.23 + y * 0.19) * 0.25;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = field(x, y);
        let c = P.snow;
        if (n < -1.72) c = P.earth;
        else if (n < -1.64) c = P.earthD;
        else if (n < -1.45) c = P.snowS;
        else if (n > 1.25) c = field(x, y - 1) <= 1.25 ? P.snowL : P.snowS;
        else if ((x * 7 + y * 13) % 97 === 0) c = P.snowL;
        r.px(x, y, c);
      }
    // Roads: from the house to the market at the gate; lanes to each plot (over the bridge for the west).
    const road = (pts: { x: number; y: number }[], wd: number) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
          for (let j = -wd; j <= wd; j++)
            for (let i2 = -wd; i2 <= wd; i2++) {
              const d = Math.hypot(i2, j);
              if (d > wd + 0.3) continue;
              const px = Math.round(x + i2), py = Math.round(y + j);
              r.px(px, py, d > wd - 0.8 ? P.roadL : (px + py) % 9 === 0 ? P.roadD : P.road);
            }
        }
      }
    };
    const home = placeAt('home');
    road([home, { x: ESTATE.wallX - 4, y: ESTATE.gateY + 4 }], 3);
    for (const p of ESTATE.plots) road([home, ...route(home, placeAt(p.id))], 1.4);
    // The river: dark water with currents, ice along both banks.
    for (let y = 0; y < H; y++) {
      const cx = riverX(y), hw = RIVER_W / 2;
      for (let x = Math.floor(cx - hw - 2); x <= Math.ceil(cx + hw + 2); x++) {
        const d = Math.abs(x + 0.5 - cx);
        if (d > hw + 1.5) continue;
        let c: string;
        if (d > hw) c = P.earthD;
        else if (d > hw - 2.5) c = dither(x, y, 0.55) ? P.ice : P.waterL;
        else c = (x * 3 + y * 7) % 23 === 0 ? P.waterL : (y + Math.round(Math.sin(x * 0.6) * 2)) % 6 === 0 ? P.waterM : P.water;
        r.px(x, y, c);
      }
    }
    // The bridge: planks across, rails, snow on the planks' ends.
    const by = ESTATE.bridgeY, bx = riverX(by);
    r.rect(bx - 16, by - 4, 32, 8, P.logD);
    for (let x = bx - 15; x < bx + 15; x += 2) {
      r.rect(x, by - 3, 1, 6, P.plank);
      r.px(x, by - 3, P.snow);
    }
    r.rect(bx - 16, by - 5, 32, 1, P.log);
    r.rect(bx - 16, by + 4, 32, 1, P.log);
    for (const x of [bx - 16, bx - 6, bx + 5, bx + 15]) {
      r.rect(x, by - 7, 1, 3, P.logD);
      r.px(x, by - 8, P.snow);
    }
    // Trees where the land is free: spruce woods, a few birches; stumps and stones.
    const trees: [number, number, number, boolean][] = [];
    for (let i = 0; i < 360; i++) {
      const x = 4 + R() * (W - 8), y = 10 + R() * (H - 12);
      if (this.taken(x, y, 6)) continue;
      if (trees.some(([tx, ty]) => Math.abs(tx - x) < 6 && Math.abs(ty - y) < 5)) continue;
      trees.push([x, y, 3 + R() * 2.5, R() < 0.18]);
    }
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, y, s, b] of trees) (b ? birch : spruce)(r, Math.round(x), Math.round(y), s);
    // The town beyond its wall, the gate, the market before it.
    this.townLights = townWall(r, ESTATE.wallX, H, ESTATE.gateY, 0, 1);
    market(r, ESTATE.market.x - 14, ESTATE.market.y - 22);
    // The house's mill on the river: a log mill-house on the east bank, copper cable to the workshop.
    const mx = Math.round(riverX(92) + RIVER_W / 2 + 2);
    house(r, { x: mx, y: 98, w: 14, d: 10, h: 8, rise: 7, wall: 'log', roof: 'shingle', windows: 0, door: false, lit: 0 });
    for (let x = mx + 14; x < ESTATE.home.x + 10; x++) r.px(x, 92 + Math.round(Math.sin(x * 0.4)), P.copper);
  }

  // ------------------------------------------------------------------ every frame

  private smoke(key: string, at: [number, number] | null, dt: number, rate: number): void {
    if (!at) return;
    const k = (this.emit.get(key) ?? 0) + dt * rate;
    if (k >= 1) {
      this.puffs.push({ x: at[0], y: at[1], t: 0, life: 2.4 + Math.random(), vx: 3 + Math.random() * 2 });
      this.emit.set(key, k - 1);
    } else this.emit.set(key, k);
  }

  /** A worked yard: snow trodden grey, earth showing along the paths and by the door. */
  private yard(x: number, y: number, w: number, h: number): void {
    const r = this.r;
    r.rect(x + 1, y + 1, w - 2, h - 2, P.snowS);
    for (let j = y + 2; j < y + h - 1; j++)
      for (let i = x + 2; i < x + w - 2; i++) {
        const n = Math.sin(i * 0.35 + j * 0.2) + Math.sin(j * 0.5 - i * 0.13);
        if (n > 1.7) r.px(i, j, P.earth);
        else if (n > 1.55) r.px(i, j, P.earthD);
        else if ((i * 5 + j * 11) % 53 === 0) r.px(i, j, P.snow);
      }
    // The trodden way from the gate in the fence to the door.
    for (let j = y + h - 8; j < y + h - 1; j++) for (let i = x + w / 2 - 2; i < x + w / 2 + 3; i++) r.px(i, j, (i + j) % 3 ? P.earth : P.earthD);
  }

  /** A workshop on its plot, drawn by trade and level, its yard, its pile, its bar and its level marks. */
  private drawShop(p: PlotDef, s: Shop, working: boolean, night: number, dt: number): void {
    const r = this.r;
    const E = this.game.estate;
    const base = p.y + p.h - 11;
    const roof = s.kind === 'wheel' ? 'shingle' : 'slate';
    const stone = (s.kind === 'arms' && s.lvl >= 3) || (s.kind === 'relic' && s.lvl >= 2);
    const lit = working ? Math.max(night, 0.3) : night * 0.4;
    const litColor = s.kind === 'relic' ? P.relic : undefined;
    const marks: HouseMarks[] = [];
    let forge: [number, number] | null = null;
    // Behind first: a barn at level 4 and up.
    if (s.lvl >= 4) barn(r, p.x + 38, base - 12, 15, 8, roof);
    if (s.lvl === 1) forge = shed(r, p.x + 10, base, 20, working ? 1 : 0, true);
    else {
      const big = s.lvl >= 5;
      const w = big ? 28 : s.lvl >= 3 ? 22 : 18;
      marks.push(house(r, { x: p.x + (big ? 5 : 8), y: base, w, d: big ? 14 : 11, h: big ? 15 : 10, rise: big ? 11 : 9, wall: stone ? 'stone' : 'log', roof, windows: big ? 2 : 1, door: true, chimney: true, horse: s.lvl >= 3, tall: big, lit, litColor }));
      if (s.lvl === 3) forge = shed(r, p.x + 34, base, 12, working ? 1 : 0, true);
    }
    yardProps(r, s.kind, p.x + (s.lvl >= 5 ? 36 : s.lvl >= 3 ? 36 : 34), base + 7, s.lvl, this.time);
    // Smoke from the chimney or the forge while it works; the forge's glow.
    for (const m of marks) {
      if (working) this.smoke(p.id + 'c', m.chimney, dt, 1.6);
      for (const [wx, wy] of m.windows) if (lit > 0.15) this.lights.push({ x: wx, y: wy, r: 7, c: litColor ?? P.glow, a: 0.35 + 0.4 * night });
    }
    if (forge && working) {
      this.smoke(p.id + 'f', [forge[0], forge[1] - 6], dt, 1.2);
      this.lights.push({ x: forge[0], y: forge[1], r: 8, c: P.fire, a: 0.4 + 0.3 * Math.sin(this.time * 13) * 0.5 + 0.3 * night });
      if (Math.random() < dt * 8) this.puffs.push({ x: forge[0], y: forge[1], t: 0, life: 0.5, vx: (Math.random() - 0.5) * 12 });
    }
    // The pile of finished work by the door, the bar, the level.
    const pile = { x: p.x + 3, y: p.y + p.h - 10, w: 18, h: 9 };
    if (s.stock.length) {
      stockPile(r, pile.x + 2, pile.y + 9, s.stock.length, s.stock.length >= E.shopCap(s), Math.floor(this.time * 3) % 2 === 0);
      this.piles.set(p.id, pile);
    }
    bar(r, p.x + p.w - 22, p.y + p.h - 5, 18, s.t / E.shopCycle(p.id, s), working);
    levelMarks(r, p.x + 3, p.y + 3, s.lvl);
  }

  frame(dt: number): void {
    if (!this.isOpen) return;
    this.time += dt;
    this.dtNow = dt;
    const g = this.game, E = g.estate;
    const r = this.r;
    const night = Math.min(1, g.clock.dark * 1.1);
    this.lights.length = 0;
    this.piles.clear();
    r.copyFrom(this.base);
    // The mill's wheel turns with the river (faster with a second wheel bought).
    this.wheelA += dt * (g.owned.wheel2 ? 2.4 : 1.4);
    const mx = Math.round(riverX(92));
    waterWheel(r, mx + 4, 95, 7, this.wheelA);

    // Plots, back to front.
    const plots = [...ESTATE.plots].sort((a, b) => a.y - b.y);
    const open = !!g.flags.season2;
    const blink = Math.floor(this.time * 3) % 2 === 0;
    const drawPlot = (p: PlotDef) => {
      const st = E.plots[p.id];
      if (!st.owned) {
        // Wild land: a few young spruces, stakes at the corners, a board with the price.
        for (const [cx, cy] of [[p.x, p.y], [p.x + p.w, p.y], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h]]) {
          r.rect(cx, cy - 4, 1, 4, P.logD);
          r.px(cx, cy - 5, P.snow);
        }
        spruce(r, p.x + 14, p.y + 18, 3);
        spruce(r, p.x + 46, p.y + 26, 3.5);
        birch(r, p.x + 30, p.y + 16, 2.5);
        signpost(r, p.x + p.w / 2, p.y + p.h - 6, !open);
        return;
      }
      // Bought: cleared, fenced; a workshop if there is one, else logs ready for building.
      this.yard(p.x, p.y + 4, p.w, p.h - 4);
      wattle(r, p.x, p.y + 4, p.w, p.h - 4);
      if (!st.shop) {
        for (let k = 0; k < 4; k++) {
          r.rect(p.x + 20, p.y + p.h - 14 - k * 2, 18 - k * 2, 2, k % 2 ? P.log : P.logL);
          r.px(p.x + 20, p.y + p.h - 14 - k * 2, P.logEnd);
        }
        r.rect(p.x + 20, p.y + p.h - 21, 14, 1, P.snow);
        return;
      }
      const working = !E.unpaid && st.shop.stock.length < E.shopCap(st.shop);
      this.drawShop(p, st.shop, working, night, dt);
    };
    for (const p of plots.filter((q) => q.y < ESTATE.home.y)) drawPlot(p);
    this.drawHome(night, dt, blink);
    for (const p of plots.filter((q) => q.y >= ESTATE.home.y)) drawPlot(p);

    // The courier on his round.
    const c = E.courier;
    if (c) {
      const moving = !!c.to && c.path.length > 0;
      courier(r, c.x, c.y, c.lvl, moving ? Math.floor(this.time * 8) : 0, c.bag.length > 0, c.left);
    }

    // Smoke and sparks.
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const q = this.puffs[i];
      q.t += dt;
      if (q.t > q.life) {
        this.puffs.splice(i, 1);
        continue;
      }
      const k = q.t / q.life;
      if (q.life < 1) {
        r.px(q.x + q.vx * q.t, q.y - q.t * 18 + q.t * q.t * 20, k < 0.5 ? P.fireL : P.fire);
        continue;
      }
      const x = q.x + q.vx * q.t + Math.sin(q.t * 2 + q.y) * 1.5, y = q.y - q.t * 7;
      const s = 1 + Math.floor(k * 3);
      for (let j = 0; j < s; j++) for (let i2 = 0; i2 < s; i2++) if (dither(Math.round(x) + i2, Math.round(y) + j, 0.75 - k * 0.6)) r.blend(x + i2, y + j, k < 0.4 ? '#7a7a84' : '#9aa0aa', 0.85 - k * 0.6);
    }

    // Hover and selection: a frame round the place (the chosen one in gold, marching).
    const frameRect = (rc: Rect, col: string, march: boolean) => {
      const per = 2 * (rc.w + rc.h);
      for (let k = 0; k < per; k++) {
        if (march && (k + Math.floor(this.time * 12)) % 6 > 3) continue;
        let x: number, y: number;
        if (k < rc.w) [x, y] = [rc.x + k, rc.y];
        else if (k < rc.w + rc.h) [x, y] = [rc.x + rc.w, rc.y + k - rc.w];
        else if (k < 2 * rc.w + rc.h) [x, y] = [rc.x + rc.w - (k - rc.w - rc.h), rc.y + rc.h];
        else [x, y] = [rc.x, rc.y + rc.h - (k - 2 * rc.w - rc.h)];
        r.px(x, y, col);
      }
    };
    const rectOf = (id: string): Rect | null => (id === 'home' ? ESTATE.home : id === 'market' ? { x: ESTATE.market.x - 16, y: ESTATE.market.y - 26, w: 32, h: 32 } : ESTATE.plots.find((p) => p.id === id) ?? null);
    const hr = this.hover && this.hover !== this.sel ? rectOf(this.hover) : null;
    if (hr) frameRect(hr, '#fff4d8', false);
    const sr = rectOf(this.sel);
    if (sr) frameRect(sr, P.gold, true);

    // Dusk and night over everything, then the lights and the falling snow.
    r.tint(P.night, night * 0.55);
    for (const [x, y] of this.townLights) this.lights.push({ x, y, r: 5, c: P.glow, a: 0.15 + 0.45 * night });
    for (const l of this.lights) r.glow(l.x, l.y, l.r, l.c, l.a);
    for (const f of this.flakes) {
      f.y += f.v * dt;
      f.x += Math.sin(this.time + f.v) * dt * 3;
      if (f.y > H) {
        f.y = -2;
        f.x = Math.random() * W;
      }
      r.blend(f.x, f.y, P.snowL, 0.8);
    }
    this.lowCx.putImageData(r.img, 0, 0);
    this.cx.drawImage(this.low, 0, 0, W * S, H * S);
    this.drawLabels(open);
    this.drawPortrait();
    this.renderTop();
    this.renderPanel();
  }

  /** The house and workshop: a big log house with the forge's chimney, the apprentice's pile at the door. */
  private drawHome(night: number, dt: number, blink: boolean): void {
    const r = this.r, g = this.game, E = g.estate;
    const hm = ESTATE.home;
    this.yard(hm.x, hm.y + 6, hm.w, hm.h - 6);
    wattle(r, hm.x, hm.y + 6, hm.w, hm.h - 6);
    // A woodpile and a cart by the fence.
    for (let k = 0; k < 3; k++) r.rect(hm.x + 52, hm.y + 20 - k * 2, 14 - k * 3, 2, k % 2 ? P.log : P.logL);
    r.rect(hm.x + 52, hm.y + 15, 10, 1, P.snow);
    const m = house(r, { x: hm.x + 10, y: hm.y + hm.h - 12, w: 34, d: 16, h: 14, rise: 12, wall: 'log', roof: 'slate', windows: 2, door: true, chimney: true, horse: true, tall: true, lit: Math.max(0.35, night) });
    // The forge's chimney throws sparks as well as smoke.
    this.smoke('home', m.chimney, dt, 2);
    if (m.chimney && Math.random() < dt * 6) this.puffs.push({ x: m.chimney[0], y: m.chimney[1], t: 0, life: 0.6, vx: (Math.random() - 0.5) * 10 });
    for (const [wx, wy] of m.windows) this.lights.push({ x: wx, y: wy, r: 8, c: P.glow, a: 0.4 + 0.4 * night });
    // The sign over the yard gate.
    r.rect(hm.x + 52, hm.y + hm.h - 14, 1, 10, P.logD);
    r.rect(hm.x + 48, hm.y + hm.h - 18, 12, 5, P.logD);
    r.rect(hm.x + 49, hm.y + hm.h - 17, 10, 3, P.plank);
    r.px(hm.x + 51, hm.y + hm.h - 16, P.fire);
    r.px(hm.x + 54, hm.y + hm.h - 16, P.fire);
    // The apprentice's finished work waiting at the door.
    if (E.home.length) {
      const pile = { x: hm.x + 46, y: hm.y + hm.h - 10, w: 16, h: 8 };
      stockPile(r, pile.x + 1, pile.y + 7, E.home.length, E.home.length >= BALANCE.estate.homeCap, blink);
      this.piles.set('home', pile);
    }
  }

  /** Words over the picture (in the HUD's pixel font): prices on the boards, how many wait in each pile, sales. */
  private drawLabels(open: boolean): void {
    const x = this.cx, E = this.game.estate;
    const text = (s: string, px: number, py: number, col: string, size = 16) => {
      x.font = `${size}px 'Strata Pixel', monospace`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillStyle = 'rgba(16, 11, 8, 0.85)';
      for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) x.fillText(s, px * S + ox, py * S + oy);
      x.fillStyle = col;
      x.fillText(s, px * S, py * S);
    };
    for (const p of ESTATE.plots) {
      const st = E.plots[p.id];
      if (!st.owned && open) text(`◆${p.price}`, p.x + p.w / 2, p.y + p.h - 15.5, '#ffe8b0');
      if (st.shop && st.shop.stock.length) text(`${st.shop.stock.length}/${E.shopCap(st.shop)}`, p.x + 29, p.y + p.h - 5, st.shop.stock.length >= E.shopCap(st.shop) ? '#ff9a7a' : '#fff4dc');
    }
    if (E.home.length) text(`${E.home.length}/${BALANCE.estate.homeCap}`, ESTATE.home.x + 54, ESTATE.home.y + ESTATE.home.h - 15, E.home.length >= BALANCE.estate.homeCap ? '#ff9a7a' : '#fff4dc');
    if (E.unpaid && Math.floor(this.time * 2) % 2 === 0) text(t('map.unpaid'), W / 2, 8, '#ff9a7a');
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += this.dtNow;
      if (p.t > 1.6) {
        this.pops.splice(i, 1);
        continue;
      }
      text(p.text, p.x, p.y - p.t * 12, p.t < 1.1 ? '#ffe070' : 'rgba(255,224,112,0.5)');
    }
    // The name of what's under the cursor.
    if (this.hover) {
      const name = this.placeName(this.hover);
      const rc = this.hover === 'home' ? ESTATE.home : ESTATE.plots.find((q) => q.id === this.hover);
      if (rc) text(name, rc.x + rc.w / 2, rc.y + 4, '#fff4dc');
    }
  }

  private placeName(id: string): string {
    if (id === 'home') return t('map.home');
    if (id === 'market') return t('map.market');
    const s = this.game.estate.plots[id]?.shop;
    const d = this.game.estate.def(id);
    return s ? t('shop.' + s.kind) : d ? t('plot.' + d.kind) : '';
  }

  /** The chosen place, close up, at the top of the page. */
  private drawPortrait(): void {
    const id = this.sel;
    const rc = id === 'home' ? ESTATE.home : id === 'market' ? { x: ESTATE.market.x - 30, y: ESTATE.market.y - 30, w: 62, h: 46 } : ESTATE.plots.find((p) => p.id === id);
    if (!rc) return;
    const px = this.portrait.getContext('2d')!;
    px.imageSmoothingEnabled = false;
    const w = 64, h = 44;
    const cx = rc.x + rc.w / 2, cy = rc.y + rc.h / 2;
    px.drawImage(this.low, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, 0, 0, this.portrait.width, this.portrait.height);
  }

  // ------------------------------------------------------------------ the page of the estate book

  private btn(act: string, arg: string, label: string, ok: boolean): string {
    return `<span class="btn${ok ? '' : ' off'}" data-act="${act}" data-arg="${arg}">${label}</span>`;
  }

  private hammers(n: number): string {
    return `<span class="lv">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  /** What the estate brings in a minute, roughly (the workshops at work). */
  private perMinute(): number {
    const E = this.game.estate;
    let v = 0;
    for (const [id, p] of Object.entries(E.plots)) if (p.shop) v += (E.shopValue(p.shop, this.game.repMul()) * 60) / E.shopCycle(id, p.shop);
    return Math.round(v);
  }

  private renderTop(): void {
    const g = this.game, E = g.estate;
    const c = E.courier;
    const where = !c ? t('map.noCourier') : !c.to ? t('map.cIdle') : c.to === 'market' ? t('map.cMarket', { n: c.bag.length }) : t('map.cGoing', { place: this.placeName(c.to) });
    const h = `<b>${t('map.title')}</b><span>◆ ${g.money}</span><span>${t('map.income', { n: this.perMinute() })}</span><span>${t('map.upkeep', { n: E.upkeep() })}</span><span>${t('map.courier')}: ${where}</span>${E.unpaid ? `<span class="bad">${t('map.unpaid')}</span>` : ''}`;
    if (h !== this.topHtml) {
      this.topHtml = h;
      this.top.innerHTML = h;
    }
  }

  private renderPanel(): void {
    const g = this.game, E = g.estate, m = g.money;
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    let h = '';
    if (this.sel === 'home') {
      const st = E.home;
      h += `<h4>${t('map.home')}</h4><p>${t('map.homeDesc')}</p>`;
      h += `<div class="row"><span>${t('map.store')}</span><b>${st.length} / ${BALANCE.estate.homeCap}</b></div>`;
      if (!g.owned.apprentice) h += `<p class="dim">${t('map.noApp')}</p>`;
      h += this.btn('sell', 'home', `${t('map.sell')} · ◆ ${sum(st)}`, st.length > 0);
      h += `<h4>${t('map.courier')}</h4>`;
      const c = E.courier;
      if (!c) {
        const cost = BALANCE.estate.courier.cost;
        h += `<p>${t('map.courierDesc')}</p>`;
        h += g.owned.apprentice ? this.btn('courier', '', `${t('map.hire')} · ◆ ${cost}`, m >= cost) : `<p class="dim">${t('map.noApp')}</p>`;
      } else {
        h += `<div class="row"><span>${t('map.level')}</span>${this.hammers(c.lvl)}</div><div class="row"><span>${t('map.courierNow', { bag: E.courierBag(), v: Math.round(E.courierSpeed()) })}</span></div>`;
        if (c.lvl < 5) h += `<p class="dim">${t(c.lvl >= 4 ? 'map.cNext5' : c.lvl >= 2 ? 'map.cNext3' : 'map.cNext')}</p>`;
        const uc = E.courierUpCost();
        h += uc ? this.btn('courierUp', '', `${t('map.raise')} · ◆ ${uc}`, m >= uc) : `<div class="row ok">${t('map.top')}</div>`;
      }
    } else if (this.sel === 'market') {
      h += `<h4>${t('map.market')}</h4><p>${t('map.marketDesc')}</p>`;
    } else {
      const d = E.def(this.sel)!, st = E.plots[this.sel];
      if (!st.owned) {
        h += `<h4>${t('plot.' + d.kind)}</h4><p>${t('plot.' + d.kind + '.desc')}</p>`;
        h += g.flags.season2 ? this.btn('plot', d.id, `${t('map.buyPlot')} · ◆ ${d.price}`, m >= d.price) : `<p class="dim">${t('map.afterGate')}</p>`;
      } else if (!st.shop) {
        h += `<h4>${t('plot.' + d.kind)}</h4><p>${t('plot.' + d.kind + '.desc')}</p><div class="row">${t('map.build')}:</div>`;
        for (const k of SHOP_ORDER) {
          const K = SHOP_KINDS[k];
          h += `<div class="kind">${this.btn('build', k, `${t('shop.' + k)} · ◆ ${K.cost}`, m >= K.cost)}<p>${t('shop.' + k + '.desc')}</p></div>`;
        }
      } else {
        const s = st.shop;
        const q = E.shopQuality(s);
        const taught = E.taught[s.kind] >= 0;
        h += `<h4>${t('shop.' + s.kind)}</h4><p class="dim">${t('plot.' + d.kind)} · ${t('plot.' + d.kind + '.desc')}</p>`;
        h += `<div class="row"><span>${t('map.level')}</span>${this.hammers(s.lvl)}</div>`;
        h += `<div class="row"><span>${t('map.hand')}</span>${this.hammers(Math.max(1, Math.round(q * 5)))}</div>`;
        h += `<p class="dim">${taught ? '' : t('map.untaught') + ' '}${t('map.teach', { parts: SHOP_KINDS[s.kind].parts.map((p) => t('part.' + p)).join(', ') })}</p>`;
        h += `<div class="row"><span>${t('map.makesL')}</span><b>${t('map.makes', { v: E.shopValue(s, g.repMul()), s: Math.round(E.shopCycle(this.sel, s)) })}</b></div>`;
        h += `<div class="row"><span>${t('map.store')}</span><b>${s.stock.length} / ${E.shopCap(s)}</b></div>`;
        h += this.btn('sell', this.sel, `${t('map.sell')} · ◆ ${sum(s.stock)}`, s.stock.length > 0);
        const uc = E.shopUpCost(s);
        h += uc ? `<p class="dim">${t('map.next')}</p>` + this.btn('up', this.sel, `${t('map.raise')} · ◆ ${uc}`, m >= uc) : `<div class="row ok">${t('map.top')}</div>`;
        h += `<div class="row dim"><span>${t('map.upkeepL')}</span><span>${t('map.per20', { n: SHOP_KINDS[s.kind].upkeep * s.lvl })}</span></div>`;
      }
    }
    if (h !== this.panelHtml) {
      this.panelHtml = h;
      this.panel.innerHTML = h;
    }
  }
}
