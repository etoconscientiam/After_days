// Where the particles come from.
//  - The drizzle of sediment: every zone lays down what its background and its life produce (and what an element
//    adds), at the same rates as before (cells per world column per game year; one particle = cellsPerParticle cells).
//    Each particle column has its own accumulator; the material is chosen by a noise keyed on time and place, so
//    the same moment lays the same lamina across neighbouring columns (lenses and laminae, not salt and pepper).
//  - Bones and organic matter from the carcass pools come with that drizzle: the next particles of a zone become a
//    bone of the right species or organic matter, as the pools allow (fast burial after a flood or ash: more).
//  - A tap drops a pile into its column: the base of the zone under the finger plus what life produces there; one of
//    life's materials stays for a few piles in a row, so piles lay bands and lenses.
// Full mode on screen (particles fall from the sky), fast mode for the balance run and offline (they settle at once).
import { CFG, ZONES, mat, M } from '../config';
import type { Game } from './game';
import { GW, P_INSECT, P_FAST, P_GLOW } from '../world/Grid';
import { dropPile, rainOne } from './sand';
import { valueNoise } from './rng';

const S = CFG.B.sand;
const CPP = S.cellsPerParticle;

interface ZoneSource { rate: number; bg: number; base: number; mats: number[]; w: number[]; cum: number[] }

const bgMat = {
  water: mat(CFG.B.zones.backgroundMat.water),
  shore: mat(CFG.B.zones.backgroundMat.shore),
  land: mat(CFG.B.zones.backgroundMat.land),
};
const dustMat = mat(CFG.B.zones.landAltMat);

/** The background material of each zone now (water, shore, land). */
export function zoneSourcesBase(g: Game): number[] {
  return [bgMat.water, bgMat.shore, g.run.era < CFG.B.zones.landAltBeforeEra ? dustMat : bgMat.land];
}

/** What each zone lays down now: total rate (cells per world column per year) and the material weights. */
export function zoneSources(g: Game, natMul = 1): ZoneSource[] {
  const r = g.run;
  const out: ZoneSource[] = [];
  for (let zi = 0; zi < 3; zi++) {
    const z = ZONES[zi];
    const weights = new Map<number, number>();
    const add = (m: number, w: number) => weights.set(m, (weights.get(m) ?? 0) + w);
    const bg = CFG.B.zones.background[z];
    let base = bgMat[z];
    if (z === 'land' && r.era < CFG.B.zones.landAltBeforeEra) base = dustMat;
    // the natural flow (the zone's background and what its life lays down) scaled by natMul — the drizzle
    // upgrade; what an element adds is not
    add(base, bg * natMul);
    let rate = bg * natMul;
    for (const sp of CFG.species) {
      const n = r.pop[sp.id][zi];
      if (n <= 0 || !sp.deposit.contrib || natMul <= 0) continue;
      const sr = (sp.deposit.contrib * n * natMul) / 10;
      rate += sr;
      for (const [m, w] of Object.entries(sp.deposit.mats)) add(mat(m), sr * w);
    }
    for (const a of r.active) {
      const el = CFG.elements.find((e) => e.id === a.id);
      const boost = el?.params?.depositBoost?.[z];
      if (!boost) continue;
      rate += boost;
      add(mat(el!.params.mat), boost);
    }
    const mats: number[] = [], w: number[] = [], cum: number[] = [];
    let c = 0;
    for (const [m, v] of weights) { if (v <= 0) continue; c += v; mats.push(m); w.push(v); cum.push(c); }
    if (!mats.length) { mats.push(base); w.push(1); cum.push(1); c = 1; }
    out.push({ rate, bg, base, mats, w, cum: cum.map((v) => v / c) });
  }
  return out;
}

function pick(src: ZoneSource, u: number): number {
  for (let i = 0; i < src.cum.length; i++) if (u <= src.cum[i]) return src.mats[i];
  return src.mats[src.mats.length - 1];
}

