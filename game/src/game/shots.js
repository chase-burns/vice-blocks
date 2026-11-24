// shots.js — deterministic staging for the four storefront screenshots.
// Each scene rearranges the live game state (player, cars, cops, peds,
// mission, wallet) into a composed still that shows real systems: the
// title shows the save line, play shows a timed mission from the cockpit,
// chase shows a four-star response at late dusk, and end shows an aimed
// rifle mid-burst. Pure logic, so the QA scripts can verify visibility
// counts and projections headlessly before anything is captured.
import { BLOCK, CITY_HALF, roadCenters } from './world.js';

function stagePed(s, index, x, z, horiz, road, side) {
  const ped = s.peds[index % s.peds.length];
  ped.x = x;
  ped.z = z;
  ped.horiz = horiz;
  ped.road = road;
  ped.side = side;
  ped.state = 'walk';
  ped.dir = 1;
  ped.t = 99;
  ped.ry = horiz ? Math.PI / 2 : 0;
  return ped;
}

function stageTraffic(s, index, x, z, ry, color) {
  const traffic = s.cars.filter((c) => c.kind === 'traffic');
  const car = traffic[index % traffic.length];
  car.x = x;
  car.z = z;
  car.ry = ry;
  car.speed = 0;
  if (color) car.color = color;
  return car;
}

function firstParked(s) {
  return s.cars.find((c) => c.kind === 'parked');
}

// ------------------------------------------------------------- title still
function stageStart(s) {
  const p = s.player;
  s.mode = 'title';
  s.hasGun = true;
  // A mid-career profile so the CONTINUE line has something to say:
  // five of eight missions done, three weapons, Operator respect.
  s.missionIdx = 5;
  s.cash = 12480;
  s.respect = 460;
  s.hasSmg = true;
  s.hasShotgun = true;
  p.x = CITY_HALF - 30;
  p.z = -38;
  s.camYaw = -2.32; // looking WSW down the coast road
  p.ry = s.camYaw;
  const coupe = firstParked(s);
  coupe.x = p.x - 15;
  coupe.z = p.z - 9;
  coupe.ry = 0.5;
  coupe.color = [0.95, 0.15, 0.55];
  const coastRoad = roadCenters()[roadCenters().length - 1];
  for (let i = 0; i < 5; i++) {
    stagePed(s, i, coastRoad - 9.5, -46 - i * 7 + s.rng.range(-1, 1), false, coastRoad, -9.5);
  }
  stageTraffic(s, 0, coastRoad - 3.6, -70, Math.PI, [0.98, 0.78, 0.15]);
  stageTraffic(s, 1, coastRoad + 3.6, -95, 0, [0.9, 0.4, 0.3]);
}

// -------------------------------------------------------------- play still
function stagePlay(s) {
  const car = firstParked(s);
  car.kind = 'player';
  car.x = BLOCK * 0.5 + 3.6;
  car.z = -60;
  car.ry = 0;
  car.rpm = 0.92;
  const p = s.player;
  p.inCar = car;
  p.x = car.x;
  p.z = car.z;
  s.cash = 2840;
  s.armor = 50;
  s.health = 100;
  s.radio = 1;      // VICE FM on the gear line
  s.respect = 340;  // OPERATOR
  s.hasGun = true;
  stageTraffic(s, 0, car.x, car.z + 18, 0, [0.98, 0.78, 0.15]);
  stageTraffic(s, 1, car.x, car.z + 38, 0, [0.85, 0.88, 0.9]);
  stageTraffic(s, 2, car.x - 7.2, car.z + 30, Math.PI, [0.3, 0.55, 0.95]);
  const road = BLOCK * 0.5;
  stagePed(s, 0, road - 9.5, car.z + 10, false, road, -9.5);
  stagePed(s, 1, road + 9.5, car.z + 16, false, road, 9.5);
  stagePed(s, 2, road - 9.5, car.z + 26, false, road, -9.5);
  stagePed(s, 3, road + 9.5, car.z + 6, false, road, 9.5);
  s.mission = {
    name: 'PALM TREE GRAND PRIX',
    desc: "Rico's midnight circuit — hit 5 checkpoints against the clock.",
    timer: 63,
    target: { x: car.x, z: car.z + 120, r: 6 },
  };
}

