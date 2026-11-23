// Pure game simulation: player, traffic AI, pedestrians, police, wanted level,
// missions, economy. No DOM / WebGL / audio here — side effects are queued as
// state.events strings for the shell to consume (sounds, banners).
import { makeRng, clamp, dist2, angleLerp } from './rng.js';
import { genCity, collideBuildings, roadCenters, CITY_HALF, BLOCK } from './city.js';

export const CAR_COLORS = [
  [0.9, 0.2, 0.3], [0.2, 0.5, 0.95], [0.95, 0.8, 0.2], [0.3, 0.9, 0.5],
  [0.95, 0.95, 0.95], [0.25, 0.25, 0.3], [1.0, 0.5, 0.15], [0.7, 0.3, 0.9],
];

export function createState(seed, saved) {
  const rng = makeRng(seed);
  const city = genCity(seed);
  const s = {
    seed, rng, city, time: 0, events: [],
    mode: 'title', // title | play | paused | busted | wasted
    cash: saved?.cash ?? 120,
    hasGun: saved?.hasGun ?? false,
    missionIdx: saved?.missionIdx ?? 0,
    health: 100, armor: 0,
    wanted: 0, bustTimer: 0, crimeHeat: 0,
    player: { x: -BLOCK * 0.5, z: BLOCK * 1.5 + 10, y: 0, ry: 0, speed: 0, inCar: null, aim: false },
    camYaw: 0, camPitch: 0.32,
    cars: [], peds: [], cops: [], bullets: [],
    mission: null, banner: '', bannerT: 0, msg: '', msgT: 0,
    stats: { earned: 0, robbed: 0, stolen: 0 },
    shot: null,
  };
  // Traffic cars: each follows a rectangular lane loop around a block ring.
  const centers = roadCenters();
  for (let i = 0; i < 14; i++) {
    const horiz = rng.chance(0.5);
    const road = centers[rng.int(1, centers.length - 2)];
    const dir = rng.chance(0.5) ? 1 : -1;
    const t = rng.range(-CITY_HALF, CITY_HALF);
    const lane = road + dir * 3.6;
    s.cars.push({
      id: i, kind: 'traffic',
      x: horiz ? t : lane, z: horiz ? lane : t,
      ry: horiz ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
      speed: 0, targetSpeed: rng.range(9, 14), horiz, road, dir,
      color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: true, stopped: 0,
    });
  }
  // Parked cars (stealable) near sidewalks.
  for (let i = 0; i < 10; i++) {
    const road = centers[rng.int(0, centers.length - 1)];
    const horiz = rng.chance(0.5);
    const t = rng.range(-CITY_HALF + 10, CITY_HALF - 10);
    const side = rng.chance(0.5) ? 6.4 : -6.4;
    s.cars.push({
      id: 100 + i, kind: 'parked',
      x: horiz ? t : road + side, z: horiz ? road + side : t,
      ry: horiz ? Math.PI / 2 : 0, speed: 0, targetSpeed: 11,
      horiz, road, dir: 1, color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
      hp: 100, smoke: 0, driver: false, stopped: 0,
    });
  }
  // Pedestrians on sidewalks.
  for (let i = 0; i < 22; i++) {
    s.peds.push(spawnPed(s, rng));
  }
  return s;
}

function spawnPed(s, rng) {
  const centers = roadCenters();
  const road = centers[rng.int(0, centers.length - 1)];
  const horiz = rng.chance(0.5);
  const t = rng.range(-CITY_HALF, CITY_HALF);
  const side = (rng.chance(0.5) ? 1 : -1) * rng.range(8.6, 10.5);
  return {
    x: horiz ? t : road + side, z: horiz ? road + side : t,
    ry: rng.range(0, Math.PI * 2), speed: rng.range(1.2, 2.2),
    horiz, road, side, dir: rng.chance(0.5) ? 1 : -1,
    color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)],
    state: 'walk', t: rng.range(2, 6), cash: rng.int(15, 90), robbed: false,
  };
}

function ev(s, name, data) { s.events.push({ name, data }); }
export function drainEvents(s) { const e = s.events; s.events = []; return e; }

