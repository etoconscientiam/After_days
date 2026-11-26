// The left panel of the desktop layout: what a player at a big screen wants at a glance, all the time. Three looks
// to choose from (?desk=a|b|c while we compare): A «Планета» — the planet the strata are making, B «Разрез» — the whole
// depth laid down so far, C «Приборы» — instruments (the eras, the income chart, the pile ring, the oxygen tube).
// Built once (and on a language change), refreshed twice a second; the planet turns every frame.
import { CFG } from '../config';
import type { Game } from '../core/game';
import type { Hud } from './hud';
import { $, h, setText } from './dom';
import { t, fmt } from './i18n';
import { rockIcon, energyIcon } from './icons';
import { Planet, History, drawDepth, drawChart, drawRing, drawTube, ERA_COLORS } from './deskViz';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
export type DeskLook = 'a' | 'b' | 'c';

export class InfoPanel {
  private root = $('#side-left');
  private acc = 1;
  private sig = '';
  private refs: Record<string, HTMLElement> = {};
  private planet = new Planet(84);
  private hist = new History(2, 90);
  private cv: Record<string, HTMLCanvasElement> = {};

  constructor(private g: () => Game, private hud: Hud, public look: DeskLook = 'a') {}

  private section(title: string | null, ...body: (Node | null)[]): HTMLElement {
    return h('section', { class: 'ip-sec' }, title ? h('h3', {}, title) : null, ...body);
  }

  private row(key: string, label: string | Node, cls = ''): HTMLElement {
    const v = h('b', {});
    this.refs[key] = v;
    return h('div', { class: 'ip-row ' + cls }, h('span', {}, label), v);
  }

  private canvas(key: string, w: number, hgt: number, cls = ''): HTMLCanvasElement {
    const c = h('canvas', { class: 'pix ' + cls }) as HTMLCanvasElement;
    c.width = w; c.height = hgt;
    this.cv[key] = c;
    return c;
  }

  private ref<T extends HTMLElement>(key: string, el: T): T { this.refs[key] = el; return el; }

  // ---- shared blocks
  private eraHead(): HTMLElement[] {
    return [
      h('div', { class: 'ip-era' }, this.ref('eraName', h('span', { class: 'ip-era-name' })), this.ref('eraHurry', h('small', {}))),
      h('div', { class: 'ip-bar' }, this.ref('eraBar', h('i', {}))),
      h('div', { class: 'ip-era-sub' }, this.ref('eraSub', h('span', {})))];
  }
  private goalsBlock(): HTMLElement { return this.section(t('info.goals'), this.ref('goals', h('div', { class: 'ip-goals' }))); }
  private incomeChart(w: number, hgt: number): HTMLElement {
    return h('div', { class: 'ip-chart' }, this.canvas('chart', w, hgt, 'dv-chart'), this.ref('chartMax', h('span', { class: 'ip-chart-max' })));
  }
  private incomeRows(): HTMLElement[] {
    return [
      this.row('incTotal', h('span', { class: 'ip-ico' }, energyIcon(14), t('info.total')), 'strong'),
      this.row('incLife', h('span', { class: 'ip-ico' }, h('i', { class: 'ip-sw', style: 'background:#9ccc5a' }), t('info.life'))),
      this.row('incAbsorb', h('span', { class: 'ip-ico' }, h('i', { class: 'ip-sw', style: 'background:#6fb4e0' }), t('info.absorb'))),
      this.row('incTap', t('info.tap'))];
  }
  private specialsBlock(): HTMLElement { return this.section(t('info.specials'), this.ref('specials', h('div', { class: 'ip-specials' }))); }

