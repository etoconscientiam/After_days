// Flicker check for the section: needs the dev server (npx vite --host 127.0.0.1 --port 5173).
// Runs a game to the Sea era, samples the section buffer 40 times every 100 ms and prints
// changed (share of pixels that changed between frames: motion) and flickerBack (A->B->A: flicker; target 0).
// Usage: node tools/check/flicker.cjs
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await p.goto('http://127.0.0.1:5173/'); await p.evaluate(() => localStorage.clear()); await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = window.__strata, g = s.game; g.chooseItem(g.availableItems()[0]); s.dev.timeScale = 40; });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { const s = window.__strata, g = s.game; s.dev.jumpEra(1); g.run.oxygen = 21; for (let k = 0; k < 4; k++) { g.run.energy += 1e9; g.buySpecies('mats'); } s.dev.jumpEra(2); for (let k = 0; k < 6; k++) for (const id of ['plankton', 'fish', 'molluscs']) { g.run.energy += 1e9; g.buySpecies(id); } s.dev.timeScale = 30; });
  await p.waitForTimeout(6000);
  await p.evaluate(() => { const s = window.__strata; s.dev.timeScale = 3; });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(async () => {
    const s = window.__strata, sec = s.renderer.section, H = s.renderer.lay.sectionH, W = 180;
    const frames = [];
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); frames.push(sec.buf.slice(0, H * W)); }
    let ch = 0, back = 0, tot = 0;
    for (let i = 2; i < frames.length; i++) for (let j = 0; j < frames[i].length; j++) {
      tot++;
      if (frames[i - 1][j] !== frames[i - 2][j]) { ch++; if (frames[i][j] === frames[i - 2][j]) back++; }
    }
    return { changed: (ch / tot).toFixed(3), flickerBack: (back / tot).toFixed(4), layers: sec.layers.length };
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
