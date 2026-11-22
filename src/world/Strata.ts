// The strata as a list of layers (top = youngest first). A layer is an object of the simulation, not a guess of the
// renderer: it has its years, its rock, its own thickness profile across the width, one compaction k, transformation
// progress, bones and fossils in its own coordinates. New layers appear only at the top: the top layer is open and
// takes all deposits; it closes when the deposited rock changes steadily, an element lays an event layer, the era
// changes or it reaches its max thickness (the closing rules live in the physics).
//
// Lateral detail: the width is cut into NS segments; every segment keeps its own amounts per material (sea silt and
// land soil can lie in one layer side by side), its own transformation progress (a local heat zone or a press acts on
// some segments only) and its own displayed rock. The thickness profile is interpolated between segment centres.
import { CFG, NMAT, M, eraOfYear } from '../config';
import { World, Pack, W, CAP, F_FOSSIL, F_ROLLED, F_RARE, F_FRAGMENT, F_INSECT, F_FAST } from './World';

/** Segments across the width. */
export const NS = 12;
export const SEGW = W / NS;
/** No material: a segment with nothing in it. */
export const NONE = 255;

/** Bone flags reuse the cell flags of the old model. */
export const B_FAST = F_FAST, B_ROLLED = F_ROLLED, B_FOSSIL = F_FOSSIL, B_RARE = F_RARE, B_FRAGMENT = F_FRAGMENT;

/** A bone in a layer: x in world px, f = depth inside the layer (0 top .. 1 bottom), species index, decay 0..255. */
export interface Bone { x: number; f: number; sp: number; decay: number; flags: number }

export type LayerKind = '' | 'flood' | 'ash' | 'moraine' | 'meteor' | 'magma' | 'foundation';

export interface Layer {
  id: number;
  /** birth years: from (oldest) .. to (youngest); `to` grows while the layer is open */
  y0: number; y1: number;
  era: number;
  /** raw amounts in pixel cells, [s * NMAT + m] */
  amt: Float32Array;
  /** transformation progress in years, [s * NMAT + m] */
  prog: Float32Array;
  /** cells of resin with an insect inside, per segment (a part of amt[resin]) */
  insect: Float32Array;
  /** displayed rock per segment (changes only by an explicit event: opening, transformation, merge) */
  rock: Uint8Array;
  /** at most one admixture per segment (NONE = pure) */
  mix: Uint8Array;
  /** compaction: visual thickness = raw / k */
  k: number;
  /** cached at the geology tick: pressure at the middle of the layer (MPa, before k) and temperature */
  P: number; T: number;
  bones: Bone[];
  open: boolean;
  /** a belt of an epoch: old thin layers merged once, drawn as stripes */
  belt: boolean;
  kind: LayerKind;
  /** texture seed */
  seed: number;
}

/** Share of a segment a second material needs to show as an admixture. */
const MIX_SHARE = 0.2;

export class Strata {
  /** layers[0] is the top (youngest) one */
  layers: Layer[] = [];
  nextId = 1;
  /** bumped whenever the strata change in a way the renderer must see */
  version = 0;

  reset(): void {
    this.layers = [];
    this.nextId = 1;
    this.version++;
  }

  newLayer(year: number, kind: LayerKind = ''): Layer {
    const id = this.nextId++;
    return {
      id, y0: year, y1: year, era: eraOfYear(year),
      amt: new Float32Array(NS * NMAT), prog: new Float32Array(NS * NMAT), insect: new Float32Array(NS),
      rock: new Uint8Array(NS).fill(NONE), mix: new Uint8Array(NS).fill(NONE),
      k: 1, P: 0, T: 0, bones: [], open: false, belt: false, kind, seed: (id * 2654435761) >>> 0,
    };
  }

  /** The open top layer, if any. */
  top(): Layer | null {
    const L = this.layers[0];
    return L && L.open ? L : null;
  }

