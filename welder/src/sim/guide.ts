import { BALANCE } from '../data/balance';
import type { Game } from './game';
import { seamPoint } from './seam';
import { canReach } from './weld';

/**
 * What to highlight next and which short hint to show beside it. No menus, no tutorial text walls:
 * full hints during the first jobs, then only the highlight, then nothing.
 */
export interface Guide {
  target: string;
  hint: string;
  /** Anchor on the part (mm) when the target is on the part. */
  x: number;
  y: number;
  z: number;
  seam: number;
}

const pt = seamPoint();

export function computeGuide(g: Game, out: Guide): Guide {
  out.target = '';
  out.hint = '';
  out.x = 0;
  out.y = 0;
  out.z = 0;
  out.seam = -1;
  if (!g.started || g.showEnd) return out;
  const b = g.player;
  const a = b.arc;
  const early = g.ordersDone < 2;
  const learning = g.ordersDone < 4;
  const c = g.cond;

  switch (b.stage) {
    case 'empty':
      if (g.pile) {
        out.target = 'pile';
        out.hint = g.pile.urgent || early ? 'take' : '';
      } else if (g.flags.board && g.board.length) {
        out.target = 'board';
        out.hint = g.ordersDone <= 5 ? 'board' : '';
      } else if (g.flags.shelf && !g.log.milestones['buy:coated'] && g.ordersDone <= 3) {
        out.target = 'shelf';
      }
      return out;

    case 'weld': {
      if (b.swap > 0) return out;
      if (b.electrode <= 0 && !a.lit) {
        out.target = 'electrodes';
        out.hint = 'newRod';
        return out;
      }
      if (a.lit) {
        if (c.maskUpLit > 0.25) {
          out.target = 'mask';
          out.hint = 'maskDown';
          return out;
        }
        if (learning) {
          out.target = 'arc';
          if (c.long > 0.7) out.hint = 'arcLong';
          else if (c.short > 0.5) out.hint = 'arcShort';
          else if (c.fast > 0.6) out.hint = 'tooFast';
          else if (c.slow > 0.9) out.hint = 'tooSlow';
          else out.target = '';
        }
        return out;
      }
      if (c.maskDownDark > 3 && learning) {
        out.target = 'mask';
        out.hint = 'maskUp';
        return out;
      }
      // Point at the first unwelded stretch, preferring one that faces you already.
      const order: number[] = [];
      for (let i = 0; i < b.seams.length; i++) {
        const sr = b.seams[i];
        const gap = sr.firstGap(BALANCE.weld.fillMin);
        if (gap >= 0 && canReach(b, i, sr.count > 0 ? gap : sr.closed ? 0 : Math.min(sr.len, 3))) order.push(i);
      }
      for (let i = 0; i < b.seams.length; i++) if (!order.includes(i)) order.push(i);
      for (const i of order) {
        const sr = b.seams[i];
        const gap = sr.firstGap(BALANCE.weld.fillMin);
        if (gap < 0) continue;
        const anyMetal = sr.count > 0;
        const at = anyMetal ? gap : sr.closed ? 0 : Math.min(sr.len, 3);
        sr.pointAt(at, pt);
        out.target = 'seam';
        // A joint that faces away has to be turned to first.
        const reach = canReach(b, i, at) || (sr.len > 40 && canReach(b, i, Math.min(sr.len, at + 20)));
        out.hint = !reach ? (learning || c.reachMiss > 0 ? 'turn' : '') : early ? (anyMetal ? 'gap' : 'strike') : '';
        out.x = pt.x;
        out.y = pt.y;
        out.z = pt.z;
        out.seam = i;
        return out;
      }
      return out;
    }
    case 'chip':
      if (g.mask.down && g.mask.pos > 0.9) {
        out.target = 'mask';
        out.hint = learning ? 'maskUp' : '';
        return out;
      }
      out.target = 'bead';
      out.hint = early ? 'chip' : '';
      for (let i = 0; i < b.seams.length; i++) {
        const sr = b.seams[i];
        for (let k = 0; k < sr.n; k++)
          if (sr.slag[k] > 0) {
            sr.pointAt((k + 0.5) * sr.cell, pt);
            out.x = pt.x;
            out.y = pt.y;
            out.z = pt.z;
            out.seam = i;
            return out;
          }
      }
      return out;
    case 'ready':
      if (b.order?.urgent) return out;
      if (g.mask.down && learning) {
        out.target = 'mask';
        out.hint = 'maskUp';
        return out;
      }
      out.target = 'door';
      out.hint = early ? 'handOver' : '';
      return out;
  }
  return out;
}
