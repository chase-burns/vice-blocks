// Mission chain (WO Task 11): five scripted missions + endless taxi work.
// 1 Shoreline Grab, 2 Heat Courier, 3 Ammu-Nation Run, 4 The Rival Deal,
// 5 Vice Escape. Taxi runs start with [T] while driving.
import { dist2 } from '../rng.js';
import { BLOCK, roadCenters } from './world.js';

export const MISSIONS = [
  { name: 'THE SHORELINE GRAB', desc: 'Steal the magenta coupe on Ocean Drive and stash it at the alley marker.', pay: 500 },
  { name: 'HEAT COURIER', desc: 'Hit 3 checkpoints downtown before the clock runs out.', pay: 750, time: 90 },
  { name: 'AMMU-NATION RUN', desc: 'Buy the 9mm pistol ($300), then drop 5 range targets.', pay: 400 },
  { name: 'THE RIVAL DEAL', desc: 'Hold up the rival boss at the harbor and take his briefcase.', pay: 2000 },
  { name: 'VICE ESCAPE', desc: 'Survive the 4-star heat for 3 minutes, then reach the Pay \'n Spray.', pay: 1500 },
];
function randomCorner(s) {
  const c = roadCenters();
  return { x: c[s.rng.int(0, c.length - 1)] + 9, z: c[s.rng.int(0, c.length - 1)] + 9, r: 6 };
}

export function startMission(s) {
  if (s.mission || s.missionIdx >= MISSIONS.length) return;
  const def = MISSIONS[s.missionIdx];
  const m = { ...def, idx: s.missionIdx, phase: 0, timer: def.time || 0, target: null, surviveT: 0 };
  if (m.idx === 0) {
    // Designated magenta coupe parked on the east (beach) side.
    m.carId = 555;
    s.cars.push({
      id: 555, kind: 'parked', x: BLOCK * 2.0, z: -BLOCK * 0.5 + 6.4, ry: 0, speed: 0,
      targetSpeed: 11, horiz: false, road: 0, dir: 1, color: [0.95, 0.15, 0.55],
      hp: 100, smoke: 0, driver: false, stopped: 0, missionCar: true,
    });
    m.target = { x: BLOCK * 2.0, z: -BLOCK * 0.5 + 6.4, r: 7 };
  }
  if (m.idx === 1) m.target = randomCorner(s);
  if (m.idx === 2) m.target = { ...s.city.zones.gunshop };
  if (m.idx === 3) {
    m.target = { ...s.city.zones.harbor };
    s.boss = { x: s.city.zones.harbor.x + 3, z: s.city.zones.harbor.z + 2, aimTime: 0, done: false };
  }
  if (m.idx === 4) { s.wantedAPI.add(s, 4, true); m.surviveT = 180; m.target = null; }
  s.mission = m;
  s.banner = m.name; s.bannerT = 3.2;
  s.events.push({ name: 'banner', data: m.name });
}
export function startTaxi(s) {
  if (s.mission || s.taxi || !s.player.inCar) return;
  s.taxi = { phase: 0, target: randomCorner(s), timer: 75, pay: 100 + s.rng.int(0, 90) };
  s.banner = 'TAXI — PICK UP'; s.bannerT = 2;
}
function completeMission(s, pay, label) {
  s.cash += pay; s.stats.earned += pay;
  s.events.push({ name: 'cash', data: pay });
  s.events.push({ name: 'missionDone', data: label || s.mission?.name || 'TAXI' });
  s.banner = pay > 0 ? `MISSION PASSED  +$${pay}` : 'MISSION PASSED';
  s.bannerT = 3.2;
  if (s.mission) { s.mission = null; s.missionIdx++; s.events.push({ name: 'save' }); startMission(s); }
  if (s.taxi) s.taxi = null;
}
function failMission(s, why) {
  s.events.push({ name: 'missionFail', data: why });
  s.banner = 'MISSION FAILED'; s.bannerT = 2.6;
  const idx = s.mission?.idx;
  s.mission = null; s.taxi = null;
  if (idx != null) { s.missionIdx = idx; startMission(s); }
}

