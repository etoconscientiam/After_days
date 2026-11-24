// Falling-sand physics of the strata: particles fall, loose ones slide down slopes (each material at its own angle),
// rock and marker beds fall only straight down, the bedrock and the thing never move. In water a particle sinks
// slower and hardly slides, so the sea lays flat beds and the land lays cones.
//
// Two modes give the same strata:
//  - full: step by step on screen (stepFull, at a fixed rate, sleeping blocks are skipped);
//  - fast: for the balance run and offline (settleFast): a particle is put on top of its column and slides down the
//    slope at once, with the same rules — hundreds of times cheaper, the same heights and the same order of beds.
// No DOM here: the core runs in Node.
import { CFG } from '../config';
import { Grid, GW, KIND, SLIP, K_LOOSE, K_SOLID } from '../world/Grid';

const S = CFG.B.sand;

export interface Rng { next(): number }

/** Water: which columns are sea and from which row down the water stands. */
export interface Water { col: Uint8Array; level: number }

const inWater = (w: Water | null, x: number, y: number) => !!w && w.col[x] === 1 && y >= w.level;

/** One physics step over the awake blocks. Returns how many particles moved. */
export function stepFull(g: Grid, rng: Rng, water: Water | null, tick: number): number {
  g.beginStep();
  const mat = g.mat;
  let moved = 0;
  const flip = tick & 1;
  for (let y = g.floor - 2; y >= 0; y--) {
    const row = y * GW, below = row + GW;
    for (let k = 0; k < GW; k++) {
      const x = flip ? k : GW - 1 - k;
      const i = row + x, m = mat[i];
      if (!m) continue;
      const kind = KIND[m];
      if (kind === K_SOLID) continue;
      if (!g.blockAwake(x, y)) continue;
      const wet = inWater(water, x, y);
      if (wet && tick % S.waterFallEvery !== 0) { g.wake(x, y); continue; }
      if (!mat[below + x]) {
        // free fall is quicker than sliding: two cells a step when there is room (sand drops, then pours)
        const below2 = below + GW;
        g.move(i, !wet && y + 2 < g.floor && !mat[below2 + x] ? below2 + x : below + x);
        moved++;
        continue;
      }
      if (kind !== K_LOOSE) continue;
      // friction: a rolling grain goes on with the chance `slip` each step, else it stops and lies still; a grain
      // that lies still only moves again when the slope under it is twice too steep (a small avalanche)
      if (g.still[i]) {
        // a still grain slides again: always where the slope is twice too steep; with a small chance (creep)
        // down a plain 45° slope, so peaks settle to the natural angle; a lone grain on a peak with nothing at
        // its sides crumbles quickly (no needles)
        const lone = (x === 0 || !mat[row + x - 1]) && (x === GW - 1 || !mat[row + x + 1]);
        const d = rng.next() < 0.5 ? -1 : 1;
        const u = rng.next();
        for (let t = 0; t < 2; t++) {
          const xx = x + (t ? -d : d);
          if (xx < 0 || xx >= GW || mat[row + xx] || mat[below + xx]) continue;
          const steep = y + 2 < g.floor && !mat[below + GW + xx];
          if (steep || u < S.creep || (lone && u < S.peakCrumble)) { g.move(i, below + xx); moved++; break; }
        }
        // the gentle step: two cells aside and one down (≈27°), slowly — a fresh cone slumps into a mound
        if (g.still[i] && u < S.slump) {
          for (let t = 0; t < 2; t++) {
            const dd = t ? -d : d, x1 = x + dd, x2 = x + 2 * dd;
            if (x2 < 0 || x2 >= GW || mat[row + x1] || mat[row + x2] || mat[below + x2] || !mat[below + x1]) continue;
            g.move(i, below + x2); moved++; break;
          }
        }
        if (g.still[i] && (lone || canCreep(g, x, y) || canSlump(g, x, y))) g.wake(x, y);
        continue;
      }
      const slip = SLIP[m] * (wet ? S.waterSlipMul : 1);
      let went = false;
      if (rng.next() < slip) {
        const d = rng.next() < 0.5 ? -1 : 1;
        for (let t = 0; t < 2; t++) {
          const xx = x + (t ? -d : d);
          if (xx < 0 || xx >= GW) continue;
          if (!mat[row + xx] && !mat[below + xx]) { g.move(i, below + xx); moved++; went = true; break; }
        }
      }
      // a rolling grain that finds no 45° step may still run on down the gentle one (two aside, one down):
      // fresh heaps stand at about 30–35°, like real sand, not as 45° pyramids
      if (!went && rng.next() < slip * 0.5) {
        const d = rng.next() < 0.5 ? -1 : 1;
        for (let t = 0; t < 2 && !went; t++) {
          const dd = t ? -d : d, x1 = x + dd, x2 = x + 2 * dd;
          if (x2 < 0 || x2 >= GW || mat[row + x1] || mat[row + x2] || mat[below + x2] || !mat[below + x1]) continue;
          g.move(i, below + x2); moved++; went = true;
        }
      }
      if (!went) g.still[i] = 1;
    }
  }
  if (moved) { g.computeTops(); g.version++; }
  return moved;
}

