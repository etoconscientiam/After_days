import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { lambert } from './ps1';
import type { Textures } from './textures';

/**
 * A welder's gloved hand holding a handle in a hammer grip, and the forearm behind it.
 *
 * Local frame (metres): the handle runs along y through the origin (the tool end below, at −y, by the index
 * finger; the little finger at +y). The forearm leaves the fist along +x, toward the elbow. For the right hand
 * the back of the hand faces +z; the left hand is the mirror image (back toward −z). The hand is modelled
 * as a left one (knuckles at −z) and mirrored for the right.
 *
 * Built from rounded solids so it reads as a hand at the game's pixel size: a padded back of the hand with
 * four knuckles, four fingers of three joints each curled round the handle, a thumb wrapped over them, a
 * flared leather gauntlet with a red band, and a wool sleeve with folds running on out of view.
 */
const Y = new THREE.Vector3(0, 1, 0);

function bone(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const o = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.0005, d.length()), 3, 8), m);
  o.position.addVectors(a, b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(Y, d.normalize());
  return o;
}

/** A solid of revolution about +x from a profile of [radius, x] pairs. */
function alongX(prof: [number, number][], seg: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.LatheGeometry(
    prof.map(([r, x]) => new THREE.Vector2(r, x)),
    seg,
  );
  g.rotateZ(-Math.PI / 2);
  return new THREE.Mesh(g, m);
}

let mats: Record<string, THREE.Material> | null = null;

export function buildArm(tx: Textures, left = false): THREE.Group {
  mats ??= {
    glove: lambert({ map: tx.leather, color: '#f4e6d0' }),
    gloveD: lambert({ map: tx.leather, color: '#c8b49a' }),
    seam: lambert({ color: '#6a4a30' }),
    band: lambert({ color: '#7a2a1a' }),
    wool: lambert({ map: tx.wool, color: '#7a6e66' }),
  };
  const M = mats;
  const g = new THREE.Group();
  const add = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((c) => (c.castShadow = true));
    g.add(o);
    return o;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Back of the hand and palm: one padded block from the knuckles (x ≈ 0) back to the wrist.
  const hand = add(new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.088, 0.046, 3, 0.018), M.glove));
  hand.position.set(0.034, 0.002, -0.004);

  // Fingers: each wraps round the handle from its knuckle on the back (−z) over the front (−x) to the palm
  // side (+z). Joints on a circle round the handle axis, the circle a little wider than the handle.
  const fingers = [
    { y: -0.031, r: 0.0118, R: 0.031 },
    { y: -0.0105, r: 0.0122, R: 0.032 },
    { y: 0.0105, r: 0.0118, R: 0.031 },
    { y: 0.03, r: 0.0105, R: 0.029 },
  ];
  const at = (R: number, deg: number, y: number) => {
    const a = (deg * Math.PI) / 180;
    return V(Math.cos(a) * R, y, Math.sin(a) * R);
  };
  for (const f of fingers) {
    // Angles: −80° knuckle (back), −150° first joint, 165° second joint (front), 110° the tip on the palm side.
    const k = at(f.R, -72, f.y), j1 = at(f.R, -148, f.y), j2 = at(f.R * 0.97, 168, f.y), tip = at(f.R * 0.92, 112, f.y);
    add(bone(k, j1, f.r, M.glove));
    add(bone(j1, j2, f.r * 0.97, M.gloveD));
    add(bone(j2, tip, f.r * 0.92, M.gloveD));
    // The knuckle itself, a bump on the back of the hand.
    const kn = add(new THREE.Mesh(new THREE.SphereGeometry(f.r * 1.12, 8, 6), M.glove));
    kn.position.copy(k);
  }

  // Thumb: from the heel of the hand on the palm side, over the index and middle fingers at the front.
  const t0 = V(0.048, -0.034, 0.022), t1 = V(0.022, -0.03, 0.04), t2 = V(-0.006, -0.022, 0.043), t3 = V(-0.026, -0.014, 0.034);
  const heel = add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), M.glove));
  heel.scale.set(1.3, 1, 1);
  heel.position.set(0.045, -0.03, 0.016);
  add(bone(t0, t1, 0.0145, M.glove));
  add(bone(t1, t2, 0.0135, M.gloveD));
  add(bone(t2, t3, 0.0122, M.gloveD));

  // A stitched seam down the back of the glove, from the wrist to the middle knuckles.
  const st = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.003, 0.002), M.seam));
  st.position.set(0.036, 0.0, -0.0275);

  // Gauntlet: the wrist, then a stiff flared cuff, a red band near its mouth.
  const cuff = add(alongX([[0, 0.058], [0.034, 0.058], [0.036, 0.075], [0.046, 0.12], [0.056, 0.16], [0.053, 0.165], [0, 0.165]], 12, M.glove));
  void cuff;
  const band = add(alongX([[0.0505, 0.138], [0.0545, 0.141], [0.0555, 0.152], [0.052, 0.155]], 12, M.band));
  void band;

  // Sleeve: wool, bunched in a couple of folds where it meets the cuff, then on past the edge of the view.
  add(alongX([[0, 0.15], [0.05, 0.15], [0.061, 0.175], [0.057, 0.2], [0.066, 0.225], [0.062, 0.25], [0.07, 0.35], [0.076, 0.6], [0.08, 0.95], [0, 0.95]], 12, M.wool));

  if (left) return g;
  // The right hand: the same hand mirrored across the palm (three.js flips the winding for a negative scale).
  const m = new THREE.Group();
  m.scale.z = -1;
  m.add(g);
  return m;
}

/**
 * Orientation for a tool held in this hand: the handle along `handle` (unit, from the tool end toward the
 * hand) and the forearm leaving toward `elbow` (any direction not along the handle).
 */
export function gripFrame(handle: THREE.Vector3, elbow: THREE.Vector3, out: THREE.Quaternion): void {
  const x = tmpX.copy(elbow).addScaledVector(handle, -elbow.dot(handle));
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(handle, -handle.x);
  x.normalize();
  const z = tmpZ.crossVectors(x, handle);
  out.setFromRotationMatrix(tmpM.makeBasis(x, handle, z));
}
const tmpX = new THREE.Vector3();
const tmpZ = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
