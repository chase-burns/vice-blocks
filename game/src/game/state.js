// state.js — assembles the whole game state and advances it one tick
// at a time in a fixed order: player, reload, the fire/explosion
// chain, traffic, pedestrians, density, wanted, missions. It is pure
// logic with no DOM and no WebGL, so the same code runs headless in
// Node for the smoke tests.
import { makeRng, clamp, dist2 } from '../rng.js';
import { genCity, BLOCK } from './world.js';
import { spawnTraffic, spawnParked, stepTrafficCar, placeCarNear, damageCar } from './traffic.js';
import { spawnPed, stepPed, placePedNear } from './pedestrians.js';
import * as wantedMod from './wanted.js';
import * as playerMod from './player.js';
import { stepMissions, startMission } from './missions.js';

const TRAFFIC_COUNT = 16;
const PARKED_COUNT = 10;
const PED_COUNT = 30;

export function createState(seed, saved) {
  const rng = makeRng(seed);
  const s = {
    rng, seed,
    time: 0,
    mode: 'title',
    city: genCity(seed),
    player: {
      x: -BLOCK * 0.5 + 9, z: BLOCK * 1.5, ry: 0,
      inCar: null, aim: false, speed: 0, bobPhase: 0,
    },
    cars: [], cops: [], peds: [], pickups: [], targets: [],
    events: [],
    stats: { stolen: 0, earned: 0 },
    health: 100, armor: 0, cash: 80,
    // arsenal fields (see player.js WEAPONS for the definitions)
    hasGun: false, ammo: 12, reserve: 240, reloadT: 0,
    hasSmg: false, weapon: 'pistol', ammoSmg: 0, fireCd: 0,
    hasShotgun: false, ammoShotgun: 0,
    hasRifle: false, ammoRifle: 0, flashT: 0,
    respect: 0, radio: 0,
    armorUp: false, engineUp: false, heli: null,
    // law
    wanted: 0, crimeHeat: 0, bustTimer: 0,
    pendingStars: null, dispatchT: 0, wantedDecay: 0,
    // story
    missionIdx: 0, mission: null, taxi: null, boss: null,
    // presentation timers, driven from here and read by HUD/audio
    banner: '', bannerT: 0, bannerColor: '', msg: '', msgT: 0,
    fine: 0, camYaw: 0, trauma: 0, recoil: 0, roadJolt: 0,
    gunfireT: 0, gunfireX: 0, gunfireZ: 0, shotMode: '',
  };
  // Indirection so the logic modules can call each other without
  // import cycles.
  s.wantedAPI = { add: wantedMod.addWanted };
  s.playerAPI = { hurt: playerMod.hurt };

  s.cars = spawnTraffic(rng, TRAFFIC_COUNT).concat(spawnParked(rng, PARKED_COUNT));
  for (const car of s.cars) {
    const looksTaxi = car.color[0] > 0.9 && car.color[1] > 0.7 && car.color[2] < 0.3;
    if (looksTaxi) car.style = 'taxi';
    else if (rng.chance(0.24)) car.style = 'sport';
  }
  const firstParked = s.cars.find((c) => c.kind === 'parked');
  if (firstParked) firstParked.style = 'sport';
  for (let i = 0; i < PED_COUNT; i++) s.peds.push(spawnPed(s, rng));

  if (saved) applySave(s, saved);
  return s;
}

function applySave(s, saved) {
  if (typeof saved.cash === 'number') s.cash = saved.cash;
  if (typeof saved.missionIdx === 'number') s.missionIdx = clamp(saved.missionIdx, 0, 8);
  s.hasGun = !!saved.hasGun;
  s.hasSmg = !!saved.hasSmg;
  if (s.hasSmg) s.ammoSmg = 30;
  s.hasShotgun = !!saved.hasShotgun;
  if (s.hasShotgun) s.ammoShotgun = 6;
  s.hasRifle = !!saved.hasRifle;
  if (s.hasRifle) s.ammoRifle = 25;
  if (saved.weapon && playerMod.ownsWeapon(s, saved.weapon)) s.weapon = saved.weapon;
  s.respect = saved.respect || 0;
  s.armorUp = !!saved.armorUp;
  s.engineUp = !!saved.engineUp;
  if (typeof saved.armor === 'number') s.armor = saved.armor;
}

export function drainEvents(s) {
  const drained = s.events;
  s.events = [];
  return drained;
}

