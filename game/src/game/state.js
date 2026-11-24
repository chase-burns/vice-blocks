// Game-state assembly + fixed-order step orchestration. Pure logic: no DOM,
// no WebGL — safe to run headless in Node for smoke tests.
import { makeRng, clamp, dist2 } from '../rng.js';
import { genCity, BLOCK } from './world.js';
import { spawnTraffic, spawnParked, stepTrafficCar, placeCarNear } from './traffic.js';
import { spawnPed, stepPed, placePedNear } from './pedestrians.js';
import * as wanted from './wanted.js';
import * as player from './player.js';
import { stepMissions, startMission } from './missions.js';

export function createState(seed, saved) {
  const rng = makeRng(seed);
  const s = {
    rng, seed, time: 0, mode: 'title',
    city: genCity(seed),
    player: { x: -BLOCK * 0.5 + 9, z: BLOCK * 1.5, ry: 0, inCar: null, aim: false, speed: 0, bobPhase: 0 },
    cars: [], cops: [], peds: [], pickups: [], targets: [],
    events: [], stats: { stolen: 0, earned: 0 },
    health: 100, armor: 0, cash: 80, hasGun: false, ammo: 12, reserve: 240, reloadT: 0,
    wanted: 0, crimeHeat: 0, bustTimer: 0, pendingStars: null, dispatchT: 0, wantedDecay: 0,
    missionIdx: 0, mission: null, taxi: null, boss: null,
    banner: '', bannerT: 0, bannerColor: '', msg: '', msgT: 0,
    fine: 0, camYaw: 0, trauma: 0, recoil: 0, roadJolt: 0,
    gunfireT: 0, gunfireX: 0, gunfireZ: 0, shotMode: '',
  };
  s.wantedAPI = { add: wanted.addWanted };
  s.playerAPI = { hurt: player.hurt };
  s.cars = [...spawnTraffic(rng, 16), ...spawnParked(rng, 10)];
  for (let i = 0; i < 30; i++) s.peds.push(spawnPed(s, rng));
  if (saved) {
    if (typeof saved.cash === 'number') s.cash = saved.cash;
    if (typeof saved.missionIdx === 'number') s.missionIdx = clamp(saved.missionIdx, 0, 5);
    s.hasGun = !!saved.hasGun;
    if (typeof saved.armor === 'number') s.armor = saved.armor;
  }
  return s;
}

export function drainEvents(s) { const e = s.events; s.events = []; return e; }

// Density management: keep the player's neighbourhood alive — at least ~5
// peds and ~4 traffic cars within 60 m; far entities are recycled nearby.
export function manageDensity(s) {
  const p = s.player;
  let nearPeds = 0;
  const farPeds = [];
  for (const ped of s.peds) {
    const d2 = dist2(ped.x, ped.z, p.x, p.z);
    if (d2 < 60 * 60) nearPeds++;
    else if (d2 > 95 * 95 && ped.state === 'walk') farPeds.push(ped);
  }
  for (let i = 0; nearPeds < 5 && i < farPeds.length; i++, nearPeds++) placePedNear(s, farPeds[i], s.rng);
  let nearCars = 0;
  const farCars = [];
  for (const c of s.cars) {
    if (c.kind !== 'traffic') continue;
    const d2 = dist2(c.x, c.z, p.x, p.z);
    if (d2 < 60 * 60) nearCars++;
    else if (d2 > 100 * 100) farCars.push(c);
  }
  for (let i = 0; nearCars < 4 && i < farCars.length; i++, nearCars++) placeCarNear(s, farCars[i], s.rng);
}

export function step(s, input, dt) {
  s.time += dt;
  if (s.bannerT > 0) s.bannerT -= dt;
  if (s.msgT > 0) s.msgT -= dt;
  if (s.gunfireT > 0) s.gunfireT -= dt;
  s.trauma = Math.max(0, (s.trauma || 0) - dt * 1.4);
  s.recoil = Math.max(0, (s.recoil || 0) - dt / 0.12);
  if (s.mode !== 'play') return;
  if (!s.mission && !s.taxi && s.missionIdx === 0 && s.stats.stolen >= 0 && !s._metContact) {
    // First mission starts at the contact marker.
    const z = s.city.zones.contact;
    if (dist2(s.player.x, s.player.z, z.x, z.z) < z.r * z.r) { s._metContact = true; startMission(s); }
  }
  const p = s.player;
  if (p.inCar) player.stepPlayerCar(s, input, dt);
  else player.stepPlayerFoot(s, input, dt);
  player.stepZonesCar(s, dt);
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= 0 && s.reserve > 0) {
      const take = Math.min(12 - s.ammo, s.reserve);
      s.ammo += take; s.reserve -= take;
    }
  }
  if (input.reload && s.hasGun && s.ammo < 12 && s.reserve > 0 && s.reloadT <= 0) s.reloadT = 0.9;
  for (const c of s.cars) if (c !== p.inCar && (c.kind === 'traffic')) stepTrafficCar(s, c, dt);
  for (const ped of s.peds) stepPed(s, ped, dt);
  s.peds = s.peds.filter(ped => ped.state !== 'dead' || ped.t > -6);
  while (s.peds.length < 28) s.peds.push(spawnPed(s, s.rng));
  s.densityT = (s.densityT || 0) - dt;
  if (s.densityT <= 0) { s.densityT = 0.6; manageDensity(s); }
  wanted.stepWanted(s, dt);
  stepMissions(s, dt);
  // Contact respawn of traffic far away keeps the city alive.
  for (const c of s.cars) {
    if (c.kind === 'traffic' && dist2(c.x, c.z, p.x, p.z) > 300 * 300) { c.x = p.x + s.rng.range(-120, 120); c.z = p.z + s.rng.range(-120, 120); }
  }
}
