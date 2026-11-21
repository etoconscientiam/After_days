// Serializable game state (everything except the pixel world, which lives in world/World.ts).
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

export interface ChronicleEntry { id: string; y0: number; y1: number; data: Record<string, any>; at: number }
export interface MuseumEntry { common: number; rare: number; fragments: number }

export interface RunState {
  year: number;
  era: number;
  energy: number;
  energyEarned: number;
  boost: number;                  // seconds of click boost left
  pop: Record<string, number[]>;  // per species: [water, shore, land]
  peak: Record<string, number>;
  regrow: Record<string, number>;
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
  layers: number;
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
}

export interface Settings {
  lang: 'en' | 'ru';
  music: number;
  sfx: number;
  muted: boolean;
  quality: 'high' | 'low';
  integerScale: boolean;
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
    era,
    energy: 0,
    energyEarned: 0,
    boost: 0,
    pop,
    peak: {},
    regrow: {},
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
  };
}

export function newMeta(): MetaState {
  return { density: 0, densitySpent: 0, tree: {}, foundation: 0, foundationLines: [], prestiges: 0, maxEra: 0, realTime: 0 };
}

export function newLegacy(): LegacyState {
  return {
    museum: {}, notes: [], chronicle: [], echoSeen: [], items: [], relics: {}, discovered: [], rituals: [], playthrough: 1,
    totalRealTime: 0, totalPrestiges: 0, fossils: 0, finished: false, firsts: {},
  };
}

export function defaultSettings(): Settings {
  // English by default (spec); the player switches language in settings.
  return { lang: 'en', music: 0.5, sfx: 0.7, muted: false, quality: 'high', integerScale: true };
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