// The burn chain: a car at zero health catches fire, burns for a few
// seconds, then explodes — damaging nearby cars (which may then burn
// and explode in turn), scattering pedestrians and shaking the player.
export function processBurning(s, dt) {
  const everyone = s.cars.concat(s.cops);
  for (const car of everyone) {
    if (car.kind === 'dead') continue;
    if (car.hp <= 0 && car.burning == null) {
      car.burning = car === s.player.inCar ? 3 : 2 + s.rng() * 2;
      s.events.push({ name: 'carFire', data: car });
    }
    if (car.burning == null || car.burning <= 0) continue;
    car.burning -= dt;
    if (car.burning > 0) continue;
    car.burning = 0;
    car.kind = 'dead';
    car.speed = 0;
    car.smoke = 2;
    s.events.push({ name: 'explode', data: { x: car.x, z: car.z } });
    for (const other of everyone) {
      if (other !== car && other.kind !== 'dead'
        && dist2(other.x, other.z, car.x, car.z) < 9 * 9) {
        damageCar(s, other, 45);
      }
    }
    for (const ped of s.peds) {
      if (ped.state !== 'dead' && dist2(ped.x, ped.z, car.x, car.z) < 8 * 8) {
        ped.state = 'flee';
        ped.t = 3;
      }
    }
    const playerDist = Math.hypot(s.player.x - car.x, s.player.z - car.z);
    if (playerDist < 10) {
      s.trauma = Math.min(1, (s.trauma || 0) + (1 - playerDist / 10) * 0.8);
      if (s.player.inCar) damageCar(s, s.player.inCar, 30);
      else if (playerDist < 7) s.playerAPI.hurt(s, 30);
    }
    if (car === s.player.inCar) {
      s.player.inCar = null;
      s.playerAPI.hurt(s, 55);
    }
  }
}

// Keep the player's neighbourhood alive: at least five pedestrians
// and four traffic cars within 60 m, recycled from far across the city.
export function manageDensity(s) {
  const p = s.player;
  let nearPeds = 0;
  const farPeds = [];
  for (const ped of s.peds) {
    const d = dist2(ped.x, ped.z, p.x, p.z);
    if (d < 60 * 60) nearPeds++;
    else if (d > 95 * 95 && ped.state === 'walk') farPeds.push(ped);
  }
  for (let i = 0; nearPeds < 5 && i < farPeds.length; i++, nearPeds++) {
    placePedNear(s, farPeds[i], s.rng);
  }
  let nearCars = 0;
  const farCars = [];
  for (const car of s.cars) {
    if (car.kind !== 'traffic') continue;
    const d = dist2(car.x, car.z, p.x, p.z);
    if (d < 60 * 60) nearCars++;
    else if (d > 100 * 100) farCars.push(car);
  }
  for (let i = 0; nearCars < 4 && i < farCars.length; i++, nearCars++) {
    placeCarNear(s, farCars[i], s.rng);
  }
}

function tickTimers(s, dt) {
  if (s.bannerT > 0) s.bannerT -= dt;
  if (s.msgT > 0) s.msgT -= dt;
  if (s.gunfireT > 0) s.gunfireT -= dt;
  s.trauma = Math.max(0, (s.trauma || 0) - dt * 1.4);
  s.recoil = Math.max(0, (s.recoil || 0) - dt / 0.12);
  s.fireCd = Math.max(0, (s.fireCd || 0) - dt);
  s.flashT = Math.max(0, (s.flashT || 0) - dt);
}

export function step(s, input, dt) {
  s.time += dt;
  tickTimers(s, dt);
  if (s.mode !== 'play') return;

  // The story opens when the player first reaches the contact marker.
  if (!s.mission && !s.taxi && s.missionIdx === 0 && !s._metContact) {
    const contact = s.city.zones.contact;
    if (dist2(s.player.x, s.player.z, contact.x, contact.z) < contact.r * contact.r) {
      s._metContact = true;
      startMission(s);
    }
  }

  const p = s.player;
  if (p.inCar) playerMod.stepPlayerCar(s, input, dt);
  else playerMod.stepPlayerFoot(s, input, dt);
  playerMod.stepZonesCar(s, dt);

  // Reload bookkeeping for whichever weapon is in hand.
  const def = playerMod.WEAPONS[playerMod.activeWeapon(s)];
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= 0 && s.reserve > 0) {
      const take = Math.min(def.size - s[def.mag], s.reserve);
      s[def.mag] += take;
      s.reserve -= take;
    }
  }
  if (input.reload && s.hasGun && s[def.mag] < def.size && s.reserve > 0 && s.reloadT <= 0) {
    s.reloadT = 0.9;
  }

  processBurning(s, dt);
  for (const car of s.cars) {
    if (car !== p.inCar && car.kind === 'traffic') stepTrafficCar(s, car, dt);
  }
  for (const ped of s.peds) stepPed(s, ped, dt);
  s.peds = s.peds.filter((ped) => ped.state !== 'dead' || ped.t > -6);
  while (s.peds.length < 28) s.peds.push(spawnPed(s, s.rng));

  s.densityT = (s.densityT || 0) - dt;
  if (s.densityT <= 0) {
    s.densityT = 0.6;
    manageDensity(s);
  }

  const wantedBefore = s.wanted;
  wantedMod.stepWanted(s, dt);
  if (wantedBefore >= 2 && s.wanted === 0 && s.mode === 'play') {
    s.respect += 40;
    s.events.push({ name: 'respect', data: s.respect });
    s.msg = 'CLEAN GETAWAY — RESPECT +40';
    s.msgT = 2;
  }

  stepMissions(s, dt);

  // Traffic that has drifted very far away respawns around the player.
  for (const car of s.cars) {
    if (car.kind === 'traffic' && dist2(car.x, car.z, p.x, p.z) > 300 * 300) {
      car.x = p.x + s.rng.range(-120, 120);
      car.z = p.z + s.rng.range(-120, 120);
    }
  }
}
