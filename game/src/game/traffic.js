// traffic.js — the ambient vehicle pool. Traffic cars follow their
// lanes, brake for anything ahead of them and turn around at the city
// edge; parked cars wait at the kerb to be stolen. Ambient cars are
// purely kinematic — the full physics model is reserved for the
// player's car. damageCar lives here too, as the single place where
// vehicle hit points are allowed to change.
import { clamp, dist2 } from '../rng.js';
import { roadCenters, CITY_HALF } from './world.js';

export const CAR_COLORS = [
  [0.9, 0.2, 0.3], [0.2, 0.5, 0.95], [0.95, 0.8, 0.2], [0.3, 0.9, 0.5],
  [0.95, 0.95, 0.95], [0.25, 0.25, 0.3], [1.0, 0.5, 0.15], [0.7, 0.3, 0.9],
];
const CAB_YELLOW = [0.98, 0.78, 0.15];

function headingFor(horizontal, dir) {
  if (horizontal) return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

export function spawnTraffic(rng, n) {
  const count = n === undefined ? 16 : n;
  const lines = roadCenters(), fleet = [];
  for (let i = 0; i < count; i++) {
    const horiz = rng.chance(0.5);
    const road = lines[rng.int(1, lines.length - 2)];
    const dir = rng.chance(0.5) ? 1 : -1;
    const along = rng.range(-CITY_HALF, CITY_HALF);
    const lane = road + dir * 3.6;
    fleet.push({
      id: i, kind: 'traffic', x: horiz ? along : lane, z: horiz ? lane : along,
      ry: headingFor(horiz, dir), speed: 0, targetSpeed: rng.range(9.5, 12.5),
      horiz, road, dir,
      color: rng.chance(0.14) ? CAB_YELLOW.slice() : CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: true, stopped: 0, style: 'sedan',
    });
  }
  return fleet;
}

export function spawnParked(rng, n) {
  const count = n === undefined ? 10 : n;
  const lines = roadCenters(), fleet = [];
  for (let i = 0; i < count; i++) {
    const road = lines[rng.int(0, lines.length - 1)];
    const horiz = rng.chance(0.5);
    const along = rng.range(-CITY_HALF + 10, CITY_HALF - 10);
    const kerb = rng.chance(0.5) ? 6.4 : -6.4;
    fleet.push({
      id: 100 + i, kind: 'parked', x: horiz ? along : road + kerb, z: horiz ? road + kerb : along,
      ry: horiz ? Math.PI / 2 : 0, speed: 0, targetSpeed: 11, horiz, road, dir: 1,
      color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: false, stopped: 0, style: 'sedan',
    });
  }
  return fleet;
}

// Is `other` in front of `car`, inside the scan corridor?
function blocksPath(car, other, corridorHalf) {
  if (!other || other === car) return false;
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
  const dx = other.x - car.x, dz = other.z - car.z;
  const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
  return ahead > 2 && ahead < 9 && Math.abs(side) < corridorHalf;
}

export function stepTrafficCar(s, car, dt) {
  if (car.kind === 'dead') return;
  let blocked = false;
  for (const o of s.cars) if (blocksPath(car, o, 2.4)) blocked = true;
  for (const cop of s.cops) if (blocksPath(car, cop, 2.4)) blocked = true;
  if (s.player.inCar) { if (blocksPath(car, s.player.inCar, 2.4)) blocked = true; }
  else if (blocksPath(car, s.player, 1.6)) blocked = true;
  car.stopped = blocked ? car.stopped + dt : 0;
  const wanted = blocked ? 0 : car.targetSpeed;
  car.speed += clamp(wanted - car.speed, -22 * dt, 7 * dt);
  car.x += Math.sin(car.ry) * car.speed * dt;
  car.z += Math.cos(car.ry) * car.speed * dt;
  const edgeLimit = CITY_HALF - 6;
  if (Math.abs(car.x) > edgeLimit || Math.abs(car.z) > edgeLimit) {
    car.ry += Math.PI;
    car.x = clamp(car.x, -edgeLimit, edgeLimit); car.z = clamp(car.z, -edgeLimit, edgeLimit);
    car.horiz = !car.horiz;
  }
  const lines = roadCenters();
  let closestLine = lines[0], closestGap = Infinity;
  for (const c of lines) {
    const gap = Math.abs((car.horiz ? car.z : car.x) - c);
    if (gap < closestGap) { closestGap = gap; closestLine = c; }
  }
  if (car.horiz) car.z += clamp((closestLine + car.dir * 3.6) - car.z, -3 * dt, 3 * dt);
  else {
    const laneOff = (car.ry > Math.PI / 2 || car.ry < -Math.PI / 2) ? -3.6 : 3.6;
    car.x += clamp((closestLine + laneOff) - car.x, -3 * dt, 3 * dt);
  }
}

// Teleport a distant traffic car onto a lane near the player. state.js
// decides when local density has dropped enough to need this.
export function placeCarNear(s, car, rng) {
  const lines = roadCenters(), p = s.player;
  const horiz = rng.chance(0.5);
  let roadPick = lines[0], roadGap = Infinity;
  for (const c of lines) {
    const gap = Math.abs((horiz ? p.z : p.x) - c);
    if (gap < roadGap) { roadGap = gap; roadPick = c; }
  }
  const dir = rng.chance(0.65) ? 1 : -1;
  const aheadDist = rng.range(22, 48);
  const facing = p.inCar ? p.inCar.ry : p.ry;
  const facingComponent = horiz ? Math.sin(facing) : Math.cos(facing);
  const along = clamp((horiz ? p.x : p.z) + facingComponent * aheadDist * dir, -CITY_HALF + 8, CITY_HALF - 8);
  const lane = roadPick + dir * 3.6;
  car.horiz = horiz; car.road = roadPick; car.dir = dir;
  car.x = horiz ? along : lane; car.z = horiz ? lane : along;
  car.ry = headingFor(horiz, dir); car.speed = car.targetSpeed * 0.7;
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
