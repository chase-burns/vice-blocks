// main.js — the presentation shell around the simulation: boot, the
// baked static city meshes, entity drawing (cars, the first-person
// cockpit, the gun viewmodel, people, the police helicopter), input
// handling, event-to-sound wiring, the render loop, and the
// deterministic screenshot harness. All rules live in src/game/; this
// file only draws and listens.
import { Renderer, mat4LookAt, mat4Perspective, mat4Identity } from './gl/renderer.js';
import { Builder } from './gl/mesh.js';
import { drawDashTexture } from './gl/textures.js';
import { clamp, dist2 } from './rng.js';
import { BLOCK, ROAD, CITY_HALF, roadCenters } from './game/world.js';
import { createState, step, drainEvents } from './game/state.js';
import { setupShotScene } from './game/shots.js';
import { enterExitCar, shoot, respawn, weaponDef } from './game/player.js';
import { startMission, startTaxi } from './game/missions.js';
import { CameraRig, viewDir } from './game/camera.js';
import { AudioEngine } from './game/audio.js';
import { drawMinimap, updateHUD } from './game/hud.js';
import { loadProfile, saveProfile } from './game/storage.js';
import { VehiclePhysics } from './game/physics.js';

const IDENTITY_MAT = mat4Identity();
const glCanvas = document.getElementById('gl');
const renderer = new Renderer(glCanvas);
const R = renderer;

const ELEMENT_IDS = [
  'hud', 'health', 'armor', 'cash', 'stars', 'weapon', 'banner', 'msg',
  'minimap', 'speed', 'bustbar', 'bustfill', 'overlay', 'ovTitle', 'ovSub',
  'ovFeat', 'ovSave', 'mission', 'dispatch', 'slots', 'district', 'timer',
  'prompt', 'vignette', 'speedfx', 'respectfill', 'rank',
];
const ui = {};
for (const id of ELEMENT_IDS) ui[id] = document.getElementById(id);
const mapCtx = ui.minimap.getContext('2d');

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') || '';
const seedValue = parseInt(params.get('seed') || '7', 10) || 7;

let S = createState(seedValue, shotMode ? null : loadProfile());
S.shotMode = shotMode;
if (!shotMode && S.missionIdx > 0 && S.missionIdx < 5) startMission(S);
const rig = new CameraRig();
const sound = new AudioEngine();