  // ---------- amounts and thickness ----------
  /** Raw cells in segment s. */
  segCells(L: Layer, s: number): number {
    let t = 0;
    const o = s * NMAT;
    for (let m = 0; m < NMAT; m++) t += L.amt[o + m];
    return t;
  }

  /** Raw thickness (rows) of segment s. */
  segRows(L: Layer, s: number): number {
    return this.segCells(L, s) / SEGW;
  }

  /** Raw cells of the whole layer. */
  cells(L: Layer): number {
    let t = 0;
    for (let i = 0; i < L.amt.length; i++) t += L.amt[i];
    return t;
  }

  /** Mean raw thickness (rows) across the width. */
  meanRows(L: Layer): number {
    return this.cells(L) / W;
  }

  /** Raw thickness (rows) at world column x: the profile through the segment centres (smooth, cosine-eased). */
  rowsAt(L: Layer, x: number): number {
    const u = x / SEGW - 0.5;
    if (u <= 0) return this.segRows(L, 0);
    if (u >= NS - 1) return this.segRows(L, NS - 1);
    const s = Math.floor(u), t = u - s;
    const e = (1 - Math.cos(t * Math.PI)) * 0.5;
    const a = this.segRows(L, s), b = this.segRows(L, s + 1);
    return a + (b - a) * e;
  }

  /** Total raw rows of the strata at column x. */
  totalRows(x: number): number {
    let r = 0;
    for (const L of this.layers) r += this.rowsAt(L, x);
    return r;
  }

  /** Visual (compacted) depth of the strata at column x: Σ raw / k. */
  visualDepth(x: number): number {
    let v = 0;
    for (const L of this.layers) v += this.rowsAt(L, x) / L.k;
    return v;
  }

  /** Total amount of material m in the layer. */
  matCells(L: Layer, m: number): number {
    let t = 0;
    for (let s = 0; s < NS; s++) t += L.amt[s * NMAT + m];
    return t;
  }

  /** The most abundant material of segment s (NONE if empty). */
  dominant(L: Layer, s: number): number {
    let best = 0, bm = NONE;
    const o = s * NMAT;
    for (let m = 1; m < NMAT; m++) if (L.amt[o + m] > best) { best = L.amt[o + m]; bm = m; }
    return bm;
  }

  /** The most abundant material of the whole layer. */
  dominantAll(L: Layer): number {
    let best = 0, bm = NONE;
    for (let m = 1; m < NMAT; m++) { const v = this.matCells(L, m); if (v > best) { best = v; bm = m; } }
    return bm;
  }

  /** Decide the displayed rock (and admixture) of every segment from the amounts. Call only on an event
   *  (layer closed, transformation done, merge, load), never every frame. Empty segments borrow a neighbour's rock. */
  settleRock(L: Layer): void {
    for (let s = 0; s < NS; s++) {
      const o = s * NMAT;
      let b1 = 0, m1 = NONE, b2 = 0, m2 = NONE, tot = 0;
      for (let m = 1; m < NMAT; m++) {
        const v = L.amt[o + m];
        tot += v;
        if (v > b1) { b2 = b1; m2 = m1; b1 = v; m1 = m; } else if (v > b2) { b2 = v; m2 = m; }
      }
      L.rock[s] = m1;
      L.mix[s] = m2 !== NONE && tot > 0 && b2 / tot >= MIX_SHARE && m2 !== M.bone ? m2 : NONE;
    }
    // empty segments (a thin layer that pinches out) take the rock of the nearest filled one
    for (let pass = 0; pass < NS; pass++) {
      let left = false;
      for (let s = 0; s < NS; s++) {
        if (L.rock[s] !== NONE) continue;
        const n = s > 0 && L.rock[s - 1] !== NONE ? L.rock[s - 1] : s < NS - 1 && L.rock[s + 1] !== NONE ? L.rock[s + 1] : NONE;
        if (n !== NONE) L.rock[s] = n; else left = true;
      }
      if (!left) break;
    }
    this.version++;
  }

