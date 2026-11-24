// traffic.js — civilian cars that live on the avenue grid. Each car
// follows a lane (offset to its right of the road centre) from
// intersection waypoint to intersection waypoint, choosing a new exit
// at each crossing, slowing for the car in front. Bodies come in
// sedan, taxi and sport flavours; the drawing lives in main.js.

import { createRng, clamp, dist2, turnToward } from '../rng.js';
import { ROAD, PITCH, roadCenters } from './world.js';

let nextCarId = 1;

const PAINTS = [
  [0.85, 0.45, 0.35], [0.45, 0.65, 0.85], [0.9, 0.8, 0.45], [0.55, 0.8, 0.6],
  [0.8, 0.6, 0.85], [0.92, 0.92, 0.94], [0.35, 0.4, 0.5], [0.95, 0.6, 0.25],
];

export function makeCar(rng, style) {
  const carStyle = style || (rng.chance(0.22) ? 'taxi' : rng.chance(0.3) ? 'sport' : 'sedan');
  return {
    id: nextCarId++,
    kind: 'traffic',
    style: carStyle,
    color: carStyle === 'taxi' ? [0.98, 0.78, 0.2] : PAINTS[rng.int(0, PAINTS.length - 1)],
    x: 0, z: 0, ry: 0,
    speed: 0, steer: 0, phys: null,
    gear: 3, rpm: 0.4, slip: 0, isDrifting: false,
    hp: 100, smoke: 0, burning: 0, exploded: false,
    roadblock: false, _spin: 0, _dispA: 0,
    cruise: rng.range(8, 12.5),
    wp: null,
  };
}

// The lane point for a car travelling `dir` (+1/-1) along `axis`
// ('v' = along z on road x=road, 'h' = along x on road z=road).
function lanePoint(axis, road, along, dir) {
  const off = 2.9;
  if (axis === 'v') return { x: road + (dir > 0 ? off : -off), z: along };
  return { x: along, z: road + (dir > 0 ? -off : off) };
}

function headingFor(axis, dir) {
  if (axis === 'v') return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

export function placeCarOnGrid(rng, car) {
  const centers = roadCenters();
  const axis = rng.chance(0.5) ? 'v' : 'h';
  const road = centers[rng.int(0, centers.length - 1)];
  const dir = rng.chance(0.5) ? 1 : -1;
  const along = rng.range(-150, 150);
  const p = lanePoint(axis, road, along, dir);
  car.x = p.x; car.z = p.z;
  car.ry = headingFor(axis, dir);
  car.axis = axis; car.road = road; car.dir = dir;
  aimAtNextIntersection(car);
}

function aimAtNextIntersection(car) {
  const centers = roadCenters();
  const along = car.axis === 'v' ? car.z : car.x;
  let best = null;
  for (const c of centers) {
    const d = (c - along) * car.dir;
    if (d > 4 && (best === null || d < best.d)) best = { c, d };
  }
  const target = best ? best.c : along + car.dir * PITCH;
  const p = lanePoint(car.axis, car.road, target, car.dir);
  car.wp = { x: p.x, z: p.z, intersection: target };
}

function chooseExit(rng, car) {
  // At an intersection: go straight, or swing onto the crossing road.
  const turn = rng.pick(['straight', 'straight', 'left', 'right']);
  const cross = car.wp.intersection;
  if (turn === 'straight') {
    aimAtNextIntersection(car);
    return;
  }
  const newAxis = car.axis === 'v' ? 'h' : 'v';
  const newRoad = cross;
  // Left/right relative to travel direction picks the new travel sign.
  const turnSign = turn === 'left' ? -1 : 1;
  let newDir;
  if (car.axis === 'v') newDir = car.dir * turnSign;       // heading rotates
  else newDir = -car.dir * turnSign;
  car.axis = newAxis;
  car.road = newRoad;
  car.dir = newDir;
  aimAtNextIntersection(car);
}

export function spawnTraffic(state, count) {
  const rng = createRng(state.seed * 31 + 7);
  for (let i = 0; i < count; i++) {
    const car = makeCar(rng);
    placeCarOnGrid(rng, car);
    if (dist2(car.x, car.z, state.player.x, state.player.z) < 20 * 20) {
      car.z += 40; // keep the spawn pad clear
    }
    state.cars.push(car);
  }
}

export function stepTraffic(state, dt) {
  const rng = state.rng;
  const all = state.cars.concat(state.cops);
  for (const car of state.cars) {
    if (car.exploded) { car.speed = 0; continue; }
    if (!car.wp) { placeCarOnGrid(rng, car); continue; }
    // Gap to the nearest vehicle ahead in roughly our direction.
    let gap = Infinity;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    for (const other of all) {
      if (other === car) continue;
      const dx = other.x - car.x, dz = other.z - car.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < gap && side < 2.6) gap = ahead;
    }
    if (state.player.inCar) {
      const pc = state.player.inCar;
      const dx = pc.x - car.x, dz = pc.z - car.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < gap && side < 2.6) gap = ahead;
    }
    let targetSpeed = car.cruise;
    if (gap < 7) targetSpeed = 0;
    else if (gap < 13) targetSpeed = car.cruise * 0.45;
    const want = Math.atan2(car.wp.x - car.x, car.wp.z - car.z);
    const err = Math.abs(((want - car.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (err > 0.4) targetSpeed = Math.min(targetSpeed, 4.5); // slow for the swing
    car.speed += clamp(targetSpeed - car.speed, -16 * dt * 4, 5.5 * dt * 4) * 0.25;
    car.speed = clamp(car.speed + clamp(targetSpeed - car.speed, -dt * 9, dt * 4), 0, 14);
    car.ry = turnToward(car.ry, want, dt * 1.5);
    car.steer = clamp(((want - car.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.5, 0.5);
    car.x += Math.sin(car.ry) * car.speed * dt;
    car.z += Math.cos(car.ry) * car.speed * dt;
    car.rpm = 0.3 + clamp(Math.abs(car.speed) / 14, 0, 1) * 0.5;
    car.gear = 1 + Math.floor(clamp(Math.abs(car.speed) / 14, 0, 0.99) * 4);
    if (dist2(car.x, car.z, car.wp.x, car.wp.z) < 5 * 5) chooseExit(rng, car);
  }
}
