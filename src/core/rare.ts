// Rare surface events (brief 5, В1): a reward for watching, never a punishment for being away.
// One at a time, every 2-5 real minutes, for 12 seconds; tap to collect.
import { CFG, RareDef, RULES_BY_MAT } from '../config';
import type { Game } from './game';
import { GW } from '../world/Grid';
import { finishLayer } from './geology';

const W = CFG.B.world.width;

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
      // anywhere in the strata (not the freshest skin, not the bottom by the thing)
      const grid = g.grid;
      const cx = Math.floor(rnd(g, 5, GW - 13));
      const y0 = grid.surf[cx] + 3, y1 = grid.sinkRow - 2;
      if (y1 - y0 < 4) continue;
      const i = Math.floor(rnd(g, y0, y1)) * GW + cx;
      if (!grid.mat[i]) continue;
      x = cx * 2 + 1;
      birth = grid.birth[i];
    }
    else if (def.place === 'section') {
      // a spot where a transformation is under way
      const grid = g.grid;
      let found = -1;
      for (let k = 0; k < 60 && found < 0; k++) {
        const cx = Math.floor(rnd(g, 4, GW - 4));
        if (grid.sinkRow - grid.surf[cx] < 3) continue;
        const i = Math.floor(rnd(g, grid.surf[cx], grid.sinkRow)) * GW + cx;
        if (grid.prog[i] > 0 && RULES_BY_MAT[grid.mat[i]].length) { found = i; x = cx * 2 + 1; birth = grid.birth[i]; }
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
    // the special material the player has least of (by its worth)
    const least = g.leastSpecial();
    if (least) {
      const u = g.specialUnit(least);
      g.addSpecial(least, Math.max((rw.min ?? 5) * u, Math.ceil((r.rocks[least] ?? 0) * rw.rockLeast)));
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
