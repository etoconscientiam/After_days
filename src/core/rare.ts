// Rare surface events (brief 5, В1): a reward for watching, never a punishment for being away.
// One at a time, every 2-5 real minutes, for 12 seconds; tap to collect.
import { CFG, RareDef, RULES_BY_MAT } from '../config';
import type { Game } from './game';
import { W, CAP } from '../world/World';
import { finishLayer } from './geology';

export interface RareEvent { def: RareDef; x: number; t: number; birth?: number }

function rnd(g: Game, a: number, b: number): number { return a + g.rng.next() * (b - a); }

export function nextRareIn(g: Game): number { return rnd(g, CFG.rare.every[0], CFG.rare.every[1]); }

/** Pick an event that fits the era and a place for it. */
export function spawnRare(g: Game): RareEvent | null {
  const era = g.run.era;
  const pool = CFG.rare.events.filter((e) => era >= e.eras[0] && era <= e.eras[1]);
  if (!pool.length) return null;
  // most events happen in the strata (that is where the game is); weight picks them more often
  const total = pool.reduce((s, e) => s + (e.weight ?? 1), 0);
  const pick = () => { let u = g.rng.next() * total; for (const e of pool) { u -= e.weight ?? 1; if (u <= 0) return e; } return pool[pool.length - 1]; };
  for (let tries = 0; tries < 6; tries++) {
    const def = pick();
    let x = Math.floor(rnd(g, 14, W - 14));
    let birth: number | undefined;
    if (def.place === 'shore') { const sx = g.run.waterEnd * (W / 360); x = Math.round(Math.max(10, Math.min(W - 10, sx + rnd(g, -6, 10)))); }
    else if (def.place === 'land') { const land0 = g.run.shoreEnd * (W / 360); x = Math.round(Math.max(land0 + 8, Math.min(W - 16, rnd(g, land0 + 10, W - 14)))); }
    else if (def.place === 'horizon') x = Math.round(rnd(g, 20, W - 20));
    else if (def.place === 'strata') {
      // anywhere in the layers (not the freshest skin, not the deep packs)
      const w = g.world;
      x = Math.floor(rnd(g, 10, W - 26));
      const L = w.len[x];
      if (L < 6) continue;
      const i = Math.floor(rnd(g, 0, L - 3));
      birth = w.birth[x * CAP + i];
    }
    else if (def.place === 'section') {
      // a layer with a transformation under way
      const w = g.world;
      let found = -1;
      for (let k = 0; k < 40 && found < 0; k++) {
        const xx = Math.floor(rnd(g, 8, W - 8));
        const L = w.len[xx];
        if (L < 3) continue;
        const i = Math.floor(rnd(g, 0, L - 1));
        const j = xx * CAP + i;
        if (w.prog[j] > 0 && RULES_BY_MAT[w.mat[j]].length) { found = j; x = xx; birth = w.birth[j]; }
      }
      if (found < 0) continue;
    }
    return { def, x, t: CFG.rare.lifetime, birth };
  }
  return null;
}

/** Collect the event's reward. Returns a short key for the notification. */
export function claimRare(g: Game, ev: RareEvent): string {
  const r = g.run;
  const rw = ev.def.reward as Record<string, number>;
  if (rw.energySeconds) {
    const e = g.incomePerSec(false) * rw.energySeconds + g.clickValue() * 10;
    r.energy += e; r.energyEarned += e;
  }
  if (rw.rockLeast !== undefined) {
    const have = g.legacy.discovered.filter((id) => CFG.rocks.some((rk) => rk.id === id));
    if (have.length) {
      let least = have[0];
      for (const id of have) if ((r.rocks[id] ?? 0) < (r.rocks[least] ?? 0)) least = id;
      const avg = have.reduce((a, id) => a + (r.rocks[id] ?? 0), 0) / have.length;
      g.addRock(least, Math.max(rw.min ?? 5, Math.ceil(avg * rw.rockLeast)));
    } else {
      const e = g.incomePerSec(false) * 45 + g.clickValue() * 10;
      r.energy += e; r.energyEarned += e;
    }
  }
  if (rw.energyMul) { r.buffs.energyMul = rw.energyMul; r.buffs.energyT = Math.max(r.buffs.energyT, rw.seconds ?? 30); }
  if (rw.timeMul) { r.buffs.timeMul = rw.timeMul; r.buffs.timeT = Math.max(r.buffs.timeT, rw.seconds ?? 30); }
  if (rw.transform && ev.birth !== undefined) finishLayer(g, ev.x, ev.birth);
  if (rw.relicChance) {
    const missing = CFG.relics.filter((rel) => !(g.legacy.relics[rel.id] > 0));
    if (missing.length && g.rng.next() < rw.relicChance) {
      const rel = missing[Math.floor(g.rng.next() * missing.length)];
      g.legacy.relics[rel.id] = (g.legacy.relics[rel.id] ?? 0) + 1;
      g.statsDirty = true;
      g.bus.emit('relicFound', { id: rel.id });
    } else {
      const e = g.incomePerSec(false) * 30;
      r.energy += e; r.energyEarned += e;
    }
  }
  g.bus.emit('rareClaimed', { id: ev.def.id, x: ev.x });
  return ev.def.id;
}
