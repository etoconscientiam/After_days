import * as THREE from 'three';

export type CamMode = 'station' | 'walk' | 'inspect' | 'end';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Two ways of being in the workshop. At the bench (station) the eye is fixed and the mouse is a free cursor,
 * as at the sink in Dish Pit; the head turns a little at the far screen edges and leans in to look at a bead.
 * Away from it (walk) you move on WASD and look with the mouse, first person.
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
  /** Walking: where the body stands and where the head points. */
  readonly body = new THREE.Vector3(0, 0, 0.45);
  walkYaw = 0;
  walkPitch = -0.3;
  /** Seconds left of the glide between the bench and walking. */
  private blend = 0;
  /** Head turn is allowed (not while the hand is busy welding). */
  turnable = true;
  private tmp = new THREE.Vector3();
  private bob = 0;
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

  /** Step up to the bench. */
  station(): void {
    if (this.mode === 'walk') this.blend = 0.45;
    this.mode = 'station';
    this.tPos.copy(this.eye);
    this.tLook.copy(this.ahead);
    this.tFov = 58;
  }

  /** Step back from the bench and walk. */
  walk(): void {
    this.mode = 'walk';
    this.body.set(this.eye.x, 0, this.eye.z + 0.4);
    this.walkYaw = 0;
    this.walkPitch = -0.32;
    this.blend = 0.45;
    this.tFov = 66;
  }

  inspect(at: THREE.Vector3, fov = 24): void {
    this.mode = 'inspect';
    this.tPos.copy(this.eye).lerp(at, 0.35);
    this.tLook.copy(at);
    this.tFov = fov;
  }

  end(at: THREE.Vector3): void {
    if (this.mode === 'walk') this.blend = 0.45;
    this.inspect(at, 40);
    this.mode = 'end';
  }

  /** Mouse position in -1..1 at the bench; only the outer edges turn the head. */
  setNudge(x: number): void {
    const ax = Math.abs(x);
    this.yawT = this.mode === 'station' && this.turnable ? -Math.sign(x) * Math.max(0, ax - 0.94) / 0.06 * 0.5 : 0;
  }

  /** Mouse-look while walking (pixels of movement). */
  turn(dx: number, dy: number): void {
    this.walkYaw -= dx * 0.0032;
    this.walkPitch = Math.max(-1.35, Math.min(1.2, this.walkPitch - dy * 0.0032));
  }

  /** Walk with WASD; `blocked` keeps the body out of walls and furniture. */
  move(fwd: number, side: number, dt: number, blocked: (x: number, z: number, r: number) => boolean): boolean {
    if (this.mode !== 'walk' || (!fwd && !side)) return false;
    const sp = 1.6 * dt / Math.hypot(fwd, side);
    const s = Math.sin(this.walkYaw), c = Math.cos(this.walkYaw);
    const dx = (-s * fwd + c * side) * sp;
    const dz = (-c * fwd - s * side) * sp;
    const r = 0.22;
    const b = this.body;
    let moved = false;
    if (!blocked(b.x + dx, b.z, r)) {
      b.x += dx;
      moved = true;
    }
    if (!blocked(b.x, b.z + dz, r)) {
      b.z += dz;
      moved = true;
    }
    if (moved) this.bob += dt * 9;
    return moved;
  }

  /** Where the walking eye looks (unit vector). */
  dir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.walkPitch);
    return out.set(-Math.sin(this.walkYaw) * cp, Math.sin(this.walkPitch), -Math.cos(this.walkYaw) * cp);
  }

  settled(): boolean {
    return this.blend <= 0 && this.pos.distanceToSquared(this.tPos) < 1e-7 && Math.abs(this.fov - this.tFov) < 0.05 && Math.abs(this.yaw - this.yawT) < 0.002;
  }

  update(dt: number): void {
    if (this.mode === 'walk') {
      this.tPos.set(this.body.x, 1.58 + Math.sin(this.bob) * 0.012, this.body.z);
      this.tLook.copy(this.tPos).add(this.dir(this.tmp));
    }
    this.blend = Math.max(0, this.blend - dt);
    const walkingFree = this.mode === 'walk' && this.blend <= 0;
    const k = walkingFree ? 1 : 1 - Math.exp(-dt * 7);
    this.pos.lerp(this.tPos, k);
    this.look.lerp(this.tLook, k);
    this.fov += (this.tFov - this.fov) * (1 - Math.exp(-dt * 7));
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * 4));
    this.cam.position.copy(this.pos);
    const d = this.tmp.copy(this.look).sub(this.pos);
    if (this.mode !== 'walk') d.applyAxisAngle(Y_AXIS, this.yaw);
    this.cam.lookAt(d.add(this.pos));
    if (Math.abs(this.cam.fov - this.fov) > 1e-3) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
