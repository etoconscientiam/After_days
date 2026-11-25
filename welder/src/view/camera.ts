import * as THREE from 'three';

export type CamMode = 'station' | 'inspect' | 'end';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * One station view, as at a sink in Dish Pit: you stand at the bench and everything is in front of you.
 * The head turns a little when the mouse presses against the far left or right edge, and the eye leans in
 * for a moment to look at a finished bead.
 */
export class CameraRig {
  readonly cam: THREE.PerspectiveCamera;
  mode: CamMode = 'station';
  readonly eye = new THREE.Vector3(0, 1.5, 0);
  readonly ahead = new THREE.Vector3(0, 1.5 - Math.tan(THREE.MathUtils.degToRad(37)), -1);
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tPos = new THREE.Vector3();
  private tLook = new THREE.Vector3();
  private fov = 58;
  private tFov = 58;
  private yaw = 0;
  private yawT = 0;
  /** Head turn is allowed (not while the hand is busy welding). */
  turnable = true;
  private tmp = new THREE.Vector3();

  /** A soft warm light carried with the eye, so the hands always read. */
  readonly fill = new THREE.PointLight('#ffd8b0', 0.25, 0.9, 2);

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(58, aspect, 0.015, 90);
    this.pos.copy(this.eye);
    this.look.copy(this.ahead);
    this.tPos.copy(this.eye);
    this.tLook.copy(this.ahead);
    this.fill.position.set(0, 0.05, 0.05);
    this.cam.add(this.fill);
  }

  station(): void {
    this.mode = 'station';
    this.tPos.copy(this.eye);
    this.tLook.copy(this.ahead);
    this.tFov = 58;
  }

  /** Lean in toward a point on the bench. */
  inspect(at: THREE.Vector3, fov = 24): void {
    this.mode = 'inspect';
    this.tPos.copy(this.eye).lerp(at, 0.35);
    this.tLook.copy(at);
    this.tFov = fov;
  }

  end(at: THREE.Vector3): void {
    this.inspect(at, 40);
    this.mode = 'end';
  }

  /** Mouse position in -1..1; only the outer edges turn the head. */
  setNudge(x: number): void {
    const ax = Math.abs(x);
    this.yawT = this.mode === 'station' && this.turnable ? -Math.sign(x) * Math.max(0, ax - 0.94) / 0.06 * 0.5 : 0;
  }

  settled(): boolean {
    return this.pos.distanceToSquared(this.tPos) < 1e-7 && Math.abs(this.fov - this.tFov) < 0.05 && Math.abs(this.yaw - this.yawT) < 0.002;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 7);
    this.pos.lerp(this.tPos, k);
    this.look.lerp(this.tLook, k);
    this.fov += (this.tFov - this.fov) * k;
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * 4));
    this.cam.position.copy(this.pos);
    const d = this.tmp.copy(this.look).sub(this.pos).applyAxisAngle(Y_AXIS, this.yaw);
    this.cam.lookAt(d.add(this.pos));
    if (Math.abs(this.cam.fov - this.fov) > 1e-3) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
