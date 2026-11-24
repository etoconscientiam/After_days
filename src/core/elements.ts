// Elements: surface catastrophes and underground interventions — on the particles of the strata.
import { CFG, ElementDef, M, mat, SX } from '../config';
import type { Game } from './game';
import { GW, KIND, K_SOLID } from '../world/Grid';
import { giveNote } from './prestige';
import { dropPile, rainOne } from './sand';
import { wx } from './sources';

const W = CFG.B.world.width;
const S = CFG.B.sand;

export function elementUnlocked(g: Game, el: ElementDef): boolean {
  if (el.world === 'hot' && !g.mods.hot) return false;
  if (g.mods.shards && (el.id === 'seaAdvance' || el.id === 'seaRetreat')) return false;
  return g.run.era >= el.era;
}

const zoneShares = (water: number, shore: number, land: number) => [water, shore, land];
/** Particle columns of a world-pixel range. */
const cols = (X0: number, X1: number): [number, number] => [Math.max(0, Math.floor(X0 / 2)), Math.min(GW - 1, Math.floor(X1 / 2))];

/** Sink the bottom n rows of particle column x into the archive: the column above moves down by n (a fault). */
function sinkColumn(g: Game, x: number, n: number): void {
  const grid = g.grid;
  for (let k = 0; k < n; k++) {
    g.archive.addRow(grid, grid.sinkRow, x, x);
    for (let y = grid.sinkRow; y > 0; y--) {
      const a = y * GW + x, b = (y - 1) * GW + x;
      grid.mat[a] = grid.mat[b]; grid.look[a] = grid.look[b]; grid.birth[a] = grid.birth[b]; grid.prog[a] = grid.prog[b];
      grid.flags[a] = grid.flags[b]; grid.spec[a] = grid.spec[b]; grid.decay[a] = grid.decay[b];
    }
    grid.mat[x] = 0; grid.prog[x] = 0; grid.flags[x] = 0; grid.spec[x] = 0; grid.decay[x] = 0;
  }
}

/** Remove the top n particles of column x (erosion of an uplifted block, a crater). Returns how many. */
function eroded(g: Game, x: number, n: number): number {
  const grid = g.grid;
  let k = 0;
  for (let y = grid.surf[x]; y < grid.sinkRow && k < n; y++) {
    const i = y * GW + x;
    if (!grid.mat[i] || KIND[grid.mat[i]] === K_SOLID) continue;
    grid.clear(i); k++;
  }
  return k;
}