// ------------------------------------------------------------- chase still
// Does the segment eye->point pass through a building or a palm canopy?
// Used to score candidate staging spots by helicopter visibility.
function segmentBlocked(s, eye, point) {
  for (const b of s.city.buildings) {
    const lo = [b.x - b.w / 2 - 0.3, 0, b.z - b.d / 2 - 0.3];
    const hi = [b.x + b.w / 2 + 0.3, b.h, b.z + b.d / 2 + 0.3];
    let tEnter = 0;
    let tExit = 1;
    let missed = false;
    for (let axis = 0; axis < 3; axis++) {
      const d = point[axis] - eye[axis];
      if (Math.abs(d) < 1e-9) {
        if (eye[axis] < lo[axis] || eye[axis] > hi[axis]) { missed = true; break; }
        continue;
      }
      let ta = (lo[axis] - eye[axis]) / d;
      let tb = (hi[axis] - eye[axis]) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      tEnter = Math.max(tEnter, ta);
      tExit = Math.min(tExit, tb);
      if (tEnter > tExit) { missed = true; break; }
    }
    if (!missed && tEnter < 0.97) return true;
  }
  for (const palm of s.city.palms) {
    const sc = palm.s || 1;
    const lean = palm.lean || 0.1;
    const canopyX = palm.x + lean * 1.65 * sc;
    const canopyZ = palm.z + lean * 0.5 * sc;
    const canopyY = 5.05 * sc;
    const canopyR = 2.85 * sc + 0.4;
    for (let i = 1; i < 40; i++) {
      const t = i / 40;
      if (t < 0.03 || t > 0.97) continue;
      const x = eye[0] + (point[0] - eye[0]) * t;
      const y = eye[1] + (point[1] - eye[1]) * t;
      const z = eye[2] + (point[2] - eye[2]) * t;
      if (Math.abs(y - canopyY) < 0.5 && Math.hypot(x - canopyX, z - canopyZ) < canopyR) {
        return true;
      }
    }
  }
  return false;
}

// Pick the stretch of the central north-south road where the staged
// helicopter is least occluded and fewest palm canopies roof the corridor.
function pickChaseSpot(s, roadC) {
  let bestZ = -30;
  let bestScore = Infinity;
  for (let z = -75; z <= 25; z += 5) {
    const eye = [roadC - 3.6 - 0.35, 1.22, z + 0.15];
    const hx = roadC - 3.6 - 5;
    const hz = z + 22;
    const hh = 11.8;
    const hry = 1.15;
    const hfx = Math.sin(hry), hfz = Math.cos(hry);
    const hrx = Math.cos(hry), hrz = -Math.sin(hry);
    const heliSamples = [
      [hx, hh, hz],
      [hx + hfx * 3.2, hh, hz + hfz * 3.2],
      [hx - hfx * 3.4, hh + 0.4, hz - hfz * 3.4],
      [hx + hrx * 6.75, hh + 1.5, hz + hrz * 6.75],
      [hx - hrx * 6.75, hh + 1.5, hz - hrz * 6.75],
    ];
    let score = heliSamples.filter((pt) => segmentBlocked(s, eye, pt)).length * 100;
    for (const palm of s.city.palms) {
      if (Math.abs(palm.x - roadC) < 13 && palm.z > z - 4 && palm.z < z + 52) score++;
    }
    const better = score < bestScore
      || (score === bestScore && Math.abs(z + 30) < Math.abs(bestZ + 30));
    if (better) { bestScore = score; bestZ = z; }
  }
  return bestZ;
}

