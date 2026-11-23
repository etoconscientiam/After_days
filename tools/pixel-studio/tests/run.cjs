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
      setTimeout(() => { if (opts.onText) opts.onText({ text: it.text, delta: it.text }); res({ text: it.text }); }, 20);
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
      'flat.png': await mk(600, 600, (x, w, h) => { x.fillStyle = '#4a6'; x.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { x.fillStyle = i % 2 ? '#fff' : '#000'; x.fillRect((i * 37) % w, (i * 91) % h, 1, 1); } }, 'image/png')
    };
  });
  for (const [n, d] of Object.entries(files)) fs.writeFileSync(path.join(FIX, n), Buffer.from(d, 'base64'));
  fs.writeFileSync(path.join(FIX, 'note.txt'), 'не картинка');
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

  if (want('дизеринг')) {
    section('6. Дизеринг, чистка, обводка');
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
    await check('подача попадает в PNG 1080', async () => { await p.click('#lookSeg button[data-look="grid"]'); await settle(p); await p.click('#tbPng'); await p.waitForTimeout(500); const f = (await saved(p))[0]; ok(f && f.name.endsWith('.png')); await p.click('#lookSeg button[data-look="none"]'); await settle(p); });
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
    await check('третья подпись появляется при включении', async () => { ok(await changes(p, () => p.check('#l2on'), 'a')); });
    await check('пиксельный шрифт знает всю кириллицу, латиницу, цифры и знаки', async () => { const miss = await p.evaluate(() => [...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!-+/%()"\'#_=°·*<>«»—–•№'].filter(c => glyph(c) === GLYPHS['?'])); eq(miss, []); });
    await check('подпись перетаскивается мышью', async () => { const pt = await p.evaluate(() => { const h = shoreHits[0], r = afterCv.getBoundingClientRect(); return { x: r.left + (h.lx + 8) * r.width / afterCv.width, y: r.top + (h.ly + 3) * r.height / afterCv.height, x0: S.shore.labels[h.i].x }; }); await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x + 50, pt.y + 30, { steps: 4 }); await p.mouse.up(); await settle(p); ok(await p.evaluate(() => S.shore.labels[0].x) !== pt.x0); });
    await setS(p, s => { s.shore = JSON.parse(JSON.stringify(DEFAULTS.shore)); }, 'D');
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
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
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
      await setS(p, s => { s.fx.ca = 2.5; s.light.on = true; s.light.x = 0.2; s.anim.frames = 24; s.palette.method = 'fog'; s.shore.labels[1].text = 'ПРОВЕРКА'; }, 'A');
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

  if (want('экспорт')) {
    section('17. Экспорт');
    for (const asp of ['9:16', '1:1']) {
      await check(`PNG 1080 и PNG сетки (${asp}): верные размеры`, async () => {
        await setP(p, { aspect: asp, grid: { width: 108, snap: true } }, 'A');
        await p.click('#tbPng'); await p.waitForTimeout(400); await tab(p, 'file'); await p.click('#expGrid'); await p.waitForTimeout(300);
        const f = await saved(p); eq(f.map(x => pngSize(x.buf)), asp === '1:1' ? [[1080, 1080], [108, 108]] : [[1080, 1920], [108, 192]]);
      });
    }
    await check('без привязки: PNG 1080 с полями и честной подсказкой', async () => { await setS(p, s => { s.aspect = '1:1'; s.grid = { width: 100, snap: false }; }, 'A'); ok(/поля/.test(await p.textContent('#expHint'))); await p.click('#tbPng'); await p.waitForTimeout(400); eq(pngSize((await saved(p))[0].buf), [1080, 1080]); });
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
