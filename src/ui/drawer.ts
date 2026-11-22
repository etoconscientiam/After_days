// Bottom drawer (up to half the screen) with five stone tabs: Life, Elements, Upgrades, Epoch, Book;
// plus two views without a tab: Rocks (tap the resources) and Settings (the gear).
// Cards are built once per view and refreshed in place.
import { CFG, SpeciesDef, ElementDef, UpgradeDef, DensityNode, eraOfYear } from '../config';
import type { Game } from '../core/game';
import { totalPop, lifespan } from '../core/life';
import { upgradeEffect } from '../core/stats';
import { foundationPreview, prestigeRaw } from '../core/prestige';
import { $, h, setText, toggle } from './dom';
import { t, fmt, setLang, Lang } from './i18n';
import { chronicleCard } from './chronicle';
import { energyIcon, rockIcon, tabIcon, elementIcon, oxygenIcon, portrait, exhibit } from './icons';
import { habitatPixel, releasePixel, bugPixel } from './pixelIcons';
import { WW } from '../render/common';
import { assetUrl } from '../render/assets';

export type TabId = 'life' | 'elements' | 'upgrades' | 'epoch' | 'book';
export type ViewId = TabId | 'rocks' | 'settings';
const TABS: TabId[] = ['life', 'elements', 'upgrades', 'epoch', 'book'];

export class Drawer {
  el = $('#drawer');
  body = $('#drawer-body');
  titleEl = $('#drawer-title');
  sub = $('#drawer-sub');
  tabbar = $('#tabbar');
  open: ViewId | null = null;
  bookTab: 'chronicle' | 'museum' | 'notes' = 'chronicle';
  qty: 1 | 10 | 0 = 1;
  /** the species whose big card is open in the Life list */
  expanded: string | null = null;
  openNote: string | null = null;
  private sig = '';
  private refreshers: (() => void)[] = [];
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private acc = 0;
  onTarget: (el: ElementDef) => void = () => {};
  onBought: (btn: HTMLElement, zi: number) => void = () => {};
  onExhibit: (kind: 'fossil' | 'relic', id: string) => void = () => {};
  onSettingsChange: () => void = () => {};
  onExport: () => string = () => '';
  onImport: (s: string) => boolean = () => false;
  onReset: () => void = () => {};
  /** Book → Debug: the cheats and debugging panel (the beetle) */
  onDebug: () => void = () => {};
  onToast: (s: string) => void = () => {};
  /** the burial window is open: flood and volcano pulse */
  burialPulse = false;

  constructor(private g: () => Game) {
    for (const id of TABS) {
      const b = h('button', { class: 'tab', onclick: () => this.toggleView(id), 'aria-label': t('tabs.' + id) }, tabIcon(id, 26), h('span', { class: 'tab-label' }, t('tabs.' + id)), h('i', { class: 'dot' })) as HTMLButtonElement;
      this.tabButtons.set(id, b);
      this.tabbar.append(b);
    }
    // swipe down on the grip or the title closes the drawer
    let y0 = -1, dy = 0;
    const start = (e: PointerEvent) => { y0 = e.clientY; dy = 0; this.el.classList.add('dragging'); (e.target as HTMLElement).setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (y0 < 0) return; dy = Math.max(0, e.clientY - y0); this.el.style.transform = `translateY(${dy}px)`; };
    const end = () => { if (y0 < 0) return; this.el.classList.remove('dragging'); this.el.style.transform = ''; if (dy > 50) this.close(); y0 = -1; };
    for (const id of ['#drawer-grip', '#drawer-head']) {
      const el = $(id);
      el.addEventListener('pointerdown', start); el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    }
    const tex = assetUrl('ui/panel_stone.png');
    if (tex) { document.documentElement.style.setProperty('--panel-img', `url(${tex})`); this.el.classList.add('has-texture'); }
  }

  relabel(): void {
    for (const id of TABS) { const b = this.tabButtons.get(id)!; setText(b.querySelector('.tab-label') as HTMLElement, t('tabs.' + id)); b.setAttribute('aria-label', t('tabs.' + id)); }
    this.sig = '';
  }

  toggleView(id: ViewId): void {
    if (this.open === id) { this.close(); return; }
    this.open = id;
    this.openNote = null;
    this.markSeen(id);
    $('#cond-pop').hidden = true;
    $('#rock-pop').hidden = true;
    $('#fieldnote').hidden = true;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    for (const [k, b] of this.tabButtons) toggle(b, 'active', k === id);
    this.sig = '';
    this.refresh(true);
    this.body.scrollTop = 0;
  }

