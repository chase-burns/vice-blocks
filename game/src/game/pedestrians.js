// Pedestrians (WO Task 9): sidewalk wander, flee on threat, gunpoint robbery
// compliance (aim 1.5 s within 6 m -> hands up, wallet $50-$250, then flee).
import { clamp, dist2 } from '../rng.js';
import { roadCenters, CITY_HALF, collideBuildings } from './world.js';

// Bright summer clothing palette — peds must read as people, not grey dummies.
export const PED_COLORS = [
  [0.98, 0.45, 0.35], [0.25, 0.75, 0.85], [0.98, 0.85, 0.30], [0.95, 0.55, 0.75],
  [0.45, 0.90, 0.55], [0.98, 0.98, 0.95], [0.55, 0.45, 0.95], [0.98, 0.65, 0.25],
  [0.30, 0.55, 0.98], [0.90, 0.30, 0.45], [0.35, 0.85, 0.65], [0.95, 0.75, 0.55],
];

export function spawnPed(s, rng) {
  const centers = roadCenters();
  const road = centers[rng.int(0, centers.length - 1)];
  const horiz = rng.chance(0.5);
  const t = rng.range(-CITY_HALF, CITY_HALF);
  const side = (rng.chance(0.5) ? 1 : -1) * rng.range(8.6, 10.5);
  return {
    x: horiz ? t : road + side, z: horiz ? road + side : t,
    ry: rng.range(0, Math.PI * 2), speed: rng.range(1.2, 1.6),
    horiz, road, side, dir: rng.chance(0.5) ? 1 : -1,
    color: PED_COLORS[rng.int(0, PED_COLORS.length - 1)],
    state: 'walk', t: rng.range(2, 6), cash: rng.int(50, 250), robbed: false, aimTime: 0,
  };
}
// Teleport a ped onto a sidewalk 22-55 m from the player (density recycling).
export function placePedNear(s, ped, rng) {
  const centers = roadCenters();
  const p = s.player;
  let bx = centers[0], bz = centers[0], bd = 1e18;
  for (const c of centers) { const d = Math.abs(p.x - c); if (d < bd) { bd = d; bx = c; } }
  bd = 1e18;
  for (const c of centers) { const d = Math.abs(p.z - c); if (d < bd) { bd = d; bz = c; } }
  const horiz = rng.chance(0.5);
  const along = rng.range(20, 52) * (rng.chance(0.5) ? 1 : -1);
  const side = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.4);
  if (horiz) { ped.x = clamp(p.x + along, -CITY_HALF, CITY_HALF); ped.z = bz + side; ped.road = bz; }
  else { ped.x = bx + side; ped.z = clamp(p.z + along, -CITY_HALF, CITY_HALF); ped.road = bx; }
  ped.horiz = horiz; ped.side = side; ped.state = 'walk'; ped.t = rng.range(3, 7);
  ped.dir = rng.chance(0.5) ? 1 : -1;
  return ped;
}

export function stepPed(s, p, dt) {
  if (p.state === 'dead') { p.t -= dt; return; }
  const pl = s.player;
  const danger = (pl.inCar && dist2(p.x, p.z, pl.inCar.x, pl.inCar.z) < 12 * 12 && (pl.inCar.velSpeed || 0) > 6)
    || (pl.aim && dist2(p.x, p.z, pl.x, pl.z) < 10 * 10)
    || (s.gunfireT > 0 && dist2(p.x, p.z, s.gunfireX, s.gunfireZ) < 30 * 30);
  if (danger && p.state !== 'robbed' && p.state !== 'handsup') p.state = 'flee';
  // Gunpoint robbery: sustained aim at close range.
  if (pl.aim && s.hasGun && !pl.inCar && !p.robbed && dist2(p.x, p.z, pl.x, pl.z) < 6 * 6) {
    p.aimTime += dt;
    p.state = 'handsup';
    if (p.aimTime >= 1.5) {
      p.robbed = true; p.state = 'robbed'; p.t = 1.6;
      s.pickups.push({ x: p.x, z: p.z, cash: p.cash, t: 25 });
      s.events.push({ name: 'robDrop', data: p.cash });
      s.wantedAPI.add(s, 1, true);
    }
  } else p.aimTime = Math.max(0, p.aimTime - dt * 2);
  if (p.state === 'handsup') { return; }
  if (p.state === 'flee') {
    const src = pl.inCar || pl;
    const sx = s.gunfireT > 0 ? s.gunfireX : src.x, sz = s.gunfireT > 0 ? s.gunfireZ : src.z;
    const dx = p.x - sx, dz = p.z - sz;
    const d = Math.hypot(dx, dz) || 1;
    p.x += (dx / d) * 5.2 * dt; p.z += (dz / d) * 5.2 * dt;
    p.ry = Math.atan2(dx, dz);
    p.t -= dt;
    if (p.t < -3 && !danger) p.state = 'walk';
    const [nx, nz] = collideBuildings(s.city, p.x, p.z, 0.5);
    p.x = nx; p.z = nz;
    return;
  }
  if (p.state === 'robbed') { p.t -= dt; if (p.t <= 0) { p.state = 'flee'; p.t = 2; } return; }
  if (p.state === 'cross') {
    // Walk across the road to the opposite sidewalk.
    const target = -p.side;
    const cur = p.horiz ? p.z - p.road : p.x - p.road;
    const stepv = Math.sign(target - cur) * 1.5 * dt;
    if (p.horiz) { p.z += stepv; p.ry = stepv > 0 ? 0 : Math.PI; } else { p.x += stepv; p.ry = stepv > 0 ? Math.PI / 2 : -Math.PI / 2; }
    if (Math.abs((p.horiz ? p.z - p.road : p.x - p.road) - target) < 0.6) { p.side = target; p.state = 'walk'; p.t = s.rng.range(3, 7); }
    return;
  }
  p.t -= dt;
  if (p.t <= 0) {
    if (s.rng.chance(0.22)) { p.state = 'cross'; return; }
    p.dir *= -1; p.t = s.rng.range(3, 8);
  }
  const v = p.speed * p.dir;
  if (p.horiz) { p.x += v * dt; p.ry = v > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { p.z += v * dt; p.ry = v > 0 ? 0 : Math.PI; }
  if (Math.abs(p.x) > CITY_HALF || Math.abs(p.z) > CITY_HALF) p.dir *= -1;
  const [nx, nz] = collideBuildings(s.city, p.x, p.z, 0.5);
  p.x = nx; p.z = nz;
}
