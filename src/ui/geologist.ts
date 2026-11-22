// Geologist view (brief 5, A3) and the readable section (brief 6):
// - the lens button stands at the top of the strip right of the section; it turns on the Geologist view
//   (dim, heat, water, windows, forecast plates) and the lens: tap a layer and a round magnifier shows it up close,
//   with its rock and epoch; tap the button again or tap off the layers to close;
// - the era ruler below the button: a coloured segment per epoch with its sign and roman numeral; a tap zooms the
//   section to that epoch (tap again to let go). It never covers the layers: the section is narrower for it.
import { CFG } from '../config';
import type { Game } from '../core/game';
import type { Renderer } from '../render/renderer';
import type { Input } from './input';
import { $, h, toggle } from './dom';
import { t, fmt } from './i18n';
import { rockIcon } from './icons';
import { lensPixel, eraPixel, ROMAN } from './pixelIcons';
import { WH, WW } from '../render/common';
import { ERA_COLORS } from '../render/section';

const LENS_N = 60;     // lens pixels across (one lens pixel = one world pixel on screen)
const LENS_Z = 3;      // magnification

export class Geologist {
  btn = $('#geo-btn') as HTMLButtonElement;
  plates = $('#geo-plates');
  private age = 9;
  private hintT = 0;
  private ruler: HTMLElement;
  private rulerKey = '';
  private rulerAge = 9;
  private lens: HTMLElement;
  private lensCv: HTMLCanvasElement;
  private lensLabel: HTMLElement;
  private lensImg: ImageData;
  private lensAt: { x: number; y: number } | null = null;
  private lensAge = 0;

  constructor(private g: () => Game, private ren: Renderer, private input: Input, private scale: () => number) {
    this.btn.append(lensPixel(26));
    this.btn.title = t('geo.button');
    this.btn.setAttribute('aria-label', t('geo.button'));
    this.btn.addEventListener('click', () => this.set(!this.ren.geologist));
    // the era ruler
    this.ruler = h('div', { id: 'ruler', 'aria-label': t('geo.ruler') });
    this.btn.after(this.ruler);
    // the lens
    this.lensCv = document.createElement('canvas');
    this.lensCv.width = this.lensCv.height = LENS_N;
    this.lensCv.className = 'pix';
    this.lensImg = this.lensCv.getContext('2d')!.createImageData(LENS_N, LENS_N);
    this.lensLabel = h('div', { class: 'lens-label' });
    this.lens = h('div', { id: 'lens', hidden: true }, h('div', { class: 'lens-glass' }, this.lensCv, h('i', { class: 'lens-shine' })), this.lensLabel);
    this.lens.addEventListener('click', () => this.closeLens());
    this.ruler.after(this.lens);
    this.input.onLens = (x, y) => this.openLens(x, y);
    this.input.onLensMiss = () => { if (this.lensAt) this.closeLens(); else this.set(false); };
  }

  set(on: boolean): void {
    this.ren.geologist = on;
    this.input.geologist = on;
    toggle(this.btn, 'on', on);
    this.btn.classList.remove('hint');
    this.hintT = 0;
    $('#fieldnote').hidden = true;
    this.age = 9;
    if (!on) { this.plates.replaceChildren(); this.closeLens(); }
  }

  /** First time a rock needs heat or depth: the lens glows for a while. */
  hint(): void { this.hintT = 10; this.btn.classList.add('hint'); }

  // ---------- lens ----------
  private openLens(x: number, y: number): void {
    this.lensAt = { x, y };
    this.lensAge = 9;
    this.lens.hidden = false;
    this.lens.classList.remove('in');
    void this.lens.offsetWidth;
    this.lens.classList.add('in');
  }

  closeLens(): void {
    this.lensAt = null;
    this.lens.hidden = true;
  }

  private paintLens(): void {
    const at = this.lensAt!;
    const sec = this.ren.section;
    const out = new Uint32Array(this.lensImg.data.buffer);
    const L = sec.paintLens(out, LENS_N, at.x, at.y, LENS_Z);
    // round: outside the circle is transparent
    const r2 = (LENS_N / 2) ** 2;
    for (let v = 0; v < LENS_N; v++) for (let u = 0; u < LENS_N; u++) {
      const dx = u - LENS_N / 2 + 0.5, dy = v - LENS_N / 2 + 0.5;
      if (dx * dx + dy * dy > r2) out[v * LENS_N + u] = 0;
    }
    this.lensCv.getContext('2d')!.putImageData(this.lensImg, 0, 0);
    if (L) {
      const rock = CFG.materials[L.mat].id;
      this.lensLabel.replaceChildren(rockIcon(rock, 16), h('span', {}, t('geo.lensLabel', { rock: t('materials.' + rock), n: ROMAN[L.era] ?? String(L.era) })));
    }
  }

  // ---------- layout helpers ----------
  private frame() {
    const cr = ($('#world') as HTMLCanvasElement).getBoundingClientRect(), ur = $('#ui').getBoundingClientRect();
    const k = this.scale();
    return {
      k, cr, ur,
      toUiY: (wy: number) => (cr.top + (wy / WH) * cr.height - ur.top) / k,
      toUiX: (wx: number) => (cr.left + (wx / WW) * cr.width - ur.left) / k,
      px: cr.width / WW / k,          // UI units per world px
    };
  }

