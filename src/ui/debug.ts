// Cheats and debugging: the beetle button at the top left opens a panel over the world.
// Time (speed, pause, frozen sky), resources, life, epochs, elements, and live counters.
// The panel closes on a tap outside it (like every pop-up); ` or ~ toggles it from the keyboard.
import { CFG } from '../config';
import type { Game } from '../core/game';
import type { Renderer } from '../render/renderer';
import { $, h, setText, toggle } from './dom';
import { t, fmt, fmtInt } from './i18n';
import { bugPixel, ROMAN } from './pixelIcons';

export class DevPanel {
  el = $('#dev');
  btn = $('#dbg-btn') as HTMLButtonElement;
  timeScale = 1;
  noCooldown = false;
  skyFrozen = false;
  private info: HTMLElement;
  private fps = 60;
  private infoAge = 9;
  private speedBtns: HTMLElement[] = [];
  private flags: { el: HTMLElement; on: () => boolean }[] = [];

  constructor(private g: () => Game, private ren: Renderer, private onReset: () => void) {
    this.btn.append(bugPixel(18));
    this.btn.title = t('dev.title');
    this.btn.setAttribute('aria-label', t('dev.title'));
    this.btn.addEventListener('click', () => this.toggle());
    this.info = h('div', { class: 'dv-info' });
    this.build();
  }

  /** (Re)build the panel: on start and when the language changes. */
  build(): void {
    this.speedBtns = [];
    this.flags = [];
    this.btn.title = t('dev.title');
    const btn = (label: string, f: () => void, cls = '') => h('button', { class: 'dv-b ' + cls, onclick: () => { f(); this.refresh(); } }, label);
    const flag = (label: string, on: () => boolean, set: (v: boolean) => void) => {
      const b = h('button', { class: 'dv-b flag', onclick: () => { set(!on()); this.refresh(); } }, label);
      this.flags.push({ el: b, on });
      return b;
    };
    const sec = (title: string, ...rows: HTMLElement[]) => h('div', { class: 'dv-sec' }, h('div', { class: 'dv-t' }, title), ...rows);
    const row = (...k: HTMLElement[]) => h('div', { class: 'dv-row' }, ...k);

    // time
    const speeds = [0, 1, 5, 20, 100];
    this.speedBtns = speeds.map((s) => h('button', { class: 'dv-b seg', 'data-s': String(s), onclick: () => { this.timeScale = s; this.refresh(); } }, s === 0 ? '❚❚' : '×' + s));
    // epochs
    const eraSel = h('select', { class: 'dv-sel' }, ...CFG.eras.map((e) => h('option', { value: String(e.id) }, `${ROMAN[e.id] ?? e.id} · ${t('era.' + e.id)}`))) as HTMLSelectElement;
    const elSel = h('select', { class: 'dv-sel' }, ...CFG.elements.map((e) => h('option', { value: e.id }, t('elements.' + e.id + '.name')))) as HTMLSelectElement;

    this.el.replaceChildren(
      h('div', { class: 'dv-head' }, bugPixel(16), h('b', {}, t('dev.title')), h('button', { class: 'dv-x', 'aria-label': '✕', onclick: () => this.toggle(false) }, '✕')),
      this.info,
      sec(t('dev.time'), row(...this.speedBtns), row(flag(t('dev.skyStop'), () => this.skyFrozen, (v) => (this.skyFrozen = v)))),
      sec(t('dev.resources'),
        row(btn(t('dev.energy10m'), () => { const g = this.g(); g.run.energy += Math.max(1000, g.incomePerSec(false) * 600); }),
          btn('+1e9 ✦', () => { this.g().run.energy += 1e9; })),
        row(flag(t('dev.infEnergy'), () => this.g().cheats.infiniteEnergy, (v) => (this.g().cheats.infiniteEnergy = v))),
        row(btn(t('dev.rocks'), () => { const g = this.g(); for (const id of CFG.B.sand.specials.order) g.addSpecial(id, 200 * g.specialUnit(id)); }),
          btn(t('dev.density'), () => { this.g().meta.density += 10; }))),
      sec(t('dev.life'),
        row(btn(t('dev.oxygen'), () => { this.g().run.oxygen = CFG.B.oxygen.max; }),
          flag(t('dev.capacity'), () => this.g().cheats.capMul > 1, (v) => { const g = this.g(); g.cheats.capMul = v ? 3 : 1; g.statsDirty = true; }))),
      sec(t('dev.epochs'),
        row(btn(t('dev.nextEra'), () => { const g = this.g(); if (g.run.era < 7) this.jumpEra(g.run.era + 1); })),
        row(eraSel, btn(t('dev.go'), () => this.jumpEra(+eraSel.value))),
        row(btn(t('dev.prestige'), () => { const g = this.g(); g.run.compactMass = Math.max(g.run.compactMass, CFG.B.prestige.divisor * 30); g.prestige(); this.toggle(false); }),
          btn(t('dev.excavate'), () => { const r = this.g().run; r.excavation = r.excavationNeed + 1; r.excavationShards = [1e9, 1e9, 1e9]; }))),
      sec(t('dev.elements'),
        row(flag(t('dev.cooldowns'), () => this.noCooldown, (v) => (this.noCooldown = v)), flag(t('dev.free'), () => this.g().cheats.freeElements, (v) => (this.g().cheats.freeElements = v))),
        row(elSel, btn(t('dev.cast'), () => {
          const g = this.g();
          const el = CFG.elements.find((e) => e.id === elSel.value)!;
          g.run.cooldowns[el.id] = 0;
          g.run.energy += g.elementCost(el);
          const s = this.ren.section;
          g.cast(el.id, el.kind === 'section' ? { x: 90, v: s.vOfY(s.strataH * 0.5), ...this.birthMid() } : undefined);
        }))),
      sec(t('dev.save'), row(btn(t('dev.reset'), () => { if (confirm(t('dev.resetAsk'))) this.onReset(); }, 'danger'))),
    );
    this.refresh();
  }

