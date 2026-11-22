// Save: localStorage, JSON state + the pixel world packed into base64 typed arrays. Versioned with migrations.
import { CFG, NMAT } from '../config';
import { Game } from '../core/game';
import { GameState, newGameState } from '../core/state';
import { World, W, CAP, Pack } from '../world/World';

const KEY = CFG.B.save.key;
const VERSION = CFG.B.save.version;

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

interface WorldSave {
  len: string; h: string; serial: string; fold: string;
  mat: string; flags: string; spec: string; decay: string; k: string; birth: string; prog: string;
  packs: { rows: number; amt: string; prog: string; k: number; a0: number; a1: number; s: number; finds: any[] }[];
  packSerial: number; totalCells: number;
}

/** Only used cells are stored, column by column. k and progress are quantized. */
function packWorld(w: World): WorldSave {
  let n = 0;
  for (let x = 0; x < W; x++) n += w.len[x];
  const mat = new Uint8Array(n), flags = new Uint8Array(n), spec = new Uint8Array(n), decay = new Uint8Array(n);
  const k = new Uint16Array(n), birth = new Float32Array(n), prog = new Uint16Array(n);
  let o = 0;
  for (let x = 0; x < W; x++) {
    for (let i = 0; i < w.len[x]; i++, o++) {
      const j = x * CAP + i;
      mat[o] = w.mat[j]; flags[o] = w.flags[j]; spec[o] = w.spec[j]; decay[o] = w.decay[j];
      k[o] = Math.min(65535, Math.round(w.k[j] * 5000));
      birth[o] = w.birth[j];
      prog[o] = Math.min(65535, Math.round(w.prog[j] / 2));
    }
  }
  const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  return {
    len: b64(u8(w.len)), h: b64(u8(w.h)), serial: b64(u8(w.serial)), fold: b64(u8(w.fold)),
    mat: b64(mat), flags: b64(flags), spec: b64(spec), decay: b64(decay), k: b64(u8(k)), birth: b64(u8(birth)), prog: b64(u8(prog)),
    packs: w.packs.map((p) => ({ rows: p.rows, amt: b64(u8(p.amt)), prog: b64(u8(p.prog)), k: p.k, a0: p.ageMin, a1: p.ageMax, s: p.serial, finds: p.finds })),
    packSerial: w.packSerial, totalCells: w.totalCells,
  };
}

function f32(s: string): Float32Array { const u = unb64(s); return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); }
function u16(s: string): Uint16Array { const u = unb64(s); return new Uint16Array(u.buffer, u.byteOffset, u.byteLength / 2); }
function u32(s: string): Uint32Array { const u = unb64(s); return new Uint32Array(u.buffer, u.byteOffset, u.byteLength / 4); }

function unpackWorld(ws: WorldSave): World {
  const w = new World();
  w.reset();
  w.len.set(u16(ws.len)); w.h.set(f32(ws.h)); w.serial.set(u32(ws.serial)); w.fold.set(f32(ws.fold));
  const mat = unb64(ws.mat), flags = unb64(ws.flags), spec = unb64(ws.spec), decay = unb64(ws.decay), k = u16(ws.k);
  const birth = f32(ws.birth), prog = u16(ws.prog);
  let o = 0;
  for (let x = 0; x < W; x++) {
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

export interface SaveBlob { v: number; state: GameState; world: WorldSave }

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
  // if (blob.v < 2) { ...future migrations... }
  blob.v = VERSION;
  blob.state.version = VERSION;
  return blob;
}

export function serialize(g: Game): string {
  g.state.savedAt = Date.now();
  g.state.seed = g.rng.seed;
  const blob: SaveBlob = { v: VERSION, state: g.state, world: packWorld(g.world) };
  return JSON.stringify(blob);
}

export function deserialize(json: string): { state: GameState; world: World } {
  const blob = migrate(JSON.parse(json) as SaveBlob);
  return { state: blob.state, world: unpackWorld(blob.world) };
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

export function loadLocal(): { state: GameState; world: World } | null {
  try {
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

export function importString(s: string): { state: GameState; world: World } {
  const json = new TextDecoder().decode(unb64(s.trim()));
  return deserialize(json);
}
