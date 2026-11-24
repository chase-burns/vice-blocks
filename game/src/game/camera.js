// camera.js — two first-person camera rigs, pure math. The cockpit rig
// sits at the driver's eye, inherits chassis pitch and roll through soft
// springs, widens its FOV under acceleration, leans a little against the
// steering at speed, and shakes with an amplitude proportional to trauma
// squared. The foot rig is a bobbing eye at 1.72 m with recoil kick.
import { clamp } from '../rng.js';

export function viewDir(yaw, pitch) {
  const cosPitch = Math.cos(pitch);
  return [Math.sin(yaw) * cosPitch, -Math.sin(pitch), Math.cos(yaw) * cosPitch];
}

function shakeNoise(t, seed) {
  return Math.sin(t * 31.7 + seed) * 0.6 + Math.sin(t * 57.3 + seed * 2.1) * 0.4;
}

const BASE_FOV = 75 * Math.PI / 180;

export class CameraRig {
  constructor() {
    this.eye = null; this.center = null;
    this._pitchSpring = 0; this._pitchSpringVel = 0;
    this._rollSpring = 0; this._rollSpringVel = 0;
    this.fovPunch = 0;
  }

  _stepSpring(value, velocity, target, dt) {
    const accel = 18 * (target - value) - 2.4 * velocity * 6;
    velocity += accel * dt;
    value += velocity * dt;
    return [value, velocity];
  }

  cockpit(s, car, lookYaw, lookPitch, t, dt) {
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const eyePos = [car.x - rx * 0.35 + fx * 0.15, 1.22, car.z - rz * 0.35 + fz * 0.15];
    const phys = car.phys;
    const pitchStep = this._stepSpring(this._pitchSpring, this._pitchSpringVel, phys ? phys.pitch : 0, dt);
    this._pitchSpring = pitchStep[0]; this._pitchSpringVel = pitchStep[1];
    const rollStep = this._stepSpring(this._rollSpring, this._rollSpringVel, phys ? phys.roll : 0, dt);
    this._rollSpring = rollStep[0]; this._rollSpringVel = rollStep[1];
    const longAccel = phys ? phys.aLong : 0;
    const fovGoal = BASE_FOV + clamp(longAccel * 0.35, -5, 12) * Math.PI / 180;
    if (!this.fovPunch) this.fovPunch = fovGoal;
    this.fovPunch += (fovGoal - this.fovPunch) * Math.min(1, dt * 6);
    this.fovPunch = clamp(this.fovPunch, 0.9, 2.2);
    const yaw = car.ry + lookYaw;
    const pitch = lookPitch + this._pitchSpring * 0.7;
    const dir = viewDir(yaw, pitch);
    eyePos[1] += s.roadJolt || 0;
    const trauma = s.trauma || 0;
    if (trauma > 0.01) {
      const amp = trauma * trauma * 0.14;
      eyePos[0] += shakeNoise(t, 1.3) * amp;
      eyePos[1] += shakeNoise(t, 4.1) * amp * 0.7;
      eyePos[2] += shakeNoise(t, 7.7) * amp;
    }
    const lookTarget = [eyePos[0] + dir[0] * 10, eyePos[1] + dir[1] * 10, eyePos[2] + dir[2] * 10];
    const speedRatio = clamp(Math.abs(car.speed) / 20, 0, 1);
    const leanFromSteer = clamp(-(car.steerAngle || 0) * speedRatio * 0.3, -0.05, 0.05);
    const totalRoll = this._rollSpring * 0.8 + leanFromSteer;
    const upVec = [-Math.cos(yaw) * totalRoll, 1, Math.sin(yaw) * totalRoll];
    return { eye: eyePos, center: lookTarget, up: upVec, fov: this.fovPunch, yaw, pitch };
  }

  foot(s, lookYaw, lookPitch, t) {
    const p = s.player;
    const isWalking = p.speed > 0.2;
    const bobVertical = isWalking ? Math.sin(p.bobPhase * 2) * 0.045 : 0;
    const bobLateral = isWalking ? Math.cos(p.bobPhase) * 0.03 : 0;
    const rx = Math.cos(lookYaw), rz = -Math.sin(lookYaw);
    const eyePos = [p.x + rx * bobLateral, 1.72 + bobVertical, p.z + rz * bobLateral];
    const recoil = (s.recoil || 0) * 0.03;
    const dir = viewDir(lookYaw, lookPitch - recoil);
    const trauma = s.trauma || 0;
    if (trauma > 0.01) {
      const amp = trauma * trauma * 0.1;
      eyePos[0] += shakeNoise(t, 2.2) * amp;
      eyePos[1] += shakeNoise(t, 5.5) * amp;
    }
    const lookTarget = [eyePos[0] + dir[0] * 10, eyePos[1] + dir[1] * 10, eyePos[2] + dir[2] * 10];
    return { eye: eyePos, center: lookTarget, up: [0, 1, 0], fov: BASE_FOV, yaw: lookYaw, pitch: lookPitch };
  }
}