  private birthMid(): { b0: number; b1: number } {
    const s = this.ren.section;
    const [b0, b1] = s.birthRange(s.strataH * 0.4, s.strataH * 0.6);
    return { b0, b1 };
  }

  private refresh(): void {
    for (const b of this.speedBtns) toggle(b, 'on', +b.dataset.s! === this.timeScale);
    for (const f of this.flags) toggle(f.el, 'on', f.on());
    toggle(this.btn, 'on', !this.el.hidden);
    toggle(this.btn, 'fast', this.timeScale !== 1 || this.skyFrozen);
  }

  /** Fill the bare world with old ground up to its relief (tests, a quick look at a filled section). */
  fillStrata(): void {
    const g = this.g();
    g.prefill();
    g.updateWater();
  }

  jumpEra(era: number): void {
    const g = this.g();
    const r = g.run;
    if (era <= r.era) return;
    const before = r.year;
    while (r.era < era) {
      r.year = Math.max(r.year, CFG.eras[r.era].end);
      g.enterEra(r.era + 1);
    }
    if (era >= 2) r.oxygen = Math.max(r.oxygen, 20);
    r.year = Math.max(r.year, CFG.eras[era].start);
    r.clock += r.year - before;
  }

  toggle(on = this.el.hidden): void {
    this.el.hidden = !on;
    this.infoAge = 9;
    this.refresh();
  }

  update(dt: number): void {
    const g = this.g();
    if (this.noCooldown) for (const k in g.run.cooldowns) g.run.cooldowns[k] = 0;
    if (g.cheats.infiniteEnergy && g.run.energy < 1e15) g.run.energy = 1e15;
    this.ren.skyFrozen = this.skyFrozen;
    this.fps = this.fps * 0.95 + (1 / Math.max(1e-3, dt)) * 0.05;
    if (this.el.hidden || (this.infoAge += dt) < 0.25) return;
    this.infoAge = 0;
    const r = g.run;
    const wall = r.year >= g.eraDef().end - 1e-6 && !g.eraConditionMet();
    setText(this.info, [
      `fps ${this.fps.toFixed(0)} · ×${this.timeScale}${this.skyFrozen ? ' · sky ❚❚' : ''}`,
      `${t('dev.year')} ${fmtInt(r.year)}${wall ? ' ⏸' : ''} · ${t('dev.clock')} ${fmtInt(r.clock)}`,
      `${t('dev.era')} ${ROMAN[r.era]} · ${fmt(g.yps(), 1)} ${t('dev.yps')} · O₂ ${r.oxygen.toFixed(1)}%`,
      `${t('dev.zones')} ${[0, 1, 2].map((z) => `${fmt(g.used(z), 0)}/${g.capacity(z)}`).join(' · ')}`,
      `${t('dev.cells')} ${fmtInt(g.grid.particles())} · ${t('dev.packs')} ${g.archive.layers.length} · ${t('dev.layers')} ${fmtInt(r.sink.rows)}`,
      `${t('dev.phys')} ${g.physMs.toFixed(2)} ms · ${t('dev.awake')} ${g.grid.awakeBlocks()}/${g.grid.awake.length} · ${t('dev.moving')} ${g.moving}`,
      `${t('dev.mass')} ${fmt(r.compactMass)} · ${t('dev.foundation')} ${g.meta.foundation.toFixed(1)}`,
    ].join('\n'));
  }
}
