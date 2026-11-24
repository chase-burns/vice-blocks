// player.js — everything the player does directly: first-person walking,
// driving through the physics model, entering and stealing cars,
// shooting, gun-store shopping, Pay 'n Spray from the driver's seat,
// taking damage, and respawning after a bust or hospital visit.
import { dist2 } from '../rng.js';
import { collideBuildings, BLOCK } from './world.js';
import { VehiclePhysics } from './physics.js';
import { damageCar } from './traffic.js';
import { witnessed } from './wanted.js';

// Arsenal: all four weapons share one reserve pool; each keeps its own
// magazine field, cadence, spread, pellets and vehicle damage.
// Ammu-Nation sells strictly in order; keys 1–4 switch owned weapons.
export const WEAPONS = {
  pistol: { label: 'PISTOL', short: '9MM', mag: 'ammo', size: 12, cd: 0.25, auto: false, spread: 1.2, carDmg: 18, range: 50, pellets: 1, price: 300 },
  smg: { label: 'SMG', short: 'SMG', mag: 'ammoSmg', size: 30, cd: 0.09, auto: true, spread: 2.8, carDmg: 9, range: 50, pellets: 1, price: 600 },
  shotgun: { label: 'SHOTGUN', short: '12G', mag: 'ammoShotgun', size: 6, cd: 0.85, auto: false, spread: 3.6, carDmg: 11, range: 32, pellets: 6, price: 800 },
  rifle: { label: 'RIFLE', short: 'AR', mag: 'ammoRifle', size: 25, cd: 0.13, auto: true, spread: 0.7, carDmg: 22, range: 70, pellets: 1, price: 1000 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];
const FLAG = { pistol: 'hasGun', smg: 'hasSmg', shotgun: 'hasShotgun', rifle: 'hasRifle' };
const START = { pistol: 12, smg: 30, shotgun: 6, rifle: 25 };

export function ownsWeapon(s, w) { return !!s[FLAG[w]]; }
export function activeWeapon(s) { return ownsWeapon(s, s.weapon) ? s.weapon : 'pistol'; }
export function weaponDef(s) { return WEAPONS[activeWeapon(s)]; }

export function hurt(s, dmg) {
  const soaked = Math.min(s.armor, dmg * 0.6);
  s.armor -= soaked; s.health -= dmg - soaked;
  s.events.push({ name: 'hurt', data: dmg });
  if (s.health <= 0 && s.mode === 'play') { s.health = 0; s.mode = 'wasted'; s.events.push({ name: 'wasted' }); }
}

export function enterExitCar(s) {
  const p = s.player;
  if (p.inCar) {
    const car = p.inCar;
    p.x = car.x + Math.cos(car.ry) * 2.4;
    p.z = car.z - Math.sin(car.ry) * 2.4;
    car.speed = car.phys ? car.phys.u : car.speed;
    p.inCar = null;
    s.events.push({ name: 'exitCar' });
    return;
  }
  let nearest = null, nearestD2 = 4.5 * 4.5;
  for (const car of s.cars.concat(s.cops)) {
    const d = dist2(car.x, car.z, p.x, p.z);
    if (d < nearestD2) { nearestD2 = d; nearest = car; }
  }
  if (!nearest) return;
  nearest.hpMax = s.armorUp ? 150 : 100;
  if (nearest.gear == null) nearest.gear = 1;
  if (!nearest.phys) nearest.phys = new VehiclePhysics();
  nearest.phys.u = nearest.speed || 0; nearest.phys.v = 0; nearest.phys.omega = 0;
  p.inCar = nearest;
  if (nearest.kind === 'parked' || nearest.kind === 'traffic') {
    if (nearest.driver) s.events.push({ name: 'yank' });
    nearest.kind = 'player'; nearest.driver = false; s.stats.stolen++;
    s.wantedAPI.add(s, 1, witnessed(s, p.x, p.z));
  }
  s.events.push({ name: 'enterCar' });
}

// One trigger pull resolved per pellet: nearest pedestrian on the shot
// line wins, then mission targets, then the nearest vehicle. Wanted
// consequences scale with what was actually hit.
export function shoot(s) {
  const p = s.player;
  if (!s.hasGun || p.inCar) return;
  const key = activeWeapon(s), W = WEAPONS[key];
  if (s[W.mag] <= 0) { s.events.push({ name: 'dryFire' }); return; }
  s[W.mag]--; s.recoil = 1; s.flashT = 0.07; s.gunfireT = 0.6; s.gunfireX = p.x; s.gunfireZ = p.z;
  s.events.push({ name: 'shot', data: key });
  const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
  let hitAnything = false, killedPed = false, hitCopCar = false;
  for (let pellet = 0; pellet < W.pellets; pellet++) {
    const jitter = W.pellets > 1 ? (Math.random() * 2 - 1) * W.spread : 0;
    const tol = W.pellets > 1 ? 1.15 : W.spread;
    const alongOf = (x, z) => (x - p.x) * fx + (z - p.z) * fz;
    const latOf = (x, z) => (x - p.x) * fz - (z - p.z) * fx - jitter;
    let victim = null, victimDist = W.range;
    for (const ped of s.peds) {
      if (ped.state === 'dead') continue;
      const along = alongOf(ped.x, ped.z);
      if (along > 0 && along < victimDist && Math.abs(latOf(ped.x, ped.z)) < tol) { victim = ped; victimDist = along; }
    }
    let targetHit = false;
    for (const tg of s.targets || []) {
      if (tg.down) continue;
      const along = alongOf(tg.x, tg.z);
      if (along > 0 && along < victimDist && Math.abs(latOf(tg.x, tg.z)) < 1.4) { tg.down = true; targetHit = true; victimDist = along; }
    }
    if (targetHit) { s.events.push({ name: 'targetDown', data: null }); hitAnything = true; continue; }
    if (victim) { victim.state = 'dead'; victim.t = 4; hitAnything = true; killedPed = true; s.events.push({ name: 'hitPed' }); continue; }
    for (const car of s.cars.concat(s.cops)) {
      const along = alongOf(car.x, car.z);
      if (along > 0 && along < W.range * 0.84 && Math.abs(latOf(car.x, car.z)) < 2.2) {
        damageCar(s, car, W.carDmg);
        if (car.kind === 'cop') hitCopCar = true;
        hitAnything = true; break;
      }
    }
  }
  if (killedPed) s.wantedAPI.add(s, 3, witnessed(s, p.x, p.z));
  else if (hitCopCar) s.wantedAPI.add(s, Math.max(3, s.wanted), true);
  else if (!hitAnything) s.wantedAPI.add(s, 1, witnessed(s, p.x, p.z));
}

export function stepPlayerCar(s, input, dt) {
  const p = s.player, car = p.inCar;
  if (!car.phys) car.phys = new VehiclePhysics();
  const phys = car.phys;
  phys.powerMul = s.engineUp ? 1.15 : 1;
  const substeps = 2, sdt = dt / substeps;
  let worst = 0;
  for (let i = 0; i < substeps; i++) {
    phys.update(sdt, { throttle: input.up ? 1 : 0, brake: input.down ? 1 : 0, steer: (input.left ? -1 : 0) + (input.right ? 1 : 0), handbrake: input.handbrake });
    car.ry += phys.omega * sdt;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const vx = fx * phys.u + rx * phys.v, vz = fz * phys.u + rz * phys.v;
    let nx = car.x + vx * sdt, nz = car.z + vz * sdt;
    const resolved = collideBuildings(s.city, nx, nz, 1.7);
    const cx = resolved[0], cz = resolved[1];
    if (cx !== nx || cz !== nz) {
      const pushX = cx - nx, pushZ = cz - nz, pushLen = Math.hypot(pushX, pushZ) || 1;
      const ax = pushX / pushLen, az = pushZ / pushLen;
      const vN = vx * ax + vz * az;
      if (vN < 0) {
        const slideX = vx - vN * ax, slideZ = vz - vN * az;
        const nvx = slideX * 0.5 - vN * 0.2 * ax, nvz = slideZ * 0.5 - vN * 0.2 * az;
        worst = Math.max(worst, Math.abs(vN));
        phys.u = nvx * fx + nvz * fz; phys.v = nvx * rx + nvz * rz;
      }
      nx = cx; nz = cz;
    }
    car.x = nx; car.z = nz;
  }
  car.speed = phys.u; car.velSpeed = Math.hypot(phys.u, phys.v);
  car.steerAngle = phys.steerAngle; car.slip = Math.abs(phys.v - phys.omega * 1.4);
  car.rpm = phys.rpm; car.gear = phys.gear; car.handbrake = phys.handbrake; car.isDrifting = phys.isDrifting;
  if (worst > 4) { damageCar(s, car, worst * 1.1); s.events.push({ name: 'crash', data: worst }); s.trauma = Math.min(1, (s.trauma || 0) + worst / 15); }
  p.x = car.x; p.z = car.z; p.ry = car.ry;
  resolveCarContacts(s, car, phys);
  resolvePedContacts(s, car);
  car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
  if (car.smoke === 2 && s.rng.chance(dt * 0.25)) damageCar(s, car, 3);
  collectPickups(s);
}

// Shoving traffic aside; a roadblock cruiser can be punched through —
// it spins off line, the line breaks, and the law notices.
function resolveCarContacts(s, car, phys) {
  for (const other of s.cars.concat(s.cops)) {
    if (other === car || other.kind === 'dead') continue;
    if (dist2(other.x, other.z, car.x, car.z) >= 3.1 * 3.1) continue;
    if (car.velSpeed <= 2) continue;
    const dx = other.x - car.x, dz = other.z - car.z, dl = Math.hypot(dx, dz) || 1;
    if (other.roadblock) {
      other.roadblock = false;
      other.x += (dx / dl) * 2.4 + (dz / dl) * 1.2;
      other.z += (dz / dl) * 2.4 - (dx / dl) * 1.2;
      other.ry += 0.9; other.speed = 3;
      damageCar(s, other, 30); damageCar(s, car, 10);
      s.trauma = Math.min(1, (s.trauma || 0) + 0.3);
      s.events.push({ name: 'roadblockHit', data: other });
      s.wantedAPI.add(s, Math.max(4, s.wanted), true);
    } else {
      other.x += (dx / dl) * 0.9; other.z += (dz / dl) * 0.9;
      damageCar(s, other, 8); damageCar(s, car, 5); phys.u *= 0.82;
    }
  }
}

function resolvePedContacts(s, car) {
  for (const ped of s.peds) {
    if (ped.state === 'dead') continue;
    if (car.velSpeed <= 5) continue;
    if (dist2(ped.x, ped.z, car.x, car.z) >= 2.3 * 2.3) continue;
    ped.state = 'dead'; ped.t = 5;
    damageCar(s, car, 4);
    s.wantedAPI.add(s, 2, witnessed(s, car.x, car.z));
    s.events.push({ name: 'hitPed' });
  }
}

export function stepPlayerFoot(s, input, dt) {
  const p = s.player;
  const speed = input.shift ? 8.2 : 4.5;
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const forward = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  p.bobPhase = p.bobPhase || 0;
  if (strafe || forward) {
    const yaw = s.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * forward + rx * strafe, dz = fz * forward + rz * strafe;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    p.ry = Math.atan2(dx, dz);
    const resolved = collideBuildings(s.city, p.x + dx * speed * dt, p.z + dz * speed * dt, 0.55);
    p.x = resolved[0]; p.z = resolved[1];
    p.speed = speed; p.bobPhase += dt * speed * 1.6;
  } else p.speed = 0;
  p.aim = !!(input.aim && s.hasGun);
  collectPickups(s);
  stepFootZones(s, input, dt);
}

function inZone(p, zone) { return dist2(p.x, p.z, zone.x, zone.z) < zone.r * zone.r; }

function stepFootZones(s, input, dt) {
  const p = s.player, zones = s.city.zones;
  if (inZone(p, zones.gunshop) && input.interact) buyNext(s);
  if (inZone(p, zones.hospital) && s.health < 100) s.health = Math.min(100, s.health + 22 * dt);
}

function buyNext(s) {
  const nextKey = WEAPON_ORDER.find((w) => !ownsWeapon(s, w));
  if (!nextKey) {
    if (s.reserve < 240) { s.reserve = 240; s.msg = 'AMMO RESTOCKED'; s.msgT = 1.5; }
    return;
  }
  const def = WEAPONS[nextKey];
  if (s.cash < def.price) { s.msg = def.label + ' $' + def.price + ' — NOT ENOUGH CASH'; s.msgT = 2; return; }
  s.cash -= def.price;
  s[FLAG[nextKey]] = true; s[def.mag] = START[nextKey]; s.weapon = nextKey;
  s.msg = nextKey === 'pistol' ? 'PISTOL PURCHASED — RIGHT MOUSE AIM, LEFT CLICK FIRE' : def.label + ' PURCHASED — KEYS 1-4 SWITCH';
  s.msgT = nextKey === 'pistol' ? 3 : 2.5;
  s.events.push({ name: 'buyGun' }); s.events.push({ name: 'save' });
}

function collectPickups(s) {
  const p = s.player;
  for (let i = s.pickups.length - 1; i >= 0; i--) {
    const pk = s.pickups[i];
    pk.t -= 1 / 60;
    if (pk.t <= 0) { s.pickups.splice(i, 1); continue; }
    if (dist2(pk.x, pk.z, p.x, p.z) < 2 * 2) {
      s.cash += pk.cash; s.stats.earned += pk.cash;
      s.events.push({ name: 'cash', data: pk.cash });
      s.pickups.splice(i, 1);
    }
  }
}

// Pay 'n Spray from the driver's seat. Priority: clear heat, then
// repairs, then the two one-time garage upgrades.
export function stepZonesCar(s, dt) {
  void dt;
  const p = s.player, car = p.inCar;
  if (!car) return;
  const spray = s.city.zones.spray;
  if (!inZone(p, spray)) return;
  const cap = car.hpMax || 100;
  const repaint = () => { car.hp = cap; car.smoke = 0; car.burning = null; };
  if (s.wanted > 0 && s.cash >= 100) {
    s.cash -= 100; s.wanted = 0; s.crimeHeat = 0; s.pendingStars = null;
    s.cops = s.cops.filter((c) => c === car);
    repaint();
    car.color = [s.rng.range(0.3, 1), s.rng.range(0.3, 1), s.rng.range(0.3, 1)];
    s.events.push({ name: 'spray' }); s.events.push({ name: 'save' });
  } else if (car.hp < cap && s.cash >= 100) {
    s.cash -= 100; repaint(); s.events.push({ name: 'spray' });
  } else if (!s.armorUp && s.cash >= 400) {
    s.cash -= 400; s.armorUp = true; car.hpMax = 150;
    s.msg = 'ARMOUR FITTED — HULL +50% ($400)'; s.msgT = 2.5;
    s.events.push({ name: 'spray' }); s.events.push({ name: 'save' });
  } else if (!s.engineUp && s.cash >= 500) {
    s.cash -= 500; s.engineUp = true;
    s.msg = 'ENGINE TUNED — TOP SPEED +15% ($500)'; s.msgT = 2.5;
    s.events.push({ name: 'spray' }); s.events.push({ name: 'save' });
  }
}

export function respawn(s, kind) {
  if (kind === 'busted') {
    s.cash -= s.fine || 0;
    if (s.hasGun && s.rng.chance(0.5)) s.hasGun = false;
  } else {
    s.cash = Math.max(0, s.cash - 150);
    if (s.rng.chance(0.4)) s.hasGun = false;
  }
  s.wanted = 0; s.crimeHeat = 0; s.bustTimer = 0; s.pendingStars = null;
  s.health = 100; s.cops = []; s.player.inCar = null;
  s.player.x = s.city.zones.hospital.x + 10;
  s.player.z = s.city.zones.hospital.z + 10;
  s.mode = 'play';
  s.events.push({ name: 'save' });
}

export { BLOCK };
