import type { PartDef } from './types';
import { line, ring, path, saddle, norm } from './geom';

/**
 * Jobs. Every job is a thing you can name at a glance, put together from pieces that are not yet joined;
 * the seams run along the joints between them. Part-local millimetres: y up, x right, z toward the welder
 * as the part arrives (`rest` turns it first). The view builds `pieces`; the sim needs only the seams,
 * thickness and burn-through heat.
 */

// --- Shapes reused by the seams ------------------------------------------------------------------------

/** Kettle body profile, radius at height y. */
const KETTLE: [number, number][] = [[0, 0], [66, 0], [78, 8], [84, 30], [84, 52], [78, 78], [60, 98], [34, 108], [0, 110]];
function lerpProfile(prof: [number, number][], y: number): number {
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1) && y1 !== y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}
const SPOUT_DIR: [number, number, number] = [Math.cos((40 * Math.PI) / 180), Math.sin((40 * Math.PI) / 180), 0];
const SPOUT_BASE: [number, number, number] = [72, 40, 0];
const SPOUT_LEN = 96;

/** Helmet: an egg-shaped bowl, radius 92 and 122 high. */
const HA = 92, HB = 122, BAND = 22;
const helmetProfile = (): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const b = (i / 10) * (Math.PI / 2);
    out.push([Math.round(HA * Math.cos(b) * 10) / 10, Math.round(HB * Math.sin(b) * 10) / 10]);
  }
  return out;
};
function crest(): ReturnType<typeof path> {
  const pts: [number, number, number][] = [];
  const nrm: [number, number, number][] = [];
  const b0 = Math.asin((BAND + 1) / HB);
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const b = b0 + ((Math.PI - 2 * b0) * i) / n;
    const z = HA * Math.cos(b), y = HB * Math.sin(b);
    pts.push([0, y + 0.8, z]);
    nrm.push(norm([0, y / (HB * HB), z / (HA * HA)]));
  }
  return path('crest', pts, nrm);
}

/** Cauldron: round body standing on legs, a new patch riveted over a hole on its +x side. */
const CR = 112;
const PATCH = { y0: 74, y1: 132, a: 0.34 };
function patchLoop(): ReturnType<typeof path> {
  const pts: [number, number, number][] = [];
  const nrm: [number, number, number][] = [];
  const r = CR + 1.6;
  const P = (phi: number, y: number): [number, number, number] => [r * Math.sin(phi), y, r * Math.cos(phi)];
  const R = (phi: number): [number, number, number] => [Math.sin(phi), 0, Math.cos(phi)];
  const T = (phi: number): [number, number, number] => [Math.cos(phi), 0, -Math.sin(phi)];
  const c = Math.PI / 2, a0 = c - PATCH.a, a1 = c + PATCH.a;
  const push = (p: [number, number, number], n: [number, number, number]) => {
    pts.push(p);
    nrm.push(norm(n));
  };
  const N = 8;
  // Bottom edge, left to right (as seen from outside: phi grows toward -z).
  for (let i = 0; i <= N; i++) {
    const phi = a0 + ((a1 - a0) * i) / N;
    const rr = R(phi);
    push(P(phi, PATCH.y0 - 1), [rr[0], -0.9, rr[2]]);
  }
  for (let i = 1; i <= 3; i++) {
    const y = PATCH.y0 + ((PATCH.y1 - PATCH.y0) * i) / 4;
    const rr = R(a1), tt = T(a1);
    push(P(a1 + 0.012, y), [rr[0] + tt[0], 0, rr[2] + tt[2]]);
  }
  for (let i = 0; i <= N; i++) {
    const phi = a1 - ((a1 - a0) * i) / N;
    const rr = R(phi);
    push(P(phi, PATCH.y1 + 1), [rr[0], 0.9, rr[2]]);
  }
  for (let i = 1; i <= 3; i++) {
    const y = PATCH.y1 - ((PATCH.y1 - PATCH.y0) * i) / 4;
    const rr = R(a0), tt = T(a0);
    push(P(a0 - 0.012, y), [rr[0] - tt[0], 0, rr[2] - tt[2]]);
  }
  pts.push(pts[0]);
  nrm.push(nrm[0]);
  return path('patch', pts, nrm, true);
}

/** Portcullis section: four bars under two cross bars; the crossings are welded. */
const GATE_X = [-150, -50, 50, 150];
const GB = 20;

/** Relic mount: a made thing from before stands on an iron foot, held by four bars under a band. */
const RELIC_A = [45, 135, 225, 315];
const relicJoint = (id: string, a: number, r: number, y: number, up: number) => {
  const k = (a * Math.PI) / 180;
  const d: [number, number, number] = [Math.sin(k), 0, Math.cos(k)];
  const t: [number, number, number] = [Math.cos(k), 0, -Math.sin(k)];
  const P: [number, number, number] = [d[0] * r, y, d[2] * r];
  return line(id, [P[0] - t[0] * 6, y, P[2] - t[2] * 6], [P[0] + t[0] * 6, y, P[2] + t[2] * 6], [d[0], up, d[2]]);
};

