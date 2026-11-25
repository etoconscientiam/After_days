import { Bus } from '../core/bus';
import { RngStreams } from '../core/rng';
import { BALANCE } from '../data/balance';
import type { GameData, GradeId } from '../data/types';
import type { SimEvents } from './events';
import { Stats, computeStats, checkCond, unmet, Reason, CondCtx } from './stats';
import { Bench, TorchIn, WeldCtx, emptyTorch, stepBench, newElectrode, reveal, faceSeam } from './weld';
import { Power } from './power';
import { Order, makeOrder, rollBoardOrder } from './orders';
import { Recorder, Replayer, Habit } from './apprentice';
import { payForSeams, gradeRank, idealSpeed } from './quality';
import type { SeamRun } from './seam';
import { computeGuide, Guide } from './guide';

export type Command =
  | { type: 'start' }
  | { type: 'takePile' }
  | { type: 'takeOrder'; uid: number }
  | { type: 'newElectrode' }
  | { type: 'handOver' }
  | { type: 'mask'; down?: boolean }
  | { type: 'buy'; id: string }
  | { type: 'dismissEnd' }
  /** Turn the part on the bench so the next unwelded joint faces you. */
  | { type: 'faceNext' }
  /** Turn a given joint to face you (scripts; the apprentice turns his own work). */
  | { type: 'face'; seam: number; s: number };

export interface FrameInput {
  torch: TorchIn;
}

export type ApprenticeState = 'away' | 'watching' | 'idle' | 'setup' | 'weld' | 'swap' | 'chip' | 'hand';

export interface ShiftLog {
  milestones: Record<string, number>;
  qualities: number[];
  best: number;
  holes: number;
  electrodes: number;
  blinded: number;
  earned: number;
  apprenticeJobs: number;
  apprenticeEarned: number;
}

/** The whole simulation. No DOM, no three.js, no audio: runs the same in Node. */
export class Game {
  readonly data: GameData;
  readonly bus = new Bus<SimEvents>();
  readonly seed: number;
  rng: RngStreams;

  started = false;
  t = 0;
  money = 0;
  owned: Record<string, boolean> = {};
  flags: Record<string, boolean> = {};
  ordersDone = 0;
  stats: Stats;

  pile: Order | null = null;
  introIndex = 0;
  board: Order[] = [];
  nextArrival = 0;
  uid = 1;

  mask = { down: false, pos: 0 };
  glare = 0;
  after = 0;

  clock = { dark: 0, snow: 0, cold: 0, night: false };
  nightBoost = 0;
  power = new Power();

  player = new Bench('player');
  app = new Bench('apprentice');
  appState: ApprenticeState = 'away';
  appTimer = 0;
  habit: Habit | null = null;
  recorder = new Recorder();
  replayer = new Replayer();
  private appTorch: TorchIn = emptyTorch();

  guide: Guide = { target: '', hint: '', x: 0, y: 0, z: 0, seam: -1 };
  private guideTmp: Guide = { target: '', hint: '', x: 0, y: 0, z: 0, seam: -1 };
  /** Timers used by the guide (how long a condition has held). */
  cond = { maskUpLit: 0, long: 0, short: 0, fast: 0, slow: 0, maskDownDark: 0, idle: 0, reachMiss: 0 };

  finaleSeams: SeamRun[] | null = null;
  finalePart = '';
  finaleQuality = 0;
  finaleGrade: GradeId = 'bad';
  showEnd = false;
  howlT = 0;

  log: ShiftLog = {
    milestones: {},
    qualities: [],
    best: 0,
    holes: 0,
    electrodes: 0,
    blinded: 0,
    earned: 0,
    apprenticeJobs: 0,
    apprenticeEarned: 0,
  };

  private cmds: Command[] = [];
  private lastCursor = { x: 0, y: 0, z: 0, has: false };
  private saveT = 0;
  private ctx: WeldCtx;

  constructor(data: GameData, seed = 1) {
    this.data = data;
    this.bus.on('cantReach', (e) => {
      if (e.bench === 'player') this.cond.reachMiss = 4;
    });
    this.seed = seed >>> 0;
    this.rng = new RngStreams(this.seed);
    this.stats = computeStats(data, this.owned);
    this.ctx = {
      dt: BALANCE.dt,
      I: 1,
      stats: this.stats,
      data,
      weld: this.rng.get('weld'),
      spatter: this.rng.get('spatter'),
      power: this.rng.get('power'),
      bus: this.bus,
    };
    this.bus.on('weldDone', (e) => this.onWeldDone(e.bench));
  }

