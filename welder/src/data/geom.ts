import type { SeamDef } from './types';

/** Helpers that lay seams out in 3D for the part records. Pure maths, used at load time only. */
type P3 = [number, number, number];

const r1 = (v: number) => Math.round(v * 100) / 100;
const pt = (v: P3): P3 => [r1(v[0]), r1(v[1]), r1(v[2])];

export function norm(v: P3): P3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const add = (a: P3, b: P3, k = 1): P3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Two unit vectors across `axis`. */
function basis(axis: P3): [P3, P3] {
  const a = norm(axis);
  const ref: P3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u = norm(cross(ref, a));
  const v = cross(a, u);
  return [u, v];
}

/** A straight joint from a to b, welded from direction n. */
export function line(id: string, a: P3, b: P3, n: P3, turn?: 'spin' | 'roll'): SeamDef {
  const nn = norm(n);
  return { id, pts: [pt(a), pt(b)], nrm: [nn, nn], turn };
}

/**
 * A ring around `axis` through `c`, radius r. The weld faces out from the axis, tilted toward the axis
 * direction by `tilt` radians (a fillet between a pipe and the face it stands on is tilted by 45°).
 */
export function ring(id: string, c: P3, axis: P3, r: number, tilt: number, n = 32, turn?: 'spin' | 'roll'): SeamDef {
  const [u, v] = basis(axis);
  const ax = norm(axis);
  const pts: P3[] = [];
  const nrm: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad: P3 = add([u[0] * Math.cos(a), u[1] * Math.cos(a), u[2] * Math.cos(a)], v, Math.sin(a));
    pts.push(pt(add(c, rad, r)));
    nrm.push(norm(add([rad[0] * Math.cos(tilt), rad[1] * Math.cos(tilt), rad[2] * Math.cos(tilt)], ax, Math.sin(tilt))));
  }
  return { id, pts, nrm, closed: true, turn };
}

/** Any path: points and the welding direction at each. */
export function path(id: string, pts: P3[], nrm: P3[], closed = false): SeamDef {
  return { id, pts: pts.map(pt), nrm: nrm.map(norm), closed };
}

/**
 * Where a tapered pipe (spout) meets a round body standing on the y axis: for each angle around the pipe,
 * walk up its axis until the surface leaves the body. `rBody(y)` is the body's radius at height y.
 */
export function saddle(
  id: string,
  base: P3,
  dir: P3,
  rPipe: (t: number) => number,
  rBody: (y: number) => number,
  n = 28,
): SeamDef {
  const d = norm(dir);
  const [u, v] = basis(d);
  const pts: P3[] = [];
  const nrm: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad: P3 = add([u[0] * Math.cos(a), u[1] * Math.cos(a), u[2] * Math.cos(a)], v, Math.sin(a));
    const at = (t: number) => add(add(base, d, t), rad, rPipe(t));
    const outside = (t: number) => {
      const p = at(t);
      return Math.hypot(p[0], p[2]) > rBody(p[1]);
    };
    let lo = -40, hi = 60;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (outside(m)) hi = m;
      else lo = m;
    }
    const p = at(hi + 0.6);
    pts.push(pt(p));
    const body = norm([p[0], 0, p[2]]);
    nrm.push(norm(add(rad, body)));
  }
  return { id, pts, nrm, closed: true };
}