function stageChase(s, out) {
  const centers = roadCenters();
  const roadC = centers.reduce(
    (a, b) => (Math.abs(b - BLOCK * 0.5) < Math.abs(a - BLOCK * 0.5) ? b : a),
    centers[0]);
  const car = firstParked(s);
  car.kind = 'player';
  car.x = roadC - 3.6;
  car.z = pickChaseSpot(s, roadC);
  car.ry = 0;
  car.rpm = 0.8;
  const p = s.player;
  p.inCar = car;
  p.x = car.x;
  p.z = car.z;

  s.wanted = 4;
  s.trauma = 0.45;
  s.radio = 2;      // SOLMAR
  s.respect = 720;  // KINGPIN
  s.hasGun = true;
  s.hasSmg = true;
  s.hasShotgun = true;
  s.mission = {
    name: 'VICE ESCAPE',
    desc: "Survive the 4-star heat, then reach the Pay 'n Spray.",
    idx: 4, surviveT: 97,
    target: { x: s.city.zones.spray.x, z: s.city.zones.spray.z, r: 6 },
  };

  const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
  const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const at = (forward, right) => [car.x + fx * forward + rx * right, car.z + fz * forward + rz * right];
  const makeCop = (x, z, ry) => ({
    id: 950 + s.cops.length, kind: 'cop', x, z, ry,
    speed: 12, targetSpeed: 20, hp: 120, smoke: 0,
    driver: true, stopped: 0, color: [0.95, 0.95, 0.97],
  });

  // One unit tucked behind (seen in the mirror and on the minimap).
  let pos = at(-2, -2.6);
  s.cops.push(makeCop(pos[0], pos[1], car.ry + 0.15));
  // A pursuit unit alongside ahead-left, fully in frame.
  pos = at(9, 5.0);
  s.cops.push(makeCop(pos[0], pos[1], car.ry + 0.05));
  // A near unit half-cut by the right frame edge: foreground pressure.
  pos = at(5.5, -6.2);
  const nearCop = makeCop(pos[0], pos[1], car.ry - 0.5);
  nearCop.speed = 0;
  s.cops.push(nearCop);
  // The four-star roadblock: two cruisers angled 45 degrees, noses
  // funnelled toward a gap marked by striped barricades.
  for (const side of [-3.4, 3.4]) {
    pos = at(15, side);
    const blocker = makeCop(pos[0], pos[1], car.ry - Math.sign(side) * Math.PI / 4);
    blocker.roadblock = true;
    blocker.speed = 0;
    s.cops.push(blocker);
  }
  out.barriers = [1.7, -1.7].map((side) => {
    const bp = at(15.3, side);
    return { kind: 'barrier', x: bp[0], z: bp[1] };
  });
  // Air support high in the upper frame, broadside to the camera, with
  // its spotlight pool landing between the player and the roadblock.
  const heliPos = at(22, -5);
  s.heli = { a: 0, h: 11.8, ry: car.ry + 1.15, x: heliPos[0], z: heliPos[1] };
  const poolPos = at(8.5, 0);
  s.spotTarget = { x: poolPos[0], z: poolPos[1] };
  // A burning wreck by the roadside sells the explosion chain.
  pos = at(11, -8);
  const wreck = stageTraffic(s, 3, pos[0], pos[1], car.ry + 0.7, [0.3, 0.3, 0.34]);
  wreck.burning = 1.4;
  wreck.hp = 0;
  // Bystander traffic and peds fleeing at the corners.
  pos = at(26, -8);
  stageTraffic(s, 0, pos[0], pos[1], car.ry + Math.PI / 2, [0.98, 0.78, 0.15]);
  pos = at(-10, 10);
  stageTraffic(s, 1, pos[0], pos[1], car.ry, [0.4, 0.7, 0.4]);
  stagePed(s, 0, roadC - 10, car.z - 12, false, roadC, -10);
  stagePed(s, 1, roadC + 10.5, car.z + 14, false, roadC, 10.5);
  stagePed(s, 2, roadC + 2, car.z + 22, true, roadC, 12);
  stagePed(s, 3, roadC + 16, car.z + 4, true, roadC, -13);
  // Drift smoke behind the car and a spray of sparks at the sill.
  const rng = s.rng;
  for (let i = 0; i < 26; i++) {
    out.puffs.push({
      x: car.x - fx * 2 + rng.range(-1, 1), y: 0.5,
      z: car.z - fz * 2 + rng.range(-1, 1),
      vx: -fx * 2, vy: rng.range(1, 2), vz: -fz * 2,
      life: 1.6, size: 0.9, color: [0.85, 0.85, 0.88],
    });
  }
  for (let i = 0; i < 10; i++) {
    out.puffs.push({
      x: car.x - rx * 2.2, y: 0.8, z: car.z - rz * 2.2,
      vx: -rx * 3, vy: 1.5, vz: -rz * 3,
      life: 0.5, size: 0.3, color: [1, 0.75, 0.25],
    });
  }
  out.skids = [
    { x: car.x - fx * 6, z: car.z - fz * 6, ry: car.ry, len: 9 },
    { x: car.x - fx * 10, z: car.z - fz * 10, ry: car.ry + 0.2, len: 8 },
  ];
}

// --------------------------------------------------------------- end still
function aabbDistance(x, z, b) {
  const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0);
  const dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
  return Math.hypot(dx, dz);
}

// Find a vantage near the Pay 'n Spray with a clear view of it: no palm
// at the camera or across the first metres of the sight line, no car or
// building in the way.
function pickEndVantage(s, spray) {
  const candidates = [[-10, 12], [-4, 14], [-14, 6], [-6, 8], [-12, 16], [-2, 10], [-16, 12]];
  for (const [ox, oz] of candidates) {
    const px = spray.x + ox;
    const pz = spray.z + oz;
    const yaw = Math.atan2(spray.x - px, spray.z - pz);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let clear = true;
    for (const palm of s.city.palms) {
      if (Math.hypot(palm.x - px, palm.z - pz) < 2.5) { clear = false; break; }
      for (let t = 1; t < 8; t += 1.5) {
        if (Math.hypot(palm.x - (px + fx * t), palm.z - (pz + fz * t)) < 1.8) {
          clear = false;
          break;
        }
      }
      if (!clear) break;
    }
    if (clear) {
      for (const car of s.cars) {
        if (Math.hypot(car.x - px, car.z - pz) < 3) { clear = false; break; }
      }
    }
    if (clear) {
      for (const b of s.city.buildings) {
        if (aabbDistance(px, pz, b) < 2.5) { clear = false; break; }
        for (let t = 1.5; t < 11; t += 1.5) {
          if (aabbDistance(px + fx * t, pz + fz * t, b) < 1.2) { clear = false; break; }
        }
        if (!clear) break;
      }
    }
    if (clear) return [px, pz];
  }
  return [spray.x - 10, spray.z + 12];
}