// The static world, baked once into a few large meshes: one untextured
// batch (road markings, palms, street props), one road batch, one
// sidewalk batch, and one batch per facade texture.
function bakeCityMeshes(state) {
  const city = state.city;
  const plainB = new Builder(), roadB = new Builder(), walkB = new Builder();
  const facadeBs = [new Builder(), new Builder(), new Builder(), new Builder()];
  city.buildings.forEach((b, bi) => {
    const batch = facadeBs[b.tex];
    batch.box(b.x, 0, b.z, b.w, b.h, b.d, [1, 1, 1], Math.max(1, Math.round(b.h / 14)));
    batch.box(b.x, b.h, b.z, b.w + 0.8, 1.0, b.d + 0.8, [0.92, 0.90, 0.86], 1);
    batch.box(b.x, b.h * 0.55, b.z, b.w + 0.5, 0.55, b.d + 0.5, [0.94, 0.92, 0.88], 1);
    batch.box(b.x, 0, b.z, b.w + 0.6, 1.4, b.d + 0.6, [0.9, 0.88, 0.84], 1);
    if (bi % 3 !== 0) {
      const balconies = 2 + (bi % 3);
      for (let k = 0; k < balconies; k++) {
        batch.box(b.x + b.w / 2 + 0.45, b.h * (0.3 + 0.18 * k), b.z - b.d / 4 + (k % 2) * b.d / 2, 0.9, 0.28, 2.6, [0.88, 0.86, 0.82], 1);
      }
    }
  });
  const lines = roadCenters();
  const extent = CITY_HALF + 40;
  for (const c of lines) {
    roadB.quad([c - ROAD / 2, 0.01, -extent], [c + ROAD / 2, 0.01, -extent], [c + ROAD / 2, 0.01, extent], [c - ROAD / 2, 0.01, extent], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    roadB.quad([-extent, 0.01, c - ROAD / 2], [extent, 0.01, c - ROAD / 2], [extent, 0.01, c + ROAD / 2], [-extent, 0.01, c + ROAD / 2], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    for (const side of [-1, 1]) {
      walkB.box(c + side * (ROAD / 2 + 1), 0, 0, 2, 0.18, extent * 2, [1, 1, 1]);
      walkB.box(0, 0, c + side * (ROAD / 2 + 1), extent * 2, 0.18, 2, [1, 1, 1]);
    }
    for (let t = -CITY_HALF - 30; t < CITY_HALF + 30; t += 6) {
      plainB.box(c, 0.03, t, 0.35, 0.02, 2.6, [0.95, 0.8, 0.25]);
      plainB.box(t, 0.03, c, 2.6, 0.02, 0.35, [0.95, 0.8, 0.25]);
    }
    for (const c2 of lines) for (let k = -3; k <= 3; k++) {
      plainB.box(c + k * 1.1, 0.035, c2 - ROAD / 2 + 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
      plainB.box(c + k * 1.1, 0.035, c2 + ROAD / 2 - 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
    }
  }
  plainB.box(0, -0.05, 0, (CITY_HALF + 42) * 2, 0.1, (CITY_HALF + 42) * 2, [0.66, 0.60, 0.50]);
  plainB.box(CITY_HALF + 120, -0.4, 0, 190, 0.1, (CITY_HALF + 60) * 2, [0.13, 0.72, 0.68]);
  plainB.box(CITY_HALF + 16, -0.02, 0, 26, 0.12, (CITY_HALF + 40) * 2, [0.93, 0.84, 0.62]);
  for (const palm of city.palms) {
    const sc = palm.s || 1, lean = palm.lean || 0.1;
    let tx = palm.x, tz = palm.z;
    for (let seg = 0; seg < 3; seg++) {
      plainB.box(tx, seg * 1.6 * sc, tz, 0.34 * sc, 1.7 * sc, 0.34 * sc, [0.52, 0.42, 0.30]);
      tx += lean * (seg + 1) * 0.55 * sc; tz += lean * 0.3 * sc;
    }
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
      plainB.box(tx + dx * 1.15 * sc, 4.95 * sc + 0.3, tz + dz * 1.15 * sc, 2.4 * sc, 0.08, 0.55 * sc, [0.18, 0.62, 0.33]);
      plainB.box(tx + dx * 2.2 * sc, 4.55 * sc + 0.3, tz + dz * 2.2 * sc, 1.3 * sc, 0.07, 0.45 * sc, [0.16, 0.56, 0.30]);
    }
  }
  for (const lamp of city.lights) plainB.box(lamp.x, 0, lamp.z, 0.18, 5.2, 0.18, [0.2, 0.2, 0.25]);
  for (const prop of city.props) {
    if (prop.kind === 'bin') plainB.box(prop.x, 0, prop.z, 0.6, 1.0, 0.6, [0.25, 0.5, 0.35]);
    else if (prop.kind === 'barrier') {
      plainB.box(prop.x, 0, prop.z, 1.8, 0.75, 0.3, [0.92, 0.92, 0.94]);
      plainB.box(prop.x, 0.42, prop.z + 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plainB.box(prop.x, 0.42, prop.z - 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plainB.box(prop.x, 0.75, prop.z, 0.24, 0.18, 0.24, [1, 0.55, 0.1]);
    } else if (prop.kind === 'hydrant') plainB.box(prop.x, 0, prop.z, 0.35, 0.7, 0.35, [0.9, 0.2, 0.2]);
    else plainB.box(prop.x, 0, prop.z, 0.9, 0.9, 0.9, prop.color);
  }
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2;
    if (Math.cos(ang) > 0.35) continue;
    const dist = CITY_HALF + 130 + (i % 5) * 30;
    plainB.box(Math.sin(ang) * dist, 0, Math.cos(ang) * dist, 34, 40 + (i * 37) % 70, 34, [0.58, 0.65, 0.72]);
  }
  const lampHeads = new Builder();
  for (const lamp of city.lights) lampHeads.box(lamp.x, 5.2, lamp.z, 0.55, 0.3, 0.55, [1, 0.85, 0.5]);
  return { plain: plainB.build(R), road: roadB.build(R), walk: walkB.build(R), tex: facadeBs.map((b) => b.build(R)), lampDots: lampHeads.build(R), signs: city.signs, lights: city.lights };
}
let MESHES = bakeCityMeshes(S);

const particles = [];
function emitParticle(x, y, z, vx, vy, vz, life, size, color, grav) {
  const g = grav || 0;
  if (particles.length > 420) particles.shift();
  particles.push({ x, y, z, vx, vy, vz, life, maxLife: life, size, color, grav: g });
}
function advanceParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    if (pt.life <= 0) { particles.splice(i, 1); continue; }
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
    pt.vy -= pt.grav * dt;
    if (pt.y < 0.06) pt.y = 0.06;
  }
}
function paintParticles() {
  for (const pt of particles) {
    const alpha = clamp(pt.life / pt.maxLife, 0, 1) * 0.55;
    R.box(pt.x, pt.y, pt.z, pt.x * 7 + pt.z, pt.size, pt.size, pt.size, pt.color, { alpha });
  }
}
const skidMarks = [];
function paintSkids() {
  for (const m of skidMarks) R.box(m.x, 0.045, m.z, m.ry, 0.32, 0.015, m.len, [0.05, 0.05, 0.07], { alpha: 0.5 });
}

// Cars are assembled from tinted boxes in car space, via a part helper
// that places boxes by (forward, right, height). Four body styles share
// the helper: the low sport coupe, the black-and-white police
// interceptor, the plain sedan, and the sedan wearing a taxi checker
// band and roof sign.
function paintCar(s, car, t, isPlayers) {
  const x = car.x, z = car.z, ry = car.ry;
  const phys = car.phys;
  const pitch = phys ? -phys.pitch : (car._dispA || 0) * 0.002;
  const roll = phys ? phys.roll : clamp(-(car.steer || 0) * 0.03, -0.04, 0.04);
  R.box(x, 0.16, z, ry, 2.6, 0.06, 4.4, [0.03, 0.02, 0.05], { alpha: 0.3 });
  R.box(x, 0.18, z, ry, 2.3, 0.05, 4.0, [0.04, 0.03, 0.07], { alpha: 0.35 });
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  const style = car.kind === 'cop' ? 'police' : (car.style || 'sedan');
  if (car.kind === 'cop') {
    const redTurn = Math.floor(t * 5 + car.id) % 2 === 0;
    R.box(x + fx * 0.5, 0.1, z + fz * 0.5, ry, 3.4, 0.04, 5.2, redTurn ? [1, 0.07, 0.13] : [0.07, 0.4, 1], { alpha: 0.26 });
  }
  const paintCol = car.kind === 'dead' ? [0.15, 0.14, 0.16] : car.color;
  const glass = [0.13, 0.18, 0.24], trim = [0.08, 0.08, 0.1];
  const part = (fwd, right, y, w, h, d, color, o) => {
    const opts = o || {};
    R.box(x + fx * fwd + rx * right, y, z + fz * fwd + rz * right, ry, w, h, d, color, { pitch, roll, ...opts });
  };
  const steerShown = car === s.player.inCar && car.phys ? car.phys.steerAngle : (car.steer || 0) * 0.4;
  car._spin = (car._spin || 0) + (car.speed || 0) * 0.09;
  const wheels = (rFront, rRear, width, offFront, offRear) => {
    const corners = [[-1, offFront, 1], [1, offFront, 1], [-1, -offRear, 0], [1, -offRear, 0]];
    for (const corner of corners) {
      const sideSign = corner[0], along = corner[1], isFront = corner[2];
      const radius = isFront ? rFront : rRear;
      const wx = x + rx * sideSign * 0.92 + fx * along;
      const wz = z + rz * sideSign * 0.92 + fz * along;
      const heading = ry + (isFront ? steerShown : 0);
      R.box(wx, radius, wz, heading, width, radius * 2, radius * 2, [0.05, 0.05, 0.07], { roll: car._spin });
      R.box(wx + rx * sideSign * 0.16, radius, wz + rz * sideSign * 0.16, heading, 0.05, radius * 1.15, radius * 1.15, [0.75, 0.76, 0.8], { roll: car._spin });
    }
  };
  const headCol = Math.sin(t * 47 + car.id) > 0 ? [1, 0.95, 0.75] : [0.9, 0.85, 0.6];
  const tailCol = [1, 0.15, 0.2];
  if (style === 'sport') {
    part(0, 0, 0.36, 1.95, 0.52, 4.4, paintCol);
    part(1.62, 0, 0.60, 1.85, 0.30, 1.25, paintCol, { pitch: pitch + 0.14 });
    if (!isPlayers) { part(-0.55, 0, 0.86, 1.62, 0.46, 1.7, glass); part(-0.55, 0, 1.12, 1.5, 0.07, 1.4, paintCol); }
    part(-1.72, 0, 0.70, 1.85, 0.18, 0.9, paintCol);
    part(-2.02, -0.6, 0.92, 0.08, 0.2, 0.3, trim);
    part(-2.02, 0.6, 0.92, 0.08, 0.2, 0.3, trim);
    part(-2.06, 0, 1.05, 1.9, 0.06, 0.42, paintCol);
    wheels(0.33, 0.37, 0.30, 1.42, 1.42);
    part(2.18, -0.62, 0.48, 0.42, 0.13, 0.08, headCol, { emissive: true });
    part(2.18, 0.62, 0.48, 0.42, 0.13, 0.08, headCol, { emissive: true });
    part(-2.18, 0, 0.58, 1.7, 0.12, 0.08, tailCol, { emissive: true });
  } else if (style === 'police') {
    const white = [0.94, 0.94, 0.96], black = [0.07, 0.07, 0.09];
    part(0, 0, 0.42, 1.9, 0.62, 4.3, white);
    part(0.1, 0, 0.44, 1.93, 0.42, 2.3, black);
    part(1.58, 0, 0.76, 1.8, 0.1, 1.05, white, { pitch: pitch + 0.08 });
    if (!isPlayers) { part(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glass); part(-0.15, 0, 1.33, 1.6, 0.08, 1.9, white); }
    part(2.28, 0, 0.45, 0.35, 0.5, 0.18, black);
    const redTurn = Math.floor(t * 5 + car.id) % 2 === 0;
    const redLamp = [1, 0.07, 0.13], blueLamp = [0.07, 0.4, 1], lampOff = [0.3, 0.3, 0.35];
    part(0, -0.34, 1.46, 0.62, 0.16, 0.42, redTurn ? redLamp : lampOff, { emissive: true });
    part(0, 0.34, 1.46, 0.62, 0.16, 0.42, redTurn ? lampOff : blueLamp, { emissive: true });
    part(0, -0.34, 1.80, 1.15, 0.5, 0.75, redLamp, { emissive: true, alpha: redTurn ? 0.34 : 0.05, add: true });
    part(0, 0.34, 1.80, 1.15, 0.5, 0.75, blueLamp, { emissive: true, alpha: redTurn ? 0.05 : 0.34, add: true });
    wheels(0.34, 0.34, 0.28, 1.4, 1.4);
    part(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, headCol, { emissive: true });
    part(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, headCol, { emissive: true });
    part(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, tailCol, { emissive: true });
    part(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, tailCol, { emissive: true });
  } else {
    part(0, 0, 0.42, 1.9, 0.62, 4.3, paintCol);
    part(1.58, 0, 0.76, 1.8, 0.1, 1.05, paintCol, { pitch: pitch + 0.08 });
    part(-1.98, 0, 0.78, 1.8, 0.12, 0.45, paintCol);
    if (!isPlayers) { part(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glass); part(-0.15, 0, 1.33, 1.6, 0.08, 1.9, paintCol); }
    part(2.14, 0, 0.32, 1.86, 0.22, 0.14, trim);
    part(-2.14, 0, 0.32, 1.86, 0.22, 0.14, trim);
    if (style === 'taxi') {
      part(0, 0, 0.52, 1.93, 0.13, 3.1, [0.12, 0.12, 0.14]);
      part(-0.15, 0, 1.48, 0.72, 0.2, 0.34, [1, 0.85, 0.4], { emissive: true });
    }
    wheels(0.34, 0.34, 0.28, 1.4, 1.4);
    part(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, headCol, { emissive: true });
    part(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, headCol, { emissive: true });
    part(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, tailCol, { emissive: true });
    part(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, tailCol, { emissive: true });
  }
  if ((car.speed || 0) > 1 || car === s.player.inCar) R.box(x + fx * 3.4, 0.35, z + fz * 3.4, ry, 2.6, 0.5, 2.6, [1, 0.95, 0.7], { alpha: 0.08 });
  if (car.smoke === 1) emitParticle(x, 1.2, z, 0, 1.6, 0, 0.8, 0.7, [0.55, 0.55, 0.6]);
  else if (car.smoke === 2) {
    emitParticle(x, 1.2, z, 0, 2.2, 0, 0.9, 0.9, [0.25, 0.2, 0.22]);
    if (Math.random() < 0.4) emitParticle(x, 1.0, z, 0, 1.4, 0, 0.4, 0.6, [1, 0.45, 0.1]);
  }
}

// The cockpit interior, laid out in car space around the driver's eye.
// Layout contract (checked by the cockpit QA): left-hand drive, wheel
// centre near 33% of frame width, the gauge cluster sunk into the
// driver-side dash face with its top edge in the bottom quarter of the
// frame, a full-width two-step dash, A-pillars, a narrow roof beam, a
// wide mirror on a stalk, and a sliver of body-coloured hood visible
// over the dash line.
const DASH_DARK = [0.13, 0.14, 0.17];
const DASH_MID = [0.19, 0.21, 0.26];
function paintCockpit(s, car) {
  void s;
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const toWorld = (fwd, right, y) => [car.x + fx * fwd + rx * right, y, car.z + fz * fwd + rz * right];
  const piece = (fwd, right, y, w, h, d, color, o) => { const q = toWorld(fwd, right, y); R.box(q[0], q[1], q[2], car.ry, w, h, d, color, o || {}); };
  piece(1.80, -0.2, 0.90, 2.3, 0.10, 1.15, car.color || [0.7, 0.2, 0.3]);
  piece(1.15, -0.2, 0.79, 4.4, 0.46, 0.36, DASH_DARK);
  piece(1.22, -0.2, 0.95, 4.4, 0.14, 0.24, DASH_MID);
  piece(0.955, 0.45, 0.97, 0.95, 0.02, 0.012, [0.62, 0.64, 0.68]);
  piece(0.945, -0.02, 0.778, 0.74, 0.36, 0.07, [0.09, 0.09, 0.11]);
  { const q = toWorld(0.90, -0.02, 0.778); R.panel(q[0], q[1], q[2], car.ry, 0.64, 0.30, 'dash', { pitch: -0.21 }); }
  piece(1.02, -0.02, 1.00, 0.86, 0.06, 0.32, DASH_DARK, { pitch: -0.38 });
  const wheelTurn = -(car.phys ? car.phys.steerAngle : 0) * 3.2;
  const hub = toWorld(0.80, -0.05, 0.84);
  const wheelPoint = (dx, dy) => {
    const cosR = Math.cos(wheelTurn), sinR = Math.sin(wheelTurn);
    const lx = dx * cosR - dy * sinR, ly = dx * sinR + dy * cosR;
    return [hub[0] + rx * lx, hub[1] + ly, hub[2] + rz * lx];
  };
  const rimCol = [0.20, 0.20, 0.23], spokeCol = [0.30, 0.30, 0.34];
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const q = wheelPoint(Math.cos(ang) * 0.14, Math.sin(ang) * 0.14);
    R.box(q[0], q[1], q[2], car.ry, 0.085, 0.03, 0.032, rimCol, { pitch: -0.32, roll: wheelTurn + ang + Math.PI / 2 });
  }
  for (const spokeAng of [0, Math.PI, -Math.PI / 2]) {
    const q = wheelPoint(Math.cos(spokeAng) * 0.082, Math.sin(spokeAng) * 0.082);
    R.box(q[0], q[1], q[2], car.ry, 0.115, 0.026, 0.04, spokeCol, { pitch: -0.32, roll: wheelTurn + spokeAng });
  }
  { const q = wheelPoint(0, 0); R.box(q[0], q[1], q[2], car.ry, 0.10, 0.10, 0.06, [0.22, 0.22, 0.26], { pitch: -0.32, roll: wheelTurn }); }
  { const q = wheelPoint(0, 0); R.box(q[0], q[1], q[2], car.ry, 0.055, 0.055, 0.07, [0.32, 0.32, 0.37], { pitch: -0.32, roll: wheelTurn }); }
  piece(0.58, -0.05, 0.70, 0.08, 0.08, 0.42, [0.09, 0.09, 0.11], { pitch: -0.32 });
  piece(1.16, 1.04, 1.42, 0.11, 1.30, 0.055, DASH_DARK, { pitch: -0.18, roll: 0.30 });
  piece(1.16, -1.72, 1.42, 0.11, 1.30, 0.055, DASH_DARK, { pitch: -0.18, roll: -0.30 });
  piece(1.24, -0.35, 2.00, 3.6, 0.10, 0.12, [0.08, 0.085, 0.10]);
  piece(1.24, -0.32, 1.965, 0.03, 0.075, 0.03, [0.07, 0.07, 0.09]);
  piece(1.26, -0.32, 1.90, 0.34, 0.105, 0.035, [0.07, 0.07, 0.09]);
  piece(1.235, -0.32, 1.90, 0.30, 0.08, 0.012, [0.15, 0.21, 0.29], { emissive: true });
  piece(1.23, -0.32, 1.90, 0.13, 0.010, 0.014, [0.55, 0.65, 0.78], { emissive: true, roll: 0.45 });
  piece(0.35, 0.18, 0.42, 0.42, 0.3, 1.1, DASH_DARK);
  piece(0.55, 0.18, 0.6, 0.07, 0.16, 0.07, [0.2, 0.2, 0.24]);
}

// The held-weapon viewmodel, shaped per weapon type: the shotgun long
// and thick, the rifle long with a box magazine, the SMG compact with a
// long magazine, the pistol short. While flashT is alive it also draws
// the muzzle-flash star and a tracer line.
const WEAPON_SHAPES = {
  shotgun: { body: 0.62, bodyW: 0.11, barrel: 0.4, barrelW: 0.07, mag: 0 },
  rifle: { body: 0.58, bodyW: 0.08, barrel: 0.38, barrelW: 0.045, mag: 0.16 },
  smg: { body: 0.42, bodyW: 0.09, barrel: 0.22, barrelW: 0.05, mag: 0.19 },
  pistol: { body: 0.46, bodyW: 0.09, barrel: 0.26, barrelW: 0.05, mag: 0 },
};
function paintWeaponView(s, eye, yaw, pitch, lowered) {
  const isLow = lowered || false;
  const dir = viewDir(yaw, pitch);
  const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw);
  const aiming = s.player.aim && !isLow;
  const kick = (s.recoil || 0) * 0.03;
  const sideOff = aiming ? 0 : 0.23;
  const fwdOff = (aiming ? 0.62 : 0.58) - kick;
  const downOff = isLow ? -0.5 : (aiming ? -0.20 : -0.30) + kick * 0.6;
  const gx = eye[0] + dir[0] * fwdOff + rightX * sideOff;
  const gy = eye[1] + dir[1] * fwdOff + downOff;
  const gz = eye[2] + dir[2] * fwdOff + rightZ * sideOff;
  const shapeKey = s.weapon === 'shotgun' && s.hasShotgun ? 'shotgun'
    : s.weapon === 'rifle' && s.hasRifle ? 'rifle'
    : s.weapon === 'smg' && s.hasSmg ? 'smg' : 'pistol';
  const shape = WEAPON_SHAPES[shapeKey];
  const bodyCol = [0.1, 0.1, 0.12], barrelCol = [0.16, 0.16, 0.18];
  R.box(gx, gy, gz, yaw, shape.bodyW, 0.15, shape.body, bodyCol, { pitch });
  R.box(gx + dir[0] * 0.3, gy + dir[1] * 0.3 + 0.02, gz + dir[2] * 0.3, yaw, shape.barrelW, shape.barrelW, shape.barrel, barrelCol, { pitch });
  if (shape.mag) R.box(gx + dir[0] * 0.05, gy - 0.13, gz + dir[2] * 0.05, yaw, 0.06, shape.mag, 0.09, [0.13, 0.13, 0.15], { pitch });
  if ((s.flashT || 0) > 0) {
    const muzzleDist = 0.3 + shape.barrel * 0.5 + 0.06;
    const mx = gx + dir[0] * muzzleDist, my = gy + dir[1] * muzzleDist + 0.02, mz = gz + dir[2] * muzzleDist;
    const flashCol = [1, 0.8, 0.35];
    R.box(mx, my, mz, yaw, 0.3, 0.07, 0.07, flashCol, { pitch });
    R.box(mx, my, mz, yaw, 0.07, 0.3, 0.07, flashCol, { pitch });
    R.box(mx, my, mz, yaw, 0.12, 0.12, 0.12, [1, 0.98, 0.9], { pitch });
    R.box(gx + dir[0] * 6.4, gy + dir[1] * 6.4 + 0.02, gz + dir[2] * 6.4, yaw, 0.035, 0.035, 11.5, flashCol, { pitch, alpha: 0.75 });
  }
  R.box(gx - dir[0] * 0.08 + rightX * 0.02, gy - 0.13, gz - dir[2] * 0.08 + rightZ * 0.02, yaw, 0.15, 0.11, 0.2, [0.92, 0.76, 0.6], { pitch });
  if (!aiming) R.box(gx - dir[0] * 0.22 + rightX * 0.1, gy - 0.3, gz - dir[2] * 0.22 + rightZ * 0.1, yaw, 0.12, 0.12, 0.34, [0.97, 0.87, 0.72], { pitch: pitch + 0.5 });
}

