// The left panel of the desktop layout: what a player at a big screen wants at a glance, all the time — the era and
// how far it has gone, every goal, where the energy comes from, the special materials, the composition of the piles,
// the strata and the life. Built once, refreshed twice a second; stone tiles like the rest of the interface.
import { CFG } from '../config';
import type { Game } from '../core/game';
import type { Hud } from './hud';
import { $, h, setText } from './dom';
import { t, fmt } from './i18n';
import { rockIcon, energyIcon } from './icons';
import { totalPop } from '../core/life';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export class InfoPanel {
  private root = $('#side-left');
  private acc = 1;
  private sig = '';
  private refs: Record<string, HTMLElement> = {};

  constructor(private g: () => Game, private hud: Hud) {}

  private section(title: string, ...body: (Node | null)[]): HTMLElement {
    return h('section', { class: 'ip-sec' }, h('h3', {}, title), ...body);
  }

  private row(key: string, label: string | Node, cls = ''): HTMLElement {
    const v = h('b', {});
    this.refs[key] = v;
    return h('div', { class: 'ip-row ' + cls }, h('span', {}, label), v);
  }

  private build(g: Game): void {
    this.refs = {};
    const eraBar = h('i', {});
    this.refs.eraBar = eraBar;
    const goals = h('div', { class: 'ip-goals' });
    this.refs.goals = goals;
    const mix = h('div', { class: 'ip-mix' });
    this.refs.mix = mix;
    const specials = h('div', { class: 'ip-specials' });
    this.refs.specials = specials;
    this.root.replaceChildren(
      this.section(t('info.era'),
        h('div', { class: 'ip-era' }, h('span', { class: 'ip-era-name' }), h('small', {})),
        h('div', { class: 'ip-bar' }, eraBar),
        this.row('years', t('info.year')),
        this.row('speed', t('info.speed')),
        this.row('left', t('info.left'))),
      this.section(t('info.goals'), goals),
      this.section(t('info.income'),
        this.row('incTotal', h('span', { class: 'ip-ico' }, energyIcon(14), t('info.total')), 'strong'),
        this.row('incLife', t('info.life')),
        this.row('incAbsorb', t('info.absorb')),
        this.row('incTap', t('info.tap'))),
      this.section(t('info.specials'), specials),
      this.section(t('info.pile'), this.row('pileN', t('info.pileSize')), mix),
      this.section(t('info.strata'),
        this.row('layers', t('info.layers')),
        this.row('absorbed', t('info.absorbed')),
        this.row('fossils', t('info.fossils')),
        this.row('oxygen', t('info.oxygen')),
        this.row('species', t('info.species'))),
    );
  }

  update(dt: number, on: boolean): void {
    if (!on) return;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const g = this.g(), r = g.run;
    const sig = g.state.settings.lang;
    if (sig !== this.sig) { this.sig = sig; this.build(g); }
    const era = g.eraDef();
    const head = this.root.querySelector('.ip-era') as HTMLElement;
    setText(head.firstChild as HTMLElement, r.era > 0 ? `${ROMAN[r.era] ?? r.era} · ${t('era.' + r.era)}` : t('era.' + r.era));
    setText(head.lastChild as HTMLElement, g.hurrying() ? t('info.hurry') : '');
    const k = Math.max(0, Math.min(1, (r.year - era.start) / Math.max(1, era.end - era.start)));
    this.refs.eraBar.style.width = (k * 100).toFixed(1) + '%';
    setText(this.refs.years, fmt(Math.round(r.year), 0));
    setText(this.refs.speed, t('hud.yps', { v: fmt(g.yps(), g.yps() < 10 ? 1 : 0) }));
    const yps = g.yps();
    const left = Math.max(0, era.end - r.year);
    setText(this.refs.left, left <= 0 ? t('info.wall') : yps > 0 ? `${fmt(left, 0)} · ~${fmt(Math.ceil(left / yps), 0)} ${t('info.sec')}` : '—');
    // goals: the same list as the header's pop-up
    this.refs.goals.replaceChildren(...this.hud.goals(g).map((x) => h('div', { class: 'ip-goal' + (x.sub ? ' sub' : '') },
      h('span', {}, x.text), x.sub ? null : h('i', { class: 'ip-bar small' }, h('i', { style: `width:${Math.round(Math.min(1, x.k) * 100)}%` })))));
    // income
    const life = g.lifeIncome() * g.stats.energyMul;
    setText(this.refs.incTotal, t('hud.perSec', { v: fmt(g.incomePerSec() + g.absorbRate) }));
    setText(this.refs.incLife, t('hud.perSec', { v: fmt(life) }));
    setText(this.refs.incAbsorb, t('hud.perSec', { v: fmt(g.absorbRate) }));
    setText(this.refs.incTap, fmt(g.clickValue()));
    // the special materials
    const sp = CFG.B.sand.specials.order.filter((id) => g.specialKnown(id));
    const ssig = sp.join(',');
    if (this.refs.specials.dataset.sig !== ssig) {
      this.refs.specials.dataset.sig = ssig;
      this.refs.specials.replaceChildren(...(sp.length ? sp.map((id) => h('div', { class: 'ip-row', 'data-sp': id }, h('span', { class: 'ip-ico' }, rockIcon(id, 16), t('rocks.' + id)), h('b', {})))
        : [h('div', { class: 'ip-note' }, t('info.noSpecials'))]));
    }
    this.refs.specials.querySelectorAll<HTMLElement>('[data-sp]').forEach((el) => setText(el.lastChild as HTMLElement, fmt(r.rocks[el.dataset.sp!] ?? 0, 0)));
    // the piles
    setText(this.refs.pileN, fmt(g.pileSize(), 0));
    const sh = g.pileShares();
    const parts: [string, number, string][] = [[t('pile.own'), sh.own, '#8a7a64']];
    for (const [id, p] of sh.mats) {
      const u = CFG.upgrades.find((x) => x.pileMat === id);
      const m = CFG.materials[CFG.matIndex[id]] as { px?: string[] } | undefined;
      parts.push([u ? t('upgrades.' + u.id + '.name') : id, p, m?.px?.[0] ?? '#999']);
    }
    this.refs.mix.replaceChildren(
      h('div', { class: 'ip-mixbar' }, ...parts.map(([, p, c]) => h('i', { style: `width:${(p * 100).toFixed(1)}%;background:${c}` }))),
      ...parts.map(([n, p, c]) => h('div', { class: 'ip-row small' }, h('span', { class: 'ip-ico' }, h('i', { class: 'ip-sw', style: `background:${c}` }), n), h('b', {}, fmt(p * 100, 0) + '%'))));
    // the strata and the life
    setText(this.refs.layers, fmt(r.layers, 0));
    setText(this.refs.absorbed, fmt(r.sink.rows, 0));
    setText(this.refs.fossils, fmt(g.legacy.fossils, 0));
    setText(this.refs.oxygen, fmt(r.oxygen, 1) + '%');
    let n = 0, units = 0;
    for (const s of CFG.species) { const u = totalPop(g, s.id); if (u > 0) { n++; units += u; } }
    setText(this.refs.species, `${n} · ${fmt(units, 0)}`);
  }
}
