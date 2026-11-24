// Pedestrians (WO Task 9): sidewalk wander, flee on threat, gunpoint robbery
// compliance (aim 1.5 s within 6 m -> hands up, wallet $50-$250, then flee).
import { clamp, dist2 } from '../rng.js';
import { roadCenters, CITY_HALF, collideBuildings } from './world.js';
import { CAR_COLORS } from './traffic.js';

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
    color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
    state: 'walk', t: rng.range(2, 6), cash: rng.int(50, 250), robbed: false, aimTime: 0,
  };
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
  p.t -= dt;
  if (p.t <= 0) { p.dir *= -1; p.t = s.rng.range(3, 8); }
  const v = p.speed * p.dir;
  if (p.horiz) { p.x += v * dt; p.ry = v > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { p.z += v * dt; p.ry = v > 0 ? 0 : Math.PI; }
  if (Math.abs(p.x) > CITY_HALF || Math.abs(p.z) > CITY_HALF) p.dir *= -1;
  const [nx, nz] = collideBuildings(s.city, p.x, p.z, 0.5);
  p.x = nx; p.z = nz;
}
