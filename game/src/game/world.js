// world.js — the city as data rather than pixels. A zoned 5x5 grid of
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
  const lines = [];
  for (let i = 0; i <= GRID; i++) lines.push(-GRID * BLOCK / 2 + i * BLOCK);
  return lines;
}

export function isOnRoad(x, z) {
  for (const c of roadCenters()) {
    if (Math.abs(x - c) < ROAD / 2 + 1) return true;
    if (Math.abs(z - c) < ROAD / 2 + 1) return true;
  }
  return false;
}

// District lookup: the harbour circle wins first, then the outer
// quadrants, and downtown keeps whatever remains in the middle.
export function districtAt(city, x, z) {
  const port = city.zones.harbor;
  const dx = x - port.x, dz = z - port.z;
  if (dx * dx + dz * dz < 34 * 34) return 'THE HARBOR';
  if (x > 55) return 'OCEAN DRIVE';
  if (z < -55) return 'SOLMAR BAY';
  if (x < -55) return 'PALM HEIGHTS';
  if (z > 55) return 'NORTH BEACH';
  return 'DOWNTOWN';
}

const BUILDING_PALETTE = [
  [0.96, 0.55, 0.75], [0.45, 0.85, 0.95], [0.98, 0.80, 0.45], [0.70, 0.60, 0.95],
  [0.55, 0.95, 0.70], [0.95, 0.65, 0.50], [0.85, 0.90, 0.98], [0.60, 0.75, 0.90],
];
const SIGN_PALETTE = [
  [0.98, 0.62, 0.50], [0.85, 0.93, 0.98], [0.98, 0.85, 0.60], [0.75, 0.90, 0.80], [0.96, 0.75, 0.82],
];
const PROP_KINDS = ['bin', 'bin', 'barrier', 'hydrant', 'crate'];

function makeZones() {
  return {
    gunshop: { x: -BLOCK * 1.5, z: -BLOCK * 0.5, r: 7, label: 'AMMU-NATION', color: [1, 0.3, 0.25] },
    hospital: { x: BLOCK * 1.5, z: BLOCK * 0.5, r: 8, label: 'HOSPITAL', color: [1, 1, 1] },
    spray: { x: BLOCK * 0.5, z: -BLOCK * 1.5, r: 7, label: "PAY 'N SPRAY", color: [0.3, 1, 0.6] },
    contact: { x: -BLOCK * 0.5, z: BLOCK * 1.5, r: 6, label: 'CONTACT', color: [1, 0.3, 0.7] },
    harbor: { x: BLOCK * 2.0, z: BLOCK * 1.5, r: 7, label: 'HARBOR', color: [0.4, 0.8, 1] },
  };
}

// Roughly one building in five earns a pastel sign panel on a random face.
function attachSign(rng, b, signs) {
  if (!rng.chance(0.2)) return;
  const panel = { x: b.x, z: b.z, y: 0, w: rng.range(4, 8), h: rng.range(1.2, 2.2), color: SIGN_PALETTE[rng.int(0, SIGN_PALETTE.length - 1)], ry: 0 };
  panel.y = rng.range(3, Math.min(b.h - 2, 12));
  const face = rng.int(0, 3);
  if (face === 0) { panel.z = b.z - b.d / 2 - 0.15; panel.ry = Math.PI; }
  else if (face === 1) { panel.z = b.z + b.d / 2 + 0.15; panel.ry = 0; }
  else if (face === 2) { panel.x = b.x - b.w / 2 - 0.15; panel.ry = -Math.PI / 2; }
  else { panel.x = b.x + b.w / 2 + 0.15; panel.ry = Math.PI / 2; }
  signs.push(panel);
}

