// Chronicle of layers: entries are built from the real content of a layer and phrased from i18n templates,
// in the style of a palaeontologist's field diary.
import { CFG } from '../config';
import type { Game } from '../core/game';
import type { ChronicleEntry } from '../core/state';
import { CAP, F_FOSSIL, F_RARE } from '../world/World';
import { t, fmtInt, fmt } from './i18n';

const cd = (year: number) => fmtInt(Math.max(0, CFG.zeroYear - year)) + '⟡';

/** Inspect what lies at (x, visual depth v) and record a chronicle entry. */
export function makeEntry(g: Game, x: number, v: number): ChronicleEntry | null {
  const w = g.world;
  const loc = w.locate(x, v);
  if (!loc) return null;
  const data: Record<string, any> = {};
  let y0: number, y1: number;
  if (loc.kind === 'cell') {
    const j = x * CAP + loc.i;
    const b = w.birth[j];
    // the "layer" = cells laid within ±150 years across nearby columns
    y0 = b - 150; y1 = b + 150;
    const counts: Record<number, number> = {};
    const bones: Record<number, number> = {};
    let fossils = 0, rare = 0, rareSp = -1, fossilSp = -1, decaySum = 0, decayN = 0;
    for (let xx = Math.max(0, x - 30); xx < Math.min(w.len.length, x + 30); xx++) {
      for (let i = 0; i < w.len[xx]; i++) {
        const jj = xx * CAP + i;
        const bb = w.birth[jj];
        if (bb < y0 || bb > y1) continue;
        const m = w.mat[jj];
        counts[m] = (counts[m] ?? 0) + 1;
        if (w.spec[jj]) { bones[w.spec[jj] - 1] = (bones[w.spec[jj] - 1] ?? 0) + 1; decaySum += w.decay[jj] / 255; decayN++; }
        if (w.flags[jj] & F_FOSSIL) { fossils++; fossilSp = w.spec[jj] - 1; if (w.flags[jj] & F_RARE) { rare++; rareSp = w.spec[jj] - 1; } }
      }
    }
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    data.mat = CFG.materials[w.mat[j]].id;
    data.second = main.length > 1 && main[1][1] > main[0][1] * 0.25 ? CFG.materials[+main[1][0]].id : null;
    data.above = loc.i + 4 < w.len[x] ? CFG.materials[w.mat[x * CAP + Math.min(w.len[x] - 1, loc.i + 6)]].id : null;
    data.below = loc.i - 6 >= 0 ? CFG.materials[w.mat[x * CAP + loc.i - 6]].id : null;
    const topBones = Object.entries(bones).sort((a, b) => b[1] - a[1])[0];
    if (topBones) { data.bones = CFG.species[+topBones[0]]?.id; data.boneCount = topBones[1]; data.decay = decaySum / Math.max(1, decayN); }
    if (rare) data.rare = CFG.species[rareSp]?.id;
    else if (fossils) data.fossil = CFG.species[fossilSp]?.id;
    data.k = w.k[j]; data.P = w.P[j]; data.T = w.T[j];
    data.depth = loc.depth;
    data.water = g.run.targets.some((tz) => tz.kind === 'water' && x >= tz.x0 && x <= tz.x1 && b >= tz.b0 && b <= tz.b1);
    data.heat = g.run.targets.some((tz) => tz.kind !== 'water' && x >= tz.x0 && x <= tz.x1 && b >= tz.b0 && b <= tz.b1);
  } else {
    const pk = w.packs[loc.p];
    y0 = pk.ageMin; y1 = pk.ageMax;
    const list: [number, number][] = [];
    pk.amt.forEach((a, m) => { if (a > 0) list.push([m, a]); });
    list.sort((a, b) => b[1] - a[1]);
    data.pack = true;
    data.n = pk.rows;
    data.mat = CFG.materials[list[0]?.[0] ?? 0].id;
    data.second = list[1] ? CFG.materials[list[1][0]].id : null;
    data.k = pk.k; data.P = pk.P; data.T = pk.T;
    if (pk.finds.length) data.fossil = CFG.species[pk.finds[0].species]?.id;
  }
  const id = `${Math.round(y0 / 100)}:${data.mat}`;
  const entry: ChronicleEntry = { id, y0, y1, data, at: Date.now() };
  const list = g.legacy.chronicle;
  const idx = list.findIndex((e) => e.id === id);
  if (idx >= 0) list.splice(idx, 1);
  list.push(entry);
  while (list.length > 200) list.shift();
  return entry;
}

const matName = (id: string) => t('materials.' + id);
const spName = (id: string) => t('species.' + id + '.name');

export function chronicleText(e: ChronicleEntry): string {
  const d = e.data;
  const parts: string[] = [];
  if (d.pack) parts.push(t('chron.pack', { y0: cd(e.y1), y1: cd(e.y0), n: fmt(d.n, 0) }));
  else parts.push(t('chron.head', { y0: cd(e.y1), y1: cd(e.y0) }));
  parts.push(t('chron.mat', { mat: matName(d.mat) + (d.second ? ', ' + matName(d.second).toLowerCase() : '') }));
  if (d.above && d.above !== d.mat) parts.push(t('chron.under', { mat: matName(d.above).toLowerCase() }));
  if (d.bones) {
    if (d.boneCount >= 6) parts.push(t('chron.massBurial', { s: spName(d.bones).toLowerCase() }));
    else parts.push(t('chron.bones', { s: spName(d.bones).toLowerCase() }));
    const q = d.decay < 0.3 ? 'great' : d.decay < 0.65 ? 'good' : 'poor';
    parts.push(t('chron.preservation.' + q));
  }
  if (d.rare) parts.push(t('chron.rare', { s: spName(d.rare) }));
  else if (d.fossil) parts.push(t('chron.fossil', { s: spName(d.fossil) }));
  if (d.water) parts.push(t('chron.water'));
  if (d.heat) parts.push(t('chron.heat'));
  if (d.k >= 2.5) parts.push(t('chron.pressed', { k: fmt(d.k, 1) }));
  if (d.T >= 45 || d.P >= 10) parts.push(t('chron.deep', { t: fmt(d.T, 0), p: fmt(d.P, 1) }));
  return parts.join(' ');
}
