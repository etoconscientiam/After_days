#!/usr/bin/env node
// Обложка 1200×630 для страницы чек-листа: кадр из студии + сводка последнего прогона. → out/thumb.png
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'report.json'), 'utf8'));
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('file://' + path.resolve(__dirname, '..', 'pixel-studio-3011.html'));
  await p.waitForFunction(() => typeof G !== 'undefined' && G.rgb && G.W > 0);
  // кадр: квадрат 1:1, стиль «Запись Shore», подписи по-русски
  const img = await p.evaluate(async total => {
    S.aspect = '1:1'; S.grid.width = 120; S.crop.zoom = 2.2;
    const st = STYLES.find(s => s.id === 'vhs'); const base = JSON.parse(JSON.stringify(DEFAULTS)); mergeInto(base, st.s); for (const k of STYLE_KEYS) S[k] = base[k];
    S.pix.look = 'none'; S.fx.vhs = 0.35; S.fx.shift = 0.12;
    S.shore.notes = [{ text: '224 ПРОВЕРКИ', kind: 'plate', x: 0.08, y: 0.72, tx: 0, ty: 0, size: 1, on: true }, { text: 'ВСЁ ЗЕЛЁНОЕ', kind: 'pointer', x: 0.34, y: 0.15, tx: 0.42, ty: 0.36, size: 1, on: true }];
    S.shore.notes[0].text = total + ' ПРОВЕРКИ';
    buildWork(); buildBase(); quantize(); applyEffects();
    const c = document.createElement('canvas'); c.width = c.height = 600; const x = c.getContext('2d');
    x.imageSmoothingEnabled = false; x.drawImage(gridCv, 0, 0, 600, 600); drawShore(x, 600, 600, null);
    return c.toDataURL('image/png');
  }, rep.total);
  const ok = rep.fail === 0;
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@500&family=Unbounded:wght@500&display=swap">
  <style>body{margin:0;width:1200px;height:630px;background:#0c100f;color:#d8ddd2;font-family:"IBM Plex Sans",sans-serif;display:grid;grid-template-columns:minmax(0,1fr) 630px;overflow:hidden}
  .l{padding:64px 0 56px 72px;display:flex;flex-direction:column;gap:22px}
  .k{font:500 18px "IBM Plex Mono",monospace;letter-spacing:.14em;color:#89948a}
  h1{font:500 50px/1.12 Unbounded,sans-serif;margin:0}h1 b{font-weight:500;color:#b4bb72}
  .big{margin-top:auto;display:flex;flex-direction:column;gap:10px}.big b{font:500 92px/1 "IBM Plex Mono",monospace;color:${ok ? '#8fc77a' : '#e07a62'}}.big span{font-size:24px;color:#89948a;line-height:1.3}
  .r{position:relative}.r img{width:630px;height:630px;image-rendering:pixelated;display:block}
  .r::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,#0c100f 0,rgba(12,16,15,0) 14%)}</style>
  <div class="l"><div class="k">ЧЕК-ЛИСТ</div><h1>Пиксельная<br>студия <b>3011</b></h1>
  <div class="big"><b>${rep.pass}/${rep.total}</b><span>автопроверок ${ok ? 'пройдено' : 'пройдено, есть ошибки'} · ${new Set(rep.results.map(r => r.area)).size} разделов</span></div></div>
  <div class="r"><img src="${img}"></div>`;
  const q = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await q.setContent(html); await q.waitForTimeout(800);
  await q.screenshot({ path: path.join(__dirname, 'out', 'thumb.png') });
  await b.close();
  console.log('out/thumb.png', fs.statSync(path.join(__dirname, 'out', 'thumb.png')).size, 'байт');
})();