/** Could a still grain at (x, y) still creep (an empty cell beside and below it)? Keeps its block awake. */
function canCreep(g: Grid, x: number, y: number): boolean {
  const row = y * GW, below = row + GW;
  for (const xx of [x - 1, x + 1]) if (xx >= 0 && xx < GW && !g.mat[row + xx] && !g.mat[below + xx]) return true;
  return false;
}

/** Could a still grain at (x, y) slump two cells aside and one down? */
function canSlump(g: Grid, x: number, y: number): boolean {
  const row = y * GW, below = row + GW;
  for (const d of [-1, 1]) {
    const x1 = x + d, x2 = x + 2 * d;
    if (x2 >= 0 && x2 < GW && !g.mat[row + x1] && !g.mat[row + x2] && !g.mat[below + x2] && g.mat[below + x1]) return true;
  }
  return false;
}

/** Fast mode: put one particle on top of column x and let it slide down the slope with the full-mode rules.
 *  Returns its index, or -1 if the column is full. */
export function settleFast(g: Grid, rng: Rng, water: Water | null, x: number, m: number, look: number, birth: number,
  flags = 0, spec = 0, decay = 0): number {
  let y = g.tops[x] - 1;
  if (y < 0) return -1;
  const loose = KIND[m] === K_LOOSE;
  // the same friction as in full mode: the grain rolls on with the chance `slip` each step; once it stops it only
  // moves again where the slope is twice too steep
  let rolling = true;
  for (let guard = 0; guard < 400 && loose; guard++) {
    const row = y * GW, below = row + GW;
    if (y + 1 >= g.floor) break;
    const slip = SLIP[m] * (inWater(water, x, y) ? S.waterSlipMul : 1);
    let moved = false;
    const d = rng.next() < 0.5 ? -1 : 1;
    for (let t = 0; t < 2 && !moved; t++) {
      const xx = x + (t ? -d : d);
      if (xx < 0 || xx >= GW || g.mat[row + xx] || g.mat[below + xx]) continue;
      // in the end a grain creeps down any free 45° slope (full mode: creep), so here it slides on
      x = xx; y = g.tops[xx] - 1; moved = true;
      void slip; void rolling;
    }
    // and in time it slumps down the gentle step too (two aside, one down): half of them have by now
    if (!moved && rng.next() < 0.5) {
      for (let t = 0; t < 2 && !moved; t++) {
        const dd = t ? -d : d, x1 = x + dd, x2 = x + 2 * dd;
        if (x2 < 0 || x2 >= GW || g.mat[row + x1] || g.mat[row + x2] || g.mat[below + x2] || !g.mat[below + x1]) continue;
        x = x2; y = g.tops[x2] - 1; moved = true;
      }
    }
    if (!moved) { if (rolling) { rolling = false; continue; } break; }
  }
  return g.put(x, y, m, look, birth, flags, spec, decay);
}

export interface PileSpec {
  /** column of the pile's centre */
  cx: number;
  /** number of particles */
  n: number;
  /** materials and their weights; inside the pile they lie in wavy bands, in a random order */
  mix: { m: number; w: number }[];
  birth: number;
  /** row of the pile's top in full mode (it falls from there) */
  y0?: number;
  /** called for every particle placed (flags of resin, glow…) */
  decorate?: (i: number, m: number) => void;
}

