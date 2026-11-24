// main.js — the shell around the simulation. It boots the state,
// bakes the static city into a few big meshes, draws every moving
// thing (cars, the cockpit interior, the gun viewmodel, people, the
// helicopter) out of transformed boxes, feeds keyboard and mouse into
// the step function, turns simulation events into sound and particles,
// and runs the deterministic screenshot mode the harness captures.

import { Renderer, mat4LookAt, mat4Perspective, mat4Identity } from './gl/renderer.js';
import { Builder } from './gl/mesh.js';
import { drawDashTexture } from './gl/textures.js';
import { clamp, dist2 } from './rng.js';
import { CITY_HALF, roadCenters } from './game/world.js';
import { createState, step, drainEvents } from './game/state.js';
import { setupShotScene } from './game/shots.js';
import { enterExitCar, shoot, respawn, weaponDef } from './game/player.js';
import { startMission, startTaxi } from './game/missions.js';
import { CameraRig, viewDir } from './game/camera.js';
import { AudioEngine } from './game/audio.js';
import { drawMinimap, updateHUD } from './game/hud.js';
import { loadProfile, saveProfile } from './game/storage.js';
import { VehiclePhysics } from './game/physics.js';

const IDENTITY = mat4Identity();
const canvas = document.getElementById('gl');
const renderer = new Renderer(canvas);
const R = renderer;

const UI_IDS = [
  'hud', 'health', 'armor', 'cash', 'stars', 'weapon', 'banner', 'msg',
  'minimap', 'speed', 'bustbar', 'bustfill', 'overlay', 'ovTitle', 'ovSub',
  'ovFeat', 'ovSave', 'mission', 'dispatch', 'slots', 'district', 'timer',
  'prompt', 'vignette', 'speedfx', 'respectfill', 'rank',
];
const ui = {};
for (const id of UI_IDS) ui[id] = document.getElementById(id);
const mapCtx = ui.minimap.getContext('2d');

const query = new URLSearchParams(location.search);
const shotKind = query.get('shot') || '';
const seedParam = parseInt(query.get('seed') || '7', 10) || 7;

const S = createState(seedParam, shotKind ? null : loadProfile());
S.shotMode = shotKind;
if (!shotKind && S.missionIdx > 0 && S.missionIdx < 5) startMission(S);
const rig = new CameraRig();
const audio = new AudioEngine();

// ---- static city meshes -------------------------------------------------

