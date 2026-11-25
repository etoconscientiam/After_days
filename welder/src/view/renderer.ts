import * as THREE from 'three';
import { SKIN } from '../skin/default';

const POST_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * The whole frame goes through here: scene → HDR target at 426×240 → this pass (mask, glare, afterimage,
 * tone mapping, 15-bit colour with ordered dither) → the canvas, which CSS stretches with hard pixels.
 */
const POST_FRAG = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform vec2 uRes;
uniform float uExposure;
uniform float uMaskPos;
uniform float uMaskT;
uniform float uMaskWindow;
uniform vec3 uMaskTint;
uniform vec3 uShell;
uniform float uGlare;
uniform vec2 uArcUv;
uniform float uArcOn;
uniform vec3 uSpots[6];
uniform vec3 uAfterColor;
uniform vec2 uShake;
uniform float uFade;
uniform float uLevels;
uniform float uDither;
uniform float uVignette;
uniform float uGlareMax;
varying vec2 vUv;

float bayer4(vec2 p) {
  vec2 q = mod(p, 4.0);
  int i = int(q.x) + int(q.y) * 4;
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
  m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0;
  return 0.0;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 pix = floor(vUv * uRes);
  vec2 src = clamp(pix + uShake, vec2(0.0), uRes - 1.0);
  vec3 c = texture2D(tScene, (src + 0.5) / uRes).rgb;
  c += texture2D(tBloom, (src + 0.5) / uRes).rgb * uBloom;
  c *= uExposure;

  float aspect = uRes.x / uRes.y;
  vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);

  // Arc halo (scattering in the eye or in the glass).
  vec2 da = (vUv - uArcUv) * vec2(aspect, 1.0);
  float r2 = dot(da, da);
  float halo = uArcOn * (exp(-r2 * 900.0) * 6.0 + exp(-r2 * 60.0) * 0.6);

  // The mask slides down from above; through its window the world is darkened and tinted.
  float yc = mix(1.7, 0.0, uMaskPos);
  float covered = step(abs(q.y - yc), 1.05);
  vec2 w = vec2(0.42 * aspect * uMaskWindow, 0.27 + 0.1 * uMaskWindow);
  vec2 wq = abs(vec2(q.x, q.y - yc)) - w;
  float inWin = step(max(wq.x, wq.y), 0.0);
  vec3 seen = (c + halo * 0.35) * uMaskT * uMaskTint;
  vec3 world = c + halo * (0.6 + 1.2 * uGlare);
  c = mix(world, mix(uShell, seen, inWin), covered);

  // Blinding white when the arc is watched bare-eyed.
  // Bare-eyed arc: the picture blows out toward blue-white but stays readable.
  c = c * (1.0 + uGlare * 1.6) + vec3(0.85, 0.92, 1.0) * uGlare * uGlareMax;

  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));

  // Afterimage: a stain on the retina that stays where the arc was on screen.
  // Afterimages: small stains left on the eye where the arc was, fading on their own.
  for (int i = 0; i < 6; i++) {
    vec3 s = uSpots[i];
    if (s.z <= 0.002) continue;
    float d = length((vUv - s.xy) * vec2(aspect, 1.0));
    float core = s.z * smoothstep(0.04, 0.01, d);
    float rim = s.z * 0.5 * smoothstep(0.05, 0.03, d) * (1.0 - smoothstep(0.03, 0.02, d));
    c = mix(c, uAfterColor * 0.55 + c * 0.15, min(1.0, core * 1.1));
    c += vec3(0.3, 0.42, 0.18) * rim;
  }

  float vig = 1.0 - uVignette * dot(q, q) * 1.2;
  c *= vig;
  c *= 1.0 - uFade;

  float d = (bayer4(pix) - 0.5) * uDither;
  c = floor(c * uLevels + 0.5 + d) / uLevels;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

const BRIGHT_FRAG = `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * max(0.0, l - uThreshold) / max(l, 1e-4), 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += texture2D(tSrc, vUv + uDir * 1.38).rgb * 0.316;
  c += texture2D(tSrc, vUv - uDir * 1.38).rgb * 0.316;
  c += texture2D(tSrc, vUv + uDir * 3.23).rgb * 0.07;
  c += texture2D(tSrc, vUv - uDir * 3.23).rgb * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;

export class LowRes {
  readonly renderer: THREE.WebGLRenderer;
  readonly rt: THREE.WebGLRenderTarget;
  readonly w = SKIN.res.w;
  readonly h = SKIN.res.h;
  readonly post: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Bloom at half resolution: bright pass, then a separable blur, twice. */
  private blurA: THREE.WebGLRenderTarget;
  private blurB: THREE.WebGLRenderTarget;
  private bright: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private passScene = new THREE.Scene();
  private passMesh: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.w, this.h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.info.autoReset = false;
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    const half = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.blurA = new THREE.WebGLRenderTarget(Math.ceil(this.w / 2), Math.ceil(this.h / 2), half);
    this.blurB = new THREE.WebGLRenderTarget(Math.ceil(this.w / 2), Math.ceil(this.h / 2), half);
    this.bright = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: { tSrc: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2(1 / this.w, 1 / this.h) }, uThreshold: { value: SKIN.post.bloomThreshold } },
    });
    this.blur = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    });
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.rt.texture },
        tBloom: { value: this.blurA.texture },
        uBloom: { value: SKIN.post.bloom },
        uRes: { value: new THREE.Vector2(this.w, this.h) },
        uExposure: { value: SKIN.post.exposure },
        uMaskPos: { value: 0 },
        uMaskT: { value: 0.02 },
        uMaskWindow: { value: 0.7 },
        uMaskTint: { value: new THREE.Vector3(...SKIN.mask.tint) },
        uShell: { value: new THREE.Vector3(...SKIN.mask.shell) },
        uGlare: { value: 0 },
        uGlareMax: { value: SKIN.post.glare },
        uArcUv: { value: new THREE.Vector2(0.5, 0.5) },
        uArcOn: { value: 0 },
        uSpots: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
        uAfterColor: { value: new THREE.Vector3(...SKIN.post.afterColor) },
        uShake: { value: new THREE.Vector2(0, 0) },
        uFade: { value: 0 },
        uLevels: { value: Math.pow(2, SKIN.ps1.colorBits) - 1 },
        uDither: { value: SKIN.ps1.dither },
        uVignette: { value: SKIN.post.vignette },
      },
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const m = new THREE.Mesh(tri, this.post);
    m.frustumCulled = false;
    this.postScene.add(m);
    this.passMesh = new THREE.Mesh(tri, this.bright);
    this.passMesh.frustumCulled = false;
    this.passScene.add(this.passMesh);
  }

  get u() {
    return this.post.uniforms;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.info.reset();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    // Bloom.
    const r = this.renderer;
    const bw = this.blurA.width, bh = this.blurA.height;
    this.passMesh.material = this.bright;
    r.setRenderTarget(this.blurA);
    r.render(this.passScene, this.postCam);
    this.passMesh.material = this.blur;
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tSrc.value = this.blurA.texture;
      this.blur.uniforms.uDir.value.set((1 + i) / bw, 0);
      r.setRenderTarget(this.blurB);
      r.render(this.passScene, this.postCam);
      this.blur.uniforms.tSrc.value = this.blurB.texture;
      this.blur.uniforms.uDir.value.set(0, (1 + i) / bh);
      r.setRenderTarget(this.blurA);
      r.render(this.passScene, this.postCam);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
