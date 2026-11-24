// The pile's extra material, chosen by the player: a row of small buttons over the tab bar, one for each
// material the «pile composition» branch has opened, plus «the zone's own» (what life lays down there). Only one
// extra goes into a pile, so each choice gives one thing and not another — soil for a forest or lime for the
// shells, sandstone, a seal for oil, amber — and what it turns into deep down is not shown until it is found.
import { CFG } from '../config';
import type { Game } from '../core/game';
import { $, h, setText, toggle } from './dom';
import { t } from './i18n';
import { pilePixel } from './pixelIcons';

export class PileChips {
  private el = h('div', { id: 'pile-chips', hidden: '' });
  private row = h('div', { class: 'pc-row' });
  private info = h('div', { class: 'pc-info' });
  private sig = '';
  private acc = 0;

  constructor(private g: () => Game) {
    this.el.append(this.row, this.info);
    $('#stage-ui').append(this.el);
  }

  /** the materials opened by the branch */
  private opened(g: Game): string[] {
    return CFG.upgrades.filter((u) => u.pileMat && (g.run.upgrades[u.id] ?? 0) > 0).map((u) => u.pileMat!);
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const g = this.g();
    const mats = this.opened(g);
    const drawer = $('#ui').classList.contains('drawer-open');
    const show = g.state.phase === 'play' && mats.length > 0 && !drawer;
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) return;
    const cur = g.run.pileChoice ?? null;
    const sig = mats.join(',') + '|' + cur + '|' + g.state.settings.lang;
    if (sig !== this.sig) { this.sig = sig; this.build(g, mats, cur); }
  }

  private build(g: Game, mats: string[], cur: string | null): void {
    const chip = (id: string | null) => {
      const name = id ? t('materials.' + id) : t('pile.own');
      const b = h('button', { class: 'pc-chip' + (cur === id ? ' on' : ''), title: name, 'aria-label': name },
        id ? pilePixel(18, id) : h('span', { class: 'pc-own' }, '◇')) as HTMLButtonElement;
      b.addEventListener('click', (e) => { e.stopPropagation(); g.setPileChoice(id); this.sig = ''; this.update(1); });
      return b;
    };
    this.row.replaceChildren(chip(null), ...mats.map((m) => chip(m)));
    const what = cur ? t('materials.' + cur) + ': ' + t('pile.feeds.' + cur) : t('pile.own') + ': ' + t('pile.feeds.own');
    setText(this.info, what);
    toggle(this.el, 'chosen', !!cur);
  }
}
