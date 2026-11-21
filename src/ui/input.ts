// Pointer input on the world canvas: artifact clicks, layer tooltips, chronicle notes, targeting for underground elements.
import { CFG, ElementDef, RULES_BY_MAT } from '../config';
import type { Game } from '../core/game';
import type { Renderer } from '../render/renderer';
import { CAP, F_FOSSIL, F_FRAGMENT } from '../world/World';
import { $, h, setText } from './dom';
import { t, fmt, fmtInt } from './i18n';
import { makeEntry, chronicleText } from './chronicle';

export class Input {
  private tooltip = $('#tooltip');
  private fieldnote = $('#fieldnote');
  private hint = $('#target-hint');
  private canvas = $('#world') as HTMLCanvasElement;
  targeting: ElementDef | null = null;
  scale = 1;
  private noteTimer = 0;
  private mouse: { x: number; y: number } | null = null;
  onArtifact: (shard: number) => void = () => {};
  onCast: () => void = () => {};

  constructor(private g: () => Game, private ren: Renderer) {
    const c = this.canvas;
    c.addEventListener('mousemove', (e) => this.move(e));
    c.addEventListener('mouseleave', () => { this.mouse = null; this.ren.hover = null; this.tooltip.hidden = true; });
    c.addEventListener('mousedown', (e) => { if (e.button === 0) this.down(e); });
    c.addEventListener('contextmenu', (e) => { if (this.targeting) { e.preventDefault(); this.cancelTarget(); } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.cancelTarget(); });
    this.fieldnote.addEventListener('click', () => { this.fieldnote.hidden = true; });
  }

