import { BALANCE } from '../data/balance';
import type { GameData, GradeId, PartDef } from '../data/types';
import type { Rng } from '../core/rng';
import type { Bus } from '../core/bus';
import type { SimEvents, BenchId, ArcOutReason } from './events';
import type { Stats } from './stats';
import type { Order } from './orders';
import { SeamRun, Proj, SeamPoint, F_PORE, F_COLD, F_HOT, F_LONG, F_SHORT, F_OFF, F_BACK } from './seam';
import { partQuality, gradeOf, countHoles, countPores } from './quality';

const W = BALANCE.weld;
const A = BALANCE.arc;

export type BenchStage = 'empty' | 'weld' | 'chip' | 'inspect' | 'ready';

/** What drives a bench this step: the player's mouse, or the apprentice's replayed habit. */
export interface TorchIn {
  /** Cursor is over the part (x, z valid). */
  has: boolean;
  x: number;
  z: number;
  press: boolean;
  /** Arc length change requested this step (mm). */
  dL: number;
  /** If finite, the arc length is set directly (apprentice replay). */
  forceL: number;
}

export function emptyTorch(): TorchIn {
  return { has: false, x: 0, z: 0, press: false, dL: 0, forceL: NaN };
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
  z = 0;
  scratch = 0;
  lastX = 0;
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
const pt: SeamPoint = { x: 0, z: 0, tx: 1, tz: 0 };

/** Nearest joint to (x, z) across all seams; the current seam gets a small preference so crossings don't flip. */
export function nearestSeam(b: Bench, x: number, z: number, prefer: number, out: Proj): void {
  let best = Infinity;
  out.dist = Infinity;
  out.seam = -1;
  for (let i = 0; i < b.seams.length; i++) {
    b.seams[i].project(x, z, tmpP);
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

  if (b.swap > 0) {
    extinguish(b, 'release', ctx);
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
    if (!inp.press) {
      a.stuck = false;
      ctx.bus.emit('arcUnstick', { bench: b.id });
    }
    return;
  }

  if (!inp.press || !inp.has) {
    if (a.lit) extinguish(b, inp.press ? 'off' : 'release', ctx);
    a.scratch = 0;
    a.hadPos = false;
    if (!a.lit) checkDone(b, ctx);
    return;
  }

  const moved = a.hadPos ? Math.hypot(inp.x - a.lastX, inp.z - a.lastZ) : 0;
  a.lastX = inp.x;
  a.lastZ = inp.z;
  a.hadPos = true;
  a.x = inp.x;
  a.z = inp.z;

  if (!a.lit) {
    if (b.electrode <= 0) {
      if (!a.emptyNotified) {
        a.emptyNotified = true;
        ctx.bus.emit('electrodeEmpty', { bench: b.id });
      }
      return;
    }
    nearestSeam(b, inp.x, inp.z, a.seam, proj);
    if (proj.seam < 0 || proj.dist > W.strikeRadius) {
      a.scratch = 0;
      return;
    }
    const sr = b.seams[proj.seam];
    const hot = sr.heat[sr.cellAt(proj.s)];
    a.scratch += moved;
    if (hot >= W.hotRestart || a.scratch >= W.scratchMM * ctx.stats.strikeMul) {
      a.lit = true;
      a.L = Number.isFinite(inp.forceL) ? inp.forceL : A.startL;
      a.seam = proj.seam;
      a.s = proj.s;
      a.d = proj.d;
      a.v = 0;
      a.rip = 0;
      a.litTime = 0;
      ctx.bus.emit('arcStrike', { bench: b.id, x: inp.x, z: inp.z });
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

  nearestSeam(b, inp.x, inp.z, a.seam, proj);
  const onSeam = proj.seam >= 0 && proj.dist <= W.captureMM;
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
    if (b.seams.length && ctx.spatter.chance(a.spatterRate * BALANCE.spatter.stickChance * dt)) {
      b.seams[0].addSpatter(inp.x + ctx.spatter.signed() * 12, inp.z + ctx.spatter.signed() * 12);
      b.rev++;
    }
    return;
  }

  const sr = b.seams[proj.seam];
  let ds = 0;
  if (proj.seam === a.seam) ds = proj.s - a.s;
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
  const s0 = ds !== 0 ? a.s : proj.s;
  const s1 = proj.s;
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
    const ca = Math.max(0, sr.cellAt(Math.min(s0, s1)) - 3), cb = Math.min(sr.n - 1, sr.cellAt(Math.max(s0, s1)) + 3);
    for (let c = ca; c <= cb; c++) if (sr.metal[c] > 0.05 && sr.heat[c] > sr.peak[c]) sr.peak[c] = sr.heat[c];
  }
  a.s = proj.s;
  a.d = proj.d;
  const cHere = sr.cellAt(a.s);
  a.pool = sr.heat[cHere];

  // Burn-through.
  const c0 = Math.max(0, cHere - 4), c1 = Math.min(sr.n - 1, cHere + 4);
  for (let c = c0; c <= c1; c++) {
    if (!sr.hole[c] && sr.heat[c] > part.burn) {
      sr.hole[c] = 1;
      b.rev++;
      sr.pointAt((c + 0.5) * sr.cell, pt);
      ctx.bus.emit('burnThrough', { bench: b.id, seam: proj.seam, s: (c + 0.5) * sr.cell, x: pt.x, z: pt.z });
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
    w = Math.min(13, Math.max(2.5, w));
    h = Math.min(4.2, Math.max(0.5, h));
    sr.addRipple(a.s, a.d, w, h, a.v, L, q, I, f);
    b.rev++;
  }

  if (ctx.spatter.chance(a.spatterRate * BALANCE.spatter.stickChance * dt)) {
    const r = 5 + ctx.spatter.next() * (12 + longX * 8);
    const ang = ctx.spatter.next() * Math.PI * 2;
    sr.pointAt(a.s, pt);
    sr.addSpatter(pt.x + Math.cos(ang) * r, pt.z + Math.sin(ang) * r);
    b.rev++;
  }

  if (!sr.filled && sr.gaps(W.fillMin) === 0) {
    sr.filled = true;
    ctx.bus.emit('seamFilled', { bench: b.id, seam: proj.seam });
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
  nearestSeam(b, inp.x, inp.z, -1, proj);
  if (proj.seam < 0 || proj.dist > BALANCE.chip.radius) {
    ctx.bus.emit('hammerMiss', { bench: b.id, x: inp.x, z: inp.z, onMetal: true });
    return;
  }
  const sr = b.seams[proj.seam];
  // Good slag peels off in long pieces; a bad bead holds it in lumps.
  const ease = 0.7 + 0.8 * b.quality;
  const a = ctx.weld.range(BALANCE.chip.chunkMin, BALANCE.chip.chunkMax) * ease;
  const c = ctx.weld.range(BALANCE.chip.chunkMin, BALANCE.chip.chunkMax) * ease;
  const s0 = Math.max(0, proj.s - a), s1 = Math.min(sr.len, proj.s + c);
  let amount = 0;
  for (let i = sr.cellAt(s0); i <= sr.cellAt(s1); i++) {
    amount += sr.slag[i];
    sr.slag[i] = 0;
  }
  if (amount <= 0) {
    ctx.bus.emit('hammerMiss', { bench: b.id, x: inp.x, z: inp.z, onMetal: true });
    return;
  }
  b.rev++;
  ctx.bus.emit('slagChip', { bench: b.id, seam: proj.seam, s0, s1, x: inp.x, z: inp.z, amount });
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
