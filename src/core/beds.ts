// Marker beds: a thin bed drapes the surface. The skin of the strata — the top particle of every column and the
// particles of steep faces — turns into the marker. No volume is added, nothing moves: the bed follows the hills
// exactly and stays in the strata as a line of that moment, later folded by piles and carried down by the conveyor.
//
// Sources (wired in by the game): the «Bed» button (ochre), an erupting volcano
// (a pale ash lens around the vent), a flood (silt over the sea and the shore), a meteorite (an iridium bed).
// A bed waits until no particles are in the air, so it never lands on a falling pile.
// A new epoch leaves no bed but a small golden lens somewhere inside the strata (lens()): a line per epoch
// across the whole cut made the late strata noisy.
import { CFG } from '../config';
import { Grid, GW, KIND, MARKER, K_LOOSE } from '../world/Grid';

const S = CFG.B.sand;

/** Turn the skin of columns x0..x1 into marker m. Returns the number of particles coated. */
export function coat(g: Grid, m: number, x0 = 0, x1 = GW - 1, onCell?: (i: number) => void): number {
  let n = 0;
  for (let x = Math.max(0, x0); x <= Math.min(GW - 1, x1); x++) {
    for (let y = g.surf[x], k = 0; y < g.sinkRow && k < S.coatDepth; y++, k++) {
      const i = y * GW + x, cur = g.mat[i];
      if (!cur) continue;
      const exposed = y === g.surf[x] || (x > 0 && !g.mat[i - 1]) || (x < GW - 1 && !g.mat[i + 1]);
      if (!exposed) break;
      if (KIND[cur] !== K_LOOSE || MARKER[cur]) continue;
      g.mat[i] = m; g.prog[i] = 0;
      n++;
      onCell?.(i);
    }
  }
  if (n) g.version++;
  return n;
}

/** A lens of marker m inside the strata: a small flat pocket around a random spot under the surface (not a line
 *  along the whole surface). rnd: 0..1. Only loose grains turn (rock, beds and the thing stay). Returns the number
 *  of particles turned (0 when the strata are still too thin to hold one). */
export function lens(g: Grid, m: number, rnd: () => number): number {
  // columns deep enough to hide a lens a few rows under the surface
  const cols: number[] = [];
  for (let x = 2; x < GW - 2; x++) if (!g.isArtifactCol(x) && g.sinkRow - g.surf[x] >= 10) cols.push(x);
  if (!cols.length) return 0;
  const cx = cols[Math.floor(rnd() * cols.length)];
  const top = g.surf[cx] + 4, bot = g.sinkRow - 3;
  const cy = top + Math.floor(rnd() * Math.max(1, bot - top));
  const rx = 3 + rnd() * 2.5, ry = 1.3 + rnd() * 0.9;
  const tilt = (rnd() - 0.5) * 0.5;
  let n = 0;
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      const x = cx + dx, y = cy + dy + Math.round(dx * tilt);
      if (x < 0 || x >= GW || y < 0 || y >= g.sinkRow) continue;
      const d = (dx / rx) ** 2 + (dy / ry) ** 2;
      if (d > 1 - 0.45 * rnd()) continue;      // a ragged rim, never a neat ellipse
      const i = y * GW + x, cur = g.mat[i];
      if (!cur || KIND[cur] !== K_LOOSE || MARKER[cur]) continue;
      g.mat[i] = m; g.prog[i] = 0;
      n++;
    }
  }
  if (n) g.version++;
  return n;
}

export interface BedOrder { m: number; x0: number; x1: number; wait: number }

/** Beds waiting for the air to clear. Kept in the save so a bed asked for is never lost. */
export class BedQueue {
  items: BedOrder[] = [];

  push(m: number, x0 = 0, x1 = GW - 1): void { this.items.push({ m, x0, x1, wait: 0 }); }

  /** Lay the first waiting bed if nothing is falling (or it has waited long enough). `moving` = particles that
   *  moved on the last physics step (0 in fast mode). Returns the bed laid, or null. */
  update(g: Grid, dt: number, moving: number, onCell?: (i: number) => void): (BedOrder & { n: number }) | null {
    const b = this.items[0];
    if (!b) return null;
    b.wait += dt;
    if (moving > 6 && b.wait < S.coatWait) return null;
    this.items.shift();
    const n = coat(g, b.m, b.x0, b.x1, onCell);
    return { ...b, n };
  }
}
