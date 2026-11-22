// Smooth (non-pixel) UI icons. Each first looks for a painted asset in assets/ui (see config/assets.json);
// until it exists, a procedural placeholder is drawn with soft gradients so the interface already reads
// as "stone and amber". Swap files in, the code stays the same.
import { CFG } from '../config';
import { assetUrl } from '../render/assets';
import { creatureIcon } from '../render/creatures';
import { drawFossil, fossilKind } from '../render/skins';
import { drawRelic } from '../render/items';

const DPR = 2;
const THEME = { amber: '#F2B54A', amberDeep: '#C9782A', bone: '#EDE3D0', stone: '#2E2925', stone9: '#1B1816' };

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w * DPR; c.height = h * DPR;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const x = c.getContext('2d')!;
  x.scale(DPR, DPR);
  return [c, x];
}

function imgOr(path: string, size: number, draw: () => HTMLElement): HTMLElement {
  const url = assetUrl(path);
  if (!url) return draw();
  const img = document.createElement('img');
  img.src = url; img.width = size; img.height = size; img.alt = '';
  img.style.width = size + 'px'; img.style.height = size + 'px';
  return img;
}

/** The energy spark: a four-pointed amber star with a halo. */
export function energyIcon(size = 18): HTMLElement {
  // the painted icon is a dark tile: only at sizes where it reads (small inline sparks stay procedural)
  return imgOr(size >= 24 ? 'ui/icons/energy.png' : 'ui/icons/__none.png', size, () => {
    const [c, x] = canvas(size);
    const s = size / 2;
    const g = x.createRadialGradient(s, s, 0, s, s, s);
    g.addColorStop(0, 'rgba(255,230,160,0.9)'); g.addColorStop(0.5, 'rgba(242,181,74,0.35)'); g.addColorStop(1, 'rgba(242,181,74,0)');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    x.beginPath();
    const r1 = s * 0.92, r2 = s * 0.22;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? r2 : r1;
      x.lineTo(s + Math.cos(a) * r, s + Math.sin(a) * r);
    }
    x.closePath();
    const f = x.createLinearGradient(0, 0, size, size);
    f.addColorStop(0, '#fff1c8'); f.addColorStop(1, THEME.amber);
    x.fillStyle = f; x.fill();
    return c;
  });
}

function hexRgb(h: string): number[] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

/** A pebble of the rock: soft lit stone with grains in its own palette. */
export function rockIcon(rock: string, size = 22): HTMLElement {
  return imgOr(size >= 24 ? `ui/icons/rock_${rock}.png` : 'ui/icons/__none.png', size, () => {
    const [c, x] = canvas(size);
    const m = CFG.materials.find((mm) => mm.rock === rock && mm.id !== 'amberInsect') ?? CFG.materials.find((mm) => mm.id === rock) ?? CFG.materials[1];
    const pal = m.palette.map(hexRgb);
    let seed = 0;
    for (let i = 0; i < rock.length; i++) seed = (seed * 31 + rock.charCodeAt(i)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const cx = size / 2, cy = size / 2 + 1, R = size * 0.4;
    x.beginPath();
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = R * (0.82 + rnd() * 0.2) * (1 + 0.12 * Math.cos(a * 2));
      x.lineTo(cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 0.88);
    }
    x.closePath();
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 3; x.shadowOffsetY = 1.5;
    const g = x.createRadialGradient(cx - R * 0.4, cy - R * 0.5, R * 0.1, cx, cy, R * 1.3);
    g.addColorStop(0, `rgb(${pal[4].join(',')})`); g.addColorStop(0.55, `rgb(${pal[2].join(',')})`); g.addColorStop(1, `rgb(${pal[0].map((v) => v * 0.6).join(',')})`);
    x.fillStyle = g; x.fill();
    x.restore();
    x.save(); x.clip();
    for (let i = 0; i < 26; i++) {
      x.fillStyle = `rgba(${pal[(rnd() * 5) | 0].join(',')},0.7)`;
      x.beginPath(); x.arc(cx + (rnd() - 0.5) * R * 2.2, cy + (rnd() - 0.5) * R * 1.8, 0.4 + rnd() * 1.1, 0, 7); x.fill();
    }
    if (m.glint) { x.fillStyle = 'rgba(255,255,255,0.75)'; x.beginPath(); x.arc(cx - R * 0.35, cy - R * 0.4, R * 0.16, 0, 7); x.fill(); }
    x.restore();
    return c;
  });
}

