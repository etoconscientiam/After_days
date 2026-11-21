// Chronicle of layers: a dry data card per clicked layer — years (countdown), depth, composition in %,
// P, T, k, finds as icons without captions, and short template tags. No narrator, no "I", no judgements.
import { CFG, eraOfYear } from '../config';
import type { Game } from '../core/game';
import type { ChronicleEntry } from '../core/state';
import { CAP, F_FOSSIL, F_RARE, F_FAST } from '../world/World';
import { t, fmtInt, fmt } from './i18n';
import { h, fossilIcon, matSwatch } from './dom';

const cd = (year: number) => fmtInt(Math.max(0, CFG.zeroYear - year));

function composition(counts: Map<number, number>): [string, number][] {
  let tot = 0;
  counts.forEach((v) => (tot += v));
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => [CFG.materials[m].id, (v / tot) * 100] as [string, number]);
  const top = list.slice(0, 4);
  const rest = list.slice(4).reduce((a, b) => a + b[1], 0);
  if (rest >= 1) top.push(['other', rest]);
  return top.filter((x) => x[1] >= 1);
}

/** Inspect what lies at (x, visual depth v) and record an entry. horizon = the click hit the technogenic horizon. */
export function makeEntry(g: Game, x: number, v: number, horizon = false): ChronicleEntry | null {
  const w = g.world;
  const data: Record<string, any> = { tags: [] as string[], finds: [] as { s: string; rare: boolean }[] };
  let y0: number, y1: number;
  if (horizon) {
    y0 = CFG.startYear - 20; y1 = CFG.startYear;
    data.comp = Object.entries(CFG.story.horizon.mix).map(([k, v2]) => [k, (v2 as number) * 100]);
    data.depth = w.columnRows(x) + g.meta.foundation;
    data.P = null; data.T = null; data.k = 1;
    data.horizon = true;
  } else {
    const loc = w.locate(x, v);
    if (!loc) return null;
    if (loc.kind === 'cell') {
      const j = x * CAP + loc.i;
      const b = w.birth[j];
      y0 = b - 150; y1 = b + 150;
      const counts = new Map<number, number>();
      const bones = new Map<number, number>();
      let decaySum = 0, decayN = 0, fast = 0;
      for (let xx = Math.max(0, x - 15); xx < Math.min(w.len.length, x + 15); xx++) {
        for (let i = 0; i < w.len[xx]; i++) {
          const jj = xx * CAP + i;
          const bb = w.birth[jj];
          if (bb < y0 || bb > y1) continue;
          const m = w.mat[jj];
          counts.set(m, (counts.get(m) ?? 0) + 1);
          if (w.spec[jj]) { bones.set(w.spec[jj] - 1, (bones.get(w.spec[jj] - 1) ?? 0) + 1); decaySum += w.decay[jj] / 255; decayN++; }
          if (w.flags[jj] & F_FAST) fast++;
          if ((w.flags[jj] & F_FOSSIL) && data.finds.length < 6) data.finds.push({ s: CFG.species[w.spec[jj] - 1]?.id, rare: !!(w.flags[jj] & F_RARE) });
        }
      }
      data.comp = composition(counts);
      const tags: string[] = data.tags;
      const has = (id: string) => counts.has(CFG.matIndex[id]);
      if (has('ash')) tags.push('ash');
      if (has('meteor') || has('iridium')) tags.push('impact');
      if (has('moraine')) tags.push('glacial');
      if (fast > 0) tags.push('rapidBurial');
      let boneTotal = 0;
      bones.forEach((n) => (boneTotal += n));
      if (boneTotal >= 6) tags.push('massBurial');
      if (decayN) { const d = decaySum / decayN; tags.push(d < 0.3 ? 'presHigh' : d < 0.65 ? 'presMid' : 'presLow'); }
      if (g.run.targets.some((tz) => tz.kind === 'water' && x >= tz.x0 && x <= tz.x1 && b >= tz.b0 && b <= tz.b1)) tags.push('groundwater');
      if (g.run.targets.some((tz) => tz.kind !== 'water' && x >= tz.x0 && x <= tz.x1 && b >= tz.b0 && b <= tz.b1)) tags.push('heated');
      if (w.k[j] >= 2.5) tags.push('compacted');
      data.k = w.k[j]; data.P = w.P[j]; data.T = w.T[j];
      data.depth = loc.depth;
    } else {
      const pk = w.packs[loc.p];
      y0 = pk.ageMin; y1 = pk.ageMax;
      const counts = new Map<number, number>();
      pk.amt.forEach((a, m) => { if (a > 0.05) counts.set(m, a); });
      data.comp = composition(counts);
      data.k = pk.k; data.P = pk.P; data.T = pk.T;
      data.depth = loc.depth;
      for (const f of pk.finds.slice(0, 6)) data.finds.push({ s: CFG.species[f.species]?.id, rare: f.rare });
      if (pk.k >= 2.5) data.tags.push('compacted');
    }
  }
  const id = horizon ? 'horizon' : `${Math.round(y0 / 100)}:${data.comp[0]?.[0]}`;
  const entry: ChronicleEntry = { id, y0, y1, data, at: Date.now() };
  const list = g.legacy.chronicle;
  const idx = list.findIndex((e) => e.id === id);
  if (idx >= 0) list.splice(idx, 1);
  list.push(entry);
  while (list.length > 200) list.shift();
  return entry;
}

