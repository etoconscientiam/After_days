const { chromium } = require('playwright');
(async () => {
  const [,, html, png, w] = process.argv;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +(w || 1500), height: 800 }, deviceScaleFactor: 1 });
  await p.goto('file://' + html);
  await p.waitForTimeout(300);
  await p.screenshot({ path: png, fullPage: true });
  await b.close();
})();