function buildCityMeshes(state) {
  const city = state.city;
  const plain = new Builder();
  const road = new Builder();
  const walk = new Builder();
  const facades = [new Builder(), new Builder(), new Builder(), new Builder()];

  city.buildings.forEach((b, bi) => {
    const batch = facades[b.tex];
    batch.box(b.x, 0, b.z, b.w, b.h, b.d, [1, 1, 1], Math.max(1, Math.round(b.h / 14)));
    // Cornice, mid band, plinth and balcony slabs are untextured trim,
    // so they live in the plain batch with flat tints.
    plain.box(b.x, b.h, b.z, b.w + 0.8, 1.0, b.d + 0.8, [0.92, 0.90, 0.86], 1);
    plain.box(b.x, b.h * 0.55, b.z, b.w + 0.5, 0.55, b.d + 0.5, [0.94, 0.92, 0.88], 1);
    plain.box(b.x, 0, b.z, b.w + 0.6, 1.4, b.d + 0.6, [0.90, 0.88, 0.84], 1);
    if (bi % 3 !== 0) {
      const slabs = 2 + (bi % 3);
      for (let k = 0; k < slabs; k++) {
        plain.box(b.x + b.w / 2 + 0.45, b.h * (0.3 + 0.18 * k), b.z - b.d / 4 + (k % 2) * (b.d / 2), 0.9, 0.28, 2.6, [0.88, 0.86, 0.82], 1);
      }
    }
  });

  const centers = roadCenters();
  const extent = CITY_HALF + 40;
  for (const c of centers) {
    road.quad([c - 6.5, 0.01, -extent], [c + 6.5, 0.01, -extent], [c + 6.5, 0.01, extent], [c - 6.5, 0.01, extent], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    road.quad([-extent, 0.01, c - 6.5], [extent, 0.01, c - 6.5], [extent, 0.01, c + 6.5], [-extent, 0.01, c + 6.5], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    for (const side of [-1, 1]) {
      walk.box(c + side * 7.5, 0, 0, 2, 0.18, extent * 2, [1, 1, 1]);
      walk.box(0, 0, c + side * 7.5, extent * 2, 0.18, 2, [1, 1, 1]);
    }
    for (let t = -CITY_HALF - 30; t < CITY_HALF + 30; t += 6) {
      plain.box(c, 0.02, t, 0.35, 0.02, 2.6, [0.95, 0.80, 0.25]);
      plain.box(t, 0.02, c, 2.6, 0.02, 0.35, [0.95, 0.80, 0.25]);
    }
    for (const c2 of centers) {
      for (let k = -3; k <= 3; k++) {
        plain.box(c + k * 1.1, 0.025, c2 - 5.3, 0.6, 0.02, 2.2, [0.90, 0.90, 0.92]);
        plain.box(c + k * 1.1, 0.025, c2 + 5.3, 0.6, 0.02, 2.2, [0.90, 0.90, 0.92]);
      }
    }
  }

  plain.box(0, -0.12, 0, (CITY_HALF + 42) * 2, 0.1, (CITY_HALF + 42) * 2, [0.66, 0.60, 0.50]);
  plain.box(CITY_HALF + 120, -0.42, 0, 190, 0.1, (CITY_HALF + 60) * 2, [0.13, 0.72, 0.68]);
  plain.box(CITY_HALF + 16, -0.02, 0, 26, 0.12, (CITY_HALF + 40) * 2, [0.93, 0.84, 0.62]);

  for (const palm of city.palms) {
    const s = palm.s || 1, lean = palm.lean || 0.1;
    let px = palm.x, pz = palm.z;
    for (let seg = 0; seg < 3; seg++) {
      plain.box(px, seg * 1.6 * s, pz, 0.34 * s, 1.7 * s, 0.34 * s, [0.52, 0.42, 0.30]);
      px += lean * (seg + 1) * 0.55 * s;
      pz += lean * 0.3 * s;
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      plain.box(px + dx * 1.15 * s, 4.95 * s, pz + dz * 1.15 * s, 2.4 * s, 0.08, 0.55 * s, [0.18, 0.62, 0.33]);
      plain.box(px + dx * 2.2 * s, 4.55 * s, pz + dz * 2.2 * s, 1.3 * s, 0.07, 0.45 * s, [0.16, 0.56, 0.30]);
    }
  }

  for (const light of city.lights) plain.box(light.x, 0, light.z, 0.18, 5.2, 0.18, [0.20, 0.20, 0.25]);
  for (const prop of city.props) {
    if (prop.kind === 'bin') plain.box(prop.x, 0, prop.z, 0.6, 1.0, 0.6, [0.25, 0.50, 0.35]);
    else if (prop.kind === 'barrier') {
      plain.box(prop.x, 0, prop.z, 1.8, 0.75, 0.3, [0.92, 0.92, 0.94]);
      plain.box(prop.x, 0.42, prop.z + 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plain.box(prop.x, 0.42, prop.z - 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plain.box(prop.x, 0.75, prop.z, 0.24, 0.18, 0.24, [1, 0.55, 0.10]);
    } else if (prop.kind === 'hydrant') plain.box(prop.x, 0, prop.z, 0.35, 0.7, 0.35, [0.90, 0.20, 0.20]);
    else plain.box(prop.x, 0, prop.z, 0.9, 0.9, 0.9, prop.color);
  }

  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    if (Math.cos(a) > 0.35) continue;
    const d = CITY_HALF + 130 + (i % 5) * 30;
    plain.box(Math.sin(a) * d, 0, Math.cos(a) * d, 34, 40 + (i * 37) % 70, 34, [0.58, 0.65, 0.72]);
  }

  const lampHeads = new Builder();
  for (const light of city.lights) lampHeads.box(light.x, 5.2, light.z, 0.55, 0.3, 0.55, [1, 0.85, 0.50]);

  return {
    plain: plain.build(R), road: road.build(R), walk: walk.build(R),
    tex: facades.map((b) => b.build(R)), lampDots: lampHeads.build(R),
    signs: city.signs, lights: city.lights,
  };
}
let MESHES = buildCityMeshes(S);

// ---- particles and skid marks --------------------------------------------

const particles = [];
function spawnParticle(x, y, z, vx, vy, vz, life, size, color, grav = 0) {
  if (particles.length > 420) particles.shift();
  particles.push({ x, y, z, vx, vy, vz, life, maxLife: life, size, color, grav });
}
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    if (pt.life <= 0) { particles.splice(i, 1); continue; }
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
    pt.vy -= pt.grav * dt;
    if (pt.y < 0.06) pt.y = 0.06;
  }
}
const skids = [];

// ---- entity drawing --------------------------------------------------------

function drawCar(s, car, t, isPlayerCar) {
  const x = car.x, z = car.z, ry = car.ry;
  const phys = car.phys;
  const pitchB = phys ? -phys.pitch : (car._dispA || 0) * 0.002;
  const rollB = phys ? phys.roll : clamp(-(car.steer || 0) * 0.03, -0.04, 0.04);
  R.box(x, 0.16, z, ry, 2.6, 0.06, 4.4, [0.03, 0.02, 0.05], { alpha: 0.30 });
  R.box(x, 0.18, z, ry, 2.3, 0.05, 4.0, [0.04, 0.03, 0.07], { alpha: 0.35 });
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  const style = car.kind === 'cop' ? 'police' : (car.style || 'sedan');
  if (car.kind === 'cop') {
    const redOn = Math.floor(t * 5 + car.id) % 2 === 0;
    R.box(x + fx * 0.5, 0.10, z + fz * 0.5, ry, 3.4, 0.04, 5.2, redOn ? [1, 0.07, 0.13] : [0.07, 0.40, 1], { alpha: 0.26 });
  }
  const paint = car.exploded ? [0.15, 0.14, 0.16] : car.color;
  const glass = [0.13, 0.18, 0.24], trim = [0.08, 0.08, 0.10];
  const part = (f, r, y, w, h, d, color, o = {}) => {
    R.box(x + fx * f + rx * r, y, z + fz * f + rz * r, ry, w, h, d, color, { pitch: pitchB, roll: rollB, ...o });
  };
  const steerVis = isPlayerCar && phys ? phys.steerAngle : (car.steer || 0) * 0.4;
  car._spin = (car._spin || 0) + (car.speed || 0) * 0.09;
  const wheels = (rF, rR, wdt, fOff, rOff) => {
    for (const [side, along, front] of [[-1, fOff, 1], [1, fOff, 1], [-1, -rOff, 0], [1, -rOff, 0]]) {
      const rad = front ? rF : rR;
      const wx = x + rx * side * 0.92 + fx * along;
      const wz = z + rz * side * 0.92 + fz * along;
      const heading = ry + (front ? steerVis : 0);
      R.box(wx, rad, wz, heading, wdt, rad * 2, rad * 2, [0.05, 0.05, 0.07], { roll: car._spin });
      R.box(wx + rx * side * 0.16, rad, wz + rz * side * 0.16, heading, 0.05, rad * 1.15, rad * 1.15, [0.75, 0.76, 0.80], { roll: car._spin });
    }
  };
  const headTint = Math.sin(t * 47 + car.id) > 0 ? [1, 0.95, 0.75] : [0.90, 0.85, 0.60];
  const tailTint = [1, 0.15, 0.20];

  if (style === 'sport') {
    part(0, 0, 0.36, 1.95, 0.52, 4.4, paint);
    part(1.62, 0, 0.60, 1.85, 0.30, 1.25, paint, { pitch: pitchB + 0.14 });
    if (!isPlayerCar) { part(-0.55, 0, 0.86, 1.62, 0.46, 1.70, glass); part(-0.55, 0, 1.12, 1.50, 0.07, 1.40, paint); }
    part(-1.72, 0, 0.70, 1.85, 0.18, 0.90, paint);
    part(-2.02, -0.6, 0.92, 0.08, 0.20, 0.30, trim);
    part(-2.02, 0.6, 0.92, 0.08, 0.20, 0.30, trim);
    part(-2.06, 0, 1.05, 1.90, 0.06, 0.42, paint);
    wheels(0.33, 0.37, 0.30, 1.42, 1.42);
    part(2.18, -0.62, 0.48, 0.42, 0.13, 0.08, headTint, { emissive: true });
    part(2.18, 0.62, 0.48, 0.42, 0.13, 0.08, headTint, { emissive: true });
    part(-2.18, 0, 0.58, 1.70, 0.12, 0.08, tailTint, { emissive: true });
  } else if (style === 'police') {
    const white = [0.94, 0.94, 0.96], black = [0.07, 0.07, 0.09];
    part(0, 0, 0.42, 1.90, 0.62, 4.30, white);
    part(0.10, 0, 0.44, 1.93, 0.42, 2.30, black);
    part(1.58, 0, 0.76, 1.80, 0.10, 1.05, white, { pitch: pitchB + 0.08 });
    if (!isPlayerCar) { part(-0.15, 0, 1.02, 1.70, 0.55, 2.10, glass); part(-0.15, 0, 1.33, 1.60, 0.08, 1.90, white); }
    part(2.28, 0, 0.45, 0.35, 0.50, 0.18, black);
    const redOn = Math.floor(t * 5 + car.id) % 2 === 0;
    const red = [1, 0.07, 0.13], blue = [0.07, 0.40, 1], dark = [0.30, 0.30, 0.35];
    part(0, -0.34, 1.46, 0.62, 0.16, 0.42, redOn ? red : dark, { emissive: true });
    part(0, 0.34, 1.46, 0.62, 0.16, 0.42, redOn ? dark : blue, { emissive: true });
    part(0, -0.34, 1.80, 1.15, 0.50, 0.75, red, { emissive: true, alpha: redOn ? 0.34 : 0.05, add: true });
    part(0, 0.34, 1.80, 1.15, 0.50, 0.75, blue, { emissive: true, alpha: redOn ? 0.05 : 0.34, add: true });
    wheels(0.34, 0.34, 0.28, 1.40, 1.40);
    part(2.16, -0.6, 0.55, 0.40, 0.20, 0.10, headTint, { emissive: true });
    part(2.16, 0.6, 0.55, 0.40, 0.20, 0.10, headTint, { emissive: true });
    part(-2.16, -0.6, 0.55, 0.40, 0.20, 0.10, tailTint, { emissive: true });
    part(-2.16, 0.6, 0.55, 0.40, 0.20, 0.10, tailTint, { emissive: true });
  } else {
    part(0, 0, 0.42, 1.90, 0.62, 4.30, paint);
    part(1.58, 0, 0.76, 1.80, 0.10, 1.05, paint, { pitch: pitchB + 0.08 });
    part(-1.98, 0, 0.78, 1.80, 0.12, 0.45, paint);
    if (!isPlayerCar) { part(-0.15, 0, 1.02, 1.70, 0.55, 2.10, glass); part(-0.15, 0, 1.33, 1.60, 0.08, 1.90, paint); }
    part(2.14, 0, 0.32, 1.86, 0.22, 0.14, trim);
    part(-2.14, 0, 0.32, 1.86, 0.22, 0.14, trim);
    if (style === 'taxi') {
      part(0, 0, 0.52, 1.93, 0.13, 3.10, [0.12, 0.12, 0.14]);
      part(-0.15, 0, 1.48, 0.72, 0.20, 0.34, [1, 0.85, 0.40], { emissive: true });
    }
    wheels(0.34, 0.34, 0.28, 1.40, 1.40);
    part(2.16, -0.6, 0.55, 0.40, 0.20, 0.10, headTint, { emissive: true });
    part(2.16, 0.6, 0.55, 0.40, 0.20, 0.10, headTint, { emissive: true });
    part(-2.16, -0.6, 0.55, 0.40, 0.20, 0.10, tailTint, { emissive: true });
    part(-2.16, 0.6, 0.55, 0.40, 0.20, 0.10, tailTint, { emissive: true });
  }
  if ((car.speed || 0) > 1 || isPlayerCar) R.box(x + fx * 3.4, 0.35, z + fz * 3.4, ry, 2.6, 0.5, 2.6, [1, 0.95, 0.70], { alpha: 0.08 });
  if (car.smoke === 1) spawnParticle(x, 1.2, z, 0, 1.6, 0, 0.8, 0.7, [0.55, 0.55, 0.60]);
  else if (car.smoke === 2) {
    spawnParticle(x, 1.2, z, 0, 2.2, 0, 0.9, 0.9, [0.25, 0.20, 0.22]);
    if (Math.random() < 0.4) spawnParticle(x, 1.0, z, 0, 1.4, 0, 0.4, 0.6, [1, 0.45, 0.10]);
  }
}

// The cockpit. Its layout is a contract: left-hand drive, wheel centre
// a third of the frame wide, the gauge panel sunk in the driver-side
// dash face with its top edge in the bottom quarter, the mirror up in
// the top band, and the body-coloured bonnet over the dash line.
const DASH_DARK = [0.13, 0.14, 0.17];
const DASH_MID = [0.19, 0.21, 0.26];
function drawCockpit(s, car) {
  void s;
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const at = (f, r, y) => [car.x + fx * f + rx * r, y, car.z + fz * f + rz * r];
  const piece = (f, r, y, w, h, d, color, o = {}) => { const q = at(f, r, y); R.box(q[0], q[1], q[2], car.ry, w, h, d, color, o); };
  piece(1.80, -0.2, 0.90, 2.3, 0.10, 1.15, car.color || [0.7, 0.2, 0.3]);
  piece(1.15, -0.2, 0.79, 4.4, 0.46, 0.36, DASH_DARK);
  piece(1.22, -0.2, 0.95, 4.4, 0.14, 0.24, DASH_MID);
  piece(0.955, 0.45, 0.97, 0.95, 0.02, 0.012, [0.62, 0.64, 0.68]);
  piece(0.945, -0.02, 0.778, 0.74, 0.36, 0.07, [0.09, 0.09, 0.11]);
  // The gauge panel is yawed half a turn so its painted face looks
  // back at the driver instead of showing its mirrored back.
  { const q = at(0.90, -0.02, 0.778); R.panel(q[0], q[1], q[2], car.ry + Math.PI, 0.64, 0.30, 'dash', { pitch: -0.21 }); }
  piece(1.02, -0.02, 1.00, 0.86, 0.06, 0.32, DASH_DARK, { pitch: -0.38 });
  const wheelRoll = -(car.phys ? car.phys.steerAngle : 0) * 3.2;
  const centre = at(0.80, -0.05, 0.84);
  const onWheel = (dx, dy) => {
    const c = Math.cos(wheelRoll), sn = Math.sin(wheelRoll);
    const lx = dx * c - dy * sn, ly = dx * sn + dy * c;
    return [centre[0] + rx * lx, centre[1] + ly, centre[2] + rz * lx];
  };
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const q = onWheel(Math.cos(a) * 0.14, Math.sin(a) * 0.14);
    R.box(q[0], q[1], q[2], car.ry, 0.085, 0.03, 0.032, [0.20, 0.20, 0.23], { pitch: -0.32, roll: wheelRoll + a + Math.PI / 2 });
  }
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const q = onWheel(Math.cos(a) * 0.082, Math.sin(a) * 0.082);
    R.box(q[0], q[1], q[2], car.ry, 0.115, 0.026, 0.04, [0.30, 0.30, 0.34], { pitch: -0.32, roll: wheelRoll + a });
  }
  { const q = onWheel(0, 0); R.box(q[0], q[1], q[2], car.ry, 0.10, 0.10, 0.06, [0.22, 0.22, 0.26], { pitch: -0.32, roll: wheelRoll }); }
  { const q = onWheel(0, 0); R.box(q[0], q[1], q[2], car.ry, 0.055, 0.055, 0.07, [0.32, 0.32, 0.37], { pitch: -0.32, roll: wheelRoll }); }
  piece(0.58, -0.05, 0.70, 0.08, 0.08, 0.42, [0.09, 0.09, 0.11], { pitch: -0.32 });
  piece(1.16, 1.04, 1.42, 0.11, 1.30, 0.055, DASH_DARK, { pitch: -0.18, roll: 0.30 });
  piece(1.16, -1.72, 1.42, 0.11, 1.30, 0.055, DASH_DARK, { pitch: -0.18, roll: -0.30 });
  piece(1.24, -0.35, 2.00, 3.6, 0.10, 0.12, [0.08, 0.085, 0.10]);
  piece(1.24, -0.32, 1.965, 0.03, 0.075, 0.03, [0.07, 0.07, 0.09]);
  piece(1.26, -0.32, 1.90, 0.34, 0.105, 0.035, [0.07, 0.07, 0.09]);
  piece(1.235, -0.32, 1.90, 0.30, 0.08, 0.012, [0.15, 0.21, 0.29], { emissive: true });
  piece(1.23, -0.32, 1.90, 0.13, 0.010, 0.014, [0.55, 0.65, 0.78], { emissive: true, roll: 0.45 });
  piece(0.35, 0.18, 0.42, 0.42, 0.30, 1.10, DASH_DARK);
  piece(0.55, 0.18, 0.60, 0.07, 0.16, 0.07, [0.20, 0.20, 0.24]);
}

