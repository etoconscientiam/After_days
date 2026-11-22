// Hand-placed pixel icons for the small signs on the cards: where a creature lives (water, shore, land) and
// "let one go" (a bird leaving its nest). Drawn at 1:1 and scaled up by whole pixels (image-rendering: pixelated).

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