  /** Re-create RNG-backed context after loading a save. */
  rebindRng(): void {
    this.ctx.weld = this.rng.get('weld');
    this.ctx.spatter = this.rng.get('spatter');
    this.ctx.power = this.rng.get('power');
  }

  queue(c: Command): void {
    this.cmds.push(c);
  }

  condCtx(): CondCtx {
    return { ordersDone: this.ordersDone, owned: this.owned, flags: this.flags, t: this.t };
  }

  milestone(id: string): void {
    if (this.log.milestones[id] !== undefined) return;
    this.log.milestones[id] = this.t;
    this.bus.emit('milestone', { id, t: this.t });
  }

  // ---------------------------------------------------------------- shop

  /** Why an upgrade cannot be bought right now (empty = can buy). */
  whyNot(id: string): Reason[] {
    const u = this.data.upgrades.find((x) => x.id === id);
    if (!u) return [];
    if (this.owned[id]) return [{ kind: 'owned' }];
    const r = unmet(u.requires, this.condCtx());
    if (this.money < u.cost) r.push({ kind: 'coins', need: u.cost - this.money });
    return r;
  }

  canTake(o: Order): { ok: boolean; why: string } {
    if (this.player.stage !== 'empty') return { ok: false, why: 'busy' };
    if (o.req.needs && !this.owned[o.req.needs]) return { ok: false, why: 'needs' };
    if (this.flags.finale && !this.flags.finaleDone && !o.urgent) return { ok: false, why: 'urgent' };
    return { ok: true, why: '' };
  }

  // ---------------------------------------------------------------- step

  step(input: FrameInput): void {
    const dt = BALANCE.dt;
    for (const c of this.cmds) this.apply(c);
    this.cmds.length = 0;
    if (!this.started) return;

    this.t += dt;
    this.updateClock(dt);

    const load = (this.player.arc.lit ? 1 : 0) + (this.app.arc.lit ? 0.6 : 0);
    this.power.step(dt, this.clock.cold, this.stats, load, this.rng.get('power'), this.bus);
    this.ctx.I = this.power.I;
    this.ctx.stats = this.stats;

    // Mask and glare.
    const M = BALANCE.mask;
    const tgt = this.mask.down ? 1 : 0;
    const dm = dt / M.animTime;
    this.mask.pos = this.mask.pos < tgt ? Math.min(tgt, this.mask.pos + dm) : Math.max(tgt, this.mask.pos - dm);
    const lit = this.player.arc.lit ? 1 : 0;
    const exposed = lit * (1 - this.mask.pos);
    const gT = exposed > this.glare ? M.glareRise : M.glareFall;
    this.glare += (exposed - this.glare) * (1 - Math.exp(-dt / gT));
    if (exposed > 0.3) this.after = Math.min(1, this.after + M.afterRise * exposed * dt);
    else this.after *= Math.exp(-dt / M.afterFall);
    if (this.glare > 0.7) this.log.blinded += dt;

    // Player bench.
    const torch = input.torch;
    const lc = this.lastCursor;
    const cs = torch.has && lc.has ? Math.hypot(torch.x - lc.x, torch.y - lc.y, torch.z - lc.z) / dt : 0;
    lc.x = torch.x;
    lc.y = torch.y;
    lc.z = torch.z;
    this.lastCursor.has = torch.has;
    const wasLit = this.player.arc.lit;
    stepBench(this.player, torch, this.ctx);
    if (this.player.stage === 'weld' && this.player.order?.simple) this.recorder.sample(this.player, torch.press, cs, dt);
    if (!wasLit && this.player.arc.lit) this.milestone('firstStrike');
    if (this.player.stage === 'ready' && this.player.order?.urgent) this.handOver();

    this.stepApprentice(dt);
    this.stepOrders(dt);
    this.stepStory();
    this.stepFinale(dt);
    this.updateGuideTimers(dt);
    const g = computeGuide(this, this.guideTmp);
    const changed = g.target !== this.guide.target || g.hint !== this.guide.hint;
    this.guide.target = g.target;
    this.guide.hint = g.hint;
    this.guide.x = g.x;
    this.guide.y = g.y;
    this.guide.z = g.z;
    this.guide.seam = g.seam;
    if (changed) this.bus.emit('focus', { target: g.target, hint: g.hint });

    this.saveT += dt;
    if (this.saveT >= BALANCE.saveEvery) {
      this.saveT = 0;
      this.bus.emit('save', {});
    }
  }

