import type { UpgradeDef } from './types';

/**
 * Shelf items. `requires` is checked as a whole and every unmet piece is shown as the reason.
 * Effects modify stats in sim/stats.ts (set, then add, then mul).
 */
export const UPGRADES: UpgradeDef[] = [
  {
    id: 'coated',
    cost: 4,
    effects: { mul: { strikeMul: 0.55, spatterMul: 0.55, poreMul: 0.45 }, add: { electrodeSeconds: 6, stickL: -0.2, stableI: -0.05 } },
    slot: 0,
    model: 'rods',
  },
  {
    id: 'glass',
    cost: 5,
    effects: { set: { maskTransmission: 0.065, maskSee: 0.42, maskWindow: 0.82 } },
    slot: 1,
    model: 'glass',
  },
  {
    id: 'jar',
    cost: 8,
    effects: { set: { powerSmooth: 0.55 }, mul: { dipMul: 0.5 } },
    slot: 2,
    model: 'jar',
  },
  {
    id: 'cable',
    cost: 12,
    requires: { owns: ['jar'] },
    effects: { add: { dynamoGain: 0.08, stableI: -0.03 } },
    slot: 3,
    model: 'cable',
  },
  {
    id: 'apprentice',
    cost: 18,
    requires: { flag: 'board' },
    effects: { set: { apprentice: 1 } },
    slot: 4,
    model: 'apron',
  },
  {
    id: 'wheel2',
    cost: 30,
    requires: { owns: ['jar'], flag: 'board' },
    effects: { add: { dynamoGain: 0.3, wheels: 1 }, mul: { dipMul: 0.75 } },
    slot: 5,
    model: 'wheel',
  },
];
