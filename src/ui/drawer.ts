// Bottom drawer with tabs: Life, Elements, Upgrades, Epoch, Book. Cards are built once and updated in place.
import { CFG, SpeciesDef, ElementDef, UpgradeDef, DensityNode } from '../config';
import type { Game } from '../core/game';
import { totalPop, lifespan } from '../core/life';
import { upgradeEffect } from '../core/stats';
import { $, h, setText, toggle, speciesIcon, elementIcon, rockSwatch, energyIcon, densityIcon, fossilIcon, rockColor } from './dom';
import { t, fmt, fmtInt, fmtTime } from './i18n';
import { chronicleText } from './chronicle';

export type TabId = 'life' | 'elements' | 'upgrades' | 'epoch' | 'book';
const TABS: { id: TabId; ico: string }[] = [
  { id: 'life', ico: '❦' }, { id: 'elements', ico: '☂' }, { id: 'upgrades', ico: '▲' }, { id: 'epoch', ico: '◆' }, { id: 'book', ico: '❧' },
];

interface Card { el: HTMLElement; title: HTMLElement; small: HTMLElement; desc: HTMLElement; btn: HTMLButtonElement; btn2?: HTMLButtonElement; cd?: HTMLElement; auto?: HTMLInputElement; autoWrap?: HTMLElement }

function card(icon: HTMLElement, onBuy: () => void, opts: { second?: { label: string; title: string; on: () => void }; cooldown?: boolean; auto?: (on: boolean) => void } = {}): Card {
  const title = h('span', {});
  const small = h('small', {});
  const titleWrap = h('div', { class: 'c-title' }, title, small);
  const desc = h('div', { class: 'c-desc' });
  const btn = h('button', { class: 'btn', onclick: (e: Event) => { e.stopPropagation(); onBuy(); } }) as HTMLButtonElement;
  const act = h('div', { class: 'c-act' });
  let btn2: HTMLButtonElement | undefined;
  let auto: HTMLInputElement | undefined, autoWrap: HTMLElement | undefined;
  if (opts.auto) {
    auto = h('input', { type: 'checkbox' }) as HTMLInputElement;
    auto.addEventListener('change', () => opts.auto!(auto!.checked));
    autoWrap = h('label', { class: 'auto' }, auto, t('elements.auto'));
    act.append(autoWrap);
  }
  if (opts.second) {
    btn2 = h('button', { class: 'btn small ghost', title: opts.second.title, onclick: (e: Event) => { e.stopPropagation(); opts.second!.on(); } }, opts.second.label) as HTMLButtonElement;
    act.append(btn2);
  }
  act.append(btn);
  const el = h('div', { class: 'card' }, h('div', { class: 'c-ico' }, icon), titleWrap, act, desc);
  let cd: HTMLElement | undefined;
  if (opts.cooldown) { cd = h('div', { class: 'cd-bar' }); el.append(cd); }
  return { el, title, small, desc, btn, btn2, cd, auto, autoWrap };
}

export class Drawer {
  el = $('#drawer');
  body = $('#drawer-body');
  titleEl = $('#drawer-title');
  sub = $('#drawer-sub');
  tabbar = $('#tabbar');
  open: TabId | null = null;
  bookTab: 'chronicle' | 'museum' | 'notes' | 'stats' = 'chronicle';
  private sig = '';
  private cards = new Map<string, Card>();
  private refreshers: (() => void)[] = [];
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private acc = 0;
  private bookSeen = { notes: 0, fossils: 0, chronicle: 0 };
  onTarget: (el: ElementDef) => void = () => {};
  onConfirm: (text: string, yes: () => void) => void = () => {};
  onBuy: () => void = () => {};

  constructor(private g: () => Game) {
    for (const tb of TABS) {
      const b = h('button', { onclick: () => this.toggleTab(tb.id) }, h('span', { class: 'tab-ico' }, tb.ico), h('span', { class: 'tab-label' }, t('tabs.' + tb.id)), h('span', { class: 'dot' })) as HTMLButtonElement;
      this.tabButtons.set(tb.id, b);
      this.tabbar.append(b);
    }
    $('#drawer-close').addEventListener('click', () => this.close());
  }

