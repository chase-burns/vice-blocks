// Procedural coastal city (WO Task 4): zoned grid — downtown towers in the
// centre, beach + ocean on the east flank, service facilities, street props,
// and a 40 m spatial hash of static AABB colliders.
import { makeRng } from '../rng.js';

export const BLOCK = 46;
export const ROAD = 15;
export const GRID = 5;
export const CITY_HALF = (GRID * BLOCK) / 2 + BLOCK;

export function roadCenters() {
  const out = [];
  for (let i = 0; i <= GRID; i++) out.push(-GRID * BLOCK / 2 + i * BLOCK);
  return out;
}
export function isOnRoad(x, z) {
  const c = roadCenters();
  for (const r of c) if (Math.abs(x - r) < ROAD / 2 + 1 || Math.abs(z - r) < ROAD / 2 + 1) return true;
  return false;
}

const PALETTE = [
  [0.96, 0.55, 0.75], [0.45, 0.85, 0.95], [0.98, 0.80, 0.45], [0.70, 0.60, 0.95],
  [0.55, 0.95, 0.70], [0.95, 0.65, 0.50], [0.85, 0.90, 0.98], [0.60, 0.75, 0.90],
];
const NEON = [ // pastel shopfront signs (kept sparse, mostly unlit paint)
  [0.98, 0.62, 0.50], [0.85, 0.93, 0.98], [0.98, 0.85, 0.60], [0.75, 0.90, 0.80], [0.96, 0.75, 0.82],
];

