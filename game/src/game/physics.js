// physics.js — how the player's car moves. The model works in the
// body frame: forward speed u, lateral speed v and yaw rate omega,
// with Pacejka-style tyre curves at each axle, a four-speed gearbox
// with shift hysteresis, a handbrake that collapses rear grip so the
// car can be drifted, and pitch/roll springs whose state the cockpit
// camera rides on. The tuning target is eagerness: full throttle
// passes 15 m/s in under two seconds.
import { clamp } from '../rng.js';

export const SPEC = {
  mass: 1350,
  wheelbase: 2.7,
  frontAxle: 1.3,     // CG to front axle, metres
  rearAxle: 1.4,      // CG to rear axle, metres
  yawInertia: 1900,
  gravity: 9.81,
  steerLock: 0.5934,        // road-wheel angle at a standstill
  steerSpeedFade: 0.042,    // lock shrink per m/s of speed
  gears: [                  // [band low, band high, wheel torque]
    [0, 12, 5200], [12, 24, 3400], [24, 36, 2200], [36, 48, 1400],
  ],
  finalDrive: 2.45,
  brakeForce: 7800,
  rollingResistance: 0.015,
  dragK: 0.4116,
  gripDry: 1.15,
  gripRearHandbrake: 0.32,
  pacejka: { B: 7.0, C: 1.35, E: 0.15 },
};

