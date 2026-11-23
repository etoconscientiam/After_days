// Serializable game state (everything except the strata: the particle grid lives in world/Grid.ts, the depth in world/Archive.ts).
import { CFG, ZoneId } from '../config';

export interface Pool {
  orgM: number;      // marine organic mass
  orgL: number;      // land organic mass
  bone: number;
  boneSpec: number[]; // bone mass per species index
  age: number;       // average lying age (years)
  boneCredit: number;
  orgCredit: number;
  fast: number;      // >0 while a rapid burial (flood/ash) is in effect (years left)
}

export interface ActiveEffect { id: string; until: number; x?: number; data?: any }
export interface TargetZone { kind: 'water' | 'heat' | 'magma'; x0: number; x1: number; b0: number; b1: number; until: number; heat: number }

/** Press: a finger holding the strata — a circle in grid cells (particle columns/rows); power after paying. */
export interface PressState { x: number; y: number; r: number; power: number }
/** The conveyor into the archive (core/pressure.ts). */
export interface SinkRun { acc: number; rows: number }
/** A marker bed waiting for the air to clear (core/beds.ts). */
export interface BedRun { m: number; x0: number; x1: number; wait: number }
/** An epoch order: a small task with a reward (config/orders.json). */
export interface OrderState { id: string; start: number; done: boolean }
export interface BuffState { energyMul: number; energyT: number; timeMul: number; timeT: number }

/** A fault from an earthquake: layers older than year b are offset on one side of x and gently bent. */
export interface FaultState { x: number; up: number; lift: number; amp: number; lam: number; b: number }

export interface ChronicleEntry { id: string; y0: number; y1: number; data: Record<string, any>; at: number }
export interface MuseumEntry { common: number; rare: number; fragments: number }

export interface RunState {
  year: number;
  /** world time in years that never stops (life, deposits, geology, effect timers); `year` is the calendar,
   *  which waits at an era's end until its condition is met */
  clock: number;
  era: number;
  energy: number;
  energyEarned: number;
  boost: number;                  // seconds of click boost left
  pop: Record<string, number[]>;  // per species: [water, shore, land]
  peak: Record<string, number>;
  regrow: Record<string, number>;
  /** units of each species that arose on their own (core/niche.ts); the rest were bought. Absent in old saves. */
  wild?: Record<string, number>;
  /** seconds toward the next wild birth or death of each species */
  wildT?: Record<string, number>;
  rocks: Record<string, number>;
  rocksEarned: Record<string, number>;
  upgrades: Record<string, number>;
  waterEnd: number;               // x (360 px) where water ends
  shoreEnd: number;               // x where shore ends
  startWaterEnd: number;
  oxygen: number;
  pools: Record<ZoneId, Pool>;
  active: ActiveEffect[];
  targets: TargetZone[];
  cooldowns: Record<string, number>;
  auto: Record<string, boolean>;
  excavation: number;
  excavationNeed: number;
  settled: boolean;
  fertility: number;
  glacierLoad: number;
  compactMass: number;
  unlocked: string[];
  mutations: Record<string, string>;
  mutationOffer: { species: string; mutation: string }[] | null;
  mutationEraOffered: number;
  rockRanks: Record<string, number>;
  basinRocks: Record<string, number>[];  // shard world: rocks produced per basin
  shardBoost: number[];                  // shard world: boost seconds per basin
  excavationShards: number[];
  autoVolcanoTimer: number;
  realTime: number;               // real seconds in this run
  timeAtEra: number[];            // real seconds when each era was reached
  deaths: number;
  fossilsRun: number;
  layers: number;                 // particles laid in this run (the away report)
  press: PressState | null;       // the finger pressing the layers (not a long-term state)
  buffs: BuffState;               // short boosts from rare surface events (real seconds left)
  recentKills: number[];          // [year, count, year, count, ...] of violent deaths, for the burial window
  burialWindow: number;           // real seconds left of the burial window
  burialCooldown: number;
  burials: number[];              // [b0, b1, mul, ...] birth ranges whose bones fossilise more easily
  orders: OrderState[];
  ordersEra: number;              // era the current orders were drawn for
  shepherd: Record<string, boolean>;  // species bought automatically (Shepherd node)
  pressMoved: number;             // compacted thickness done by pressing (orders)
  insectAmber: number;            // pieces of amber with an insect made in this run (orders)
  faults: FaultState[];           // earthquakes leave a fault: older layers are shifted and bent (section view)
  sink: SinkRun;                  // the conveyor into the archive
  beds: BedRun[];                 // marker beds waiting to be laid
  pileSec: number;                // the material that lies in the piles for a few piles in a row (bands and lenses)
  bedT: number;                   // real seconds until the «Bed» button is ready again
}

export interface MetaState {
  density: number;
  densitySpent: number;
  tree: Record<string, number>;
  foundation: number;          // thickness in visual rows
  foundationLines: number[];   // thickness values where epoch lines are drawn
  prestiges: number;
  maxEra: number;
  realTime: number;
}

