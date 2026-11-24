// Epoch orders (brief 5, В3): every era draws one or two small tasks from config/orders.json.
// They push toward layer recipes, so most need the Geologist view and the press.
import { CFG, OrderDef } from '../config';
import type { Game } from './game';
import type { OrderState } from './state';

export function orderDef(id: string): OrderDef | undefined { return CFG.orders.pool.find((o) => o.id === id); }

/** The value an order counts from (its baseline is stored when it is drawn). */
function measure(g: Game, d: OrderDef): number {
  const r = g.run;
  switch (d.type) {
    case 'formed': return r.formed?.[d.rock!] ?? 0;
    case 'rockEarned': return r.rocksEarned[d.rock!] ?? 0;
    case 'museum': { const m = g.legacy.museum[d.species!]; return m ? m.common + m.rare : 0; }
    case 'insectAmber': return r.insectAmber;
    case 'pressMoved': return r.pressMoved;
  }
  return 0;
}

export function orderProgress(g: Game, o: OrderState): { have: number; need: number } {
  const d = orderDef(o.id);
  if (!d) return { have: 0, need: 1 };
  return { have: o.done ? d.n : Math.max(0, Math.min(d.n, measure(g, d) - o.start)), need: d.n };
}

/** Draw this era's orders (once per era). */
export function drawOrders(g: Game): void {
  const r = g.run;
  if (r.ordersEra === r.era) return;
  r.ordersEra = r.era;
  const done = new Set(r.orders.filter((o) => o.done).map((o) => o.id));
  r.orders = r.orders.filter((o) => !o.done && (orderDef(o.id)?.eras[1] ?? -1) >= r.era);   // unfinished ones carry over
  // the press is asked for only once it has been shown (a hint at the compaction line, main.ts)
  const press = !!g.legacy.firsts.pressTaught;
  const pool = CFG.orders.pool.filter((d) => r.era >= d.eras[0] && r.era <= d.eras[1] && !done.has(d.id) && !r.orders.some((o) => o.id === d.id) && (press || d.type !== 'pressMoved'));
  const [a, b] = CFG.orders.perEra;
  let n = a + Math.floor(g.rng.next() * (b - a + 1)) - r.orders.length;
  while (n-- > 0 && pool.length) {
    const d = pool.splice(Math.floor(g.rng.next() * pool.length), 1)[0];
    r.orders.push({ id: d.id, start: measure(g, d), done: false });
  }
}

/** Check orders; pay rewards for the finished ones. */
export function checkOrders(g: Game): void {
  for (const o of g.run.orders) {
    if (o.done) continue;
    const d = orderDef(o.id);
    if (!d) continue;
    if (measure(g, d) - o.start < d.n) continue;
    o.done = true;
    const rw = d.reward;
    if (rw.density) { g.meta.density += rw.density; }
    if (rw.rock) {
      // a special material: the named one, or the one the player has least of (none known yet: density)
      const rock = rw.rock === 'least' ? g.leastSpecial() : rw.rock;
      if (rock) g.addSpecial(rock, (rw.n ?? 5) * g.specialUnit(rock));
      else g.meta.density += 1;
    }
    g.bus.emit('orderDone', { id: o.id });
  }
}
