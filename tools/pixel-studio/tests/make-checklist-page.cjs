#!/usr/bin/env node
// Собирает страницу чек-листа из out/report.json и раздела «Ручные проверки» в CHECKLIST.md.
// Запуск: node make-checklist-page.cjs  →  out/checklist.html
'use strict';
const fs = require('fs');
const path = require('path');
const rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'report.json'), 'utf8'));
const md = fs.readFileSync(path.join(__dirname, 'CHECKLIST.md'), 'utf8');

// ручные пункты: заголовки ### и строки «- [ ] …» внутри раздела «Ручные проверки»
const manualMd = md.split('## Ручные проверки')[1].split('\n## ')[0];
const manual = []; let group = '';
for (const line of manualMd.split('\n')) {
  const h = line.match(/^###\s+(.*)/); if (h) { group = h[1].trim(); continue; }
  const m = line.match(/^- \[ \]\s+(.*)/); if (m) manual.push({ id: 'm' + (manual.length + 1), group, text: m[1].trim() });
}
const fixedMd = (md.split('## Найдено и исправлено при отладке')[1] || '').trim();
const fixed = fixedMd.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
const earlier = (fixedMd.split('\n').find(l => l.startsWith('Найденное раньше')) || '').replace(/^Найденное раньше[^:]*:\s*/, '');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const areas = [...new Set(rep.results.map(r => r.area))];
const date = new Date(rep.date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const mins = (rep.secs / 60).toFixed(1).replace('.', ',');

const areaHtml = areas.map((a, ai) => {
  const rs = rep.results.filter(r => r.area === a);
  const p = rs.filter(r => r.status === 'pass').length, f = rs.filter(r => r.status === 'fail').length, s = rs.length - p - f;
  const state = f ? 'fail' : s ? 'skip' : 'pass';
  return `<details class="area ${state}" id="a${ai}"${f ? ' open' : ''}>
  <summary><span class="dot" aria-hidden="true"></span><span class="aname">${esc(a)}</span><span class="acount">${p}/${rs.length}${f ? ` · ${f} ✘` : ''}${s ? ` · ${s} пропущено` : ''}</span></summary>
  <ul>${rs.map(r => `<li class="${r.status}"><span class="mark" aria-label="${r.status === 'pass' ? 'пройдено' : r.status === 'fail' ? 'ошибка' : 'пропущено'}">${r.status === 'pass' ? '✔' : r.status === 'fail' ? '✘' : '–'}</span><span class="t">${esc(r.title)}${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</span></li>`).join('')}</ul>
</details>`;
}).join('\n');

const groups = [...new Set(manual.map(m => m.group))];
const manualHtml = groups.map(g => `<section class="mgroup"><h3>${esc(g)}</h3><ul>${manual.filter(m => m.group === g).map(m => `<li><label><input type="checkbox" id="${m.id}" data-id="${m.id}"><span>${esc(m.text)}</span></label><time data-for="${m.id}"></time></li>`).join('')}</ul></section>`).join('\n');

const html = `<title>Чек-лист студии 3011</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Unbounded:wght@500&display=swap">
<style>
/* Одна тёмная тема, как у самой студии: сводка сверху, ниже автопроверки по разделам и ручной список с галочками */
:root{
  color-scheme:dark;
  --bg:#0c100f; --surface:#121816; --raise:#19201d; --line:#252e2a; --line-2:#33403a;
  --fg:#d8ddd2; --muted:#89948a; --accent:#b4bb72; --warm:#cf9f58; --ok:#8fc77a; --bad:#e07a62; --skip:#c9b25a;
  --f-body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
  --f-disp:"Unbounded","IBM Plex Sans",system-ui,sans-serif;
}
body{background:var(--bg);color:var(--fg);font:15px/1.5 var(--f-body);margin:0}
.wrap{max-width:980px;margin:0 auto;padding-block:28px 60px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:28px}
h1{font:500 clamp(20px,3.4vw,28px)/1.2 var(--f-disp);margin:0;text-wrap:balance}
h1 b{font-weight:500;color:var(--accent)}
h2{font:600 13px/1 var(--f-body);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 12px}
h3{font-size:14px;margin:0 0 8px}
.lead{color:var(--muted);margin:8px 0 0;max-width:68ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat b{display:block;font:500 26px/1.1 var(--f-mono);font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:12.5px}
.stat.ok b{color:var(--ok)} .stat.bad b{color:var(--bad)} .stat.man b{color:var(--warm)}
.areas{display:flex;flex-direction:column;gap:6px}
.area{background:var(--surface);border:1px solid var(--line);border-radius:9px}
.area>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 14px}
.area>summary::-webkit-details-marker{display:none}
.area>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:9px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--ok);flex:none}
.area.fail .dot{background:var(--bad)} .area.skip .dot{background:var(--skip)}
.aname{font-weight:500;min-width:0}
.acount{margin-left:auto;font:13px var(--f-mono);color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.area ul{list-style:none;margin:0;padding:0 14px 12px 33px;display:flex;flex-direction:column;gap:5px}
.area li{display:grid;grid-template-columns:18px minmax(0,1fr);gap:6px;font-size:13.5px}
.mark{font-family:var(--f-mono)}
li.pass .mark{color:var(--ok)} li.fail .mark{color:var(--bad)} li.skip .mark{color:var(--skip)}
.t small{display:block;color:var(--muted);font:12px var(--f-mono);overflow-wrap:anywhere}
.manual{display:flex;flex-direction:column;gap:18px}
.mgroup ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.mgroup li{display:flex;align-items:flex-start;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:9px 12px}
.mgroup label{display:flex;gap:10px;align-items:flex-start;cursor:pointer;flex:1;min-width:0}
.mgroup input{accent-color:var(--warm);width:17px;height:17px;margin:2px 0 0;flex:none}
.mgroup input:checked+span{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--line-2)}
.mgroup time{font:12px var(--f-mono);color:var(--muted);white-space:nowrap}
.note{font-size:13px;color:var(--muted)}
.note.err{color:var(--bad)}
.bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:8px}
.bar i{display:block;height:100%;background:var(--warm);width:0;transition:width .2s}
.fixed{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 18px}
.fixed ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px}
.fixed p{margin:12px 0 0;color:var(--muted);font-size:13.5px}
code{font:13px var(--f-mono);background:var(--raise);padding:1px 5px;border-radius:4px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <header>
    <h1>Чек-лист <b>Пиксельной студии 3011</b></h1>
    <p class="lead">Автопроверки идут из <code>tools/pixel-studio/tests/run.cjs</code>, последний прогон — ${esc(date)}. Ручные пункты — то, что можно проверить только в настоящем просмотрщике и приложениях Claude. Отметки сохраняются вместе со страницей.</p>
  </header>

  <section class="stats" aria-label="Сводка">
    <div class="stat ok"><b>${rep.pass}</b><span>автопроверок пройдено из ${rep.total}</span></div>
    <div class="stat${rep.fail ? ' bad' : ''}"><b>${rep.fail}</b><span>с ошибкой</span></div>
    <div class="stat"><b>${areas.length}</b><span>разделов, прогон ${mins} мин</span></div>
    <div class="stat man"><b id="manCount">0/${manual.length}</b><span>ручных проверок отмечено</span><div class="bar"><i id="manBar"></i></div></div>
  </section>

  <section>
    <h2>Ручные проверки</h2>
    <p class="note" id="syncNote">Загружаю отметки…</p>
    <div class="manual">${manualHtml}</div>
  </section>

  <section>
    <h2>Автопроверки по разделам</h2>
    <div class="areas">${areaHtml}</div>
  </section>

  <section>
    <h2>Найдено и исправлено при отладке</h2>
    <div class="fixed"><ul>${fixed.map(f => `<li>${esc(f)}</li>`).join('')}</ul>${earlier ? `<p>Раньше: ${esc(earlier)}</p>` : ''}</div>
  </section>
</div>

<script>
'use strict';
const TOTAL = ${manual.length};
const boxes = [...document.querySelectorAll('.mgroup input[type=checkbox]')];
const note = document.getElementById('syncNote');
const fmt = t => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let state = {};
function render() {
  let n = 0;
  for (const b of boxes) {
    const s = state[b.dataset.id];
    b.checked = !!(s && s.done); if (b.checked) n++;
    document.querySelector('time[data-for="' + b.dataset.id + '"]').textContent = s && s.done && s.at ? fmt(s.at) : '';
  }
  document.getElementById('manCount').textContent = n + '/' + TOTAL;
  document.getElementById('manBar').style.width = (n / TOTAL * 100) + '%';
}
render();
const LS = 'pixel3011-checklist';
const local = { load() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } }, save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ } } };
let db = null;
const fallback = why => { db = null; state = local.load(); render(); note.textContent = why + ' Отметки сохраняются только в этом браузере.'; };
const timer = setTimeout(() => { if (!db) fallback('Хранилище страницы не ответило.'); }, 10000);
(async () => {
  const use = window.claude && typeof window.claude.use === 'function' ? window.claude.use('db').catch(() => null) : Promise.resolve(null);
  const d = await use;
  clearTimeout(timer);
  if (!d) { fallback('Общее хранилище здесь недоступно.'); return; }
  db = d;
  db.collection('manual').onSnapshot(snap => {
    state = {}; for (const doc of snap.docs) state[doc.id] = doc.data();
    render(); note.textContent = 'Отметки сохраняются вместе со страницей и видны на любом устройстве.'; note.className = 'note';
  }, e => { note.textContent = 'Не удалось прочитать отметки (' + (e && e.code || 'ошибка') + '). Обновите страницу.'; note.className = 'note err'; });
})();
for (const b of boxes) b.addEventListener('change', async () => {
  const id = b.dataset.id, val = { done: b.checked, at: Date.now() };
  state[id] = val; render();
  if (!db) { local.save(); return; }
  try { await db.doc('manual/' + id).set(val); }
  catch (e) { b.checked = !b.checked; state[id] = { done: b.checked, at: val.at }; render(); note.textContent = e && e.code === 'permission_denied' ? 'У вас нет прав отмечать пункты на этой странице.' : 'Отметка не сохранилась (' + (e && e.code || 'ошибка') + '). Попробуйте ещё раз.'; note.className = 'note err'; }
});
</script>
`;
fs.writeFileSync(path.join(__dirname, 'out', 'checklist.html'), html);
console.log('out/checklist.html:', rep.total, 'автопроверок,', manual.length, 'ручных пунктов');
