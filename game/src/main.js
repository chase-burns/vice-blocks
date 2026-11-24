// Entry point / bootstrap (WO Task 1 + 13): renderer + state wiring, input,
// render orchestration, particles, deterministic screenshot harness.
import { Renderer, mat4LookAt, mat4Perspective } from './gl/renderer.js';
import { Builder } from './gl/mesh.js';
import { drawDashTexture } from './gl/textures.js';
import { clamp, dist2 } from './rng.js';
import { BLOCK, ROAD, CITY_HALF, roadCenters } from './game/world.js';
import { createState, step, drainEvents } from './game/state.js';
import { setupShotScene } from './game/shots.js';
import { enterExitCar, shoot, respawn } from './game/player.js';
import { startMission, startTaxi } from './game/missions.js';
import { CameraRig, viewDir } from './game/camera.js';
import { AudioEngine } from './game/audio.js';
import { drawMinimap, updateHUD } from './game/hud.js';
import { loadProfile, saveProfile } from './game/storage.js';

const canvas = document.getElementById('gl');
const R = new Renderer(canvas);
const ui = {};
for (const id of ['hud','health','armor','cash','stars','weapon','banner','msg','minimap','speed','bustbar','bustfill','overlay','ovTitle','ovSub','mission','timer','prompt','vignette'])
  ui[id] = document.getElementById(id);
const mm = ui.minimap.getContext('2d');

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') || '';
const seedParam = parseInt(params.get('seed') || '7', 10) || 7;

let S = createState(seedParam, shotMode ? null : loadProfile());
S.shotMode = shotMode;
if (!shotMode && S.missionIdx > 0 && S.missionIdx < 5) startMission(S);
const rig = new CameraRig();
const audio = new AudioEngine();

