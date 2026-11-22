// The strata of old saves (v1/v2): 180 columns of 1×1 cells (newest on top) plus full-width "packs" for the deep
// old rows. The game no longer runs on this model — it is only read when an old save is migrated (save.ts): the top of
// the columns becomes particles of the grid, the rest goes into the archive (Strata.ts strataFromWorld).
// Column storage: index i = 0 is the oldest (bottom) cell, len-1 is the newest (top) cell.
import { CFG, NMAT } from '../config';

export const W = CFG.B.world.width;
export const CAP = CFG.B.world.pixelRows;

export const F_FOSSIL = 1;
export const F_ROLLED = 2;
export const F_INSECT = 4;
export const F_RARE = 8;
export const F_FRAGMENT = 16;
export const F_GLOW = 32;
export const F_FAST = 64;

export interface Find { x: number; f: number; species: number; rare: boolean; fragment: boolean }

export interface Pack {
  rows: number;            // physical rows (amount sum / W)
  amt: Float32Array;       // pixel-equivalents per material
  prog: Float32Array;      // transform progress per material (years)
  k: number;               // compaction
  ageMin: number;          // birth year range
  ageMax: number;
  serial: number;          // texture seed
  finds: Find[];
  P: number;               // cached at geology tick
  T: number;
}

export class LegacyWorld {
  len = new Uint16Array(W);
  h = new Float32Array(W);         // fractional deposition accumulator
  serial = new Uint32Array(W);     // total cells ever deposited per column (texture coordinates)
  mat = new Uint8Array(W * CAP);
  flags = new Uint8Array(W * CAP);
  spec = new Uint8Array(W * CAP);  // species index + 1 for bone pixels
  decay = new Uint8Array(W * CAP); // 0..255 preservation loss
  k = new Float32Array(W * CAP);
  birth = new Float32Array(W * CAP);
  prog = new Float32Array(W * CAP);
  P = new Float32Array(W * CAP);   // cached pressure (MPa, before k)
  T = new Float32Array(W * CAP);   // cached temperature
  packs: Pack[] = [];              // packs[0] = youngest, right under the pixel cells
  packSerial = 1;
  fold = new Float32Array(W);      // visual fold displacement in rows (earthquakes), decays slowly
  version = 0;                     // bumped whenever the section changes (render cache key)
  totalCells = 0;

  reset(): void {
    this.len.fill(0); this.h.fill(0); this.serial.fill(0);
    this.mat.fill(0); this.flags.fill(0); this.spec.fill(0); this.decay.fill(0);
    this.k.fill(1); this.birth.fill(0); this.prog.fill(0); this.P.fill(0); this.T.fill(0);
    this.packs = []; this.fold.fill(0); this.version++; this.totalCells = 0;
  }

  idx(x: number, i: number): number {
    return x * CAP + i;
  }

  newPack(): Pack {
    return {
      rows: 0, amt: new Float32Array(NMAT), prog: new Float32Array(NMAT), k: 1,
      ageMin: Infinity, ageMax: -Infinity, serial: this.packSerial++, finds: [], P: 0, T: 0,
    };
  }

  /** Total physical rows in column x (cells + packs). */
  columnRows(x: number): number {
    let r = this.len[x];
    for (const p of this.packs) r += p.rows;
    return r;
  }

  /** Visual (compacted) depth of column x: sum of 1/k. */
  visualDepth(x: number): number {
    let v = 0;
    const base = x * CAP;
    for (let i = 0; i < this.len[x]; i++) v += 1 / this.k[base + i];
    for (const p of this.packs) v += p.rows / p.k;
    return v;
  }

  packRowsTotal(): number {
    let r = 0;
    for (const p of this.packs) r += p.rows;
    return r;
  }
}