const GUN_SHAPES = {
  shotgun: { body: 0.62, bodyW: 0.11, barrel: 0.40, barrelW: 0.07, mag: 0 },
  rifle: { body: 0.58, bodyW: 0.08, barrel: 0.38, barrelW: 0.045, mag: 0.16 },
  smg: { body: 0.42, bodyW: 0.09, barrel: 0.22, barrelW: 0.05, mag: 0.19 },
  pistol: { body: 0.46, bodyW: 0.09, barrel: 0.26, barrelW: 0.05, mag: 0 },
};
function drawWeaponView(s, eye, yaw, pitch, lowered = false) {
  const dir = viewDir(yaw, pitch);
  const rxv = Math.cos(yaw), rzv = -Math.sin(yaw);
  const aiming = s.player.aim && !lowered;
  const kick = (s.recoil || 0) * 0.03;
  const side = aiming ? 0 : 0.23;
  const fwd = (aiming ? 0.62 : 0.58) - kick;
  const down = lowered ? -0.5 : (aiming ? -0.20 : -0.30) + kick * 0.6;
  const gx = eye[0] + dir[0] * fwd + rxv * side;
  const gy = eye[1] + dir[1] * fwd + down;
  const gz = eye[2] + dir[2] * fwd + rzv * side;
  const key = s.weapon === 'shotgun' && s.hasShotgun ? 'shotgun'
    : s.weapon === 'rifle' && s.hasRifle ? 'rifle'
    : s.weapon === 'smg' && s.hasSmg ? 'smg' : 'pistol';
  const shape = GUN_SHAPES[key];
  R.box(gx, gy, gz, yaw, shape.bodyW, 0.15, shape.body, [0.10, 0.10, 0.12], { pitch });
  R.box(gx + dir[0] * 0.3, gy + dir[1] * 0.3 + 0.02, gz + dir[2] * 0.3, yaw, shape.barrelW, shape.barrelW, shape.barrel, [0.16, 0.16, 0.18], { pitch });
  if (shape.mag) R.box(gx + dir[0] * 0.05, gy - 0.13, gz + dir[2] * 0.05, yaw, 0.06, shape.mag, 0.09, [0.13, 0.13, 0.15], { pitch });
  if ((s.flashT || 0) > 0) {
    const gap = 0.3 + shape.barrel * 0.5 + 0.06;
    const mx = gx + dir[0] * gap, my = gy + dir[1] * gap + 0.02, mz = gz + dir[2] * gap;
    R.box(mx, my, mz, yaw, 0.30, 0.07, 0.07, [1, 0.80, 0.35], { pitch });
    R.box(mx, my, mz, yaw, 0.07, 0.30, 0.07, [1, 0.80, 0.35], { pitch });
    R.box(mx, my, mz, yaw, 0.12, 0.12, 0.12, [1, 0.98, 0.90], { pitch });
    R.box(gx + dir[0] * 6.4, gy + dir[1] * 6.4 + 0.02, gz + dir[2] * 6.4, yaw, 0.035, 0.035, 11.5, [1, 0.80, 0.35], { pitch, alpha: 0.75 });
  }
  R.box(gx - dir[0] * 0.08 + rxv * 0.02, gy - 0.13, gz - dir[2] * 0.08 + rzv * 0.02, yaw, 0.15, 0.11, 0.20, [0.92, 0.76, 0.60], { pitch });
  if (!aiming) R.box(gx - dir[0] * 0.22 + rxv * 0.1, gy - 0.30, gz - dir[2] * 0.22 + rzv * 0.1, yaw, 0.12, 0.12, 0.34, [0.97, 0.87, 0.72], { pitch: pitch + 0.5 });
}