  /** Open the Upgrades on the group of this rock (from the header). */
  openUpgradesAt(rock: string): void {
    if (this.open !== 'upgrades') this.toggleView('upgrades');
    const el = this.body.querySelector(`.group-title[data-rock="${rock}"]`) as HTMLElement | null;
    if (el) { this.body.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
  }

  close(): void {
    this.open = null;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    for (const b of this.tabButtons.values()) b.classList.remove('active');
  }

  /** Drawer height in canvas px (0 when closed) so the world can lift its camera. */
  heightPx(): number {
    const r = this.el.getBoundingClientRect();
    const tab = this.tabbar.getBoundingClientRect();
    const scale = tab.width / WW;
    if (!(scale > 0)) return 0;
    return Math.max(0, (tab.top - r.top) / scale);
  }

  update(dt: number): void {
    this.sampleGain(dt);
    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    this.updateDots();
    if (this.open) this.refresh(false);
  }

  /** What each tab currently offers (ids), to tell what is new since the player last looked. */
  private offers(g: Game): Record<'life' | 'elements' | 'upgrades' | 'density', string[]> {
    return {
      life: CFG.species.filter((sp) => g.speciesUnlocked(sp)).map((sp) => sp.id),
      elements: CFG.elements.filter((el) => g.elementAvailable(el) && (el.world !== 'hot' || g.mods.hot)).map((el) => el.id),
      upgrades: CFG.upgrades.filter((u) => u.currency === 'energy' || g.legacy.discovered.includes(u.currency)).map((u) => u.id),
      density: CFG.density.filter((n) => (n.requires ?? 0) <= g.meta.prestiges).map((n) => n.id),
    };
  }

  /** Opening a tab: everything in it counts as seen. */
  private markSeen(id: ViewId): void {
    const g = this.g();
    const seen = g.legacy.seen;
    const o = this.offers(g);
    const add = (list: string[], ids: string[]) => { for (const x of ids) if (!list.includes(x)) list.push(x); };
    if (id === 'life') add(seen.life, o.life);
    if (id === 'elements') add(seen.elements, o.elements);
    if (id === 'upgrades') add(seen.upgrades, o.upgrades);
    if (id === 'epoch') add(seen.density, o.density);
    if (id === 'book') seen.notes = g.legacy.notes.length;
  }

  /** A dot on a tab = something new appeared there (not "you can afford something" — the amber buttons say that). */
  private updateDots(): void {
    const g = this.g();
    const seen = g.legacy.seen;
    const o = this.offers(g);
    const fresh = (list: string[], ids: string[]) => ids.some((x) => !list.includes(x));
    const map: Record<TabId, boolean> = {
      life: fresh(seen.life, o.life) || !!g.run.mutationOffer,
      elements: fresh(seen.elements, o.elements),
      upgrades: fresh(seen.upgrades, o.upgrades),
      epoch: fresh(seen.density, o.density),
      book: g.legacy.notes.length > seen.notes,
    };
    if (this.open && this.open in map) this.markSeen(this.open);
    for (const id of TABS) toggle(this.tabButtons.get(id)!, 'has-new', map[id] && this.open !== id);
  }

  refresh(force: boolean): void {
    const g = this.g();
    const id = this.open;
    if (!id) return;
    const sig = id + '|' + this.signature(g, id) + g.state.settings.lang + (g.state.settings.detailed ? 'D' : '') + this.qty + (this.openNote ?? '');
    if (force || sig !== this.sig) {
      this.sig = sig;
      this.refreshers = [];
      this.body.replaceChildren();
      this.sub.replaceChildren();
      setText(this.titleEl, id === 'rocks' ? t('rocksView.title') : id === 'settings' ? t('settings.title') : t('tabs.' + id));
      ({ life: () => this.buildLife(g), elements: () => this.buildElements(g), upgrades: () => this.buildUpgrades(g), epoch: () => this.buildEpoch(g),
        book: () => this.buildBook(g), rocks: () => this.buildRocks(g), settings: () => this.buildSettings(g) })[id]();
    }
    for (const f of this.refreshers) f();
  }

  private signature(g: Game, id: ViewId): string {
    const r = g.run;
    switch (id) {
      case 'life': return CFG.species.map((s) => (g.speciesUnlocked(s) ? 1 : 0)).join('') + r.era + (r.mutationOffer ? 'm' + r.mutationEraOffered : '') + (this.expanded ?? '') + g.stats.buyBest + g.stats.shepherdSlots;
      case 'elements': return CFG.elements.map((e) => (g.elementAvailable(e) ? 1 : 0)).join('') + g.stats.autoSlots;
      case 'upgrades': return g.legacy.discovered.join(',') + g.mods.living;
      case 'epoch': return String(g.meta.prestiges);
      case 'book': return this.bookTab + g.legacy.notes.length + '|' + g.legacy.fossils + '|' + g.legacy.chronicle.length + '|' + Object.keys(g.legacy.relics).length;
      case 'rocks': return g.legacy.discovered.join(',');
      case 'settings': return '';
    }
  }

  // ---------- Life ----------
  private buildLife(g: Game): void {
    const r = g.run;
    const seg = h('div', { class: 'seg' });
    for (const [q, label] of [[1, '×1'], [10, '×10'], [0, t('life.qtyMax')]] as const) {
      seg.append(h('button', { class: this.qty === q ? 'on' : '', onclick: () => { this.qty = q; this.sig = ''; } }, label));
    }
    this.sub.append(seg);
    // three zone icons with fill bars and the oxygen bubble; the numbers live in the tooltip
    const zoneRow = h('div', { class: 'zone-row' });
    const ZN = ['water', 'shore', 'land'] as const;
    const fills: HTMLElement[] = [];
    const chips: HTMLElement[] = [];
    for (let zi = 0; zi < 3; zi++) {
      const fill = h('b', {});
      const chip = h('span', { class: 'zone-chip', 'data-tip': '' }, habitatPixel(ZN[zi], 20), h('i', { class: 'zbar' }, fill));
      fills.push(fill); chips.push(chip); zoneRow.append(chip);
    }
    const o2fill = h('b', {});
    const o2 = h('span', { class: 'zone-chip o2', 'data-tip': '' }, oxygenIcon(16), h('i', { class: 'zbar' }, o2fill));
    zoneRow.append(o2);
    this.body.append(zoneRow);
    this.refreshers.push(() => {
      for (let zi = 0; zi < 3; zi++) {
        const used = g.used(zi), cap = g.capacity(zi);
        fills[zi].style.width = (cap > 0 ? Math.min(100, (used / cap) * 100) : 0) + '%';
        toggle(chips[zi], 'full', cap > 0 && used >= cap);
        const tip = t('life.zoneTip', { zone: t('zones.' + ZN[zi]), u: fmt(used, 0), c: cap });
        chips[zi].title = tip; chips[zi].dataset.tip = tip;
      }
      o2fill.style.width = Math.min(100, (r.oxygen / 21) * 100) + '%';
      const tip = t('life.o2tip', { v: fmt(r.oxygen, 1) });
      o2.title = tip; o2.dataset.tip = tip;
    });
    if (r.mutationOffer && g.mods.living) {
      this.body.append(h('div', { class: 'group-title' }, t('mutation.choose')));
      const mg = h('div', { class: 'cards' });
      r.mutationOffer.forEach((o, i) => {
        mg.append(h('button', { class: 'card', onclick: () => { g.chooseMutation(i); this.sig = ''; } }, h('div', { class: 'pic' }, portrait(o.species, 48)), h('div', { class: 'name' }, t('species.' + o.species + '.name')), h('div', { class: 'lock' }, t('mutation.' + o.mutation))));
      });
      this.body.append(mg, h('button', { class: 'stone-btn', style: 'margin:8px 0', onclick: () => { g.rerollMutations(); this.sig = ''; } }, t('mutation.reroll')));
    }
    // Buy the best (Density tree) and the Shepherd slots
    if (g.stats.buyBest > 0) {
      const bb = h('button', { class: 'stone-btn buy-best', title: t('auto.buyBestTip'), onclick: () => { const n = g.buyBest(); if (n) this.onBought(bb as HTMLElement, 1); } }, energyIcon(14), t('auto.buyBest'));
      this.body.append(bb);
    }
    const list = h('div', { class: 'life-list' });
    this.body.append(list);
    // the next species to open: one silhouette row, not a row each
    const next = CFG.species.find((sp) => !g.speciesUnlocked(sp));
    for (const sp of CFG.species) if (g.speciesUnlocked(sp)) list.append(this.speciesRow(g, sp));
    if (next) {
      let hint = t('life.openIn', { era: t('era.' + next.era) });
      if (r.era >= next.era && next.needsOxygen && r.oxygen < next.needsOxygen) hint = t('life.needO2', { v: next.needsOxygen });
      else if (r.era >= next.era && next.unlockAfter) hint = t('life.after', { species: t('species.' + next.unlockAfter + '.name'), n: CFG.unlockAfterPop });
      list.append(h('div', { class: 'life-row locked' }, h('div', { class: 'lr-pic' }, portrait(next.id, 40, true)), h('div', { class: 'lr-mid' }, h('div', { class: 'lr-name' }, hint))));
    }
  }

  private qtyFor(g: Game, sp: SpeciesDef): { n: number; cost: number } {
    const want = this.qty === 0 ? 1000 : this.qty;
    let free = 0;
    free = g.roomUnits(sp);
    const pop = totalPop(g, sp.id);
    let n = 0, cost = 0;
    while (n < Math.min(want, free)) {
      const c = sp.cost * CFG.costGrowth ** (pop + n);
      if (this.qty === 0 && cost + c > g.run.energy) break;
      cost += c; n++;
    }
    if (n === 0) return { n: 1, cost: g.speciesCost(sp) };
    return { n, cost };
  }

  /** One species as a compact row: portrait, name · count, income, buy button. Tap the row for the big card. */
  private speciesRow(g: Game, sp: SpeciesDef): HTMLElement {
    const name = h('span', {});
    const count = h('span', { class: 'lr-count' });
    const eps = h('span', { class: 'lr-eps' });
    const lives = h('span', {});
    const price = h('span', {});
    const btn = h('button', { class: 'buy' }, h('span', { class: 'e' }, energyIcon(14)), price) as HTMLButtonElement;
    const row = h('div', { class: 'life-row' },
      h('div', { class: 'lr-pic' }, portrait(sp.id, 40)),
      h('div', { class: 'lr-mid' }, h('div', { class: 'lr-name' }, name, count),
        h('div', { class: 'lr-sub' }, h('span', { class: 'icon-inline habitat', title: t('zones.' + sp.zone), 'data-tip': t('zones.' + sp.zone) }, habitatPixel(sp.zone, 16)), lives)),
      eps, btn);
    const wrap = h('div', { class: 'life-item' }, row);
    const buyOnce = () => {
      const { n } = this.qtyFor(g, sp);
      let bought = 0;
      for (let i = 0; i < n; i++) if (g.buySpecies(sp.id)) bought++; else break;
      if (bought) { const zi = g.habitatZones(sp)[0]; this.onBought(btn, zi); }
      return bought > 0;
    };
    holdToRepeat(btn, buyOnce);
    // tap on the row (not the button): open or close the big card
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.buy, .habitat')) return;
      this.expanded = this.expanded === sp.id ? null : sp.id;
      this.sig = '';
    });
    if (this.expanded === sp.id) wrap.append(this.speciesCard(g, sp));
    this.refreshers.push(() => {
      const n = totalPop(g, sp.id);
      setText(name, short(t('species.' + sp.id + '.name')));
      setText(count, n > 0 ? ' · ×' + n : '');
      let e = sp.eps * (1 + g.stats.lifeEnergy) * g.stats.energyMul;
      if (g.run.mutations[sp.id] === 'vigor') e *= 1.5;
      setText(eps, '+' + fmt(e) + '/' + t('life.sec'));
      setText(lives, t('life.livesShort', { v: fmt(lifespan(g, sp), 0) }));
      const q = this.qtyFor(g, sp);
      setText(price, (this.qty !== 1 && q.n > 1 ? `×${q.n} · ` : '') + fmt(q.cost));
      const can = g.run.energy >= q.cost && !!g.placeFor(sp);
      btn.disabled = !can;
      toggle(btn, 'ok', can);
      toggle(row, 'afford', can);
    });
    return wrap;
  }

  /** The big card under a row: large portrait, description, numbers, release and the Shepherd's auto switch. */
  private speciesCard(g: Game, sp: SpeciesDef): HTMLElement {
    const stats = h('div', { class: 'sc-stats' });
    const minus = h('button', { class: 'stone-btn sc-release', title: t('life.release'), 'data-tip': t('life.release'), onclick: () => g.releaseSpecies(sp.id) }, releasePixel(20), h('span', {}, t('life.release').split(':')[0])) as HTMLButtonElement;
    const card = h('div', { class: 'species-card' },
      h('div', { class: 'sc-pic' }, portrait(sp.id, 96)),
      h('div', { class: 'sc-body' }, h('div', { class: 'sc-name' }, t('species.' + sp.id + '.name')), h('div', { class: 'sc-desc' }, t('species.' + sp.id + '.desc')), stats));
    const actions = h('div', { class: 'sc-actions' }, minus);
    if (g.stats.shepherdSlots > 0) {
      const used = () => Object.values(g.run.shepherd).filter(Boolean).length;
      const auto = h('button', { class: 'auto-toggle' + (g.run.shepherd[sp.id] ? ' on' : ''), title: t('auto.shepherdTip') }, t('auto.shepherd')) as HTMLButtonElement;
      auto.addEventListener('click', () => {
        const on = !g.run.shepherd[sp.id];
        if (on && used() >= g.stats.shepherdSlots) return;
        g.run.shepherd[sp.id] = on;
        toggle(auto, 'on', on);
      });
      const slots = h('small', {});
      actions.append(auto, slots);
      this.refreshers.push(() => setText(slots, t('auto.slots', { used: used(), max: g.stats.shepherdSlots })));
    }
    card.append(actions);
    this.refreshers.push(() => {
      const n = totalPop(g, sp.id);
      minus.disabled = n <= 0;
      const p = g.run.pop[sp.id];
      stats.replaceChildren(
        h('div', {}, t('life.lives', { v: fmt(lifespan(g, sp), 0) })),
        h('div', {}, '×' + n + (n ? ` (${['water', 'shore', 'land'].map((z, i) => (p[i] ? t('zones.' + z) + ' ' + p[i] : '')).filter(Boolean).join(', ')})` : '')));
    });
    return card;
  }

  // ---------- Elements ----------
  private buildElements(g: Game): void {
    const slots = g.stats.autoSlots;
    const grid = h('div', { class: 'medals' });
    this.body.append(grid);
    for (const el of CFG.elements) {
      if (el.world === 'hot' && !g.mods.hot) continue;
      if (g.mods.shards && (el.id === 'seaAdvance' || el.id === 'seaRetreat')) continue;
      const avail = g.elementAvailable(el);
      const ring = h('i', { class: 'ring' });
      const disc = h('button', { class: 'disc', 'aria-label': t('elements.' + el.id + '.name'), title: t('elements.' + el.id + '.desc') }, elementIcon(el.icon === 'water' ? 'groundwater' : el.icon === 'quake' ? 'earthquake' : el.icon === 'seaUp' ? 'seaAdvance' : el.icon === 'seaDown' ? 'seaRetreat' : el.id, 50), ring);
      const cost = h('span', {});
      const medal = h('div', { class: 'medal' + (avail ? '' : ' locked') }, disc, h('div', { class: 'm-name' }, t('elements.' + el.id + '.name')), h('div', { class: 'm-cost' }, energyIcon(12), cost));
      if (slots > 0 && el.kind === 'surface' && avail) {
        const auto = h('button', { class: 'auto' + (g.run.auto[el.id] ? ' on' : ''), onclick: () => { g.setAuto(el.id, !g.run.auto[el.id]); } }, t('elements.autoShort')) as HTMLButtonElement;
        medal.append(auto);
        this.refreshers.push(() => toggle(auto, 'on', !!g.run.auto[el.id]));
      }
      disc.addEventListener('click', () => {
        if (!avail || !g.canCast(el)) return;
        if (el.kind === 'section') this.onTarget(el);
        else g.cast(el.id);
      });
      grid.append(medal);
      if (!avail) { setText(cost, '—'); medal.title = t('elements.locked', { era: t('era.' + el.era) }); continue; }
      this.refreshers.push(() => {
        const cd = g.run.cooldowns[el.id] ?? 0;
        ring.style.setProperty('--p', cd > 0 ? (1 - cd / el.cooldown).toFixed(3) : '1');
        setText(cost, cd > 0 ? t('elements.cooldown', { v: Math.ceil(cd) }) : fmt(g.elementCost(el)));
        toggle(medal, 'cooling', cd > 0);
        toggle(medal, 'burial', this.burialPulse && (el.id === 'flood' || el.id === 'volcano'));
        toggle(medal, 'ok', g.canCast(el));
      });
    }
  }

  // ---------- Upgrades ----------
  private upgradeRow(g: Game, u: UpgradeDef): HTMLElement {
    const name = h('div', { class: 'r-name' });
    const eff = h('div', { class: 'r-eff' });
    const price = h('span', {});
    const btn = h('button', { class: 'buy' }, u.currency === 'energy' ? h('span', { class: 'e' }, energyIcon(13)) : h('span', { class: 'e' }, rockIcon(u.currency, 14)), price) as HTMLButtonElement;
    const fill = h('b', {});
    const scale = h('div', { class: 'scale' }, fill, ...CFG.milestones.map((m) => h('i', { style: `left:${m}%`, 'data-m': String(m) })));
    const row = h('div', { class: 'row' }, h('div', { class: 'r-ico' }, u.currency === 'energy' ? energyIcon(26) : rockIcon(u.currency, 28)), name, h('div', { class: 'r-act' }, btn), eff, scale);
    holdToRepeat(btn, () => g.buyUpgrade(u.id));
    this.refreshers.push(() => {
      const lvl = g.upgradeLevel(u.id);
      name.replaceChildren(t('upgrades.' + u.id + '.name'), h('small', {}, lvl ? String(lvl) : ''));
      const cur = lvl > 0 ? upgradeEffect(lvl, u.value, u.kind, !!u.milestones) : 0;
      const curStr = lvl > 0 ? (u.kind === 'mul' ? ` · ×${fmt(cur, 2)}` : u.stat.endsWith('Add') || u.stat === 'geoHeat' || u.stat === 'kMax' ? ` · +${fmt(cur, 1)}` : ` · +${fmt(cur * 100, 0)}%`) : '';
      setText(eff, t('upgrades.' + u.id + '.desc') + curStr);
      const cost = g.upgradeCost(u.id);
      setText(price, fmt(cost));
      const can = g.currency(u.currency) >= cost;
      btn.disabled = !can;
      toggle(btn, 'ok', can);
      toggle(row, 'afford', can);
      fill.style.width = Math.min(100, lvl) + '%';
      const next = CFG.milestones.find((m) => m > lvl);
      scale.querySelectorAll('i').forEach((i) => toggle(i as HTMLElement, 'next', u.milestones === true && Number((i as HTMLElement).dataset.m) === next));
      scale.style.display = u.milestones ? '' : 'none';
    });
    return row;
  }

  private buildUpgrades(g: Game): void {
    this.body.append(h('div', { class: 'group-title' }, energyIcon(18), t('upgrades.awakening')));
    for (const u of CFG.upgrades.filter((x) => x.currency === 'energy')) this.body.append(this.upgradeRow(g, u));
    const byRock = new Map<string, UpgradeDef[]>();
    for (const u of CFG.upgrades.filter((x) => x.currency !== 'energy')) byRock.set(u.currency, [...(byRock.get(u.currency) ?? []), u]);
    const locked: [string, UpgradeDef[]][] = [];
    for (const [rock, list] of byRock) {
      if (!g.legacy.discovered.includes(rock)) { locked.push([rock, list]); continue; }
      const stock = h('small', {});
      this.body.append(h('div', { class: 'group-title', 'data-rock': rock }, rockIcon(rock, 20), t('rocks.' + rock), stock));
      this.refreshers.push(() => setText(stock, fmt(g.run.rocks[rock] ?? 0, 0)));
      for (const u of list) this.body.append(this.upgradeRow(g, u));
    }
    for (const [rock, list] of locked) {
      for (const u of list) {
        this.body.append(h('div', { class: 'row dim' }, h('div', { class: 'r-ico' }, h('span', { class: 'silhouette' }, rockIcon(rock, 26))), h('div', { class: 'r-name' }, t('upgrades.' + u.id + '.name')), h('div', { class: 'r-act' }),
          h('div', { class: 'hint' }, t('upgrades.need', { rock: t('rocks.' + rock) }) + '. ' + t('upgrades.howTo', { how: t('rockHow.' + rock) }))));
      }
    }
    if (g.mods.living) {
      this.body.append(h('div', { class: 'group-title' }, t('upgrades.ranks')));
      for (const rk of g.legacy.discovered) {
        const price = h('span', {});
        const btn = h('button', { class: 'buy', onclick: () => g.rankUp(rk) }, price) as HTMLButtonElement;
        const name = h('div', { class: 'r-name' });
        this.body.append(h('div', { class: 'row' }, h('div', { class: 'r-ico' }, rockIcon(rk, 26)), name, h('div', { class: 'r-act' }, btn), h('div', { class: 'r-eff' }, '+25%')));
        this.refreshers.push(() => {
          const lvl = g.run.rockRanks[rk] ?? 0;
          name.replaceChildren(t('rocks.' + rk), h('small', {}, ['', 'I', 'II', 'III', 'IV', 'V'][lvl]));
          const c = g.rankCost(rk);
          setText(price, lvl >= 5 ? '—' : fmt(c));
          const can = lvl < 5 && (g.run.rocks[rk] ?? 0) >= c;
          btn.disabled = !can; toggle(btn, 'ok', can);
        });
      }
    }
  }

  // ---------- Epoch ----------
  private buildEpoch(g: Game): void {
    const P = CFG.B.prestige;
    const diagram = document.createElement('canvas');
    diagram.width = 82; diagram.height = 120;
    const gain = h('div', { class: 'gain' });
    const note = h('small', {});
    const later = h('small', { class: 'gain-later' });
    gain.append(note, later);
    this.body.append(h('div', { class: 'epoch-top' }, diagram, h('div', {}, gain)));
    const fill = h('i', { class: 'fill' });
    const label = h('span', {}, t('epoch.button'));
    const btn = h('button', { class: 'hold' }, fill, label) as HTMLButtonElement;
    const hint = h('div', { class: 'hold-hint' }, t('epoch.holdHint'));
    this.body.append(btn, hint);
    holdToConfirm(btn, fill, 1000, () => { if (g.prestige()) this.sig = ''; });
    const extra = h('div', { class: 'meta-line detail-only' });
    this.body.append(extra);
    this.refreshers.push(() => {
      const v = g.prestigeGain();
      gain.firstChild && gain.firstChild !== note ? (gain.firstChild.textContent = t('epoch.gainBig', { v })) : gain.prepend(document.createTextNode(t('epoch.gainBig', { v })));
      // the same numbers the shift will use (core/prestige.ts foundationPreview)
      const fp = foundationPreview(g);
      const frac = fp.share;
      setText(later, this.shiftHint(g, v));
      setText(note, v < 1 ? t('epoch.notYet') : fp.add >= 0.05
        ? t('epoch.foundationAdd', { v: fmt(fp.add, 1), p: fmt(Math.max(1, frac * 100), 0) })
        : t('epoch.foundationNone', { k: CFG.B.physics.foundationK }));
      btn.disabled = v < 1 || g.state.phase !== 'play';
      toggle(btn, 'ok', v >= 1 && v >= g.meta.density * P.glowAt);
      drawColumn(diagram, g, frac);
      if (g.state.settings.detailed) setText(extra, `${t('epoch.mass', { v: fmt(g.run.compactMass) })} · ${t('epoch.foundation', { v: fmt(g.meta.foundation, 1), p: fmt(g.meta.foundation * CFG.B.physics.foundationP * (1 + g.stats.foundation), 1) })}`);
    });
    const have = h('div', { class: 'group-title' });
    this.body.append(have);
    this.refreshers.push(() => have.replaceChildren(t('epoch.tree'), h('small', { style: 'color:var(--density)' }, '◆ ' + fmt(g.meta.density, 0))));
    for (const n of CFG.density) this.body.append(this.densityRow(g, n));
  }

  /** Samples of the raw gain over real time, to forecast the shift (taken every 2 s even with the drawer closed). */
  private gainHist: { t: number; v: number }[] = [];
  private histAcc = 0;
  private sampleGain(dt: number): void {
    this.histAcc += dt;
    if (this.histAcc < 2) return;
    this.histAcc = 0;
    const g = this.g();
    const now = performance.now() / 1000;
    this.gainHist.push({ t: now, v: prestigeRaw(g) });
    while (this.gainHist.length > 2 && now - this.gainHist[0].t > 120) this.gainHist.shift();
    // a shift (or a new world) resets the run: start over
    const n = this.gainHist.length;
    if (n > 1 && this.gainHist[n - 1].v < this.gainHist[n - 2].v * 0.5) this.gainHist = [this.gainHist[n - 1]];
  }

  /** "In ≈ 4 min it will be +5" — from the current pace of compaction; or "hardly grows any more". */
  private shiftHint(g: Game, now: number): string {
    const H = this.gainHist;
    if (H.length < 4) return '';
    const a = H[0], b = H[H.length - 1];
    const rate = (b.v - a.v) / Math.max(1, b.t - a.t);            // gain per real second
    const target = Math.max(now + 2, Math.floor(b.v) + 2);
    if (rate <= 0 || rate * 600 < 1) return now >= 1 ? t('epochHint.flat') : '';
    const sec = (target - b.v) / rate;
    if (sec > 3 * 3600) return now >= 1 ? t('epochHint.flat') : '';
    const tt = sec < 90 ? t('epochHint.sec', { v: Math.max(10, Math.round(sec / 10) * 10) }) : sec < 5400 ? t('epochHint.min', { v: Math.round(sec / 60) }) : t('epochHint.hour', { v: fmt(sec / 3600, 1) });
    return t('epochHint.later', { t: tt, v: target });
  }

  private densityRow(g: Game, n: DensityNode): HTMLElement {
    const name = h('div', { class: 'r-name' });
    const price = h('span', {});
    const btn = h('button', { class: 'buy', onclick: () => g.buyDensity(n.id) }, price) as HTMLButtonElement;
    const row = h('div', { class: 'row' }, h('div', { class: 'r-ico', style: 'color:var(--density);font-size:32px;line-height:1' }, '◆'), name, h('div', { class: 'r-act' }, btn), h('div', { class: 'r-eff' }, t('epoch.' + n.id + '.desc')));
    this.refreshers.push(() => {
      const lvl = g.meta.tree[n.id] ?? 0;
      const locked = (n.requires ?? 0) > g.meta.prestiges;
      name.replaceChildren(t('epoch.' + n.id + '.name'), h('small', { style: 'color:var(--density)' }, locked ? t('auto.requires', { n: n.requires ?? 0 }) : `${lvl}/${n.max}`));
      toggle(row, 'dim', locked);
      if (locked) { setText(price, '◇'); btn.disabled = true; toggle(btn, 'ok', false); toggle(row, 'afford', false); btn.title = t('auto.requires', { n: n.requires ?? 0 }); return; }
      const maxed = lvl >= n.max, cost = g.densityCost(n.id);
      setText(price, maxed ? '✓' : '◆ ' + fmt(cost, 0));
      const can = !maxed && g.meta.density >= cost;
      btn.disabled = !can; toggle(btn, 'ok', can); toggle(row, 'afford', can);
    });
    return row;
  }

  // ---------- Book ----------
  private buildBook(g: Game): void {
    const seg = h('div', { class: 'seg' });
    for (const id of ['chronicle', 'museum', 'notes'] as const) seg.append(h('button', { class: this.bookTab === id ? 'on' : '', onclick: () => { this.bookTab = id; this.openNote = null; this.sig = ''; } }, t('book.' + id)));
    this.sub.append(seg);
    if (this.bookTab === 'chronicle') {
      const list = g.legacy.chronicle.slice().reverse();
      if (!list.length) this.body.append(h('div', { class: 'meta-line' }, t('book.chronicleEmpty')));
      const byEra = new Map<number, typeof list>();
      for (const e of list) { const era = e.data.horizon ? -1 : eraOfYear((e.y0 + e.y1) / 2); byEra.set(era, [...(byEra.get(era) ?? []), e]); }
      for (const [era, entries] of [...byEra.entries()].sort((a, b) => b[0] - a[0])) {
        this.body.append(h('div', { class: 'chron-era' }, era < 0 ? '⟡' : t('era.' + era)));
        this.body.append(h('div', { class: 'chron-list' }, ...entries.map((e) => chronicleCard(e, false))));
      }
    } else if (this.bookTab === 'museum') {
      const fossilShelf = h('div', { class: 'shelf' });
      for (const sp of CFG.species.filter((s) => s.death.bone)) {
        const m = g.legacy.museum[sp.id];
        const got = !!m && m.common + m.rare > 0;
        const niche = h('div', { class: 'niche' + (got ? '' : ' empty') });
        if (got) { const ex = exhibit('fossil', sp.id, (m?.rare ?? 0) > 0); ex.addEventListener('click', () => this.onExhibit('fossil', sp.id)); niche.append(ex); }
        fossilShelf.append(niche);
      }
      const relicShelf = h('div', { class: 'shelf' });
      for (const rel of CFG.relics) {
        const got = (g.legacy.relics[rel.id] ?? 0) > 0;
        const niche = h('div', { class: 'niche' + (got ? '' : ' empty') });
        if (got) { const ex = exhibit('relic', rel.id); ex.addEventListener('click', () => this.onExhibit('relic', rel.id)); niche.append(ex); }
        relicShelf.append(niche);
      }
      this.body.append(h('div', { class: 'shelves' }, h('div', { class: 'shelf-label' }, t('book.fossilsShelf')), fossilShelf, h('div', { class: 'shelf-label' }, t('book.relicsShelf')), relicShelf));
    } else {
      if (this.openNote) {
        const n = CFG.notes.find((x) => x.id === this.openNote)!;
        const text = h('div', {});
        const raw = t('notes.' + n.id + '.text', { phrase: n.todoKey ? t(n.todoKey) : '' });
        raw.split('{lost}').forEach((part, i, arr) => { text.append(part); if (i < arr.length - 1) text.append(h('span', { class: 'lost' })); });
        const foot = t('notes.' + n.id + '.footer');
        const art = assetUrl(`ui/media/${n.medium}.png`);
        const doc = h('div', { class: `doc ${n.medium}` + (art ? ' with-art' : ''), style: art ? `background-image:url(${art})` : '' }, text, foot.startsWith('notes.') ? null : h('div', { class: 'foot' }, foot));
        this.body.append(h('button', { class: 'stone-btn', style: 'margin-bottom:10px', onclick: () => { this.openNote = null; } }, '‹'), doc);
        return;
      }
      if (!g.legacy.notes.length) this.body.append(h('div', { class: 'meta-line' }, t('book.notesEmpty')));
      const list = h('div', { class: 'media-list' });
      for (const n of CFG.notes) {
        const has = g.legacy.notes.includes(n.id);
        list.append(h('button', { class: 'media-item' + (has ? '' : ' locked'), disabled: !has, onclick: () => { this.openNote = n.id; } },
          h('span', { class: `sw doc ${n.medium}`, style: 'padding:0;margin:0' }),
          h('span', {}, h('div', { class: 'mi-text' }, has ? t('book.media.' + n.medium) : '—'), h('div', { class: 'mi-sub' }, has ? t('book.type.' + n.type) : ''))));
      }
      this.body.append(list);
    }
    // the debug & cheats panel (the beetle) lives at the bottom of the Book
    this.body.append(h('button', { class: 'stone-btn book-debug', onclick: () => this.onDebug() }, bugPixel(16), t('book.debug')));
  }

  // ---------- Rocks & Settings ----------
  private buildRocks(g: Game): void {
    const grid = h('div', { class: 'rocks-grid' });
    for (const rk of g.legacy.discovered) {
      const n = h('b', {});
      grid.append(h('div', { class: 'rock-tile' }, rockIcon(rk, 32), n, h('span', {}, t('rocks.' + rk))));
      this.refreshers.push(() => setText(n, fmt(g.run.rocks[rk] ?? 0, 0)));
    }
    this.body.append(grid);
  }

  private buildSettings(g: Game): void {
    const s = g.state.settings;
    const lang = h('select', {}, h('option', { value: 'en' }, 'English'), h('option', { value: 'ru' }, 'Русский')) as HTMLSelectElement;
    lang.value = s.lang;
    lang.addEventListener('change', () => { s.lang = lang.value as Lang; setLang(s.lang); this.onSettingsChange(); this.sig = ''; });
    const range = (key: 'music' | 'sfx') => {
      const r = h('input', { type: 'range', min: '0', max: '1', step: '0.05' }) as HTMLInputElement;
      r.value = String(s[key]);
      r.addEventListener('input', () => { s[key] = +r.value; this.onSettingsChange(); });
      return r;
    };
    const check = (val: boolean, on: (v: boolean) => void) => {
      const c = h('input', { type: 'checkbox' }) as HTMLInputElement;
      c.checked = val; c.style.accentColor = 'var(--amber)';
      c.addEventListener('change', () => { on(c.checked); this.onSettingsChange(); });
      return c;
    };
    const quality = h('select', {}, h('option', { value: 'high' }, t('settings.high')), h('option', { value: 'low' }, t('settings.low'))) as HTMLSelectElement;
    quality.value = s.quality;
    quality.addEventListener('change', () => { s.quality = quality.value as any; this.onSettingsChange(); });
    const ta = h('textarea', { class: 'set-ta', placeholder: t('settings.importPlaceholder') }) as HTMLTextAreaElement;
    const resetFill = h('i', { class: 'fill' });
    const reset = h('button', { class: 'stone-btn danger' }, resetFill, h('span', { style: 'position:relative' }, t('settings.resetHold'))) as HTMLButtonElement;
    holdToConfirm(reset, resetFill, 2000, () => this.onReset());
    this.body.append(
      h('div', { class: 'set-row' }, t('settings.language'), lang),
      h('div', { class: 'set-row' }, t('settings.music'), range('music')),
      h('div', { class: 'set-row' }, t('settings.sfx'), range('sfx')),
      h('div', { class: 'set-row' }, t('settings.mute'), check(s.muted, (v) => (s.muted = v))),
      h('div', { class: 'set-row' }, t('settings.quality'), quality),
      h('div', { class: 'set-row' }, t('settings.detailed'), check(s.detailed, (v) => (s.detailed = v))),
      h('div', { class: 'set-row' }, t('settings.integer'), check(s.integerScale, (v) => (s.integerScale = v))),
      ta,
      h('div', { class: 'btns' },
        h('button', { class: 'stone-btn', onclick: async () => { const str = this.onExport(); ta.value = str; ta.select(); try { await navigator.clipboard.writeText(str); this.onToast(t('settings.copied')); } catch { /* text stays selected */ } } }, t('settings.export')),
        h('button', { class: 'stone-btn', onclick: () => { if (ta.value.trim()) this.onToast(t(this.onImport(ta.value) ? 'toast.imported' : 'toast.importFailed')); } }, t('settings.import'))),
      h('div', { class: 'btns' }, reset),
    );
  }
}

