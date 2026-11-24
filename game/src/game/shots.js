// shots.js — deterministic staging for the four screenshot scenes.
// Each kind rearranges the state into a frozen, photogenic moment:
// the title over the city, a grand prix mid-corner, a four-star escape
// with the roadblock and helicopter composed for the cockpit camera,
// and the quiet frame after the finale. setupShotScene returns the
// loose effects (skid marks, smoke puffs, extra barriers) that main.js
// applies to its own render-side lists.

import { makeCar } from './traffic.js';
import { makePed } from './pedestrians.js';

function stageCop(state, x, z, ry, roadblock) {
  const cop = {
    id: 9000 + state.cops.length,
    kind: 'cop', style: 'police', color: [0.92, 0.92, 0.95],
    x, z, ry, speed: 0, steer: 0, phys: null,
    gear: 3, rpm: 0.5, slip: 0, isDrifting: false,
    hp: 100, smoke: 0, burning: 0, exploded: false,
    roadblock: !!roadblock, pit: false, _spin: 0, _dispA: 0, ramCd: 0,
  };
  state.cops.push(cop);
  return cop;
}

function stagePlayerCar(state, x, z, ry, color) {
  const car = makeCar(state.rng, 'sport');
  car.color = color;
  car.x = x; car.z = z; car.ry = ry;
  car.parked = false;
  state.cars.push(car);
  state.player.inCar = car;
  state.player.x = x; state.player.z = z; state.player.ry = ry;
  return car;
}

function clearStage(state) {
  state.cops = [];
  state.heli = null;
  state.targets = [];
  state.pickups = [];
  state.taxi = null;
  state.boss = null;
  state.trauma = 0;
  state.bust = 0;
}

