#!/usr/bin/env node
/*
  Автотесты «Пиксельной студии 3011».
  Запуск:  cd tools/pixel-studio/tests && npm install && node run.cjs
  Нужен Playwright с Chromium (require('playwright')). Для проверки видео — пакеты из package.json.
  Результат: чек-лист в консоли, out/report.json и out/REPORT.md.
  Флаги: --only=область,область  --quick (без долгих проверок скорости и стресс-теста)
*/
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'pixel-studio-3011.html');
const OUT = path.join(__dirname, 'out');
const FIX = path.join(OUT, 'fixtures');
fs.mkdirSync(FIX, { recursive: true });
const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const QUICK = args.includes('--quick');

const LIBS = {};
for (const [url, mod, file] of [
  ['https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.js', 'mp4-muxer', 'build/mp4-muxer.js'],
  ['https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/build/webm-muxer.js', 'webm-muxer', 'build/webm-muxer.js']]) {
  try { LIBS[url] = fs.readFileSync(path.join(__dirname, 'node_modules', mod, file), 'utf8'); } catch (e) { /* видео пропустим */ }
}
const HAVE_LIBS = Object.keys(LIBS).length === 2;
let FFPROBE = null; try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); FFPROBE = 'ffprobe'; } catch (e) { /* нет */ }

/* ---------- чек-лист ---------- */
const results = [];
let area = '';
const C = { pass: '\x1b[32m✔\x1b[0m', fail: '\x1b[31m✘\x1b[0m', skip: '\x1b[33m–\x1b[0m' };
class Skip extends Error {}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'условие не выполнено'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'ожидалось'}: ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); }
async function check(title, fn) {
  const t0 = Date.now();
  let status = 'pass', detail = '';
  try { const r = await fn(); if (typeof r === 'string') detail = r; }
  catch (e) { if (e instanceof Skip) { status = 'skip'; detail = e.message; } else { status = 'fail'; detail = String(e && e.message || e).split('\n')[0]; } }
  results.push({ area, title, status, detail, ms: Date.now() - t0 });
  console.log(`  ${C[status]} ${title}${detail ? '  — ' + detail : ''}`);
}
const section = (name) => { area = name; console.log('\n■ ' + name); };
const want = name => !ONLY.length || ONLY.some(o => name.toLowerCase().includes(o.toLowerCase()));

/* ---------- страница ---------- */
async function open(browser, opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) p.errors.push('console: ' + m.text()); });
  for (const url in LIBS) await p.route(url, r => r.fulfill({ contentType: 'text/javascript', body: LIBS[url] }));
  await p.addInitScript(o => {
    window.__saved = []; window.__q = []; window.__prompts = []; window.__dl = o.dl || 'ok';
    if (o.noRuntime) return;
    const sample = (input, opts) => new Promise((res, rej) => {
      window.__prompts.push(input);
      const it = window.__q.shift();
      if (!it) return rej({ code: 'upstream_error' });
      if (it.wait) { opts.signal.addEventListener('abort', () => rej({ code: 'cancelled' })); return; }
      if (it.error) return rej({ code: it.error });
      setTimeout(() => { if (opts.onText) opts.onText({ text: it.text, delta: it.text }); res({ text: it.text }); }, it.delay || 20);
    });
    const downloads = { save: async r => {
      if (window.__dl === 'declined') throw { code: 'declined' };
      const buf = new Uint8Array(await r.data.arrayBuffer()); let s = '';
      for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      window.__saved.push([r.filename, btoa(s)]); return { status: 'saved' };
    } };
    window.claude = { use: async n => n === 'sample' ? (o.noSample ? null : sample) : n === 'downloads' ? (o.noDownloads ? null : downloads) : null };
  }, opt);
  await p.goto(PAGE);
  await p.waitForFunction(() => typeof G !== 'undefined' && G.rgb && G.W > 0, null, { timeout: 20000 });
  await settle(p);
  return p;
}
async function settle(p, extra = 40) {
  await p.waitForFunction(() => !raf && dirty === null, null, { timeout: 30000 });
  await p.waitForTimeout(extra);
}
const hash = p => p.evaluate(() => {
  const h = cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let a = 2166136261; for (let i = 0; i < d.length; i += 3) a = Math.imul(a ^ d[i], 16777619); return cv.width + 'x' + cv.height + ':' + (a >>> 0); };
  return { g: h(gridCv), a: h(document.querySelector('#after')) };
});
const setS = (p, fn, stage = 'A') => p.evaluate(([f, st]) => { (0, eval)('(' + f + ')')(S); syncUI(); invalidate(st); }, [fn.toString(), stage]).then(() => settle(p));
// Глубокое слияние объекта в S (без замыканий — можно передавать переменные теста)
const setP = (p, patch, stage = 'A') => p.evaluate(([pt, st]) => { const m = (t, s) => { for (const k in s) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && t[k] && typeof t[k] === 'object') m(t[k], s[k]); else t[k] = s[k]; } }; m(S, pt); syncUI(); invalidate(st); }, [patch, stage]).then(() => settle(p));
const tab = async (p, t) => { await p.click(`.ptabs button[data-tab="${t}"]`); await p.waitForTimeout(40); };
async function slide(p, id, v) { await p.fill('#' + id, String(v)); await p.dispatchEvent('#' + id, 'input'); await settle(p); }
async function changes(p, fn, which = 'g') { const a = await hash(p); await fn(); await settle(p); const b = await hash(p); return a[which] !== b[which]; }
const gridColors = p => p.evaluate(() => { const d = gridCv.getContext('2d').getImageData(0, 0, gridCv.width, gridCv.height).data, s = new Set(); for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return [...s]; });
const palKeys = p => p.evaluate(() => G.pal.map(c => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])));
const waitSaved = (p, n = 1) => p.waitForFunction(n => window.__saved.length >= n, n, { timeout: 15000 });
const saved = async p => (await p.evaluate(() => window.__saved.splice(0))).map(([n, d]) => ({ name: n, buf: Buffer.from(d, 'base64') }));
const noErrors = async p => { ok(!p.errors.length, p.errors.slice(0, 3).join(' | ')); };

