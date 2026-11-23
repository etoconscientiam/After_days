// Oil and gas move. Lighter than the water in the pores, they creep up through porous beds (loose sediment,
// sandstone, siltstone, limestone, chalk, coal…), slowly through mudstone, and stop under a seal — clay, shale,
// slate, crystalline rock, or a fossil they do not push aside: a trap. Under a seal they slip up a slope to its highest point (the top
// of a fold), so oil gathers in pockets and gas over it. Gas rises faster and through oil. Gas that reaches the
// surface seeps out (a puff of bubbles, the particle is gone); so does oil, as a dark slick.
// Moving is a swap with the grain above, so the bed it passes keeps its particles, one row lower each.
//
// Water is buried too: now and then a stretch of shallow water leaves a lens of water on its floor, the next
// laminae bury it and it sinks with the strata. Deep enough, the pressure breaks it out: the whole lens goes up
// through the strata above its top as a geyser, the empty lens collapses (the ground over it sags) and sinter falls
// around the vent. Only on screen, not in the headless run.
import { CFG, M } from '../config';
import { rainOne } from './sand';
import type { Game } from './game';
import { GW, KIND, K_NONE, K_SOLID, P_FOSSIL, P_RARE } from '../world/Grid';

const F = CFG.B.sand.fluids;
const LZ = CFG.B.sand.lenses;

/** The chance a fluid passes into a grain of this material: 1 porous, tightMul tight (mudstone), 0 a seal. */
const POROUS = new Float32Array(CFG.materials.length);
CFG.materials.forEach((m, i) => {
  const k = KIND[i];
  POROUS[i] = k === K_NONE || k === K_SOLID || F.seals.includes(m.id) ? 0 : F.tight.includes(m.id) ? F.tightMul : 1;
});

/** One tick of migration over the visible strata (top to bottom, so a particle moves once a tick). */
function fluidTick(g: Game): number {
  const grid = g.grid, mat = grid.mat, flags = grid.flags, rng = g.rng;
  const OIL = M.oil, GAS = M.gas;
  let moved = 0;
  const WATER = M.water;
  // oil and gas go round a lens of buried water (they would scatter it drop by drop)
  const pass = (i: number): boolean => POROUS[mat[i]] > 0 && (POROUS[mat[i]] >= 1 || rng.next() < POROUS[mat[i]]) && mat[i] !== GAS && mat[i] !== OIL && mat[i] !== WATER && !(flags[i] & (P_FOSSIL | P_RARE));
  for (let y = 1; y < grid.sinkRow; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x, m = mat[i];
      if (m !== OIL && m !== GAS) continue;
      const gas = m === GAS;
      if (rng.next() > (gas ? F.gasChance : F.oilChance)) continue;
      const up = i - GW, mu = mat[up];
      // at the surface it seeps out: gas as bubbles, oil as a dark slick (it would otherwise climb every new
      // lamina and pile up as tar)
      if (!mu) {
        if (y <= grid.surf[x] + 1) {
          grid.clear(i);
          moved++;
          if (!g.headless) g.bus.emit('seep', { x, y, oil: !gas });
        }
        continue;
      }
      // gas rises through oil
      if (gas && mu === OIL) { grid.swap(i, up); moved++; continue; }
      if (pass(up)) { grid.swap(i, up); moved++; continue; }
      // under a seal: up a slope if one side is open (it takes a while to find it), else along under it now
      // and then — so even a short lens of clay holds a little pocket for a time
      const d = rng.next() < 0.5 ? -1 : 1;
      let done = false;
      if (rng.next() < F.slopeChance) for (const dx of [d, -d]) {
        const xx = x + dx;
        if (xx < 0 || xx >= GW) continue;
        const j = up + dx;
        if (pass(j)) { grid.swap(i, j); moved++; done = true; break; }
      }
      if (done || rng.next() > F.sideChance) continue;
      const xx = x + d;
      if (xx < 0 || xx >= GW) continue;
      const j = i + d;
      // along only where the seal goes on above (a fluid does not slide down)
      if (pass(j) && POROUS[mat[j - GW]] < 1) { grid.swap(i, j); moved++; }
    }
  }
  return moved;
}