/** World column of particle column x (its centre). */
export const wx = (x: number) => x * 2 + 1;

/** The drizzle: dy game years of sediment from the zones, life and elements. */
/** The relief the sediment keeps: the row of the surface column x aims at (sea floor below the water, the shore at
 *  the water, the land above it), blended across zone borders. */
export function reliefRow(g: Game, x: number): number {
  const X = wx(x), mix = g.zoneMix, R = S.relief;
  const level = g.seaRow();
  return level + mix[X * 3] * R.sea + mix[X * 3 + 1] * R.shore + mix[X * 3 + 2] * R.land;
}

/** Room under the relief, per column (rows; > 0: the column is lower than its shape). */
const room = new Float32Array(GW);

/** Where a particle meant for column x settles: there if it has room, else the column with the most room, nearer
 *  ones first (room less spill-cost per column of distance): the surplus of a full sea goes to the hollows of the
 *  land, not only next door. If nowhere has room, x (everything rises together and the conveyor takes it down). */
function route(x: number): number {
  if (room[x] > 0) return x;
  let best = x, bs = 0;
  const cost = 1 / S.relief.spill;
  for (let xx = 0; xx < GW; xx++) {
    const sc = room[xx] - Math.abs(xx - x) * cost;
    if (sc > bs) { bs = sc; best = xx; }
  }
  return best;
}

export function drizzle(g: Game, dy: number): void {
  const r = g.run;
  const surf = g.grid.surf;
  for (let x = 0; x < GW; x++) room[x] = surf[x] - reliefRow(g, x);
  // at the start nothing falls on its own: the drizzle upgrade opens the natural flow (elements always lay theirs)
  const src = zoneSources(g, g.stats.drizzle);
  const depMul = 1 + g.stats.deposition;
  const advFrom = r.startWaterEnd;
  const mix = g.zoneMix;
  const acc = g.dripAcc;
  const fast = g.headless;
  for (let x = 0; x < GW; x++) {
    const X = wx(x);
    const zi = g.zoneMap[X];
    const m0 = mix[X * 3], m1 = mix[X * 3 + 1], m2 = mix[X * 3 + 2];
    // rates blend across zone borders so layers do not form vertical walls
    const rate = src[0].rate * m0 + src[1].rate * m1 + src[2].rate * m2;
    let mul = depMul * g.colNoise[X];
    if (zi === 0 && X >= advFrom && !g.mods.shards) mul *= 2; // advanced sea: double deposition
    if (g.mods.shards && r.shardBoost[g.basinMap[X]] > 0) mul *= 2;
    // two world columns per particle column, CPP cells per particle
    acc[x] += (rate * dy * mul * 2) / CPP;
    let guard = 0;
    while (acc[x] >= 1 && guard++ < 32) {
      acc[x] -= 1;
      const ty = r.year / 160 + acc[x] * 0.3;
      const uz = valueNoise(X / 9, ty * 0.6 + 31.7);
      const zsrc = uz < m0 ? 0 : uz < m0 + m1 ? 1 : 2;
      const u = valueNoise(X / 22 + zsrc * 50, ty) * 0.8 + g.rng.next() * 0.2;
      // one particle raises a column by a row; slides spread it, so count half
      const xs = route(x);
      room[xs] -= 0.5;
      layParticle(g, xs, pick(src[zsrc], u), zi, 1, fast);
    }
  }
}

/** Lay one particle in column x (plus bones and organic matter from the zone's carcass pool). */
export function layParticle(g: Game, x: number, m: number, zi: number, burialMul: number, fast: boolean): void {
  const r = g.run;
  const T = CFG.B.taphonomy;
  let flags = 0;
  if (m === M.resin) {
    const insects = r.pop.insects ? r.pop.insects[1] + r.pop.insects[2] : 0;
    if (g.rng.next() < 0.02 * (insects > 0 ? 3 : 1) * CPP) flags |= P_INSECT;
  }
  if (rainOne(g.grid, g.rng, g.water, x, m, r.year, fast, flags) < 0) return;
  r.layers++;
  buryFromPool(g, x, zi, burialMul, fast);
  void T;
}

