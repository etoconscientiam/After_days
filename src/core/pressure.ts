// Pressure, temperature and transformations of the particles, and the conveyor into the depth.
//
// Every particle feels the weight of the column above it (densities × pressurePerParticle, plus the foundation and a
// glacier), the temperature of its depth (plus heat zones of elements and magma), water (sea columns, groundwater
// zones) and air (the top rows). The rules are the game's transforms.json — the same conditions as before, checked
// per particle. A finished transformation is an event: the particle changes its material once (its look stays, so
// the pattern does not jump), the caller pays the rock and shows a small sparkle.
//
// The conveyor: when the mean column above the thing is taller than the line, the row right above the thing sinks
// into the archive and everything above moves down one row at the same moment (faster when that row is already rock).
// This is the only way the strata lose volume: particles never vanish one by one.
import { CFG, RULES_BY_MAT, TransformRule } from '../config';
import { Grid, GW, GH, KIND, DENS, K_NONE, K_SOLID, K_ROCK, K_MARKER, P_ROLLED, P_INSECT, P_FAST } from '../world/Grid';
import type { Rng } from './sand';

const S = CFG.B.sand;
const ORGANIC = CFG.materials.map((m) => !!m.organic);
const FERTILE = CFG.materials.map((m) => !!m.fertile);
const BONE = CFG.matIndex.bone;
const SOIL = CFG.matIndex.soil;

/** Conditions of a rule, as in transforms.json. */
export interface Cond { Peff: number; T: number; water: boolean; depth: number; oxygen: boolean }

/** Does the rule's physical condition hold? (World modifiers and ranks are the caller's ruleAllowed.) */
export function condOk(rule: TransformRule, c: Cond): boolean {
  if (rule.pMin !== undefined && c.Peff < rule.pMin) return false;
  if (rule.tMin !== undefined && c.T < rule.tMin) return false;
  if (rule.tMax !== undefined && c.T > rule.tMax) return false;
  if (rule.water && !c.water) return false;
  if (rule.noOxygen && c.oxygen) return false;
  if (rule.maxDepth !== undefined && c.depth > rule.maxDepth) return false;
  return true;
}

/** What the geology needs from the game. The core stays free of the Game class (tests, the balance run). */
export interface GeoEnv {
  rng: Rng;
  /** game years since the last tick */
  dy: number;
  /** transformation speed multiplier (upgrades, diversity) */
  speed: number;
  /** MPa on top of the strata: foundation of past epochs, a glacier */
  P0: number;
  /** pressure multiplier (upgrades) */
  pressMul: number;
  /** surface temperature and the gradient multiplier (hot world, upgrades) */
  T0: number;
  gradMul: number;
  /** world modifiers and ranks: may this rule run at all? */
  ruleAllowed(rule: TransformRule): boolean;
  /** extra heat (°C) of heat zones at column x for a particle born in year b */
  heatAt(x: number, b: number): number;
  /** groundwater zone at column x for a particle born in year b */
  waterAt(x: number, b: number): boolean;
  /** sea column */
  marine(x: number): boolean;
  /** how many particles must lie above a particle before it compacts (as in the prototype: a load threshold, so the
   *  compaction front follows the shape of the pile); -1: no such gate */
  compactDepth: number;
  /** the finger pressing the strata (grid coordinates), power after paying */
  finger: { x: number; y: number; r: number; power: number } | null;
  /** a transformation finished (the material is already changed) */
  onTransform(i: number, x: number, y: number, from: number, to: number, rule: TransformRule, insect: boolean): void;
  /** a bone reached the fossilisation pressure for the first time (P_ROLLED is already set); mineral = groundwater bonus */
  onFossilRoll(i: number, x: number, y: number, mineral: number): void;
}

export interface GeoReport {
  /** the strongest heat transformation running per column (0..1) and its row: the glow */
  hot: Float32Array;
  hotY: Int16Array;
  /** fertile particles near the surface on land */
  fertile: number;
  /** highest effective pressure seen */
  maxP: number;
  /** particles squeezed by the finger this tick (for «moved by the press») */
  pressed: number;
}

export function newReport(): GeoReport {
  return { hot: new Float32Array(GW), hotY: new Int16Array(GW), fertile: 0, maxP: 0, pressed: 0 };
}

/** Per-cell scratch of the tick: the load on each particle (MPa, -1 where empty) before and after the lateral
 *  spread, and the particle's depth under the surface. */
const LOAD = new Float32Array(GW * GH);
const SPREAD = new Float32Array(GW * GH);
const DEPTH = new Int16Array(GW * GH);