function stageEnd(s, out) {
  const spray = s.city.zones.spray;
  const p = s.player;
  const [px, pz] = pickEndVantage(s, spray);
  p.x = px;
  p.z = pz;
  // Aim at the spray shop, nudged so the gold car sits off the aim line
  // and the muzzle flash reads against the street.
  s.camYaw = Math.atan2(spray.x - p.x, spray.z - p.z) + 0.13;
  p.ry = s.camYaw;
  s.hasGun = true;
  const gold = firstParked(s);
  gold.x = spray.x;
  gold.z = spray.z;
  gold.ry = Math.PI / 2;
  gold.color = [0.98, 0.8, 0.35];
  s.pickups.push({ x: spray.x + 4, z: spray.z + 6, cash: 0, t: 999 });
  s.cops.push({
    id: 977, kind: 'cop', x: spray.x + 26, z: spray.z - 20, ry: Math.PI,
    speed: 6, targetSpeed: 12, hp: 120, smoke: 0,
    driver: true, stopped: 0, color: [0.95, 0.95, 0.97],
  });
  stageTraffic(s, 0, spray.x - 14, spray.z - 26, Math.PI / 2, [0.9, 0.45, 0.3]);
  stagePed(s, 0, spray.x + 6, spray.z + 8, true, spray.z, 8);
  stagePed(s, 1, spray.x + 2, spray.z + 2, false, spray.x, -6);
  s.banner = 'MISSION PASSED';
  s.bannerColor = '#00FFCC';
  s.bannerT = 999;
  s.mission = { name: 'THE RIVAL DEAL', desc: 'REWARD: $20,000', target: null };
  s.cash = 21450;
  s.wanted = 0;
  s.respect = 760; // KINGPIN
  s.hasSmg = true;
  s.hasShotgun = true;
  s.hasRifle = true;
  s.weapon = 'rifle';
  s.ammoRifle = 17;
  s.flashT = 999; // caught mid-burst: flash and tracer stay in the still
  s.recoil = 0.8;
  p.aim = true;
  out.skids = [
    { x: spray.x - 6, z: spray.z + 2, ry: Math.PI / 2, len: 10 },
    { x: spray.x - 11, z: spray.z + 2.6, ry: Math.PI / 2, len: 8 },
  ];
  for (let i = 0; i < 8; i++) {
    out.puffs.push({
      x: spray.x + (i % 3 - 1) * 0.8, y: 1.2 + i * 0.35,
      z: spray.z + (i % 2) * 1.2 - 0.6,
      vx: 0.2, vy: 0.7, vz: 0.1,
      life: 1.4, size: 0.3, color: [0.8, 0.8, 0.82],
    });
  }
}

// -------------------------------------------------------------- entry point
export function setupShotScene(s, kind) {
  const out = { skids: [], puffs: [] };
  s.mode = 'play';
  if (kind === 'start') stageStart(s);
  else if (kind === 'play') stagePlay(s);
  else if (kind === 'chase') stageChase(s, out);
  else if (kind === 'end') stageEnd(s, out);
  return out;
}

// The camera the renderer uses for a staged scene (mirrors main.js).
export function shotCamera(s, kind) {
  const p = s.player;
  if (p.inCar) {
    const car = p.inCar;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    return {
      eye: [car.x - rx * 0.35 + fx * 0.15, 1.22, car.z - rz * 0.35 + fz * 0.15],
      yaw: car.ry, pitch: 0,
    };
  }
  return { eye: [p.x, 1.72, p.z], yaw: s.camYaw, pitch: kind === 'start' ? -0.03 : 0.02 };
}

// Count staged entities inside a ~55-degree cone around the view
// direction — the headless density check the capture pipeline relies on.
export function countVisible(s, kind) {
  const cam = shotCamera(s, kind);
  const dirX = Math.sin(cam.yaw);
  const dirZ = Math.cos(cam.yaw);
  const inView = (x, z) => {
    const dx = x - cam.eye[0];
    const dz = z - cam.eye[2];
    const d = Math.hypot(dx, dz);
    if (d < 1.5 || d > 130) return false;
    return (dx * dirX + dz * dirZ) / d > 0.55;
  };
  let peds = 0, cars = 0, cops = 0;
  for (const ped of s.peds) if (ped.state !== 'dead' && inView(ped.x, ped.z)) peds++;
  for (const car of s.cars) if (car !== s.player.inCar && inView(car.x, car.z)) cars++;
  for (const cop of s.cops) if (inView(cop.x, cop.z)) cops++;
  return { peds, cars, cops };
}