export function addWanted(s, stars, witnessed) {
  if (!witnessed) return;
  const before = s.wanted;
  s.wanted = clamp(Math.max(s.wanted, stars), 0, 5);
  s.crimeHeat = Math.max(s.crimeHeat, 6 + s.wanted * 3);
  if (s.wanted > before) ev(s, 'wanted', s.wanted);
}
function witnessed(s, x, z) {
  // A crime counts when a ped or cop is within sight range.
  for (const p of s.peds) if (dist2(p.x, p.z, x, z) < 28 * 28) return true;
  for (const c of s.cops) if (dist2(c.x, c.z, x, z) < 60 * 60) return true;
  return s.wanted > 0;
}

const MISSIONS = [
  { name: 'MEET THE CONTACT', desc: 'Drive to the pink marker and meet your contact.', type: 'goto', zone: 'contact', pay: 0 },
  { name: 'HOT PACKAGE', desc: 'Deliver the package across town before the timer runs out!', type: 'deliver', pay: 250, time: 75 },
  { name: 'FARE GAME', desc: 'Pick up the passenger and drop them off for a fare.', type: 'taxi', pay: 120, time: 90 },
  { name: 'LOSE THE HEAT', desc: 'You are at 3 stars. Shake the cops until the heat dies down!', type: 'escape', pay: 300 },
  { name: 'THE BIG SCORE', desc: 'Grab the money van downtown and bring it to the Pay \'n Spray.', type: 'score', pay: 1000, time: 120 },
];
export function missionDef(s) { return MISSIONS[Math.min(s.missionIdx, MISSIONS.length - 1)]; }

export function startMission(s) {
  if (s.mission) return;
  const taxiLoop = s.missionIdx >= MISSIONS.length;
  const def = taxiLoop
    ? { name: 'TAXI SHIFT', desc: 'Pick up the passenger and drop them off.', type: 'taxi', pay: 100 + s.rng.int(0, 80), time: 90 }
    : missionDef(s);
  const m = { ...def, phase: 0, timer: def.time || 0, target: null, van: null };
  if (def.type === 'goto') m.target = { ...s.city.zones.contact };
  if (def.type === 'deliver') m.target = { x: BLOCK * 1.5, z: -BLOCK * 1.5, r: 6 };
  if (def.type === 'taxi') m.target = randomCorner(s);
  if (def.type === 'escape') { addWanted(s, 3, true); m.target = null; }
  if (def.type === 'score') {
    m.target = { x: 0, z: 0, r: 6 };
    m.van = { x: 6, z: -6, taken: false };
  }
  s.mission = m;
  s.banner = m.name; s.bannerT = 3.2;
  ev(s, 'banner', m.name);
}
function randomCorner(s) {
  const c = roadCenters();
  return { x: c[s.rng.int(0, c.length - 1)] + 9, z: c[s.rng.int(0, c.length - 1)] + 9, r: 6 };
}
function completeMission(s, pay) {
  s.cash += pay; s.stats.earned += pay;
  ev(s, 'cash', pay);
  ev(s, 'missionDone', s.mission?.name || '');
  s.banner = pay > 0 ? `MISSION PASSED  +$${pay}` : 'MISSION PASSED';
  s.bannerT = 3.2;
  s.mission = null;
  if (s.missionIdx < MISSIONS.length) s.missionIdx++;
  ev(s, 'save');
  startMission(s);
}
function failMission(s, why) {
  ev(s, 'missionFail', why);
  s.banner = 'MISSION FAILED'; s.bannerT = 2.6;
  s.mission = null;
  startMission(s);
}

