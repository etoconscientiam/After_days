import { BALANCE } from '../data/balance';
import type { GameData, GradeId, PartDef } from '../data/types';
import type { Rng } from '../core/rng';
import type { Bus } from '../core/bus';
import type { SimEvents, BenchId, ArcOutReason } from './events';
import type { Stats } from './stats';
import type { Order } from './orders';
import { Q, qIdent, qEuler, qMul, qAxis, qRot, qNorm, qTurnToward, V3 } from '../core/quat';
import { SeamRun, Proj, seamPoint, F_PORE, F_COLD, F_HOT, F_LONG, F_SHORT, F_OFF, F_BACK } from './seam';
import { partQuality, gradeOf, countHoles, countPores, seamQuality, stretchScore, seamShare, payFor } from './quality';

const W = BALANCE.weld;
const A = BALANCE.arc;

export type BenchStage = 'empty' | 'weld' | 'chip' | 'inspect' | 'ready';

/** Why a held button isn't welding: off the joint, the joint faces away, no rod, changing rods, stuck, or striking. */
export type StrikeWhy = '' | 'far' | 'away' | 'empty' | 'swap' | 'stuck' | 'strike';

/** What drives a bench this step: the player's mouse, or the apprentice's replayed habit. */
export interface TorchIn {
  /** Cursor is on the part (x, y, z valid, part-local mm). */
  has: boolean;
  x: number;
  y: number;
  z: number;
  /** Turn the part this step: radians about the bench's left-right axis and about the vertical. */
  turnX: number;
  turnY: number;
  press: boolean;
  /** Arc length change requested this step (mm). */
  dL: number;
  /** If finite, the arc length is set directly (apprentice replay). */
  forceL: number;
}

export function emptyTorch(): TorchIn {
  return { has: false, x: 0, y: 0, z: 0, turnX: 0, turnY: 0, press: false, dL: 0, forceL: NaN };
}

export class Arc {
  lit = false;
  stuck = false;
  L: number = A.startL;
  seam = -1;
  s = 0;
  d = 0;
  v = 0;
  dir = 1;
  x = 0;
  y = 0;
  z = 0;
  scratch = 0;
  lastX = 0;
  lastY = 0;
  lastZ = 0;
  hadPos = false;
  rip = 0;
  onSeam = false;
  spatterRate = 0;
  /** 0..1, how much the current makes the arc sputter. */
  unstable = 0;
  /** Heat at the pool. */
  pool = 0;
  litTime = 0;
  emptyNotified = false;
  /** Seconds the rod has been held on the joint without catching (striking by touch). */
  touch = 0;
  /** While the button is held and the arc isn't burning: why not. '' when nothing to say. */
  why: StrikeWhy = '';
  /** 0..1 how close the strike is (scratch or touch), for sputtering sparks. */
  strikeK = 0;
}

export interface WeldCtx {
  dt: number;
  I: number;
  stats: Stats;
  data: GameData;
  weld: Rng;
  spatter: Rng;
  power: Rng;
  bus: Bus<SimEvents>;
}

export class Bench {
  readonly id: BenchId;
  stage: BenchStage = 'empty';
  order: Order | null = null;
  part: PartDef | null = null;
  seams: SeamRun[] = [];
  arc = new Arc();
  electrode = 1;
  swap = 0;
  timer = 0;
  quality = 0;
  grade: GradeId = 'bad';
  holes = 0;
  pores = 0;
  slag0 = 1;
  slagLeft = 1;
  hammerCd = 0;
  prevPress = false;
  /** Increments whenever the bead geometry changes (new ripple, hole, chip) so the view can skip work. */
  rev = 0;
  /** How the part is turned on the bench (part-local → bench frame), and where it is being turned to. */
  rot: Q = qIdent();
  rotT: Q | null = null;
  /** The last press was refused because the joint faces away (one event per press). */
  reachWarned = false;

  constructor(id: BenchId) {
    this.id = id;
  }

