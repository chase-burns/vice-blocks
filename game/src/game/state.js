// state.js — the whole game in one object, plus the step function
// that advances it. createState builds the city, the player, traffic
// and pedestrians, and applies any saved profile. step() runs the
// subsystems in a fixed order and keeps the shared timers (messages,
// banner, trauma) ticking. Events are queued on state.events and
// drained by main, which turns them into sound and particles.

import { createRng } from '../rng.js';
import { createCity } from './world.js';
import { spawnTraffic, stepTraffic, makeCar } from './traffic.js';
import { spawnPeds, stepPeds } from './pedestrians.js';
import { stepWanted, damageCar } from './wanted.js';
import { stepMissions } from './missions.js';
import { stepPlayer, hurtPlayer } from './player.js';

export function createState(seed, profile) {
  const city = createCity(createRng(seed));
  const state = {
    seed,
    rng: createRng(seed * 101 + 3),
    city,
    time: 0,
    mode: 'title',
    shotMode: '',
    player: {
      x: 9, z: 9, ry: 0, hp: 100, armor: 0,
      inCar: null, walkPhase: 0, aim: false, moving: false,
    },
    cars: [], cops: [], peds: [], pickups: [], targets: [],
    heli: null, spotTarget: null, boss: null, missionCar: null,
    cash: 0, respect: 0,
    heat: 0, stars: 0, lastSeenT: -99, lastCrimeT: -99,
    spawnT: 0, roadblockCd: 0,
    hasGun: false, hasSmg: false, hasShotgun: false, hasRifle: false,
    weapon: 'pistol',
    ammo: {
      pistol: { mag: 12, res: 60 },
      smg: { mag: 30, res: 120 },
      shotgun: { mag: 6, res: 30 },
      rifle: { mag: 30, res: 120 },
    },
    armorUp: false, engineUp: false,
    fireCd: 0, reloadT: 0, flashT: 0, recoil: 0,
    missionIdx: 0, mission: null, taxi: null,
    radio: 1, msg: '', msgT: 0, banner: '', bannerT: 0,
    trauma: 0, roadJolt: 0, bust: 0,
    camYaw: 0, alarmX: 0, alarmZ: 0, alarmT: -99,
    events: [],
  };
  if (profile) {
    state.cash = profile.cash || 0;
    state.respect = profile.respect || 0;
    state.missionIdx = profile.missionIdx || 0;
    state.hasGun = !!(profile.weapons && profile.weapons.pistol);
    state.hasSmg = !!(profile.weapons && profile.weapons.smg);
    state.hasShotgun = !!(profile.weapons && profile.weapons.shotgun);
    state.hasRifle = !!(profile.weapons && profile.weapons.rifle);
    if (state.hasRifle) state.weapon = 'rifle';
    else if (state.hasShotgun) state.weapon = 'shotgun';
    else if (state.hasSmg) state.weapon = 'smg';
    state.armorUp = !!profile.armorUp;
    state.engineUp = !!profile.engineUp;
  }
  spawnTraffic(state, 20);
  spawnPeds(state, 26);
  // The beach coupe that mission one is about, parked on the shore road.
  const coupe = makeCar(createRng(seed * 7 + 1), 'sport');
  coupe.color = [0.95, 0.35, 0.55];
  coupe.x = 135.1; coupe.z = -30; coupe.ry = 0;
  coupe.parked = true;
  state.cars.push(coupe);
  state.missionCar = coupe;
  return state;
}

export function drainEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}

export function step(state, input, dt) {
  if (state.mode === 'paused') return;
  state.time += dt;
  state.msgT = Math.max(0, state.msgT - dt);
  state.bannerT = Math.max(0, state.bannerT - dt);
  state.trauma = Math.max(0, state.trauma - dt * 0.55);

  if (state.mode === 'title') {
    stepTraffic(state, dt);
    stepPeds(state, dt);
    return;
  }
  if (state.mode !== 'play') return;

  stepPlayer(state, input, dt);
  stepTraffic(state, dt);
  stepPeds(state, dt);
  stepWanted(state, dt);
  stepMissions(state, dt);

  // Burning wrecks cook off; the blast chains into whatever is close.
  const everyone = state.cars.concat(state.cops);
  for (const car of everyone) {
    if (car.burning > 0 && !car.exploded) {
      car.burning -= dt;
      if (car.burning <= 0) damageCar(state, car, 1000);
    }
  }
  for (const ev of state.events) {
    if (ev.name !== 'explode' || ev.chained) continue;
    ev.chained = true;
    const src = ev.data;
    if (!src || src.x == null) continue;
    for (const car of everyone) {
      if (car !== src && !car.exploded) {
        const d2 = (car.x - src.x) ** 2 + (car.z - src.z) ** 2;
        if (d2 < 7.5 * 7.5) damageCar(state, car, 42);
      }
    }
    const p = state.player;
    const pd2 = (p.x - src.x) ** 2 + (p.z - src.z) ** 2;
    if (pd2 < 7 * 7) hurtPlayer(state, 26);
    state.trauma = Math.min(1, state.trauma + 0.4);
  }
}
