// The archive of the depth: everything the conveyor took below the thing, as layers (the layer model of
// world/Strata.ts). Rows arrive from below the visible strata, so each new row is younger than the whole archive and
// goes on top of it: into the open top layer, or a new one when the epoch changes, when a marker bed sinks (a bed is a
// natural boundary and gets its own thin layer) or when the layer is thick enough. When there are too many layers,
// the oldest ones of one epoch merge into a belt of that epoch — once and for ever.
//
// Units: amounts are old 1×1 cells (as in Strata.ts and the old saves): one particle = cellsPerParticle cells.
// The deep geology of the layers (pressure from above, k, the slow transformations) runs on this model too.
import { CFG, NMAT, eraOfYear } from '../config';
import { Grid, GW, KIND, MARKER, K_NONE, K_SOLID, P_FAST, P_ROLLED, P_FOSSIL, P_RARE, P_FRAGMENT, P_INSECT } from './Grid';
import { Strata, Layer, NS, SEGW, Bone } from './Strata';

const S = CFG.B.sand;
const CPP = S.cellsPerParticle;
const BONE = CFG.matIndex.bone;
const W = CFG.B.world.width;

export class Archive extends Strata {
  /** rows taken into the open top layer */
  rowsInTop = 0;

  static from(st: Strata): Archive {
    const a = new Archive();
    a.layers = st.layers;
    a.nextId = st.nextId;
    const top = a.layers[0];
    a.rowsInTop = top && top.open ? Math.round(a.meanRows(top) / 2) : 0;
    a.version++;
    return a;
  }

  /** Take row y of the grid (called by the conveyor right before the row leaves). */
  addRow(g: Grid, y: number): void {
    const base = y * GW;
    let n = 0, mk = 0, b0 = Infinity, b1 = -Infinity, bsum = 0;
    for (let x = 0; x < GW; x++) {
      const m = g.mat[base + x], k = KIND[m];
      if (k === K_NONE || k === K_SOLID) continue;
      n++;
      if (MARKER[m]) mk++;
      const b = g.birth[base + x];
      bsum += b;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    if (!n) return;
    const era = eraOfYear(bsum / n);
    const markerRow = mk >= n * 0.5;
    let L = this.layers[0];
    const fits = L && L.open && L.era === era && L.kind !== 'marker' && !markerRow && this.rowsInTop < S.archiveMaxRows;
    if (!fits) {
      if (L && L.open) { L.open = false; this.settleRock(L); }
      L = this.newLayer(b0, markerRow ? 'marker' : '');
      L.era = era; L.y0 = b0; L.y1 = b1; L.open = true;
      this.layers.unshift(L);
      this.rowsInTop = 0;
    }
    // the new row lies on top of the layer: what was there sinks a little deeper inside it
    const T0 = this.meanRows(L), t = (n * CPP) / W, T1 = T0 + t;
    for (const bn of L.bones) bn.f = (bn.f * T0 + t) / T1;
    L.k = (L.k * T0 + t) / T1;
    for (let x = 0; x < GW; x++) {
      const i = base + x, m = g.mat[i], k = KIND[m];
      if (k === K_NONE || k === K_SOLID) continue;
      const s = Math.min(NS - 1, Math.floor((x * 2 + 1) / SEGW));
      const j = s * NMAT + m;
      const a0 = L.amt[j];
      L.amt[j] = a0 + CPP;
      L.prog[j] = (L.prog[j] * a0 + g.prog[i] * CPP) / (a0 + CPP);
      if (g.flags[i] & P_INSECT) L.insect[s] += CPP;
      if (m === BONE && g.spec[i]) {
        const bone: Bone = { x: x * 2 + 1, f: (t * 0.5) / T1, sp: g.spec[i] - 1, decay: g.decay[i], flags: g.flags[i] & (P_FAST | P_ROLLED | P_FOSSIL | P_RARE | P_FRAGMENT) };
        L.bones.push(bone);
      }
    }
    L.y0 = Math.min(L.y0, b0);
    L.y1 = Math.max(L.y1, b1);
    this.rowsInTop++;
    if (markerRow || this.rowsInTop >= S.archiveMaxRows) { L.open = false; }
    this.settleRock(L);
    this.cap();
  }

  /** Too many layers: the oldest of one epoch merge into a belt (a merge is final). */
  cap(): void {
    let guard = 0;
    while (this.layers.length > S.archiveMaxLayers && guard++ < 1000) {
      const ls = this.layers;
      // the deepest pair of neighbours of the same epoch; if none, the two deepest
      let k = -1;
      for (let i = ls.length - 2; i >= 1; i--) if (ls[i].era === ls[i + 1].era && !ls[i].open) { k = i; break; }
      if (k < 0) k = ls.length - 2;
      const a: Layer = ls[k], b: Layer = ls[k + 1];
      this.mergeInto(a, b);
      a.belt = true;
      ls.splice(k + 1, 1);
    }
  }

  /** Raw cells in the whole archive per material (checks). */
  totals(): Float64Array {
    const t = new Float64Array(NMAT);
    for (const L of this.layers) for (let s = 0; s < NS; s++) for (let m = 0; m < NMAT; m++) t[m] += L.amt[s * NMAT + m];
    return t;
  }
}