export function enterExitCar(s) {
  const p = s.player;
  if (p.inCar) {
    const car = p.inCar;
    p.x = car.x + Math.cos(car.ry) * 2.4; p.z = car.z - Math.sin(car.ry) * 2.4;
    p.inCar = null; ev(s, 'exitCar');
    return;
  }
  let best = null, bd = 4.5 * 4.5;
  for (const c of [...s.cars, ...s.cops]) {
    const d = dist2(c.x, c.z, p.x, p.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) {
    p.inCar = best;
    if (best.kind === 'parked' || best.kind === 'traffic') {
      if (best.driver) { ev(s, 'yank'); }
      best.kind = 'player'; best.driver = false;
      s.stats.stolen++;
      addWanted(s, 1, witnessed(s, p.x, p.z));
    }
    ev(s, 'enterCar');
  }
}

export function shoot(s) {
  const p = s.player;
  if (!s.hasGun || p.inCar) return;
  ev(s, 'shot');
  // Hitscan along camera yaw: nearest ped/car within 40m in a narrow cone.
  const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
  let hit = null, hd = 40;
  for (const ped of s.peds) {
    const dx = ped.x - p.x, dz = ped.z - p.z;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < hd && Math.abs(dx * fz - dz * fx) < 1.2) { hit = ped; hd = along; }
  }
  if (hit) {
    hit.state = 'dead'; hit.t = 4;
    addWanted(s, 3, witnessed(s, p.x, p.z));
    ev(s, 'hitPed');
    return;
  }
  for (const c of [...s.cars, ...s.cops]) {
    const dx = c.x - p.x, dz = c.z - p.z;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < 42 && Math.abs(dx * fz - dz * fx) < 2.2) {
      damageCar(s, c, 18);
      if (c.kind === 'cop') addWanted(s, Math.max(3, s.wanted), true);
      return;
    }
  }
  addWanted(s, 1, witnessed(s, p.x, p.z)); // gunfire heard
}

export function damageCar(s, car, dmg) {
  car.hp -= dmg;
  car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
  if (car.hp <= 0 && car.kind !== 'dead') {
    ev(s, 'explode', car);
    if (car === s.player.inCar) hurtPlayer(s, 45);
    car.kind = 'dead'; car.speed = 0;
  }
}

export function hurtPlayer(s, dmg) {
  s.health -= dmg;
  ev(s, 'hurt', dmg);
  if (s.health <= 0 && s.mode === 'play') {
    s.health = 0; s.mode = 'wasted';
    ev(s, 'wasted');
  }
}

function stepTrafficCar(s, c, dt) {
  if (c.kind === 'dead') return;
  // Stop for obstacles ahead (player car, other cars, peds crossing).
  let blocked = false;
  const fx = Math.sin(c.ry), fz = Math.cos(c.ry);
  const ahead = (o, r) => {
    const dx = o.x - c.x, dz = o.z - c.z;
    const along = dx * fx + dz * fz;
    return along > 2 && along < 9 && Math.abs(dx * fz - dz * fx) < r;
  };
  for (const o of s.cars) if (o !== c && ahead(o, 2.4)) blocked = true;
  if (s.player.inCar && ahead(s.player.inCar, 2.4)) blocked = true;
  if (!s.player.inCar && ahead(s.player, 1.6)) blocked = true;
  c.stopped = blocked ? c.stopped + dt : 0;
  const want = blocked ? 0 : c.targetSpeed;
  c.speed += clamp(want - c.speed, -22 * dt, 7 * dt);
  // Follow lane: drive straight, turn at intersections onto the ring.
  c.x += fx * c.speed * dt;
  c.z += fz * c.speed * dt;
  const lim = CITY_HALF - 6;
  if (Math.abs(c.x) > lim || Math.abs(c.z) > lim) {
    // U-turn at the city edge ring road.
    c.ry += Math.PI;
    c.x = clamp(c.x, -lim, lim); c.z = clamp(c.z, -lim, lim);
    c.horiz = !c.horiz;
  }
  // Keep on nearest lane line of its axis.
  const centers = roadCenters();
  let near = centers[0], nd = 1e9;
  for (const cc of centers) { const d = Math.abs((c.horiz ? c.z : c.x) - cc); if (d < nd) { nd = d; near = cc; } }
  const laneTarget = near + c.dir * 3.6 * (c.horiz ? 1 : 1);
  if (c.horiz) c.z += clamp(laneTarget - c.z, -3 * dt, 3 * dt);
  else c.x += clamp((near + (c.ry > Math.PI / 2 || c.ry < -Math.PI / 2 ? -3.6 : 3.6)) - c.x, -3 * dt, 3 * dt);
}