/** Tap = one; hold = again and again, faster and faster. */
function holdToRepeat(btn: HTMLButtonElement, act: () => boolean): void {
  let timer = 0, delay = 0;
  const stop = () => { clearTimeout(timer); timer = 0; btn.classList.remove('pressed'); };
  const tick = () => { if (btn.disabled || !act()) { stop(); return; } delay = Math.max(40, delay * 0.8); timer = window.setTimeout(tick, delay); };
  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    btn.classList.add('pressed');
    act();
    delay = 220;
    timer = window.setTimeout(tick, 420);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
}

/** The action happens only after holding for `ms` (the fill grows); no confirmation window. */
function holdToConfirm(btn: HTMLButtonElement, fill: HTMLElement, ms: number, act: () => void): void {
  let t0 = 0, raf = 0;
  const stop = () => { cancelAnimationFrame(raf); t0 = 0; fill.style.width = '0'; };
  const frame = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    fill.style.width = k * 100 + '%';
    if (k >= 1) { stop(); act(); return; }
    raf = requestAnimationFrame(frame);
  };
  btn.addEventListener('pointerdown', (e) => { if (btn.disabled) return; e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(frame); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
}

const short = (s: string) => (s.includes('—') ? s.split('—')[1].trim() : s);

/** Small picture of the column: layers above, the part that becomes foundation outlined in density violet. */
function drawColumn(cv: HTMLCanvasElement, g: Game, frac: number): void {
  const x = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  x.fillStyle = '#12100e'; x.fillRect(0, 0, W, H);
  const src = (window as any).__strata?.renderer?.section;
  if (src && src.strataH > 0) {
    // each row of the section, averaged across its width: the column reads as horizontal bands
    const sh = src.strataH;
    const d = src.ctx.getImageData(0, 0, src.canvas.width, sh).data;
    const sw = src.canvas.width;
    const hh = H - 22;
    for (let yy = 0; yy < hh; yy++) {
      const row = Math.min(sh - 1, Math.floor((yy / hh) * sh));
      let r = 0, gg = 0, b = 0;
      for (let xx = 0; xx < sw; xx += 3) { const o = (row * sw + xx) * 4; r += d[o]; gg += d[o + 1]; b += d[o + 2]; }
      const n = Math.ceil(sw / 3);
      x.fillStyle = `rgb(${r / n | 0},${gg / n | 0},${b / n | 0})`;
      x.fillRect(4, 4 + yy, W - 8, 1);
    }
  }
  const fh = (H - 22) * frac;
  x.fillStyle = 'rgba(185,166,232,0.28)'; x.fillRect(4, H - 18 - fh, W - 8, fh);
  x.strokeStyle = '#B9A6E8'; x.setLineDash([3, 2]); x.strokeRect(4.5, H - 18 - fh + 0.5, W - 9, fh);
  x.setLineDash([]);
  x.fillStyle = '#2a2430'; x.fillRect(4, H - 18, W - 8, 6);
  x.fillStyle = '#F2B54A';
  for (let i = 0; i < g.meta.foundationLines.length && i < 5; i++) x.fillRect(4, H - 17 + i, W - 8, 1);
  x.fillStyle = '#3a3e4c'; x.fillRect(4, H - 12, W - 8, 8);
  x.fillStyle = '#F2B54A'; x.beginPath(); x.arc(W / 2, H - 15, 2.2, 0, 7); x.fill();
}
