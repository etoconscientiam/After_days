// Build the falling-sand prototype for publishing: inline the font files it links (relative url(...) → data: URI).
// Usage: node tools/build-proto.mjs   → dist-single/sand.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'proto/sand.html');
let html = readFileSync(src, 'utf8');
let n = 0;
html = html.replace(/url\('(\.\.\/assets\/fonts\/[^']+\.woff2)'\)/g, (_, rel) => {
  n++;
  const b64 = readFileSync(resolve(dirname(src), rel)).toString('base64');
  return `url('data:font/woff2;base64,${b64}')`;
});
mkdirSync(resolve(root, 'dist-single'), { recursive: true });
const out = resolve(root, 'dist-single/sand.html');
writeFileSync(out, html);
console.log(`wrote ${out}: ${(html.length / 1024).toFixed(0)} KB, ${n} fonts inlined`);