  load(order: Order, part: PartDef): void {
    this.order = order;
    this.part = part;
    this.seams = part.seams.map((s) => new SeamRun(s, W.cellMM, W.rippleCap, W.spatterDotCap));
    this.stage = 'weld';
    this.quality = 0;
    this.grade = 'bad';
    this.holes = 0;
    this.pores = 0;
    this.slag0 = 1;
    this.slagLeft = 1;
    this.arc = new Arc();
    this.timer = 0;
    const r = part.rest ?? [0, 0, 0];
    const k = Math.PI / 180;
    this.rot = qEuler(r[0] * k, r[1] * k, r[2] * k);
    this.rotT = null;
    this.rev++;
  }

  clear(): void {
    this.order = null;
    this.part = null;
    this.seams = [];
    this.stage = 'empty';
    this.arc.lit = false;
    this.arc.stuck = false;
    this.rev++;
  }

  /** Total heat-glow anywhere on the part (for lights and sound). */
  hot(): number {
    let m = 0;
    for (const s of this.seams) if (s.maxHeat > m) m = s.maxHeat;
    return m;
  }

  gaps(): number {
    let g = 0;
    for (const s of this.seams) g += s.gaps(W.fillMin);
    return g;
  }
}

const proj: Proj = { s: 0, d: 0, dist: 0, seam: -1 };
const tmpP: Proj = { s: 0, d: 0, dist: 0, seam: -1 };
const pt = seamPoint();
const v3: V3 = [0, 0, 0];
const REACH: V3 = (() => {
  const r = W.reachDir;
  const l = Math.hypot(r[0], r[1], r[2]);
  return [r[0] / l, r[1] / l, r[2] / l];
})();

/** How squarely the joint at s faces the welder: 1 = straight at him, 0 = edge-on, < 0 = turned away. */
export function facing(b: Bench, seam: number, s: number): number {
  const sr = b.seams[seam];
  if (!sr) return 0;
  sr.pointAt(s, pt);
  qRot(b.rot, pt.nx, pt.ny, pt.nz, v3);
  return v3[0] * REACH[0] + v3[1] * REACH[1] + v3[2] * REACH[2];
}

export function canReach(b: Bench, seam: number, s: number): boolean {
  return facing(b, seam, s) >= W.reachMin;
}

/**
 * Start turning the part so that the joint at s faces the welder, the way hands do it: spin it round on the
 * bench, then tip it toward you if that's not enough. A seam marked `turn: 'roll'` (a ring round a spear,
 * the underside of a handle) is rolled about the left-right axis instead.
 */
export function faceSeam(b: Bench, seam: number, s: number, span = 0): void {
  const sr = b.seams[seam];
  if (!sr) return;
  // Over a stretch (a patch loop, a ring), face the average way it looks, not one corner of it.
  let nx = 0, ny = 0, nz = 0;
  const k = span > 0 ? 8 : 1;
  for (let i = 0; i < k; i++) {
    sr.pointAt(s + (span * i) / Math.max(1, k - 1), pt);
    nx += pt.nx;
    ny += pt.ny;
    nz += pt.nz;
  }
  const n = qRot(b.rot, nx, ny, nz, [0, 0, 0]);
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  n[0] /= nl;
  n[1] /= nl;
  n[2] /= nl;
  const aimX = Math.atan2(REACH[1], REACH[2]);
  let q: Q = qIdent();
  if (sr.def.turn === 'roll' && Math.hypot(n[1], n[2]) > 0.45) {
    q = qAxis(1, 0, 0, -(aimX - Math.atan2(n[1], n[2])));
  } else {
    const h = Math.hypot(n[0], n[2]);
    if (h > 0.2) {
      q = qAxis(0, 1, 0, -Math.atan2(n[0], n[2]));
      n[0] = 0;
      n[2] = h;
    }
    if (n[1] * REACH[1] + n[2] * REACH[2] < 0.55) q = qMul(qAxis(1, 0, 0, -(aimX - Math.atan2(n[1], n[2]))), q);
  }
  b.rotT = qNorm(qMul(q, b.rot));
}

