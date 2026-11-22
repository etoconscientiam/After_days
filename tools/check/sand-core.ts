// Checks of the falling-sand core (merge stage 1). No game, no DOM: the grid, the physics in both modes, pressure
// and transformations, the conveyor into the archive, marker beds.
// Usage: npx tsx tools/check/sand-core.ts        (exit code 1 if a check fails)
import { CFG, M, NMAT, TransformRule } from '../../src/config';
import { Grid, GW, KIND, K_ROCK, K_MARKER } from '../../src/world/Grid';
import { Archive } from '../../src/world/Archive';
import { stepFull, dropPile, settleAll, Rng, Water } from '../../src/core/sand';
import { geoTick, sinkStep, overload, GeoEnv, SinkState } from '../../src/core/pressure';
import { coat } from '../../src/core/beds';

const S = CFG.B.sand;
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${name}: ${detail}`);
};

function rng(seed: number): Rng {
  let s = seed >>> 0;
  return { next: () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } };
}
const hash = (a: Uint8Array) => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
const water: Water = { col: new Uint8Array(GW).map((_, x) => (x < 30 ? 1 : 0)), level: 60 };
const mix = [{ m: M.dust, w: 3 }, { m: M.sand, w: 2 }, { m: CFG.matIndex.clay, w: 1 }];

function env(r: Rng, dy: number, counter: { n: number }): GeoEnv {
  return {
    rng: r, dy, speed: 1, P0: 0, pressMul: 1, T0: 15, gradMul: 1,
    ruleAllowed: (rule: TransformRule) => !rule.world && !rule.rankReq,
    heatAt: () => 0, waterAt: () => false, marine: (x) => x < 30, finger: null,
    onTransform: () => { counter.n++; }, onFossilRoll: () => {},
  };
}

/** A series of piles at fixed columns; full mode lets them fall between taps like a player would. */
function piles(fast: boolean, seed: number, count: number, n = 50): { g: Grid; placed: number; steps: number } {
  const g = new Grid();
  g.reset();
  const r = rng(seed), where = rng(999);
  let placed = 0, steps = 0;
  for (let k = 0; k < count; k++) {
    const cx = 6 + Math.floor(where.next() * (GW - 12));
    placed += dropPile(g, r, water, { cx, n, mix, birth: 4000 + k, y0: 2 }, fast);
    if (!fast) for (let s = 0; s < 30; s++, steps++) stepFull(g, r, water, steps);
  }
  if (!fast) steps += settleAll(g, r, water);
  return { g, placed, steps };
}

const meanHeight = (g: Grid) => { let s = 0; for (let x = 0; x < GW; x++) s += g.sinkRow + 1 - g.tops[x]; return s / GW; };
const smooth = (g: Grid, R = 6) => Array.from({ length: GW }, (_, x) => { let s = 0, n = 0; for (let d = -R; d <= R; d++) { const xx = x + d; if (xx >= 0 && xx < GW) { s += g.sinkRow + 1 - g.tops[xx]; n++; } } return s / n; });

// 1) mass, determinism
{
  const a = piles(false, 7, 60), b = piles(false, 7, 60);
  check('mass (full mode)', a.g.particles() === a.placed, `${a.placed} placed, ${a.g.particles()} in the grid`);
  check('determinism', hash(a.g.mat) === hash(b.g.mat) && hash(a.g.look) === hash(b.g.look), `hash ${hash(a.g.mat).toString(16)} / ${hash(b.g.mat).toString(16)}`);
  let air = 0;
  for (let y = 0; y < a.g.floor - 1; y++) for (let x = 0; x < GW; x++) if (a.g.mat[y * GW + x] && !a.g.mat[(y + 1) * GW + x]) air++;
  check('settled: nothing floats', air === 0, `${air} particles over a gap after settling (${a.steps} steps)`);
}

// 2) full and fast modes make the same strata
{
  const f = piles(false, 11, 120), q = piles(true, 11, 120);
  const hf = meanHeight(f.g), hq = meanHeight(q.g);
  const sf = smooth(f.g), sq = smooth(q.g);
  let dev = 0; for (let x = 0; x < GW; x++) dev += Math.abs(sf[x] - sq[x]); dev /= GW;
  check('fast = full: mean height', Math.abs(hf - hq) <= 2, `full ${hf.toFixed(1)} rows, fast ${hq.toFixed(1)} rows`);
  check('fast = full: profile', dev <= 4, `mean |difference| of the smoothed profile ${dev.toFixed(2)} rows`);
  check('mass (fast mode)', q.g.particles() === q.placed, `${q.placed} placed, ${q.g.particles()} in the grid`);
}

// 3) transformations follow transforms.json: sand in the sea under ≥5 MPa becomes sandstone, the top stays sand
{
  const g = new Grid(); g.reset();
  const r = rng(3);
  for (let y = g.floor - 1; y > g.floor - 1 - 110; y--) for (let x = 0; x < 28; x++) g.put(x, y, M.sand, 0, 5000);
  g.computeTops();
  const c = { n: 0 };
  for (let t = 0; t < 10; t++) geoTick(g, env(r, 300, c));
  let deep = 0, shallow = 0;
  const ss = CFG.matIndex.sandstone;
  for (let x = 0; x < 28; x++) {
    for (let y = g.sinkRow - 20; y <= g.sinkRow; y++) if (g.mat[y * GW + x] === ss) deep++;
    for (let y = g.tops[x]; y < g.tops[x] + 20; y++) if (g.mat[y * GW + x] === ss) shallow++;
  }
  const pAtBottom = 110 * CFG.materials[M.sand].density * S.pressurePerParticle;
  check('rules: deep sand → sandstone', deep > 28 * 18, `${deep} of ${28 * 21} cells at the bottom (P≈${pAtBottom.toFixed(1)} MPa)`);
  check('rules: shallow sand stays', shallow === 0, `${shallow} sandstone cells in the top 20 rows`);
  // land columns (no water): the same sand never turns
  const g2 = new Grid(); g2.reset();
  for (let y = g2.floor - 1; y > g2.floor - 1 - 110; y--) for (let x = 40; x < 60; x++) g2.put(x, y, M.sand, 0, 5000);
  g2.computeTops();
  for (let t = 0; t < 10; t++) geoTick(g2, env(r, 300, c));
  let land = 0; for (let i = 0; i < g2.N; i++) if (g2.mat[i] === ss) land++;
  check('rules: sand on land needs water', land === 0, `${land} sandstone cells on land`);
}

// 4) the conveyor holds the strata steady at the line; nothing is lost into the archive.
//    Tempo of epoch I: 150 game years a second, a pile a second plus a little more.
function conveyor(pilesPerSec: number, yps: number) {
  const g = new Grid(); g.reset();
  const arc = new Archive();
  const r = rng(21), where = rng(5);
  const st: SinkState = { acc: 0, rows: 0 };
  const c = { n: 0 };
  let placed = 0, acc = 0, year = 4000;
  const loads: number[] = [];
  for (let sec = 0; sec < 900; sec++) {
    acc += pilesPerSec;
    for (; acc >= 1; acc--) placed += dropPile(g, r, water, { cx: 4 + Math.floor(where.next() * (GW - 8)), n: 60, mix, birth: year }, true);
    year += yps;
    geoTick(g, env(r, yps, c));
    sinkStep(g, st, 1, (gg, y) => arc.addRow(gg, y));
    if (sec >= 600) loads.push(overload(g));
  }
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  return { g, arc, st, c, placed, mean, lo: Math.min(...loads), hi: Math.max(...loads) };
}
{
  const { g, arc, st, c, placed, mean, lo, hi } = conveyor(1.2, 150);
  check('conveyor: level held at the line', mean >= 0.95 && mean <= 1.3 && hi - lo < 0.15, `overload over the last 300 s: mean ${mean.toFixed(2)}, ${lo.toFixed(2)}…${hi.toFixed(2)}; ${st.rows} rows sunk`);
  const tot = arc.totals();
  let arcCells = 0; for (let m = 0; m < NMAT; m++) arcCells += tot[m];
  const inArc = arcCells / S.cellsPerParticle;
  check('conveyor: mass kept (grid + archive)', Math.abs(g.particles() + inArc - placed) < 0.5, `${placed} placed = ${g.particles()} in the grid + ${inArc.toFixed(1)} in the archive`);
  let ordered = true;
  for (let i = 1; i < arc.layers.length; i++) if (arc.layers[i].y0 > arc.layers[i - 1].y1 + 1e-6) ordered = false;
  check('archive: layers in order of years', ordered && arc.layers.length > 0, `${arc.layers.length} layers, years ${Math.round(arc.layers[arc.layers.length - 1]?.y0)}…${Math.round(arc.layers[0]?.y1)}`);
  let rock = 0, all = 0;
  for (let y = g.sinkRow - 5; y <= g.sinkRow; y++) for (let x = 0; x < GW; x++) { const k = KIND[g.mat[y * GW + x]]; if (k) { all++; if (k === K_ROCK) rock++; } }
  check('pressure: the bottom turns to rock', rock > all * 0.15, `${rock} of ${all} particles in the bottom rows are rock (${c.n} transformations)`);
  // a much harder tapper: the level rises a little and holds, it does not run away
  const hard = conveyor(4, 150);
  check('conveyor: holds under heavy input', hard.mean < 1.6 && hard.hi - hard.lo < 0.2, `4 piles/s: overload mean ${hard.mean.toFixed(2)}, ${hard.lo.toFixed(2)}…${hard.hi.toFixed(2)}`);
}

// 5) a marker bed drapes the surface and moves nothing
{
  const { g } = piles(true, 31, 80);
  const before = Uint8Array.from(g.mat, (m) => (m ? 1 : 0));
  const n = coat(g, M.ochre);
  let same = true; for (let i = 0; i < g.N; i++) if ((g.mat[i] ? 1 : 0) !== before[i]) same = false;
  let markers = 0, topsMarked = 0;
  for (let i = 0; i < g.N; i++) if (KIND[g.mat[i]] === K_MARKER) markers++;
  for (let x = 0; x < GW; x++) if (g.tops[x] < g.floor && KIND[g.mat[g.tops[x] * GW + x]] === K_MARKER) topsMarked++;
  check('bed: nothing moves', same, `${n} particles coated`);
  check('bed: covers every surface column', topsMarked >= GW - 2, `${topsMarked} of ${GW} columns have the bed on top (${markers} marker particles)`);
}

// 6) speed
{
  const { g } = piles(true, 41, 150);
  const r = rng(9), where = rng(10);
  let t0 = performance.now(), steps = 0;
  for (let k = 0; k < 40; k++) {
    dropPile(g, r, water, { cx: 6 + Math.floor(where.next() * (GW - 12)), n: 60, mix, birth: 9000 }, false);
    for (let s = 0; s < 5; s++, steps++) stepFull(g, r, water, steps);
  }
  const msStep = (performance.now() - t0) / steps;
  const g2 = new Grid(); g2.reset();
  const st: SinkState = { acc: 0, rows: 0 }, arc = new Archive(), c = { n: 0 };
  t0 = performance.now();
  for (let k = 0; k < 1000; k++) {
    dropPile(g2, r, water, { cx: 6 + Math.floor(where.next() * (GW - 12)), n: 60, mix, birth: 9000 + k }, true);
    if (k % 10 === 9) { geoTick(g2, env(r, 10, c)); sinkStep(g2, st, 3, (gg, y) => arc.addRow(gg, y)); }
  }
  const msFast = performance.now() - t0;
  const msGeo = (() => { const t = performance.now(); for (let k = 0; k < 20; k++) geoTick(g, env(r, 1, c)); return (performance.now() - t) / 20; })();
  check('speed: full physics step', msStep < 2, `${msStep.toFixed(3)} ms per step (with piles falling)`);
  check('speed: geology tick', msGeo < 4, `${msGeo.toFixed(3)} ms per tick (full grid)`);
  check('speed: fast mode', msFast < 400, `1000 piles + geology + conveyor in ${msFast.toFixed(0)} ms`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
