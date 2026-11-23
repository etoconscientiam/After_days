// Typed config loader. All game numbers and ids come from the JSON files next to this one.
import materialsJson from './materials.json';
import transformsJson from './transforms.json';
import erasJson from './eras.json';
import speciesJson from './species.json';
import elementsJson from './elements.json';
import upgradesJson from './upgrades.json';
import balanceJson from './balance.json';
import storyJson from './story.json';
import echoesJson from './echoes.json';
import notesJson from './notes.json';
import rareJson from './rare.json';
import ordersJson from './orders.json';

export type ZoneId = 'water' | 'shore' | 'land';
export const ZONES: ZoneId[] = ['water', 'shore', 'land'];
export type HabitatId = ZoneId | 'any' | 'shoreLand';

export type MatKind = 'none' | 'loose' | 'rock' | 'marker' | 'solid';
export interface MaterialDef {
  id: string; idx: number; density: number; palette: string[]; grain: number;
  organic?: boolean; fertile?: boolean; rock?: string; glint?: boolean; banded?: boolean; emissive?: boolean;
  /** behaviour in the falling-sand strata (see materials.json _comment) */
  kind: MatKind; slip?: number; marker?: boolean;
  rgb: [number, number, number][];
}
export interface RockDef { id: string; icon: string; value: number }
export interface TransformRule {
  from: string; to: string; pMin?: number; tMin?: number; tMax?: number; water?: boolean; noOxygen?: boolean;
  maxDepth?: number; years: number; yield: number; chance?: number; world?: string; insectTo?: string; insectYield?: number;
  rankReq?: number;
  fromIdx: number; toIdx: number; insectToIdx: number; rock: string;
}
export interface EraCond { type: string; value?: number; group?: string; predator?: boolean }
export interface EraDef { id: number; key: string; start: number; end: number; yps: number; cond: EraCond }
export interface SpeciesDef {
  id: string; era: number; zone: HabitatId; cost: number; eps: number; lifespan: number; groups: string[];
  deposit: { contrib: number; mats: Record<string, number> };
  death: { org?: number; orgMat?: string; bone?: number };
  oxygen?: number; needsOxygen?: number; insects?: boolean; predator?: boolean; digs?: boolean;
  unlockAfter?: string | null; trait?: Record<string, number>; sprite: string; tint?: string;
  /** units that arise on their own in a perfect niche; the niche itself (core/niche.ts) */
  wild?: number; niche?: { mix?: Record<string, number>; food?: string[]; deep?: number };
  idx: number;
}
export interface ElementDef {
  id: string; era: number; cost: number; cooldown: number; duration: number; kind: 'surface' | 'section';
  icon: string; world?: string; params: any;
}
export interface UpgradeDef {
  id: string; branch: string; currency: string; base: number; stat: string; kind: 'add' | 'mul'; value: number;
  extra?: { stat: string; value: number }; milestones?: boolean; growth?: number;
  /** branch pile: the material this upgrade adds to every tapped pile; era: the epoch it opens in */
  pileMat?: string; era?: number;
}
export interface DensityNode { id: string; base: number; mult: number; max: number; stat: string; value: number; requires?: number }
export interface RareDef { id: string; eras: [number, number]; place: 'sky' | 'shore' | 'land' | 'section' | 'strata' | 'horizon'; weight?: number; reward: Record<string, number | boolean> }
export interface OrderDef { id: string; eras: [number, number]; type: 'rockEarned' | 'museum' | 'insectAmber' | 'pressMoved'; rock?: string; species?: string; n: number; reward: { density?: number; rock?: string; n?: number } }
export interface RitualDef { id: string; scene: string; world: string; mods: Record<string, any> }
export interface EchoDef { id: string; picture: string; sound: string; group: 'common' | 'ring' | 'key' | 'wand'; trigger: string; eras?: [number, number] }
export interface NoteDef { id: string; order: number; medium: 'metal_sheet' | 'memory_crystal' | 'ceramic_plate' | 'school_tablet'; type: string; reviewEn?: boolean; todo?: string; todoKey?: string }
export interface ItemDef { id: string; echoGroup: string; sprite: string }

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const materials: MaterialDef[] = (materialsJson.materials as any[]).map((m, idx) => ({
  ...m, idx, rgb: (m.palette as string[]).map(hexToRgb),
}));
const matIndex: Record<string, number> = {};
materials.forEach((m) => (matIndex[m.id] = m.idx));