  relabel(): void {
    for (const tb of TABS) setText(this.tabButtons.get(tb.id)!.querySelector('.tab-label') as HTMLElement, t('tabs.' + tb.id));
    this.sig = '';
  }

  toggleTab(id: TabId): void {
    if (this.open === id) { this.close(); return; }
    this.open = id;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    for (const [k, b] of this.tabButtons) toggle(b, 'active', k === id);
    this.sig = '';
    this.refresh(true);
    this.body.scrollTop = 0;
  }

  close(): void {
    this.open = null;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    for (const b of this.tabButtons.values()) b.classList.remove('active');
  }

  /** Height of the drawer in world px (0 when closed), read from the actual element so the world can squeeze. */
  heightPx(): number {
    if (!this.el.classList.contains('open') && !this.el.getAnimations().length) return 0;
    const r = this.el.getBoundingClientRect();
    const tab = this.tabbar.getBoundingClientRect();
    const scale = tab.width / 360;
    return Math.max(0, (tab.top - r.top) / scale);
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    this.updateDots();
    if (this.open) this.refresh(false);
  }

  private updateDots(): void {
    const g = this.g();
    const r = g.run;
    const lifeNew = CFG.species.some((sp) => g.speciesUnlocked(sp) && totalPop(g, sp.id) === 0 && r.energy >= g.speciesCost(sp) && g.freeZoneFor(sp) >= 0) || !!r.mutationOffer;
    const upNew = CFG.upgrades.some((u) => u.currency !== 'energy' && g.legacy.discovered.includes(u.currency) && g.currency(u.currency) >= g.upgradeCost(u.id));
    const gain = g.prestigeGain();
    const epochNew = gain >= 1 && gain >= g.meta.density * 0.5;
    const bookNew = g.legacy.notes.length > this.bookSeen.notes || g.legacy.fossils > this.bookSeen.fossils;
    toggle(this.tabButtons.get('life')!, 'has-new', lifeNew && this.open !== 'life');
    toggle(this.tabButtons.get('upgrades')!, 'has-new', upNew && this.open !== 'upgrades');
    toggle(this.tabButtons.get('epoch')!, 'has-new', epochNew && this.open !== 'epoch');
    toggle(this.tabButtons.get('book')!, 'has-new', bookNew && this.open !== 'book');
  }

  refresh(force: boolean): void {
    const g = this.g();
    const id = this.open;
    if (!id) return;
    const sig = id + '|' + this.signature(g, id);
    if (force || sig !== this.sig) {
      this.sig = sig;
      this.cards.clear();
      this.refreshers = [];
      this.body.replaceChildren();
      this.sub.replaceChildren();
      setText(this.titleEl, t('tabs.' + id));
      if (id === 'life') this.buildLife(g);
      else if (id === 'elements') this.buildElements(g);
      else if (id === 'upgrades') this.buildUpgrades(g);
      else if (id === 'epoch') this.buildEpoch(g);
      else this.buildBook(g);
    }
    for (const f of this.refreshers) f();
  }

  private signature(g: Game, id: TabId): string {
    const r = g.run;
    switch (id) {
      case 'life': return CFG.species.map((s) => (g.speciesUnlocked(s) ? 1 : 0)).join('') + r.era + (r.mutationOffer ? 'm' + r.mutationEraOffered : '') + g.state.settings.lang;
      case 'elements': return CFG.elements.map((e) => (g.elementAvailable(e) ? 1 : 0)).join('') + g.stats.autoSlots + g.state.settings.lang;
      case 'upgrades': return g.legacy.discovered.join(',') + g.mods.living + g.state.settings.lang;
      case 'epoch': return String(g.meta.prestiges) + g.state.settings.lang;
      case 'book': return this.bookTab + g.legacy.notes.length + '|' + g.legacy.fossils + '|' + g.legacy.chronicle.length + g.state.settings.lang;
    }
  }

