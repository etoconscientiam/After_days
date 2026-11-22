// Geology tick (every 0.5 s real time): pressure, temperature, water, oxygen rot, compaction k,
// rock transformations, fossilisation, plus cached aggregates (compact mass, fertility, excavation need).
import { CFG, RULES_BY_MAT, NMAT, M, TransformRule } from '../config';
import type { Game } from './game';
import { W, CAP, F_FOSSIL, F_ROLLED, F_RARE, F_FRAGMENT, F_INSECT, F_FAST, Pack } from '../world/World';
import type { TargetZone } from './state';

const DENS = CFG.materials.map((m) => m.density);
const ORGANIC = CFG.materials.map((m) => !!m.organic);
const FERTILE = CFG.materials.map((m) => !!(m as any).fertile);
const SQRT = (k: number) => Math.sqrt(k);

interface Cond { Peff: number; T: number; water: boolean; depth: number; oxygen: boolean }

function ruleOk(g: Game, rule: TransformRule, c: Cond): boolean {
  if (rule.world) {
    if (rule.world === 'hot' && !g.mods.hot) return false;
  }
  if (rule.rankReq && g.mods.living) {
    const src = CFG.materials[rule.fromIdx].rock ?? '';
    if ((g.run.rockRanks[src] ?? 0) < rule.rankReq) return false;
  }
  if (rule.pMin !== undefined && c.Peff < rule.pMin) return false;
  if (rule.tMin !== undefined && c.T < rule.tMin) return false;
  if (rule.tMax !== undefined && c.T > rule.tMax) return false;
  if (rule.water && !c.water) return false;
  if (rule.noOxygen && c.oxygen) return false;
  if (rule.maxDepth !== undefined && c.depth > rule.maxDepth) return false;
  return true;
}

