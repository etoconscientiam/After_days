import * as THREE from 'three';
import type { PartDef, PieceDef, PieceMat } from '../data/types';
import { lambert } from './ps1';
import type { Textures } from './textures';

/**
 * A job on the bench, built from its pieces. Geometry is in metres (part-local millimetres × 0.001), so the
 * view's partRoot (scaled to frame the job) maps sim millimetres straight onto it.
 */
export interface PartMesh {
  group: THREE.Group;
  /** The meshes the cursor can land on. */
  meshes: THREE.Mesh[];
  /** A cloud of surface points (part-local mm) for working out how the turned part rests on the bench. */
  hull: Float32Array;
}

const MM = 0.001;
const D2R = Math.PI / 180;

type Mats = Record<PieceMat, THREE.Material>;
let shared: Mats | null = null;

/**
 * Heat tint on the work round what has been welded: the part's metal itself darkens to blue-grey beside the
 * bead and to straw further out, fading off. Drawn by the material from points along the bead (world space,
 * filled each frame by the view), so it lies on every face, corner and curve exactly.
 */
export const HEAT_TINT = {
  uTintP: { value: Array.from({ length: 160 }, () => new THREE.Vector4()) },
  uTintN: { value: 0 },
  uTintR: { value: 0.01 },
};

function heatTint<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uTintP = HEAT_TINT.uTintP;
    sh.uniforms.uTintN = HEAT_TINT.uTintN;
    sh.uniforms.uTintR = HEAT_TINT.uTintR;
    sh.vertexShader = 'varying vec3 vTW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader =
      'varying vec3 vTW;\nuniform vec4 uTintP[160];\nuniform int uTintN;\nuniform float uTintR;\n' +
      sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    float best = 1e9;
    for (int i = 0; i < 160; i++) {
      if (i >= uTintN) break;
      vec3 d = vTW - uTintP[i].xyz;
      best = min(best, dot(d, d));
    }
    float dd = sqrt(best) / uTintR;
    float a = (1.0 - smoothstep(0.4, 1.0, dd)) * 0.75;
    vec3 tc = mix(vec3(0.03, 0.033, 0.05), vec3(0.13, 0.075, 0.025), smoothstep(0.45, 0.85, dd));
    diffuseColor.rgb = mix(diffuseColor.rgb, tc, a);
  }`,
      );
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (key ? key() : '') + 'tint';
  return m;
}

export function partMaterials(tx: Textures): Mats {
  if (shared) return shared;
  const mk = (map: THREE.Texture | null, color: string) => {
    const m = lambert(map ? { map, color } : { color });
    (m as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    return m;
  };
  shared = {
    // A shade darker than they were, so bright new metal, glowing drops and heat tint stand out on them.
    iron: heatTint(mk(tx.part, '#94928f')),
    dark: heatTint(mk(tx.iron, '#7c7874')),
    steel: heatTint(mk(tx.steel, '#b8b8be')),
    rust: heatTint(mk(tx.plate, '#c4b8ac')),
    wood: mk(tx.wood, '#e0d4c4'),
    copper: heatTint(mk(tx.steel, '#e09868')),
    leather: mk(tx.leather, '#ffffff'),
  };
  return shared;
}

/**
 * Texture coordinates by box projection in millimetres, so every piece gets the same texel size whatever
 * its shape (about one texel per millimetre, like the rest of the room's pixel-art textures).
 */
function boxUV(g: THREE.BufferGeometry, per = 48): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u / per;
    uv[i * 2 + 1] = v / per;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function pieceGeometry(pc: PieceDef): THREE.BufferGeometry {
  const p = pc.p ?? {};
  switch (pc.kind) {
    case 'box':
      return new THREE.BoxGeometry(p.w ?? 10, p.h ?? 10, p.d ?? 10, Math.max(1, Math.ceil((p.w ?? 10) / 40)), 1, Math.max(1, Math.ceil((p.d ?? 10) / 40)));
    case 'cyl':
      return new THREE.CylinderGeometry(p.r2 ?? p.r ?? 10, p.r ?? 10, p.h ?? 10, p.seg ?? 12, 1, false);
    case 'cone':
      return new THREE.ConeGeometry(p.r ?? 10, p.h ?? 10, p.seg ?? 8);
    case 'sphere':
      return new THREE.SphereGeometry(p.r ?? 5, 8, 6);
    case 'torus': {
      const g = new THREE.TorusGeometry(p.R ?? 20, p.r ?? 3, 5, Math.max(8, Math.round((p.arc ?? 360) / 15)), (p.arc ?? 360) * D2R);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case 'lathe': {
      const pts = (pc.pts ?? []).map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
      return new THREE.LatheGeometry(pts, p.seg ?? 20, (p.phi0 ?? 0) * D2R, (p.phiLen ?? 360) * D2R);
    }
    case 'tube': {
      const h = p.h ?? 20, t = p.t ?? 2, rb = p.r ?? 20, rt = p.r2 ?? rb;
      const prof = [
        new THREE.Vector2(rb - t, -h / 2),
        new THREE.Vector2(rb, -h / 2),
        new THREE.Vector2(rt, h / 2),
        new THREE.Vector2(rt - t, h / 2),
        new THREE.Vector2(rb - t, -h / 2),
      ];
      const phi0 = (p.phi0 ?? 0) * D2R, len = (p.phiLen ?? 360) * D2R;
      const lathe = new THREE.LatheGeometry(prof, p.seg ?? 24, phi0, len);
      if (len >= Math.PI * 2 - 1e-3) return lathe;
      // Cut ends: cap them so a split ring shows solid metal at the crack.
      const shape = new THREE.Shape(prof.slice(0, 4).map((v) => new THREE.Vector2(v.x, v.y)));
      const caps = [phi0, phi0 + len].map((phi) => {
        const c = new THREE.ShapeGeometry(shape);
        c.rotateY(phi - Math.PI / 2);
        return c;
      });
      return mergeGeometries([lathe.toNonIndexed(), caps[0].toNonIndexed(), caps[1].toNonIndexed()]);
    }
    case 'plate': {
      const shape = new THREE.Shape((pc.pts ?? []).map(([x, z]) => new THREE.Vector2(x, z)));
      const t = p.t ?? 3;
      const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      g.translate(0, t, 0);
      return g;
    }
  }
  return new THREE.BoxGeometry(10, 10, 10);
}

/** Plain concatenation of non-indexed position-only geometries. */
function mergeGeometries(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of gs) {
    const a = g.attributes.position.array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

export function buildPart(def: PartDef, tx: Textures): PartMesh {
  const mats = partMaterials(tx);
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const hull: number[] = [];
  const v = new THREE.Vector3();
  const e = new THREE.Euler();
  const m4 = new THREE.Matrix4();
  for (const pc of def.pieces) {
    const g = pieceGeometry(pc);
    boxUV(g);
    // Hull points in part-local mm (after the piece's own placement).
    const r = pc.rot ?? [0, 0, 0];
    const pos = pc.pos ?? [0, 0, 0];
    m4.makeRotationFromEuler(e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R)).setPosition(pos[0], pos[1], pos[2]);
    const pa = g.attributes.position as THREE.BufferAttribute;
    const step = Math.max(1, Math.floor(pa.count / 120));
    for (let i = 0; i < pa.count; i += step) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m4);
      hull.push(v.x, v.y, v.z);
    }
    g.scale(MM, MM, MM);
    const mesh = new THREE.Mesh(g, mats[pc.mat ?? 'iron']);
    mesh.position.set(pos[0] * MM, pos[1] * MM, pos[2] * MM);
    mesh.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.pick = 'part';
    group.add(mesh);
    meshes.push(mesh);
  }
  return { group, meshes, hull: new Float32Array(hull) };
}
