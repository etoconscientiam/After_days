// Life on the surface: statistical deaths, carcass pools, oxygen, regrowth, catastrophes.
import { CFG, ZONES, SpeciesDef } from '../config';
import type { Game } from './game';
import type { Pool } from './state';

export function totalPop(g: Game, id: string): number {
  const p = g.run.pop[id];
  return p ? p[0] + p[1] + p[2] : 0;
}

export function speciesAlive(g: Game): number {
  let n = 0;
  for (const sp of CFG.species) if (totalPop(g, sp.id) > 0) n++;
  return n;
}

export function lifespan(g: Game, sp: SpeciesDef): number {
  const mu = g.run.mutations[sp.id];
  let l = sp.lifespan;
  if (mu === 'swarm') l *= 0.7;
  if (mu === 'longlife') l *= 1.6;
  return l;
}

/** Add n dead units of species sp in zone zi to that zone's carcass pool. */
export function addCarcass(g: Game, zi: number, sp: SpeciesDef, n: number): void {
  const pool = g.run.pools[ZONES[zi]];
  const org = (sp.death.org ?? 0) * n;
  let bone = (sp.death.bone ?? 0) * n;
  if (g.run.mutations[sp.id] === 'shell') bone *= 1.5;
  const before = pool.orgM + pool.orgL + pool.bone;
  const add = org + bone;
  if (add <= 0) return;
  if (sp.death.orgMat === 'orgMarine' || zi === 0) pool.orgM += org;
  else pool.orgL += org;
  pool.bone += bone;
  pool.boneSpec[sp.idx] += bone;
  pool.age = before + add > 0 ? (pool.age * before) / (before + add) : 0;
}

export function lifeStep(g: Game, dy: number): void {
  const r = g.run;
  const T = CFG.B.taphonomy;
  // oxygen
  let o2 = 0;
  for (const sp of CFG.species) if (sp.oxygen) o2 += sp.oxygen * totalPop(g, sp.id);
  r.oxygen = Math.min(CFG.B.oxygen.max, r.oxygen + o2 * dy);

  const predIn = [0, 0, 0];
  for (const sp of CFG.species) if (sp.predator) for (let z = 0; z < 3; z++) predIn[z] += r.pop[sp.id][z];

  for (const sp of CFG.species) {
    const p = r.pop[sp.id];
    const tot = p[0] + p[1] + p[2];
    if (tot <= 0) continue;
    const life = lifespan(g, sp);
    for (let z = 0; z < 3; z++) {
      if (p[z] <= 0) continue;
      const mult = sp.groups.includes('prey') && predIn[z] > 0 ? 2 : 1;
      const deaths = (p[z] * dy * mult) / life;
      r.deaths += deaths;
      addCarcass(g, z, sp, deaths);
    }
    // natural regrowth back toward the peak after catastrophes
    const peak = r.peak[sp.id] ?? 0;
    if (tot < peak) {
      r.regrow[sp.id] = (r.regrow[sp.id] ?? 0) + (tot * dy) / (life * CFG.B.regrowth.factor);
      while (r.regrow[sp.id] >= 1 && totalPop(g, sp.id) < peak) {
        const zi = g.freeZoneFor(sp);
        if (zi < 0) { r.regrow[sp.id] = 0; break; }
        p[zi]++;
        r.regrow[sp.id] -= 1;
        g.statsDirty = true;
      }
    } else r.regrow[sp.id] = 0;
  }

  // carcass pools: scavengers and rot
  const f = Math.pow(1 - T.rotShare, dy / T.rotEvery);
  for (const z of ZONES) {
    const pool = r.pools[z];
    pool.orgM *= f; pool.orgL *= f; pool.bone *= f;
    for (let i = 0; i < pool.boneSpec.length; i++) pool.boneSpec[i] *= f;
    pool.age += dy;
  }

  // species that lost their habitat (sea moved, capacity shrank) die off
  for (let z = 0; z < 3; z++) {
    let over = g.used(z) - g.capacity(z);
    if (over <= 0.5) continue;
    for (const sp of CFG.species) {
      while (over > 0.5 && r.pop[sp.id][z] > 0) {
        r.pop[sp.id][z]--;
        addCarcass(g, z, sp, 1);
        over -= g.unitSize(sp);
        g.statsDirty = true;
      }
    }
  }
}

/** Kill a share of population per zone [water, shore, land]. Killed go to the carcass pool at once. */
export function killShare(g: Game, shares: number[], cause: string): number {
  const r = g.run;
  let killed = 0;
  for (const sp of CFG.species) {
    const p = r.pop[sp.id];
    for (let z = 0; z < 3; z++) {
      if (!shares[z] || p[z] <= 0) continue;
      const exact = p[z] * shares[z];
      let k = Math.floor(exact);
      if (g.rng.next() < exact - k) k++;
      if (k <= 0) continue;
      p[z] -= k;
      killed += k;
      addCarcass(g, z, sp, k);
    }
  }
  if (killed > 0) {
    g.statsDirty = true;
    g.bus.emit('extinction', { cause, killed });
    if (g.firstTime('extinction')) g.triggerMemory('firstExtinction');
  }
  return killed;
}

export function poolMass(p: Pool): number {
  return p.orgM + p.orgL + p.bone;
}
