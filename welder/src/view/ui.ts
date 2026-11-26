import { setFrameUnit } from './frames';
import type { Game } from '../sim/game';
import type { Reason } from '../sim/stats';
import type { GradeId } from '../data/types';
import { t } from '../i18n';
import type { Order } from '../sim/orders';
import { jobSheet, payAtGrade, seamProgress, JobSheet } from '../sim/jobs';

/**
 * The dust that hides a word you can't read yet (like a spoiler in a chat): sparse pixel specks of varied
 * brightness on a tile, set as a CSS image; CSS jumps it about so the specks shimmer.
 */
function makeSpoilerDust(): void {
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 12;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 110; i++) {
    const a = 0.15 + Math.random() * 0.6;
    x.fillStyle = `rgba(200, 184, 152, ${a.toFixed(2)})`;
    x.fillRect(Math.floor(Math.random() * 24), Math.floor(Math.random() * 12), 1, 1);
  }
  document.documentElement.style.setProperty('--spoil', `url(${c.toDataURL()})`);
}

/** The close button in a window's corner: a pixel cross on a small plate, which stays put while the window scrolls. */
const CLOSE_X = `<div class="x" title="Esc"><svg viewBox="0 0 7 7" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${i}" y="${i}" width="1" height="1"/><rect x="${6 - i}" y="${i}" width="1" height="1"/>`).join('')}</svg></div>`;
import { payForSeams, seamLosses } from '../sim/quality';
import { SKIP_AT } from '../sim/weld';
import { BALANCE } from '../data/balance';

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
  /** Debug panel (the ` key): jump the progression to one of three levels. */
  private dbgEl = el('div', 'dbg', 'pe');
  onDebugLevel: (level: 1 | 2 | 3) => void = () => {};
  /** The «next» button on the job card: leave the rest of this seam (or of the chipping). */
  onSkip: (seam: number) => void = () => {};
  /** Seams seen closed on this job, and the one closed last (its losses are shown on a long job's card). */
  private filledSeen = new Set<number>();
  private lastFilled = -1;
  private craftBtn = el('div', 'craft-btn', 'pe');
  private tourEl = el('div', 'tour', 'label pe');
  craftOpen = false;
  onBuy: (id: string) => void = () => {};
  onCraftBtn: () => void = () => {};
  onLang: () => void = () => {};
  private langBtn = el('div', 'lang-btn', 'pe');
  private hudL = el('div', 'hudl');
  /** How much of the rod is left. */
  private rodEl = el('div', 'rod');
  private rodKey = '';
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
    // Left column, one flow top to bottom: money, the craft book, the rod, the job's stages.
    this.hudL.append(this.money, this.craftBtn, this.rodEl, this.stagesEl);
    root.append(this.hudL, this.langBtn, this.jobEl, this.craftEl, this.tourEl, this.ctrl, this.promptEl, this.whyEl, this.appStatus, this.hint, this.tip, this.stampEl, this.toasts, this.board, this.endEl, this.start, this.dbgEl, this.cursor);
    this.dbgEl.style.display = 'none';
    makeSpoilerDust();
    this.stagesEl.addEventListener('pointerdown', (e) => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('.next');
      if (!n) return;
      e.stopPropagation();
      if (!n.classList.contains('off')) this.onSkip(+n.dataset.seam!);
    });
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
    // The pixel font only stays crisp at whole pixel sizes.
    // Strata Pixel is drawn on a 16 px grid: whole multiples of 16 only. Headings a step up, in Strata Stone
    // (32 px grid) where that lands on 32/64, else in Strata Pixel.
    const fs = 16 * Math.max(1, Math.round((px * 7) / 16));
    const fh = fs === 16 ? 32 : fs + 16;
    const root = document.documentElement.style;
    root.setProperty('--fs', fs + 'px');
    root.setProperty('--fh', fh + 'px');
    root.setProperty('--fhf', fh % 32 === 0 ? "'Strata Stone', 'Strata Pixel', monospace" : "'Strata Pixel', monospace");
    setFrameUnit(px);
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

  /** Hang the label under its point (when the point is near the top of the picture). */
  hintBelow(on: boolean): void {
    this.hint.classList.toggle('below', on);
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

  /** How well something came out: five stars, filled by quality. */
  private rating(q: number): string {
    const n = Math.max(0, Math.min(5, Math.round(q * 5)));
    return `<span class="on">${'★'.repeat(n)}</span><span class="off">${'★'.repeat(5 - n)}</span>`;
  }

  /** A stage's name that fills with colour, left to right, as the work on it goes (0..1). */
  private filled(text: string, k: number): string {
    return `<span class="fill" style="--p:${Math.round(Math.max(0, Math.min(1, k)) * 100)}%">${text}</span>`;
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
      this.filledSeen.clear();
      this.lastFilled = -1;
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
    // Which seam was closed last: its losses are the ones worth reading now.
    for (let i = 0; i < b.seams.length; i++) {
      const f = b.seams[i].filled;
      if (f && !this.filledSeen.has(i)) this.lastFilled = i;
      if (f) this.filledSeen.add(i);
    }
    type Item = { html: string; seamDone: boolean; pay: number; max: number; seam: number };
    const items: Item[] = s.stages.map((st, i) => {
      const n = `${i + 1}. `;
      if (st.kind === 'seam') {
        const p = seamProgress(b.seams, st.seam, reward);
        const finished = p.filled || done;
        if (finished) {
          const pay = done ? seamProgress(b.seams, st.seam, reward).pay : p.pay;
          total += pay;
          return { html: `<li class="ok"><s>✓</s>${n}${this.stageName(st.id)}<em class="q">${this.rating(b.seams[st.seam].quality)}</em></li>`, seamDone: true, pay, max: st.max, seam: st.seam };
        }
        const on = st.seam === cur;
        return { html: `<li class="${on ? 'on' : ''}"><s>${on ? '▶' : ''}</s>${this.filled(n + this.stageName(st.id), p.laid)}</li>`, seamDone: false, pay: 0, max: st.max, seam: st.seam };
      }
      const none = { seamDone: false, pay: 0, max: 0, seam: -1 };
      if (st.kind === 'chip') {
        if (b.stage === 'chip') return { ...none, html: `<li class="on"><s>▶</s>${this.filled(n + t('stage.chip'), 1 - b.slagLeft)}</li>` };
        if (b.stage === 'inspect' || b.stage === 'ready') return { ...none, html: `<li class="ok"><s>✓</s>${n}${t('stage.chip')}</li>` };
        return { ...none, html: `<li><s></s>${n}${t('stage.chip')}</li>` };
      }
      return { ...none, html: `<li class="${b.stage === 'ready' ? 'on' : ''}"><s>${b.stage === 'ready' ? '▶' : ''}</s>${n}${t('stage.hand')}</li>` };
    });
    const causesOf = (seam: number) => {
      const c = this.causes(seam);
      return c ? `<li class="causes">${c}</li>` : '';
    };
    const rows: string[] = [];
    if (items.length <= 5) {
      for (const it of items) rows.push(it.html + (it.seamDone ? causesOf(it.seam) : ''));
    } else {
      // A long job (a gate of many joints): the closed seams fold into one line, then what is in hand and
      // the next two; the rest is counted. The card stays short whatever the job.
      const fin = items.filter((it) => it.seamDone);
      const seams = items.filter((it) => it.seam >= 0).length;
      if (fin.length) {
        const pay = fin.reduce((a, it) => a + it.pay, 0), max = fin.reduce((a, it) => a + it.max, 0);
        const q = fin.reduce((a, it) => a + b.seams[it.seam].quality, 0) / fin.length;
        void pay;
        void max;
        rows.push(`<li class="ok"><s>✓</s>${t('job.seamsDone', { n: fin.length, m: seams })}<em class="q">${this.rating(q)}</em></li>`);
        const last = fin.find((it) => it.seam === this.lastFilled) ?? fin[fin.length - 1];
        rows.push(causesOf(last.seam));
      }
      const rest = items.filter((it) => !it.seamDone);
      const on = Math.max(0, rest.findIndex((it) => it.html.startsWith('<li class="on"')));
      const ordered = [...rest.slice(on), ...rest.slice(0, on)];
      for (const it of ordered.slice(0, 3)) rows.push(it.html);
      if (ordered.length > 3) rows.push(`<li class="more"><s></s>${t('job.more', { n: ordered.length - 3 })}</li>`);
    }
    // The whole job so far: how well (stars over the seams closed) and what it will bring, in whole coins.
    const closed = b.seams.filter((x) => x.filled || done);
    const qAll = closed.length ? closed.reduce((a, x) => a + x.quality, 0) / closed.length : 0;
    const coinsNow = Math.round(done ? payForSeams(b.seams, reward) : total);
    const sum = closed.length ? `<div class="sum"><span>${t(done ? 'job.total' : 'job.sofar')}</span><span class="q">${this.rating(qAll)}</span><em>◆ ${coinsNow}</em></div>` : '';
    // «Next»: leave the rest of the seam in hand (or of the chipping) once two thirds of it are done.
    let next = '';
    const W = BALANCE.weld.fillMin;
    if (b.stage === 'weld' && cur >= 0 && !b.seams[cur].filled) {
      const ok = b.seams[cur].coverage(W) >= SKIP_AT;
      next = `<div class="next${ok ? '' : ' off'}" data-seam="${cur}">${t('job.next')}</div>`;
    } else if (b.stage === 'chip') {
      const ok = 1 - b.slagLeft >= SKIP_AT;
      next = `<div class="next${ok ? '' : ' off'}" data-seam="-1">${t('job.next')}</div>`;
    }
    const html = `<b>${t('part.' + b.order.part)}</b><ol>${rows.join('')}</ol>${sum}${next}`;
    if (html !== this.stagesHtml) {
      this.stagesHtml = html;
      this.stagesEl.innerHTML = html;
      this.stagesEl.style.display = 'block';
    }
  }

  // ---------------------------------------------------------------- craft book

  /** Show or hide the debug panel. */
  toggleDebug(): void {
    const on = this.dbgEl.style.display === 'none';
    this.dbgEl.style.display = on ? 'block' : 'none';
    if (!on) return;
    const lv: [1 | 2 | 3, string][] = [
      [1, t('dbg.l1')],
      [2, t('dbg.l2')],
      [3, t('dbg.l3')],
    ];
    this.dbgEl.innerHTML = `${CLOSE_X}<h3>${t('dbg.title')}</h3><div class="lvls">${lv.map(([n, s]) => `<span class="lvl" data-l="${n}"><b>${n}</b> ${s}</span>`).join('')}</div>`;
    this.dbgEl.querySelectorAll<HTMLElement>('.lvl').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onDebugLevel(+b.dataset.l! as 1 | 2 | 3);
        this.dbgEl.querySelectorAll('.lvl').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    this.dbgEl.querySelector('.x')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.toggleDebug();
    });
  }

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
    this.craftEl.innerHTML = `${CLOSE_X}<h3>${t('craft.title')}</h3><div class="money-line">◆ ${g.money}</div>${sec('craft')}${sec('tools')}${sec('shop')}<div class="close">${t('board.close')}</div>`;
    this.craftEl.querySelectorAll<HTMLElement>('.buy').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onBuy(b.dataset.id!);
      }),
    );
    this.craftEl.querySelectorAll('.close, .x').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.closeCraft();
      }),
    );
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
    // Losses can add up past the whole seam (it is then simply worthless): show them as shares of what was lost.
    const sum = L.tempo + L.arc + L.fusion + L.hand;
    const k1 = sum > 1 ? 1 / sum : 1;
    for (const k of ['tempo', 'arc', 'fusion', 'hand'] as const) {
      const v = L[k] * k1;
      if (v < 0.03) continue;
      // A cause not yet learned is there but unreadable, under a shimmer of dust (until the craft teaches it).
      const name = know[k] ? t('cause.' + k) : `<i class="spoil">${t('cause.' + k)}</i>`;
      out.push(`<span class="cause${know[k] ? '' : ' unk'}">${name} −${Math.round(v * 100)}%</span>`);
    }
    return out.join('<b>·</b>');
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

  /** The rod in the holder: a bar of what's left, red when it's nearly gone; hidden with no job on the bench. */
  setRod(show: boolean, remain: number, swapping: boolean): void {
    const pct = Math.max(0, Math.min(100, Math.round(remain * 100)));
    const key = show ? `${pct}|${swapping}` : '';
    if (key === this.rodKey) return;
    this.rodKey = key;
    this.rodEl.style.display = show ? 'flex' : 'none';
    if (!show) return;
    const low = pct <= 15;
    this.rodEl.className = low ? 'low' : '';
    this.rodEl.innerHTML = `<span>${swapping ? t('rod.swap') : t('rod.label')}</span><i class="bar"><i style="width:${swapping ? 0 : pct}%"></i></i>${low && !swapping ? '<span class="k">R</span>' : ''}`;
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
    this.tip.classList.remove('ready');
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

  /** Over a finished job: «Done», and what it will fetch. Follows the cursor. */
  showReady(x: number, y: number): void {
    const b = this.game.player;
    const html = `<h4>${t('tip.ready')}</h4>` + (b.order ? `<div class="cost">◆ ${this.coins(payForSeams(b.seams, b.order.reward))} / ${b.order.reward}</div>` : '');
    if (this.tipId !== 'ready' || this.tip.innerHTML !== html) this.tip.innerHTML = html;
    this.tipId = 'ready';
    this.tip.classList.add('ready');
    this.tip.style.display = 'block';
    this.tip.style.left = x + 'px';
    this.tip.style.top = y + 'px';
  }

  get readyShown(): boolean {
    return this.tipId === 'ready';
  }

  refreshTip(): void {
    if (this.tipId === 'ready') return;
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
    this.board.innerHTML = `${CLOSE_X}<h3>${t('board.title')}</h3><div class="cards">${cards.join('') || `<div class="empty">${t('board.empty')}</div>`}</div><div class="close">${t('board.close')}</div>`;
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
    this.board.querySelectorAll('.close, .x').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.closeBoard();
      }),
    );
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