function paintPerson(s, x, z, ry, color, o) {
  void s;
  const opts = o || {};
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  R.box(x, 0.02, z, ry, 0.8, 0.04, 0.8, [0.03, 0.02, 0.05], { alpha: 0.3 });
  if (opts.dead) { R.box(x, 0.12, z, ry, 0.55, 0.25, 1.6, color); return; }
  const phase = opts.walkPhase || 0, swing = Math.sin(phase) * 0.3;
  const pantsCol = opts.pants || [0.22, 0.24, 0.34], skinCol = opts.skin || [0.92, 0.76, 0.6];
  R.box(x - fx * swing * 0.4 - rx * 0.11, 0.4, z - fz * swing * 0.4 - rz * 0.11, ry, 0.19, 0.8, 0.23, pantsCol, { pitch: swing * 0.7 });
  R.box(x + fx * swing * 0.4 + rx * 0.11, 0.4, z + fz * swing * 0.4 + rz * 0.11, ry, 0.19, 0.8, 0.23, pantsCol, { pitch: -swing * 0.7 });
  R.box(x, 1.1, z, ry, 0.55, 0.65, 0.3, color);
  const armY = opts.handsUp ? 1.95 : 1.15, armPitch = opts.handsUp ? 0.4 : swing * 0.55;
  R.box(x - rx * 0.36 + fx * swing * 0.18, armY, z - rz * 0.36 + fz * swing * 0.18, ry, 0.14, 0.6, 0.16, color, { pitch: -armPitch });
  R.box(x + rx * 0.36 - fx * swing * 0.18, armY, z + rz * 0.36 - fz * swing * 0.18, ry, 0.14, 0.6, 0.16, color, { pitch: armPitch });
  R.box(x, 1.62, z, ry, 0.34, 0.36, 0.34, skinCol);
  if (opts.gun) R.box(x + fx * 0.4, 1.25, z + fz * 0.4, ry, 0.08, 0.12, 0.45, [0.08, 0.08, 0.1]);
}

