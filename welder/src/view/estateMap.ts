import type { Game } from '../sim/game';
import { ESTATE, SHOP_KINDS, SHOP_ORDER, ShopKind, PlotDef } from '../data/estate';
import { placeAt } from '../sim/estate';
import { BALANCE } from '../data/balance';
import { t } from '../i18n';

/**
 * The map of the estate, hung on the workshop wall and opened over the game: a drawn plan (320×200 plan
 * pixels, drawn twice as big) with the house in the middle, the river, the road to market and the plots;
 * workshops with their bars and sacks of finished things, the courier walking his round. A panel beside it
 * says what the chosen place is and what can be done there: sell, buy, build, raise.
 */

const S = 2;
const W = ESTATE.W * S, H = ESTATE.H * S;

const C = {
  paper: '#d8c49a',
  paperD: '#c4ac80',
  paperL: '#e6d6b0',
  ink: '#4a3420',
  inkL: '#7a5a38',
  river: '#6a8aa0',
  riverL: '#9ab4c4',
  road: '#a8885c',
  roadD: '#8a6c44',
  tree: '#4a5a34',
  treeD: '#34402a',
  gold: '#c8902a',
  red: '#a8402a',
};

const ROOF: Record<ShopKind, string> = { wheel: '#7a4a2a', pots: '#b06a3a', arms: '#4a5a6a', relic: '#2a6a72' };

