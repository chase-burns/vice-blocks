// shots.js — deterministic staging for the four storefront screenshots.
// Each scene rearranges live game state — player, cars, cops, peds,
// mission, wallet — into a composed still that shows real systems at
// work: the title carries the save line, play shows a timed mission from
// the cockpit, chase shows a four-star response at late dusk, and end
// shows an aimed rifle mid-burst. Pure logic throughout, so the QA
// harness can verify the projections headlessly before anything is
// captured.
import { BLOCK, CITY_HALF, roadCenters } from './world.js';

function stagePedAt(s, index, x, z, horiz, road, side) {
  const ped = s.peds[index % s.peds.length];
  ped.x = x; ped.z = z; ped.horiz = horiz; ped.road = road; ped.side = side;
  ped.state = 'walk'; ped.dir = 1; ped.t = 99;
  ped.ry = horiz ? Math.PI / 2 : 0;
  return ped;
}

function stageTrafficAt(s, index, x, z, ry, color) {
  const trafficPool = s.cars.filter((c) => c.kind === 'traffic');
  const car = trafficPool[index % trafficPool.length];
  car.x = x; car.z = z; car.ry = ry; car.speed = 0;
  if (color) car.color = color;
  return car;
}

function firstParkedCar(s) { return s.cars.find((c) => c.kind === 'parked'); }

function composeTitle(s) {
  const p = s.player;
  s.mode = 'title';
  s.hasGun = true;
  s.missionIdx = 5; s.cash = 12480; s.respect = 460;
  s.hasSmg = true; s.hasShotgun = true;
  p.x = CITY_HALF - 30; p.z = -38;
  s.camYaw = -2.32; p.ry = s.camYaw;
  const coupe = firstParkedCar(s);
  coupe.x = p.x - 15; coupe.z = p.z - 9; coupe.ry = 0.5; coupe.color = [0.95, 0.15, 0.55];
  const centers = roadCenters();
  const coastRoad = centers[centers.length - 1];
  for (let i = 0; i < 5; i++) stagePedAt(s, i, coastRoad - 9.5, -46 - i * 7 + s.rng.range(-1, 1), false, coastRoad, -9.5);
  stageTrafficAt(s, 0, coastRoad - 3.6, -70, Math.PI, [0.98, 0.78, 0.15]);
  stageTrafficAt(s, 1, coastRoad + 3.6, -95, 0, [0.9, 0.4, 0.3]);
}

function composePlay(s) {
  const car = firstParkedCar(s);
  car.kind = 'player';
  car.x = BLOCK * 0.5 + 3.6; car.z = -60; car.ry = 0; car.rpm = 0.92;
  const p = s.player;
  p.inCar = car; p.x = car.x; p.z = car.z;
  s.cash = 2840; s.armor = 50; s.health = 100;
  s.radio = 1; s.respect = 340; s.hasGun = true;
  stageTrafficAt(s, 0, car.x, car.z + 18, 0, [0.98, 0.78, 0.15]);
  stageTrafficAt(s, 1, car.x, car.z + 38, 0, [0.85, 0.88, 0.9]);
  stageTrafficAt(s, 2, car.x - 7.2, car.z + 30, Math.PI, [0.3, 0.55, 0.95]);
  const roadLine = BLOCK * 0.5;
  stagePedAt(s, 0, roadLine - 9.5, car.z + 10, false, roadLine, -9.5);
  stagePedAt(s, 1, roadLine + 9.5, car.z + 16, false, roadLine, 9.5);
  stagePedAt(s, 2, roadLine - 9.5, car.z + 26, false, roadLine, -9.5);
  stagePedAt(s, 3, roadLine + 9.5, car.z + 6, false, roadLine, 9.5);
  s.mission = { name: 'PALM TREE GRAND PRIX', desc: "Rico's midnight circuit — hit 5 checkpoints against the clock.", timer: 63, target: { x: car.x, z: car.z + 120, r: 6 } };
}

