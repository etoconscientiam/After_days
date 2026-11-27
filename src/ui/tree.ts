// The tree of the thing (the «Upgrades» tab): the in-run upgrades as nodes on a board that grows from the thing in
// six branches. A node opens when its parent has a level (or is full, for a keystone), its epoch has come and the
// other one of its pair is not taken (Game.upgradeLock). Drag to look around, ± to zoom; a tap picks a node and the
// card under the board tells what it gives, what it costs and what opens it, with the button to take it.
import { CFG, UpgradeDef } from '../config';
import type { Game } from '../core/game';
import { upgradeEffect } from '../core/stats';
import { h, setText, toggle } from './dom';
import { t, fmt } from './i18n';
import { energyIcon, rockIcon } from './icons';
import { ROMAN } from './pixelIcons';

export const BRANCH_COLOR: Record<string, string> = {
  tap: '#f2b54a', pile: '#d8b87a', life: '#8fae6a', time: '#9fc4e8', depth: '#c98a5a', under: '#a68ad0',
};

/** 9×9 pixel icons of the nodes: '#' the branch colour, '+' and '@' the light of the thing. */
const ICO: Record<string, string[]> = {
  thing: ['...###...', '..#####..', '.##+++##.', '##+++++##', '#++@@@++#', '##+++++##', '.##+++##.', '..#####..', '...###...'],
  hand: ['...#.#...', '..##.##..', '..##.##..', '.###.###.', '.#######.', '.#######.', '..#####..', '...###...', '...###...'],
  clock: ['..#####..', '.#.....#.', '#...#...#', '#...#...#', '#...###.#', '#.......#', '#.......#', '.#.....#.', '..#####..'],
  spark: ['....#....', '....#....', '...###...', '..#####..', '#########', '..#####..', '...###...', '....#....', '....#....'],
  double: ['.........', '..#...#..', '.###.###.', '#####.###', '.###.###.', '..#...#..', '.........', '#########', '.........'],
  wave: ['.........', '.........', '.##...##.', '#..#.#..#', '....#....', '.........', '.##...##.', '#..#.#..#', '....#....'],
  bell: ['....#....', '...###...', '..#####..', '..#####..', '..#####..', '.#######.', '#########', '.........', '...###...'],
  pile: ['.........', '.........', '....#....', '...###...', '..#####..', '.#######.', '#########', '#########', '.........'],
  tower: ['...###...', '...###...', '...###...', '..#####..', '..#####..', '..#####..', '.#######.', '.#######.', '#########'],
  scatter: ['.........', '.........', '.........', '.........', '...###...', '.#######.', '#########', '#########', '.........'],
  grain: ['.........', '..##.....', '.####..#.', '.####.###', '..##..##.', '.....##..', '.##.####.', '####.##..', '.##......'],
  shell: ['..#####..', '.#.....#.', '#..###..#', '#.#...#.#', '#.#.#.#.#', '#.#..##.#', '#..#....#', '.#..####.', '..##.....'],
  leaf: ['....#....', '...###...', '..#.#.#..', '.#..#..#.', '.#..#..#.', '..#.#.#..', '...###...', '....#....', '....#....'],
  drop: ['....#....', '....#....', '...###...', '..#####..', '.##+####.', '.##+####.', '.#######.', '..#####..', '...###...'],
  beds: ['#########', '.........', '#########', '#########', '.........', '#########', '.........', '#########', '#########'],
  sun: ['....#....', '.#..#..#.', '..#####..', '..#####..', '#########', '..#####..', '..#####..', '.#..#..#.', '....#....'],
  fish: ['.........', '.....##..', '#..#####.', '#########', '#..#####.', '.....##..', '.........', '.........', '.........'],
  lungs: ['....#....', '....#....', '.##.#.##.', '####.####', '####.####', '####.####', '####.####', '.##...##.', '.........'],
  dna: ['#.......#', '.#.....#.', '..#####..', '.#.....#.', '#.......#', '.#.....#.', '..#####..', '.#.....#.', '#.......#'],
  arrow: ['....#....', '.....#...', '######.#.', '......#.#', '######.#.', '.....#...', '....#....', '.........', '.........'],
  moon: ['...####..', '..##.....', '.##......', '.##......', '.##......', '.##......', '..##.....', '...####..', '.........'],
  book: ['.........', '####.####', '#..#.#..#', '#..#.#..#', '#..#.#..#', '#..#.#..#', '####.####', '....#....', '.........'],
  rain: ['..#####..', '.#######.', '#########', '.........', '.#..#..#.', '#..#..#..', '.#..#..#.', '#..#..#..', '.........'],
  maw: ['#########', '#.#.#.#.#', '.........', '...###...', '..#####..', '...###...', '.........', '#.#.#.#.#', '#########'],
  press: ['#########', '#########', '...###...', '...###...', '...###...', '.........', '#.#.#.#.#', '#########', '#########'],
  gem: ['..#####..', '.#..#..#.', '#########', '.#.....#.', '..#...#..', '...#.#...', '....#....', '.........', '.........'],
  flame: ['....#....', '...##....', '...###...', '..#####..', '.###.###.', '.##...##.', '.##...##.', '..#####..', '...###...'],
  bone: ['##.....##', '###...###', '.#######.', '..#####..', '.#######.', '###...###', '##.....##', '.........', '.........'],
};