/** Is one of the 8 neighbours of particle (x, y) already the rock this rule makes? */
function nearTarget(mat: Uint8Array, x: number, y: number, rule: TransformRule): boolean {
  const to = rule.toIdx, to2 = rule.insectToIdx;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= GH) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx;
      if (xx < 0 || xx >= GW) continue;
      const m = mat[yy * GW + xx];
      if (m === to || (to2 >= 0 && m === to2)) return true;
    }
  }
  return false;
}

/** How fast the rule runs for this particle (0: not at all). A plain compaction rule (by pressure only: no heat,
 *  no chance) also runs along the bed: next to a particle that already became its rock it runs bedSpread times
 *  faster, and there it needs only bedRelax of its pressure — so a bed turns to rock along its length from where
 *  it began, and the front follows the beds instead of the ragged line of equal load. */
function ruleRate(rule: TransformRule, c: Cond, mat: Uint8Array, x: number, y: number): number {
  if (condOk(rule, c)) {
    if (rule.pMin === undefined || rule.tMin !== undefined || rule.chance !== undefined) return 1;
    return nearTarget(mat, x, y, rule) ? S.bedSpread : 1;
  }
  if (rule.pMin === undefined || rule.tMin !== undefined || rule.chance !== undefined) return 0;
  if (c.Peff < rule.pMin * S.bedRelax) return 0;
  if (!condOk(rule, { ...c, Peff: rule.pMin })) return 0;
  return nearTarget(mat, x, y, rule) ? S.bedSpread * S.bedRelaxRate : 0;
}

/** One geology tick over the whole grid. */
export function geoTick(g: Grid, env: GeoEnv, rep: GeoReport = newReport()): GeoReport {
  const mat = g.mat, prog = g.prog, birth = g.birth, flags = g.flags;
  const dy = env.dy;
  const rotP = 1 - Math.pow(1 - CFG.transforms.oxygenRotPer100y, dy / 100);
  const grad = S.gradientPerRow * env.gradMul;
  const f = env.finger;
  const fr2 = f ? f.r * f.r : 0;
  const fP = f ? 1 + 2 * f.power : 1, fS = f ? 1 + 3 * f.power : 1;
  rep.hot.fill(0); rep.fertile = 0; rep.maxP = 0; rep.pressed = 0;

  // 1. the load on every particle: the weight of its column above it
  LOAD.fill(-1);
  for (let x = 0; x < GW; x++) {
    let P = env.P0, depth = -1;
    for (let y = g.surf[x]; y < g.floor; y++) {
      const i = y * GW + x, m = mat[i];
      const kind = KIND[m];
      if (kind === K_NONE) continue;          // a gap under an overhang: no weight, no depth
      if (kind === K_SOLID) break;             // the thing: below it only the floor
      depth++;
      const w = DENS[m] * S.pressurePerParticle;
      LOAD[i] = P + w * 0.5;
      P += w;
      DEPTH[i] = depth;
    }
  }
  // 2. the load spreads sideways (rock carries weight to its neighbours): a tall pile presses on the strata beside it
  //    too, and one column is never much harder pressed than the next — no ragged steps in the front
  const R = S.pressureSpread;
  for (let y = 0; y < g.floor; y++) {
    const row = y * GW;
    for (let x = 0; x < GW; x++) {
      const i = row + x;
      if (LOAD[i] < 0) { SPREAD[i] = -1; continue; }
      let s = 0, wsum = 0;
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= GW) continue;
        const l = LOAD[row + xx];
        if (l < 0) continue;
        const w = R + 1 - Math.abs(dx);
        s += l * w; wsum += w;
      }
      SPREAD[i] = s / wsum;
    }
  }

  // 3. each particle under its load, heat, water and air
  for (let x = 0; x < GW; x++) {
    const marine = env.marine(x);
    let hot = 0, hotY = 0;

    for (let y = g.surf[x]; y < g.floor; y++) {
      const i = y * GW + x, m = mat[i];
      const kind = KIND[m];
      if (kind === K_NONE) continue;
      if (kind === K_SOLID) break;
      const depth = DEPTH[i];
      const Pc = SPREAD[i];
      let Peff = Pc * env.pressMul;
      let sp = env.speed;
      if (f) {
        const ddx = x - f.x, ddy = y - f.y;
        if (ddx * ddx + ddy * ddy <= fr2) { Peff *= fP; sp *= fS; rep.pressed++; }
      }
      if (Peff > rep.maxP) rep.maxP = Peff;
      const oxygen = depth < S.oxygenRows;
      const b = birth[i];
      // organic matter rots near the air: one particle turns into soil, nothing around it changes
      // — unless a pile sealed it at once (a buried forest: P_FAST)
      if (oxygen && ORGANIC[m] && dy > 0 && !(flags[i] & P_FAST) && env.rng.next() < rotP) { mat[i] = SOIL; prog[i] = 0; g.version++; continue; }
      if (oxygen && FERTILE[m] && !marine) rep.fertile++;
      const gw = env.waterAt(x, b);
      // fossilisation: once per bone, when the pressure is enough
      if (m === BONE && !(flags[i] & P_ROLLED) && Pc >= S.fossilP) {
        flags[i] |= P_ROLLED;
        env.onFossilRoll(i, x, y, gw ? CFG.B.taphonomy.groundwaterMineral : 1);
      }
      const rules = RULES_BY_MAT[m];
      // nothing turns to rock under too thin a load (a fresh pile on the floor stays loose)
      if (!rules.length || dy <= 0 || (env.compactDepth >= 0 && depth < env.compactDepth)) continue;
      const T = env.T0 + grad * depth + env.heatAt(x, b);
      const c: Cond = { Peff, T, water: gw || marine, depth, oxygen };
      for (const rule of rules) {
        if (!env.ruleAllowed(rule)) continue;
        const rate = ruleRate(rule, c, mat, x, y);
        if (rate <= 0) continue;
        prog[i] += dy * sp * rate;
        if (rule.tMin !== undefined && hot < 1) { hot = 1; hotY = y; }
        if (prog[i] >= rule.years) {
          prog[i] = 0;
          if (rule.chance !== undefined && env.rng.next() >= rule.chance) break;
          const insect = rule.insectToIdx >= 0 && (flags[i] & P_INSECT) !== 0;
          const to = insect ? rule.insectToIdx : rule.toIdx;
          mat[i] = to;
          g.version++;
          env.onTransform(i, x, y, m, to, rule, insect);
        }
        break;
      }
    }
    rep.hot[x] = hot; rep.hotY[x] = hotY;
  }
  return rep;
}

