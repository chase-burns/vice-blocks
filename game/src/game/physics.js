// physics.js — the car model: a Pacejka-flavoured bicycle. Forward
// speed u, lateral speed v and yaw rate omega are integrated from tyre
// slip angles; each tyre's lateral force follows a tanh curve that
// saturates like the Pacejka magic formula's first lobe. The handbrake
// collapses rear grip, which is what makes the car rotate into a
// drift. A simple stepped gearbox turns road speed into gear and rpm
// for the dash and the engine note.

import { clamp } from '../rng.js';

const GEAR_EDGES = [0, 8.5, 15, 22.5, 29.5, 38.5];
const HALF_WHEELBASE = 1.35;

export class VehiclePhysics {
  constructor() {
    this.u = 0;          // forward speed, m/s
    this.v = 0;          // lateral speed, m/s (car space)
    this.omega = 0;      // yaw rate, rad/s
    this.steerAngle = 0; // front wheel angle, rad
    this.pitch = 0;      // body pitch for the camera/drawing, rad
    this.roll = 0;       // body roll, rad
    this.slip = 0;       // rear slip magnitude, drives smoke + HUD
    this.gear = 1;
    this.rpm = 0.12;     // 0..1 across the dial
    this._longAccel = 0;
  }

  // ctl: { throttle: -1..1, steer: -1..1, handbrake: bool }
  update(dt, ctl, opts = {}) {
    const engineMul = opts.engineMul || 1;
    const gripMul = opts.gripMul || 1;

    // Steering: less lock as speed rises, approached at a fixed rate.
    const maxLock = 0.58 / (1 + Math.abs(this.u) * 0.05);
    const steerTarget = clamp(ctl.steer, -1, 1) * maxLock;
    const steerRate = 3.6 * dt;
    this.steerAngle += clamp(steerTarget - this.steerAngle, -steerRate, steerRate);

    // Gearbox: pick the band the speed falls in, rpm is progress
    // through the band (with a floor so idle still shows on the dial).
    const spd = Math.abs(this.u);
    let gear = 1;
    while (gear < 5 && spd > GEAR_EDGES[gear]) gear++;
    this.gear = this.u < -0.5 ? 0 : gear;
    const lo = GEAR_EDGES[gear - 1] || 0;
    const hi = GEAR_EDGES[gear] || 38.5;
    const bandFrac = clamp((spd - lo) / Math.max(1, hi - lo), 0, 1);
    this.rpm = clamp(0.18 + bandFrac * 0.78 + Math.max(0, ctl.throttle) * 0.05, 0, 1);

    // Longitudinal: engine curve falls off with speed, drag grows with
    // its square; together they put the ceiling near 38.5 m/s.
    let accel = 0;
    if (ctl.throttle > 0) {
      accel += ctl.throttle * 10.5 * Math.max(0.15, 1.25 - spd / 62) * engineMul;
    } else if (ctl.throttle < 0) {
      accel += this.u > 0.8 ? ctl.throttle * 14 : ctl.throttle * 5.5; // brake, then reverse
    }
    accel -= 0.0035 * this.u * Math.abs(this.u) + 0.35 * Math.tanh(this.u * 0.6);
    if (ctl.handbrake && this.u > 0.8) accel -= 5.5;
    this.u += accel * dt;
    if (Math.abs(this.u) < 0.04 && ctl.throttle === 0) this.u = 0;
    this.u = clamp(this.u, -9, 40);
    this._longAccel = this._longAccel + (accel - this._longAccel) * Math.min(1, dt * 5);

    // Lateral bicycle model.
    const denom = Math.abs(this.u) < 1.2 ? (this.u < 0 ? -1.2 : 1.2) : this.u;
    const alphaF = Math.atan((this.v + HALF_WHEELBASE * this.omega) / denom) - this.steerAngle * Math.sign(this.u || 1);
    const alphaR = Math.atan((this.v - HALF_WHEELBASE * this.omega) / denom);
    const frontGrip = 10.5 * gripMul;
    const rearGrip = (ctl.handbrake ? 3.1 : 10.0) * gripMul;
    const forceF = -Math.tanh(alphaF * 5.2) * frontGrip;
    const forceR = -Math.tanh(alphaR * 5.2) * rearGrip;
    const latAccel = forceF + forceR;
    this.v += (latAccel - this.omega * this.u) * dt;
    this.omega += ((forceF - forceR) * HALF_WHEELBASE / 1.9) * dt;
    // Parking-speed tidy-up so the car settles instead of creeping.
    const settle = Math.abs(this.u) < 1.5 ? Math.exp(-dt * 6) : Math.exp(-dt * 0.7);
    this.v *= settle;
    this.omega *= Math.abs(this.u) < 1.5 ? Math.exp(-dt * 7) : Math.exp(-dt * 1.1);
    this.slip = Math.abs(alphaR) * 57.3 * clamp(Math.abs(this.u) / 16, 0, 1.4);

    // Body lean for the camera and the exterior drawing.
    this.pitch = clamp(-this._longAccel * 0.0055, -0.05, 0.06);
    this.roll = clamp(latAccel * 0.0038, -0.06, 0.06);
  }
}
