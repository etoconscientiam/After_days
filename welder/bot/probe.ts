/**
 * Weld one seam at a fixed speed multiple and arc length and print what comes out.
 *   npm run probe -- bars        (I=0.8 also: I=0.8 npm run probe -- axle)
 */
import { Bench, emptyTorch, stepBench, WeldCtx } from '../src/sim/weld';
import { DATA } from '../src/data';
import { BALANCE } from '../src/data/balance';
import { Bus } from '../src/core/bus';
import { Rng } from '../src/core/rng';
import { baseStats } from '../src/sim/stats';
import { partQuality, idealSpeed } from '../src/sim/quality';
import type { SimEvents } from '../src/sim/events';

export function probe(partId: string, vMul: number, L: number, I = 1, lat = 0) {
  const bus = new Bus<SimEvents>();
  const ctx: WeldCtx = { dt: BALANCE.dt, I, stats: baseStats(), data: DATA, weld: new Rng(1), spatter: new Rng(2), power: new Rng(3), bus };
  const b = new Bench('player');
  const part = DATA.parts[partId];
  b.load({ uid: 1, part: partId, customer: 'x', reward: 1, req: {}, simple: true, urgent: false }, part);
  const sr = b.seams[0];
  const t = emptyTorch();
  const v = idealSpeed(part.thick, I) * vMul;
  let s = -6;
  const pt = { x: 0, z: 0, tx: 1, tz: 0 };
  let maxH = 0, steps = 0;
  t.has = true; t.press = true; t.forceL = L;
  while (s < sr.len + 2 && steps < 60 * 120) {
    if (b.arc.lit) s += v * ctx.dt; else s += 25 * ctx.dt;
    sr.pointAt(Math.min(s, sr.len), pt);
    t.x = pt.x - pt.tz * lat; t.z = pt.z + pt.tx * lat;
    stepBench(b, t, ctx);
    if (b.arc.pool > maxH) maxH = b.arc.pool;
    steps++;
  }
  let m = 0, f = 0, holes = 0;
  for (let i = 1; i < sr.n - 1; i++) { m += sr.metal[i]; f += sr.peak[i]; holes += sr.hole[i]; }
  m /= sr.n - 2; f /= sr.n - 2;
  const q = partQuality(b.seams, part.thick);
  if (process.env.GAPS) { const g: string[] = []; for (let i = 1; i < sr.n - 1; i++) if (sr.metal[i] < BALANCE.weld.fillMin) g.push(i + ":" + sr.metal[i].toFixed(2)); console.log("n=" + sr.n, g.join(" ")); }
  return { v: v.toFixed(1), pool: b.arc.pool.toFixed(2), maxH: maxH.toFixed(2), metal: m.toFixed(2), fuse: f.toFixed(2), holes, gaps: sr.gaps(BALANCE.weld.fillMin), ripples: sr.count, q: q.toFixed(2) };
}

const part = process.argv[2] ?? 'bars';
const Is = process.env.I ? [+process.env.I] : [1, 0.8];
for (const I of Is)
  for (const L of [2.5, 4.2, 1.3])
    for (const vm of [0.4, 0.6, 0.8, 1, 1.25, 1.5, 2])
      console.log(`I=${I} L=${L} v×${vm}`.padEnd(20), JSON.stringify(probe(part, vm, L, I)));
