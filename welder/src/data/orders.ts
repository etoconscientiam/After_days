import type { OrderTemplate } from './types';

/** The first jobs arrive one at a time, in this order, on the scrap heap by the door. */
export const INTRO: OrderTemplate[] = [
  { part: 'spade', customer: 'northerner', reward: [4, 4], minPay: 3 },
  { part: 'pan', customer: 'neighbour', reward: [5, 5] },
  { part: 'wheel', customer: 'carter', reward: [6, 6] },
  { part: 'kettle', customer: 'northwoman', reward: [7, 7] },
  { part: 'spear', customer: 'guard', reward: [8, 8] },
];

/** If the intro runs out before the board opens, walk-ins keep the heap busy. */
export const WALKIN: OrderTemplate[] = [
  { part: 'pan', customer: 'northwoman', reward: [4, 5] },
  { part: 'spade', customer: 'northerner', reward: [4, 4] },
  { part: 'spear', customer: 'guard', reward: [4, 5] },
];

/** The order board: each order shows customer, part, requirements and reward. */
export const BOARD: OrderTemplate[] = [
  { part: 'bucket', customer: 'northwoman', reward: [9, 11], weight: 3 },
  { part: 'cauldron', customer: 'northerner', reward: [9, 11], req: { minGrade: 'fair' }, weight: 2 },
  { part: 'helmet', customer: 'guard', reward: [12, 14], req: { noHoles: true }, weight: 2 },
  { part: 'kettle', customer: 'northwoman', reward: [6, 8], weight: 2 },
  { part: 'spear', customer: 'guard', reward: [7, 9], req: { noHoles: true }, weight: 2 },
  { part: 'wheel', customer: 'carter', reward: [9, 11], req: { needs: 'jar' }, weight: 2 },
  { part: 'spade', customer: 'northerner', reward: [5, 6], weight: 2 },
  { part: 'pan', customer: 'neighbour', reward: [5, 7], weight: 1 },
  // A made thing from before, brought up by the river: an iron cradle round it, and not a hole burnt.
  { part: 'relic', customer: 'keeper', reward: [17, 21], req: { noHoles: true, minGrade: 'fair' }, weight: 2, after: 6 },
];

/** Night order: the guard brings a broken section of the city gate's portcullis. */
export const FINALE: OrderTemplate = { part: 'grate', customer: 'guard', reward: [40, 40], req: { noHoles: true } };