export function castElement(g: Game, el: ElementDef, target?: { x: number; v: number; b0?: number; b1?: number }): void {
  const r = g.run;
  const p = el.params;
  const grid = g.grid;
  const fast = g.headless;
  switch (el.id) {
    case 'rain': {
      r.active.push({ id: 'rain', until: r.clock + el.duration });
      // carry carcasses downhill: land -> shore, shore -> water
      const move = (from: 'land' | 'shore', to: 'shore' | 'water') => {
        const a = r.pools[from], b = r.pools[to];
        const s = p.transport;
        const mass = (a.orgL + a.orgM + a.bone) * s;
        const bm = b.orgL + b.orgM + b.bone;
        b.orgL += a.orgL * s; b.orgM += a.orgM * s; b.bone += a.bone * s;
        for (let i = 0; i < a.boneSpec.length; i++) { b.boneSpec[i] += a.boneSpec[i] * s; a.boneSpec[i] *= 1 - s; }
        a.orgL *= 1 - s; a.orgM *= 1 - s; a.bone *= 1 - s;
        b.age = mass + bm > 0 ? (b.age * bm + a.age * mass) / (mass + bm) : 0;
      };
      move('shore', 'water');
      move('land', 'shore');
      break;
    }
    case 'flood': {
      r.active.push({ id: 'flood', until: r.clock + el.duration });
      r.pools.shore.fast = el.duration;
      r.pools.water.fast = el.duration;
      g.kill(zoneShares(0, p.kill.shore, 0), 'flood');
      // a thin bed of silt over the sea and the shore
      const [x0, x1] = cols(0, r.shoreEnd);
      g.queueBed(M.floodSilt, x0, x1);
      break;
    }
    case 'drought': {
      r.active.push({ id: 'drought', until: r.clock + el.duration });
      g.kill(zoneShares(0, 0, p.kill.land), 'drought');
      break;
    }
    case 'groundwater':
    case 'heat':
    case 'magma': {
      if (!target) return;
      const t = target.b0 !== undefined && target.b1 !== undefined
        ? { kind: 'water' as const, x0: Math.max(0, target.x - p.radiusX), x1: Math.min(W - 1, target.x + p.radiusX), b0: target.b0, b1: target.b1, until: 0, heat: 0 }
        : g.targetFromSection(target.x, target.v, p.radiusX, p.radiusY)!;
      t.kind = el.id === 'groundwater' ? 'water' : el.id === 'heat' ? 'heat' : 'magma';
      t.heat = p.heat ?? 0;
      t.until = r.clock + el.duration;
      r.targets.push(t);
      if (el.id === 'magma') {
        // a pocket of magma in the chosen layers: an ellipse in columns and years
        const [x0, x1] = cols(t.x0, t.x1);
        const cx = target.x / 2, rx = Math.max(1, p.radiusX / 2);
        const mid = (t.b0 + t.b1) / 2, half = Math.max(1, (t.b1 - t.b0) / 2);
        for (let x = x0; x <= x1; x++) {
          const dx = (x - cx) / rx;
          for (let y = grid.surf[x]; y <= grid.sinkRow; y++) {
            const i = y * GW + x;
            if (!grid.mat[i] || KIND[grid.mat[i]] === K_SOLID) continue;
            const dyv = (grid.birth[i] - mid) / half;
            if (dx * dx + dyv * dyv <= 1) { grid.mat[i] = M.magma; grid.prog[i] = 0; }
          }
        }
      }
      grid.version++;
      break;
    }
    case 'volcano': {
      let vent: number;
      if (g.mods.shards) vent = Math.round((g.lastShard * 120 + 30 + g.rng.next() * 60) * SX);
      else vent = Math.floor(r.waterEnd + g.rng.next() * Math.max(20, W - r.waterEnd - 10));
      vent = Math.max(2, Math.min(W - 3, vent));
      r.active.push({ id: 'volcanoFx', until: r.clock + 30, x: vent });
      // an ash cone at the vent (the volume of the old ash fall) and a pale ash lens around it; burial ×5
      const cv = Math.floor(vent / 2);
      const n = Math.round((p.ashRows * p.radius * Math.sqrt(Math.PI)) / S.cellsPerParticle);
      dropPile(grid, g.rng, g.water, { cx: cv, n, mix: [{ m: M.ash, w: 1 }], birth: r.year, y0: 2 }, fast);
      r.layers += n;
      for (const pool of Object.values(r.pools)) pool.fast = Math.max(pool.fast, 30 * p.burial);
      const rl = Math.round(p.radius / 2);
      g.queueBed(M.tephra, cv - rl, cv + rl);
      const vz = g.zoneMap[vent];
      const shares = [0.1, 0.1, 0.1];
      shares[vz] = p.kill;
      g.kill(shares, 'volcano');
      r.targets.push({ kind: 'heat', x0: Math.max(0, vent - Math.round(24 * SX)), x1: Math.min(W - 1, vent + Math.round(24 * SX)), b0: -1e9, b1: 1e9, until: r.clock + p.heatYears, heat: p.heat });
      if (g.mods.hot) dropPile(grid, g.rng, g.water, { cx: cv, n: 24, mix: [{ m: M.magma, w: 1 }], birth: r.year, y0: 2 }, fast);
      grid.version++;
      break;
    }
    case 'seaAdvance':
    case 'seaRetreat': {
      const shift = Math.round(p.shift * CFG.B.world.ref640);
      const minW = Math.round(CFG.B.zones.minWidth640 * CFG.B.world.ref640);
      const shoreW = r.shoreEnd - r.waterEnd;
      if (el.id === 'seaAdvance') r.waterEnd = Math.min(W - minW - shoreW, r.waterEnd + shift);
      else r.waterEnd = Math.max(minW, r.waterEnd - shift);
      r.shoreEnd = r.waterEnd + shoreW;
      g.recomputeZones();
      g.statsDirty = true;
      grid.version++;
      break;
    }
    case 'earthquake': {
      const X0 = Math.floor((40 + g.rng.next() * 280) * SX);
      const rightUp = g.rng.next() < 0.5;
      const lift = g.rng.int(p.liftMin, p.liftMax);
      const A = g.rng.range(p.foldMin, p.foldMax);
      const lam = g.rng.range(120, 300) * CFG.B.world.ref640;
      // a real fault: the block on the down side sinks by the lift (its bottom goes into the archive), the raised
      // block loses its top to erosion; the layers stay offset across the fault for good
      const cx0 = Math.floor(X0 / 2), n = Math.max(1, Math.round(lift / 2));
      for (let x = 0; x < GW; x++) {
        const up = rightUp ? x > cx0 : x < cx0;
        const ramp = Math.min(1, Math.abs(x - cx0) / 3);
        if (up) eroded(g, x, Math.round(n * ramp * 0.5));
        else if (!grid.isArtifactCol(x)) sinkColumn(g, x, Math.round(n * ramp));
      }
      grid.computeTops();
      grid.wakeAll();
      g.run.faults.push({ x: X0 / W, up: rightUp ? 1 : -1, lift, amp: A, lam: lam / W, b: g.run.year });
      if (g.run.faults.length > 4) g.run.faults.shift();
      for (let i = 0; i < Math.min(12, g.archive.layers.length); i++) if (g.rng.next() < p.noteChance) giveNote(g);
      // small things from the technogenic horizon come up with the fault
      if (g.rng.next() < CFG.story.relicChance) {
        const rel = g.rng.pick(CFG.relics).id;
        g.legacy.relics[rel] = (g.legacy.relics[rel] ?? 0) + 1;
        g.statsDirty = true;
        g.bus.emit('relicFound', { id: rel });
      }
      r.active.push({ id: 'quakeFx', until: r.clock + 5, x: X0 });
      g.kill([0.03, 0.08, 0.08], 'earthquake');
      grid.version++;
      break;
    }
    case 'glacier': {
      r.active.push({ id: 'glacier', until: r.clock + el.duration });
      r.glacierLoad = p.load;
      // moraine over the land (and half as much on the shore)
      for (let x = 0; x < GW; x++) {
        const zi = g.zoneMap[wx(x)];
        if (zi === 0) continue;
        const n = Math.round(((p.moraineRows * (zi === 2 ? 1 : 0.5)) * 2) / S.cellsPerParticle);
        for (let k = 0; k < n; k++) rainOne(grid, g.rng, g.water, x, M.moraine, r.year, fast);
        r.layers += n;
      }
      g.kill(zoneShares(0, p.kill.shore, p.kill.land), 'glacier');
      grid.version++;
      break;
    }
    case 'meteor': {
      const cx = Math.floor((30 + g.rng.next() * 300) * SX / 2);
      const R = Math.max(2, Math.round(p.craterRadius / 2));
      // the crater: a bowl taken out of the strata, its ejecta thrown back around the rim
      let thrown = 0;
      for (let x = Math.max(0, cx - R); x <= Math.min(GW - 1, cx + R); x++) {
        const d = Math.abs(x - cx) / R;
        thrown += eroded(g, x, Math.round(6 * (1 - d * d)));
      }
      grid.computeTops();
      const mixEj = [{ m: mat('dust'), w: 1 }];
      for (const side of [-1, 1]) dropPile(grid, g.rng, g.water, { cx: Math.max(2, Math.min(GW - 3, cx + side * (R + 2))), n: Math.round(thrown / 2), mix: mixEj, birth: r.year, y0: 2 }, fast);
      dropPile(grid, g.rng, g.water, { cx, n: 12, mix: [{ m: M.meteor, w: 1 }], birth: r.year, y0: 2 }, fast);
      // an iridium bed over the whole world
      g.queueBed(M.meteor);
      for (const L of g.archive.layers) L.k = Math.min(CFG.B.physics.kMax + g.stats.kMax, L.k + p.kDelta);
      g.formRock('rare', p.rare, wx(cx));
      g.kill([p.kill, p.kill, p.kill], 'meteor');
      r.active.push({ id: 'meteorFx', until: r.clock + 60, x: wx(cx) });
      grid.version++;
      break;
    }
  }
}

export { mat };
