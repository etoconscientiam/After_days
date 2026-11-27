/** Seeded randomness. mulberry32, one independent stream per subsystem. Math.random is never used in sim/. */

export function hashSeed(seed: number, name: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x85ebca6b);
    h = (h ^ (h >>> 13)) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  signed(): number {
    return this.next() * 2 - 1;
  }
  /** Roughly normal, mean 0, sd 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(arr: readonly T[], w: (x: T) => number): T {
    let sum = 0;
    for (const x of arr) sum += w(x);
    let r = this.next() * sum;
    for (const x of arr) {
      r -= w(x);
      if (r <= 0) return x;
    }
    return arr[arr.length - 1];
  }
}

export const STREAMS = ['orders', 'power', 'spatter', 'weld', 'world', 'apprentice', 'returns'] as const;
export type StreamName = (typeof STREAMS)[number];

export class RngStreams {
  private s = {} as Record<StreamName, Rng>;
  constructor(seed: number) {
    for (const n of STREAMS) this.s[n] = new Rng(hashSeed(seed, n));
  }
  get(name: StreamName): Rng {
    return this.s[name];
  }
  snapshot(): number[] {
    return STREAMS.map((n) => this.s[n].state);
  }
  restore(states: number[]): void {
    STREAMS.forEach((n, i) => {
      if (typeof states[i] === 'number') this.s[n].state = states[i] >>> 0;
    });
  }
}
