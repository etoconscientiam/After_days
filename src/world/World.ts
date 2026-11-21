// The section model: 360 columns of pixel cells (newest on top), plus full-width "packs" for old deep rows.
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

export class World {
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
  foldHook?: (x: number, j: number) => void; // called for each cell before it is folded into a pack
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

  /** Put a new cell on top of column x. Returns its index. */
  deposit(x: number, m: number, year: number, flags = 0, spec = 0, decay = 0): number {
    if (this.len[x] >= CAP) this.foldColumns(this.foldHook);
    const i = this.len[x]++;
    const j = x * CAP + i;
    this.mat[j] = m; this.flags[j] = flags; this.spec[j] = spec; this.decay[j] = decay;
    this.k[j] = 1; this.birth[j] = year; this.prog[j] = 0;
    this.serial[x]++;
    this.totalCells++;
    return j;
  }

  /** Cell serial (stable texture row coordinate). */
  cellSerial(x: number, i: number): number {
    return this.serial[x] - this.len[x] + i;
  }

  /** Remove n top cells from column x (erosion). Returns removed materials. */
  removeTop(x: number, n: number): number[] {
    const out: number[] = [];
    const take = Math.min(n, this.len[x]);
    for (let t = 0; t < take; t++) {
      const i = --this.len[x];
      out.push(this.mat[x * CAP + i]);
      this.serial[x]--;
      this.totalCells--;
    }
    return out;
  }

  /** Fold the oldest cells of every column into a new full-width pack. */
  foldColumns(onFind?: (x: number, j: number) => void): Pack | null {
    const B = CFG.B.world;
    const pack = this.newPack();
    let kSum = 0, n = 0;
    const progW = new Float32Array(NMAT);
    for (let x = 0; x < W; x++) {
      const L = this.len[x];
      const take = Math.min(B.packRows, Math.max(0, L - B.minKeepRows));
      if (take <= 0) continue;
      const base = x * CAP;
      for (let i = 0; i < take; i++) {
        const j = base + i;
        const m = this.mat[j];
        if (onFind) onFind(x, j);
        pack.amt[m] += 1;
        progW[m] += this.prog[j];
        kSum += this.k[j]; n++;
        const b = this.birth[j];
        if (b < pack.ageMin) pack.ageMin = b;
        if (b > pack.ageMax) pack.ageMax = b;
        if (this.flags[j] & F_FOSSIL) {
          pack.finds.push({ x, f: (take - i) / take, species: this.spec[j] - 1, rare: !!(this.flags[j] & F_RARE), fragment: false });
        }
      }
      // shift remaining cells down
      const remain = L - take;
      this.mat.copyWithin(base, base + take, base + L);
      this.flags.copyWithin(base, base + take, base + L);
      this.spec.copyWithin(base, base + take, base + L);
      this.decay.copyWithin(base, base + take, base + L);
      this.k.copyWithin(base, base + take, base + L);
      this.birth.copyWithin(base, base + take, base + L);
      this.prog.copyWithin(base, base + take, base + L);
      this.P.copyWithin(base, base + take, base + L);
      this.T.copyWithin(base, base + take, base + L);
      this.len[x] = remain;
    }
    if (n === 0) return null;
    for (let m = 0; m < NMAT; m++) if (pack.amt[m] > 0) pack.prog[m] = progW[m] / pack.amt[m];
    pack.k = kSum / n;
    pack.rows = n / W;
    this.packs.unshift(pack);
    this.mergeDeep();
    this.version++;
    return pack;
  }

  /** Below deepPackFrom rows, merge packs into ~deepPackRows chunks. */
  mergeDeep(): void {
    const B = CFG.B.world;
    let depth = 0;
    for (let p = 0; p < this.packs.length - 1; p++) {
      const a = this.packs[p];
      depth += a.rows;
      if (depth < B.deepPackFrom) continue;
      const b = this.packs[p + 1];
      if (a.rows + b.rows <= B.deepPackRows * 1.05) {
        this.mergeInto(a, b);
        this.packs.splice(p + 1, 1);
        depth -= a.rows; // re-check this merged pack
        p--;
      }
    }
  }

  mergeInto(a: Pack, b: Pack): void {
    const ta = a.rows, tb = b.rows;
    for (let m = 0; m < NMAT; m++) {
      const s = a.amt[m] + b.amt[m];
      if (s > 0) a.prog[m] = (a.prog[m] * a.amt[m] + b.prog[m] * b.amt[m]) / s;
      a.amt[m] = s;
    }
    for (const f of a.finds) f.f = (f.f * ta) / (ta + tb);
    for (const f of b.finds) a.finds.push({ ...f, f: (ta + f.f * tb) / (ta + tb) });
    a.k = (a.k * ta + b.k * tb) / Math.max(1e-6, ta + tb);
    a.rows = ta + tb;
    a.ageMin = Math.min(a.ageMin, b.ageMin);
    a.ageMax = Math.max(a.ageMax, b.ageMax);
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

  /** Locate what lies at visual depth v (compacted rows from surface) in column x. */
  locate(x: number, v: number): { kind: 'cell'; i: number; depth: number } | { kind: 'pack'; p: number; frac: number; depth: number } | null {
    let acc = 0;
    const base = x * CAP;
    let depth = 0;
    for (let i = this.len[x] - 1; i >= 0; i--) {
      const t = 1 / this.k[base + i];
      if (v < acc + t) return { kind: 'cell', i, depth };
      acc += t; depth++;
    }
    for (let p = 0; p < this.packs.length; p++) {
      const pk = this.packs[p];
      const t = pk.rows / pk.k;
      if (v < acc + t) {
        const frac = (v - acc) / t;
        return { kind: 'pack', p, frac, depth: depth + frac * pk.rows };
      }
      acc += t; depth += pk.rows;
    }
    return null;
  }
}