function drawPerson(s, x, z, ry, color, o = {}) {
  void s;
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  R.box(x, 0.02, z, ry, 0.8, 0.04, 0.8, [0.03, 0.02, 0.05], { alpha: 0.30 });
  if (o.dead) { R.box(x, 0.12, z, ry, 0.55, 0.25, 1.6, color); return; }
  const swing = Math.sin(o.walkPhase || 0) * 0.3;
  const pants = o.pants || [0.22, 0.24, 0.34], skin = o.skin || [0.92, 0.76, 0.60];
  R.box(x - fx * swing * 0.4 - rx * 0.11, 0.40, z - fz * swing * 0.4 - rz * 0.11, ry, 0.19, 0.80, 0.23, pants, { pitch: swing * 0.7 });
  R.box(x + fx * swing * 0.4 + rx * 0.11, 0.40, z + fz * swing * 0.4 + rz * 0.11, ry, 0.19, 0.80, 0.23, pants, { pitch: -swing * 0.7 });
  R.box(x, 1.10, z, ry, 0.55, 0.65, 0.30, color);
  const armY = o.handsUp ? 1.95 : 1.15, armPitch = o.handsUp ? 0.4 : swing * 0.55;
  R.box(x - rx * 0.36 + fx * swing * 0.18, armY, z - rz * 0.36 + fz * swing * 0.18, ry, 0.14, 0.60, 0.16, color, { pitch: -armPitch });
  R.box(x + rx * 0.36 - fx * swing * 0.18, armY, z + rz * 0.36 - fz * swing * 0.18, ry, 0.14, 0.60, 0.16, color, { pitch: armPitch });
  R.box(x, 1.62, z, ry, 0.34, 0.36, 0.34, skin);
  if (o.gun) R.box(x + fx * 0.4, 1.25, z + fz * 0.4, ry, 0.08, 0.12, 0.45, [0.08, 0.08, 0.10]);
}

