import type { Game } from './game';
import type { Order } from './orders';
import { computeStats } from './stats';
import type { Habit } from './apprentice';

/** Save format: a version, ids and numbers only. The bead in progress is not saved; its order goes back. */
export const SAVE_VERSION = 2;

type OrderRow = [number, string, string, number, string, number, string, number, number, number?];

export interface SaveData {
  v: number;
  seed: number;
  t: number;
  money: number;
  owned: string[];
  flags: string[];
  ordersDone: number;
  introIndex: number;
  uid: number;
  pile: OrderRow | null;
  board: OrderRow[];
  nextArrival: number;
  habit: Habit | null;
  app: string;
  rng: number[];
  log: Game['log'];
  power: [number, number];
  /** Customers: visits and the last grade; jobs on their way back. (Older saves have none.) */
  visits?: Record<string, number>;
  lastGrade?: Record<string, string>;
  returns?: [number, OrderRow][];
  /** After the gate: seconds into the current day; each hand's bench level. */
  day?: number;
  wl?: number[];
}

function row(o: Order): OrderRow {
  return [o.uid, o.part, o.customer, o.reward, o.req.minGrade ?? '', o.req.noHoles ? 1 : 0, o.req.needs ?? '', o.simple ? 1 : 0, o.urgent ? 1 : 0, o.ret ? 1 : 0];
}

function unrow(r: OrderRow): Order {
  return {
    uid: r[0],
    part: r[1],
    customer: r[2],
    reward: r[3],
    req: {
      ...(r[4] ? { minGrade: r[4] as Order['req']['minGrade'] } : {}),
      ...(r[5] ? { noHoles: true } : {}),
      ...(r[6] ? { needs: r[6] } : {}),
    },
    simple: !!r[7],
    urgent: !!r[8],
    ...(r[9] ? { ret: true } : {}),
  };
}

export function serialize(g: Game): SaveData {
  const board = g.board.map(row);
  let pile = g.pile ? row(g.pile) : null;
  // Jobs in progress go back where they came from.
  const po = g.player.order;
  if (po) {
    if (po.urgent || !g.flags.board) pile = row(po);
    else board.unshift(row(po));
  }
  const ao = g.app.order;
  if (ao) board.unshift(row(ao));
  for (const w of g.workers) if (w.bench.order) board.unshift(row(w.bench.order));
  return {
    v: SAVE_VERSION,
    seed: g.seed,
    t: Math.round(g.t * 100) / 100,
    money: g.money,
    owned: Object.keys(g.owned).filter((k) => g.owned[k]),
    flags: Object.keys(g.flags).filter((k) => g.flags[k] && k !== 'finaleQueued'),
    ordersDone: g.ordersDone,
    introIndex: g.introIndex,
    uid: g.uid,
    pile,
    board,
    nextArrival: g.nextArrival,
    habit: g.habit,
    app: g.appState === 'away' ? 'away' : g.habit ? 'idle' : 'watching',
    rng: g.rng.snapshot(),
    log: g.log,
    power: [g.power.flow, g.power.wheel],
    visits: g.visits,
    lastGrade: g.lastGrade,
    day: Math.round((g.t - g.dayStart) * 10) / 10,
    wl: [0, 1, 2, 3].map((i) => g.workers.find((w) => w.i === i)?.lvl ?? 1),
    returns: g.returns.map((x) => [Math.round((x.at - g.t) * 10) / 10, row(x.o)]),
  };
}

export function restore(g: Game, d: SaveData): boolean {
  if (!d || d.v !== SAVE_VERSION) return false;
  g.t = d.t;
  g.money = d.money;
  g.owned = Object.fromEntries(d.owned.map((k) => [k, true]));
  g.flags = Object.fromEntries(d.flags.map((k) => [k, true]));
  g.ordersDone = d.ordersDone;
  g.introIndex = d.introIndex;
  g.uid = d.uid;
  // Orders for parts this build doesn't have (an older save) are dropped.
  const known = (o: Order) => !!g.data.parts[o.part] && !!g.data.customers[o.customer];
  g.pile = d.pile ? unrow(d.pile) : null;
  if (g.pile && !known(g.pile)) g.pile = null;
  if (g.pile?.urgent) g.flags.finaleQueued = true;
  g.board = d.board.map(unrow).filter(known);
  g.nextArrival = d.nextArrival;
  g.habit = d.habit;
  g.appState = d.app as Game['appState'];
  g.rng.restore(d.rng);
  g.rebindRng();
  g.log = d.log;
  g.power.flow = d.power[0];
  g.power.wheel = d.power[1];
  g.visits = { ...(d.visits ?? {}) };
  g.lastGrade = { ...(d.lastGrade ?? {}) } as Game['lastGrade'];
  g.returns = (d.returns ?? []).map(([dt, r]) => ({ at: d.t + dt, o: unrow(r) })).filter((x) => known(x.o));
  g.stats = computeStats(g.data, g.owned);
  g.dayStart = d.t - (d.day ?? d.t);
  g.workers = [];
  g.syncWorkers(d.wl ?? []);
  if (g.flags.finale && !g.flags.season2) g.nightBoost = 1;
  return true;
}
