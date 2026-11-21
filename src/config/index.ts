// Typed config loader. All game numbers and ids come from the JSON files next to this one.
import materialsJson from './materials.json';
import transformsJson from './transforms.json';
import erasJson from './eras.json';
import speciesJson from './species.json';
import elementsJson from './elements.json';
import upgradesJson from './upgrades.json';
import balanceJson from './balance.json';
import storyJson from './story.json';

export type ZoneId = 'water' | 'shore' | 'land';
export const ZONES: ZoneId[] = ['water', 'shore', 'land'];
export type HabitatId = ZoneId | 'any' | 'shoreLand';

export interface MaterialDef {
  id: string; idx: number; density: number; palette: string[]; grain: number;
  organic?: boolean; fertile?: boolean; rock?: string; glint?: boolean; banded?: boolean; emissive?: boolean;
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
  idx: number;
}
export interface ElementDef {
  id: string; era: number; cost: number; cooldown: number; duration: number; kind: 'surface' | 'section';
  icon: string; world?: string; params: any;
}
export interface UpgradeDef {
  id: string; branch: string; currency: string; base: number; stat: string; kind: 'add' | 'mul'; value: number;
  extra?: { stat: string; value: number }; milestones?: boolean; growth?: number;
}
export interface DensityNode { id: string; base: number; mult: number; max: number; stat: string; value: number }
export interface RitualDef { id: string; scene: string; world: string; mods: Record<string, any> }

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
  B: balanceJson,
  story: storyJson,
  rituals: storyJson.rituals as RitualDef[],
};

export type Config = typeof CFG;

/** Transform rules indexed by source material. */
export const RULES_BY_MAT: TransformRule[][] = materials.map((m) => rules.filter((r) => r.fromIdx === m.idx));

export const M = {
  void: mat('void'), soil: mat('soil'), dust: mat('dust'), silt: mat('silt'), sand: mat('sand'), clay: mat('clay'),
  shellOoze: mat('shellOoze'), limeCrust: mat('limeCrust'), orgLand: mat('orgLand'), orgMarine: mat('orgMarine'),
  bone: mat('bone'), resin: mat('resin'), ash: mat('ash'), moraine: mat('moraine'), meteor: mat('meteor'),
  magma: mat('magma'), glowstone: mat('glowstone'), iridium: mat('iridium'),
};
export const NMAT = materials.length;