export function setupShotScene(state, kind) {
  const fx = { skids: [], puffs: [], barriers: [] };
  clearStage(state);
  state.shotMode = kind;
  const p = state.player;

  if (kind === 'start') {
    state.mode = 'title';
    p.inCar = null;
    p.x = 148; p.z = -6; p.ry = -Math.PI / 2 + 0.12;
    state.camYaw = p.ry;
    // The save-slot summary the title screen shows off.
    state.cash = 12480;
    state.respect = 260;
    state.missionIdx = 5;
    state.hasGun = true; state.hasSmg = true; state.hasShotgun = true;
    state.weapon = 'pistol';
    return fx;
  }

  if (kind === 'play') {
    state.mode = 'play';
    const car = stagePlayerCar(state, 92, 60, 0, [0.96, 0.52, 0.14]);
    car.speed = 38.5;
    state.cash = 2840;
    state.respect = 260;
    state.missionIdx = 5;
    state.hasGun = true; state.hasSmg = true; state.hasShotgun = true;
    state.weapon = 'pistol';
    state.radio = 1;
    state.mission = {
      idx: 5, name: 'PALM TREE GRAND PRIX', kind: 'checkpoints', phase: 'main',
      text: "PALM TREE GRAND PRIX — Rico's midnight circuit — hit 5 checkpoints against the clock",
      timer: 63, target: { x: 92, z: 138 }, points: [], count: 1, reward: 2000, respect: 100,
    };
    // A taxi up the road and a couple of pedestrians for street life.
    const taxi = makeCar(state.rng, 'taxi');
    taxi.x = 94.9; taxi.z = 96; taxi.ry = 0; taxi.speed = 8;
    state.cars.push(taxi);
    const pedA = makePed(state.rng, 85.4, 52);
    const pedB = makePed(state.rng, 98.2, 74);
    state.peds.push(pedA, pedB);
    return fx;
  }

  if (kind === 'chase') {
    state.mode = 'play';
    const car = stagePlayerCar(state, 46, -40, 0, [0.52, 0.27, 0.78]);
    car.speed = 23.2;
    state.cash = 80;
    state.respect = 500;
    state.heat = 4.3; state.stars = 4;
    state.radio = 2;
    state.trauma = 0.35;
    state.hasGun = true; state.hasSmg = true; state.hasShotgun = true;
    state.weapon = 'smg';
    state.mission = {
      idx: 4, name: 'VICE ESCAPE', kind: 'survive', phase: 'main',
      text: "VICE ESCAPE — Survive the 4-star heat, then reach the Pay 'n Spray",
      timer: 97, target: null, reward: 1500, respect: 90,
    };
    const heading = car.ry;
    const f = [Math.sin(heading), Math.cos(heading)];
    const r = [Math.cos(heading), -Math.sin(heading)];
    const ahead = (dist, side) => ({
      x: car.x + f[0] * dist + r[0] * side,
      z: car.z + f[1] * dist + r[1] * side,
    });
    // The roadblock pair, angled across the lane ahead.
    for (const side of [-1, 1]) {
      const pos = ahead(15, side * 3.4);
      stageCop(state, pos.x, pos.z, heading - side * Math.PI / 4, true);
      const bp = ahead(15.3, side * 1.7);
      fx.barriers.push({ x: bp.x, z: bp.z, kind: 'barrier', color: [0.8, 0.8, 0.8] });
    }
    // One pursuit unit up the right shoulder, in the camera's eye,
    // and two more patrols trailing behind for the dispatch board.
    const chase = ahead(7, 4.1);
    stageCop(state, chase.x, chase.z, heading, false);
    stageCop(state, car.x - 6, car.z - 34, heading + 0.3, false);
    stageCop(state, car.x + 9, car.z - 44, heading - 0.2, false);
    // KESTREL-1 high and ahead, spotlight pool thrown in front of
    // the car where the drift is carrying it.
    const hp = ahead(22, -5);
    state.heli = { x: hp.x, z: hp.z, h: 11.8, ry: Math.atan2(car.x - hp.x, car.z - hp.z) };
    const pool = ahead(8.5, 0);
    state.spotTarget = { x: pool.x, z: pool.z };
    // Rubber on the road and tyre smoke from the drift.
    for (let i = 0; i < 6; i++) {
      fx.skids.push({ x: car.x - 0.8 + i * 0.06, z: car.z - 3.5 - i * 1.15, ry: heading + 0.3, len: 2.2 });
      fx.skids.push({ x: car.x + 0.9 + i * 0.06, z: car.z - 3.5 - i * 1.15, ry: heading + 0.3, len: 2.2 });
    }
    for (let i = 0; i < 7; i++) {
      fx.puffs.push({
        x: car.x + (i % 3 - 1) * 0.8, y: 0.4 + i * 0.14, z: car.z - 2 - i * 0.5,
        vx: 0.4, vy: 1.1, vz: -0.6, life: 0.9, size: 0.85, color: [0.82, 0.82, 0.86],
      });
    }
    return fx;
  }

  if (kind === 'end') {
    state.mode = 'play';
    p.inCar = null;
    // Standing in the middle of the downtown crossing, rifle up,
    // looking down the avenue the deal went sideways on.
    p.x = 3; p.z = -6; p.ry = 0.5; p.aim = true;
    state.camYaw = 0.5;
    p.hp = 100; p.armor = 55;
    state.cash = 21450;
    state.respect = 500;
    state.missionIdx = 8;
    state.hasGun = true; state.hasSmg = true; state.hasShotgun = true; state.hasRifle = true;
    state.weapon = 'rifle';
    state.ammo.rifle = { mag: 17, res: 240 };
    state.mission = {
      idx: 7, name: 'THE RIVAL DEAL', kind: 'deal', phase: 'done',
      text: 'THE RIVAL DEAL — REWARD: $20,000',
      timer: null, target: null, reward: 20000, respect: 200,
    };
    state.banner = 'MISSION PASSED';
    state.bannerT = 999;
    const wreck = makeCar(state.rng, 'taxi');
    wreck.x = 10; wreck.z = 18; wreck.ry = 0.5; wreck.parked = true;
    state.cars.push(wreck);
    state.peds.push(makePed(state.rng, 8, 10), makePed(state.rng, -4, 16), makePed(state.rng, 15, 27));
    return fx;
  }

  return fx;
}

// A loose camera description for a shot kind; main uses its own rig
// live, this exists for tooling that wants the intended framing.
export function shotCamera(state, kind) {
  const p = state.player;
  if (kind === 'start') return { eye: [p.x, 1.72, p.z], yaw: state.camYaw, pitch: -0.03, fov: 75 };
  if (p.inCar) return { eye: [p.inCar.x, 1.15, p.inCar.z], yaw: p.inCar.ry, pitch: 0.02, fov: 78 };
  return { eye: [p.x, 1.72, p.z], yaw: state.camYaw, pitch: 0.02, fov: 75 };
}

// Count city towers standing in front of a ground position — a cheap
// visibility probe for tooling.
export function countVisible(state, x, z, yaw) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let n = 0;
  for (const b of state.city.buildings) {
    const dx = b.x - x, dz = b.z - z;
    if (dx * fx + dz * fz > 0 && dx * dx + dz * dz < 220 * 220) n++;
  }
  return n;
}
