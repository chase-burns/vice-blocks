// physics.js — player-car movement in the body frame: forward speed u,
// lateral speed v and yaw rate omega. Pacejka-style curves act at each
// axle, a four-speed gearbox uses shift hysteresis, the handbrake drops
// rear grip for drifts, and pitch/roll springs feed the cockpit camera.
// Tuning is eager: full throttle passes 15 m/s in under two seconds.
import { clamp } from '../rng.js';

export const SPEC = {
  mass: 1350, wheelbase: 2.7, frontAxle: 1.3, rearAxle: 1.4,
  yawInertia: 1900, gravity: 9.81,
  steerLock: 0.5934, steerSpeedFade: 0.042,
  gears: [[0, 12, 5200], [12, 24, 3400], [24, 36, 2200], [36, 48, 1400]],
  finalDrive: 2.45, brakeForce: 7800, rollingResistance: 0.015, dragK: 0.4116,
  gripDry: 1.15, gripRearHandbrake: 0.32,
  pacejka: { B: 7.0, C: 1.35, E: 0.15 },
};

// Simplified Pacejka lateral force for one axle.
function pacejkaForce(slip, grip, load) {
  const { B, C, E } = SPEC.pacejka;
  const x = B * slip;
  return grip * load * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

// One damped-spring step; returns [value, velocity].
function springStep(value, velocity, target, stiffness, damping, dt) {
  const accel = stiffness * (target - value) - damping * velocity;
  return [value + velocity * dt, velocity + accel * dt];
}

export class VehiclePhysics {
  constructor() {
    this.u = 0; this.v = 0; this.omega = 0; this.steerAngle = 0;
    this.gear = 1; this.rpm = 0.1; this.isDrifting = false;
    this.slipFront = 0; this.slipRear = 0; this.pitch = 0; this.roll = 0;
    this.throttle = 0; this.handbrake = false; this.aLong = 0; this.aLat = 0;
    this.powerMul = 1; this._pitchVel = 0; this._rollVel = 0;
    this._shiftPause = 0; this._gearIndex = 0;
  }

  get speed() { return this.u; }

  // Gear selection with offset up/down thresholds so the box does not
  // hunt when speed hovers on a boundary.
  _selectGear() {
    if (this.u < -0.5) this._gearIndex = -1;
    else {
      let gi = this._gearIndex; if (gi < 0) gi = 0;
      while (gi < 3 && this.u >= SPEC.gears[gi][1] + 0.8) gi++;
      while (gi > 0 && this.u < SPEC.gears[gi][0] - 1.5) gi--;
      this._gearIndex = gi;
    }
    const shown = this._gearIndex + 1;
    if (shown !== this.gear && this.u >= 0) { this.gear = shown; this._shiftPause = 0.09; }
    if (this.u < -0.5) this.gear = 0;
    return this._gearIndex >= 0 ? SPEC.gears[this._gearIndex] : [0, 8, 2600];
  }

  update(dt, input) {
    const M = SPEC.mass, L = SPEC.wheelbase, a = SPEC.frontAxle, b = SPEC.rearAxle;
    const speedAbs = Math.abs(this.u), moving = speedAbs > 0.05, dirSign = Math.sign(this.u || 1);
    const steerIn = clamp(input.steer || 0, -1, 1);
    const lockNow = SPEC.steerLock / (1 + SPEC.steerSpeedFade * speedAbs);
    const steerTarget = steerIn * lockNow;
    const rackRate = steerIn === 0 ? 5.0 : 3.4;
    this.steerAngle += clamp(steerTarget - this.steerAngle, -rackRate * dt, rackRate * dt);
    const delta = this.steerAngle;
    const band = this._selectGear();
    if (this._shiftPause > 0) this._shiftPause -= dt;
    this.rpm = clamp((speedAbs - band[0]) / (band[1] - band[0]), 0.08, 1);
    if (!input.throttle && !input.brake) this.rpm = clamp(this.rpm - dt * 0.5, 0.08, 1);
    this.throttle = input.throttle || 0;
    let forceX = 0;
    if (this._shiftPause <= 0) forceX += this.throttle * band[2] * SPEC.finalDrive * (this.powerMul || 1);
    if (input.brake) {
      if (this.u > 0.4) forceX -= SPEC.brakeForce;
      else if (this.u > -10) forceX -= 2600 * SPEC.finalDrive * 0.45;
    }
    const handbrake = !!input.handbrake;
    this.handbrake = handbrake;
    if (handbrake) forceX -= Math.sign(this.u) * 6500 * 0.55;
    if (moving) forceX -= SPEC.rollingResistance * M * SPEC.gravity * Math.sign(this.u);
    forceX -= SPEC.dragK * this.u * speedAbs;
    const denom = Math.max(speedAbs, 1.2) * dirSign;
    const alphaFront = Math.atan((this.v + this.omega * a) / denom) - delta * dirSign;
    const alphaRear = Math.atan((this.v - this.omega * b) / denom);
    this.slipFront = alphaFront; this.slipRear = alphaRear;
    const loadFront = M * SPEC.gravity * b / L, loadRear = M * SPEC.gravity * a / L;
    const gripRear = handbrake ? SPEC.gripRearHandbrake : SPEC.gripDry;
    const forceFront = moving ? -pacejkaForce(alphaFront, SPEC.gripDry, loadFront) * dirSign : 0;
    const forceRear = moving ? -pacejkaForce(alphaRear, gripRear, loadRear) * dirSign : 0;
    const aLong = forceX / M + this.omega * this.v;
    const aLat = (forceFront + forceRear) / M - this.omega * this.u;
    this.u += aLong * dt; this.v += aLat * dt;
    let yawAccel = (a * forceFront - b * forceRear) / SPEC.yawInertia;
    const counter = Math.sign(delta) !== 0 && Math.sign(delta) !== Math.sign(alphaRear) && Math.abs(alphaRear) > 0.05;
    if (counter) yawAccel += -1.35 * this.omega * Math.abs(alphaRear);
    const yawDamping = handbrake ? 0.55 : 1.35;
    yawAccel -= this.omega * yawDamping * (speedAbs > 0.5 ? 1 : 0.25);
    this.omega += yawAccel * dt;
    if (!moving && !input.throttle && !input.brake) { this.u = 0; this.v *= 0.8; this.omega *= 0.7; }
    this.u = clamp(this.u, -11, 48);
    this.aLong = aLong; this.aLat = aLat;
    this.isDrifting = (handbrake && speedAbs > 3 && Math.abs(delta) > 0.04) || (Math.abs(this.v) > 2.5 && speedAbs > 5);
    const ps = springStep(this.pitch, this._pitchVel, clamp(aLong * 0.012, -0.06, 0.05), 26, 5.5, dt);
    this.pitch = ps[0]; this._pitchVel = ps[1];
    const rs = springStep(this.roll, this._rollVel, clamp(-aLat * 0.016, -0.09, 0.09), 26, 5.5, dt);
    this.roll = rs[0]; this._rollVel = rs[1];
    return this;
  }
}
