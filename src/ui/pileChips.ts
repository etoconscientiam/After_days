// The pile's extra material, chosen by the player: a column of small buttons at the right, under the Geologist's
// buttons, one for each
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
  private lastCur: string | null | undefined = undefined;
  private infoTimer: ReturnType<typeof setTimeout> | undefined;
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
    // the Geologist's view takes the side column for its plates
    const geo = $('#ui').classList.contains('geo-on');
    const show = g.state.phase === 'play' && mats.length > 0 && !drawer && !geo;
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) { this.acc = 0.2; return; }
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
    // the plate on what the extra gives shows for a while after a choice, by the chosen button
    // (not when the column first appears: only after the player's own choice)
    if (this.lastCur === undefined) this.lastCur = cur;
    if (this.lastCur !== cur) {
      this.lastCur = cur;
      const i = cur ? mats.indexOf(cur) + 1 : 0;
      this.info.style.top = i * 38 + 'px';
      this.info.classList.add('show');
      clearTimeout(this.infoTimer);
      this.infoTimer = setTimeout(() => this.info.classList.remove('show'), 3500);
    }
  }
}
