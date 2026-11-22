// Offline progress: simplified, in batches of ~50 game years. Era cannot change offline.
import { CFG } from '../config';
import type { Game } from './game';
import { geoTickGame } from './geology';

export interface OfflineReport { seconds: number; years: number; layers: number; rocks: Record<string, number>; fossils: number; notes: string[]; energy: number }

export function runOffline(g: Game, seconds: number): OfflineReport | null {
  const T = CFG.B.time;
  const maxSec = (T.offlineMaxHours + g.stats.offlineHours) * 3600;
  const sec = Math.min(seconds, maxSec);
  const r = g.run;
  if (sec < 30 || g.state.phase !== 'play') return null;
  const end = g.eraDef().end;
  const yps = g.yps(false) * T.offlineSpeed;
  // the world runs the whole time; the calendar stops at the era's end (era cannot change offline)
  const years = yps * sec;
  const rocksBefore = { ...r.rocksEarned };
  const layersBefore = r.layers;
  const fossilsBefore = r.fossilsRun;
  const notesBefore = g.legacy.notes.length;
  const energy = g.incomePerSec(false) * sec * T.offlineSpeed;
  r.energy += energy;
  r.energyEarned += energy;
  const wasHeadless = g.headless;
  g.headless = true;
  g.bus.muted = true;
  let left = years;
  const step = Math.max(T.offlineStepYears, years / 400);
  while (left > 1e-6) {
    const dy = Math.min(step, left);
    r.year = Math.min(end, r.year + dy);
    r.clock += dy;
    g.simulate(dy);
    geoTickGame(g, dy);
    // the conveyor runs for the real seconds these years stand for
    g.strataStep(dy / Math.max(1e-6, yps));
    left -= dy;
  }
  g.bus.muted = false;
  g.headless = wasHeadless;
  for (const k in r.cooldowns) r.cooldowns[k] = 0;
  const rocks: Record<string, number> = {};
  for (const k in r.rocksEarned) {
    const d = r.rocksEarned[k] - (rocksBefore[k] ?? 0);
    if (d > 0.5) rocks[k] = d;
  }
  return {
    seconds: sec, years, layers: r.layers - layersBefore, rocks, fossils: r.fossilsRun - fossilsBefore,
    notes: g.legacy.notes.slice(notesBefore), energy,
  };
}
