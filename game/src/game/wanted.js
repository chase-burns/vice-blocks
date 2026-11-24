// wanted.js — heat, stars and the SBPD response. Crimes raise heat;
// heat floors into stars. Patrols converge and ram, at four stars a
// two-car roadblock is angled across the road ahead, and at five the
// KESTREL-1 helicopter takes up station with its spotlight. Stay out
// of sight and the heat bleeds away.

import { clamp, dist2, turnToward } from '../rng.js';
import { roadCenters } from './world.js';

let copId = 5000;

export function reportCrime(state, amount) {
  const before = state.stars;
  state.heat = clamp(state.heat + amount, 0, 5.9);
  state.stars = clamp(Math.floor(state.heat), 0, 5);
  state.lastCrimeT = state.time;
  if (state.stars !== before) state.events.push({ name: 'wanted', data: state.stars });
}

function makeCopCar(state, x, z, ry) {
  return {
    id: copId++,
    kind: 'cop', style: 'police',
    color: [0.92, 0.92, 0.95],
    x, z, ry,
    speed: 0, steer: 0, phys: null,
    gear: 3, rpm: 0.4, slip: 0, isDrifting: false,
    hp: 100, smoke: 0, burning: 0, exploded: false,
    roadblock: false, pit: false, _spin: 0, _dispA: 0, ramCd: 0,
  };
}

function roadPointNear(state, x, z) {
  const centers = roadCenters();
  let bestX = centers[0], bestD = Infinity;
  for (const c of centers) if (Math.abs(c - x) < bestD) { bestD = Math.abs(c - x); bestX = c; }
  let bestZ = centers[0]; bestD = Infinity;
  for (const c of centers) if (Math.abs(c - z) < bestD) { bestD = Math.abs(c - z); bestZ = c; }
  return Math.abs(x - bestX) < Math.abs(z - bestZ) ? { x: bestX, z } : { x, z: bestZ };
}

function spawnPatrol(state) {
  const p = state.player;
  const ang = state.rng.range(0, Math.PI * 2);
  const dist = state.rng.range(52, 68);
  const spot = roadPointNear(state, p.x + Math.sin(ang) * dist, p.z + Math.cos(ang) * dist);
  const cop = makeCopCar(state, spot.x, spot.z, Math.atan2(p.x - spot.x, p.z - spot.z));
  cop.pit = state.stars >= 3 && state.rng.chance(0.4);
  state.cops.push(cop);
}

function spawnRoadblock(state) {
  const p = state.player;
  const heading = p.inCar ? p.inCar.ry : p.ry;
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const rx = Math.cos(heading), rz = -Math.sin(heading);
  const ahead = 42;
  for (const side of [-1, 1]) {
    const x = p.x + fx * ahead + rx * side * 3.4;
    const z = p.z + fz * ahead + rz * side * 3.4;
    const cop = makeCopCar(state, x, z, heading - side * Math.PI / 4);
    cop.roadblock = true;
    state.cops.push(cop);
  }
  state.roadblockCd = 26;
  state.events.push({ name: 'roadblock', data: 0 });
}

