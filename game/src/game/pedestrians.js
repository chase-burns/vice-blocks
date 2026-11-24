// pedestrians.js — the people on the sidewalks, each a small state
// machine: stroll along a pavement, occasionally cross the road, flee
// from danger (a fast car, nearby gunfire, an aimed weapon), and — held
// at close gunpoint long enough — put their hands up and drop a wallet
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
  const centers = roadCenters();
  const road = centers[rng.int(0, centers.length - 1)];
  const horiz = rng.chance(0.5);
  const alongRoad = rng.range(-CITY_HALF, CITY_HALF);
  const pavementSide = (rng.chance(0.5) ? 1 : -1) * rng.range(8.6, 10.5);
  return {
    x: horiz ? alongRoad : road + pavementSide, z: horiz ? road + pavementSide : alongRoad,
    ry: rng.range(0, Math.PI * 2), speed: rng.range(1.2, 1.6),
    horiz, road, side: pavementSide, dir: rng.chance(0.5) ? 1 : -1,
    color: PED_COLORS[rng.int(0, PED_COLORS.length - 1)],
    pants: PANTS[rng.int(0, PANTS.length - 1)],
    skin: SKINS[rng.int(0, SKINS.length - 1)],
    state: 'walk', t: rng.range(2, 6), cash: rng.int(50, 250), robbed: false, aimTime: 0,
  };
}

// Move a far-away walker onto a sidewalk 20–52 m from the player.
export function placePedNear(s, ped, rng) {
  const centers = roadCenters(), p = s.player;
  let nearestRoadX = centers[0], nearestRoadZ = centers[0], gapX = Infinity, gapZ = Infinity;
  for (const c of centers) {
    const dx = Math.abs(p.x - c); if (dx < gapX) { gapX = dx; nearestRoadX = c; }
    const dz = Math.abs(p.z - c); if (dz < gapZ) { gapZ = dz; nearestRoadZ = c; }
  }
  const horiz = rng.chance(0.5);
  const offset = rng.range(20, 52) * (rng.chance(0.5) ? 1 : -1);
  const side = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.4);
  if (horiz) { ped.x = clamp(p.x + offset, -CITY_HALF, CITY_HALF); ped.z = nearestRoadZ + side; ped.road = nearestRoadZ; }
  else { ped.x = nearestRoadX + side; ped.z = clamp(p.z + offset, -CITY_HALF, CITY_HALF); ped.road = nearestRoadX; }
  ped.horiz = horiz; ped.side = side; ped.state = 'walk'; ped.t = rng.range(3, 7);
  ped.dir = rng.chance(0.5) ? 1 : -1;
  return ped;
}

function isThreatened(s, ped) {
  const pl = s.player;
  if (pl.inCar && dist2(ped.x, ped.z, pl.inCar.x, pl.inCar.z) < 12 * 12 && (pl.inCar.velSpeed || 0) > 6) return true;
  if (pl.aim && dist2(ped.x, ped.z, pl.x, pl.z) < 10 * 10) return true;
  if (s.gunfireT > 0 && dist2(ped.x, ped.z, s.gunfireX, s.gunfireZ) < 30 * 30) return true;
  return false;
}

function resolveBuildingOverlap(s, ped) {
  const resolved = collideBuildings(s.city, ped.x, ped.z, 0.5);
  ped.x = resolved[0]; ped.z = resolved[1];
}

export function stepPed(s, ped, dt) {
  if (ped.state === 'dead') { ped.t -= dt; return; }
  const pl = s.player;
  const threatened = isThreatened(s, ped);
  if (threatened && ped.state !== 'robbed' && ped.state !== 'handsup') ped.state = 'flee';
  const heldAtGunpoint = pl.aim && s.hasGun && !pl.inCar && !ped.robbed && dist2(ped.x, ped.z, pl.x, pl.z) < 6 * 6;
  if (heldAtGunpoint) {
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
    const threatPos = s.gunfireT > 0 ? { x: s.gunfireX, z: s.gunfireZ } : (pl.inCar || pl);
    const dx = ped.x - threatPos.x, dz = ped.z - threatPos.z, len = Math.hypot(dx, dz) || 1;
    ped.x += (dx / len) * 5.2 * dt; ped.z += (dz / len) * 5.2 * dt;
    ped.ry = Math.atan2(dx, dz); ped.t -= dt;
    if (ped.t < -3 && !threatened) ped.state = 'walk';
    resolveBuildingOverlap(s, ped); return;
  }
  if (ped.state === 'robbed') {
    ped.t -= dt;
    if (ped.t <= 0) { ped.state = 'flee'; ped.t = 2; }
    return;
  }
  if (ped.state === 'cross') {
    const offsetNow = ped.horiz ? ped.z - ped.road : ped.x - ped.road;
    const stepLen = Math.sign(-ped.side - offsetNow) * 1.5 * dt;
    if (ped.horiz) { ped.z += stepLen; ped.ry = stepLen > 0 ? 0 : Math.PI; }
    else { ped.x += stepLen; ped.ry = stepLen > 0 ? Math.PI / 2 : -Math.PI / 2; }
    const offsetAfter = ped.horiz ? ped.z - ped.road : ped.x - ped.road;
    if (Math.abs(offsetAfter - (-ped.side)) < 0.6) { ped.side = -ped.side; ped.state = 'walk'; ped.t = s.rng.range(3, 7); }
    return;
  }
  ped.t -= dt;
  if (ped.t <= 0) {
    if (s.rng.chance(0.22)) { ped.state = 'cross'; return; }
    ped.dir *= -1; ped.t = s.rng.range(3, 8);
  }
  const walkVel = ped.speed * ped.dir;
  if (ped.horiz) { ped.x += walkVel * dt; ped.ry = walkVel > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { ped.z += walkVel * dt; ped.ry = walkVel > 0 ? 0 : Math.PI; }
  if (Math.abs(ped.x) > CITY_HALF || Math.abs(ped.z) > CITY_HALF) ped.dir *= -1;
  resolveBuildingOverlap(s, ped);
}
