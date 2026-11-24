import * as THREE from 'three';

export type CamMode = 'room' | 'work' | 'inspect' | 'end';

/**
 * Camera rig with a few poses and a smooth, critically damped glide between them. In the room, the mouse
 * nudges the view a little; at the bench, the camera holds still so the hand can be precise.
 */
export class CameraRig {
  readonly cam: THREE.PerspectiveCamera;
  mode: CamMode = 'room';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tPos = new THREE.Vector3();
  private tLook = new THREE.Vector3();
  private vPos = new THREE.Vector3();
  private vLook = new THREE.Vector3();
  private fov = 55;
  private tFov = 55;
  /** Room pose, set once from the layout. */
  readonly roomPos = new THREE.Vector3(0.1, 1.72, 1.55);
  readonly roomLook = new THREE.Vector3(0.05, 0.98, -0.9);
  private nudge = new THREE.Vector2();
  private tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(55, aspect, 0.02, 80);
    this.pos.copy(this.roomPos);
    this.look.copy(this.roomLook);
    this.tPos.copy(this.roomPos);
    this.tLook.copy(this.roomLook);
  }

  room(): void {
    this.mode = 'room';
    this.tPos.copy(this.roomPos);
    this.tLook.copy(this.roomLook);
    this.tFov = 55;
  }

  /** Look down at the bench so that `frameMM` of the part fits across the screen. */
  work(center: THREE.Vector3, frameMM: number): void {
    this.mode = 'work';
    const fov = 38;
    const w = (frameMM * 1.25) / 1000;
    const dist = w / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * this.cam.aspect) + 0.02;
    const pitch = THREE.MathUtils.degToRad(58);
    this.tLook.copy(center);
    this.tPos.set(center.x, center.y + Math.sin(pitch) * dist, center.z + Math.cos(pitch) * dist);
    this.tFov = fov;
  }

  /** Close look at a point of the bead. */
  inspect(at: THREE.Vector3, frameMM: number): void {
    this.mode = 'inspect';
    this.work(at, frameMM);
    this.mode = 'inspect';
  }

  end(center: THREE.Vector3, frameMM: number): void {
    this.work(center, frameMM);
    this.mode = 'end';
  }

  setNudge(x: number, y: number): void {
    this.nudge.set(x, y);
  }

  /** Has the glide (nearly) settled? */
  settled(): boolean {
    return this.pos.distanceToSquared(this.tPos) < 1e-6 && Math.abs(this.fov - this.tFov) < 0.05;
  }

  update(dt: number): void {
    const k = 9; // spring stiffness → ~0.45 s glides
    const spring = (p: THREE.Vector3, v: THREE.Vector3, t: THREE.Vector3) => {
      this.tmp.copy(t).sub(p).multiplyScalar(k * k * dt);
      v.add(this.tmp);
      v.multiplyScalar(Math.max(0, 1 - 2 * k * dt));
      p.addScaledVector(v, dt);
    };
    spring(this.pos, this.vPos, this.tPos);
    spring(this.look, this.vLook, this.tLook);
    this.fov += (this.tFov - this.fov) * Math.min(1, dt * 7);
    this.cam.position.copy(this.pos);
    if (this.mode === 'room') {
      this.cam.position.x += this.nudge.x * 0.06;
      this.cam.position.y += this.nudge.y * 0.03;
    }
    this.cam.lookAt(this.look);
    if (this.cam.fov !== this.fov) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