  private build(): void {
    this.refs = {}; this.cv = {};
    this.root.dataset.look = this.look;
    if (this.look === 'a') {
      this.root.replaceChildren(
        h('section', { class: 'ip-sec ip-planet' },
          h('div', { class: 'ip-globe' }, this.planet.canvas),
          ...this.eraHead(),
          h('div', { class: 'ip-chips' }, this.ref('chLand', h('span', { class: 'ip-chip land' })), this.ref('chForest', h('span', { class: 'ip-chip forest' })), this.ref('chO2', h('span', { class: 'ip-chip o2' })))),
        this.goalsBlock(),
        this.section(t('info.income'), this.incomeChart(116, 40), ...this.incomeRows()),
        this.specialsBlock(),
      );
    } else if (this.look === 'b') {
      this.root.replaceChildren(
        h('div', { class: 'ip-split' },
          h('div', { class: 'ip-depth' }, this.canvas('depth', 48, 260, 'dv-depth'), this.ref('depthMarks', h('div', { class: 'ip-depth-marks' }))),
          h('div', { class: 'ip-stack' },
            this.section(null, ...this.eraHead()),
            this.goalsBlock(),
            this.section(t('info.income'), ...this.incomeRows()),
            this.section(t('info.strata'), this.row('layers', t('info.layers'), 'small'), this.row('absorbed', t('info.absorbed'), 'small'), this.row('fossils', t('info.fossils'), 'small')),
            this.specialsBlock())),
      );
    } else {
      const eras = h('div', { class: 'ip-eras' });
      for (let e = 0; e <= 7; e++) eras.append(h('span', { 'data-e': String(e), style: `--c:${ERA_COLORS[e]}` }, h('i', {}), h('em', {}, ROMAN[e])));
      this.refs.eras = eras;
      this.root.replaceChildren(
        h('section', { class: 'ip-sec' },
          h('div', { class: 'ip-era' }, this.ref('eraName', h('span', { class: 'ip-era-name' })), this.ref('eraHurry', h('small', {}))),
          eras,
          h('div', { class: 'ip-era-sub' }, this.ref('eraSub', h('span', {})))),
        this.section(t('info.income'), this.incomeChart(116, 46), ...this.incomeRows()),
        h('section', { class: 'ip-sec ip-instr' },
          h('div', { class: 'ip-ring' }, h('h3', {}, t('info.pile')), h('div', { class: 'ip-ring-in' }, this.canvas('ring', 44, 44, 'dv-ring'), this.ref('ringLegend', h('div', { class: 'ip-legend' })))),
          h('div', { class: 'ip-tube' }, h('h3', {}, 'O₂'), this.canvas('tube', 10, 60, 'dv-tube'), this.ref('tubeV', h('b', {})))),
        this.goalsBlock(),
        this.specialsBlock(),
      );
    }
  }