  private world(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 360, y: ((e.clientY - r.top) / r.height) * 640 };
  }

  startTarget(el: ElementDef): void {
    if (!this.g().canCast(el)) return;
    this.targeting = el;
    this.hint.hidden = false;
    setText(this.hint, t('elements.target'));
    this.canvas.classList.add('target');
  }

  cancelTarget(): void {
    this.targeting = null;
    this.ren.targeting = null;
    this.hint.hidden = true;
    this.canvas.classList.remove('target');
  }

  update(dt: number): void {
    if (this.noteTimer > 0) { this.noteTimer -= dt; if (this.noteTimer <= 0) this.fieldnote.hidden = true; }
    if (this.mouse) this.refreshHover();
  }

  private move(e: MouseEvent): void {
    this.mouse = this.world(e);
    this.refreshHover();
  }

  private refreshHover(): void {
    const g = this.g();
    const m = this.mouse!;
    const art = this.ren.isArtifact(m.x, m.y, g);
    this.canvas.classList.toggle('pointer', art >= 0 && !this.targeting);
    const sy = this.ren.sectionY(m.y);
    const x = Math.max(0, Math.min(359, Math.floor(m.x)));
    if (this.targeting) {
      const p = this.targeting.params;
      this.ren.targeting = sy !== null ? { rx: p.radiusX, ry: p.radiusY, x, y: sy, kind: this.targeting.id } : null;
      this.tooltip.hidden = true;
      return;
    }
    if (sy === null || art >= 0) { this.ren.hover = null; this.tooltip.hidden = true; return; }
    this.ren.hover = { x, y: Math.floor(sy) };
    this.showTooltip(g, x, Math.floor(sy), m);
  }

  private showTooltip(g: Game, x: number, sy: number, m: { x: number; y: number }): void {
    const lay = this.ren.lay;
    const w = g.world;
    let v = lay.vOf[sy];
    if (w.fold[x]) v = Math.max(0, v + w.fold[x] * (v / (v + 30)));
    const loc = w.locate(x, v);
    const rows: string[] = [];
    let head = '';
    if (!loc) {
      head = t('materials.basement');
    } else if (loc.kind === 'cell') {
      const j = x * CAP + loc.i;
      const mat = CFG.materials[w.mat[j]];
      head = t('materials.' + mat.id);
      const b = w.birth[j];
      rows.push(t('tip.laid', { y: fmtInt(Math.max(0, CFG.zeroYear - b)) + '⟡' }) + ' · ' + t('tip.depth', { d: fmt(loc.depth, 0) }));
      rows.push(`${t('tip.P', { v: fmt(w.P[j], 2) })} · ${t('tip.T', { v: fmt(w.T[j], 0) })} · ${t('tip.k', { v: fmt(w.k[j], 2) })}`);
      const fl = w.flags[j];
      if (fl & F_FOSSIL) rows.push(t('tip.fossil', { s: t('species.' + CFG.species[w.spec[j] - 1]?.id + '.name') }));
      else if (fl & F_FRAGMENT) rows.push(t('tip.fragment', { s: t('species.' + CFG.species[w.spec[j] - 1]?.id + '.name') }));
      const rule = RULES_BY_MAT[w.mat[j]].find((r) => (!r.world || (r.world === 'hot' && g.mods.hot)) && r.years > 0 && r.yield > 0);
      if (rule && w.prog[j] > 0) rows.push(t('tip.progress', { rock: t('rocks.' + rule.rock), p: fmt(Math.min(99, (w.prog[j] / rule.years) * 100), 0) }));
      for (const tz of g.run.targets) if (x >= tz.x0 && x <= tz.x1 && b >= tz.b0 && b <= tz.b1) rows.push(t(tz.kind === 'water' ? 'tip.water' : 'tip.heat'));
    } else {
      const pk = w.packs[loc.p];
      let best = 0, bm = 0;
      pk.amt.forEach((a, mm) => { if (a > best) { best = a; bm = mm; } });
      head = t('materials.' + CFG.materials[bm].id);
      rows.push(t('tip.pack', { n: fmt(pk.rows, 0), y0: fmtInt(CFG.zeroYear - pk.ageMax), y1: fmtInt(CFG.zeroYear - pk.ageMin) + '⟡' }));
      rows.push(t('tip.depth', { d: fmt(loc.depth, 0) }));
      rows.push(`${t('tip.P', { v: fmt(pk.P, 1) })} · ${t('tip.T', { v: fmt(pk.T, 0) })} · ${t('tip.k', { v: fmt(pk.k, 2) })}`);
    }
    const tip = this.tooltip;
    tip.replaceChildren(h('div', { class: 't-head' }, head), ...rows.map((r) => h('div', { class: 't-row' }, r)), loc ? h('div', { class: 't-hint' }, t('tip.click')) : '');
    tip.hidden = false;
    const tx = m.x > 200 ? m.x - 196 : m.x + 10;
    const ty = Math.min(560, Math.max(60, m.y - 20));
    tip.style.left = Math.max(4, tx) + 'px';
    tip.style.top = ty + 'px';
  }

  private down(e: MouseEvent): void {
    const g = this.g();
    const m = this.world(e);
    const art = this.ren.isArtifact(m.x, m.y, g);
    if (this.targeting) {
      const sy = this.ren.sectionY(m.y);
      if (sy === null) { this.cancelTarget(); return; }
      const x = Math.floor(m.x);
      let v = this.ren.lay.vOf[Math.floor(sy)];
      if (g.cast(this.targeting.id, { x, v })) this.onCast();
      this.cancelTarget();
      return;
    }
    if (art >= 0) { this.onArtifact(art); return; }
    const sy = this.ren.sectionY(m.y);
    if (sy !== null) {
      const x = Math.max(0, Math.min(359, Math.floor(m.x)));
      let v = this.ren.lay.vOf[Math.floor(sy)];
      if (g.world.fold[x]) v = Math.max(0, v + g.world.fold[x] * (v / (v + 30)));
      const entry = makeEntry(g, x, v);
      if (entry) {
        this.fieldnote.replaceChildren(h('b', {}, '✎ '), chronicleText(entry));
        this.fieldnote.hidden = false;
        this.fieldnote.style.top = Math.max(100, Math.min(470, m.y - 60)) + 'px';
        this.noteTimer = 7;
      }
    }
  }
}