function stepPed(s, p, dt) {
  if (p.state === 'dead') { p.t -= dt; return; }
  const danger = (s.player.inCar && dist2(p.x, p.z, s.player.inCar.x, s.player.inCar.z) < 12 * 12 && Math.abs(s.player.inCar.speed) > 6)
    || (s.player.aim && dist2(p.x, p.z, s.player.x, s.player.z) < 10 * 10);
  if (danger && p.state !== 'robbed') p.state = 'flee';
  if (p.state === 'flee') {
    const src = s.player.inCar || s.player;
    const dx = p.x - src.x, dz = p.z - src.z;
    const d = Math.hypot(dx, dz) || 1;
    p.x += (dx / d) * 4.6 * dt; p.z += (dz / d) * 4.6 * dt;
    p.ry = Math.atan2(dx, dz);
    p.t -= dt;
    if (p.t < -3) { p.state = 'walk'; }
    // Robbery: aiming a gun at a close ped makes them hand over cash once.
    if (s.player.aim && s.hasGun && !p.robbed && dist2(p.x, p.z, s.player.x, s.player.z) < 5 * 5) {
      p.robbed = true; p.state = 'robbed'; p.t = 2.5;
      s.cash += p.cash; s.stats.robbed++;
      ev(s, 'rob', p.cash);
      addWanted(s, 1, witnessed(s, p.x, p.z));
    }
    return;
  }
  if (p.state === 'robbed') { p.t -= dt; if (p.t <= 0) { p.state = 'flee'; p.t = 2; } return; }
  // Walk along sidewalk: move along axis, flip at ends / randomly.
  p.t -= dt;
  if (p.t <= 0) { p.dir *= -1; p.t = s.rng.range(3, 8); }
  const v = p.speed * p.dir;
  if (p.horiz) { p.x += v * dt; p.ry = v > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { p.z += v * dt; p.ry = v > 0 ? 0 : Math.PI; }
  if (Math.abs(p.x) > CITY_HALF || Math.abs(p.z) > CITY_HALF) p.dir *= -1;
  const [nx, nz] = collideBuildings(s.city, p.x, p.z, 0.5);
  p.x = nx; p.z = nz;
}

function spawnCop(s) {
  const a = s.rng.range(0, Math.PI * 2);
  const d = 55;
  const car = {
    id: 900 + s.cops.length + Math.floor(s.rng() * 500),
    kind: 'cop', x: clamp(s.player.x + Math.sin(a) * d, -CITY_HALF, CITY_HALF),
    z: clamp(s.player.z + Math.cos(a) * d, -CITY_HALF, CITY_HALF),
    ry: 0, speed: 0, targetSpeed: 17 + s.wanted, hp: 120, smoke: 0, driver: true, stopped: 0,
    color: [0.95, 0.95, 0.97],
  };
  s.cops.push(car);
  ev(s, 'copSpawn');
}

function stepCop(s, c, dt) {
  if (c.kind === 'dead') return;
  if (c === s.player.inCar) return;
  const target = s.player.inCar || s.player;
  const dx = target.x - c.x, dz = target.z - c.z;
  const d = Math.hypot(dx, dz);
  const wantRy = Math.atan2(dx, dz);
  c.ry = angleLerp(c.ry, wantRy, clamp(dt * 2.2, 0, 1));
  const top = 15 + s.wanted * 1.6;
  const want = d > 7 ? top : (s.player.inCar ? top * 0.6 : 0);
  c.speed += clamp(want - c.speed, -20 * dt, 9 * dt);
  let nx = c.x + Math.sin(c.ry) * c.speed * dt;
  let nz = c.z + Math.cos(c.ry) * c.speed * dt;
  [nx, nz] = collideBuildings(s.city, nx, nz, 1.6);
  // Ram damage on contact.
  if (dist2(nx, nz, target.x, target.z) < 3.2 * 3.2 && Math.abs(c.speed) > 5) {
    if (s.player.inCar) damageCar(s, s.player.inCar, 7);
    else hurtPlayer(s, 6);
    c.speed *= -0.25;
    ev(s, 'ram');
  }
  c.x = nx; c.z = nz;
  // Bust meter: cop close + player slow = arrest progress.
  if (d < 9 && (!s.player.inCar || Math.abs(s.player.inCar.speed) < 2.5)) {
    s.bustTimer += dt * (s.player.inCar ? 0.8 : 1.3);
  }
}

export function step(s, input, dt) {
  if (s.mode !== 'play') return;
  s.time += dt;
  const p = s.player;
  if (s.bannerT > 0) s.bannerT -= dt;
  if (s.msgT > 0) s.msgT -= dt;

  // --- Player movement ---
  if (p.inCar) {
    const car = p.inCar;
    const accel = input.up ? 16 : 0, brake = input.down ? (car.speed > 0.5 ? -26 : -9) : 0;
    car.speed += (accel + brake) * dt;
    car.speed -= car.speed * 0.35 * dt; // drag
    car.speed = clamp(car.speed, -11, 26 + s.wanted);
    const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (Math.abs(car.speed) > 0.2) car.ry += steer * dt * 1.7 * Math.sign(car.speed) * clamp(Math.abs(car.speed) / 9, 0.3, 1);
    let nx = car.x + Math.sin(car.ry) * car.speed * dt;
    let nz = car.z + Math.cos(car.ry) * car.speed * dt;
    const [cx, cz] = collideBuildings(s.city, nx, nz, 1.7);
    if ((cx !== nx || cz !== nz) && Math.abs(car.speed) > 7) {
      damageCar(s, car, Math.abs(car.speed) * 0.7);
      ev(s, 'crash', Math.abs(car.speed));
      car.speed *= -0.3;
    } else car.speed = car.speed; // no-op keep
    car.x = cx; car.z = cz;
    p.x = car.x; p.z = car.z; p.ry = car.ry;
    // Run over peds.
    for (const ped of s.peds) {
      if (ped.state !== 'dead' && Math.abs(car.speed) > 5 && dist2(ped.x, ped.z, car.x, car.z) < 2.3 * 2.3) {
        ped.state = 'dead'; ped.t = 5;
        damageCar(s, car, 4);
        addWanted(s, 2, witnessed(s, car.x, car.z));
        ev(s, 'hitPed');
      }
    }
    car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
    if (car.smoke === 2 && s.rng.chance(dt * 0.25)) damageCar(s, car, 3);
  } else {
    const run = input.shift ? 7.4 : 4.1;
    const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const mz = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (mx || mz) {
      const yaw = s.camYaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      let dx = fx * -mz + rx * mx, dz = fz * -mz + rz * mx;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      p.ry = Math.atan2(dx, dz);
      const [nx, nz] = collideBuildings(s.city, p.x + dx * run * dt, p.z + dz * run * dt, 0.55);
      p.x = nx; p.z = nz;
      p.speed = run;
    } else p.speed = 0;
    p.aim = !!(input.aim && s.hasGun);
  }

  // --- World actors ---
  for (const c of s.cars) if (c.kind === 'traffic') stepTrafficCar(s, c, dt);
  for (const ped of s.peds) stepPed(s, ped, dt);
  s.peds = s.peds.filter(ped => ped.state !== 'dead' || ped.t > -8);
  while (s.peds.length < 20) s.peds.push(spawnPed(s, s.rng));

  // --- Wanted / police ---
  if (s.crimeHeat > 0) s.crimeHeat -= dt;
  else if (s.wanted > 0) {
    // Heat decays when no cop sees the player.
    let seen = false;
    for (const c of s.cops) if (dist2(c.x, c.z, p.x, p.z) < 45 * 45) seen = true;
    if (!seen) {
      s.wantedDecay = (s.wantedDecay || 0) + dt;
      if (s.wantedDecay > 6) { s.wanted--; s.wantedDecay = 0; ev(s, 'wanted', s.wanted); }
    } else s.wantedDecay = 0;
  }
  const wantCops = s.wanted === 0 ? 0 : 1 + s.wanted; // 2..6
  if (s.cops.filter(c => c.kind === 'cop').length < wantCops && s.rng.chance(dt * 1.5)) spawnCop(s);
  if (s.wanted === 0) { s.cops = s.cops.filter(c => c === p.inCar); s.bustTimer = 0; }
  s.bustTimer = Math.max(0, s.bustTimer - dt * 0.7);
  for (const c of [...s.cops]) stepCop(s, c, dt);
  if (s.bustTimer > 3.2 && s.mode === 'play') {
    s.mode = 'busted';
    const fine = 100 + s.wanted * 150;
    s.fine = Math.min(fine, s.cash);
    ev(s, 'busted', s.fine);
  }

  // --- Zones ---
  const zones = s.city.zones;
  const inZone = (z) => dist2(p.x, p.z, z.x, z.z) < z.r * z.r;
  if (inZone(zones.gunshop) && !p.inCar && input.interact) {
    if (!s.hasGun && s.cash >= 300) { s.cash -= 300; s.hasGun = true; ev(s, 'buyGun'); ev(s, 'save'); }
    else if (!s.hasGun) { s.msg = 'PISTOL $300 — NOT ENOUGH CASH'; s.msgT = 2; }
  }
  if (inZone(zones.hospital) && s.health < 100) {
    s.health = Math.min(100, s.health + 22 * dt);
  }
  if (inZone(zones.spray) && p.inCar) {
    if (s.wanted > 0 && s.cash >= 200) {
      s.cash -= 200; s.wanted = 0; s.crimeHeat = 0; s.cops = s.cops.filter(c => c === p.inCar);
      p.inCar.hp = 100; p.inCar.smoke = 0; p.inCar.color = CAR_COLORS[s.rng.int(0, CAR_COLORS.length - 1)];
      ev(s, 'spray');
    } else if (p.inCar.hp < 100 && s.cash >= 100) {
      s.cash -= 100; p.inCar.hp = 100; p.inCar.smoke = 0; ev(s, 'spray');
    }
  }

  // --- Mission logic ---
  const m = s.mission;
  if (m) {
    if (m.timer > 0) { m.timer -= dt; if (m.timer <= 0) { failMission(s, 'Out of time'); return; } }
    const t = m.target;
    if (m.type === 'goto' && t && dist2(p.x, p.z, t.x, t.z) < t.r * t.r) completeMission(s, 0);
    else if (m.type === 'deliver' && t && dist2(p.x, p.z, t.x, t.z) < t.r * t.r) completeMission(s, m.pay);
    else if (m.type === 'taxi' && t) {
      if (m.phase === 0 && dist2(p.x, p.z, t.x, t.z) < t.r * t.r) {
        m.phase = 1; m.target = randomCorner(s); m.timer = Math.max(m.timer, 60);
        s.banner = 'DROP THEM OFF'; s.bannerT = 2; ev(s, 'pickup');
      } else if (m.phase === 1 && dist2(p.x, p.z, t.x, t.z) < t.r * t.r) completeMission(s, m.pay);
    } else if (m.type === 'escape') {
      if (s.wanted === 0) completeMission(s, m.pay);
    } else if (m.type === 'score' && t) {
      if (!m.van.taken && dist2(p.x, p.z, m.van.x, m.van.z) < 7 * 7) {
        m.van.taken = true; addWanted(s, 4, true);
        s.banner = 'TAKE IT TO THE PAY \'N SPRAY'; s.bannerT = 2.6; ev(s, 'scoreGrab');
        m.target = { ...zones.spray };
      } else if (m.van.taken && dist2(p.x, p.z, t.x, t.z) < t.r * t.r) {
        s.wanted = 0; s.cops = s.cops.filter(c => c === p.inCar);
        completeMission(s, m.pay);
      }
    }
  }
}

export function respawn(s, kind) {
  // After BUSTED: pay fine, lose gun sometimes, back at hospital. After WASTED: hospital bill.
  if (kind === 'busted') {
    s.cash -= s.fine || 0;
    if (s.hasGun && s.rng.chance(0.5)) s.hasGun = false;
  } else {
    s.cash = Math.max(0, s.cash - 150);
  }
  s.wanted = 0; s.crimeHeat = 0; s.bustTimer = 0; s.health = 100;
  s.cops = [];
  if (s.player.inCar) s.player.inCar = null;
  s.player.x = s.city.zones.hospital.x + 10;
  s.player.z = s.city.zones.hospital.z + 10;
  s.mode = 'play';
  ev(s, 'save');
}