/** Same, at once (scripts and tests). */
export function snapFace(b: Bench, seam: number, s: number): void {
  faceSeam(b, seam, s);
  if (b.rotT) b.rot = b.rotT;
  b.rotT = null;
}

/** Turn the part by hand (radians about the bench's x axis, then the vertical). */
export function turnPart(b: Bench, ax: number, ay: number): void {
  if (!ax && !ay) return;
  b.rotT = null;
  let q = b.rot;
  if (ax) q = qMul(qAxis(1, 0, 0, ax), q);
  if (ay) q = qMul(qAxis(0, 1, 0, ay), q);
  b.rot = qNorm(q);
}

/**
 * Nearest joint to (x, y, z) across all seams; the current seam gets a small preference so crossings don't flip.
 * `workable`: only joints with something left to lay that face the welder there (where a strike can land) —
 * two seams side by side (over and under a handle) then don't steal each other's strikes.
 */
export function nearestSeam(b: Bench, x: number, y: number, z: number, prefer: number, out: Proj, workable = false): void {
  let best = Infinity;
  out.dist = Infinity;
  out.seam = -1;
  for (let i = 0; i < b.seams.length; i++) {
    if (workable && b.seams[i].filled) continue;
    b.seams[i].project(x, y, z, tmpP);
    if (workable && !canReach(b, i, tmpP.s)) continue;
    const score = tmpP.dist - (i === prefer ? 3 : 0);
    if (score < best) {
      best = score;
      out.s = tmpP.s;
      out.d = tmpP.d;
      out.dist = tmpP.dist;
      out.seam = i;
    }
  }
}

function extinguish(b: Bench, reason: ArcOutReason, ctx: WeldCtx): void {
  const a = b.arc;
  if (!a.lit) return;
  a.lit = false;
  a.scratch = 0;
  a.spatterRate = 0;
  a.unstable = 0;
  ctx.bus.emit('arcOut', { bench: b.id, reason });
}

export function stepBench(b: Bench, inp: TorchIn, ctx: WeldCtx): void {
  const dt = ctx.dt;
  for (let i = 0; i < b.seams.length; i++) b.seams[i].stepHeat(dt, W.cool, W.diffuse);
  if (b.hammerCd > 0) b.hammerCd -= dt;
  if (b.stage !== 'empty') {
    if (inp.turnX || inp.turnY) turnPart(b, inp.turnX, inp.turnY);
    else if (b.rotT && qTurnToward(b.rot, b.rotT, W.turnRate * dt)) b.rotT = null;
  }

  switch (b.stage) {
    case 'weld':
      stepWeld(b, inp, ctx);
      break;
    case 'chip':
      if (inp.press && !b.prevPress) hammer(b, inp, ctx);
      break;
    case 'inspect':
      b.timer -= dt;
      if (b.timer <= 0) b.stage = 'ready';
      break;
  }
  b.prevPress = inp.press;
}

