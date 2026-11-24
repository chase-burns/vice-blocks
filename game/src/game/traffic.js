// traffic.js — the ambient vehicle pool. Traffic cars follow their
// lanes, brake for anything in front of them and turn around at the city
// edge; parked cars sit at the kerb waiting to be stolen. Ambient cars
// are purely kinematic — the full physics model is reserved for the
// player's car. damageCar lives here too, as the one place where vehicle
// hit points are allowed to change.
import { clamp, dist2 } from '../rng.js';
import { roadCenters, CITY_HALF } from './world.js';

export const CAR_COLORS = [
  [0.9, 0.2, 0.3], [0.2, 0.5, 0.95], [0.95, 0.8, 0.2], [0.3, 0.9, 0.5],
  [0.95, 0.95, 0.95], [0.25, 0.25, 0.3], [1.0, 0.5, 0.15], [0.7, 0.3, 0.9],
];
const TAXI_YELLOW = [0.98, 0.78, 0.15];

function laneHeading(horizontal, dir) {
  if (horizontal) return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

export function spawnTraffic(rng, n) {
  const total = n === undefined ? 16 : n;
  const centers = roadCenters(), cars = [];
  for (let i = 0; i < total; i++) {
    const horiz = rng.chance(0.5);
    const road = centers[rng.int(1, centers.length - 2)];
    const dir = rng.chance(0.5) ? 1 : -1;
    const alongRoad = rng.range(-CITY_HALF, CITY_HALF);
    const lanePos = road + dir * 3.6;
    cars.push({
      id: i, kind: 'traffic', x: horiz ? alongRoad : lanePos, z: horiz ? lanePos : alongRoad,
      ry: laneHeading(horiz, dir), speed: 0, targetSpeed: rng.range(9.5, 12.5),
      horiz, road, dir,
      color: rng.chance(0.14) ? TAXI_YELLOW.slice() : CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: true, stopped: 0, style: 'sedan',
    });
  }
  return cars;
}

export function spawnParked(rng, n) {
  const total = n === undefined ? 10 : n;
  const centers = roadCenters(), cars = [];
  for (let i = 0; i < total; i++) {
    const road = centers[rng.int(0, centers.length - 1)];
    const horiz = rng.chance(0.5);
    const alongRoad = rng.range(-CITY_HALF + 10, CITY_HALF - 10);
    const kerbSide = rng.chance(0.5) ? 6.4 : -6.4;
    cars.push({
      id: 100 + i, kind: 'parked', x: horiz ? alongRoad : road + kerbSide, z: horiz ? road + kerbSide : alongRoad,
      ry: horiz ? Math.PI / 2 : 0, speed: 0, targetSpeed: 11, horiz, road, dir: 1,
      color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: false, stopped: 0, style: 'sedan',
    });
  }
  return cars;
}

// Does `other` sit ahead of `car`, inside the scan corridor?
function isAhead(car, other, corridorWidth) {
  if (!other || other === car) return false;
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
  const dx = other.x - car.x, dz = other.z - car.z;
  const forwardDist = dx * fx + dz * fz, sideDist = dx * fz - dz * fx;
  return forwardDist > 2 && forwardDist < 9 && Math.abs(sideDist) < corridorWidth;
}

export function stepTrafficCar(s, car, dt) {
  if (car.kind === 'dead') return;
  let obstructed = false;
  for (const o of s.cars) if (isAhead(car, o, 2.4)) obstructed = true;
  for (const cop of s.cops) if (isAhead(car, cop, 2.4)) obstructed = true;
  if (s.player.inCar) { if (isAhead(car, s.player.inCar, 2.4)) obstructed = true; }
  else if (isAhead(car, s.player, 1.6)) obstructed = true;
  car.stopped = obstructed ? car.stopped + dt : 0;
  const goalSpeed = obstructed ? 0 : car.targetSpeed;
  car.speed += clamp(goalSpeed - car.speed, -22 * dt, 7 * dt);
  car.x += Math.sin(car.ry) * car.speed * dt;
  car.z += Math.cos(car.ry) * car.speed * dt;
  const edge = CITY_HALF - 6;
  if (Math.abs(car.x) > edge || Math.abs(car.z) > edge) {
    car.ry += Math.PI;
    car.x = clamp(car.x, -edge, edge); car.z = clamp(car.z, -edge, edge);
    car.horiz = !car.horiz;
  }
  const centers = roadCenters();
  let nearestCenter = centers[0], nearestGap = Infinity;
  for (const c of centers) {
    const gap = Math.abs((car.horiz ? car.z : car.x) - c);
    if (gap < nearestGap) { nearestGap = gap; nearestCenter = c; }
  }
  if (car.horiz) car.z += clamp((nearestCenter + car.dir * 3.6) - car.z, -3 * dt, 3 * dt);
  else {
    const laneOffset = (car.ry > Math.PI / 2 || car.ry < -Math.PI / 2) ? -3.6 : 3.6;
    car.x += clamp((nearestCenter + laneOffset) - car.x, -3 * dt, 3 * dt);
  }
}

// Teleport a far-away traffic car onto a lane near the player. state.js
// decides when local density has dropped enough to need this.
export function placeCarNear(s, car, rng) {
  const centers = roadCenters(), p = s.player;
  const horiz = rng.chance(0.5);
  let chosenRoad = centers[0], bestGap = Infinity;
  for (const c of centers) {
    const gap = Math.abs((horiz ? p.z : p.x) - c);
    if (gap < bestGap) { bestGap = gap; chosenRoad = c; }
  }
  const dir = rng.chance(0.65) ? 1 : -1;
  const distanceAhead = rng.range(22, 48);
  const facing = p.inCar ? p.inCar.ry : p.ry;
  const forwardComponent = horiz ? Math.sin(facing) : Math.cos(facing);
  const alongRoad = clamp((horiz ? p.x : p.z) + forwardComponent * distanceAhead * dir, -CITY_HALF + 8, CITY_HALF - 8);
  const lanePos = chosenRoad + dir * 3.6;
  car.horiz = horiz; car.road = chosenRoad; car.dir = dir;
  car.x = horiz ? alongRoad : lanePos; car.z = horiz ? lanePos : alongRoad;
  car.ry = laneHeading(horiz, dir); car.speed = car.targetSpeed * 0.7;
  return car;
}

export function damageCar(s, car, dmg) {
  car.hp -= dmg;
  car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
  if (car.hp <= 0 && car.kind !== 'dead') {
    car.kind = 'dead'; car.speed = 0;
    if (car.phys) { car.phys.u = 0; car.phys.v = 0; }
    s.events.push({ name: 'explode', data: car });
    if (car === s.player.inCar) s.events.push({ name: 'hurt', data: 45 });
  }
}

export { dist2 };
