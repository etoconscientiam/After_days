/**
 * Headless playthrough of the slice on sim/ alone.
 *   npm run bot                 → three skill levels, milestone table
 *   npm run bot -- good 7 -v    → one skill, seed 7, every job printed
 */
import { Game } from '../src/sim/game';
import { DATA } from '../src/data';
import { BALANCE } from '../src/data/balance';
import { emptyTorch, canReach } from '../src/sim/weld';
import { seamPoint } from '../src/sim/seam';
import { Rng } from '../src/core/rng';
import { computeStats } from '../src/sim/stats';
import { makeOrder } from '../src/sim/orders';

interface Skill {
  name: string;
  speedMul: number;
  speedNoise: number;
  lat: number;
  Ltol: number;
  reaction: number;
  aim: number;
  chipEvery: number;
  buys: string[];
  /** Human thinking time around each job (looking, deciding). */
  think: number;
}

const SKILLS: Record<string, Skill> = {
  good: { name: 'good', speedMul: 1.0, speedNoise: 0.12, lat: 1.0, Ltol: 0.7, reaction: 0.35, aim: 0.7, chipEvery: 0.28, buys: ['coated', 'glass', 'jar', 'apprentice', 'wheel2', 'cable'], think: 1.2 },
  average: { name: 'average', speedMul: 1.15, speedNoise: 0.3, lat: 2.4, Ltol: 1.1, reaction: 0.55, aim: 1.0, chipEvery: 0.36, buys: ['jar', 'coated', 'glass', 'apprentice', 'wheel2', 'cable'], think: 2.6 },
  poor: { name: 'poor', speedMul: 1.65, speedNoise: 0.5, lat: 4.5, Ltol: 1.8, reaction: 0.8, aim: 1.4, chipEvery: 0.45, buys: ['glass', 'coated', 'apprentice', 'jar', 'wheel2'], think: 3.5 },
};

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function run(skill: Skill, seed: number, verbose: boolean, setup?: (g: Game) => void, until?: (g: Game) => boolean) {
  const g = new Game(DATA, seed);
  const r = new Rng(seed * 7919 + 13);
  const torch = emptyTorch();
  const pt = seamPoint();
  const jobs: string[] = [];
  const appJobs: number[] = [];
  const simpleJobs: number[] = [];
  let jobStart = 0;
  let outs: Record<string, number> = {};
  g.bus.on('orderTaken', (e) => {
    if (e.bench === 'player') {
      jobStart = g.t;
      outs = {};
    }
  });
  g.bus.on('arcOut', (e) => {
    if (e.bench === 'player') outs[e.reason] = (outs[e.reason] ?? 0) + 1;
  });
  g.bus.on('cantReach', (e) => {
    if (e.bench === 'player') outs.cantReach = (outs.cantReach ?? 0) + 1;
  });
  g.bus.on('handedOver', (e) => {
    const b = e.bench === 'player' ? g.player : g.app;
    if (e.bench === 'apprentice') appJobs.push(b.quality);
    else if (DATA.parts[e.part].simple) simpleJobs.push(b.quality);
    jobs.push(
      `${fmt(g.t)} ${e.bench === 'player' ? 'you' : 'app'} ${e.part.padEnd(9)} q=${b.quality.toFixed(2)} ${e.grade.padEnd(5)} holes=${b.holes} pay=${e.pay}${e.reqMet ? '' : ' (req failed)'}  ${e.bench === 'player' ? (g.t - jobStart).toFixed(1) + 's' : ''}  money=${g.money}` + (process.env.TRACE && e.bench === 'player' ? '  ' + JSON.stringify(outs) : ''),
    );
  });

  let wait = 0;
  let mode: 'idle' | 'turn' | 'aim' | 'scratch' | 'run' = 'idle';
  let seam = 0, s = 0, lat = 0, vMul = 1, Lcheck = 0, chipT = 0;
  g.queue({ type: 'start' });
  g.step({ torch });
  setup?.(g);

  const dt = BALANCE.dt;
  while (g.t < 1200 && !g.showEnd && !until?.(g)) {
    torch.press = false;
    torch.dL = 0;
    const b = g.player;
    if (wait > 0) wait -= dt;
    else if (b.stage === 'empty') {
      for (const id of skill.buys) if (!g.whyNot(id).length) { g.queue({ type: 'buy', id }); wait = skill.think; break; }
      if (wait <= 0) {
        if (g.pile) { g.queue({ type: 'takePile' }); wait = skill.think; }
        else if (g.board.length) {
          const ok = g.board.filter((o) => g.canTake(o).ok).sort((a, c) => c.reward - a.reward);
          if (ok.length) { g.queue({ type: 'takeOrder', uid: ok[0].uid }); wait = skill.think * 1.5; }
        }
      }
      mode = 'idle';
    } else if (b.stage === 'weld') {
      const a = b.arc;
      if (b.swap > 0) { /* hands busy */ }
      else if (b.electrode <= 0 && !a.lit) {
        if (g.mask.down) g.queue({ type: 'mask', down: false });
        g.queue({ type: 'newElectrode' });
        wait = skill.reaction + 0.5;
        mode = 'idle';
      } else if (mode === 'idle') {
        seam = -1;
        for (let i = 0; i < b.seams.length; i++) {
          const gp = b.seams[i].firstGap(BALANCE.weld.fillMin);
          if (gp >= 0) { seam = i; s = Math.max(0, gp - 5); break; }
        }
        if (seam >= 0) {
          if (g.mask.down) g.queue({ type: 'mask', down: false });
          const sr = b.seams[seam];
          const ahead = Math.min(sr.len, s + 12);
          if (!canReach(b, seam, s + 5) || !canReach(b, seam, ahead)) {
            // Turn the work first, then look again.
            g.queue({ type: 'face', seam, s: sr.len < 60 ? sr.len / 2 : ahead });
            mode = 'turn';
            wait = 0.2;
          } else {
            mode = 'aim';
            wait = skill.aim;
          }
        }
      } else if (mode === 'turn') {
        if (!b.rotT) {
          mode = 'idle';
          wait = skill.aim * 0.5;
        }
      } else if (mode === 'aim') {
        mode = 'scratch';
      } else {
        const sr = b.seams[seam];
        const vI = g.idealSpeed(b);
        if (mode === 'scratch') {
          // Scratch in place across the joint until it catches.
          lat = Math.sin(g.t * 40) * 5;
          if (a.lit) {
            mode = 'run';
            wait = 0;
            g.queue({ type: 'mask', down: true });
            vMul = skill.speedMul;
          }
          if (s > sr.len) mode = 'idle';
        } else {
          if (r.chance(dt * 2)) vMul = skill.speedMul * (1 + r.gauss() * skill.speedNoise);
          s += Math.max(0, vI * vMul) * dt;
          Lcheck -= dt;
          if (Lcheck <= 0) {
            Lcheck = skill.reaction;
            const e = a.L - BALANCE.arc.idealL;
            if (Math.abs(e) > skill.Ltol) torch.dL = -Math.sign(e) * BALANCE.arc.wheelStep * Math.min(3, Math.round(Math.abs(e) / BALANCE.arc.wheelStep));
          }
          if (s >= sr.len + 1 || (!a.lit && !a.stuck && a.pool < 0.5)) mode = 'idle';
          // The joint turns away round a ring: stop and turn the work.
          else if (!canReach(b, seam, Math.min(sr.len, s + 3))) mode = 'idle';
        }
        if (mode !== 'scratch') lat += (r.gauss() * skill.lat - lat) * Math.min(1, dt * 3);
        const p = sr.pointAt(Math.min(s, sr.len), pt);
        torch.has = true;
        torch.x = p.x + p.bx * lat;
        torch.y = p.y + p.by * lat;
        torch.z = p.z + p.bz * lat;
        torch.press = mode !== 'idle' && !a.stuck;
      }
    } else if (b.stage === 'chip') {
      if (g.mask.down) g.queue({ type: 'mask', down: false });
      chipT -= dt;
      if (chipT <= 0) {
        chipT = skill.chipEvery;
        outer: for (const sr of b.seams)
          for (let k = 0; k < sr.n; k++)
            if (sr.slag[k] > 0) {
              const p = sr.pointAt((k + 0.5) * sr.cell + 4, pt);
              torch.has = true;
              const j = r.signed() * 3;
              torch.x = p.x + p.tx * j + p.bx * r.signed() * 2;
              torch.y = p.y + p.ty * j + p.by * r.signed() * 2;
              torch.z = p.z + p.tz * j + p.bz * r.signed() * 2;
              torch.press = true;
              break outer;
            }
      }
    } else if (b.stage === 'ready') {
      g.queue({ type: 'handOver' });
      wait = skill.think;
    }
    g.step({ torch });
  }

  if (verbose) for (const j of jobs) console.log('   ' + j);
  return { g, appJobs, simpleJobs };
}

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const names = args.filter((a) => SKILLS[a]);
const seedArg = args.find((a) => /^\d+$/.test(a));
const seed = seedArg ? +seedArg : 1;
const which = names.length ? names : ['good', 'average', 'poor'];

