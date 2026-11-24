// traffic.js — the ambient vehicle pool. Traffic cars follow lanes,
// brake for whatever is ahead of them and U-turn at the city edge;
// parked cars sit at the kerb waiting to be stolen. Ambient cars are
// kinematic — only the player's car runs the full physics model.
// damageCar also lives here: it is the single place vehicle hit
// points are allowed to change.
import { clamp, dist2 } from '../rng.js';
import { roadCenters, CITY_HALF } from './world.js';

export const CAR_COLORS = [
  [0.9, 0.2, 0.3], [0.2, 0.5, 0.95], [0.95, 0.8, 0.2], [0.3, 0.9, 0.5],
  [0.95, 0.95, 0.95], [0.25, 0.25, 0.3], [1.0, 0.5, 0.15], [0.7, 0.3, 0.9],
];
const TAXI_YELLOW = [0.98, 0.78, 0.15];

function headingFor(horiz, dir) {
  if (horiz) return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

export function spawnTraffic(rng, n) {
  const count = n === undefined ? 16 : n;
  const centers = roadCenters();
  const cars = [];
  for (let i = 0; i < count; i++) {
    const horiz = rng.chance(0.5);
    const road = centers[rng.int(1, centers.length - 2)];
    const dir = rng.chance(0.5) ? 1 : -1;
    const along = rng.range(-CITY_HALF, CITY_HALF);
    const lane = road + dir * 3.6;
    cars.push({
      id: i, kind: 'traffic',
      x: horiz ? along : lane,
      z: horiz ? lane : along,
      ry: headingFor(horiz, dir),
      speed: 0, targetSpeed: rng.range(9.5, 12.5),
      horiz, road, dir,
      color: rng.chance(0.14) ? TAXI_YELLOW.slice() : CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: true, stopped: 0, style: 'sedan',
    });
  }
  return cars;
}

export function spawnParked(rng, n) {
  const count = n === undefined ? 10 : n;
  const centers = roadCenters();
  const cars = [];
  for (let i = 0; i < count; i++) {
    const road = centers[rng.int(0, centers.length - 1)];
    const horiz = rng.chance(0.5);
    const along = rng.range(-CITY_HALF + 10, CITY_HALF - 10);
    const side = rng.chance(0.5) ? 6.4 : -6.4;
    cars.push({
      id: 100 + i, kind: 'parked',
      x: horiz ? along : road + side,
      z: horiz ? road + side : along,
      ry: horiz ? Math.PI / 2 : 0,
      speed: 0, targetSpeed: 11,
      horiz, road, dir: 1,
      color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: false, stopped: 0, style: 'sedan',
    });
  }
  return cars;
}

// True when `other` sits in front of `car`, inside the scan corridor.
function blockedAhead(s, car, other, width) {
  if (!other || other === car) return false;
  const fx = Math.sin(car.ry);
  const fz = Math.cos(car.ry);
  const dx = other.x - car.x;
  const dz = other.z - car.z;
  const along = dx * fx + dz * fz;
  const lateral = dx * fz - dz * fx;
  return along > 2 && along < 9 && Math.abs(lateral) < width;
}

export function stepTrafficCar(s, car, dt) {
  if (car.kind === 'dead') return;
  let blocked = false;
  for (const other of s.cars) if (blockedAhead(s, car, other, 2.4)) blocked = true;
  for (const cop of s.cops) if (blockedAhead(s, car, cop, 2.4)) blocked = true;
  if (s.player.inCar) {
    if (blockedAhead(s, car, s.player.inCar, 2.4)) blocked = true;
  } else if (blockedAhead(s, car, s.player, 1.6)) blocked = true;

  car.stopped = blocked ? car.stopped + dt : 0;
  const target = blocked ? 0 : car.targetSpeed;
  car.speed += clamp(target - car.speed, -22 * dt, 7 * dt);
  car.x += Math.sin(car.ry) * car.speed * dt;
  car.z += Math.cos(car.ry) * car.speed * dt;

  // At the city edge, turn around instead of leaving the world.
  const lim = CITY_HALF - 6;
  if (Math.abs(car.x) > lim || Math.abs(car.z) > lim) {
    car.ry += Math.PI;
    car.x = clamp(car.x, -lim, lim);
    car.z = clamp(car.z, -lim, lim);
    car.horiz = !car.horiz;
  }
  // Ease back toward the centre of the lane being followed.
  const centers = roadCenters();
  let nearest = centers[0];
  let nearestDist = Infinity;
  for (const c of centers) {
    const d = Math.abs((car.horiz ? car.z : car.x) - c);
    if (d < nearestDist) { nearestDist = d; nearest = c; }
  }
  if (car.horiz) {
    car.z += clamp((nearest + car.dir * 3.6) - car.z, -3 * dt, 3 * dt);
  } else {
    const laneOffset = (car.ry > Math.PI / 2 || car.ry < -Math.PI / 2) ? -3.6 : 3.6;
    car.x += clamp((nearest + laneOffset) - car.x, -3 * dt, 3 * dt);
  }
}

// Move a far-away traffic car onto a lane near the player. The density
// manager in state.js decides when this recycling is needed.
export function placeCarNear(s, car, rng) {
  const centers = roadCenters();
  const p = s.player;
  const horiz = rng.chance(0.5);
  let road = centers[0];
  let best = Infinity;
  for (const c of centers) {
    const d = Math.abs((horiz ? p.z : p.x) - c);
    if (d < best) { best = d; road = c; }
  }
  const dir = rng.chance(0.65) ? 1 : -1;
  const ahead = rng.range(22, 48);
  const heading = p.inCar ? p.inCar.ry : p.ry;
  const forward = horiz ? Math.sin(heading) : Math.cos(heading);
  const along = clamp((horiz ? p.x : p.z) + forward * ahead * dir, -CITY_HALF + 8, CITY_HALF - 8);
  const lane = road + dir * 3.6;
  car.horiz = horiz;
  car.road = road;
  car.dir = dir;
  car.x = horiz ? along : lane;
  car.z = horiz ? lane : along;
  car.ry = headingFor(horiz, dir);
  car.speed = car.targetSpeed * 0.7;
  return car;
}

export function damageCar(s, car, dmg) {
  car.hp -= dmg;
  car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
  if (car.hp <= 0 && car.kind !== 'dead') {
    car.kind = 'dead';
    car.speed = 0;
    if (car.phys) { car.phys.u = 0; car.phys.v = 0; }
    s.events.push({ name: 'explode', data: car });
    if (car === s.player.inCar) s.events.push({ name: 'hurt', data: 45 });
  }
}

export { dist2 };