/** The carcass pool of zone zi gives bones and organic matter to column x, as much as its credit allows. */
function buryFromPool(g: Game, x: number, zi: number, burialMul: number, fast: boolean): void {
  const r = g.run;
  const T = CFG.B.taphonomy;
  const pool = r.pools[ZONES[zi]];
  if (pool.bone + pool.orgM + pool.orgL <= 0.0001) return;
  const quick = pool.fast > 0 || burialMul > 1;
  // a particle buries as much of the pool as CPP old cells did
  const share = Math.min(1, (T.burialShare * (quick ? 2 : 1) * burialMul * CPP) / Math.max(1, g.zoneWidth[zi]));
  const tb = pool.bone * share, tom = pool.orgM * share, tol = pool.orgL * share;
  const decay = 1 - Math.exp(-pool.age / T.decayTau);
  pool.bone -= tb; pool.orgM -= tom; pool.orgL -= tol;
  let specTotal = 0;
  for (let i = 0; i < pool.boneSpec.length; i++) specTotal += pool.boneSpec[i];
  const mass = T.massPerPixel * CPP;
  pool.boneCredit = Math.min(6, pool.boneCredit + tb / mass);
  pool.orgCredit = Math.min(6, pool.orgCredit + (tom + tol) / mass);
  let extra = 0;
  while (pool.boneCredit >= 1 && extra < 2) {
    let u = g.rng.next() * specTotal, si = 0;
    for (; si < pool.boneSpec.length - 1; si++) { u -= pool.boneSpec[si]; if (u <= 0) break; }
    for (let i = 0; i < pool.boneSpec.length; i++) pool.boneSpec[i] *= 1 - share;
    rainOne(g.grid, g.rng, g.water, x, M.bone, r.year, fast, quick ? P_FAST : 0, si + 1, Math.round(decay * 255));
    pool.boneCredit -= 1;
    extra++;
  }
  while (pool.orgCredit >= 1 && extra < 3) {
    const marine = pool.orgM >= pool.orgL || zi === 0;
    let om = marine ? M.orgMarine : M.orgLand;
    let fl = 0;
    if (g.mods.living && g.rng.next() < 0.04) { om = M.glowstone; fl = P_GLOW; g.formRock('glowstone', CPP, wx(x)); }
    rainOne(g.grid, g.rng, g.water, x, om, r.year, fast, fl);
    pool.orgCredit -= 1;
    extra++;
  }
}

/** The pile a tap drops: the zone's base and one of life's materials (sticky for a few piles). */
export function pileMix(g: Game, zi: number): { m: number; w: number }[] {
  // as in the prototype: a pile is the zone's base and ONE more material, so the strata lie in thick clean beds,
  // and that one stays for a few piles in a row. It is a bought material (the «pile composition» branch: each has
  // its share p, bought with energy) or the zone's own — what life lays down here. A pile carrying a bought
  // material holds pileExtraShare of it, and such piles come with the chance p / pileExtraShare: so over the piles
  // each material makes exactly its share p, the percentage the composition bar shows.
  const src = zoneSources(g)[zi];
  const base = { m: src.base, w: Math.max(1e-6, src.bg) };
  const r = g.run;
  const sh = g.pileShares();
  if (r.pileSlot === undefined || g.rng.next() < 0.25 || (r.pileSlot && !sh.mats.some((q) => q[0] === r.pileSlot))) {
    let u = g.rng.next() * S.pileExtraShare;
    r.pileSlot = '';
    for (const [id, p] of sh.mats) { u -= p; if (u <= 0) { r.pileSlot = id; break; } }
  }
  if (r.pileSlot && mat(r.pileSlot) !== src.base) {
    const x = S.pileExtraShare;
    r.pileSec = mat(r.pileSlot);
    return [base, { m: r.pileSec, w: (base.w * x) / (1 - x) }];
  }
  const extra = new Map<number, number>();
  for (let k = 0; k < src.mats.length; k++) if (src.mats[k] !== src.base) extra.set(src.mats[k], (extra.get(src.mats[k]) ?? 0) + src.w[k]);
  extra.delete(src.base);
  if (!extra.size) return [base];
  let et = 0;
  for (const w of extra.values()) et += w;
  if (!extra.has(r.pileSec) || g.rng.next() < 0.25) {
    let u = g.rng.next() * et;
    for (const [m, w] of extra) { r.pileSec = m; u -= w; if (u <= 0) break; }
  }
  return [base, { m: r.pileSec, w: et }];
}

