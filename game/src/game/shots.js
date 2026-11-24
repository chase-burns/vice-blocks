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
    s.mission = { name: 'CRUISE', desc: 'Downtown run', target: { x: car.x, z: car.z + 120, r: 6 } };
  }
  if (kind === 'chase') {
    const car = s.cars.find(c => c.kind === 'parked');
    car.kind = 'player'; car.x = BLOCK * 0.5; car.z = BLOCK * 0.5; car.ry = 0.9;
    p.inCar = car; p.x = car.x; p.z = car.z;
    car.rpm = 0.8; s.wanted = 4; s.trauma = 0.45;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    const mkCop = (x, z, ry) => ({ id: 950 + s.cops.length, kind: 'cop', x, z, ry, speed: 12, targetSpeed: 20, hp: 120, smoke: 0, driver: true, stopped: 0, color: [0.95, 0.95, 0.97] });
    s.cops.push(mkCop(car.x - rx * 2.6 + fx * 0.6, car.z - rz * 2.6 + fz * 0.6, car.ry + 0.15));
    s.cops.push(mkCop(car.x - fx * 14 + rx * 5, car.z - fz * 14 + rz * 5, car.ry));
    // 4-star roadblock: two cruisers side by side across the road ahead.
    for (const sd of [-2.3, 2.3]) {
      const rb = mkCop(car.x + fx * 19 + rx * sd, car.z + fz * 19 + rz * sd, car.ry + Math.PI / 2);
      rb.roadblock = true; rb.speed = 0;
      s.cops.push(rb);
    }
    // Air unit overhead, spotlight locked on the player car (staged for frame).
    s.heli = { a: 0, h: 17, x: car.x + fx * 26 - rx * 10, z: car.z + fz * 26 - rz * 10 };
    // A burning wreck by the roadside for the explosion chain money-shot.
    const wreck = placeTrafficAt(s, 3, car.x + fx * 12 + rx * 9, car.z + fz * 12 + rz * 9, car.ry + 0.7, [0.3, 0.3, 0.34]);
    wreck.burning = 1.4; wreck.hp = 0;
    // Bystander traffic + fleeing peds at the intersection corners.
    placeTrafficAt(s, 0, car.x + fx * 26 - rx * 8, car.z + fz * 26 - rz * 8, car.ry + Math.PI / 2, [0.98, 0.78, 0.15]);
    placeTrafficAt(s, 1, car.x - fx * 10 + rx * 10, car.z - fz * 10 + rz * 10, car.ry, [0.4, 0.7, 0.4]);
    const road = BLOCK * 0.5;
    placePedAt(s, 0, road - 10, road - 12, false, road, -10);
    placePedAt(s, 1, road + 10.5, road + 14, false, road, 10.5);
    placePedAt(s, 2, road + 2, road + 22, true, road, 12);
    placePedAt(s, 3, road + 16, road + 4, true, road, -13);
    for (let i = 0; i < 26; i++) out.puffs.push({ x: car.x - fx * 2 + rng.range(-1, 1), y: 0.5, z: car.z - fz * 2 + rng.range(-1, 1), vx: -fx * 2, vy: rng.range(1, 2), vz: -fz * 2, life: 1.6, size: 0.9, color: [0.85, 0.85, 0.88] });
    for (let i = 0; i < 10; i++) out.puffs.push({ x: car.x - rx * 2.2, y: 0.8, z: car.z - rz * 2.2, vx: -rx * 3, vy: 1.5, vz: -rz * 3, life: 0.5, size: 0.3, color: [1, 0.75, 0.25] });
    out.skids = [{ x: car.x - fx * 6, z: car.z - fz * 6, ry: car.ry, len: 9 }, { x: car.x - fx * 10, z: car.z - fz * 10, ry: car.ry + 0.2, len: 8 }];
  }
  if (kind === 'end') {
    const z = s.city.zones.spray;
    p.x = z.x - 10; p.z = z.z + 12;
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
    out.skids = [{ x: z.x - 6, z: z.z + 2, ry: Math.PI / 2, len: 10 }, { x: z.x - 11, z: z.z + 2.6, ry: Math.PI / 2, len: 8 }];
    for (let i = 0; i < 8; i++) out.puffs.push({ x: p.x + Math.sin(s.camYaw) * 0.6, y: 1.5 + i * 0.1, z: p.z + Math.cos(s.camYaw) * 0.6, vx: 0.2, vy: 0.7, vz: 0.1, life: 1.4, size: 0.22, color: [0.8, 0.8, 0.82] });
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