/* ---------- разбор файлов ---------- */
function pngSize(b) { ok(b.slice(1, 4).toString() === 'PNG', 'не PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }
function gifInfo(b) {
  ok(b.slice(0, 6).toString() === 'GIF89a', 'не GIF89a');
  const w = b.readUInt16LE(6), h = b.readUInt16LE(8);
  let i = 13; if (b[10] & 0x80) i += 3 * (2 << (b[10] & 7));
  let frames = 0, loop = false, delays = [];
  const skipSub = () => { while (b[i]) i += b[i] + 1; i++; };
  while (i < b.length) {
    const t = b[i++];
    if (t === 0x3B) break;
    if (t === 0x21) { const lab = b[i++]; if (lab === 0xF9) { delays.push(b.readUInt16LE(i + 2)); } if (lab === 0xFF && b.slice(i + 1, i + 12).toString() === 'NETSCAPE2.0') loop = true; skipSub(); }
    else if (t === 0x2C) { frames++; const pk = b[i + 8]; i += 9; if (pk & 0x80) i += 3 * (2 << (pk & 7)); i++; skipSub(); }
    else throw new Error('битый блок GIF');
  }
  return { w, h, frames, loop, delay: delays[0] };
}
function probe(file) {
  if (!FFPROBE) return null;
  const out = execFileSync(FFPROBE, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-show_entries', 'format=duration', '-of', 'json', file]).toString();
  const j = JSON.parse(out), s = j.streams[0];
  return { codec: s.codec_name, w: s.width, h: s.height, frames: +s.nb_read_frames, dur: +j.format.duration };
}

/* ---------- заготовки картинок ---------- */
async function makeFixtures(browser) {
  const p = await (await browser.newContext()).newPage();
  await p.goto('about:blank');
  const files = await p.evaluate(async () => {
    const mk = async (w, h, draw, type, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const b = await new Promise(r => c.toBlob(r, type, q)); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
    const scene = (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h * 0.5); g.addColorStop(0, '#5d7fb0'); g.addColorStop(1, '#b9c8d8'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#5a6e34'; x.fillRect(0, h * 0.5, w, h / 2); x.strokeStyle = '#3f4f22'; x.lineWidth = 3; for (let k = -w; k < 2 * w; k += w / 20) { x.beginPath(); x.moveTo(w / 2, h / 2); x.lineTo(k, h); x.stroke(); } x.fillStyle = '#b07a58'; x.fillRect(w * 0.38, h * 0.3, w * 0.24, h * 0.2); x.fillStyle = '#7a3a30'; x.beginPath(); x.moveTo(w * 0.36, h * 0.3); x.lineTo(w / 2, h * 0.18); x.lineTo(w * 0.64, h * 0.3); x.fill(); };
    return {
      'scene.jpg': await mk(1200, 900, scene, 'image/jpeg', 0.9),
      'big.jpg': await mk(4000, 3000, scene, 'image/jpeg', 0.85),
      'tall.png': await mk(300, 1400, scene, 'image/png'),
      'tiny.png': await mk(40, 30, (x, w, h) => { x.fillStyle = '#c33'; x.fillRect(0, 0, w, h); }, 'image/png'),
      'photo.webp': await mk(800, 800, scene, 'image/webp', 0.9),
      'flat.png': await mk(600, 600, (x, w, h) => { x.fillStyle = '#4a6'; x.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { x.fillStyle = i % 2 ? '#fff' : '#000'; x.fillRect((i * 37) % w, (i * 91) % h, 1, 1); } }, 'image/png'),
      'swatch.png': await mk(40, 8, x => { ['#101820', '#3a5f4a', '#8fb35a', '#e8d27a', '#fff6e0'].forEach((c, i) => { x.fillStyle = c; x.fillRect(i * 8, 0, 8, 8); }); }, 'image/png')
    };
  });
  for (const [n, d] of Object.entries(files)) fs.writeFileSync(path.join(FIX, n), Buffer.from(d, 'base64'));
  fs.writeFileSync(path.join(FIX, 'note.txt'), 'не картинка');
  fs.writeFileSync(path.join(FIX, 'test.gpl'), 'GIMP Palette\nName: Тест GPL\nColumns: 4\n#\n  0   0   0\tчёрный\n255 255 255\tбелый\n200  40  40 red\n 40 200  40 green\n 40  40 200 blue\n');
  fs.writeFileSync(path.join(FIX, 'test.pal'), 'JASC-PAL\r\n0100\r\n4\r\n16 16 16\r\n80 90 100\r\n180 170 120\r\n250 240 220\r\n');
  fs.writeFileSync(path.join(FIX, 'paintnet.txt'), '; paint.net Palette File\n; Colors: 3\nFF112233\nFF445566\nFFAABBCC\n');
  fs.writeFileSync(path.join(FIX, 'lines.hex'), '0d2b45\n203c56\n544e68\n8d697a\nd08159\nffaa5e\n');
  fs.writeFileSync(path.join(FIX, 'lospec.json'), JSON.stringify({ name: 'Болотный свет', author: 'тест', colors: ['0b1a12', '1f3b2a', '4f7a3c', 'a3b85c', 'e9e4b0'] }));
  fs.writeFileSync(path.join(FIX, 'broken.json'), '{"colors": [');
  fs.writeFileSync(path.join(FIX, 'rgb.json'), JSON.stringify([[0, 0, 0], [255, 0, 0], { r: 0, g: 0, b: 255 }]));
  fs.writeFileSync(path.join(FIX, 'rgba.hex'), 'ff004480\n00ff00ff\n#0000ffff\n');
  fs.writeFileSync(path.join(FIX, 'semi.hex'), '#112233;#445566\n');
  fs.writeFileSync(path.join(FIX, 'many.hex'), Array.from({ length: 100 }, (_, i) => ((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0')).join('\n'));
  await p.close();
}

/* ======================================================================== */
(async () => {
  const browser = await chromium.launch();
  await makeFixtures(browser);
  const t0 = Date.now();
  let p = await open(browser);
  const FIXP = n => path.join(FIX, n);
  const plan = await p.evaluate(() => JSON.stringify(DEMO_PLAN));

  if (want('старт')) {
    section('1. Старт');
    await check('страница открывается без ошибок в консоли', () => noErrors(p));
    await check('пример сцены уже нарисован: сетка 108×192, есть палитра', async () => { const r = await p.evaluate(() => [G.W, G.H, G.pal.length, S.mode]); eq(r, [108, 192, 22, 'image']); });
    await check('пример взят с запасом за рамкой (масштаб кадра 2,2)', async () => { eq(await p.evaluate(() => S.crop.zoom), 2.2); });
    await check('история отмены начата, кнопки в верном состоянии', async () => { eq(await p.evaluate(() => [HIST.stack.length >= 1, $('#undoBtn').disabled, $('#redoBtn').disabled]), [true, true, true]); });
    await check('у каждого ползунка есть число справа', async () => { eq(await p.$$eval('.row', rows => rows.filter(r => !r.querySelector('output') || !r.querySelector('output').textContent).length), 0); });
    await check('у анимируемых ползунков есть кнопка ◆ и место под редактор', async () => { const r = await p.evaluate(() => [Object.keys(RANGES).length, document.querySelectorAll('.kbtn').length, document.querySelectorAll('.kedit').length]); ok(r[0] > 40 && r[0] === r[1] && r[1] === r[2], JSON.stringify(r)); return `${r[0]} ползунков`; });
    await check('все id в разметке уникальны', async () => { const d = await p.evaluate(() => { const m = {}; document.querySelectorAll('[id]').forEach(e => { m[e.id] = (m[e.id] || 0) + 1; }); return Object.entries(m).filter(([, c]) => c > 1).map(([k]) => k); }); eq(d, [], 'повторы id'); });
    await check('у полей ввода есть подпись или aria-label', async () => { const d = await p.evaluate(() => [...document.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden' && e.type !== 'file' && !e.getAttribute('aria-label') && !(e.id && document.querySelector(`label[for="${e.id}"]`)) && !e.closest('label')).map(e => e.id || e.dataset.bind || e.dataset.kf)); eq(d, [], 'без подписи'); });
  }

  if (want('источник')) {
    section('2. Источник: загрузка и кадр');
    for (const f of ['scene.jpg', 'photo.webp', 'tall.png']) {
      await check(`загрузка ${f} через «Открыть…»`, async () => { await p.setInputFiles('#fileIn', FIXP(f)); await p.waitForFunction(n => $('#srcName').textContent.startsWith(n), f); await settle(p, 200); eq(await p.evaluate(() => [S.mode, S.crop.zoom]), ['image', 1]); });
    }
    await check('большое фото 4000×3000 уменьшается до 2048 по длинной стороне', async () => { await p.setInputFiles('#fileIn', FIXP('big.jpg')); await p.waitForFunction(() => $('#srcName').textContent.startsWith('big')); await settle(p, 200); eq(await p.evaluate(() => [src.width, src.height]), [2048, 1536]); });
    await check('крошечная картинка 40×30 обрабатывается', async () => { await p.setInputFiles('#fileIn', FIXP('tiny.png')); await p.waitForFunction(() => $('#srcName').textContent.startsWith('tiny')); await settle(p, 200); eq(await p.evaluate(() => [G.W, G.H]), [108, 192]); });
    await check('не-картинка отклоняется с понятным сообщением', async () => { await p.setInputFiles('#fileIn', FIXP('note.txt')); await p.waitForTimeout(150); ok(/Нужен файл изображения/.test(await p.textContent('#toast'))); });
    await check('перетаскивание файла: подсказка появляется и скрывается, файл загружается', async () => {
      const b64 = fs.readFileSync(FIXP('scene.jpg')).toString('base64');
      const r = await p.evaluate(async b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], 'drop.jpg', { type: 'image/jpeg' })); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); const shown = !$('#dropHint').hidden; window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 500)); return [shown, $('#dropHint').hidden, $('#srcName').textContent.startsWith('drop')]; }, b64);
      eq(r, [true, true, true]); await settle(p);
    });
    await check('вставка картинки из буфера (Ctrl+V)', async () => {
      const b64 = fs.readFileSync(FIXP('photo.webp')).toString('base64');
      ok(await p.evaluate(async b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], 'paste.webp', { type: 'image/webp' })); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); await new Promise(r => setTimeout(r, 500)); return $('#srcName').textContent.startsWith('paste'); }, b64));
      await settle(p);
    });
    await p.setInputFiles('#fileIn', FIXP('scene.jpg')); await p.waitForFunction(() => $('#srcName').textContent.startsWith('scene')); await settle(p, 200);
    await tab(p, 'src');
    await check('рамка кадра тянется мышью и меняет картинку', async () => {
      const b = await p.locator('#cropCv').boundingBox(), before = await p.evaluate(() => S.crop.cx), h0 = await hash(p);
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 4 }); await p.mouse.up(); await settle(p);
      ok(before !== await p.evaluate(() => S.crop.cx), 'cx не изменился'); ok(h0.g !== (await hash(p)).g, 'картинка не изменилась');
    });
    await check('колесо над рамкой меняет масштаб кадра', async () => { const b = await p.locator('#cropCv').boundingBox(); const z0 = await p.evaluate(() => S.crop.zoom); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.wheel(0, -200); await settle(p); ok(await p.evaluate(() => S.crop.zoom) > z0); });
    await check('рамка не выходит за картинку при любом сдвиге', async () => { await setS(p, s => { s.crop.cx = 5; s.crop.cy = -3; s.crop.zoom = 2; }); const r = await p.evaluate(() => { const c = cropRect(); return c.x >= 0 && c.y >= 0 && c.x + c.w <= src.width + 0.01 && c.y + c.h <= src.height + 0.01; }); ok(r); });
    await check('«Кадр по X/Y» выключены, когда кадр во всю картинку, и включаются при масштабе > 1', async () => {
      await setS(p, s => { s.crop = { cx: 0.5, cy: 0.5, zoom: 1 }; });
      const a = await p.evaluate(() => [$('#r-crop-cx').disabled || $('#r-crop-cy').disabled, /увеличьте/.test($('#cropHint').textContent) || !$('#r-crop-cx').disabled]);
      await setS(p, s => { s.crop.zoom = 2; });
      const b2 = await p.evaluate(() => [$('#r-crop-cx').disabled, $('#r-crop-cy').disabled]);
      ok(a[0] && a[1], 'при zoom=1 одна из осей должна быть заблокирована'); eq(b2, [false, false]);
    });
    await check('ползунки «Кадр по X/Y» двигают кадр', async () => { ok(await changes(p, () => slide(p, 'r-crop-cx', 0.3))); ok(await changes(p, () => slide(p, 'r-crop-cy', 0.7))); });
    for (const asp of ['1:1', '9:16']) {
      await check(`формат ${asp}: правильная высота сетки и пропорция кадра`, async () => {
        await p.click(`#aspectSeg button[data-aspect="${asp}"]`); await settle(p);
        const r = await p.evaluate(() => { const c = cropRect(); return [G.W, G.H, +(c.w / c.h).toFixed(3)]; });
        eq(r, asp === '1:1' ? [108, 108, 1] : [108, 192, +(108 / 192).toFixed(3)]);
      });
    }
  }

  if (want('предобработка')) {
    section('3. Предобработка и фишай');
    await tab(p, 'src');
    await setS(p, s => { s.palette.method = 'original'; s.pix.sharpen = 0; s.tint = 0; s.vignette = 0; });
    for (const [id, v, test] of [['r-pre-brightness', 60, 'светлее'], ['r-pre-contrast', 80, 'контрастнее'], ['r-pre-saturation', 0, 'серое'], ['r-pre-gamma', 2, 'гамма']]) {
      await check(`${id.replace('r-pre-', '')}: ${test}`, async () => {
        const m0 = await p.evaluate(() => { const d = gridCv.getContext('2d').getImageData(0, 0, G.W, G.H).data; let l = 0, sat = 0; for (let i = 0; i < d.length; i += 4) { l += d[i] + d[i + 1] + d[i + 2]; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); } return [l, sat]; });
        await slide(p, id, v);
        const m1 = await p.evaluate(() => { const d = gridCv.getContext('2d').getImageData(0, 0, G.W, G.H).data; let l = 0, sat = 0; for (let i = 0; i < d.length; i += 4) { l += d[i] + d[i + 1] + d[i + 2]; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); } return [l, sat]; });
        if (test === 'светлее') ok(m1[0] > m0[0] * 1.1, 'не посветлело');
        if (test === 'серое') ok(m1[1] < m0[1] * 0.05, 'не обесцветилось');
        if (test === 'контрастнее' || test === 'гамма') ok(m1[0] !== m0[0], 'не изменилось');
        await p.dblclick(`label[for="${id}"]`); await settle(p);
        eq(+await p.inputValue('#' + id), await p.evaluate(path => getPath(DEFAULTS, path), id.replace('r-', '').replace(/-/g, '.')), 'двойной щелчок не сбросил');
      });
    }
    await check('фишай: вид фишая выключен при силе 0 и включается при силе > 0', async () => { await setS(p, s => { s.fisheye = 0; }); ok(await p.$eval('#fishSel', e => e.disabled)); await slide(p, 'r-fisheye', 0.6); ok(!await p.$eval('#fishSel', e => e.disabled)); });
    await check('настоящий фишай расширяет угол: рабочий холст больше кадра', async () => { await setS(p, s => { s.fisheye = 1; s.fishMode = 'wide'; }); const r = await p.evaluate(() => [G.Ww / (G.W * G.f), G.fish]); ok(r[0] > 2 && r[1], JSON.stringify(r)); });
    await check('настоящий фишай: центр кадра почти не меняется', async () => {
      const mid = () => p.evaluate(() => { const d = gridCv.getContext('2d').getImageData(G.W / 2 - 3 | 0, G.H / 2 - 3 | 0, 6, 6).data; let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s / d.length; });
      await setS(p, s => { s.fisheye = 0; }); const a = await mid(); await setS(p, s => { s.fisheye = 0.6; }); const b2 = await mid();
      ok(Math.abs(a - b2) < 12, `${a.toFixed(1)} → ${b2.toFixed(1)}`);
    });
    await check('бочка: холст не расширяется, картинка меняется', async () => { await setS(p, s => { s.fisheye = 0; s.fishMode = 'barrel'; }); const h0 = await hash(p); await setS(p, s => { s.fisheye = 0.8; }); eq(await p.evaluate(() => G.Ww === G.W * G.f), true); ok(h0.g !== (await hash(p)).g); });
    await check('дорисовка за краем фото без чёрных пятен (самый тёмный угол не чёрный)', async () => {
      await setS(p, s => { s.fishMode = 'wide'; s.fisheye = 1; s.crop = { cx: 0.5, cy: 0.5, zoom: 1 }; });
      const r = await p.evaluate(() => { const d = G.work.data, W = G.Ww, H = G.Wh, pts = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]]; return Math.min(...pts.map(([x, y]) => { const o = (y * W + x) * 4; return d[o] + d[o + 1] + d[o + 2]; })); });
      ok(r > 60, 'угол почти чёрный: ' + r);
    });
    await check('шторка «до» совпадает с фишаем (fishCv того же размера, что кадр)', async () => { await setS(p, s => s); eq(await p.evaluate(() => [fishCv.width, fishCv.height]), await p.evaluate(() => [G.W * G.f, G.H * G.f])); });
    await check('режим текста + фишай: сцена продолжается за рамку (стена и пол вне кадра не чёрные)', async () => {
      await p.click('#tabText'); await settle(p, 200);
      await setS(p, s => { s.fisheye = 1; s.fishMode = 'wide'; });
      const r = await p.evaluate(() => { const d = G.work.data, W = G.Ww; const at = (x, y) => { const o = (y * W + x) * 4; return d[o] + d[o + 1] + d[o + 2]; }; return [at(4, 4), at(W - 5, G.Wh - 5), at(4, G.Wh / 2 | 0)]; });
      ok(r.every(v => v > 40), JSON.stringify(r));
      await p.click('#tabImage'); await settle(p, 200);
    });
    await setS(p, s => { s.fisheye = 0; s.fishMode = 'wide'; s.pre = { brightness: 0, contrast: 8, saturation: 92, gamma: 1 }; s.palette.method = 'gnet'; s.pix.sharpen = 0.3; s.tint = 0.25; s.vignette = 0.4; });
  }

  if (want('сетка')) {
    section('4. Сетка и уменьшение');
    await tab(p, 'pix');
    for (const asp of ['1:1', '9:16']) {
      await check(`привязка к 1080 (${asp}): ширина прыгает только по делителям, PNG без полей`, async () => {
        await setP(p, { aspect: asp, grid: { snap: true } });
        const L = await p.evaluate(a => SNAP[a], asp);
        for (const v of [64, 100, 150, 250, 512]) { await slide(p, 'r-grid-width', v); const w = await p.evaluate(() => S.grid.width); ok(L.includes(w), `${v} → ${w}`); const ex = await p.evaluate(() => exportScale()); eq([ex.padX, ex.padY], [0, 0], `поля при ${w}`); }
      });
    }
    await check('без привязки: любая ширина 64…512, высота = ширина × 16/9', async () => { await setS(p, s => { s.aspect = '9:16'; s.grid.snap = false; }); await slide(p, 'r-grid-width', 97); eq(await p.evaluate(() => [G.W, G.H]), [97, Math.round(97 * 16 / 9)]); });
    await check('клавиши [ и ] меняют ширину', async () => { await setS(p, s => { s.grid.snap = true; s.grid.width = 108; }); await p.locator('#info').click(); await p.keyboard.press(']'); await settle(p); eq(await p.evaluate(() => S.grid.width), 135); await p.keyboard.press('['); await p.keyboard.press('['); await settle(p); eq(await p.evaluate(() => S.grid.width), 90); await setS(p, s => { s.grid.width = 108; }); });
    await check('готовые размеры: кнопка ставит ширину и отмечается, итог показывает пиксель в PNG', async () => { await setP(p, { aspect: '9:16', grid: { snap: true, width: 108 } }); await p.click('#gridChips button[data-w="216"]'); await settle(p); eq(await p.evaluate(() => S.grid.width), 216); eq(await p.getAttribute('#gridChips button[data-w="216"]', 'aria-pressed'), 'true'); ok(/216×384 · в PNG 1080 пиксель = 5×5/.test(await p.textContent('#gridDims')), await p.textContent('#gridDims')); });
    await check('кнопки −/+: с привязкой — соседние размеры, без — шаг 1, с Shift — 8', async () => {
      await p.click('#gridDec'); await settle(p); eq(await p.evaluate(() => S.grid.width), 180);
      await p.click('#gridInc'); await settle(p); eq(await p.evaluate(() => S.grid.width), 216);
      await setP(p, { grid: { snap: false, width: 100 } });
      await p.click('#gridInc'); await settle(p); eq(await p.evaluate(() => S.grid.width), 101);
      await p.click('#gridDec', { modifiers: ['Shift'] }); await settle(p); eq(await p.evaluate(() => S.grid.width), 93);
    });
    await check('поле ширины: любое число без привязки, с привязкой — ближайшее и объяснение', async () => {
      await p.fill('#gridNum', '150'); await p.dispatchEvent('#gridNum', 'change'); await settle(p); eq(await p.evaluate(() => S.grid.width), 150);
      await p.fill('#gridNum', '999'); await p.dispatchEvent('#gridNum', 'change'); await settle(p); eq(await p.evaluate(() => S.grid.width), 512);
      await p.check('#snapCb'); await settle(p); eq(await p.evaluate(() => S.grid.width), 360); ok(/512 → 360/.test(await p.textContent('#toast')));
      await p.fill('#gridNum', '100'); await p.dispatchEvent('#gridNum', 'change'); await settle(p); eq(await p.evaluate(() => S.grid.width), 108); ok(/100 → 108/.test(await p.textContent('#toast')));
    });
    await check('«по окну»: картинка и интерфейс Shore на экране одного размера при любой ширине сетки', async () => {
      const sizes = new Set();
      const hud = new Set();
      for (const w of [72, 108, 135, 216, 360]) { await setP(p, { grid: { width: w } }); const b = await p.locator('#after').boundingBox(); sizes.add(Math.round(b.height / 2)); hud.add(await p.evaluate(() => { const h = shoreHits.find(x => x.key === 'time'), r = afterCv.getBoundingClientRect(); return Math.round(h.w * r.width / afterCv.width / 3); })); }
      eq(sizes.size, 1, 'разных высот'); eq(hud.size, 1, 'разных размеров интерфейса Shore'); ok(/по окну/.test(await p.textContent('#zoomFit')));
    });
    await check('«целые»: строго целое увеличение, кнопка отмечается, повторное нажатие возвращает «по окну»', async () => {
      await p.click('#exactBtn'); await settle(p);
      const r = await p.evaluate(() => [afterCv.width / G.W, afterCv.getBoundingClientRect().width / G.W, $('#exactBtn').getAttribute('aria-pressed')]);
      ok(Number.isInteger(r[0]) && Math.abs(r[1] - Math.round(r[1])) < 0.01 && r[2] === 'true', JSON.stringify(r));
      await p.click('#exactBtn'); await settle(p); ok(/по окну/.test(await p.textContent('#zoomFit')));
      await setP(p, { grid: { width: 108, snap: true } });
    });
    for (const m of ['avg', 'dominant', 'detail', 'center']) {
      await check(`способ «${m}» даёт свою картинку и подсказку`, async () => { await p.selectOption('#methodSel', m); await settle(p); ok((await p.textContent('#methodHint')).length > 20); return (await hash(p)).g.split(':')[1]; });
    }
    await check('четыре способа уменьшения дают разные результаты', async () => { const hs = new Set(); for (const m of ['avg', 'dominant', 'detail', 'center']) { await p.selectOption('#methodSel', m); await settle(p); hs.add((await hash(p)).g); } await p.selectOption('#methodSel', 'avg'); await settle(p); eq(hs.size, 4); });
    await check('резкость меняет картинку', async () => { ok(await changes(p, () => slide(p, 'r-pix-sharpen', 1.5))); await slide(p, 'r-pix-sharpen', 0.3); });
  }

  if (want('палитр')) {
    section('5. Палитры');
    await tab(p, 'pix');
    for (const m of ['median', 'kmeans']) for (const n of [8, 24, 64]) {
      await check(`${m}, ${n} цветов: в картинке не больше ${n} цветов и все из палитры`, async () => {
        await setP(p, { palette: { method: m, colors: n }, fx: { ca: 0, shift: 0, bands: 0, blocks: 0, sort: 0, vhs: 0, dead: 0 } }, 'C');
        const cols = await gridColors(p), pal = await palKeys(p);
        ok(pal.length <= n, `палитра ${pal.length}`); ok(cols.every(c => pal.includes(c)), 'есть цвета вне палитры');
      });
    }
    for (const m of ['gnet', 'fog', 'night']) {
      await check(`готовая палитра «${m}»: все цвета из неё`, async () => {
        await setP(p, { palette: { method: m, colors: 64 } }, 'C');
        const pre = await p.evaluate(m => PALETTES[m].map(h => parseInt(h.slice(1), 16)), m);
        const cols = await gridColors(p); ok(cols.every(c => pre.includes(c)), 'цвет не из палитры');
      });
    }
    await check('«3011 — гнёт» при 8 цветах берёт 8 самых нужных и пишет об этом', async () => { await setS(p, s => { s.palette.method = 'gnet'; s.palette.colors = 8; }, 'C'); eq((await palKeys(p)).length, 8); ok(/самых нужных/.test(await p.textContent('#palHint'))); });
    await check('ручная палитра: понимает HEX через пробел, запятую и перенос, #rgb', async () => { await setS(p, s => { s.palette.method = 'custom'; s.palette.colors = 64; s.palette.custom = '#000000, #fff\n#ff0000 00ff00'; }, 'C'); eq((await palKeys(p)).sort((a, b) => a - b), [0, 0x00ff00, 0xff0000, 0xffffff]); });
    await check('ручная палитра меньше двух цветов: подставляется «гнёт» и есть пояснение', async () => { await setS(p, s => { s.palette.custom = 'мусор #12'; }, 'C'); ok(/меньше двух/.test(await p.textContent('#palHint'))); ok((await palKeys(p)).length >= 8); });
    await check('поле ручной палитры видно только для «Ручная»', async () => { ok(await p.isVisible('#customHex')); await p.selectOption('#palSel', 'kmeans'); await settle(p); ok(!await p.isVisible('#customHex')); });
    await check('подбор OKLab и RGB дают разные результаты', async () => { await setS(p, s => { s.palette.method = 'gnet'; s.palette.colors = 22; s.pix.space = 'oklab'; }, 'C'); const a = await hash(p); await setS(p, s => { s.pix.space = 'rgb'; }, 'C'); ok(a.g !== (await hash(p)).g); await setS(p, s => { s.pix.space = 'oklab'; }, 'C'); });
    await check('«Цвета оригинала»: расхождение с исходником меньше 1/255 после «Выключить цветокоррекцию»', async () => {
      await setS(p, s => { s.palette.method = 'original'; s.pix.sharpen = 0; s.fisheye = 0; }, 'A');
      ok(await p.isVisible('#origFixBtn'), 'нет кнопки'); await p.click('#origFixBtn'); await settle(p);
      const e = await p.evaluate(() => { const W = G.W, H = G.H, f = G.f, d = G.work.data, ww = G.Ww, g = gridCv.getContext('2d').getImageData(0, 0, W, H).data; let s = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let r = 0, gg = 0, bb = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const o = ((y * f + j + G.oy) * ww + x * f + i + G.ox) * 4; r += d[o]; gg += d[o + 1]; bb += d[o + 2]; } const n = f * f, o = (y * W + x) * 4; s += (Math.abs(r / n - g[o]) + Math.abs(gg / n - g[o + 1]) + Math.abs(bb / n - g[o + 2])) / 3; } return s / (W * H); });
      ok(e < 1, e.toFixed(2)); return `расхождение ${e.toFixed(2)}/255`;
    });
    await check('«Цвета оригинала»: дизеринг, чистка, число цветов и «вернуть в палитру» заблокированы', async () => { eq(await p.evaluate(() => ['#ditherSel', '#cleanSel', '#r-palette-colors', '#spaceSel', '#toPal'].map(s => $(s).disabled)), [true, true, true, true, true]); ok(/оригинала/.test(await p.textContent('#info'))); });
    await check('«Цвета оригинала»: обводка работает по яркости', async () => { await setS(p, s => { s.outline.on = false; }, 'C'); const a = await hash(p); await setS(p, s => { s.outline.on = true; s.outline.threshold = 30; }, 'C'); ok(a.g !== (await hash(p)).g); await setS(p, s => { s.outline.on = false; }, 'C'); });
    await setS(p, s => { s.palette.method = 'gnet'; s.palette.colors = 22; s.pre = { brightness: 0, contrast: 8, saturation: 92, gamma: 1 }; s.tint = 0.25; s.vignette = 0.4; s.pix.sharpen = 0.3; }, 'B');
  }

  if (want('палитр') || want('карт')) {
    section('5а. Градиентная карта, библиотека и импорт палитр, палитра словами');
    await tab(p, 'pix');
    const clean = { palette: { method: 'kmeans', colors: 16 }, dither: { type: 'none', strength: 0 }, tint: 0, vignette: 0, tone: { shadowsAmt: 0, highlightsAmt: 0 }, light: { on: false }, fog: { amount: 0 }, glow: { bloom: 0 }, fx: { ca: 0, shift: 0, bands: 0, blocks: 0, sort: 0, vhs: 0, dead: 0, grain: 0 } };
    await setP(p, clean, 'C');
    // --- градиентная карта ---
    await check('карта выключена: цвета, «−», «+», сила недоступны; шесть готовых наборов', async () => {
      eq(await p.evaluate(() => [S.gmap.on, document.querySelectorAll('#gmapPresets button').length, [...document.querySelectorAll('#gmapStops input, #gmapStops button')].every(e => e.disabled), $('#r-gmap-amount').disabled]), [false, 6, true, true]);
    });
    await check('«Ночное видение» включает карту: картинка меняется, все цвета зелёные', async () => {
      const ch = await changes(p, async () => { await p.click('#gmapPresets button[data-gm="nv"]'); });
      ok(ch, 'картинка не изменилась');
      eq(await p.evaluate(() => [S.gmap.on, S.gmap.preset, $('#gmapCb').checked]), [true, 'nv', true]);
      const cols = await gridColors(p);
      ok(cols.every(c => { const r = c >> 16, g = c >> 8 & 255, b = c & 255; return g >= r && g >= b; }), 'есть не-зелёный цвет');
      return `${cols.length} цветов, все зелёные`;
    });
    await check('шесть наборов дают шесть разных картинок, нажатый набор отмечен', async () => {
      const hs = new Set();
      for (const id of ['nv', 'thermal', 'sepia', 'duo3011', 'neon', 'bw']) { await p.click(`#gmapPresets button[data-gm="${id}"]`); await settle(p); hs.add((await hash(p)).g); eq(await p.getAttribute(`#gmapPresets button[data-gm="${id}"]`, 'aria-pressed'), 'true'); }
      eq(hs.size, 6);
    });
    await check('сила 0 — как без карты; сила ползунком меняет кадр', async () => {
      await setP(p, { gmap: { on: false } }, 'C'); const off = (await hash(p)).g;
      await setP(p, { gmap: { on: true, amount: 0 } }, 'C'); eq((await hash(p)).g, off, 'сила 0 не равна выключенной');
      ok(await changes(p, () => slide(p, 'r-gmap-amount', 0.6)), 'ползунок ничего не меняет');
      await setP(p, { gmap: { amount: 1 } }, 'C');
    });
    await check('чёрное → первый цвет, белое → последний (с палитрой «Цвета оригинала»)', async () => {
      const r = await p.evaluate(() => { const lut = gmapLUT(['#102030', '#808080', '#f0e0d0']); return [0, 1, 2, 255 * 3, 255 * 3 + 1, 255 * 3 + 2, 128 * 3].map(i => Math.round(lut[i])); });
      eq(r.slice(0, 6), [16, 32, 48, 240, 224, 208]); ok(Math.abs(r[6] - 128) < 3, 'середина не серая');
    });
    await check('«+» добавляет цвет до 6, «−» убирает до 2, кнопки блокируются на краях', async () => {
      await p.click('#gmapPresets button[data-gm="sepia"]'); await settle(p);
      for (let i = 0; i < 6; i++) { const b = await p.$('#gmapStops button[data-ga="add"]'); if (!await b.isDisabled()) await b.click(); }
      eq(await p.evaluate(() => [S.gmap.stops.length, $('#gmapStops button[data-ga="add"]').disabled, S.gmap.preset]), [6, true, '']);
      for (let i = 0; i < 5; i++) { const b = await p.$('#gmapStops button[data-ga="del"]'); if (!await b.isDisabled()) await b.click(); }
      eq(await p.evaluate(() => [S.gmap.stops.length, $('#gmapStops button[data-ga="del"]').disabled, document.querySelectorAll('#gmapStops input').length]), [2, true, 2]);
      await settle(p);
    });
    await check('⇄ переворачивает карту и меняет кадр', async () => {
      const before = await p.evaluate(() => S.gmap.stops.slice());
      ok(await changes(p, () => p.click('#gmapStops button[data-ga="rev"]')));
      eq(await p.evaluate(() => S.gmap.stops), before.slice().reverse());
    });
    await check('правка цвета: кадр меняется, поле не пересоздаётся (окно выбора цвета не закрывается)', async () => {
      const r = await p.evaluate(async () => {
        const el = $('#gmapStops input[data-gi="0"]'); el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        return [el.isConnected, S.gmap.stops[0], getComputedStyle($('#gmapStops .gbar')).backgroundImage.includes('255, 0, 0')];
      });
      eq(r, [true, '#ff0000', true]); await settle(p);
    });
    await check('карта с «Своей из картинки»: палитра собирается из цветов карты', async () => {
      await p.click('#gmapPresets button[data-gm="neon"]'); await setP(p, { palette: { method: 'median', colors: 8 } }, 'C');
      const pal = await p.evaluate(() => G.pal.map(c => c.map(Math.round)));
      const lut = await p.evaluate(() => { const l = gmapLUT(S.gmap.stops); return Array.from({ length: 256 }, (_, i) => [l[i * 3], l[i * 3 + 1], l[i * 3 + 2]]); });
      const near = c => Math.min(...lut.map(q => Math.abs(q[0] - c[0]) + Math.abs(q[1] - c[1]) + Math.abs(q[2] - c[2])));
      ok(pal.every(c => near(c) < 30), 'цвет палитры далеко от карты');
    });
    await check('карта с готовой палитрой: пояснение и кнопка «Палитра из карты»', async () => {
      await setP(p, { palette: { method: 'gnet', colors: 22 } }, 'C');
      ok(await p.isVisible('#gmapOwnPal'), 'нет кнопки'); ok(/«3011 — гнёт»/.test(await p.textContent('#gmapPalText')));
      await p.click('#gmapOwnPal'); await settle(p);
      eq(await p.evaluate(() => [S.palette.method, S.palette.colors >= 12, $('#gmapPalNote').hidden]), ['median', true, true]);
    });
    await check('«Цвета оригинала» + карта: предупреждение и кнопка выключают и карту', async () => {
      await setP(p, { palette: { method: 'original' } }, 'C');
      ok(/градиентная карта/.test(await p.textContent('#palHint'))); await p.click('#origFixBtn'); await settle(p);
      eq(await p.evaluate(() => S.gmap.on), false);
      await setP(p, Object.assign({}, clean), 'B');
    });
    await check('отмена: включение карты — один шаг, Ctrl+Z выключает', async () => {
      await p.click('#gmapPresets button[data-gm="thermal"]'); await settle(p, 450);
      await p.click('#undoBtn'); await settle(p);
      eq(await p.evaluate(() => S.gmap.on), false);
      await p.click('#redoBtn'); await settle(p); eq(await p.evaluate(() => [S.gmap.on, S.gmap.preset]), [true, 'thermal']);
    });
    await check('пресет хранит свои цвета карты; стиль выключает карту', async () => {
      await setP(p, { gmap: { on: true, preset: '', stops: ['#000011', '#334455', '#ffeedd'], amount: 0.7 } }, 'C');
      const txt = await p.evaluate(() => presetText());
      await setP(p, { gmap: { on: false, stops: ['#000000', '#ffffff'] } }, 'C');
      await p.evaluate(t => { $('#presetText').value = t; $('#presetLoad').click(); }, txt); await settle(p);
      eq(await p.evaluate(() => [S.gmap.on, S.gmap.stops, S.gmap.amount]), [true, ['#000011', '#334455', '#ffeedd'], 0.7]);
      await p.click('#styles button[data-style="vhs"]'); await settle(p);
      eq(await p.evaluate(() => S.gmap.on), false);
      await setP(p, clean, 'C');
    });
    await check('силу карты можно анимировать ключами (◆ у ползунка)', async () => {
      ok(await p.evaluate(() => !!RANGES['gmap.amount'] && !!document.querySelector('.kbtn[data-kpath="gmap.amount"]')));
    });
    // --- библиотека ---
    await check('библиотека: 16 известных палитр, у всех правильные HEX, в списке и в меню', async () => {
      const r = await p.evaluate(() => [PAL_LIB.length, PAL_LIB.every(x => PALETTES[x.id].length >= 4 && PALETTES[x.id].every(h => /^#[0-9a-f]{6}$/.test(h)) && new Set(PALETTES[x.id]).size === PALETTES[x.id].length), document.querySelectorAll('#palLib button').length, document.querySelectorAll('#palSel optgroup').length, PAL_LIB.every(x => !!$(`#palSel option[value="${x.id}"]`))]);
      eq(r, [16, true, 19, 4, true]);
    });
    await check('щелчок по PICO-8: все цвета кадра из PICO-8, имя в подсказке, кнопка отмечена', async () => {
      await p.click('#palLibBox summary'); await p.click('#palLib button[data-pal="pico8"]'); await settle(p);
      const pre = await p.evaluate(() => PALETTES.pico8.map(h => parseInt(h.slice(1), 16)));
      ok((await gridColors(p)).every(c => pre.includes(c)), 'цвет не из PICO-8');
      ok(/PICO-8/.test(await p.textContent('#palHint')));
      eq(await p.evaluate(() => [S.palette.method, S.palette.colors, $('#palSel').value, $('#palLib button[data-pal="pico8"]').getAttribute('aria-pressed')]), ['pico8', 16, 'pico8', 'true']);
    });
    await check('каждая палитра библиотеки: все цвета кадра из неё', async () => {
      const ids = await p.evaluate(() => PAL_LIB.map(x => x.id)); const bad = [];
      for (const id of ids) {
        await setP(p, { palette: { method: id, colors: 64 } }, 'C');
        const pre = await p.evaluate(id => PALETTES[id].map(h => parseInt(h.slice(1), 16)), id);
        if (!(await gridColors(p)).every(c => pre.includes(c))) bad.push(id);
      }
      eq(bad, []);
    });
    await check('Game Boy: 4 цвета, «используются все»; Endesga 32 на 8 цветов — 8 самых нужных', async () => {
      await setP(p, { palette: { method: 'gameboy', colors: 8 } }, 'C'); eq((await palKeys(p)).length, 4); ok(/Game Boy.*используются все/.test(await p.textContent('#palHint')));
      await p.selectOption('#palSel', 'endesga32'); await setP(p, { palette: { colors: 8 } }, 'C'); eq((await palKeys(p)).length, 8); ok(/самых нужных/.test(await p.textContent('#palHint')));
    });
    // --- импорт ---
    const imp = async (f, re) => { await p.setInputFiles('#palFile', FIXP(f)); await p.waitForFunction(r => new RegExp(r).test($('#toast').textContent), re.source, { timeout: 5000 }); await settle(p); };
    const pk = hs => hs.map(h => parseInt(h.slice(1), 16)).sort((a, b) => a - b);
    for (const [f, name, cols] of [
      ['test.gpl', 'Тест GPL', ['#000000', '#ffffff', '#c82828', '#28c828', '#2828c8']],
      ['test.pal', 'test', ['#101010', '#505a64', '#b4aa78', '#faf0dc']],
      ['paintnet.txt', 'paintnet', ['#112233', '#445566', '#aabbcc']],
      ['lines.hex', 'lines', ['#0d2b45', '#203c56', '#544e68', '#8d697a', '#d08159', '#ffaa5e']],
      ['lospec.json', 'Болотный свет', ['#0b1a12', '#1f3b2a', '#4f7a3c', '#a3b85c', '#e9e4b0']],
      ['swatch.png', 'swatch', ['#101820', '#3a5f4a', '#8fb35a', '#e8d27a', '#fff6e0']]]) {
      await check(`импорт ${f}: имя «${name}», ${cols.length} цв., кадр в этих цветах`, async () => {
        await imp(f, /Палитра «/);
        eq(await p.evaluate(() => [S.palette.method, S.palette.customName]), ['custom', name]);
        eq(await p.evaluate(() => S.palette.custom.split(' ')), cols);
        const pal = pk(cols); ok((await gridColors(p)).every(c => pal.includes(c)), 'цвет не из палитры');
        ok((await p.textContent('#palSel option[value="custom"]')).includes(name), 'имя не в меню');
      });
    }
    await check('100 цветов в файле: в кадр идут 64 самых нужных, об этом сказано', async () => { await imp('many.hex', /64 самых нужных/); eq(await p.evaluate(() => [S.palette.custom.split(' ').length, S.palette.colors, G.pal.length]), [100, 64, 64]); });
    await check('битый JSON, не-палитра и фото отклоняются, палитра не меняется', async () => {
      const keep = await p.evaluate(() => S.palette.custom);
      await imp('broken.json', /не загружена.*JSON/); await imp('note.txt', /не загружена.*меньше двух/); await imp('scene.jpg', /не загружена.*фото/);
      eq(await p.evaluate(() => S.palette.custom), keep);
    });
    await check('перетаскивание файла на раздел палитры: импорт, а не новая картинка', async () => {
      const src = await p.textContent('#srcName'), txt = fs.readFileSync(FIXP('test.gpl'), 'utf8');
      const r = await p.evaluate(async t => { const dt = new DataTransfer(); dt.items.add(new File([t], 'drop.gpl', { type: '' })); const sec = $('#secPal'); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); sec.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); const hl = sec.classList.contains('dropping'); sec.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 300)); return [hl, sec.classList.contains('dropping'), $('#dropHint').hidden, S.palette.customName]; }, txt);
      eq(r, [true, false, true, 'Тест GPL']); eq(await p.textContent('#srcName'), src, 'картинка сменилась'); await settle(p);
    });
    await check('ручная правка списка снимает имя; стиль сохраняет ручную палитру с именем', async () => {
      await p.click('#styles button[data-style="lens"]'); await settle(p);
      eq(await p.evaluate(() => [S.palette.customName, S.palette.custom.split(' ').length]), ['Тест GPL', 5]);
      await setP(p, { palette: { method: 'custom' } }, 'C');
      await p.fill('#customHex', '#000000 #ffffff #ff0000'); await settle(p);
      eq(await p.evaluate(() => [S.palette.customName, $('#palSel option[value="custom"]').textContent]), ['', 'Ручная (список HEX)']);
      await setP(p, clean, 'B');
    });
    // --- палитра словами ---
    const palJson = (name, n) => JSON.stringify({ name, colors: Array.from({ length: n }, (_, i) => '#' + [i * 15, 40 + i * 12, 90 + i * 9].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('')) });
    await check('пустое описание — подсказка, запроса нет', async () => { const n = await p.evaluate(() => window.__prompts.length); await p.fill('#aiPalText', ''); await p.click('#aiPalBtn'); ok(/Опишите настроение/.test(await p.textContent('#aiPalStatus'))); eq(await p.evaluate(() => window.__prompts.length), n); });
    await check('ответ Claude → ручная палитра с именем и нужным числом цветов; промпт с описанием и правилами', async () => {
      await p.evaluate(t => window.__q.push({ text: t }), palJson('Ржавый закат', 12));
      await p.fill('#aiPalText', 'ржавый закат над болотом'); await p.selectOption('#aiPalN', '12'); await p.click('#aiPalBtn');
      await p.waitForFunction(() => /Палитра «Ржавый закат»: 12/.test($('#aiPalStatus').textContent)); await settle(p);
      eq(await p.evaluate(() => [S.palette.method, S.palette.customName, S.palette.custom.split(' ').length, S.palette.colors, $('#aiPalBtn').textContent]), ['custom', 'Ржавый закат', 12, 12, 'Создать']);
      const pr = await p.evaluate(() => window.__prompts.at(-1));
      ok(typeof pr === 'string' && pr.includes('ржавый закат над болотом') && pr.includes('ровно из 12') && pr.includes('#rrggbb') && pr.includes('от самого тёмного'), 'промпт неполный');
    });
    await check('ответ в ```json с пояснением и цветами без # тоже принимается (Enter в поле)', async () => {
      await p.evaluate(() => window.__q.push({ text: 'Вот:\n```json\n{"name":"«Больница»","colors":["0a0f12","1c2a30","3c5660","6f8f8f","a7c4bc","e6f2ea","f0e0a0","c05050"]}\n```' }));
      await p.fill('#aiPalText', 'больничный коридор ночью'); await p.selectOption('#aiPalN', '8'); await p.press('#aiPalText', 'Enter');
      await p.waitForFunction(() => /Палитра «Больница»: 8/.test($('#aiPalStatus').textContent)); await settle(p);
    });
    await check('плохой ответ → автоповтор с текстом ошибки → успех', async () => {
      await p.evaluate(t => window.__q.push({ text: '{"colors":["#12","red"]}' }, { text: t }), palJson('Туман', 16));
      const n = await p.evaluate(() => window.__prompts.length); await p.selectOption('#aiPalN', '16'); await p.click('#aiPalBtn');
      await p.waitForFunction(() => /Палитра «Туман»/.test($('#aiPalStatus').textContent));
      eq(await p.evaluate(() => window.__prompts.length), n + 2); const pr = await p.evaluate(() => window.__prompts.at(-1));
      ok(Array.isArray(pr) && /правильных #rrggbb пришло 0/.test(pr[2].content)); await settle(p);
    });
    await check('две ошибки подряд → понятное сообщение, палитра не меняется', async () => {
      const keep = await p.evaluate(() => S.palette.custom);
      await p.evaluate(() => window.__q.push({ text: 'не знаю' }, { text: '{"name":"x"}' })); await p.click('#aiPalBtn');
      await p.waitForFunction(() => /дважды/.test($('#aiPalStatus').textContent)); eq(await p.evaluate(() => S.palette.custom), keep);
    });
    for (const [code, re] of [['rate_limited', /Слишком много/], ['not_granted', /не разрешено.*HEX/], ['refused', /не стал составлять палитру/]]) {
      await check(`ошибка ${code} — понятное сообщение`, async () => { await p.evaluate(c => window.__q.push({ error: c }), code); await p.click('#aiPalBtn'); await p.waitForFunction(r => new RegExp(r).test($('#aiPalStatus').textContent), re.source); eq(await p.textContent('#aiPalBtn'), 'Создать'); });
    }
    await check('«Стоп» прерывает запрос', async () => {
      await p.evaluate(() => window.__q.push({ wait: true })); await p.click('#aiPalBtn'); await p.waitForTimeout(80);
      eq(await p.textContent('#aiPalBtn'), 'Стоп'); await p.click('#aiPalBtn');
      await p.waitForFunction(() => /Остановлено/.test($('#aiPalStatus').textContent)); eq(await p.textContent('#aiPalBtn'), 'Создать');
    });

    // --- найдено при отладке ---
    for (const [f, cols] of [['rgb.json', ['#000000', '#ff0000', '#0000ff']], ['rgba.hex', ['#ff0044', '#00ff00', '#0000ff']], ['semi.hex', ['#112233', '#445566']]]) {
      await check(`импорт ${f}: ${cols.join(' ')}`, async () => { await imp(f, /Палитра «/); eq(await p.evaluate(() => S.palette.custom.split(' ')), cols); });
    }
    await check('файл палитры, брошенный не на раздел палитры, тоже импортируется', async () => {
      const txt = fs.readFileSync(FIXP('lines.hex'), 'utf8');
      const r = await p.evaluate(async t => { const dt = new DataTransfer(); dt.items.add(new File([t], 'окно.hex', { type: '' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 300)); return [S.palette.customName, $('#toast').textContent]; }, txt);
      eq(r[0], 'окно'); await settle(p);
    });
    await check('палитра из меню берёт все свои цвета (Endesga 32 → 32, потом PICO-8 → 16)', async () => {
      await setP(p, { palette: { method: 'gnet', colors: 22 } }, 'C');
      await p.selectOption('#palSel', 'endesga32'); await settle(p); eq(await p.evaluate(() => [S.palette.colors, G.pal.length]), [32, 32]);
      await p.selectOption('#palSel', 'pico8'); await settle(p); eq(await p.evaluate(() => S.palette.colors), 16);
    });
    await check('«Цветов» с ключами: щелчок по палитре библиотеки пишет число в ключ, таймлайн его не откатывает', async () => {
      await p.evaluate(() => { S.palette.colors = 12; addTrack('palette.colors'); });
      await p.click('#palLib button[data-pal="endesga32"]'); await settle(p);
      await p.evaluate(() => { applyTimeline(TL.frame); syncUI(); invalidate('C'); }); await settle(p);
      eq(await p.evaluate(() => S.palette.colors), 32);
      await p.evaluate(() => { removeTrack('palette.colors'); }); await setP(p, clean, 'C');
    });
    await check('ответ Claude с палитрой во время сборки GIF применяется после сборки, GIF в одной палитре', async () => {
      await p.evaluate(t => window.__q.push({ text: t, delay: 300 }), palJson('Поздняя', 8));
      await p.fill('#aiPalText', 'поздний ответ'); await p.selectOption('#aiPalN', '8'); await p.click('#aiPalBtn');
      const r = await p.evaluate(async () => {
        S.anim.frames = 24; syncUI(); const seen = new Set();
        $('#gifBtn').click(); const iv = setInterval(() => { if (gifJob) seen.add(S.palette.method + ':' + G.pal.length); }, 10);
        await new Promise(res => { const w = () => gifJob ? setTimeout(w, 50) : res(); setTimeout(w, 50); });
        clearInterval(iv); await new Promise(r => setTimeout(r, 200));
        return [[...seen], S.palette.method, S.palette.customName];
      });
      eq(r[0].length, 1, 'палитра менялась во время сборки: ' + r[0].join(' ')); eq(r.slice(1), ['custom', 'Поздняя']);
      await p.evaluate(() => { S.anim.frames = 16; syncUI(); }); await saved(p); await settle(p);
    });
    await check('во время сборки GIF Tab не уводит фокус за окно сборки, после — фокус возвращается', async () => {
      await p.focus('#cmpBtn');
      const r = await p.evaluate(async () => { S.anim.frames = 24; syncUI(); $('#gifBtn').click(); await new Promise(r => setTimeout(r, 50)); return [$('.app').inert, $('#busy').contains(document.activeElement)]; });
      for (let i = 0; i < 5; i++) await p.keyboard.press('Tab');
      const inside = await p.evaluate(() => !$('.app').contains(document.activeElement));
      await p.waitForFunction(() => !gifJob, null, { timeout: 60000 }); await p.waitForTimeout(150);
      eq([...r, inside, await p.evaluate(() => [$('.app').inert, document.activeElement.id, cmp.on])], [true, true, true, [false, 'cmpBtn', false]]);
      await p.evaluate(() => { S.anim.frames = 16; syncUI(); }); await saved(p);
    });
    await check('«Варианты» иногда берут палитры библиотеки и градиентную карту', async () => {
      const r = await p.evaluate(() => { const base = styleSnapshot(), rr = rng(42); let lib = 0, gm = 0, cap = 0; for (let i = 0; i < 300; i++) { const v = makeVariant(base, rr, true); if (PAL_LIB.some(x => x.id === v.palette.method)) lib++; if (v.gmap.on) gm++; if (/карта «/.test(variantCaption(v))) cap++; } return [lib, gm, cap]; });
      ok(r[0] > 20 && r[1] > 20 && r[2] === r[1], JSON.stringify(r)); return `из 300: библиотека ${r[0]}, карта ${r[1]}`;
    });
    await check('без вызова Claude — честное сообщение про палитру', async () => {
      const q = await open(browser, { noRuntime: true });
      await tab(q, 'pix'); await q.fill('#aiPalText', 'зима'); await q.click('#aiPalBtn');
      await q.waitForFunction(() => /нет вызова Claude.*HEX/.test($('#aiPalStatus').textContent)); await noErrors(q); await q.context().close();
    });
    await check('«Стоп» срабатывает сразу и с запасным window.claude.complete, поздний ответ не применяется', async () => {
      const q = await open(browser, { noRuntime: true });
      await q.evaluate(() => { window.claude = { complete: () => new Promise(r => setTimeout(() => r('{"name":"Поздно","colors":["#000000","#444444","#888888","#cccccc","#ffffff","#ff0000","#00ff00","#0000ff"]}'), 700)) }; });
      await tab(q, 'pix'); await q.fill('#aiPalText', 'зима'); await q.selectOption('#aiPalN', '8'); await q.click('#aiPalBtn'); await q.waitForTimeout(100);
      await q.click('#aiPalBtn'); await q.waitForTimeout(50);
      eq(await q.evaluate(() => [$('#aiPalStatus').textContent, $('#aiPalBtn').textContent]), ['Остановлено.', 'Создать']);
      await q.waitForTimeout(900); eq(await q.evaluate(() => S.palette.method), 'gnet'); await noErrors(q); await q.context().close();
    });
    await check('«Стоп» у плана сцены тоже срабатывает сразу с window.claude.complete', async () => {
      const q = await open(browser, { noRuntime: true });
      await q.evaluate(() => { window.claude = { complete: () => new Promise(r => setTimeout(() => r('{}'), 700)) }; });
      await q.click('#tabText'); await q.click('#drawBtn'); await q.waitForTimeout(100); await q.click('#stopBtn'); await q.waitForTimeout(50);
      ok(/Остановлено/.test(await q.textContent('#aiStatus'))); ok(!await q.$eval('#drawBtn', e => e.disabled)); await q.waitForTimeout(800); await noErrors(q); await q.context().close();
    });
    await check('картинка, вставленная во время сборки GIF, загружается после сборки', async () => {
      const b64 = fs.readFileSync(FIXP('tiny.png')).toString('base64');
      const r = await p.evaluate(async b64 => {
        S.anim.frames = 24; syncUI(); const was = $('#srcName').textContent; $('#gifBtn').click(); await new Promise(r => setTimeout(r, 30));
        const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u], 'mid.png', { type: 'image/png' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 300)); const during = $('#srcName').textContent === was && !!gifJob;
        await new Promise(res => { const w = () => gifJob ? setTimeout(w, 50) : res(); w(); }); await new Promise(r => setTimeout(r, 400));
        return [during, $('#srcName').textContent.startsWith('mid')];
      }, b64);
      eq(r, [true, true]); await p.evaluate(() => { S.anim.frames = 16; syncUI(); }); await saved(p);
      await p.setInputFiles('#fileIn', FIXP('scene.jpg')); await p.waitForFunction(() => $('#srcName').textContent.startsWith('scene')); await settle(p, 200);
    });
    await setS(p, s => { s.gmap.on = false; s.palette.method = 'gnet'; s.palette.colors = 22; s.dither.type = 'bayer4'; s.dither.strength = 0.3; s.tint = 0.25; s.vignette = 0.4; }, 'B');
    await check('без ошибок в консоли', () => noErrors(p));
  }

  if (want('дизеринг')) {
    section('6. Дизеринг, чистка, обводка');
    await tab(p, 'pix');
    const types = ['none', 'bayer2', 'bayer4', 'bayer8', 'fs', 'atkinson'];
    await check('шесть типов дизеринга дают разные картинки', async () => { const hs = new Set(); for (const t of types) { await setS(p, s => { s.dither.type = 'X'.replace('X', ''); }, 'C'); await p.selectOption('#ditherSel', t); await settle(p); hs.add((await hash(p)).g); } eq(hs.size, 6); });
    await check('сила 0 у Байера = без дизеринга', async () => { await setS(p, s => { s.dither = { type: 'none', strength: 0.5 }; }, 'C'); const a = await hash(p); await setS(p, s => { s.dither = { type: 'bayer4', strength: 0 }; }, 'C'); eq((await hash(p)).g, a.g); });
    await check('ползунок силы заблокирован при «Нет»', async () => { await p.selectOption('#ditherSel', 'none'); await settle(p); ok(await p.$eval('#r-dither-strength', e => e.disabled)); await p.selectOption('#ditherSel', 'bayer4'); await settle(p); });
    await check('чистка «убрать одиночные»: не остаётся пикселей без единого соседа своего цвета', async () => {
      await p.setInputFiles('#fileIn', FIXP('flat.png')); await p.waitForFunction(() => $('#srcName').textContent.startsWith('flat')); await settle(p, 200);
      const lonely = () => p.evaluate(() => { const W = G.W, H = G.H, idx = G.idx; let n = 0; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const c = idx[y * W + x]; let same = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && idx[(y + j) * W + x + i] === c) same++; if (!same) n++; } return n; });
      await setS(p, s => { s.palette.method = 'kmeans'; s.palette.colors = 8; s.dither.type = 'fs'; s.dither.strength = 1; s.clean = 'off'; s.pix.method = 'center'; }, 'B');
      const before = await lonely(); await setS(p, s => { s.clean = 'soft'; }, 'C'); const after = await lonely();
      ok(after === 0 && before > 0, `${before} → ${after}`); return `${before} → ${after}`;
    });
    await check('обводка: тёмных пикселей становится больше, порог 140 почти выключает', async () => {
      await p.setInputFiles('#fileIn', FIXP('scene.jpg')); await p.waitForFunction(() => $('#srcName').textContent.startsWith('scene')); await settle(p, 200);
      await setS(p, s => { s.palette.method = 'gnet'; s.palette.colors = 22; s.dither.type = 'none'; s.clean = 'soft'; s.pix.method = 'avg'; s.outline.on = false; }, 'B');
      const dark = () => p.evaluate(() => G.idx.reduce((a, v) => a + (v === G.darkest), 0));
      const a = await dark(); await setS(p, s => { s.outline = { on: true, threshold: 20 }; }, 'C'); const b2 = await dark(); await setS(p, s => { s.outline = { on: true, threshold: 140 }; }, 'C'); const c = await dark();
      ok(b2 > a && c < b2, `${a} / ${b2} / ${c}`); await setS(p, s => { s.outline = { on: false, threshold: 56 }; s.dither = { type: 'bayer4', strength: 0.3 }; }, 'C');
    });
  }

  if (want('подача')) {
    section('7. Подача пикселя');
    await tab(p, 'pix');
    await check('сила подачи заблокирована при «чистый»', async () => { await p.click('#lookSeg button[data-look="none"]'); await settle(p); ok(await p.$eval('#r-pix-lookStrength', e => e.disabled)); });
    for (const l of ['grid', 'scan', 'led']) {
      await check(`подача «${l}» меняет экран, но не сетку`, async () => { const a = await hash(p); await p.click(`#lookSeg button[data-look="${l}"]`); await settle(p); const b2 = await hash(p); ok(a.a !== b2.a, 'экран не изменился'); eq(b2.g, a.g, 'сетка изменилась'); });
    }
    await check('подача попадает в PNG 1080', async () => { await p.click('#lookSeg button[data-look="grid"]'); await settle(p); await p.click('#tbPng'); await waitSaved(p); const f = (await saved(p))[0]; ok(f && f.name.endsWith('.png')); await p.click('#lookSeg button[data-look="none"]'); await settle(p); });
  }

  if (want('свет')) {
    section('8. Свет и атмосфера');
    await tab(p, 'light');
    await check('ползунки лампы заблокированы, пока лампа выключена', async () => { await setS(p, s => { s.light.on = false; }, 'C'); eq(await p.evaluate(() => ['#r-light-power', '#r-light-radius', '#r-light-x', '#lightColor'].map(s => $(s).disabled)), [true, true, true, true]); });
    await check('включение лампы меняет картинку, лампа видна на кадре', async () => { ok(await changes(p, () => p.check('#lightCb'))); ok(await p.isVisible('#lamp')); });
    for (const [id, v] of [['r-light-power', 2.8], ['r-light-radius', 0.2], ['r-light-z', 0.9], ['r-light-ambient', 0.1], ['r-light-shadowTint', 1], ['r-light-relief', 1.4], ['r-light-x', 0.9], ['r-light-y', 0.9], ['r-light-rays', 1.2], ['r-glow-bloom', 1.2], ['r-fog-amount', 0.7], ['r-tint', 0.9], ['r-tone-shadowsAmt', 0.8], ['r-tone-highlightsAmt', 0.8], ['r-vignette', 1]]) {
      await check(`${id.replace('r-', '')} меняет картинку`, async () => { ok(await changes(p, () => slide(p, id, v))); });
    }
    await check('пыль работает только вместе с лучами', async () => { await slide(p, 'r-light-rays', 0); ok(await p.$eval('#r-light-dust', e => e.disabled)); await slide(p, 'r-light-rays', 0.8); ok(!await p.$eval('#r-light-dust', e => e.disabled)); ok(await changes(p, () => slide(p, 'r-light-dust', 1))); });
    await check('цвет лампы, теней, дымки и тонов меняют картинку', async () => { for (const id of ['lightColor', 'shadowColor', 'fogColor', 'toneS', 'toneH']) { const c = await changes(p, async () => { await p.fill('#' + id, '#ff0000'); await p.dispatchEvent('#' + id, 'input'); }); ok(c, id); } });
    await check('лампа тянется мышью и двигается стрелками', async () => {
      const b = await p.locator('#lamp').boundingBox(); const x0 = await p.evaluate(() => S.light.x);
      await p.mouse.move(b.x + 13, b.y + 13); await p.mouse.down(); await p.mouse.move(b.x - 60, b.y + 40, { steps: 4 }); await p.mouse.up(); await settle(p);
      const x1 = await p.evaluate(() => S.light.x); ok(x1 < x0, `${x0} → ${x1}`);
      await p.focus('#lamp'); await p.keyboard.press('ArrowRight'); await settle(p); ok(await p.evaluate(() => S.light.x) > x1);
    });
    await check('лампа скрыта на других вкладках', async () => { await tab(p, 'fx'); ok(!await p.isVisible('#lamp')); await tab(p, 'light'); ok(await p.isVisible('#lamp')); });
    await check('пересвет не выжигает кадр в один цвет (мягкое плечо)', async () => { await setS(p, s => { s.light = { ...s.light, on: true, power: 3, radius: 2.5, ambient: 1.2, rays: 1.5 }; s.glow.bloom = 1.5; }, 'C'); const n = (await gridColors(p)).length; ok(n >= 6, n + ' цветов'); });
    await setS(p, s => { s.light = JSON.parse(JSON.stringify(DEFAULTS.light)); s.glow = { ...DEFAULTS.glow }; s.fog = { ...DEFAULTS.fog }; s.tone = { ...DEFAULTS.tone }; s.tint = 0.25; s.vignette = 0.4; }, 'C');
  }

  if (want('эффекты')) {
    section('9. Эффекты: аберрация и глитч');
    await tab(p, 'fx');
    await check('направление аберрации недоступно при сдвиге 0', async () => { await setS(p, s => { s.fx.ca = 0; }, 'E'); ok(await p.$eval('#caSeg button', e => e.disabled)); });
    for (const m of ['radial', 'horizontal', 'diagonal']) {
      await check(`аберрация «${m}» сдвигает каналы`, async () => { await slide(p, 'r-fx-ca', 3); await p.click(`#caSeg button[data-ca="${m}"]`); await settle(p); const a = await hash(p); await slide(p, 'r-fx-ca', 0); ok(a.g !== (await hash(p)).g); });
    }
    for (const [id, v] of [['r-fx-shift', 0.8], ['r-fx-bands', 0.8], ['r-fx-blocks', 0.8], ['r-fx-sort', 0.8], ['r-fx-vhs', 0.8], ['r-fx-dead', 0.8], ['r-fx-grain', 0.6]]) {
      await check(`${id.replace('r-fx-', '')} меняет картинку`, async () => { ok(await changes(p, () => slide(p, id, v))); });
    }
    await check('направление сортировки, порог, место полосы VHS и цветное зерно работают', async () => { ok(await changes(p, async () => { await p.selectOption('#sortDir', 'v'); })); ok(await changes(p, () => slide(p, 'r-fx-sortThr', 0.2))); ok(await changes(p, () => slide(p, 'r-fx-vhsPos', 0.2))); ok(await changes(p, () => p.check('#grainCol'))); });
    await check('«Перемешать глитч» меняет вариант', async () => { const s0 = await p.textContent('#seedInfo'); ok(await changes(p, () => p.click('#reseedBtn'))); ok(s0 !== await p.textContent('#seedInfo')); });
    await check('«Вернуть эффекты в палитру»: все цвета снова из палитры', async () => { await slide(p, 'r-fx-ca', 3); await p.check('#toPal'); await settle(p); const cols = await gridColors(p), pal = await palKeys(p); ok(cols.every(c => pal.includes(c)), 'есть цвета вне палитры'); await p.uncheck('#toPal'); await settle(p); ok((await gridColors(p)).some(c => !pal.includes(c)), 'без галочки цвета должны выходить из палитры'); });
    await check('эффекты не трогают исходные пиксели вне глитча (аберрация 0, глитч 0 → как до)', async () => { await setS(p, s => { Object.assign(s.fx, { ca: 0, shift: 0, bands: 0, blocks: 0, sort: 0, vhs: 0, dead: 0, grain: 0, grainColor: false, toPalette: false }); }, 'C'); const a = await p.evaluate(() => { const d = gridCv.getContext('2d').getImageData(0, 0, G.W, G.H).data; for (let i = 0; i < d.length; i++) if (d[i] !== G.rgb[i]) return false; return true; }); ok(a); });
  }

  if (want('shore')) {
    section('10. Интерфейс очков Shore');
    await tab(p, 'shore');
    await check('включение и выключение меняет экран, но не сетку', async () => { const a = await hash(p); await p.uncheck('#shoreCb'); await settle(p); const b2 = await hash(p); ok(a.a !== b2.a); eq(a.g, b2.g); await p.check('#shoreCb'); await settle(p); });
    for (const [sel, v] of [['#shTime', '23:59'], ['#shNotif', '0'], ['#shNotif', '42']]) {
      await check(`поле ${sel} = ${v} меняет интерфейс`, async () => { ok(await changes(p, async () => { await p.fill(sel, v); await p.dispatchEvent(sel, 'input'); }, 'a')); });
    }
    await check('числовые поля держат пределы, пустое поле откатывается', async () => { for (const [v, e] of [['-5', 0], ['1000', 99], ['', 99]]) { await p.fill('#shNotif', v); await p.dispatchEvent('#shNotif', 'input'); await p.dispatchEvent('#shNotif', 'change'); eq(await p.evaluate(() => S.shore.notif), e, 'notif=' + v); } eq(await p.inputValue('#shNotif'), '99'); await p.fill('#shNotif', '3'); await p.dispatchEvent('#shNotif', 'change'); });
    await check('REC, батарея (в т. ч. красная при < 20%), прозрачность', async () => { ok(await changes(p, () => p.uncheck('#shRec'), 'a')); await p.check('#shRec'); ok(await changes(p, () => slide(p, 'r-shore-battery', 10), 'a')); ok(await changes(p, () => slide(p, 'r-shore-opacity', 0.35), 'a')); });
    await check('уголки, время, батарея и Blik выключаются по отдельности', async () => { for (const id of ['#shCorners', '#shShowTime', '#shBattery', '#shBlik']) { ok(await changes(p, () => p.uncheck(id), 'a'), id); await p.check(id); } await settle(p); });
    await check('каждый элемент Shore тянется мышью, «Вернуть на места» возвращает', async () => {
      const moved = [];
      for (const key of ['time', 'rec', 'battery', 'notif', 'blik']) {
        const pt = await p.evaluate(k => { const h = shoreHits.find(x => x.type === 'el' && x.key === k); if (!h) return null; const r = afterCv.getBoundingClientRect(); return { x: r.left + (h.x + h.w / 2) * r.width / afterCv.width, y: r.top + (h.y + h.h / 2) * r.height / afterCv.height }; }, key);
        ok(pt, 'нет элемента ' + key);
        await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x - 40, pt.y + 60, { steps: 4 }); await p.mouse.up(); await settle(p);
        if (await p.evaluate(k => !!S.shore.pos[k], key)) moved.push(key);
      }
      eq(moved, ['time', 'rec', 'battery', 'notif', 'blik']);
      const a = await hash(p); await p.click('#shoreReset'); await settle(p); ok(a.a !== (await hash(p)).a); eq(await p.evaluate(() => Object.values(S.shore.pos).every(v => v === null)), true);
    });
    await check('аннотация: кнопка добавляет, поле текста в фокусе, текст меняет экран', async () => { const n0 = await p.evaluate(() => S.shore.notes.length); await p.click('#noteAdd'); await settle(p); eq(await p.evaluate(() => S.shore.notes.length), n0 + 1); ok(await p.evaluate(() => document.activeElement.classList.contains('n-text'))); ok(await changes(p, async () => { await p.keyboard.type('ПРИВЕТ, МИР'); }, 'a')); eq(await p.evaluate(() => S.shore.notes.at(-1).text), 'ПРИВЕТ, МИР'); });
    await check('четыре вида аннотаций и размер 2× выглядят по-разному', async () => { const last = await p.evaluate(() => S.shore.notes.length - 1); const hs = new Set(); for (const k of ['label', 'box', 'plate', 'pointer']) { await p.selectOption(`.noterow[data-i="${last}"] .n-kind`, k); await settle(p); hs.add((await hash(p)).a); } await p.selectOption(`.noterow[data-i="${last}"] .n-size`, '2'); await settle(p); hs.add((await hash(p)).a); eq(hs.size, 5); });
    await check('у выноски тянется и текст, и точка на конце', async () => {
      const last = await p.evaluate(() => S.shore.notes.length - 1);
      const get = part => p.evaluate(([i, part]) => { const h = shoreHits.find(x => x.type === 'note' && x.i === i && x.part === part); const r = afterCv.getBoundingClientRect(); return { x: r.left + (h.x + h.w / 2) * r.width / afterCv.width, y: r.top + (h.y + h.h / 2) * r.height / afterCv.height }; }, [last, part]);
      const n0 = await p.evaluate(i => ({ ...S.shore.notes[i] }), last);
      let pt = await get('target'); await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x + 50, pt.y + 50, { steps: 4 }); await p.mouse.up(); await settle(p);
      pt = await get('text'); await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x - 30, pt.y - 30, { steps: 4 }); await p.mouse.up(); await settle(p);
      const n1 = await p.evaluate(i => ({ ...S.shore.notes[i] }), last);
      ok(n1.tx > n0.tx && n1.ty > n0.ty && n1.x < n0.x && n1.y < n0.y, JSON.stringify([n0, n1]));
    });
    await check('двойной щелчок по пустому месту кадра добавляет аннотацию в эту точку', async () => { const n0 = await p.evaluate(() => S.shore.notes.length); const a = await p.locator('#after').boundingBox(); await p.mouse.dblclick(a.x + a.width * 0.6, a.y + a.height * 0.85); await settle(p); const n = await p.evaluate(() => S.shore.notes.at(-1)); eq(await p.evaluate(() => S.shore.notes.length), n0 + 1); ok(Math.abs(n.x - 0.6) < 0.03 && Math.abs(n.y - 0.85) < 0.03, JSON.stringify(n)); });
    await check('двойной щелчок по аннотации открывает её текст', async () => { await tab(p, 'pix'); const pt = await p.evaluate(() => { const h = shoreHits.find(x => x.type === 'note' && x.i === 0 && x.part === 'text'); const r = afterCv.getBoundingClientRect(); return { x: r.left + (h.x + h.w / 2) * r.width / afterCv.width, y: r.top + (h.y + h.h / 2) * r.height / afterCv.height }; }); await p.mouse.dblclick(pt.x, pt.y); await p.waitForTimeout(100); eq(await p.evaluate(() => [activeTab, document.activeElement.closest('.noterow') && document.activeElement.closest('.noterow').dataset.i]), ['shore', '0']); });
    await check('удаление, выключение и предел в 12 аннотаций', async () => { while (await p.evaluate(() => S.shore.notes.length) < 12) { await p.click('#noteAdd'); } ok(await p.$eval('#noteAdd', e => e.disabled)); await p.evaluate(() => addNote(0.5, 0.5)); eq(await p.evaluate(() => S.shore.notes.length), 12); ok(/максимум/.test(await p.textContent('#toast'))); ok(await changes(p, () => p.uncheck('.noterow[data-i="0"] .n-on'), 'a')); while (await p.evaluate(() => S.shore.notes.length) > 2) { await p.click('.noterow:last-child .n-del'); } await settle(p); ok(!await p.$eval('#noteAdd', e => e.disabled)); });
    await check('аннотации видны и без интерфейса очков, и выключаются своей галочкой', async () => { await p.check('.noterow[data-i="0"] .n-on'); await p.uncheck('#shoreCb'); await settle(p); ok(await p.evaluate(() => shoreHits.some(h => h.type === 'note') && !shoreHits.some(h => h.type === 'el'))); ok(await changes(p, () => p.uncheck('#notesCb'), 'a')); await p.check('#notesCb'); await p.check('#shoreCb'); await settle(p); });
    await check('перемещение элемента и правка аннотации отменяются', async () => { await p.waitForTimeout(500); await p.evaluate(() => { S.shore.pos.time = { x: 0.5, y: 0.5 }; invalidate('D'); }); await settle(p); await p.waitForTimeout(500); await p.click('#undoBtn'); await settle(p); eq(await p.evaluate(() => S.shore.pos.time), null); });
    await check('пиксельный шрифт знает всю кириллицу, латиницу, цифры и знаки', async () => { const miss = await p.evaluate(() => [...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!-+/%()"\'#_=°·*<>«»—–•№'].filter(c => glyph(c) === GLYPHS['?'])); eq(miss, []); });
    await check('старый пресет с тремя подписями превращается в аннотации', async () => { await tab(p, 'file'); await p.fill('#presetText', JSON.stringify({ settings: { shore: { labels: [{ text: 'А', x: 0.1, y: 0.1, on: true }, { text: 'Б', x: 0.2, y: 0.2, on: false }, { text: 'В', x: 0.3, y: 0.3, on: true }] } } })); await p.click('#presetLoad'); await settle(p); eq(await p.evaluate(() => S.shore.notes.map(n => [n.text, n.kind, n.on])), [['А', 'label', true], ['Б', 'label', false], ['В', 'label', true]]); eq(await p.$$eval('.noterow', r => r.length), 3); await tab(p, 'shore'); });
    await setS(p, s => { s.shore = JSON.parse(JSON.stringify(DEFAULTS.shore)); }, 'D'); await p.evaluate(() => renderNotes());
  }

  if (want('холст')) {
    section('11. Холст: шторка, масштаб, пипетка');
    await check('шторка «до/после»: кнопка, ручка, клавиши', async () => { await p.click('#cmpBtn'); await settle(p); ok(await p.isVisible('#handle') && await p.isVisible('#before')); await p.focus('#handle'); await p.keyboard.press('ArrowLeft'); eq(await p.evaluate(() => +cmp.p.toFixed(2)), 0.45); await p.click('#cmpBtn'); await settle(p); ok(!await p.isVisible('#handle')); });
    await check('пробел (держать) показывает исходник и возвращает обратно', async () => { await p.locator('#info').click(); await p.keyboard.down(' '); await p.waitForTimeout(80); const held = await p.evaluate(() => [cmp.on, cmp.p]); await p.keyboard.up(' '); await p.waitForTimeout(80); eq(held, [true, 1]); eq(await p.evaluate(() => cmp.on), false); });
    await check('масштаб: + до предела, − до «вписано», 0 вписывает', async () => { for (let i = 0; i < 25; i++) await p.click('#zoomIn'); await settle(p); const big = await p.evaluate(() => [afterCv.width * afterCv.height, view.fit]); ok(big[0] <= 32e6 && !big[1]); for (let i = 0; i < 25; i++) await p.click('#zoomOut'); await settle(p); ok(await p.evaluate(() => view.fit)); await p.click('#zoomIn'); await p.locator('#info').click(); await p.keyboard.press('0'); await settle(p); ok(await p.evaluate(() => view.fit)); });
    await check('колесо мыши приближает к точке под курсором, кадр тянется', async () => { const st = await p.locator('#stage').boundingBox(); await p.mouse.move(st.x + st.width / 2, st.y + st.height / 2); await p.mouse.wheel(0, -300); await settle(p); ok(!await p.evaluate(() => view.fit)); const px0 = await p.evaluate(() => view.px); await p.mouse.down(); await p.mouse.move(st.x + st.width / 2 + 80, st.y + st.height / 2, { steps: 3 }); await p.mouse.up(); ok(await p.evaluate(() => view.px) !== px0); await p.click('#zoomFit'); await settle(p); });
    await check('пипетка показывает координаты и HEX', async () => { const a = await p.locator('#after').boundingBox(); await p.mouse.move(a.x + 20, a.y + 30); ok(/x \d+ · y \d+ · #[0-9a-f]{6}/.test(await p.textContent('#pick'))); });
    await check('холст не дёргается при наведении на края (размер и место неизменны)', async () => {
      const a = await p.locator('#after').boundingBox(); const seen = new Set();
      for (let t = 0; t <= 1; t += 0.1) for (const [x, y] of [[a.x + t * a.width, a.y - 2], [a.x + t * a.width, a.y + a.height + 1], [a.x - 2, a.y + t * a.height], [a.x + a.width + 1, a.y + t * a.height], [a.x + t * a.width, a.y + 1]]) { await p.mouse.move(x, y); await p.waitForTimeout(5); const b = await p.locator('#after').boundingBox(); seen.add([b.x, b.y, b.width, b.height].map(Math.round).join()); }
      eq(seen.size, 1, 'вариантов положения');
    });
    await check('длинное сообщение не сдвигает холст', async () => { const a = await p.locator('#after').boundingBox(); await p.evaluate(() => toast('Очень длинное сообщение '.repeat(8))); await p.waitForTimeout(100); const b = await p.locator('#after').boundingBox(); eq([b.y, b.height], [a.y, a.height]); });
  }

  if (want('клавиш')) {
    section('11а. Горячие клавиши');
    await check('цифры 1–6 переключают вкладки', async () => { await p.locator('#info').click(); const got = []; for (const k of '123456') { await p.keyboard.press(k); got.push(await p.evaluate(() => activeTab)); } eq(got, ['src', 'pix', 'light', 'fx', 'shore', 'file']); });
    await check('русская раскладка: С, К, Д, Р, Б, Ю работают как C, R, L, H, «,», «.»', async () => {
      await p.locator('#info').click();
      const press = k => p.evaluate(k => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }, k);
      p.keyboard.press = new Proxy(p.keyboard.press, { apply: (f, th, a) => /^[а-яё]$/.test(a[0]) ? press(a[0]) : f.apply(th, a) });
      const r = [];
      await p.keyboard.press('с'); r.push(await p.evaluate(() => cmp.on)); await p.keyboard.press('с');
      const seed = await p.evaluate(() => S.fx.seed); await p.keyboard.press('к'); r.push(seed !== await p.evaluate(() => S.fx.seed));
      await p.keyboard.press('д'); r.push(await p.evaluate(() => S.light.on)); await p.keyboard.press('д');
      await p.keyboard.press('р'); r.push(!await p.evaluate(() => S.shore.on)); await p.keyboard.press('р');
      await p.keyboard.press('Home'); await p.keyboard.press('ю'); await p.keyboard.press('ю'); await p.keyboard.press('б'); r.push(await p.evaluate(() => TL.frame === 1));
      await settle(p); eq(r, [true, true, true, true, true]);
    });
    await check('Ctrl+S — PNG, Ctrl+Shift+S — GIF, Ctrl+Alt+S — видео', async () => {
      await saved(p); await setS(p, s => { s.anim.frames = 4; s.anim.loops = 1; s.anim.size = 'small'; s.anim.vsize = 'small'; }, 'N');
      await p.locator('#info').click();
      await p.keyboard.press('Control+s'); await waitSaved(p);
      await p.keyboard.press('Control+Shift+s'); await p.waitForFunction(() => $('#busy').hidden && $('#tbGif').textContent === 'GIF', null, { timeout: 60000 }); await p.waitForTimeout(200);
      if (HAVE_LIBS) { await p.keyboard.press('Control+Alt+s'); await p.waitForFunction(() => $('#busy').hidden && $('#tbMp4').textContent === 'MP4', null, { timeout: 60000 }); await p.waitForTimeout(200); }
      const names = (await saved(p)).map(f => f.name.split('.').pop()); eq(names, HAVE_LIBS ? ['png', 'gif', 'mp4'] : ['png', 'gif']);
      await setS(p, s => { s.anim.frames = 16; s.anim.loops = 3; s.anim.size = 'half'; s.anim.vsize = 'full'; }, 'N');
    });
    await check('Ctrl+O открывает выбор файла', async () => { await p.locator('#info').click(); const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 3000 }), p.keyboard.press('Control+o')]); ok(fc); });
    await check('клавиши не срабатывают, пока печатаешь в поле', async () => { await tab(p, 'shore'); await p.focus('#shTime'); const t0 = await p.evaluate(() => activeTab); await p.keyboard.type('12'); eq(await p.evaluate(() => activeTab), t0); await p.fill('#shTime', '03:11'); await p.dispatchEvent('#shTime', 'input'); });
  }

  if (want('история')) {
    section('12. Отмена и повтор');
    await tab(p, 'pix');
    await check('два разных быстрых действия — два шага отмены', async () => {
      await p.waitForTimeout(500); const s0 = await p.evaluate(() => snapState());
      await slide(p, 'r-dither-strength', 0.9); await p.waitForTimeout(100); await p.selectOption('#palSel', 'night'); await settle(p); await p.waitForTimeout(500);
      await p.click('#undoBtn'); await settle(p); eq(await p.evaluate(() => S.palette.method), 'gnet'); eq(await p.evaluate(() => S.dither.strength), 0.9);
      await p.click('#undoBtn'); await settle(p); eq(await p.evaluate(() => snapState()), s0, 'состояние после двух отмен');
    });
    await check('повтор возвращает изменения, Ctrl+Z / Ctrl+Shift+Z работают', async () => { await p.click('#redoBtn'); await settle(p); eq(await p.evaluate(() => S.dither.strength), 0.9); await p.locator('#info').click(); await p.keyboard.press('Control+Shift+z'); await settle(p); eq(await p.evaluate(() => S.palette.method), 'night'); await p.keyboard.press('Control+z'); await settle(p); eq(await p.evaluate(() => S.palette.method), 'gnet'); });
    await check('протяжка ползунка — один шаг отмены', async () => { await p.waitForTimeout(500); const n0 = await p.evaluate(() => HIST.i); for (const v of [0.1, 0.2, 0.3, 0.4, 0.5]) { await p.fill('#r-dither-strength', String(v)); await p.dispatchEvent('#r-dither-strength', 'input'); await p.waitForTimeout(50); } await p.waitForTimeout(600); eq(await p.evaluate(() => HIST.i), n0 + 1); });
    await check('Ctrl+Z в текстовом поле не трогает историю студии', async () => { await tab(p, 'shore'); const i0 = await p.evaluate(() => HIST.i); await p.focus('#shTime'); await p.keyboard.press('Control+z'); eq(await p.evaluate(() => HIST.i), i0); });
  }

  if (want('пресет')) {
    section('13. Пресеты');
    await tab(p, 'file');
    await check('сохранение и загрузка возвращают все настройки, ключи и план', async () => {
      await setS(p, s => { s.fx.ca = 2.5; s.light.on = true; s.light.x = 0.2; s.anim.frames = 24; s.palette.method = 'fog'; s.shore.notes[1].text = 'ПРОВЕРКА'; s.shore.pos.rec = { x: 0.3, y: 0.6 }; }, 'A');
      await p.evaluate(() => { addTrack('fx.shift'); });
      await p.click('#presetMake'); const txt = await p.inputValue('#presetText'); const before = await p.evaluate(() => snapState());
      await p.click('#styles button[data-style="lens"]'); await p.evaluate(() => { removeTrack('fx.shift'); }); await settle(p);
      await p.click('#presetLoad'); await settle(p);
      eq(await p.evaluate(() => snapState()), before); ok(JSON.parse(txt).plan, 'нет плана');
    });
    await check('копирование: в буфер или выделение текста', async () => { await p.click('#presetCopy'); await p.waitForTimeout(200); ok(/Скопировано|выделен/.test(await p.textContent('#presetStatus'))); });
    await check('битый JSON и чужой JSON дают понятные ошибки', async () => { await p.fill('#presetText', '{плохо'); await p.click('#presetLoad'); ok(/не JSON/.test(await p.textContent('#presetStatus'))); await p.fill('#presetText', '{"a":1}'); await p.click('#presetLoad'); ok(/нет поля settings/.test(await p.textContent('#presetStatus'))); });
    await check('старый пресет v1 (без новых разделов) загружается со значениями по умолчанию', async () => { await p.fill('#presetText', JSON.stringify({ app: 'pixel-studio-3011', version: 1, settings: { aspect: '1:1', grid: { width: 120, snap: true }, palette: { method: 'night', colors: 13 }, tint: 0.1 } })); await p.click('#presetLoad'); await settle(p); eq(await p.evaluate(() => [S.aspect, S.grid.width, S.palette.method, S.fx.ca, S.light.on, Object.keys(S.keys).length]), ['1:1', 120, 'night', 0, false, 0]); });
    await check('пресет с мусором в ключах не ломает студию', async () => { await p.fill('#presetText', JSON.stringify({ settings: { keys: { 'fx.ca': { mode: 'keys', keys: [{ t: 'x' }] }, 'нет.такого': { mode: 'keys' }, 'grid.width': { mode: 'rand' } } } })); await p.click('#presetLoad'); await settle(p); eq(await p.evaluate(() => Object.keys(S.keys)), ['fx.ca']); eq(await p.evaluate(() => S.keys['fx.ca'].keys.length), 2); await p.evaluate(() => { S.keys = {}; keysChanged(); }); await settle(p); });
    await setS(p, s => { Object.assign(s, JSON.parse(JSON.stringify({ aspect: '9:16', grid: { width: 108, snap: true } }))); }, 'A');
  }

  if (want('стил')) {
    section('14. Готовые стили');
    const ids = await p.$$eval('#styles button', b => b.map(x => x.dataset.style));
    for (const id of ids) {
      await check(`стиль «${id}» применяется, отмечается и не трогает кадр, сетку и Shore`, async () => {
        await setS(p, s => { s.crop.zoom = 1.5; s.grid.width = 135; s.shore.time = '12:34'; }, 'A');
        await p.click(`#styles button[data-style="${id}"]`); await settle(p);
        eq(await p.getAttribute(`#styles button[data-style="${id}"]`, 'aria-pressed'), 'true');
        eq(await p.evaluate(() => [S.crop.zoom, S.grid.width, S.shore.time]), [1.5, 135, '12:34']);
      });
    }
    await check('изменение ползунка снимает отметку стиля', async () => { await tab(p, 'pix'); await slide(p, 'r-pix-sharpen', 0.75); eq(await p.$$eval('#styles button[aria-pressed="true"]', b => b.length), 0); });
    await p.click('#styles button[data-style="gnet"]'); await setS(p, s => { s.crop.zoom = 1; s.grid.width = 108; s.shore.time = '03:11'; }, 'A');
  }

  if (want('текст')) {
    section('15. Режим «Из текста» и Claude');
    await p.click('#tabText'); await settle(p, 200);
    await check('режим текста открывает вкладку «Источник» с описанием', async () => { ok(await p.isVisible('#sceneText') && await p.isVisible('#drawBtn')); });
    await check('пустое описание и пустая правка — подсказки без запроса', async () => { const n = await p.evaluate(() => window.__prompts.length); await p.fill('#sceneText', ' '); await p.click('#drawBtn'); ok(/хотя бы одним/.test(await p.textContent('#aiStatus'))); await p.fill('#refineText', ''); await p.click('#refineBtn'); ok(/Напишите правку/.test(await p.textContent('#aiStatus'))); eq(await p.evaluate(() => window.__prompts.length), n); await p.fill('#sceneText', 'Кухня, вечер, окно слева.'); });
    await check('промпт содержит сетку, формат, схему и просьбу растянуть фон', async () => { await p.evaluate(pl => window.__q.push({ text: pl }), plan); await p.click('#drawBtn'); await p.waitForFunction(() => /Готово/.test($('#aiStatus').textContent)); const pr = await p.evaluate(() => window.__prompts.at(-1)); const s = typeof pr === 'string' ? pr : pr[0].content; ok(s.includes('108×192') && s.includes('9:16') && s.includes('window-light') && s.includes('от края до края')); });
    await check('ответ в ```json и с пояснением вокруг тоже принимается', async () => { await p.evaluate(pl => window.__q.push({ text: 'Вот план:\n```json\n' + pl + '\n```\nУдачи!' }), plan); await p.click('#drawBtn'); await p.waitForFunction(() => /Готово/.test($('#aiStatus').textContent)); });
    await check('плохой ответ → один автоповтор с текстом ошибки → успех', async () => { await p.evaluate(pl => window.__q.push({ text: '{"layers":[{"elements":[{"type":"blob"}]}]}' }, { text: pl }), plan); const n = await p.evaluate(() => window.__prompts.length); await p.click('#drawBtn'); await p.waitForFunction(() => /Готово/.test($('#aiStatus').textContent)); const pr = await p.evaluate(() => window.__prompts.at(-1)); eq(await p.evaluate(() => window.__prompts.length), n + 2); ok(Array.isArray(pr) && /blob/.test(pr[2].content)); });
    await check('две ошибки подряд → понятное сообщение, JSON открыт для ручной правки', async () => { await p.evaluate(() => window.__q.push({ text: 'нет' }, { text: 'опять нет' })); await p.click('#drawBtn'); await p.waitForFunction(() => /дважды/.test($('#aiStatus').textContent)); ok(await p.evaluate(() => $('#jsonBox').open)); });
    for (const [code, re] of [['rate_limited', /Слишком много/], ['not_granted', /не разрешено/], ['refused', /не стал/], ['session_expired', /Сессия/], ['empty_completion', /пустой/], ['prompt_too_large', /слишком большие/], ['upstream_error', /Не удалось получить ответ/]]) {
      await check(`ошибка ${code} — человеческое сообщение`, async () => { await p.evaluate(c => window.__q.push({ error: c }), code); await p.click('#drawBtn'); await p.waitForFunction(r => new RegExp(r).test($('#aiStatus').textContent), re.source); ok(!await p.$eval('#drawBtn', e => e.disabled)); });
    }
    await check('«Стоп» прерывает запрос и возвращает кнопки', async () => { await p.evaluate(() => window.__q.push({ wait: true })); await p.click('#drawBtn'); await p.waitForTimeout(100); ok(await p.isVisible('#stopBtn')); await p.click('#stopBtn'); await p.waitForFunction(() => /Остановлено/.test($('#aiStatus').textContent)); ok(!await p.isVisible('#stopBtn') && !await p.$eval('#drawBtn', e => e.disabled)); });
    await check('«Доработать» отправляет текущий план и правку, поле очищается', async () => { await p.evaluate(pl => window.__q.push({ text: pl }), plan); await p.fill('#refineText', 'добавь гитару справа'); await p.keyboard.press('Enter'); await p.waitForFunction(() => /Правка применена/.test($('#aiStatus').textContent)); const pr = await p.evaluate(() => window.__prompts.at(-1)); ok(pr.includes('добавь гитару справа') && pr.includes('"layers"')); eq(await p.inputValue('#refineText'), ''); });
    await check('ручная правка JSON: ошибка с указанием места и успешная перерисовка', async () => { await p.evaluate(() => { $('#jsonBox').open = true; }); await p.fill('#planJson', '{"layers":[{"elements":[{"type":"rect","x":0,"y":0,"w":10,"h":10}]}]}'); await p.click('#redrawBtn'); ok(/elements\[0\]: нет color/.test(await p.textContent('#jsonStatus'))); await p.fill('#planJson', plan); await p.click('#redrawBtn'); ok(/Перерисовано/.test(await p.textContent('#jsonStatus'))); });
    await check('проверка плана ловит неизвестный тип, плохой цвет, мало точек, нет слоёв', async () => { const r = await p.evaluate(() => [parsePlan('{"layers":[{"elements":[{"type":"star"}]}]}').error, parsePlan('{"layers":[{"elements":[{"type":"rect","x":0,"y":0,"w":1,"h":1,"color":"red"}]}]}').error, parsePlan('{"layers":[{"elements":[{"type":"polygon","points":[[0,0]],"color":"#fff"}]}]}').error, parsePlan('{"a":1}').error]); ok(/star/.test(r[0]) && /HEX/.test(r[1]) && /3\+/.test(r[2]) && /layers/.test(r[3]), JSON.stringify(r)); });
    await check('план с координатами за рамкой рисуется без ошибок', async () => { const pl = JSON.parse(plan); pl.layers[0].elements.push({ type: 'rect', x: -40, y: -40, w: 30, h: 30, color: '#ff00ff' }); await p.fill('#planJson', JSON.stringify(pl)); await p.click('#redrawBtn'); await settle(p); ok(/Перерисовано/.test(await p.textContent('#jsonStatus'))); });
    await check('смена формата кадра при плане 9:16 объясняет растяжение', async () => { await p.click('#aspectSeg button[data-aspect="1:1"]'); await settle(p); ok(/растянут/.test(await p.textContent('#aiStatus'))); await p.click('#aspectSeg button[data-aspect="9:16"]'); await settle(p); });
    await p.evaluate(pl => { applyPlan(JSON.parse(pl), false); }, plan); await settle(p);
    await p.click('#tabImage'); await settle(p, 200);
  }

  if (want('ключ')) {
    section('16. Ключи ползунков и таймлайн');
    await tab(p, 'fx');
    await check('◆ создаёт два ключа, открывает редактор и дорожку', async () => { await p.click('.kbtn[data-kpath="fx.ca"]'); await settle(p); const tr = await p.evaluate(() => S.keys['fx.ca']); eq(tr.keys.length, 2); ok(await p.isVisible('.kedit[data-kfor="fx.ca"]')); eq(await p.$$eval('#tlGrid .lane[data-p]', l => l.length), 1); });
    await check('бегунок + ползунок ставит ключ на этом кадре', async () => { await p.evaluate(() => setPlayhead(7)); await slide(p, 'r-fx-ca', 6); const k = await p.evaluate(() => S.keys['fx.ca'].keys.map(k => [Math.round(k.t * 15), k.v])); ok(k.some(([f, v]) => f === 7 && v === 6), JSON.stringify(k)); });
    await check('значения между ключами плавные, на ключах точные', async () => { const v = await p.evaluate(() => Array.from({ length: 16 }, (_, i) => evalTrack('fx.ca', i, 16))); eq(v[7], 6); ok(v[0] <= v[3] && v[3] <= v[7], v.join(' ')); });
    await check('ключ тянется по дорожке', async () => { const kd = p.locator('#tlGrid .kd').nth(1), b = await kd.boundingBox(), lane = await p.locator('#tlGrid .lane[data-p="fx.ca"]').boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(lane.x + lane.width * 0.2, b.y + b.height / 2, { steps: 5 }); await p.mouse.up(); await settle(p); ok(await p.evaluate(() => S.keys['fx.ca'].keys.some(k => Math.round(k.t * 15) === 3))); });
    await check('двойной щелчок по дорожке добавляет ключи, но не больше 5', async () => { const lane = await p.locator('#tlGrid .lane[data-p="fx.ca"]').boundingBox(); for (const f of [0.55, 0.7, 0.85, 0.93]) { await p.mouse.dblclick(lane.x + lane.width * f, lane.y + lane.height / 2); await p.waitForTimeout(80); } eq(await p.evaluate(() => S.keys['fx.ca'].keys.length), 5); ok(/максимум/.test(await p.textContent('#toast'))); });
    await check('редактор: кадр, значение, удаление (не меньше 2), переход', async () => {
      const ed = '.kedit[data-kfor="fx.ca"]';
      await p.fill(`${ed} input[data-kf="v"][data-ki="0"]`, '1.5'); await p.dispatchEvent(`${ed} input[data-kf="v"][data-ki="0"]`, 'change'); await settle(p);
      eq(await p.evaluate(() => S.keys['fx.ca'].keys[0].v), 1.5);
      for (let i = 0; i < 4; i++) { const btn = p.locator(`${ed} button[data-kact="del"]`).last(); if (await btn.isDisabled()) break; await btn.click(); await settle(p); }
      eq(await p.evaluate(() => S.keys['fx.ca'].keys.length), 2); ok(await p.locator(`${ed} button[data-kact="del"]`).first().isDisabled());
      for (const e of ['linear', 'step', 'smooth']) { await p.selectOption(`${ed} select[data-kf="ease"]`, e); await settle(p); eq(await p.evaluate(() => S.keys['fx.ca'].ease), e); }
    });
    await check('случайный режим: значения в диапазоне, цикл замкнут, ползунок заблокирован', async () => {
      await tab(p, 'light'); await p.check('#lightCb'); await settle(p);
      await p.click('.kbtn[data-kpath="light.x"]'); await settle(p);
      const ed = '.kedit[data-kfor="light.x"]';
      await p.click(`${ed} button[data-v="rand"]`); await settle(p);
      for (const [k, v] of [['min', 20], ['max', 80], ['every', 3]]) { await p.fill(`${ed} input[data-kf="${k}"]`, String(v)); await p.dispatchEvent(`${ed} input[data-kf="${k}"]`, 'change'); await settle(p); }
      await p.check(`${ed} input[data-kf="smooth"]`); await settle(p);
      const v = await p.evaluate(() => Array.from({ length: 17 }, (_, i) => evalTrack('light.x', i % 16, 16)));
      ok(v.every(x => x >= 0.2 - 1e-9 && x <= 0.8 + 1e-9), v.join(' ')); ok(new Set(v).size > 3, 'значения не меняются');
      ok(await p.$eval('#r-light-x', e => e.disabled), 'ползунок не заблокирован');
      const seed0 = await p.evaluate(() => S.keys['light.x'].seed); await p.click(`${ed} button[data-kact="reseed"]`); ok(seed0 !== await p.evaluate(() => S.keys['light.x'].seed));
    });
    await check('кадров и к/с на таймлайне ограничены 2…96 и 2…30', async () => { for (const [id, v, e] of [['tlFrames', 500, 96], ['tlFrames', 1, 2], ['tlFps', 99, 30], ['tlFrames', 16, 16], ['tlFps', 10, 10]]) { await p.fill('#' + id, String(v)); await p.dispatchEvent('#' + id, 'change'); await settle(p); eq(await p.evaluate(i => i === 'tlFrames' ? S.anim.frames : S.anim.fps, id), e, id); } });
    await check('клавиши , . Home End двигают бегунок', async () => { await p.locator('#info').click(); await p.keyboard.press('Home'); await p.keyboard.press('.'); await p.keyboard.press('.'); eq(await p.evaluate(() => TL.frame), 2); await p.keyboard.press(','); eq(await p.evaluate(() => TL.frame), 1); await p.keyboard.press('End'); eq(await p.evaluate(() => TL.frame), 15); await settle(p); });
    await check('щелчок по названию дорожки открывает нужную вкладку и ползунок', async () => { await tab(p, 'src'); await p.click('#tlGrid .tlname[data-p="fx.ca"]'); await p.waitForTimeout(300); eq(await p.evaluate(() => activeTab), 'fx'); ok(await p.isVisible('.kedit[data-kfor="fx.ca"]')); });
    await check('отмена убирает и возвращает дорожку', async () => { await p.waitForTimeout(500); await p.click('#tlGrid .tlx[data-p="light.x"]'); await settle(p); await p.waitForTimeout(500); ok(!await p.evaluate(() => !!S.keys['light.x'])); await p.click('#undoBtn'); await settle(p); ok(await p.evaluate(() => !!S.keys['light.x'])); });
    await check('загрузка пресета во время проигрывания сбрасывает закреплённую палитру', async () => { await p.click('#tlPlay'); await p.waitForTimeout(300); await p.evaluate(() => { anim.pal = [[1, 2, 3], [4, 5, 6]]; S.palette.method = 'night'; syncUI(); invalidate('C'); }); await p.waitForTimeout(300); const pal = await p.evaluate(() => anim.pal && anim.pal.length); await p.keyboard.press('Escape'); await settle(p); ok(pal !== 2, 'палитра не обновилась: ' + pal); await setS(p, s => { s.palette.method = 'gnet'; }, 'C'); });
    await check('проигрывание идёт по кадрам и останавливается, настройки не портятся', async () => { const fx0 = await p.evaluate(() => JSON.stringify(S.fx)); await p.click('#tlPlay'); await p.waitForTimeout(900); ok(await p.evaluate(() => anim.on)); await p.keyboard.press('Escape'); await settle(p); ok(!await p.evaluate(() => anim.on)); const fx1 = await p.evaluate(() => { const f = { ...S.fx }; return JSON.stringify(f); }); eq(JSON.parse(fx1).seed, JSON.parse(fx0).seed); });
    await check('палитра по первому кадру одна на все кадры', async () => { await setS(p, s => { s.palette.method = 'kmeans'; s.palette.colors = 16; s.anim.lockPal = true; }, 'C'); await p.evaluate(() => addTrack('pre.brightness')); const same = await p.evaluate(() => { const pal = lockedPal(); const ks = []; for (const i of [0, 7, 15]) computeAnimFrame(i, 16, pal, () => ks.push(JSON.stringify(G.pal))); restoreAfterFrames(); return new Set(ks).size; }); eq(same, 1); await p.evaluate(() => removeTrack('pre.brightness')); await settle(p); });
    await check('движение глитча: «нет» — кадры одинаковые, остальные три — меняются', async () => { await p.evaluate(() => { S.keys = {}; keysChanged(); }); await setS(p, s => { s.fx.shift = 0.5; s.fx.vhs = 0.4; s.fx.grain = 0; s.light.on = false; }, 'C'); const r = await p.evaluate(() => { const out = {}; for (const m of ['still', 'jitter', 'bursts', 'roll']) { S.anim.mode = m; const hs = new Set(); for (let i = 0; i < 6; i++) computeAnimFrame(i, 16, null, () => hs.add(gridCv.toDataURL().length + ':' + gridCv.getContext('2d').getImageData(0, 0, G.W, G.H).data.reduce((a, v, j) => j % 97 ? a : a + v, 0))); out[m] = hs.size; } S.anim.mode = 'bursts'; restoreAfterFrames(); return out; }); ok(r.still === 1 && r.jitter > 1 && r.roll > 1 && r.bursts > 1, JSON.stringify(r)); return JSON.stringify(r); });
    await p.evaluate(() => { S.keys = {}; keysChanged(); }); await setS(p, s => { s.fx.shift = 0; s.fx.vhs = 0; s.fx.ca = 0; s.light.on = false; s.palette.method = 'gnet'; s.palette.colors = 22; }, 'C');
  }

  if (want('живое') || want('частиц') || want('вариант')) {
    section('16а. Частицы, бегущие цвета, живой Shore, варианты');
    const frameHash = (i, n = 16) => p.evaluate(([i, n]) => { ANIM_CTX = { i, n, fps: 10 }; try { applyEffects(); } finally { ANIM_CTX = null; } let a = 2166136261; for (let k = 0; k < G.out.length; k += 3) a = Math.imul(a ^ G.out[k], 16777619); return a >>> 0; }, [i, n]);
    await tab(p, 'fx');
    await check('частицы: пять видов рисуются, кадры меняются, цикл замкнут', async () => {
      const res = [];
      for (const t of ['rain', 'snow', 'dust', 'steam', 'sparks']) {
        await p.click(`#partsSeg button[data-pt="${t}"]`); await settle(p);
        const off = await p.evaluate(() => { S.parts.on = false; applyEffects(); const h = G.out.slice(); S.parts.on = true; return Array.from(h.slice(0, 0)); });
        const a0 = await frameHash(0), a5 = await frameHash(5), aN = await frameHash(16);
        ok(a0 !== a5, t + ': кадры не меняются'); eq(aN, a0, t + ': кадр 16 не совпал с кадром 0'); res.push(t); void off;
      }
      return res.join(', ');
    });
    await check('частицы «в цветах палитры» не выходят из палитры', async () => { await setP(p, { parts: { on: true, type: 'snow', toPal: true, amount: 1 }, fx: { ca: 0, shift: 0, bands: 0, blocks: 0, sort: 0, vhs: 0, dead: 0, toPalette: false } }, 'E'); const pal = await palKeys(p); const cols = await gridColors(p); ok(cols.every(c => pal.includes(c)), 'есть цвета вне палитры'); });
    await check('источник частиц виден только для пара и искр и тянется мышью', async () => {
      await p.click('#partsSeg button[data-pt="snow"]'); await settle(p); ok(!await p.isVisible('#emitter'), 'виден для снега');
      await p.click('#partsSeg button[data-pt="steam"]'); await settle(p); ok(await p.isVisible('#emitter'), 'не виден для пара');
      const b = await p.locator('#emitter').boundingBox(), x0 = await p.evaluate(() => S.parts.ex);
      await p.mouse.move(b.x + 13, b.y + 13); await p.mouse.down(); await p.mouse.move(b.x - 60, b.y - 40, { steps: 4 }); await p.mouse.up(); await settle(p);
      ok(await p.evaluate(() => S.parts.ex) < x0); await tab(p, 'pix'); ok(!await p.isVisible('#emitter'), 'виден на другой вкладке'); await tab(p, 'fx');
    });
    await check('частицы выключены — их ползунки заблокированы', async () => { await p.uncheck('#partsCb'); await settle(p); eq(await p.evaluate(() => ['#r-parts-amount', '#partsColor', '#partsSeed'].map(s => $(s).disabled)), [true, true, true]); });
    await check('бегущие цвета: считаются цвета, кадры меняются, цикл замкнут, цвета из палитры', async () => {
      await p.check('#cycleCb'); await settle(p);
      ok(/в цикле \d+ цв/.test(await p.textContent('#cycleInfo')), await p.textContent('#cycleInfo'));
      const a0 = await frameHash(0), a3 = await frameHash(3), aN = await frameHash(16);
      ok(a0 !== a3, 'кадры не меняются'); eq(aN, a0, 'цикл не замкнут');
      const pal = await palKeys(p); ok((await gridColors(p)).every(c => pal.includes(c)), 'цвета вне палитры');
    });
    await check('бегущие цвета: режим «похожие на цвет», туда-обратно, несколько оборотов', async () => {
      await p.click('#cycleSeg button[data-cm="hue"]'); await settle(p); ok(!await p.$eval('#cycleColor', e => e.disabled)); ok(await p.$eval('#r-cycle-lo', e => e.disabled));
      await p.check('#cyclePP'); await slide(p, 'r-cycle-cycles', 3); eq(await frameHash(16), await frameHash(0), 'цикл не замкнут с туда-обратно');
      await p.click('#cycleSeg button[data-cm="band"]'); await p.uncheck('#cyclePP'); await slide(p, 'r-cycle-cycles', 1);
    });
    await check('бегущие цвета не работают с «Цвета оригинала» и честно об этом пишут', async () => { await setP(p, { palette: { method: 'original' } }, 'C'); ok(/оригинала/.test(await p.textContent('#cycleInfo'))); await setP(p, { palette: { method: 'gnet' }, cycle: { on: false } }, 'C'); });
    await tab(p, 'shore');
    await check('живой Shore: на неподвижной картинке интерфейс целиком, в анимации — печатается', async () => {
      const draw = (i) => p.evaluate(i => { const c = document.createElement('canvas'); c.width = 540; c.height = 960; const x = c.getContext('2d'); if (i != null) ANIM_CTX = { i, n: 16, fps: 10 }; try { drawShore(x, 540, 960, null); } finally { ANIM_CTX = null; } const d = x.getImageData(0, 0, 540, 960).data; let n = 0; for (let k = 3; k < d.length; k += 4) if (d[k]) n++; return n; }, i);
      const still = await draw(null), f0 = await draw(0), f15 = await draw(15);
      ok(f0 < still, `кадр 0 не пустее неподвижного (${f0} / ${still})`); ok(f15 >= still * 0.9, `к концу текст не допечатан (${f15} / ${still})`);
    });
    await check('бегущие секунды и всплывающее уведомление', async () => { eq(await p.evaluate(() => { const live = { on: true, ac: { i: 25, n: 40, fps: 10 }, L: S.shore.live }; return liveTime('03:11', live); }), '03:11:02'); await p.uncheck('#liveSecs'); eq(await p.evaluate(() => liveTime('03:11', { on: true, ac: { i: 25, n: 40, fps: 10 }, L: S.shore.live })), '03:11'); await p.check('#liveSecs'); });
    await check('аннотация «прицел»: рисуется, второй угол тянется', async () => {
      await p.evaluate(() => { S.shore.notes = [{ text: 'ОБЪЕКТ', kind: 'scan', x: 0.3, y: 0.4, tx: 0.6, ty: 0.6, size: 1, on: true }]; renderNotes(); invalidate('D'); }); await settle(p);
      const pt = await p.evaluate(() => { const h = shoreHits.find(x => x.type === 'note' && x.part === 'target'); const r = afterCv.getBoundingClientRect(); return { x: r.left + (h.x + h.w / 2) * r.width / afterCv.width, y: r.top + (h.y + h.h / 2) * r.height / afterCv.height }; });
      await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x + 40, pt.y + 40, { steps: 4 }); await p.mouse.up(); await settle(p);
      const n = await p.evaluate(() => S.shore.notes[0]); ok(n.tx > 0.6 && n.ty > 0.6, JSON.stringify(n)); eq(await p.$eval('.noterow .n-kind', e => e.value), 'scan');
      await setS(p, s => { s.shore = JSON.parse(JSON.stringify(DEFAULTS.shore)); }, 'D'); await p.evaluate(() => renderNotes());
    });
    await check('«Варианты»: 10 плиток, первая — текущий лук, состояние после закрытия не меняется', async () => {
      const s0 = await p.evaluate(() => snapState());
      await p.locator('#info').click(); await p.keyboard.press('v'); await p.waitForFunction(() => !$('#varModal').hidden && !VAR.busy, null, { timeout: 30000 });
      eq(await p.$$eval('.vpick', x => x.length), 10); ok(/исходный/.test(await p.textContent('.vpick[data-v="0"] span')));
      await p.keyboard.press('Escape'); await settle(p); ok(await p.evaluate(() => $('#varModal').hidden)); eq(await p.evaluate(() => snapState()), s0, 'состояние изменилось без выбора');
    });
    await check('«Варианты»: щелчок применяет, Ctrl+Z возвращает, кадр, сетка и Shore не трогаются', async () => {
      await setS(p, s => { s.grid.width = 135; s.crop.zoom = 1.7; s.shore.time = '09:09'; }, 'A'); await p.waitForTimeout(500);
      const s0 = await p.evaluate(() => snapState());
      await p.click('#varBtn'); await p.waitForFunction(() => !VAR.busy, null, { timeout: 30000 });
      await p.click('.vpick[data-v="5"]'); await settle(p);
      const s1 = await p.evaluate(() => snapState()); ok(s1 !== s0, 'ничего не применилось');
      eq(await p.evaluate(() => [S.grid.width, S.crop.zoom, S.shore.time]), [135, 1.7, '09:09']);
      await p.waitForTimeout(500); await p.click('#undoBtn'); await settle(p); eq(await p.evaluate(() => snapState()), s0, 'отмена не вернула');
    });
    await check('«Варианты»: «Похожие» и «Ещё 9», мягкий режим', async () => {
      await p.click('#varBtn'); await p.waitForFunction(() => !VAR.busy, null, { timeout: 30000 });
      await p.click('.vnear[data-v="3"]'); await p.waitForFunction(() => !VAR.busy, null, { timeout: 30000 }); ok(/Похожие на вариант 4/.test(await p.textContent('#varTitle')));
      await p.click('#varMode button[data-vm="soft"]'); await p.click('#varMore'); await p.waitForFunction(() => !VAR.busy, null, { timeout: 30000 });
      eq(await p.$$eval('.vpick', x => x.length), 10); await p.click('#varClose'); await settle(p);
      await setS(p, s => { s.grid.width = 108; s.crop.zoom = 2.2; s.shore.time = '03:11'; }, 'A');
    });
    await check('GIF с частицами, бегущими цветами и живым Shore собирается, кадры разные', async () => {
      await setP(p, { parts: { on: true, type: 'rain' }, cycle: { on: true }, anim: { frames: 6, size: 'small' } }, 'E'); await saved(p);
      await p.click('#tbGif'); await p.waitForFunction(() => $('#busy').hidden && $('#tbGif').textContent === 'GIF', null, { timeout: 60000 }); await waitSaved(p);
      const f = (await saved(p))[0]; const gi = gifInfo(f.buf); eq(gi.frames, 6);
      await setP(p, { parts: { on: false }, cycle: { on: false }, anim: { frames: 16, size: 'half' } }, 'E');
      return `${gi.w}×${gi.h}, ${gi.frames} кадров`;
    });
  }

  if (want('экспорт')) {
    section('17. Экспорт');
    for (const asp of ['9:16', '1:1']) {
      await check(`PNG 1080 и PNG сетки (${asp}): верные размеры`, async () => {
        await setP(p, { aspect: asp, grid: { width: 108, snap: true } }, 'A');
        await p.click('#tbPng'); await waitSaved(p); await tab(p, 'file'); await p.click('#expGrid'); await waitSaved(p, 2);
        const f = await saved(p); eq(f.map(x => pngSize(x.buf)), asp === '1:1' ? [[1080, 1080], [108, 108]] : [[1080, 1920], [108, 192]]);
      });
    }
    await check('без привязки: PNG 1080 с полями и честной подсказкой', async () => { await setS(p, s => { s.aspect = '1:1'; s.grid = { width: 100, snap: false }; }, 'A'); ok(/поля/.test(await p.textContent('#expHint'))); await p.click('#tbPng'); await waitSaved(p); eq(pngSize((await saved(p))[0].buf), [1080, 1080]); });
    await setS(p, s => { s.aspect = '9:16'; s.grid = { width: 108, snap: true }; s.fx.shift = 0.4; s.anim.frames = 8; }, 'A');
    await check('GIF: каждый размер, 8 кадров, зациклен, задержка по к/с', async () => {
      await tab(p, 'fx'); const sizes = await p.$$eval('#gifSize option', o => o.map(x => x.value));
      for (const sz of sizes) { await p.selectOption('#gifSize', sz); await p.click('#gifBtn'); await p.waitForFunction(() => $('#tbGif').textContent === 'GIF', null, { timeout: 60000 }); }
      const f = await saved(p); eq(f.length, sizes.length);
      const info = f.map(x => gifInfo(x.buf)); ok(info.every(i => i.frames === 8 && i.loop && i.delay === 10), JSON.stringify(info));
      return info.map(i => `${i.w}×${i.h}`).join(', ');
    });
    await check('GIF можно отменить', async () => { await setS(p, s => { s.anim.frames = 60; s.anim.size = 'full'; }, 'N'); await p.click('#gifBtn'); await p.waitForSelector('#busy:not([hidden])'); await p.click('#busyCancel'); await p.waitForFunction(() => $('#tbGif').textContent === 'GIF', null, { timeout: 60000 }); ok(/отменена/.test(await p.textContent('#toast'))); eq((await saved(p)).length, 0); });
    await setS(p, s => { s.anim.frames = 8; s.anim.loops = 2; }, 'N');
    for (const [fmt, codec, ext] of [['auto', 'h264', 'mp4'], ['webm', 'vp9', 'webm']]) {
      await check(`видео ${ext}: кодек, размер, кадры и длительность`, async () => {
        if (!HAVE_LIBS) throw new Skip('нет пакетов mp4-muxer / webm-muxer (npm install в папке tests)');
        await p.selectOption('#vidFmt', fmt); await p.selectOption('#vidSize', 'half'); await p.click('#vidBtn');
        await p.waitForFunction(() => $('#tbMp4').textContent === 'MP4', null, { timeout: 120000 });
        const f = (await saved(p))[0]; ok(f && f.name.endsWith('.' + ext), f ? f.name : 'файл не сохранён');
        const file = path.join(OUT, 'last.' + ext); fs.writeFileSync(file, f.buf);
        const pr = probe(file); if (!pr) return 'ffprobe нет — проверено только имя и размер';
        ok(pr.codec === codec && pr.frames === 16 && pr.w % 2 === 0 && pr.h % 2 === 0, JSON.stringify(pr));
        return `${pr.codec} ${pr.w}×${pr.h}, ${pr.frames} кадров, ${pr.dur.toFixed(1)} с`;
      });
    }
    await check('видео можно отменить', async () => { if (!HAVE_LIBS) throw new Skip('нет пакетов'); await setS(p, s => { s.anim.frames = 96; s.anim.loops = 20; s.anim.vsize = 'full'; s.anim.vformat = 'auto'; }, 'N'); await p.click('#vidBtn'); await p.waitForSelector('#busy:not([hidden])'); await p.keyboard.press('Escape'); await p.waitForFunction(() => $('#tbMp4').textContent === 'MP4', null, { timeout: 60000 }); ok(/отменена/.test(await p.textContent('#toast'))); eq((await saved(p)).length, 0); });
    await check('во время сборки настройки заблокированы окном с прогрессом', async () => { await setS(p, s => { s.anim.frames = 30; s.anim.size = 'full'; }, 'N'); await p.click('#tbGif'); await p.waitForSelector('#busy:not([hidden])'); const t = await p.textContent('#busyTitle'); const blocked = await p.evaluate(() => { const r = $('#tabText').getBoundingClientRect(); return document.elementFromPoint(r.left + 5, r.top + 5).closest('#busy') !== null; }); await p.keyboard.press('3'); const tabNow = await p.evaluate(() => activeTab); await p.click('#busyCancel'); await p.waitForFunction(() => $('#busy').hidden, null, { timeout: 60000 }); ok(/кадр/.test(t) && blocked, t); ok(tabNow !== 'light', 'клавиша сработала под окном'); await saved(p); await setS(p, s => { s.anim.frames = 8; }, 'N'); });
    await check('отказ в окне скачивания — сообщение, без ошибок', async () => { await p.evaluate(() => { window.__dl = 'declined'; toast(''); }); await p.click('#tbPng'); await p.waitForFunction(() => /отменено/.test($('#toast').textContent), null, { timeout: 5000 }); await p.evaluate(() => { window.__dl = 'ok'; }); });
    await setS(p, s => { s.anim.frames = 16; s.anim.loops = 3; s.fx.shift = 0; }, 'E');
    await check('открыто как обычный файл (без claude.ai): PNG, GIF и MP4 скачиваются обычным скачиванием', async () => {
      const r = await open(browser, { noRuntime: true }); const names = [];
      for (const [btn, re] of [['#tbPng', /\.png$/], ['#tbGif', /\.gif$/]].concat(HAVE_LIBS ? [['#tbMp4', /\.(mp4|webm)$/]] : [])) {
        const [d] = await Promise.all([r.waitForEvent('download', { timeout: 60000 }), r.click(btn)]);
        ok(re.test(d.suggestedFilename()), d.suggestedFilename()); names.push(d.suggestedFilename());
        await r.waitForFunction(() => !gifJob && !vidJob, null, { timeout: 60000 });
      }
      ok(await r.evaluate(() => $('#saveModal').hidden), 'открылось окно ручного сохранения'); await noErrors(r); await r.context().close();
      return names.join(', ');
    });
    const q = await open(browser, { noDownloads: true, noSample: true });
    await check('без скачивания в просмотрщике: картинка открывается в окне для ручного сохранения', async () => { await q.click('#tbPng'); await q.waitForSelector('#saveModal:not([hidden])'); ok(/^blob:/.test(await q.getAttribute('#saveImg', 'src'))); await q.keyboard.press('Escape'); ok(await q.evaluate(() => $('#saveModal').hidden)); });
    await check('без вызова Claude: понятное сообщение при «Нарисовать»', async () => { await q.click('#tabText'); await q.click('#drawBtn'); await q.waitForFunction(() => /нет вызова Claude|не разрешено|недоступен/.test($('#aiStatus').textContent)); });
    await check('страница без возможностей просмотрщика работает без ошибок', () => noErrors(q));
    await q.context().close();
  }

  if (want('раскладк')) {
    section('18. Раскладка на разных экранах');
    for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 700], [800, 760], [720, 800], [640, 900], [400, 860]]) {
      await check(`${w}×${h}: картинка видна целиком при прокрутке настроек, нет сдвига вбок`, async () => {
        const r = await open(browser, { viewport: { width: w, height: h } });
        const out = [];
        for (const t of ['pix', 'light', 'fx']) {
          await tab(r, t);
          await r.evaluate(() => { $('#panel').scrollTop = 1e6; window.scrollTo(0, 1e6); }); await r.waitForTimeout(80);
          const v = await r.evaluate(() => { const a = $('#after').getBoundingClientRect(); return [Math.max(0, Math.min(a.bottom, innerHeight) - Math.max(a.top, 0)) / a.height, document.documentElement.scrollWidth - innerWidth, a.width]; });
          ok(v[0] > 0.99, `${t}: видно ${Math.round(v[0] * 100)}%`); ok(v[1] <= 0, 'горизонтальная прокрутка'); out.push(v[2]);
        }
        const k = await r.evaluate(() => $('#zoomFit').textContent);
        await noErrors(r); await r.context().close();
        return k;
      });
    }
    await check('при открытой справке горячие клавиши не трогают студию', async () => { await p.locator('#info').click(); const before = await p.evaluate(() => [activeTab, S.light.on, S.shore.on]); await p.keyboard.press('?'); for (const k of ['3', 'l', 'h', 'p']) await p.keyboard.press(k); const after = await p.evaluate(() => [activeTab, S.light.on, S.shore.on, anim.on]); await p.keyboard.press('Escape'); eq(after, [...before, false]); });
    await check('справка по клавишам открывается «?» и закрывается Esc', async () => { await p.locator('#info').click(); await p.keyboard.press('?'); ok(await p.isVisible('#helpModal')); await p.keyboard.press('Escape'); ok(!await p.isVisible('#helpModal')); });
  }

  if (want('скорост') && !QUICK) {
    section('19. Скорость');
    for (const [w, heavy, limit] of [[108, false, 150], [108, true, 600], [270, true, 1500], [512, true, 4000]]) {
      await check(`сетка ${w}${heavy ? ', всё включено' : ''}: полный пересчёт быстрее ${limit} мс`, async () => {
        const ms = await p.evaluate(([w, heavy]) => {
          const keep = JSON.stringify(S); S.grid.snap = false; S.grid.width = w;
          if (heavy) Object.assign(S, { fisheye: 0.7, dither: { type: 'fs', strength: 0.6 }, clean: 'strong', outline: { on: true, threshold: 50 }, light: { ...S.light, on: true, rays: 0.8, dust: 0.4, relief: 1 }, glow: { bloom: 0.6, threshold: 0.7, radius: 3 }, fx: { ...S.fx, ca: 3, shift: 0.5, blocks: 0.5, sort: 0.5, vhs: 0.5, dead: 0.3, grain: 0.3 }, palette: { ...S.palette, method: 'kmeans', colors: 32 } });
          const t = performance.now(); buildWork(); buildBase(); quantize(); applyEffects(); const d = performance.now() - t;
          const k = JSON.parse(keep); for (const x in k) S[x] = k[x]; return d;
        }, [w, heavy]);
        await setS(p, s => s, 'A');
        ok(ms < limit, Math.round(ms) + ' мс'); return Math.round(ms) + ' мс';
      });
    }
  }

  if (want('стресс') && !QUICK) {
    section('20. Стресс-тест');
    await check('1000 случайных действий без ошибок, состояние целое', async () => {
      const r = await open(browser, { viewport: { width: 1366, height: 768 } });
      let seed = 777; const R = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const keys = ['1', '2', '3', '4', '5', '6', 'c', 'p', 'r', 'l', 'h', '[', ']', '=', '-', '0', 'Escape', 'Control+z', 'Control+Shift+z', ',', '.', 'Home'];
      for (let n = 0; n < 1000; n++) {
        const a = R();
        try {
          if (a < 0.5) {
            const h = await r.evaluateHandle(x => { const els = [...document.querySelectorAll('input,select,button,.kbtn')].filter(e => e.offsetParent && !e.disabled && !['fileIn', 'tbPng', 'tbGif', 'tbMp4', 'vidBtn', 'expVid', 'gifBtn', 'expGif', 'exp1080', 'expGrid', 'drawBtn', 'refineBtn', 'presetLoad', 'presetCopy', 'helpBtn'].includes(e.id)); return els[Math.floor(x * els.length)]; }, R());
            await h.evaluate((e, x) => {
              if (e.type === 'range') { e.value = +e.min + x * (+e.max - +e.min); e.dispatchEvent(new Event('input', { bubbles: true })); }
              else if (e.tagName === 'SELECT') { e.value = e.options[Math.floor(x * e.options.length)].value; e.dispatchEvent(new Event('change', { bubbles: true })); }
              else if (e.type === 'color') { e.value = '#' + Math.floor(x * 0xffffff).toString(16).padStart(6, '0'); e.dispatchEvent(new Event('input', { bubbles: true })); }
              else if (e.type === 'text' || e.type === 'number' || e.tagName === 'TEXTAREA') { e.value = e.type === 'number' ? String(Math.floor(x * 120) - 10) : 'Ё' + Math.floor(x * 999); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
              else e.click();
            }, R());
          } else if (a < 0.75) { await r.locator('#info').click({ force: true }); await r.keyboard.press(keys[Math.floor(R() * keys.length)]); }
          else if (a < 0.9) { const st = await r.locator('#stage').boundingBox(); const x = st.x + R() * st.width, y = st.y + R() * st.height; await r.mouse.move(x, y); await r.mouse.down(); await r.mouse.move(x + (R() - 0.5) * 200, y + (R() - 0.5) * 200, { steps: 2 }); await r.mouse.up(); }
          else await r.waitForTimeout(Math.floor(R() * 150));
        } catch (e) { r.errors.push('тест: ' + e.message.split('\n')[0]); }
        if (r.errors.length) break;
      }
      await r.keyboard.press('Escape'); await settle(r, 300);
      const s = await r.evaluate(() => ({ W: G.W, ok: !!G.out && G.out.length === G.W * G.H * 4, nan: JSON.stringify(S).includes('null') && Object.values(S.fx).some(v => typeof v === 'number' && !isFinite(v)) }));
      await noErrors(r); ok(s.ok && !s.nan, JSON.stringify(s)); await r.context().close();
    });
  }

  section('Итог по главной странице');
  await check('за весь прогон в консоли не было ошибок', () => noErrors(p));
  await browser.close();

  /* ---------- отчёт ---------- */
  const total = results.length, pass = results.filter(r => r.status === 'pass').length, fail = results.filter(r => r.status === 'fail').length, skip = total - pass - fail;
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ date: new Date().toISOString(), total, pass, fail, skip, secs, results }, null, 1));
  let md = `# Чек-лист автотестов «Пиксельной студии 3011»\n\nПрогон: ${new Date().toLocaleString('ru-RU')} · ${total} проверок · ✅ ${pass} · ❌ ${fail} · ⏭ ${skip} · ${secs} с\n`;
  for (const a of [...new Set(results.map(r => r.area))]) {
    md += `\n## ${a}\n\n`;
    for (const r of results.filter(x => x.area === a)) md += `- [${r.status === 'pass' ? 'x' : ' '}] ${r.status === 'skip' ? '⏭ ' : r.status === 'fail' ? '❌ ' : ''}${r.title}${r.detail ? ` — ${r.detail}` : ''}\n`;
  }
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}Итого: ${pass}/${total} пройдено, ${fail} с ошибкой, ${skip} пропущено за ${secs} с\x1b[0m`);
  console.log('Отчёт: ' + path.join(OUT, 'REPORT.md'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
