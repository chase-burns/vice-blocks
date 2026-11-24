// rng.js — deterministic randomness and the handful of numeric helpers
// every module leans on. The core is mulberry32: a single 32-bit state
// word advanced by an odd increment, then mixed with two multiply and
// xorshift rounds. Because everything flows from a seed, the city layout,
// the traffic and the staged screenshot scenes come out identical on
// every run. Nothing here touches the DOM.

export function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  function next() {
    state = (state + 0x6D2B79F5) | 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (items) => items[Math.floor(next() * items.length) % items.length];
  next.chance = (p) => next() < p;
  return next;
}

// Keep a value inside [lo, hi].
export function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

// Straight-line blend between two numbers.
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Squared ground-plane distance. Proximity tests compare it against
// squared radii, so the hot paths skip the square root entirely.
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

// Blend two headings (radians) along whichever arc is shorter.
export function angleLerp(a, b, t) {
  const TAU = Math.PI * 2;
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}