export function genCity(seed) {
  const rng = makeRng(seed);
  const buildings = [], palms = [], lights = [], signs = [], props = [];
  const lot = BLOCK - ROAD;
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) {
    const centreX = -GRID * BLOCK / 2 + gx * BLOCK + BLOCK / 2;
    const centreZ = -GRID * BLOCK / 2 + gz * BLOCK + BLOCK / 2;
    const downtown = (gx === 2 && gz >= 1 && gz <= 3) || (gx === 1 && gz === 2) || (gx === 3 && gz === 2);
    const beachfront = gx === GRID - 1;
    const pair = rng.chance(0.45);
    const placements = pair ? [[-lot / 4, -lot / 4], [lot / 4, lot / 4]] : [[0, 0]];
    for (const off of placements) {
      const lo = lot * (pair ? 0.34 : 0.55), hi = lot * (pair ? 0.44 : 0.8);
      const b = {
        x: centreX + off[0], z: centreZ + off[1],
        w: rng.range(lo, hi), d: rng.range(lo, hi),
        h: downtown ? rng.range(70, 110) : beachfront ? rng.range(12, 30) : rng.range(20, 60),
        color: BUILDING_PALETTE[rng.int(0, BUILDING_PALETTE.length - 1)], tex: rng.int(0, 3), seed: rng.int(0, 9999),
      };
      buildings.push(b); attachSign(rng, b, signs);
    }
    const cornerDist = lot / 2 + 2.2;
    for (const corner of [[-cornerDist, -cornerDist], [cornerDist, -cornerDist], [-cornerDist, cornerDist], [cornerDist, cornerDist]]) {
      if (rng.chance(0.78)) palms.push({ x: centreX + corner[0], z: centreZ + corner[1], s: rng.range(0.85, 1.45), lean: rng.range(-0.12, 0.12) });
      else if (rng.chance(0.6)) lights.push({ x: centreX + corner[0], z: centreZ + corner[1] });
    }
  }
  for (let z = -CITY_HALF + 4; z < CITY_HALF - 2; z += 11) {
    palms.push({ x: CITY_HALF - 3.5, z: z + rng.range(-1.5, 1.5), s: rng.range(1.0, 1.5), lean: rng.range(-0.1, 0.16) });
    if (rng.chance(0.6)) palms.push({ x: CITY_HALF - 9, z: z + 5 + rng.range(-1, 1), s: rng.range(0.9, 1.3), lean: rng.range(-0.14, 0.1) });
  }
  const lines = roadCenters();
  for (let i = 0; i < 90; i++) {
    const roadLine = lines[rng.int(0, lines.length - 1)];
    const horizontal = rng.chance(0.5);
    const along = rng.range(-CITY_HALF + 6, CITY_HALF - 6);
    const sideOff = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.8);
    props.push({ x: horizontal ? along : roadLine + sideOff, z: horizontal ? roadLine + sideOff : along, kind: rng.pick(PROP_KINDS), ry: rng.range(0, Math.PI), color: BUILDING_PALETTE[rng.int(0, BUILDING_PALETTE.length - 1)] });
  }
  // Register every building in its own 40 m cell and all eight
  // neighbours, so a radius query near a cell border can never miss a
  // collider.
  const hash = new Map();
  const keyOf = (cx, cz) => cx + ',' + cz;
  for (const b of buildings) {
    const cellX = Math.floor(b.x / 40), cellZ = Math.floor(b.z / 40);
    for (let ix = cellX - 1; ix <= cellX + 1; ix++) for (let iz = cellZ - 1; iz <= cellZ + 1; iz++) {
      const k = keyOf(ix, iz);
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k).push(b);
    }
  }
  const city = { buildings, palms, lights, signs, props, zones: makeZones(), seed, hash };
  city.getCollidersInRadius = function (x, z, r) {
    const collected = new Set();
    const cellX = Math.floor(x / 40), cellZ = Math.floor(z / 40);
    const span = Math.ceil(r / 40) + 1;
    for (let ix = cellX - span; ix <= cellX + span; ix++) for (let iz = cellZ - span; iz <= cellZ + span; iz++) {
      const cell = hash.get(keyOf(ix, iz));
      if (cell) for (const b of cell) collected.add(b);
    }
    return Array.from(collected);
  };
  return city;
}

// Push a point of radius r out of any building AABB it overlaps, along
// the axis of least penetration, then clamp to the playable bounds.
export function collideBuildings(city, x, z, r) {
  let px = x, pz = z;
  const nearby = city.getCollidersInRadius ? city.getCollidersInRadius(x, z, r + 26) : city.buildings;
  for (const b of nearby) {
    const halfW = b.w / 2 + r, halfD = b.d / 2 + r;
    const dx = px - b.x, dz = pz - b.z;
    if (Math.abs(dx) >= halfW || Math.abs(dz) >= halfD) continue;
    const penX = halfW - Math.abs(dx), penZ = halfD - Math.abs(dz);
    if (penX < penZ) px = b.x + (dx >= 0 ? halfW : -halfW);
    else pz = b.z + (dz >= 0 ? halfD : -halfD);
  }
  const bound = CITY_HALF + 30;
  if (px < -bound) px = -bound; if (px > bound) px = bound;
  if (pz < -bound) pz = -bound; if (pz > bound) pz = bound;
  return [px, pz];
}