/** Migration for dt seconds: ticks at F.tickHz, a few at most per call; then buried water. */
export function fluidStep(g: Game, dt: number): void {
  g.fluidAcc = Math.min(g.fluidAcc + dt * F.tickHz, 4);
  while (g.fluidAcc >= 1) {
    g.fluidAcc -= 1;
    fluidTick(g);
  }
  if (g.headless || g.state.phase !== 'play') return;
  g.lensT -= dt;
  if (g.lensT <= 0) {
    g.lensT = LZ.every * (0.5 + g.rng.next());
    layLens(g);
  }
  g.eruptT += dt;
  if (g.eruptT >= 0.5) { checkEruptions(g, g.eruptT); g.eruptT = 0; }
}

/** How many water particles the strata hold now. */
function waterCount(g: Game): number {
  const mat = g.grid.mat, W = M.water;
  let n = 0;
  for (let i = 0; i < g.grid.sinkRow * GW; i++) if (mat[i] === W) n++;
  return n;
}

/** A stretch of shallow water leaves a lens on its floor. */
function layLens(g: Game): void {
  const grid = g.grid, col = g.water.col, level = g.water.level;
  const shallow = (x: number) => col[x] === 1 && grid.surf[x] - level >= 1 && grid.surf[x] - level <= LZ.shallowRows;
  const xs: number[] = [];
  for (let x = 0; x < GW; x++) if (shallow(x)) xs.push(x);
  if (!xs.length || waterCount(g) >= LZ.maxParticles) return;
  const x0 = xs[Math.floor(g.rng.next() * xs.length)];
  const w = LZ.wMin + Math.floor(g.rng.next() * (LZ.wMax - LZ.wMin + 1));
  let a = x0, b = x0;
  while (b - a + 1 < w) {
    const r = b + 1 < GW && shallow(b + 1), l = a > 0 && shallow(a - 1);
    if (!r && !l) break;
    if (r && (!l || g.rng.next() < 0.5)) b++; else a--;
  }
  if (b - a < 2) return;
  const year = g.run.year;
  for (let x = a; x <= b; x++) {
    const mid = Math.min(x - a, b - x) >= 1 ? 2 : 1;
    for (let k = 0; k < mid; k++) grid.put(x, grid.surf[x] - 1, M.water, (g.rng.next() * 256) | 0, year);
  }
}

/** Deep lenses break out now and then (a lone drop does not: it sinks on to the thing). */
function checkEruptions(g: Game, dt: number): void {
  const grid = g.grid, mat = grid.mat, WATER = M.water;
  const deep: number[] = [];
  let maxD = 0;
  for (let y = 0; y < grid.sinkRow; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (mat[i] !== WATER) continue;
      const d = y - grid.surf[x];
      if (d >= LZ.eruptDepth) { deep.push(i); if (d > maxD) maxD = d; }
    }
  }
  if (!deep.length) return;
  const p = (LZ.eruptChance + (maxD - LZ.eruptDepth) * LZ.eruptPerRow) * dt;
  if (g.rng.next() >= p) return;
  const i0 = deep[Math.floor(g.rng.next() * deep.length)];
  if (lensOf(g, i0).length >= LZ.minLens) erupt(g, i0);
}

/** The water cells connected to cell i0. */
function lensOf(g: Game, i0: number): number[] {
  const grid = g.grid, mat = grid.mat, WATER = M.water;
  const seen = new Set<number>([i0]);
  const stack = [i0], cells: number[] = [];
  while (stack.length) {
    const i = stack.pop()!;
    cells.push(i);
    const x = i % GW;
    for (const j of [i - GW, i + GW, x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1]) {
      if (j < 0 || j >= grid.sinkRow * GW || seen.has(j) || mat[j] !== WATER) continue;
      seen.add(j); stack.push(j);
    }
  }
  return cells;
}

/** The lens that holds cell i breaks out through the strata above its top. */
export function erupt(g: Game, i0: number): number {
  const grid = g.grid;
  const cells = lensOf(g, i0);
  // the vent: above the top of the lens
  let top = cells[0];
  for (const i of cells) if (((i / GW) | 0) < ((top / GW) | 0)) top = i;
  const vx = top % GW, y0 = (top / GW) | 0, y1 = grid.surf[vx];
  for (const i of cells) grid.clear(i);
  const n = cells.length;
  const k = Math.min(LZ.sinterMax, Math.ceil(n / LZ.sinterPer));
  for (let s = 0; s < k; s++) {
    const x = Math.max(0, Math.min(GW - 1, vx + Math.round((g.rng.next() - 0.5) * 4)));
    rainOne(grid, g.rng, g.water, x, M.sinter, g.run.year, false);
  }
  if (!g.headless) g.bus.emit('geyser', { x: vx, y0, y1, n });
  return n;
}
