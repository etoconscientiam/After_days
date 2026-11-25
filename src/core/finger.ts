// The finger on the strata (a held press): besides squeezing the layers (core/geology.ts), it moves the loose grains
// under it, as a finger in sand. Each frame a share of the loose particles in its circle (press.push.share, 11%)
// takes a step: along the way the finger is drawn, or, while it only presses, aside and a little up out of its way
// (a dent with a rim), shoving the loose grains ahead of it up to the first empty cell (air or water; press.push.chain
// cells at most). Rock, marker beds and the thing do not move, nor does anything they hold.
import { CFG } from '../config';
import type { Game } from './game';
import { GW, KIND, K_LOOSE } from '../world/Grid';

const P = CFG.B.press.push;

export function fingerPush(g: Game): void {
  const p = g.run.press;
  if (!p || p.power <= 0) return;
  const grid = g.grid, rng = g.rng;
  const share = P.share * Math.min(1.5, p.power);
  const r = Math.max(1, Math.round(p.r)), r2 = r * r;
  const mx = p.mx ?? 0, my = p.my ?? 0, sp = Math.abs(mx) + Math.abs(my);
  const drawn = sp > P.moveMin;
  for (let y = Math.max(0, p.y - r); y <= Math.min(grid.floor - 1, p.y + r); y++) {
    for (let x = Math.max(0, p.x - r); x <= Math.min(GW - 1, p.x + r); x++) {
      const ddx = x - p.x, ddy = y - p.y;
      if (ddx * ddx + ddy * ddy > r2) continue;
      const i = y * GW + x, m = grid.mat[i];
      if (!m || KIND[m] !== K_LOOSE || rng.next() >= share) continue;
      let dx = 0, dy = 0;
      if (drawn) {
        // along the finger's way: the larger of its two steps more often
        if (rng.next() * sp < Math.abs(mx)) dx = Math.sign(mx); else dy = Math.sign(my);
      } else {
        // pressed: aside from the middle (a random side under it) and, nearer the top of the circle, up
        dx = ddx !== 0 ? Math.sign(ddx) : rng.next() < 0.5 ? -1 : 1;
        if (ddy <= 0 && rng.next() < P.up) { dy = -1; if (rng.next() < 0.5) dx = 0; }
      }
      // the grain pushes the loose ones ahead of it, up to the first empty cell (a few cells at most): in packed
      // sand the finger shoves a short run of grains, and the sand ahead heaps up
      let k = 1, ok = false;
      for (; k <= P.chain; k++) {
        const nx = x + dx * k, ny = y + dy * k;
        if (nx < 0 || nx >= GW || ny < 0 || ny >= grid.floor) break;
        const mj = grid.mat[ny * GW + nx];
        if (!mj) { ok = true; break; }
        if (KIND[mj] !== K_LOOSE) break;
      }
      if (!ok) continue;
      for (let q = k; q >= 1; q--) grid.move(y * GW + x + (dy * (q - 1)) * GW + dx * (q - 1), (y + dy * q) * GW + x + dx * q);
    }
  }
}
