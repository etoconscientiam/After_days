// Hand-placed pixel icons for the small signs on the cards: where a creature lives (water, shore, land) and
// "let one go" (a bird leaving its nest). Drawn at 1:1 and scaled up by whole pixels (image-rendering: pixelated).
import { CFG, mat } from '../config';

type Art = { rows: string[]; pal: Record<string, string> };

const OUT = '#211a16';

/** Little scene tiles, 16×16: you can tell water, shore and land at a glance. */
const WATER: Art = {
  rows: [
    '.oooooooooooooo.',
    'oSSSSSSSSSSSuUuo',
    'oSSSSsssSSSSSuUo',
    'oSSSsscssSSSSSuo',
    'oSSSSSSSSSSSSSSo',
    'oTTTTTTTTTTTTTTo',
    'oTTFTTTTTTFTTTTo',
    'oLLFFLLLLLFFLLLo',
    'oLFWWFLLLFWWFLLo',
    'oFWWWWFFFWWWWFFo',
    'oWWDWWWWWWWDWWWo',
    'oWDDDWWGWWDDDWWo',
    'oDDDDDWWWDDDDDDo',
    'oDDDGDDDDDDDGDDo',
    'oDDDDDDDDDDDDDDo',
    '.oooooooooooooo.',
  ],
  pal: { o: OUT, S: '#b9e2ec', s: '#eef8fb', c: '#d6eef4', u: '#fff3c4', U: '#ffe08a', T: '#8fcadb', F: '#f2fbfc', L: '#6fbccb', W: '#3f93a6', D: '#24606f', G: '#a6e6ef' },
};

const SHORE: Art = {
  rows: [
    '.oooooooooooooo.',
    'oSSSSSSSSSSSSSSo',
    'oSSSSSSsssSSSSSo',
    'oSSSSSsscssSSSSo',
    'oTTTTTTTTTTyyyyo',
    'oTTTTTTTTyyyYYYo',
    'oLLLLLLyyYYYYYYo',
    'oLFFLLyYYYYYYYYo',
    'oFWWFyYYYYYYYYYo',
    'oWWFyYYYYYxCYYYo',
    'oWFyYYYYYYCxYpYo',
    'oFyYYYYYYYYYYPZo',
    'oyYYYYZYYYYYZZZo',
    'oYYYYZZZYYYZZZZo',
    'oYZZZZZZZZZZZZZo',
    '.oooooooooooooo.',
  ],
  pal: { o: OUT, S: '#b9e2ec', s: '#eef8fb', c: '#d6eef4', T: '#8fcadb', F: '#f2fbfc', L: '#6fbccb', W: '#3f93a6', y: '#f7e6b4', Y: '#dcbd7c', Z: '#b0904f', x: '#fbeee6', C: '#d99a86', p: '#9a9088', P: '#6a625c' },
};

const LAND: Art = {
  rows: [
    '.oooooooooooooo.',
    'oSSSSSSSSSSSSSSo',
    'oSSccSSSSSkKkSSo',
    'oScccsSSSkKhKKSo',
    'oSSSSSSSkKhhKKko',
    'oSSSSSSSkkKKKKko',
    'oSSSSSSSSkkbkkSo',
    'oSSSSSggggbggSSo',
    'oSSggGGGGGbGGggo',
    'oSgGGGGGfGGGGGGo',
    'ogGGHGGGGGGGHGGo',
    'oGGHHGGGGGGHHGGo',
    'oeeEeeeeerEeeeeo',
    'oeEeeqQeeeeeEeeo',
    'oeeeeeeeEeeeeeeo',
    '.oooooooooooooo.',
  ],
  pal: { o: OUT, S: '#c4e4ee', c: '#f2fafc', s: '#dcf0f5', K: '#3f7a30', k: '#2f5e24', h: '#9bd06a', b: '#6a4628', g: '#b0da78', G: '#6ea84a', H: '#477c32', f: '#f4d24a', e: '#6c4b33', E: '#8a6446', r: '#4f3422', q: '#a49a90', Q: '#7a7068' },
};

/** "Let one go": an amber bird lifting off from its nest. 16×16. */
const RELEASE: Art = {
  rows: [
    '................',
    '.oo..........oo.',
    'owwo........owwo',
    'obwwo..oo..owwbo',
    '.obwwoohhoowwbo.',
    '..obbwehhewbbo..',
    '...obbhkkhbbo...',
    '....obbbbbbo....',
    '.....oBbbBo.....',
    '......oBBo......',
    '.....oBooBo.....',
    '..t..oo..oo.t...',
    '.oooooooooooooo.',
    'onNnNnNnNnNnNnNo',
    'oNnNnNNnNnNnNnNo',
    '.oooooooooooooo.',
  ],
  pal: { o: OUT, w: '#fff0c4', b: '#f2b54a', B: '#c9782a', h: '#f7c766', e: '#1a1412', k: '#e07a22', t: '#8a6040', n: '#a8784a', N: '#7a5232' },
};

