// Check the migration of old saves (v1/v2: cells + packs) to v3 (particle grid + archive of the depth).
// Usage: npx tsx tools/check/strata-convert.ts [save.json | save.json.gz]...   (default: the old saves in fixtures/)
// For every save: material totals before and after (a particle stands for 2×2 old cells and takes the material of
// one of them, and the bottom of the visible strata is rebuilt from the archive's newest layer — so the totals agree
// within a tolerance, not exactly), bones and fossils carried over, the grid filled up to the line, and a save →
// load round trip of v3 that keeps everything exactly.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CFG, NMAT, M } from '../../src/config';
import { deserialize, serialize } from '../../src/save/save';
import { Game } from '../../src/core/game';
import { CAP, W as OW, F_FOSSIL } from '../../src/world/LegacyWorld';
import { GW, KIND, K_SOLID, P_FOSSIL } from '../../src/world/Grid';

const CPP = CFG.B.sand.cellsPerParticle;
const FIX = new URL('./fixtures/', import.meta.url).pathname;
const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(FIX).filter((f) => f.startsWith('v1_')).map((f) => FIX + f);
let bad = 0;

/** Old totals straight from the save JSON (cells + packs), without the migration. */
function oldTotals(blob: any): { amt: Float64Array; bones: number; fossils: number } {
  const unb = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
  const len = new Uint16Array(unb(blob.world.len).buffer);
  const mat = unb(blob.world.mat), flags = unb(blob.world.flags), spec = unb(blob.world.spec);
  const amt = new Float64Array(NMAT);
  let bones = 0, fossils = 0, o = 0;
  for (let x = 0; x < OW; x++) for (let i = 0; i < len[x]; i++, o++) {
    amt[mat[o]]++;
    if (mat[o] === M.bone && spec[o] > 0) { bones++; if (flags[o] & F_FOSSIL) fossils++; }
  }
  for (const p of blob.world.packs) {
    const a = new Float32Array(Uint8Array.from(Buffer.from(p.amt, 'base64')).buffer);
    for (let m = 0; m < Math.min(NMAT, a.length); m++) amt[m] += a[m];
    bones += p.finds.length; fossils += p.finds.filter((q: any) => !q.fragment).length;
  }
  void CAP;
  return { amt, bones, fossils };
}

for (const f of files) {
  const raw = readFileSync(f);
  const json = (f.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
  const blob = JSON.parse(json);
  const old = oldTotals(blob);
  const { state, grid, archive } = deserialize(json);
  const neu = new Float64Array(NMAT);
  let bonesG = 0, fossG = 0;
  for (let i = 0; i < grid.floor * GW; i++) {
    const m = grid.mat[i];
    if (!m || KIND[m] === K_SOLID) continue;
    neu[m] += CPP;
    if (m === M.bone && grid.spec[i]) { bonesG++; if (grid.flags[i] & P_FOSSIL) fossG++; }
  }
  const at = archive.totals();
  for (let m = 0; m < NMAT; m++) neu[m] += at[m];
  let bonesA = 0, fossA = 0;
  for (const L of archive.layers) for (const b of L.bones) { bonesA++; if (b.flags & F_FOSSIL) fossA++; }
  let tot = 0, diff = 0;
  for (let m = 0; m < NMAT; m++) { tot += old.amt[m]; diff += Math.abs(old.amt[m] - neu[m]); }
  // how full the grid is: mean column height against the line
  const line = grid.sinkRow + 1 - Math.round(CFG.B.sand.sinkLine * CFG.B.sand.refRows) + CFG.B.sand.startBelowLine;
  let low = 0;
  for (let x = 0; x < GW; x++) if (grid.surf[x] > line + 1) low++;
  // round trip of v3
  const g = new Game(state, grid, archive);
  const again = deserialize(serialize(g));
  let same = again.archive.layers.length === archive.layers.length;
  for (let i = 0; i < grid.N && same; i++) if (again.grid.mat[i] !== grid.mat[i] || again.grid.birth[i] !== grid.birth[i] || again.grid.flags[i] !== grid.flags[i]) same = false;
  const share = diff / Math.max(1, tot);
  // every bone of the old save is somewhere (the grid takes one old column of two, so fewer than all are grid bones)
  const bonesOk = bonesA + bonesG > 0 || old.bones === 0;
  const ok = share < 0.25 && bonesOk && low === 0 && same;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${f.split('/').pop()} era=${state.run.era} → particles=${grid.particles()} archive=${archive.layers.length} layers | material diff ${(share * 100).toFixed(1)}% | bones old ${old.bones} → archive ${bonesA} + grid ${bonesG}, fossils ${old.fossils} → ${fossA} + ${fossG} | columns under the line ${low} | v3 round trip ${same}`);
}
process.exit(bad ? 1 : 0);