  // ---------- Life ----------
  private buildLife(g: Game): void {
    const r = g.run;
    const zones = h('div', { class: 'zones' });
    const pills = ['water', 'shore', 'land'].map((z, zi) => {
      const fill = h('div', { class: 'zf', style: `background:${['#4a8ac0', '#c8a868', '#7a9a52'][zi]}` });
      const txt = h('span', {});
      zones.append(h('div', { class: 'zone-pill' }, fill, txt));
      return { fill, txt, z, zi };
    });
    const stat = h('div', { class: 'stat-line' });
    this.body.append(zones, stat);
    this.refreshers.push(() => {
      for (const p of pills) {
        const cap = g.capacity(p.zi), used = g.used(p.zi);
        p.fill.style.width = Math.min(100, (used / Math.max(1, cap)) * 100) + '%';
        setText(p.txt, `${t('zones.' + p.z)} ${fmt(used, 0)}/${cap}`);
      }
      const parts = [t('life.oxygen', { v: fmt(r.oxygen, 1) })];
      if (r.era >= 3) parts.push(t('life.forest', { v: fmt(g.forestCover() * 100, 0) }));
      setText(stat, parts.join(' · '));
    });

    if (r.mutationOffer && g.mods.living) {
      this.body.append(h('div', { class: 'section-title' }, t('mutation.choose')));
      r.mutationOffer.forEach((o, i) => {
        const c = card(speciesIcon(o.species), () => { g.chooseMutation(i); this.sig = ''; });
        setText(c.title, t('species.' + o.species + '.name'));
        setText(c.desc, t('mutation.' + o.mutation));
        setText(c.btn, '✓');
        this.body.append(c.el);
      });
      const rr = h('button', { class: 'btn ghost', onclick: () => { g.rerollMutations(); this.sig = ''; } }, t('mutation.reroll'));
      this.body.append(rr);
    }

    let lockedShown = 0;
    for (const sp of CFG.species) {
      const unlocked = g.speciesUnlocked(sp);
      if (!unlocked) {
        if (lockedShown >= 2 || sp.era > r.era + 1) continue;
        lockedShown++;
        const c = card(speciesIcon(sp.id), () => {});
        c.el.classList.add('locked');
        setText(c.title, t('species.' + sp.id + '.name'));
        let hint = t('life.lockedEra', { era: t('era.' + sp.era) });
        if (r.era >= sp.era && sp.needsOxygen && r.oxygen < sp.needsOxygen) hint = t('life.lockedOxygen', { v: sp.needsOxygen });
        else if (r.era >= sp.era && sp.unlockAfter) hint = t('life.lockedAfter', { species: t('species.' + sp.unlockAfter + '.name'), n: CFG.unlockAfterPop });
        setText(c.desc, hint);
        c.btn.disabled = true;
        setText(c.btn, fmt(sp.cost));
        this.body.append(c.el);
        continue;
      }
      const c = card(speciesIcon(sp.id), () => { if (g.buySpecies(sp.id)) this.onBuy(); }, {
        second: { label: '−', title: t('life.release'), on: () => g.releaseSpecies(sp.id) },
      });
      this.body.append(c.el);
      this.refreshers.push(() => this.refreshSpecies(g, sp, c));
    }
  }

  private refreshSpecies(g: Game, sp: SpeciesDef, c: Card): void {
    const n = totalPop(g, sp.id);
    setText(c.title, t('species.' + sp.id + '.name'));
    setText(c.small, n > 0 ? t('life.pop', { n }) : '');
    const zi = g.freeZoneFor(sp);
    const cost = g.speciesCost(sp);
    const mu = g.run.mutations[sp.id];
    let eps = sp.eps * (1 + g.stats.lifeEnergy) * g.stats.energyMul;
    if (mu === 'vigor') eps *= 1.5;
    const parts = [t('species.' + sp.id + '.desc'), t('life.eps', { v: fmt(eps) }) + ' · ' + t('zones.' + sp.zone) + ' · ' + t('life.lifespan', { v: fmt(lifespan(g, sp), 0) })];
    if (mu) parts.push(t('life.mutation', { m: t('mutation.' + mu) }));
    if (zi < 0) parts.push(t('life.full', { zone: t('zones.' + sp.zone) }));
    setText(c.desc, parts.join(' '));
    setText(c.btn, fmt(cost));
    const can = g.run.energy >= cost && zi >= 0;
    c.btn.disabled = !can;
    toggle(c.el, 'afford', can);
    toggle(c.el, 'poor', !can);
    if (c.btn2) c.btn2.disabled = n <= 0;
  }

