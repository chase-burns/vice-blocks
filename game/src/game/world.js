// world.js — the city described as data, not pixels. A zoned 5x5 grid of
// blocks sits against the coast: tall towers downtown in the middle, a
// low row along the eastern beach, mid-rise blocks everywhere else. This
// module also names the districts, lays out five service zones, and
// answers building-collision queries through a 40 m spatial hash.
import { makeRng } from '../rng.js';

export const BLOCK = 46;
export const ROAD = 15;
export const GRID = 5;
export const CITY_HALF = (GRID * BLOCK) / 2 + BLOCK;

export function roadCenters() {
  const centers = [];
  for (let i = 0; i <= GRID; i++) centers.push(-GRID * BLOCK / 2 + i * BLOCK);
  return centers;
}

export function isOnRoad(x, z) {
  for (const c of roadCenters()) {
    if (Math.abs(x - c) < ROAD / 2 + 1) return true;
    if (Math.abs(z - c) < ROAD / 2 + 1) return true;
  }
  return false;
}

// District lookup: the harbour circle wins first, then the outer
// quadrants, and downtown keeps whatever is left in the middle.
export function districtAt(city, x, z) {
  const harbour = city.zones.harbor;
  const dx = x - harbour.x, dz = z - harbour.z;
  if (dx * dx + dz * dz < 34 * 34) return 'THE HARBOR';
  if (x > 55) return 'OCEAN DRIVE';
  if (z < -55) return 'SOLMAR BAY';
  if (x < -55) return 'PALM HEIGHTS';
  if (z > 55) return 'NORTH BEACH';
  return 'DOWNTOWN';
}

const BUILDING_TINTS = [
  [0.96, 0.55, 0.75], [0.45, 0.85, 0.95], [0.98, 0.80, 0.45], [0.70, 0.60, 0.95],
  [0.55, 0.95, 0.70], [0.95, 0.65, 0.50], [0.85, 0.90, 0.98], [0.60, 0.75, 0.90],
];
const SIGN_TINTS = [
  [0.98, 0.62, 0.50], [0.85, 0.93, 0.98], [0.98, 0.85, 0.60], [0.75, 0.90, 0.80], [0.96, 0.75, 0.82],
];
const STREET_PROP_KINDS = ['bin', 'bin', 'barrier', 'hydrant', 'crate'];

function buildZones() {
  return {
    gunshop: { x: -BLOCK * 1.5, z: -BLOCK * 0.5, r: 7, label: 'AMMU-NATION', color: [1, 0.3, 0.25] },
    hospital: { x: BLOCK * 1.5, z: BLOCK * 0.5, r: 8, label: 'HOSPITAL', color: [1, 1, 1] },
    spray: { x: BLOCK * 0.5, z: -BLOCK * 1.5, r: 7, label: "PAY 'N SPRAY", color: [0.3, 1, 0.6] },
    contact: { x: -BLOCK * 0.5, z: BLOCK * 1.5, r: 6, label: 'CONTACT', color: [1, 0.3, 0.7] },
    harbor: { x: BLOCK * 2.0, z: BLOCK * 1.5, r: 7, label: 'HARBOR', color: [0.4, 0.8, 1] },
  };
}

// About one building in five gets a pastel sign panel on a random face.
function maybeAddSign(rng, b, signs) {
  if (!rng.chance(0.2)) return;
  const sign = { x: b.x, z: b.z, y: 0, w: rng.range(4, 8), h: rng.range(1.2, 2.2), color: SIGN_TINTS[rng.int(0, SIGN_TINTS.length - 1)], ry: 0 };
  sign.y = rng.range(3, Math.min(b.h - 2, 12));
  const face = rng.int(0, 3);
  if (face === 0) { sign.z = b.z - b.d / 2 - 0.15; sign.ry = Math.PI; }
  else if (face === 1) { sign.z = b.z + b.d / 2 + 0.15; sign.ry = 0; }
  else if (face === 2) { sign.x = b.x - b.w / 2 - 0.15; sign.ry = -Math.PI / 2; }
  else { sign.x = b.x + b.w / 2 + 0.15; sign.ry = Math.PI / 2; }
  signs.push(sign);
}

