// Overlays without dialogs: ritual slabs, the return-from-away summary (after a short timelapse),
// "1 year from the Finding" + New world, the end text, an exhibit view. Plus the developer panel.
import { CFG } from '../config';
import type { Game } from '../core/game';
import type { OfflineReport } from '../core/offline';
import { $, h, setText } from './dom';
import { t, fmt, fmtInt } from './i18n';
import { assetUrl } from '../render/assets';
import { drawScene, VW, VH } from '../render/ritual';
import { energyIcon, rockIcon, exhibit } from './icons';

export class Modals {
  overlay = $('#overlay');
  private finaleShown: string | null = null;
  private scenes: { cv: HTMLCanvasElement; ritual: string; src: HTMLCanvasElement }[] = [];
  private tt = 0;
  onNewWorld: () => void = () => {};

  constructor(private g: () => Game) {
    // a tap on the free space around a card closes it (the finale choices stay: they are the game's own step)
    this.overlay.addEventListener('click', (e) => {
      const kind = this.overlay.dataset.kind ?? '';
      if (e.target === this.overlay && !kind.startsWith('finale')) this.close();
    });
  }

  get isOpen(): boolean { return this.overlay.classList.contains('show'); }

  close(): void {
    this.overlay.classList.remove('show', 'dim');
    this.overlay.replaceChildren();
    this.overlay.dataset.kind = '';
    this.scenes = [];
  }

  private show(kind: string, dim: boolean, ...nodes: HTMLElement[]): void {
    this.overlay.replaceChildren(...nodes);
    this.overlay.dataset.kind = kind;
    this.overlay.classList.add('show');
    this.overlay.classList.toggle('dim', dim);
  }

  /** "While you were away, 4 200 years passed" — a museum label with what grew. */
  away(rep: OfflineReport): void {
    const rocks = Object.entries(rep.rocks).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const card = h('div', { class: 'summary label' },
      h('div', { class: 'big' }, t('away.title') + ', ' + t('away.passed', { v: fmtInt(rep.years) })),
      h('div', { class: 'rows' },
        h('div', {}, energyIcon(16), '+' + fmt(rep.energy)),
        rep.layers ? h('div', {}, t('away.layers', { v: fmtInt(rep.layers) })) : null,
        ...rocks.map(([k, v]) => h('div', {}, rockIcon(k, 16), `${t('rocks.' + k)} +${fmt(v, 0)}`)),
        rep.fossils ? h('div', {}, t('away.fossils', { v: rep.fossils })) : null,
        rep.notes.length ? h('div', {}, t('away.notes', { v: rep.notes.length })) : null),
      h('button', { class: 'stone-btn', onclick: () => this.close() }, t('btn.continue')));
    this.show('away', true, card);
  }

  /** A find, enlarged, with its bonus. Tap anywhere to close. */
  exhibitView(kind: 'fossil' | 'relic', id: string): void {
    const g = this.g();
    const rare = kind === 'fossil' && (g.legacy.museum[id]?.rare ?? 0) > 0;
    const bonus = kind === 'relic' ? t('book.bonusRelic') : rare ? t('book.bonusFossil') + '; ' + t('book.bonusRare') : t('book.bonusFossil');
    const view = h('div', { class: 'exhibit-view' }, h('div', { class: 'case' }, exhibit(kind, id, rare, 6)), h('div', { class: 'label' }, h('div', { class: 'l-sub' }, bonus)));
    view.addEventListener('click', () => this.close());
    this.show('exhibit', true, view);
  }

  private slabArt(ritual: string): HTMLElement {
    const url = assetUrl(`ui/ritual_${ritual}.png`);
    if (url) return h('img', { src: url, alt: '' });
    const src = document.createElement('canvas');
    src.width = VW; src.height = VH;
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 90;
    this.scenes.push({ cv, ritual, src });
    return cv;
  }