  private updateClock(dt: number): void {
    const C = BALANCE.clock;
    const ph = Math.min(1, this.t / C.duskEnd);
    if (this.flags.finale) this.nightBoost = Math.min(1, this.nightBoost + dt / BALANCE.finale.nightBlend);
    const p = Math.max(ph, this.nightBoost);
    this.clock.dark = p * p * (3 - 2 * p);
    this.clock.snow = 0.15 + 0.85 * p;
    this.clock.cold = Math.pow(p, 1.3);
    this.clock.night = this.t >= C.nightAt || this.nightBoost >= 1;
  }

  private updateGuideTimers(dt: number): void {
    const a = this.player.arc;
    const c = this.cond;
    const A = BALANCE.arc;
    const tick = (v: number, on: boolean) => (on ? v + dt : 0);
    c.maskUpLit = tick(c.maskUpLit, a.lit && this.mask.pos < 0.5);
    c.long = tick(c.long, a.lit && a.L > A.goodHi + 0.4);
    c.short = tick(c.short, a.lit && a.L < A.goodLo - 0.1);
    const vI = this.idealSpeed(this.player);
    c.fast = tick(c.fast, a.lit && a.onSeam && a.v > vI * 1.6);
    c.slow = tick(c.slow, a.lit && a.onSeam && a.v < vI * 0.4);
    c.maskDownDark = tick(c.maskDownDark, !a.lit && this.mask.down && this.player.stage === 'weld');
    c.idle = tick(c.idle, !a.lit);
    c.reachMiss = Math.max(0, c.reachMiss - dt);
  }

  /** Travel speed that gives a good bead on this bench's part with the current current. */
  idealSpeed(b: Bench): number {
    const th = b.part ? b.part.thick : 1;
    return idealSpeed(th, this.power.I);
  }

  // ---------------------------------------------------------------- commands

  private apply(c: Command): void {
    switch (c.type) {
      case 'start':
        if (!this.started) {
          this.started = true;
          this.bus.emit('started', { resumed: this.t > 0 });
          this.refillPile();
        }
        break;
      case 'mask':
        this.mask.down = c.down ?? !this.mask.down;
        this.bus.emit('mask', { down: this.mask.down });
        break;
      case 'takePile':
        if (this.pile && this.canTake(this.pile).ok) {
          const o = this.pile;
          this.pile = null;
          this.load(o);
          this.bus.emit('pileChanged', { has: false });
        }
        break;
      case 'takeOrder': {
        const o = this.board.find((x) => x.uid === c.uid);
        if (o && this.canTake(o).ok) {
          this.board.splice(this.board.indexOf(o), 1);
          this.load(o);
          this.bus.emit('boardChanged', { count: this.board.length });
        }
        break;
      }
      case 'newElectrode':
        if (this.player.stage === 'weld' && newElectrode(this.player, this.ctx, BALANCE.electrode.swapTime)) this.log.electrodes++;
        break;
      case 'handOver':
        this.handOver();
        break;
      case 'buy':
        this.buy(c.id);
        break;
      case 'dismissEnd':
        this.showEnd = false;
        break;
      case 'faceNext':
        this.faceNext();
        break;
      case 'face':
        if (this.player.stage !== 'empty' && !this.player.arc.lit) faceSeam(this.player, c.seam, c.s);
        break;
    }
  }

  /**
   * Turn to the next joint that still needs work: the first gap after the one in view (round-robin), so
   * repeated presses step through the seams.
   */
  private faceNext(): void {
    const b = this.player;
    if (b.stage === 'empty' || b.arc.lit) return;
    const fill = BALANCE.weld.fillMin;
    const n = b.seams.length;
    if (!n) return;
    const cur = this.faceIdx % n;
    for (let k = 1; k <= n; k++) {
      const i = (cur + k) % n;
      const sr = b.seams[i];
      let s = -1;
      if (b.stage === 'weld') s = sr.firstGap(fill);
      else if (b.stage === 'chip') {
        for (let c = 0; c < sr.n; c++)
          if (sr.slag[c] > 0) {
            s = (c + 0.5) * sr.cell;
            break;
          }
      } else s = sr.len / 2;
      if (s < 0) continue;
      // Short joints: face the middle. Long ones: face the way the next stretch of the gap looks on average.
      if (sr.len < 60) faceSeam(b, i, sr.len / 2);
      else if (sr.count === 0 && sr.def.turn !== 'roll') faceSeam(b, i, 0, sr.len);
      else faceSeam(b, i, s, Math.min(sr.closed ? sr.len * 0.4 : sr.len - s, 70));
      this.faceIdx = i;
      return;
    }
  }