function treeIcon(name: string, col: string, k: number): HTMLCanvasElement {
  const rows = ICO[name] ?? ICO.spark;
  const c = document.createElement('canvas');
  c.width = 9 * k; c.height = 9 * k;
  c.className = 'pix';
  const x = c.getContext('2d')!;
  rows.forEach((r, y) => {
    for (let i = 0; i < 9; i++) {
      const ch = r[i];
      if (!ch || ch === '.') continue;
      x.fillStyle = ch === '+' ? '#ffe6a8' : ch === '@' ? '#fff6dc' : col;
      x.fillRect(i * k, y * k, k, k);
    }
  });
  return c;
}

/** What a node gives now, as a short addition to its description. */
export function upgradeNow(g: Game, u: UpgradeDef): string {
  const lvl = g.upgradeLevel(u.id);
  if (lvl <= 0) return '';
  const cur = upgradeEffect(lvl, u.value, u.kind, !!u.milestones);
  if (u.stat === 'tapGap') return `${fmt(g.tapGapMs(), 0)} ${t('upgrades.ms')}`;
  if (u.stat === 'pileSize') return `+${fmt(cur * CFG.B.sand.pile.perLevel, 0)}`;
  if (u.stat === 'offlineHours') return `+${fmt(cur, 0)} ${t('tree.hours')}`;
  if (u.stat === 'eraMemory') return `${fmt(cur, 0)} ${t('tree.sec')}`;
  if (u.stat === 'hurryAdd') return `×${fmt(CFG.B.time.hurryMul + cur, 0)}`;
  if (u.stat === 'bell' || u.stat === 'pileSpread' || u.stat === 'bedsStick' || u.stat === 'sinkMul' || u.stat === 'wildSpeed') return t('tree.on');
  if (u.kind === 'mul') return `×${fmt(cur, 2)}`;
  if (u.stat.endsWith('Add') || u.stat === 'geoHeat' || u.stat === 'kMax') return `+${fmt(cur, 1)}`;
  return `+${fmt(cur * 100, 0)}%`;
}

type Node = { u: UpgradeDef | null; id: string; x: number; y: number; el: HTMLElement; badge: HTMLElement; size: number };

