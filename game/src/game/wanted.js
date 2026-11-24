// Wanted system (WO Task 10): witness-gated crimes with a 2.5 s dispatch
// delay, per-star cop counts, PIT/ram pursuit, roadblocks at 4 stars,
// bust meter (speed < 2 m/s, cop within 5 m, fills in 2.5 s).
import { clamp, dist2, angleLerp } from '../rng.js';
import { CITY_HALF, collideBuildings } from './world.js';
import { damageCar } from './traffic.js';

export const COP_COUNTS = { 1: 1, 2: 2, 3: 4, 4: 5, 5: 7 };

export function witnessed(s, x, z) {
  for (const p of s.peds) if (dist2(p.x, p.z, x, z) < 35 * 35) return true;
  for (const c of s.cops) if (dist2(c.x, c.z, x, z) < 60 * 60) return true;
  return s.wanted > 0;
}
export function addWanted(s, stars, wasWitnessed) {
  if (!wasWitnessed) return;
  if (stars <= s.wanted) { s.crimeHeat = Math.max(s.crimeHeat, 6 + s.wanted * 3); return; }
  // 911 dispatch delay: the raise lands 2.5 s after the witnessed crime.
  if (s.pendingStars == null || stars > s.pendingStars) { s.pendingStars = stars; s.dispatchT = 2.5; }
}
function applyPending(s, dt) {
  if (s.pendingStars != null) {
    s.dispatchT -= dt;
    if (s.dispatchT <= 0) {
      const before = s.wanted;
      s.wanted = clamp(Math.max(s.wanted, s.pendingStars), 0, 5);
      s.crimeHeat = Math.max(s.crimeHeat, 6 + s.wanted * 3);
      s.pendingStars = null;
      if (s.wanted > before) s.events.push({ name: 'wanted', data: s.wanted });
      if (s.wanted >= 4) spawnRoadblock(s);
    }
  }
}
function spawnCop(s, roadblock = false) {
  const a = s.rng.range(0, Math.PI * 2);
  const d = roadblock ? 65 : 55;
  const tx = s.player.x + Math.sin(a) * d, tz = s.player.z + Math.cos(a) * d;
  const car = {
    id: 900 + s.cops.length + Math.floor(s.rng() * 500), kind: 'cop',
    x: clamp(tx, -CITY_HALF, CITY_HALF), z: clamp(tz, -CITY_HALF, CITY_HALF),
    ry: 0, speed: 0, targetSpeed: 17 + s.wanted, hp: 120, smoke: 0, driver: true, stopped: 0,
    color: [0.95, 0.95, 0.97], roadblock,
  };
  if (roadblock) { car.ry = s.rng.range(0, Math.PI); car.speed = 0; }
  s.cops.push(car);
  s.events.push({ name: 'copSpawn' });
}
function spawnRoadblock(s) {
  // Two cruisers side by side across the road ahead of the player.
  const p = s.player;
  const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
  const rx = Math.cos(p.ry), rz = -Math.sin(p.ry);
  for (const sd of [-2.2, 2.2]) {
    s.cops.push({
      id: 990 + s.cops.length, kind: 'cop',
      x: clamp(p.x + fx * 70 + rx * sd, -CITY_HALF, CITY_HALF),
      z: clamp(p.z + fz * 70 + rz * sd, -CITY_HALF, CITY_HALF),
      ry: p.ry + Math.PI / 2, speed: 0, targetSpeed: 20, hp: 140, smoke: 0, driver: true, stopped: 0,
      color: [0.95, 0.95, 0.97], roadblock: true,
    });
  }
}
export function stepCop(s, c, dt) {
  if (c.kind === 'dead' || c === s.player.inCar) return;
  if (c.roadblock && s.wanted < 4) c.roadblock = false;
  if (c.roadblock) return; // holds the line
  const target = s.player.inCar || s.player;
  const dx = target.x - c.x, dz = target.z - c.z;
  const d = Math.hypot(dx, dz);
  const wantRy = Math.atan2(dx, dz);
  c.ry = angleLerp(c.ry, wantRy, clamp(dt * 2.2, 0, 1));
  const top = Math.min(26, 15 + s.wanted * 1.9);
  const want = d > 5 ? top : (s.player.inCar ? top * 0.55 : 0);
  c.speed += clamp(want - c.speed, -20 * dt, 9 * dt);
  let nx = c.x + Math.sin(c.ry) * c.speed * dt;
  let nz = c.z + Math.cos(c.ry) * c.speed * dt;
  [nx, nz] = collideBuildings(s.city, nx, nz, 1.6);
  if (dist2(nx, nz, target.x, target.z) < 3.2 * 3.2 && Math.abs(c.speed) > 5) {
    if (s.player.inCar) damageCar(s, s.player.inCar, 7);
    else s.playerAPI.hurt(s, 6);
    c.speed *= -0.25;
    s.events.push({ name: 'ram' });
  }
  c.x = nx; c.z = nz;
}
export function stepWanted(s, dt) {
  applyPending(s, dt);
  if (s.crimeHeat > 0) s.crimeHeat -= dt;
  else if (s.wanted > 0) {
    let seen = false;
    for (const c of s.cops) if (dist2(c.x, c.z, s.player.x, s.player.z) < 45 * 45) seen = true;
    if (!seen) {
      s.wantedDecay = (s.wantedDecay || 0) + dt;
      if (s.wantedDecay > 6) { s.wanted--; s.wantedDecay = 0; s.events.push({ name: 'wanted', data: s.wanted }); }
    } else s.wantedDecay = 0;
  }
  const wantCops = s.wanted === 0 ? 0 : COP_COUNTS[s.wanted];
  const active = s.cops.filter(c => c.kind === 'cop' && !c.roadblock).length;
  if (active < wantCops && s.rng.chance(dt * 1.5)) spawnCop(s);
  if (s.wanted === 0) { s.cops = s.cops.filter(c => c === s.player.inCar); s.bustTimer = 0; s.pendingStars = null; }
  // Bust meter bookkeeping: fill while any cop is close and player slow, else drain.
  let close = false;
  const pSpeed = s.player.inCar ? Math.abs(s.player.inCar.speed) : 0;
  if (s.wanted > 0 && pSpeed < 2) {
    for (const c of s.cops) if (c.kind === 'cop' && dist2(c.x, c.z, s.player.x, s.player.z) < 5.5 * 5.5) close = true;
  }
  if (close) s.bustTimer += dt;
  else s.bustTimer = Math.max(0, s.bustTimer - dt * 1.4);
  for (const c of [...s.cops]) stepCop(s, c, dt);
  if (s.bustTimer > 2.5 && s.mode === 'play') {
    s.mode = 'busted';
    const fine = 100 + s.wanted * 150;
    s.fine = Math.min(fine, s.cash);
    s.events.push({ name: 'busted', data: s.fine });
  }
}