  /** Called every frame: finale overlays for the current phase, and the living ritual previews. */
  update(dt: number): void {
    const g = this.g();
    this.tt += dt;
    for (const s of this.scenes) {
      const c = s.src.getContext('2d')!;
      drawScene(c, s.ritual, 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(this.tt * 0.4)), this.tt, g.legacy.items[g.legacy.items.length - 1] ?? 'artifact_a');
      const d = s.cv.getContext('2d')!;
      d.imageSmoothingEnabled = false;
      d.clearRect(0, 0, 64, 90);
      d.drawImage(s.src, (VW - 64) / 2, 0, 64, VH, 0, 0, 64, 90);
    }
    const ph = g.state.phase;
    const key = ph + ':' + g.legacy.rituals.length + ':' + g.state.settings.lang;
    if (ph === 'play' || ph === 'temple' || ph === 'choose') {
      if (this.finaleShown && this.finaleShown !== 'none' && this.overlay.dataset.kind?.startsWith('finale')) this.close();
      this.finaleShown = null;
      return;
    }
    if (this.finaleShown === key) return;
    this.finaleShown = key;
    if (ph === 'finale') {
      this.scenes = [];
      const avail = CFG.rituals.filter((r) => !g.legacy.rituals.includes(r.id));
      const slabs = h('div', { class: 'slabs' }, ...avail.map((r) => h('button', { class: 'slab', 'aria-label': t('ritual.' + r.id + '.name'), onclick: () => { g.chooseRitual(r.id); this.close(); this.finaleShown = 'none'; } },
        h('div', { class: 'art' }, this.slabArt(r.id)), h('b', {}, t('ritual.' + r.id + '.name')))));
      this.show('finale', false, h('div', { class: 'overlay-q' }, t('finale.choose')), slabs);
    } else if (ph === 'newWorld') {
      this.show('finale-new', false, h('button', { class: 'stone-btn big center-cta', onclick: () => { this.close(); this.onNewWorld(); } }, t('btn.newWorld')));
    } else if (ph === 'end') {
      const L = g.legacy;
      this.show('finale-end', false, h('div', { class: 'end-text' }, t('finale.end'), h('small', {}, t('finale.endStats', { w: L.playthrough, f: L.fossils, p: L.totalPrestiges }))));
    }
  }
}

/** Developer panel: FPS, counters, time ×10/×100, resources, era jump, free elements, reset. */
export class DevPanel {
  el = $('#dev');
  private info: HTMLElement;
  timeScale = 1;
  noCooldown = false;
  private fps = 60;

  constructor(private g: () => Game, private onReset: () => void) {
    this.info = h('div', { class: 'dv' });
    const btn = (label: string, f: () => void) => h('button', { onclick: f }, label);
    const eraSel = h('select', {}, ...CFG.eras.map((e) => h('option', { value: String(e.id) }, `${e.id} ${e.key}`))) as HTMLSelectElement;
    const elSel = h('select', {}, ...CFG.elements.map((e) => h('option', { value: e.id }, e.id))) as HTMLSelectElement;
    this.el.append(
      h('div', {}, t('dev.title')), this.info,
      h('div', {}, t('dev.speed'), btn('1', () => (this.timeScale = 1)), btn('10', () => (this.timeScale = 10)), btn('100', () => (this.timeScale = 100))),
      h('div', {}, btn('+E', () => { const gg = this.g(); gg.run.energy += Math.max(1000, gg.incomePerSec(false) * 600); }),
        btn('+rocks', () => { const gg = this.g(); for (const r of CFG.rocks) { gg.addRock(r.id, 200); } }),
        btn('+◆', () => { this.g().meta.density += 10; })),
      h('div', {}, eraSel, btn('go', () => this.jumpEra(+eraSel.value))),
      h('div', {}, elSel, btn('cast', () => {
        const gg = this.g();
        const el = CFG.elements.find((e) => e.id === elSel.value)!;
        gg.run.cooldowns[el.id] = 0;
        gg.run.energy += gg.elementCost(el);
        gg.cast(el.id, el.kind === 'section' ? { x: 90, v: 30 } : undefined);
      })),
      h('div', {}, btn(t('dev.cooldowns'), () => (this.noCooldown = !this.noCooldown)), btn(t('dev.excavate'), () => { const r = this.g().run; r.excavation = r.excavationNeed + 1; r.excavationShards = [1e9, 1e9, 1e9]; })),
      h('div', {}, btn(t('dev.prestige'), () => { const gg = this.g(); gg.run.compactMass = Math.max(gg.run.compactMass, CFG.B.prestige.divisor * 30); gg.prestige(); }), btn(t('dev.reset'), () => this.onReset())),
    );
  }

  jumpEra(era: number): void {
    const g = this.g();
    const r = g.run;
    if (era < r.era) return;
    while (r.era < era) {
      r.year = CFG.eras[r.era].end;
      g.enterEra(r.era + 1);
    }
    if (era >= 2) r.oxygen = Math.max(r.oxygen, 20);
    r.year = Math.max(r.year, CFG.eras[era].start);
  }

  toggle(): void { this.el.hidden = !this.el.hidden; }

  update(dt: number): void {
    const g = this.g();
    if (this.noCooldown) for (const k in g.run.cooldowns) g.run.cooldowns[k] = 0;
    if (this.el.hidden) return;
    this.fps = this.fps * 0.95 + (1 / Math.max(1e-3, dt)) * 0.05;
    setText(this.info, `fps ${this.fps.toFixed(0)}  ×${this.timeScale}\nyear ${fmtInt(g.run.year)} era ${g.run.era}\ncells ${g.world.totalCells}\npacks ${g.world.packs.length}\nmass ${fmt(g.run.compactMass)}\nfound ${g.meta.foundation.toFixed(1)}\nO2 ${g.run.oxygen.toFixed(1)} fert ${g.run.fertility.toFixed(2)}`);
  }
}