/** Cells of a pile blob around (cx, y0) and the material of each, top to bottom. */
function pileLayout(g: Grid, rng: Rng, spec: PileSpec): { cells: number[]; mats: number[] } {
  const n = spec.n, r = Math.sqrt(n / Math.PI) * 1.15;
  const y0 = spec.y0 ?? 2;
  const cells: number[] = [];
  const taken = new Set<number>();
  for (let tries = 0; tries < n * 4 && cells.length < n; tries++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * r;
    const x = Math.round(spec.cx + Math.cos(a) * d * 1.3), y = Math.round(y0 + r + Math.sin(a) * d);
    if (x < 0 || x >= GW || y < 0 || y >= g.floor) continue;
    const i = y * GW + x;
    if (g.mat[i] || taken.has(i)) continue;
    taken.add(i); cells.push(i);
  }
  const tot = spec.mix.reduce((s, q) => s + q.w, 0) || 1;
  const order = spec.mix.map((q) => ({ m: q.m, n: (q.w / tot) * cells.length }));
  for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rng.next() * (k + 1)); const t = order[k]; order[k] = order[j]; order[j] = t; }
  const ph = rng.next() * 6, amp = 0.8 + rng.next() * 1.5;
  const key = (i: number) => Math.floor(i / GW) + amp * Math.sin((i % GW) * 0.6 + ph);
  cells.sort((a, b) => key(a) - key(b));
  const mats: number[] = new Array(cells.length);
  let k = 0, acc = 0;
  for (const q of order) { acc += q.n; for (; k < Math.round(acc) && k < cells.length; k++) mats[k] = q.m; }
  for (; k < cells.length; k++) mats[k] = order[0]?.m ?? 0;
  return { cells, mats };
}

/** Drop a pile. Full mode: the blob appears in the sky and falls. Fast mode: its particles settle at once, the
 *  bottom of the blob first (as it would land). Returns the number of particles placed. */
export function dropPile(g: Grid, rng: Rng, water: Water | null, spec: PileSpec, fast: boolean): number {
  if (!spec.mix.length || spec.n <= 0) return 0;
  const { cells, mats } = pileLayout(g, rng, spec);
  let placed = 0;
  const look = () => (rng.next() * 256) | 0;
  if (!fast) {
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const j = g.put(i % GW, (i / GW) | 0, mats[k], look(), spec.birth);
      if (j >= 0) { placed++; spec.decorate?.(j, mats[k]); }
    }
    return placed;
  }
  for (let k = cells.length - 1; k >= 0; k--) {
    const j = settleFast(g, rng, water, cells[k] % GW, mats[k], look(), spec.birth);
    if (j >= 0) { placed++; spec.decorate?.(j, mats[k]); }
  }
  return placed;
}

/** One particle laid on the surface of column x (the drizzle of sediment from life, bones from the carcass pools). */
export function rainOne(g: Grid, rng: Rng, water: Water | null, x: number, m: number, birth: number, fast: boolean,
  flags = 0, spec = 0, decay = 0): number {
  const look = (rng.next() * 256) | 0;
  if (fast) return settleFast(g, rng, water, x, m, look, birth, flags, spec, decay);
  // full mode: it settles on the surface of its column — the drizzle builds the ground up from below, it does not
  // rain from the sky (a tapped pile still falls: dropPile). If the cell right over the surface is taken (a grain
  // laid a moment ago), the first free cell above it
  for (let y = g.surf[x] - 1; y >= 0; y--) if (!g.mat[y * GW + x]) return g.put(x, y, m, look, birth, flags, spec, decay);
  return -1;
}

/** Let everything fall until nothing moves (tests, migration, the start of a world). */
export function settleAll(g: Grid, rng: Rng, water: Water | null, maxSteps = 4000): number {
  g.wakeAll();
  let steps = 0;
  for (; steps < maxSteps; steps++) if (stepFull(g, rng, water, steps) === 0 && steps > 2) break;
  return steps;
}