export function stepMissions(s, dt) {
  const p = s.player;
  const m = s.mission;
  if (m) {
    if (m.timer > 0) { m.timer -= dt; if (m.timer <= 0) { failMission(s, 'Out of time'); return; } }
    const t = m.target;
    const near = t && dist2(p.x, p.z, t.x, t.z) < t.r * t.r;
    if (m.idx === 0) {
      if (m.phase === 0 && p.inCar && p.inCar.id === 555) {
        m.phase = 1; m.target = { x: -BLOCK * 1.5, z: BLOCK * 1.0, r: 6 };
        s.banner = 'STASH IT IN THE ALLEY'; s.bannerT = 2;
      } else if (m.phase === 1 && near && p.inCar) completeMission(s, m.pay);
      else if (m.phase === 0 && near && !p.inCar) { s.msg = 'STEAL THE MAGENTA COUPE'; s.msgT = 0.6; }
    } else if (m.idx === 1) {
      if (near) {
        m.phase++;
        if (m.phase >= 3) completeMission(s, m.pay);
        else { m.target = randomCorner(s); s.banner = `CHECKPOINT ${m.phase + 1} / 3`; s.bannerT = 1.6; s.events.push({ name: 'pickup' }); }
      }
    } else if (m.idx === 2) {
      if (m.phase === 0 && s.hasGun) {
        m.phase = 1;
        s.targets = [];
        for (let i = 0; i < 5; i++) s.targets.push({ x: s.city.zones.gunshop.x + 6 + i * 2.2, z: s.city.zones.gunshop.z - 8, down: false });
        s.banner = 'DROP 5 TARGETS'; s.bannerT = 2;
        m.target = null;
      } else if (m.phase === 1) {
        const down = (s.targets || []).filter(tg => tg.down).length;
        if (down >= 5) { s.targets = []; completeMission(s, m.pay); }
      }
    } else if (m.idx === 3) {
      const boss = s.boss;
      if (boss && !boss.done) {
        if (p.aim && s.hasGun && !p.inCar && dist2(p.x, p.z, boss.x, boss.z) < 7 * 7) {
          boss.aimTime += dt;
          if (boss.aimTime >= 2) {
            boss.done = true;
            s.pickups.push({ x: boss.x, z: boss.z, cash: 2000, t: 60 });
            s.wantedAPI.add(s, 3, true);
            s.banner = 'GRAB THE BRIEFCASE'; s.bannerT = 2;
            s.events.push({ name: 'scoreGrab' });
          }
        } else boss.aimTime = Math.max(0, boss.aimTime - dt);
      }
      if (boss?.done && !s.pickups.some(pk => pk.cash === 2000)) {
        completeMission(s, 0); // the $2000 came from the briefcase pickup itself
      }
    } else if (m.idx === 4) {
      if (s.wanted > 0) m.surviveT -= dt;
      if (m.surviveT <= 0 && !m.target) {
        m.target = { ...s.city.zones.spray };
        s.banner = 'NOW LOSE THEM AT THE PAY \'N SPRAY'; s.bannerT = 2.4;
      }
      if (m.target && s.wanted === 0 && dist2(p.x, p.z, m.target.x, m.target.z) < m.target.r * m.target.r + 40) completeMission(s, m.pay);
      if (s.mode !== 'play') return; // busted/wasted handled by shell
    }
  }
  const tx = s.taxi;
  if (tx) {
    tx.timer -= dt;
    if (tx.timer <= 0) { s.taxi = null; s.banner = 'FARE LOST'; s.bannerT = 2; return; }
    if (tx.target && dist2(p.x, p.z, tx.target.x, tx.target.z) < tx.target.r * tx.target.r) {
      if (tx.phase === 0) { tx.phase = 1; tx.target = randomCorner(s); tx.timer = Math.max(tx.timer, 60); s.banner = 'DROP THEM OFF'; s.bannerT = 2; s.events.push({ name: 'pickup' }); }
      else completeMission(s, tx.pay, 'TAXI');
    }
  }
}
