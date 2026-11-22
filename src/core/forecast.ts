// Forecasts for the Geologist view (brief 5, A3): what a layer is turning into and how soon, or why it is not.
// The same conditions as the geology tick (geology.ts): effective pressure P·k, temperature, water, air, depth.
import { CFG, RULES_BY_MAT, NMAT, TransformRule } from '../config';
import type { Game } from './game';
import { CAP, W } from '../world/World';

export type Reason = 'deeper' | 'heat' | 'water' | 'tooHot' | 'tooDeep' | 'noAir';
export interface Forecast {
  rock: string;           // the rock it becomes (or would become)
  toMat: number;
  years: number;          // game years left (when ok)
  ok: boolean;
  reason?: Reason;
  progress: number;       // 0..1 of the current rule
}

function usable(g: Game, rule: TransformRule): boolean {
  if (rule.world === 'hot' && !g.mods.hot) return false;
  if (rule.rankReq && g.mods.living) {
    const src = CFG.materials[rule.fromIdx].rock ?? '';
    if ((g.run.rockRanks[src] ?? 0) < rule.rankReq) return false;
  }
  return true;
}

function failure(rule: TransformRule, Peff: number, T: number, water: boolean, depth: number, oxygen: boolean): Reason | null {
  if (rule.pMin !== undefined && Peff < rule.pMin) return 'deeper';
  if (rule.noOxygen && oxygen) return 'deeper';
  if (rule.tMin !== undefined && T < rule.tMin) return 'heat';
  if (rule.water && !water) return 'water';
  if (rule.tMax !== undefined && T > rule.tMax) return 'tooHot';
  if (rule.maxDepth !== undefined && depth > rule.maxDepth) return 'tooDeep';
  return null;
}

export function speedNow(g: Game): number {
  return (1 + g.stats.transformSpeed) * (1 + g.diversityBonus());
}

/** Is cell (x, i) in a groundwater zone? */
function inWater(g: Game, x: number, birth: number): boolean {
  for (const t of g.run.targets) if (t.kind === 'water' && x >= t.x0 && x <= t.x1 && birth >= t.b0 && birth <= t.b1) return true;
  return false;
}

/** Forecast for one pixel cell. */
export function forecastCell(g: Game, x: number, i: number): Forecast | null {
  const w = g.world;
  const j = x * CAP + i;
  const m = w.mat[j];
  const rules = RULES_BY_MAT[m].filter((r) => usable(g, r));
  if (!rules.length) return null;
  const depth = w.len[x] - 1 - i;
  const Peff = w.P[j] * w.k[j];
  const T = w.T[j];
  const water = inWater(g, x, w.birth[j]) || g.zoneMap[x] === 0;
  const oxygen = depth < CFG.transforms.oxygenRows;
  const sp = speedNow(g);
  let first: { rule: TransformRule; reason: Reason } | null = null;
  for (const rule of rules) {
    const why = failure(rule, Peff, T, water, depth, oxygen);
    if (!why) {
      const left = Math.max(0, rule.years - w.prog[j]) / Math.max(1e-6, sp);
      return { rock: rule.rock, toMat: rule.toIdx, years: left, ok: true, progress: Math.min(1, w.prog[j] / rule.years) };
    }
    if (!first) first = { rule, reason: why };
  }
  return first ? { rock: first.rule.rock, toMat: first.rule.toIdx, years: Infinity, ok: false, reason: first.reason, progress: Math.min(1, w.prog[j] / first.rule.years) } : null;
}

/** Forecast for a deep pack (full width): its main material that still has a rule. */
export function forecastPack(g: Game, p: number): Forecast | null {
  const pk = g.world.packs[p];
  let best = -1, amt = 0;
  for (let m = 0; m < NMAT; m++) if (pk.amt[m] > amt && RULES_BY_MAT[m].some((r) => usable(g, r))) { amt = pk.amt[m]; best = m; }
  if (best < 0) return null;
  const Peff = pk.P * pk.k;
  const water = g.zoneWidth[0] / W > 0.2;
  const sp = speedNow(g);
  let first: { rule: TransformRule; reason: Reason } | null = null;
  for (const rule of RULES_BY_MAT[best].filter((r) => usable(g, r))) {
    const why = failure(rule, Peff, pk.T, water, 999, false);
    if (!why) return { rock: rule.rock, toMat: rule.toIdx, years: Math.max(0, rule.years - pk.prog[best]) / sp, ok: true, progress: Math.min(1, pk.prog[best] / rule.years) };
    if (!first) first = { rule, reason: why };
  }
  return first ? { rock: first.rule.rock, toMat: first.rule.toIdx, years: Infinity, ok: false, reason: first.reason, progress: 0 } : null;
}

/** Does any transformation rule that makes this rock need heat or depth? (the Geologist's first hint) */
export function rockNeedsHeatOrDepth(rock: string): boolean {
  return CFG.transforms.rules.some((r: any) => r.rock === rock && (r.tMin !== undefined || r.pMin !== undefined));
}