/** Conveyor state (kept in the save). */
export interface SinkState { acc: number; rows: number }

/** Mean height of the columns above the sink row, in particle rows (the artifact columns excluded). */
export function columnLoad(g: Grid): number {
  let s = 0, n = 0;
  for (let x = 0; x < GW; x++) {
    if (g.isArtifactCol(x)) continue;
    s += Math.max(0, g.sinkRow + 1 - g.surf[x]); n++;
  }
  return n ? s / n : 0;
}

/** Overload of the strata against the line: 1 = at the line. */
export function overload(g: Grid): number {
  return columnLoad(g) / (S.sinkLine * S.refRows);
}

/** Share of the sink row that is rock (or a marker turned to rock). */
function rockShare(g: Grid): number {
  let r = 0;
  const row = g.sinkRow * GW;
  for (let x = 0; x < GW; x++) { const k = KIND[g.mat[row + x]]; if (k === K_ROCK || k === K_MARKER) r++; }
  return r / GW;
}

/** Move the conveyor by dt seconds. `onRow` gets the sink row before it leaves the grid (the archive takes it).
 *  The rate grows with the overload (^4) and with the share of rock in the sink row: a bottom already turned to rock
 *  sinks at full rate, a dusty one (dust and soil have no rule to become rock) at a quarter — never stuck.
 *  Returns the number of rows sunk. */
export function sinkStep(g: Grid, st: SinkState, dt: number, onRow: (g: Grid, y: number) => void): number {
  let r = overload(g);
  if (r < 1) { st.acc = 0; return 0; }
  const rate = (rr: number) => S.sinkRate * rr * rr * rr * rr * (0.25 + 0.75 * Math.min(1, rockShare(g) / S.sinkRockShare));
  st.acc += dt * rate(r);
  let n = 0;
  while (st.acc >= 1 && r >= 1 && n < 400) {
    st.acc -= 1;
    onRow(g, g.sinkRow);
    sinkRowOnce(g);
    n++; st.rows++;
    r = overload(g);
  }
  if (st.acc > 1) st.acc = 1;
  return n;
}

/** The sink row leaves; every row above it moves down by one, all at once. */
export function sinkRowOnce(g: Grid): void {
  const end = g.sinkRow * GW;
  for (const a of [g.mat, g.look, g.flags, g.spec, g.decay] as Uint8Array[]) { a.copyWithin(GW, 0, end); a.fill(0, 0, GW); }
  for (const a of [g.birth, g.prog] as Float32Array[]) { a.copyWithin(GW, 0, end); a.fill(0, 0, GW); }
  for (let x = 0; x < GW; x++) if (g.tops[x] < g.floor) g.tops[x] = Math.min(g.floor, g.tops[x] + 1);
  g.computeTops();
  g.wakeAll();
  g.version++;
}