// The helicopter: fuselage, tail boom and fin, a translucent rotor disc
// with two blade bars, navigation lights, and the spotlight — three
// additive cone slabs stepping down to the target, a radial pool panel
// and a hot core. The pose is nose-down with a bank.
function paintHeli(s, t) {
  const heli = s.heli, player = s.player;
  const x = heli.x, z = heli.z, y = heli.h || 28;
  const ry = heli.ry != null ? heli.ry : Math.atan2(player.x - x, player.z - z);
  const pose = { pitch: -0.26, roll: 0.17 };
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  const hull = [0.32, 0.35, 0.44], darkMetal = [0.22, 0.24, 0.31];
  R.box(x, y, z, ry, 2.6, 2.2, 6.4, hull, pose);
  R.box(x - rx * 1.35, y - 0.1, z - rz * 1.35, ry, 0.20, 0.20, 0.20, [1, 0.10, 0.15], { emissive: true });
  R.box(x + rx * 1.35, y - 0.1, z + rz * 1.35, ry, 0.20, 0.20, 0.20, [0.15, 1, 0.35], { emissive: true });
  R.box(x - fx * 7.9, y + 1.1, z - fz * 7.9, ry, 0.16, 0.16, 0.16, [1, 1, 1], { emissive: true });
  R.box(x, y - 0.2, z, ry, 2.65, 0.5, 6.0, [0.92, 0.92, 0.95], pose);
  R.box(x, y + 0.25, z, ry, 2.2, 1.1, 2.0, [0.65, 0.8, 0.92], { emissive: true, ...pose });
  R.box(x - fx * 5.4, y + 0.6, z - fz * 5.4, ry, 0.55, 0.8, 5.0, darkMetal, pose);
  R.box(x - fx * 7.8, y + 1.1, z - fz * 7.8, ry, 0.2, 1.7, 1.2, darkMetal, pose);
  R.box(x, y + 1.5, z, ry, 13.5, 0.05, 13.5, [0.10, 0.10, 0.12], { alpha: 0.28, ...pose });
  const spin = t * 42;
  R.box(x, y + 1.52, z, spin, 13.5, 0.07, 0.55, [0.12, 0.12, 0.16], { alpha: 0.45 });
  R.box(x, y + 1.52, z, spin + Math.PI / 2, 13.5, 0.07, 0.55, [0.12, 0.12, 0.16], { alpha: 0.45 });
  R.box(x - fx * 7.8, y + 1.1, z - fz * 7.8, ry, 1.8, 0.13, 0.32, [0.15, 0.15, 0.19], { roll: t * 55 });
  R.box(x - fx * 1.6, y - 1.45, z - fz * 1.6, ry, 3.0, 0.18, 0.34, [0.3, 0.3, 0.34], pose);
  const aimPoint = s.spotTarget || player;
  const lampX = x, lampY = y - 1.3, lampZ = z;
  const dxT = aimPoint.x - lampX, dzT = aimPoint.z - lampZ;
  const beamLen = Math.hypot(dxT, dzT, lampY);
  const beamYaw = Math.atan2(dxT, dzT);
  const beamPitch = Math.atan2(Math.hypot(dxT, dzT), lampY);
  for (const stepDef of [[0.18, 1.5], [0.5, 3.6], [0.82, 6.2]]) {
    const frac = stepDef[0], width = stepDef[1];
    R.box(lampX + dxT * frac, lampY * (1 - frac) + 0.3, lampZ + dzT * frac, beamYaw, width, beamLen / 3.1, width, [1, 0.97, 0.82], { alpha: 0.15, pitch: -beamPitch, add: true });
  }
  R.panel(aimPoint.x, 0.07, aimPoint.z, 0, 11.5, 11.5, 'pool', { pitch: -Math.PI / 2, alpha: 0.6, add: true });
  R.box(aimPoint.x, 0.09, aimPoint.z, 0, 3.8, 0.05, 3.8, [1, 1, 0.95], { alpha: 0.30, add: true });
}

