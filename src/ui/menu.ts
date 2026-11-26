// The main menu: over the world of the active slot, which lies still behind it (the game is paused). The title,
// then Continue (with what is in the save), New game, Saves (three slots: play, delete, start anew) and Settings.
// The world behind keeps its sky and water moving, so the menu feels like a pause in the game, not a page.
import { CFG } from '../config';
import { $, h, setText } from './dom';
import { t, fmt, fmtTime, getLang } from './i18n';
import { SLOTS, activeSlot, slotMeta, SlotMeta } from '../save/save';
import { itemPicture } from '../render/items';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
type View = 'main' | 'slots' | 'new' | 'thing';

/** hold-to-confirm for the destructive buttons (delete, overwrite) */
function hold(btn: HTMLButtonElement, fill: HTMLElement, ms: number, done: () => void): void {
  let t0 = 0, raf = 0;
  const stop = () => { t0 = 0; cancelAnimationFrame(raf); fill.style.width = '0'; };
  const tick = () => {
    if (!t0) return;
    const k = (performance.now() - t0) / ms;
    fill.style.width = Math.min(100, k * 100) + '%';
    if (k >= 1) { stop(); done(); return; }
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(tick); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
}

export class Menu {
  private el = h('div', { id: 'menu', hidden: '' });
  private body = h('div', { class: 'mn-body' });
  private view: View = 'main';
  open = false;
  onContinue: () => void = () => {};
  onNew: (slot: number) => void = () => {};
  onLoad: (slot: number) => void = () => {};
  onDelete: (slot: number) => void = () => {};
  onSettings: () => void = () => {};
  /** the things the new world can begin with, and the choice of one */
  things: () => string[] = () => [];
  onThing: (id: string) => void = () => {};

  constructor() {
    this.el.append(
      h('div', { class: 'mn-veil' }),
      h('div', { class: 'mn-head' }, h('div', { class: 'mn-title' }), h('div', { class: 'mn-sub' })),
      this.body,
      h('div', { class: 'mn-foot' }),
    );
    $('#ui').append(this.el);
  }

  show(view: View = 'main'): void {
    this.open = true;
    this.view = view;
    this.el.hidden = false;
    $('#ui').classList.add('menu-open');
    this.build();
    requestAnimationFrame(() => this.el.classList.add('in'));
  }

  hide(): void {
    this.open = false;
    this.el.classList.remove('in');
    $('#ui').classList.remove('menu-open');
    setTimeout(() => { if (!this.open) this.el.hidden = true; }, 350);
  }

  /** Hide for a moment (the settings drawer goes over the world), keeping the game paused. */
  conceal(on: boolean): void { this.el.classList.toggle('concealed', on); }

  private info(m: SlotMeta): HTMLElement {
    const era = Math.max(0, Math.min(CFG.eras.length - 1, m.era));
    const ago = m.savedAt ? Math.max(0, (Date.now() - m.savedAt) / 1000) : 0;
    return h('div', { class: 'mn-info' },
      h('div', { class: 'mn-era' }, `${ROMAN[era] ?? era} · ${t('era.' + era)}`),
      h('div', { class: 'mn-meta' }, [
        m.year > 0 ? t('menu.year', { n: fmt(m.year, 0) }) : '',
        m.real > 0 ? t('menu.played', { t: fmtTime(m.real) }) : '',
        m.savedAt ? t('menu.savedAgo', { t: ago < 60 ? t('menu.justNow') : fmtTime(ago) }) : '',
      ].filter(Boolean).join(' · ')));
  }

  private build(): void {
    const head = this.el.querySelector('.mn-head')!;
    setText(head.querySelector('.mn-title') as HTMLElement, t('title').toUpperCase());
    setText(head.querySelector('.mn-sub') as HTMLElement, t('menu.subtitle'));
    setText(this.el.querySelector('.mn-foot') as HTMLElement, getLang() === 'ru' ? 'Слои · пре-альфа' : 'Strata · pre-alpha');
    this.body.replaceChildren();
    if (this.view === 'main') this.buildMain();
    else if (this.view === 'thing') this.buildThing();
    else this.buildSlots(this.view === 'new');
  }

  private btn(label: string, on: () => void, cls = '', sub?: HTMLElement): HTMLButtonElement {
    const b = h('button', { class: 'mn-btn ' + cls, onclick: on }, h('span', { class: 'mn-l' }, label), sub ?? null) as HTMLButtonElement;
    return b;
  }

  private buildMain(): void {
    const act = activeSlot(), m = slotMeta(act);
    if (m) this.body.append(this.btn(t('menu.continue'), () => this.onContinue(), 'primary', this.info(m)));
    // a new world goes to the active slot if it is empty, else the player picks where
    this.body.append(this.btn(t('menu.newGame'), () => (m ? this.show('new') : this.onNew(act)), m ? '' : 'primary'));
    const any = Array.from({ length: SLOTS }, (_, i) => slotMeta(i + 1)).some(Boolean);
    if (any) this.body.append(this.btn(t('menu.saves'), () => this.show('slots')));
    this.body.append(this.btn(t('menu.settings'), () => this.onSettings()));
  }

  private buildSlots(fresh: boolean): void {
    this.body.append(h('div', { class: 'mn-h2' }, t(fresh ? 'menu.whereNew' : 'menu.saves')));
    const act = activeSlot();
    for (let i = 1; i <= SLOTS; i++) {
      const m = slotMeta(i);
      const card = h('div', { class: 'mn-slot' + (i === act && m ? ' active' : '') + (m ? '' : ' empty') });
      const title = h('div', { class: 'mn-slot-h' }, t('menu.slot', { n: i }), i === act && m ? h('small', {}, t('menu.current')) : null);
      const acts = h('div', { class: 'mn-slot-a' });
      if (m) {
        if (fresh) {
          const fill = h('i', { class: 'fill' });
          const b = h('button', { class: 'mn-small danger' }, fill, h('span', {}, t('menu.overwrite'))) as HTMLButtonElement;
          hold(b, fill, 1200, () => this.onNew(i));
          acts.append(b);
        } else {
          acts.append(h('button', { class: 'mn-small go', onclick: () => this.onLoad(i) }, t('menu.play')));
          const fill = h('i', { class: 'fill' });
          const d = h('button', { class: 'mn-small danger' }, fill, h('span', {}, t('menu.delete'))) as HTMLButtonElement;
          hold(d, fill, 1200, () => { this.onDelete(i); this.build(); });
          acts.append(d);
        }
        card.append(title, this.info(m), acts);
      } else {
        acts.append(h('button', { class: 'mn-small go', onclick: () => this.onNew(i) }, t('menu.newHere')));
        card.append(title, h('div', { class: 'mn-meta' }, t('menu.empty')), acts);
      }
      this.body.append(card);
    }
    this.body.append(this.btn(t('menu.back'), () => this.show('main'), 'back'));
  }

  /** The first choice of a world: which thing goes into the ground (no names: they are found out by playing). */
  private buildThing(): void {
    this.body.append(h('div', { class: 'mn-h2' }, t('menu.thingTitle')), h('div', { class: 'mn-note' }, t('menu.thingNote')));
    const row = h('div', { class: 'mn-things' });
    for (const id of this.things()) {
      const pic = itemPicture(id, 48);
      row.append(h('button', { class: 'mn-thing', onclick: () => this.onThing(id) }, pic));
    }
    this.body.append(row, this.btn(t('menu.back'), () => this.show('main'), 'back'));
  }

  /** The language changed (from the settings): redraw. */
  relabel(): void { if (this.open) this.build(); }
}
