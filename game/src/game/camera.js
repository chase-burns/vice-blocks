// camera.js — two first-person rigs. The cockpit rig anchors at the
// driver's eye, inherits chassis pitch/roll through soft springs, widens
// FOV under acceleration, rolls slightly against steering at speed and
// shakes with amplitude proportional to trauma squared. The foot rig is
// a bobbing eye at 1.72 m. Pure math, no rendering.
import { clamp } from '../rng.js';

export function viewDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
}

function noise(t, seed) {
  return Math.sin(t * 31.7 + seed) * 0.6 + Math.sin(t * 57.3 + seed * 2.1) * 0.4;
}

const BASE_FOV = 75 * Math.PI / 180;

export class CameraRig {
  constructor() {
    this.eye = null; this.center = null;
    this._springPitch = 0; this._springPitchVel = 0;
    this._springRoll = 0; this._springRollVel = 0;
    this.fovPunch = 0;
  }

  _spring(current, velocity, target, dt) {
    const accel = 18 * (target - current) - 2.4 * velocity * 6;
    velocity += accel * dt;
    current += velocity * dt;
    return [current, velocity];
  }

  cockpit(s, car, lookYaw, lookPitch, t, dt) {
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const eye = [car.x - rx * 0.35 + fx * 0.15, 1.22, car.z - rz * 0.35 + fz * 0.15];
    const phys = car.phys;
    const ps = this._spring(this._springPitch, this._springPitchVel, phys ? phys.pitch : 0, dt);
    this._springPitch = ps[0]; this._springPitchVel = ps[1];
    const rs = this._spring(this._springRoll, this._springRollVel, phys ? phys.roll : 0, dt);
    this._springRoll = rs[0]; this._springRollVel = rs[1];
    const aLong = phys ? phys.aLong : 0;
    const fovTarget = BASE_FOV + clamp(aLong * 0.35, -5, 12) * Math.PI / 180;
    if (!this.fovPunch) this.fovPunch = fovTarget;
    this.fovPunch += (fovTarget - this.fovPunch) * Math.min(1, dt * 6);
    this.fovPunch = clamp(this.fovPunch, 0.9, 2.2);
    const yaw = car.ry + lookYaw;
    const pitch = lookPitch + this._springPitch * 0.7;
    const dir = viewDir(yaw, pitch);
    eye[1] += s.roadJolt || 0;
    const trauma = s.trauma || 0;
    if (trauma > 0.01) {
      const amp = trauma * trauma * 0.14;
      eye[0] += noise(t, 1.3) * amp;
      eye[1] += noise(t, 4.1) * amp * 0.7;
      eye[2] += noise(t, 7.7) * amp;
    }
    const center = [eye[0] + dir[0] * 10, eye[1] + dir[1] * 10, eye[2] + dir[2] * 10];
    const speedFactor = clamp(Math.abs(car.speed) / 20, 0, 1);
    const steerLean = clamp(-(car.steerAngle || 0) * speedFactor * 0.3, -0.05, 0.05);
    const roll = this._springRoll * 0.8 + steerLean;
    const up = [-Math.cos(yaw) * roll, 1, Math.sin(yaw) * roll];
    return { eye, center, up, fov: this.fovPunch, yaw, pitch };
  }

  foot(s, lookYaw, lookPitch, t) {
    const p = s.player;
    const walking = p.speed > 0.2;
    const bobY = walking ? Math.sin(p.bobPhase * 2) * 0.045 : 0;
    const bobX = walking ? Math.cos(p.bobPhase) * 0.03 : 0;
    const rx = Math.cos(lookYaw), rz = -Math.sin(lookYaw);
    const eye = [p.x + rx * bobX, 1.72 + bobY, p.z + rz * bobX];
    const recoilPitch = (s.recoil || 0) * 0.03;
    const dir = viewDir(lookYaw, lookPitch - recoilPitch);
    const trauma = s.trauma || 0;
    if (trauma > 0.01) {
      const amp = trauma * trauma * 0.1;
      eye[0] += noise(t, 2.2) * amp;
      eye[1] += noise(t, 5.5) * amp;
    }
    const center = [eye[0] + dir[0] * 10, eye[1] + dir[1] * 10, eye[2] + dir[2] * 10];
    return { eye, center, up: [0, 1, 0], fov: BASE_FOV, yaw: lookYaw, pitch: lookPitch };
  }
}
