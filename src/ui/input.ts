// Pointer input on the world canvas: artifact clicks, layer labels (museum style), targeting for underground
// elements (the drawer hides, a ghost glow follows the finger, a tap applies, ✕ cancels), tap-on-world closes the drawer.
import { CFG, ElementDef, eraOfYear } from '../config';
import type { Game } from '../core/game';
import type { Renderer } from '../render/renderer';
import { P_FOSSIL, P_FRAGMENT } from '../world/Grid';
import { $, h, setText } from './dom';
import { WW, WH } from '../render/common';
import { t, fmt } from './i18n';
import { fmtCountdown } from './hud';
import { makeEntry, chronicleCard } from './chronicle';
import { rockIcon } from './icons';


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
  /** A tap anywhere in the world: an impulse from the thing. */
  onImpulse: (x: number, y: number) => void = () => {};
  /** The press began (true) or ended (false). */
  onPress: (on: boolean) => void = () => {};
  /** The rare event was tapped. */
  onRare: () => void = () => {};
  /** The burial window marker was tapped. */
  onBurial: () => void = () => {};
  onTargetEnd: () => void = () => {};

  constructor(private g: () => Game, private ren: Renderer) {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      if (this.hold && this.hold.id === e.pointerId) { this.hold.m = this.world(e); return; }
      if (e.pointerType === 'mouse' || e.pointerType === 'pen' || this.targeting) this.move(e);
    });
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e));
    c.addEventListener('pointerleave', () => { this.mouse = null; this.ren.hover = null; this.tooltip.hidden = true; });
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.lastDown = performance.now();
      this.tooltip.hidden = true;
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
    this.updateHold();
    if (this.mouse && !this.finger && !this.hold) this.refreshHover();
  }

  /** when the pointer last went down and last moved: the label waits for a still pointer, not over taps */
  private lastDown = -1e9;
  private lastMove = -1e9;

  private move(e: MouseEvent): void {
    this.mouse = this.world(e);
    this.lastMove = performance.now();
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
    // the museum label only for a pointer resting on the strata, not while tapping: it would cover the pile
    const now = performance.now();
    if (now - this.lastDown < 2000 || now - this.lastMove < 700 || this.ren.geologist) { this.tooltip.hidden = true; return; }
    this.showTooltip(g, x, sy, m);
  }

  /** A small museum label on hover: rock name and era (numbers only in detailed mode). */
  private showTooltip(g: Game, x: number, sy: number, m: { x: number; y: number }): void {
    const loc = this.ren.section.locateAt(g, x, sy);
    const grid = g.grid;
    const detailed = !!g.state.settings.detailed;
    let head = '', icon = '', sub = '';
    const rows: string[] = [];
    if (loc.kind === 'horizon') { head = t('chron.horizon'); sub = fmtCountdown(CFG.zeroYear - CFG.startYear) + '⟡'; }
    else if (loc.kind !== 'particle') { this.tooltip.hidden = true; return; }
    else {
      const j = loc.i;
      const mat = CFG.materials[grid.mat[j]];
      head = t('materials.' + mat.id); icon = mat.id;
      sub = t('era.' + eraOfYear(grid.birth[j]));
      if (detailed) rows.push(t('tip.laid', { y: fmtCountdown(CFG.zeroYear - grid.birth[j]) + '⟡' }) + ' · ' + t('tip.depth', { d: fmt(loc.depth * 2, 0) }));
      const fl = grid.flags[j];
      if (fl & P_FOSSIL) rows.push(t('tip.fossil', { s: t('species.' + CFG.species[grid.spec[j] - 1]?.id + '.name') }));
      else if (fl & P_FRAGMENT) rows.push(t('tip.fragment', { s: t('species.' + CFG.species[grid.spec[j] - 1]?.id + '.name') }));
    }
    const tip = this.tooltip;
    tip.replaceChildren(h('div', { class: 'l-head' }, icon ? rockIcon(icon, 18) : h('span', { class: 'l-sym' }, '⟡'), h('span', {}, head)),
      h('div', { class: 'l-sub' }, sub), ...rows.map((r) => h('div', { class: 'l-sub' }, r)));
    tip.hidden = false;
    const cr = this.canvas.getBoundingClientRect(), ur = $('#ui').getBoundingClientRect();
    const ux = (cr.left + (m.x / WW) * cr.width - ur.left) / this.scale, uy = (cr.top + (m.y / WH) * cr.height - ur.top) / this.scale;
    const tx = ux > 190 ? ux - 176 : ux + 12;
    tip.style.left = Math.max(6, tx) + 'px';
    tip.style.top = Math.min(540, Math.max(110, uy - 24)) + 'px';
  }

  /** Where a pointer is, in UI units (360×640), wherever the world is drawn (it shrinks above the drawer). */
  private uiPt(e: MouseEvent): { x: number; y: number } {
    const u = $('#ui').getBoundingClientRect();
    return { x: (e.clientX - u.left) / this.scale, y: (e.clientY - u.top) / this.scale };
  }

  /** Geologist mode (the lens button): tapping a layer opens the lens on it; tapping off the layers closes it. */
  geologist = false;
  onLens: (x: number, y: number) => void = () => {};
  onLensMiss: () => void = () => {};
  /** A finger (or the mouse) down on the strata: a short tap is an impulse, a hold is a press. */
  private hold: { id: number; t0: number; m: { x: number; y: number }; pressing: boolean } | null = null;

  /** Is (world x, y) on the strata (not the horizon/bedrock)? */
  private onStrata(m: { x: number; y: number }): boolean {
    const sy = this.ren.sectionY(m.y);
    if (sy === null) return false;
    const x = this.col(m.x);
    if (x >= this.ren.section.SW) return false;          // the era ruler's strip
    return sy >= this.ren.section.topD[x] && sy < this.ren.section.horizonTop[x];
  }

  private down(e: PointerEvent): void {
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
    // a rare event takes the tap
    if (g.rare && this.ren.rareHit(g, m.x, m.y, this.finger ? 1.6 : 1)) { this.onRare(); return; }
    // the burial window marker opens the Elements (flood, volcano)
    if (this.ren.burialHit(g, m.x, m.y)) { this.onBurial(); return; }
    // Geologist: a tap on a layer opens the lens there; a tap off the layers closes it
    if (this.geologist) {
      const sy = this.ren.sectionY(m.y);
      if (this.onStrata(m) && sy !== null && sy < this.ren.section.cut) this.onLens(this.col(m.x) + 0.5, sy);
      else this.onLensMiss();
      return;
    }
    // on the strata: wait — a hold becomes a press, a short tap an impulse
    if (g.state.phase === 'play' && this.onStrata(m)) {
      this.hold = { id: e.pointerId, t0: performance.now(), m, pressing: false };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not all pointers can be captured */ }
      return;
    }
    // anywhere else in the world: an impulse
    this.onImpulse(m.x, m.y);
  }

  private up(e: PointerEvent): void {
    const h0 = this.hold;
    if (!h0 || h0.id !== e.pointerId) return;
    this.hold = null;
    if (h0.pressing) this.endPress();
    else this.onImpulse(h0.m.x, h0.m.y);
  }

  private endPress(): void {
    this.g().run.press = null;
    this.ren.press = null;
    this.onPress(false);
  }

  /** While the finger holds: start the press after the hold time, then follow the finger. */
  private updateHold(): void {
    const h0 = this.hold;
    if (!h0) return;
    const g = this.g();
    if (g.state.phase !== 'play') { this.hold = null; if (h0.pressing) this.endPress(); return; }
    if (!h0.pressing && performance.now() - h0.t0 >= CFG.B.press.holdMs) { h0.pressing = true; this.onPress(true); this.tooltip.hidden = true; }
    if (!h0.pressing) return;
    const sec = this.ren.section;
    const x = this.col(h0.m.x);
    const sy = Math.max(sec.topD[x], Math.min(sec.horizonTop[x] - 1, h0.m.y - this.ren.lay.sectionTop));
    const R = CFG.B.press.radius + g.stats.pressRadius;
    // a circle of the strata under the finger (grid cells: one particle = 2 world px)
    const prev = g.run.press;
    g.run.press = { x: Math.floor(x / 2), y: Math.floor((sy + CFG.B.layout.sectionTop) / 2), r: R / 2, power: prev ? prev.power : 1 + g.stats.pressPower };
    this.ren.press = { x, y: this.ren.lay.sectionTop + sy, r: R, t0: h0.t0, power: g.run.press.power };
  }

  private showCard(g: Game, m: { x: number; y: number }, u: { x: number; y: number }, detailed: boolean): void {
    const sy = this.ren.sectionY(m.y);
    if (sy === null) return;
    const x = this.col(m.x);
    const entry = makeEntry(g, x, this.ren.section.locateAt(g, x, sy));
    if (!entry) { this.fieldnote.hidden = true; return; }
    this.fieldnote.replaceChildren(chronicleCard(entry, detailed || !!g.state.settings.detailed));
    this.fieldnote.hidden = false;
    this.fieldnote.style.top = Math.max(150, Math.min(420, u.y - 70)) + 'px';
    this.noteTimer = 8;
  }
}