let frameCount = 0;
let frameDt = 1 / 60;
function renderScene(s, t) {
  const dims = R.resize(), vw = dims[0], vh = dims[1];
  const p = s.player, driven = p.inCar;
  let cam;
  if (driven) cam = rig.cockpit(s, driven, lookYaw, lookPitch, t, frameDt);
  else if (shotMode === 'start') {
    const dir = viewDir(s.camYaw, lookPitch);
    cam = { eye: [p.x, 1.72, p.z], center: [p.x + dir[0] * 10, 1.72 + dir[1] * 10, p.z + dir[2] * 10], up: [0, 1, 0], fov: 75 * Math.PI / 180, yaw: s.camYaw, pitch: lookPitch };
  } else cam = rig.foot(s, s.camYaw, lookPitch, t);
  const proj = mat4Perspective(cam.fov, vw / vh, 0.05, 900);
  const view = mat4LookAt(cam.eye, cam.center, cam.up);
  // The chase still is graded as late dusk; everything else keeps the
  // peach daylight grade.
  const dusk = s.shotMode === 'chase';
  R.zen = dusk ? [0.15, 0.13, 0.36] : [0.42, 0.66, 0.92];
  R.mid = dusk ? [0.60, 0.30, 0.24] : [0.98, 0.78, 0.58];
  R.horizon = dusk ? [0.82, 0.36, 0.15] : [1.0, 0.70, 0.47];
  R.fogColor = dusk ? [0.48, 0.30, 0.30] : [0.99, 0.80, 0.62];
  R.ambScale = dusk ? 0.62 : 1.0;
  R.begin(view, proj, cam.eye);
  R.draw(MESHES.plain, IDENTITY_MAT);
  R.draw(MESHES.road, IDENTITY_MAT, { tex: 'road' });
  R.draw(MESHES.walk, IDENTITY_MAT, { tex: 'walk' });
  for (let i = 0; i < 4; i++) R.draw(MESHES.tex[i], IDENTITY_MAT, { tex: dusk ? 'b4' : 'b' + i });
  R.draw(MESHES.lampDots, IDENTITY_MAT, { emissive: true });
  for (const sign of MESHES.signs) R.box(sign.x, sign.y, sign.z, sign.ry, sign.w, sign.h, 0.18, sign.color);
  for (const lamp of MESHES.lights) R.box(lamp.x, 4.4, lamp.z, 0, 2.6, 0.05, 2.6, [1, 0.8, 0.45], { alpha: 0.10 });
  const zoneSet = s.city.zones;
  for (const key of ['gunshop', 'hospital', 'spray', 'contact', 'harbor']) {
    const zone = zoneSet[key];
    R.box(zone.x, 2.2, zone.z, t * 0.4, 0.5, 4.4, 0.5, zone.color, { alpha: 0.30, emissive: true });
    R.box(zone.x, 4.6, zone.z, 0, 1.6, 0.5, 1.6, zone.color, { emissive: true });
  }
  const goal = (s.mission && s.mission.target) || (s.taxi && s.taxi.target);
  if (goal) R.box(goal.x, 2.4, goal.z, t * 0.6, 0.7, 4.8, 0.7, [1, 0.9, 0.3], { alpha: 0.4, emissive: true });
  for (const pk of s.pickups) R.box(pk.x, 0.5 + Math.sin(t * 3) * 0.12, pk.z, t * 1.5, 0.55, 0.35, 0.4, [0.15, 0.9, 0.35], { emissive: true });
  for (const tg of s.targets || []) if (!tg.down) R.box(tg.x, 1.1, tg.z, 0, 0.7, 1.5, 0.25, [1, 0.25, 0.3], { emissive: true });
  if (s.boss && !s.boss.done) paintPerson(s, s.boss.x, s.boss.z, Math.PI, [0.2, 0.2, 0.22], { walkPhase: 0 });
  paintSkids();
  for (const c of s.cars) paintCar(s, c, t, c === p.inCar);
  for (const c of s.cops) if (c !== p.inCar) paintCar(s, c, t);
  if (s.heli) paintHeli(s, t);
  for (const c of s.cars.concat(s.cops)) {
    if (c.burning > 0) {
      emitParticle(c.x, 1.1, c.z, (Math.random() - 0.5) * 1.4, 2.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4, 0.5, 0.75, [1, 0.5, 0.12]);
      emitParticle(c.x, 1.3, c.z, 0, 1.8, 0, 0.8, 0.9, [0.3, 0.28, 0.3]);
    }
  }
  for (const ped of s.peds) {
    const rate = ped.state === 'dead' ? 0 : (ped.state === 'flee' ? 11 : 6);
    ped._phase = (ped._phase || 0) + rate * frameDt * (ped.speed / 1.4);
    paintPerson(s, ped.x, ped.z, ped.ry, ped.color, { walkPhase: ped._phase, dead: ped.state === 'dead', handsUp: ped.state === 'handsup' || ped.state === 'robbed', pants: ped.pants, skin: ped.skin });
  }
  paintParticles();
  if (p.inCar) paintCockpit(s, p.inCar);
  else if (s.hasGun && s.mode !== 'title') paintWeaponView(s, cam.eye, cam.yaw, cam.pitch, shotMode === 'start');
  if (frameCount % 6 === 0 && p.inCar) drawDashTexture(R.gl, R.textures.dash, Math.abs(p.inCar.speed) * 2.23694, p.inCar.rpm || 0.1);
}