// Does the segment eye->point pass through a building or a palm canopy?
// Used to score candidate chase positions by helicopter visibility.
function sightLineBlocked(s, eye, point) {
  for (const b of s.city.buildings) {
    const boxLo = [b.x - b.w / 2 - 0.3, 0, b.z - b.d / 2 - 0.3];
    const boxHi = [b.x + b.w / 2 + 0.3, b.h, b.z + b.d / 2 + 0.3];
    let tNear = 0, tFar = 1, outside = false;
    for (let axis = 0; axis < 3; axis++) {
      const d = point[axis] - eye[axis];
      if (Math.abs(d) < 1e-9) { if (eye[axis] < boxLo[axis] || eye[axis] > boxHi[axis]) { outside = true; break; } continue; }
      let ta = (boxLo[axis] - eye[axis]) / d, tb = (boxHi[axis] - eye[axis]) / d;
      if (ta > tb) { const swap = ta; ta = tb; tb = swap; }
      tNear = Math.max(tNear, ta); tFar = Math.min(tFar, tb);
      if (tNear > tFar) { outside = true; break; }
    }
    if (!outside && tNear < 0.97) return true;
  }
  for (const palm of s.city.palms) {
    const scale = palm.s || 1, lean = palm.lean || 0.1;
    const canopyX = palm.x + lean * 1.65 * scale, canopyZ = palm.z + lean * 0.5 * scale;
    const canopyY = 5.05 * scale, canopyR = 2.85 * scale + 0.4;
    for (let i = 1; i < 40; i++) {
      const t = i / 40;
      if (t < 0.03 || t > 0.97) continue;
      const x = eye[0] + (point[0] - eye[0]) * t;
      const y = eye[1] + (point[1] - eye[1]) * t;
      const z = eye[2] + (point[2] - eye[2]) * t;
      if (Math.abs(y - canopyY) < 0.5 && Math.hypot(x - canopyX, z - canopyZ) < canopyR) return true;
    }
  }
  return false;
}

// Choose the stretch of the central north–south road where the staged
// helicopter is least occluded and the fewest palm canopies roof the
// corridor.
function pickChaseStretch(s, roadC) {
  let chosenZ = -30, chosenScore = Infinity;
  for (let z = -75; z <= 25; z += 5) {
    const eyePos = [roadC - 3.6 - 0.35, 1.22, z + 0.15];
    const heliX = roadC - 3.6 - 5, heliZ = z + 22, heliH = 11.8, heliRy = 1.15;
    const hFwdX = Math.sin(heliRy), hFwdZ = Math.cos(heliRy), hRightX = Math.cos(heliRy), hRightZ = -Math.sin(heliRy);
    const heliSamples = [
      [heliX, heliH, heliZ],
      [heliX + hFwdX * 3.2, heliH, heliZ + hFwdZ * 3.2],
      [heliX - hFwdX * 3.4, heliH + 0.4, heliZ - hFwdZ * 3.4],
      [heliX + hRightX * 6.75, heliH + 1.5, heliZ + hRightZ * 6.75],
      [heliX - hRightX * 6.75, heliH + 1.5, heliZ - hRightZ * 6.75],
    ];
    let score = heliSamples.filter((pt) => sightLineBlocked(s, eyePos, pt)).length * 100;
    for (const palm of s.city.palms) if (Math.abs(palm.x - roadC) < 13 && palm.z > z - 4 && palm.z < z + 52) score++;
    const isBetter = score < chosenScore || (score === chosenScore && Math.abs(z + 30) < Math.abs(chosenZ + 30));
    if (isBetter) { chosenScore = score; chosenZ = z; }
  }
  return chosenZ;
}