/** The Geologist's lens: a magnifier over three layers. 16×16. */
const LENS: Art = {
  rows: [
    '................',
    '.....oooo.......',
    '....oggggo......',
    '...ogwggggo.....',
    '..ogwgaaaggo....',
    '..oggaaaaaggo...',
    '..oggsssssggo...',
    '..ogsssssssgo...',
    '..ogrrrrrrrgo...',
    '...ogrrrrrgo....',
    '....oggggggoo...',
    '.....oooooohhoo.',
    '..........ohHHo.',
    '...........ohHHo',
    '............ohho',
    '.............oo.',
  ],
  pal: { o: OUT, g: '#b8d8e0', w: '#ffffff', a: '#e8c070', s: '#9a8a68', r: '#7a5a48', h: '#8a6040', H: '#c8964a' },
};

/** Epoch signs for the era ruler, 12×12: silence, first life, sea, land, beasts, hominids, tribes, the finding. */
const ERA_ART: Art[] = [
  { rows: [
    '............', '....oooo....', '...oMMMMo...', '..oMMoooo...', '..oMmo......', '..oMmo...s..',
    '..oMmo......', '..oMMoooo...', '...oMMMMo...', '....oooo....', '.s..........', '............'],
    pal: { o: OUT, M: '#cfc6e0', m: '#9a8fb4', s: '#f2e6c4' } },
  { rows: [
    '............', '...oooooo...', '..oGGGGGGo..', '.oGgGGGGGGo.', '.oGGGnnGGGo.', '.oGGnNNnGGo.',
    '.oGGnNNnGGo.', '.oGGGnnGGGo.', '.oGGGGGGHGo.', '..oGGGGGGo..', '...oooooo...', '............'],
    pal: { o: OUT, G: '#6cc0a0', g: '#c8f0dc', H: '#3f8a70', n: '#2f6a58', N: '#f2d58a' } },
  { rows: [
    '............', '...ooo......', '..oWWWo.....', '.oWwwWWo....', '.oWo.oWWo.o.', '.oo...oWWoWo',
    '.......oWWWo', 'ooo.....ooo.', 'oBBooo..ooo.', 'oBBBBBooBBBo', '.oBbBBBBBbo.', '..oooooooo..'],
    pal: { o: OUT, W: '#8cc8ec', w: '#eef8ff', B: '#3f7fb0', b: '#9cd0f0' } },
  { rows: [
    '.....oo.....', '....oLLo....', '..oo.oLo.oo.', '.oLLooLooLLo', '..oLLoLoLLo.', '...ooLLLoo..',
    '.....oLo....', '.....oLo....', '...ooolooo..', '..oeeeeeeeo.', '..oEEEEEEEo.', '...ooooooo..'],
    pal: { o: OUT, L: '#8cd060', l: '#5a9a3a', e: '#8a6446', E: '#6c4b33' } },
  { rows: [
    '............', '...oo..oo...', '..oPPooPPo..', '..oPpooPpo..', 'oo.oo..oo.oo', 'oPPo....oPPo',
    'oPpo....oPpo', '.oo.oooo.oo.', '...oPPPPo...', '..oPPpPPPo..', '..oPPPPPpo..', '...oooooo...'],
    pal: { o: OUT, P: '#e0b070', p: '#a87838' } },
  { rows: [
    '.....oo.....', '....oFFo....', '...oFfFFo...', '...oFFFfo...', '..oFfFFFFo..', '..oFFFfFFo..',
    '.oFFfFFFFFo.', '.oFFFFFfFFo.', '.oFfFFFFFFo.', '..oFFFfFFo..', '...oFFFFo...', '....oooo....'],
    pal: { o: OUT, F: '#d08a5a', f: '#8a4a2a' } },
  { rows: [
    '.....o......', '....oRo.....', '....oRRo....', '...oRYRo.o..', '..oRRYRRoRo.', '..oRYYYRRRo.',
    '.oRYYWYYRRo.', '.oRYWWWYRo..', '..oRYWYRRo..', '.oBBoooooBo.', 'oBBBbBBbBBBo', '.oooooooooo.'],
    pal: { o: OUT, R: '#e0602a', Y: '#f6b340', W: '#fff0b0', B: '#8a6040', b: '#5a3a24' } },
  { rows: [
    '.....oo.....', '....oAAo....', '...oAaaAo...', '..oAaWWaAo..', '.oAaWWWWaAo.', 'oAaWWWWWWaAo',
    'oAaWWWWWWaAo', '.oAaWWWWaAo.', '..oAaWWaAo..', '...oAaaAo...', '....oAAo....', '.....oo.....'],
    pal: { o: OUT, A: '#c8902a', a: '#f2c14e', W: '#fff4cc' } },
];