// ---------- static city meshes ----------
function buildCityMeshes(s) {
  const city = s.city;
  const plain = new Builder(), texB = [new Builder(), new Builder(), new Builder(), new Builder()], road = new Builder(), walk = new Builder();
  city.buildings.forEach((b, bi) => {
    const B = texB[b.tex];
    B.box(b.x, 0, b.z, b.w, b.h, b.d, [1, 1, 1], Math.max(1, Math.round(b.h / 14)));
    // Architectural relief (same facade texture, tinted slightly darker):
    B.box(b.x, b.h, b.z, b.w + 0.8, 1.0, b.d + 0.8, [0.92, 0.90, 0.86], 1);              // parapet cap
    B.box(b.x, b.h * 0.55, b.z, b.w + 0.5, 0.55, b.d + 0.5, [0.94, 0.92, 0.88], 1);      // cornice band
    B.box(b.x, 0, b.z, b.w + 0.6, 1.4, b.d + 0.6, [0.9, 0.88, 0.84], 1);                // podium base
    if (bi % 3 !== 0) { // balconies on the +x face, 2-4 slabs
      const n = 2 + (bi % 3);
      for (let k = 0; k < n; k++) {
        B.box(b.x + b.w / 2 + 0.45, b.h * (0.3 + 0.18 * k), b.z - b.d / 4 + (k % 2) * b.d / 2, 0.9, 0.28, 2.6, [0.88, 0.86, 0.82], 1);
      }
    }
  });
  const centers = roadCenters();
  for (const c of centers) {
    road.quad([c - ROAD / 2, 0.01, -CITY_HALF - 40], [c + ROAD / 2, 0.01, -CITY_HALF - 40], [c + ROAD / 2, 0.01, CITY_HALF + 40], [c - ROAD / 2, 0.01, CITY_HALF + 40], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    road.quad([-CITY_HALF - 40, 0.01, c - ROAD / 2], [CITY_HALF + 40, 0.01, c - ROAD / 2], [CITY_HALF + 40, 0.01, c + ROAD / 2], [-CITY_HALF - 40, 0.01, c + ROAD / 2], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    for (const zz of [-1, 1]) {
      walk.box(c + zz * (ROAD / 2 + 1), 0, 0, 2, 0.18, (CITY_HALF + 40) * 2, [1, 1, 1]);
      walk.box(0, 0, c + zz * (ROAD / 2 + 1), (CITY_HALF + 40) * 2, 0.18, 2, [1, 1, 1]);
    }
    // dashed centre line + crosswalks at intersections
    for (let t = -CITY_HALF - 30; t < CITY_HALF + 30; t += 6) {
      plain.box(c, 0.03, t, 0.35, 0.02, 2.6, [0.95, 0.8, 0.25]);
      plain.box(t, 0.03, c, 2.6, 0.02, 0.35, [0.95, 0.8, 0.25]);
    }
    for (const c2 of centers) for (let k = -3; k <= 3; k++) {
      plain.box(c + k * 1.1, 0.035, c2 - ROAD / 2 + 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
      plain.box(c + k * 1.1, 0.035, c2 + ROAD / 2 - 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
    }
  }
  plain.box(0, -0.05, 0, (CITY_HALF + 42) * 2, 0.1, (CITY_HALF + 42) * 2, [0.66, 0.60, 0.50]);
  // turquoise ocean on the east flank + beach strip
  plain.box(CITY_HALF + 120, -0.4, 0, 190, 0.1, (CITY_HALF + 60) * 2, [0.13, 0.72, 0.68]);
  plain.box(CITY_HALF + 16, -0.02, 0, 26, 0.12, (CITY_HALF + 40) * 2, [0.93, 0.84, 0.62]);
  for (const pm of city.palms) {
    const sc = pm.s || 1, lean = pm.lean || 0.1;
    // Curved trunk: 3 stacked segments leaning progressively.
    let tx = pm.x, tz = pm.z;
    for (let seg = 0; seg < 3; seg++) {
      plain.box(tx, seg * 1.6 * sc, tz, 0.34 * sc, 1.7 * sc, 0.34 * sc, [0.52, 0.42, 0.30]);
      tx += lean * (seg + 1) * 0.55 * sc; tz += lean * 0.3 * sc;
    }
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      plain.box(tx + Math.sin(a) * 1.8 * sc, 4.9 * sc + 0.3, tz + Math.cos(a) * 1.8 * sc, 3.8 * sc, 0.08, 0.8 * sc, [0.18, 0.62, 0.33]);
    }
  }
  for (const l of city.lights) {
    plain.box(l.x, 0, l.z, 0.18, 5.2, 0.18, [0.2, 0.2, 0.25]);
  }
  for (const pr of city.props) {
    if (pr.kind === 'bin') plain.box(pr.x, 0, pr.z, 0.6, 1.0, 0.6, [0.25, 0.5, 0.35]);
    else if (pr.kind === 'barrier') plain.box(pr.x, 0, pr.z, 1.8, 0.8, 0.3, [0.95, 0.5, 0.15]);
    else if (pr.kind === 'hydrant') plain.box(pr.x, 0, pr.z, 0.35, 0.7, 0.35, [0.9, 0.2, 0.2]);
    else plain.box(pr.x, 0, pr.z, 0.9, 0.9, 0.9, pr.color);
  }
  // distant skyline silhouettes
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2;
    if (Math.cos(a) > 0.35) continue;
    const d = CITY_HALF + 130 + (i % 5) * 30;
    plain.box(Math.sin(a) * d, 0, Math.cos(a) * d, 34, 40 + (i * 37) % 70, 34, [0.58, 0.65, 0.72]);
  }
  const lampDots = new Builder();
  for (const l of city.lights) lampDots.box(l.x, 5.2, l.z, 0.55, 0.3, 0.55, [1, 0.85, 0.5]);
  return {
    plain: plain.build(R), road: road.build(R), walk: walk.build(R),
    tex: texB.map(b => b.build(R)), lampDots: lampDots.build(R),
    signs: city.signs, lights: city.lights,
  };
}
const MESH = buildCityMeshes(S);

// ---------- particles & decals ----------
const particles = [];
function spawnP(x, y, z, vx, vy, vz, life, size, color, grav = 0) {
  if (particles.length > 420) particles.shift();
  particles.push({ x, y, z, vx, vy, vz, life, max: life, size, color, grav });
}
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.life -= dt;
    if (q.life <= 0) { particles.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    q.vy -= q.grav * dt;
    if (q.y < 0.06) q.y = 0.06;
  }
}
function drawParticles() {
  for (const q of particles) {
    const a = clamp(q.life / q.max, 0, 1) * 0.55;
    R.box(q.x, q.y, q.z, q.x * 7 + q.z, q.size, q.size, q.size, q.color, { alpha: a });
  }
}
let skids = [];
function drawSkids() {
  for (const sk of skids) R.box(sk.x, 0.045, sk.z, sk.ry, 0.32, 0.015, sk.len, [0.05, 0.05, 0.07], { alpha: 0.5 });
}

// ---------- entity drawing ----------
function drawCar(s, car, t, interior = false) {
  const { x, z } = car, ry = car.ry;
  const phys = car.phys;
  const pitch = phys ? -phys.pitch : (car._dispA || 0) * 0.002;
  const roll = phys ? phys.roll : clamp(-(car.steer || 0) * 0.03, -0.04, 0.04);
  R.box(x, 0.16, z, ry, 2.6, 0.06, 4.4, [0.03, 0.02, 0.05], { alpha: 0.3 });
  R.box(x, 0.18, z, ry, 2.3, 0.05, 4.0, [0.04, 0.03, 0.07], { alpha: 0.35 });
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  const style = car.kind === 'cop' ? 'police' : (car.style || 'sedan');
  if (car.kind === 'cop') {
    const ph = Math.floor(t * 5 + car.id) % 2 === 0;
    R.box(x + fx * 0.5, 0.1, z + fz * 0.5, ry, 3.4, 0.04, 5.2, ph ? [1, 0.1, 0.15] : [0.2, 0.4, 1], { alpha: 0.20 });
  }
  const body = car.kind === 'dead' ? [0.15, 0.14, 0.16] : car.color;
  const glass = [0.13, 0.18, 0.24], dark = [0.08, 0.08, 0.1];
  // P(f, r, yCentre, w, h, d, color, opts): part placed in car space.
  const P = (f, r, y, w, h, d, color, o = {}) => R.box(x + fx * f + rx * r, y, z + fz * f + rz * r, ry, w, h, d, color, { pitch, roll, ...o });
  const steerVis = car === s.player.inCar && car.phys ? car.phys.steerAngle : (car.steer || 0) * 0.4;
  car._spin = (car._spin || 0) + (car.speed || 0) * 0.09;
  const wheels = (rF, rR, wdt, fOff, rOff) => {
    for (const [sx, sz, front] of [[-1, fOff, 1], [1, fOff, 1], [-1, -rOff, 0], [1, -rOff, 0]]) {
      const rr = front ? rF : rR;
      const wx = x + rx * sx * 0.92 + fx * sz, wz = z + rz * sx * 0.92 + fz * sz;
      R.box(wx, rr, wz, ry + (front ? steerVis : 0), wdt, rr * 2, rr * 2, [0.05, 0.05, 0.07], { roll: car._spin });
      R.box(wx + rx * sx * 0.16, rr, wz + rz * sx * 0.16, ry + (front ? steerVis : 0), 0.05, rr * 1.15, rr * 1.15, [0.75, 0.76, 0.8], { roll: car._spin });
    }
  };
  const hl = Math.sin(t * 47 + car.id) > 0 ? [1, 0.95, 0.75] : [0.9, 0.85, 0.6];
  if (style === 'sport') {
    P(0, 0, 0.36, 1.95, 0.52, 4.4, body);                    // low main body
    P(1.62, 0, 0.60, 1.85, 0.30, 1.25, body, { pitch: pitch + 0.14 }); // wedge nose
    if (!interior) {
      P(-0.55, 0, 0.86, 1.62, 0.46, 1.7, glass);             // rear-set cabin
      P(-0.55, 0, 1.12, 1.5, 0.07, 1.4, body);               // roof skin
    }
    P(-1.72, 0, 0.70, 1.85, 0.18, 0.9, body);                // rear deck
    P(-2.02, -0.6, 0.92, 0.08, 0.2, 0.3, dark);              // spoiler strut L
    P(-2.02, 0.6, 0.92, 0.08, 0.2, 0.3, dark);               // spoiler strut R
    P(-2.06, 0, 1.05, 1.9, 0.06, 0.42, body);                // spoiler blade
    wheels(0.33, 0.37, 0.30, 1.42, 1.42);
    P(2.18, -0.62, 0.48, 0.42, 0.13, 0.08, hl, { emissive: true });
    P(2.18, 0.62, 0.48, 0.42, 0.13, 0.08, hl, { emissive: true });
    P(-2.18, 0, 0.58, 1.7, 0.12, 0.08, [1, 0.15, 0.2], { emissive: true }); // full-width tail bar
  } else if (style === 'police') {
    const white = [0.94, 0.94, 0.96], black = [0.07, 0.07, 0.09];
    P(0, 0, 0.42, 1.9, 0.62, 4.3, white);
    P(0.1, 0, 0.44, 1.93, 0.42, 2.3, black);                 // black door band
    P(1.58, 0, 0.76, 1.8, 0.1, 1.05, white, { pitch: pitch + 0.08 }); // hood slope
    if (!interior) {
      P(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glass);
      P(-0.15, 0, 1.33, 1.6, 0.08, 1.9, white);
    }
    P(2.28, 0, 0.45, 0.35, 0.5, 0.18, black);                // push bar
    const ph = Math.floor(t * 5 + car.id) % 2 === 0;
    P(0, -0.34, 1.46, 0.62, 0.16, 0.42, ph ? [1, 0.12, 0.18] : [0.3, 0.3, 0.35], { emissive: true }); // light bar red
    P(0, 0.34, 1.46, 0.62, 0.16, 0.42, ph ? [0.3, 0.3, 0.35] : [0.25, 0.45, 1], { emissive: true });  // light bar blue
    wheels(0.34, 0.34, 0.28, 1.4, 1.4);
    P(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, hl, { emissive: true });
    P(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, hl, { emissive: true });
    P(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, [1, 0.15, 0.2], { emissive: true });
    P(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, [1, 0.15, 0.2], { emissive: true });
  } else { // sedan + taxi
    P(0, 0, 0.42, 1.9, 0.62, 4.3, body);
    P(1.58, 0, 0.76, 1.8, 0.1, 1.05, body, { pitch: pitch + 0.08 }); // sloped hood
    P(-1.98, 0, 0.78, 1.8, 0.12, 0.45, body);                // trunk lip
    if (!interior) {
      P(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glass);
      P(-0.15, 0, 1.33, 1.6, 0.08, 1.9, body);
    }
    P(2.14, 0, 0.32, 1.86, 0.22, 0.14, dark);                // front bumper
    P(-2.14, 0, 0.32, 1.86, 0.22, 0.14, dark);               // rear bumper
    if (style === 'taxi') {
      P(0, 0, 0.52, 1.93, 0.13, 3.1, [0.12, 0.12, 0.14]);    // checker band
      P(-0.15, 0, 1.48, 0.72, 0.2, 0.34, [1, 0.85, 0.4], { emissive: true }); // roof sign
    }
    wheels(0.34, 0.34, 0.28, 1.4, 1.4);
    P(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, hl, { emissive: true });
    P(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, hl, { emissive: true });
    P(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, [1, 0.15, 0.2], { emissive: true });
    P(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, [1, 0.15, 0.2], { emissive: true });
  }
  if ((car.speed || 0) > 1 || car === s.player.inCar) {
    R.box(x + fx * 3.4, 0.35, z + fz * 3.4, ry, 2.6, 0.5, 2.6, [1, 0.95, 0.7], { alpha: 0.08 });
  }
  if (car.smoke === 1) spawnP(x, 1.2, z, 0, 1.6, 0, 0.8, 0.7, [0.55, 0.55, 0.6]);
  if (car.smoke === 2) { spawnP(x, 1.2, z, 0, 2.2, 0, 0.9, 0.9, [0.25, 0.2, 0.22]); if (Math.random() < 0.4) spawnP(x, 1.0, z, 0, 1.4, 0, 0.4, 0.6, [1, 0.45, 0.1]); }
}
function drawInterior(s, car) {
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
  const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const at = (f, r, y) => [car.x + fx * f + rx * r, y, car.z + fz * f + rz * r];
  let q = at(1.02, 0, 0.80);
  R.box(q[0], q[1], q[2], car.ry, 2.05, 0.34, 0.5, [0.09, 0.09, 0.12]);
  q = at(1.06, 0, 0.99);
  R.box(q[0], q[1], q[2], car.ry, 2.05, 0.07, 0.42, [0.16, 0.15, 0.2]);
  // live instrument cluster (canvas texture, needles track speed/rpm)
  q = at(1.40, -0.05, 0.98);
  R.panel(q[0], q[1], q[2], car.ry, 1.15, 0.55, 'dash', { pitch: -0.25 });
  // steering wheel: slim ring (r=0.19) + three spokes, rotation = steer x 3.2
  const wheelRoll = -(car.phys ? car.phys.steerAngle : 0) * 3.2;
  const wc = at(0.70, -0.35, 0.84);
  const wob = (dx, dy) => {
    const cr = Math.cos(wheelRoll), sr = Math.sin(wheelRoll);
    const lx = dx * cr - dy * sr, ly = dx * sr + dy * cr;
    return [wc[0] + rx * lx, wc[1] + ly, wc[2] + rz * lx];
  };
  const rimC = [0.13, 0.13, 0.15], spokeC = [0.22, 0.22, 0.25];
  let b;
  // ring: 12 short segments approximating a circle
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    b = wob(Math.cos(a) * 0.19, Math.sin(a) * 0.19);
    R.box(b[0], b[1], b[2], car.ry, 0.115, 0.048, 0.05, rimC, { pitch: -0.32, roll: wheelRoll + a + Math.PI / 2 });
  }
  // three spokes: down, lower-left, lower-right (classic 3-spoke layout)
  for (const a of [-Math.PI / 2, -Math.PI / 2 - 2.1, -Math.PI / 2 + 2.1]) {
    b = wob(Math.cos(a) * 0.095, Math.sin(a) * 0.095);
    R.box(b[0], b[1], b[2], car.ry, 0.20, 0.042, 0.055, spokeC, { pitch: -0.32, roll: wheelRoll + a });
  }
  b = wob(0, 0); R.box(b[0], b[1], b[2], car.ry, 0.11, 0.11, 0.09, [0.16, 0.16, 0.19], { pitch: -0.32, roll: wheelRoll });
  // driver hands gripping the rim at 9 and 3
  b = wob(-0.19, 0.02); R.box(b[0], b[1], b[2], car.ry, 0.11, 0.09, 0.14, [0.92, 0.76, 0.6], { pitch: -0.32, roll: wheelRoll });
  b = wob(0.19, 0.02); R.box(b[0], b[1], b[2], car.ry, 0.11, 0.09, 0.14, [0.92, 0.76, 0.6], { pitch: -0.32, roll: wheelRoll });
  for (const sd of [-1, 1]) {
    q = at(0.92, sd * 1.04, 1.3);
    R.box(q[0], q[1], q[2], car.ry, 0.3, 0.17, 0.05, [0.08, 0.08, 0.1]);
    q = at(0.9, sd * 1.03, 1.3);
    R.box(q[0], q[1], q[2], car.ry, 0.24, 0.12, 0.02, [0.75, 0.85, 0.95], { emissive: true });
  }
  // centre console + gear knob between the seats
  q = at(0.35, 0.18, 0.42);
  R.box(q[0], q[1], q[2], car.ry, 0.42, 0.3, 1.1, [0.11, 0.11, 0.14]);
  q = at(0.55, 0.18, 0.6);
  R.box(q[0], q[1], q[2], car.ry, 0.07, 0.16, 0.07, [0.2, 0.2, 0.24]);
  // rear-view mirror with a simple two-tone reflection (sky over road)
  q = at(1.05, 0, 1.52);
  R.box(q[0], q[1], q[2], car.ry, 0.62, 0.2, 0.05, [0.07, 0.07, 0.09]);
  q = at(1.02, 0, 1.565);
  R.box(q[0], q[1], q[2], car.ry, 0.54, 0.075, 0.02, [0.62, 0.78, 0.94], { emissive: true });
  q = at(1.02, 0, 1.475);
  R.box(q[0], q[1], q[2], car.ry, 0.54, 0.075, 0.02, [0.42, 0.42, 0.46], { emissive: true });
  q = at(1.12, 0, 1.66);
  R.box(q[0], q[1], q[2], car.ry, 2.05, 0.09, 0.3, [0.08, 0.08, 0.11]);
}
function drawGunView(s, eye, viewYaw, viewPitch, lowered = false) {
  const d = viewDir(viewYaw, viewPitch);
  const rx = Math.cos(viewYaw), rz = -Math.sin(viewYaw);
  const aim = s.player.aim && !lowered;
  const kick = (s.recoil || 0) * 0.03;
  const rOff = aim ? 0 : 0.23, dOff = (aim ? 0.42 : 0.5) - kick, yOff = lowered ? -0.5 : (aim ? -0.145 : -0.27) + kick * 0.6;
  const gx = eye[0] + d[0] * dOff + rx * rOff, gy = eye[1] + d[1] * dOff + yOff, gz = eye[2] + d[2] * dOff + rz * rOff;
  R.box(gx, gy, gz, viewYaw, 0.09, 0.15, 0.46, [0.1, 0.1, 0.12], { pitch: viewPitch });
  R.box(gx + d[0] * 0.3, gy + d[1] * 0.3 + 0.02, gz + d[2] * 0.3, viewYaw, 0.05, 0.05, 0.26, [0.16, 0.16, 0.18], { pitch: viewPitch });
  R.box(gx - d[0] * 0.08 + rx * 0.02, gy - 0.13, gz - d[2] * 0.08 + rz * 0.02, viewYaw, 0.15, 0.11, 0.2, [0.92, 0.76, 0.6], { pitch: viewPitch });
  if (!aim) R.box(gx - d[0] * 0.22 + rx * 0.1, gy - 0.3, gz - d[2] * 0.22 + rz * 0.1, viewYaw, 0.13, 0.13, 0.42, [0.97, 0.87, 0.72], { pitch: viewPitch + 0.5 });
}
function drawPerson(s, x, z, ry, color, o = {}) {
  // 7 parts: shadow, 2 legs (pants), torso (shirt), 2 arms (sleeves, swinging
  // counter-phase to the legs), head (skin tone). Plus optional gun.
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const rx = Math.cos(ry), rz = -Math.sin(ry);
  R.box(x, 0.02, z, ry, 0.8, 0.04, 0.8, [0.03, 0.02, 0.05], { alpha: 0.3 });
  const ph = o.walkPhase || 0;
  const sw = Math.sin(ph) * 0.3;
  if (o.dead) { R.box(x, 0.12, z, ry, 0.55, 0.25, 1.6, color); return; }
  const pants = o.pants || [0.22, 0.24, 0.34], skin = o.skin || [0.92, 0.76, 0.6];
  R.box(x - fx * sw * 0.4 - rx * 0.11, 0.4, z - fz * sw * 0.4 - rz * 0.11, ry, 0.19, 0.8, 0.23, pants, { pitch: sw * 0.7 });
  R.box(x + fx * sw * 0.4 + rx * 0.11, 0.4, z + fz * sw * 0.4 + rz * 0.11, ry, 0.19, 0.8, 0.23, pants, { pitch: -sw * 0.7 });
  R.box(x, 1.1, z, ry, 0.55, 0.65, 0.3, color);
  const armY = o.handsUp ? 1.95 : 1.15;
  const armP = o.handsUp ? 0.4 : sw * 0.55;
  R.box(x - rx * 0.36 + fx * sw * 0.18, armY, z - rz * 0.36 + fz * sw * 0.18, ry, 0.14, 0.6, 0.16, color, { pitch: -armP });
  R.box(x + rx * 0.36 - fx * sw * 0.18, armY, z + rz * 0.36 - fz * sw * 0.18, ry, 0.14, 0.6, 0.16, color, { pitch: armP });
  R.box(x, 1.62, z, ry, 0.34, 0.36, 0.34, skin);
  if (o.gun) R.box(x + fx * 0.4, 1.25, z + fz * 0.4, ry, 0.08, 0.12, 0.45, [0.08, 0.08, 0.1]);
}