export class TreeView {
  readonly el: HTMLElement;
  private vp: HTMLElement;
  private inner: HTMLElement;
  private svg: SVGSVGElement;
  private nodes: Node[] = [];
  private links: { a: string; b: string; line: SVGLineElement }[] = [];
  private card: HTMLElement;
  private pick = 'impulse';
  private view = { x: 0, y: 30, z: 0.6 };
  private drag: { id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  private cardSig = '';

  constructor(private g: () => Game, private hold: (btn: HTMLButtonElement, act: () => boolean) => void) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'tree-links');
    this.inner = h('div', { class: 'tree-inner' }, this.svg as unknown as HTMLElement);
    const zoom = (k: number) => { this.view.z = Math.max(0.5, Math.min(1.8, this.view.z * k)); this.apply(); };
    const ctl = h('div', { class: 'tree-ctl' },
      h('button', { class: 'stone-btn', 'aria-label': '+', onclick: () => zoom(1.25) }, '+'),
      h('button', { class: 'stone-btn', 'aria-label': '−', onclick: () => zoom(0.8) }, '−'),
      h('button', { class: 'stone-btn', title: t('tree.center'), 'aria-label': t('tree.center'), onclick: () => { this.view.x = 0; this.view.y = 30; this.view.z = 0.6; this.apply(); } }, '◆'));
    this.vp = h('div', { class: 'tree-vp' }, this.inner, ctl);
    this.card = h('div', { class: 'tree-card' });
    this.el = h('div', { class: 'tree' }, this.vp, this.card);
    this.build();
    // drag to look around (a tap without a move picks the node under it)
    this.vp.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.tree-ctl')) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
    });
    this.vp.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; try { this.vp.setPointerCapture(e.pointerId); } catch { /* not all pointers */ } }
      if (!d.moved) return;
      const k = this.uiScale();
      this.view.x = d.vx + dx / k; this.view.y = d.vy + dy / k;
      this.apply();
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (!d.moved) {
        const n = (e.target as HTMLElement).closest('.tn') as HTMLElement | null;
        if (n?.dataset.id) { this.pick = n.dataset.id; this.cardSig = ''; this.refresh(); }
      }
    };
    this.vp.addEventListener('pointerup', end);
    this.vp.addEventListener('pointercancel', end);
    this.vp.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
    this.apply();
  }

  /** CSS px per UI unit (the UI is scaled to fit the screen). */
  private uiScale(): number {
    const r = this.vp.getBoundingClientRect();
    return this.vp.offsetWidth ? r.width / this.vp.offsetWidth : 1;
  }

  private apply(): void {
    this.inner.style.transform = `translate(${this.view.x * this.view.z}px, ${this.view.y * this.view.z}px) scale(${this.view.z})`;
  }

  private build(): void {
    const all: { id: string; u: UpgradeDef | null; x: number; y: number; parent?: string; icon: string; kind: string; branch: string }[] = [
      { id: 'thing', u: null, x: 0, y: 0, icon: 'thing', kind: 'root', branch: 'tap' },
      { id: 'hub', u: null, x: 40, y: -120, parent: 'thing', icon: 'gem', kind: 'small', branch: 'under' },
    ];
    for (const u of CFG.upgrades) if (u.tree) all.push({ id: u.id, u, x: u.tree.x, y: u.tree.y, parent: u.tree.parent, icon: u.tree.icon, kind: u.tree.kind, branch: u.tree.branch });
    // links first, under the nodes
    for (const n of all) {
      if (!n.parent) continue;
      const p = all.find((q) => q.id === n.parent)!;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(p.x)); line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(n.x)); line.setAttribute('y2', String(n.y));
      if (n.kind === 'choice') line.setAttribute('stroke-dasharray', '5 5');
      this.svg.append(line);
      this.links.push({ a: p.id, b: n.id, line });
    }
    for (const n of all) {
      const size = n.kind === 'root' ? 52 : n.kind === 'key' || n.kind === 'core' ? 42 : 34;
      const badge = h('span', { class: 'tn-badge' });
      const el = h('div', { class: `tn ${n.kind}`, 'data-id': n.id, role: 'button', 'aria-label': n.u ? t('upgrades.' + n.id + '.name') : t('tree.' + n.id) },
        h('span', { class: 'tn-face' }, treeIcon(n.icon, BRANCH_COLOR[n.branch], Math.max(2, Math.round(size / 13)))), badge);
      el.style.left = n.x - size / 2 + 'px';
      el.style.top = n.y - size / 2 + 'px';
      el.style.width = el.style.height = size + 'px';
      el.style.setProperty('--br', BRANCH_COLOR[n.branch]);
      this.inner.append(el);
      this.nodes.push({ u: n.u, id: n.id, x: n.x, y: n.y, el, badge, size });
    }
  }

  private stateOf(g: Game, n: Node): 'max' | 'part' | 'open' | 'locked' {
    if (n.id === 'thing') return 'max';
    if (n.id === 'hub') return g.hubOpen() ? 'max' : 'locked';
    const u = n.u!;
    const lvl = g.upgradeLevel(u.id), max = g.upgradeMax(u);
    if (lvl >= max) return 'max';
    if (lvl > 0) return 'part';
    return g.upgradeLock(u) ? 'locked' : 'open';
  }

  refresh(): void {
    const g = this.g();
    const st = new Map<string, string>();
    for (const n of this.nodes) {
      const s = this.stateOf(g, n);
      st.set(n.id, s);
      n.el.className = `tn ${n.el.classList.contains('root') ? 'root' : n.u?.tree?.kind ?? 'small'} ${s}` + (n.id === this.pick ? ' picked' : '');
      if (n.u) {
        const lvl = g.upgradeLevel(n.u.id), max = g.upgradeMax(n.u);
        setText(n.badge, max === Infinity ? String(lvl) : `${lvl}/${max}`);
        // can it be bought right now: a light pulse on the rim
        toggle(n.el, 'afford', s !== 'max' && s !== 'locked' && g.currency(n.u.currency) >= g.upgradeCost(n.u.id));
      } else n.badge.hidden = true;
    }
    for (const L of this.links) {
      const s = st.get(L.b)!;
      L.line.setAttribute('class', s === 'max' || s === 'part' ? 'on' : s === 'open' ? 'open' : 'off');
    }
    this.paintCard(g);
  }

  private paintCard(g: Game): void {
    const n = this.nodes.find((q) => q.id === this.pick) ?? this.nodes[0];
    const u = n.u;
    const s = this.stateOf(g, n);
    if (!u) {
      const sig = n.id + s;
      if (sig === this.cardSig) return;
      this.cardSig = sig;
      this.card.replaceChildren(h('div', { class: 'tc-tag' }, t(n.id === 'hub' ? 'tree.branch.under' : 'tree.centre')), h('div', { class: 'tc-name' }, t('tree.' + n.id)), h('div', { class: 'tc-desc' }, t('tree.' + n.id + 'Desc')));
      return;
    }
    const lvl = g.upgradeLevel(u.id), max = g.upgradeMax(u);
    const cost = g.upgradeCost(u.id);
    const lock = g.upgradeLock(u);
    const now = upgradeNow(g, u);
    const can = s !== 'max' && !lock && g.currency(u.currency) >= cost;
    const sig = [u.id, lvl, s, fmt(cost), can, now, JSON.stringify(lock)].join('|');
    if (sig === this.cardSig) { this.btn && (this.btn.disabled = !can); return; }
    this.cardSig = sig;
    const kind = u.tree?.kind ?? 'small';
    const why: string[] = [];
    if (lock?.parent) why.push(t(lock.full ? 'tree.needFull' : 'tree.needLevel', { name: t('upgrades.' + lock.parent + '.name') }));
    if (lock?.era) why.push(t('upgrades.opensEra', { n: ROMAN[lock.era] ?? String(lock.era), name: t('era.' + lock.era) }));
    if (lock?.hub) why.push(t('tree.needHub'));
    if (lock?.pair) why.push(t('tree.instead', { name: t('upgrades.' + lock.pair + '.name') }));
    const price = h('span', {}, fmt(cost));
    const btn = h('button', { class: 'buy' + (can ? ' ok' : '') }, u.currency === 'energy' ? h('span', { class: 'e' }, energyIcon(13)) : h('span', { class: 'e' }, rockIcon(u.currency, 14)), price) as HTMLButtonElement;
    btn.disabled = !can;
    this.hold(btn, () => { const ok = g.buyUpgrade(u.id); this.cardSig = ''; this.refresh(); return ok; });
    this.btn = btn;
    this.card.replaceChildren(...([
      h('div', { class: 'tc-tag' }, t('tree.branch.' + (u.tree?.branch ?? 'tap')) + ' · ' + t('tree.kind.' + kind)),
      h('div', { class: 'tc-head' }, h('div', { class: 'tc-name' }, t('upgrades.' + u.id + '.name')),
        h('div', { class: 'tc-lvl' }, max === Infinity ? t('tree.level', { v: lvl }) : t('tree.levelOf', { v: lvl, m: max }))),
      h('div', { class: 'tc-desc' }, t('upgrades.' + u.id + '.desc') + (now ? ` · ${t('tree.now')} ${now}` : '')),
      kind === 'core' ? h('div', { class: 'tc-note' }, t('tree.coreNote')) : kind === 'key' ? h('div', { class: 'tc-note' }, t('tree.keyNote')) : kind === 'choice' ? h('div', { class: 'tc-note' }, t('tree.choiceNote')) : null,
      why.length ? h('div', { class: 'tc-lock' }, t('tree.opens') + ': ' + why.join(' · ')) : null,
      s === 'max' ? h('div', { class: 'tc-done' }, t('tree.full')) : h('div', { class: 'tc-act' }, btn),
    ].filter(Boolean) as HTMLElement[]));
  }
  private btn: HTMLButtonElement | null = null;

  /** Pick the first node paid with this material and bring it to the middle of the board. */
  focusCurrency(cur: string): void {
    const u = CFG.upgrades.find((x) => x.currency === cur && x.tree);
    const n = u && this.nodes.find((q) => q.id === u.id);
    if (!n) return;
    this.pick = n.id; this.cardSig = '';
    this.view.x = -n.x; this.view.y = -n.y;
    this.apply(); this.refresh();
  }
}
