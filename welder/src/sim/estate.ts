import { BALANCE } from '../data/balance';
import { ESTATE, SHOP_KINDS, ShopKind, PlotDef } from '../data/estate';
import { payFor } from './quality';

/** A workshop on a plot: its trade, its level (1..5), how far the thing in hand is, what waits to be sold. */
export interface Shop {
  kind: ShopKind;
  lvl: number;
  /** Seconds into the thing being made. */
  t: number;
  /** What each finished thing will fetch. */
  stock: number[];
}

export interface PlotState {
  owned: boolean;
  shop: Shop | null;
}

/** The courier: where he is on the plan, what he carries, where he is going ('' standing). */
export interface Courier {
  lvl: number;
  x: number;
  y: number;
  bag: number[];
  to: string;
}

/** Where on the plan a place is ('home', 'market' or a plot id): its middle. */
export function placeAt(id: string): { x: number; y: number } {
  if (id === 'market') return ESTATE.market;
  const r: { x: number; y: number; w: number; h: number } = id === 'home' ? ESTATE.home : ESTATE.plots.find((p) => p.id === id)!;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * The land round the workshop, simulated: the house's store (the apprentice's jobs), plots and the
 * workshops on them making things by themselves, pay days, and the courier who carries things to market.
 * Money changes go through `money(delta)` so the game can tell everyone.
 */
export class Estate {
  home: number[] = [];
  plots: Record<string, PlotState> = Object.fromEntries(ESTATE.plots.map((p) => [p.id, { owned: false, shop: null }]));
  /** How well you have shown each trade at your bench (0..1), -1 not yet. */
  taught: Record<ShopKind, number> = { wheel: -1, pots: -1, arms: -1, relic: -1 };
  courier: Courier | null = null;
  payT = 0;
  unpaid = false;

  def(id: string): PlotDef | undefined {
    return ESTATE.plots.find((p) => p.id === id);
  }

  shopCap(s: Shop): number {
    const E = BALANCE.estate;
    return E.shopCap + E.capPer * (s.lvl - 1);
  }

  /** Seconds a thing takes at this workshop. */
  shopCycle(id: string, s: Shop): number {
    const E = BALANCE.estate;
    const river = this.def(id)?.kind === 'river' ? E.riverSpeed : 1;
    return SHOP_KINDS[s.kind].cycle / ((1 + E.levelSpeed * (s.lvl - 1)) * river);
  }

  /** How well its things come out: as you showed the trade, a little better per level. */
  shopQuality(s: Shop): number {
    const E = BALANCE.estate;
    const base = this.taught[s.kind] >= 0 ? this.taught[s.kind] : E.untaught;
    return Math.min(1, base + E.levelQuality * (s.lvl - 1));
  }

  /** What one thing from it fetches. */
  shopValue(s: Shop, rep: number): number {
    const E = BALANCE.estate;
    return Math.max(1, Math.round(payFor(SHOP_KINDS[s.kind].base, this.shopQuality(s)) * (1 + E.levelValue * (s.lvl - 1)) * rep));
  }

  /** What raising it a level costs (0 at the top). */
  shopUpCost(s: Shop): number {
    if (s.lvl >= 5) return 0;
    return Math.round(SHOP_KINDS[s.kind].cost * BALANCE.estate.levelCost[s.lvl - 1]);
  }

  courierUpCost(): number {
    const c = this.courier;
    if (!c || c.lvl >= 5) return 0;
    return BALANCE.estate.courier.upCost[c.lvl - 1];
  }

  courierBag(): number {
    const C = BALANCE.estate.courier;
    return C.bag + C.bagPer * ((this.courier?.lvl ?? 1) - 1);
  }

  courierSpeed(): number {
    const C = BALANCE.estate.courier;
    return C.speed * (1 + C.speedPer * ((this.courier?.lvl ?? 1) - 1));
  }

  /** What everything costs on a pay day. */
  upkeep(): number {
    let u = 0;
    for (const p of Object.values(this.plots)) if (p.shop) u += SHOP_KINDS[p.shop.kind].upkeep * p.shop.lvl;
    if (this.courier) u += BALANCE.estate.courier.wage * this.courier.lvl;
    return u;
  }

  /** What waits to be sold at a place. */
  stockAt(id: string): number[] {
    if (id === 'home') return this.home;
    return this.plots[id]?.shop?.stock ?? [];
  }

  /** You showed a trade at your bench: its workshops learn from it (the last few jobs count most). */
  teach(kind: ShopKind, q: number): void {
    const t = this.taught[kind];
    this.taught[kind] = t < 0 ? q : t * 0.5 + q * 0.5;
  }