  private faceIdx = -1;

  private load(o: Order): void {
    this.faceIdx = -1;
    const part = this.data.parts[o.part];
    this.player.load(o, part);
    if (o.simple) this.recorder.begin();
    this.bus.emit('orderTaken', { bench: 'player', uid: o.uid, part: o.part });
  }

  private buy(id: string): void {
    const u = this.data.upgrades.find((x) => x.id === id);
    if (!u || this.whyNot(id).length) return;
    this.money -= u.cost;
    this.owned[id] = true;
    this.stats = computeStats(this.data, this.owned);
    this.bus.emit('money', { money: this.money, delta: -u.cost });
    this.bus.emit('bought', { id });
    this.bus.emit('shopChanged', {});
    this.milestone('buy:' + id);
    if (id === 'guild') this.refillPile();
    if (id === 'apprentice') {
      this.appState = this.habit ? 'idle' : 'watching';
      this.bus.emit('apprentice', { state: this.appState });
    }
    this.bus.emit('save', {});
  }

  private settle(o: Order, b: Bench): { pay: number; met: boolean } {
    let met = true;
    if (o.req.minGrade && gradeRank(b.grade) < gradeRank(o.req.minGrade)) met = false;
    if (o.req.noHoles && b.holes > 0) met = false;
    let pay = payForSeams(b.seams, o.reward);
    if (!met) pay *= BALANCE.quality.failedReqMul;
    // Until the welder has joined the guild, a finished job always pays at least its fee: however rough
    // the first seam, the first step forward is always open.
    const guild = this.owned.guild ? 0 : (this.data.upgrades.find((u) => u.id === 'guild')?.cost ?? 0);
    return { pay: Math.max(1, o.minPay ?? 0, guild, Math.round(pay)), met };
  }

  private handOver(): void {
    const b = this.player;
    if (b.stage !== 'ready' || !b.order) return;
    const o = b.order;
    const { pay, met } = this.settle(o, b);
    this.money += pay;
    this.log.earned += pay;
    this.ordersDone++;
    this.log.qualities.push(b.quality);
    this.log.best = Math.max(this.log.best, b.quality);
    this.log.holes += b.holes;
    if (o.urgent) {
      // The gate: keep its seams for the end card, then let the night calm down.
      this.finaleSeams = b.seams;
      this.finalePart = o.part;
      this.finaleQuality = b.quality;
      this.finaleGrade = b.grade;
      this.flags.finaleDone = true;
      this.flags.calm = true;
      this.showEnd = true;
    }
    this.bus.emit('handedOver', { bench: 'player', uid: o.uid, pay, grade: b.grade, reqMet: met, part: o.part });
    this.bus.emit('money', { money: this.money, delta: pay });
    this.bus.emit('shopChanged', {});
    this.milestone('firstCoin');
    if (o.urgent) {
      this.milestone('finaleEnd');
      this.bus.emit('finaleEnd', { quality: b.quality, grade: b.grade });
      b.order = null;
      b.part = null;
      b.stage = 'empty';
      b.seams = [];
      b.rev++;
    } else {
      b.clear();
    }
    this.refillPile();
    this.bus.emit('save', {});
  }

  private onWeldDone(bench: string): void {
    if (bench !== 'player') return;
    if (this.player.order?.simple && this.recorder.active) {
      const h = this.recorder.commit();
      if (h) {
        this.habit = h;
        this.bus.emit('habitRecorded', { seconds: h.seconds });
        if (this.appState === 'watching') {
          this.appState = 'idle';
          this.bus.emit('apprentice', { state: 'idle' });
        }
      }
    }
  }

  // ---------------------------------------------------------------- orders & story

  private refillPile(): void {
    if (this.pile) return;
    if (this.flags.finale && !this.flags.finaleDone) {
      if (!this.flags.finaleQueued && this.player.stage === 'empty') {
        this.flags.finaleQueued = true;
        this.pile = makeOrder(this.data, this.data.finale, this.uid++, this.rng.get('orders'), true);
        this.bus.emit('pileChanged', { has: true });
      }
      return;
    }
    if (this.flags.board) return;
    // After the first job the next waits until you've joined the guild.
    if (this.introIndex >= 1 && !this.owned.guild) return;
    const tpl =
      this.introIndex < this.data.intro.length
        ? this.data.intro[this.introIndex++]
        : this.rng.get('orders').pick(this.data.pools.walkin);
    this.pile = makeOrder(this.data, tpl, this.uid++, this.rng.get('orders'));
    this.bus.emit('pileChanged', { has: true });
  }

