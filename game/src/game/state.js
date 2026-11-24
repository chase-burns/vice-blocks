// state.js — assembles the entire game state, then advances it one tick
// at a time in a fixed order: player, reload bookkeeping, the
// fire/explosion chain, traffic, pedestrians, population density, the
// wanted system, missions. It is pure logic — no DOM, no WebGL — so the
// identical code runs headless under Node for smoke tests.
import { makeRng, clamp, dist2 } from '../rng.js';
import { genCity, BLOCK } from './world.js';
import { spawnTraffic, spawnParked, stepTrafficCar, placeCarNear, damageCar } from './traffic.js';
import { spawnPed, stepPed, placePedNear } from './pedestrians.js';
import * as wantedModule from './wanted.js';
import * as playerModule from './player.js';
import { stepMissions, startMission } from './missions.js';

const TRAFFIC_POOL = 16;
const PARKED_POOL = 10;
const PED_POOL = 30;

export function createState(seed, saved) {
  const rng = makeRng(seed);
  const s = {
    rng, seed, time: 0, mode: 'title', city: genCity(seed),
    player: { x: -BLOCK * 0.5 + 9, z: BLOCK * 1.5, ry: 0, inCar: null, aim: false, speed: 0, bobPhase: 0 },
    cars: [], cops: [], peds: [], pickups: [], targets: [], events: [],
    stats: { stolen: 0, earned: 0 },
    health: 100, armor: 0, cash: 80,
    hasGun: false, ammo: 12, reserve: 240, reloadT: 0,
    hasSmg: false, weapon: 'pistol', ammoSmg: 0, fireCd: 0,
    hasShotgun: false, ammoShotgun: 0, hasRifle: false, ammoRifle: 0, flashT: 0,
    respect: 0, radio: 0, armorUp: false, engineUp: false, heli: null,
    wanted: 0, crimeHeat: 0, bustTimer: 0, pendingStars: null, dispatchT: 0, wantedDecay: 0,
    missionIdx: 0, mission: null, taxi: null, boss: null,
    banner: '', bannerT: 0, bannerColor: '', msg: '', msgT: 0,
    fine: 0, camYaw: 0, trauma: 0, recoil: 0, roadJolt: 0,
    gunfireT: 0, gunfireX: 0, gunfireZ: 0, shotMode: '',
  };
  // These two facades break what would otherwise be import cycles
  // between the logic modules.
  s.wantedAPI = { add: wantedModule.addWanted };
  s.playerAPI = { hurt: playerModule.hurt };
  s.cars = spawnTraffic(rng, TRAFFIC_POOL).concat(spawnParked(rng, PARKED_POOL));
  for (const car of s.cars) {
    const paintedLikeTaxi = car.color[0] > 0.9 && car.color[1] > 0.7 && car.color[2] < 0.3;
    if (paintedLikeTaxi) car.style = 'taxi';
    else if (rng.chance(0.24)) car.style = 'sport';
  }
  const firstParkedCar = s.cars.find((c) => c.kind === 'parked');
  if (firstParkedCar) firstParkedCar.style = 'sport';
  for (let i = 0; i < PED_POOL; i++) s.peds.push(spawnPed(s, rng));
  if (saved) restoreSave(s, saved);
  return s;
}

function restoreSave(s, saved) {
  if (typeof saved.cash === 'number') s.cash = saved.cash;
  if (typeof saved.missionIdx === 'number') s.missionIdx = clamp(saved.missionIdx, 0, 8);
  s.hasGun = !!saved.hasGun;
  s.hasSmg = !!saved.hasSmg; if (s.hasSmg) s.ammoSmg = 30;
  s.hasShotgun = !!saved.hasShotgun; if (s.hasShotgun) s.ammoShotgun = 6;
  s.hasRifle = !!saved.hasRifle; if (s.hasRifle) s.ammoRifle = 25;
  if (saved.weapon && playerModule.ownsWeapon(s, saved.weapon)) s.weapon = saved.weapon;
  s.respect = saved.respect || 0;
  s.armorUp = !!saved.armorUp; s.engineUp = !!saved.engineUp;
  if (typeof saved.armor === 'number') s.armor = saved.armor;
}

export function drainEvents(s) { const drained = s.events; s.events = []; return drained; }

