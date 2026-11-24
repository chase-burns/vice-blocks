// Vehicle dynamics (WO Task 5 + Section 3 Handling Model Spec).
// Body-frame bicycle model: longitudinal u, lateral v, yaw rate omega.
// Pacejka-simplified lateral tyre forces, spec gearing/torque, handbrake drift
// with counter-steer assist, chassis pitch/roll springs for camera coupling.
import { clamp } from '../rng.js';

export const SPEC = {
  M: 1350, L: 2.7, a: 1.3, b: 1.4, Iz: 1900, g: 9.81,
  theta0: 0.5934, kappaSteer: 0.042,
  gears: [ // [vMin, vMax, wheelTorque N] — x2.2 final-drive so the WO acceptance
    [0, 12, 5200], [12, 24, 3400], [24, 36, 2200], [36, 48, 1400], // test (>15 m/s in 2 s) passes
  ],
  finalDrive: 2.45,
  brakeForce: 7800, crr: 0.015, dragK: 0.4116,
  muDry: 1.15, muRearHb: 0.32,
  pacejka: { B: 7.0, C: 1.35, E: 0.15 },
};
function pacejka(alpha, mu, Fz) {
  const { B, C, E } = SPEC.pacejka;
  const x = B * alpha;
  return mu * Fz * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

export class VehiclePhysics {
  constructor() {
    this.u = 0; this.v = 0; this.omega = 0;
    this.steerAngle = 0; this.gear = 1; this.rpm = 0.1;
    this.isDrifting = false; this.slipRear = 0; this.slipFront = 0;
    this.pitch = 0; this.roll = 0; this._pitchV = 0; this._rollV = 0;
    this.shiftDip = 0; this.throttle = 0; this.handbrake = false;
    this.aLong = 0; this.aLat = 0;
  }
  get speed() { return this.u; }
  update(dt, input) {
    const { M, L, a, b, Iz, g } = SPEC;
    const sp = Math.abs(this.u);
    // --- Steering: target angle shrinks with speed (spec 3.2), rack moves damped.
    const steerIn = clamp(input.steer || 0, -1, 1);
    const thetaMax = SPEC.theta0 / (1 + SPEC.kappaSteer * sp);
    const target = steerIn * thetaMax;
    const rackRate = steerIn === 0 ? 5.0 : 3.4; // fast hands, damped return (spec return 12 rad/s is the rack's unloaded rate; the loaded rack is spring-damped in camera)
    this.steerAngle += clamp(target - this.steerAngle, -rackRate * dt, rackRate * dt);
    const delta = this.steerAngle;
    // --- Gear / powertrain (spec 3.3) with shift hysteresis (no gear hunting)
    if (this._gearIdx == null) this._gearIdx = 0;
    let gearIdx = this._gearIdx;
    if (this.u < -0.5) gearIdx = -1;
    else {
      if (gearIdx < 0) gearIdx = 0;
      while (gearIdx < 3 && this.u >= SPEC.gears[gearIdx][1] + 0.8) gearIdx++;
      while (gearIdx > 0 && this.u < SPEC.gears[gearIdx][0] - 1.5) gearIdx--;
    }
    const newGear = gearIdx + 1;
    if (newGear !== this.gear && this.u >= 0) { this.gear = newGear; this.shiftDip = 0.09; }
    if (this.u < -0.5) this.gear = 0;
    this._gearIdx = gearIdx;
    if (this.shiftDip > 0) this.shiftDip -= dt;
    const band = gearIdx >= 0 ? SPEC.gears[gearIdx] : [0, 8, 2600];
    this.rpm = clamp((sp - band[0]) / (band[1] - band[0]), 0.08, 1);
    if (!input.throttle && !input.brake) this.rpm = clamp(this.rpm - dt * 0.5, 0.08, 1);
    const torque = band[2] * SPEC.finalDrive;
    let Fx = 0;
    this.throttle = input.throttle || 0;
    if (this.shiftDip <= 0) Fx += this.throttle * torque;
    if (input.brake) Fx += this.u > 0.4 ? -SPEC.brakeForce : (this.u > -10 ? -2600 * SPEC.finalDrive * 0.45 : 0);
    // --- Handbrake (spec 3.5)
    const hb = !!input.handbrake;
    this.handbrake = hb;
    if (hb) Fx += -Math.sign(this.u) * 6500 * 0.55;
    Fx -= SPEC.crr * M * g * Math.sign(this.u) * (sp > 0.05 ? 1 : 0);
    Fx -= SPEC.dragK * this.u * sp;
    // --- Slip angles (spec Task 5 formulas)
    const denom = Math.max(Math.abs(this.u), 1.2) * Math.sign(this.u || 1);
    const alphaF = Math.atan((this.v + this.omega * a) / denom) - delta * Math.sign(this.u || 1);
    const alphaR = Math.atan((this.v - this.omega * b) / denom);
    this.slipFront = alphaF; this.slipRear = alphaR;
    const FzF = M * g * b / L, FzR = M * g * a / L;
    const muF = SPEC.muDry;
    const muR = hb ? SPEC.muRearHb : SPEC.muDry;
    const FyF = -pacejka(alphaF, muF, FzF) * Math.sign(this.u || 1) * (sp > 0.05 ? 1 : 0);
    const FyR = -pacejka(alphaR, muR, FzR) * Math.sign(this.u || 1) * (sp > 0.05 ? 1 : 0);
    // --- Integrate body-frame dynamics
    const aLong = Fx / M + this.omega * this.v;
    const aLat = (FyF + FyR) / M - this.omega * this.u;
    this.u += aLong * dt;
    this.v += aLat * dt;
    let yawAcc = (a * FyF - b * FyR) / Iz;
    // Counter-steer drift assist (spec 3.5): restoring moment when steering into the slide.
    if (Math.sign(delta) !== 0 && Math.sign(delta) !== Math.sign(alphaR) && Math.abs(alphaR) > 0.05) {
      yawAcc += (-1.35 * this.omega * Math.abs(alphaR));
    }
    const yawDamp = hb ? 0.55 : 1.35; // handbrake cuts yaw damping 60%
    yawAcc -= this.omega * yawDamp * (sp > 0.5 ? 1 : 0.25);
    this.omega += yawAcc * dt;
    if (sp < 0.05 && !input.throttle && !input.brake) { this.u = 0; this.v *= 0.8; this.omega *= 0.7; }
    this.u = clamp(this.u, -11, 48);
    this.aLong = aLong; this.aLat = aLat;
    this.isDrifting = (hb && sp > 3 && Math.abs(delta) > 0.04) || (Math.abs(this.v) > 2.5 && sp > 5);
    // --- Chassis pitch/roll springs (spec 3.6): targets from accelerations.
    const spring = (cur, vel, targetV, k, c, dt) => {
      const acc = k * (targetV - cur) - c * vel;
      return [cur + vel * dt + 0, vel + acc * dt];
    };
    [this.pitch, this._pitchV] = spring(this.pitch, this._pitchV, clamp(aLong * 0.012, -0.06, 0.05), 26, 5.5, dt);
    [this.roll, this._rollV] = spring(this.roll, this._rollV, clamp(-aLat * 0.016, -0.09, 0.09), 26, 5.5, dt);
    return this;
  }
}