// ---------- render ----------
let frame = 0;
function render(s, t) {
  const [w, h] = R.resize();
  const p = s.player, car = p.inCar;
  let cam;
  if (car) cam = rig.cockpit(s, car, lookYaw, lookPitch, t, lastDt);
  else if (shotMode === 'start') cam = { eye: [p.x, 1.72, p.z], center: (() => { const d = viewDir(s.camYaw, lookPitch); return [p.x + d[0] * 10, 1.72 + d[1] * 10, p.z + d[2] * 10]; })(), up: [0, 1, 0], fov: 75 * Math.PI / 180, yaw: s.camYaw, pitch: lookPitch };
  else cam = rig.foot(s, s.camYaw, lookPitch, t);
  const proj = mat4Perspective(cam.fov, w / h, 0.05, 900);
  const view = mat4LookAt(cam.eye, cam.center, cam.up);
  R.begin(view, proj, cam.eye);
  R.draw(MESH.plain, IDM);
  R.draw(MESH.road, IDM, { tex: 'road' });
  R.draw(MESH.walk, IDM, { tex: 'walk' });
  for (let i = 0; i < 4; i++) R.draw(MESH.tex[i], IDM, { tex: 'b' + i });
  R.draw(MESH.lampDots, IDM, { emissive: true });
  for (const sg of MESH.signs) R.box(sg.x, sg.y, sg.z, sg.ry, sg.w, sg.h, 0.18, sg.color);
  for (const l of MESH.lights) R.box(l.x, 4.4, l.z, 0, 2.6, 0.05, 2.6, [1, 0.8, 0.45], { alpha: 0.10 });
  const zz = s.city.zones;
  for (const key of ['gunshop', 'hospital', 'spray', 'contact', 'harbor']) {
    const z = zz[key];
    R.box(z.x, 2.2, z.z, t * 0.4, 0.5, 4.4, 0.5, z.color, { alpha: 0.30, emissive: true });
    R.box(z.x, 4.6, z.z, 0, 1.6, 0.5, 1.6, z.color, { emissive: true });
  }
  const target = s.mission?.target || s.taxi?.target;
  if (target) R.box(target.x, 2.4, target.z, t * 0.6, 0.7, 4.8, 0.7, [1, 0.9, 0.3], { alpha: 0.4, emissive: true });
  for (const pk of s.pickups) {
    R.box(pk.x, 0.5 + Math.sin(t * 3) * 0.12, pk.z, t * 1.5, 0.55, 0.35, 0.4, [0.15, 0.9, 0.35], { emissive: true });
  }
  for (const tg of s.targets || []) if (!tg.down) R.box(tg.x, 1.1, tg.z, 0, 0.7, 1.5, 0.25, [1, 0.25, 0.3], { emissive: true });
  if (s.boss && !s.boss.done) drawPerson(s, s.boss.x, s.boss.z, Math.PI, [0.2, 0.2, 0.22], { walkPhase: 0 });
  drawSkids();
  for (const c of s.cars) drawCar(s, c, t, c === p.inCar);
  for (const c of s.cops) if (c !== p.inCar) drawCar(s, c, t);
  for (const ped of s.peds) {
    ped._phase = (ped._phase || 0) + (ped.state === 'dead' ? 0 : (ped.state === 'flee' ? 11 : 6) * lastDt * (ped.speed / 1.4));
    drawPerson(s, ped.x, ped.z, ped.ry, ped.color, { walkPhase: ped._phase, dead: ped.state === 'dead', handsUp: ped.state === 'handsup' || ped.state === 'robbed', pants: ped.pants, skin: ped.skin });
  }
  drawParticles();
  if (p.inCar) drawInterior(s, p.inCar);
  else if (s.hasGun && s.mode !== 'title') drawGunView(s, cam.eye, cam.yaw, cam.pitch, shotMode === 'start');
  if (frame % 6 === 0 && p.inCar) drawDashTexture(R.gl, R.textures.dash, Math.abs(p.inCar.speed) * 2.23694, p.inCar.rpm || 0.1);
}
import { mat4Identity } from './gl/renderer.js';
const IDM = mat4Identity();