const TAB_PATHS: Record<string, string> = {
  life: 'M12 21v-7 M12 14c-5 0-7-4-7-8 4 0 7 3 7 8z M12 12c0-5 3-8 8-8 0 5-3 8-8 8z',
  elements: 'M6 13a4 4 0 0 1 1-7.9 5 5 0 0 1 9.5 1.4A3.5 3.5 0 0 1 17 13z M11 14l-2 4h3l-2 4',
  upgrades: 'M12 3l6 7h-4v10h-4V10H6z',
  epoch: 'M3 6h18 M3 10h18 M3 14h18 M3 18h18',
  book: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z M12 6v14',
  rocks: 'M5 16l3-7 5-2 5 4 1 5-6 3z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
};

/** Tab / small UI glyph as a soft-lit stroke icon. */
export function tabIcon(id: string, size = 26): HTMLElement {
  return imgOr(`ui/icons/tab_${id}.png`, size, () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    svg.setAttribute('class', 'glyph');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', TAB_PATHS[id] ?? TAB_PATHS.book);
    p.setAttribute('fill', id === 'epoch' || id === 'settings' ? 'none' : 'currentColor');
    p.setAttribute('fill-opacity', '0.18');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.7');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
    return svg as unknown as HTMLElement;
  });
}

/** Round medallion art for an element (rain, volcano…), drawn with soft paths. */
export function elementIcon(id: string, size = 44): HTMLElement {
  return imgOr(`ui/icons/element_${id}.png`, size, () => {
    const [c, x] = canvas(size);
    const s = size / 24;
    x.scale(s, s);
    const bg = x.createRadialGradient(9, 8, 1, 12, 12, 13);
    const tone: Record<string, [string, string]> = {
      rain: ['#4a6a86', '#1e2a36'], flood: ['#3e7c86', '#123038'], drought: ['#b08a4a', '#3a2a16'], groundwater: ['#3e7c96', '#10283a'],
      heat: ['#c9782a', '#3a160c'], volcano: ['#8a3a22', '#1e0e0a'], seaAdvance: ['#3e7c86', '#122a34'], seaRetreat: ['#a08a5a', '#2a2214'],
      earthquake: ['#6a5a4a', '#1e1814'], glacier: ['#8ab8d0', '#1e3040'], meteor: ['#7a4a6a', '#1a0e1a'], magma: ['#b5523b', '#200a06'],
    };
    const [a, b] = tone[id] ?? ['#4a423a', '#1b1816'];
    bg.addColorStop(0, a); bg.addColorStop(1, b);
    x.fillStyle = bg; x.beginPath(); x.arc(12, 12, 11.5, 0, 7); x.fill();
    x.lineCap = 'round'; x.lineJoin = 'round';
    const bone = '#EDE3D0', amber = '#F2B54A', water = '#9ad0e8';
    const cloud = () => { x.fillStyle = bone; x.beginPath(); x.arc(9, 9.5, 3, 0, 7); x.arc(13, 8, 3.6, 0, 7); x.arc(16, 10, 2.6, 0, 7); x.rect(8, 10, 9, 2.6); x.fill(); };
    const waves = (y: number, col: string) => { x.strokeStyle = col; x.lineWidth = 1.4; x.beginPath(); for (let i = 0; i <= 12; i++) x.lineTo(5 + i * 1.2, y + Math.sin(i * 1.1) * 1); x.stroke(); };
    switch (id) {
      case 'rain': cloud(); x.strokeStyle = water; x.lineWidth = 1.2; for (const [px, py] of [[9, 15], [12.5, 16], [16, 15]]) { x.beginPath(); x.moveTo(px, py); x.lineTo(px - 1, py + 3); x.stroke(); } break;
      case 'flood': waves(10, water); waves(13.5, bone); waves(17, water); break;
      case 'drought': x.fillStyle = amber; x.beginPath(); x.arc(12, 9, 3.5, 0, 7); x.fill(); x.strokeStyle = '#6a4a22'; x.lineWidth = 1; x.beginPath(); x.moveTo(6, 17); x.lineTo(9, 15.5); x.lineTo(11, 17.5); x.lineTo(14, 15.5); x.lineTo(18, 17); x.stroke(); break;
      case 'groundwater': x.fillStyle = water; x.beginPath(); x.moveTo(12, 5.5); x.bezierCurveTo(16, 11, 16.5, 13, 16.5, 14.5); x.arc(12, 14.5, 4.5, 0, Math.PI); x.bezierCurveTo(7.5, 13, 8, 11, 12, 5.5); x.fill(); x.fillStyle = 'rgba(255,255,255,0.6)'; x.beginPath(); x.arc(10.5, 14, 1.2, 0, 7); x.fill(); break;
      case 'heat': case 'magma': {
        const fl = x.createLinearGradient(0, 18, 0, 5); fl.addColorStop(0, id === 'magma' ? '#ff5a20' : '#c9782a'); fl.addColorStop(1, '#ffe08a');
        x.fillStyle = fl; x.beginPath(); x.moveTo(12, 5); x.bezierCurveTo(16, 9, 17, 12, 16, 15); x.arc(12, 15, 4, 0, Math.PI); x.bezierCurveTo(7, 12, 9, 10, 10, 8.5); x.bezierCurveTo(10.5, 10, 11, 10.5, 11.5, 10.5); x.bezierCurveTo(11, 8, 11.5, 6.5, 12, 5); x.fill(); break;
      }
      case 'volcano': x.fillStyle = '#4a342a'; x.beginPath(); x.moveTo(5, 19); x.lineTo(10, 10); x.lineTo(14, 10); x.lineTo(19, 19); x.fill(); x.fillStyle = '#ff7a2a'; x.beginPath(); x.moveTo(10.5, 10); x.lineTo(13.5, 10); x.lineTo(12.6, 13); x.lineTo(11.4, 13); x.fill(); x.fillStyle = 'rgba(200,190,180,0.7)'; x.beginPath(); x.arc(11, 7, 2, 0, 7); x.arc(14, 5.5, 2.4, 0, 7); x.fill(); break;
      case 'seaAdvance': case 'seaRetreat': waves(15, water); x.strokeStyle = amber; x.lineWidth = 1.6; x.beginPath(); if (id === 'seaAdvance') { x.moveTo(12, 12); x.lineTo(12, 5.5); x.moveTo(9.5, 8); x.lineTo(12, 5.5); x.lineTo(14.5, 8); } else { x.moveTo(12, 5.5); x.lineTo(12, 12); x.moveTo(9.5, 9.5); x.lineTo(12, 12); x.lineTo(14.5, 9.5); } x.stroke(); break;
      case 'earthquake': x.strokeStyle = bone; x.lineWidth = 1.6; x.beginPath(); x.moveTo(5, 12); x.lineTo(8, 9); x.lineTo(10, 14); x.lineTo(13, 8); x.lineTo(15, 15); x.lineTo(19, 11); x.stroke(); break;
      case 'glacier': x.fillStyle = '#dceef8'; x.beginPath(); x.moveTo(5, 18); x.lineTo(10, 7); x.lineTo(13, 12); x.lineTo(15, 9); x.lineTo(19, 18); x.fill(); x.fillStyle = '#8ab8d0'; x.beginPath(); x.moveTo(10, 7); x.lineTo(11.5, 18); x.lineTo(8, 18); x.fill(); break;
      case 'meteor': { const fg = x.createLinearGradient(6, 6, 16, 16); fg.addColorStop(0, 'rgba(255,200,120,0)'); fg.addColorStop(1, '#ffb040'); x.strokeStyle = fg; x.lineWidth = 3; x.beginPath(); x.moveTo(6, 6); x.lineTo(14, 14); x.stroke(); x.fillStyle = '#ffd890'; x.beginPath(); x.arc(15, 15, 3, 0, 7); x.fill(); break; }
    }
    const rim = x.createLinearGradient(0, 0, 0, 24); rim.addColorStop(0, 'rgba(255,240,210,0.35)'); rim.addColorStop(1, 'rgba(0,0,0,0.4)');
    x.strokeStyle = rim; x.lineWidth = 1; x.beginPath(); x.arc(12, 12, 11.4, 0, 7); x.stroke();
    return c;
  });
}

