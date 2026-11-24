// missions.js — an eight-mission story chain in strict order, plus
// endless taxi work on the side. Finishing one job immediately starts
// the next: a car theft, a timed courier run, a gun-store errand with
// range targets, a harbour holdup, four-star survival, a five-checkpoint
// race, a roadblock run, and a stealth courier whose clock bleeds while
// you carry heat. Story missions pay cash and RESPECT; taxi fares
// (press T while driving) pay cash only.
import { dist2 } from '../rng.js';
import { BLOCK, roadCenters } from './world.js';

export const MISSIONS = [
  { name: 'THE SHORELINE GRAB', desc: 'Steal the magenta coupe on Ocean Drive and stash it at the alley marker.', pay: 500 },
  { name: 'HEAT COURIER', desc: 'Hit 3 checkpoints downtown before the clock runs out.', pay: 750, time: 90 },
  { name: 'AMMU-NATION RUN', desc: 'Buy the 9mm pistol ($300), then drop 5 range targets.', pay: 400 },
  { name: 'THE RIVAL DEAL', desc: 'Hold up the rival boss at the harbor and take his briefcase.', pay: 2000 },
  { name: 'VICE ESCAPE', desc: 'Survive the 4-star heat for 3 minutes, then reach the Pay \'n Spray.', pay: 1500 },
  { name: 'PALM TREE GRAND PRIX', desc: 'Rico\'s midnight circuit on Solmar Bay: hit 5 checkpoints against the clock.', pay: 900, time: 80 },
  { name: 'ROADBLOCK RUN', desc: 'Marisol\'s cargo has to cross town. Punch through the heat, hit the marks, reach the hideout.', pay: 1200 },
  { name: 'NIGHT COURIER', desc: 'Uncle Bao\'s package, delivered quietly. Heat makes the clock bleed — stay invisible.', pay: 1100, time: 100 },
];

function randomCorner(s) {
  const lines = roadCenters();
  return { x: lines[s.rng.int(0, lines.length - 1)] + 9, z: lines[s.rng.int(0, lines.length - 1)] + 9, r: 6 };
}

function showBanner(s, text, seconds) { s.banner = text; s.bannerT = seconds === undefined ? 2 : seconds; }

export function startMission(s) {
  if (s.mission || s.missionIdx >= MISSIONS.length) return;
  const def = MISSIONS[s.missionIdx];
  const m = { ...def, idx: s.missionIdx, phase: 0, timer: def.time || 0, target: null, surviveT: 0 };
  if (m.idx === 0) {
    s.cars.push({ id: 555, kind: 'parked', x: BLOCK * 2.0, z: -BLOCK * 0.5 + 6.4, ry: 0, speed: 0, targetSpeed: 11, horiz: false, road: 0, dir: 1, color: [0.95, 0.15, 0.55], hp: 100, smoke: 0, driver: false, stopped: 0, missionCar: true });
    m.target = { x: BLOCK * 2.0, z: -BLOCK * 0.5 + 6.4, r: 7 };
  } else if (m.idx === 1 || m.idx === 5 || m.idx === 7) m.target = randomCorner(s);
  else if (m.idx === 2) m.target = { ...s.city.zones.gunshop };
  else if (m.idx === 3) { m.target = { ...s.city.zones.harbor }; s.boss = { x: s.city.zones.harbor.x + 3, z: s.city.zones.harbor.z + 2, aimTime: 0, done: false }; }
  else if (m.idx === 4) { s.wantedAPI.add(s, 4, true); m.surviveT = 180; }
  else if (m.idx === 6) { s.wantedAPI.add(s, 4, true); m.target = randomCorner(s); }
  s.mission = m;
  showBanner(s, m.name, 3.2);
  s.events.push({ name: 'banner', data: m.name });
}

export function startTaxi(s) {
  if (s.mission || s.taxi || !s.player.inCar) return;
  s.taxi = { phase: 0, target: randomCorner(s), timer: 75, pay: 100 + s.rng.int(0, 90) };
  showBanner(s, 'TAXI — PICK UP', 2);
}

function completeJob(s, pay, label) {
  s.cash += pay; s.stats.earned += pay;
  if (s.mission) { s.respect += 100; s.events.push({ name: 'respect', data: s.respect }); }
  s.events.push({ name: 'cash', data: pay });
  s.events.push({ name: 'missionDone', data: label || (s.mission && s.mission.name) || 'TAXI' });
  showBanner(s, pay > 0 ? 'MISSION PASSED  +$' + pay : 'MISSION PASSED', 3.2);
  if (s.mission) { s.mission = null; s.missionIdx++; s.events.push({ name: 'save' }); startMission(s); }
  if (s.taxi) s.taxi = null;
}

function failCurrentJob(s, reason) {
  s.events.push({ name: 'missionFail', data: reason });
  showBanner(s, 'MISSION FAILED', 2.6);
  const retryIdx = s.mission ? s.mission.idx : null;
  s.mission = null; s.taxi = null;
  if (retryIdx != null) { s.missionIdx = retryIdx; startMission(s); }
}

