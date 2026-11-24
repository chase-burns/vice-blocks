// camera.js — the two first-person cameras. The cockpit camera sits
// at the driver's head position in car space (left-hand drive: offset
// to the car's left), looks down the bonnet, widens its field of view
// with speed, and shakes in proportion to state.trauma. The foot
// camera is a plain eye-level view at the player's head.

import { clamp } from '../rng.js';

export function viewDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}

export class CameraRig {
  constructor() {
    // When set (shot mode), the cockpit FOV is pinned to this value.
    this.fovPunch = null;
  }

  cockpit(s, car, lookYaw, lookPitch, t, dt) {
    void dt;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const trauma = s.trauma || 0;
    const shakeY = Math.sin(t * 39) * 0.02 * trauma;
    const shakeR = Math.sin(t * 27 + 1) * 0.012 * trauma;
    // Driver's head: 0.30 ahead of the car origin, 0.30 to the left,
    // 1.15 up. These offsets are what put the wheel, cluster and
    // mirror in their contract positions.
    const eye = [
      car.x + fx * 0.30 + rx * (-0.30 + shakeR),
      1.15 + (s.roadJolt || 0) + shakeY,
      car.z + fz * 0.30 + rz * (-0.30 + shakeR),
    ];
    const yaw = car.ry + lookYaw + Math.sin(t * 31) * 0.006 * trauma;
    const pitch = lookPitch + Math.sin(t * 47) * 0.008 * trauma + (car.phys ? car.phys.pitch * 0.35 : 0);
    const dir = viewDir(yaw, pitch);
    const speedFrac = clamp(Math.abs(car.speed || 0) / 38.5, 0, 1);
    const fov = this.fovPunch != null ? this.fovPunch : (66 + speedFrac * 12) * Math.PI / 180;
    return {
      eye,
      center: [eye[0] + dir[0] * 10, eye[1] + dir[1] * 10, eye[2] + dir[2] * 10],
      up: [0, 1, 0],
      fov, yaw, pitch,
    };
  }

  foot(s, camYaw, pitch, t) {
    void t;
    const p = s.player;
    const eye = [p.x, 1.72, p.z];
    const dir = viewDir(camYaw, pitch);
    return {
      eye,
      center: [eye[0] + dir[0] * 10, eye[1] + dir[1] * 10, eye[2] + dir[2] * 10],
      up: [0, 1, 0],
      fov: 75 * Math.PI / 180,
      yaw: camYaw, pitch,
    };
  }
}