export function genCity(seed) {
  const rng = makeRng(seed);
  const buildings = [], palms = [], lights = [], signs = [], props = [];
  const lotSize = BLOCK - ROAD;
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) {
    const cx = -GRID * BLOCK / 2 + gx * BLOCK + BLOCK / 2;
    const cz = -GRID * BLOCK / 2 + gz * BLOCK + BLOCK / 2;
    const isDowntown = (gx === 2 && gz >= 1 && gz <= 3) || (gx === 1 && gz === 2) || (gx === 3 && gz === 2);
    const isBeachfront = gx === GRID - 1;
    const twoBuildings = rng.chance(0.45);
    const offsets = twoBuildings ? [[-lotSize / 4, -lotSize / 4], [lotSize / 4, lotSize / 4]] : [[0, 0]];
    for (const off of offsets) {
      const lo = lotSize * (twoBuildings ? 0.34 : 0.55), hi = lotSize * (twoBuildings ? 0.44 : 0.8);
      const b = {
        x: cx + off[0], z: cz + off[1],
        w: rng.range(lo, hi), d: rng.range(lo, hi),
        h: isDowntown ? rng.range(70, 110) : isBeachfront ? rng.range(12, 30) : rng.range(20, 60),
        color: BUILDING_TINTS[rng.int(0, BUILDING_TINTS.length - 1)], tex: rng.int(0, 3), seed: rng.int(0, 9999),
      };
      buildings.push(b); maybeAddSign(rng, b, signs);
    }
    const cornerOff = lotSize / 2 + 2.2;
    for (const corner of [[-cornerOff, -cornerOff], [cornerOff, -cornerOff], [-cornerOff, cornerOff], [cornerOff, cornerOff]]) {
      if (rng.chance(0.78)) palms.push({ x: cx + corner[0], z: cz + corner[1], s: rng.range(0.85, 1.45), lean: rng.range(-0.12, 0.12) });
      else if (rng.chance(0.6)) lights.push({ x: cx + corner[0], z: cz + corner[1] });
    }
  }
  for (let z = -CITY_HALF + 4; z < CITY_HALF - 2; z += 11) {
    palms.push({ x: CITY_HALF - 3.5, z: z + rng.range(-1.5, 1.5), s: rng.range(1.0, 1.5), lean: rng.range(-0.1, 0.16) });
    if (rng.chance(0.6)) palms.push({ x: CITY_HALF - 9, z: z + 5 + rng.range(-1, 1), s: rng.range(0.9, 1.3), lean: rng.range(-0.14, 0.1) });
  }
  const centers = roadCenters();
  for (let i = 0; i < 90; i++) {
    const roadLine = centers[rng.int(0, centers.length - 1)];
    const horizontal = rng.chance(0.5);
    const along = rng.range(-CITY_HALF + 6, CITY_HALF - 6);
    const sideOff = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.8);
    props.push({ x: horizontal ? along : roadLine + sideOff, z: horizontal ? roadLine + sideOff : along, kind: rng.pick(STREET_PROP_KINDS), ry: rng.range(0, Math.PI), color: BUILDING_TINTS[rng.int(0, BUILDING_TINTS.length - 1)] });
  }
  // File every building into its own 40 m cell plus all eight neighbours,
  // so a radius query near a cell border can never miss a collider.
  const hash = new Map();
  const cellKey = (cx, cz) => cx + ',' + cz;
  for (const b of buildings) {
    const bcx = Math.floor(b.x / 40), bcz = Math.floor(b.z / 40);
    for (let ix = bcx - 1; ix <= bcx + 1; ix++) for (let iz = bcz - 1; iz <= bcz + 1; iz++) {
      const k = cellKey(ix, iz);
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k).push(b);
    }
  }
  const city = { buildings, palms, lights, signs, props, zones: buildZones(), seed, hash };
  city.getCollidersInRadius = function (x, z, r) {
    const found = new Set();
    const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
    const span = Math.ceil(r / 40) + 1;
    for (let ix = cx - span; ix <= cx + span; ix++) for (let iz = cz - span; iz <= cz + span; iz++) {
      const cell = hash.get(cellKey(ix, iz));
      if (cell) for (const b of cell) found.add(b);
    }
    return Array.from(found);
  };
  return city;
}

// Shove a point of radius r out of any building AABB it overlaps, along
// whichever axis penetrates least, then clamp to the playable bounds.
export function collideBuildings(city, x, z, r) {
  let px = x, pz = z;
  const candidates = city.getCollidersInRadius ? city.getCollidersInRadius(x, z, r + 26) : city.buildings;
  for (const b of candidates) {
    const hw = b.w / 2 + r, hd = b.d / 2 + r;
    const dx = px - b.x, dz = pz - b.z;
    if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
    const pushX = hw - Math.abs(dx), pushZ = hd - Math.abs(dz);
    if (pushX < pushZ) px = b.x + (dx >= 0 ? hw : -hw);
    else pz = b.z + (dz >= 0 ? hd : -hd);
  }
  const limit = CITY_HALF + 30;
  if (px < -limit) px = -limit; if (px > limit) px = limit;
  if (pz < -limit) pz = -limit; if (pz > limit) pz = limit;
  return [px, pz];
}
