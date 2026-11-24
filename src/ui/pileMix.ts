// The composition of the piles, as in the prototype: a thin bar over the tab bar, a segment for each material
// in the share it makes of the piles — the zone's own matter and each material bought in the «pile composition»
// branch (energy). A tap on it opens that branch.
import { CFG } from '../config';
import type { Game } from '../core/game';
import { $, h, setText } from './dom';
import { fmt, t } from './i18n';

const OWN = '#8a7a64';

function matColor(id: string): string {
  const m = CFG.materials[CFG.matIndex[id]] as { px?: string[] } | undefined;
  return m?.px?.[0] ?? '#999';
}

export class PileMix {
  private el = h('button', { id: 'pile-mix', hidden: '' });
  private n = h('span', {});
  private bar = h('div', { class: 'pm-bar' });
  private sig = '';
  private acc = 1;
  onOpen: () => void = () => {};

  constructor(private g: () => Game) {
    this.el.append(h('div', { class: 'pm-lbl' }, h('span', {}, t('upgrades.pile')), this.n), this.bar);
    this.el.addEventListener('click', () => this.onOpen());
    $('#stage-ui').append(this.el);
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.3) return;
    this.acc = 0;
    const g = this.g();
    const sh = g.pileShares();
    const show = g.state.phase === 'play' && sh.mats.length > 0;
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) return;
    setText(this.n, t('upgrades.pileN', { n: g.pileSize() }));
    const parts: [string, number, string][] = [['own', sh.own, OWN], ...sh.mats.map(([id, p]) => [id, p, matColor(id)] as [string, number, string])];
    const sig = parts.map((p) => p[0] + ':' + p[1].toFixed(3)).join(',') + g.state.settings.lang;
    if (sig === this.sig) return;
    this.sig = sig;
    this.bar.replaceChildren(...parts.map(([id, p, c]) => {
      const u = CFG.upgrades.find((x) => x.pileMat === id);
      const name = id === 'own' || !u ? t('pile.own') : t('upgrades.' + u.id + '.name');
      return h('i', { style: `width:${(p * 100).toFixed(1)}%;background:${c}`, title: `${name} · ${fmt(p * 100, 0)}%` });
    }));
  }
}
