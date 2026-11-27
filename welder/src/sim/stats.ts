import type { Cond, GameData, StatId } from '../data/types';
import { BALANCE } from '../data/balance';

export type Stats = Record<StatId, number>;

/** Base values before upgrades. */
export function baseStats(): Stats {
  return {
    maskTransmission: 0.03,
    /** How much of the unlit room shows through the glass (0 = black). */
    maskSee: 0.2,
    /** Knowledge: which causes of a weak seam you can tell (and read on the gauges). */
    knowTempo: 0,
    knowArc: 0,
    knowFusion: 0,
    knowHand: 0,
    knowFit: 0,
    maskWindow: 0.7,
    strikeMul: 1,
    // Bare rods at the start: a lot of spatter; coated rods bring it down (upgrades.ts).
    spatterMul: 1.7,
    poreMul: 1,
    electrodeSeconds: BALANCE.electrode.arcSeconds,
    powerSmooth: 0.04,
    dipMul: 1,
    dynamoGain: 1,
    stickL: BALANCE.arc.stickL,
    stableI: 0.86,
    wheels: 1,
    apprentice: 0,
    rodWild: 1,
    maskWear: 1,
  };
}

export function computeStats(data: GameData, owned: Record<string, boolean>): Stats {
  const s = baseStats();
  const ups = data.upgrades.filter((u) => owned[u.id]);
  for (const u of ups) for (const [k, v] of Object.entries(u.effects.set ?? {})) s[k as StatId] = v as number;
  for (const u of ups) for (const [k, v] of Object.entries(u.effects.add ?? {})) s[k as StatId] += v as number;
  for (const u of ups) for (const [k, v] of Object.entries(u.effects.mul ?? {})) s[k as StatId] *= v as number;
  return s;
}

export interface CondCtx {
  ordersDone: number;
  owned: Record<string, boolean>;
  flags: Record<string, boolean>;
  t: number;
}

export function checkCond(c: Cond, x: CondCtx): boolean {
  if (c.ordersDone !== undefined && x.ordersDone < c.ordersDone) return false;
  if (c.owns && !c.owns.every((id) => x.owned[id])) return false;
  if (c.flag && !x.flags[c.flag]) return false;
  if (c.time !== undefined && x.t < c.time) return false;
  if (c.all && !c.all.every((k) => checkCond(k, x))) return false;
  if (c.any && !c.any.some((k) => checkCond(k, x))) return false;
  return true;
}

/** Unmet pieces of a condition, for showing "why not". Only flat conditions are explained piece by piece. */
export type Reason =
  | { kind: 'coins'; need: number }
  | { kind: 'owns'; id: string }
  | { kind: 'orders'; have: number; need: number }
  | { kind: 'flag'; id: string }
  | { kind: 'owned' };

export function unmet(c: Cond | undefined, x: CondCtx): Reason[] {
  const out: Reason[] = [];
  if (!c) return out;
  if (c.owns) for (const id of c.owns) if (!x.owned[id]) out.push({ kind: 'owns', id });
  if (c.ordersDone !== undefined && x.ordersDone < c.ordersDone)
    out.push({ kind: 'orders', have: x.ordersDone, need: c.ordersDone });
  if (c.flag && !x.flags[c.flag]) out.push({ kind: 'flag', id: c.flag });
  return out;
}