function runShorelineGrab(s, m, atTarget) {
  const p = s.player;
  if (m.phase === 0 && p.inCar && p.inCar.id === 555) { m.phase = 1; m.target = { x: -BLOCK * 1.5, z: BLOCK * 1.0, r: 6 }; showBanner(s, 'STASH IT IN THE ALLEY'); }
  else if (m.phase === 1 && atTarget && p.inCar) completeJob(s, m.pay);
  else if (m.phase === 0 && atTarget && !p.inCar) { s.msg = 'STEAL THE MAGENTA COUPE'; s.msgT = 0.6; }
}

function runCheckpoints(s, m, atTarget, total, labelFn) {
  if (!atTarget) return;
  m.phase++;
  if (m.phase >= total) { completeJob(s, m.pay); return; }
  m.target = randomCorner(s);
  showBanner(s, labelFn(m.phase), 1.6);
  s.events.push({ name: 'pickup' });
}

function runGunShop(s, m) {
  if (m.phase === 0 && s.hasGun) {
    m.phase = 1; s.targets = [];
    for (let i = 0; i < 5; i++) s.targets.push({ x: s.city.zones.gunshop.x + 6 + i * 2.2, z: s.city.zones.gunshop.z - 8, down: false });
    showBanner(s, 'DROP 5 TARGETS'); m.target = null;
  } else if (m.phase === 1) {
    const downCount = (s.targets || []).filter((t) => t.down).length;
    if (downCount >= 5) { s.targets = []; completeJob(s, m.pay); }
  }
}

function runRivalDeal(s, m, dt) {
  void m;
  const p = s.player, boss = s.boss;
  if (boss && !boss.done) {
    const aiming = p.aim && s.hasGun && !p.inCar && dist2(p.x, p.z, boss.x, boss.z) < 7 * 7;
    if (aiming) {
      boss.aimTime += dt;
      if (boss.aimTime >= 2) {
        boss.done = true;
        s.pickups.push({ x: boss.x, z: boss.z, cash: 2000, t: 60 });
        s.wantedAPI.add(s, 3, true);
        showBanner(s, 'GRAB THE BRIEFCASE');
        s.events.push({ name: 'scoreGrab' });
      }
    } else boss.aimTime = Math.max(0, boss.aimTime - dt);
  }
  if (boss && boss.done && !s.pickups.some((pk) => pk.cash === 2000)) completeJob(s, 0);
}

function runViceEscape(s, m, dt) {
  const p = s.player;
  if (s.wanted > 0) m.surviveT -= dt;
  if (m.surviveT <= 0 && !m.target) { m.target = { ...s.city.zones.spray }; showBanner(s, 'NOW LOSE THEM AT THE PAY \'N SPRAY', 2.4); }
  if (m.target && s.wanted === 0 && dist2(p.x, p.z, m.target.x, m.target.z) < m.target.r * m.target.r + 40) completeJob(s, m.pay);
}

function runRoadblockRun(s, m, atTarget) {
  if (!atTarget || !s.player.inCar) return;
  m.phase++;
  if (m.phase === 1) { m.target = randomCorner(s); showBanner(s, 'ONE MORE MARK — STAY AHEAD OF THEM'); s.events.push({ name: 'pickup' }); }
  else if (m.phase === 2) { m.target = { ...s.city.zones.harbor }; showBanner(s, 'NOW THE HIDEOUT AT THE HARBOR'); }
  else completeJob(s, m.pay);
}

function runNightCourier(s, m, atTarget, dt) {
  if (s.wanted >= 2) { m.timer -= dt; s.msg = 'TOO HOT — THE CLOCK IS BLEEDING'; s.msgT = 0.4; }
  if (atTarget && s.player.inCar) completeJob(s, m.pay);
}

export function stepMissions(s, dt) {
  const p = s.player, m = s.mission;
  if (m) {
    if (m.timer > 0) { m.timer -= dt; if (m.timer <= 0) { failCurrentJob(s, 'Out of time'); return; } }
    const reached = !!m.target && dist2(p.x, p.z, m.target.x, m.target.z) < m.target.r * m.target.r;
    switch (m.idx) {
      case 0: runShorelineGrab(s, m, reached); break;
      case 1: runCheckpoints(s, m, reached, 3, (n) => 'CHECKPOINT ' + (n + 1) + ' / 3'); break;
      case 2: runGunShop(s, m); break;
      case 3: runRivalDeal(s, m, dt); break;
      case 4: runViceEscape(s, m, dt); if (s.mode !== 'play') return; break;
      case 5: if (reached && p.inCar) runCheckpoints(s, m, true, 5, (n) => 'CHECKPOINT ' + (n + 1) + ' / 5'); break;
      case 6: runRoadblockRun(s, m, reached); break;
      case 7: runNightCourier(s, m, reached, dt); break;
      default: break;
    }
  }
  const fare = s.taxi;
  if (fare) {
    fare.timer -= dt;
    if (fare.timer <= 0) { s.taxi = null; showBanner(s, 'FARE LOST'); return; }
    const atFare = fare.target && dist2(p.x, p.z, fare.target.x, fare.target.z) < fare.target.r * fare.target.r;
    if (atFare) {
      if (fare.phase === 0) { fare.phase = 1; fare.target = randomCorner(s); fare.timer = Math.max(fare.timer, 60); showBanner(s, 'DROP THEM OFF'); s.events.push({ name: 'pickup' }); }
      else completeJob(s, fare.pay, 'TAXI');
    }
  }
}
