// Save: localStorage, JSON state + the particle grid (typed arrays in base64) + the archive of the depth.
// Versioned with migrations: v1/v2 saves carry the old cell world (columns of cells + packs); on load its top becomes
// particles of the grid and the rest goes into the archive.
import { CFG, NMAT } from '../config';
import { Game } from '../core/game';
import { GameState, newGameState } from '../core/state';
import { LegacyWorld, W as OW, CAP, Pack } from '../world/LegacyWorld';
import { Grid, GW } from '../world/Grid';
import { Archive } from '../world/Archive';
import { StrataSave, packStrata, unpackStrata, strataFromWorld, NS, SEGW, NONE } from '../world/Strata';

const KEY = CFG.B.save.key;
const VERSION = CFG.B.save.version;
const SAND = CFG.B.sand;

function b64(u8: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const u8of = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
function f32(s: string): Float32Array { const u = unb64(s); return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); }
function u16(s: string): Uint16Array { const u = unb64(s); return new Uint16Array(u.buffer, u.byteOffset, u.byteLength / 2); }
function u32(s: string): Uint32Array { const u = unb64(s); return new Uint32Array(u.buffer, u.byteOffset, u.byteLength / 4); }

// ---------- the grid (v3) ----------
interface GridSave { mat: string; look: string; flags: string; spec: string; decay: string; birth: string; prog: string }

function packGrid(g: Grid): GridSave {
  const prog = new Uint16Array(g.N);
  for (let i = 0; i < g.N; i++) prog[i] = Math.min(65535, Math.round(g.prog[i] / 2));
  return {
    mat: b64(g.mat), look: b64(g.look), flags: b64(g.flags), spec: b64(g.spec), decay: b64(g.decay),
    birth: b64(u8of(g.birth)), prog: b64(u8of(prog)),
  };
}

/** Where the thing(s) lie and how thick the foundation is, from the state (as Game.resetStrata does). */
function emptyGrid(state: GameState): Grid {
  const g = new Grid();
  const shards = state.legacy.rituals.includes('shatter');
  const centers = shards ? CFG.B.shards.x640.map((v) => Math.round(v * CFG.B.world.ref640) / 2) : [GW / 2];
  g.reset(centers, state.meta.foundation / 2);
  return g;
}

function unpackGrid(gs: GridSave, state: GameState): Grid {
  const g = emptyGrid(state);
  const mat = unb64(gs.mat);
  if (mat.length !== g.N) throw new Error('grid size changed');
  g.mat.set(mat); g.look.set(unb64(gs.look)); g.flags.set(unb64(gs.flags)); g.spec.set(unb64(gs.spec)); g.decay.set(unb64(gs.decay));
  g.birth.set(f32(gs.birth));
  const prog = u16(gs.prog);
  for (let i = 0; i < g.N; i++) g.prog[i] = prog[i] * 2;
  g.computeTops();
  g.wakeAll();
  g.version++;
  return g;
}

// ---------- the old cell world (v1/v2), read only for the migration ----------
interface WorldSave {
  len: string; h: string; serial: string; fold: string;
  mat: string; flags: string; spec: string; decay: string; k: string; birth: string; prog: string;
  packs: { rows: number; amt: string; prog: string; k: number; a0: number; a1: number; s: number; finds: any[] }[];
  packSerial: number; totalCells: number;
}

function unpackWorld(ws: WorldSave): LegacyWorld {
  const w = new LegacyWorld();
  w.reset();
  w.len.set(u16(ws.len)); w.h.set(f32(ws.h)); w.serial.set(u32(ws.serial)); w.fold.set(f32(ws.fold));
  const mat = unb64(ws.mat), flags = unb64(ws.flags), spec = unb64(ws.spec), decay = unb64(ws.decay), k = u16(ws.k);
  const birth = f32(ws.birth), prog = u16(ws.prog);
  let o = 0;
  for (let x = 0; x < OW; x++) {
    for (let i = 0; i < w.len[x]; i++, o++) {
      const j = x * CAP + i;
      w.mat[j] = mat[o]; w.flags[j] = flags[o]; w.spec[j] = spec[o]; w.decay[j] = decay[o];
      w.k[j] = k[o] / 5000; w.birth[j] = birth[o]; w.prog[j] = prog[o] * 2;
    }
  }
  w.packs = ws.packs.map((p) => {
    const amt = new Float32Array(NMAT), pr = new Float32Array(NMAT);
    amt.set(f32(p.amt).subarray(0, NMAT)); pr.set(f32(p.prog).subarray(0, NMAT));
    const pk: Pack = { rows: p.rows, amt, prog: pr, k: p.k, ageMin: p.a0, ageMax: p.a1, serial: p.s, finds: p.finds ?? [], P: 0, T: 0 };
    return pk;
  });
  w.packSerial = ws.packSerial;
  w.totalCells = ws.totalCells;
  w.version++;
  return w;
}

/**
 * Old cells → particles and archive. The top of each pair of old columns (2x, 2x+1) becomes particle column x, as
 * many rows as fit up to the line where the strata settle (one particle stands for 2×2 old cells: the cell of
 * column 2x at every second row gives it its material, year, bone and progress). What is left below — the older cells
 * and the deep packs — goes into the archive, as layers by years.
 */