function stepWeld(b: Bench, inp: TorchIn, ctx: WeldCtx): void {
  const a = b.arc;
  const dt = ctx.dt;
  const part = b.part!;

  a.why = '';
  if (b.swap > 0) {
    extinguish(b, 'release', ctx);
    if (inp.press) a.why = 'swap';
    b.swap -= dt;
    if (b.swap <= 0) {
      b.swap = 0;
      b.electrode = 1;
      a.emptyNotified = false;
      ctx.bus.emit('electrodeNew', { bench: b.id });
    }
    return;
  }

  if (a.stuck) {
    a.why = 'stuck';
    if (!inp.press) {
      a.stuck = false;
      ctx.bus.emit('arcUnstick', { bench: b.id });
    }
    return;
  }

  if (!inp.press) b.reachWarned = false;
  if (!inp.press || !inp.has) {
    if (a.lit) extinguish(b, inp.press ? 'off' : 'release', ctx);
    if (inp.press && !a.lit) a.why = 'far';
    a.scratch = 0;
    a.touch = 0;
    a.strikeK = 0;
    a.hadPos = false;
    if (!a.lit) checkDone(b, ctx);
    return;
  }

  const moved = a.hadPos ? Math.hypot(inp.x - a.lastX, inp.y - a.lastY, inp.z - a.lastZ) : 0;
  a.lastX = inp.x;
  a.lastY = inp.y;
  a.lastZ = inp.z;
  a.hadPos = true;
  a.x = inp.x;
  a.y = inp.y;
  a.z = inp.z;

  if (!a.lit) {
    if (b.electrode <= 0) {
      a.why = 'empty';
      if (!a.emptyNotified) {
        a.emptyNotified = true;
        ctx.bus.emit('electrodeEmpty', { bench: b.id });
      }
      return;
    }
    // Strike on a joint that can take it; failing that, look at all of them to say why not.
    nearestSeam(b, inp.x, inp.y, inp.z, a.seam, proj, true);
    if (proj.seam < 0 || proj.dist > W.strikeRadius) nearestSeam(b, inp.x, inp.y, inp.z, a.seam, proj);
    if (proj.seam < 0 || proj.dist > W.strikeRadius) {
      a.scratch = 0;
      a.touch = 0;
      a.strikeK = 0;
      a.why = 'far';
      return;
    }
    // A joint that faces away can't be reached with the rod: the part has to be turned first.
    if (!canReach(b, proj.seam, proj.s)) {
      a.scratch = 0;
      a.touch = 0;
      a.strikeK = 0;
      a.why = 'away';
      if (!b.reachWarned) {
        b.reachWarned = true;
        ctx.bus.emit('cantReach', { bench: b.id, seam: proj.seam });
      }
      return;
    }
    const sr = b.seams[proj.seam];
    const hot = sr.heat[sr.cellAt(proj.s)];
    // Strike: scratch the rod along, or just hold it on the joint for a moment.
    a.scratch += moved;
    a.touch += dt;
    a.why = 'strike';
    a.strikeK = Math.min(1, Math.max(a.scratch / (W.scratchMM * ctx.stats.strikeMul), a.touch / (W.touchTime * ctx.stats.strikeMul)));
    if (hot >= W.hotRestart || a.strikeK >= 1) {
      a.why = '';
      a.strikeK = 0;
      a.touch = 0;
      a.lit = true;
      a.L = Number.isFinite(inp.forceL) ? inp.forceL : A.startL;
      a.seam = proj.seam;
      a.s = proj.s;
      a.d = proj.d;
      a.v = 0;
      a.rip = 0;
      a.litTime = 0;
      ctx.bus.emit('arcStrike', { bench: b.id, x: inp.x, y: inp.y, z: inp.z });
    }
    return;
  }

  // --- The arc is lit. ---
  a.litTime += dt;
  const I = ctx.I;
  if (Number.isFinite(inp.forceL)) a.L = inp.forceL;
  else a.L += inp.dL + A.drift * I * dt;
  if (a.L < 0) a.L = 0;
  if (a.L > 12) a.L = 12;

  // Weak current makes the arc sputter out. A hot pool relights by itself while the electrode is held there.
  const instab = Math.max(0, ctx.stats.stableI - I);
  a.unstable = Math.min(1, instab * 4);
  if (instab > 0 && ctx.power.chance(instab * A.sputterK * dt)) {
    extinguish(b, 'power', ctx);
    return;
  }
  if (a.L <= ctx.stats.stickL) {
    a.lit = false;
    a.stuck = true;
    a.spatterRate = 0;
    b.electrode = Math.max(0, b.electrode - 0.015);
    ctx.bus.emit('arcStick', { bench: b.id });
    return;
  }
  const Lbreak = A.breakL * Math.min(1.3, Math.max(0.5, I));
  if (a.L >= Lbreak) {
    extinguish(b, 'long', ctx);
    return;
  }

  b.electrode -= (dt / ctx.stats.electrodeSeconds) * (0.7 + 0.3 * I);
  if (b.electrode <= 0) {
    b.electrode = 0;
    extinguish(b, 'electrode', ctx);
    a.emptyNotified = true;
    ctx.bus.emit('electrodeEmpty', { bench: b.id });
    return;
  }

  nearestSeam(b, inp.x, inp.y, inp.z, a.seam, proj);
  const onSeam = proj.seam >= 0 && proj.dist <= W.captureMM;
  // Turned away mid-run (round a ring, or the part was turned): the rod can't follow.
  if (onSeam && facing(b, proj.seam, proj.s) < W.reachMin - 0.08) {
    extinguish(b, 'reach', ctx);
    return;
  }
  a.onSeam = onSeam;

  const L = a.L;
  const longX = Math.max(0, L - 3.2);
  a.spatterRate =
    (BALANCE.spatter.base + BALANCE.spatter.longK * Math.pow(longX, 1.4) + BALANCE.spatter.unstableK * instab) *
    ctx.stats.spatterMul;

  if (!onSeam) {
    a.v += (0 - a.v) * (1 - Math.exp(-dt / W.speedTau));
    a.pool = 0;
    // Spatter sticks where the arc wanders.
    if (proj.seam >= 0 && proj.dist < 40 && ctx.spatter.chance(a.spatterRate * BALANCE.spatter.stickChance * dt)) {
      b.seams[proj.seam].addSpatter(proj.s + ctx.spatter.signed() * 12, Math.max(-30, Math.min(30, proj.d + ctx.spatter.signed() * 12)));
      b.rev++;
    }
    return;
  }

  const sr = b.seams[proj.seam];
  let ds = 0;
  if (proj.seam === a.seam) ds = sr.delta(a.s, proj.s);
  else a.seam = proj.seam;
  if (Math.abs(ds) > 30) ds = 0; // jumped across a corner or onto another stretch
  const inst = Math.abs(ds) / dt;
  a.v += (inst - a.v) * (1 - Math.exp(-dt / W.speedTau));
  if (Math.abs(ds) > 0.02) a.dir = ds > 0 ? 1 : -1;

  // Heat and filler.
  const Li = A.idealL;
  const hL = L < Li ? 0.72 + 0.28 * Math.min(1, Math.max(0, (L - ctx.stats.stickL) / (Li - ctx.stats.stickL))) : 1 - 0.05 * (L - Li);
  const sigma = W.heatSigma * (1 + 0.16 * Math.max(0, L - Li));
  const heatRate = (W.heatGain * Math.pow(I, 1.2) * hL) / part.thick;
  const depEff = 1 - 0.08 * Math.max(0, L - 3.4);
  const depRate = W.deposit * W.vIdeal * I * depEff;
  const off = Math.exp(-(proj.d * proj.d) / (2 * W.lateralSigma * W.lateralSigma));
  const s1 = proj.s;
  const s0 = ds !== 0 ? s1 - ds : s1;
  const k = Math.max(1, Math.min(10, Math.ceil(Math.abs(s1 - s0) / 1.5)));
  const adev = Math.abs(proj.d);
  for (let j = 0; j < k; j++) {
    const s = s0 + ((s1 - s0) * (j + 0.5)) / k;
    sr.addGauss(sr.heat, s, sigma, (heatRate * off * dt) / k);
    const c = sr.cellAt(s);
    const amt = (depRate * dt) / k;
    sr.addGauss(sr.metal, s, W.metalSigma, amt / sr.cell);
    if (adev > sr.dev[c]) sr.dev[c] = adev;
  }
  if (sr.maxHeat < sr.heat[sr.cellAt(s1)]) sr.maxHeat = sr.heat[sr.cellAt(s1)];
  // Fusion: the hottest the joint got under the filler (off-centre arcs heat the joint less).
  {
    const ca = sr.cellAt(Math.min(s0, s1)) - 3, cb = sr.cellAt(Math.max(s0, s1)) + 3;
    for (let cc = ca; cc <= cb; cc++) {
      const c = sr.closed ? ((cc % sr.n) + sr.n) % sr.n : cc;
      if (c < 0 || c >= sr.n) continue;
      if (sr.metal[c] > 0.05 && sr.heat[c] > sr.peak[c]) sr.peak[c] = sr.heat[c];
    }
  }
  a.s = proj.s;
  a.d = proj.d;
  const cHere = sr.cellAt(a.s);
  a.pool = sr.heat[cHere];

  // Burn-through.
  for (let cc = cHere - 4; cc <= cHere + 4; cc++) {
    const c = sr.closed ? ((cc % sr.n) + sr.n) % sr.n : cc;
    if (c < 0 || c >= sr.n) continue;
    if (!sr.hole[c] && sr.heat[c] > part.burn) {
      sr.hole[c] = 1;
      b.rev++;
      sr.pointAt((c + 0.5) * sr.cell, pt);
      ctx.bus.emit('burnThrough', { bench: b.id, seam: proj.seam, s: (c + 0.5) * sr.cell, x: pt.x, y: pt.y, z: pt.z });
    }
  }

  // Ripples: one per pulse of the arc. Spacing comes from travel speed; width from heat; height from filler per mm.
  a.rip += dt;
  if (a.rip >= W.rippleDt) {
    a.rip -= W.rippleDt;
    const q = a.pool;
    const mInst = depRate / Math.max(a.v, 2.5);
    let w = (4 + 2.7 * Math.sqrt(Math.max(0, q))) * (1 + 0.1 * (L - Li));
    let h = 1.5 * Math.sqrt(mInst / W.deposit);
    let f = 0;
    if (q < W.fuseLow + 0.1) {
      f |= F_COLD;
      w *= 0.78;
      h *= 1.2;
    }
    if (q > part.burn * 0.8) f |= F_HOT;
    if (L > A.goodHi) f |= F_LONG;
    if (L < A.goodLo) f |= F_SHORT;
    if (adev > 4) f |= F_OFF;
    if (a.dir < 0) f |= F_BACK;
    const pPore =
      (BALANCE.pores.base +
        BALANCE.pores.longK * Math.pow(Math.max(0, L - 3.3), 1.5) +
        (f & F_COLD ? BALANCE.pores.coldK : 0)) *
      ctx.stats.poreMul;
    if (ctx.weld.chance(pPore)) {
      f |= F_PORE;
      if (sr.pores[cHere] < 3) sr.pores[cHere]++;
    }
    // A bare rod's puddle runs unevenly: each ripple a little wider or narrower, taller or flatter, and
    // off to one side. Only how it looks: the seam is judged by the heat and metal laid, not by ripples.
    const wild = ctx.stats.rodWild;
    w *= 1 + 0.22 * wild * ctx.spatter.signed();
    h *= 1 + 0.28 * wild * ctx.spatter.signed();
    const dRip = a.d + 1.1 * wild * ctx.spatter.signed();
    w = Math.min(13, Math.max(2.5, w));
    h = Math.min(4.2, Math.max(0.5, h));
    sr.addRipple(a.s, dRip, w, h, a.v, L, q, I, f);
    b.rev++;
  }

  if (ctx.spatter.chance(a.spatterRate * BALANCE.spatter.stickChance * dt)) {
    const r = 5 + ctx.spatter.next() * (12 + longX * 8);
    const ang = ctx.spatter.next() * Math.PI * 2;
    sr.addSpatter(a.s + Math.cos(ang) * r, Math.sin(ang) * r);
    b.rev++;
  }

  if (!sr.filled && sr.gaps(W.fillMin) === 0) {
    sr.filled = true;
    sr.quality = seamQuality(sr, part.thick);
    ctx.bus.emit('seamFilled', { bench: b.id, seam: proj.seam, quality: sr.quality });
  }
}

