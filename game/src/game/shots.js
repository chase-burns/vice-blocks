// Deterministic screenshot scenes (WO Task 13 + Section 4), pure logic so the
// QA script can verify visible crowd/traffic counts before any capture.
// Every scene deliberately places pedestrians and traffic in frame.
import { BLOCK, CITY_HALF, roadCenters } from './world.js';

function placePedAt(s, i, x, z, horiz, road, side) {
  const ped = s.peds[i % s.peds.length];
  ped.x = x; ped.z = z; ped.horiz = horiz; ped.road = road; ped.side = side;
  ped.state = 'walk'; ped.dir = 1; ped.t = 99;
  ped.ry = horiz ? Math.PI / 2 : 0;
  return ped;
}
function placeTrafficAt(s, i, x, z, ry, color) {
  const cars = s.cars.filter(c => c.kind === 'traffic');
  const car = cars[i % cars.length];
  car.x = x; car.z = z; car.ry = ry; car.speed = 0;
  if (color) car.color = color;
  return car;
}

export function setupShotScene(s, kind) {
  const p = s.player, rng = s.rng;
  const out = { skids: [], puffs: [] };
  s.mode = 'play';
  if (kind === 'start') {
    s.mode = 'title'; s.hasGun = true;
    p.x = CITY_HALF - 30; p.z = -38;
    s.camYaw = -2.32; p.ry = s.camYaw;
    const coupe = s.cars.find(c => c.kind === 'parked');
    coupe.x = p.x - 15; coupe.z = p.z - 9; coupe.ry = 0.5; coupe.color = [0.95, 0.15, 0.55];
    // Promenade life: strollers on the coast road's west sidewalk (in frame,
    // camera looks WSW) + cars driving the coast road southbound/northbound.
    const coastRoad = roadCenters()[roadCenters().length - 1];
    for (let i = 0; i < 5; i++) {
      placePedAt(s, i, coastRoad - 9.5, -46 - i * 7 + rng.range(-1, 1), false, coastRoad, -9.5);
    }
    placeTrafficAt(s, 0, coastRoad - 3.6, -70, Math.PI, [0.98, 0.78, 0.15]);
    placeTrafficAt(s, 1, coastRoad + 3.6, -95, 0, [0.9, 0.4, 0.3]);
  }
  if (kind === 'play') {
    const car = s.cars.find(c => c.kind === 'parked');
    car.kind = 'player'; car.x = BLOCK * 0.5 + 3.6; car.z = -60; car.ry = 0;
    p.inCar = car; p.x = car.x; p.z = car.z;
    car.rpm = 0.92;
    s.cash = 2840; s.armor = 50; s.health = 100;
    s.radio = 1; s.respect = 340; // HUD sells it: RADIO VICE FM + RESPECT OPERATOR
    // Traffic ahead (taxi close, sedan further) + oncoming lane car.
    placeTrafficAt(s, 0, car.x, car.z + 18, 0, [0.98, 0.78, 0.15]);
    placeTrafficAt(s, 1, car.x, car.z + 38, 0, [0.85, 0.88, 0.9]);
    placeTrafficAt(s, 2, car.x - 7.2, car.z + 30, Math.PI, [0.3, 0.55, 0.95]);
    // Sidewalk pedestrians on both sides, walking toward camera street.
    const road = BLOCK * 0.5;
    placePedAt(s, 0, road - 9.5, car.z + 10, false, road, -9.5);
    placePedAt(s, 1, road + 9.5, car.z + 16, false, road, 9.5);
    placePedAt(s, 2, road - 9.5, car.z + 26, false, road, -9.5);
    placePedAt(s, 3, road + 9.5, car.z + 6, false, road, 9.5);
    s.mission = { name: 'PALM TREE GRAND PRIX', desc: "Rico's midnight circuit — hit 5 checkpoints against the clock.", timer: 63, target: { x: car.x, z: car.z + 120, r: 6 } };
  }
  if (kind === 'chase') {
    const car = s.cars.find(c => c.kind === 'parked');
    // Open straight-road staging: scan this road for the stretch with the
    // fewest palm canopies overhanging the next 50 m, so the frame reads as
    // an open chase corridor instead of a tunnel of fronds.
    const centers = roadCenters();
    const roadC = centers.reduce((a, b) => Math.abs(b - BLOCK * 0.5) < Math.abs(a - BLOCK * 0.5) ? b : a, centers[0]);
    // Score each stretch by (a) how many sight-rays from the cockpit to the
    // staged helicopter are blocked by buildings / palm canopies (eye is the
    // deterministic cockpit anchor; margins cover spring/trauma wobble) and
    // (b) how many canopies overhang the corridor. Geometry mirrors the QA
    // projection assertion in /tmp/qa-chase.mjs.
    const segBlocked = (e, pt) => {
      for (const b of s.city.buildings) {
        const lo = [b.x - b.w / 2 - 0.3, 0, b.z - b.d / 2 - 0.3], hi = [b.x + b.w / 2 + 0.3, b.h, b.z + b.d / 2 + 0.3];
        let t0 = 0, t1 = 1, miss = false;
        for (let i = 0; i < 3; i++) {
          const d = pt[i] - e[i];
          if (Math.abs(d) < 1e-9) { if (e[i] < lo[i] || e[i] > hi[i]) { miss = true; break; } continue; }
          let ta = (lo[i] - e[i]) / d, tb = (hi[i] - e[i]) / d;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) { miss = true; break; }
        }
        if (!miss && t0 < 0.97) return true;
      }
      for (const pm of s.city.palms) {
        const sc = pm.s || 1, lean = pm.lean || 0.1;
        const cxp = pm.x + lean * 1.65 * sc, czp = pm.z + lean * 0.5 * sc, cyp = 5.05 * sc, rr = 2.85 * sc + 0.4;
        for (let i = 1; i < 40; i++) {
          const t = i / 40;
          if (t < 0.03 || t > 0.97) continue;
          const x = e[0] + (pt[0] - e[0]) * t, y = e[1] + (pt[1] - e[1]) * t, zz = e[2] + (pt[2] - e[2]) * t;
          if (Math.abs(y - cyp) < 0.5 && Math.hypot(x - cxp, zz - czp) < rr) return true;
        }
      }
      return false;
    };
    let bestZ = -30, bestScore = Infinity;
    for (let z = -75; z <= 25; z += 5) {
      const eye = [roadC - 3.6 - 0.35, 1.22, z + 0.15];
      const hx0 = roadC - 3.6 - 6, hz0 = z + 21, hh = 12.5, hry = 0.9;
      const hfx = Math.sin(hry), hfz = Math.cos(hry), hrx = Math.cos(hry), hrz = -Math.sin(hry);
      const hPts = [
        [hx0, hh, hz0],
        [hx0 + hfx * 3.2, hh, hz0 + hfz * 3.2],
        [hx0 - hfx * 3.4, hh + 0.4, hz0 - hfz * 3.4],
        [hx0 + hrx * 6.75, hh + 1.5, hz0 + hrz * 6.75],
        [hx0 - hrx * 6.75, hh + 1.5, hz0 - hrz * 6.75],
      ];
      let score = hPts.filter(pt => segBlocked(eye, pt)).length * 100;
      for (const pm of s.city.palms) if (Math.abs(pm.x - roadC) < 13 && pm.z > z - 4 && pm.z < z + 52) score++;
      if (score < bestScore || (score === bestScore && Math.abs(z + 30) < Math.abs(bestZ + 30))) { bestScore = score; bestZ = z; }
    }
    car.kind = 'player'; car.x = roadC - 3.6; car.z = bestZ; car.ry = 0;
    p.inCar = car; p.x = car.x; p.z = car.z;
    car.rpm = 0.8; s.wanted = 4; s.trauma = 0.45;
    s.radio = 2; s.respect = 720; // RADIO SOLMAR + RESPECT KINGPIN on the HUD
    s.mission = { name: 'VICE ESCAPE', desc: "Survive the 4-star heat, then reach the Pay 'n Spray.", idx: 4, surviveT: 97, target: { x: s.city.zones.spray.x, z: s.city.zones.spray.z, r: 6 } };
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const mkCop = (x, z, ry) => ({ id: 950 + s.cops.length, kind: 'cop', x, z, ry, speed: 12, targetSpeed: 20, hp: 120, smoke: 0, driver: true, stopped: 0, color: [0.95, 0.95, 0.97] });
    // PIT unit tucked behind (mirror / minimap dressing).
    s.cops.push(mkCop(car.x - rx * 2.6 - fx * 2, car.z - rz * 2.6 - fz * 2, car.ry + 0.15));
    // Pursuit unit alongside ahead-left, fully in frame.
    s.cops.push(mkCop(car.x + fx * 9 + rx * 5.0, car.z + fz * 9 + rz * 5.0, car.ry + 0.05));
    // 4-star roadblock: two cruisers angled nose-in across the road ahead.
    for (const sd of [-3.0, 3.0]) {
      const rb = mkCop(car.x + fx * 15 + rx * sd, car.z + fz * 15 + rz * sd, car.ry + Math.PI / 2 - Math.sign(sd) * 0.30);
      rb.roadblock = true; rb.speed = 0;
      s.cops.push(rb);
    }
    // Air unit high in the upper frame, broadside, spotlight on the player.
    s.heli = { a: 0, h: 12.5, ry: car.ry + 0.9, x: car.x + fx * 21 - rx * 6, z: car.z + fz * 21 - rz * 6 };
    // A burning wreck by the roadside for the explosion chain money-shot.
    const wreck = placeTrafficAt(s, 3, car.x + fx * 11 - rx * 8, car.z + fz * 11 - rz * 8, car.ry + 0.7, [0.3, 0.3, 0.34]);
    wreck.burning = 1.4; wreck.hp = 0;
    // Bystander traffic + fleeing peds at the intersection corners.
    placeTrafficAt(s, 0, car.x + fx * 26 - rx * 8, car.z + fz * 26 - rz * 8, car.ry + Math.PI / 2, [0.98, 0.78, 0.15]);
    placeTrafficAt(s, 1, car.x - fx * 10 + rx * 10, car.z - fz * 10 + rz * 10, car.ry, [0.4, 0.7, 0.4]);
    const road = roadC;
    placePedAt(s, 0, road - 10, car.z - 12, false, road, -10);
    placePedAt(s, 1, road + 10.5, car.z + 14, false, road, 10.5);
    placePedAt(s, 2, road + 2, car.z + 22, true, road, 12);
    placePedAt(s, 3, road + 16, car.z + 4, true, road, -13);
    for (let i = 0; i < 26; i++) out.puffs.push({ x: car.x - fx * 2 + rng.range(-1, 1), y: 0.5, z: car.z - fz * 2 + rng.range(-1, 1), vx: -fx * 2, vy: rng.range(1, 2), vz: -fz * 2, life: 1.6, size: 0.9, color: [0.85, 0.85, 0.88] });
    for (let i = 0; i < 10; i++) out.puffs.push({ x: car.x - rx * 2.2, y: 0.8, z: car.z - rz * 2.2, vx: -rx * 3, vy: 1.5, vz: -rz * 3, life: 0.5, size: 0.3, color: [1, 0.75, 0.25] });
    out.skids = [{ x: car.x - fx * 6, z: car.z - fz * 6, ry: car.ry, len: 9 }, { x: car.x - fx * 10, z: car.z - fz * 10, ry: car.ry + 0.2, len: 8 }];
  }
  if (kind === 'end') {
    const z = s.city.zones.spray;
    // Pick a vantage with a clear sightline to the spray: no palm near the
    // camera or across the first 8 m of the view ray, no car on top of us.
    const candidates = [[-10, 12], [-4, 14], [-14, 6], [-6, 8], [-12, 16], [-2, 10], [-16, 12]];
    let placed = false;
    for (const [ox, oz] of candidates) {
      const px = z.x + ox, pz = z.z + oz;
      const fx = Math.sin(Math.atan2(z.x - px, z.z - pz)), fz = Math.cos(Math.atan2(z.x - px, z.z - pz));
      let clear = true;
      for (const pm of s.city.palms) {
        const d0 = Math.hypot(pm.x - px, pm.z - pz);
        if (d0 < 2.5) { clear = false; break; }
        for (let t = 1; t < 8; t += 1.5) {
          if (Math.hypot(pm.x - (px + fx * t), pm.z - (pz + fz * t)) < 1.8) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (clear) for (const c of s.cars) if (Math.hypot(c.x - px, c.z - pz) < 3) { clear = false; break; }
      if (clear) {
        // Buildings too: not standing inside one, none blocking the view ray.
        const aabbD = (bx, bz, b) => {
          const dx = Math.max(Math.abs(bx - b.x) - b.w / 2, 0);
          const dz = Math.max(Math.abs(bz - b.z) - b.d / 2, 0);
          return Math.hypot(dx, dz);
        };
        for (const b of s.city.buildings) {
          if (aabbD(px, pz, b) < 2.5) { clear = false; break; }
          let blocked = false;
          for (let t = 1.5; t < 11; t += 1.5) if (aabbD(px + fx * t, pz + fz * t, b) < 1.2) { blocked = true; break; }
          if (blocked) { clear = false; break; }
        }
      }
      if (clear) { p.x = px; p.z = pz; placed = true; break; }
    }
    if (!placed) { p.x = z.x - 10; p.z = z.z + 12; }
    s.camYaw = Math.atan2(z.x - p.x, z.z - p.z); p.ry = s.camYaw;
    s.hasGun = true;
    const gold = s.cars.find(c => c.kind === 'parked');
    gold.x = z.x; gold.z = z.z; gold.ry = Math.PI / 2; gold.color = [0.98, 0.8, 0.35];
    s.pickups.push({ x: z.x + 4, z: z.z + 6, cash: 0, t: 999 });
    s.cops.push({ id: 977, kind: 'cop', x: z.x + 26, z: z.z - 20, ry: Math.PI, speed: 6, targetSpeed: 12, hp: 120, smoke: 0, driver: true, stopped: 0, color: [0.95, 0.95, 0.97] });
    // Street life around the spray shop.
    placeTrafficAt(s, 0, z.x - 14, z.z - 26, Math.PI / 2, [0.9, 0.45, 0.3]);
    placePedAt(s, 0, z.x + 6, z.z + 8, true, z.z, 8);
    placePedAt(s, 1, z.x + 2, z.z + 2, false, z.x, -6);
    s.banner = 'MISSION PASSED'; s.bannerColor = '#00FFCC'; s.bannerT = 999;
    s.mission = { name: 'THE RIVAL DEAL', desc: 'REWARD: $20,000', target: null };
    s.cash = 21450; s.wanted = 0;
    s.respect = 760; s.hasSmg = true; s.weapon = 'smg'; s.ammoSmg = 28; // endgame loadout on the HUD: SMG + KINGPIN
    out.skids = [{ x: z.x - 6, z: z.z + 2, ry: Math.PI / 2, len: 10 }, { x: z.x - 11, z: z.z + 2.6, ry: Math.PI / 2, len: 8 }];
    // Celebration smoke rises off the gold car, NOT in the camera's face.
    for (let i = 0; i < 8; i++) out.puffs.push({ x: z.x + (i % 3 - 1) * 0.8, y: 1.2 + i * 0.35, z: z.z + (i % 2) * 1.2 - 0.6, vx: 0.2, vy: 0.7, vz: 0.1, life: 1.4, size: 0.3, color: [0.8, 0.8, 0.82] });
  }
  return out;
}

// Camera used by the renderer for each scene (mirrors main.js render()).
export function shotCamera(s, kind) {
  const p = s.player;
  if (p.inCar) {
    const car = p.inCar;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    return { eye: [car.x - rx * 0.35 + fx * 0.15, 1.22, car.z - rz * 0.35 + fz * 0.15], yaw: car.ry, pitch: 0 };
  }
  return { eye: [p.x, 1.72, p.z], yaw: s.camYaw, pitch: kind === 'start' ? -0.03 : 0.02 };
}
export function countVisible(s, kind) {
  const cam = shotCamera(s, kind);
  const dir = [Math.sin(cam.yaw), Math.cos(cam.yaw)];
  const test = (x, z) => {
    const dx = x - cam.eye[0], dz = z - cam.eye[2];
    const d = Math.hypot(dx, dz);
    if (d < 1.5 || d > 130) return false;
    const dot = (dx * dir[0] + dz * dir[1]) / d;
    return dot > 0.55; // within ~55 deg of view centre
  };
  let peds = 0, cars = 0, cops = 0;
  for (const ped of s.peds) if (ped.state !== 'dead' && test(ped.x, ped.z)) peds++;
  for (const c of s.cars) if (c !== s.player.inCar && test(c.x, c.z)) cars++;
  for (const c of s.cops) if (test(c.x, c.z)) cops++;
  return { peds, cars, cops };
}