  // ---------- merging (belts of an epoch, the converter) ----------
  /** Merge layer b (directly below a) into a. Thicknesses add up; bones keep their place in the merged thickness. */
  mergeInto(a: Layer, b: Layer): void {
    const ta = this.meanRows(a), tb = this.meanRows(b), T = Math.max(1e-6, ta + tb);
    for (let i = 0; i < a.amt.length; i++) {
      const s = a.amt[i] + b.amt[i];
      if (s > 0) a.prog[i] = (a.prog[i] * a.amt[i] + b.prog[i] * b.amt[i]) / s;
      a.amt[i] = s;
    }
    for (let s = 0; s < NS; s++) a.insect[s] += b.insect[s];
    for (const bn of a.bones) bn.f = (bn.f * ta) / T;
    for (const bn of b.bones) a.bones.push({ ...bn, f: (ta + bn.f * tb) / T });
    a.k = (a.k * ta + b.k * tb) / T;
    a.y0 = Math.min(a.y0, b.y0);
    a.y1 = Math.max(a.y1, b.y1);
    if (a.kind !== b.kind) a.kind = '';
    this.settleRock(a);
  }

  /** The layer holding birth year b (the youngest one if several touch it), or null. */
  layerOfYear(b: number): Layer | null {
    for (const L of this.layers) if (b >= L.y0 && b <= L.y1) return L;
    return null;
  }

  // ---------- summary (debug, checks) ----------
  summary(): { n: number; rows: number; belts: number; bones: number; fossils: number; list: { id: number; y0: number; y1: number; era: number; rock: string; rows: number; k: number; open: boolean }[] } {
    let bones = 0, fossils = 0, belts = 0, rows = 0;
    const list = this.layers.map((L) => {
      bones += L.bones.length;
      for (const b of L.bones) if (b.flags & B_FOSSIL) fossils++;
      if (L.belt) belts++;
      const r = this.meanRows(L);
      rows += r;
      const d = this.dominantAll(L);
      return { id: L.id, y0: Math.round(L.y0), y1: Math.round(L.y1), era: L.era, rock: d === NONE ? '-' : CFG.materials[d].id, rows: +r.toFixed(2), k: +L.k.toFixed(3), open: L.open };
    });
    return { n: this.layers.length, rows: +rows.toFixed(1), belts, bones, fossils, list };
  }
}

// ---------- converter: the old cell + pack world → layers ----------

/** Calendar bins per era for the converter (a layer never spans two eras). */
const BINS_PER_ERA = 16;
/** Converter: a layer is closed when it gets thicker than this (mean rows across the width). */
export const CONVERT_MAX_ROWS = 24;

interface Bin { amt: Float32Array; prog: Float32Array; insect: Float32Array; kSum: number; n: number; y0: number; y1: number; bones: { x: number; birth: number; sp: number; decay: number; flags: number }[] }

/** Build the layer list from an old save's cells and packs, by birth years. Existing games survive the rewrite:
 *  the same rocks in the same order, the same amounts (rock yields keep their balance), the bones with their state. */