const order = ['firstStrike', 'firstCoin', 'shelf', 'buy:coated', 'buy:glass', 'buy:jar', 'board', 'buy:apprentice', 'apprenticeFirst', 'buy:cable', 'buy:wheel2', 'finaleStart', 'finaleEnd'];
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);

const partArg = args.find((a) => a.startsWith('--part='))?.slice(7);
if (partArg) {
  // One part, three times in a row, on the pile from the start: how long it takes and how it comes out.
  for (const n of which) {
    const sk = { ...SKILLS[n], buys: [] };
    let k = 0;
    const res = run(sk, seed, true, (g) => {
      g.introIndex = 999;
      g.pile = makeOrder(DATA, { part: partArg, customer: 'guard', reward: [1, 1] }, 900, g.rng.get('orders'), false);
      g.bus.on('handedOver', () => {
        if (++k < 3) g.pile = makeOrder(DATA, { part: partArg, customer: 'guard', reward: [1, 1] }, 900 + k, g.rng.get('orders'), false);
      });
    }, (g) => k >= 3 || g.t > 300);
    void res;
  }
  process.exit(0);
}

if (args.includes('--mirror')) {
  // Does the apprentice weld like the one he watched? Board open, apprentice hired from the start.
  console.log('apprentice mirror test: player quality on simple jobs vs apprentice quality');
  for (const n of ['good', 'average', 'poor']) {
    const sk = { ...SKILLS[n], buys: [] };
    const res = run(sk, seed, !!process.env.MV, (g) => {
      g.flags.board = true;
      g.flags.shelf = true;
      g.ordersDone = 5;
      g.owned.apprentice = true;
      g.stats = computeStats(DATA, g.owned);
      g.appState = 'watching';
      g.board = [];
      g.pile = null;
      (g as unknown as { nextArrival: number }).nextArrival = 0;
    }, (g) => g.log.apprenticeJobs >= 4 || g.t > 400);
    console.log(`  ${n.padEnd(8)} player ${avg(res.simpleJobs)} (${res.simpleJobs.length} jobs)   apprentice ${avg(res.appJobs)} (${res.appJobs.length} jobs)`);
  }
  process.exit(0);
}

const results = which.map((n) => {
  console.log(`\n== ${n} (seed ${seed})`);
  const res = run(SKILLS[n], seed, verbose || which.length === 1);
  const { g } = res;
  const q = g.log.qualities;
  console.log(`   simple jobs: you ${avg(res.simpleJobs)}, apprentice ${avg(res.appJobs)}`);
  console.log(`   orders ${g.ordersDone}, avg quality ${(q.reduce((a, b) => a + b, 0) / Math.max(1, q.length)).toFixed(2)}, earned ${g.log.earned}, apprentice ${g.log.apprenticeJobs} jobs avg q ${(res.appJobs.reduce((a, b) => a + b, 0) / Math.max(1, res.appJobs.length)).toFixed(2)}, finale ${g.finaleGrade} ${g.finaleQuality.toFixed(2)}`);
  return res;
});
console.log('\nmilestone'.padEnd(18) + which.map((n) => n.padStart(9)).join(''));
for (const m of order) console.log(m.padEnd(17) + results.map((r) => (r.g.log.milestones[m] !== undefined ? fmt(r.g.log.milestones[m]) : '—').padStart(9)).join(''));
