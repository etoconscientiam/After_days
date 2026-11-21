// DOM helpers and small procedural icons (skins) for cards.
import { CFG } from '../config';
import { SKINS, drawPattern, drawFossil, fossilKind } from '../render/skins';

export function $(sel: string): HTMLElement { return document.querySelector(sel) as HTMLElement; }

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

export function setText(el: HTMLElement, s: string): void { if (el.textContent !== s) el.textContent = s; }
export function toggle(el: HTMLElement, cls: string, on: boolean): void { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); }

function iconCanvas(draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 11; cv.height = 11;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  draw(c);
  return cv;
}

export function speciesIcon(id: string): HTMLCanvasElement {
  const sp = CFG.speciesById[id];
  return iconCanvas((c) => {
    c.fillStyle = sp.zone === 'water' ? '#16303e' : '#2a2219';
    c.fillRect(0, 0, 11, 11);
    const fn = SKINS[sp.sprite];
    const opts = { t: 0.3, i: 1, season: 0.3, tint: sp.tint };
    switch (sp.sprite) {
      case 'tree': fn(c, 5, 11, { ...opts, i: 0 }); break;
      case 'fish': drawPattern(c, 3, 4, [' bb ', 'bbbbt', ' bb '], { b: '#8ab0c8', t: '#6a90a8' }); break;
      case 'plankton': for (let i = 0; i < 6; i++) { c.fillStyle = '#aadcc8'; c.fillRect(2 + (i * 3) % 7, 2 + (i * 5) % 7, 1, 1); } break;
      case 'mat': c.fillStyle = '#6a8a42'; c.fillRect(1, 8, 9, 2); c.fillStyle = '#8aaa5a'; c.fillRect(2, 7, 2, 1); c.fillRect(6, 7, 3, 1); break;
      case 'insect': c.fillStyle = '#e8e0a0'; c.fillRect(3, 4, 1, 1); c.fillRect(7, 6, 1, 1); c.fillRect(5, 2, 1, 1); break;
      case 'bird': fn(c, 5, 5, opts); fn(c, 2, 3, { ...opts, i: 2 }); fn(c, 8, 7, { ...opts, i: 3 }); break;
      case 'herd': case 'predator': fn(c, 2, 9, opts); break;
      case 'mollusc': fn(c, 4, 8, opts); break;
      case 'moss': fn(c, 2, 10, opts); fn(c, 6, 10, { ...opts, i: 1 }); break;
      default: fn(c, 4, 10, opts);
    }
  });
}

const ELEMENT_ICONS: Record<string, [string[], Record<string, string>]> = {
  rain: [['  ccc  ', ' ccccc ', 'ccccccc', '       ', ' d d d ', 'd d d  ', ' d d d '], { c: '#9aa8b8', d: '#7ab8e8' }],
  flood: [['       ', 'ww  ww ', '  ww  w', 'wwwwwww', 'bbbbbbb', 'bbbbbbb'], { w: '#9ad0f0', b: '#3a78a8' }],
  drought: [['  sss  ', ' sssss ', '  sss  ', '       ', 'ddddddd', 'd d d d'], { s: '#f0c060', d: '#c8a060' }],
  water: [['   w   ', '  www  ', ' wwwww ', ' wwbww ', '  www  '], { w: '#7ab8e8', b: '#d0f0ff' }],
  heat: [['  f  f ', ' ff ff ', ' fffff ', 'ffyyfff', 'fyyyyff', ' fyyyf '], { f: '#e8602a', y: '#f8c040' }],
  volcano: [['  a a  ', '   a   ', '  ror  ', ' rrrrr ', 'rrrrrrr'], { a: '#8a8a8a', r: '#6a4a3a', o: '#ff7a2a' }],
  seaUp: [['   u   ', '  uuu  ', ' u u u ', 'wwwwwww', 'bbbbbbb'], { u: '#f2c14e', w: '#9ad0f0', b: '#3a78a8' }],
  seaDown: [['wwwwwww', 'bbbbbbb', ' d d d ', '  ddd  ', '   d   '], { d: '#f2c14e', w: '#9ad0f0', b: '#3a78a8' }],
  quake: [['g  g  g', ' g g g ', 'ggggggg', 'ccc ccc', 'cc   cc'], { g: '#8a7a60', c: '#5a4a3a' }],
  glacier: [[' iiiii ', 'iiiiiii', 'iwiwiwi', 'sssssss'], { i: '#d8ecf8', w: '#a8c8e0', s: '#6e7076' }],
  meteor: [['      o', '     o ', '   oo  ', '  oyo  ', ' oyyo  ', ' ooo   '], { o: '#c86a3a', y: '#ffd070' }],
  magma: [['rrrrrrr', 'rmmmmmr', 'rmyyymr', 'rmmmmmr', 'rrrrrrr'], { r: '#3a3a42', m: '#e04010', y: '#ffb020' }],
};

export function elementIcon(icon: string): HTMLCanvasElement {
  return iconCanvas((c) => {
    c.fillStyle = '#1a1714'; c.fillRect(0, 0, 11, 11);
    const p = ELEMENT_ICONS[icon];
    if (p) drawPattern(c, 2, 2, p[0], p[1]);
  });
}

export function rockSwatch(rock: string): HTMLCanvasElement {
  const m = CFG.materials.find((mm) => mm.rock === rock) ?? CFG.materials[0];
  return iconCanvas((c) => {
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
      const s = (x * 7 + y * 13 + ((x * y) % 5)) % m.palette.length;
      c.fillStyle = m.palette[s];
      c.fillRect(x, y, 1, 1);
    }
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 10, 11, 1); c.fillRect(10, 0, 1, 11);
  });
}

export function energyIcon(): HTMLCanvasElement {
  return iconCanvas((c) => {
    c.fillStyle = '#1a1714'; c.fillRect(0, 0, 11, 11);
    drawPattern(c, 2, 1, ['   a   ', '  aba  ', ' abcba ', 'abcccba', ' abcba ', '  aba  ', '   a   ', ''], { a: '#8a6a2a', b: '#f2c14e', c: '#fff2c0' });
  });
}

export function densityIcon(): HTMLCanvasElement {
  return iconCanvas((c) => {
    c.fillStyle = '#16131c'; c.fillRect(0, 0, 11, 11);
    for (let y = 0; y < 5; y++) { c.fillStyle = ['#5a5070', '#4a4060', '#3a3050', '#2a2440', '#c8b8ff'][y]; c.fillRect(1, 2 + y * 2, 9, y === 4 ? 1 : 2); }
  });
}

export function fossilIcon(speciesId: string, rare: boolean, has: boolean): HTMLCanvasElement {
  return iconCanvas((c) => {
    c.fillStyle = has ? '#2a241c' : '#141210'; c.fillRect(0, 0, 11, 11);
    if (has) drawFossil(c, 5, 5, fossilKind(speciesId), rare, 0);
    else { c.fillStyle = '#2a2622'; c.fillRect(3, 3, 5, 5); }
  });
}

export function rockColor(rock: string): string {
  return CFG.rocks.find((r) => r.id === rock)?.icon ?? '#888';
}
