// The thing absorbs the strata. Above it, the strata squeeze: the bottom rows of the visible section are drawn as
// 1-px lines (core/sand rows stay 2 px elsewhere), then the rows the conveyor already took, also 1 px each, so a
// layer reaching the thing slows down and thins to a line. The lowest line touches the thing and is absorbed:
// the thing gets energy by what the line is made of — loose sediment is cheap, rock dearer, bones, amber, coal and
// marker beds dearer still (balance.json sand.absorb). The rows the conveyor takes still go to the archive of
// the depth (its geology, the foundation, the dig of epoch VII): the archive is the memory of what was absorbed.
import { CFG } from '../config';
import type { Game } from './game';
import { Grid, GW, KIND, K_LOOSE, K_ROCK, K_MARKER, P_FOSSIL } from '../world/Grid';

const A = CFG.B.sand.absorb;

/** Energy value of one particle of each material (before the unit of the moment). */
export const VALUE = new Float32Array(CFG.materials.length);
CFG.materials.forEach((m, i) => {
  const k = KIND[i];
  let v = k === K_LOOSE ? A.kind.loose : k === K_ROCK ? A.kind.rock : k === K_MARKER ? A.kind.marker : 0;
  const o = (A.mat as Record<string, number>)[m.id];
  if (o !== undefined) v = o;
  VALUE[i] = v;
});

/** One line of the band: the particles of a row the conveyor took, and their summed value. */
export interface BandLine { mats: Uint8Array; looks: Uint8Array; v: number }

/** The row y of the grid as a band line (called right before the conveyor takes it). */
export function captureRow(g: Grid, y: number): BandLine {
  const o = y * GW;
  const mats = g.mat.slice(o, o + GW), looks = g.look.slice(o, o + GW);
  let v = 0;
  for (let x = 0; x < GW; x++) {
    const m = mats[x];
    let val = VALUE[m];
    if (val > 0 && (g.flags[o + x] & P_FOSSIL)) val *= A.fossilMul;
    v += val;
  }
  return { mats, looks, v };
}

/** Energy of one unit of value now: a small flat part and a share of the income, so it keeps its weight. */
export function absorbUnit(g: Game): number {
  return A.flat * g.stats.energyMul + g.incomePerSec(false) * A.incomeShare;
}

/** A new line enters the band at its top; the lowest line beyond the band's depth is absorbed by the thing. */
export function pushBand(g: Game, line: BandLine): void {
  g.band.unshift(line);
  while (g.band.length > A.bandRows) absorbLine(g, g.band.pop()!);
}

function absorbLine(g: Game, line: BandLine): void {
  if (g.state.phase !== 'play' || line.v <= 0) return;
  const e = line.v * absorbUnit(g);
  const r = g.run;
  r.energy += e;
  r.energyEarned += e;
  g.absorbAcc += e;
  // the colour of the line: its most valuable material
  let best = 0, bm = 0;
  const w = new Float32Array(CFG.materials.length);
  for (let x = 0; x < GW; x++) { const m = line.mats[x]; w[m] += VALUE[m]; if (w[m] > best) { best = w[m]; bm = m; } }
  if (!g.headless) g.bus.emit('absorb', { energy: e, mat: CFG.materials[bm].id, value: line.v });
}