export function migrateWorld(w: LegacyWorld, state: GameState): { grid: Grid; archive: Archive } {
  const grid = emptyGrid(state);
  const line = grid.sinkRow + 1 - Math.round(SAND.sinkLine * SAND.refRows) + SAND.startBelowLine;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24);
  // 1) how many of the newest old rows each particle column takes; they leave both old columns
  const take = new Int16Array(GW), oldLen = new Uint16Array(GW), oldLen2 = new Uint16Array(GW);
  for (let x = 0; x < GW; x++) {
    const X = 2 * x;
    const bottom = grid.isArtifactCol(x) ? grid.sinkRow : grid.floor - 1;
    oldLen[x] = w.len[X];
    oldLen2[x] = w.len[X + 1];
    take[x] = Math.max(0, Math.min(bottom - line + 1, Math.floor(w.len[X] / 2)));
    for (const XX of [X, X + 1]) w.len[XX] = Math.max(0, w.len[XX] - 2 * take[x]);
  }
  // 2) the rest (older cells and the deep packs) is the archive
  const archive = Archive.from(strataFromWorld(w, state.run.year, false));
  for (const L of archive.layers) L.open = false;
  archive.rowsInTop = 0;
  // 3) each column: up to the line, the archive's newest layer at the bottom, the newest old cells on top
  const top0 = archive.layers[0];
  for (let x = 0; x < GW; x++) {
    const X = 2 * x, len = oldLen[x], n = take[x];
    const bottom = grid.isArtifactCol(x) ? grid.sinkRow : grid.floor - 1;
    const rows = bottom - line + 1;
    const fill = Math.max(0, rows - n);
    const s = Math.min(NS - 1, Math.floor((X + 1) / SEGW));
    const fm = top0 && top0.rock[s] !== NONE ? top0.rock[s] : CFG.matIndex.dust;
    for (let k = 0; k < fill; k++) grid.put(x, bottom - k, fm, rnd(), top0 ? top0.y1 : state.run.year - 1);
    const len2 = oldLen2[x];
    for (let k = 0; k < n; k++) {
      // the particle stands for 2×2 old cells; a bone among them wins (finds matter more than a grain of mass)
      let j = X * CAP + (len - 1 - 2 * k);
      for (const [XX, L2] of [[X, len], [X + 1, len2]] as [number, number][]) {
        for (const dk of [0, 1]) {
          const idx = L2 - 1 - 2 * k - dk;
          if (idx < 0) continue;
          const jj = XX * CAP + idx;
          if (w.mat[jj] === CFG.matIndex.bone && w.spec[jj] > 0 && !(w.mat[j] === CFG.matIndex.bone && w.spec[j] > 0)) j = jj;
        }
      }
      const y = bottom - fill - n + 1 + k;
      if (grid.put(x, y, w.mat[j], rnd(), w.birth[j], w.flags[j], w.spec[j], w.decay[j]) >= 0) grid.prog[y * GW + x] = w.prog[j];
    }
  }
  grid.computeTops();
  grid.wakeAll();
  return { grid, archive };
}

// ---------- blob ----------
/** v3: `grid` + `archive`. v1/v2: `world` (old cells; v2 also `strata`, a copy rebuilt from them, ignored). */
export interface SaveBlob { v: number; state: GameState; grid?: GridSave; archive?: StrataSave; world?: WorldSave; strata?: unknown }

/** Fill in fields added after a save was written; bump versions here. */
function migrate(blob: SaveBlob): SaveBlob {
  // world clock (added later): timers were in calendar years, so it starts at the calendar
  if (blob.state.run && (blob.state.run as any).clock === undefined) (blob.state.run as any).clock = blob.state.run.year;
  const fresh = newGameState(blob.state.seed);
  const deepFill = (dst: any, src: any) => {
    for (const k in src) {
      if (dst[k] === undefined) dst[k] = src[k];
      else if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && typeof dst[k] === 'object') deepFill(dst[k], src[k]);
    }
  };
  deepFill(blob.state, fresh);
  for (const sp of CFG.species) if (!blob.state.run.pop[sp.id]) blob.state.run.pop[sp.id] = [0, 0, 0];
  // v3: the press is a circle in grid cells now; an old one is dropped (it is not a long-term state anyway)
  if ((blob.v ?? 1) < 3) { blob.state.run.press = null; delete blob.strata; }
  blob.v = VERSION;
  blob.state.version = VERSION;
  return blob;
}

export function serialize(g: Game): string {
  g.state.savedAt = Date.now();
  g.state.seed = g.rng.seed;
  const blob: SaveBlob = { v: VERSION, state: g.state, grid: packGrid(g.grid), archive: packStrata(g.archive) };
  return JSON.stringify(blob);
}

export interface Loaded { state: GameState; grid: Grid; archive: Archive }

export function deserialize(json: string): Loaded {
  const blob = migrate(JSON.parse(json) as SaveBlob);
  if (blob.grid) {
    const grid = unpackGrid(blob.grid, blob.state);
    const archive = blob.archive ? Archive.from(unpackStrata(blob.archive)) : new Archive();
    return { state: blob.state, grid, archive };
  }
  if (blob.world) {
    const { grid, archive } = migrateWorld(unpackWorld(blob.world), blob.state);
    return { state: blob.state, grid, archive };
  }
  return { state: blob.state, grid: emptyGrid(blob.state), archive: new Archive() };
}

export function saveLocal(g: Game): boolean {
  try {
    localStorage.setItem(KEY, serialize(g));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function loadLocal(): Loaded | null {
  try {
    // saves of the worlds that started on old ground are not carried over: the game starts anew, bare
    for (const k of (CFG.B.save as { oldKeys?: string[] }).oldKeys ?? []) localStorage.removeItem(k);
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    return deserialize(s);
  } catch (e) {
    console.warn('load failed', e);
    return null;
  }
}

export function clearLocal(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Export: base64 of the JSON (unicode-safe). */
export function exportString(g: Game): string {
  const bytes = new TextEncoder().encode(serialize(g));
  return b64(bytes);
}

export function importString(s: string): Loaded {
  const json = new TextDecoder().decode(unb64(s.trim()));
  return deserialize(json);
}