function drawHeli(s, t) {
  const heli = s.heli, p = s.player;
  const x = heli.x, z = heli.z, y = heli.h || 28;
  const ry = heli.ry != null ? heli.ry : Math.atan2(p.x - x, p.z - z);
  const pose = { pitch: -0.26, roll: 0.17 };
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  const hull = [0.32, 0.35, 0.44], dark = [0.22, 0.24, 0.31];
  R.box(x, y, z, ry, 2.6, 2.2, 6.4, hull, pose);
  R.box(x - rx * 1.35, y - 0.1, z - rz * 1.35, ry, 0.20, 0.20, 0.20, [1, 0.10, 0.15], { emissive: true });
  R.box(x + rx * 1.35, y - 0.1, z + rz * 1.35, ry, 0.20, 0.20, 0.20, [0.15, 1, 0.35], { emissive: true });
  R.box(x - fx * 7.9, y + 1.1, z - fz * 7.9, ry, 0.16, 0.16, 0.16, [1, 1, 1], { emissive: true });
  R.box(x, y - 0.2, z, ry, 2.65, 0.5, 6.0, [0.92, 0.92, 0.95], pose);
  R.box(x, y + 0.25, z, ry, 2.2, 1.1, 2.0, [0.65, 0.80, 0.92], { emissive: true, ...pose });
  R.box(x - fx * 5.4, y + 0.6, z - fz * 5.4, ry, 0.55, 0.8, 5.0, dark, pose);
  R.box(x - fx * 7.8, y + 1.1, z - fz * 7.8, ry, 0.2, 1.7, 1.2, dark, pose);
  R.box(x, y + 1.5, z, ry, 13.5, 0.05, 13.5, [0.10, 0.10, 0.12], { alpha: 0.28, ...pose });
  const spin = t * 42;
  R.box(x, y + 1.52, z, spin, 13.5, 0.07, 0.55, [0.12, 0.12, 0.16], { alpha: 0.45 });
  R.box(x, y + 1.52, z, spin + Math.PI / 2, 13.5, 0.07, 0.55, [0.12, 0.12, 0.16], { alpha: 0.45 });
  R.box(x - fx * 7.8, y + 1.1, z - fz * 7.8, ry, 1.8, 0.13, 0.32, [0.15, 0.15, 0.19], { roll: t * 55 });
  R.box(x - fx * 1.6, y - 1.45, z - fz * 1.6, ry, 3.0, 0.18, 0.34, [0.30, 0.30, 0.34], pose);
  const target = s.spotTarget || p;
  const sx = x, sy = y - 1.3, sz = z;
  const dx = target.x - sx, dz = target.z - sz;
  const beamLen = Math.hypot(dx, dz, sy);
  const beamYaw = Math.atan2(dx, dz);
  const beamTilt = Math.atan2(Math.hypot(dx, dz), sy);
  for (const [frac, wdt] of [[0.18, 1.5], [0.5, 3.6], [0.82, 6.2]]) {
    R.box(sx + dx * frac, sy * (1 - frac) + 0.3, sz + dz * frac, beamYaw, wdt, beamLen / 3.1, wdt, [1, 0.97, 0.82], { alpha: 0.15, pitch: -beamTilt, add: true });
  }
  R.panel(target.x, 0.07, target.z, 0, 11.5, 11.5, 'pool', { pitch: -Math.PI / 2, alpha: 0.6, add: true });
  R.box(target.x, 0.09, target.z, 0, 3.8, 0.05, 3.8, [1, 1, 0.95], { alpha: 0.30, add: true });
}