// Raw input state, fed by the listeners below.
const keysDown = {};
let mouseDX = 0, mouseDY = 0, mouseLeft = false, mouseRight = false;
let lookYaw = 0, lookPitch = 0, lastLookAt = 0;
let fireQueued = false, interactQueued = false, enterQueued = false, taxiQueued = false, reloadQueued = false;

addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keysDown[e.code] = true;
  if (e.repeat) return;
  sound.init();
  if (S.mode === 'title') { S.mode = 'play'; return; }
  if (S.mode === 'busted' || S.mode === 'wasted') { respawn(S, S.mode); return; }
  if (e.code === 'KeyF') enterQueued = true;
  if (e.code === 'KeyE') interactQueued = true;
  if (e.code === 'KeyT') taxiQueued = true;
  if (e.code === 'KeyR') {
    if (S.player.inCar) {
      S.radio = (S.radio + 1) % 3;
      S.msg = S.radio === 0 ? 'RADIO OFF' : S.radio === 1 ? 'RADIO · VICE FM' : 'RADIO · SOLMAR';
      S.msgT = 1.6;
    } else reloadQueued = true;
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
addEventListener('keyup', (e) => { keysDown[e.code] = false; });
glCanvas.addEventListener('click', () => {
  sound.init();
  if (S.mode === 'title') { S.mode = 'play'; return; }
  if (S.mode === 'busted' || S.mode === 'wasted') { respawn(S, S.mode); return; }
  if (S.mode === 'paused') { S.mode = 'play'; return; }
  if (!shotMode && document.pointerLockElement !== glCanvas) glCanvas.requestPointerLock();
});
addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouseLeft = true; fireQueued = true; }
  if (e.button === 2) mouseRight = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseLeft = false;
  if (e.button === 2) mouseRight = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === glCanvas) {
    mouseDX += e.movementX; mouseDY += e.movementY;
    lastLookAt = performance.now();
  }
});