const cache = new Map<string, HTMLCanvasElement>();
function paint(art: Art, key: string): HTMLCanvasElement {
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const h = art.rows.length, w = art.rows[0].length;
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  art.rows.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      const col = art.pal[row[i]];
      if (!col) continue;
      x.fillStyle = col; x.fillRect(i, y, 1, 1);
    }
  });
  cache.set(key, c);
  return c;
}

function show(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  c.className = 'pix';
  c.style.width = size + 'px';
  c.style.height = Math.round((size * src.height) / src.width) + 'px';
  return c;
}

/** Where a species lives. 'any' = water and land halves; 'shoreLand' = the shore tile. */
export function habitatPixel(zone: string, size = 24): HTMLCanvasElement {
  if (zone === 'water') return show(paint(WATER, 'water'), size);
  if (zone === 'land') return show(paint(LAND, 'land'), size);
  if (zone === 'shore' || zone === 'shoreLand') return show(paint(SHORE, 'shore'), size);
  // any: water on the left, land on the right, the frame kept
  let c = cache.get('any');
  if (!c) {
    c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d')!;
    x.drawImage(paint(WATER, 'water'), 0, 0, 8, 16, 0, 0, 8, 16);
    x.drawImage(paint(LAND, 'land'), 8, 0, 8, 16, 8, 0, 8, 16);
    cache.set('any', c);
  }
  return show(c, size);
}

export function releasePixel(size = 32): HTMLCanvasElement {
  return show(paint(RELEASE, 'release'), size);
}

export function lensPixel(size = 24): HTMLCanvasElement {
  return show(paint(LENS, 'lens'), size);
}

/** The sign of an epoch (the era ruler). */
export function eraPixel(era: number, size = 14): HTMLCanvasElement {
  const i = Math.max(0, Math.min(ERA_ART.length - 1, era));
  return show(paint(ERA_ART[i], 'era' + i), size);
}

export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** The debug / cheats button: a little amber beetle. 14×14. */
const BUG: Art = {
  rows: [
    '..o........o..',
    '...o......o...',
    '....oooooo....',
    '...ohhHHhho...',
    'oo.ohHHHHho.oo',
    '..ooAAaaAAoo..',
    '..oAAAaaAAAo..',
    'ooaAwAaaAAAaoo',
    '..oAAAaaAAAo..',
    '..oAAAaaAAAo..',
    'ooaAAAaaAAAaoo',
    '...oAAaaAAo...',
    '....oooooo....',
    '..............',
  ],
  pal: { o: OUT, h: '#5a4a3a', H: '#8a7058', A: '#f2b54a', a: '#a8661e', w: '#fff3c4' },
};
export function bugPixel(size = 18): HTMLCanvasElement { return show(paint(BUG, 'bug'), size); }

/** A heap of grains (branch «pile composition»), in the colours of its material (sand by default). 14×10. */
const PILE_ROWS = [
  '......oo......',
  '.....oLAo.....',
  '....oLAaAo....',
  '...oLAAAaAo...',
  '..oLAaAAAAAo..',
  '.oLAAAAaAAaAo.',
  'oLAAaAAAAAAAAo',
  'oAAAAAaAAAaAAo',
  '.oooooooooooo.',
  '..............',
];
export function pilePixel(size = 18, matId = 'sand'): HTMLCanvasElement {
  const m = CFG.materials[mat(matId)] ?? CFG.materials[mat('sand')];
  const p = m.palette;
  return show(paint({ rows: PILE_ROWS, pal: { o: OUT, A: p[2], a: p[0], L: p[4] ?? p[3] } }, 'pile-' + matId), size);
}

/** The «Bed» button: strata with a bright ochre bed across them. 14×13. */
const BED: Art = {
  rows: [
    'oooooooooooooo',
    'oYYYYYYYYYYYYo',
    'oYyYYYYyYYYYYo',
    'oYYYYYYYYYYYYo',
    'oBBBBBBBBBBBBo',
    'oBbBBBBBBbBBBo',
    'oGGGGGGGGGGGGo',
    'oGGGgGGGGGgGGo',
    'oBBBBBBBBBBBBo',
    'oBBBbBBBBBBbBo',
    'oGGGGGGGGGGGGo',
    'oGgGGGGGgGGGGo',
    'oooooooooooooo',
  ],
  pal: { o: OUT, Y: '#e08458', y: '#f3b07a', B: '#6b5a4e', b: '#887562', G: '#4a4640', g: '#5e5952' },
};
export function bedPixel(size = 22): HTMLCanvasElement { return show(paint(BED, 'bed'), size); }
