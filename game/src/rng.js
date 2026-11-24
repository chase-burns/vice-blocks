// rng.js — deterministic randomness and the handful of numeric helpers
// that every other module leans on. The core generator is mulberry32:
// a single 32-bit word of state, advanced with an odd increment and then
// scrambled with two imul/xorshift rounds. Because it is seeded, one seed
// always grows the identical city, traffic layout and screenshot scene,
// which is what makes the stills reproducible. No DOM access here.

export function makeRng(seed) {
  let word = (seed >>> 0) || 1;
  const next = function () {
    word = (word + 0x6D2B79F5) | 0;
    let t = word;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = function (lo, hi) { return lo + next() * (hi - lo); };
  next.int = function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); };
  next.pick = function (arr) { return arr[Math.floor(next() * arr.length) % arr.length]; };
  next.chance = function (p) { return next() < p; };
  return next;
}

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Ground-plane squared distance. All proximity tests in the game use
// this form so they can compare against a squared radius and skip sqrt.
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// Shortest-arc interpolation between two headings, in radians.
export function angleLerp(a, b, t) {
  const TAU = Math.PI * 2;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}
