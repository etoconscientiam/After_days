// The game's geology tick (every 0.5 s real time): the particles (core/pressure.ts) and the archive of the depth
// (core/archiveGeo.ts) under the game's world modifiers, upgrades, elements and the finger. Here also the fossil roll
// of a bone, the cached aggregates (compacted mass for the prestige, fertility, excavation need) and the «glowing
// layer» reward that finishes transformations around a spot.
import { CFG, RULES_BY_MAT, TransformRule } from '../config';
import type { Game } from './game';
import { GW, P_FOSSIL, P_RARE, P_FRAGMENT, P_FAST, P_OLD } from '../world/Grid';
import { geoTick, GeoEnv, GeoReport, newReport } from './pressure';
import { archiveTick } from './archiveGeo';
import { wx } from './sources';

const S = CFG.B.sand;
const CPP = S.cellsPerParticle;

/** May this rule run in this world at all (world modifiers, ranks of the living world)? */
export function ruleAllowed(g: Game, rule: TransformRule): boolean {
  if (rule.world === 'hot' && !g.mods.hot) return false;
  if (rule.rankReq && g.mods.living) {
    const src = CFG.materials[rule.fromIdx].rock ?? '';
    if ((g.run.rockRanks[src] ?? 0) < rule.rankReq) return false;
  }
  return true;
}

/** Heat of the heat/magma zones at world column X for birth year b. */
export function heatAt(g: Game, X: number, b: number): number {
  let h = 0;
  for (const t of g.run.targets) if (t.kind !== 'water' && X >= t.x0 && X <= t.x1 && b >= t.b0 && b <= t.b1) h += t.heat;
  return h;
}

export function groundwaterAt(g: Game, X: number, b: number): boolean {
  for (const t of g.run.targets) if (t.kind === 'water' && X >= t.x0 && X <= t.x1 && b >= t.b0 && b <= t.b1) return true;
  return false;
}

/** Pressure on top of the strata: the foundation of past epochs and a glacier. */
export function surfacePressure(g: Game): number {
  return g.meta.foundation * CFG.B.physics.foundationP * (1 + g.stats.foundation) + g.run.glacierLoad;
}

/** Everything the particle geology needs from the game, for dy game years. */
export function geoEnv(g: Game, dy: number): GeoEnv {
  const st = g.stats;
  const r = g.run;
  const pr = r.press && r.press.power > 0 ? r.press : null;
  let glints = 0;
  return {
    rng: g.rng, dy,
    speed: (1 + st.transformSpeed) * (1 + g.diversityBonus()),
    // until the strata first reach the line (the thing has taken a row), a particle compacts only under enough load —
    // the front follows the pile's shape, as in the prototype; after that by pressure everywhere, as the economy needs
    compactDepth: CFG.B.sand.compactAtLine && g.run.sink.rows === 0 ? Math.round((g.grid.sinkRow + 1 - g.lineRow()) * CFG.B.sand.compactDepthShare) : -1,
    P0: surfacePressure(g),
    pressMul: (1 + st.press) * (1 + st.layerWeight),
    T0: CFG.B.physics.surfaceT + st.geoHeat,
    gradMul: g.mods.geoGradientMul * (1 + st.geoGradient),
    ruleAllowed: (rule) => ruleAllowed(g, rule),
    heatAt: (x, b) => heatAt(g, wx(x), b),
    waterAt: (x, b) => groundwaterAt(g, wx(x), b),
    marine: (x) => g.zoneMap[wx(x)] === 0,
    finger: pr ? { x: pr.x, y: pr.y, r: pr.r, power: pr.power } : null,
    onTransform: (i, x, y, _from, to, rule, insect) => {
      if (insect) r.insectAmber++;
      g.transforms++;
      const yv = insect ? rule.insectYield! : rule.yield;
      if (yv > 0 && !(g.grid.flags[i] & P_OLD)) g.formRock(rule.rock, yv * CFG.B.rockYield * CPP * S.rockYieldMul, wx(x));
      // every grain that turns to rock flashes: a small bright spark in the colour of the new rock
      // (about one in three, scattered inside the grain and in time: a sprinkle of sparks, never a grid of dots)
      if (g.rng.next() < 0.35 && glints++ < 60 && g.glints.length < 120) {
        g.glints.push({ x: x * 2 + (g.rng.next() < 0.5 ? 0 : 1), y: y * 2 + (g.rng.next() < 0.5 ? 0 : 1), t: 0.35 + g.rng.next() * 0.45, color: CFG.materials[to].palette[3] ?? CFG.materials[to].palette[0] });
      }
      if (pr) {
        const dx = x - pr.x, dyy = y - pr.y;
        if (dx * dx + dyy * dyy <= pr.r * pr.r && g.pressFlashes.length < 80) g.pressFlashes.push({ x: wx(x), y: y * 2 + 1, t: 0.9, color: CFG.materials[to].palette[4] });
      }
      void i;
    },
    onFossilRoll: (i, x, y, mineral) => rollFossil(g, i, x, y, mineral),
  };
}

