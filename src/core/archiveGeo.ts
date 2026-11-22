// Geology of the archive of the depth: the layers below the visible strata go on compacting and transforming, as
// the deep packs of the old model did. Each layer feels the visible column above it and the layers above it; its k
// grows with the pressure (it gets thinner); its materials transform per lateral segment under the rules of
// transforms.json (water where the segment is sea or a groundwater zone, heat where a heat zone covers its years).
// When a rule completes, the whole amount of that material in the segment turns at once (the chance of a rare rule
// scales the amount) — one event, its rock paid out, the layer's shown rock decided again.
import { CFG, RULES_BY_MAT, NMAT } from '../config';
import type { Game } from './game';
import { GW } from '../world/Grid';
import { NS, SEGW } from '../world/Strata';
import { condOk, GeoEnv } from './pressure';
import { heatAt, groundwaterAt, ruleAllowed } from './geology';

const S = CFG.B.sand;
const W = CFG.B.world.width;
const DENS = CFG.materials.map((m) => m.density);

/** One tick of the archive. Returns the compacted mass of the archive (for the prestige). */
export function archiveTick(g: Game, dy: number, env: GeoEnv): { mass: number } {
  const arc = g.archive;
  const st = g.stats;
  const ph = CFG.B.physics;
  const grid = g.grid;
  // the visible column above the archive: mean weight and depth over the width
  let gridP = 0, rows = 0;
  for (let x = 0; x < GW; x++) {
    for (let y = grid.surf[x]; y <= grid.sinkRow; y++) {
      const m = grid.mat[y * GW + x];
      if (m) { gridP += DENS[m] * S.pressurePerParticle; rows++; }
    }
  }
  gridP /= GW; rows /= GW;
  let P = env.P0 + gridP;
  const Tbase = env.T0 + S.gradientPerRow * env.gradMul * rows;
  const grad = ph.gradient * env.gradMul;          // per old cell row below the visible strata
  const kRate = (1 + st.press) * ph.kRate;
  const kMax = ph.kMax + st.kMax;
  const wMul = 1 + st.layerWeight;
  const glacierK = g.run.glacierLoad > 0 ? (0.3 / 100) * dy : 0;
  let depth = 0, mass = 0;
  // sea share of each segment
  const sea = new Float32Array(NS);
  for (let s = 0; s < NS; s++) {
    let n = 0;
    for (let X = Math.floor(s * SEGW); X < Math.floor((s + 1) * SEGW); X++) if (g.zoneMap[X] === 0) n++;
    sea[s] = n / SEGW;
  }
  for (const L of arc.layers) {
    const cells = arc.cells(L);
    if (cells <= 0) continue;
    let weight = 0;
    for (let i = 0; i < L.amt.length; i++) if (L.amt[i] > 0) weight += L.amt[i] * DENS[i % NMAT];
    weight = (weight / W) * ph.pressurePerRow * Math.sqrt(L.k) * wMul;
    const Pc = P + weight * 0.5;
    const lrows = cells / W;
    const T = Tbase + grad * (depth + lrows * 0.5);
    L.P = Pc; L.T = T;
    if (dy > 0) L.k = Math.min(kMax, L.k + kRate * (Pc / 10) * dy + glacierK);
    const Peff = Pc * L.k;
    mass += (Pc - env.P0) * L.k * cells;
    if (dy > 0) transformLayer(g, L, Peff, T, sea, dy * env.speed, depth);
    P += weight;
    depth += lrows;
  }
  return { mass };
}

function transformLayer(g: Game, L: ReturnType<Game['archive']['newLayer']>, Peff: number, T: number, sea: Float32Array, dyS: number, depth: number): void {
  const arc = g.archive;
  const mid = (L.y0 + L.y1) / 2;
  let changed = false;
  for (let s = 0; s < NS; s++) {
    const X = Math.floor((s + 0.5) * SEGW);
    const heat = heatAt(g, X, mid);
    const water = sea[s] > 0.3 || groundwaterAt(g, X, mid);
    const o = s * NMAT;
    for (let m = 1; m < NMAT; m++) {
      const a = L.amt[o + m];
      if (a < 0.01) continue;
      for (const rule of RULES_BY_MAT[m]) {
        if (!ruleAllowed(g, rule)) continue;
        if (!condOk(rule, { Peff, T: T + heat, water, depth: 999, oxygen: false })) continue;
        L.prog[o + m] += dyS;
        if (L.prog[o + m] >= rule.years) {
          L.prog[o + m] = 0;
          const conv = rule.chance !== undefined ? a * rule.chance : a;
          if (conv <= 0) break;
          // resin with insects inside turns into amber with an insect, the rest into plain amber
          const ins = rule.insectToIdx >= 0 ? Math.min(conv, L.insect[s]) : 0;
          L.amt[o + m] -= conv;
          for (const [to, amount] of [[rule.toIdx, conv - ins], [rule.insectToIdx, ins]] as [number, number][]) {
            if (amount <= 0 || to < 0) continue;
            L.prog[o + to] = (L.prog[o + to] * L.amt[o + to]) / Math.max(1e-6, L.amt[o + to] + amount);
            L.amt[o + to] += amount;
            const y = to === rule.insectToIdx ? rule.insectYield! : rule.yield;
            if (y > 0) g.addRock(rule.rock, amount * y * CFG.B.rockYield, X);
          }
          if (ins > 0) { g.run.insectAmber++; L.insect[s] -= ins; }
          changed = true;
        }
        break;
      }
    }
  }
  if (changed) arc.settleRock(L);
  void depth;
}
