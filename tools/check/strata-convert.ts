// Check the converter (stage 1 of the layer engine): old saves (cells + packs) → layers.
// Usage: npx tsx tools/check/strata-convert.ts [save.json | save.json.gz]...   (default: the old saves in fixtures/)
// For every save: material totals, bones, depth at three columns (old world vs layers), layer list,
// and a save → load round trip of the layers.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CFG, NMAT, M } from '../../src/config';
import { deserialize } from '../../src/save/save';
import { packStrata, unpackStrata, NS, NONE } from '../../src/world/Strata';
import { W, CAP, F_FOSSIL } from '../../src/world/World';

let bad = 0;
const FIX = new URL('./fixtures/', import.meta.url).pathname;
const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(FIX).filter((f) => f.startsWith('v1_')).map((f) => FIX + f);
for (const f of files) {
  const raw = readFileSync(f);
  const { state, world: w, strata: st } = deserialize((f.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
  const old = new Float64Array(NMAT), neu = new Float64Array(NMAT);
  let oldBones = 0, oldFossils = 0;
  for (let x = 0; x < W; x++) for (let i = 0; i < w.len[x]; i++) {
    const j = x * CAP + i;
    old[w.mat[j]]++;
    if (w.mat[j] === M.bone && w.spec[j] > 0) { oldBones++; if (w.flags[j] & F_FOSSIL) oldFossils++; }
  }
  for (const p of w.packs) { for (let m = 0; m < NMAT; m++) old[m] += p.amt[m]; oldBones += p.finds.length; oldFossils += p.finds.filter((q) => !q.fragment).length; }
  for (const L of st.layers) for (let s = 0; s < NS; s++) for (let m = 0; m < NMAT; m++) neu[m] += L.amt[s * NMAT + m];
  let diff = 0, tot = 0;
  for (let m = 0; m < NMAT; m++) { diff += Math.abs(old[m] - neu[m]); tot += old[m]; }
  const sum = st.summary();
  const depth = [10, 90, 170].map((x) => `${w.visualDepth(x).toFixed(0)}/${st.visualDepth(x).toFixed(0)}`).join(' ');
  // round trip
  const st2 = unpackStrata(JSON.parse(JSON.stringify(packStrata(st))));
  // amounts are stored with 3 decimals: thicknesses may differ in the last digit
  const s2 = st2.summary();
  const rt = s2.n === sum.n && s2.bones === sum.bones && s2.fossils === sum.fossils
    && sum.list.every((L, i) => { const M2 = s2.list[i]; return M2.id === L.id && M2.y0 === L.y0 && M2.y1 === L.y1 && M2.rock === L.rock && M2.k === L.k && M2.open === L.open && Math.abs(M2.rows - L.rows) < 0.05; });
  const maxRows = Math.max(...sum.list.map((L) => L.rows));
  const size = JSON.stringify(packStrata(st)).length;
  const yearsOk = st.layers.every((L, i) => L.y0 <= L.y1 && (i === 0 || L.y0 <= st.layers[i - 1].y1 + 1e-6) && L.rock.every((r) => r !== NONE));
  const ok = diff / Math.max(1, tot) < 1e-4 && sum.bones === oldBones && sum.fossils === oldFossils && rt && yearsOk;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${f.split('/').pop()} era=${state.run.era} year=${Math.round(state.run.year)} cells=${w.totalCells} packs=${w.packs.length} → layers=${sum.n} rows=${sum.rows} | amt diff ${(diff / Math.max(1, tot) * 100).toFixed(4)}% | bones ${oldBones}/${sum.bones} fossils ${oldFossils}/${sum.fossils} | depth old/new ${depth} | roundtrip ${rt} | thickest ${maxRows} | ${(size / 1024).toFixed(0)} KB`);
  if (process.env.LIST) for (const L of sum.list) console.log(`    #${L.id} ${CFG.eras[L.era].key.padEnd(9)} ${String(L.y0).padStart(6)}..${String(L.y1).padEnd(6)} ${L.rock.padEnd(10)} rows=${L.rows} k=${L.k}${L.open ? ' open' : ''}`);
}
process.exit(bad ? 1 : 0);