export function stepWanted(state, dt) {
  const p = state.player;
  const px = p.inCar ? p.inCar.x : p.x;
  const pz = p.inCar ? p.inCar.z : p.z;

  // Sightings: any unit within 45m refreshes the "seen" clock; out of
  // sight long enough and heat decays.
  let seen = false;
  for (const cop of state.cops) if (dist2(cop.x, cop.z, px, pz) < 45 * 45) { seen = true; break; }
  if (state.heli && dist2(state.heli.x, state.heli.z, px, pz) < 70 * 70) seen = true;
  if (seen) state.lastSeenT = state.time;
  if (state.time - state.lastSeenT > 11 && state.stars > 0) {
    state.heat = Math.max(0, state.heat - dt * 0.045);
    state.stars = clamp(Math.floor(state.heat), 0, 5);
  }

  // Patrol strength by star level.
  const desired = [0, 2, 3, 4, 5, 6][state.stars];
  const patrols = state.cops.filter((c) => !c.roadblock);
  if (patrols.length < desired) {
    state.spawnT -= dt;
    if (state.spawnT <= 0) { spawnPatrol(state); state.spawnT = 1.4; }
  }
  // Cull units that fell far behind.
  state.cops = state.cops.filter((c) => c.roadblock || dist2(c.x, c.z, px, pz) < 130 * 130 || patrols.length <= desired);

  // Roadblocks at four stars and up.
  state.roadblockCd -= dt;
  const hasBlock = state.cops.some((c) => c.roadblock);
  if (state.stars >= 4 && !hasBlock && state.roadblockCd <= 0 && p.inCar) spawnRoadblock(state);
  if (hasBlock) {
    // A block the player has blown past is cleared away.
    state.cops = state.cops.filter((c) => !c.roadblock || dist2(c.x, c.z, px, pz) < 85 * 85);
  }

  // The helicopter at five stars.
  if (state.stars >= 5 && !state.heli) {
    state.heli = { x: px + 30, z: pz - 30, h: 27, ry: 0 };
    state.events.push({ name: 'heli', data: 0 });
  }
  if (state.stars < 5 && state.heli) state.heli = null;
  if (state.heli) {
    const heli = state.heli;
    const tx = px + Math.sin(state.time * 0.24) * 7;
    const tz = pz + Math.cos(state.time * 0.19) * 7;
    heli.x += (tx - heli.x) * Math.min(1, dt * 1.6);
    heli.z += (tz - heli.z) * Math.min(1, dt * 1.6);
    heli.h = 27 + Math.sin(state.time * 0.7) * 1.5;
    heli.ry = Math.atan2(px - heli.x, pz - heli.z);
    state.spotTarget = { x: px, z: pz };
  }

  // Pursuit driving: aim at the player's near future, drive hard,
  // and shove when alongside.
  const pvx = p.inCar ? Math.sin(p.inCar.ry) * p.inCar.speed : 0;
  const pvz = p.inCar ? Math.cos(p.inCar.ry) * p.inCar.speed : 0;
  for (const cop of state.cops) {
    if (cop.roadblock || cop.exploded) { cop.speed = 0; continue; }
    cop.ramCd -= dt;
    const aimX = px + pvx * 0.55, aimZ = pz + pvz * 0.55;
    const want = Math.atan2(aimX - cop.x, aimZ - cop.z);
    cop.ry = turnToward(cop.ry, want, dt * (cop.pit ? 1.9 : 1.5));
    const d2 = dist2(cop.x, cop.z, px, pz);
    const topSpeed = cop.pit ? 33 : 30.5;
    const target = d2 > 26 * 26 ? topSpeed : topSpeed * 0.82;
    cop.speed += clamp(target - cop.speed, -dt * 12, dt * 6.5);
    cop.steer = clamp(((want - cop.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.5, 0.5);
    cop.x += Math.sin(cop.ry) * cop.speed * dt;
    cop.z += Math.cos(cop.ry) * cop.speed * dt;
    cop.rpm = 0.45 + clamp(Math.abs(cop.speed) / 33, 0, 1) * 0.5;
    cop.gear = 1 + Math.floor(clamp(Math.abs(cop.speed) / 33, 0, 0.99) * 4);
    if (d2 < 3.4 * 3.4 && cop.ramCd <= 0 && p.inCar) {
      cop.ramCd = 0.9;
      state.events.push({ name: 'ram', data: 9 });
      damageCar(state, p.inCar, 7);
      state.trauma = Math.min(1, state.trauma + 0.35);
    }
  }
}

// Shared car-damage ladder: smoke, then fire, then the explosion the
// event system turns into noise and shrapnel.
export function damageCar(state, car, amount) {
  if (!car || car.exploded) return;
  car.hp -= amount;
  if (car.hp < 55 && car.smoke === 0) car.smoke = 1;
  if (car.hp < 26 && car.smoke === 1) { car.smoke = 2; car.burning = 2.6; }
  if (car.hp <= 0 && !car.exploded) {
    car.exploded = true;
    car.kind = 'dead';
    car.speed = 0;
    state.events.push({ name: 'explode', data: car });
  }
}
