import * as THREE from 'three';
import { SKIN } from '../skin/default';

/** Shared uniforms of the PS1 look. */
export const PS1 = {
  snapRes: { value: new THREE.Vector2(SKIN.res.w * SKIN.ps1.snap * 0.5, SKIN.res.h * SKIN.ps1.snap * 0.5) },
};

/**
 * Patch a built-in material: vertices snap to a coarse screen grid (wobbly edges) and textures are mapped
 * affinely (no perspective correction), like on the original hardware.
 */
export function ps1<T extends THREE.Material>(mat: T, opts: { snap?: boolean; affine?: boolean } = {}): T {
  const snap = opts.snap ?? SKIN.ps1.snap > 0;
  const affine = (opts.affine ?? SKIN.ps1.affine) && !!(mat as unknown as { map?: unknown }).map;
  if (!snap && !affine) return mat;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uSnapRes = PS1.snapRes;
    let v = 'uniform vec2 uSnapRes;\n' + (affine ? 'varying vec3 vAffine;\n' : '') + sh.vertexShader;
    let tail = '';
    if (snap)
      tail += `
      { vec2 ndc = gl_Position.xy / gl_Position.w;
        ndc = floor(ndc * uSnapRes + 0.5) / uSnapRes;
        gl_Position.xy = ndc * gl_Position.w; }`;
    if (affine) tail += `\n vAffine = vec3(vMapUv * gl_Position.w, gl_Position.w);`;
    v = v.replace('#include <project_vertex>', '#include <project_vertex>' + tail);
    sh.vertexShader = v;
    if (affine) {
      sh.fragmentShader =
        'varying vec3 vAffine;\n' +
        sh.fragmentShader.replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            diffuseColor *= texture2D( map, vAffine.xy / vAffine.z );
          #endif`,
        );
    }
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + `ps1${snap ? 1 : 0}${affine ? 1 : 0}`;
  return mat;
}

/** Lambert material with the PS1 treatment. */
export function lambert(params: THREE.MeshLambertMaterialParameters, opts?: { snap?: boolean; affine?: boolean }) {
  return ps1(new THREE.MeshLambertMaterial(params), opts);
}
