// Single-file web build (everything inlined into one HTML) for publishing the game as a page.
// Usage: node tools/build-single.mjs [out.html]   (default: dist-single/strata.html)
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.resolve(process.argv[2] ?? path.join(root, 'dist-single/strata.html'));
const OUT = path.join(root, 'dist-single/tmp');
await build({ root, configFile: false, base: './', logLevel: 'warn',
  build: { outDir: OUT, emptyOutDir: true, assetsInlineLimit: 100000000, modulePreload: false } });
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const dir = path.join(OUT, 'assets');
for (const f of fs.readdirSync(dir)) {
  const body = fs.readFileSync(path.join(dir, f), 'utf8');
  if (f.endsWith('.js')) html = html.replace(new RegExp(`<script[^>]*src="./assets/${f}"></script>`), () => `<script type="module">${body.replace(/<\/script/g, '<\\/script')}</script>`);
  if (f.endsWith('.css')) html = html.replace(new RegExp(`<link[^>]*href="./assets/${f}">`), () => `<style>${body}</style>`);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
fs.rmSync(OUT, { recursive: true, force: true });
console.log('wrote', outFile, 'size', html.length, 'leftover refs', (html.match(/\.\/assets\//g) || []).length);