/** Small habitat sign: water / shore / land. */
export function habitatIcon(zone: string, size = 14): HTMLElement {
  const [c, x] = canvas(size);
  const s = size / 14;
  x.scale(s, s);
  x.lineWidth = 1.3; x.lineCap = 'round';
  if (zone === 'water' || zone === 'any') { x.strokeStyle = '#7ab8c8'; x.beginPath(); for (let i = 0; i <= 10; i++) x.lineTo(2 + i, 8 + Math.sin(i * 1.2) * 1.4); x.stroke(); }
  if (zone === 'shore' || zone === 'shoreLand' || zone === 'any') { x.fillStyle = '#d8b878'; x.beginPath(); x.ellipse(7, 11, 5, 1.6, 0, 0, 7); x.fill(); }
  if (zone === 'land' || zone === 'shoreLand' || zone === 'any') { x.fillStyle = '#7ea05a'; x.beginPath(); x.moveTo(7, 2); x.lineTo(10.5, 8); x.lineTo(3.5, 8); x.fill(); x.fillStyle = '#6a4a30'; x.fillRect(6.4, 8, 1.2, 2.5); }
  return c;
}

/** Portrait of a species: painted asset, or a placeholder — the pixel creature in a soft oval frame. */
export function portrait(speciesId: string, size = 64, locked = false): HTMLElement {
  const sp = CFG.speciesById[speciesId];
  const el = imgOr(`ui/portraits/${speciesId}.png`, size, () => {
    const [c, x] = canvas(size);
    const water = sp.zone === 'water';
    const g = x.createRadialGradient(size * 0.45, size * 0.38, 2, size / 2, size / 2, size * 0.62);
    if (locked) { g.addColorStop(0, '#4a423a'); g.addColorStop(1, '#141210'); }
    else { g.addColorStop(0, water ? '#6ab4be' : '#9cbc72'); g.addColorStop(0.6, water ? '#2e6670' : '#4e6a36'); g.addColorStop(1, water ? '#14303a' : '#243018'); }
    x.fillStyle = g;
    x.beginPath(); x.ellipse(size / 2, size / 2, size * 0.47, size * 0.47, 0, 0, 7); x.fill();
    let ic: HTMLCanvasElement = creatureIcon(sp.sprite, sp.tint, water);
    if (locked) {
      // a dark silhouette of the creature on the stone
      const sc = document.createElement('canvas');
      sc.width = ic.width; sc.height = ic.height;
      const sx = sc.getContext('2d')!;
      sx.drawImage(ic, 0, 0);
      sx.globalCompositeOperation = 'source-in';
      sx.fillStyle = '#0c0a09'; sx.fillRect(0, 0, sc.width, sc.height);
      ic = sc;
    }
    x.imageSmoothingEnabled = false;
    const k = Math.floor((size * 0.68) / ic.width) || 1;
    x.save(); x.beginPath(); x.ellipse(size / 2, size / 2, size * 0.45, size * 0.45, 0, 0, 7); x.clip();
    x.globalCompositeOperation = locked ? 'source-over' : 'lighten';
    x.drawImage(ic, Math.round((size - ic.width * k) / 2), Math.round((size - ic.height * k) / 2), ic.width * k, ic.height * k);
    x.restore();
    x.strokeStyle = 'rgba(237,227,208,0.25)'; x.lineWidth = 1.2;
    x.beginPath(); x.ellipse(size / 2, size / 2, size * 0.47, size * 0.47, 0, 0, 7); x.stroke();
    return c;
  });
  if (locked && el.tagName === 'IMG') el.classList.add('silhouette');
  return el;
}

/** A museum exhibit: the pixel fossil or relic on its own, to sit inside a smooth showcase. */
export function exhibit(kind: 'fossil' | 'relic', id: string, rare = false, scale = 3): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 14; c.height = 12;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  if (kind === 'fossil') drawFossil(x, 7, 6, fossilKind(id), rare, 0.3);
  else drawRelic(x, id, 7, 6);
  c.style.width = 14 * scale + 'px'; c.style.height = 12 * scale + 'px';
  c.className = 'pixel';
  return c;
}

/** Oxygen: two bubbles, cool and light. */
export function oxygenIcon(size = 16): HTMLElement {
  const [c, x] = canvas(size);
  const s = size / 16;
  x.scale(s, s);
  for (const [cx, cy, r] of [[6, 9.5, 4.2], [11.5, 5, 2.6]] as const) {
    const g = x.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 0.5, cx, cy, r);
    g.addColorStop(0, 'rgba(220,240,255,0.95)'); g.addColorStop(1, 'rgba(110,170,200,0.55)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.strokeStyle = 'rgba(200,230,245,0.9)'; x.lineWidth = 0.9; x.stroke();
  }
  return c;
}
