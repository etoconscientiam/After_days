// DOM helpers and small procedural icons (skins) for cards.
import { CFG } from '../config';
import { drawPattern, drawFossil, fossilKind } from '../render/skins';
import { creatureIcon } from '../render/creatures';

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
  return creatureIcon(sp.sprite, sp.tint, sp.zone === 'water');
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

const TAB_ICONS: Record<string, [string[], Record<string, string>]> = {
  life: [[
    '     gg     ', '    gGGg    ', '   gGGGg  g ', '   gGGg  gGg', '    gg  gGGg', '     s  gGg ',
    '     s gGg  ', '     ssg    ', '     s      ', '  bbbsbbb   ', ' bbbbbbbbb  ', '            '], { g: '#4a8a3a', G: '#8ad05a', s: '#6a8a4a', b: '#7a5a3a' }],
  elements: [[
    '   cccc     ', '  cCCCCc    ', ' cCCCCCCcc  ', 'cCCCCCCCCCc ', ' ccccccccc  ', '    yy      ',
    '   yy  d  d ', '  yyyy  d  d', '    yy d  d ', '   yy   d   ', '  y      d  ', '            '], { c: '#8a96a8', C: '#d8e0ec', y: '#f2c14e', d: '#7ab8e8' }],
  upgrades: [[
    '     aa     ', '    aAAa    ', '   aAAAAa   ', '  aAAaaAAa  ', ' aaa aa aaa ', '    aAAa    ',
    '    aAAa    ', '    aAAa    ', '    aAAa    ', '    aAAa    ', '    aaaa    ', '            '], { a: '#b8862a', A: '#f2c14e' }],
  epoch: [[
    '            ', 'aaaaaaaaaaaa', 'AAAAAAAAAAAA', 'bbbbbbbbbbbb', 'BBBBBBBBBBBB', 'cccccccccccc',
    'cccccccccccc', 'dddddddddddd', 'ddddddDDdddd', 'ddddddDDdddd', 'dddddddddddd', '            '], { a: '#7a9a52', A: '#5a7a3a', b: '#b8a070', B: '#8a7450', c: '#6a6070', d: '#2a2630', D: '#f2c14e' }],
  book: [[
    '            ', ' pppp  pppp ', 'pPPPPp pPPPp', 'pPllPp pPllp', 'pPPPPp pPPPp', 'pPllPp pPllp',
    'pPPPPp pPPPp', 'pPllPp pPllp', 'pPPPPpppPPPp', ' ppppp ppppp', '     pp     ', '            '], { p: '#6a4a2a', P: '#e8dcc0', l: '#9a8a70' }],
};

/** Pixel icon for a drawer tab (12×12, shown large and crisp). */
export function tabIcon(id: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 12; cv.height = 12;
  cv.className = 'tab-ico';
  const c = cv.getContext('2d')!;
  const p = TAB_ICONS[id];
  if (p) drawPattern(c, 0, 0, p[0], p[1]);
  return cv;
}

/** A small swatch of a material's palette (for tooltips and cards). */
export function matSwatch(matId: string): HTMLCanvasElement {
  const m = CFG.materials.find((mm) => mm.id === matId) ?? CFG.materials[0];
  const cv = document.createElement('canvas');
  cv.width = 6; cv.height = 6;
  cv.className = 'tip-ico';
  const c = cv.getContext('2d')!;
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) { c.fillStyle = m.palette[(x * 7 + y * 13 + ((x * y) % 5)) % m.palette.length]; c.fillRect(x, y, 1, 1); }
  return cv;
}
