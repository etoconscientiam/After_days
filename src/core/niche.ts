// Life arises on its own. Every geology tick the surface of each zone is read: the shares of groups of
// materials (mud, carbonate, soil, wet ground, sand, barren) in its top rows, and the mean depth of the sea.
// A species fits where its needs are met — a share of a group in its zone, a food that lives, a deep enough
// sea — and its suitability is the product of how well each is met (a drought or a glacier lowers it). Where the
// niche is open (every need met at least halfway), a few units arise on their own, one at a time, as many as the
// suitability allows; when the niche shrinks, the wild ones die off one by one. Energy no longer creates life: it
// strengthens a species that is there (or whose niche is open), and the price counts only the bought units.
import { CFG, SpeciesDef } from '../config';
import type { Game } from './game';
import { GW, KIND, K_NONE, K_SOLID } from '../world/Grid';
import { totalPop, addCarcass } from './life';

const N = CFG.B.niche;
export const GROUPS = Object.keys(N.groups);
const NG = GROUPS.length;
/** bit k set = the material belongs to group k */
const GROUP_BITS = new Uint8Array(CFG.materials.length);
GROUPS.forEach((gname, k) => {
  for (const id of (N.groups as Record<string, string[]>)[gname]) {
    const i = CFG.matIndex[id];
    if (i !== undefined) GROUP_BITS[i] |= 1 << k;
  }
});

/** What the surface of the zones is made of now. */
export interface Surface { mix: Float32Array; depth: number }
export function newSurface(): Surface { return { mix: new Float32Array(3 * NG), depth: 0 }; }

/** Read the top rows of every zone (called with the water, every geology tick). */
export function readSurface(g: Game): void {
  const grid = g.grid, s = g.surface;
  const cnt = [0, 0, 0];
  s.mix.fill(0);
  for (let x = 0; x < GW; x++) {
    const zi = g.zoneMap[x * 2 + 1];
    for (let y = grid.surf[x], k = 0; y < grid.sinkRow && k < N.surfaceRows; y++) {
      const m = grid.mat[y * GW + x];
      if (!m || KIND[m] === K_NONE || KIND[m] === K_SOLID) continue;
      k++;
      cnt[zi]++;
      const b = GROUP_BITS[m];
      if (b) for (let q = 0; q < NG; q++) if (b & (1 << q)) s.mix[zi * NG + q]++;
    }
  }
  for (let zi = 0; zi < 3; zi++) for (let q = 0; q < NG; q++) s.mix[zi * NG + q] /= Math.max(1, cnt[zi]);
  let d = 0, n = 0;
  for (let x = 0; x < GW; x++) if (g.water.col[x] === 1 && g.zoneMap[x * 2 + 1] === 0) { d += Math.max(0, grid.surf[x] - g.water.level); n++; }
  s.depth = n ? d / n : 0;
}

/** Share of group `name` in zone zi. */
export function share(g: Game, zi: number, name: string): number {
  const q = GROUPS.indexOf(name);
  return q < 0 ? 0 : g.surface.mix[zi * NG + q];
}

/** One need of a species and how well it is met now (ok 0..1). */
export interface Need { kind: 'mix' | 'food' | 'deep'; key: string; have: number; need: number; ok: number; foods?: string[] }

export function needs(g: Game, sp: SpeciesDef): Need[] {
  const out: Need[] = [];
  const nd = sp.niche;
  if (!nd) return out;
  const zones = g.habitatZones(sp);
  for (const [key, need] of Object.entries(nd.mix ?? {})) {
    let have = 0;
    for (const zi of zones) have = Math.max(have, share(g, zi, key));
    out.push({ kind: 'mix', key, have, need, ok: Math.min(1, have / need) });
  }
  if (nd.food?.length) {
    const alive = nd.food.filter((f) => totalPop(g, f) > 0);
    out.push({ kind: 'food', key: nd.food.join(','), have: alive.length, need: 1, ok: alive.length ? 1 : 0, foods: nd.food });
  }
  if (nd.deep) {
    const have = g.surface.depth;
    out.push({ kind: 'deep', key: 'deep', have, need: nd.deep, ok: Math.min(1, have / nd.deep) });
  }
  return out;
}

/** The climate now: a drought hurts life on the shore and the land, a glacier all life. */
function climate(g: Game, sp: SpeciesDef): number {
  let k = 1;
  for (const a of g.run.active) {
    if (a.id === 'drought' && sp.zone !== 'water') k *= N.drought;
    if (a.id === 'glacier') k *= N.glacier;
  }
  return k;
}

/** How well the surface suits sp now (0..1). */
export function suitability(g: Game, sp: SpeciesDef): number {
  let s = climate(g, sp);
  for (const n of needs(g, sp)) s *= n.ok;
  return s;
}

/** Is the niche of sp open (its epoch, oxygen and forerunners, and every need met at least `at`, openAt by
 *  default)? A niche already lived in holds on to closeAt: life that is there does not vanish at the first dip. */