function readInput() {
  return {
    up: !!(keysDown.KeyW || keysDown.ArrowUp),
    down: !!(keysDown.KeyS || keysDown.ArrowDown),
    left: !!(keysDown.KeyA || keysDown.ArrowLeft),
    right: !!(keysDown.KeyD || keysDown.ArrowRight),
    shift: !!(keysDown.ShiftLeft || keysDown.ShiftRight),
    handbrake: !!keysDown.Space, aim: mouseRight, interact: interactQueued, reload: reloadQueued,
  };
}

function nearAnyCar() {
  for (const c of S.cars.concat(S.cops)) if (dist2(c.x, c.z, S.player.x, S.player.z) < 4.5 * 4.5) return true;
  return false;
}

// Translate simulation events into sound effects, messages and particles.
function handleEvents(s) {
  for (const evt of drainEvents(s)) {
    switch (evt.name) {
      case 'shot': {
        sound.shot();
        const p = s.player, fx = Math.sin(p.ry), fz = Math.cos(p.ry);
        emitParticle(p.x + fx * 0.7, 1.45, p.z + fz * 0.7, fx * 2, 0.4, fz * 2, 0.12, 0.3, [1, 0.8, 0.3]);
        for (let i = 0; i < 3; i++) emitParticle(p.x + fx * 0.8, 1.3, p.z + fz * 0.8, fx + (Math.random() - 0.5), Math.random(), fz + (Math.random() - 0.5), 0.5, 0.18, [0.7, 0.7, 0.72]);
        break;
      }
      case 'targetDown': sound.beep(1200, 0.1, 'square', 0.14); s.msg = 'TARGET DOWN'; s.msgT = 1; break;
      case 'dryFire': sound.beep(200, 0.05, 'square', 0.08); s.msg = 'EMPTY — R TO RELOAD'; s.msgT = 1.2; break;
      case 'hitPed': sound.noiseBurst(0.15, 0.3, 500); break;
      case 'crash': case 'ram': sound.crash(evt.data || 8); break;
      case 'explode': {
        sound.noiseBurst(0.8, 0.7, 220);
        const src = evt.data || s.player, bx = src.x, bz = src.z;
        for (let i = 0; i < 30; i++) emitParticle(bx, 1 + Math.random(), bz, (Math.random() - 0.5) * 9, 2 + Math.random() * 5, (Math.random() - 0.5) * 9, 0.7 + Math.random() * 0.5, 1.1, i % 3 ? [1, 0.55, 0.15] : [0.35, 0.3, 0.3]);
        break;
      }
      case 'roadblockHit': sound.crash(14); s.msg = 'ROADBLOCK SMASHED'; s.msgT = 1.6; break;
      case 'heli': s.msg = 'AIR UNIT INBOUND'; s.msgT = 2; break;
      case 'carFire': break;
      case 'cash': case 'pickup': case 'missionDone': sound.cash(); break;
      case 'robDrop': s.msg = 'WALLET DROPPED — GRAB IT'; s.msgT = 2; break;
      case 'buyGun': sound.cash(); s.msg = 'PISTOL PURCHASED — RIGHT MOUSE AIM, LEFT CLICK FIRE'; s.msgT = 3; break;
      case 'spray': sound.beep(520, 0.3, 'sawtooth', 0.1); s.msg = "PAY 'N SPRAY — HEAT CLEARED, FRESH PAINT"; s.msgT = 2.5; break;
      case 'wanted': s.msg = evt.data > 0 ? 'WANTED ' + '★'.repeat(evt.data) : 'HEAT LOST'; s.msgT = 2; break;
      case 'busted': break;
      case 'missionFail': sound.beep(160, 0.4, 'sawtooth', 0.15); break;
      case 'save': saveProfile(s); break;
      default: break;
    }
  }
}

