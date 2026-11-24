// world.js — procedural city generation. A square grid of avenues
// spaced PITCH apart; the blocks between them hold pastel Art Deco
// towers, and the east edge gives way to sand and water. Everything is
// placed from the seeded stream so a seed always builds the same city.

export const ROAD = 13;
export const BLOCK = 33;
export const PITCH = ROAD + BLOCK;
export const CITY_HALF = PITCH * 3 + PITCH / 2;

export function roadCenters() {
  const out = [];
  for (let k = -3; k <= 3; k++) out.push(k * PITCH);
  return out;
}

const PROP_KINDS = ['bin', 'barrier', 'hydrant', 'crate'];
const CRATE_COLORS = [[0.72, 0.55, 0.32], [0.4, 0.55, 0.62], [0.68, 0.42, 0.38], [0.5, 0.6, 0.42]];
const SIGN_COLORS = [[1, 0.45, 0.6], [0.4, 0.9, 1], [1, 0.75, 0.3], [0.55, 1, 0.6], [1, 0.55, 0.3]];

export function createCity(rng) {
  const centers = roadCenters();
  const buildings = [];
  const palms = [];
  const lights = [];
  const props = [];
  const signs = [];

  // Towers: one or two per block cell, inset from the road edges so
  // the avenues stay clear. Heights swell toward the middle of town.
  for (let i = 0; i < centers.length - 1; i++) {
    for (let j = 0; j < centers.length - 1; j++) {
      const cx = centers[i] + PITCH / 2;
      const cz = centers[j] + PITCH / 2;
      if (rng.chance(0.10)) continue; // the odd empty lot
      const centrality = 1 - Math.min(1, Math.hypot(cx, cz) / (CITY_HALF * 1.15));
      const mkTower = (ox, oz, maxW) => {
        const w = rng.range(15, maxW);
        const d = rng.range(15, maxW);
        const h = rng.range(9, 20) + centrality * rng.range(8, 30);
        buildings.push({ x: cx + ox, z: cz + oz, w, d, h, tex: rng.int(0, 3) });
      };
      if (rng.chance(0.35)) {
        mkTower(-8, -8, 13);
        mkTower(8, 8, 13);
      } else {
        mkTower(0, 0, 27);
      }
      // A neon sign on a random face of some towers.
      if (rng.chance(0.30)) {
        const b = buildings[buildings.length - 1];
        signs.push({
          x: b.x, y: b.h * rng.range(0.45, 0.7), z: b.z + b.d / 2 + 0.2,
          ry: 0, w: rng.range(3, 6), h: rng.range(1.2, 2.2),
          color: SIGN_COLORS[rng.int(0, SIGN_COLORS.length - 1)],
        });
      }
    }
  }

  // Palms: a row down the beach and clusters at avenue corners,
  // always kept off the carriageway itself.
  for (let z = -CITY_HALF; z <= CITY_HALF; z += rng.range(9, 15)) {
    palms.push({ x: CITY_HALF + rng.range(10, 22), z, s: rng.range(0.85, 1.25), lean: rng.range(0.05, 0.22) });
  }
  for (const cx of centers) {
    for (const cz of centers) {
      if (rng.chance(0.55)) {
        palms.push({
          x: cx + (ROAD / 2 + 1.7) * (rng.chance(0.5) ? 1 : -1),
          z: cz + (ROAD / 2 + 1.7) * (rng.chance(0.5) ? 1 : -1),
          s: rng.range(0.8, 1.15), lean: rng.range(0.05, 0.18),
        });
      }
    }
  }

  // Streetlights staggered along both kerbs of every avenue.
  for (const c of centers) {
    for (let t = -CITY_HALF + 12; t < CITY_HALF; t += 23) {
      lights.push({ x: c - ROAD / 2 - 0.9, z: t });
      lights.push({ x: t + 11, z: c + ROAD / 2 + 0.9 });
    }
  }

  // Street props scattered on the sidewalks.
  for (let n = 0; n < 130; n++) {
    const onVertical = rng.chance(0.5);
    const road = centers[rng.int(0, centers.length - 1)];
    const side = rng.chance(0.5) ? 1 : -1;
    const along = rng.range(-CITY_HALF, CITY_HALF);
    const kind = PROP_KINDS[rng.int(0, PROP_KINDS.length - 1)];
    const px = onVertical ? road + side * (ROAD / 2 + 1.1) : along;
    const pz = onVertical ? along : road + side * (ROAD / 2 + 1.1);
    props.push({ x: px, z: pz, kind, color: CRATE_COLORS[rng.int(0, CRATE_COLORS.length - 1)] });
  }

  const zones = {
    gunshop: { x: 56, z: -56, color: [1, 0.62, 0.2], label: 'AMMU-NATION' },
    hospital: { x: -56, z: 56, color: [0.95, 0.95, 0.98], label: 'HOSPITAL' },
    spray: { x: 56, z: 56, color: [0.35, 0.95, 0.55], label: "PAY 'N SPRAY" },
    contact: { x: -56, z: -56, color: [1, 0.85, 0.3], label: 'CONTACT' },
    harbor: { x: -128, z: 128, color: [0.4, 0.75, 1], label: 'THE HARBOR' },
  };

  return { buildings, palms, lights, props, signs, zones };
}

// Six named districts, sliced by avenue bands.
export function districtAt(x, z) {
  if (x > 55) {
    if (z < -20) return 'NORTH BEACH';
    if (z > 20) return 'SOLMAR BAY';
    return 'OCEAN DRIVE';
  }
  if (x < -55) {
    if (z < 0) return 'PALM HEIGHTS';
    return 'THE HARBOR';
  }
  return 'DOWNTOWN';
}