  // ---------- Elements ----------
  private buildElements(g: Game): void {
    const slots = g.stats.autoSlots;
    const slotLine = h('div', { class: 'stat-line' });
    if (slots > 0) this.body.append(slotLine);
    this.refreshers.push(() => {
      if (slots > 0) setText(slotLine, t('elements.autoSlots', { used: Object.values(g.run.auto).filter(Boolean).length, max: slots }));
    });
    for (const el of CFG.elements) {
      if (el.world === 'hot' && !g.mods.hot) continue;
      if (g.mods.shards && (el.id === 'seaAdvance' || el.id === 'seaRetreat')) continue;
      const avail = g.elementAvailable(el);
      const c = card(elementIcon(el.icon), () => {
        if (el.kind === 'section') this.onTarget(el);
        else if (g.cast(el.id)) this.onBuy();
      }, { cooldown: true, auto: slots > 0 && el.kind === 'surface' ? (on) => { if (!g.setAuto(el.id, on)) c.auto!.checked = false; } : undefined });
      setText(c.title, t('elements.' + el.id + '.name'));
      if (!avail) {
        c.el.classList.add('locked');
        setText(c.desc, t('elements.locked', { era: t('era.' + el.era) }));
        c.btn.disabled = true;
        setText(c.btn, '—');
        if (c.autoWrap) c.autoWrap.style.display = 'none';
        this.body.append(c.el);
        continue;
      }
      setText(c.desc, t('elements.' + el.id + '.desc'));
      this.body.append(c.el);
      this.refreshers.push(() => {
        const cd = g.run.cooldowns[el.id] ?? 0;
        const cost = g.elementCost(el);
        c.cd!.style.width = cd > 0 ? ((1 - cd / el.cooldown) * 100).toFixed(1) + '%' : '0';
        setText(c.btn, cd > 0 ? t('elements.cooldown', { v: Math.ceil(cd) }) : fmt(cost));
        const can = g.canCast(el);
        c.btn.disabled = !can;
        toggle(c.el, 'afford', can);
        if (c.auto) c.auto.checked = !!g.run.auto[el.id];
      });
    }
  }

  // ---------- Upgrades ----------
  private upgradeCard(g: Game, u: UpgradeDef): Card {
    const icon = u.currency === 'energy' ? energyIcon() : rockSwatch(u.currency);
    const c = card(icon, () => { if (g.buyUpgrade(u.id)) this.onBuy(); });
    this.refreshers.push(() => {
      const lvl = g.upgradeLevel(u.id);
      setText(c.title, t('upgrades.' + u.id + '.name'));
      setText(c.small, t('upgrades.level', { n: lvl }));
      const cur = lvl > 0 ? upgradeEffect(lvl, u.value, u.kind, !!u.milestones) : 0;
      let curStr = '';
      if (lvl > 0) curStr = u.kind === 'mul' ? ` (×${fmt(cur, 2)})` : u.stat.endsWith('Add') || u.stat === 'geoHeat' || u.stat === 'kMax' ? ` (+${fmt(cur, 1)})` : ` (+${fmt(cur * 100, 0)}%)`;
      setText(c.desc, t('upgrades.' + u.id + '.desc') + curStr + (u.milestones ? ' · ' + t('upgrades.milestone') : ''));
      const cost = g.upgradeCost(u.id);
      setText(c.btn, fmt(cost) + (u.currency === 'energy' ? '' : ' ' + t('rocks.' + u.currency).slice(0, 4) + '.'));
      const can = g.currency(u.currency) >= cost;
      c.btn.disabled = !can;
      toggle(c.el, 'afford', can);
      toggle(c.el, 'poor', !can);
    });
    return c;
  }

