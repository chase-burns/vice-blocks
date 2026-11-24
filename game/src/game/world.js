// world.js — the city itself: a zoned 5x5 grid of blocks on the coast.
// Downtown towers rise in the middle, the east row stays low against the
// beach, and everything else is mid-rise. The module also owns the named
// districts, the five service zones, and building collision backed by a
// 40 m spatial hash. Pure data and math — no rendering in here.
import { makeRng } from '../rng.js';

export const BLOCK = 46;   // metres, block pitch (road + lot)
export const ROAD = 15;    // metres, road width
export const GRID = 5;     // blocks per side
export const CITY_HALF = (GRID * BLOCK) / 2 + BLOCK;

export function roadCenters() {
  const centers = [];
  for (let i = 0; i <= GRID; i++) centers.push(-GRID * BLOCK / 2 + i * BLOCK);
  return centers;
}

export function isOnRoad(x, z) {
  for (const c of roadCenters()) {
    if (Math.abs(x - c) < ROAD / 2 + 1 || Math.abs(z - c) < ROAD / 2 + 1) return true;
  }
  return false;
}

// Which named district a point belongs to. The harbor claims its circle
// first; after that the city splits by quadrant, downtown in the middle.
export function districtAt(city, x, z) {
  const harbor = city.zones.harbor;
  if ((x - harbor.x) ** 2 + (z - harbor.z) ** 2 < 34 * 34) return 'THE HARBOR';
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

// Maybe hang a pastel shop sign on one face of a building.
function maybeSign(rng, b, signs) {
  if (!rng.chance(0.2)) return;
  const color = SIGN_TINTS[rng.int(0, SIGN_TINTS.length - 1)];
  const face = rng.int(0, 3);
  const sign = {
    x: b.x, z: b.z, y: 0,
    w: rng.range(4, 8), h: rng.range(1.2, 2.2), color, ry: 0,
  };
  sign.y = rng.range(3, Math.min(b.h - 2, 12));
  if (face === 0) { sign.z = b.z - b.d / 2 - 0.15; sign.ry = Math.PI; }
  else if (face === 1) { sign.z = b.z + b.d / 2 + 0.15; sign.ry = 0; }
  else if (face === 2) { sign.x = b.x - b.w / 2 - 0.15; sign.ry = -Math.PI / 2; }
  else { sign.x = b.x + b.w / 2 + 0.15; sign.ry = Math.PI / 2; }
  signs.push(sign);
}

export function genCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const palms = [];
  const lights = [];
  const signs = [];
  const props = [];
  const lot = BLOCK - ROAD;

  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const cx = -GRID * BLOCK / 2 + gx * BLOCK + BLOCK / 2;
      const cz = -GRID * BLOCK / 2 + gz * BLOCK + BLOCK / 2;
      const downtown = (gx === 2 && gz >= 1 && gz <= 3) || (gx === 1 && gz === 2) || (gx === 3 && gz === 2);
      const beachfront = gx === GRID - 1;
      // A block holds either one centred building or a diagonal pair.
      const pair = rng.chance(0.45);
      const footprints = pair ? [[-lot / 4, -lot / 4], [lot / 4, lot / 4]] : [[0, 0]];
      for (const [ox, oz] of footprints) {
        const spanLo = lot * (pair ? 0.34 : 0.55);
        const spanHi = lot * (pair ? 0.44 : 0.8);
        const w = rng.range(spanLo, spanHi);
        const d = rng.range(spanLo, spanHi);
        const h = downtown ? rng.range(70, 110) : beachfront ? rng.range(12, 30) : rng.range(20, 60);
        const b = {
          x: cx + ox, z: cz + oz, w, d, h,
          color: BUILDING_TINTS[rng.int(0, BUILDING_TINTS.length - 1)],
          tex: rng.int(0, 3),
          seed: rng.int(0, 9999),
        };
        buildings.push(b);
        maybeSign(rng, b, signs);
      }
      // Corners get a palm most of the time, a street light otherwise.
      const e = lot / 2 + 2.2;
      for (const [ox, oz] of [[-e, -e], [e, -e], [-e, e], [e, e]]) {
        if (rng.chance(0.78)) {
          palms.push({ x: cx + ox, z: cz + oz, s: rng.range(0.85, 1.45), lean: rng.range(-0.12, 0.12) });
        } else if (rng.chance(0.6)) {
          lights.push({ x: cx + ox, z: cz + oz });
        }
      }
    }
  }

  // Two loose palm rows along the east promenade.
  for (let z = -CITY_HALF + 4; z < CITY_HALF - 2; z += 11) {
    palms.push({ x: CITY_HALF - 3.5, z: z + rng.range(-1.5, 1.5), s: rng.range(1.0, 1.5), lean: rng.range(-0.1, 0.16) });
    if (rng.chance(0.6)) {
      palms.push({ x: CITY_HALF - 9, z: z + 5 + rng.range(-1, 1), s: rng.range(0.9, 1.3), lean: rng.range(-0.14, 0.1) });
    }
  }

  // Street props scattered on sidewalks.
  const centers = roadCenters();
  for (let i = 0; i < 90; i++) {
    const road = centers[rng.int(0, centers.length - 1)];
    const horiz = rng.chance(0.5);
    const along = rng.range(-CITY_HALF + 6, CITY_HALF - 6);
    const side = (rng.chance(0.5) ? 1 : -1) * rng.range(8.8, 10.8);
    props.push({
      x: horiz ? along : road + side,
      z: horiz ? road + side : along,
      kind: rng.pick(PROP_KINDS),
      ry: rng.range(0, Math.PI),
      color: BUILDING_TINTS[rng.int(0, BUILDING_TINTS.length - 1)],
    });
  }

  // Spatial hash of building colliders, cell size 40 m. Each building is
  // registered into its own cell and the eight neighbours so radius
  // queries near a border never miss it.
  const hash = new Map();
  const cellKey = (cx, cz) => cx + ',' + cz;
  for (const b of buildings) {
    const cx = Math.floor(b.x / 40);
    const cz = Math.floor(b.z / 40);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const k = cellKey(ix, iz);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push(b);
      }
    }
  }

  const city = { buildings, palms, lights, signs, props, zones: makeZones(), seed, hash };
  city.getCollidersInRadius = (x, z, r) => {
    const found = new Set();
    const cx = Math.floor(x / 40);
    const cz = Math.floor(z / 40);
    const span = Math.ceil(r / 40) + 1;
    for (let ix = cx - span; ix <= cx + span; ix++) {
      for (let iz = cz - span; iz <= cz + span; iz++) {
        const cell = hash.get(cellKey(ix, iz));
        if (cell) for (const b of cell) found.add(b);
      }
    }
    return [...found];
  };
  return city;
}

// Push a point (with radius r) out of every building AABB it overlaps,
// resolving along whichever axis penetrates least, then clamp to the
// playable bounds. Returns the corrected [x, z].
export function collideBuildings(city, x, z, r) {
  let px = x;
  let pz = z;
  const nearby = city.getCollidersInRadius
    ? city.getCollidersInRadius(x, z, r + 26)
    : city.buildings;
  for (const b of nearby) {
    const hw = b.w / 2 + r;
    const hd = b.d / 2 + r;
    const dx = px - b.x;
    const dz = pz - b.z;
    if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
    const pushX = hw - Math.abs(dx);
    const pushZ = hd - Math.abs(dz);
    if (pushX < pushZ) px = b.x + (dx >= 0 ? hw : -hw);
    else pz = b.z + (dz >= 0 ? hd : -hd);
  }
  const lim = CITY_HALF + 30;
  px = Math.max(-lim, Math.min(lim, px));
  pz = Math.max(-lim, Math.min(lim, pz));
  return [px, pz];
}