// Staging for the deterministic screenshot mode.
function stageShot(kind) {
  const fx = setupShotScene(S, kind);
  if (kind === 'play') rig.fovPunch = 78 * Math.PI / 180;
  lookPitch = kind === 'start' ? -0.03 : 0.02;
  for (const m of fx.skids) skidMarks.push(m);
  for (const puff of fx.puffs) emitParticle(puff.x, puff.y, puff.z, puff.vx, puff.vy, puff.vz, puff.life, puff.size, puff.color);
  if (fx.barriers) { for (const bp of fx.barriers) S.city.props.push(bp); MESHES = bakeCityMeshes(S); }
  document.getElementById('help').style.display = 'none';
  if (kind === 'chase') ui.vignette.style.opacity = '0.85';
}

function primeShotPhysics() {
  for (const car of S.cars) {
    if (car !== S.player.inCar) continue;
    car.phys = new VehiclePhysics();
    car.phys.u = shotMode === 'play' ? 38.5 : shotMode === 'chase' ? 23.2 : 0;
    car.phys.steerAngle = shotMode === 'play' ? 0.10 : shotMode === 'chase' ? 0.30 : 0;
    if (shotMode === 'chase') { car.phys.v = -15.7; car.phys.omega = 0.4; }
    car.speed = car.phys.u;
    car.rpm = shotMode === 'play' ? 0.92 : 0.8;
    car.gear = shotMode === 'play' ? 5 : 4;
    car.slip = shotMode === 'chase' ? 14 : 0;
    car.isDrifting = shotMode === 'chase';
  }
}

if (shotMode) { stageShot(shotMode); primeShotPhysics(); }

let lastStamp = performance.now();
let shotFrames = 0;

function computeRoadJolt(s, dt) {
  void dt;
  const car = s.player.inCar;
  if (!car) { s.roadJolt = 0; return; }
  let closestGap = Infinity;
  for (const c of roadCenters()) closestGap = Math.min(closestGap, Math.abs(car.x - c), Math.abs(car.z - c));
  let jolt = 0;
  const spd = Math.abs(car.speed);
  if (spd > 4) {
    if (closestGap > 6.1 && closestGap < 9.5) jolt += Math.sin(s.time * 43) * 0.016;
    const seamGap = Math.min(Math.abs(((car.x % 23) + 23) % 23 - 11.5), Math.abs(((car.z % 23) + 23) % 23 - 11.5));
    if (seamGap > 10.6) jolt += Math.sin(s.time * 34) * 0.02 * clamp(spd / 14, 0, 1);
  }
  s.roadJolt = jolt;
}

function frameLoop(now) {
  requestAnimationFrame(frameLoop);
  const dt = Math.min(0.05, (now - lastStamp) / 1000 || 0.016);
  lastStamp = now; frameDt = dt; frameCount++;
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
    if (S.player.inCar && performance.now() - lastLookAt > 1400) {
      lookYaw *= Math.exp(-dt * 2.2);
      lookPitch *= Math.exp(-dt * 2.2);
    }
    if (S.mode === 'play') {
      if (enterQueued) { enterExitCar(S); enterQueued = false; }
      if (taxiQueued) { startTaxi(S); taxiQueued = false; }
      const input = readInput();
      if (!S.player.inCar && (fireQueued || (mouseLeft && weaponDef(S).auto))) {
        if ((S.fireCd || 0) <= 0) { shoot(S); S.fireCd = weaponDef(S).cd; }
      }
      step(S, input, dt);
      const car = S.player.inCar;
      if (car && car.isDrifting && Math.abs(car.speed) > 5) {
        skidMarks.push({ x: car.x, z: car.z, ry: car.ry, len: 2.2 });
        if (skidMarks.length > 240) skidMarks.shift();
        const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
        for (let i = 0; i < 2; i++) emitParticle(car.x - fx * 1.6, 0.4, car.z - fz * 1.6, (Math.random() - 0.5) * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2, 0.9, 0.8, [0.82, 0.82, 0.86]);
      }
      if (car && (car.slip || 0) > 1.1 && Math.abs(car.speed) > 5 && Math.random() < 0.6) {
        const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
        emitParticle(car.x - fx * 1.6, 0.35, car.z - fz * 1.6, 0, 1, 0, 0.7, 0.7, [0.8, 0.8, 0.84]);
      }
      handleEvents(S);
      computeRoadJolt(S, dt);
    }
    fireQueued = false; interactQueued = false; reloadQueued = false;
    sound.frame(S);
  }
  advanceParticles(shotMode ? 0 : dt);
  renderScene(S, S.time);
  updateHUD(S, ui, nearAnyCar);
  drawMinimap(S, mapCtx);
  const vigOn = shotMode === 'chase' || S.trauma > 0.25;
  ui.vignette.style.opacity = vigOn ? String(Math.min(0.85, 0.35 + (S.trauma || 0) * 0.5)) : '0';
  if (shotMode) { shotFrames++; if (shotFrames > 15) window.__shotReady = true; }
}
requestAnimationFrame(frameLoop);
console.log('Vice Blocks 3D booted', shotMode ? '(shot=' + shotMode + ' seed=' + seedValue + ')' : '');