  private buildUpgrades(g: Game): void {
    this.body.append(h('div', { class: 'section-title' }, t('upgrades.awakening')));
    for (const u of CFG.upgrades.filter((x) => x.branch === 'awakening')) this.body.append(this.upgradeCard(g, u).el);
    this.body.append(h('div', { class: 'section-title' }, t('upgrades.rockBranches')));
    const locked: UpgradeDef[] = [];
    for (const u of CFG.upgrades.filter((x) => x.branch === 'rock')) {
      if (g.legacy.discovered.includes(u.currency)) this.body.append(this.upgradeCard(g, u).el);
      else locked.push(u);
    }
    for (const u of locked) {
      const c = card(rockSwatch(u.currency), () => {});
      c.el.classList.add('locked');
      setText(c.title, t('upgrades.' + u.id + '.name'));
      setText(c.desc, t('upgrades.' + u.id + '.desc') + ' — ' + t('upgrades.need', { rock: t('rocks.' + u.currency) }) + '. ' + t('upgrades.howTo', { how: t('rockHow.' + u.currency) }));
      c.btn.disabled = true;
      setText(c.btn, '?');
      this.body.append(c.el);
    }
    if (g.mods.living) {
      this.body.append(h('div', { class: 'section-title' }, t('upgrades.ranks')));
      for (const rk of g.legacy.discovered) {
        const c = card(rockSwatch(rk), () => { g.rankUp(rk); });
        this.body.append(c.el);
        this.refreshers.push(() => {
          const lvl = g.run.rockRanks[rk] ?? 0;
          setText(c.title, t('rocks.' + rk));
          setText(c.small, ['', 'I', 'II', 'III', 'IV', 'V'][lvl]);
          setText(c.desc, lvl >= 5 ? '' : t('upgrades.rankUp', { n: lvl, m: lvl + 1 }) + ` (+25%)`);
          const cost = g.rankCost(rk);
          setText(c.btn, lvl >= 5 ? '—' : fmt(cost));
          c.btn.disabled = lvl >= 5 || (g.run.rocks[rk] ?? 0) < cost;
        });
      }
    }
  }

