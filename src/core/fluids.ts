// Oil and gas move. Lighter than the water in the pores, they creep up through porous beds (loose sediment,
// sandstone, siltstone, limestone, chalk, coal…), slowly through mudstone, and stop under a seal — clay, shale,
// slate, crystalline rock, or a fossil they do not push aside: a trap. Under a seal they slip up a slope to its highest point (the top
// of a fold), so oil gathers in pockets and gas over it. Gas rises faster and through oil. Gas that reaches the
// surface seeps out (a puff of bubbles, the particle is gone); so does oil, as a dark slick.
// Moving is a swap with the grain above, so the bed it passes keeps its particles, one row lower each.
import { CFG, M } from '../config';
import type { Game } from './game';
import { GW, KIND, K_NONE, K_SOLID, P_FOSSIL, P_RARE } from '../world/Grid';

const F = CFG.B.sand.fluids;

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
  const pass = (i: number): boolean => POROUS[mat[i]] > 0 && (POROUS[mat[i]] >= 1 || rng.next() < POROUS[mat[i]]) && mat[i] !== GAS && mat[i] !== OIL && !(flags[i] & (P_FOSSIL | P_RARE));
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

/** Migration for dt seconds: ticks at F.tickHz, a few at most per call. */
export function fluidStep(g: Game, dt: number): void {
  g.fluidAcc = Math.min(g.fluidAcc + dt * F.tickHz, 4);
  while (g.fluidAcc >= 1) {
    g.fluidAcc -= 1;
    fluidTick(g);
  }
}
