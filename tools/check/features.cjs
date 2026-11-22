// Every feature of the merge table (docs/MERGE_PLAN.md, section 8) once, in the browser, on the particles.
// Needs the dev server (npx vite --host 127.0.0.1 --port 5173). Prints OK/FAIL per feature and the console errors.
// Usage: node tools/check/features.cjs
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://127.0.0.1:5173/'); await p.evaluate(() => localStorage.clear()); await p.goto('http://127.0.0.1:5173/');
  await p.waitForFunction(() => window.__strata && window.__strata.game);
  const results = [];
  const check = async (name, fn) => {
    try { const r = await fn(); results.push([r ? 'OK  ' : 'FAIL', name, typeof r === 'string' ? r : '']); }
    catch (e) { results.push(['FAIL', name, String(e).slice(0, 160)]); }
  };
  const ev = (fn, arg) => p.evaluate(fn, arg);
  // a point of the strata on screen: world x, and k (0 top of the section .. 1 its bottom), in client pixels
  const strataPoint = (wx, k) => ev(({ wx, k }) => {
    const s = window.__strata, sec = s.renderer.section, lay = s.renderer.lay;
    const r = document.querySelector('#world').getBoundingClientRect();
    const wy = lay.sectionTop + sec.topD[wx] + (sec.strataH - sec.topD[wx]) * k;
    return { x: r.left + (wx / 180) * r.width, y: r.top + (wy / 320) * r.height };
  }, { wx, k });
  await ev(() => { const s = window.__strata, g = s.game; if (g.state.phase === 'choose') g.chooseItem(g.availableItems()[0]); s.dev.jumpEra(2); g.run.oxygen = 21;
    for (const id of ['mats', 'plankton', 'molluscs', 'fish']) for (let k = 0; k < 6; k++) { g.run.energy += 1e9; g.buySpecies(id); } });
  await p.waitForTimeout(800);

  await check('tap: a pile falls where the finger is, energy comes', async () => {
    const before = await ev(() => ({ n: window.__strata.game.grid.particles(), e: window.__strata.game.run.energy }));
    for (let k = 0; k < 3; k++) { await p.mouse.click(200, 300); await p.waitForTimeout(100); }
    await p.waitForTimeout(1500);
    const after = await ev(() => ({ n: window.__strata.game.grid.particles(), e: window.__strata.game.run.energy }));
    return after.n > before.n + 100 && after.e > before.e ? `+${after.n - before.n} particles` : false;
  });
  await check('press: hold on the strata', async () => {
    const pt = await strataPoint(60, 0.5);
    await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.waitForTimeout(1500);
    const on = await ev(() => !!window.__strata.game.run.press);
    await p.mouse.up(); await p.waitForTimeout(200);
    const off = await ev(() => !window.__strata.game.run.press);
    return on && off;
  });
  await check('Geologist: view, plates and the lens', async () => {
    await p.click('#geo-btn'); await p.waitForTimeout(900);
    const on = await ev(() => window.__strata.renderer.geologist);
    const pt = await strataPoint(60, 0.4);
    await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(600);
    const lens = await ev(() => { const l = document.querySelector('#lens'); return l && !l.hidden ? l.textContent : ''; });
    await p.click('#geo-btn'); await p.waitForTimeout(300);
    return on && lens ? `lens: ${lens.trim()}` : false;
  });
  await check('era ruler: epochs of the section and the archive, focus', async () => {
    const n = await ev(() => document.querySelectorAll('#ruler .r-seg').length);
    await ev(() => window.__strata.renderer.section.focus(0)); await p.waitForTimeout(300);
    const f = await ev(() => window.__strata.renderer.section.focusEra);
    await ev(() => window.__strata.renderer.section.focus(-1));
    return n > 0 && f === 0 ? `${n} segments` : false;
  });
  await check('chronicle: an entry from a particle', async () => {
    const e = await ev(async () => {
      const m = await import('/src/ui/chronicle.ts'); const s = window.__strata, g = s.game, sec = s.renderer.section;
      const x = 60, y = Math.round((sec.topD[x] + sec.strataH) / 2);
      const entry = m.makeEntry(g, x, sec.locateAt(g, x, y));
      return entry ? JSON.stringify(entry).slice(0, 80) : '';
    });
    return e || false;
  });
  await check('rare event: spawn and claim', async () => {
    const r = await ev(async () => {
      const m = await import('/src/core/rare.ts'); const g = window.__strata.game;
      for (let k = 0; k < 40 && !g.rare; k++) g.rare = m.spawnRare(g);
      if (!g.rare) return '';
      const id = g.rare.id; return (g.rare.def?.id ?? g.rare.kind ?? 'event') + ' → ' + g.claimRare();
    });
    return r || false;
  });
  await check('Bed button: an ochre bed over the surface, then a cooldown', async () => {
    await p.click('#bed-btn'); await p.waitForTimeout(4500);
    return ev(() => { const g = window.__strata.game;
      return g.run.bedT > 0 && document.querySelector('#bed-btn').disabled ? `cooldown ${g.run.bedT.toFixed(0)} s` : false; });
  });
  await check('branch «pile composition»: size and shares', async () => {
    return ev(() => {
      const g = window.__strata.game; g.run.energy += 1e7;
      const n0 = g.pileSize();
      for (const id of ['pileSize', 'pileSand', 'pileClay', 'pileShell']) for (let k = 0; k < 3; k++) g.buyUpgrade(id);
      g.refreshStats();
      const lockedPeat = !g.buyUpgrade('pilePeat');
      return g.pileSize() > n0 && lockedPeat ? `pile ${n0} → ${g.pileSize()}, peat locked in epoch ${g.run.era}` : false;
    });
  });
  for (const el of ['rain', 'flood', 'drought', 'groundwater', 'heat', 'volcano', 'seaAdvance', 'seaRetreat', 'earthquake', 'glacier', 'meteor', 'magma']) {
    await check(`element: ${el}`, async () => {
      return ev((el) => {
        const s = window.__strata, g = s.game;
        const sec = s.renderer.section;
        g.run.energy += 1e12; g.cheats.freeElements = true; g.run.cooldowns[el] = 0;
        if (el === 'earthquake') s.dev.jumpEra(4);
        if (el === 'magma') { g.mods.hot = true; }
        const ok = g.cast(el, { x: 90, v: sec.vOfY(sec.strataH * 0.5), b0: 0, b1: 1e9 });
        return ok === false ? false : 'cast';
      }, el);
    });
  }
  await p.waitForTimeout(2000);
  await check('debug panel: particles, archive, physics', async () => {
    await ev(() => window.__strata.dev.toggle(true)); await p.waitForTimeout(600);
    const txt = await ev(() => document.querySelector('#dev').textContent);
    await ev(() => window.__strata.dev.toggle(false));
    return /ms/.test(txt) ? txt.split('\n').find((l) => /ms/.test(l)) || 'ok' : false;
  });
  await check('save and load (v3)', async () => {
    return ev(async () => {
      const m = await import('/src/save/save.ts'); const g = window.__strata.game;
      const n = g.grid.particles(), L = g.archive.layers.length;
      const str = m.serialize(g); const back = m.deserialize(str);
      return back.grid.particles() === n && back.archive.layers.length === L ? `${Math.round(str.length / 1024)} KB` : false;
    });
  });
  await check('offline 2 h', async () => {
    const y0 = await ev(() => window.__strata.game.run.year);
    await ev(() => window.__strata.away(7200)); await p.waitForTimeout(500);
    const y1 = await ev(() => window.__strata.game.run.year);
    return y1 > y0 ? `+${Math.round(y1 - y0)} yr` : false;
  });
  await check('prestige: a new world on the foundation', async () => {
    return ev(() => {
      const s = window.__strata, g = s.game, P = g.meta.prestiges;
      g.run.compactMass = Math.max(g.run.compactMass, 1e9);
      const ok = g.prestige();
      if (g.state.phase === 'choose') g.chooseItem(g.availableItems()[0]);
      return ok && g.meta.prestiges === P + 1 && g.grid.particles() > 1000 ? `particles ${g.grid.particles()}` : false;
    });
  });
  await p.waitForTimeout(1000);
  for (const r of results) console.log(r[0], r[1], r[2] ? '— ' + r[2] : '');
  console.log('console errors:', errs.length ? errs.slice(0, 6) : 'none');
  await b.close();
})();
