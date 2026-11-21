// Deposition: every column accumulates fractional height; when it reaches 1 a pixel is laid on top.
// The material is drawn from weighted sources above the column; carcass pools get buried with it.
import { CFG, ZONES, mat, M } from '../config';
import type { Game } from './game';
import { F_INSECT, F_FAST, F_GLOW } from '../world/World';
import { valueNoise } from './rng';

interface ZoneSource { rate: number; mats: number[]; cum: number[] }

const bgMat = {
  water: mat(CFG.B.zones.backgroundMat.water),
  shore: mat(CFG.B.zones.backgroundMat.shore),
  land: mat(CFG.B.zones.backgroundMat.land),
};
const dustMat = mat(CFG.B.zones.landAltMat);

function buildSources(g: Game): ZoneSource[] {
  const r = g.run;
  const out: ZoneSource[] = [];
  const els = r.active;
  for (let zi = 0; zi < 3; zi++) {
    const z = ZONES[zi];
    const weights = new Map<number, number>();
    const add = (m: number, w: number) => weights.set(m, (weights.get(m) ?? 0) + w);
    const bgRate = CFG.B.zones.background[z];
    let bm = bgMat[z];
    if (z === 'land' && r.era < CFG.B.zones.landAltBeforeEra) bm = dustMat;
    add(bm, bgRate);
    let rate = bgRate;
    for (const sp of CFG.species) {
      const n = r.pop[sp.id][zi];
      if (n <= 0 || !sp.deposit.contrib) continue;
      const sr = (sp.deposit.contrib * n) / 10;
      rate += sr;
      for (const [m, w] of Object.entries(sp.deposit.mats)) add(mat(m), sr * w);
    }
    for (const a of els) {
      const el = CFG.elements.find((e) => e.id === a.id);
      const boost = el?.params?.depositBoost?.[z];
      if (!boost) continue;
      rate += boost;
      add(mat(el!.params.mat), boost);
    }
    const mats: number[] = [], cum: number[] = [];
    let c = 0;
    for (const [m, w] of weights) { c += w; mats.push(m); cum.push(c); }
    out.push({ rate, mats, cum: cum.map((v) => v / c) });
  }
  return out;
}

function pick(src: ZoneSource, u: number): number {
  for (let i = 0; i < src.cum.length; i++) if (u <= src.cum[i]) return src.mats[i];
  return src.mats[src.mats.length - 1];
}

export function depositionStep(g: Game, dy: number): void {
  const r = g.run;
  const w = g.world;
  const src = buildSources(g);
  const depMul = 1 + g.stats.deposition;
  const advFrom = r.startWaterEnd;
  const mix = g.zoneMix;
  for (let x = 0; x < w.len.length; x++) {
    const zi = g.zoneMap[x];
    const m0 = mix[x * 3], m1 = mix[x * 3 + 1], m2 = mix[x * 3 + 2];
    // rates blend smoothly across zone borders so layers don't form vertical walls
    let rate = src[0].rate * m0 + src[1].rate * m1 + src[2].rate * m2;
    let mul = depMul * g.colNoise[x];
    if (zi === 0 && x >= advFrom && !g.mods.shards) mul *= 2; // advanced sea: double deposition
    if (g.mods.shards && r.shardBoost[g.basinMap[x]] > 0) mul *= 2;
    w.h[x] += rate * dy * mul;
    let guard = 0;
    while (w.h[x] >= 1 && guard++ < 64) {
      w.h[x] -= 1;
      // which zone's material falls here (blended near borders)
      // keyed on time, so the same moment forms the same lamina across columns
      const ty = r.year / 160 + w.h[x] * 0.3;
      const uz = valueNoise(x / 9, ty * 0.6 + 31.7);
      const zsrc = uz < m0 ? 0 : uz < m0 + m1 ? 1 : 2;
      // spatially coherent choice: lenses and laminae instead of salt-and-pepper
      const u = valueNoise(x / 22 + zsrc * 50, ty) * 0.8 + g.rng.next() * 0.2;
      depositCell(g, x, pick(src[zsrc], u), zi, 1);
    }
  }
}

/** Lay one cell (plus any bones/organics buried from the carcass pool). */
export function depositCell(g: Game, x: number, m: number, zi: number, burialMul: number): void {
  const r = g.run;
  const w = g.world;
  const T = CFG.B.taphonomy;
  let flags = 0;
  if (m === M.resin) {
    const insects = r.pop.insects ? r.pop.insects[1] + r.pop.insects[2] : 0;
    const ch = 0.02 * (insects > 0 ? 3 : 1);
    if (g.rng.next() < ch) flags |= F_INSECT;
  }
  w.deposit(x, m, r.year, flags);
  r.layers++;

  const pool = r.pools[ZONES[zi]];
  const fast = pool.fast > 0 || burialMul > 1;
  const share = Math.min(1, (T.burialShare * (fast ? 2 : 1) * burialMul) / Math.max(1, g.zoneWidth[zi]));
  if (pool.bone + pool.orgM + pool.orgL > 0.0001) {
    const tb = pool.bone * share, tom = pool.orgM * share, tol = pool.orgL * share;
    const decay = 1 - Math.exp(-pool.age / T.decayTau);
    pool.bone -= tb; pool.orgM -= tom; pool.orgL -= tol;
    let specTotal = 0;
    for (let i = 0; i < pool.boneSpec.length; i++) specTotal += pool.boneSpec[i];
    pool.boneCredit = Math.min(6, pool.boneCredit + tb / T.massPerPixel);
    pool.orgCredit = Math.min(6, pool.orgCredit + (tom + tol) / T.massPerPixel);
    let extra = 0;
    while (pool.boneCredit >= 1 && extra < 2) {
      // pick the species of this bone by mass share
      let u = g.rng.next() * specTotal, si = 0;
      for (; si < pool.boneSpec.length - 1; si++) { u -= pool.boneSpec[si]; if (u <= 0) break; }
      for (let i = 0; i < pool.boneSpec.length; i++) pool.boneSpec[i] *= 1 - share;
      let bf = fast ? F_FAST : 0;
      w.deposit(x, M.bone, r.year, bf, si + 1, Math.round(decay * 255));
      pool.boneCredit -= 1;
      extra++;
    }
    while (pool.orgCredit >= 1 && extra < 3) {
      const marine = pool.orgM >= pool.orgL || zi === 0;
      let om = marine ? M.orgMarine : M.orgLand;
      let fl = 0;
      if (g.mods.living && g.rng.next() < 0.04) { om = M.glowstone; fl = F_GLOW; g.addRock('glowstone', 1, x); }
      w.deposit(x, om, r.year, fl);
      pool.orgCredit -= 1;
      extra++;
    }
  }
}