export function nicheOpen(g: Game, sp: SpeciesDef, at: number = N.openAt): boolean {
  if (!g.speciesGate(sp)) return false;
  for (const n of needs(g, sp)) if (n.ok < at) return false;
  return suitability(g, sp) > 0;
}

/** How many units of sp the niche brings forth (grow) or keeps (hold) on its own now. */
export function wildCap(g: Game, sp: SpeciesDef, hold = false): number {
  if (!sp.wild || !nicheOpen(g, sp, hold ? N.closeAt : N.openAt)) return 0;
  return Math.max(1, Math.round(wildMax(g, sp) * suitability(g, sp)));
}

/** The most wild units of sp a perfect niche holds: `wild`, or `wildShare` of the capacity of its zones. */
export function wildMax(g: Game, sp: SpeciesDef): number {
  if (!sp.wildShare) return sp.wild ?? 0;
  let cap = 0;
  for (const zi of g.habitatZones(sp)) cap += g.capacity(zi);
  return sp.wildShare * cap;
}

/** Wild units of sp (never more than the species has: catastrophes and displacement take the wild first). */
export function wildOf(g: Game, id: string): number {
  const w = (g.run.wild ??= {});
  const n = Math.min(w[id] ?? 0, totalPop(g, id));
  w[id] = n;
  return n;
}

/** Wild births and deaths for dt seconds. */
export function wildStep(g: Game, dt: number): void {
  if (g.state.phase !== 'play' || dt <= 0) return;
  const r = g.run;
  const W = (r.wild ??= {}), T = (r.wildT ??= {});
  for (const sp of CFG.species) {
    const w = wildOf(g, sp.id);
    const grow = wildCap(g, sp), hold = w > 0 ? wildCap(g, sp, true) : 0;
    if (w >= grow && w <= hold) { T[sp.id] = 0; continue; }
    T[sp.id] = (T[sp.id] ?? 0) + dt;
    if (w < grow) {
      // a big niche (a forest) fills faster than a few units: one every growSec / (cap / 8)
      if (T[sp.id] < N.growSec / Math.max(1, grow / 8)) continue;
      T[sp.id] = 0;
      const zi = g.freeZoneFor(sp);
      if (zi < 0) continue;
      const first = totalPop(g, sp.id) === 0;
      r.pop[sp.id][zi]++;
      W[sp.id] = w + 1;
      const t = totalPop(g, sp.id);
      if (t > (r.peak[sp.id] ?? 0)) r.peak[sp.id] = t;
      g.statsDirty = true;
      if (!g.headless) g.bus.emit('wildBorn', { id: sp.id, zi, first });
    } else {
      if (T[sp.id] < N.declineSec) continue;
      T[sp.id] = 0;
      const p = r.pop[sp.id];
      let zi = 0;
      for (let z = 1; z < 3; z++) if (p[z] > p[zi]) zi = z;
      if (p[zi] <= 0) continue;
      p[zi]--;
      W[sp.id] = w - 1;
      addCarcass(g, zi, sp, 1);
      r.peak[sp.id] = Math.min(r.peak[sp.id] ?? 0, totalPop(g, sp.id));
      g.statsDirty = true;
      if (!g.headless) g.bus.emit('wildDied', { id: sp.id, zi, last: totalPop(g, sp.id) === 0 });
    }
  }
}

/** The species that moves the era's condition now (the lever the goal line points at), or null. */
export function leverSpecies(g: Game): SpeciesDef | null {
  const c = g.eraDef().cond;
  const alive = (id: string) => totalPop(g, id) > 0;
  const pick = (ids: string[]) => {
    for (const id of ids) { const sp = CFG.speciesById[id]; if (sp && g.speciesGate(sp) && !alive(id)) return sp; }
    for (const id of ids) { const sp = CFG.speciesById[id]; if (sp && g.speciesGate(sp)) return sp; }
    return null;
  };
  switch (c.type) {
    case 'oxygen': return pick(['mats']);
    case 'speciesCount': return pick(CFG.species.filter((s) => s.groups.includes(c.group!)).map((s) => s.id));
    case 'forest': return pick(['trees']);
    case 'animals': return alive('predators') ? pick(['herds', 'insects', 'birds']) : pick(['herds', 'predators']);
    case 'settled': return pick(['tribe']);
  }
  return null;
}

/** Did the last pile, dropped at world x, feed a group of materials the lever of the era goal still lacks
 *  (its zone is the lever's habitat and the pile's base or its extra belongs to that group)? */
export function pileFeedsLever(g: Game, X: number): boolean {
  const sp = leverSpecies(g);
  if (!sp) return false;
  const zi = g.zoneMap[Math.max(0, Math.min(g.zoneMap.length - 1, Math.round(X)))];
  if (!g.habitatZones(sp).includes(zi)) return false;
  const lack = needs(g, sp).filter((n) => n.kind === 'mix' && n.ok < 1);
  if (!lack.length) return false;
  const mats = [g.run.pileSec];
  for (const n of lack) {
    const q = GROUPS.indexOf(n.key);
    if (q >= 0 && mats.some((m) => GROUP_BITS[m] & (1 << q))) return true;
  }
  return false;
}
