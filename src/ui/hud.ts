// Header: the countdown (the main storyteller), ⟡, a thin era line, era name (tap for the condition), speed;
// resources: Energy large plus the last three rocks; notifications (at most two, merged when alike).
import { CFG } from '../config';
import type { Game } from '../core/game';
import { $, h, setText, toggle } from './dom';
import { t, fmt } from './i18n';
import { energyIcon, rockIcon, tabIcon } from './icons';
import { orderDef, orderProgress } from '../core/orders';
import { leverSpecies, suitability, needs } from '../core/niche';
import { needText, shortName } from './nicheText';

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
    toggle(this.speed, 'hurry', !atWall && g.hurrying());
    if (atWall) setText(this.speed, t('hud.wall'));
    else {
      const yps = g.yps();
      const sp = yps >= 1 ? t('hud.yps', { v: fmt(yps, yps < 10 ? 1 : 0) }) : yps * 52 >= 1 ? t('hud.wps', { v: fmt(yps * 52, 1) }) : t('hud.dps', { v: fmt(yps * 365, 1) });
      // the goal of the era is met: time hurries to its end (said, so the speed-up is not a mystery)
      setText(this.speed, g.hurrying() ? t('hud.hurry', { v: sp }) : sp);
    }
    const k = Math.max(0, Math.min(1, (r.year - era.start) / (era.end - era.start)));
    this.eraFill.style.width = (k * 100).toFixed(1) + '%';
    this.sym.style.animationDuration = r.boost > 0 ? '1.2s' : '4s';
    setText(this.energyVal, fmt(r.energy));
    setText(this.energyRate, t('hud.perSec', { v: fmt(g.incomePerSec() + g.absorbRate) }));
    this.drawSpecials(g);
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
    // the goal line, else the era line, else (drawer open: both hidden) the top row
    const eraLine = $('#era-line');
    const under = !this.goal.hidden && this.goal.offsetParent ? this.goal : eraLine.offsetParent ? eraLine : $('#top-row');
    const b = (under.getBoundingClientRect().bottom - u.top) / k;
    this.notes.style.top = Math.round(b + 6) + 'px';
    this.bottomUI = b;
  }
  /** Lowest point of the header text, in UI units (the open sky starts below it). */
  bottomUI = 132;

  /** The counters of the special materials the thing has got (or whose rocks have formed), in a fixed order;
   *  each counts what arrived — the matter still flying from the thing is not counted yet. */
  private drawSpecials(g: Game, also = ''): void {
    const r = g.run;
    const known = CFG.B.sand.specials.order.filter((id) => id === also || g.specialKnown(id) || (this.pending[id] ?? 0) > 0);
    const sig = known.join(',') + g.state.settings.lang;
    if (sig !== this.rockSig) {
      this.rockSig = sig;
      this.rocks.replaceChildren(...known.map((rk) => h('span', { class: 'rock-chip fly-in', 'data-rock': rk }, rockIcon(rk, 18), h('span', {}))));
    }
    this.rocks.querySelectorAll<HTMLElement>('.rock-chip').forEach((chip) => {
      const id = chip.dataset.rock!;
      setText(chip.lastChild as HTMLElement, fmt(Math.max(0, Math.floor((r.rocks[id] ?? 0) - (this.pending[id] ?? 0))), 0));
    });
  }

  /** special materials on their way from the thing to their counters (not shown yet) */
  private pending: Record<string, number> = {};

  /** Where the counter of special material id is, in world pixels (for the matter flying to it), or null. */
  specialPoint(id: string, canvas: DOMRect): { x: number; y: number } | null {
    if (!CFG.B.sand.specials.order.includes(id)) return null;
    // the counter appears the moment the first of it is got; place it now so the matter has somewhere to fly
    this.pending[id] ??= 0;
    this.drawSpecials(this.g(), id);
    const chip = this.rocks.querySelector<HTMLElement>(`.rock-chip[data-rock="${id}"]`);
    if (!chip || !chip.offsetParent) return null;
    const r = (chip.firstChild as HTMLElement).getBoundingClientRect();
    return { x: ((r.left + r.width / 2 - canvas.left) / canvas.width) * 180, y: ((r.top + r.height / 2 - canvas.top) / canvas.height) * 320 };
  }

  /** Matter of a special material set off from the thing to its counter: it is counted when it arrives. */
  specialSend(id: string, n: number): void { this.pending[id] = (this.pending[id] ?? 0) + n; }

  specialArrive(id: string, n: number): void {
    this.pending[id] = Math.max(0, (this.pending[id] ?? 0) - n);
    const chip = this.rocks.querySelector<HTMLElement>(`.rock-chip[data-rock="${id}"]`);
    if (chip) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
  }

  /** The active order (if any) and the era condition. */
  goals(g: Game): { text: string; k: number; sub?: boolean }[] {
    const out: { text: string; k: number; sub?: boolean }[] = [];
    // the era's condition comes first while it is not met (it is the way on, and its lever is shown under it);
    // the orders follow (all of them in the list behind a tap on the goal)
    // the very first goal: bury the thing up to the compaction line (until the first row goes into it)
    if (g.state.phase === 'play' && g.run.sink.rows === 0) {
      const grid = g.grid, line = g.lineRow();
      let mean = 0;
      for (let x = 0; x < grid.W; x++) mean += grid.surf[x];
      mean /= grid.W;
      const k = Math.max(0, Math.min(1, (grid.floor - mean) / Math.max(1, grid.floor - line)));
      out.push({ text: t('goal.bury', { p: fmt(k * 100, 0) }), k });
    }
    const eraOpen = g.state.phase === 'play' && g.run.era < 8 && g.eraConditionProgress() < 1;
    if (eraOpen) out.push({ text: this.condString(g), k: g.eraConditionProgress(), sub: true });
    for (const o of g.run.orders) {
      if (o.done) continue;
      const pr = orderProgress(g, o);
      out.push({ text: `${t('orders.' + o.id, { n: CFG.orders.pool.find((d) => d.id === o.id)?.n ?? 0 })} — ${fmt(pr.have, 0)}/${fmt(pr.need, 0)}`, k: pr.have / Math.max(1, pr.need) });
    }
    if (!eraOpen && g.state.phase === 'play' && g.run.era < 8) out.push({ text: this.condString(g), k: g.eraConditionProgress(), sub: true });
    return out;
  }

  /** Open the Life tab on a species (main wires it to the drawer). */
  onLever: ((id: string) => void) | null = null;

  /** The lever of the era goal in words: the species that moves it and what its niche lacks now. */
  leverText(g: Game): string {
    const sp = leverSpecies(g);
    if (!sp) return '';
    const name = shortName(t('species.' + sp.id + '.name'));
    const lack = needText(g, sp, true, true);
    const miss = needs(g, sp).find((n) => n.kind === 'mix' && n.ok < CFG.B.niche.openAt) ?? needs(g, sp).find((n) => n.kind === 'mix' && n.ok < 1);
    if (lack) return t('goal.leverNeeds', { s: name, need: lack, how: miss ? t('niche.how.' + miss.key) : t('niche.strengthenShort') });
    return t('goal.leverFit', { s: name, v: fmt(suitability(g, sp) * 100, 0) });
  }

  private updateGoal(g: Game): void {
    const gs = this.goals(g);
    const main = gs[0];
    this.goal.hidden = !main || g.state.phase !== 'play';
    if (!main) return;
    setText(this.goalMain, '◆ ' + main.text);
    const seg = 8, on = Math.round(main.k * seg);
    this.goalBar.replaceChildren(...segBar(on, seg));
    // under the era goal: its lever (what to strengthen or pile, and what the niche lacks)
    const lever = main.sub ? this.leverText(g) : '';
    this.goalSub.hidden = !lever;
    toggle(this.goalSub, 'lever', !!lever);
    if (lever) setText(this.goalSub, '→ ' + lever);
  }

  /** Tap on the goal line: all current goals with their progress. */
  private showGoals(): void {
    if (!this.condPop.hidden && this.condKind === 'goals') { this.condPop.hidden = true; this.condTimer = 0; return; }
    this.condKind = 'goals';
    const g = this.g();
    const gs = this.goals(g);
    const rows = gs.length ? gs.map((x) => {
      const seg = 10, on = Math.round(x.k * seg);
      return h('div', { class: 'l-sub goal-row' }, h('span', {}, x.text), h('span', { class: 'g-bar' }, ...segBar(on, seg)));
    }) : [h('div', { class: 'l-sub' }, t('goal.none'))];
    const rewards = g.run.orders.filter((o) => !o.done).map((o) => {
      const rw = orderDef(o.id)?.reward ?? {};
      const what = rw.density ? t('orders.rewardDensity', { n: rw.density }) : rw.rock === 'least' ? t('orders.rewardLeast', { n: rw.n ?? 0 }) : t('orders.rewardRock', { rock: t('rocks.' + rw.rock), n: rw.n ?? 0 });
      return h('div', { class: 'l-sub' }, t('orders.title') + ': ' + t('orders.reward', { what }));
    });
    // the lever: the species that moves the era goal, what it lacks, and a way to it
    const sp = leverSpecies(g);
    const lever = sp ? [h('div', { class: 'l-sub goal-lever' }, '→ ' + this.leverText(g)),
      h('button', { class: 'stone-btn goal-open', onclick: () => { this.condPop.hidden = true; this.onLever?.(sp.id); } }, t('goal.open', { s: shortName(t('species.' + sp.id + '.name')) }))] : [];
    this.condPop.replaceChildren(h('div', { class: 'label' }, h('div', { class: 'l-head' }, t('goal.all')), ...rows, ...lever, ...rewards));
    this.condPop.hidden = false;
    this.condTimer = sp ? 10 : 6;
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
    setTimeout(() => p.el.remove(), 820);
  }
}

/** A progress bar of pixel cells (the font has no ▰▱: they fell back to a smooth system face). */
function segBar(on: number, seg: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let i = 0; i < seg; i++) out.push(h('i', { class: i < on ? 'on' : '' }));
  return out;
}
