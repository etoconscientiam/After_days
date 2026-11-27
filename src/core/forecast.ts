// Forecasts for the Geologist view (brief 5, A3): what a layer is turning into and how soon, or why it is not.
// The same conditions as the geology tick (geology.ts): effective pressure P·k, temperature, water, air, depth.
import { CFG, RULES_BY_MAT, NMAT, TransformRule } from '../config';
import type { Game } from './game';
import { GW, KIND, K_NONE, K_SOLID, DENS } from '../world/Grid';
import type { Layer } from '../world/Strata';
import { geoEnv } from './geology';

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

/** Pressure, temperature, water, air and depth of the particle at grid cell (x, y) — as the geology tick sees it. */
export function conditionsAt(g: Game, x: number, y: number): { Peff: number; T: number; water: boolean; depth: number; oxygen: boolean } {
  const grid = g.grid;
  const env = geoEnv(g, 0);
  const S = CFG.B.sand;
  let P = env.P0, depth = -1, Pc = P;
  for (let yy = grid.surf[x]; yy <= y && yy < grid.floor; yy++) {
    const m = grid.mat[yy * GW + x], k = KIND[m];
    if (k === K_NONE) continue;
    if (k === K_SOLID) break;
    depth++;
    const w = DENS[m] * S.pressurePerParticle;
    Pc = P + w * 0.5;
    P += w;
  }
  let Peff = Pc * env.pressMul;
  const f = env.finger;
  if (f && (x - f.x) ** 2 + (y - f.y) ** 2 <= f.r * f.r) Peff *= 1 + 2 * f.power;
  const b = grid.birth[y * GW + x];
  const T = env.T0 + S.gradientPerRow * env.gradMul * Math.max(0, depth) + env.heatAt(x, b);
  return { Peff, T, water: env.waterAt(x, b) || env.marine(x) || y >= env.waterTable, depth: Math.max(0, depth), oxygen: depth < S.oxygenRows };
}

/** Forecast for one particle at grid cell (x, y). */
export function forecastParticle(g: Game, x: number, y: number): Forecast | null {
  const grid = g.grid;
  const i = y * GW + x;
  const m = grid.mat[i];
  const rules = RULES_BY_MAT[m].filter((r) => usable(g, r));
  if (!rules.length) return null;
  const c = conditionsAt(g, x, y);
  const sp = speedNow(g);
  const prog = grid.prog[i];
  let first: { rule: TransformRule; reason: Reason } | null = null;
  for (const rule of rules) {
    const why = failure(rule, c.Peff, c.T, c.water, c.depth, c.oxygen);
    if (!why) {
      const left = Math.max(0, rule.years - prog) / Math.max(1e-6, sp);
      return { rock: rule.rock, toMat: rule.toIdx, years: left, ok: true, progress: Math.min(1, prog / rule.years) };
    }
    if (!first) first = { rule, reason: why };
  }
  return first ? { rock: first.rule.rock, toMat: first.rule.toIdx, years: Infinity, ok: false, reason: first.reason, progress: Math.min(1, prog / first.rule.years) } : null;
}

/** Forecast for a layer of the archive: its main material that still has a rule. */
export function forecastLayer(g: Game, L: Layer): Forecast | null {
  const arc = g.archive;
  let best = -1, amt = 0;
  for (let m = 0; m < NMAT; m++) { const a = arc.matCells(L, m); if (a > amt && RULES_BY_MAT[m].some((r) => usable(g, r))) { amt = a; best = m; } }
  if (best < 0) return null;
  const Peff = L.P * L.k;
  const water = g.zoneWidth[0] / CFG.B.world.width > 0.2;
  const sp = speedNow(g);
  let prog = 0;
  for (let s = 0; s < L.amt.length / NMAT; s++) prog = Math.max(prog, L.prog[s * NMAT + best]);
  let first: { rule: TransformRule; reason: Reason } | null = null;
  for (const rule of RULES_BY_MAT[best].filter((r) => usable(g, r))) {
    const why = failure(rule, Peff, L.T, water, 999, false);
    if (!why) return { rock: rule.rock, toMat: rule.toIdx, years: Math.max(0, rule.years - prog) / sp, ok: true, progress: Math.min(1, prog / rule.years) };
    if (!first) first = { rule, reason: why };
  }
  return first ? { rock: first.rule.rock, toMat: first.rule.toIdx, years: Infinity, ok: false, reason: first.reason, progress: 0 } : null;
}

/** Does any transformation rule that makes this rock need heat or depth? (the Geologist's first hint) */
export function rockNeedsHeatOrDepth(rock: string): boolean {
  return CFG.transforms.rules.some((r: any) => r.rock === rock && (r.tMin !== undefined || r.pMin !== undefined));
}
