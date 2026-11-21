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
  const all = CFG.story.notes;
  const next = all.find((n) => !g.legacy.notes.includes(n));
  if (!next) return null;
  g.legacy.notes.push(next);
  g.bus.emit('noteFound', { id: next });
  return next;
}

export function startEraFor(g: Game): number {
  const lvl = g.meta.tree.deepMemory ?? 0;
  if (lvl <= 0) return 0;
  return Math.min(lvl + 1, g.meta.maxEra);
}

export function doPrestige(g: Game): void {
  const s = g.state;
  const w = g.world;
  const gain = prestigeGain(g);
  // foundation: strongly compacted rows (k >= threshold) survive as a thin dark band
  const kf = CFG.B.physics.foundationK;
  let vis = 0;
  for (let x = 0; x < W; x++) {
    const base = x * CAP;
    for (let i = 0; i < w.len[x]; i++) {
      const k = w.k[base + i];
      if (k >= kf) vis += 1 / k;
    }
  }
  vis /= W;
  for (const pk of w.packs) if (pk.k >= kf) vis += pk.rows / pk.k;
  s.meta.foundation += vis * CFG.B.physics.foundationCompress;
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
  if (g.firstTime('prestige')) g.triggerMemory('firstPrestige');
}
