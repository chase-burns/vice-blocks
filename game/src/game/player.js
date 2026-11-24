// Player controller (WO Task 8): first-person foot movement, physics-driven
// driving, car entry/jacking, pistol shooting with recoil, damage/respawn.
import { clamp, dist2 } from '../rng.js';
import { collideBuildings, BLOCK } from './world.js';
import { VehiclePhysics } from './physics.js';
import { damageCar } from './traffic.js';
import { witnessed } from './wanted.js';

export function hurt(s, dmg) {
  // Armor absorbs first (WO HUD: health + armor meters).
  const absorbed = Math.min(s.armor, dmg * 0.6);
  s.armor -= absorbed;
  s.health -= (dmg - absorbed);
  s.events.push({ name: 'hurt', data: dmg });
  if (s.health <= 0 && s.mode === 'play') {
    s.health = 0; s.mode = 'wasted';
    s.events.push({ name: 'wasted' });
  }
}

export function enterExitCar(s) {
  const p = s.player;
  if (p.inCar) {
    const car = p.inCar;
    p.x = car.x + Math.cos(car.ry) * 2.4; p.z = car.z - Math.sin(car.ry) * 2.4;
    car.speed = car.phys ? car.phys.u : car.speed;
    p.inCar = null;
    s.events.push({ name: 'exitCar' });
    return;
  }
  let best = null, bd = 4.5 * 4.5;
  for (const c of [...s.cars, ...s.cops]) {
    const d = dist2(c.x, c.z, p.x, p.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) {
    best.hpMax = s.armorUp ? 150 : 100; // garage armour upgrade raises the cap
    if (best.gear == null) best.gear = 1;
    if (!best.phys) best.phys = new VehiclePhysics();
    best.phys.u = best.speed || 0; best.phys.v = 0; best.phys.omega = 0;
    p.inCar = best;
    if (best.kind === 'parked' || best.kind === 'traffic') {
      if (best.driver) s.events.push({ name: 'yank' });
      best.kind = 'player'; best.driver = false;
      s.stats.stolen++;
      s.wantedAPI.add(s, 1, witnessed(s, p.x, p.z));
    }
    s.events.push({ name: 'enterCar' });
  }
}

export function shoot(s) {
  const p = s.player;
  const smg = s.weapon === 'smg' && s.hasSmg;
  const magKey = smg ? 'ammoSmg' : 'ammo';
  if (!s.hasGun || p.inCar || s[magKey] <= 0) { if (s[magKey] <= 0 && s.hasGun) s.events.push({ name: 'dryFire' }); return; }
  s[magKey]--;
  const spread = smg ? 2.8 : 1.2;   // SMG: full-auto scatter
  const carDmg = smg ? 9 : 18;
  s.recoil = 1; // viewmodel slide kick, spring recovery in camera/render
  s.gunfireT = 0.6; s.gunfireX = p.x; s.gunfireZ = p.z;
  s.events.push({ name: 'shot' });
  const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
  let hit = null, hd = 50;
  for (const ped of s.peds) {
    const dx = ped.x - p.x, dz = ped.z - p.z;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < hd && Math.abs(dx * fz - dz * fx) < spread) { hit = ped; hd = along; }
  }
  // Mission training targets (Ammu-Nation Run).
  for (const tg of s.targets || []) {
    const dx = tg.x - p.x, dz = tg.z - p.z;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < hd && Math.abs(dx * fz - dz * fx) < 1.4 && !tg.down) {
      tg.down = true; s.events.push({ name: 'targetDown', data: tg });
      return;
    }
  }
  if (hit) {
    hit.state = 'dead'; hit.t = 4;
    s.wantedAPI.add(s, 3, witnessed(s, p.x, p.z));
    s.events.push({ name: 'hitPed' });
    return;
  }
  for (const c of [...s.cars, ...s.cops]) {
    const dx = c.x - p.x, dz = c.z - p.z;
    const along = dx * fx + dz * fz;
    if (along > 0 && along < 42 && Math.abs(dx * fz - dz * fx) < 2.2) {
      damageCar(s, c, carDmg);
      if (c.kind === 'cop') s.wantedAPI.add(s, Math.max(3, s.wanted), true);
      return;
    }
  }
  s.wantedAPI.add(s, 1, witnessed(s, p.x, p.z));
}