export function geoTick(g: Game, dy: number): void {
  const r = g.run;
  const w = g.world;
  const st = g.stats;
  const ph = CFG.B.physics;
  const tf = CFG.transforms;
  const tap = CFG.B.taphonomy;
  const press = (1 + st.press) * ph.kRate;
  const kMax = ph.kMax + st.kMax;
  const grad = ph.gradient * g.mods.geoGradientMul * (1 + st.geoGradient);
  const baseT = ph.surfaceT + st.geoHeat;
  const wMul = 1 + st.layerWeight;
  const fBase = g.meta.foundation * ph.foundationP * (1 + st.foundation);
  const P0 = fBase + r.glacierLoad;
  const speed = (1 + st.transformSpeed) * (1 + g.diversityBonus());
  const rotP = 1 - Math.pow(1 - tf.oxygenRotPer100y, dy / 100);
  const oxyRows = tf.oxygenRows;
  const glacierK = r.glacierLoad > 0 ? (0.3 / 100) * dy : 0;
  const fossilMul = 1 + st.fossilChance;
  let compact = 0;
  let maxK = 1;
  let fertileCount = 0;
  let glints = 0;
  let sumBottomP = 0, sumLen = 0;
  const targets = r.targets;
  const colTargets: TargetZone[] = [];
  const marineCol = g.zoneMap;
  // press: the finger speeds up compaction (x6) and transformations (x4) in its circle, scaled by its power
  const pr = r.press && r.press.power > 0 ? r.press : null;
  const kMulP = pr ? 1 + 5 * pr.power : 1, sMulP = pr ? 1 + 3 * pr.power : 1;
  let pressK = 0;

  for (let x = 0; x < W; x++) {
    colTargets.length = 0;
    for (const t of targets) if (x >= t.x0 && x <= t.x1) colTargets.push(t);
    const base = x * CAP;
    const L = w.len[x];
    let P = P0;
    const marine = marineCol[x] === 0;
    const pressCol = pr !== null && x >= pr.x0 && x <= pr.x1;
    for (let i = L - 1, depth = 0; i >= 0; i--, depth++) {
      const j = base + i;
      const m = w.mat[j];
      let k = w.k[j];
      const inPress = pressCol && w.birth[j] >= pr!.b0 && w.birth[j] <= pr!.b1;
      const dens = DENS[m] * SQRT(k) * wMul * 0.0098;
      const Pc = P + dens * 0.5;
      let T = baseT + grad * depth;
      let gw = false;
      if (colTargets.length) {
        const b = w.birth[j];
        for (const t of colTargets) {
          if (b < t.b0 || b > t.b1) continue;
          if (t.kind === 'water') gw = true;
          else T += t.heat;
        }
      }
      w.P[j] = Pc;
      w.T[j] = T;
      // compaction
      if (dy > 0) {
        const k0 = k;
        k += press * (Pc / 10) * dy * (inPress ? kMulP : 1) + glacierK;
        if (k > kMax) k = kMax;
        w.k[j] = k;
        if (inPress) pressK += 1 / k0 - 1 / k;   // thickness squeezed out by the finger
      }
      const Peff = Pc * k;
      if (k > maxK) maxK = k;
      compact += (Pc - P0) * k;
      const oxygen = depth < oxyRows;
      if (oxygen) {
        if (ORGANIC[m] && g.rng.next() < rotP) { w.mat[j] = M.soil; w.prog[j] = 0; P += dens; continue; }
        if (FERTILE[m] && marineCol[x] !== 0) fertileCount++;
      }
      // fossilisation: once per bone pixel when pressure is enough
      if (m === M.bone && !(w.flags[j] & F_ROLLED) && Pc >= tap.fossilP) {
        rollFossil(g, x, j, gw ? tap.groundwaterMineral : 1, fossilMul, depth);
      }
      const rules = RULES_BY_MAT[m];
      if (rules.length && dy > 0) {
        const c: Cond = { Peff, T, water: gw || marine, depth, oxygen };
        for (const rule of rules) {
          if (!ruleOk(g, rule, c)) continue;
          w.prog[j] += dy * speed * (inPress ? sMulP : 1);
          if (w.prog[j] >= rule.years) {
            w.prog[j] = 0;
            if (rule.chance !== undefined && g.rng.next() >= rule.chance) break;
            const insect = rule.insectToIdx >= 0 && (w.flags[j] & F_INSECT) !== 0;
            if (insect) r.insectAmber++;
            w.mat[j] = insect ? rule.insectToIdx : rule.toIdx;
            const y = insect ? rule.insectYield! : rule.yield;
            if (y > 0) {
              g.addRock(rule.rock, y * CFG.B.rockYield, x);
              if (glints < 60) {
                glints++;
                g.glints.push({ x, depth, t: 0.6, color: CFG.materials[rule.toIdx].palette[4], birth: w.birth[j] });
              }
            }
            if (inPress && g.pressFlashes.length < 80) g.pressFlashes.push({ x, birth: w.birth[j], t: 0.9, color: CFG.materials[w.mat[j]].palette[4] });
            w.version++;
          }
          break;
        }
      }
      P += dens;
    }
    sumBottomP += P;
    sumLen += L;
  }

  // ---- packs (deep, full-width) ----
  let P = sumBottomP / W;
  let depth = sumLen / W;
  const seaFrac = g.zoneWidth[0] / W;
  for (const pk of w.packs) {
    let amtTot = 0, weight = 0;
    for (let m = 0; m < NMAT; m++) if (pk.amt[m] > 0) { amtTot += pk.amt[m]; weight += pk.amt[m] * DENS[m]; }
    weight = (weight / W) * SQRT(pk.k) * wMul * 0.0098;
    const Pc = P + weight * 0.5;
    const T = baseT + grad * (depth + pk.rows * 0.5);
    pk.P = Pc; pk.T = T;
    // a press reaches a pack in the share of the width it covers
    const pAge = pr && pk.ageMax >= pr.b0 && pk.ageMin <= pr.b1 ? (pr.x1 - pr.x0 + 1) / W : 0;
    if (dy > 0) pk.k = Math.min(kMax, pk.k + press * (Pc / 10) * dy * (1 + (kMulP - 1) * pAge) + glacierK);
    const Peff = Pc * pk.k;
    compact += (Pc - P0) * pk.k * amtTot;
    // zone overlaps (by layer age)
    let heat = 0, heatFrac = 0, gwFrac = 0;
    for (const t of targets) {
      if (pk.ageMax < t.b0 || pk.ageMin > t.b1) continue;
      const f = (t.x1 - t.x0 + 1) / W;
      if (t.kind === 'water') gwFrac = Math.min(1, gwFrac + f);
      else { heat = Math.max(heat, t.heat); heatFrac = Math.min(1, heatFrac + f); }
    }
    if (dy > 0) packTransforms(g, pk, Peff, T, heat, heatFrac, Math.max(seaFrac, gwFrac), depth, dy * speed * (1 + (sMulP - 1) * pAge));
    P += weight;
    depth += pk.rows;
  }

  r.compactMass = compact;
  r.pressMoved += (pressK / W) * 40;
  if (maxK >= CFG.story.echoCompactionK) g.triggerEcho('compactionVisible');
  r.fertility = Math.min(CFG.B.fertility.max, fertileCount * CFG.B.fertility.perPixel);
  if (r.era >= 7) {
    if (g.mods.shards) {
      const need = Math.max(...g.shardXs().map((x) => g.artifactDepth(x)));
      r.excavationNeed = need;
    } else r.excavationNeed = g.artifactDepth();
  }
  g.statsDirty = true;
}

