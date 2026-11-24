// player.js — everything the player does with their own hands and feet:
// first-person walking, driving through the physics model, entering and
// stealing cars, shooting, shopping at the gun store, using the
// Pay 'n Spray from the driver's seat, taking damage, and respawning
// after a bust or a hospital visit.
import { dist2 } from '../rng.js';
import { collideBuildings, BLOCK } from './world.js';
import { VehiclePhysics } from './physics.js';
import { damageCar } from './traffic.js';
import { witnessed } from './wanted.js';

// The arsenal. All four weapons draw from one shared reserve pool; each
// keeps its own magazine field, cadence, spread, pellet count and
// vehicle damage. Ammu-Nation sells strictly in order, and keys 1–4
// switch between the weapons you own.
export const WEAPONS = {
  pistol: { label: 'PISTOL', short: '9MM', mag: 'ammo', size: 12, cd: 0.25, auto: false, spread: 1.2, carDmg: 18, range: 50, pellets: 1, price: 300 },
  smg: { label: 'SMG', short: 'SMG', mag: 'ammoSmg', size: 30, cd: 0.09, auto: true, spread: 2.8, carDmg: 9, range: 50, pellets: 1, price: 600 },
  shotgun: { label: 'SHOTGUN', short: '12G', mag: 'ammoShotgun', size: 6, cd: 0.85, auto: false, spread: 3.6, carDmg: 11, range: 32, pellets: 6, price: 800 },
  rifle: { label: 'RIFLE', short: 'AR', mag: 'ammoRifle', size: 25, cd: 0.13, auto: true, spread: 0.7, carDmg: 22, range: 70, pellets: 1, price: 1000 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];
const OWNED_FLAG = { pistol: 'hasGun', smg: 'hasSmg', shotgun: 'hasShotgun', rifle: 'hasRifle' };
const STARTING_MAG = { pistol: 12, smg: 30, shotgun: 6, rifle: 25 };

export function ownsWeapon(s, w) { return !!s[OWNED_FLAG[w]]; }
export function activeWeapon(s) { return ownsWeapon(s, s.weapon) ? s.weapon : 'pistol'; }
export function weaponDef(s) { return WEAPONS[activeWeapon(s)]; }

export function hurt(s, dmg) {
  const absorbed = Math.min(s.armor, dmg * 0.6);
  s.armor -= absorbed; s.health -= dmg - absorbed;
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
  let closest = null, closestD2 = 4.5 * 4.5;
  for (const car of s.cars.concat(s.cops)) {
    const d = dist2(car.x, car.z, p.x, p.z);
    if (d < closestD2) { closestD2 = d; closest = car; }
  }
  if (!closest) return;
  closest.hpMax = s.armorUp ? 150 : 100;
  if (closest.gear == null) closest.gear = 1;
  if (!closest.phys) closest.phys = new VehiclePhysics();
  closest.phys.u = closest.speed || 0; closest.phys.v = 0; closest.phys.omega = 0;
  p.inCar = closest;
  if (closest.kind === 'parked' || closest.kind === 'traffic') {
    if (closest.driver) s.events.push({ name: 'yank' });
    closest.kind = 'player'; closest.driver = false; s.stats.stolen++;
    s.wantedAPI.add(s, 1, witnessed(s, p.x, p.z));
  }
  s.events.push({ name: 'enterCar' });
}

// One trigger pull, resolved pellet by pellet: the nearest pedestrian on
// the shot line wins, then mission targets, then the nearest vehicle.
// The wanted consequences scale with what was actually hit.
export function shoot(s) {
  const p = s.player;
  if (!s.hasGun || p.inCar) return;
  const weaponKey = activeWeapon(s), W = WEAPONS[weaponKey];
  if (s[W.mag] <= 0) { s.events.push({ name: 'dryFire' }); return; }
  s[W.mag]--; s.recoil = 1; s.flashT = 0.07; s.gunfireT = 0.6; s.gunfireX = p.x; s.gunfireZ = p.z;
  s.events.push({ name: 'shot', data: weaponKey });
  const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
  let hitSomething = false, killedPed = false, hitCopCar = false;
  for (let pellet = 0; pellet < W.pellets; pellet++) {
    const lateralJitter = W.pellets > 1 ? (Math.random() * 2 - 1) * W.spread : 0;
    const tolerance = W.pellets > 1 ? 1.15 : W.spread;
    const alongDist = (x, z) => (x - p.x) * fx + (z - p.z) * fz;
    const lateralDist = (x, z) => (x - p.x) * fz - (z - p.z) * fx - lateralJitter;
    let pedVictim = null, victimAlong = W.range;
    for (const ped of s.peds) {
      if (ped.state === 'dead') continue;
      const along = alongDist(ped.x, ped.z);
      if (along > 0 && along < victimAlong && Math.abs(lateralDist(ped.x, ped.z)) < tolerance) { pedVictim = ped; victimAlong = along; }
    }
    let targetWasHit = false;
    for (const tg of s.targets || []) {
      if (tg.down) continue;
      const along = alongDist(tg.x, tg.z);
      if (along > 0 && along < victimAlong && Math.abs(lateralDist(tg.x, tg.z)) < 1.4) { tg.down = true; targetWasHit = true; victimAlong = along; }
    }
    if (targetWasHit) { s.events.push({ name: 'targetDown', data: null }); hitSomething = true; continue; }
    if (pedVictim) { pedVictim.state = 'dead'; pedVictim.t = 4; hitSomething = true; killedPed = true; s.events.push({ name: 'hitPed' }); continue; }
    for (const car of s.cars.concat(s.cops)) {
      const along = alongDist(car.x, car.z);
      if (along > 0 && along < W.range * 0.84 && Math.abs(lateralDist(car.x, car.z)) < 2.2) {
        damageCar(s, car, W.carDmg);
        if (car.kind === 'cop') hitCopCar = true;
        hitSomething = true; break;
      }
    }
  }
  if (killedPed) s.wantedAPI.add(s, 3, witnessed(s, p.x, p.z));
  else if (hitCopCar) s.wantedAPI.add(s, Math.max(3, s.wanted), true);
  else if (!hitSomething) s.wantedAPI.add(s, 1, witnessed(s, p.x, p.z));
}

export function stepPlayerCar(s, input, dt) {
  const p = s.player, car = p.inCar;
  if (!car.phys) car.phys = new VehiclePhysics();
  const phys = car.phys;
  phys.powerMul = s.engineUp ? 1.15 : 1;
  const substeps = 2, subDt = dt / substeps;
  let hardestHit = 0;
  for (let i = 0; i < substeps; i++) {
    phys.update(subDt, { throttle: input.up ? 1 : 0, brake: input.down ? 1 : 0, steer: (input.left ? -1 : 0) + (input.right ? 1 : 0), handbrake: input.handbrake });
    car.ry += phys.omega * subDt;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const velX = fx * phys.u + rx * phys.v, velZ = fz * phys.u + rz * phys.v;
    let tryX = car.x + velX * subDt, tryZ = car.z + velZ * subDt;
    const resolved = collideBuildings(s.city, tryX, tryZ, 1.7);
    const resX = resolved[0], resZ = resolved[1];
    if (resX !== tryX || resZ !== tryZ) {
      const pushX = resX - tryX, pushZ = resZ - tryZ, pushLen = Math.hypot(pushX, pushZ) || 1;
      const axisX = pushX / pushLen, axisZ = pushZ / pushLen;
      const velIntoWall = velX * axisX + velZ * axisZ;
      if (velIntoWall < 0) {
        const slideX = velX - velIntoWall * axisX, slideZ = velZ - velIntoWall * axisZ;
        const newVelX = slideX * 0.5 - velIntoWall * 0.2 * axisX, newVelZ = slideZ * 0.5 - velIntoWall * 0.2 * axisZ;
        hardestHit = Math.max(hardestHit, Math.abs(velIntoWall));
        phys.u = newVelX * fx + newVelZ * fz; phys.v = newVelX * rx + newVelZ * rz;
      }
      tryX = resX; tryZ = resZ;
    }
    car.x = tryX; car.z = tryZ;
  }
  car.speed = phys.u; car.velSpeed = Math.hypot(phys.u, phys.v);
  car.steerAngle = phys.steerAngle; car.slip = Math.abs(phys.v - phys.omega * 1.4);
  car.rpm = phys.rpm; car.gear = phys.gear; car.handbrake = phys.handbrake; car.isDrifting = phys.isDrifting;
  if (hardestHit > 4) { damageCar(s, car, hardestHit * 1.1); s.events.push({ name: 'crash', data: hardestHit }); s.trauma = Math.min(1, (s.trauma || 0) + hardestHit / 15); }
  p.x = car.x; p.z = car.z; p.ry = car.ry;
  resolveVehicleContacts(s, car, phys);
  resolvePedestrianContacts(s, car);
  car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
  if (car.smoke === 2 && s.rng.chance(dt * 0.25)) damageCar(s, car, 3);
  gatherPickups(s);
}

// Shoving other traffic aside as you pass. A roadblock cruiser can be
// punched straight through: it spins off the line, the line breaks, and
// the law definitely notices.
function resolveVehicleContacts(s, car, phys) {
  for (const other of s.cars.concat(s.cops)) {
    if (other === car || other.kind === 'dead') continue;
    if (dist2(other.x, other.z, car.x, car.z) >= 3.1 * 3.1) continue;
    if (car.velSpeed <= 2) continue;
    const dx = other.x - car.x, dz = other.z - car.z, len = Math.hypot(dx, dz) || 1;
    if (other.roadblock) {
      other.roadblock = false;
      other.x += (dx / len) * 2.4 + (dz / len) * 1.2;
      other.z += (dz / len) * 2.4 - (dx / len) * 1.2;
      other.ry += 0.9; other.speed = 3;
      damageCar(s, other, 30); damageCar(s, car, 10);
      s.trauma = Math.min(1, (s.trauma || 0) + 0.3);
      s.events.push({ name: 'roadblockHit', data: other });
      s.wantedAPI.add(s, Math.max(4, s.wanted), true);
    } else {
      other.x += (dx / len) * 0.9; other.z += (dz / len) * 0.9;
      damageCar(s, other, 8); damageCar(s, car, 5); phys.u *= 0.82;
    }
  }
}

function resolvePedestrianContacts(s, car) {
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
  const moveSpeed = input.shift ? 8.2 : 4.5;
  const strafeInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const forwardInput = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  p.bobPhase = p.bobPhase || 0;
  if (strafeInput || forwardInput) {
    const yaw = s.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let moveX = fx * forwardInput + rx * strafeInput, moveZ = fz * forwardInput + rz * strafeInput;
    const len = Math.hypot(moveX, moveZ) || 1; moveX /= len; moveZ /= len;
    p.ry = Math.atan2(moveX, moveZ);
    const resolved = collideBuildings(s.city, p.x + moveX * moveSpeed * dt, p.z + moveZ * moveSpeed * dt, 0.55);
    p.x = resolved[0]; p.z = resolved[1];
    p.speed = moveSpeed; p.bobPhase += dt * moveSpeed * 1.6;
  } else p.speed = 0;
  p.aim = !!(input.aim && s.hasGun);
  gatherPickups(s);
  stepFootZoneEffects(s, input, dt);
}

function insideZone(p, zone) { return dist2(p.x, p.z, zone.x, zone.z) < zone.r * zone.r; }

function stepFootZoneEffects(s, input, dt) {
  const p = s.player, zones = s.city.zones;
  if (insideZone(p, zones.gunshop) && input.interact) buyNextWeapon(s);
  if (insideZone(p, zones.hospital) && s.health < 100) s.health = Math.min(100, s.health + 22 * dt);
}

function buyNextWeapon(s) {
  const nextKey = WEAPON_ORDER.find((w) => !ownsWeapon(s, w));
  if (!nextKey) {
    if (s.reserve < 240) { s.reserve = 240; s.msg = 'AMMO RESTOCKED'; s.msgT = 1.5; }
    return;
  }
  const def = WEAPONS[nextKey];
  if (s.cash < def.price) { s.msg = def.label + ' $' + def.price + ' — NOT ENOUGH CASH'; s.msgT = 2; return; }
  s.cash -= def.price;
  s[OWNED_FLAG[nextKey]] = true; s[def.mag] = STARTING_MAG[nextKey]; s.weapon = nextKey;
  s.msg = nextKey === 'pistol' ? 'PISTOL PURCHASED — RIGHT MOUSE AIM, LEFT CLICK FIRE' : def.label + ' PURCHASED — KEYS 1-4 SWITCH';
  s.msgT = nextKey === 'pistol' ? 3 : 2.5;
  s.events.push({ name: 'buyGun' }); s.events.push({ name: 'save' });
}

function gatherPickups(s) {
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

// Pay 'n Spray, used from the driver's seat. Priority order: clear the
// heat first, then repairs, then the two one-time garage upgrades.
export function stepZonesCar(s, dt) {
  void dt;
  const p = s.player, car = p.inCar;
  if (!car) return;
  const sprayZone = s.city.zones.spray;
  if (!insideZone(p, sprayZone)) return;
  const hpCap = car.hpMax || 100;
  const fullRespray = () => { car.hp = hpCap; car.smoke = 0; car.burning = null; };
  if (s.wanted > 0 && s.cash >= 100) {
    s.cash -= 100; s.wanted = 0; s.crimeHeat = 0; s.pendingStars = null;
    s.cops = s.cops.filter((c) => c === car);
    fullRespray();
    car.color = [s.rng.range(0.3, 1), s.rng.range(0.3, 1), s.rng.range(0.3, 1)];
    s.events.push({ name: 'spray' }); s.events.push({ name: 'save' });
  } else if (car.hp < hpCap && s.cash >= 100) {
    s.cash -= 100; fullRespray(); s.events.push({ name: 'spray' });
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