// Simplified Pacejka lateral force for a single axle.
function tyreForce(slipAngle, grip, axleLoad) {
  const B = SPEC.pacejka.B, C = SPEC.pacejka.C, E = SPEC.pacejka.E;
  const x = B * slipAngle;
  return grip * axleLoad * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

// One damped-spring integration step; returns [value, velocity].
function spring(value, velocity, target, stiffness, damping, dt) {
  const accel = stiffness * (target - value) - damping * velocity;
  return [value + velocity * dt, velocity + accel * dt];
}

export class VehiclePhysics {
  constructor() {
    this.u = 0;
    this.v = 0;
    this.omega = 0;
    this.steerAngle = 0;
    this.gear = 1;         // 0 reverse, 1..4 forward
    this.rpm = 0.1;        // normalised across the current gear band
    this.isDrifting = false;
    this.slipFront = 0;
    this.slipRear = 0;
    this.pitch = 0;
    this.roll = 0;
    this.throttle = 0;
    this.handbrake = false;
    this.aLong = 0;
    this.aLat = 0;
    this.powerMul = 1;     // the garage engine tune raises this
    this._pitchVel = 0;
    this._rollVel = 0;
    this._shiftPause = 0;
    this._gearIndex = 0;
  }

  get speed() { return this.u; }

  // Gear choice with hysteresis: the up/down thresholds are offset so
  // the box does not hunt when the speed hovers on a boundary.
  _selectGear() {
    if (this.u < -0.5) {
      this._gearIndex = -1;
    } else {
      let gi = this._gearIndex;
      if (gi < 0) gi = 0;
      while (gi < 3 && this.u >= SPEC.gears[gi][1] + 0.8) gi++;
      while (gi > 0 && this.u < SPEC.gears[gi][0] - 1.5) gi--;
      this._gearIndex = gi;
    }
    const shown = this._gearIndex + 1;
    if (shown !== this.gear && this.u >= 0) {
      this.gear = shown;
      this._shiftPause = 0.09; // torque is cut while the shift lands
    }
    if (this.u < -0.5) this.gear = 0;
    return this._gearIndex >= 0 ? SPEC.gears[this._gearIndex] : [0, 8, 2600];
  }

  update(dt, input) {
    const M = SPEC.mass, L = SPEC.wheelbase;
    const a = SPEC.frontAxle, b = SPEC.rearAxle;
    const speedAbs = Math.abs(this.u);
    const moving = speedAbs > 0.05;
    const dirSign = Math.sign(this.u || 1);

    // Steering: lock fades with speed, and the rack chases its target
    // at a fixed rate — faster returning to centre than going to lock.
    const steerIn = clamp(input.steer || 0, -1, 1);
    const lockNow = SPEC.steerLock / (1 + SPEC.steerSpeedFade * speedAbs);
    const steerTarget = steerIn * lockNow;
    const rackRate = steerIn === 0 ? 5.0 : 3.4;
    this.steerAngle += clamp(steerTarget - this.steerAngle, -rackRate * dt, rackRate * dt);
    const delta = this.steerAngle;

    // Powertrain: gear-band torque through the final drive, brakes,
    // handbrake drag, rolling resistance and aerodynamic drag.
    const band = this._selectGear();
    if (this._shiftPause > 0) this._shiftPause -= dt;
    this.rpm = clamp((speedAbs - band[0]) / (band[1] - band[0]), 0.08, 1);
    if (!input.throttle && !input.brake) {
      this.rpm = clamp(this.rpm - dt * 0.5, 0.08, 1);
    }
    this.throttle = input.throttle || 0;
    let forceX = 0;
    if (this._shiftPause <= 0) {
      forceX += this.throttle * band[2] * SPEC.finalDrive * (this.powerMul || 1);
    }
    if (input.brake) {
      if (this.u > 0.4) forceX -= SPEC.brakeForce;
      else if (this.u > -10) forceX -= 2600 * SPEC.finalDrive * 0.45;
    }
    const handbrake = !!input.handbrake;
    this.handbrake = handbrake;
    if (handbrake) forceX -= Math.sign(this.u) * 6500 * 0.55;
    if (moving) forceX -= SPEC.rollingResistance * M * SPEC.gravity * Math.sign(this.u);
    forceX -= SPEC.dragK * this.u * speedAbs;

    // Slip angles at the two axles.
    const denom = Math.max(speedAbs, 1.2) * dirSign;
    const alphaFront = Math.atan((this.v + this.omega * a) / denom) - delta * dirSign;
    const alphaRear = Math.atan((this.v - this.omega * b) / denom);
    this.slipFront = alphaFront;
    this.slipRear = alphaRear;
    const loadFront = M * SPEC.gravity * b / L;
    const loadRear = M * SPEC.gravity * a / L;
    const gripRear = handbrake ? SPEC.gripRearHandbrake : SPEC.gripDry;
    const forceFront = moving ? -tyreForce(alphaFront, SPEC.gripDry, loadFront) * dirSign : 0;
    const forceRear = moving ? -tyreForce(alphaRear, gripRear, loadRear) * dirSign : 0;

    // Integrate the body-frame equations.
    const aLong = forceX / M + this.omega * this.v;
    const aLat = (forceFront + forceRear) / M - this.omega * this.u;
    this.u += aLong * dt;
    this.v += aLat * dt;
    let yawAccel = (a * forceFront - b * forceRear) / SPEC.yawInertia;
    // Drift assist: steering against the rear slide adds a restoring
    // yaw moment — this is what makes a counter-steered drift catch.
    const counterSteering = Math.sign(delta) !== 0
      && Math.sign(delta) !== Math.sign(alphaRear)
      && Math.abs(alphaRear) > 0.05;
    if (counterSteering) yawAccel += -1.35 * this.omega * Math.abs(alphaRear);
    const yawDamping = handbrake ? 0.55 : 1.35;
    yawAccel -= this.omega * yawDamping * (speedAbs > 0.5 ? 1 : 0.25);
    this.omega += yawAccel * dt;

    if (!moving && !input.throttle && !input.brake) {
      this.u = 0;
      this.v *= 0.8;
      this.omega *= 0.7;
    }
    this.u = clamp(this.u, -11, 48);
    this.aLong = aLong;
    this.aLat = aLat;
    this.isDrifting = (handbrake && speedAbs > 3 && Math.abs(delta) > 0.04)
      || (Math.abs(this.v) > 2.5 && speedAbs > 5);

    // Chassis attitude for the camera: pitch tracks longitudinal
    // acceleration, roll tracks lateral acceleration.
    const pitchStep = spring(this.pitch, this._pitchVel, clamp(aLong * 0.012, -0.06, 0.05), 26, 5.5, dt);
    this.pitch = pitchStep[0]; this._pitchVel = pitchStep[1];
    const rollStep = spring(this.roll, this._rollVel, clamp(-aLat * 0.016, -0.09, 0.09), 26, 5.5, dt);
    this.roll = rollStep[0]; this._rollVel = rollStep[1];
    return this;
  }
}
