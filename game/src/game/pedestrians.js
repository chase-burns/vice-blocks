// pedestrians.js — the people on the sidewalks, each a small state
// machine: stroll along a pavement, sometimes cross the road, flee from
// danger (a fast car, nearby gunfire, an aimed weapon), and — held at
// close gunpoint long enough — put their hands up and drop a wallet
// pickup. Clothing colours are deliberately bright, so a pedestrian
// still reads as a person at screenshot size.
import { clamp, dist2 } from '../rng.js';
import { roadCenters, CITY_HALF, collideBuildings } from './world.js';

export const PED_COLORS = [
  [0.98, 0.45, 0.35], [0.25, 0.75, 0.85], [0.98, 0.85, 0.30], [0.95, 0.55, 0.75],
  [0.45, 0.90, 0.55], [0.98, 0.98, 0.95], [0.55, 0.45, 0.95], [0.98, 0.65, 0.25],
  [0.30, 0.55, 0.98], [0.90, 0.30, 0.45], [0.35, 0.85, 0.65], [0.95, 0.75, 0.55],
];
export const PANTS = [
  [0.20, 0.26, 0.45], [0.85, 0.80, 0.68], [0.16, 0.16, 0.18],
  [0.55, 0.42, 0.30], [0.92, 0.92, 0.90], [0.35, 0.45, 0.30],
];
export const SKINS = [
  [0.98, 0.80, 0.64], [0.88, 0.66, 0.48], [0.68, 0.47, 0.32], [0.48, 0.32, 0.21],
];

export function spawnPed(s, rng) {
  void s;
  const lines = roadCenters();
  const road = lines[rng.int(0, lines.length - 1)];
  const horiz = rng.chance(0.5);
  const along = rng.range(-CITY_HALF, CITY_HALF);
  const sideOff = (rng.chance(0.5) ? 1 : -1) * rng.range(8.6, 10.5);
  return {
    x: horiz ? along : road + sideOff, z: horiz ? road + sideOff : along,
    ry: rng.range(0, Math.PI * 2), speed: rng.range(1.2, 1.6),
    horiz, road, side: sideOff, dir: rng.chance(0.5) ? 1 : -1,
    color: PED_COLORS[rng.int(0, PED_COLORS.length - 1)],
    pants: PANTS[rng.int(0, PANTS.length - 1)],
    skin: SKINS[rng.int(0, SKINS.length - 1)],
    state: 'walk', t: rng.range(2, 6), cash: rng.int(50, 250), robbed: false, aimTime: 0,
  };
}

// Move a far-away walker onto a sidewalk 20–52 m from the player.
export function placePedNear(s, ped, rng) {
  const lines = roadCenters(), p = s.player;
  let roadNearX = lines[0], roadNearZ = lines[0], bestX = Infinity, bestZ = Infinity;
  for (const c of lines) {
    const dx = Math.abs(p.x - c); if (dx < bestX) { bestX = dx; roadNearX = c; }
    const dz = Math.abs(p.z - c); if (dz < bestZ) { bestZ = dz; roadNearZ = c; }
  }
  const horiz = rng.chance(0.5);
  const shift = rng.range(20, 52) * (rng.chance(0.5) ? 1 : -1);
  const sideOff = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.4);
  if (horiz) { ped.x = clamp(p.x + shift, -CITY_HALF, CITY_HALF); ped.z = roadNearZ + sideOff; ped.road = roadNearZ; }
  else { ped.x = roadNearX + sideOff; ped.z = clamp(p.z + shift, -CITY_HALF, CITY_HALF); ped.road = roadNearX; }
  ped.horiz = horiz; ped.side = sideOff; ped.state = 'walk'; ped.t = rng.range(3, 7);
  ped.dir = rng.chance(0.5) ? 1 : -1;
  return ped;
}

function feelsThreatened(s, ped) {
  const pl = s.player;
  if (pl.inCar && dist2(ped.x, ped.z, pl.inCar.x, pl.inCar.z) < 12 * 12 && (pl.inCar.velSpeed || 0) > 6) return true;
  if (pl.aim && dist2(ped.x, ped.z, pl.x, pl.z) < 10 * 10) return true;
  if (s.gunfireT > 0 && dist2(ped.x, ped.z, s.gunfireX, s.gunfireZ) < 30 * 30) return true;
  return false;
}

function pushOutOfBuildings(s, ped) {
  const solved = collideBuildings(s.city, ped.x, ped.z, 0.5);
  ped.x = solved[0]; ped.z = solved[1];
}

export function stepPed(s, ped, dt) {
  if (ped.state === 'dead') { ped.t -= dt; return; }
  const pl = s.player;
  const scared = feelsThreatened(s, ped);
  if (scared && ped.state !== 'robbed' && ped.state !== 'handsup') ped.state = 'flee';
  const gunpoint = pl.aim && s.hasGun && !pl.inCar && !ped.robbed && dist2(ped.x, ped.z, pl.x, pl.z) < 6 * 6;
  if (gunpoint) {
    ped.aimTime += dt; ped.state = 'handsup';
    if (ped.aimTime >= 1.5) {
      ped.robbed = true; ped.state = 'robbed'; ped.t = 1.6;
      s.pickups.push({ x: ped.x, z: ped.z, cash: ped.cash, t: 25 });
      s.events.push({ name: 'robDrop', data: ped.cash });
      s.wantedAPI.add(s, 1, true);
    }
  } else ped.aimTime = Math.max(0, ped.aimTime - dt * 2);
  if (ped.state === 'handsup') return;
  if (ped.state === 'flee') {
    const danger = s.gunfireT > 0 ? { x: s.gunfireX, z: s.gunfireZ } : (pl.inCar || pl);
    const dx = ped.x - danger.x, dz = ped.z - danger.z, len = Math.hypot(dx, dz) || 1;
    ped.x += (dx / len) * 5.2 * dt; ped.z += (dz / len) * 5.2 * dt;
    ped.ry = Math.atan2(dx, dz); ped.t -= dt;
    if (ped.t < -3 && !scared) ped.state = 'walk';
    pushOutOfBuildings(s, ped); return;
  }
  if (ped.state === 'robbed') {
    ped.t -= dt;
    if (ped.t <= 0) { ped.state = 'flee'; ped.t = 2; }
    return;
  }
  if (ped.state === 'cross') {
    const offNow = ped.horiz ? ped.z - ped.road : ped.x - ped.road;
    const stepSize = Math.sign(-ped.side - offNow) * 1.5 * dt;
    if (ped.horiz) { ped.z += stepSize; ped.ry = stepSize > 0 ? 0 : Math.PI; }
    else { ped.x += stepSize; ped.ry = stepSize > 0 ? Math.PI / 2 : -Math.PI / 2; }
    const offAfter = ped.horiz ? ped.z - ped.road : ped.x - ped.road;
    if (Math.abs(offAfter - (-ped.side)) < 0.6) { ped.side = -ped.side; ped.state = 'walk'; ped.t = s.rng.range(3, 7); }
    return;
  }
  ped.t -= dt;
  if (ped.t <= 0) {
    if (s.rng.chance(0.22)) { ped.state = 'cross'; return; }
    ped.dir *= -1; ped.t = s.rng.range(3, 8);
  }
  const pace = ped.speed * ped.dir;
  if (ped.horiz) { ped.x += pace * dt; ped.ry = pace > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { ped.z += pace * dt; ped.ry = pace > 0 ? 0 : Math.PI; }
  if (Math.abs(ped.x) > CITY_HALF || Math.abs(ped.z) > CITY_HALF) ped.dir *= -1;
  pushOutOfBuildings(s, ped);
}
