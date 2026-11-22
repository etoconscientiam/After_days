// Pointer input on the world canvas: artifact clicks, layer labels (museum style), targeting for underground
// elements (the drawer hides, a ghost glow follows the finger, a tap applies, ✕ cancels), tap-on-world closes the drawer.
import { CFG, ElementDef, eraOfYear } from '../config';
import type { Game } from '../core/game';
import type { Renderer } from '../render/renderer';
import { CAP, F_FOSSIL, F_FRAGMENT } from '../world/World';
import { $, h, setText } from './dom';
import { WW, WH } from '../render/common';
import { t, fmt } from './i18n';
import { fmtCountdown } from './hud';
import { makeEntry, chronicleCard } from './chronicle';
import { rockIcon } from './icons';

/** UI units (360×640) per canvas pixel. */
const UI = 360 / WW;

export class Input {
  private tooltip = $('#tooltip');
  private fieldnote = $('#fieldnote');
  private bar = $('#target-bar');
  private canvas = $('#world') as HTMLCanvasElement;
  targeting: ElementDef | null = null;
  /** Last input was a finger: bigger hit areas, no hover. */
  finger = false;
  scale = 1;
  private noteTimer = 0;
  private mouse: { x: number; y: number } | null = null;
  onArtifact: (shard: number) => void = () => {};
  onCast: (x: number, y: number) => void = () => {};
  onChoose: (index: number) => void = () => {};
  /** Returns true when a tap on the world only closed the drawer. */
  onWorldTap: () => boolean = () => false;
  onTargetEnd: () => void = () => {};

