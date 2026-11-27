import type { CustomerDef } from './types';

/** Who comes to the door. Looks are read by the view (queue figures and board tags). */
const list: CustomerDef[] = [
  { id: 'northerner', look: { cloak: '#5a5048', hood: '#7a6a58', hat: 'hood', height: 1.62, beard: 'long', hair: '#6a4a2c', skin: '#b07a58', coat: 'cloak' } },
  { id: 'northwoman', look: { cloak: '#4a5058', hood: '#6a7280', hat: 'cap', height: 1.55, female: true, hair: '#c8a870', skin: '#d8a582', coat: 'coat', role: 'north' } },
  { id: 'guard', look: { cloak: '#3c3a38', hood: '#6a6c70', hat: 'helmet', height: 1.75, beard: 'mustache', hair: '#2a1d14', skin: '#c8936c', coat: 'coat', role: 'guard', trousers: '#2e2c2a' } },
  { id: 'carter', look: { cloak: '#5c4630', hood: '#7a5c3c', hat: 'cap', height: 1.68, beard: 'short', hair: '#4a3020', skin: '#9a6a4c', coat: 'coat', role: 'carter' } },
  { id: 'neighbour', look: { cloak: '#463e36', hood: '#6c5c4c', hat: 'cap', height: 1.6, beard: 'stubble', hair: '#8a7a68', skin: '#c08868', coat: 'coat', role: 'neighbour' } },
  /** He gathers the made things the river gives up, and brings them to be mounted. */
  { id: 'keeper', look: { cloak: '#2c3236', hood: '#4c565c', hat: 'hood', height: 1.72, beard: 'long', hair: '#b0a090', skin: '#c8936c', coat: 'robe', role: 'keeper' } },
];

export const CUSTOMERS: Record<string, CustomerDef> = Object.fromEntries(list.map((c) => [c.id, c]));
