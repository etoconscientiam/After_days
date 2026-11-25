import type { Game } from '../sim/game';
import type { Reason } from '../sim/stats';
import type { GradeId } from '../data/types';
import { t } from '../i18n';

function el(tag: string, id?: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  return e;
}

/**
 * DOM layer over the canvas. Content changes only on sim events; the only per-frame work is moving the hint
 * label and the cursor when they are visible.
 */
export class UI {
  readonly root: HTMLElement;
  readonly cursor = el('div', 'cursor');
  private money = el('div', 'money');
  private moneyVal = el('b');
  private hint = el('div', 'hint', 'label');
  private tip = el('div', 'tip', 'label');
  private stampEl = el('div', 'stamp');
  private toasts = el('div', 'toasts');
  private board = el('div', 'board', 'pe');
  private appStatus = el('div', 'app-status');
  private ctrl = el('div', 'ctrl');
  private promptEl = el('div', 'prompt');
  private start = el('div', 'start', 'pe');
  private endEl = el('div', 'end');
  private stampT = 0;
  hintVisible = false;
  boardOpen = false;
  tipId = '';
  onTake: (uid: number) => void = () => {};
  onBoardClose: () => void = () => {};

  constructor(root: HTMLElement, private game: Game) {
    this.root = root;
    this.money.append(el('i'), this.moneyVal);
    this.endEl.style.display = 'none';
    root.append(this.money, this.ctrl, this.promptEl, this.appStatus, this.hint, this.tip, this.stampEl, this.toasts, this.board, this.endEl, this.start, this.cursor);
  }

  /** Bottom strip: how to act in the current mode. At the bench, the mask and which way SPACE moves it. */
  setCtrl(mode: string, maskDown: boolean): void {
    this.ctrl.style.display = mode ? 'flex' : 'none';
    if (!mode) return;
    if (mode === 'walk') {
      this.ctrl.innerHTML = `<span class="k">WASD</span><span class="k">◉</span><span class="k">E</span><span>${t('ctrl.walk')}</span>`;
      return;
    }
    const mask = `<svg viewBox="0 0 12 12" shape-rendering="crispEdges"><rect x="2" y="1" width="8" height="10" fill="#4a4640"/><rect x="3" y="2" width="6" height="8" fill="#6a665e"/><rect x="3" y="4" width="6" height="3" fill="${maskDown ? '#1e3a24' : '#2a2620'}"/><rect x="4" y="5" width="4" height="1" fill="${maskDown ? '#5a9a5a' : '#3a3630'}"/></svg>`;
    this.ctrl.innerHTML = `<span class="k">◉</span>${mask}<span>${maskDown ? '▲' : '▼'}</span><span class="k">SPACE</span><span class="k">E</span><span>${t('ctrl.leave')}</span>`;
  }

  get promptShown(): boolean {
    return this.promptEl.style.display === 'block';
  }

  muteHint(m: boolean): void {
    this.hint.style.visibility = m ? 'hidden' : '';
  }

  /** "E · take the job" under the crosshair while walking. */
  setPrompt(text: string): void {
    this.promptEl.textContent = text;
    this.promptEl.style.display = text ? 'block' : 'none';
  }

  placePrompt(x: number, y: number): void {
    if (this.promptEl.style.display === 'none') return;
    this.promptEl.style.left = x + 'px';
    this.promptEl.style.top = y + 'px';
  }

  setScale(px: number): void {
    this.root.style.setProperty('--px', px + 'px');
    document.documentElement.style.setProperty('--px', px + 'px');
  }

  showMoney(v: number, bump = false): void {
    this.money.style.opacity = '1';
    this.moneyVal.textContent = String(v);
    if (bump) {
      this.money.classList.remove('bump');
      void this.money.offsetWidth;
      this.money.classList.add('bump');
    }
  }

  setHint(text: string, top = false): void {
    this.hintVisible = !!text;
    this.hint.textContent = text;
    this.hint.style.display = text ? 'block' : 'none';
    this.hint.classList.toggle('top', top);
  }

  hintEdge(side: string): void {
    this.hint.classList.toggle('edge-l', side === 'l');
    this.hint.classList.toggle('edge-r', side === 'r');
  }

  placeHint(x: number, y: number): void {
    this.hint.style.left = x + 'px';
    this.hint.style.top = y + 'px';
  }

  placeCursor(x: number, y: number, show: boolean): void {
    this.cursor.style.display = show ? 'block' : 'none';
    if (show) {
      this.cursor.style.left = x + 'px';
      this.cursor.style.top = y + 'px';
    }
  }

  /** Shelf tooltip: name, what it does, price, and every reason it can't be bought yet. */
  showTip(id: string, x: number, y: number): void {
    this.tipId = id;
    const u = this.game.data.upgrades.find((q) => q.id === id);
    if (!u) return this.hideTip();
    const why = this.game.whyNot(id);
    const reasons = why.map((r) => this.reason(r));
    const owned = why.some((r) => r.kind === 'owned');
    this.tip.innerHTML =
      `<h4>${t('up.' + id + '.name')}</h4><p>${t('up.' + id + '.desc')}</p>` +
      (owned
        ? `<div class="ok">${t('why.owned')}</div>`
        : `<div class="cost">◆ ${u.cost}</div>` + (reasons.length ? reasons.map((r) => `<div class="why">${r}</div>`).join('') : `<div class="ok">${t('buy')}</div>`));
    this.tip.style.display = 'block';
    this.tip.style.left = x + 'px';
    this.tip.style.top = y + 'px';
  }

