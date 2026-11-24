// pedestrians.js — the people on the sidewalks. Each walker picks
// stroll targets along the pavement, ambles between them, and reacts:
// fleeing from gunfire, crashes and speeding cars, throwing their
// hands up when a gun is pointed at them (which is how robberies
// happen), and falling when shot.

import { createRng, clamp, dist2 } from '../rng.js';
import { ROAD, CITY_HALF } from './world.js';

const SHIRTS = [
  [0.95, 0.55, 0.45], [0.45, 0.75, 0.9], [0.95, 0.85, 0.4], [0.55, 0.9, 0.65],
  [0.9, 0.6, 0.85], [0.95, 0.95, 0.95], [0.4, 0.5, 0.75], [1, 0.7, 0.35],
];
const TROUSERS = [[0.22, 0.24, 0.34], [0.35, 0.3, 0.25], [0.5, 0.52, 0.55], [0.25, 0.35, 0.3]];
const SKIN = [[0.92, 0.76, 0.6], [0.98, 0.84, 0.68], [0.72, 0.52, 0.38], [0.55, 0.38, 0.26]];

export function makePed(rng, x, z) {
  return {
    x, z, ry: rng.range(0, Math.PI * 2),
    speed: 0, hp: 30,
    state: 'walk', stateT: 0,
    color: SHIRTS[rng.int(0, SHIRTS.length - 1)],
    pants: TROUSERS[rng.int(0, TROUSERS.length - 1)],
    skin: SKIN[rng.int(0, SKIN.length - 1)],
    tx: x, tz: z, _phase: rng.range(0, 6),
    robbed: false,
  };
}

export function spawnPeds(state, count) {
  const rng = createRng(state.seed * 57 + 13);
  const centers = [];
  for (let k = -3; k <= 3; k++) centers.push(k * 46);
  for (let i = 0; i < count; i++) {
    const road = centers[rng.int(0, centers.length - 1)];
    const side = rng.chance(0.5) ? 1 : -1;
    const along = rng.range(-CITY_HALF, CITY_HALF);
    const vertical = rng.chance(0.5);
    const x = vertical ? road + side * (ROAD / 2 + 1.6) : along;
    const z = vertical ? along : road + side * (ROAD / 2 + 1.6);
    state.peds.push(makePed(rng, x, z));
  }
}

function pickStrollTarget(state, ped) {
  const rng = state.rng;
  ped.tx = clamp(ped.x + rng.range(-38, 38), -CITY_HALF - 6, CITY_HALF + 26);
  ped.tz = clamp(ped.z + rng.range(-38, 38), -CITY_HALF - 6, CITY_HALF + 6);
}

export function stepPeds(state, dt) {
  const p = state.player;
  for (const ped of state.peds) {
    if (ped.state === 'dead') { ped.speed = 0; continue; }
    ped.stateT -= dt;
    const nearPlayer = dist2(ped.x, ped.z, p.x, p.z) < 9 * 9;
    const playerThreat = !p.inCar && state.hasGun && p.aim && nearPlayer &&
      dist2(ped.x, ped.z, p.x, p.z) < 6.5 * 6.5;

    if (ped.state === 'walk') {
      if (playerThreat) { ped.state = 'handsup'; ped.stateT = 1.2; }
      else if (state.alarmT > state.time - 1.2 && dist2(ped.x, ped.z, state.alarmX, state.alarmZ) < 16 * 16) {
        ped.state = 'flee'; ped.stateT = 2.6;
        ped.tx = ped.x + (ped.x - state.alarmX) * 2;
        ped.tz = ped.z + (ped.z - state.alarmZ) * 2;
      }
    } else if (ped.state === 'handsup') {
      ped.speed = 0;
      if (!playerThreat && ped.stateT <= 0) { ped.state = 'flee'; ped.stateT = 1.6; ped.tx = ped.x - (p.x - ped.x) * 2; ped.tz = ped.z - (p.z - ped.z) * 2; }
      continue;
    } else if (ped.state === 'flee' && ped.stateT <= 0) {
      ped.state = 'walk';
      pickStrollTarget(state, ped);
    }

    const speed = ped.state === 'flee' ? 4.3 : 1.35;
    const dx = ped.tx - ped.x, dz = ped.tz - ped.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) {
      if (ped.state === 'walk') pickStrollTarget(state, ped);
      ped.speed = 0;
      continue;
    }
    ped.ry = Math.atan2(dx, dz);
    ped.speed = speed;
    ped.x += Math.sin(ped.ry) * speed * dt;
    ped.z += Math.cos(ped.ry) * speed * dt;
  }
}