const list: PartDef[] = [
  {
    // A spade for the diggers: the blade broke off its neck.
    id: 'spade',
    pieces: [
      { kind: 'plate', pts: [[1, -70], [110, -67], [150, -48], [172, -16], [178, 0], [172, 16], [150, 48], [110, 67], [1, 70]], p: { t: 3 }, mat: 'iron' },
      { kind: 'plate', pts: [[-50, -18], [-1.5, -31], [-1.5, 31], [-50, 18]], p: { t: 5 }, mat: 'rust' },
      { kind: 'cyl', p: { r: 15, r2: 18, h: 100, seg: 10 }, pos: [-100, 14, 0], rot: [0, 0, 90], mat: 'rust' },
      { kind: 'cyl', p: { r: 13.5, h: 100, seg: 8 }, pos: [-195, 14, 0], rot: [0, 0, 90], mat: 'wood' },
    ],
    seams: [line('neck', [0, 4.2, -28], [0, 4.2, 28], [-0.15, 1, 0])],
    thick: 0.9,
    burn: 2.6,
    simple: true,
    frame: 280,
  },
  {
    // A frying pan whose handle came off: welded on top, then turned over and welded underneath.
    id: 'pan',
    pieces: [
      {
        kind: 'lathe',
        pts: [[0, 0], [86, 0], [94, 2], [101, 30], [104, 34], [101, 35], [97, 31], [90, 4], [82, 3], [0, 3]],
        p: { seg: 28 },
        mat: 'dark',
      },
      { kind: 'box', p: { w: 150, h: 7, d: 28 }, pos: [100 + 75 * Math.cos(0.21), 26 + 75 * Math.sin(0.21), 0], rot: [0, 0, 12], mat: 'iron' },
      { kind: 'torus', p: { R: 11, r: 3 }, pos: [262, 60, 0], rot: [0, 0, 12], mat: 'iron' },
    ],
    seams: [
      line('top', [100.6, 30, -13], [100.6, 30, 13], [0.68, 0.73, 0]),
      line('under', [100.4, 22.3, 13], [100.4, 22.3, -13], [0.73, -0.68, 0], 'roll'),
    ],
    thick: 0.85,
    burn: 2.5,
    simple: true,
    frame: 300,
  },
  {
    // A barrow wheel: the iron tyre has split in two places, on either side.
    id: 'wheel',
    pieces: [
      { kind: 'cyl', p: { r: 26, h: 60, seg: 10 }, mat: 'wood' },
      { kind: 'cyl', p: { r: 9, h: 64, seg: 8 }, mat: 'dark' },
      ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({
        kind: 'box' as const,
        p: { w: 84, h: 14, d: 16 },
        pos: [Math.cos((a * Math.PI) / 180) * 68, 0, -Math.sin((a * Math.PI) / 180) * 68] as [number, number, number],
        rot: [0, a, 0] as [number, number, number],
        mat: 'wood' as const,
      })),
      { kind: 'tube', p: { r: 122, h: 40, t: 13, seg: 32 }, mat: 'wood' },
      { kind: 'tube', p: { r: 130, h: 44, t: 7, seg: 32, phi0: 90.7, phiLen: 178.6 }, mat: 'rust' },
      { kind: 'tube', p: { r: 130, h: 44, t: 7, seg: 32, phi0: 270.7, phiLen: 178.6 }, mat: 'iron' },
    ],
    seams: [line('crackR', [130.5, -21, 0], [130.5, 21, 0], [1, 0, 0]), line('crackL', [-130.5, 21, 0], [-130.5, -21, 0], [-1, 0, 0])],
    thick: 1.15,
    burn: 2.6,
    simple: true,
    frame: 320,
  },
  {
    // A copper kettle with its spout knocked off: the joint runs round the spout, under it too.
    id: 'kettle',
    pieces: [
      { kind: 'lathe', pts: KETTLE, p: { seg: 24 }, mat: 'copper' },
      { kind: 'torus', p: { R: 32, r: 3 }, pos: [0, 104, 0], mat: 'copper' },
      { kind: 'sphere', p: { r: 9 }, pos: [0, 116, 0], mat: 'dark' },
      { kind: 'torus', p: { R: 62, r: 4.5, arc: 180 }, pos: [0, 92, 0], rot: [90, 0, 0], mat: 'dark' },
      {
        kind: 'tube',
        p: { r: 15, r2: 7, h: SPOUT_LEN, t: 2.5, seg: 12 },
        pos: [SPOUT_BASE[0] + SPOUT_DIR[0] * (SPOUT_LEN / 2), SPOUT_BASE[1] + SPOUT_DIR[1] * (SPOUT_LEN / 2), 0],
        rot: [0, 0, -50],
        mat: 'copper',
      },
    ],
    seams: [saddle('spout', SPOUT_BASE, SPOUT_DIR, (t) => 15 - (8 * t) / SPOUT_LEN, (y) => lerpProfile(KETTLE, y))],
    thick: 0.8,
    burn: 2.45,
    simple: true,
    frame: 260,
  },
  {
    // A guard's spear: blade and socket parted at the neck. The ring has to be turned round as you go.
    id: 'spear',
    pieces: [
      { kind: 'cyl', p: { r: 12.5, h: 110, seg: 8 }, pos: [-160, 0, 0], rot: [0, 0, 90], mat: 'wood' },
      { kind: 'cyl', p: { r: 15, r2: 18.5, h: 112, seg: 12 }, pos: [-57, 0, 0], rot: [0, 0, 90], mat: 'rust' },
      { kind: 'torus', p: { R: 18.5, r: 2.5 }, pos: [-104, 0, 0], rot: [0, 0, 90], mat: 'dark' },
      { kind: 'cyl', p: { r: 11.5, h: 16, seg: 12 }, pos: [8.5, 0, 0], rot: [0, 0, 90], mat: 'steel' },
      { kind: 'plate', pts: [[14, -7], [40, -22], [92, -25], [150, -13], [196, 0], [150, 13], [92, 25], [40, 22], [14, 7]], p: { t: 5 }, pos: [0, -2.5, 0], mat: 'steel' },
      { kind: 'box', p: { w: 160, h: 8, d: 7 }, pos: [100, 0, 0], mat: 'steel' },
    ],
    seams: [ring('neck', [1.2, 0, 0], [1, 0, 0], 12.6, Math.PI / 4, 28, 'roll')],
    thick: 1.1,
    burn: 2.55,
    simple: true,
    frame: 300,
  },
  {
    // A pail with a new bottom: one long ring round the foot; spin it as you weld.
    id: 'bucket',
    pieces: [
      { kind: 'tube', p: { r: 58, r2: 72, h: 140, t: 2, seg: 28 }, pos: [0, 0, 0], mat: 'iron' },
      { kind: 'torus', p: { R: 73, r: 3.2 }, pos: [0, 70, 0], mat: 'iron' },
      { kind: 'torus', p: { R: 66, r: 1.6 }, pos: [0, 20, 0], mat: 'iron' },
      { kind: 'cyl', p: { r: 61, h: 3, seg: 28 }, pos: [0, -71.5, 0], mat: 'steel' },
      { kind: 'torus', p: { R: 76, r: 2.4, arc: 180 }, pos: [0, 60, 0], rot: [90, 0, 0], mat: 'dark' },
      { kind: 'box', p: { w: 6, h: 22, d: 14 }, pos: [74, 58, 0], mat: 'dark' },
      { kind: 'box', p: { w: 6, h: 22, d: 14 }, pos: [-74, 58, 0], mat: 'dark' },
    ],
    seams: [ring('bottom', [0, -69.4, 0], [0, 1, 0], 59, Math.PI / 4, 40)],
    thick: 0.8,
    burn: 2.45,
    simple: false,
    frame: 230,
  },
  {
    // A guard's helmet split in two halves along the crest, and its nose guard.
    id: 'helmet',
    pieces: [
      { kind: 'lathe', pts: helmetProfile(), p: { seg: 12, phi0: 0.6, phiLen: 178.8 }, mat: 'iron' },
      { kind: 'lathe', pts: helmetProfile(), p: { seg: 12, phi0: 180.6, phiLen: 178.8 }, mat: 'rust' },
      { kind: 'tube', p: { r: HA + 3, h: BAND, t: 3, seg: 28 }, pos: [0, BAND / 2, 0], mat: 'dark' },
      { kind: 'box', p: { w: 16, h: 62, d: 4 }, pos: [0, -10, HA + 4.6], mat: 'dark' },
      ...[-60, -30, 30, 60, 150, 180, 210].map((a) => ({
        kind: 'sphere' as const,
        p: { r: 2.6 },
        pos: [Math.sin((a * Math.PI) / 180) * (HA + 4.5), BAND / 2, Math.cos((a * Math.PI) / 180) * (HA + 4.5)] as [number, number, number],
        mat: 'iron' as const,
      })),
    ],
    seams: [crest(), line('nose', [-7.5, BAND - 0.4, HA + 4.4], [7.5, BAND - 0.4, HA + 4.4], [0, 0.7, 0.7])],
    thick: 0.95,
    burn: 2.5,
    simple: false,
    frame: 270,
  },
  {
    // A three-legged cauldron with a patch over a hole in its side.
    id: 'cauldron',
    pieces: [
      { kind: 'lathe', pts: [[0, 0], [48, 3], [84, 18], [106, 44], [CR, 72], [CR, 150]], p: { seg: 28 }, mat: 'dark' },
      { kind: 'torus', p: { R: CR + 2, r: 5 }, pos: [0, 151, 0], mat: 'dark' },
      { kind: 'tube', p: { r: CR + 3.2, h: PATCH.y1 - PATCH.y0, t: 3, seg: 6, phi0: 90 - (PATCH.a * 180) / Math.PI, phiLen: (2 * PATCH.a * 180) / Math.PI }, pos: [0, (PATCH.y0 + PATCH.y1) / 2, 0], mat: 'steel' },
      ...[30, 150, 270].map((a) => ({
        kind: 'cone' as const,
        p: { r: 9, h: 40 },
        pos: [Math.sin((a * Math.PI) / 180) * 56, -12, Math.cos((a * Math.PI) / 180) * 56] as [number, number, number],
        rot: [180, 0, 0] as [number, number, number],
        mat: 'dark' as const,
      })),
      { kind: 'torus', p: { R: CR + 4, r: 2.6, arc: 180 }, pos: [0, 146, 0], rot: [22, 0, 0], mat: 'iron' },
    ],
    seams: [patchLoop()],
    rest: [0, 0, 0],
    thick: 1.0,
    burn: 2.5,
    simple: false,
    frame: 290,
  },
  {
    // The night order: a section of the city gate's portcullis. Eight crossings; half of them on the far side.
    id: 'grate',
    pieces: [
      ...GATE_X.map((x) => ({ kind: 'box' as const, p: { w: GB, h: GB, d: 330 }, pos: [x, GB / 2, 0] as [number, number, number], mat: 'dark' as const })),
      ...[-80, 80].map((z) => ({ kind: 'box' as const, p: { w: 420, h: GB, d: GB }, pos: [0, GB * 1.5, z] as [number, number, number], mat: 'rust' as const })),
      ...GATE_X.map((x) => ({ kind: 'cone' as const, p: { r: 12, h: 46, seg: 4 }, pos: [x, GB / 2, 188] as [number, number, number], rot: [90, 45, 0] as [number, number, number], mat: 'dark' as const })),
    ],
    seams: [
      ...GATE_X.map((x, i) => line('front' + i, [x - GB / 2 + 1, GB + 0.8, 80 + GB / 2 + 0.8], [x + GB / 2 - 1, GB + 0.8, 80 + GB / 2 + 0.8], [0, 1, 1])),
      ...GATE_X.map((x, i) => line('back' + i, [x + GB / 2 - 1, GB + 0.8, -80 - GB / 2 - 0.8], [x - GB / 2 + 1, GB + 0.8, -80 - GB / 2 - 0.8], [0, 1, -1])),
    ],
    thick: 1.3,
    burn: 2.6,
    simple: false,
    frame: 430,
  },
  {
    // A made thing from before that the river gave up, to be mounted: four bars welded to the foot below and
    // to the band above. It is thin work round something that must not be burnt.
    id: 'relic',
    pieces: [
      { kind: 'cyl', p: { r: 74, h: 10, seg: 20 }, pos: [0, 5, 0], mat: 'dark' },
      { kind: 'lathe', pts: [[0, 14], [26, 18], [40, 38], [45, 62], [40, 86], [24, 104], [0, 110]], p: { seg: 20 }, mat: 'relic' },
      { kind: 'torus', p: { R: 45.5, r: 2 }, pos: [0, 62, 0], mat: 'relic' },
      ...RELIC_A.map((a) => ({
        kind: 'box' as const,
        p: { w: 14, h: 108, d: 14 },
        pos: [Math.sin((a * Math.PI) / 180) * 60, 64, Math.cos((a * Math.PI) / 180) * 60] as [number, number, number],
        rot: [0, a, 0] as [number, number, number],
        mat: 'iron' as const,
      })),
      { kind: 'torus', p: { R: 60, r: 6 }, pos: [0, 124, 0], mat: 'rust' },
    ],
    seams: [...RELIC_A.map((a, i) => relicJoint('foot' + i, a, 67.8, 10.8, 1)), ...RELIC_A.map((a, i) => relicJoint('band' + i, a, 67.6, 118.6, 0.25))],
    thick: 0.9,
    burn: 2.4,
    simple: false,
    frame: 300,
  },
];

export const PARTS: Record<string, PartDef> = Object.fromEntries(list.map((p) => [p.id, p]));