// ---- render -----------------------------------------------------------------

let frameNo = 0;
let lastDt = 1 / 60;
function renderFrame(s, t) {
  const [vw, vh] = R.resize();
  const p = s.player, car = p.inCar;
  let cam;
  if (car) cam = rig.cockpit(s, car, lookYaw, lookPitch, t, lastDt);
  else if (shotKind === 'start') {
    const dir = viewDir(s.camYaw, lookPitch);
    cam = { eye: [p.x, 1.72, p.z], center: [p.x + dir[0] * 10, 1.72 + dir[1] * 10, p.z + dir[2] * 10], up: [0, 1, 0], fov: 75 * Math.PI / 180, yaw: s.camYaw, pitch: lookPitch };
  } else cam = rig.foot(s, s.camYaw, lookPitch, t);
  const proj = mat4Perspective(cam.fov, vw / vh, 0.05, 900);
  const view = mat4LookAt(cam.eye, cam.center, cam.up);
  const dusk = s.shotMode === 'chase';
  R.zen = dusk ? [0.15, 0.13, 0.36] : [0.42, 0.66, 0.92];
  R.mid = dusk ? [0.60, 0.30, 0.24] : [0.98, 0.78, 0.58];
  R.horizon = dusk ? [0.82, 0.36, 0.15] : [1.0, 0.70, 0.47];
  R.fogColor = dusk ? [0.48, 0.30, 0.30] : [0.99, 0.80, 0.62];
  R.ambScale = dusk ? 0.62 : 1.0;
  R.begin(view, proj, cam.eye);
  R.draw(MESHES.plain, IDENTITY);
  R.draw(MESHES.road, IDENTITY, { tex: 'road' });
  R.draw(MESHES.walk, IDENTITY, { tex: 'walk' });
  for (let i = 0; i < 4; i++) R.draw(MESHES.tex[i], IDENTITY, { tex: dusk ? 'b4' : 'b' + i });
  R.draw(MESHES.lampDots, IDENTITY, { emissive: true });
  for (const sign of MESHES.signs) R.box(sign.x, sign.y, sign.z, sign.ry, sign.w, sign.h, 0.18, sign.color, { emissive: true });
  for (const light of MESHES.lights) R.box(light.x, 4.4, light.z, 0, 2.6, 0.05, 2.6, [1, 0.80, 0.45], { alpha: 0.10 });
  for (const key of ['gunshop', 'hospital', 'spray', 'contact', 'harbor']) {
    const zone = s.city.zones[key];
    R.box(zone.x, 2.2, zone.z, t * 0.4, 0.5, 4.4, 0.5, zone.color, { alpha: 0.30, emissive: true });
    R.box(zone.x, 4.6, zone.z, 0, 1.6, 0.5, 1.6, zone.color, { emissive: true });
  }
  const objective = (s.mission && s.mission.target) || (s.taxi && s.taxi.target);
  if (objective) R.box(objective.x, 2.4, objective.z, t * 0.6, 0.7, 4.8, 0.7, [1, 0.90, 0.30], { alpha: 0.4, emissive: true });
  for (const pk of s.pickups) R.box(pk.x, 0.5 + Math.sin(t * 3) * 0.12, pk.z, t * 1.5, 0.55, 0.35, 0.4, [0.15, 0.90, 0.35], { emissive: true });
  for (const tg of s.targets || []) if (!tg.down) R.box(tg.x, 0.75, tg.z, 0, 0.7, 1.5, 0.25, [1, 0.25, 0.30], { emissive: true });
  if (s.boss && !s.boss.done) drawPerson(s, s.boss.x, s.boss.z, Math.PI, [0.20, 0.20, 0.22], { walkPhase: 0 });
  for (const mark of skids) R.box(mark.x, 0.045, mark.z, mark.ry, 0.32, 0.015, mark.len, [0.05, 0.05, 0.07], { alpha: 0.5 });
  for (const c of s.cars) drawCar(s, c, t, c === car);
  for (const c of s.cops) if (c !== car) drawCar(s, c, t, false);
  if (s.heli) drawHeli(s, t);
  for (const c of s.cars.concat(s.cops)) {
    if (c.burning > 0) {
      spawnParticle(c.x, 1.1, c.z, (Math.random() - 0.5) * 1.4, 2.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4, 0.5, 0.75, [1, 0.50, 0.12]);
      spawnParticle(c.x, 1.3, c.z, 0, 1.8, 0, 0.8, 0.9, [0.30, 0.28, 0.30]);
    }
  }
  for (const ped of s.peds) {
    const rate = ped.state === 'dead' ? 0 : ped.state === 'flee' ? 11 : 6;
    ped._phase = (ped._phase || 0) + rate * lastDt * ((ped.speed || 0) / 1.4);
    drawPerson(s, ped.x, ped.z, ped.ry, ped.color, {
      walkPhase: ped._phase, dead: ped.state === 'dead',
      handsUp: ped.state === 'handsup' || ped.state === 'robbed',
      pants: ped.pants, skin: ped.skin,
    });
  }
  for (const pt of particles) {
    const fade = clamp(pt.life / pt.maxLife, 0, 1) * 0.55;
    R.box(pt.x, pt.y, pt.z, pt.x * 7 + pt.z, pt.size, pt.size, pt.size, pt.color, { alpha: fade });
  }
  if (car) drawCockpit(s, car);
  else if (s.hasGun && s.mode !== 'title') drawWeaponView(s, cam.eye, cam.yaw, cam.pitch, shotKind === 'start');
  if (frameNo % 6 === 0 && car) drawDashTexture(R.gl, R.textures.dash, Math.abs(car.speed || 0) * 2.23694, car.rpm || 0.1);
}

