// Geologist view (brief 5, A3): the lens button at the section's right edge and the forecast plates.
// The overlay itself (dim, heat, water, windows) is drawn by the renderer from the same per-layer forecasts.
import type { Game } from '../core/game';
import type { Renderer } from '../render/renderer';
import type { Input } from './input';
import { $, h, toggle } from './dom';
import { t, fmt } from './i18n';
import { rockIcon } from './icons';
import { lensPixel } from './pixelIcons';
import { WH } from '../render/common';

export class Geologist {
  btn = $('#geo-btn') as HTMLButtonElement;
  plates = $('#geo-plates');
  private age = 9;
  private hintT = 0;

  constructor(private g: () => Game, private ren: Renderer, private input: Input, private scale: () => number) {
    this.btn.append(lensPixel(26));
    this.btn.title = t('geo.button');
    this.btn.setAttribute('aria-label', t('geo.button'));
    this.btn.addEventListener('click', () => this.set(!this.ren.geologist));
  }

  set(on: boolean): void {
    this.ren.geologist = on;
    this.input.geologist = on;
    toggle(this.btn, 'on', on);
    this.btn.classList.remove('hint');
    this.hintT = 0;
    $('#fieldnote').hidden = true;
    this.age = 9;
    if (!on) this.plates.replaceChildren();
  }

  /** First time a rock needs heat or depth: the lens glows for a while. */
  hint(): void { this.hintT = 10; this.btn.classList.add('hint'); }

  update(dt: number): void {
    const g = this.g();
    const play = g.state.phase === 'play';
    this.btn.hidden = !play;
    if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.btn.classList.remove('hint');
    // keep the button at the section's right edge (the world may be shrunk above the drawer)
    const cr = ($('#world') as HTMLCanvasElement).getBoundingClientRect(), ur = $('#ui').getBoundingClientRect();
    const k = this.scale();
    const toUiY = (wy: number) => (cr.top + (wy / WH) * cr.height - ur.top) / k;
    const right = (cr.right - ur.left) / k;
    const top = this.ren.lay.sectionTop;
    const bs = Math.max(26, Math.min(34, (cr.width / k) * 0.09));
    this.btn.style.width = this.btn.style.height = bs + 'px';
    this.btn.style.left = right - bs - 4 + 'px';
    this.btn.style.top = toUiY(top + 3) + 'px';
    if (!this.ren.geologist || !play) { if (this.plates.childElementCount) this.plates.replaceChildren(); return; }
    this.age += dt;
    if (this.age < 0.5) return;
    this.age = 0;
    // plates: the future rock and "≈ N years", or a grey one-phrase reason; never stacked on each other
    const out: HTMLElement[] = [];
    let lastY = -99, lastText = '';
    const firstY = toUiY(top + 3) + bs + 4;
    for (const gl of this.ren.geoLayers) {
      if (!gl.f || gl.h < 3) continue;
      const y = toUiY(top + gl.y);
      if (y < firstY || y - lastY < 15 || out.length >= 9) continue;
      const f = gl.f;
      const text = f.ok ? t('geo.years', { v: fmt(Math.max(1, f.years), 0) }) : t('geo.' + f.reason);
      if (!f.ok && text === lastText) continue;          // the same reason again below: one plate is enough
      lastText = text;
      lastY = y;
      const el = h('div', { class: 'geo-plate ' + (f.ok ? 'ok' : 'no') }, rockIcon(f.rock, 14), h('span', {}, text));
      el.style.top = y - 9 + 'px';
      el.style.right = Math.max(4, (ur.right - cr.right) / k + 4) + 'px';
      out.push(el);
    }
    this.plates.replaceChildren(...out);
  }
}