  update(dt: number, on: boolean): void {
    if (!on) return;
    const g = this.g(), r = g.run;
    const sig = g.state.settings.lang + this.look;
    if (sig !== this.sig) { this.sig = sig; this.build(); this.acc = 1; }
    if (this.hist.sample(dt, g) && this.cv.chart) setText(this.refs.chartMax, t('hud.perSec', { v: fmt(drawChart(this.cv.chart.getContext('2d')!, this.cv.chart.width, this.cv.chart.height, this.hist)) }));
    if (this.look === 'a') this.planet.draw(g, dt);
    if (this.look === 'c' && this.cv.tube) {
      const c = g.eraDef().cond;
      drawTube(this.cv.tube.getContext('2d')!, 10, 60, r.oxygen, c.type === 'oxygen' ? c.value! : null);
    }
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const era = g.eraDef();
    setText(this.refs.eraName, r.era > 0 ? `${ROMAN[r.era] ?? r.era} · ${t('era.' + r.era)}` : t('era.' + r.era));
    setText(this.refs.eraHurry, g.hurrying() ? t('info.hurry') : '');
    const k = Math.max(0, Math.min(1, (r.year - era.start) / Math.max(1, era.end - era.start)));
    if (this.refs.eraBar) this.refs.eraBar.style.width = (k * 100).toFixed(1) + '%';
    if (this.refs.eras) this.refs.eras.querySelectorAll<HTMLElement>('span').forEach((s) => {
      const e = +s.dataset.e!;
      s.classList.toggle('done', e < r.era); s.classList.toggle('now', e === r.era);
      (s.firstChild as HTMLElement).style.width = e < r.era ? '100%' : e === r.era ? (k * 100).toFixed(1) + '%' : '0';
    });
    const yps = g.yps(), left = Math.max(0, era.end - r.year);
    setText(this.refs.eraSub, `${t('info.year')} ${fmt(Math.round(r.year), 0)} · ${t('hud.yps', { v: fmt(yps, yps < 10 ? 1 : 0) })} · ${left <= 0 ? t('info.wall') : yps > 0 ? '~' + fmt(Math.ceil(left / yps), 0) + ' ' + t('info.sec') : '—'}`);
    // goals
    this.refs.goals.replaceChildren(...this.hud.goals(g).map((x) => h('div', { class: 'ip-goal' + (x.sub ? ' sub' : '') },
      h('span', {}, x.text), x.sub ? null : h('i', { class: 'ip-bar small' }, h('i', { style: `width:${Math.round(Math.min(1, x.k) * 100)}%` })))));
    // income
    setText(this.refs.incTotal, t('hud.perSec', { v: fmt(g.incomePerSec() + g.absorbRate) }));
    setText(this.refs.incLife, t('hud.perSec', { v: fmt(g.lifeIncome() * g.stats.energyMul) }));
    setText(this.refs.incAbsorb, t('hud.perSec', { v: fmt(g.absorbRate) }));
    setText(this.refs.incTap, fmt(g.clickValue()));
    // the special materials: icons with counts in a row
    const sp = CFG.B.sand.specials.order.filter((id) => g.specialKnown(id));
    const ssig = sp.join(',');
    if (this.refs.specials.dataset.sig !== ssig) {
      this.refs.specials.dataset.sig = ssig;
      this.refs.specials.replaceChildren(...(sp.length ? sp.map((id) => h('span', { class: 'ip-spec', 'data-sp': id, title: t('rocks.' + id) }, rockIcon(id, 18), h('b', {})))
        : [h('div', { class: 'ip-note' }, t('info.noSpecials'))]));
    }
    this.refs.specials.querySelectorAll<HTMLElement>('[data-sp]').forEach((el) => setText(el.lastChild as HTMLElement, fmt(r.rocks[el.dataset.sp!] ?? 0, 0)));
    // per look
    if (this.look === 'a') {
      let land = 0; for (const z of g.zoneMap) if (z >= 1) land++;
      setText(this.refs.chLand, `${t('info.land')} ${Math.round((land / g.zoneMap.length) * 100)}%`);
      setText(this.refs.chForest, `${t('info.forest')} ${Math.round(g.forestCover() * 100)}%`);
      setText(this.refs.chO2, `O₂ ${fmt(r.oxygen, 1)}%`);
    } else if (this.look === 'b') {
      const cv = this.cv.depth, res = drawDepth(cv.getContext('2d')!, cv.width, cv.height, g);
      const marks = res.marks.filter((m, i, a) => i === a.length - 1 || a[i + 1].y - m.y >= 12);
      this.refs.depthMarks.replaceChildren(...marks.map((m) => h('span', { style: `top:${(m.y / cv.height) * 100}%;color:${ERA_COLORS[m.era]}` }, ROMAN[m.era])),
        h('span', { class: 'thing', style: `top:${(res.thing / cv.height) * 100}%` }, '◆'));
      setText(this.refs.layers, fmt(r.layers, 0));
      setText(this.refs.absorbed, fmt(r.sink.rows, 0));
      setText(this.refs.fossils, fmt(g.legacy.fossils, 0));
    } else {
      const sh = g.pileShares();
      const parts: [string, number, string][] = [[t('pile.own'), sh.own, '#8a7a64']];
      for (const [id, p] of sh.mats) {
        const u = CFG.upgrades.find((x) => x.pileMat === id);
        const m = CFG.materials[CFG.matIndex[id]] as { px?: string[] } | undefined;
        parts.push([u ? t('upgrades.' + u.id + '.name') : id, p, m?.px?.[0] ?? '#999']);
      }
      drawRing(this.cv.ring.getContext('2d')!, 44, parts.map(([, p, c]) => [p, c]));
      this.refs.ringLegend.replaceChildren(...parts.map(([n, p, c]) => h('div', { class: 'ip-row small' }, h('span', { class: 'ip-ico' }, h('i', { class: 'ip-sw', style: `background:${c}` }), n), h('b', {}, fmt(p * 100, 0) + '%'))));
      setText(this.refs.tubeV, fmt(r.oxygen, 1) + '%');
    }
  }
}