export function strataFromWorld(w: World, now: number): Strata {
  const st = new Strata();
  const nE = CFG.eras.length;
  const NB = nE * BINS_PER_ERA;
  const binOf = (b: number): number => {
    const e = eraOfYear(b), E = CFG.eras[e];
    const i = Math.floor(((b - E.start) / Math.max(1e-6, E.end - E.start)) * BINS_PER_ERA);
    return e * BINS_PER_ERA + Math.max(0, Math.min(BINS_PER_ERA - 1, i));
  };
  const bins = new Map<number, Bin>();
  const getBin = (key: number): Bin => {
    let b = bins.get(key);
    if (!b) {
      b = { amt: new Float32Array(NS * NMAT), prog: new Float32Array(NS * NMAT), insect: new Float32Array(NS), kSum: 0, n: 0, y0: Infinity, y1: -Infinity, bones: [] };
      bins.set(key, b);
    }
    return b;
  };

  // pack years → the bins they span, [bin, share of the pack, lo, hi]
  const binSpan = (bi: number): [number, number] => {
    const E = CFG.eras[Math.floor(bi / BINS_PER_ERA)], step = (E.end - E.start) / BINS_PER_ERA;
    return [E.start + (bi % BINS_PER_ERA) * step, E.start + ((bi % BINS_PER_ERA) + 1) * step];
  };
  const sharesOf = (pk: Pack): [number, number, number, number][] => {
    const a0 = Math.min(pk.ageMin, pk.ageMax), a1 = Math.max(pk.ageMin, pk.ageMax), span = a1 - a0;
    const out: [number, number, number, number][] = [];
    if (span >= 1e-6) {
      for (let bi = binOf(a0); bi <= binOf(a1); bi++) {
        const [b0, b1] = binSpan(bi);
        const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
        if (hi > lo) out.push([bi, (hi - lo) / span, lo, hi]);
      }
    }
    if (!out.length) return [[binOf(a0), 1, a0, a1]];
    const tot = out.reduce((s, q) => s + q[1], 0);
    for (const q of out) q[1] /= tot;
    return out;
  };

  // 1) how thick each calendar bin is (mean rows): a bin laid while the calendar waited at an era's end, or a deep
  //    pack, can be thick, so it is cut into parts (cells by their order in each column, packs evenly)
  const binRows = new Float32Array(NB);
  for (let x = 0; x < W; x++) for (let i = 0; i < w.len[x]; i++) binRows[binOf(w.birth[x * CAP + i])] += 1 / W;
  for (const pk of w.packs) for (const [bi, sh] of sharesOf(pk)) binRows[bi] += pk.rows * sh;
  const parts = new Uint16Array(NB);
  for (let b = 0; b < NB; b++) parts[b] = Math.min(64, Math.max(1, Math.ceil(binRows[b] / CONVERT_MAX_ROWS)));
  const keyOf = (bin: number, part: number) => bin * 64 + Math.min(63, part);

  // 2) cells
  const cnt = new Uint16Array(NB), seen = new Uint16Array(NB);
  for (let x = 0; x < W; x++) {
    const s = Math.min(NS - 1, Math.floor(x / SEGW));
    const base = x * CAP, L = w.len[x];
    cnt.fill(0); seen.fill(0);
    for (let i = 0; i < L; i++) cnt[binOf(w.birth[base + i])]++;
    for (let i = 0; i < L; i++) {
      const j = base + i;
      const bi = binOf(w.birth[j]);
      const part = parts[bi] > 1 ? Math.floor((seen[bi]++ * parts[bi]) / Math.max(1, cnt[bi])) : 0;
      const B = getBin(keyOf(bi, part));
      const m = w.mat[j];
      B.amt[s * NMAT + m] += 1;
      B.prog[s * NMAT + m] += w.prog[j];
      if (m === M.resin && (w.flags[j] & F_INSECT)) B.insect[s] += 1;
      B.kSum += w.k[j]; B.n++;
      const y = w.birth[j];
      if (y < B.y0) B.y0 = y;
      if (y > B.y1) B.y1 = y;
    }
  }

  // 3) packs: full width, spread over the bins they span in proportion to the years, and evenly over the parts
  //    of a bin (older parts get the older years)
  for (const pk of w.packs) {
    const a0 = Math.min(pk.ageMin, pk.ageMax), a1 = Math.max(pk.ageMin, pk.ageMax), span = a1 - a0;
    const shares = sharesOf(pk);
    for (const [bi, sh, lo, hi] of shares) {
      const n = parts[bi];
      for (let p = 0; p < n; p++) {
        const B = getBin(keyOf(bi, p));
        const q = sh / n;
        for (let m = 0; m < NMAT; m++) {
          const a = pk.amt[m] * q;
          if (a <= 0) continue;
          for (let s = 0; s < NS; s++) { B.amt[s * NMAT + m] += a / NS; B.prog[s * NMAT + m] += (pk.prog[m] * a) / NS; }
        }
        const cells = pk.rows * W * q;
        B.kSum += pk.k * cells; B.n += cells;
        const plo = lo + ((hi - lo) * p) / n, phi = lo + ((hi - lo) * (p + 1)) / n;
        if (plo < B.y0) B.y0 = plo;
        if (phi > B.y1) B.y1 = phi;
      }
    }
    // finds of the pack: f is the depth inside the pack (0 top .. 1 bottom), so their year is known
    for (const f of pk.finds) {
      const fy = a1 - f.f * span;
      const sq = shares.find((q) => fy >= q[2] && fy <= q[3]) ?? shares[0];
      const n = parts[sq[0]];
      const p = sq[3] > sq[2] ? Math.min(n - 1, Math.floor(((fy - sq[2]) / (sq[3] - sq[2])) * n)) : 0;
      getBin(keyOf(sq[0], p)).bones.push({ x: f.x, birth: fy, sp: f.species, decay: 0, flags: F_ROLLED | (f.fragment ? F_FRAGMENT : F_FOSSIL) | (f.rare ? F_RARE : 0) });
    }
  }

  // 4) bins → layers, old to young: a new layer at an era change, when the dominant rock changes, or when it is
  //    thick enough
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const out: Layer[] = [];
  const binsOf = new Map<Layer, Bin[]>();
  const layerOfKey = new Map<number, Layer>();
  let cur: Layer | null = null;
  let curDom = NONE;
  for (const key of keys) {
    const B = bins.get(key)!;
    if (B.n <= 0) continue;
    const era = Math.floor(Math.floor(key / 64) / BINS_PER_ERA);
    let bd = NONE, best = 0;
    for (let m = 1; m < NMAT; m++) { let v = 0; for (let s = 0; s < NS; s++) v += B.amt[s * NMAT + m]; if (v > best) { best = v; bd = m; } }
    const rows = B.n / W;
    const next = !cur || cur.era !== era || bd !== curDom || st.meanRows(cur) + rows > CONVERT_MAX_ROWS;
    if (next) {
      cur = st.newLayer(B.y0);
      cur.era = era;
      cur.y0 = B.y0; cur.y1 = B.y1;
      cur.k = 0;
      curDom = bd;
      out.push(cur);
      binsOf.set(cur, []);
    }
    const L = cur!;
    binsOf.get(L)!.push(B);
    layerOfKey.set(key, L);
    for (let i = 0; i < L.amt.length; i++) { L.amt[i] += B.amt[i]; L.prog[i] += B.prog[i]; }
    for (let s = 0; s < NS; s++) L.insect[s] += B.insect[s];
    L.k += B.kSum;
    (L as any)._n = ((L as any)._n ?? 0) + B.n;
    L.y0 = Math.min(L.y0, B.y0);
    L.y1 = Math.max(L.y1, B.y1);
  }
  for (const L of out) {
    const n = (L as any)._n as number;
    delete (L as any)._n;
    L.k = n > 0 ? Math.max(1, L.k / n) : 1;
    for (let i = 0; i < L.amt.length; i++) L.prog[i] = L.amt[i] > 0 ? L.prog[i] / L.amt[i] : 0;
    // finds of old packs: depth inside the layer follows their year (younger = higher)
    const span = Math.max(1e-6, L.y1 - L.y0);
    for (const B of binsOf.get(L)!) for (const b of B.bones) {
      L.bones.push({ x: b.x, f: Math.max(0, Math.min(1, (L.y1 - b.birth) / span)), sp: b.sp, decay: b.decay, flags: b.flags });
    }
    st.settleRock(L);
  }
  // bones of the cells: depth inside the layer follows the order of the cells in their column
  const below = new Map<Layer, number>(), inCol = new Map<Layer, number>();
  for (let x = 0; x < W; x++) {
    const base = x * CAP, L = w.len[x];
    cnt.fill(0); seen.fill(0);
    for (let i = 0; i < L; i++) cnt[binOf(w.birth[base + i])]++;
    const lay: (Layer | undefined)[] = new Array(L);
    below.clear(); inCol.clear();
    for (let i = 0; i < L; i++) {
      const bi = binOf(w.birth[base + i]);
      const part = parts[bi] > 1 ? Math.floor((seen[bi]++ * parts[bi]) / Math.max(1, cnt[bi])) : 0;
      const ly = layerOfKey.get(keyOf(bi, part));
      lay[i] = ly;
      if (ly) inCol.set(ly, (inCol.get(ly) ?? 0) + 1);
    }
    for (let i = 0; i < L; i++) {
      const ly = lay[i];
      if (!ly) continue;
      const k = below.get(ly) ?? 0;
      below.set(ly, k + 1);
      const j = base + i;
      if (w.mat[j] !== M.bone || w.spec[j] === 0) continue;
      const n = inCol.get(ly)!;
      ly.bones.push({ x, f: 1 - (k + 0.5) / n, sp: w.spec[j] - 1, decay: w.decay[j], flags: w.flags[j] & (F_FAST | F_ROLLED | F_FOSSIL | F_RARE | F_FRAGMENT) });
    }
  }
  out.reverse();   // top first
  st.layers = out;
  if (out.length) {
    out[0].open = true;
    out[0].y1 = Math.max(out[0].y1, now);
  }
  st.version++;
  return st;
}

