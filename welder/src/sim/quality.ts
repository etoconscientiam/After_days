import { BALANCE } from '../data/balance';
import type { GradeId } from '../data/types';
import { SeamRun, F_PORE } from './seam';

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Score of one seam, 0..1. Everything that lowers it is visible on the bead after the slag is gone:
 * holes, gaps, cold lumps, pores, wandering off the joint, spatter, an uneven ripple rhythm.
 */
export function seamQuality(sr: SeamRun, thick = 1): number {
  const W = BALANCE.weld;
  // Filler a good pass leaves on this part; thicker parts take a fatter bead.
  const mI = (W.deposit * W.vIdeal) / idealSpeed(thick, 1);
  let sum = 0;
  let cnt = 0;
  for (let c = sr.edge; c < sr.n - sr.edge; c++) {
    cnt++;
    if (sr.hole[c]) continue;
    const m = sr.metal[c];
    let fill = m < 0.8 * mI ? smooth(0.25 * mI, 0.8 * mI, m) : 1;
    if (m > 1.45 * mI) fill *= Math.max(0.45, 1 - (m / mI - 1.45) * 0.45);
    const fuse = smooth(W.fuseLow, W.fuseHigh, sr.peak[c]);
    const off = smooth(4, 8, sr.dev[c]);
    let sc = fill * (0.3 + 0.7 * fuse) * (1 - 0.5 * off);
    sc -= 0.6 * sr.pores[c];
    sum += Math.max(0, sc);
  }
  let q = cnt > 0 ? sum / cnt : 0;

  // Rhythm: ripple spacing should be even. Fish scale vs. lumps.
  if (sr.count > 6) {
    let ms = 0, n = 0;
    const sp = new Float32Array(sr.count);
    for (let i = 1; i < sr.count; i++) {
      const d = Math.abs(sr.delta(sr.rS[i - 1], sr.rS[i]));
      if (d < 8) {
        sp[n++] = d;
        ms += d;
      }
    }
    if (n > 4) {
      ms /= n;
      let v = 0;
      for (let i = 0; i < n; i++) v += (sp[i] - ms) * (sp[i] - ms);
      const cv = Math.sqrt(v / n) / Math.max(0.3, ms);
      q -= 0.12 * smooth(0.25, 0.9, cv);
    }
  }
  q -= Math.min(0.08, sr.spN * 0.0015);
  return Math.max(0, Math.min(1, q));
}

export function partQuality(seams: SeamRun[], thick = 1): number {
  let s = 0, l = 0;
  for (const sr of seams) {
    sr.quality = seamQuality(sr, thick);
    s += sr.quality * sr.len;
    l += sr.len;
  }
  return l > 0 ? s / l : 0;
}

export function gradeOf(q: number): GradeId {
  for (const g of BALANCE.quality.grades) if (q >= g.min) return g.id;
  return 'bad';
}

export function gradeRank(g: GradeId): number {
  return ['bad', 'rough', 'fair', 'clean'].indexOf(g);
}

export function countHoles(seams: SeamRun[]): number {
  let h = 0;
  for (const sr of seams) for (let i = 0; i < sr.n; i++) h += sr.hole[i];
  return h;
}

export function countPores(seams: SeamRun[]): number {
  let p = 0;
  for (const sr of seams) for (let i = 0; i < sr.count; i++) if (sr.rF[i] & F_PORE) p++;
  return p;
}

export function payFor(reward: number, q: number): number {
  const Q = BALANCE.quality;
  return reward * (Q.payMin + (1 - Q.payMin) * Math.pow(q, Q.payExp));
}

/** Travel speed (mm/s) that gives the best bead on a part of this thickness at this current. */
export function idealSpeed(thick: number, I: number): number {
  return (BALANCE.weld.vIdeal * Math.pow(I, 1.2)) / Math.pow(thick, 1.5);
}
