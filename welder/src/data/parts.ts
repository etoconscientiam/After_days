import type { PartDef } from './types';

/**
 * Parts. Seam points are in part-local millimetres on the top surface: x to the right, z toward the welder.
 * `shape` + `params` only matter to the view; the sim needs seams, thickness and burn-through heat.
 */
const list: PartDef[] = [
  {
    id: 'boiler',
    shape: 'curvedPlate',
    params: { w: 230, d: 160, r: 320, t: 3 },
    seams: [{ id: 'crack', pts: [[-50, -16], [-28, -5], [-10, -12], [10, 4], [30, -1], [50, 12]] }],
    thick: 0.85,
    burn: 2.9,
    simple: true,
    frame: 190,
  },
  {
    id: 'bars',
    shape: 'bars',
    params: { len: 230, size: 16 },
    seams: [{ id: 'fillet', pts: [[-64, 0], [64, 0]] }],
    thick: 1,
    burn: 2.5,
    simple: true,
    frame: 200,
  },
  {
    id: 'rim',
    shape: 'rim',
    params: { R: 330, width: 42, arc: 0.62, t: 9 },
    // Crack follows the rim's centre line (radius 330, centre at z = +330 so the arc bows away).
    seams: [{ id: 'crack', pts: arcPts(0, 330, 330, -0.22, 0.22, 10) }],
    thick: 1.1,
    burn: 2.55,
    simple: true,
    frame: 220,
  },
  {
    id: 'axle',
    shape: 'axle',
    params: { len: 330, r: 22 },
    seams: [{ id: 'split', pts: [[-66, 2], [-30, -1], [0, 2], [34, -1], [66, 1]] }],
    thick: 1.35,
    burn: 2.6,
    simple: false,
    frame: 230,
  },
  {
    id: 'damper',
    shape: 'damper',
    params: { w: 190, d: 160, t: 4 },
    seams: [{ id: 'strap', pts: [[-58, -46], [48, -46], [48, 44]] }],
    thick: 0.95,
    burn: 2.5,
    simple: false,
    frame: 210,
  },
  {
    id: 'cauldron',
    shape: 'curvedPlate',
    params: { w: 260, d: 180, r: 240, t: 3, dark: 1 },
    seams: [{ id: 'crack', pts: [[-66, 10], [-40, -6], [-14, 4], [12, -10], [38, 0], [64, -12]] }],
    thick: 0.85,
    burn: 2.5,
    simple: true,
    frame: 220,
  },
  {
    id: 'stove',
    shape: 'plates',
    params: { w: 250, d: 170, t: 4 },
    seams: [{ id: 'butt', pts: [[-76, 0], [76, 0]] }],
    thick: 1,
    burn: 2.5,
    simple: true,
    frame: 220,
  },
  {
    id: 'patch',
    shape: 'patch',
    params: { w: 200, d: 170, r: 280, pw: 72, pd: 60 },
    seams: [{ id: 'round', pts: [[-36, -30], [36, -30], [36, 30], [-36, 30], [-36, -28]] }],
    thick: 0.75,
    burn: 2.4,
    simple: false,
    frame: 180,
  },
  {
    id: 'spear',
    shape: 'spear',
    params: { len: 210, r: 13 },
    seams: [
      { id: 'socket', pts: [[-20, -14], [-20, 14]] },
      { id: 'blade', pts: [[18, -12], [18, 12]] },
    ],
    thick: 1.15,
    burn: 2.55,
    simple: true,
    frame: 160,
  },
  {
    id: 'grate',
    shape: 'grate',
    params: { w: 440, d: 300, bar: 18 },
    seams: [
      { id: 'joint_a', pts: [[-120, -110], [-92, -110]] },
      { id: 'joint_b', pts: [[92, 110], [120, 110]] },
      { id: 'main', pts: [[-170, 6], [-110, 2], [-50, 8], [10, 3], [70, 9], [130, 2], [170, 6]] },
    ],
    thick: 1.3,
    burn: 2.6,
    simple: false,
    frame: 430,
  },
];

function arcPts(cx: number, cz: number, r: number, a0: number, a1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([Math.round((cx + Math.sin(a) * r) * 10) / 10, Math.round((cz - Math.cos(a) * r) * 10) / 10]);
  }
  return out;
}

export const PARTS: Record<string, PartDef> = Object.fromEntries(list.map((p) => [p.id, p]));