function composeChase(s, out) {
  const centers = roadCenters();
  const roadC = centers.reduce((a, b) => (Math.abs(b - BLOCK * 0.5) < Math.abs(a - BLOCK * 0.5) ? b : a), centers[0]);
  const car = firstParkedCar(s);
  car.kind = 'player';
  car.x = roadC - 3.6; car.z = pickChaseStretch(s, roadC); car.ry = 0; car.rpm = 0.8;
  const p = s.player;
  p.inCar = car; p.x = car.x; p.z = car.z;
  s.wanted = 4; s.trauma = 0.45; s.radio = 2; s.respect = 720;
  s.hasGun = true; s.hasSmg = true; s.hasShotgun = true;
  s.mission = { name: 'VICE ESCAPE', desc: "Survive the 4-star heat, then reach the Pay 'n Spray.", idx: 4, surviveT: 97, target: { x: s.city.zones.spray.x, z: s.city.zones.spray.z, r: 6 } };
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const ahead = (forward, right) => [car.x + fx * forward + rx * right, car.z + fz * forward + rz * right];
  const buildCop = (x, z, ry) => ({ id: 950 + s.cops.length, kind: 'cop', x, z, ry, speed: 12, targetSpeed: 20, hp: 120, smoke: 0, driver: true, stopped: 0, color: [0.95, 0.95, 0.97] });
  let spot = ahead(-2, -2.6);
  s.cops.push(buildCop(spot[0], spot[1], car.ry + 0.15));
  spot = ahead(9, 5.0);
  s.cops.push(buildCop(spot[0], spot[1], car.ry + 0.05));
  spot = ahead(5.5, -6.2);
  const closeCop = buildCop(spot[0], spot[1], car.ry - 0.5);
  closeCop.speed = 0;
  s.cops.push(closeCop);
  for (const side of [-3.4, 3.4]) {
    spot = ahead(15, side);
    const blocker = buildCop(spot[0], spot[1], car.ry - Math.sign(side) * Math.PI / 4);
    blocker.roadblock = true; blocker.speed = 0;
    s.cops.push(blocker);
  }
  out.barriers = [1.7, -1.7].map((side) => { const bp = ahead(15.3, side); return { kind: 'barrier', x: bp[0], z: bp[1] }; });
  const heliSpot = ahead(22, -5);
  s.heli = { a: 0, h: 11.8, ry: car.ry + 1.15, x: heliSpot[0], z: heliSpot[1] };
  const poolSpot = ahead(8.5, 0);
  s.spotTarget = { x: poolSpot[0], z: poolSpot[1] };
  spot = ahead(11, -8);
  const burningWreck = stageTrafficAt(s, 3, spot[0], spot[1], car.ry + 0.7, [0.3, 0.3, 0.34]);
  burningWreck.burning = 1.4; burningWreck.hp = 0;
  spot = ahead(26, -8);
  stageTrafficAt(s, 0, spot[0], spot[1], car.ry + Math.PI / 2, [0.98, 0.78, 0.15]);
  spot = ahead(-10, 10);
  stageTrafficAt(s, 1, spot[0], spot[1], car.ry, [0.4, 0.7, 0.4]);
  stagePedAt(s, 0, roadC - 10, car.z - 12, false, roadC, -10);
  stagePedAt(s, 1, roadC + 10.5, car.z + 14, false, roadC, 10.5);
  stagePedAt(s, 2, roadC + 2, car.z + 22, true, roadC, 12);
  stagePedAt(s, 3, roadC + 16, car.z + 4, true, roadC, -13);
  const rng = s.rng;
  for (let i = 0; i < 26; i++) out.puffs.push({ x: car.x - fx * 2 + rng.range(-1, 1), y: 0.5, z: car.z - fz * 2 + rng.range(-1, 1), vx: -fx * 2, vy: rng.range(1, 2), vz: -fz * 2, life: 1.6, size: 0.9, color: [0.85, 0.85, 0.88] });
  for (let i = 0; i < 10; i++) out.puffs.push({ x: car.x - rx * 2.2, y: 0.8, z: car.z - rz * 2.2, vx: -rx * 3, vy: 1.5, vz: -rz * 3, life: 0.5, size: 0.3, color: [1, 0.75, 0.25] });
  out.skids = [
    { x: car.x - fx * 6, z: car.z - fz * 6, ry: car.ry, len: 9 },
    { x: car.x - fx * 10, z: car.z - fz * 10, ry: car.ry + 0.2, len: 8 },
  ];
}

function gapToBuilding(x, z, b) {
  const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0);
  const dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
  return Math.hypot(dx, dz);
}

// Find a vantage point near the Pay 'n Spray with a genuinely clear
// view: no palm at the camera or across the first metres of the sight
// line, and no car or building in the way.
function pickEndVantage(s, spray) {
  const options = [[-10, 12], [-4, 14], [-14, 6], [-6, 8], [-12, 16], [-2, 10], [-16, 12]];
  for (const option of options) {
    const px = spray.x + option[0], pz = spray.z + option[1];
    const viewYaw = Math.atan2(spray.x - px, spray.z - pz);
    const fx = Math.sin(viewYaw), fz = Math.cos(viewYaw);
    let unobstructed = true;
    for (const palm of s.city.palms) {
      if (Math.hypot(palm.x - px, palm.z - pz) < 2.5) { unobstructed = false; break; }
      for (let t = 1; t < 8; t += 1.5) if (Math.hypot(palm.x - (px + fx * t), palm.z - (pz + fz * t)) < 1.8) { unobstructed = false; break; }
      if (!unobstructed) break;
    }
    if (unobstructed) for (const car of s.cars) if (Math.hypot(car.x - px, car.z - pz) < 3) { unobstructed = false; break; }
    if (unobstructed) {
      for (const b of s.city.buildings) {
        if (gapToBuilding(px, pz, b) < 2.5) { unobstructed = false; break; }
        for (let t = 1.5; t < 11; t += 1.5) if (gapToBuilding(px + fx * t, pz + fz * t, b) < 1.2) { unobstructed = false; break; }
        if (!unobstructed) break;
      }
    }
    if (unobstructed) return [px, pz];
  }
  return [spray.x - 10, spray.z + 12];
}