// ---- input --------------------------------------------------------------------

const keys = {};
let lookYaw = 0, lookPitch = 0;
let mouseDX = 0, mouseDY = 0, mouseLeft = false, mouseRight = false;
let lastLookAt = 0;
let wantShoot = false, wantEnter = false, wantInteract = false, wantTaxi = false, wantReload = false;

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
  if (e.code === 'KeyR') {
    if (S.player.inCar) {
      S.radio = (S.radio + 1) % 3;
      S.msg = S.radio === 0 ? 'RADIO OFF' : S.radio === 1 ? 'RADIO · VICE FM' : 'RADIO · SOLMAR';
      S.msgT = 1.6;
    } else wantReload = true;
  }
  if (e.code === 'Digit1' && S.hasGun) S.weapon = 'pistol';
  if (e.code === 'Digit2' && S.hasSmg) S.weapon = 'smg';
  if (e.code === 'Digit3' && S.hasShotgun) S.weapon = 'shotgun';
  if (e.code === 'Digit4' && S.hasRifle) S.weapon = 'rifle';
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
  if (!shotKind && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});
addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouseLeft = true; wantShoot = true; }
  if (e.button === 2) mouseRight = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseLeft = false;
  if (e.button === 2) mouseRight = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    mouseDX += e.movementX; mouseDY += e.movementY;
    lastLookAt = performance.now();
  }
});

function pollInput() {
  return {
    up: !!(keys.KeyW || keys.ArrowUp),
    down: !!(keys.KeyS || keys.ArrowDown),
    left: !!(keys.KeyA || keys.ArrowLeft),
    right: !!(keys.KeyD || keys.ArrowRight),
    shift: !!(keys.ShiftLeft || keys.ShiftRight),
    handbrake: !!keys.Space,
    aim: mouseRight,
    interact: wantInteract, reload: wantReload, enter: wantEnter, taxi: wantTaxi,
  };
}

function playerNearCar(state) {
  const p = state.player;
  if (p.inCar) return false;
  for (const c of state.cars.concat(state.cops)) {
    if (dist2(c.x, c.z, p.x, p.z) < 4.5 * 4.5) return true;
  }
  return false;
}

// ---- events to sound and sparks ------------------------------------------------

function dispatchEvents(s) {
  for (const ev of drainEvents(s)) {
    switch (ev.name) {
      case 'shot': {
        audio.shot();
        const p = s.player, fx = Math.sin(p.ry), fz = Math.cos(p.ry);
        spawnParticle(p.x + fx * 0.7, 1.45, p.z + fz * 0.7, fx * 2, 0.4, fz * 2, 0.12, 0.3, [1, 0.80, 0.30]);
        for (let i = 0; i < 3; i++) spawnParticle(p.x + fx * 0.8, 1.3, p.z + fz * 0.8, fx + (Math.random() - 0.5), Math.random(), fz + (Math.random() - 0.5), 0.5, 0.18, [0.7, 0.7, 0.72]);
        break;
      }
      case 'targetDown': audio.beep(1200, 0.1, 'square', 0.14); s.msg = 'TARGET DOWN'; s.msgT = 1; break;
      case 'dryFire': audio.beep(200, 0.05, 'square', 0.08); s.msg = 'EMPTY — R TO RELOAD'; s.msgT = 1.2; break;
      case 'hitPed': audio.noiseBurst(0.15, 0.3, 500); break;
      case 'crash': case 'ram': audio.crash(ev.data || 8); break;
      case 'explode': {
        audio.noiseBurst(0.8, 0.7, 220);
        const src = ev.data || s.player;
        for (let i = 0; i < 30; i++) {
          spawnParticle(src.x, 1 + Math.random(), src.z, (Math.random() - 0.5) * 9, 2 + Math.random() * 5, (Math.random() - 0.5) * 9, 0.7 + Math.random() * 0.5, 1.1, i % 3 ? [1, 0.55, 0.15] : [0.35, 0.30, 0.30]);
        }
        break;
      }
      case 'roadblock': s.msg = 'ROADBLOCK AHEAD'; s.msgT = 1.6; break;
      case 'heli': s.msg = 'AIR UNIT INBOUND'; s.msgT = 2; break;
      case 'cash': case 'pickup': case 'missionDone': audio.cash(); break;
      case 'robDrop': s.msg = 'WALLET DROPPED — GRAB IT'; s.msgT = 2; break;
      case 'buyGun': audio.cash(); s.msg = 'WEAPON PURCHASED — 1-4 TO SWITCH'; s.msgT = 2.6; break;
      case 'spray': audio.beep(520, 0.3, 'sawtooth', 0.1); s.msg = "PAY 'N SPRAY — HEAT CLEARED, FRESH PAINT"; s.msgT = 2.5; break;
      case 'wanted': s.msg = ev.data > 0 ? 'WANTED ' + '★'.repeat(ev.data) : 'HEAT LOST'; s.msgT = 2; break;
      case 'missionFail': audio.beep(160, 0.4, 'sawtooth', 0.15); break;
      case 'save': saveProfile(s); break;
      default: break;
    }
  }
}