export function mat(id: string): number {
  const i = matIndex[id];
  if (i === undefined) throw new Error('Unknown material ' + id);
  return i;
}

const rules: TransformRule[] = (transformsJson.rules as any[]).map((r) => ({
  ...r,
  fromIdx: mat(r.from),
  toIdx: mat(r.to),
  insectToIdx: r.insectTo ? mat(r.insectTo) : -1,
  rock: materials[mat(r.to)].rock ?? '',
}));

const species: SpeciesDef[] = (speciesJson.species as any[]).map((s, idx) => ({ ...s, idx }));

export const CFG = {
  materials,
  matIndex,
  rocks: materialsJson.rocks as RockDef[],
  transforms: { rules, oxygenRows: transformsJson.oxygenRows, oxygenRotPer100y: transformsJson.oxygenRotPer100y },
  eras: erasJson.eras as EraDef[],
  startYear: erasJson.startYear,
  zeroYear: erasJson.zeroYear,
  species,
  speciesById: Object.fromEntries(species.map((s) => [s.id, s])) as Record<string, SpeciesDef>,
  costGrowth: speciesJson.costGrowth,
  spritesPerSpecies: speciesJson.spritesPerSpecies,
  unlockAfterPop: speciesJson.unlockAfterPop,
  elements: elementsJson.elements as ElementDef[],
  elementMinCost: elementsJson.minCost,
  upgrades: upgradesJson.upgrades as UpgradeDef[],
  upgradeGrowth: upgradesJson.growth,
  milestones: upgradesJson.milestones,
  density: upgradesJson.density.nodes as DensityNode[],
  rare: rareJson as unknown as { every: [number, number]; lifetime: number; events: RareDef[] },
  orders: ordersJson as unknown as { perEra: [number, number]; pool: OrderDef[] },
  B: balanceJson,
  story: storyJson,
  rituals: storyJson.rituals as RitualDef[],
  echoes: echoesJson as { duration: number; personalShare: number; interval: { base: number; perEra: number; jitter: number }; alpha: { base: number; perEra: number; min: number }; echoes: EchoDef[] },
  notes: (notesJson.notes as NoteDef[]).slice().sort((a, b) => a.order - b.order),
  items: storyJson.items as ItemDef[],
  relics: storyJson.relics as { id: string; sprite: string }[],
};

export type Config = typeof CFG;

/** Transform rules indexed by source material. */
export const RULES_BY_MAT: TransformRule[][] = materials.map((m) => rules.filter((r) => r.fromIdx === m.idx));

export const M = {
  void: mat('void'), soil: mat('soil'), dust: mat('dust'), silt: mat('silt'), sand: mat('sand'), clay: mat('clay'),
  shellOoze: mat('shellOoze'), limeCrust: mat('limeCrust'), orgLand: mat('orgLand'), orgMarine: mat('orgMarine'),
  bone: mat('bone'), resin: mat('resin'), ash: mat('ash'), moraine: mat('moraine'), meteor: mat('meteor'),
  magma: mat('magma'), glowstone: mat('glowstone'), iridium: mat('iridium'), oil: mat('oil'), gas: mat('gas'), biomat: mat('biomat'), water: mat('water'), sinter: mat('sinter'),
  concrete: mat('concrete'), glassSand: mat('glassSand'), plastic: mat('plastic'), metal: mat('metal'),
  bedrock: mat('bedrock'), foundation: mat('foundation'), artifact: mat('artifact'),
  ochre: mat('ochre'), tephra: mat('tephra'), boundary: mat('boundary'), floodSilt: mat('floodSilt'),
};
export const NMAT = materials.length;

/** Horizontal scale of the world relative to the original 360-px design (numbers written for 360 px are multiplied by this). */
export const SX = CFG.B.world.width / 360;

/** Era index a game year belongs to. */
export function eraOfYear(year: number): number {
  for (let i = CFG.eras.length - 1; i >= 0; i--) if (year >= CFG.eras[i].start) return i;
  return 0;
}
