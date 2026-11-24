// player.js — everything the player does directly: walking and
// driving, getting in and out of cars, gunplay, shopping at the
// gunshop and the Pay 'n Spray, robberies, and coming back after a
// bust or a wasting. Weapons are bought in a fixed chain — pistol,
// SMG, shotgun, rifle — each with its own magazine and reserve pool.

import { clamp, dist2 } from '../rng.js';
import { VehiclePhysics } from './physics.js';
import { reportCrime, damageCar } from './wanted.js';
import { startMission, startTaxi } from './missions.js';

export const WEAPONS = {
  pistol: { label: '9MM', price: 300, dmg: 34, cd: 0.30, auto: false, mag: 12, spread: 0.014, range: 65 },
  smg: { label: 'SMG', price: 600, dmg: 15, cd: 0.082, auto: true, mag: 30, spread: 0.03, range: 55 },
  shotgun: { label: '12G', price: 800, dmg: 85, cd: 0.85, auto: false, mag: 6, spread: 0.075, range: 30 },
  rifle: { label: 'AR', price: 1000, dmg: 30, cd: 0.105, auto: true, mag: 30, spread: 0.016, range: 85 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];
const OWNED_FIELD = { pistol: 'hasGun', smg: 'hasSmg', shotgun: 'hasShotgun', rifle: 'hasRifle' };

export function weaponDef(state) {
  return WEAPONS[state.weapon] || WEAPONS.pistol;
}

export function rankFor(respect) {
  if (respect >= 450) return 'KINGPIN';
  if (respect >= 150) return 'OPERATOR';
  return 'RUNNER';
}

export function enterExitCar(state) {
  const p = state.player;
  if (p.inCar) {
    const car = p.inCar;
    p.inCar = null;
    car.parked = true;
    if (car.phys) { car.phys.u = 0; car.phys.v = 0; car.phys.omega = 0; }
    car.speed = 0;
    p.x = car.x + Math.cos(car.ry) * -2.0;
    p.z = car.z - Math.sin(car.ry) * -2.0;
    p.ry = car.ry;
    return;
  }
  let best = null, bestD = 4.6 * 4.6;
  for (const car of state.cars.concat(state.cops)) {
    if (car.exploded) continue;
    const d = dist2(car.x, car.z, p.x, p.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (!best) return;
  p.inCar = best;
  best.parked = false;
  if (!best.phys) {
    best.phys = new VehiclePhysics();
    best.phys.u = best.speed || 0;
  }
  if (best.kind === 'cop') reportCrime(state, 0.6);
  p.x = best.x; p.z = best.z;
}

export function shoot(state) {
  const p = state.player;
  if (p.inCar || !state.hasGun || state.reloadT > 0) return;
  const def = weaponDef(state);
  const ammo = state.ammo[state.weapon];
  if (state.fireCd > 0) return;
  if (ammo.mag <= 0) {
    state.events.push({ name: 'dryFire', data: 0 });
    state.fireCd = 0.3;
    return;
  }
  ammo.mag--;
  state.fireCd = def.cd;
  state.flashT = 0.055;
  state.recoil = 1;
  state.events.push({ name: 'shot', data: 0 });
  state.alarmX = p.x; state.alarmZ = p.z; state.alarmT = state.time;
  // A shot heard by anyone nearby is a crime.
  let witnessed = false;
  for (const ped of state.peds) if (dist2(ped.x, ped.z, p.x, p.z) < 30 * 30) { witnessed = true; break; }
  if (!witnessed) for (const cop of state.cops) if (dist2(cop.x, cop.z, p.x, p.z) < 42 * 42) { witnessed = true; break; }
  if (witnessed) reportCrime(state, 0.4);

  const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
  const jitter = (state.rng.next() - 0.5) * def.spread * 2;
  const dx = fx + Math.cos(p.ry) * jitter, dz = fz - Math.sin(p.ry) * jitter;
  const rayHit = (tx, tz, radius) => {
    const relX = tx - p.x, relZ = tz - p.z;
    const along = relX * dx + relZ * dz;
    if (along < 0.5 || along > def.range) return -1;
    const side = Math.abs(relX * dz - relZ * dx);
    return side < radius ? along : -1;
  };
  let bestAlong = Infinity, victim = null, victimKind = '';
  for (const t of state.targets) {
    if (t.down) continue;
    const a = rayHit(t.x, t.z, 1.1);
    if (a > 0 && a < bestAlong) { bestAlong = a; victim = t; victimKind = 'target'; }
  }
  if (state.boss && !state.boss.done) {
    const a = rayHit(state.boss.x, state.boss.z, 1.2);
    if (a > 0 && a < bestAlong) { bestAlong = a; victim = state.boss; victimKind = 'boss'; }
  }
  for (const ped of state.peds) {
    if (ped.state === 'dead') continue;
    const a = rayHit(ped.x, ped.z, 1.0);
    if (a > 0 && a < bestAlong) { bestAlong = a; victim = ped; victimKind = 'ped'; }
  }
  for (const car of state.cars.concat(state.cops)) {
    const a = rayHit(car.x, car.z, 2.3);
    if (a > 0 && a < bestAlong) { bestAlong = a; victim = car; victimKind = 'car'; }
  }
  if (!victim) return;
  if (victimKind === 'target') {
    victim.hp -= def.dmg;
    if (victim.hp <= 0 && !victim.down) {
      victim.down = true;
      state.events.push({ name: 'targetDown', data: 0 });
    }
  } else if (victimKind === 'boss') {
    victim.hp -= def.dmg;
    if (victim.hp <= 0 && !victim.done) {
      victim.done = true;
      reportCrime(state, 0.8);
    }
  } else if (victimKind === 'ped') {
    victim.hp -= def.dmg;
    state.events.push({ name: 'hitPed', data: 0 });
    if (victim.hp <= 0) {
      victim.state = 'dead';
      reportCrime(state, 0.9);
    } else {
      victim.state = 'flee'; victim.stateT = 3;
      victim.tx = victim.x - fx * 20; victim.tz = victim.z - fz * 20;
    }
  } else if (victimKind === 'car') {
    damageCar(state, victim, def.dmg * 0.55);
  }
}

function collideBuildings(state, x, z, radius) {
  let outX = x, outZ = z, hit = false;
  for (const b of state.city.buildings) {
    const hw = b.w / 2 + radius, hd = b.d / 2 + radius;
    if (Math.abs(outX - b.x) < hw && Math.abs(outZ - b.z) < hd) {
      hit = true;
      const pushLeft = (b.x - hw) - outX, pushRight = (b.x + hw) - outX;
      const pushDown = (b.z - hd) - outZ, pushUp = (b.z + hd) - outZ;
      const minPush = Math.min(Math.abs(pushLeft), Math.abs(pushRight), Math.abs(pushDown), Math.abs(pushUp));
      if (minPush === Math.abs(pushLeft)) outX = b.x - hw;
      else if (minPush === Math.abs(pushRight)) outX = b.x + hw;
      else if (minPush === Math.abs(pushDown)) outZ = b.z - hd;
      else outZ = b.z + hd;
    }
  }
  return { x: outX, z: outZ, hit };
}

function tryInteract(state) {
  const p = state.player;
  const zones = state.city.zones;
  const near = (z, r) => dist2(z.x, z.z, p.x, p.z) < r * r;
  // Robbery first: a pedestrian with their hands up drops a wallet.
  if (!p.inCar && state.hasGun && p.aim) {
    for (const ped of state.peds) {
      if (ped.state === 'handsup' && !ped.robbed && dist2(ped.x, ped.z, p.x, p.z) < 4.5 * 4.5) {
        ped.robbed = true;
        ped.state = 'flee'; ped.stateT = 2.5;
        ped.tx = ped.x - (p.x - ped.x) * 3; ped.tz = ped.z - (p.z - ped.z) * 3;
        state.pickups.push({ x: ped.x, z: ped.z, amount: 40 + Math.floor(state.rng.next() * 90) });
        state.events.push({ name: 'robDrop', data: 0 });
        reportCrime(state, 0.5);
        return;
      }
    }
  }
  if (near(zones.gunshop, 6) && !p.inCar) {
    const next = WEAPON_ORDER.find((w) => !state[OWNED_FIELD[w]]);
    if (!next) { state.msg = 'AMMU-NATION — YOU OWN THE WALL'; state.msgT = 1.8; return; }
    const def = WEAPONS[next];
    if (state.cash < def.price) { state.msg = `${def.label} — $${def.price} NEEDED`; state.msgT = 1.8; return; }
    state.cash -= def.price;
    state[OWNED_FIELD[next]] = true;
    state.weapon = next;
    state.ammo[next] = { mag: def.mag, res: def.mag * 4 };
    state.events.push({ name: 'buyGun', data: next });
    state.events.push({ name: 'save', data: 0 });
    return;
  }
  if (near(zones.spray, 7) && p.inCar) {
    const car = p.inCar;
    if ((state.stars > 0 || car.hp < 100) && state.cash >= 100) {
      state.cash -= 100;
      car.hp = 100; car.smoke = 0; car.burning = 0;
      car.color = [state.rng.range(0.3, 0.95), state.rng.range(0.3, 0.95), state.rng.range(0.3, 0.95)];
      state.heat = 0; state.stars = 0; state.cops = []; state.heli = null;
      state.events.push({ name: 'spray', data: 0 });
      state.events.push({ name: 'save', data: 0 });
    } else if (!state.armorUp && state.cash >= 400) {
      state.cash -= 400; state.armorUp = true;
      state.msg = 'HULL ARMOUR FITTED (+50% TOUGHNESS)';
      state.msgT = 2.2;
      state.events.push({ name: 'save', data: 0 });
    } else if (!state.engineUp && state.cash >= 500) {
      state.cash -= 500; state.engineUp = true;
      state.msg = 'ENGINE TUNED (+15% POWER)';
      state.msgT = 2.2;
      state.events.push({ name: 'save', data: 0 });
    } else {
      state.msg = "PAY 'N SPRAY — $100 RESPRAY · $400 ARMOUR · $500 ENGINE";
      state.msgT = 2;
    }
    return;
  }
  if (near(zones.hospital, 6) && !p.inCar) {
    if (p.hp < 100) { p.hp = 100; state.msg = 'PATCHED UP'; state.msgT = 1.5; }
    return;
  }
  if (near(zones.contact, 6) && !p.inCar) {
    if (!startMission(state)) {
      state.msg = state.missionIdx >= 8 ? 'ALL JOBS DONE — TAXI WORK FOREVER (T)' : 'FINISH THE CURRENT JOB FIRST';
      state.msgT = 1.8;
    }
  }
}

export function respawn(state, mode) {
  const p = state.player;
  if (mode === 'busted') {
    const fine = Math.min(state.cash, 250);
    state.cash -= fine;
    state.msg = 'BUSTED — $' + fine + ' FINE';
  } else {
    state.msg = 'WASTED — THE HOSPITAL KEPT THE CHANGE';
    state.cash = Math.max(0, state.cash - 100);
  }
  state.msgT = 2.6;
  p.hp = 100; p.armor = 0; p.inCar = null;
  const hz = state.city.zones.hospital;
  p.x = hz.x; p.z = hz.z;
  state.heat = 0; state.stars = 0; state.cops = []; state.heli = null;
  state.bust = 0; state.trauma = 0;
  state.mode = 'play';
  state.events.push({ name: 'save', data: 0 });
}

export function stepPlayer(state, input, dt) {
  const p = state.player;
  state.fireCd = Math.max(0, state.fireCd - dt);
  state.flashT = Math.max(0, state.flashT - dt);
  state.recoil = Math.max(0, state.recoil - dt * 6);
  if (state.reloadT > 0) {
    state.reloadT -= dt;
    if (state.reloadT <= 0) {
      const def = weaponDef(state);
      const ammo = state.ammo[state.weapon];
      const need = def.mag - ammo.mag;
      const take = Math.min(need, ammo.res);
      ammo.mag += take; ammo.res -= take;
    }
  }
  if (input.reload && state.reloadT <= 0) {
    const ammo = state.ammo[state.weapon];
    if (ammo.mag < weaponDef(state).mag && ammo.res > 0) state.reloadT = 1.05;
  }
  if (input.enter) enterExitCar(state);
  if (input.taxi) startTaxi(state);
  if (input.interact) tryInteract(state);

  if (p.inCar) {
    const car = p.inCar;
    const phys = car.phys;
    const ctl = {
      throttle: (input.up ? 1 : 0) + (input.down ? -1 : 0),
      steer: (input.right ? 1 : 0) + (input.left ? -1 : 0),
      handbrake: !!input.handbrake,
    };
    phys.update(dt, ctl, { engineMul: state.engineUp ? 1.15 : 1 });
    const prevSpeed = Math.abs(car.speed || 0);
    car.ry += phys.omega * dt;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    car.x += (fx * phys.u + rx * phys.v) * dt;
    car.z += (fz * phys.u + rz * phys.v) * dt;
    const col = collideBuildings(state, car.x, car.z, 1.6);
    if (col.hit) {
      car.x = col.x; car.z = col.z;
      if (prevSpeed > 7) {
        damageCar(state, car, prevSpeed * (state.armorUp ? 0.8 : 1.2));
        state.events.push({ name: 'crash', data: prevSpeed });
        state.trauma = Math.min(1, state.trauma + prevSpeed * 0.02);
        if (prevSpeed > 12) hurtPlayer(state, prevSpeed * 0.7);
      }
      phys.u *= 0.35; phys.v *= 0.3;
    }
    car.speed = phys.u;
    car.rpm = phys.rpm; car.gear = phys.gear;
    car.slip = phys.slip;
    car.isDrifting = ctl.handbrake && Math.abs(phys.u) > 7 && phys.slip > 6;
    p.x = car.x; p.z = car.z; p.ry = car.ry;
    // Bust meter: stationary with a unit on top of you.
    let copNear = false;
    for (const cop of state.cops) if (dist2(cop.x, cop.z, car.x, car.z) < 8 * 8) { copNear = true; break; }
    if (state.stars > 0 && Math.abs(car.speed) < 2.5 && copNear) {
      state.bust = Math.min(1, state.bust + dt / 2.4);
      if (state.bust >= 1) {
        state.mode = 'busted';
        state.events.push({ name: 'busted', data: 0 });
      }
    } else {
      state.bust = Math.max(0, state.bust - dt * 0.7);
    }
  } else {
    // On foot: move relative to the camera heading.
    const run = input.shift ? 5.8 : 3.3;
    let mx = 0, mz = 0;
    const fx = Math.sin(state.camYaw), fz = Math.cos(state.camYaw);
    const rx = Math.cos(state.camYaw), rz = -Math.sin(state.camYaw);
    if (input.up) { mx += fx; mz += fz; }
    if (input.down) { mx -= fx; mz -= fz; }
    if (input.right) { mx += rx; mz += rz; }
    if (input.left) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx = mx / len * run; mz = mz / len * run;
      const col = collideBuildings(state, p.x + mx * dt, p.z + mz * dt, 0.55);
      p.x = col.x; p.z = col.z;
      p.walkPhase = (p.walkPhase || 0) + dt * run * 2.1;
      p.moving = true;
    } else p.moving = false;
    p.ry = state.camYaw;
    p.aim = !!input.aim;
    let copNear = false;
    for (const cop of state.cops) if (dist2(cop.x, cop.z, p.x, p.z) < 3.2 * 3.2) { copNear = true; break; }
    if (state.stars > 0 && copNear) {
      state.bust = Math.min(1, state.bust + dt / 1.6);
      if (state.bust >= 1) { state.mode = 'busted'; state.events.push({ name: 'busted', data: 0 }); }
    } else state.bust = Math.max(0, state.bust - dt * 0.7);
  }

  p.x = clamp(p.x, -175, 185);
  p.z = clamp(p.z, -175, 175);
  if (p.hp <= 0 && state.mode === 'play') {
    state.mode = 'wasted';
    state.events.push({ name: 'wasted', data: 0 });
  }
}

export function hurtPlayer(state, amount) {
  const p = state.player;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, amount * 0.7);
    p.armor -= absorbed;
    p.hp -= amount - absorbed;
  } else {
    p.hp -= amount;
  }
  state.trauma = Math.min(1, state.trauma + 0.25);
}