// ---- shot staging -----------------------------------------------------------------

function prepareShot(kind) {
  const staged = setupShotScene(S, kind);
  rig.fovPunch = 78 * Math.PI / 180;
  lookPitch = kind === 'start' ? -0.03 : 0.02;
  for (const mark of staged.skids) skids.push(mark);
  for (const puff of staged.puffs) spawnParticle(puff.x, puff.y, puff.z, puff.vx, puff.vy, puff.vz, puff.life, puff.size, puff.color);
  if (staged.barriers && staged.barriers.length) {
    for (const bp of staged.barriers) S.city.props.push(bp);
    MESHES = buildCityMeshes(S);
  }
  document.getElementById('help').style.display = 'none';
  if (kind === 'chase') ui.vignette.style.opacity = '0.85';
}

function seedShotPhysics() {
  const car = S.player.inCar;
  if (!car) return;
  car.phys = new VehiclePhysics();
  if (shotKind === 'play') {
    car.phys.u = 38.5; car.phys.steerAngle = 0.10;
    car.speed = 38.5; car.rpm = 0.92; car.gear = 5;
  } else if (shotKind === 'chase') {
    car.phys.u = 23.2; car.phys.steerAngle = 0.30; car.phys.v = -15.7; car.phys.omega = 0.4;
    car.speed = 23.2; car.rpm = 0.8; car.gear = 4; car.slip = 14; car.isDrifting = true;
  }
}

if (shotKind) { prepareShot(shotKind); seedShotPhysics(); }

// ---- road feel -----------------------------------------------------------------------

function computeRoadJolt(s) {
  const car = s.player.inCar;
  if (!car) { s.roadJolt = 0; return; }
  let nearest = Infinity;
  for (const c of roadCenters()) nearest = Math.min(nearest, Math.abs(car.x - c), Math.abs(car.z - c));
  let jolt = 0;
  const spd = Math.abs(car.speed || 0);
  if (spd > 4) {
    if (nearest > 6.1 && nearest < 9.5) jolt += Math.sin(s.time * 43) * 0.016;
    const seamX = Math.abs(((car.x % 23) + 23) % 23 - 11.5);
    const seamZ = Math.abs(((car.z % 23) + 23) % 23 - 11.5);
    if (Math.min(seamX, seamZ) > 10.6) jolt += Math.sin(s.time * 34) * 0.02 * clamp(spd / 14, 0, 1);
  }
  s.roadJolt = jolt;
}

// ---- the loop --------------------------------------------------------------------------

let prevStamp = performance.now();
let shotFrames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - prevStamp) / 1000 || 0.016);
  prevStamp = now; lastDt = dt; frameNo++;
  if (!shotKind) {
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
    if (S.player.inCar && performance.now() - lastLookAt > 1400) {
      lookYaw *= Math.exp(-dt * 2.2);
      lookPitch *= Math.exp(-dt * 2.2);
    }
    if (S.mode === 'play') {
      if (!S.player.inCar && (wantShoot || (mouseLeft && weaponDef(S).auto))) shoot(S);
      step(S, pollInput(), dt);
      const car = S.player.inCar;
      if (car && car.isDrifting && Math.abs(car.speed) > 5) {
        skids.push({ x: car.x, z: car.z, ry: car.ry, len: 2.2 });
        if (skids.length > 240) skids.shift();
        const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
        for (let i = 0; i < 2; i++) {
          spawnParticle(car.x - fx * 1.6, 0.4, car.z - fz * 1.6, (Math.random() - 0.5) * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2, 0.9, 0.8, [0.82, 0.82, 0.86]);
        }
      }
      if (car && (car.slip || 0) > 1.1 && Math.abs(car.speed) > 5 && Math.random() < 0.6) {
        const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
        spawnParticle(car.x - fx * 1.6, 0.35, car.z - fz * 1.6, 0, 1, 0, 0.7, 0.7, [0.80, 0.80, 0.84]);
      }
      dispatchEvents(S);
      computeRoadJolt(S);
    }
    wantShoot = false; wantEnter = false; wantInteract = false; wantTaxi = false; wantReload = false;
    audio.frame(S);
  }
  stepParticles(shotKind ? 0 : dt);
  renderFrame(S, S.time);
  updateHUD(S, ui, playerNearCar);
  drawMinimap(S, mapCtx);
  const hot = shotKind === 'chase' || S.trauma > 0.25;
  ui.vignette.style.opacity = hot ? String(Math.min(0.85, 0.35 + (S.trauma || 0) * 0.5)) : '0';
  if (shotKind) { shotFrames++; if (shotFrames > 15) window.__shotReady = true; }
}
requestAnimationFrame(loop);
console.log('Vice Blocks 3D booted', shotKind ? `(shot=${shotKind} seed=${seedParam})` : '');
