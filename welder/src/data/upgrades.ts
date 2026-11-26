import type { UpgradeDef } from './types';

/**
 * The craft book. First the guild (it opens everything else), then knowledge that lets you tell why a seam
 * came out weak (and read it on the gauges), then tools, then the workshop. `requires` is checked as a whole and every unmet piece is shown as the reason.
 * Effects modify stats in sim/stats.ts (set, then add, then mul).
 */
export const UPGRADES: UpgradeDef[] = [
  { id: 'guild', group: 'craft', cost: 3, effects: {}, slot: -1, model: '' },
  { id: 'tempo', group: 'craft', cost: 4, requires: { owns: ['guild'] }, effects: { set: { knowTempo: 1 } }, slot: -1, model: '' },
  { id: 'ear', group: 'craft', cost: 4, requires: { owns: ['guild'] }, effects: { set: { knowArc: 1 } }, slot: -1, model: '' },
  { id: 'fusion', group: 'craft', cost: 6, requires: { owns: ['guild'], ordersDone: 3 }, effects: { set: { knowFusion: 1 } }, slot: -1, model: '' },
  { id: 'hand', group: 'craft', cost: 5, requires: { owns: ['guild'], ordersDone: 3 }, effects: { set: { knowHand: 1 } }, slot: -1, model: '' },
  {
    id: 'coated',
    group: 'tools',
    cost: 4,
    requires: { owns: ['guild'] },
    effects: { mul: { strikeMul: 0.55, spatterMul: 0.33, poreMul: 0.45, rodWild: 0.3 }, add: { electrodeSeconds: 13, stickL: -0.2, stableI: -0.05 } },
    slot: 0,
    model: 'rods',
  },
  {
    id: 'glass',
    group: 'tools',
    cost: 5,
    requires: { owns: ['guild'] },
    effects: { set: { maskTransmission: 0.065, maskSee: 0.42, maskWindow: 0.82 } },
    slot: 1,
    model: 'glass',
  },
  {
    id: 'jar',
    group: 'shop',
    cost: 8,
    requires: { owns: ['guild'] },
    effects: { set: { powerSmooth: 0.55 }, mul: { dipMul: 0.5 } },
    slot: 2,
    model: 'jar',
  },
  {
    id: 'cable',
    group: 'shop',
    cost: 12,
    requires: { owns: ['jar'] },
    effects: { add: { dynamoGain: 0.08, stableI: -0.03 } },
    slot: 3,
    model: 'cable',
  },
  {
    id: 'apprentice',
    group: 'shop',
    cost: 18,
    requires: { flag: 'board' },
    effects: { set: { apprentice: 1 } },
    slot: 4,
    model: 'apron',
  },
  {
    id: 'wheel2',
    group: 'shop',
    cost: 30,
    requires: { owns: ['jar'], flag: 'board' },
    effects: { add: { dynamoGain: 0.3, wheels: 1 }, mul: { dipMul: 0.75 } },
    slot: 5,
    model: 'wheel',
  },
];