const matName = (id: string) => (id === 'other' ? t('chron.other') : t('materials.' + id));

/** The data card as DOM. */
export function chronicleCard(e: ChronicleEntry, detailed = false): HTMLElement {
  const d = e.data;
  if (!detailed) {
    const main = (d.comp as [string, number][])[0]?.[0] ?? 'soil';
    const era = d.horizon ? '⟡' : t('era.' + eraOfYear((e.y0 + e.y1) / 2));
    const rows2: (HTMLElement | string)[] = [
      h('div', { class: 'cc-head' }, h('b', {}, matSwatch(main), matName(main)), h('span', {}, era)),
      h('div', { class: 'cc-bar' }, ...(d.comp as [string, number][]).filter(([m]) => m !== 'other').map(([m, p]) => h('i', { style: `flex:${p};background:${CFG.materials.find((mm) => mm.id === m)?.palette[2] ?? '#555'}`, title: matName(m) }))),
    ];
    if (d.tags?.length) rows2.push(h('div', { class: 'cc-tags' }, (d.tags as string[]).filter((tg) => !tg.startsWith('pres') && tg !== 'compacted').map((tg) => t('chron.tag.' + tg)).join(' ')));
    if (d.finds?.length) rows2.push(h('div', { class: 'cc-finds' }, ...(d.finds as { s: string; rare: boolean }[]).map((f) => fossilIcon(f.s, f.rare, true))));
    return h('div', { class: 'chron-card' }, ...rows2);
  }
  const head = d.horizon ? `${cd(e.y1)}⟡` : `${cd(e.y1)}–${cd(e.y0)}⟡`;
  const rows: (HTMLElement | string)[] = [
    h('div', { class: 'cc-head' }, head, h('span', {}, t('tip.depth', { d: fmt(d.depth ?? 0, 0) }))),
    h('div', { class: 'cc-comp' }, ...(d.comp as [string, number][]).map(([m, p]) => h('span', {}, `${matName(m)} ${fmt(p, 0)}%`))),
  ];
  const phys: string[] = [];
  if (d.P !== null && d.P !== undefined) phys.push(t('tip.P', { v: fmt(d.P, 1) }));
  if (d.T !== null && d.T !== undefined) phys.push(t('tip.T', { v: fmt(d.T, 0) }));
  phys.push(t('tip.k', { v: fmt(d.k ?? 1, 2) }));
  rows.push(h('div', { class: 'cc-phys' }, phys.join(' · ')));
  if (d.tags?.length) rows.push(h('div', { class: 'cc-tags' }, (d.tags as string[]).map((tg) => t('chron.tag.' + tg)).join(' ')));
  if (d.finds?.length) rows.push(h('div', { class: 'cc-finds' }, ...(d.finds as { s: string; rare: boolean }[]).map((f) => fossilIcon(f.s, f.rare, true))));
  return h('div', { class: 'chron-card' }, ...rows);
}