// ---------- input ----------
const keys = {};
let mouseDX = 0, mouseDY = 0, mouseDownL = false, mouseDownR = false;
let lookYaw = 0, lookPitch = 0, lastLookMove = 0;
let wantShoot = false, wantInteract = false, wantEnter = false, wantTaxi = false, wantReload = false;
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  audio.init();
  if (S.mode === 'title') { S.mode = 'play'; return; }
  if (S.mode === 'busted' || S.mode === 'wasted') { respawn(S, S.mode); return; }
  if (e.code === 'KeyF') wantEnter = true;
  if (e.code === 'KeyE') wantInteract = true;
  if (e.code === 'KeyT') wantTaxi = true;
  if (e.code === 'KeyR') wantReload = true;
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (S.mode === 'play') S.mode = 'paused';
    else if (S.mode === 'paused') S.mode = 'play';
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('click', () => {
  audio.init();
  if (S.mode === 'title') { S.mode = 'play'; return; }
  if (S.mode === 'busted' || S.mode === 'wasted') { respawn(S, S.mode); return; }
  if (S.mode === 'paused') { S.mode = 'play'; return; }
  if (!shotMode && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});
addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouseDownL = true; wantShoot = true; }
  if (e.button === 2) mouseDownR = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDownL = false;
  if (e.button === 2) mouseDownR = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) { mouseDX += e.movementX; mouseDY += e.movementY; lastLookMove = performance.now(); }
});
function readInput() {
  return {
    up: !!(keys.KeyW || keys.ArrowUp), down: !!(keys.KeyS || keys.ArrowDown),
    left: !!(keys.KeyA || keys.ArrowLeft), right: !!(keys.KeyD || keys.ArrowRight),
    shift: !!(keys.ShiftLeft || keys.ShiftRight), handbrake: !!keys.Space,
    aim: mouseDownR, interact: wantInteract, reload: wantReload,
  };
}
function nearCar() {
  for (const c of [...S.cars, ...S.cops]) if (dist2(c.x, c.z, S.player.x, S.player.z) < 4.5 * 4.5) return true;
  return false;
}