  /**
   * One step: pay day, the workshops at work, the courier on his round. `money` takes a change of coins
   * (and returns false if it can't be paid); `sold` is told of every sale.
   */
  step(dt: number, rep: number, money: () => number, pay: (delta: number) => void, sold: (amount: number, at: string) => void, changed: () => void): void {
    const E = BALANCE.estate;
    const due = this.upkeep();
    if (due > 0) {
      this.payT += dt;
      if (this.payT >= (this.unpaid ? E.retry : E.payEvery)) {
        this.payT = 0;
        if (money() >= due) {
          pay(-due);
          if (this.unpaid) changed();
          this.unpaid = false;
        } else if (!this.unpaid) {
          this.unpaid = true;
          changed();
        }
      }
    }
    if (this.unpaid) return;
    for (const [id, p] of Object.entries(this.plots)) {
      const s = p.shop;
      if (!s || s.stock.length >= this.shopCap(s)) continue;
      s.t += dt;
      const cyc = this.shopCycle(id, s);
      if (s.t >= cyc) {
        s.t -= cyc;
        s.stock.push(this.shopValue(s, rep));
        changed();
      }
    }
    this.stepCourier(dt, sold, changed);
  }

  /**
   * The courier's round: to the place with the most waiting, then on to the next while the bag has room,
   * then to market to sell it all; then again.
   */
  private stepCourier(dt: number, sold: (amount: number, at: string) => void, changed: () => void): void {
    const c = this.courier;
    if (!c) return;
    const bag = this.courierBag();
    if (!c.to) {
      const next = this.nextPickup(c);
      if (next) c.to = next;
      else if (c.bag.length) c.to = 'market';
      else return;
    }
    const tgt = placeAt(c.to);
    const dx = tgt.x - c.x, dy = tgt.y - c.y;
    const d = Math.hypot(dx, dy);
    const step = this.courierSpeed() * dt;
    if (d > step) {
      c.x += (dx / d) * step;
      c.y += (dy / d) * step;
      return;
    }
    c.x = tgt.x;
    c.y = tgt.y;
    if (c.to === 'market') {
      const sum = c.bag.reduce((a, v) => a + v, 0);
      c.bag = [];
      c.to = '';
      if (sum) sold(sum, 'market');
      return;
    }
    const st = this.stockAt(c.to);
    const take = Math.min(st.length, bag - c.bag.length);
    c.bag.push(...st.splice(0, take));
    if (take) changed();
    c.to = c.bag.length < bag ? (this.nextPickup(c) ?? 'market') : 'market';
    if (!c.bag.length) c.to = '';
  }

  /** The place with the most waiting (nearest first among equals), if anything waits. */
  private nextPickup(c: Courier): string | null {
    let best: string | null = null, bestN = 0, bestD = Infinity;
    for (const id of ['home', ...Object.keys(this.plots)]) {
      const n = this.stockAt(id).length;
      if (!n) continue;
      const p = placeAt(id);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (n > bestN || (n === bestN && d < bestD)) {
        best = id;
        bestN = n;
        bestD = d;
      }
    }
    return best;
  }

  /** Sell everything waiting at a place (from the map, by hand). Returns the coins. */
  sellAt(id: string): number {
    const st = this.stockAt(id);
    const sum = st.reduce((a, v) => a + v, 0);
    st.length = 0;
    return sum;
  }

  // ------------------------------------------------------------------ save

  save(): EstateSave {
    return {
      home: this.home,
      plots: Object.fromEntries(Object.entries(this.plots).filter(([, p]) => p.owned).map(([id, p]) => [id, p.shop ? [p.shop.kind, p.shop.lvl, Math.round(p.shop.t * 10) / 10, p.shop.stock] : 0])),
      taught: this.taught,
      courier: this.courier ? this.courier.lvl : 0,
    };
  }

  load(d: EstateSave | undefined): void {
    if (!d) return;
    this.home = [...(d.home ?? [])];
    for (const [id, v] of Object.entries(d.plots ?? {})) {
      if (!this.plots[id]) continue;
      this.plots[id].owned = true;
      if (Array.isArray(v) && SHOP_KINDS[v[0] as ShopKind]) this.plots[id].shop = { kind: v[0] as ShopKind, lvl: v[1], t: v[2], stock: [...v[3]] };
    }
    this.taught = { ...this.taught, ...(d.taught ?? {}) };
    if (d.courier) {
      const h = placeAt('home');
      this.courier = { lvl: d.courier, x: h.x, y: h.y, bag: [], to: '' };
    }
  }
}

export interface EstateSave {
  home: number[];
  plots: Record<string, [string, number, number, number[]] | 0>;
  taught: Record<string, number>;
  courier: number;
}