/** Drop the pile of a tap into world column X. Returns the number of particles laid. */
/** Where a tapped pile appears: high in the sky (row pileSkyRow, the top of the screen), so it falls the whole way
 *  down; only over a heap that already reaches up there it starts pileDrop rows above the heap's top. */
function pileTop(g: Game, x: number): number {
  return Math.max(0, Math.min(S.pileSkyRow, Math.min(g.grid.surf[x], g.water.level) - S.pileDrop));
}

/** Rooted life under a pile is buried: a share of the units of each listed species (by how much of its zone the
 *  pile covers), the wild ones first, each leaving its organics sealed on the surface under the pile. */
function buryLife(g: Game, x: number, zi: number, n: number): void {
  const B = CFG.B.sand.lifeBurial;
  const r = g.run, grid = g.grid;
  const half = Math.max(2, Math.round(Math.sqrt(n / Math.PI) * 1.5));
  const zoneCols = Math.max(1, g.zoneWidth[zi] / 2);
  for (const [id, d] of Object.entries(B.species) as [string, { mat: string; per: number }][]) {
    const sp = CFG.speciesById[id];
    const p = r.pop[id];
    if (!sp || !p || p[zi] <= 0 || !g.habitatZones(sp).includes(zi)) continue;
    const expect = (p[zi] * Math.min(1, (half * 2) / zoneCols)) * B.share;
    let k = Math.floor(expect) + (g.rng.next() < expect - Math.floor(expect) ? 1 : 0);
    k = Math.min(k, B.maxPerPile, p[zi]);
    if (k <= 0) continue;
    const W = (r.wild ??= {});
    for (let q = 0; q < k; q++) {
      p[zi]--;
      if ((W[id] ?? 0) > 0) W[id]--;
      // its organics, on the surface under the pile, sealed
      for (let s = 0; s < d.per; s++) {
        const xx = Math.max(0, Math.min(GW - 1, x + Math.round((g.rng.next() * 2 - 1) * half)));
        grid.put(xx, grid.surf[xx] - 1, mat(d.mat), (g.rng.next() * 256) | 0, r.year, P_FAST);
      }
    }
    g.statsDirty = true;
    if (!g.headless) g.bus.emit('lifeBuried', { id, n: k, x });
  }
}

export function tapPile(g: Game, X: number, n: number): number {
  const x = Math.max(2, Math.min(GW - 3, Math.floor(X / 2)));
  const zi = g.zoneMap[wx(x)];
  const insects = g.run.pop.insects ? g.run.pop.insects[1] + g.run.pop.insects[2] : 0;
  const n0 = n;
  buryLife(g, x, zi, n0);
  const placed = dropPile(g.grid, g.rng, g.water, {
    cx: x, n, mix: pileMix(g, zi), birth: g.run.year, y0: pileTop(g, x),
    decorate: (i, m) => { if (m === M.resin && g.rng.next() < 0.06 * (insects > 0 ? 3 : 1)) g.grid.flags[i] |= P_INSECT; },
  }, g.headless);
  g.run.layers += placed;
  // the carcass pools go down with the pile (with no drizzle the taps are the only burial)
  if (placed > 0) for (let k = 0; k < Math.ceil(placed / 3); k++) buryFromPool(g, x, zi, 1, g.headless);
  return placed;
}