  // ---------- Epoch ----------
  private buildEpoch(g: Game): void {
    const info = h('div', { class: 'stat-line', style: 'flex-direction:column;gap:2px' });
    this.body.append(h('div', { class: 'c-desc', style: 'margin-bottom:5px;font-size:11px;color:#b8ae9c' }, t('epoch.explain')), info);
    const btn = h('button', { class: 'btn big', style: 'width:100%;margin:4px 0 6px' }, t('epoch.button')) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      const gain = g.prestigeGain();
      if (gain < 1) return;
      this.onConfirm(t('epoch.confirm', { v: gain }), () => { g.prestige(); this.sig = ''; });
    });
    this.body.append(btn);
    const lines = [h('div', {}), h('div', {}), h('div', {}), h('div', {})];
    info.append(...lines);
    this.refreshers.push(() => {
      const gain = g.prestigeGain();
      const P = CFG.B.prestige;
      setText(lines[0], t('epoch.mass', { v: fmt(g.run.compactMass) }));
      setText(lines[1], t('epoch.gain', { v: gain }));
      setText(lines[2], t('epoch.next', { v: fmt(P.divisor * Math.pow(gain + 1, 1 / P.power)) }));
      const f = g.meta.foundation;
      setText(lines[3], t('epoch.foundation', { v: fmt(f, 1), p: fmt(f * CFG.B.physics.foundationP * (1 + g.stats.foundation), 1) }));
      btn.disabled = gain < 1 || g.state.phase !== 'play';
      toggle(btn, 'glow', gain >= 1 && gain >= g.meta.density * P.glowAt);
    });
    const have = h('div', { class: 'section-title' });
    this.body.append(have);
    this.refreshers.push(() => setText(have, t('epoch.tree') + ' · ' + t('epoch.have', { v: fmt(g.meta.density, 0) })));
    for (const n of CFG.density) this.body.append(this.densityCard(g, n).el);
  }

  private densityCard(g: Game, n: DensityNode): Card {
    const c = card(densityIcon(), () => { if (g.buyDensity(n.id)) this.onBuy(); });
    this.refreshers.push(() => {
      const lvl = g.meta.tree[n.id] ?? 0;
      setText(c.title, t('epoch.' + n.id + '.name'));
      setText(c.small, `${lvl}/${n.max}`);
      setText(c.desc, t('epoch.' + n.id + '.desc'));
      const maxed = lvl >= n.max;
      const cost = g.densityCost(n.id);
      setText(c.btn, maxed ? t('epoch.max') : '◆ ' + fmt(cost, 0));
      const can = !maxed && g.meta.density >= cost;
      c.btn.disabled = !can;
      toggle(c.el, 'afford', can);
    });
    return c;
  }

  // ---------- Book ----------
  private buildBook(g: Game): void {
    const tabs = h('div', { class: 'sub-tabs' });
    for (const id of ['chronicle', 'museum', 'notes', 'stats'] as const) {
      tabs.append(h('button', { class: this.bookTab === id ? 'active' : '', onclick: () => { this.bookTab = id; this.sig = ''; this.refresh(true); } }, t('book.' + id)));
    }
    this.sub.append(tabs);
    this.bookSeen = { notes: g.legacy.notes.length, fossils: g.legacy.fossils, chronicle: g.legacy.chronicle.length };
    if (this.bookTab === 'chronicle') {
      const list = g.legacy.chronicle;
      if (!list.length) this.body.append(h('div', { class: 'empty' }, t('book.chronicleEmpty')));
      for (const e of list.slice().reverse()) this.body.append(h('div', { class: 'chron' }, chronicleText(e)));
    } else if (this.bookTab === 'museum') {
      this.body.append(h('div', { class: 'c-desc', style: 'margin-bottom:5px' }, t('book.museumHint')));
      const grid = h('div', { class: 'museum-grid' });
      for (const sp of CFG.species) {
        if (!sp.death.bone) continue;
        const m = g.legacy.museum[sp.id] ?? { common: 0, rare: 0, fragments: 0 };
        const got = m.common + m.rare > 0;
        grid.append(h('div', { class: 'mus' + (got ? ' got' : '') }, fossilIcon(sp.id, m.rare > 0, got),
          h('div', {}, h('div', { class: 'm-name' }, got ? t('species.' + sp.id + '.name') : '???'),
            h('div', { class: 'm-sub' }, `${t('book.common')} ${m.common} · ${t('book.rare')} ${m.rare}`),
            m.fragments ? h('div', { class: 'm-sub' }, t('book.fragments', { n: m.fragments })) : null)));
      }
      this.body.append(grid);
    } else if (this.bookTab === 'notes') {
      if (!g.legacy.notes.length) this.body.append(h('div', { class: 'empty' }, t('book.notesEmpty')));
      for (const id of CFG.story.notes) {
        if (g.legacy.notes.includes(id)) this.body.append(h('div', { class: 'note' }, h('div', { class: 'n-title' }, t('notes.' + id + '.title')), h('div', { class: 'n-text' }, t('notes.' + id + '.text'))));
        else this.body.append(h('div', { class: 'note locked' }, t('book.locked')));
      }
    } else {
      const L = g.legacy;
      const rows: [string, string][] = [
        ['playthrough', String(L.playthrough)], ['prestiges', String(L.totalPrestiges)], ['fossils', String(L.fossils)],
        ['time', fmtTime(L.totalRealTime)], ['maxEra', t('era.' + g.meta.maxEra)], ['notes', `${L.notes.length}/${CFG.story.notes.length}`],
        ['discovered', String(L.discovered.length)], ['rituals', L.rituals.map((r) => t('ritual.' + r + '.name')).join(', ') || '—'],
      ];
      for (const [k, v] of rows) this.body.append(h('div', { class: 'stat-line' }, t('book.st.' + k) + ': ', h('b', {}, v)));
    }
    void fmtInt; void rockColor;
  }
}
