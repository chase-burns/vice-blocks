// rng.js — seeded randomness plus small numeric utilities shared by all
// modules. The generator is mulberry32: one 32-bit state word, stepped by
// an odd constant and mixed through two multiply/xorshift rounds. Seeding
// makes cities, traffic and screenshot scenes reproducible. No DOM here.

export function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (items) => items[Math.floor(next() * items.length) % items.length];
  next.chance = (p) => next() < p;
  return next;
}

export function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Squared distance on the ground plane; callers compare with squared
// radii so most proximity checks never need a square root.
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

// Interpolate headings along the shortest arc, angles in radians.
export function angleLerp(a, b, t) {
  const TAU = Math.PI * 2;
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}
