// Balance simulation: runs the core headless with a simple bot and writes CSV timings.
// Usage: npm run sim -- [hours=10] [clicksPerSec=2] [seed=1]
import { mkdirSync, writeFileSync } from 'node:fs';
import { CFG } from '../src/config';
import { Game } from '../src/core/game';
import { newGameState } from '../src/core/state';
import { totalPop } from '../src/core/life';

const hours = Number(process.argv[2] ?? 10);
const cps = Number(process.argv[3] ?? 2);
const seed = Number(process.argv[4] ?? 1);
const DT = 0.5;

const g = new Game(newGameState(seed));
g.headless = true;
const rows: string[] = ['event,real_s,real_min,year,era,detail'];
const log = (ev: string, detail = '') => {
  const t = g.state.legacy.totalRealTime;
  rows.push(`${ev},${t.toFixed(0)},${(t / 60).toFixed(1)},${Math.round(g.run.year)},${g.run.era},${detail}`);
  console.log(`[${(t / 60).toFixed(1)} min] ${ev} ${detail}`);
};
g.bus.on('eraChanged', (e) => log('era', String(e.era)));
g.bus.on('rockDiscovered', (e) => log('rock', e.rock));
g.bus.on('prestige', (e) => log('prestige', `gain=${e.gain} total=${g.meta.density} foundation=${g.meta.foundation.toFixed(1)}`));
g.bus.on('fossilFound', (e) => { if (e.complete && g.legacy.fossils <= 5) log('fossil', e.species + (e.rare ? ' rare' : '')); });
g.bus.on('temple', (e) => log('temple', e.ritual));
g.bus.on('noteFound', (e) => log('note', e.id));

let clickAcc = 0;
let stuck = 0;
let lastYear = 0;
const densityPriority = ['deepMemory', 'evolution', 'agesPress', 'fertileSoil', 'strongFound', 'tenacious', 'warmDepths', 'legacy', 'autoElements', 'longSleep'];

function botBuy() {
  // rock upgrades whenever affordable
  for (const u of CFG.upgrades) if (u.currency !== 'energy') while (g.buyUpgrade(u.id)) {}
  for (let guard = 0; guard < 50; guard++) {
    const inc = g.incomePerSec(false) + 0.1;
    let best: (() => boolean) | null = null;
    let bestScore = 0;
    for (const sp of CFG.species) {
      if (!g.speciesUnlocked(sp) || g.freeZoneFor(sp) < 0) continue;
      const cost = g.speciesCost(sp);
      // prefer species that the era condition needs
      let score = (sp.eps / cost) * (totalPop(g, sp.id) === 0 ? 5 : 1);
      if (sp.id === 'mats' && g.run.era === 1) score *= 4;
      if (sp.id === 'trees' && g.run.era === 3) score *= 4;
      if (sp.id === 'tribe') score *= 6;
      if (cost <= g.run.energy && score > bestScore) { bestScore = score; best = () => g.buySpecies(sp.id); }
    }
    for (const id of ['impulse', 'radiance', 'striving', 'sediment']) {
      const cost = g.upgradeCost(id);
      if (cost > g.run.energy) continue;
      let gain = 0;
      if (id === 'radiance') gain = 0.5 * g.stats.energyMul;
      if (id === 'impulse') gain = cps * g.stats.clickMul * 0.5;
      if (id === 'striving') gain = inc * 0.05 * 0.5;
      if (id === 'sediment') gain = inc * 0.03 * 0.5;
      const score = gain / cost;
      if (score > bestScore) { bestScore = score; best = () => g.buyUpgrade(id); }
    }
    if (!best || !best()) break;
  }
}

/** Make room for a species the era condition needs by releasing the weakest earners in its habitat. */
function makeRoom(id: string) {
  const sp = CFG.speciesById[id];
  if (!g.speciesUnlocked(sp) || g.freeZoneFor(sp) >= 0) return;
  if (g.run.energy < g.speciesCost(sp)) return;
  const zones = g.habitatZones(sp);
  const victims = CFG.species.filter((v) => v.id !== id && v.eps < sp.eps && zones.some((z) => g.run.pop[v.id][z] > 0)).sort((a, b) => a.eps - b.eps);
  if (victims.length) g.releaseSpecies(victims[0].id);
}

function botElements() {
  const r = g.run;
  const cast = (id: string, target?: { x: number; v: number }) => {
    const el = CFG.elements.find((e) => e.id === id)!;
    if (g.canCast(el) && g.elementCost(el) < r.energy * 0.3) g.cast(id, target);
  };
  if (r.era >= 1) cast('flood');
  cast('rain');
  if (r.era >= 1) cast('groundwater', { x: 60, v: 120 });
  if (r.era >= 2) cast('heat', { x: 80, v: 60 });
  if (r.era >= 2 && g.rng.next() < 0.02) cast('volcano');
  if (r.era >= 4 && g.rng.next() < 0.01) cast('glacier');
}

const end = hours * 3600;
while (g.state.legacy.totalRealTime < end) {
  clickAcc += cps * DT;
  while (clickAcc >= 1) { g.click(); clickAcc -= 1; }
  g.update(DT);
  if (Math.floor(g.state.legacy.totalRealTime) % 2 === 0) {
    const need: Record<number, string[]> = { 3: ['trees'], 5: ['fossor', 'vigil', 'litoralis'], 6: ['tribe'], 7: ['tribe'] };
    for (const id of need[g.run.era] ?? []) makeRoom(id);
    botBuy(); botElements();
  }
  if (g.state.phase === 'finale') g.chooseRitual(CFG.rituals.find((r) => !g.legacy.rituals.includes(r.id))!.id);
  if (g.state.phase === 'newWorld') { log('done', `playthrough ${g.legacy.playthrough}`); break; }
  // prestige heuristic: stuck at an era wall, or a big gain
  if (Math.abs(g.run.year - lastYear) < 1e-6) stuck += DT; else stuck = 0;
  lastYear = g.run.year;
  const gain = g.prestigeGain();
  if (gain >= 1 && g.run.era < 7 && ((stuck > 300 && gain >= Math.max(1, (g.meta.density + g.meta.densitySpent) * 0.5)) || gain >= (g.meta.density + g.meta.densitySpent) * 2 + 2)) {
    g.prestige();
    for (const id of densityPriority) while (g.buyDensity(id)) {}
    stuck = 0;
  }
  if (Math.floor(g.state.legacy.totalRealTime) % 600 === 0 && g.state.legacy.totalRealTime % 1 === 0) {
    const rocks = Object.entries(g.run.rocks).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v.toFixed(0)}`).join(' ');
    console.log(`  .. ${(g.state.legacy.totalRealTime / 60).toFixed(0)}m era=${g.run.era} year=${Math.round(g.run.year)} E=${g.run.energy.toExponential(2)} inc=${g.incomePerSec(false).toExponential(2)} yps=${g.yps(false).toFixed(1)} O2=${g.run.oxygen.toFixed(1)} cells=${g.world.totalCells} packs=${g.world.packs.length} gain=${gain} cond=${g.eraConditionProgress().toFixed(2)} fossils=${g.legacy.fossils} ${rocks}`);
  }
}
log('end', `density=${g.meta.density} prestiges=${g.meta.prestiges}`);
mkdirSync('sim/out', { recursive: true });
writeFileSync(`sim/out/sim_${seed}.csv`, rows.join('\n'));
console.log(`wrote sim/out/sim_${seed}.csv`);
