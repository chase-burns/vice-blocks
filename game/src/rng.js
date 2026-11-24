// rng.js — seeded randomness plus the small numeric helpers shared by
// nearly every module. The generator is mulberry32: one 32-bit state
// word, stepped by an odd constant and scrambled through two multiply /
// xorshift rounds. Since every random choice in the game draws from a
// seed, the city, the traffic and the staged screenshot scenes are the
// same on every run. This file never touches the DOM.

export function makeRng(seed) {
  let word = (seed >>> 0) || 1;
  function draw() {
    word = (word + 0x6D2B79F5) | 0;
    let t = word;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  draw.range = (lo, hi) => lo + draw() * (hi - lo);
  draw.int = (lo, hi) => lo + Math.floor(draw() * (hi - lo + 1));
  draw.pick = (arr) => arr[Math.floor(draw() * arr.length) % arr.length];
  draw.chance = (p) => draw() < p;
  return draw;
}

// Pin a number into the inclusive range [lo, hi].
export function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

// Linear interpolation from a to b by fraction t.
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Squared distance on the ground plane. Callers compare against squared
// radii, which keeps square roots out of the per-frame hot paths.
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

// Interpolate between two headings (radians) along the shorter arc.
export function angleLerp(a, b, t) {
  const FULL = Math.PI * 2;
  let d = (b - a) % FULL;
  if (d > Math.PI) d -= FULL;
  else if (d < -Math.PI) d += FULL;
  return a + d * t;
}
