// Flicker check of the strata: needs the dev server (npx vite --host 127.0.0.1 --port 5173).
// Plays to the Sea era with life (and taps), samples the section buffer and the particle grid 40 times every 100 ms.
// A falling grain is motion, not flicker: only cells where the same particle (material and look) stays for three
// frames in a row are judged. Their pixels must not change at all:
//   restingChanged — share of such pixels that changed between frames (target 0),
//   flickerBack    — share that went A→B→A (target 0),
//   moving         — share of cells whose particle moved (motion, for reference).
// Usage: node tools/check/flicker.cjs
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await p.goto('http://127.0.0.1:5173/'); await p.evaluate(() => localStorage.clear()); await p.goto('http://127.0.0.1:5173/'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = window.__strata, g = s.game; g.chooseItem(g.availableItems()[0]); s.dev.timeScale = 20; });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = window.__strata, g = s.game; s.dev.jumpEra(1); g.run.oxygen = 21; for (let k = 0; k < 4; k++) { g.run.energy += 1e9; g.buySpecies('mats'); } s.dev.jumpEra(2); for (let k = 0; k < 6; k++) for (const id of ['plankton', 'fish', 'molluscs']) { g.run.energy += 1e9; g.buySpecies(id); } s.dev.timeScale = 3; });
  await p.waitForTimeout(3000);
  // keep tapping while sampling: piles fall, the strata compact, the conveyor runs
  const tap = setInterval(() => p.mouse.click(40 + Math.random() * 300, 220).catch(() => {}), 300);
  const r = await p.evaluate(async () => {
    const s = window.__strata, sec = s.renderer.section, grid = s.game.grid, W = 180, GW = grid.W;
    const frames = [];
    for (let i = 0; i < 40; i++) {
      await new Promise((res) => setTimeout(res, 100));
      frames.push({ px: sec.buf.slice(), mat: grid.mat.slice(), look: grid.look.slice(), sunk: s.game.run.sink.rows });
    }
    let judged = 0, changed = 0, back = 0, moving = 0, cells = 0;
    for (let i = 2; i < frames.length; i++) {
      const a = frames[i - 2], m = frames[i - 1], c = frames[i];
      // the conveyor moves the whole strata down by whole rows: follow a particle through that shift
      const s1 = m.sunk - a.sunk, s2 = c.sunk - a.sunk;
      for (let j = 0; j < grid.floor * GW; j++) {
        const x = j % GW, y = (j / GW) | 0;
        const y1 = y + s1, y2 = y + s2;
        if (y2 >= grid.floor || y > grid.sinkRow) continue;
        const j1 = y1 * GW + x, j2 = y2 * GW + x;
        if (!a.mat[j]) continue;
        cells++;
        if (a.mat[j] !== m.mat[j1] || m.mat[j1] !== c.mat[j2] || a.look[j] !== m.look[j1] || m.look[j1] !== c.look[j2]) { moving++; continue; }
        for (let d = 0; d < 4; d++) {
          const dx = x * 2 + (d & 1), dy = d >> 1;
          const k0 = (y * 2 + dy) * W + dx, k1 = (y1 * 2 + dy) * W + dx, k2 = (y2 * 2 + dy) * W + dx;
          judged++;
          if (a.px[k0] !== m.px[k1] || m.px[k1] !== c.px[k2]) changed++;
          if (a.px[k0] !== m.px[k1] && c.px[k2] === a.px[k0]) back++;
        }
      }
    }
    return { restingChanged: (changed / Math.max(1, judged)).toFixed(5), flickerBack: (back / Math.max(1, judged)).toFixed(5), moving: (moving / Math.max(1, cells)).toFixed(4), particles: grid.particles(), sunk: s.game.run.sink.rows };
  });
  clearInterval(tap);
  console.log(JSON.stringify(r));
  await b.close();
})();
