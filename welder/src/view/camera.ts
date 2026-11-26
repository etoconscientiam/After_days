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
  /** The head following the cursor a little at the bench (yaw, pitch in radians), and where it heads. */
  private fx = 0;
  private fy = 0;
  private fxT = 0;
  private fyT = 0;
  private side = new THREE.Vector3();
  /** Walking: where the body stands and where the head points. */
  readonly body = new THREE.Vector3(0, 0, 0.45);
  walkYaw = 0;
  walkPitch = -0.3;
  /** Seconds left of the glide between the bench and walking. */
  private blend = 0;
  /** Head turn is allowed (not while the hand is busy welding). */
  turnable = true;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** Head offsets at the bench: the wheel zoom, and the lean while welding. */
  private zoomOff = new THREE.Vector3();
  private leanOff = new THREE.Vector3();
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
    this.tFov = 58;
    this.applyOff();
  }

  /**
   * Lean toward a point on the work by fraction k of the way (0 = upright at the bench). The head moves along
   * the line of sight to that point without turning, so the point stays exactly where it is on screen and the
   * hand on the mouse doesn't jump; everything around it just gets bigger.
   */
  lean(at: THREE.Vector3 | null, k: number): void {
    this.leanOff.set(0, 0, 0);
    // A hand zoom already brings the work close: don't lean on top of it.
    if (at && k > 0 && this.zoomOff.lengthSq() < 0.0025) this.leanOff.copy(at).sub(this.eye).multiplyScalar(k);
    this.applyOff();
  }

  /**
   * Zoom with the wheel toward the point under the cursor (steps > 0 in, < 0 out). Same trick as leaning: the
   * head moves along the line of sight to that point, so it stays under the cursor.
   */
  zoomAt(at: THREE.Vector3 | null, steps: number): void {
    if (this.mode !== 'station') return;
    const cur = this.tmp.copy(this.eye).add(this.zoomOff);
    if (steps > 0 && at) {
      for (let i = 0; i < steps; i++) {
        const d = this.tmp2.copy(at).sub(cur);
        if (d.length() < 0.28) break;
        d.multiplyScalar(0.16);
        this.zoomOff.add(d);
        cur.add(d);
      }
    } else if (steps < 0) {
      this.zoomOff.multiplyScalar(Math.pow(0.72, -steps));
      if (this.zoomOff.lengthSq() < 1e-4) this.zoomOff.set(0, 0, 0);
    }
    this.applyOff();
  }

  resetZoom(): void {
    this.zoomOff.set(0, 0, 0);
    this.leanOff.set(0, 0, 0);
    this.applyOff();
  }

  get zoomed(): boolean {
    return this.zoomOff.lengthSq() > 1e-4;
  }

  private applyOff(): void {
    if (this.mode !== 'station') return;
    this.tPos.copy(this.eye).add(this.zoomOff).add(this.leanOff);
    this.tLook.copy(this.ahead).add(this.zoomOff).add(this.leanOff);
  }

  /** Step back from the bench and walk. */
  walk(): void {
    this.zoomOff.set(0, 0, 0);
    this.leanOff.set(0, 0, 0);
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

  /**
   * Mouse position in -1..1 at the bench. The head follows it a little (a few degrees, slowly), so the eye
   * drifts toward what you point at; `follow` 0..1 damps that (held still while welding, so the aim doesn't
   * slide under a still hand). The outer edges still turn the head properly.
   */
  setNudge(x: number, y = 0, follow = 1): void {
    const ax = Math.abs(x);
    const on = this.mode === 'station';
    this.yawT = on && this.turnable ? -Math.sign(x) * Math.max(0, ax - 0.94) / 0.06 * 0.5 : 0;
    this.fxT = on ? -x * 0.07 * follow : 0;
    this.fyT = on ? y * 0.045 * follow : 0;
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
    return this.blend <= 0 && this.pos.distanceToSquared(this.tPos) < 1e-7 && Math.abs(this.fov - this.tFov) < 0.05 && Math.abs(this.yaw - this.yawT) < 0.002 && Math.abs(this.fx - this.fxT) < 0.002 && Math.abs(this.fy - this.fyT) < 0.002;
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
    const kf = 1 - Math.exp(-dt * 2.2);
    this.fx += (this.fxT - this.fx) * kf;
    this.fy += (this.fyT - this.fy) * kf;
    this.cam.position.copy(this.pos);
    const d = this.tmp.copy(this.look).sub(this.pos);
    if (this.mode !== 'walk') {
      d.applyAxisAngle(Y_AXIS, this.yaw + this.fx);
      // Pitch about the horizontal axis across the view.
      this.side.set(-d.z, 0, d.x).normalize();
      d.applyAxisAngle(this.side, this.fy);
    }
    this.cam.lookAt(d.add(this.pos));
    if (Math.abs(this.cam.fov - this.fov) > 1e-3) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
