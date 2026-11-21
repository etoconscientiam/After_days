// Header: the countdown (the main storyteller), ⟡, a thin era line, era name (tap for the condition), speed;
// resources: Energy large plus the last three rocks; notifications (at most two, merged when alike).
import { CFG } from '../config';
import type { Game } from '../core/game';
import { $, h, setText, toggle } from './dom';
import { t, fmt } from './i18n';
import { energyIcon, rockIcon, tabIcon } from './icons';

/** 97 844 — a thin space between thousands, in every language. */
export function fmtCountdown(n: number): string {
  return String(Math.max(0, Math.ceil(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

interface Plate { key: string; n: number; el: HTMLElement; timer: number; text: (n: number) => string }

export class Hud {
  private cdNum = $('#cd-num');
  private countdown = $('#countdown');
  private sym = $('#cd-sym');
  private hud = $('#hud');
  private eraName = $('#era-name');
  private speed = $('#speed');
  private eraFill = $('#era-fill');
  private condPop = $('#cond-pop');
  private energyVal = $('#energy-val');
  private energyRate = $('#energy-rate');
  private rocks = $('#rocks');
  private density = $('#density');
  private notes = $('#notes');
  private plates: Plate[] = [];
  private rockSig = '';
  private condTimer = 0;
  onRocks: () => void = () => {};

  constructor(private g: () => Game) {
    $('#e-ico').append(energyIcon(18));
    $('#gear').append(tabIcon('settings', 20));
    this.eraName.addEventListener('click', () => this.showCondition());
    this.rocks.addEventListener('click', () => this.onRocks());
    $('#energy').addEventListener('click', () => this.onRocks());
  }

  private showCondition(): void {
    const g = this.g();
    this.condPop.replaceChildren(h('div', { class: 'label' }, h('div', { class: 'l-head' }, t('era.' + g.run.era)), h('div', { class: 'l-sub' }, this.condString(g))));
    this.condPop.hidden = false;
    this.condTimer = 5;
  }

  /** Bump the Energy counter when a spark arrives. */
  bump(): void {
    this.energyVal.classList.add('bump');
    setTimeout(() => this.energyVal.classList.remove('bump'), 120);
  }

  /** Canvas-space point of the Energy number (for the click sparks). */
  energyPoint(canvasRect: DOMRect): { x: number; y: number } {
    const r = this.energyVal.getBoundingClientRect();
    return { x: ((r.left + r.width / 2 - canvasRect.left) / canvasRect.width) * 180, y: ((r.top + r.height / 2 - canvasRect.top) / canvasRect.height) * 320 };
  }

  update(g: Game, dt: number): void {
    const r = g.run;
    const phase = g.state.phase;
    const finding = phase === 'newWorld' || phase === 'end' || phase === 'temple' || phase === 'finale';
    this.hud.style.visibility = finding ? 'hidden' : '';
    setText(this.cdNum, fmtCountdown(CFG.zeroYear - r.year));
    setText(this.eraName, t('era.' + r.era));
    const era = g.eraDef();
    const atWall = r.year >= era.end - 1e-6 && !g.eraConditionMet() && phase === 'play';
    toggle(this.speed, 'wall', atWall);
    if (atWall) setText(this.speed, t('hud.wall'));
    else {
      const yps = g.yps();
      setText(this.speed, yps >= 1 ? t('hud.yps', { v: fmt(yps, yps < 10 ? 1 : 0) }) : yps * 52 >= 1 ? t('hud.wps', { v: fmt(yps * 52, 1) }) : t('hud.dps', { v: fmt(yps * 365, 1) }));
    }
    const k = Math.max(0, Math.min(1, (r.year - era.start) / (era.end - era.start)));
    this.eraFill.style.width = (k * 100).toFixed(1) + '%';
    this.sym.style.animationDuration = r.boost > 0 ? '1.2s' : '4s';
    setText(this.energyVal, fmt(r.energy));
    setText(this.energyRate, t('hud.perSec', { v: fmt(g.incomePerSec()) }));
    // the last three rocks found
    const last = g.legacy.discovered.slice(-3).reverse();
    const sig = last.join(',') + g.state.settings.lang;
    if (sig !== this.rockSig) {
      this.rockSig = sig;
      this.rocks.replaceChildren(...last.map((rk) => h('span', { class: 'rock-chip fly-in', 'data-rock': rk, title: t('rocks.' + rk) }, rockIcon(rk, 18), h('span', {}))));
    }
    this.rocks.querySelectorAll<HTMLElement>('.rock-chip').forEach((chip) => setText(chip.lastChild as HTMLElement, fmt(r.rocks[chip.dataset.rock!] ?? 0, 0)));
    this.density.hidden = g.meta.density <= 0 && g.meta.prestiges === 0;
    setText(this.density, '◆ ' + fmt(g.meta.density, 0));
    if (this.condTimer > 0) { this.condTimer -= dt; if (this.condTimer <= 0) this.condPop.hidden = true; }
    for (const p of this.plates) p.timer -= dt;
    for (const p of this.plates.filter((q) => q.timer <= 0)) this.dropPlate(p);
  }

  condString(g: Game): string {
    const r = g.run;
    const c = g.eraDef().cond;
    const pct = (v: number) => fmt(v * 100, 0);
    switch (c.type) {
      case 'energyEarned': return t('cond.energyEarned', { v: fmt(c.value!), cur: fmt(r.energyEarned) });
      case 'oxygen': return t('cond.oxygen', { v: c.value!, cur: fmt(r.oxygen, 1) });
      case 'speciesCount': return t('cond.' + c.group, { v: c.value!, cur: g.groupCount(c.group!) });
      case 'forest': return t('cond.forest', { v: pct(c.value!), cur: pct(g.forestCover()) });
      case 'animals': return t('cond.animals', { v: c.value!, cur: g.groupCount('animal') });
      case 'settled': return t('cond.settled', { v: c.value!, cur: fmt(g.settlePop(), 1) });
      case 'excavation': return t('cond.excavation', { v: fmt(r.excavationNeed, 0), cur: fmt(r.excavation, 0) });
    }
    return '';
  }

  /**
   * A small plate under the header, top left of the world. At most two at once; the same kind merges
   * into one ("+4 new eras") instead of stacking.
   */
  notify(key: string, single: string, color = '#F2B54A', plural?: (n: number) => string): void {
    const same = this.plates.find((p) => p.key === key);
    if (same) {
      same.n++;
      same.timer = 3;
      setText(same.el.lastChild as HTMLElement, same.text(same.n));
      return;
    }
    if (this.plates.length >= 2) this.dropPlate(this.plates[0]);
    const text = (n: number) => (n <= 1 ? single : plural ? plural(n) : `${single} ×${n}`);
    const el = h('div', { class: 'note-plate' }, h('i', { class: 'dot', style: `background:${color}` }), h('span', {}, single));
    this.notes.append(el);
    this.plates.push({ key, n: 1, el, timer: 3, text });
  }

  private dropPlate(p: Plate): void {
    this.plates.splice(this.plates.indexOf(p), 1);
    p.el.classList.add('out');
    setTimeout(() => p.el.remove(), 500);
  }
}