export function genCity(seed) {
  const rng = makeRng(seed);
  const buildings = [], palms = [], lights = [], signs = [], props = [];
  const lot = BLOCK - ROAD;
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const cx = -GRID * BLOCK / 2 + gx * BLOCK + BLOCK / 2;
      const cz = -GRID * BLOCK / 2 + gz * BLOCK + BLOCK / 2;
      // Zoning: downtown centre towers 70-110 m, beachfront east lower, else 20-60.
      const downtown = (gx === 2 && gz >= 1 && gz <= 3) || (gx === 1 && gz === 2) || (gx === 3 && gz === 2);
      const beach = gx === GRID - 1;
      const two = rng.chance(0.45);
      const spots = two ? [[-lot / 4, -lot / 4], [lot / 4, lot / 4]] : [[0, 0]];
      for (const [ox, oz] of spots) {
        const w = rng.range(lot * (two ? 0.34 : 0.55), lot * (two ? 0.44 : 0.8));
        const d = rng.range(lot * (two ? 0.34 : 0.55), lot * (two ? 0.44 : 0.8));
        const h = downtown ? rng.range(70, 110) : beach ? rng.range(12, 30) : rng.range(20, 60);
        const b = { x: cx + ox, z: cz + oz, w, d, h, color: PALETTE[rng.int(0, PALETTE.length - 1)], tex: rng.int(0, 3), seed: rng.int(0, 9999) };
        buildings.push(b);
        if (rng.chance(0.2)) {
          const col = NEON[rng.int(0, NEON.length - 1)];
          const face = rng.int(0, 3);
          const sw = rng.range(4, 8), sh = rng.range(1.2, 2.2), sy = rng.range(3, Math.min(h - 2, 12));
          let sx = b.x, sz = b.z, ry = 0;
          if (face === 0) { sz = b.z - d / 2 - 0.15; ry = Math.PI; }
          if (face === 1) { sz = b.z + d / 2 + 0.15; ry = 0; }
          if (face === 2) { sx = b.x - w / 2 - 0.15; ry = -Math.PI / 2; }
          if (face === 3) { sx = b.x + w / 2 + 0.15; ry = Math.PI / 2; }
          signs.push({ x: sx, z: sz, y: sy, w: sw, h: sh, color: col, ry });
        }
      }
      const e = lot / 2 + 2.2;
      for (const [ox, oz] of [[-e, -e], [e, -e], [-e, e], [e, e]]) {
        if (rng.chance(0.78)) palms.push({ x: cx + ox, z: cz + oz, s: rng.range(0.85, 1.45), lean: rng.range(-0.12, 0.12) });
        else if (rng.chance(0.6)) lights.push({ x: cx + ox, z: cz + oz });
      }
    }
  }
  // Beachfront palm rows along the east promenade.
  for (let z = -CITY_HALF + 4; z < CITY_HALF - 2; z += 11) {
    palms.push({ x: CITY_HALF - 3.5, z: z + rng.range(-1.5, 1.5), s: rng.range(1.0, 1.5), lean: rng.range(-0.1, 0.16) });
    if (rng.chance(0.6)) palms.push({ x: CITY_HALF - 9, z: z + 5 + rng.range(-1, 1), s: rng.range(0.9, 1.3), lean: rng.range(-0.14, 0.1) });
  }
  const centers = roadCenters();
  for (let i = 0; i < 90; i++) {
    const road = centers[rng.int(0, centers.length - 1)];
    const horiz = rng.chance(0.5);
    const t = rng.range(-CITY_HALF + 6, CITY_HALF - 6);
    const side = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.8);
    props.push({ x: horiz ? t : road + side, z: horiz ? road + side : t, kind: rng.pick(['bin', 'bin', 'barrier', 'hydrant', 'crate']), ry: rng.range(0, Math.PI), color: PALETTE[rng.int(0, PALETTE.length - 1)] });
  }
  const zones = {
    gunshop: { x: -BLOCK * 1.5, z: -BLOCK * 0.5, r: 7, label: 'AMMU-NATION', color: [1, 0.3, 0.25] },
    hospital: { x: BLOCK * 1.5, z: BLOCK * 0.5, r: 8, label: 'HOSPITAL', color: [1, 1, 1] },
    spray: { x: BLOCK * 0.5, z: -BLOCK * 1.5, r: 7, label: "PAY 'N SPRAY", color: [0.3, 1, 0.6] },
    contact: { x: -BLOCK * 0.5, z: BLOCK * 1.5, r: 6, label: 'CONTACT', color: [1, 0.3, 0.7] },
    harbor: { x: BLOCK * 2.0, z: BLOCK * 1.5, r: 7, label: 'HARBOR', color: [0.4, 0.8, 1] },
  };
  // Spatial hash (cell 40 m) of static building colliders.
  const hash = new Map();
  const key = (cx, cz) => cx + ',' + cz;
  for (const b of buildings) {
    const cx = Math.floor(b.x / 40), cz = Math.floor(b.z / 40);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const k = key(ix, iz);
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k).push(b);
    }
  }
  const city = { buildings, palms, lights, signs, props, zones, seed, hash };
  city.getCollidersInRadius = (x, z, r) => {
    const out = new Set();
    const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
    const span = Math.ceil(r / 40) + 1;
    for (let ix = cx - span; ix <= cx + span; ix++) for (let iz = cz - span; iz <= cz + span; iz++) {
      const cell = hash.get(key(ix, iz));
      if (cell) for (const b of cell) out.add(b);
    }
    return [...out];
  };
  return city;
}

export function collideBuildings(city, x, z, r) {
  let px = x, pz = z;
  const near = city.getCollidersInRadius ? city.getCollidersInRadius(x, z, r + 26) : city.buildings;
  for (const b of near) {
    const hw = b.w / 2 + r, hd = b.d / 2 + r;
    const dx = px - b.x, dz = pz - b.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const ox = hw - Math.abs(dx), oz = hd - Math.abs(dz);
      if (ox < oz) px = b.x + (dx >= 0 ? hw : -hw);
      else pz = b.z + (dz >= 0 ? hd : -hd);
    }
  }
  const lim = CITY_HALF + 30;
  px = Math.max(-lim, Math.min(lim, px));
  pz = Math.max(-lim, Math.min(lim, pz));
  return [px, pz];
}