// The burn chain: a wreck at zero health catches fire, burns for a few
// seconds, then detonates — damaging nearby cars (which may catch and
// blow in turn), scattering pedestrians and shaking the player.
export function processBurning(s, dt) {
  const allVehicles = s.cars.concat(s.cops);
  for (const car of allVehicles) {
    if (car.kind === 'dead') continue;
    if (car.hp <= 0 && car.burning == null) {
      car.burning = car === s.player.inCar ? 3 : 2 + s.rng() * 2;
      s.events.push({ name: 'carFire', data: car });
    }
    if (car.burning == null || car.burning <= 0) continue;
    car.burning -= dt;
    if (car.burning > 0) continue;
    car.burning = 0; car.kind = 'dead'; car.speed = 0; car.smoke = 2;
    s.events.push({ name: 'explode', data: { x: car.x, z: car.z } });
    for (const other of allVehicles) {
      if (other !== car && other.kind !== 'dead' && dist2(other.x, other.z, car.x, car.z) < 9 * 9) damageCar(s, other, 45);
    }
    for (const ped of s.peds) {
      if (ped.state !== 'dead' && dist2(ped.x, ped.z, car.x, car.z) < 8 * 8) { ped.state = 'flee'; ped.t = 3; }
    }
    const playerGap = Math.hypot(s.player.x - car.x, s.player.z - car.z);
    if (playerGap < 10) {
      s.trauma = Math.min(1, (s.trauma || 0) + (1 - playerGap / 10) * 0.8);
      if (s.player.inCar) damageCar(s, s.player.inCar, 30);
      else if (playerGap < 7) s.playerAPI.hurt(s, 30);
    }
    if (car === s.player.inCar) { s.player.inCar = null; s.playerAPI.hurt(s, 55); }
  }
}

// Keep the player's neighbourhood populated: at least five pedestrians
// and four traffic cars within 60 m, recycled in from across the city.
export function manageDensity(s) {
  const p = s.player;
  let pedsNearby = 0; const pedsFar = [];
  for (const ped of s.peds) {
    const d = dist2(ped.x, ped.z, p.x, p.z);
    if (d < 60 * 60) pedsNearby++;
    else if (d > 95 * 95 && ped.state === 'walk') pedsFar.push(ped);
  }
  for (let i = 0; pedsNearby < 5 && i < pedsFar.length; i++, pedsNearby++) placePedNear(s, pedsFar[i], s.rng);
  let carsNearby = 0; const carsFar = [];
  for (const car of s.cars) {
    if (car.kind !== 'traffic') continue;
    const d = dist2(car.x, car.z, p.x, p.z);
    if (d < 60 * 60) carsNearby++;
    else if (d > 100 * 100) carsFar.push(car);
  }
  for (let i = 0; carsNearby < 4 && i < carsFar.length; i++, carsNearby++) placeCarNear(s, carsFar[i], s.rng);
}

function tickShortTimers(s, dt) {
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
  tickShortTimers(s, dt);
  if (s.mode !== 'play') return;
  if (!s.mission && !s.taxi && s.missionIdx === 0 && !s._metContact) {
    const contactZone = s.city.zones.contact;
    if (dist2(s.player.x, s.player.z, contactZone.x, contactZone.z) < contactZone.r * contactZone.r) { s._metContact = true; startMission(s); }
  }
  const p = s.player;
  if (p.inCar) playerModule.stepPlayerCar(s, input, dt);
  else playerModule.stepPlayerFoot(s, input, dt);
  playerModule.stepZonesCar(s, dt);
  const activeDef = playerModule.WEAPONS[playerModule.activeWeapon(s)];
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= 0 && s.reserve > 0) {
      const roundsMoved = Math.min(activeDef.size - s[activeDef.mag], s.reserve);
      s[activeDef.mag] += roundsMoved; s.reserve -= roundsMoved;
    }
  }
  if (input.reload && s.hasGun && s[activeDef.mag] < activeDef.size && s.reserve > 0 && s.reloadT <= 0) s.reloadT = 0.9;
  processBurning(s, dt);
  for (const car of s.cars) if (car !== p.inCar && car.kind === 'traffic') stepTrafficCar(s, car, dt);
  for (const ped of s.peds) stepPed(s, ped, dt);
  s.peds = s.peds.filter((ped) => ped.state !== 'dead' || ped.t > -6);
  while (s.peds.length < 28) s.peds.push(spawnPed(s, s.rng));
  s.densityT = (s.densityT || 0) - dt;
  if (s.densityT <= 0) { s.densityT = 0.6; manageDensity(s); }
  const wantedBefore = s.wanted;
  wantedModule.stepWanted(s, dt);
  if (wantedBefore >= 2 && s.wanted === 0 && s.mode === 'play') {
    s.respect += 40;
    s.events.push({ name: 'respect', data: s.respect });
    s.msg = 'CLEAN GETAWAY — RESPECT +40'; s.msgT = 2;
  }
  stepMissions(s, dt);
  for (const car of s.cars) {
    if (car.kind === 'traffic' && dist2(car.x, car.z, p.x, p.z) > 300 * 300) {
      car.x = p.x + s.rng.range(-120, 120);
      car.z = p.z + s.rng.range(-120, 120);
    }
  }
}