export function stepPlayerCar(s, input, dt) {
  const p = s.player, car = p.inCar;
  if (!car.phys) car.phys = new VehiclePhysics();
  const phys = car.phys;
  // Fixed-substep integration at 120 Hz for stability.
  const sub = 2, sdt = dt / sub;
  let impactDv = 0;
  for (let i = 0; i < sub; i++) {
    phys.update(sdt, {
      throttle: input.up ? 1 : 0, brake: input.down ? 1 : 0,
      steer: (input.left ? -1 : 0) + (input.right ? 1 : 0),
      handbrake: input.handbrake,
    });
    car.ry += phys.omega * sdt;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const vx = fx * phys.u + rx * phys.v, vz = fz * phys.u + rz * phys.v;
    let nx = car.x + vx * sdt, nz = car.z + vz * sdt;
    const [cx, cz] = collideBuildings(s.city, nx, nz, 1.7);
    if (cx !== nx || cz !== nz) {
      // Impact: split velocity into normal/tangent of the push-out axis.
      const pushX = cx - nx, pushZ = cz - nz;
      const pl = Math.hypot(pushX, pushZ) || 1;
      const anx = pushX / pl, anz = pushZ / pl;
      const vn = vx * anx + vz * anz;
      if (vn < 0) {
        const vtx = vx - vn * anx, vtz = vz - vn * anz;
        const nvx = vtx * 0.5 - vn * 0.2 * anx, nvz = vtz * 0.5 - vn * 0.2 * anz; // restitution 0.2, wall friction 0.5
        impactDv = Math.max(impactDv, Math.abs(vn));
        phys.u = nvx * fx + nvz * fz;
        phys.v = nvx * rx + nvz * rz;
      }
      nx = cx; nz = cz;
    }
    car.x = nx; car.z = nz;
  }
  car.speed = phys.u;
  car.velSpeed = Math.hypot(phys.u, phys.v);
  car.steerAngle = phys.steerAngle;
  car.slip = Math.abs(phys.v - phys.omega * 1.4);
  car.rpm = phys.rpm; car.gear = phys.gear;
  car.handbrake = phys.handbrake;
  car.isDrifting = phys.isDrifting;
  if (impactDv > 4) {
    damageCar(s, car, impactDv * 1.1);
    s.events.push({ name: 'crash', data: impactDv });
    s.trauma = Math.min(1, (s.trauma || 0) + impactDv / 15);
  }
  p.x = car.x; p.z = car.z; p.ry = car.ry;
  // Car-to-car contact: traffic gives way with damage; roadblock cruisers
  // can be punched through (shoved aside, spun, line broken).
  for (const o of [...s.cars, ...s.cops]) {
    if (o === car || o.kind === 'dead') continue;
    const d2o = dist2(o.x, o.z, car.x, car.z);
    if (d2o < 3.1 * 3.1 && car.velSpeed > 2) {
      const dx = o.x - car.x, dz = o.z - car.z;
      const dl = Math.hypot(dx, dz) || 1;
      if (o.roadblock) {
        o.roadblock = false;
        o.x += (dx / dl) * 2.4 + (dz / dl) * 1.2; o.z += (dz / dl) * 2.4 - (dx / dl) * 1.2;
        o.ry += 0.9; o.speed = 3;
        damageCar(s, o, 30); damageCar(s, car, 10);
        s.trauma = Math.min(1, (s.trauma || 0) + 0.3);
        s.events.push({ name: 'roadblockHit', data: o });
        s.wantedAPI.add(s, Math.max(4, s.wanted), true);
      } else {
        o.x += (dx / dl) * 0.9; o.z += (dz / dl) * 0.9;
        damageCar(s, o, 8); damageCar(s, car, 5);
        phys.u *= 0.82;
      }
    }
  }
  phys.powerMul = s.engineUp ? 1.15 : 1;
  for (const ped of s.peds) {
    if (ped.state !== 'dead' && car.velSpeed > 5 && dist2(ped.x, ped.z, car.x, car.z) < 2.3 * 2.3) {
      ped.state = 'dead'; ped.t = 5;
      damageCar(s, car, 4);
      s.wantedAPI.add(s, 2, witnessed(s, car.x, car.z));
      s.events.push({ name: 'hitPed' });
    }
  }
  car.smoke = car.hp < 55 ? (car.hp < 25 ? 2 : 1) : 0;
  if (car.smoke === 2 && s.rng.chance(dt * 0.25)) damageCar(s, car, 3);
  // Wallet pickups can be collected by driving over them too.
  collectPickups(s);
}