  refreshTip(): void {
    if (this.tipId && this.tip.style.display === 'block') this.showTip(this.tipId, parseFloat(this.tip.style.left), parseFloat(this.tip.style.top));
  }

  hideTip(): void {
    this.tipId = '';
    this.tip.style.display = 'none';
  }

  reason(r: Reason): string {
    switch (r.kind) {
      case 'coins':
        return t('why.coins', { n: r.need });
      case 'owns':
        return t('why.owns', { name: t('up.' + r.id + '.name') });
      case 'orders':
        return t('why.orders', { have: r.have, need: r.need });
      case 'flag':
        return t('why.flag.' + r.id);
      case 'owned':
        return t('why.owned');
    }
  }

  stamp(grade: GradeId, line: string): void {
    this.stampEl.innerHTML = `${t('grade.' + grade)}<small>${line}</small>`;
    this.stampEl.className = grade === 'bad' || grade === 'rough' ? 'bad' : '';
    this.stampEl.style.display = 'block';
    this.stampT = 2.4;
  }

  toast(text: string): void {
    const d = el('div', undefined, 'toast');
    d.textContent = text;
    this.toasts.append(d);
    setTimeout(() => d.remove(), 4100);
  }

  beat(text: string): void {
    const d = el('div', 'beat');
    d.textContent = text;
    this.root.append(d);
    setTimeout(() => d.remove(), 6100);
  }

  setApprentice(text: string): void {
    this.appStatus.style.display = text ? 'block' : 'none';
    this.appStatus.textContent = text;
  }

  openBoard(): void {
    this.boardOpen = true;
    this.renderBoard();
    this.board.style.display = 'block';
  }

  closeBoard(): void {
    if (!this.boardOpen) return;
    this.boardOpen = false;
    this.board.style.display = 'none';
    this.onBoardClose();
  }

  renderBoard(): void {
    if (!this.boardOpen) return;
    const g = this.game;
    const cards = g.board.map((o) => {
      const ok = g.canTake(o);
      const req: string[] = [];
      if (o.req.minGrade) req.push(t('req.minGrade', { grade: t('grade.' + o.req.minGrade) }));
      if (o.req.noHoles) req.push(t('req.noHoles'));
      if (o.req.needs) req.push(t('req.needs', { name: t('up.' + o.req.needs + '.name') }));
      if (!req.length) req.push(t('req.none'));
      if (o.simple && g.owned.apprentice) req.push(t('req.simple'));
      const why = ok.ok ? '' : ok.why === 'needs' ? t('board.needs', { name: t('up.' + o.req.needs + '.name') }) : t('board.' + ok.why);
      return `<div class="card ${ok.ok ? '' : 'off'}" data-uid="${o.uid}">
        <span class="pay">◆ ${o.reward}</span>
        <b>${t('part.' + o.part)}</b><span class="who">${t('cust.' + o.customer)}</span>
        <ul>${req.map((r) => `<li>${r}</li>`).join('')}</ul>
        ${why ? `<div class="why">${why}</div>` : ''}
      </div>`;
    });
    this.board.innerHTML = `<h3>${t('board.title')}</h3><div class="cards">${cards.join('') || `<div class="empty">${t('board.empty')}</div>`}</div><div class="close">${t('board.close')}</div>`;
    this.board.querySelectorAll<HTMLElement>('.card').forEach((c) =>
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (c.classList.contains('off')) return;
        this.onTake(+c.dataset.uid!);
        this.closeBoard();
      }),
    );
    this.board.querySelector('.close')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.closeBoard();
    });
  }

  showStart(resume: boolean, onGo: (fresh: boolean) => void, onLang: () => void): void {
    this.start.style.display = 'flex';
    this.start.innerHTML = `<h1>${t('title')}</h1><div class="sub">${t('subtitle')}</div>
      <div class="go">${resume ? t('resume') : t('start')}</div>
      <div class="small">${t('controls')}</div>
      <div class="links">${resume ? `<span data-a="new">${t('newShift')}</span>` : ''}<span data-a="lang">${t('lang')}</span></div>`;
    this.start.onpointerdown = (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      e.stopPropagation();
      if (a === 'lang') return onLang();
      this.start.style.display = 'none';
      onGo(a === 'new');
    };
  }

  showEnd(rows: [string, string][], onGo: () => void): void {
    this.endEl.style.display = 'flex';
    this.endEl.innerHTML = `<div class="panel pe"><h2>${t('end.title')}</h2><p>${t('end.sub')}</p>
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="go">${t('end.continue')}</div></div>`;
    this.endEl.querySelector('.go')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.endEl.style.display = 'none';
      onGo();
    });
  }

  get endOpen(): boolean {
    return this.endEl.style.display !== 'none';
  }

  update(dt: number): void {
    if (this.stampT > 0) {
      this.stampT -= dt;
      if (this.stampT <= 0) this.stampEl.style.display = 'none';
    }
  }
}
