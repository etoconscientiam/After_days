// Header: the countdown (the main storyteller), ⟡, a thin era line, era name (tap for the condition), speed;
// resources: Energy large plus the last three rocks; notifications (at most two, merged when alike).
import { CFG } from '../config';
import type { Game } from '../core/game';
import { $, h, setText, toggle } from './dom';
import { t, fmt } from './i18n';
import { energyIcon, rockIcon, tabIcon } from './icons';
import { orderDef, orderProgress } from '../core/orders';

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
  private condKind = '';
  onRocks: () => void = () => {};
  /** second tap on a rock in the header: open its upgrades */
  onRockJump: (rock: string) => void = () => {};
  private goal = $('#goal');
  private goalMain = this.goal.querySelector('.g-main') as HTMLElement;
  private goalBar = this.goal.querySelector('.g-bar') as HTMLElement;
  private goalSub = this.goal.querySelector('.g-sub') as HTMLElement;
  private rockPop = $('#rock-pop');
  private rockPopFor = '';
  private rockPopT = 0;
  private goalAcc = 9;

  constructor(private g: () => Game) {
    $('#e-ico').append(energyIcon(18));
    $('#gear').append(tabIcon('settings', 20));
    this.eraName.addEventListener('click', () => this.showCondition());
    // a rock in the header: first tap names it, the second opens its upgrades
    this.rocks.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('.rock-chip') as HTMLElement | null;
      if (!chip) { this.onRocks(); return; }
      const rk = chip.dataset.rock!;
      if (this.rockPopFor === rk && this.rockPopT > 0) { this.rockPop.hidden = true; this.rockPopT = 0; this.rockPopFor = ''; this.onRockJump(rk); return; }
      const g2 = this.g();
      this.rockPop.replaceChildren(h('div', { class: 'l-head' }, rockIcon(rk, 18), h('span', {}, t('rocks.' + rk))), h('div', { class: 'l-sub' }, fmt(g2.run.rocks[rk] ?? 0, 0)));
      const r = chip.getBoundingClientRect(), u = $('#ui').getBoundingClientRect();
      const k = u.width / 360;
      this.rockPop.style.left = Math.min(360 - 150, (r.left - u.left) / k - 30) + 'px';
      this.rockPop.style.top = (r.bottom - u.top) / k + 4 + 'px';
      this.rockPop.hidden = false;
      this.rockPopFor = rk; this.rockPopT = 2.5;
    });
    $('#energy').addEventListener('click', () => this.onRocks());
    this.goal.addEventListener('click', () => this.showGoals());
  }

  private showCondition(): void {
    if (!this.condPop.hidden && this.condKind === 'era') { this.condPop.hidden = true; this.condTimer = 0; return; }
    this.condKind = 'era';
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
    // the three rocks needed for the nearest upgrades (closest to buying first)
    const last = this.neededRocks(g);
    const sig = last.join(',') + g.state.settings.lang;
    if (sig !== this.rockSig) {
      this.rockSig = sig;
      this.rocks.replaceChildren(...last.map((rk) => h('span', { class: 'rock-chip fly-in', 'data-rock': rk }, rockIcon(rk, 18), h('span', {}))));
    }
    this.rocks.querySelectorAll<HTMLElement>('.rock-chip').forEach((chip) => setText(chip.lastChild as HTMLElement, fmt(r.rocks[chip.dataset.rock!] ?? 0, 0)));
    this.density.hidden = g.meta.density <= 0 && g.meta.prestiges === 0;
    setText(this.density, '◆ ' + fmt(g.meta.density, 0));
    if (this.condTimer > 0) { this.condTimer -= dt; if (this.condTimer <= 0) this.condPop.hidden = true; }
    if (this.rockPopT > 0 && (this.rockPopT -= dt) <= 0) { this.rockPop.hidden = true; this.rockPopFor = ''; }
    this.goalAcc += dt;
    if (this.goalAcc > 0.3) { this.goalAcc = 0; this.updateGoal(g); this.placeNotes(); }
    for (const p of this.plates) p.timer -= dt;
    for (const p of this.plates.filter((q) => q.timer <= 0)) this.dropPlate(p);
  }

  /** Notifications sit right under the goal line (never over Energy or the rocks). */
  private placeNotes(): void {
    const u = $('#ui').getBoundingClientRect();
    const k = u.width / 360;
    const under = !this.goal.hidden && this.goal.offsetParent ? this.goal : $('#res-row');
    const b = (under.getBoundingClientRect().bottom - u.top) / k;
    this.notes.style.top = Math.round(b + 6) + 'px';
    this.bottomUI = b;
  }
  /** Lowest point of the header text, in UI units (the open sky starts below it). */
  bottomUI = 132;

  /** A rock found for the first time: its name under the header for 2 s. */
  captionRock(rk: string): void {
    const g = this.g();
    this.rockPop.replaceChildren(h('div', { class: 'l-head' }, rockIcon(rk, 18), h('span', {}, t('rocks.' + rk))), h('div', { class: 'l-sub' }, fmt(g.run.rocks[rk] ?? 0, 0)));
    const r = this.rocks.getBoundingClientRect(), u = $('#ui').getBoundingClientRect();
    const k = u.width / 360;
    this.rockPop.style.left = Math.max(6, Math.min(360 - 150, (r.right - u.left) / k - 140)) + 'px';
    this.rockPop.style.top = (r.bottom - u.top) / k + 4 + 'px';
    this.rockPop.hidden = false;
    this.rockPopFor = ''; this.rockPopT = 2;
  }

  /** Rocks the player needs now: for each discovered rock, how close its cheapest next upgrade is. */
  neededRocks(g: Game): string[] {
    const scored: [string, number][] = [];
    for (const rk of g.legacy.discovered) {
      const ups = CFG.upgrades.filter((u) => u.currency === rk);
      if (!ups.length) continue;
      const cost = Math.min(...ups.map((u) => g.upgradeCost(u.id)));
      scored.push([rk, Math.min(1, (g.run.rocks[rk] ?? 0) / Math.max(1, cost))]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const out = scored.slice(0, 3).map((x) => x[0]);
    for (const rk of g.legacy.discovered.slice().reverse()) if (out.length < 3 && !out.includes(rk)) out.push(rk);
    return out;
  }

  /** The active order (if any) and the era condition. */
  private goals(g: Game): { text: string; k: number; sub?: boolean }[] {
    const out: { text: string; k: number; sub?: boolean }[] = [];
    for (const o of g.run.orders) {
      if (o.done) continue;
      const pr = orderProgress(g, o);
      out.push({ text: `${t('orders.' + o.id)} — ${fmt(pr.have, 0)}/${fmt(pr.need, 0)}`, k: pr.have / Math.max(1, pr.need) });
    }
    if (g.state.phase === 'play' && g.run.era < 8) out.push({ text: this.condString(g), k: g.eraConditionProgress(), sub: true });
    return out;
  }

  private updateGoal(g: Game): void {
    const gs = this.goals(g);
    const main = gs[0];
    this.goal.hidden = !main || g.state.phase !== 'play';
    if (!main) return;
    setText(this.goalMain, '◆ ' + main.text);
    const seg = 8, on = Math.round(main.k * seg);
    this.goalBar.textContent = '▰'.repeat(on) + '▱'.repeat(seg - on);
    const sub = gs.length > 1 ? gs[gs.length - 1] : null;
    this.goalSub.hidden = !sub || sub === main;
    if (sub && sub !== main) setText(this.goalSub, sub.text);
  }

  /** Tap on the goal line: all current goals with their progress. */
  private showGoals(): void {
    if (!this.condPop.hidden && this.condKind === 'goals') { this.condPop.hidden = true; this.condTimer = 0; return; }
    this.condKind = 'goals';
    const g = this.g();
    const gs = this.goals(g);
    const rows = gs.length ? gs.map((x) => {
      const seg = 10, on = Math.round(x.k * seg);
      return h('div', { class: 'l-sub goal-row' }, h('span', {}, x.text), h('span', { class: 'g-bar' }, '▰'.repeat(on) + '▱'.repeat(seg - on)));
    }) : [h('div', { class: 'l-sub' }, t('goal.none'))];
    const rewards = g.run.orders.filter((o) => !o.done).map((o) => {
      const rw = orderDef(o.id)?.reward ?? {};
      const what = rw.density ? t('orders.rewardDensity', { n: rw.density }) : rw.rock === 'least' ? t('orders.rewardLeast', { n: rw.n ?? 0 }) : t('orders.rewardRock', { rock: t('rocks.' + rw.rock), n: rw.n ?? 0 });
      return h('div', { class: 'l-sub' }, t('orders.title') + ': ' + t('orders.reward', { what }));
    });
    this.condPop.replaceChildren(h('div', { class: 'label' }, h('div', { class: 'l-head' }, t('goal.all')), ...rows, ...rewards));
    this.condPop.hidden = false;
    this.condTimer = 6;
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