  update(dt: number): void {
    const g = this.g();
    const play = g.state.phase === 'play';
    this.btn.hidden = !play;
    if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.btn.classList.remove('hint');
    const F = this.frame();
    const sec = this.ren.section;
    const top = this.ren.lay.sectionTop;
    // the button sits at the top of the strip right of the section
    const stripL = F.toUiX(sec.SW), stripW = F.toUiX(WW) - stripL;
    const bs = Math.max(24, Math.min(30, stripW - 2));
    this.btn.style.width = this.btn.style.height = bs + 'px';
    this.btn.style.left = stripL + (stripW - bs) / 2 + 'px';
    this.btn.style.top = F.toUiY(top) + 2 + 'px';
    this.updateRuler(g, F, stripL, stripW, F.toUiY(top) + bs + 6, play, dt);
    if (this.lensAt) {
      if (!play) this.closeLens();
      else {
        const lx = F.toUiX(this.lensAt.x), ly = F.toUiY(top + this.lensAt.y);
        const size = LENS_N * F.px;
        this.lensCv.style.width = this.lensCv.style.height = size + 'px';
        this.lens.style.left = Math.max(4, Math.min(stripL - size - 2, lx - size / 2)) + 'px';
        this.lens.style.top = Math.max(F.toUiY(top) - size * 0.4, ly - size / 2) + 'px';
        this.lensAge += dt;
        if (this.lensAge > 0.25) { this.lensAge = 0; this.paintLens(); }
      }
    }
    if (!this.ren.geologist || !play) { if (this.plates.childElementCount) this.plates.replaceChildren(); return; }
    this.age += dt;
    if (this.age < 0.5) return;
    this.age = 0;
    // plates: the future rock and "≈ N years", or a grey one-phrase reason; never stacked on each other
    const out: HTMLElement[] = [];
    let lastY = -99, lastText = '';
    const firstY = F.toUiY(top + 3) + bs + 4;
    for (const gl of this.ren.geoLayers) {
      if (!gl.f || gl.h < 3) continue;
      const y = F.toUiY(top + gl.y);
      if (y < firstY || y - lastY < 15 || out.length >= 9) continue;
      const f = gl.f;
      const text = f.ok ? t('geo.years', { v: fmt(Math.max(1, f.years), 0) }) : t('geo.' + f.reason);
      if (!f.ok && text === lastText) continue;          // the same reason again below: one plate is enough
      lastText = text;
      lastY = y;
      const el = h('div', { class: 'geo-plate ' + (f.ok ? 'ok' : 'no') }, rockIcon(f.rock, 14), h('span', {}, text));
      el.style.top = y - 9 + 'px';
      el.style.right = Math.max(4, (F.ur.right - F.cr.right) / F.k + stripW + 4) + 'px';
      out.push(el);
    }
    this.plates.replaceChildren(...out);
  }

  // ---------- era ruler ----------
  private updateRuler(g: Game, F: ReturnType<Geologist['frame']>, left: number, width: number, top: number, play: boolean, dt: number): void {
    const sec = this.ren.section;
    const drawerOpen = sec.cut !== Infinity;
    const show = play && !drawerOpen && sec.eras.length > 0;
    this.ruler.hidden = !show;
    if (!show) return;
    const bottom = F.toUiY(this.ren.lay.sectionTop + Math.max(...Array.from(sec.horizonTop.subarray(0, sec.SW))) + sec.hr);
    const H = Math.max(40, bottom - top);
    this.ruler.style.left = left + 'px';
    this.ruler.style.width = width + 'px';
    this.ruler.style.top = top + 'px';
    this.ruler.style.height = H + 'px';
    this.rulerAge += dt;
    const key = sec.eras.map((e) => e.era).join(',') + '|' + sec.focusEra + '|' + Math.round(H);
    if (key === this.rulerKey && this.rulerAge < 0.5) return;
    this.rulerAge = 0;
    // segment heights: each epoch gets a readable minimum, the rest follows its real share of the section
    const spans = sec.eras;
    const n = spans.length;
    const minH = Math.min(30, (H - (n - 1) * 2) / n);
    const tot = spans.reduce((s, e) => s + Math.max(0.5, e.y1 - e.y0), 0);
    const free = Math.max(0, H - (n - 1) * 2 - n * minH);
    const rebuild = key !== this.rulerKey || this.ruler.childElementCount !== n;
    this.rulerKey = key;
    if (rebuild) this.ruler.replaceChildren();
    spans.forEach((e, i) => {
      const hgt = minH + (free * Math.max(0.5, e.y1 - e.y0)) / tot;
      let seg = this.ruler.children[i] as HTMLElement | undefined;
      if (!seg || rebuild) {
        seg = h('button', { class: 'r-seg', title: t('geo.eraN', { n: ROMAN[e.era], name: t('era.' + e.era) }) },
          h('i', { class: 'r-bar' }), h('span', { class: 'r-ico' }, eraPixel(e.era, 12)), h('b', { class: 'r-num' }, ROMAN[e.era] ?? String(e.era)));
        seg.style.setProperty('--era', ERA_COLORS[e.era]);
        const era = e.era;
        seg.addEventListener('click', (ev) => {
          ev.stopPropagation();
          sec.focus(sec.focusEra === era ? -1 : era);
          this.rulerAge = 9;
          this.rulerKey = '';
        });
        this.ruler.append(seg);
      }
      seg.style.height = hgt + 'px';
      toggle(seg, 'focus', sec.focusEra === e.era);
      toggle(seg, 'now', e.era === g.run.era);
      toggle(seg, 'tight', hgt < 25);
    });
  }
}
