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
  /** At the bench while welding: some unwelded stretch can be reached as the work lies. */
  reach: boolean;
}

const pt = seamPoint();

export function computeGuide(g: Game, out: Guide): Guide {
  out.target = '';
  out.hint = '';
  out.x = 0;
  out.y = 0;
  out.z = 0;
  out.seam = -1;
  out.reach = true;
  if (!g.started || g.showEnd) return out;
  const b = g.player;
  const a = b.arc;
  const early = g.ordersDone < 2;
  const learning = g.ordersDone < 4;
  const c = g.cond;

  switch (b.stage) {
    case 'empty':
      // The house's store is full: the apprentice waits until it is sold from the map.
      if (g.estate.home.length >= BALANCE.estate.homeCap) {
        out.target = 'map';
        out.hint = g.log.milestones.courier === undefined ? 'sell' : '';
        return out;
      }
      // After the first job: the craft book, where the guild is the one thing on offer.
      if (g.flags.shelf && !g.owned.guild) {
        out.target = 'shelf';
        out.hint = 'guild';
        return out;
      }
      if (g.pile) {
        out.target = 'pile';
        out.hint = g.pile.urgent || early ? 'take' : '';
      } else if (g.flags.board && g.board.length) {
        out.target = 'board';
        out.hint = g.ordersDone <= 5 ? 'board' : '';
      } else if (g.flags.shelf && g.ordersDone <= 3 && g.money >= 4) {
        out.target = 'shelf';
        out.hint = g.ordersDone <= 2 ? 'learn' : '';
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
      // Point at the first unwelded stretch you can reach as the work lies; if none, the first gap (turn it).
      const fill = BALANCE.weld.fillMin;
      let best = -1, bestS = 0;
      for (let i = 0; i < b.seams.length && best < 0; i++) {
        const sr = b.seams[i];
        for (let k = sr.edge; k < sr.n - sr.edge; k++)
          if (sr.metal[k] < fill && !sr.hole[k] && canReach(b, i, (k + 0.5) * sr.cell)) {
            best = i;
            bestS = (k + 0.5) * sr.cell;
            break;
          }
      }
      const reach = best >= 0;
      out.reach = reach;
      if (!reach)
        for (let i = 0; i < b.seams.length; i++) {
          const g = b.seams[i].firstGap(fill);
          if (g >= 0) {
            best = i;
            bestS = g;
            break;
          }
        }
      if (best >= 0) {
        const sr = b.seams[best];
        sr.pointAt(bestS, pt);
        out.target = 'seam';
        out.hint = !reach ? (learning || c.reachMiss > 0 ? 'turn' : '') : early ? (sr.count > 0 ? 'gap' : 'strike') : '';
        out.x = pt.x;
        out.y = pt.y;
        out.z = pt.z;
        out.seam = best;
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
