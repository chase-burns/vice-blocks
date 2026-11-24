// First-person dual camera (WO Task 6): cockpit rig with spring lag, FOV
// punch and trauma shake; on-foot rig with head bob. Pure math, no DOM.
import { clamp } from '../rng.js';

export function viewDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
}
function noise1(t, seed) { return Math.sin(t * 31.7 + seed) * 0.6 + Math.sin(t * 57.3 + seed * 2.1) * 0.4; }

export class CameraRig {
  constructor() {
    this.eye = null; this.center = null;
    this.springP = 0; this.springPV = 0; this.springR = 0; this.springRV = 0;
    this.fovPunch = 0;
  }
  // 2-pole spring (k=18, c=2.4 per spec, scaled for stability at 60 Hz)
  _spring(cur, vel, target, dt) {
    const k = 18, c = 2.4;
    const acc = k * (target - cur) - c * vel * 6;
    vel += acc * dt;
    cur += vel * dt;
    return [cur, vel];
  }
  cockpit(s, car, lookYaw, lookPitch, t, dt) {
    // Anchor at driver eye [-0.35, 1.15, 0.15] in car space (x right, z fwd).
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const eye = [car.x - rx * 0.35 + fx * 0.15, 1.22, car.z - rz * 0.35 + fz * 0.15];
    // Chassis lag: spring the pitch/roll the camera inherits.
    const phys = car.phys;
    const targetP = phys ? phys.pitch : 0, targetR = phys ? phys.roll : 0;
    [this.springP, this.springPV] = this._spring(this.springP, this.springPV, targetP, dt);
    [this.springR, this.springRV] = this._spring(this.springR, this.springRV, targetR, dt);
    // FOV punch: 75deg base + clamp(aLong * 0.35, -5deg, +12deg)
    const aLong = phys ? phys.aLong : 0;
    const targetFov = 75 * Math.PI / 180 + clamp(aLong * 0.35, -5, 12) * Math.PI / 180;
    this.fovPunch += (targetFov - this.fovPunch) * Math.min(1, dt * 6);
    if (!this.fovPunch) this.fovPunch = targetFov;
    const yaw = car.ry + lookYaw;
    const pitch = lookPitch + this.springP * 0.7;
    const d = viewDir(yaw, pitch);
    // Road feel: kerb/bump jolts are added by main via s.roadJolt.
    eye[1] += (s.roadJolt || 0);
    // Trauma shake: displacement = T^2 * noise(t)
    const T = s.trauma || 0;
    if (T > 0.01) {
      const sh = T * T * 0.14;
      eye[0] += noise1(t, 1.3) * sh; eye[1] += noise1(t, 4.1) * sh * 0.7; eye[2] += noise1(t, 7.7) * sh;
    }
    const center = [eye[0] + d[0] * 10, eye[1] + d[1] * 10, eye[2] + d[2] * 10];
    const roll = this.springR * 0.8 + clamp(-(car.steerAngle || 0) * clamp(Math.abs(car.speed) / 20, 0, 1) * 0.3, -0.05, 0.05);
    const up = [-Math.cos(yaw) * roll, 1, Math.sin(yaw) * roll];
    return { eye, center, up, fov: this.fovPunch, yaw, pitch };
  }
  foot(s, lookYaw, lookPitch, t) {
    const p = s.player;
    const bobY = p.speed > 0.2 ? Math.sin(p.bobPhase * 2) * 0.045 : 0;
    const bobX = p.speed > 0.2 ? Math.cos(p.bobPhase) * 0.03 : 0;
    const rx = Math.cos(lookYaw), rz = -Math.sin(lookYaw);
    const eye = [p.x + rx * bobX, 1.72 + bobY, p.z + rz * bobX];
    const recoilPitch = (s.recoil || 0) * 0.03;
    const d = viewDir(lookYaw, lookPitch - recoilPitch);
    const T = s.trauma || 0;
    if (T > 0.01) {
      const sh = T * T * 0.1;
      eye[0] += noise1(t, 2.2) * sh; eye[1] += noise1(t, 5.5) * sh;
    }
    const center = [eye[0] + d[0] * 10, eye[1] + d[1] * 10, eye[2] + d[2] * 10];
    return { eye, center, up: [0, 1, 0], fov: 75 * Math.PI / 180, yaw: lookYaw, pitch: lookPitch };
  }
}
