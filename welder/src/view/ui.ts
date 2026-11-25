import type { Game } from '../sim/game';
import type { Reason } from '../sim/stats';
import type { GradeId } from '../data/types';
import { t } from '../i18n';
import type { Order } from '../sim/orders';
import { jobSheet, payAtGrade, seamProgress, JobSheet } from '../sim/jobs';
import { payForSeams, seamLosses } from '../sim/quality';

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
  /** Why the held rod isn't burning, by the cursor. */
  private whyEl = el('div', 'why');
  private whyKey = '';
  /** The job sheet shown before taking a job, and the live list of stages while it is on the bench. */
  private jobEl = el('div', 'job', 'pe');
  private stagesEl = el('div', 'stages');
  private stagesHtml = '';
  private sheet: JobSheet | null = null;
  private sheetUid = -1;
  jobOpen = false;
  /** The craft book (upgrades) and the guided tour of the workshop. */
  private craftEl = el('div', 'craft', 'pe');
  private craftBtn = el('div', 'craft-btn', 'pe');
  private tourEl = el('div', 'tour', 'label pe');
  craftOpen = false;
  onBuy: (id: string) => void = () => {};
  onCraftBtn: () => void = () => {};
  onLang: () => void = () => {};
  private langBtn = el('div', 'lang-btn', 'pe');
  onTourNext: () => void = () => {};

  /** Any panel over the game that takes the mouse. */
  get modal(): boolean {
    return this.boardOpen || this.jobOpen || this.craftOpen;
  }
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
    root.append(this.money, this.langBtn, this.craftBtn, this.stagesEl, this.jobEl, this.craftEl, this.tourEl, this.ctrl, this.promptEl, this.whyEl, this.appStatus, this.hint, this.tip, this.stampEl, this.toasts, this.board, this.endEl, this.start, this.cursor);
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
    this.ctrl.innerHTML = `<span class="k">◉</span>${mask}<span>${maskDown ? '▲' : '▼'}</span><span class="k">SPACE</span><span class="k">A/D</span><span class="k">W/S</span><span class="k">TAB</span><span>${t('ctrl.turn')}</span><span class="k">E</span><span>${t('ctrl.leave')}</span>`;
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

  /** Name of a stage: a seam by its id (numbered ones get their number), chipping, handing over. */
  private stageName(id: string): string {
    const m = /^(.*?)(\d+)$/.exec(id);
    return m ? `${t('seam.' + m[1])} ${+m[2] + 1}` : t('seam.' + id);
  }

  private stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  private coins(v: number): string {
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  }

  private reqText(o: Order): string[] {
    const req: string[] = [];
    if (o.req.minGrade) req.push(t('req.minPay', { n: Math.ceil(payAtGrade(o.reward, o.req.minGrade)) }));
    if (o.req.noHoles) req.push(t('req.noHoles'));
    if (o.req.needs) req.push(t('req.needs', { name: t('up.' + o.req.needs + '.name') }));
    return req;
  }

  /** The job sheet: what it is, for whom, how hard, its stages with what each pays at best, conditions. */
  showJob(o: Order, onTake: () => void): void {
    const s = jobSheet(this.game.data, o);
    const rows = s.stages
      .map((st, i) => {
        const what = st.kind === 'seam' ? `${t('job.seam')}: ${this.stageName(st.id)} · ${Math.round(st.len)} ${t('job.mm')}` : t('stage.' + st.kind);
        return `<li><span>${i + 1}. ${what}</span>${st.kind === 'seam' ? `<em>${t('job.upTo')} ${this.coins(st.max)} ◆</em>` : ''}</li>`;
      })
      .join('');
    const req = this.reqText(o);
    this.jobEl.innerHTML = `<div class="head"><b>${t('part.' + o.part)}</b><span class="pay">${t('job.upTo')} ${o.reward} ◆</span></div>
      <div class="who">${t('cust.' + o.customer)}</div>
      <div class="row">${t('job.diff')} <span class="stars">${this.stars(s.stars)}</span></div>
      <div class="row">${t('job.stages', { n: s.stages.length })}</div>
      <ol>${rows}</ol>
      <div class="row dim">${t('job.money')}</div>
      ${req.length ? `<div class="row">${t('job.req')}: ${req.join(' · ')}</div>` : ''}
      <div class="btns"><span class="take">${t('job.take')}</span><span class="later">${t('job.later')}</span></div>`;
    this.jobEl.style.display = 'block';
    this.jobOpen = true;
    this.jobEl.querySelector('.take')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.closeJob();
      onTake();
    });
    this.jobEl.querySelector('.later')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.closeJob();
    });
  }

  closeJob(): void {
    if (!this.jobOpen) return;
    this.jobOpen = false;
    this.jobEl.style.display = 'none';
    this.onBoardClose();
  }

  /**
   * The stages of the job on the bench: the one in hand marked, each finished seam with how well it came out
   * in money, chipping with how much slag is left, and the running total.
   */
  updateStages(): void {
    const g = this.game, b = g.player;
    if (!b.order || !b.part || b.stage === 'empty') {
      if (this.stagesHtml) {
        this.stagesHtml = '';
        this.stagesEl.style.display = 'none';
      }
      return;
    }
    if (this.sheetUid !== b.order.uid) {
      this.sheet = jobSheet(g.data, b.order);
      this.sheetUid = b.order.uid;
    }
    const s = this.sheet!;
    const reward = b.order.reward;
    // Which seam is in hand: the one burning, else the one the guide points to, else the first unfinished.
    let cur = -1;
    if (b.stage === 'weld') {
      cur = b.arc.lit ? b.arc.seam : g.guide.seam;
      if (cur < 0) cur = b.seams.findIndex((x) => !x.filled);
    }
    const done = b.stage !== 'weld';
    let total = 0;
    let anyUnknown = false;
    const rows = s.stages.map((st, i) => {
      const n = `${i + 1}. `;
      if (st.kind === 'seam') {
        const p = seamProgress(b.seams, st.seam, reward);
        const finished = p.filled || done;
        if (finished) {
          const pay = done ? seamProgress(b.seams, st.seam, reward).pay : p.pay;
          total += pay;
          const c = this.causes(st.seam);
          if (c.includes('unk')) anyUnknown = true;
          return `<li class="ok">✓ ${n}${this.stageName(st.id)}<em>${Math.round(b.seams[st.seam].quality * 100)}% · ${this.coins(pay)}/${this.coins(st.max)} ◆</em></li>${c ? `<li class="causes">${c}</li>` : ''}`;
        }
        const on = st.seam === cur;
        const bar = `<i class="bar"><i style="width:${Math.round(p.laid * 100)}%"></i></i>`;
        return `<li class="${on ? 'on' : ''}">${on ? '▶' : '·'} ${n}${this.stageName(st.id)}${p.laid > 0.02 || on ? bar : `<em>${t('job.upTo')} ${this.coins(st.max)} ◆</em>`}</li>`;
      }
      if (st.kind === 'chip') {
        if (b.stage === 'chip') return `<li class="on">▶ ${n}${t('stage.chip')}<em>${Math.round((1 - b.slagLeft) * 100)}%</em></li>`;
        if (b.stage === 'inspect' || b.stage === 'ready') return `<li class="ok">✓ ${n}${t('stage.chip')}</li>`;
        return `<li>· ${n}${t('stage.chip')}</li>`;
      }
      return `<li class="${b.stage === 'ready' ? 'on' : ''}">${b.stage === 'ready' ? '▶' : '·'} ${n}${t('stage.hand')}</li>`;
    });
    const sum = done ? `<div class="sum">${t('job.total')}: ${this.coins(payForSeams(b.seams, reward))} / ${reward} ◆</div>` : total > 0 ? `<div class="sum">${t('job.sofar')}: ${this.coins(total)} ◆</div>` : '';
    const legend = anyUnknown ? `<div class="legend">${t('cause.unknown')}</div>` : '';
    const html = `<b>${t('part.' + b.order.part)}</b> <span class="stars">${this.stars(s.stars)}</span><ol>${rows.join('')}</ol>${sum}${legend}`;
    if (html !== this.stagesHtml) {
      this.stagesHtml = html;
      this.stagesEl.innerHTML = html;
      this.stagesEl.style.display = 'block';
    }
  }

  // ---------------------------------------------------------------- craft book

  /** Language plate in the top-right corner: shows the other language, switches on click. */
  setLangButton(cur: string): void {
    this.langBtn.textContent = cur === 'ru' ? 'EN' : 'RU';
    this.langBtn.onpointerdown = (e) => {
      e.stopPropagation();
      this.onLang();
    };
  }

  /** Everything drawn from text: repaint after a language change. */
  relabelAll(): void {
    this.stagesHtml = '';
    this.renderCraft();
    this.renderBoard();
  }

  /** The small plate under the money that opens the craft book (shown once the book is open to you). */
  setCraftButton(show: boolean, glow: boolean): void {
    this.craftBtn.style.display = show ? 'block' : 'none';
    this.craftBtn.classList.toggle('glow', glow);
    this.craftBtn.innerHTML = `${t('craft.title')} <span class="k">U</span>`;
    this.craftBtn.onpointerdown = (e) => {
      e.stopPropagation();
      this.onCraftBtn();
    };
  }

  openCraft(): void {
    this.craftOpen = true;
    this.hideTip();
    this.renderCraft();
    this.craftEl.style.display = 'block';
  }

  closeCraft(): void {
    if (!this.craftOpen) return;
    this.craftOpen = false;
    this.craftEl.style.display = 'none';
    this.onBoardClose();
  }

  /** Sections of the book: what you know, what you work with, the workshop. Each entry: what it does, price, why not yet. */
  renderCraft(): void {
    if (!this.craftOpen) return;
    const g = this.game;
    const sec = (group: string) => {
      const items = g.data.upgrades.filter((u) => u.group === group);
      // Before the guild there is only the guild; after it, whatever its own prerequisites allow.
      const visible = items.filter((u) => (u.id === 'guild' || g.owned.guild) && (g.owned[u.id] || !u.requires?.owns || u.requires.owns.every((o) => g.owned[o])));
      if (!visible.length) return '';
      const cards = visible.map((u) => {
        const owned = !!g.owned[u.id];
        const why = owned ? [] : g.whyNot(u.id).map((r) => this.reason(r));
        const state = owned ? `<div class="own">✓ ${t('why.owned')}</div>` : why.length ? why.map((w) => `<div class="no">${w}</div>`).join('') : `<div class="buy" data-id="${u.id}">${t('buy')} · ◆ ${u.cost}</div>`;
        return `<div class="item ${owned ? 'owned' : why.length ? 'off' : 'can'}"><b>${t('up.' + u.id + '.name')}</b><span class="cost">${owned ? '' : '◆ ' + u.cost}</span><p>${t('up.' + u.id + '.desc')}</p>${state}</div>`;
      });
      return `<h4>${t('craft.' + group)}</h4><div class="items">${cards.join('')}</div>`;
    };
    this.craftEl.innerHTML = `<h3>${t('craft.title')}</h3><div class="money-line">◆ ${g.money}</div>${sec('craft')}${sec('tools')}${sec('shop')}<div class="close">${t('board.close')}</div>`;
    this.craftEl.querySelectorAll<HTMLElement>('.buy').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onBuy(b.dataset.id!);
      }),
    );
    this.craftEl.querySelector('.close')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.closeCraft();
    });
  }

  /** One step of the workshop tour: a label at (x, y) with what this is and a "next" mark. */
  setTour(text: string, x: number, y: number, last: boolean): void {
    if (!text) {
      this.tourEl.style.display = 'none';
      return;
    }
    const html = `<p>${text}</p><span class="next">${last ? t('tour.done') : t('tour.next')}</span>`;
    if (this.tourEl.dataset.t !== text) {
      this.tourEl.dataset.t = text;
      this.tourEl.innerHTML = html;
      this.tourEl.onpointerdown = (e) => {
        e.stopPropagation();
        this.onTourNext();
      };
    }
    this.tourEl.style.display = 'block';
    this.tourEl.style.left = x + 'px';
    this.tourEl.style.top = y + 'px';
  }

  /** Why a seam lost what it lost, as far as the welder can tell: causes he has learned by name, the rest as '?'. */
  private causes(seam: number): string {
    const g = this.game, b = g.player;
    const L = seamLosses(b.seams[seam], b.part?.thick ?? 1);
    const know: Record<string, number> = { tempo: g.stats.knowTempo, arc: g.stats.knowArc, fusion: g.stats.knowFusion, hand: g.stats.knowHand };
    const out: string[] = [];
    let unknown = 0;
    for (const k of ['tempo', 'arc', 'fusion', 'hand'] as const) {
      const v = L[k];
      if (v < 0.03) continue;
      if (know[k]) out.push(`<span class="cause">${t('cause.' + k)} −${Math.round(v * 100)}%</span>`);
      else unknown += v;
    }
    if (unknown >= 0.03) out.push(`<span class="cause unk">? −${Math.round(unknown * 100)}%</span>`);
    return out.join('');
  }

  /** A word or a sum that rises from a point on the work and fades (a chip's worth, a closed seam). */
  popup(text: string, x: number, y: number, cls = ''): void {
    const d = el('div', undefined, 'pop ' + cls);
    d.textContent = text;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    this.root.append(d);
    setTimeout(() => d.remove(), 1300);
  }

  /** Gauges by the holder while the arc burns: arc length and travel speed, each with its green band. */
  private gaugeEl = (() => {
    const g = el('div', 'gauges');
    g.innerHTML = `<div class="g arc"><i class="band"></i><i class="needle"></i><span>${''}</span></div><div class="g spd"><i class="band"></i><i class="needle"></i><span></span></div>`;
    return g;
  })();
  private gaugeMounted = false;

  setGauges(arc: number | null, speed: number | null, x: number, y: number): void {
    if (!this.gaugeMounted) {
      this.root.append(this.gaugeEl);
      this.gaugeMounted = true;
      const [ga, gs] = this.gaugeEl.querySelectorAll<HTMLElement>('.g');
      ga.querySelector('span')!.textContent = t('gauge.arc');
      gs.querySelector('span')!.textContent = t('gauge.speed');
    }
    const show = arc !== null || speed !== null;
    this.gaugeEl.style.display = show ? 'flex' : 'none';
    if (!show) return;
    this.gaugeEl.style.left = x + 'px';
    this.gaugeEl.style.top = y + 'px';
    const [ga, gs] = this.gaugeEl.querySelectorAll<HTMLElement>('.g');
    const set = (g: HTMLElement, v: number | null) => {
      g.style.display = v === null ? 'none' : 'block';
      if (v === null) return;
      const n = g.querySelector<HTMLElement>('.needle')!;
      n.style.bottom = `${Math.max(0, Math.min(1, v)) * 100}%`;
      g.classList.toggle('off', v < 0.33 || v > 0.67);
    };
    set(ga, arc);
    set(gs, speed);
  }

  /** Short reason under the cursor ('' hides it). */
  setWhy(key: string, x: number, y: number): void {
    if (key !== this.whyKey) {
      this.whyKey = key;
      this.whyEl.textContent = key ? t('why.' + key) : '';
      this.whyEl.style.display = key ? 'block' : 'none';
    }
    if (key) {
      this.whyEl.style.left = x + 'px';
      this.whyEl.style.top = y + 'px';
    }
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

  stamp(grade: GradeId, line: string, pay?: number, reward?: number): void {
    const head = pay !== undefined && reward !== undefined ? `${this.coins(pay)} / ${reward} ◆` : t('grade.' + grade);
    this.stampEl.innerHTML = `${head}<small>${[t('grade.' + grade), line].filter(Boolean).join(' · ')}</small>`;
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
      const req = this.reqText(o);
      const sh = jobSheet(g.data, o);
      req.unshift(`<span class="stars">${this.stars(sh.stars)}</span> · ${t('job.stages', { n: sh.stages.length })}`);
      if (o.simple && g.owned.apprentice) req.push(t('req.simple'));
      const why = ok.ok ? '' : ok.why === 'needs' ? t('board.needs', { name: t('up.' + o.req.needs + '.name') }) : t('board.' + ok.why);
      return `<div class="card ${ok.ok ? '' : 'off'}" data-uid="${o.uid}">
        <span class="pay">${t('job.upTo')} ${o.reward} ◆</span>
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
        const uid = +c.dataset.uid!;
        const o = g.board.find((x) => x.uid === uid);
        if (!o) return;
        this.board.style.display = 'none';
        this.boardOpen = false;
        this.showJob(o, () => this.onTake(uid));
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