/** One geology tick of the whole strata: particles, then the archive below them. */
export function geoTickGame(g: Game, dy: number): void {
  const r = g.run;
  const env = geoEnv(g, dy);
  const rep: GeoReport = geoTick(g.grid, env, g.geoReport ?? newReport());
  g.geoReport = rep;
  if (dy > 0) { g.hotNow.set(rep.hot); g.hotY.set(rep.hotY); }
  // «moved by the press» (orders): the particles under the finger this tick
  r.pressMoved += rep.pressed * 0.003;
  // the archive feels the whole column above it
  const arc = archiveTick(g, dy, env);
  // compacted mass (the prestige): the load each particle bears, and the archive's layers with their compaction
  let mass = 0;
  const P0 = env.P0;
  const grid = g.grid;
  for (let x = 0; x < GW; x++) {
    let P = P0;
    for (let y = grid.surf[x]; y < grid.floor; y++) {
      const m = grid.mat[y * GW + x];
      if (!m) continue;
      P += CFG.materials[m].density * S.pressurePerParticle;
      mass += (P - P0) * CPP;
    }
  }
  r.compactMass = mass + arc.mass;
  if (rep.maxP >= CFG.story.echoCompactionK * 5) g.triggerEcho('compactionVisible');
  r.fertility = Math.min(CFG.B.fertility.max, rep.fertile * CPP * CFG.B.fertility.perPixel);
  if (r.era >= 7) {
    r.excavationNeed = g.mods.shards ? Math.max(...g.shardXs().map((x) => g.artifactDepth(x))) : g.artifactDepth();
  }
  g.statsDirty = true;
}

/** The fossil roll of a bone particle (once, when the pressure first reaches fossilP). */
export function rollFossil(g: Game, i: number, x: number, y: number, mineral: number): void {
  const grid = g.grid;
  const tap = CFG.B.taphonomy;
  const d = grid.decay[i] / 255;
  const fast = (grid.flags[i] & P_FAST) !== 0;
  const sp = CFG.species[grid.spec[i] - 1];
  if (!sp) return;
  let chance = tap.fossilBase * (fast ? 5 : 1) * mineral * (1 - d) * (1 + g.stats.fossilChance);
  // a burial caught in the window after a mass death fossilises three times as easily
  const bu = g.run.burials, b = grid.birth[i];
  for (let q = 0; q < bu.length; q += 3) if (b >= bu[q] && b <= bu[q + 1]) { chance *= bu[q + 2]; break; }
  if (g.mods.living && g.run.mutations[sp.id] === 'shell') chance *= 2;
  chance = Math.min(0.95, chance);
  const u = g.rng.next();
  const mus = (g.legacy.museum[sp.id] ??= { common: 0, rare: 0, fragments: 0 });
  const depth = y - grid.surf[x];
  if (u < chance) {
    const rare = fast && d < tap.rareDecay;
    grid.flags[i] |= P_FOSSIL | (rare ? P_RARE : 0);
    if (rare) mus.rare++; else mus.common++;
    g.legacy.fossils++;
    g.run.fossilsRun++;
    g.statsDirty = true;
    g.bus.emit('fossilFound', { species: sp.id, rare, fragment: false, complete: true, x: wx(x), depth });
    g.triggerEcho('firstFossil');
  } else if (u < chance * 2) {
    // near miss: a fragment; three make a whole fossil (bad-luck protection)
    grid.flags[i] |= P_FRAGMENT;
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
    g.bus.emit('fossilFound', { species: sp.id, rare: false, fragment: true, complete, x: wx(x), depth });
  }
  grid.version++;
}

/** Finish at once the transformations under way around (world column X, birth year b): the «glowing layer». */
export function finishLayer(g: Game, X: number, birth: number, dx = 12, db = 80): number {
  const grid = g.grid;
  const cx = Math.floor(X / 2), rx = Math.ceil(dx / 2);
  let n = 0;
  for (let x = Math.max(0, cx - rx); x <= Math.min(GW - 1, cx + rx); x++) {
    for (let y = grid.surf[x]; y < grid.floor; y++) {
      const i = y * GW + x;
      if (Math.abs(grid.birth[i] - birth) > db || grid.prog[i] <= 0) continue;
      const rule = RULES_BY_MAT[grid.mat[i]].find((ru) => ruleAllowed(g, ru));
      if (!rule) continue;
      grid.prog[i] = 0;
      grid.mat[i] = rule.toIdx;
      if (rule.yield > 0 && !(grid.flags[i] & P_OLD)) g.formRock(rule.rock, rule.yield * CFG.B.rockYield * CPP * S.rockYieldMul, wx(x));
      if (g.pressFlashes.length < 80) g.pressFlashes.push({ x: wx(x), y: y * 2 + 1, t: 1.2, color: CFG.materials[rule.toIdx].palette[4] });
      n++;
    }
  }
  if (n) grid.version++;
  return n;
}
