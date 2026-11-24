// camera.js — two first-person camera rigs, pure math. The cockpit rig
// sits at the driver's eye, inherits chassis pitch and roll through soft
// springs, widens its FOV under acceleration, leans a little against the
// steering at speed, and shakes with an amplitude proportional to trauma
// squared. The foot rig is a bobbing eye at 1.72 m with recoil kick.
import { clamp } from '../rng.js';

export function viewDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
}

function jitter(t, seed) {
  return Math.sin(t * 31.7 + seed) * 0.6 + Math.sin(t * 57.3 + seed * 2.1) * 0.4;
}

const STANDARD_FOV = 75 * Math.PI / 180;

export class CameraRig {
  constructor() {
    this.eye = null; this.center = null;
    this._pitchPos = 0; this._pitchVel = 0;
    this._rollPos = 0; this._rollVel = 0;
    this.fovPunch = 0;
  }

  _spring(pos, vel, target, dt) {
    const accel = 18 * (target - pos) - 2.4 * vel * 6;
    vel += accel * dt;
    pos += vel * dt;
    return [pos, vel];
  }

  cockpit(s, car, lookYaw, lookPitch, t, dt) {
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const eyeAt = [car.x - rx * 0.35 + fx * 0.15, 1.22, car.z - rz * 0.35 + fz * 0.15];
    const phys = car.phys;
    const pitchNext = this._spring(this._pitchPos, this._pitchVel, phys ? phys.pitch : 0, dt);
    this._pitchPos = pitchNext[0]; this._pitchVel = pitchNext[1];
    const rollNext = this._spring(this._rollPos, this._rollVel, phys ? phys.roll : 0, dt);
    this._rollPos = rollNext[0]; this._rollVel = rollNext[1];
    const surge = phys ? phys.aLong : 0;
    const fovTarget = STANDARD_FOV + clamp(surge * 0.35, -5, 12) * Math.PI / 180;
    if (!this.fovPunch) this.fovPunch = fovTarget;
    this.fovPunch += (fovTarget - this.fovPunch) * Math.min(1, dt * 6);
    this.fovPunch = clamp(this.fovPunch, 0.9, 2.2);
    const yaw = car.ry + lookYaw;
    const pitch = lookPitch + this._pitchPos * 0.7;
    const dir = viewDir(yaw, pitch);
    eyeAt[1] += s.roadJolt || 0;
    const trauma = s.trauma || 0;
    if (trauma > 0.01) {
      const amp = trauma * trauma * 0.14;
      eyeAt[0] += jitter(t, 1.3) * amp;
      eyeAt[1] += jitter(t, 4.1) * amp * 0.7;
      eyeAt[2] += jitter(t, 7.7) * amp;
    }
    const targetAt = [eyeAt[0] + dir[0] * 10, eyeAt[1] + dir[1] * 10, eyeAt[2] + dir[2] * 10];
    const speedShare = clamp(Math.abs(car.speed) / 20, 0, 1);
    const steerLean = clamp(-(car.steerAngle || 0) * speedShare * 0.3, -0.05, 0.05);
    const combinedRoll = this._rollPos * 0.8 + steerLean;
    const upVec = [-Math.cos(yaw) * combinedRoll, 1, Math.sin(yaw) * combinedRoll];
    return { eye: eyeAt, center: targetAt, up: upVec, fov: this.fovPunch, yaw, pitch };
  }

  foot(s, lookYaw, lookPitch, t) {
    const p = s.player;
    const moving = p.speed > 0.2;
    const bobY = moving ? Math.sin(p.bobPhase * 2) * 0.045 : 0;
    const swayX = moving ? Math.cos(p.bobPhase) * 0.03 : 0;
    const rx = Math.cos(lookYaw), rz = -Math.sin(lookYaw);
    const eyeAt = [p.x + rx * swayX, 1.72 + bobY, p.z + rz * swayX];
    const kick = (s.recoil || 0) * 0.03;
    const dir = viewDir(lookYaw, lookPitch - kick);
    const trauma = s.trauma || 0;
    if (trauma > 0.01) {
      const amp = trauma * trauma * 0.1;
      eyeAt[0] += jitter(t, 2.2) * amp;
      eyeAt[1] += jitter(t, 5.5) * amp;
    }
    const targetAt = [eyeAt[0] + dir[0] * 10, eyeAt[1] + dir[1] * 10, eyeAt[2] + dir[2] * 10];
    return { eye: eyeAt, center: targetAt, up: [0, 1, 0], fov: STANDARD_FOV, yaw: lookYaw, pitch: lookPitch };
  }
}