function composeEnd(s, out) {
  const spray = s.city.zones.spray, p = s.player;
  const vantage = pickEndVantage(s, spray);
  p.x = vantage[0]; p.z = vantage[1];
  s.camYaw = Math.atan2(spray.x - p.x, spray.z - p.z) + 0.13;
  p.ry = s.camYaw;
  s.hasGun = true;
  const goldCar = firstParkedCar(s);
  goldCar.x = spray.x; goldCar.z = spray.z; goldCar.ry = Math.PI / 2; goldCar.color = [0.98, 0.8, 0.35];
  s.pickups.push({ x: spray.x + 4, z: spray.z + 6, cash: 0, t: 999 });
  s.cops.push({ id: 977, kind: 'cop', x: spray.x + 26, z: spray.z - 20, ry: Math.PI, speed: 6, targetSpeed: 12, hp: 120, smoke: 0, driver: true, stopped: 0, color: [0.95, 0.95, 0.97] });
  stageTrafficAt(s, 0, spray.x - 14, spray.z - 26, Math.PI / 2, [0.9, 0.45, 0.3]);
  stagePedAt(s, 0, spray.x + 6, spray.z + 8, true, spray.z, 8);
  stagePedAt(s, 1, spray.x + 2, spray.z + 2, false, spray.x, -6);
  s.banner = 'MISSION PASSED'; s.bannerColor = '#00FFCC'; s.bannerT = 999;
  s.mission = { name: 'THE RIVAL DEAL', desc: 'REWARD: $20,000', target: null };
  s.cash = 21450; s.wanted = 0; s.respect = 760;
  s.hasSmg = true; s.hasShotgun = true; s.hasRifle = true;
  s.weapon = 'rifle'; s.ammoRifle = 17; s.flashT = 999; s.recoil = 0.8;
  p.aim = true;
  out.skids = [
    { x: spray.x - 6, z: spray.z + 2, ry: Math.PI / 2, len: 10 },
    { x: spray.x - 11, z: spray.z + 2.6, ry: Math.PI / 2, len: 8 },
  ];
  for (let i = 0; i < 8; i++) out.puffs.push({ x: spray.x + (i % 3 - 1) * 0.8, y: 1.2 + i * 0.35, z: spray.z + (i % 2) * 1.2 - 0.6, vx: 0.2, vy: 0.7, vz: 0.1, life: 1.4, size: 0.3, color: [0.8, 0.8, 0.82] });
}

export function setupShotScene(s, kind) {
  const staged = { skids: [], puffs: [] };
  s.mode = 'play';
  if (kind === 'start') composeTitle(s);
  else if (kind === 'play') composePlay(s);
  else if (kind === 'chase') composeChase(s, staged);
  else if (kind === 'end') composeEnd(s, staged);
  return staged;
}

// The camera the renderer uses for a staged scene (mirrors main.js).
export function shotCamera(s, kind) {
  const p = s.player;
  if (p.inCar) {
    const car = p.inCar;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    return { eye: [car.x - rx * 0.35 + fx * 0.15, 1.22, car.z - rz * 0.35 + fz * 0.15], yaw: car.ry, pitch: 0 };
  }
  return { eye: [p.x, 1.72, p.z], yaw: s.camYaw, pitch: kind === 'start' ? -0.03 : 0.02 };
}

// Count the staged entities that fall inside a ~55-degree cone around
// the view direction.
export function countVisible(s, kind) {
  const cam = shotCamera(s, kind);
  const dirX = Math.sin(cam.yaw), dirZ = Math.cos(cam.yaw);
  const insideCone = (x, z) => {
    const dx = x - cam.eye[0], dz = z - cam.eye[2], d = Math.hypot(dx, dz);
    if (d < 1.5 || d > 130) return false;
    return (dx * dirX + dz * dirZ) / d > 0.55;
  };
  let pedsSeen = 0, carsSeen = 0, copsSeen = 0;
  for (const ped of s.peds) if (ped.state !== 'dead' && insideCone(ped.x, ped.z)) pedsSeen++;
  for (const car of s.cars) if (car !== s.player.inCar && insideCone(car.x, car.z)) carsSeen++;
  for (const cop of s.cops) if (insideCone(cop.x, cop.z)) copsSeen++;
  return { peds: pedsSeen, cars: carsSeen, cops: copsSeen };
}
