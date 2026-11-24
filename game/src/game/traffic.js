// Ambient traffic (WO Task 9): lane-following pool, bumper-distance braking,
// edge U-turns. Cars are kinematic; the player's car uses physics.js instead.
import { makeRng, clamp, dist2 } from '../rng.js';
import { roadCenters, CITY_HALF } from './world.js';

export const CAR_COLORS = [
  [0.9, 0.2, 0.3], [0.2, 0.5, 0.95], [0.95, 0.8, 0.2], [0.3, 0.9, 0.5],
  [0.95, 0.95, 0.95], [0.25, 0.25, 0.3], [1.0, 0.5, 0.15], [0.7, 0.3, 0.9],
];

export function spawnTraffic(rng, n = 16) {
  const centers = roadCenters();
  const cars = [];
  for (let i = 0; i < n; i++) {
    const horiz = rng.chance(0.5);
    const road = centers[rng.int(1, centers.length - 2)];
    const dir = rng.chance(0.5) ? 1 : -1;
    const t = rng.range(-CITY_HALF, CITY_HALF);
    const lane = road + dir * 3.6;
    cars.push({
      id: i, kind: 'traffic',
      x: horiz ? t : lane, z: horiz ? lane : t,
      ry: horiz ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
      speed: 0, targetSpeed: rng.range(9.5, 12.5), horiz, road, dir,
      color: rng.chance(0.14) ? [0.98, 0.78, 0.15] : CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)], // some taxis
      hp: 100, smoke: 0, driver: true, stopped: 0,
    });
  }
  return cars;
}
export function spawnParked(rng, n = 10) {
  const centers = roadCenters();
  const cars = [];
  for (let i = 0; i < n; i++) {
    const road = centers[rng.int(0, centers.length - 1)];
    const horiz = rng.chance(0.5);
    const t = rng.range(-CITY_HALF + 10, CITY_HALF - 10);
    const side = rng.chance(0.5) ? 6.4 : -6.4;
    cars.push({
      id: 100 + i, kind: 'parked',
      x: horiz ? t : road + side, z: horiz ? road + side : t,
      ry: horiz ? Math.PI / 2 : 0, speed: 0, targetSpeed: 11,
      horiz, road, dir: 1, color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: false, stopped: 0,
    });
  }
  return cars;
}

export function stepTrafficCar(s, c, dt) {
  if (c.kind === 'dead') return;
  let blocked = false;
  const fx = Math.sin(c.ry), fz = Math.cos(c.ry);
  const ahead = (o, r) => {
    const dx = o.x - c.x, dz = o.z - c.z;
    const along = dx * fx + dz * fz;
    return along > 2 && along < 9 && Math.abs(dx * fz - dz * fx) < r;
  };
  for (const o of s.cars) if (o !== c && ahead(o, 2.4)) blocked = true;
  for (const o of s.cops) if (ahead(o, 2.4)) blocked = true;
  if (s.player.inCar && ahead(s.player.inCar, 2.4)) blocked = true;
  if (!s.player.inCar && ahead(s.player, 1.6)) blocked = true;
  c.stopped = blocked ? c.stopped + dt : 0;
  const want = blocked ? 0 : c.targetSpeed;
  c.speed += clamp(want - c.speed, -22 * dt, 7 * dt);
  c.x += fx * c.speed * dt;
  c.z += fz * c.speed * dt;
  const lim = CITY_HALF - 6;
  if (Math.abs(c.x) > lim || Math.abs(c.z) > lim) {
    c.ry += Math.PI;
    c.x = clamp(c.x, -lim, lim); c.z = clamp(c.z, -lim, lim);
    c.horiz = !c.horiz;
  }
  const centers = roadCenters();
  let near = centers[0], nd = 1e9;
  for (const cc of centers) { const d = Math.abs((c.horiz ? c.z : c.x) - cc); if (d < nd) { nd = d; near = cc; } }
  if (c.horiz) c.z += clamp((near + c.dir * 3.6) - c.z, -3 * dt, 3 * dt);
  else c.x += clamp((near + (c.ry > Math.PI / 2 || c.ry < -Math.PI / 2 ? -3.6 : 3.6)) - c.x, -3 * dt, 3 * dt);
}

export function damageCar(s, car, dmg) {
  car.hp -= dmg;
  car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
  if (car.hp <= 0 && car.kind !== 'dead') {
    s.events.push({ name: 'explode', data: car });
    if (car === s.player.inCar) s.events.push({ name: 'hurt', data: 45 });
    car.kind = 'dead'; car.speed = 0;
    if (car.phys) { car.phys.u = 0; car.phys.v = 0; }
  }
}
