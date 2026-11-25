import type { GameData } from '../data/types';
import type { Order } from './orders';
import { Bench, canReach } from './weld';
import { BALANCE } from '../data/balance';
import { difficulty, seamShare, payFor, seamPay } from './quality';
import type { SeamRun } from './seam';

/** One line of a job sheet: a seam to lay, knocking the slag off, or handing it over. */
export interface Stage {
  kind: 'seam' | 'chip' | 'hand';
  /** Seam id (for its name), seam index, length (mm) and the most it can pay. */
  id: string;
  seam: number;
  len: number;
  max: number;
}

export interface JobSheet {
  part: string;
  reward: number;
  stars: number;
  stages: Stage[];
}

/** What the job asks for, before it's taken: stages, how hard, what it pays at best. */
export function jobSheet(data: GameData, o: Order): JobSheet {
  const part = data.parts[o.part];
  const b = new Bench('player');
  b.load(o, part);
  let needsTurn = false;
  for (let i = 0; i < b.seams.length && !needsTurn; i++) {
    const sr = b.seams[i];
    for (let s = 0; s <= sr.len; s += 4)
      if (!canReach(b, i, s)) {
        needsTurn = true;
        break;
      }
  }
  const stages: Stage[] = b.seams.map((sr, i) => ({ kind: 'seam', id: sr.def.id, seam: i, len: sr.len, max: o.reward * seamShare(b.seams, i) }));
  stages.push({ kind: 'chip', id: 'chip', seam: -1, len: 0, max: 0 }, { kind: 'hand', id: 'hand', seam: -1, len: 0, max: 0 });
  return { part: o.part, reward: o.reward, stars: difficulty(part, needsTurn), stages };
}

/** The least a job pays when its requirement is just met (for showing a grade requirement as money). */
export function payAtGrade(reward: number, grade: string): number {
  const g = BALANCE.quality.grades.find((x) => x.id === grade);
  return payFor(reward, g ? g.min : 0);
}

/** Live state of a seam on the bench: 0..1 laid, and what it pays now (once it's filled). */
export function seamProgress(seams: SeamRun[], i: number, reward: number): { laid: number; filled: boolean; q: number; pay: number } {
  const sr = seams[i];
  const laid = sr.coverage(BALANCE.weld.fillMin);
  return { laid, filled: sr.filled, q: sr.quality, pay: sr.filled ? seamPay(reward, seamShare(seams, i), sr.quality) : 0 };
}
