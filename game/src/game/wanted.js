// wanted.js — the law, and how it escalates. A crime only counts when
// somebody witnessed it, and a witnessed raise sits through a 2.5 s
// dispatch delay before the stars actually land. Each star level fields
// a fixed number of pursuit units that steer at the player and ram on
// contact. Four stars angles roadblocks across the road ahead; five
// stars launches KESTREL-1, the helicopter with the spotlight. Linger
// stationary next to a unit and the bust meter fills; break line of
// sight for long enough and the stars bleed away.
import { clamp, dist2, angleLerp } from '../rng.js';
import { CITY_HALF, collideBuildings } from './world.js';
import { damageCar } from './traffic.js';

export const COP_COUNTS = { 1: 1, 2: 2, 3: 4, 4: 5, 5: 7 };
const DISPATCH_WAIT = 2.5;

export function witnessed(s, x, z) {
  for (const ped of s.peds) if (dist2(ped.x, ped.z, x, z) < 35 * 35) return true;
  for (const cop of s.cops) if (dist2(cop.x, cop.z, x, z) < 60 * 60) return true;
  return s.wanted > 0;
}

export function addWanted(s, stars, wasWitnessed) {
  if (!wasWitnessed) return;
  if (stars <= s.wanted) { s.crimeHeat = Math.max(s.crimeHeat, 6 + s.wanted * 3); return; }
  if (s.pendingStars == null || stars > s.pendingStars) { s.pendingStars = stars; s.dispatchT = DISPATCH_WAIT; }
}

function buildCopCar(s, x, z, ry, isBlocker) {
  return {
    id: 900 + s.cops.length + Math.floor(s.rng() * 500), kind: 'cop',
    x: clamp(x, -CITY_HALF, CITY_HALF), z: clamp(z, -CITY_HALF, CITY_HALF),
    ry, speed: 0, targetSpeed: 17 + s.wanted,
    hp: isBlocker ? 140 : 120, smoke: 0, driver: true, stopped: 0,
    color: [0.95, 0.95, 0.97], roadblock: isBlocker,
  };
}

function deployPursuit(s) {
  const angle = s.rng.range(0, Math.PI * 2);
  s.cops.push(buildCopCar(s, s.player.x + Math.sin(angle) * 55, s.player.z + Math.cos(angle) * 55, 0, false));
  s.events.push({ name: 'copSpawn' });
}

// A pair of cruisers parked at an angle across the road, 70 m ahead.
function deployRoadblock(s) {
  const p = s.player;
  const fx = Math.sin(p.ry), fz = Math.cos(p.ry), rx = Math.cos(p.ry), rz = -Math.sin(p.ry);
  for (const side of [-2.2, 2.2]) {
    const car = buildCopCar(s, p.x + fx * 70 + rx * side, p.z + fz * 70 + rz * side, p.ry + Math.PI / 2, true);
    car.id = 990 + s.cops.length; car.targetSpeed = 20;
    s.cops.push(car);
  }
}

function landPendingStars(s, dt) {
  if (s.pendingStars == null) return;
  s.dispatchT -= dt;
  if (s.dispatchT > 0) return;
  const before = s.wanted;
  s.wanted = clamp(Math.max(s.wanted, s.pendingStars), 0, 5);
  s.crimeHeat = Math.max(s.crimeHeat, 6 + s.wanted * 3);
  s.pendingStars = null;
  if (s.wanted > before) s.events.push({ name: 'wanted', data: s.wanted });
  if (s.wanted >= 4) deployRoadblock(s);
}

export function stepCop(s, cop, dt) {
  if (cop.kind === 'dead' || cop === s.player.inCar) return;
  if (cop.roadblock) {
    if (s.wanted < 4) cop.roadblock = false;
    else return;
  }
  const target = s.player.inCar || s.player;
  const dx = target.x - cop.x, dz = target.z - cop.z;
  const gap = Math.hypot(dx, dz);
  cop.ry = angleLerp(cop.ry, Math.atan2(dx, dz), clamp(dt * 2.2, 0, 1));
  const ceiling = Math.min(26, 15 + s.wanted * 1.9);
  const speedGoal = gap > 5 ? ceiling : (s.player.inCar ? ceiling * 0.55 : 0);
  cop.speed += clamp(speedGoal - cop.speed, -20 * dt, 9 * dt);
  let nx = cop.x + Math.sin(cop.ry) * cop.speed * dt;
  let nz = cop.z + Math.cos(cop.ry) * cop.speed * dt;
  const solved = collideBuildings(s.city, nx, nz, 1.6);
  nx = solved[0]; nz = solved[1];
  const hitPlayer = dist2(nx, nz, target.x, target.z) < 3.2 * 3.2 && Math.abs(cop.speed) > 5;
  if (hitPlayer) {
    if (s.player.inCar) damageCar(s, s.player.inCar, 7);
    else s.playerAPI.hurt(s, 6);
    cop.speed *= -0.25;
    s.events.push({ name: 'ram' });
  }
  cop.x = nx; cop.z = nz;
}

function stepHeli(s, dt) {
  if (s.wanted >= 5 && !s.heli) {
    s.heli = { a: s.rng.range(0, 6.28), h: 28, x: s.player.x + 30, z: s.player.z };
    s.events.push({ name: 'heli' });
    s.msg = 'SBPD AIR UNIT — KESTREL-1 DEPLOYED'; s.msgT = 2.6;
  }
  if (!s.heli) return;
  if (s.wanted <= 3) { s.heli = null; return; }
  s.heli.a += dt * 0.22;
  s.heli.x = s.player.x + Math.sin(s.heli.a) * 30;
  s.heli.z = s.player.z + Math.cos(s.heli.a) * 30;
}

export function stepWanted(s, dt) {
  landPendingStars(s, dt);
  stepHeli(s, dt);
  if (s.crimeHeat > 0) s.crimeHeat -= dt;
  else if (s.wanted > 0) {
    const copNearby = s.cops.some((c) => dist2(c.x, c.z, s.player.x, s.player.z) < 45 * 45);
    if (!copNearby) {
      s.wantedDecay = (s.wantedDecay || 0) + dt;
      if (s.wantedDecay > 6) { s.wanted--; s.wantedDecay = 0; s.events.push({ name: 'wanted', data: s.wanted }); }
    } else s.wantedDecay = 0;
  }
  const desired = s.wanted === 0 ? 0 : COP_COUNTS[s.wanted];
  const active = s.cops.filter((c) => c.kind === 'cop' && !c.roadblock).length;
  if (active < desired && s.rng.chance(dt * 1.5)) deployPursuit(s);
  if (s.wanted === 0) { s.cops = s.cops.filter((c) => c === s.player.inCar); s.bustTimer = 0; }
  const playerSpeed = s.player.inCar ? Math.abs(s.player.inCar.speed) : 0;
  let copInReach = false;
  if (s.wanted > 0 && playerSpeed < 2) copInReach = s.cops.some((c) => c.kind === 'cop' && dist2(c.x, c.z, s.player.x, s.player.z) < 5.5 * 5.5);
  s.bustTimer = copInReach ? s.bustTimer + dt : Math.max(0, s.bustTimer - dt * 1.4);
  for (const cop of s.cops.slice()) stepCop(s, cop, dt);
  if (s.bustTimer > 2.5 && s.mode === 'play') {
    s.mode = 'busted';
    s.fine = Math.min(100 + s.wanted * 150, s.cash);
    s.events.push({ name: 'busted', data: s.fine });
  }
}