  constructor(private g: () => Game, private ren: Renderer) {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen' || this.targeting) this.move(e);
    });
    c.addEventListener('pointerleave', () => { this.mouse = null; this.ren.hover = null; this.tooltip.hidden = true; });
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.finger = e.pointerType === 'touch';
      e.preventDefault();
      this.down(e);
    });
    c.addEventListener('contextmenu', (e) => { if (this.targeting) { e.preventDefault(); this.cancelTarget(); } });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.cancelTarget(); });
    this.fieldnote.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.l-toggle')) this.fieldnote.hidden = true; });
    $('#target-cancel').addEventListener('click', () => this.cancelTarget());
  }

  private world(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * WW, y: ((e.clientY - r.top) / r.height) * WH };
  }

  startTarget(el: ElementDef): void {
    if (!this.g().canCast(el)) return;
    this.targeting = el;
    this.bar.hidden = false;
    setText($('#target-text'), t('elements.' + el.id + '.name') + ' · ' + t('elements.tapLayers'));
    this.canvas.classList.add('target');
    this.fieldnote.hidden = true;
  }

  cancelTarget(): void {
    if (!this.targeting) return;
    this.targeting = null;
    this.ren.targeting = null;
    this.bar.hidden = true;
    this.canvas.classList.remove('target');
    this.onTargetEnd();
  }

  update(dt: number): void {
    if (this.noteTimer > 0) { this.noteTimer -= dt; if (this.noteTimer <= 0) this.fieldnote.hidden = true; }
    if (this.mouse && !this.finger) this.refreshHover();
  }

  private move(e: MouseEvent): void {
    this.mouse = this.world(e);
    this.refreshHover();
  }

  private chooseIndex(g: Game, m: { x: number; y: number }): number {
    const xs = this.ren.chooseXs(g.availableItems().length);
    for (let i = 0; i < xs.length; i++) if (Math.abs(m.x - xs[i]) < 22 && Math.abs(m.y - 160) < 26) return i;
    return -1;
  }

  private col(x: number): number { return Math.max(0, Math.min(WW - 1, Math.floor(x))); }

  private placeTarget(m: { x: number; y: number }): void {
    const sy = this.ren.sectionY(m.y);
    const p = this.targeting!.params;
    // only the strata take a target; snap into them
    const y = sy === null ? null : Math.min(Math.max(2, sy), Math.max(2, this.ren.section.strataH - 2));
    this.ren.targeting = y !== null ? { rx: p.radiusX, ry: p.radiusY, x: this.col(m.x), y, kind: this.targeting!.id } : null;
  }

  private refreshHover(): void {
    const g = this.g();
    const m = this.mouse!;
    if (g.state.phase === 'choose') {
      this.ren.chooseHover = this.chooseIndex(g, m);
      this.canvas.classList.toggle('pointer', this.ren.chooseHover >= 0);
      this.tooltip.hidden = true;
      return;
    }
    if (this.targeting) { this.placeTarget(m); this.tooltip.hidden = true; return; }
    const art = this.ren.isArtifact(m.x, m.y, g);
    this.canvas.classList.toggle('pointer', art >= 0);
    const sy = this.ren.sectionY(m.y);
    if (sy === null || art >= 0 || g.state.phase !== 'play') { this.ren.hover = null; this.tooltip.hidden = true; return; }
    const x = this.col(m.x);
    this.ren.hover = { x, y: Math.floor(sy) };
    this.showTooltip(g, x, sy, m);
  }

  /** A small museum label on hover: rock name and era (numbers only in detailed mode). */
  private showTooltip(g: Game, x: number, sy: number, m: { x: number; y: number }): void {
    const loc = this.ren.section.locateAt(g, x, sy);
    const w = g.world;
    const detailed = !!g.state.settings.detailed;
    let head = '', icon = '', sub = '';
    const rows: string[] = [];
    if (loc.kind === 'horizon') { head = t('chron.horizon'); sub = fmtCountdown(CFG.zeroYear - CFG.startYear) + '⟡'; }
    else if (loc.kind === 'bedrock' || loc.kind === 'foundation') { this.tooltip.hidden = true; return; }
    else if (loc.kind === 'cell') {
      const j = x * CAP + loc.i;
      const mat = CFG.materials[w.mat[j]];
      head = t('materials.' + mat.id); icon = mat.id;
      sub = t('era.' + eraOfYear(w.birth[j]));
      if (detailed) rows.push(t('tip.laid', { y: fmtCountdown(CFG.zeroYear - w.birth[j]) + '⟡' }) + ' · ' + t('tip.depth', { d: fmt(loc.depth, 0) }));
      const fl = w.flags[j];
      if (fl & F_FOSSIL) rows.push(t('tip.fossil', { s: t('species.' + CFG.species[w.spec[j] - 1]?.id + '.name') }));
      else if (fl & F_FRAGMENT) rows.push(t('tip.fragment', { s: t('species.' + CFG.species[w.spec[j] - 1]?.id + '.name') }));
    } else {
      const pk = w.packs[loc.p];
      let best = 0, bm = 0;
      pk.amt.forEach((a, mm) => { if (a > best) { best = a; bm = mm; } });
      head = t('materials.' + CFG.materials[bm].id); icon = CFG.materials[bm].id;
      sub = t('era.' + eraOfYear((pk.ageMin + pk.ageMax) / 2));
      if (detailed) rows.push(t('tip.pack', { n: fmt(pk.rows, 0), y0: fmtCountdown(CFG.zeroYear - pk.ageMax), y1: fmtCountdown(CFG.zeroYear - pk.ageMin) + '⟡' }));
    }
    const tip = this.tooltip;
    tip.replaceChildren(h('div', { class: 'l-head' }, icon ? rockIcon(icon, 18) : h('span', { class: 'l-sym' }, '⟡'), h('span', {}, head)),
      h('div', { class: 'l-sub' }, sub), ...rows.map((r) => h('div', { class: 'l-sub' }, r)));
    tip.hidden = false;
    const tx = m.x * UI > 190 ? m.x * UI - 176 : m.x * UI + 12;
    tip.style.left = Math.max(6, tx) + 'px';
    tip.style.top = Math.min(540, Math.max(110, m.y * UI - 24)) + 'px';
  }

  private down(e: MouseEvent): void {
    const g = this.g();
    const m = this.world(e);
    if (g.state.phase === 'choose') {
      const i = this.chooseIndex(g, m);
      if (i >= 0) this.onChoose(i);
      return;
    }
    if (g.state.phase !== 'play' && g.state.phase !== 'temple') return;
    if (this.targeting) {
      this.placeTarget(m);
      const tg = this.ren.targeting;
      if (!tg) { if (m.y < this.ren.lay.sectionTop - 4) this.cancelTarget(); return; }
      const half = Math.max(2, tg.ry * 0.6);
      const [b0, b1] = this.ren.section.birthRange(tg.y - half, tg.y + half, tg.x);
      const v = this.ren.section.vOfY(tg.y);
      if (g.cast(this.targeting.id, { x: tg.x, v, b0, b1 })) this.onCast(tg.x, this.ren.lay.sectionTop + tg.y);
      this.cancelTarget();
      return;
    }
    const art = this.ren.isArtifact(m.x, m.y, g, this.finger ? 1.7 : 1);
    if (art >= 0) { this.onArtifact(art); return; }
    if (this.onWorldTap()) return;
    const sy = this.ren.sectionY(m.y);
    if (sy === null) { this.fieldnote.hidden = true; return; }
    const x = this.col(m.x);
    const entry = makeEntry(g, x, this.ren.section.locateAt(g, x, sy));
    if (!entry) { this.fieldnote.hidden = true; return; }
    this.fieldnote.replaceChildren(chronicleCard(entry, !!g.state.settings.detailed));
    this.fieldnote.hidden = false;
    this.fieldnote.style.top = Math.max(150, Math.min(420, m.y * UI - 70)) + 'px';
    this.noteTimer = 8;
  }
}