function checkDone(b: Bench, ctx: WeldCtx): void {
  if (b.stage !== 'weld') return;
  for (const sr of b.seams) if (sr.gaps(W.fillMin) > 0) return;
  b.quality = partQuality(b.seams, b.part!.thick);
  b.grade = gradeOf(b.quality);
  b.holes = countHoles(b.seams);
  b.pores = countPores(b.seams);
  let tot = 0;
  for (const sr of b.seams) {
    for (let c = 0; c < sr.n; c++) sr.slag[c] = sr.metal[c] > 0.08 ? 1 : 0;
    tot += sr.slagTotal();
  }
  b.slag0 = Math.max(1, tot);
  b.slagLeft = 1;
  b.stage = 'chip';
  b.rev++;
  ctx.bus.emit('weldDone', { bench: b.id });
}

function hammer(b: Bench, inp: TorchIn, ctx: WeldCtx): void {
  if (b.hammerCd > 0 || !inp.has) return;
  b.hammerCd = BALANCE.chip.cooldown;
  nearestSeam(b, inp.x, inp.y, inp.z, -1, proj);
  if (proj.seam < 0 || proj.dist > BALANCE.chip.radius) {
    ctx.bus.emit('hammerMiss', { bench: b.id, x: inp.x, y: inp.y, z: inp.z, onMetal: true });
    return;
  }
  const sr = b.seams[proj.seam];
  // Good slag peels off in long pieces; a bad bead holds it in lumps.
  const ease = 0.7 + 0.8 * b.quality;
  const a = ctx.weld.range(BALANCE.chip.chunkMin, BALANCE.chip.chunkMax) * ease;
  const c = ctx.weld.range(BALANCE.chip.chunkMin, BALANCE.chip.chunkMax) * ease;
  const s0 = sr.closed ? proj.s - a : Math.max(0, proj.s - a);
  const s1 = sr.closed ? proj.s + c : Math.min(sr.len, proj.s + c);
  let amount = 0;
  const i0 = Math.floor(s0 / sr.cell), i1 = Math.floor(s1 / sr.cell);
  for (let ii = i0; ii <= i1; ii++) {
    const i = sr.closed ? ((ii % sr.n) + sr.n) % sr.n : Math.min(sr.n - 1, Math.max(0, ii));
    amount += sr.slag[i];
    sr.slag[i] = 0;
  }
  if (amount <= 0) {
    ctx.bus.emit('hammerMiss', { bench: b.id, x: inp.x, y: inp.y, z: inp.z, onMetal: true });
    return;
  }
  b.rev++;
  // What this piece of slag uncovered: how good that stretch is, and what it's worth.
  const q = stretchScore(sr, i0, i1, b.part!.thick);
  const reward = b.order?.reward ?? 0;
  const value = payFor(reward * seamShare(b.seams, proj.seam) * Math.min(1, (i1 - i0 + 1) / sr.n), q);
  ctx.bus.emit('slagChip', { bench: b.id, seam: proj.seam, s0, s1, x: inp.x, y: inp.y, z: inp.z, amount, q, value });
  let left = 0;
  for (const s of b.seams) left += s.slagTotal();
  b.slagLeft = left / b.slag0;
  if (b.slagLeft < 0.07) reveal(b, ctx);
}

/** Knock every remaining crumb off and show the bead (also used by the apprentice). */
export function reveal(b: Bench, ctx: WeldCtx): void {
  for (const s of b.seams) s.slag.fill(0);
  b.slagLeft = 0;
  b.stage = 'inspect';
  b.timer = BALANCE.chip.inspectTime;
  b.rev++;
  ctx.bus.emit('revealed', { bench: b.id, quality: b.quality, grade: b.grade, holes: b.holes, pores: b.pores });
}

/** Swap in a fresh electrode (the old stub goes in the bucket). */
export function newElectrode(b: Bench, ctx: WeldCtx, time: number): boolean {
  if (b.swap > 0 || b.electrode > 0.97) return false;
  extinguish(b, 'release', ctx);
  b.swap = time;
  ctx.bus.emit('electrodeSwap', { bench: b.id });
  return true;
}