export interface LegacyState {
  museum: Record<string, MuseumEntry>;
  notes: string[];
  chronicle: ChronicleEntry[];
  echoSeen: string[];         // triggered echoes already shown in this playthrough
  items: string[];            // chosen thing per playthrough (artifact_a/b/c)
  relics: Record<string, number>;
  discovered: string[];       // rocks ever discovered
  rituals: string[];          // chosen in order
  playthrough: number;
  totalRealTime: number;
  totalPrestiges: number;
  fossils: number;
  finished: boolean;
  firsts: Record<string, boolean>;
  /** what the player has already seen, for the "new" dots on the tabs */
  seen: { life: string[]; elements: string[]; upgrades: string[]; notes: number; density: string[] };
}

export interface Settings {
  lang: 'en' | 'ru';
  music: number;
  sfx: number;
  muted: boolean;
  quality: 'high' | 'low';
  /** the game lowered the quality once by itself (a slow phone): it does not do it again */
  autoLow?: boolean;
  integerScale: boolean;
  detailed: boolean;
}

export type Phase = 'choose' | 'play' | 'finale' | 'temple' | 'newWorld' | 'end';

export interface GameState {
  version: number;
  run: RunState;
  meta: MetaState;
  legacy: LegacyState;
  settings: Settings;
  phase: Phase;
  ritualChoice: string | null;
  templeProgress: number;
  savedAt: number;
  seed: number;
}

export function newPool(): Pool {
  return { orgM: 0, orgL: 0, bone: 0, boneSpec: CFG.species.map(() => 0), age: 0, boneCredit: 0, orgCredit: 0, fast: 0 };
}

export function newRun(era = 0): RunState {
  const W = CFG.B.world.width;
  const z = CFG.B.zones;
  const waterEnd = Math.round(W * z.startWater);
  const shoreEnd = Math.round(W * (z.startWater + z.startShore));
  const e = CFG.eras[era];
  const pop: Record<string, number[]> = {};
  for (const s of CFG.species) pop[s.id] = [0, 0, 0];
  return {
    year: e.start,
    clock: e.start,
    era,
    energy: 0,
    energyEarned: 0,
    boost: 0,
    pop,
    peak: {},
    regrow: {},
    wild: {},
    wildT: {},
    rocks: {},
    rocksEarned: {},
    upgrades: {},
    waterEnd,
    shoreEnd,
    startWaterEnd: waterEnd,
    oxygen: era >= 2 ? CFG.eras[1].cond.value! : 0,
    pools: { water: newPool(), shore: newPool(), land: newPool() },
    active: [],
    targets: [],
    cooldowns: {},
    auto: {},
    excavation: 0,
    excavationNeed: 0,
    settled: false,
    fertility: 0,
    glacierLoad: 0,
    compactMass: 0,
    unlocked: [],
    mutations: {},
    mutationOffer: null,
    mutationEraOffered: -1,
    rockRanks: {},
    basinRocks: [{}, {}, {}],
    shardBoost: [0, 0, 0],
    excavationShards: [0, 0, 0],
    autoVolcanoTimer: 0,
    realTime: 0,
    timeAtEra: [],
    deaths: 0,
    fossilsRun: 0,
    layers: 0,
    press: null,
    buffs: { energyMul: 1, energyT: 0, timeMul: 1, timeT: 0 },
    recentKills: [],
    burialWindow: 0,
    burialCooldown: 0,
    burials: [],
    orders: [],
    ordersEra: -1,
    shepherd: {},
    pressMoved: 0,
    insectAmber: 0,
    faults: [],
    sink: { acc: 0, rows: 0 },
    beds: [],
    pileSec: -1,
    bedT: 0,
  };
}

export function newMeta(): MetaState {
  return { density: 0, densitySpent: 0, tree: {}, foundation: 0, foundationLines: [], prestiges: 0, maxEra: 0, realTime: 0 };
}

export function newLegacy(): LegacyState {
  return {
    museum: {}, notes: [], chronicle: [], echoSeen: [], items: [], relics: {}, discovered: [], rituals: [], playthrough: 1,
    totalRealTime: 0, totalPrestiges: 0, fossils: 0, finished: false, firsts: {}, seen: { life: [], elements: [], upgrades: [], notes: 0, density: [] },
  };
}

export function defaultSettings(): Settings {
  // English by default (spec); the player switches language in settings.
  return { lang: 'en', music: 0.5, sfx: 0.7, muted: false, quality: 'high', integerScale: true, detailed: false };
}

export function newGameState(seed = (Math.random() * 2 ** 31) | 0): GameState {
  return {
    version: CFG.B.save.version,
    run: newRun(0),
    meta: newMeta(),
    legacy: newLegacy(),
    settings: defaultSettings(),
    phase: 'choose',
    ritualChoice: null,
    templeProgress: 0,
    savedAt: Date.now(),
    seed,
  };
}