// ---------- save format ----------

export interface LayerSave {
  id: number; y0: number; y1: number; era: number;
  /** sparse amounts: [s * NMAT + m, amount, progress, ...] */
  a: number[];
  ins?: number[];
  k: number; o?: 1; b?: 1; kind?: LayerKind; seed: number;
  /** bones: [x, f, species, decay, flags, ...] */
  bn?: number[];
  rock: number[]; mix: number[];
}
export interface StrataSave { v: 1; next: number; layers: LayerSave[] }

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function packStrata(st: Strata): StrataSave {
  return {
    v: 1, next: st.nextId,
    layers: st.layers.map((L) => {
      const a: number[] = [];
      for (let i = 0; i < L.amt.length; i++) if (L.amt[i] > 1e-4) a.push(i, r3(L.amt[i]), Math.round(L.prog[i]));
      const ls: LayerSave = { id: L.id, y0: L.y0, y1: L.y1, era: L.era, a, k: r3(L.k), seed: L.seed, rock: [...L.rock], mix: [...L.mix] };
      if (L.insect.some((v) => v > 0)) ls.ins = [...L.insect].map(r3);
      if (L.open) ls.o = 1;
      if (L.belt) ls.b = 1;
      if (L.kind) ls.kind = L.kind;
      if (L.bones.length) {
        const bn: number[] = [];
        for (const b of L.bones) bn.push(Math.round(b.x), r3(b.f), b.sp, b.decay, b.flags);
        ls.bn = bn;
      }
      return ls;
    }),
  };
}

export function unpackStrata(s: StrataSave): Strata {
  const st = new Strata();
  st.nextId = s.next;
  st.layers = s.layers.map((ls) => {
    const L = st.newLayer(ls.y0, ls.kind ?? '');
    st.nextId = s.next;
    L.id = ls.id; L.y0 = ls.y0; L.y1 = ls.y1; L.era = ls.era; L.k = ls.k; L.seed = ls.seed;
    for (let q = 0; q + 2 < ls.a.length; q += 3) { L.amt[ls.a[q]] = ls.a[q + 1]; L.prog[ls.a[q]] = ls.a[q + 2]; }
    if (ls.ins) L.insect.set(ls.ins.slice(0, NS));
    L.open = !!ls.o; L.belt = !!ls.b;
    if (ls.bn) for (let q = 0; q + 4 < ls.bn.length; q += 5) L.bones.push({ x: ls.bn[q], f: ls.bn[q + 1], sp: ls.bn[q + 2], decay: ls.bn[q + 3], flags: ls.bn[q + 4] });
    if (ls.rock?.length === NS) L.rock.set(ls.rock); else st.settleRock(L);
    if (ls.mix?.length === NS) L.mix.set(ls.mix);
    return L;
  });
  st.version++;
  return st;
}