function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class EstateMap {
  readonly el = document.createElement('div');
  private canvas = document.createElement('canvas');
  private x: CanvasRenderingContext2D;
  private bg = document.createElement('canvas');
  private panel = document.createElement('div');
  private panelHtml = '';
  private sel = 'home';
  private hover = '';
  private time = 0;
  /** Coins rising from where something was sold. */
  private pops: { x: number; y: number; t: number; text: string }[] = [];
  isOpen = false;
  onClose: () => void = () => {};

  constructor(private game: Game) {
    this.el.id = 'estate';
    this.el.className = 'pe';
    this.canvas.width = W;
    this.canvas.height = H;
    this.x = this.canvas.getContext('2d')!;
    this.x.imageSmoothingEnabled = false;
    this.bg.width = W;
    this.bg.height = H;
    this.drawBackground();
    const wrap = document.createElement('div');
    wrap.className = 'plan';
    wrap.append(this.canvas);
    this.panel.className = 'side';
    this.el.innerHTML = `<div class="x" title="Esc"><svg viewBox="0 0 7 7" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${i}" y="${i}" width="1" height="1"/><rect x="${6 - i}" y="${i}" width="1" height="1"/>`).join('')}</svg></div><h3></h3>`;
    const body = document.createElement('div');
    body.className = 'body';
    body.append(wrap, this.panel);
    this.el.append(body);
    this.el.style.display = 'none';
    this.el.querySelector('.x')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const p = this.toPlan(e);
      const id = this.hit(p.x, p.y);
      if (!id) return;
      // A click on a sack sells what is in it at once.
      if (this.onSack(id, p.x, p.y) && this.game.estate.stockAt(id).length) return this.sell(id);
      this.sel = id;
      this.panelHtml = '';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = this.toPlan(e);
      this.hover = this.hit(p.x, p.y);
      this.canvas.style.cursor = this.hover ? 'var(--cur-hot)' : 'var(--cur)';
    });
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
      this.pops.push({ x: p.x, y: p.y - 10, t: 0, text: `+${e.amount} ◆` });
      this.panelHtml = '';
    });
    game.bus.on('estate', () => (this.panelHtml = ''));
    game.bus.on('money', () => (this.panelHtml = ''));
  }

  open(): void {
    this.isOpen = true;
    this.panelHtml = '';
    this.el.style.display = 'flex';
    this.el.querySelector('h3')!.textContent = t('map.title');
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
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * ESTATE.W, y: ((e.clientY - r.top) / r.height) * ESTATE.H };
  }

  /** What place is under a point of the plan. */
  private hit(x: number, y: number): string {
    const inR = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (inR(ESTATE.home)) return 'home';
    for (const p of ESTATE.plots) if (inR(p)) return p.id;
    const m = ESTATE.market;
    if (Math.abs(x - m.x) < 18 && Math.abs(y - m.y) < 18) return 'market';
    return '';
  }

  /** Is the point on the sack in a place's corner? */
  private onSack(id: string, x: number, y: number): boolean {
    const r = id === 'home' ? ESTATE.home : ESTATE.plots.find((p) => p.id === id);
    if (!r) return false;
    return x >= r.x + r.w - 18 && y <= r.y + 16;
  }

  // ------------------------------------------------------------------ drawing

  private r(x: CanvasRenderingContext2D, c: string, X: number, Y: number, w = 1, h = 1): void {
    x.fillStyle = c;
    x.fillRect(Math.round(X) * S, Math.round(Y) * S, Math.round(w) * S, Math.round(h) * S);
  }

  /** The parchment, the river, the road to market, trees, the market's stalls: drawn once. */
  private drawBackground(): void {
    const x = this.bg.getContext('2d')!;
    const R = rnd(7);
    const r = (c: string, X: number, Y: number, w = 1, h = 1) => this.r(x, c, X, Y, w, h);
    r(C.paper, 0, 0, ESTATE.W, ESTATE.H);
    for (let i = 0; i < 1400; i++) r(R() < 0.5 ? C.paperD : C.paperL, R() * ESTATE.W, R() * ESTATE.H, 1 + (R() < 0.2 ? 1 : 0), 1);
    // Darkened, worn edges.
    for (let i = 0; i < ESTATE.W; i++) {
      r(C.paperD, i, 0, 1, 2 + R() * 3);
      r(C.paperD, i, ESTATE.H - 3 - R() * 3, 1, 6);
    }
    for (let i = 0; i < ESTATE.H; i++) {
      r(C.paperD, 0, i, 2 + R() * 3, 1);
      r(C.paperD, ESTATE.W - 3 - R() * 3, i, 6, 1);
    }
    // The river down the west side, winding, with banks and ripples.
    for (let y = 0; y < ESTATE.H; y++) {
      const cx = 30 + Math.sin(y * 0.045) * 9 + Math.sin(y * 0.13) * 3;
      const w = 15 + Math.sin(y * 0.07) * 3;
      r(C.inkL, cx - w / 2 - 1, y, 1, 1);
      r(C.river, cx - w / 2, y, w, 1);
      r(C.inkL, cx + w / 2, y, 1, 1);
      if (y % 7 === 0) r(C.riverL, cx - 3 + Math.sin(y) * 3, y, 4, 1);
    }
    // The road from the house east to market, and lanes from the house to each plot.
    const road = (x0: number, y0: number, x1: number, y1: number, w: number) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let i = 0; i <= n; i++) {
        const X = x0 + ((x1 - x0) * i) / n, Y = y0 + ((y1 - y0) * i) / n;
        r(C.road, X - w / 2, Y - w / 2, w, w);
      }
      for (let i = 0; i <= n; i += 3) {
        const X = x0 + ((x1 - x0) * i) / n, Y = y0 + ((y1 - y0) * i) / n;
        r(C.roadD, X, Y, 1, 1);
      }
    };
    const h = placeAt('home');
    road(h.x, h.y, ESTATE.market.x - 10, ESTATE.market.y, 7);
    // Lanes from the house's edge to each plot's edge (not across their insides).
    const edge = (r: { x: number; y: number; w: number; h: number }, fx: number, fy: number, tx: number, ty: number) => {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const dx = tx - fx, dy = ty - fy;
      const k = Math.min(Math.abs((r.w / 2) / (dx || 1e-6)), Math.abs((r.h / 2) / (dy || 1e-6)));
      return { x: cx + dx * k, y: cy + dy * k };
    };
    for (const p of ESTATE.plots) {
      const c = placeAt(p.id);
      const a = edge(ESTATE.home, h.x, h.y, c.x, c.y);
      const b = edge(p, c.x, c.y, h.x, h.y);
      road(a.x, a.y, b.x, b.y, 3);
    }
    // Trees where there is room.
    for (let i = 0; i < 70; i++) {
      const X = 8 + R() * (ESTATE.W - 16), Y = 6 + R() * (ESTATE.H - 12);
      if (this.hit(X, Y) || this.hit(X + 6, Y + 6) || this.hit(X - 6, Y - 6) || (X < 52 && X > 10)) continue;
      if (Math.abs(Y - ESTATE.market.y) < 8 && X > 180) continue;
      r(C.treeD, X - 2, Y + 3, 5, 2);
      r(C.tree, X - 3, Y - 2, 6, 5);
      r(C.treeD, X - 1, Y - 3, 2, 1);
      r(C.inkL, X, Y + 3, 1, 2);
    }
    // The market: three stalls with striped awnings.
    const m = ESTATE.market;
    for (let k = 0; k < 3; k++) {
      const X = m.x - 16 + k * 11, Y = m.y - 8 + (k % 2) * 4;
      for (let i = 0; i < 9; i++) r(i % 2 ? '#e8dcc0' : C.red, X + i, Y, 1, 3);
      r(C.inkL, X, Y + 3, 9, 5);
      r(C.paperL, X + 1, Y + 4, 7, 3);
    }
    // A compass in the corner.
    const cx = 300, cy = 20;
    for (let i = -7; i <= 7; i++) {
      r(C.inkL, cx + i, cy, 1, 1);
      r(C.inkL, cx, cy + i, 1, 1);
    }
    r(C.red, cx - 1, cy - 8, 3, 3);
  }

  /** The picture of a workshop: bigger and finer with each level, the roof in its trade's colour. */
  private drawShop(x: CanvasRenderingContext2D, p: PlotDef, kind: ShopKind, lvl: number, working: boolean): void {
    const r = (c: string, X: number, Y: number, w = 1, h = 1) => this.r(x, c, X, Y, w, h);
    const cx = p.x + p.w / 2, base = p.y + p.h - 9;
    const w = 14 + lvl * 3, hgt = 8 + lvl * 2;
    const x0 = cx - w / 2;
    r(C.ink, x0 - 1, base - hgt - 1, w + 2, hgt + 2);
    r('#b8946a', x0, base - hgt, w, hgt);
    // Roof.
    for (let i = 0; i < 6 + lvl; i++) r(ROOF[kind], x0 - 2 + i, base - hgt - 1 - i, w + 4 - 2 * i, 1);
    // Door, windows (lit when working).
    r(C.ink, cx - 2, base - 6, 4, 6);
    const win = working ? '#f0c060' : '#5a4a3a';
    for (let k = 0; k < Math.min(3, lvl); k++) r(win, x0 + 2 + k * 5, base - hgt + 2, 3, 3);
    // A chimney with smoke at level 3 and up; a second building at 5.
    if (lvl >= 3) {
      r(C.ink, x0 + w - 5, base - hgt - 8, 3, 6);
      if (working) for (let k = 0; k < 3; k++) r('rgba(90,80,70,0.5)', x0 + w - 5 + Math.sin(this.time * 2 + k) * 2, base - hgt - 11 - k * 3 - ((this.time * 6) % 3), 2, 2);
    }
    if (lvl >= 5) {
      r(C.ink, p.x + 3, base - 9, 10, 10);
      r('#b8946a', p.x + 4, base - 8, 8, 8);
      r(ROOF[kind], p.x + 3, base - 11, 10, 3);
    }
    // Its sign: what it makes.
    const ic = { wheel: '#3a2a1a', pots: '#8a4a20', arms: '#6a7a8a', relic: '#5ad0e0' }[kind];
    r(ic, cx + w / 2 + 1, base - 5, 3, 3);
  }

  private drawSack(x: CanvasRenderingContext2D, X: number, Y: number, n: number, full: boolean, blink: boolean): void {
    const r = (c: string, x0: number, y0: number, w = 1, h = 1) => this.r(x, c, x0, y0, w, h);
    const col = full && blink ? C.red : '#a8844a';
    r(C.ink, X - 1, Y + 2, 12, 10);
    r(col, X, Y + 3, 10, 8);
    r(C.ink, X + 3, Y, 4, 3);
    r(col, X + 4, Y + 1, 2, 2);
    x.fillStyle = '#fff4dc';
    x.font = `${8 * S}px 'Strata Pixel', monospace`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(String(n), (X + 5) * S, (Y + 7.5) * S);
  }

  private text(x: CanvasRenderingContext2D, s: string, X: number, Y: number, col = C.ink, align: CanvasTextAlign = 'center'): void {
    x.fillStyle = col;
    x.font = `${8 * S}px 'Strata Pixel', monospace`;
    x.textAlign = align;
    x.textBaseline = 'middle';
    x.fillText(s, X * S, Y * S);
  }

  /** Every frame while open: the plan, then the panel when something changed. */
  frame(dt: number): void {
    if (!this.isOpen) return;
    this.time += dt;
    const g = this.game, E = g.estate;
    const x = this.x;
    const r = (c: string, X: number, Y: number, w = 1, h = 1) => this.r(x, c, X, Y, w, h);
    x.drawImage(this.bg, 0, 0);
    const blink = Math.floor(this.time * 3) % 2 === 0;
    const open = !!g.flags.season2;
    // Plots.
    for (const p of ESTATE.plots) {
      const st = E.plots[p.id];
      const edge = this.sel === p.id ? C.gold : this.hover === p.id ? C.inkL : C.ink;
      if (!st.owned) {
        // Dashed outline, the price; hatched while the land isn't for sale yet.
        for (let i = 0; i < p.w; i += 4) {
          r(edge, p.x + i, p.y, 2, 1);
          r(edge, p.x + i, p.y + p.h - 1, 2, 1);
        }
        for (let i = 0; i < p.h; i += 4) {
          r(edge, p.x, p.y + i, 1, 2);
          r(edge, p.x + p.w - 1, p.y + i, 1, 2);
        }
        if (!open) for (let i = 4; i < p.w + p.h; i += 7) for (let k = 0; k < Math.min(i, p.h - 2); k += 2) if (i - k > 1 && i - k < p.w - 1) r(C.paperD, p.x + i - k, p.y + 1 + k, 1, 1);
        this.text(x, open ? `◆ ${p.price}` : '—', p.x + p.w / 2, p.y + p.h / 2 + 6, open ? C.ink : C.inkL);
        this.text(x, t('plot.' + p.kind), p.x + p.w / 2, p.y + p.h / 2 - 6, C.inkL);
        continue;
      }
      r(edge, p.x, p.y, p.w, p.h);
      r('#d8c89c', p.x + 1, p.y + 1, p.w - 2, p.h - 2);
      for (let i = 0; i < 14; i++) r('#c0b080', p.x + 3 + ((i * 17) % (p.w - 6)), p.y + 3 + ((i * 11) % (p.h - 6)), 1, 1);
      const s = st.shop;
      if (!s) {
        this.text(x, '+', p.x + p.w / 2, p.y + p.h / 2, C.inkL);
        continue;
      }
      const working = !E.unpaid && s.stock.length < E.shopCap(s);
      this.drawShop(x, p, s.kind, s.lvl, working);
      // The bar of the thing in hand.
      const k = Math.min(1, s.t / E.shopCycle(p.id, s));
      r(C.ink, p.x + 4, p.y + p.h - 6, p.w - 8, 4);
      r('#5a4a30', p.x + 5, p.y + p.h - 5, p.w - 10, 2);
      r(working ? '#e8b040' : C.red, p.x + 5, p.y + p.h - 5, Math.round((p.w - 10) * k), 2);
      for (let i = 0; i < s.lvl; i++) r(C.gold, p.x + 3 + i * 3, p.y + 3, 2, 2);
      if (s.stock.length) this.drawSack(x, p.x + p.w - 14, p.y + 2, s.stock.length, s.stock.length >= E.shopCap(s), blink);
    }
    // The house in the middle, with the apprentice's store.
    const hm = ESTATE.home;
    const he = this.sel === 'home' ? C.gold : this.hover === 'home' ? C.inkL : C.ink;
    r(he, hm.x, hm.y, hm.w, hm.h);
    r('#e0d0a8', hm.x + 1, hm.y + 1, hm.w - 2, hm.h - 2);
    r(C.ink, hm.x + 9, hm.y + 14, 30, 20);
    r('#a07850', hm.x + 10, hm.y + 15, 28, 18);
    for (let i = 0; i < 10; i++) r('#6a3a2a', hm.x + 7 + i, hm.y + 13 - i, 34 - 2 * i, 1);
    r(C.ink, hm.x + 21, hm.y + 25, 6, 8);
    r('#f0c060', hm.x + 13, hm.y + 19, 4, 4);
    r('#f0c060', hm.x + 31, hm.y + 19, 4, 4);
    r(C.ink, hm.x + 33, hm.y + 2, 3, 6);
    for (let k = 0; k < 3; k++) r('rgba(90,80,70,0.5)', hm.x + 33 + Math.sin(this.time * 2 + k) * 2, hm.y - 1 - k * 3 - ((this.time * 6) % 3), 2, 2);
    if (E.home.length) this.drawSack(x, hm.x + hm.w - 14, hm.y + 2, E.home.length, E.home.length >= BALANCE.estate.homeCap, blink);
    // The courier, with a sack over his shoulder when he carries anything.
    const c = E.courier;
    if (c) {
      const bob = c.to ? Math.abs(Math.sin(this.time * 10)) : 0;
      const X = c.x, Y = c.y - bob;
      r(C.ink, X - 2, Y - 9, 5, 11);
      r('#5a4a7a', X - 1, Y - 5, 3, 5);
      r('#d8a582', X - 1, Y - 8, 3, 3);
      r(C.ink, X - 1, Y, 1, 2);
      r(C.ink, X + 1, Y, 1, 2);
      if (c.bag.length) {
        r(C.ink, X + 1, Y - 9, 5, 5);
        r('#a8844a', X + 2, Y - 8, 3, 3);
      }
    }
    if (E.unpaid && blink) this.text(x, t('map.unpaid'), ESTATE.W / 2, 8, C.red);
    // Coins rising where something sold.
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t > 1.4) {
        this.pops.splice(i, 1);
        continue;
      }
      this.text(x, p.text, p.x, p.y - p.t * 14, p.t < 1 ? '#7a5a10' : 'rgba(122,90,16,0.5)');
    }
    this.renderPanel();
  }

  // ------------------------------------------------------------------ the panel

  private btn(act: string, arg: string, label: string, ok: boolean): string {
    return `<span class="btn${ok ? '' : ' off'}" data-act="${act}" data-arg="${arg}">${label}</span>`;
  }

  private stars(n: number): string {
    return `<span class="stars"><span class="on">${'★'.repeat(n)}</span><span class="off">${'★'.repeat(5 - n)}</span></span>`;
  }

  private renderPanel(): void {
    const g = this.game, E = g.estate, m = g.money;
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    let h = '';
    if (this.sel === 'home') {
      const st = E.home;
      h += `<h4>${t('map.home')}</h4><p>${t('map.homeDesc')}</p>`;
      h += `<div class="row">${t('map.store')}: <b>${st.length} / ${BALANCE.estate.homeCap}</b></div>`;
      if (!g.owned.apprentice) h += `<p class="dim">${t('map.noApp')}</p>`;
      h += this.btn('sell', 'home', `${t('map.sell')} · ◆ ${sum(st)}`, st.length > 0);
      // The courier.
      h += `<h4>${t('map.courier')}</h4>`;
      const c = E.courier;
      if (!c) {
        const cost = BALANCE.estate.courier.cost;
        h += `<p>${t('map.courierDesc')}</p>`;
        h += g.owned.apprentice ? this.btn('courier', '', `${t('map.hire')} · ◆ ${cost}`, m >= cost) : `<p class="dim">${t('map.noApp')}</p>`;
      } else {
        h += `<div class="row">${this.stars(c.lvl)}</div><div class="row">${t('map.courierNow', { bag: E.courierBag(), v: Math.round(E.courierSpeed()) })}</div>`;
        const uc = E.courierUpCost();
        h += uc ? this.btn('courierUp', '', `${t('map.raise')} · ◆ ${uc}`, m >= uc) : `<div class="row ok">${t('map.top')}</div>`;
      }
    } else if (this.sel === 'market') {
      h += `<h4>${t('map.market')}</h4><p>${t('map.marketDesc')}</p>`;
    } else {
      const d = E.def(this.sel)!, st = E.plots[this.sel];
      h += `<h4>${t('plot.' + d.kind)}</h4><p>${t('plot.' + d.kind + '.desc')}</p>`;
      if (!st.owned) {
        h += g.flags.season2 ? this.btn('plot', d.id, `${t('map.buyPlot')} · ◆ ${d.price}`, m >= d.price) : `<p class="dim">${t('map.afterGate')}</p>`;
      } else if (!st.shop) {
        h += `<div class="row">${t('map.build')}:</div>`;
        for (const k of SHOP_ORDER) {
          const K = SHOP_KINDS[k];
          h += `<div class="kind">${this.btn('build', k, `${t('shop.' + k)} · ◆ ${K.cost}`, m >= K.cost)}<p>${t('shop.' + k + '.desc')}</p></div>`;
        }
      } else {
        const s = st.shop;
        const q = E.shopQuality(s);
        const taught = E.taught[s.kind] >= 0;
        h += `<h4>${t('shop.' + s.kind)} ${this.stars(s.lvl)}</h4>`;
        h += `<div class="row">${t('map.hand')}: ${this.stars(Math.max(1, Math.round(q * 5)))}${taught ? '' : ` <span class="dim">${t('map.untaught')}</span>`}</div>`;
        h += `<p class="dim">${t('map.teach', { parts: SHOP_KINDS[s.kind].parts.map((p) => t('part.' + p)).join(', ') })}</p>`;
        h += `<div class="row">${t('map.makes', { v: E.shopValue(s, g.repMul()), s: Math.round(E.shopCycle(this.sel, s)) })}</div>`;
        h += `<div class="row">${t('map.store')}: <b>${s.stock.length} / ${E.shopCap(s)}</b></div>`;
        h += this.btn('sell', this.sel, `${t('map.sell')} · ◆ ${sum(s.stock)}`, s.stock.length > 0);
        const uc = E.shopUpCost(s);
        h += uc ? `<div class="row">${t('map.next')}</div>` + this.btn('up', this.sel, `${t('map.raise')} · ◆ ${uc}`, m >= uc) : `<div class="row ok">${t('map.top')}</div>`;
        h += `<div class="row dim">${t('map.upkeepOne', { n: SHOP_KINDS[s.kind].upkeep * s.lvl })}</div>`;
      }
    }
    const up = E.upkeep();
    h += `<div class="foot">◆ ${m}${up ? ` · ${t('map.upkeep', { n: up })}` : ''}${E.unpaid ? `<div class="bad">${t('map.unpaid')}</div>` : ''}</div>`;
    if (h !== this.panelHtml) {
      this.panelHtml = h;
      this.panel.innerHTML = h;
    }
  }
}
