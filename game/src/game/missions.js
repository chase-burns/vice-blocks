// missions.js — the eight-mission story chain plus endless taxi
// work. A mission is a small state machine: a kind, an optional
// countdown, a target point the HUD beam and minimap point at, and
// phases for the two multi-beat jobs (the harbour holdup and the
// finale). Finishing pays cash and RESPECT and persists the profile.

import { dist2 } from '../rng.js';
import { reportCrime } from './wanted.js';

export const MISSION_DEFS = [
  { name: 'FIRST WHEELS', kind: 'steal', reward: 250, respect: 40, text: 'FIRST WHEELS — Take the coupe parked by the beach' },
  { name: 'COURIER RUN', kind: 'checkpoints', reward: 600, respect: 55, text: 'COURIER RUN — Hit every checkpoint before the clock dies', points: 4, time: 85 },
  { name: 'RANGE DAY', kind: 'targets', reward: 500, respect: 50, text: 'RANGE DAY — Drop 5 range targets behind Ammu-Nation', count: 5 },
  { name: 'HARBOR HEAT', kind: 'holdup', reward: 900, respect: 70, text: 'HARBOR HEAT — Shake down the rival crew at the harbour' },
  { name: 'VICE ESCAPE', kind: 'survive', reward: 1500, respect: 90, text: "VICE ESCAPE — Survive the 4-star heat, then reach the Pay 'n Spray", time: 90 },
  { name: 'PALM TREE GRAND PRIX', kind: 'checkpoints', reward: 2000, respect: 100, text: "PALM TREE GRAND PRIX — Rico's midnight circuit — hit 5 checkpoints against the clock", points: 5, time: 100 },
  { name: 'ROADBLOCK RUN', kind: 'goto', reward: 2500, respect: 110, text: 'ROADBLOCK RUN — Punch through to the north beach drop' },
  { name: 'THE RIVAL DEAL', kind: 'deal', reward: 20000, respect: 200, text: 'THE RIVAL DEAL — One last package, delivered quietly' },
];

const CHECKPOINT_POOL = [
  { x: 92, z: -92 }, { x: -92, z: -46 }, { x: 46, z: 92 }, { x: -46, z: -92 },
  { x: 138, z: 46 }, { x: -138, z: 46 }, { x: 92, z: 138 }, { x: -92, z: -138 },
  { x: 0, z: 138 }, { x: 138, z: -92 },
];

export function startMission(state) {
  if (state.mission || state.taxi || state.missionIdx >= MISSION_DEFS.length) return false;
  const def = MISSION_DEFS[state.missionIdx];
  const m = {
    idx: state.missionIdx, name: def.name, text: def.text, kind: def.kind,
    reward: def.reward, respect: def.respect,
    timer: def.time || null, target: null, phase: 'main', count: 0,
  };
  if (def.kind === 'steal') {
    // The coupe: a parked sport car on the beach road.
    const car = state.missionCar;
    if (car) m.target = { x: car.x, z: car.z };
  } else if (def.kind === 'checkpoints') {
    m.points = CHECKPOINT_POOL.slice(state.missionIdx * 2, state.missionIdx * 2 + def.points);
    m.target = m.points[0];
  } else if (def.kind === 'targets') {
    const z = state.city.zones.gunshop;
    state.targets = [];
    for (let i = 0; i < def.count; i++) {
      state.targets.push({ x: z.x - 14 + i * 6, z: z.z - 16, hp: 20, down: false });
    }
    m.target = { x: z.x - 8, z: z.z - 16 };
  } else if (def.kind === 'holdup') {
    const hz = state.city.zones.harbor;
    m.target = { x: hz.x, z: hz.z };
    state.boss = { x: hz.x + 4, z: hz.z + 3, hp: 70, done: false };
  } else if (def.kind === 'survive') {
    reportCrime(state, 4.2);
    m.target = null;
  } else if (def.kind === 'goto') {
    reportCrime(state, 4.0);
    m.target = { x: 138, z: -138 };
  } else if (def.kind === 'deal') {
    const hz = state.city.zones.harbor;
    m.target = { x: hz.x, z: hz.z };
  }
  state.mission = m;
  state.msg = def.name;
  state.msgT = 2.4;
  return true;
}

export function startTaxi(state) {
  if (state.taxi || state.mission) return false;
  const rng = state.rng;
  const px = rng.range(-130, 130), pz = rng.range(-130, 130);
  state.taxi = {
    phase: 'pickup',
    target: { x: px, z: pz },
    timer: null, fare: 0,
  };
  state.msg = 'TAXI — PICK UP THE FARE';
  state.msgT = 2;
  return true;
}

function finishMission(state) {
  const m = state.mission;
  state.cash += m.reward;
  state.respect += m.respect;
  state.missionIdx++;
  state.mission = null;
  state.banner = 'MISSION PASSED';
  state.bannerT = 2.6;
  state.events.push({ name: 'missionDone', data: m.reward });
  state.events.push({ name: 'save', data: 0 });
}

function failMission(state) {
  state.mission = null;
  state.banner = 'MISSION FAILED';
  state.bannerT = 2.2;
  state.events.push({ name: 'missionFail', data: 0 });
}

