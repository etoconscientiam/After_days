// HUD: the countdown (main storyteller), era, progress, speed, resources; toasts.
import { CFG } from '../config';
import type { Game } from '../core/game';
import { $, h, setText, toggle } from './dom';
import { t, fmt, fmtInt } from './i18n';

export class Hud {
  private cdNum = $('#cd-num');
  private cdSym = $('#cd-sym');
  private countdown = $('#countdown');
  private eraName = $('#era-name');
  private speed = $('#speed');
  private eraFill = $('#era-fill');
  private condFill = $('#cond-fill');
  private condText = $('#cond-text');
  private energyVal = $('#energy-val');
  private energyRate = $('#energy-rate');
  private rocks = $('#rocks');
  private density = $('#density');
  private toasts = $('#toasts');
  private rockChips = new Map<string, HTMLElement>();

  update(g: Game, dt: number): void {
    const r = g.run;
    const phase = g.state.phase;
    const finding = phase === 'newWorld' || phase === 'end' || (phase === 'temple' && g.state.templeProgress > 0.85);
    toggle(this.countdown, 'finding', finding);
    toggle(this.countdown.parentElement!.parentElement!, 'finding', finding);
    if (finding) {
      setText(this.cdNum, t('findingYear', { n: 1 }));
      setText(this.cdSym, '');
    } else {
      setText(this.cdNum, fmtInt(Math.max(0, Math.ceil(CFG.zeroYear - r.year))));
      setText(this.cdSym, t('countdownSymbol'));
    }
    setText(this.eraName, t('era.' + r.era));
    const era = g.eraDef();
    const atWall = r.year >= era.end - 1e-6 && !g.eraConditionMet() && phase === 'play';
    toggle(this.speed, 'wall', atWall);
    if (phase !== 'play') setText(this.speed, '');
    else if (atWall) setText(this.speed, t('hud.wall'));
    else {
      const yps = g.yps();
      let s: string;
      if (yps >= 1) s = t('hud.yps', { v: fmt(yps, yps < 10 ? 1 : 0) });
      else if (yps * 52 >= 1) s = t('hud.wps', { v: fmt(yps * 52, 1) });
      else s = t('hud.dps', { v: fmt(yps * 365, 1) });
      setText(this.speed, (r.boost > 0 ? '» ' : '') + s);
    }
    const k = Math.max(0, Math.min(1, (r.year - era.start) / (era.end - era.start)));
    this.eraFill.style.width = (k * 100).toFixed(1) + '%';
    this.condFill.style.width = (g.eraConditionProgress() * 100).toFixed(1) + '%';
    setText(this.condText, this.condString(g));

    setText(this.energyVal, fmt(r.energy));
    setText(this.energyRate, t('hud.perSec', { v: fmt(g.incomePerSec()) }));

    // rocks: only discovered ones, small icons with numbers
    for (const rk of CFG.rocks) {
      const known = g.legacy.discovered.includes(rk.id);
      let chip = this.rockChips.get(rk.id);
      if (!known) { if (chip) chip.style.display = 'none'; continue; }
      if (!chip) {
        chip = h('span', { class: 'rock-chip', title: t('rocks.' + rk.id) }, h('i', { class: 'rock-ico', style: `background:${rk.icon}` }), h('span', {}));
        this.rockChips.set(rk.id, chip);
        this.rocks.append(chip);
      }
      chip.style.display = '';
      chip.title = t('rocks.' + rk.id);
      setText(chip.lastChild as HTMLElement, fmt(r.rocks[rk.id] ?? 0, 0));
    }
    const dens = g.meta.density;
    this.density.hidden = dens <= 0 && g.meta.prestiges === 0;
    setText(this.density, '◆ ' + fmt(dens, 0));
    this.density.title = t('hud.density');
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

  toast(text: string | Node, color?: string): void {
    const el = h('div', { class: 'toast' }, color ? h('i', { style: `background:${color}` }) : null, text);
    this.toasts.prepend(el);
    while (this.toasts.children.length > 5) this.toasts.lastChild!.remove();
    setTimeout(() => el.remove(), 4300);
  }
}
