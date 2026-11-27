import type { CustomerDef } from './types';

/** Who comes to the door. Looks are read by the view (queue figures and board tags). */
const list: CustomerDef[] = [
  { id: 'northerner', look: { cloak: '#5a5048', hood: '#7a6a58', hat: 'hood', height: 1.62 } },
  { id: 'northwoman', look: { cloak: '#4a4038', hood: '#8a7660', hat: 'hood', height: 1.55 } },
  { id: 'guard', look: { cloak: '#3c3a38', hood: '#6a6c70', hat: 'helmet', height: 1.75 } },
  { id: 'carter', look: { cloak: '#4c3c2c', hood: '#5c4a36', hat: 'cap', height: 1.68 } },
  { id: 'neighbour', look: { cloak: '#463e36', hood: '#6c5c4c', hat: 'cap', height: 1.6 } },
  /** He gathers the made things the river gives up, and brings them to be mounted. */
  { id: 'keeper', look: { cloak: '#2c3236', hood: '#4c565c', hat: 'hood', height: 1.72 } },
];

export const CUSTOMERS: Record<string, CustomerDef> = Object.fromEntries(list.map((c) => [c.id, c]));