export function stepMissions(state, dt) {
  const p = state.player;
  const px = p.inCar ? p.inCar.x : p.x;
  const pz = p.inCar ? p.inCar.z : p.z;

  // Loose cash pickups (robbery wallets, the holdup drop).
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const pk = state.pickups[i];
    const reach = p.inCar ? 3.6 : 2.1;
    if (dist2(pk.x, pk.z, px, pz) < reach * reach) {
      state.pickups.splice(i, 1);
      state.cash += pk.amount;
      state.events.push({ name: 'pickup', data: pk.amount });
      if (pk.missionTag && state.mission && state.mission.kind === 'holdup') finishMission(state);
    }
  }

  const m = state.mission;
  if (m) {
    if (m.timer != null && m.kind !== 'survive') {
      m.timer -= dt;
      if (m.timer <= 0) { failMission(state); return; }
    }
    switch (m.kind) {
      case 'steal': {
        if (state.missionCar) m.target = { x: state.missionCar.x, z: state.missionCar.z };
        if (p.inCar && p.inCar === state.missionCar) finishMission(state);
        break;
      }
      case 'checkpoints': {
        if (m.target && dist2(m.target.x, m.target.z, px, pz) < 8 * 8) {
          m.count++;
          state.events.push({ name: 'cash', data: 0 });
          if (m.count >= m.points.length) finishMission(state);
          else { m.target = m.points[m.count]; m.timer += 10; }
        }
        break;
      }
      case 'targets': {
        if (state.targets.length && state.targets.every((t) => t.down)) finishMission(state);
        break;
      }
      case 'holdup': {
        if (state.boss && state.boss.done && !m.dropped) {
          m.dropped = true;
          state.pickups.push({ x: state.boss.x, z: state.boss.z, amount: m.reward, missionTag: true });
          m.target = { x: state.boss.x, z: state.boss.z };
          state.msg = 'GRAB THE CASH';
          state.msgT = 2;
        }
        break;
      }
      case 'survive': {
        if (m.phase === 'main') {
          m.timer -= dt;
          if (state.stars < 4) reportCrime(state, 0.6); // the heat stays on
          if (m.timer <= 0) {
            m.phase = 'escape';
            const z = state.city.zones.spray;
            m.target = { x: z.x, z: z.z };
            state.msg = "NOW — THE PAY 'N SPRAY";
            state.msgT = 2.4;
          }
        } else if (m.target && dist2(m.target.x, m.target.z, px, pz) < 7 * 7) {
          state.heat = 0; state.stars = 0; state.cops = []; state.heli = null;
          finishMission(state);
        }
        break;
      }
      case 'goto': {
        if (m.target && dist2(m.target.x, m.target.z, px, pz) < 9 * 9) finishMission(state);
        break;
      }
      case 'deal': {
        if (m.phase === 'main' && m.target && dist2(m.target.x, m.target.z, px, pz) < 8 * 8) {
          m.phase = 'fight';
          const hz = state.city.zones.harbor;
          state.targets = [0, 1, 2].map((i) => ({ x: hz.x - 8 + i * 7, z: hz.z + 10, hp: 30, down: false }));
          m.target = { x: hz.x, z: hz.z + 10 };
          state.msg = 'THE CREW WAS WAITING — DROP THEM';
          state.msgT = 2.4;
        } else if (m.phase === 'fight' && state.targets.every((t) => t.down)) {
          m.phase = 'deliver';
          const z = state.city.zones.contact;
          m.target = { x: z.x, z: z.z };
          state.msg = 'DELIVER THE PACKAGE';
          state.msgT = 2.4;
        } else if (m.phase === 'deliver' && m.target && dist2(m.target.x, m.target.z, px, pz) < 8 * 8) {
          finishMission(state);
        }
        break;
      }
      default: break;
    }
  }

  const taxi = state.taxi;
  if (taxi) {
    if (taxi.phase === 'pickup' && dist2(taxi.target.x, taxi.target.z, px, pz) < 6 * 6) {
      const rng = state.rng;
      taxi.phase = 'dropoff';
      taxi.target = { x: rng.range(-130, 130), z: rng.range(-130, 130) };
      taxi.timer = 50 + Math.hypot(taxi.target.x - px, taxi.target.z - pz) * 0.55;
      taxi.fare = Math.round(35 + Math.hypot(taxi.target.x - px, taxi.target.z - pz) * 0.5);
      state.msg = 'TAXI — DROP THEM OFF';
      state.msgT = 2;
    } else if (taxi.phase === 'dropoff') {
      taxi.timer -= dt;
      if (taxi.timer <= 0) {
        state.taxi = null;
        state.msg = 'FARE LOST';
        state.msgT = 2;
      } else if (dist2(taxi.target.x, taxi.target.z, px, pz) < 6 * 6) {
        state.cash += taxi.fare;
        state.respect += 4;
        state.events.push({ name: 'cash', data: taxi.fare });
        state.msg = 'FARE PAID $' + taxi.fare;
        state.msgT = 2;
        state.taxi = null;
      }
    }
  }
}
