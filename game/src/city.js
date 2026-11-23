// Procedural city layout. Pure data generation: grid roads, building blocks,
// palm trees, street lights, neon signs and special zones. No DOM, no WebGL.
import { makeRng } from './rng.js';

export const BLOCK = 46;          // block pitch (road + lot)
export const ROAD = 15;           // road width
export const GRID = 5;            // blocks per side (GRID x GRID lots, roads between)
export const CITY_HALF = (GRID * BLOCK) / 2 + BLOCK; // world extent

// Road centre lines sit at multiples of BLOCK offset by -CITY_HALF + BLOCK/2 ...
export function roadCenters() {
  const out = [];
  for (let i = 0; i <= GRID; i++) out.push(-GRID * BLOCK / 2 + i * BLOCK);
  return out; // coordinates where roads run (both axes)
}
export function isOnRoad(x, z) {
  const c = roadCenters();
  for (const r of c) if (Math.abs(x - r) < ROAD / 2 + 1 || Math.abs(z - r) < ROAD / 2 + 1) return true;
  return false;
}
// Lane offset for right-hand traffic on a road running along axis at centre c.
export function lanePos(c, dir) { return c + dir * (ROAD / 4); }

const PALETTE = [
  [0.96, 0.55, 0.75], [0.45, 0.85, 0.95], [0.98, 0.80, 0.45], [0.70, 0.60, 0.95],
  [0.55, 0.95, 0.70], [0.95, 0.65, 0.50], [0.85, 0.90, 0.98], [0.60, 0.75, 0.90],
];
const NEON = [
  [1.0, 0.25, 0.65], [0.2, 0.95, 1.0], [1.0, 0.85, 0.2], [0.55, 0.35, 1.0], [0.3, 1.0, 0.55],
];

export function genCity(seed) {
  const rng = makeRng(seed);
  const buildings = []; // {x,z,w,d,h,color,tex,neon?}
  const palms = [];     // {x,z,s,lean}
  const lights = [];    // {x,z}
  const signs = [];     // {x,z,y,w,h,color,ry}
  const lot = BLOCK - ROAD;
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const cx = -GRID * BLOCK / 2 + gx * BLOCK + BLOCK / 2;
      const cz = -GRID * BLOCK / 2 + gz * BLOCK + BLOCK / 2;
      // 1-2 buildings per lot
      const two = rng.chance(0.45);
      const spots = two
        ? [[-lot / 4, -lot / 4], [lot / 4, lot / 4]]
        : [[0, 0]];
      for (const [ox, oz] of spots) {
        const w = rng.range(lot * (two ? 0.34 : 0.55), lot * (two ? 0.44 : 0.8));
        const d = rng.range(lot * (two ? 0.34 : 0.55), lot * (two ? 0.44 : 0.8));
        const h = rng.range(10, 46) * (rng.chance(0.18) ? 1.7 : 1);
        const b = {
          x: cx + ox, z: cz + oz, w, d, h,
          color: PALETTE[rng.int(0, PALETTE.length - 1)],
          tex: rng.int(0, 3),
          seed: rng.int(0, 9999),
        };
        buildings.push(b);
        if (rng.chance(0.5)) { // neon sign on a street face
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
      // palms + lights along the lot corners (sidewalk edge)
      const e = lot / 2 + 2.2;
      for (const [ox, oz] of [[-e, -e], [e, -e], [-e, e], [e, e]]) {
        if (rng.chance(0.55)) palms.push({ x: cx + ox, z: cz + oz, s: rng.range(0.8, 1.3), lean: rng.range(-0.12, 0.12) });
        else if (rng.chance(0.6)) lights.push({ x: cx + ox, z: cz + oz });
      }
    }
  }
  // Street props for density: bins, barriers, hydrants, crates along sidewalks.
  const props = [];
  const centers2 = roadCenters();
  for (let i = 0; i < 90; i++) {
    const road = centers2[rng.int(0, centers2.length - 1)];
    const horiz = rng.chance(0.5);
    const t = rng.range(-CITY_HALF + 6, CITY_HALF - 6);
    const side = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.8);
    const kind = rng.pick(['bin', 'bin', 'barrier', 'hydrant', 'crate']);
    props.push({ x: horiz ? t : road + side, z: horiz ? road + side : t, kind, ry: rng.range(0, Math.PI), color: PALETTE[rng.int(0, PALETTE.length - 1)] });
  }
  // Special zones pinned to fixed lots so missions are stable across seeds.
  const zones = {
    gunshop: { x: -BLOCK * 1.5, z: -BLOCK * 0.5, r: 7, label: 'GUN SHOP', color: [1, 0.6, 0.2] },
    hospital: { x: BLOCK * 1.5, z: BLOCK * 0.5, r: 8, label: 'HOSPITAL', color: [1, 1, 1] },
    spray: { x: BLOCK * 0.5, z: -BLOCK * 1.5, r: 7, label: "PAY 'N SPRAY", color: [0.3, 1, 0.6] },
    contact: { x: -BLOCK * 0.5, z: BLOCK * 1.5, r: 6, label: 'CONTACT', color: [1, 0.3, 0.7] },
  };
  return { buildings, palms, lights, signs, zones, props, seed };
}

// Building collision: circle vs AABB, returns push-out or null.
export function collideBuildings(city, x, z, r) {
  let px = x, pz = z;
  for (const b of city.buildings) {
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