// ---------- events -> sound / messages ----------
function handleEvents(s) {
  for (const e of drainEvents(s)) {
    switch (e.name) {
      case 'shot': {
        audio.shot();
        const p = s.player, fx = Math.sin(p.ry), fz = Math.cos(p.ry);
        spawnP(p.x + fx * 0.7, 1.45, p.z + fz * 0.7, fx * 2, 0.4, fz * 2, 0.12, 0.3, [1, 0.8, 0.3]);
        for (let i = 0; i < 3; i++) spawnP(p.x + fx * 0.8, 1.3, p.z + fz * 0.8, fx + (Math.random() - 0.5), Math.random(), fz + (Math.random() - 0.5), 0.5, 0.18, [0.7, 0.7, 0.72]);
        break;
      }
      case 'targetDown': audio.beep(1200, 0.1, 'square', 0.14); s.msg = 'TARGET DOWN'; s.msgT = 1; break;
      case 'dryFire': audio.beep(200, 0.05, 'square', 0.08); s.msg = 'EMPTY — R TO RELOAD'; s.msgT = 1.2; break;
      case 'hitPed': audio.noiseBurst(0.15, 0.3, 500); break;
      case 'crash': case 'ram': audio.crash(e.data || 8); break;
      case 'explode': audio.noiseBurst(0.8, 0.7, 220); break;
      case 'cash': case 'pickup': case 'missionDone': audio.cash(); break;
      case 'robDrop': s.msg = 'WALLET DROPPED — GRAB IT'; s.msgT = 2; break;
      case 'buyGun': audio.cash(); s.msg = 'PISTOL PURCHASED — RIGHT MOUSE AIM, LEFT CLICK FIRE'; s.msgT = 3; break;
      case 'spray': audio.beep(520, 0.3, 'sawtooth', 0.1); s.msg = "PAY 'N SPRAY — HEAT CLEARED, FRESH PAINT"; s.msgT = 2.5; break;
      case 'wanted': s.msg = e.data > 0 ? `WANTED ${'★'.repeat(e.data)}` : 'HEAT LOST'; s.msgT = 2; break;
      case 'busted': break;
      case 'missionFail': audio.beep(160, 0.4, 'sawtooth', 0.15); break;
      case 'save': saveProfile(s); break;
    }
  }
}