function packTransforms(g: Game, pk: Pack, Peff: number, T: number, heat: number, heatFrac: number, waterFrac: number, depth: number, dyS: number): void {
  for (let m = 0; m < NMAT; m++) {
    const a = pk.amt[m];
    if (a < 0.01) continue;
    const rules = RULES_BY_MAT[m];
    for (const rule of rules) {
      const base: Cond = { Peff, T, water: waterFrac > 0, depth, oxygen: false };
      let frac = 0;
      if (ruleOk(g, rule, base)) frac = rule.water ? waterFrac : 1;
      else if (heatFrac > 0 && ruleOk(g, rule, { ...base, T: T + heat })) frac = heatFrac * (rule.water ? waterFrac : 1);
      if (frac <= 0) continue;
      pk.prog[m] += dyS;
      if (pk.prog[m] >= rule.years) {
        pk.prog[m] = 0;
        let conv = a * frac;
        if (rule.chance !== undefined) conv *= rule.chance;
        if (conv <= 0) break;
        pk.amt[m] -= conv;
        const to = rule.toIdx;
        pk.prog[to] = (pk.prog[to] * pk.amt[to]) / Math.max(1e-6, pk.amt[to] + conv);
        pk.amt[to] += conv;
        if (rule.yield > 0) {
          g.addRock(rule.rock, conv * rule.yield * CFG.B.rockYield);
          g.glints.push({ x: Math.floor(g.rng.next() * W), depth: depth + pk.rows * g.rng.next(), t: 0.8, color: CFG.materials[to].palette[4], birth: pk.ageMin + (pk.ageMax - pk.ageMin) * g.rng.next() });
        }
        g.world.version++;
      }
      break;
    }
  }
}

export function rollFossil(g: Game, x: number, j: number, mineral: number, fossilMul: number, depth: number): void {
  const w = g.world;
  const tap = CFG.B.taphonomy;
  w.flags[j] |= F_ROLLED;
  const d = w.decay[j] / 255;
  const fast = (w.flags[j] & F_FAST) !== 0;
  const spIdx = w.spec[j] - 1;
  const sp = CFG.species[spIdx];
  if (!sp) return;
  let chance = tap.fossilBase * (fast ? 5 : 1) * mineral * (1 - d) * fossilMul;
  // a burial caught in the window after a mass death fossilises three times as easily
  const bu = g.run.burials, b = w.birth[j];
  for (let q = 0; q < bu.length; q += 3) if (b >= bu[q] && b <= bu[q + 1]) { chance *= bu[q + 2]; break; }
  if (g.mods.living && g.run.mutations[sp.id] === 'shell') chance *= 2;
  chance = Math.min(0.95, chance);
  const u = g.rng.next();
  const mus = (g.legacy.museum[sp.id] ??= { common: 0, rare: 0, fragments: 0 });
  if (u < chance) {
    const rare = fast && d < tap.rareDecay;
    w.flags[j] |= F_FOSSIL | (rare ? F_RARE : 0);
    if (rare) mus.rare++; else mus.common++;
    g.legacy.fossils++;
    g.run.fossilsRun++;
    g.statsDirty = true;
    g.bus.emit('fossilFound', { species: sp.id, rare, fragment: false, complete: true, x, depth });
    g.triggerEcho('firstFossil');
  } else if (u < chance * 2) {
    // near miss: a fragment; three make a whole fossil (bad-luck protection)
    w.flags[j] |= F_FRAGMENT;
    mus.fragments++;
    let complete = false;
    if (mus.fragments >= tap.fragmentsPerFossil) {
      mus.fragments -= tap.fragmentsPerFossil;
      mus.common++;
      g.legacy.fossils++;
      g.run.fossilsRun++;
      complete = true;
      g.statsDirty = true;
      g.triggerEcho('firstFossil');
    }
    g.bus.emit('fossilFound', { species: sp.id, rare: false, fragment: true, complete, x, depth });
  }
  w.version++;
}

/** Finish at once the transformations under way in one layer: cells within dx columns and db years of (x, birth). */
export function finishLayer(g: Game, x: number, birth: number, dx = 12, db = 80): number {
  const w = g.world;
  let n = 0;
  for (let xx = Math.max(0, x - dx); xx <= Math.min(W - 1, x + dx); xx++) {
    const base = xx * CAP;
    for (let i = 0; i < w.len[xx]; i++) {
      const j = base + i;
      if (Math.abs(w.birth[j] - birth) > db) continue;
      const rule = RULES_BY_MAT[w.mat[j]].find((ru) => !ru.world || (ru.world === 'hot' && g.mods.hot));
      if (!rule || w.prog[j] <= 0) continue;
      w.prog[j] = 0;
      w.mat[j] = rule.toIdx;
      if (rule.yield > 0) g.addRock(rule.rock, rule.yield * CFG.B.rockYield, xx);
      if (g.pressFlashes.length < 80) g.pressFlashes.push({ x: xx, birth: w.birth[j], t: 1.2, color: CFG.materials[rule.toIdx].palette[4] });
      n++;
    }
  }
  if (n) w.version++;
  return n;
}