  private stepOrders(dt: number): void {
    if (!this.flags.board) return;
    this.nextArrival -= dt;
    if (this.nextArrival <= 0) {
      this.nextArrival = BALANCE.board.arriveEvery;
      if (this.board.length < BALANCE.board.size) {
        this.board.push(rollBoardOrder(this.data, this.board, this.uid++, this.rng.get('orders')));
        this.bus.emit('boardChanged', { count: this.board.length });
      }
    }
  }

  private stepStory(): void {
    const x = this.condCtx();
    for (const b of this.data.story) {
      if (this.flags[b.id] || !checkCond(b.when, x)) continue;
      this.flags[b.id] = true;
      this.milestone(b.id);
      this.bus.emit('beat', { id: b.id });
      this.bus.emit('shopChanged', {});
      if (b.id === 'board') {
        this.pile = null;
        this.bus.emit('pileChanged', { has: false });
        for (let i = 0; i < BALANCE.board.startOrders; i++)
          this.board.push(rollBoardOrder(this.data, this.board, this.uid++, this.rng.get('orders')));
        this.nextArrival = BALANCE.board.arriveEvery;
        this.bus.emit('boardChanged', { count: this.board.length });
      }
      if (b.id === 'finale') {
        this.howlT = 2;
        this.milestone('finaleStart');
        this.bus.emit('finaleStart', {});
      }
    }
    if (this.flags.finale && !this.flags.finaleQueued) this.refillPile();
  }

  private stepFinale(dt: number): void {
    if (!this.flags.finale || this.flags.calm) return;
    this.howlT -= dt;
    if (this.howlT <= 0) {
      const r = this.rng.get('world');
      this.howlT = r.range(BALANCE.finale.howlEvery[0], BALANCE.finale.howlEvery[1]);
      this.bus.emit('howl', { pan: r.signed(), pitch: r.range(0.8, 1.25) });
    }
  }

  // ---------------------------------------------------------------- apprentice

  private stepApprentice(dt: number): void {
    const AP = BALANCE.apprentice;
    const b = this.app;
    const set = (s: ApprenticeState) => {
      this.appState = s;
      this.bus.emit('apprentice', { state: s });
    };
    const t = this.appTorch;
    t.press = false;
    switch (this.appState) {
      case 'away':
      case 'watching':
        return;
      case 'idle': {
        if (!this.habit) return set('watching');
        if (this.flags.finale && !this.flags.finaleDone) return;
        const o = this.board.find((x) => x.simple && (!x.req.needs || this.owned[x.req.needs]));
        if (!o) return;
        this.board.splice(this.board.indexOf(o), 1);
        this.bus.emit('boardChanged', { count: this.board.length });
        b.load(o, this.data.parts[o.part]);
        b.electrode = Math.max(b.electrode, 0.0001);
        this.replayer.reset();
        this.appTimer = AP.setup;
        this.bus.emit('orderTaken', { bench: 'apprentice', uid: o.uid, part: o.part });
        return set('setup');
      }
      case 'setup':
        this.appTimer -= dt;
        if (this.appTimer <= 0) set('weld');
        break;
      case 'weld':
        if (b.electrode <= 0 && b.swap <= 0) {
          newElectrode(b, this.ctx, AP.swap);
          break;
        }
        if (b.swap <= 0 && this.habit) this.replayer.drive(b, this.habit, dt, t);
        break;
      case 'chip':
        this.appTimer -= dt;
        if (this.appTimer <= 0) {
          reveal(b, this.ctx);
          this.appTimer = AP.handOver;
          set('hand');
        }
        break;
      case 'hand':
        this.appTimer -= dt;
        if (this.appTimer <= 0 && b.order) {
          const o = b.order;
          const { pay, met } = this.settle(o, b);
          this.money += pay;
          this.log.earned += pay;
          this.log.apprenticeJobs++;
          this.log.apprenticeEarned += pay;
          this.milestone('apprenticeFirst');
          this.bus.emit('handedOver', { bench: 'apprentice', uid: o.uid, pay, grade: b.grade, reqMet: met, part: o.part });
          this.bus.emit('money', { money: this.money, delta: pay });
          this.bus.emit('shopChanged', {});
          b.clear();
          set('idle');
        }
        break;
    }
    if (b.stage !== 'empty') stepBench(b, t, this.ctx);
    if (this.appState === 'weld' && b.stage === 'chip') {
      this.appTimer = AP.chip;
      set('chip');
    }
  }
}

export type { Habit };
