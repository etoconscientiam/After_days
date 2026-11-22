// Epoch Shift (prestige): compacted mass -> Density, foundation grows, history above the artifact starts over.
import { CFG } from '../config';
import type { Game } from './game';
import { newRun } from './state';
import { W, CAP } from '../world/World';

export function prestigeGain(g: Game): number {
  const P = CFG.B.prestige;
  return Math.floor(Math.pow(g.run.compactMass / P.divisor, P.power));
}

/** Give the next 3011 note in fixed order. Returns its id or null. */
export function giveNote(g: Game): string | null {
  const next = CFG.notes.find((n) => !g.legacy.notes.includes(n.id));
  if (!next) return null;
  g.legacy.notes.push(next.id);
  g.bus.emit('noteFound', { id: next.id });
  g.triggerEcho('note:' + next.id);
  return next.id;
}

export function startEraFor(g: Game): number {
  const lvl = g.meta.tree.deepMemory ?? 0;
  if (lvl <= 0) return 0;
  return Math.min(lvl + 1, g.meta.maxEra);
}

/**
 * What a shift would add to the foundation: strongly compacted rows (k >= threshold) survive as a thin dark band.
 * share = their part of the column's visible thickness. Used by the shift itself and by the Epoch tab.
 */
export function foundationPreview(g: Game): { add: number; share: number } {
  const w = g.world;
  const kf = CFG.B.physics.foundationK;
  let hard = 0, all = 0;
  for (let x = 0; x < W; x++) {
    const base = x * CAP;
    for (let i = 0; i < w.len[x]; i++) {
      const k = w.k[base + i];
      all += 1 / k;
      if (k >= kf) hard += 1 / k;
    }
  }
  hard /= W; all /= W;
  for (const pk of w.packs) { all += pk.rows / pk.k; if (pk.k >= kf) hard += pk.rows / pk.k; }
  return { add: hard * CFG.B.physics.foundationCompress, share: all > 0 ? hard / all : 0 };
}

export function doPrestige(g: Game): void {
  const s = g.state;
  const w = g.world;
  const gain = prestigeGain(g);
  s.meta.foundation += foundationPreview(g).add;
  s.meta.foundationLines.push(s.meta.foundation);

  s.meta.density += gain;
  s.meta.prestiges++;
  s.legacy.totalPrestiges++;
  if (g.rng.next() < CFG.B.prestige.noteChance || s.meta.prestiges === 1) giveNote(g);

  // keep a share of creatures (Legacy node)
  const keep = g.stats.legacy;
  const oldPop = s.run.pop;
  const auto = s.run.auto;
  const era = startEraFor(g);
  s.run = newRun(era);
  s.run.auto = auto;
  s.run.timeAtEra[era] = 0;
  if (keep > 0) {
    for (const sp of CFG.species) {
      const n = Math.floor((oldPop[sp.id][0] + oldPop[sp.id][1] + oldPop[sp.id][2]) * keep);
      if (n <= 0 || sp.era > era) continue;
      s.run.pop[sp.id] = [0, 0, 0];
      const zs = g.habitatZones(sp);
      s.run.pop[sp.id][zs[zs.length - 1]] = n;
      s.run.peak[sp.id] = n;
    }
  }
  w.reset();
  g.recomputeZones();
  g.statsDirty = true;
  g.refreshStats();
  g.bus.emit('prestige', { gain });
}
