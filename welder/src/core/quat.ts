/** Tiny quaternion and vector helpers for the sim (no three.js there). Quaternions are [x, y, z, w]. */
export type V3 = [number, number, number];
export type Q = [number, number, number, number];

export const qIdent = (): Q => [0, 0, 0, 1];

export function qMul(a: Q, b: Q, out: Q = [0, 0, 0, 1]): Q {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function qNorm(q: Q): Q {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l;
  q[1] /= l;
  q[2] /= l;
  q[3] /= l;
  return q;
}

export function qAxis(ax: number, ay: number, az: number, angle: number): Q {
  const l = Math.hypot(ax, ay, az) || 1;
  const s = Math.sin(angle / 2) / l;
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

/** Euler angles (radians) applied in X, then Y, then Z order (same as three.js 'XYZ'). */
export function qEuler(x: number, y: number, z: number): Q {
  return qMul(qMul(qAxis(1, 0, 0, x), qAxis(0, 1, 0, y)), qAxis(0, 0, 1, z));
}

/** Rotate vector v by q. */
export function qRot(q: Q, x: number, y: number, z: number, out: V3 = [0, 0, 0]): V3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** Shortest rotation taking unit vector a onto unit vector b. */
export function qFromTo(a: V3, b: V3): Q {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.9999) {
    // Opposite: turn half a circle around any axis across a.
    const ax = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    return qAxis(ax[0], ax[1], ax[2], Math.PI);
  }
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  return qNorm([cx, cy, cz, 1 + d]);
}

export function qDot(a: Q, b: Q): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Turn a toward b by at most `maxAngle` radians (in place). Returns true once it has arrived. */
export function qTurnToward(a: Q, b: Q, maxAngle: number): boolean {
  let d = qDot(a, b);
  const sgn = d < 0 ? -1 : 1;
  d = Math.min(1, Math.abs(d));
  const angle = 2 * Math.acos(d);
  if (angle <= maxAngle || angle < 1e-4) {
    for (let i = 0; i < 4; i++) a[i] = b[i] * sgn;
    return true;
  }
  const t = maxAngle / angle;
  // Slerp.
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = (Math.sin(t * th) / s) * sgn;
  for (let i = 0; i < 4; i++) a[i] = a[i] * wa + b[i] * wb;
  qNorm(a);
  return false;
}

export function vNorm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
  return v;
}
