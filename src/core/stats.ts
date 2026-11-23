// Derived modifiers from upgrades, the Density tree, the Museum, hominid traits and ritual world mods.
import { CFG } from '../config';
import type { GameState } from './state';

export interface Stats {
  clickAdd: number; clickMul: number; passiveAdd: number; timeSpeed: number; timeSpeedDensity: number;
  deposition: number; /** share of the natural flow of sediment that falls on its own (0 at the start: taps only) */ drizzle: number; boostMax: number; lifeEnergy: number; seaCapacity: number; landCapacity: number;
  press: number; fossilChance: number; layerWeight: number; geoHeat: number; geoGradient: number;
  excavation: number; tribeAttract: number; kMax: number; energyMul: number; foundation: number;
  autoSlots: number; legacy: number; offlineHours: number; startEra: number; transformSpeed: number;
  seaEnergy: number; temple: number; memory: number; traitTime: number;
  pressPower: number; pressRadius: number; shepherdSlots: number; buyBest: number;
  /** branch pile: extra particles levels, and the share of each material (by id) in every tapped pile */
  pileSize: number; pile: Record<string, number>;
}

export function upgradeEffect(level: number, value: number, kind: 'add' | 'mul', milestones = true): number {
  let ms = 0;
  if (milestones) for (const m of CFG.milestones) if (level >= m) ms++;
  if (kind === 'add') return value * level * 2 ** ms;
  return value ** level * 2 ** ms;
}

export function upgradePrice(base: number, level: number, growth = CFG.upgradeGrowth): number {
  return base * growth ** level;
}

export function densityPrice(base: number, mult: number, level: number): number {
  return Math.ceil(base * mult ** level);
}

export function computeStats(s: GameState): Stats {
  const st: Stats = {
    clickAdd: 0, clickMul: 1, passiveAdd: 0, timeSpeed: 0, timeSpeedDensity: 0, deposition: 0, drizzle: 0, boostMax: 0,
    lifeEnergy: 0, seaCapacity: 0, landCapacity: 0, press: 0, fossilChance: 0, layerWeight: 0, geoHeat: 0,
    geoGradient: 0, excavation: 0, tribeAttract: 0, kMax: 0, energyMul: 1, foundation: 0, autoSlots: 0,
    legacy: 0, offlineHours: 0, startEra: 0, transformSpeed: 0, seaEnergy: 0, temple: 0, memory: 0, traitTime: 0,
    pressPower: 0, pressRadius: 0, shepherdSlots: 0, buyBest: 0, pileSize: 0, pile: {},
  };
  const r = s.run;
  for (const u of CFG.upgrades) {
    const lvl = r.upgrades[u.id] ?? 0;
    if (!lvl) continue;
    const e = upgradeEffect(lvl, u.value, u.kind, !!u.milestones);
    if (u.pileMat) { st.pile[u.pileMat] = (st.pile[u.pileMat] ?? 0) + e; continue; }
    if (u.kind === 'mul') (st as any)[u.stat] *= e;
    else (st as any)[u.stat] += e;
    if (u.extra) (st as any)[u.extra.stat] += u.extra.value * lvl;
  }
  for (const n of CFG.density) {
    const lvl = s.meta.tree[n.id] ?? 0;
    if (!lvl) continue;
    const v = n.value * lvl;
    if (n.stat === 'timeSpeed') st.timeSpeedDensity += v;
    else (st as any)[n.stat] += v;
  }
  // Museum: +2% transform speed per common fossil, rare ones add fossil chance and energy; full era sets add energy.
  const B = CFG.B.taphonomy;
  const eraSets: Record<number, { total: number; have: number }> = {};
  for (const sp of CFG.species) {
    if (!sp.death.bone) continue;
    const m = s.legacy.museum[sp.id];
    const set = (eraSets[sp.era] ??= { total: 0, have: 0 });
    set.total++;
    if (m && m.common > 0) { st.transformSpeed += B.museumBonus; set.have++; }
    if (m && m.rare > 0) { st.fossilChance += B.museumBonus; st.energyMul *= 1.01; }
  }
  // relics from the old world: a small permanent bonus each, like fossils
  for (const rel of CFG.relics) if ((s.legacy.relics?.[rel.id] ?? 0) > 0) st.energyMul *= 1 + CFG.story.relicBonus;
  for (const k in eraSets) if (eraSets[k].total > 0 && eraSets[k].have === eraSets[k].total) st.energyMul *= 1 + B.museumSetBonus;
  // Hominid traits apply while the species lives.
  for (const sp of CFG.species) {
    if (!sp.trait) continue;
    const p = r.pop[sp.id];
    if (!p || p[0] + p[1] + p[2] <= 0) continue;
    for (const [k, v] of Object.entries(sp.trait)) {
      if (k === 'timeSpeed') st.traitTime += v;
      else if (k === 'press') st.press += v;
      else (st as any)[k] = ((st as any)[k] ?? 0) + v;
    }
  }
  return st;
}
