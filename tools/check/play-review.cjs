// A plain player: taps ~2/s across the world, every 20 s buys the cheapest affordable thing (upgrade or species).
const { chromium } = require('playwright');
const FILE = process.argv[2], MIN = +process.argv[3] || 8;
// screenshots go next to the build (never into the repository)
const OUT = require("path").dirname(FILE);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('file://' + FILE); await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const s = window.__strata, g = s.game; s.lang('ru');
    window.__log = []; const T = () => Math.round(g.state.legacy.totalRealTime);
    const L = (ev, d) => window.__log.push(`${T()}s ${ev} ${d ?? ''}`);
    g.bus.on('eraChanged', (e) => L('ЭРА', e.era));
    g.bus.on('wildBorn', (e) => { if (e.first) L('зародился', e.id); });
    g.bus.on('wildDied', (e) => { if (e.last) L('вымер', e.id); });
    g.bus.on('rockDiscovered', (e) => L('порода', e.rock));
    g.bus.on('orderDone', (e) => L('заказ выполнен', e.id));
    g.bus.on('fossilFound', (e) => { if (e.complete) L('окаменелость', e.species); });
    g.bus.on('noteFound', (e) => L('записка', e.id));
    g.bus.on('geyser', () => L('гейзер'));
    let ab = 0; g.bus.on('absorb', () => { if (!ab++) L('первое поглощение'); });
    g.bus.on('extinction', (e) => L('вымирание', e.killed));
    g.bus.on('rare', (e) => L('редкое', JSON.stringify(e).slice(0, 40)));
  });
  // the choice screen if any
  await p.evaluate(() => { const g = window.__strata.game; if (g.state.phase === 'choose') { window.__log.push('экран выбора предмета'); g.chooseItem(g.availableItems()[0]); } });
  const t0 = Date.now(); let lastBuy = 0, shot = 0, taps = 0;
  while (Date.now() - t0 < MIN * 60000) {
    await p.mouse.click(25 + Math.random() * 300, 230 + Math.random() * 120); taps++;
    await p.waitForTimeout(430);
    const el = Date.now() - t0;
    if (el - lastBuy > 20000) {
      lastBuy = el;
      const r = await p.evaluate(() => {
        const s = window.__strata, g = s.game, C = s.cfg, out = [];
        for (let k = 0; k < 6; k++) {
          const opts = [];
          for (const u of C.upgrades) if (u.currency === 'energy' && (!u.era || g.run.era >= u.era)) opts.push({ c: g.upgradeCost(u.id), f: () => g.buyUpgrade(u.id), n: 'улучш:' + u.id });
          for (const sp of C.species) if (g.speciesUnlocked(sp) && g.placeFor(sp)) opts.push({ c: g.speciesCost(sp), f: () => g.buySpecies(sp.id), n: 'вид:' + sp.id });
          opts.sort((a, b) => a.c - b.c);
          const o = opts.find((o) => o.c <= g.run.energy);
          if (!o || !o.f()) break;
          out.push(o.n);
        }
        return out;
      });
      if (r.length) await p.evaluate((r) => window.__log.push(`${Math.round(window.__strata.game.state.legacy.totalRealTime)}s купил ${r.join(', ')}`), r);
    }
    if (el > shot * 40000) {
      const st = await p.evaluate(() => { const g = window.__strata.game; return { t: Math.round(g.state.legacy.totalRealTime), era: g.run.era, E: Math.round(g.run.energy), inc: +g.incomePerSec().toFixed(1), click: +g.clickValue().toFixed(2), goal: (document.querySelector('#hud')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160) }; });
      await p.evaluate((st) => window.__log.push('СОСТОЯНИЕ ' + JSON.stringify(st)), st);
      await p.screenshot({ path: `${OUT}/shot-${String(shot).padStart(2, '0')}.png` });
      shot++;
    }
  }
  const log = await p.evaluate(() => window.__log);
  console.log(log.join('\n'));
  console.log('taps', taps, 'errors', errs.slice(0, 3));
  await b.close();
})();
