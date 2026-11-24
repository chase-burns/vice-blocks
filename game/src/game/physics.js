// physics.js — how the player's car moves, integrated in the body frame:
// forward speed u, lateral speed v, yaw rate omega. Each axle gets a
// Pacejka-style lateral force, the four-speed gearbox shifts with
// hysteresis, the handbrake collapses rear grip to make drifts happen,
// and a pair of pitch/roll springs feeds body motion to the cockpit
// camera. The tune is eager on purpose — full throttle is past 15 m/s in
// under two seconds.
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
function axleLateralForce(slip, grip, load) {
  const { B, C, E } = SPEC.pacejka;
  const x = B * slip;
  return grip * load * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

// Advance one damped spring by dt; returns [new value, new velocity].
function stepSpring(value, velocity, target, stiffness, damping, dt) {
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

  // Pick a gear with offset up/down thresholds, so the box does not hunt
  // back and forth when the speed sits right on a boundary.
  _pickGearBand() {
    if (this.u < -0.5) this._gearIndex = -1;
    else {
      let gi = this._gearIndex; if (gi < 0) gi = 0;
      while (gi < 3 && this.u >= SPEC.gears[gi][1] + 0.8) gi++;
      while (gi > 0 && this.u < SPEC.gears[gi][0] - 1.5) gi--;
      this._gearIndex = gi;
    }
    const displayed = this._gearIndex + 1;
    if (displayed !== this.gear && this.u >= 0) { this.gear = displayed; this._shiftPause = 0.09; }
    if (this.u < -0.5) this.gear = 0;
    return this._gearIndex >= 0 ? SPEC.gears[this._gearIndex] : [0, 8, 2600];
  }

  update(dt, input) {
    const M = SPEC.mass, L = SPEC.wheelbase, a = SPEC.frontAxle, b = SPEC.rearAxle;
    const absU = Math.abs(this.u), isMoving = absU > 0.05, travelSign = Math.sign(this.u || 1);
    const steerRequest = clamp(input.steer || 0, -1, 1);
    const lockAtSpeed = SPEC.steerLock / (1 + SPEC.steerSpeedFade * absU);
    const steerGoal = steerRequest * lockAtSpeed;
    const rackSpeed = steerRequest === 0 ? 5.0 : 3.4;
    this.steerAngle += clamp(steerGoal - this.steerAngle, -rackSpeed * dt, rackSpeed * dt);
    const delta = this.steerAngle;
    const band = this._pickGearBand();
    if (this._shiftPause > 0) this._shiftPause -= dt;
    this.rpm = clamp((absU - band[0]) / (band[1] - band[0]), 0.08, 1);
    if (!input.throttle && !input.brake) this.rpm = clamp(this.rpm - dt * 0.5, 0.08, 1);
    this.throttle = input.throttle || 0;
    let longitudinalForce = 0;
    if (this._shiftPause <= 0) longitudinalForce += this.throttle * band[2] * SPEC.finalDrive * (this.powerMul || 1);
    if (input.brake) {
      if (this.u > 0.4) longitudinalForce -= SPEC.brakeForce;
      else if (this.u > -10) longitudinalForce -= 2600 * SPEC.finalDrive * 0.45;
    }
    const handbrakeOn = !!input.handbrake;
    this.handbrake = handbrakeOn;
    if (handbrakeOn) longitudinalForce -= Math.sign(this.u) * 6500 * 0.55;
    if (isMoving) longitudinalForce -= SPEC.rollingResistance * M * SPEC.gravity * Math.sign(this.u);
    longitudinalForce -= SPEC.dragK * this.u * absU;
    const slipDenom = Math.max(absU, 1.2) * travelSign;
    const slipFront = Math.atan((this.v + this.omega * a) / slipDenom) - delta * travelSign;
    const slipRear = Math.atan((this.v - this.omega * b) / slipDenom);
    this.slipFront = slipFront; this.slipRear = slipRear;
    const loadFront = M * SPEC.gravity * b / L, loadRear = M * SPEC.gravity * a / L;
    const rearGrip = handbrakeOn ? SPEC.gripRearHandbrake : SPEC.gripDry;
    const frontForce = isMoving ? -axleLateralForce(slipFront, SPEC.gripDry, loadFront) * travelSign : 0;
    const rearForce = isMoving ? -axleLateralForce(slipRear, rearGrip, loadRear) * travelSign : 0;
    const accelLong = longitudinalForce / M + this.omega * this.v;
    const accelLat = (frontForce + rearForce) / M - this.omega * this.u;
    this.u += accelLong * dt; this.v += accelLat * dt;
    let yawAccel = (a * frontForce - b * rearForce) / SPEC.yawInertia;
    const counterSteering = Math.sign(delta) !== 0 && Math.sign(delta) !== Math.sign(slipRear) && Math.abs(slipRear) > 0.05;
    if (counterSteering) yawAccel += -1.35 * this.omega * Math.abs(slipRear);
    const yawDamp = handbrakeOn ? 0.55 : 1.35;
    yawAccel -= this.omega * yawDamp * (absU > 0.5 ? 1 : 0.25);
    this.omega += yawAccel * dt;
    if (!isMoving && !input.throttle && !input.brake) { this.u = 0; this.v *= 0.8; this.omega *= 0.7; }
    this.u = clamp(this.u, -11, 48);
    this.aLong = accelLong; this.aLat = accelLat;
    this.isDrifting = (handbrakeOn && absU > 3 && Math.abs(delta) > 0.04) || (Math.abs(this.v) > 2.5 && absU > 5);
    const pitchNext = stepSpring(this.pitch, this._pitchVel, clamp(accelLong * 0.012, -0.06, 0.05), 26, 5.5, dt);
    this.pitch = pitchNext[0]; this._pitchVel = pitchNext[1];
    const rollNext = stepSpring(this.roll, this._rollVel, clamp(-accelLat * 0.016, -0.09, 0.09), 26, 5.5, dt);
    this.roll = rollNext[0]; this._rollVel = rollNext[1];
    return this;
  }
}
