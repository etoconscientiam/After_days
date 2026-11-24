import type { OrderTemplate } from './types';

/** The first jobs arrive one at a time, in this order, on the scrap heap by the door. */
export const INTRO: OrderTemplate[] = [
  { part: 'boiler', customer: 'neighbour', reward: [3, 3] },
  { part: 'bars', customer: 'neighbour', reward: [3, 3] },
  { part: 'rim', customer: 'carter', reward: [5, 5] },
  { part: 'axle', customer: 'carter', reward: [6, 6] },
  { part: 'damper', customer: 'northwoman', reward: [6, 6] },
];

/** If the intro runs out before the board opens, walk-ins keep the heap busy. */
export const WALKIN: OrderTemplate[] = [
  { part: 'stove', customer: 'northerner', reward: [4, 5] },
  { part: 'boiler', customer: 'northwoman', reward: [4, 4] },
  { part: 'spear', customer: 'guard', reward: [4, 5] },
];

/** The order board: each order shows customer, part, requirements and reward. */
export const BOARD: OrderTemplate[] = [
  { part: 'cauldron', customer: 'northerner', reward: [7, 9], weight: 3 },
  { part: 'stove', customer: 'northwoman', reward: [6, 8], weight: 3 },
  { part: 'boiler', customer: 'northerner', reward: [5, 6], weight: 2 },
  { part: 'patch', customer: 'guard', reward: [10, 13], req: { minGrade: 'fair' }, weight: 2 },
  { part: 'spear', customer: 'guard', reward: [7, 9], req: { noHoles: true }, weight: 2 },
  { part: 'axle', customer: 'carter', reward: [10, 12], req: { needs: 'jar' }, weight: 2 },
  { part: 'rim', customer: 'carter', reward: [7, 9], weight: 2 },
  { part: 'damper', customer: 'northwoman', reward: [8, 10], weight: 1 },
];

/** Night order: the guard brings the broken portcullis of the city gate. */
export const FINALE: OrderTemplate = { part: 'grate', customer: 'guard', reward: [40, 40], req: { noHoles: true } };
