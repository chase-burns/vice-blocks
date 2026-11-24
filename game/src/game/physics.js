// physics.js — how the player's car moves, integrated in the body
// frame: forward speed u, lateral speed v, yaw rate omega. Each axle
// gets a Pacejka-style lateral force, the four-speed gearbox shifts with
// hysteresis, the handbrake collapses rear grip so drifts happen, and a
// pair of pitch/roll springs feeds body motion to the cockpit camera.
// The tune is eager on purpose — full throttle passes 15 m/s in under
// two seconds.
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

// Simplified Pacejka curve: lateral force at one axle for a slip angle.
function pacejkaForce(slip, grip, load) {
  const { B, C, E } = SPEC.pacejka;
  const x = B * slip;
  return grip * load * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

// Advance one damped spring by dt; returns [new value, new velocity].
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

  // Choose a gear with offset up/down thresholds, so the box does not
  // hunt back and forth when the speed sits right on a boundary.
  _gearBand() {
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
    const speedAbs = Math.abs(this.u), rolling = speedAbs > 0.05, dirSign = Math.sign(this.u || 1);
    const steerCmd = clamp(input.steer || 0, -1, 1);
    const lockNow = SPEC.steerLock / (1 + SPEC.steerSpeedFade * speedAbs);
    const steerTarget = steerCmd * lockNow;
    const rackRate = steerCmd === 0 ? 5.0 : 3.4;
    this.steerAngle += clamp(steerTarget - this.steerAngle, -rackRate * dt, rackRate * dt);
    const delta = this.steerAngle;
    const band = this._gearBand();
    if (this._shiftPause > 0) this._shiftPause -= dt;
    this.rpm = clamp((speedAbs - band[0]) / (band[1] - band[0]), 0.08, 1);
    if (!input.throttle && !input.brake) this.rpm = clamp(this.rpm - dt * 0.5, 0.08, 1);
    this.throttle = input.throttle || 0;
    let driveForce = 0;
    if (this._shiftPause <= 0) driveForce += this.throttle * band[2] * SPEC.finalDrive * (this.powerMul || 1);
    if (input.brake) {
      if (this.u > 0.4) driveForce -= SPEC.brakeForce;
      else if (this.u > -10) driveForce -= 2600 * SPEC.finalDrive * 0.45;
    }
    const hb = !!input.handbrake;
    this.handbrake = hb;
    if (hb) driveForce -= Math.sign(this.u) * 6500 * 0.55;
    if (rolling) driveForce -= SPEC.rollingResistance * M * SPEC.gravity * Math.sign(this.u);
    driveForce -= SPEC.dragK * this.u * speedAbs;
    const slipDenom = Math.max(speedAbs, 1.2) * dirSign;
    const slipF = Math.atan((this.v + this.omega * a) / slipDenom) - delta * dirSign;
    const slipR = Math.atan((this.v - this.omega * b) / slipDenom);
    this.slipFront = slipF; this.slipRear = slipR;
    const loadF = M * SPEC.gravity * b / L, loadR = M * SPEC.gravity * a / L;
    const rearGripNow = hb ? SPEC.gripRearHandbrake : SPEC.gripDry;
    const forceF = rolling ? -pacejkaForce(slipF, SPEC.gripDry, loadF) * dirSign : 0;
    const forceR = rolling ? -pacejkaForce(slipR, rearGripNow, loadR) * dirSign : 0;
    const accLong = driveForce / M + this.omega * this.v;
    const accLat = (forceF + forceR) / M - this.omega * this.u;
    this.u += accLong * dt; this.v += accLat * dt;
    let yawAcc = (a * forceF - b * forceR) / SPEC.yawInertia;
    const counterSteer = Math.sign(delta) !== 0 && Math.sign(delta) !== Math.sign(slipR) && Math.abs(slipR) > 0.05;
    if (counterSteer) yawAcc += -1.35 * this.omega * Math.abs(slipR);
    const yawDamping = hb ? 0.55 : 1.35;
    yawAcc -= this.omega * yawDamping * (speedAbs > 0.5 ? 1 : 0.25);
    this.omega += yawAcc * dt;
    if (!rolling && !input.throttle && !input.brake) { this.u = 0; this.v *= 0.8; this.omega *= 0.7; }
    this.u = clamp(this.u, -11, 48);
    this.aLong = accLong; this.aLat = accLat;
    this.isDrifting = (hb && speedAbs > 3 && Math.abs(delta) > 0.04) || (Math.abs(this.v) > 2.5 && speedAbs > 5);
    const pitchState = springStep(this.pitch, this._pitchVel, clamp(accLong * 0.012, -0.06, 0.05), 26, 5.5, dt);
    this.pitch = pitchState[0]; this._pitchVel = pitchState[1];
    const rollState = springStep(this.roll, this._rollVel, clamp(-accLat * 0.016, -0.09, 0.09), 26, 5.5, dt);
    this.roll = rollState[0]; this._rollVel = rollState[1];
    return this;
  }
}