export function stepPlayerFoot(s, input, dt) {
  const p = s.player;
  const run = input.shift ? 8.2 : 4.5;
  const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const mz = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  p.bobPhase = p.bobPhase || 0;
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
    p.bobPhase += dt * run * 1.6;
  } else p.speed = 0;
  p.aim = !!(input.aim && s.hasGun);
  collectPickups(s);
  // Zone interactions on foot.
  const zones = s.city.zones;
  const inZone = (z) => dist2(p.x, p.z, z.x, z.z) < z.r * z.r;
  if (inZone(zones.gunshop) && input.interact) {
    if (!s.hasGun && s.cash >= 300) { s.cash -= 300; s.hasGun = true; s.ammo = 12; s.events.push({ name: 'buyGun' }); s.events.push({ name: 'save' }); }
    else if (!s.hasGun) { s.msg = 'PISTOL $300 — NOT ENOUGH CASH'; s.msgT = 2; }
    else if (!s.hasSmg && s.cash >= 600) { s.cash -= 600; s.hasSmg = true; s.ammoSmg = 30; s.weapon = 'smg'; s.msg = 'SMG PURCHASED — KEYS 1/2 SWITCH'; s.msgT = 2.5; s.events.push({ name: 'buyGun' }); s.events.push({ name: 'save' }); }
    else if (!s.hasSmg) { s.msg = 'SMG $600 — NOT ENOUGH CASH'; s.msgT = 2; }
    else if (s.reserve < 240) { s.reserve = 240; s.msg = 'AMMO RESTOCKED'; s.msgT = 1.5; }
  }
  if (inZone(zones.hospital) && s.health < 100) s.health = Math.min(100, s.health + 22 * dt);
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

export function stepZonesCar(s, dt) {
  const p = s.player, car = p.inCar;
  if (!car) return;
  const z = s.city.zones.spray;
  if (dist2(p.x, p.z, z.x, z.z) < z.r * z.r) {
    const hpCap = car.hpMax || 100;
    if (s.wanted > 0 && s.cash >= 100) {
      s.cash -= 100; s.wanted = 0; s.crimeHeat = 0; s.pendingStars = null;
      s.cops = s.cops.filter(c => c === car);
      car.hp = hpCap; car.smoke = 0; car.burning = null;
      car.color = [s.rng.range(0.3, 1), s.rng.range(0.3, 1), s.rng.range(0.3, 1)];
      s.events.push({ name: 'spray' }); s.events.push({ name: 'save' });
    } else if (car.hp < hpCap && s.cash >= 100) {
      s.cash -= 100; car.hp = hpCap; car.smoke = 0; car.burning = null; s.events.push({ name: 'spray' });
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
}

export function respawn(s, kind) {
  if (kind === 'busted') {
    s.cash -= s.fine || 0;
    if (s.hasGun && s.rng.chance(0.5)) s.hasGun = false;
  } else {
    s.cash = Math.max(0, s.cash - 150);
    if (s.rng.chance(0.4)) s.hasGun = false;
  }
  s.wanted = 0; s.crimeHeat = 0; s.bustTimer = 0; s.pendingStars = null; s.health = 100;
  s.cops = [];
  s.player.inCar = null;
  s.player.x = s.city.zones.hospital.x + 10;
  s.player.z = s.city.zones.hospital.z + 10;
  s.mode = 'play';
  s.events.push({ name: 'save' });
}
export { BLOCK };