// ---------- screenshot scenes (WO Section 4) ----------
function setupShot(kind) {
  const s = S;
  const fx0 = setupShotScene(s, kind);
  const car = s.player.inCar;
  void car;
  if (kind === 'play') rig.fovPunch = 84;
  lookPitch = kind === 'start' ? -0.03 : 0.02;
  for (const sk of fx0.skids) skids.push(sk);
  for (const pf of fx0.puffs) spawnP(pf.x, pf.y, pf.z, pf.vx, pf.vy, pf.vz, pf.life, pf.size, pf.color);
  if (kind === 'chase') ui.vignette.style.opacity = '0.85';
}

// ---------- boot ----------
if (shotMode) {
  setupShot(shotMode);
  // Physics objects for shot cars (needs the class; imported statically below).
  bootPhysics();
}
function bootPhysics() {
  for (const c of S.cars) {
    if (c === S.player.inCar) {
      c.phys = new PhysClass();
      c.phys.u = shotMode === 'play' ? 38.5 : shotMode === 'chase' ? 23.2 : 0;
      c.phys.steerAngle = shotMode === 'play' ? 0.10 : shotMode === 'chase' ? 0.49 : 0;
      if (shotMode === 'chase') { c.phys.v = -15.7; c.phys.omega = 0.4; }
      c.speed = c.phys.u; c.rpm = shotMode === 'play' ? 0.92 : 0.8;
      c.slip = shotMode === 'chase' ? 14 : 0;
      c.isDrifting = shotMode === 'chase';
    }
  }
}
import { VehiclePhysics as PhysClass } from './game/physics.js';
let lastDt = 1 / 60;
let last = performance.now(), shotFrames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now; lastDt = dt; frame++;
  if (!shotMode) {
    if (mouseDX || mouseDY) {
      if (S.player.inCar) {
        lookYaw = clamp(lookYaw - mouseDX * 0.0022, -1.15, 1.15);
        lookPitch = clamp(lookPitch + mouseDY * 0.0018, -0.45, 0.55);
      } else {
        S.camYaw -= mouseDX * 0.003;
        lookPitch = clamp(lookPitch + mouseDY * 0.0022, -0.85, 0.85);
      }
      mouseDX = 0; mouseDY = 0;
    }
    if (S.player.inCar && performance.now() - lastLookMove > 1400) {
      lookYaw *= Math.exp(-dt * 2.2); lookPitch *= Math.exp(-dt * 2.2);
    }
    if (S.mode === 'play') {
      if (wantEnter) { enterExitCar(S); wantEnter = false; }
      if (wantTaxi) { startTaxi(S); wantTaxi = false; }
      const input = readInput();
      if (wantShoot && !S.player.inCar) { shoot(S); }
      step(S, input, dt);
      // skid marks while drifting
      const pc = S.player.inCar;
      if (pc && pc.isDrifting && Math.abs(pc.speed) > 5) {
        skids.push({ x: pc.x, z: pc.z, ry: pc.ry, len: 2.2 });
        if (skids.length > 240) skids.shift();
        const fx = Math.sin(pc.ry), fz = Math.cos(pc.ry);
        for (let i = 0; i < 2; i++) spawnP(pc.x - fx * 1.6, 0.4, pc.z - fz * 1.6, (Math.random() - 0.5) * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2, 0.9, 0.8, [0.82, 0.82, 0.86]);
      }
      if (pc && (pc.slip || 0) > 1.1 && Math.abs(pc.speed) > 5 && Math.random() < 0.6) {
        const fx = Math.sin(pc.ry), fz = Math.cos(pc.ry);
        spawnP(pc.x - fx * 1.6, 0.35, pc.z - fz * 1.6, 0, 1, 0, 0.7, 0.7, [0.8, 0.8, 0.84]);
      }
      handleEvents(S);
      // road feel for the cockpit camera
      if (pc) {
        const centers = roadCenters();
        let latOff = 1e9;
        for (const c of centers) latOff = Math.min(latOff, Math.abs(pc.x - c), Math.abs(pc.z - c));
        let jolt = 0;
        const spd = Math.abs(pc.speed);
        if (spd > 4) {
          if (latOff > 6.1 && latOff < 9.5) jolt += Math.sin(S.time * 43) * 0.016;
          const gridD = Math.min(Math.abs(((pc.x % 23) + 23) % 23 - 11.5), Math.abs(((pc.z % 23) + 23) % 23 - 11.5));
          if (gridD > 10.6) jolt += Math.sin(S.time * 34) * 0.02 * clamp(spd / 14, 0, 1);
        }
        S.roadJolt = jolt;
      } else S.roadJolt = 0;
    }
    wantShoot = false; wantInteract = false; wantReload = false;
    audio.frame(S);
  }
  stepParticles(shotMode ? 0 : dt);
  render(S, S.time);
  updateHUD(S, ui, nearCar);
  drawMinimap(S, mm);
  ui.vignette.style.opacity = (shotMode === 'chase' || S.trauma > 0.25) ? String(Math.min(0.85, 0.35 + (S.trauma || 0) * 0.5)) : '0';
  if (shotMode) {
    shotFrames++;
    if (shotFrames > 15) window.__shotReady = true;
  }
}
requestAnimationFrame(loop);
console.log('Vice Blocks 3D booted', shotMode ? `(shot=${shotMode} seed=${seedParam})` : '');
