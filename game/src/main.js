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

const WORLD_IDENTITY = mat4Identity();
const canvasEl = document.getElementById('gl');
const renderer = new Renderer(canvasEl);
const R = renderer;

const HUD_ELEMENT_IDS = [
  'hud', 'health', 'armor', 'cash', 'stars', 'weapon', 'banner', 'msg',
  'minimap', 'speed', 'bustbar', 'bustfill', 'overlay', 'ovTitle', 'ovSub',
  'ovFeat', 'ovSave', 'mission', 'dispatch', 'slots', 'district', 'timer',
  'prompt', 'vignette', 'speedfx', 'respectfill', 'rank',
];
const ui = {};
for (const id of HUD_ELEMENT_IDS) ui[id] = document.getElementById(id);
const minimapCtx = ui.minimap.getContext('2d');

const queryParams = new URLSearchParams(location.search);
const shotMode = queryParams.get('shot') || '';
const seedParam = parseInt(queryParams.get('seed') || '7', 10) || 7;

let S = createState(seedParam, shotMode ? null : loadProfile());
S.shotMode = shotMode;
if (!shotMode && S.missionIdx > 0 && S.missionIdx < 5) startMission(S);
const cameraRig = new CameraRig();
const audioEngine = new AudioEngine();

// The static world, baked once into a few large meshes: one untextured
// batch (road markings, palms, street props), one road batch, one
// sidewalk batch, and one batch per facade texture.
function buildCityMeshes(state) {
  const city = state.city;
  const plainBatch = new Builder(), roadBatch = new Builder(), walkBatch = new Builder();
  const facadeBatches = [new Builder(), new Builder(), new Builder(), new Builder()];
  city.buildings.forEach((b, bi) => {
    const batch = facadeBatches[b.tex];
    batch.box(b.x, 0, b.z, b.w, b.h, b.d, [1, 1, 1], Math.max(1, Math.round(b.h / 14)));
    batch.box(b.x, b.h, b.z, b.w + 0.8, 1.0, b.d + 0.8, [0.92, 0.90, 0.86], 1);
    batch.box(b.x, b.h * 0.55, b.z, b.w + 0.5, 0.55, b.d + 0.5, [0.94, 0.92, 0.88], 1);
    batch.box(b.x, 0, b.z, b.w + 0.6, 1.4, b.d + 0.6, [0.9, 0.88, 0.84], 1);
    if (bi % 3 !== 0) {
      const balconyCount = 2 + (bi % 3);
      for (let k = 0; k < balconyCount; k++) {
        batch.box(b.x + b.w / 2 + 0.45, b.h * (0.3 + 0.18 * k), b.z - b.d / 4 + (k % 2) * b.d / 2, 0.9, 0.28, 2.6, [0.88, 0.86, 0.82], 1);
      }
    }
  });
  const centers = roadCenters();
  const worldExtent = CITY_HALF + 40;
  for (const c of centers) {
    roadBatch.quad([c - ROAD / 2, 0.01, -worldExtent], [c + ROAD / 2, 0.01, -worldExtent], [c + ROAD / 2, 0.01, worldExtent], [c - ROAD / 2, 0.01, worldExtent], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    roadBatch.quad([-worldExtent, 0.01, c - ROAD / 2], [worldExtent, 0.01, c - ROAD / 2], [worldExtent, 0.01, c + ROAD / 2], [-worldExtent, 0.01, c + ROAD / 2], [0, 1, 0], [0.92, 0.90, 0.87], 30);
    for (const sideSign of [-1, 1]) {
      walkBatch.box(c + sideSign * (ROAD / 2 + 1), 0, 0, 2, 0.18, worldExtent * 2, [1, 1, 1]);
      walkBatch.box(0, 0, c + sideSign * (ROAD / 2 + 1), worldExtent * 2, 0.18, 2, [1, 1, 1]);
    }
    for (let t = -CITY_HALF - 30; t < CITY_HALF + 30; t += 6) {
      plainBatch.box(c, 0.03, t, 0.35, 0.02, 2.6, [0.95, 0.8, 0.25]);
      plainBatch.box(t, 0.03, c, 2.6, 0.02, 0.35, [0.95, 0.8, 0.25]);
    }
    for (const c2 of centers) for (let k = -3; k <= 3; k++) {
      plainBatch.box(c + k * 1.1, 0.035, c2 - ROAD / 2 + 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
      plainBatch.box(c + k * 1.1, 0.035, c2 + ROAD / 2 - 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
    }
  }
  plainBatch.box(0, -0.05, 0, (CITY_HALF + 42) * 2, 0.1, (CITY_HALF + 42) * 2, [0.66, 0.60, 0.50]);
  plainBatch.box(CITY_HALF + 120, -0.4, 0, 190, 0.1, (CITY_HALF + 60) * 2, [0.13, 0.72, 0.68]);
  plainBatch.box(CITY_HALF + 16, -0.02, 0, 26, 0.12, (CITY_HALF + 40) * 2, [0.93, 0.84, 0.62]);
  for (const palm of city.palms) {
    const scale = palm.s || 1, lean = palm.lean || 0.1;
    let trunkX = palm.x, trunkZ = palm.z;
    for (let seg = 0; seg < 3; seg++) {
      plainBatch.box(trunkX, seg * 1.6 * scale, trunkZ, 0.34 * scale, 1.7 * scale, 0.34 * scale, [0.52, 0.42, 0.30]);
      trunkX += lean * (seg + 1) * 0.55 * scale; trunkZ += lean * 0.3 * scale;
    }
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2, dirX = Math.sin(ang), dirZ = Math.cos(ang);
      plainBatch.box(trunkX + dirX * 1.15 * scale, 4.95 * scale + 0.3, trunkZ + dirZ * 1.15 * scale, 2.4 * scale, 0.08, 0.55 * scale, [0.18, 0.62, 0.33]);
      plainBatch.box(trunkX + dirX * 2.2 * scale, 4.55 * scale + 0.3, trunkZ + dirZ * 2.2 * scale, 1.3 * scale, 0.07, 0.45 * scale, [0.16, 0.56, 0.30]);
    }
  }
  for (const light of city.lights) plainBatch.box(light.x, 0, light.z, 0.18, 5.2, 0.18, [0.2, 0.2, 0.25]);
  for (const prop of city.props) {
    if (prop.kind === 'bin') plainBatch.box(prop.x, 0, prop.z, 0.6, 1.0, 0.6, [0.25, 0.5, 0.35]);
    else if (prop.kind === 'barrier') {
      plainBatch.box(prop.x, 0, prop.z, 1.8, 0.75, 0.3, [0.92, 0.92, 0.94]);
      plainBatch.box(prop.x, 0.42, prop.z + 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plainBatch.box(prop.x, 0.42, prop.z - 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plainBatch.box(prop.x, 0.75, prop.z, 0.24, 0.18, 0.24, [1, 0.55, 0.1]);
    } else if (prop.kind === 'hydrant') plainBatch.box(prop.x, 0, prop.z, 0.35, 0.7, 0.35, [0.9, 0.2, 0.2]);
    else plainBatch.box(prop.x, 0, prop.z, 0.9, 0.9, 0.9, prop.color);
  }
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2;
    if (Math.cos(ang) > 0.35) continue;
    const dist = CITY_HALF + 130 + (i % 5) * 30;
    plainBatch.box(Math.sin(ang) * dist, 0, Math.cos(ang) * dist, 34, 40 + (i * 37) % 70, 34, [0.58, 0.65, 0.72]);
  }
  const lampHeadBatch = new Builder();
  for (const light of city.lights) lampHeadBatch.box(light.x, 5.2, light.z, 0.55, 0.3, 0.55, [1, 0.85, 0.5]);
  return { plain: plainBatch.build(R), road: roadBatch.build(R), walk: walkBatch.build(R), tex: facadeBatches.map((b) => b.build(R)), lampDots: lampHeadBatch.build(R), signs: city.signs, lights: city.lights };
}
let CITY_MESHES = buildCityMeshes(S);

const particlePool = [];
function spawnParticle(x, y, z, vx, vy, vz, life, size, color, grav) {
  const gravity = grav || 0;
  if (particlePool.length > 420) particlePool.shift();
  particlePool.push({ x, y, z, vx, vy, vz, life, maxLife: life, size, color, grav: gravity });
}
function stepParticles(dt) {
  for (let i = particlePool.length - 1; i >= 0; i--) {
    const pt = particlePool[i];
    pt.life -= dt;
    if (pt.life <= 0) { particlePool.splice(i, 1); continue; }
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
    pt.vy -= pt.grav * dt;
    if (pt.y < 0.06) pt.y = 0.06;
  }
}
function drawParticles() {
  for (const pt of particlePool) {
    const fade = clamp(pt.life / pt.maxLife, 0, 1) * 0.55;
    R.box(pt.x, pt.y, pt.z, pt.x * 7 + pt.z, pt.size, pt.size, pt.size, pt.color, { alpha: fade });
  }
}
const skidTrail = [];
function drawSkidMarks() {
  for (const mark of skidTrail) R.box(mark.x, 0.045, mark.z, mark.ry, 0.32, 0.015, mark.len, [0.05, 0.05, 0.07], { alpha: 0.5 });
}

// Cars are assembled from tinted boxes in car space, via a part helper
// that places boxes by (forward, right, height). Four body styles share
// the helper: the low sport coupe, the black-and-white police
// interceptor, the plain sedan, and the sedan wearing a taxi checker
// band and roof sign.
function drawCar(s, car, t, isPlayerCar) {
  const x = car.x, z = car.z, ry = car.ry;
  const phys = car.phys;
  const bodyPitch = phys ? -phys.pitch : (car._dispA || 0) * 0.002;
  const bodyRoll = phys ? phys.roll : clamp(-(car.steer || 0) * 0.03, -0.04, 0.04);
  R.box(x, 0.16, z, ry, 2.6, 0.06, 4.4, [0.03, 0.02, 0.05], { alpha: 0.3 });
  R.box(x, 0.18, z, ry, 2.3, 0.05, 4.0, [0.04, 0.03, 0.07], { alpha: 0.35 });
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  const bodyStyle = car.kind === 'cop' ? 'police' : (car.style || 'sedan');
  if (car.kind === 'cop') {
    const redPhase = Math.floor(t * 5 + car.id) % 2 === 0;
    R.box(x + fx * 0.5, 0.1, z + fz * 0.5, ry, 3.4, 0.04, 5.2, redPhase ? [1, 0.07, 0.13] : [0.07, 0.4, 1], { alpha: 0.26 });
  }
  const paint = car.kind === 'dead' ? [0.15, 0.14, 0.16] : car.color;
  const glassTint = [0.13, 0.18, 0.24], trimDark = [0.08, 0.08, 0.1];
  const placePart = (fwd, right, y, w, h, d, color, o) => {
    const opts = o || {};
    R.box(x + fx * fwd + rx * right, y, z + fz * fwd + rz * right, ry, w, h, d, color, { pitch: bodyPitch, roll: bodyRoll, ...opts });
  };
  const frontSteerVisual = car === s.player.inCar && car.phys ? car.phys.steerAngle : (car.steer || 0) * 0.4;
  car._spin = (car._spin || 0) + (car.speed || 0) * 0.09;
  const drawWheelSet = (radiusFront, radiusRear, tyreWidth, frontOffset, rearOffset) => {
    const wheelCorners = [[-1, frontOffset, 1], [1, frontOffset, 1], [-1, -rearOffset, 0], [1, -rearOffset, 0]];
    for (const corner of wheelCorners) {
      const sideSign = corner[0], alongPos = corner[1], isFrontWheel = corner[2];
      const radius = isFrontWheel ? radiusFront : radiusRear;
      const wx = x + rx * sideSign * 0.92 + fx * alongPos;
      const wz = z + rz * sideSign * 0.92 + fz * alongPos;
      const wheelHeading = ry + (isFrontWheel ? frontSteerVisual : 0);
      R.box(wx, radius, wz, wheelHeading, tyreWidth, radius * 2, radius * 2, [0.05, 0.05, 0.07], { roll: car._spin });
      R.box(wx + rx * sideSign * 0.16, radius, wz + rz * sideSign * 0.16, wheelHeading, 0.05, radius * 1.15, radius * 1.15, [0.75, 0.76, 0.8], { roll: car._spin });
    }
  };
  const headlampTint = Math.sin(t * 47 + car.id) > 0 ? [1, 0.95, 0.75] : [0.9, 0.85, 0.6];
  const tailTint = [1, 0.15, 0.2];
  if (bodyStyle === 'sport') {
    placePart(0, 0, 0.36, 1.95, 0.52, 4.4, paint);
    placePart(1.62, 0, 0.60, 1.85, 0.30, 1.25, paint, { pitch: bodyPitch + 0.14 });
    if (!isPlayerCar) { placePart(-0.55, 0, 0.86, 1.62, 0.46, 1.7, glassTint); placePart(-0.55, 0, 1.12, 1.5, 0.07, 1.4, paint); }
    placePart(-1.72, 0, 0.70, 1.85, 0.18, 0.9, paint);
    placePart(-2.02, -0.6, 0.92, 0.08, 0.2, 0.3, trimDark);
    placePart(-2.02, 0.6, 0.92, 0.08, 0.2, 0.3, trimDark);
    placePart(-2.06, 0, 1.05, 1.9, 0.06, 0.42, paint);
    drawWheelSet(0.33, 0.37, 0.30, 1.42, 1.42);
    placePart(2.18, -0.62, 0.48, 0.42, 0.13, 0.08, headlampTint, { emissive: true });
    placePart(2.18, 0.62, 0.48, 0.42, 0.13, 0.08, headlampTint, { emissive: true });
    placePart(-2.18, 0, 0.58, 1.7, 0.12, 0.08, tailTint, { emissive: true });
  } else if (bodyStyle === 'police') {
    const whitePaint = [0.94, 0.94, 0.96], blackPaint = [0.07, 0.07, 0.09];
    placePart(0, 0, 0.42, 1.9, 0.62, 4.3, whitePaint);
    placePart(0.1, 0, 0.44, 1.93, 0.42, 2.3, blackPaint);
    placePart(1.58, 0, 0.76, 1.8, 0.1, 1.05, whitePaint, { pitch: bodyPitch + 0.08 });
    if (!isPlayerCar) { placePart(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glassTint); placePart(-0.15, 0, 1.33, 1.6, 0.08, 1.9, whitePaint); }
    placePart(2.28, 0, 0.45, 0.35, 0.5, 0.18, blackPaint);
    const redPhase = Math.floor(t * 5 + car.id) % 2 === 0;
    const redLamp = [1, 0.07, 0.13], blueLamp = [0.07, 0.4, 1], lampDark = [0.3, 0.3, 0.35];
    placePart(0, -0.34, 1.46, 0.62, 0.16, 0.42, redPhase ? redLamp : lampDark, { emissive: true });
    placePart(0, 0.34, 1.46, 0.62, 0.16, 0.42, redPhase ? lampDark : blueLamp, { emissive: true });
    placePart(0, -0.34, 1.80, 1.15, 0.5, 0.75, redLamp, { emissive: true, alpha: redPhase ? 0.34 : 0.05, add: true });
    placePart(0, 0.34, 1.80, 1.15, 0.5, 0.75, blueLamp, { emissive: true, alpha: redPhase ? 0.05 : 0.34, add: true });
    drawWheelSet(0.34, 0.34, 0.28, 1.4, 1.4);
    placePart(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, headlampTint, { emissive: true });
    placePart(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, headlampTint, { emissive: true });
    placePart(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, tailTint, { emissive: true });
    placePart(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, tailTint, { emissive: true });
  } else {
    placePart(0, 0, 0.42, 1.9, 0.62, 4.3, paint);
    placePart(1.58, 0, 0.76, 1.8, 0.1, 1.05, paint, { pitch: bodyPitch + 0.08 });
    placePart(-1.98, 0, 0.78, 1.8, 0.12, 0.45, paint);
    if (!isPlayerCar) { placePart(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glassTint); placePart(-0.15, 0, 1.33, 1.6, 0.08, 1.9, paint); }
    placePart(2.14, 0, 0.32, 1.86, 0.22, 0.14, trimDark);
    placePart(-2.14, 0, 0.32, 1.86, 0.22, 0.14, trimDark);
    if (bodyStyle === 'taxi') {
      placePart(0, 0, 0.52, 1.93, 0.13, 3.1, [0.12, 0.12, 0.14]);
      placePart(-0.15, 0, 1.48, 0.72, 0.2, 0.34, [1, 0.85, 0.4], { emissive: true });
    }
    drawWheelSet(0.34, 0.34, 0.28, 1.4, 1.4);
    placePart(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, headlampTint, { emissive: true });
    placePart(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, headlampTint, { emissive: true });
    placePart(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, tailTint, { emissive: true });
    placePart(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, tailTint, { emissive: true });
  }
  if ((car.speed || 0) > 1 || car === s.player.inCar) R.box(x + fx * 3.4, 0.35, z + fz * 3.4, ry, 2.6, 0.5, 2.6, [1, 0.95, 0.7], { alpha: 0.08 });
  if (car.smoke === 1) spawnParticle(x, 1.2, z, 0, 1.6, 0, 0.8, 0.7, [0.55, 0.55, 0.6]);
  else if (car.smoke === 2) {
    spawnParticle(x, 1.2, z, 0, 2.2, 0, 0.9, 0.9, [0.25, 0.2, 0.22]);
    if (Math.random() < 0.4) spawnParticle(x, 1.0, z, 0, 1.4, 0, 0.4, 0.6, [1, 0.45, 0.1]);
  }
}

// The cockpit interior, laid out in car space around the driver's eye.
// Layout contract (checked by the cockpit QA): left-hand drive, wheel
// centre near 33% of frame width, the gauge cluster sunk into the
// driver-side dash face with its top edge in the bottom quarter of the
// frame, a full-width two-step dash, A-pillars, a narrow roof beam, a
// wide mirror on a stalk, and a sliver of body-coloured hood visible
// over the dash line.
const DASH_DEEP = [0.13, 0.14, 0.17];
const DASH_SURFACE = [0.19, 0.21, 0.26];
function drawCockpit(s, car) {
  void s;
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const carSpace = (fwd, right, y) => [car.x + fx * fwd + rx * right, y, car.z + fz * fwd + rz * right];
  const placeCockpit = (fwd, right, y, w, h, d, color, o) => { const q = carSpace(fwd, right, y); R.box(q[0], q[1], q[2], car.ry, w, h, d, color, o || {}); };
  placeCockpit(1.80, -0.2, 0.90, 2.3, 0.10, 1.15, car.color || [0.7, 0.2, 0.3]);
  placeCockpit(1.15, -0.2, 0.79, 4.4, 0.46, 0.36, DASH_DEEP);
  placeCockpit(1.22, -0.2, 0.95, 4.4, 0.14, 0.24, DASH_SURFACE);
  placeCockpit(0.955, 0.45, 0.97, 0.95, 0.02, 0.012, [0.62, 0.64, 0.68]);
  placeCockpit(0.945, -0.02, 0.778, 0.74, 0.36, 0.07, [0.09, 0.09, 0.11]);
  { const q = carSpace(0.90, -0.02, 0.778); R.panel(q[0], q[1], q[2], car.ry, 0.64, 0.30, 'dash', { pitch: -0.21 }); }
  placeCockpit(1.02, -0.02, 1.00, 0.86, 0.06, 0.32, DASH_DEEP, { pitch: -0.38 });
  const wheelRotation = -(car.phys ? car.phys.steerAngle : 0) * 3.2;
  const wheelCentre = carSpace(0.80, -0.05, 0.84);
  const pointOnWheel = (dx, dy) => {
    const cosR = Math.cos(wheelRotation), sinR = Math.sin(wheelRotation);
    const localX = dx * cosR - dy * sinR, localY = dx * sinR + dy * cosR;
    return [wheelCentre[0] + rx * localX, wheelCentre[1] + localY, wheelCentre[2] + rz * localX];
  };
  const rimTint = [0.20, 0.20, 0.23], spokeTint = [0.30, 0.30, 0.34];
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const q = pointOnWheel(Math.cos(ang) * 0.14, Math.sin(ang) * 0.14);
    R.box(q[0], q[1], q[2], car.ry, 0.085, 0.03, 0.032, rimTint, { pitch: -0.32, roll: wheelRotation + ang + Math.PI / 2 });
  }
  for (const spokeAng of [0, Math.PI, -Math.PI / 2]) {
    const q = pointOnWheel(Math.cos(spokeAng) * 0.082, Math.sin(spokeAng) * 0.082);
    R.box(q[0], q[1], q[2], car.ry, 0.115, 0.026, 0.04, spokeTint, { pitch: -0.32, roll: wheelRotation + spokeAng });
  }
  { const hubPos = pointOnWheel(0, 0); R.box(hubPos[0], hubPos[1], hubPos[2], car.ry, 0.10, 0.10, 0.06, [0.22, 0.22, 0.26], { pitch: -0.32, roll: wheelRotation }); }
  { const capPos = pointOnWheel(0, 0); R.box(capPos[0], capPos[1], capPos[2], car.ry, 0.055, 0.055, 0.07, [0.32, 0.32, 0.37], { pitch: -0.32, roll: wheelRotation }); }
  placeCockpit(0.58, -0.05, 0.70, 0.08, 0.08, 0.42, [0.09, 0.09, 0.11], { pitch: -0.32 });
  placeCockpit(1.16, 1.04, 1.42, 0.11, 1.30, 0.055, DASH_DEEP, { pitch: -0.18, roll: 0.30 });
  placeCockpit(1.16, -1.72, 1.42, 0.11, 1.30, 0.055, DASH_DEEP, { pitch: -0.18, roll: -0.30 });
  placeCockpit(1.24, -0.35, 2.00, 3.6, 0.10, 0.12, [0.08, 0.085, 0.10]);
  placeCockpit(1.24, -0.32, 1.965, 0.03, 0.075, 0.03, [0.07, 0.07, 0.09]);
  placeCockpit(1.26, -0.32, 1.90, 0.34, 0.105, 0.035, [0.07, 0.07, 0.09]);
  placeCockpit(1.235, -0.32, 1.90, 0.30, 0.08, 0.012, [0.15, 0.21, 0.29], { emissive: true });
  placeCockpit(1.23, -0.32, 1.90, 0.13, 0.010, 0.014, [0.55, 0.65, 0.78], { emissive: true, roll: 0.45 });
  placeCockpit(0.35, 0.18, 0.42, 0.42, 0.3, 1.1, DASH_DEEP);
  placeCockpit(0.55, 0.18, 0.6, 0.07, 0.16, 0.07, [0.2, 0.2, 0.24]);
}

// The held-weapon viewmodel, shaped per weapon type: the shotgun long
// and thick, the rifle long with a box magazine, the SMG compact with a
// long magazine, the pistol short. While flashT is alive it also draws
// the muzzle-flash star and a tracer line.
const GUN_SHAPES = {
  shotgun: { body: 0.62, bodyW: 0.11, barrel: 0.4, barrelW: 0.07, mag: 0 },
  rifle: { body: 0.58, bodyW: 0.08, barrel: 0.38, barrelW: 0.045, mag: 0.16 },
  smg: { body: 0.42, bodyW: 0.09, barrel: 0.22, barrelW: 0.05, mag: 0.19 },
  pistol: { body: 0.46, bodyW: 0.09, barrel: 0.26, barrelW: 0.05, mag: 0 },
};
function drawWeaponView(s, eye, viewYaw, viewPitch, lowered) {
  const isLowered = lowered || false;
  const lookDir = viewDir(viewYaw, viewPitch);
  const rightX = -Math.cos(viewYaw), rightZ = Math.sin(viewYaw);
  const isAiming = s.player.aim && !isLowered;
  const recoilKick = (s.recoil || 0) * 0.03;
  const rightShift = isAiming ? 0 : 0.23;
  const forwardShift = (isAiming ? 0.62 : 0.58) - recoilKick;
  const downShift = isLowered ? -0.5 : (isAiming ? -0.20 : -0.30) + recoilKick * 0.6;
  const gx = eye[0] + lookDir[0] * forwardShift + rightX * rightShift;
  const gy = eye[1] + lookDir[1] * forwardShift + downShift;
  const gz = eye[2] + lookDir[2] * forwardShift + rightZ * rightShift;
  const shapeKey = s.weapon === 'shotgun' && s.hasShotgun ? 'shotgun'
    : s.weapon === 'rifle' && s.hasRifle ? 'rifle'
    : s.weapon === 'smg' && s.hasSmg ? 'smg' : 'pistol';
  const shape = GUN_SHAPES[shapeKey];
  const gunBody = [0.1, 0.1, 0.12], gunBarrel = [0.16, 0.16, 0.18];
  R.box(gx, gy, gz, viewYaw, shape.bodyW, 0.15, shape.body, gunBody, { pitch: viewPitch });
  R.box(gx + lookDir[0] * 0.3, gy + lookDir[1] * 0.3 + 0.02, gz + lookDir[2] * 0.3, viewYaw, shape.barrelW, shape.barrelW, shape.barrel, gunBarrel, { pitch: viewPitch });
  if (shape.mag) R.box(gx + lookDir[0] * 0.05, gy - 0.13, gz + lookDir[2] * 0.05, viewYaw, 0.06, shape.mag, 0.09, [0.13, 0.13, 0.15], { pitch: viewPitch });
  if ((s.flashT || 0) > 0) {
    const muzzleGap = 0.3 + shape.barrel * 0.5 + 0.06;
    const mx = gx + lookDir[0] * muzzleGap, my = gy + lookDir[1] * muzzleGap + 0.02, mz = gz + lookDir[2] * muzzleGap;
    const flashTint = [1, 0.8, 0.35];
    R.box(mx, my, mz, viewYaw, 0.3, 0.07, 0.07, flashTint, { pitch: viewPitch });
    R.box(mx, my, mz, viewYaw, 0.07, 0.3, 0.07, flashTint, { pitch: viewPitch });
    R.box(mx, my, mz, viewYaw, 0.12, 0.12, 0.12, [1, 0.98, 0.9], { pitch: viewPitch });
    R.box(gx + lookDir[0] * 6.4, gy + lookDir[1] * 6.4 + 0.02, gz + lookDir[2] * 6.4, viewYaw, 0.035, 0.035, 11.5, flashTint, { pitch: viewPitch, alpha: 0.75 });
  }
  R.box(gx - lookDir[0] * 0.08 + rightX * 0.02, gy - 0.13, gz - lookDir[2] * 0.08 + rightZ * 0.02, viewYaw, 0.15, 0.11, 0.2, [0.92, 0.76, 0.6], { pitch: viewPitch });
  if (!isAiming) R.box(gx - lookDir[0] * 0.22 + rightX * 0.1, gy - 0.3, gz - lookDir[2] * 0.22 + rightZ * 0.1, viewYaw, 0.12, 0.12, 0.34, [0.97, 0.87, 0.72], { pitch: viewPitch + 0.5 });
}

function drawPersonFigure(s, x, z, ry, color, o) {
  void s;
  const opts = o || {};
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  R.box(x, 0.02, z, ry, 0.8, 0.04, 0.8, [0.03, 0.02, 0.05], { alpha: 0.3 });
  if (opts.dead) { R.box(x, 0.12, z, ry, 0.55, 0.25, 1.6, color); return; }
  const gait = opts.walkPhase || 0, limbSwing = Math.sin(gait) * 0.3;
  const trousers = opts.pants || [0.22, 0.24, 0.34], skinTone = opts.skin || [0.92, 0.76, 0.6];
  R.box(x - fx * limbSwing * 0.4 - rx * 0.11, 0.4, z - fz * limbSwing * 0.4 - rz * 0.11, ry, 0.19, 0.8, 0.23, trousers, { pitch: limbSwing * 0.7 });
  R.box(x + fx * limbSwing * 0.4 + rx * 0.11, 0.4, z + fz * limbSwing * 0.4 + rz * 0.11, ry, 0.19, 0.8, 0.23, trousers, { pitch: -limbSwing * 0.7 });
  R.box(x, 1.1, z, ry, 0.55, 0.65, 0.3, color);
  const armHeight = opts.handsUp ? 1.95 : 1.15, armPitch = opts.handsUp ? 0.4 : limbSwing * 0.55;
  R.box(x - rx * 0.36 + fx * limbSwing * 0.18, armHeight, z - rz * 0.36 + fz * limbSwing * 0.18, ry, 0.14, 0.6, 0.16, color, { pitch: -armPitch });
  R.box(x + rx * 0.36 - fx * limbSwing * 0.18, armHeight, z + rz * 0.36 - fz * limbSwing * 0.18, ry, 0.14, 0.6, 0.16, color, { pitch: armPitch });
  R.box(x, 1.62, z, ry, 0.34, 0.36, 0.34, skinTone);
  if (opts.gun) R.box(x + fx * 0.4, 1.25, z + fz * 0.4, ry, 0.08, 0.12, 0.45, [0.08, 0.08, 0.1]);
}

// The helicopter: fuselage, tail boom and fin, a translucent rotor disc
// with two blade bars, navigation lights, and the spotlight — three
// additive cone slabs stepping down to the target, a radial pool panel
// and a hot core. The pose is nose-down with a bank.
function drawHeli(s, t) {
  const heli = s.heli, player = s.player;
  const x = heli.x, z = heli.z, y = heli.h || 28;
  const ry = heli.ry != null ? heli.ry : Math.atan2(player.x - x, player.z - z);
  const flightPose = { pitch: -0.26, roll: 0.17 };
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  const hullTint = [0.32, 0.35, 0.44], darkAlloy = [0.22, 0.24, 0.31];
  R.box(x, y, z, ry, 2.6, 2.2, 6.4, hullTint, flightPose);
  R.box(x - rx * 1.35, y - 0.1, z - rz * 1.35, ry, 0.20, 0.20, 0.20, [1, 0.10, 0.15], { emissive: true });
  R.box(x + rx * 1.35, y - 0.1, z + rz * 1.35, ry, 0.20, 0.20, 0.20, [0.15, 1, 0.35], { emissive: true });
  R.box(x - fx * 7.9, y + 1.1, z - fz * 7.9, ry, 0.16, 0.16, 0.16, [1, 1, 1], { emissive: true });
  R.box(x, y - 0.2, z, ry, 2.65, 0.5, 6.0, [0.92, 0.92, 0.95], flightPose);
  R.box(x, y + 0.25, z, ry, 2.2, 1.1, 2.0, [0.65, 0.8, 0.92], { emissive: true, ...flightPose });
  R.box(x - fx * 5.4, y + 0.6, z - fz * 5.4, ry, 0.55, 0.8, 5.0, darkAlloy, flightPose);
  R.box(x - fx * 7.8, y + 1.1, z - fz * 7.8, ry, 0.2, 1.7, 1.2, darkAlloy, flightPose);
  R.box(x, y + 1.5, z, ry, 13.5, 0.05, 13.5, [0.10, 0.10, 0.12], { alpha: 0.28, ...flightPose });
  const rotorSpin = t * 42;
  R.box(x, y + 1.52, z, rotorSpin, 13.5, 0.07, 0.55, [0.12, 0.12, 0.16], { alpha: 0.45 });
  R.box(x, y + 1.52, z, rotorSpin + Math.PI / 2, 13.5, 0.07, 0.55, [0.12, 0.12, 0.16], { alpha: 0.45 });
  R.box(x - fx * 7.8, y + 1.1, z - fz * 7.8, ry, 1.8, 0.13, 0.32, [0.15, 0.15, 0.19], { roll: t * 55 });
  R.box(x - fx * 1.6, y - 1.45, z - fz * 1.6, ry, 3.0, 0.18, 0.34, [0.3, 0.3, 0.34], flightPose);
  const beamTarget = s.spotTarget || player;
  const lampX = x, lampY = y - 1.3, lampZ = z;
  const toTargetX = beamTarget.x - lampX, toTargetZ = beamTarget.z - lampZ;
  const beamLength = Math.hypot(toTargetX, toTargetZ, lampY);
  const beamHeading = Math.atan2(toTargetX, toTargetZ);
  const beamTilt = Math.atan2(Math.hypot(toTargetX, toTargetZ), lampY);
  for (const beamStep of [[0.18, 1.5], [0.5, 3.6], [0.82, 6.2]]) {
    const frac = beamStep[0], slabWidth = beamStep[1];
    R.box(lampX + toTargetX * frac, lampY * (1 - frac) + 0.3, lampZ + toTargetZ * frac, beamHeading, slabWidth, beamLength / 3.1, slabWidth, [1, 0.97, 0.82], { alpha: 0.15, pitch: -beamTilt, add: true });
  }
  R.panel(beamTarget.x, 0.07, beamTarget.z, 0, 11.5, 11.5, 'pool', { pitch: -Math.PI / 2, alpha: 0.6, add: true });
  R.box(beamTarget.x, 0.09, beamTarget.z, 0, 3.8, 0.05, 3.8, [1, 1, 0.95], { alpha: 0.30, add: true });
}

let framesRendered = 0;
let lastFrameDt = 1 / 60;
function renderFrame(s, t) {
  const canvasSize = R.resize(), viewW = canvasSize[0], viewH = canvasSize[1];
  const p = s.player, playerCar = p.inCar;
  let camPose;
  if (playerCar) camPose = cameraRig.cockpit(s, playerCar, lookYaw, lookPitch, t, lastFrameDt);
  else if (shotMode === 'start') {
    const dir = viewDir(s.camYaw, lookPitch);
    camPose = { eye: [p.x, 1.72, p.z], center: [p.x + dir[0] * 10, 1.72 + dir[1] * 10, p.z + dir[2] * 10], up: [0, 1, 0], fov: 75 * Math.PI / 180, yaw: s.camYaw, pitch: lookPitch };
  } else camPose = cameraRig.foot(s, s.camYaw, lookPitch, t);
  const projection = mat4Perspective(camPose.fov, viewW / viewH, 0.05, 900);
  const viewMatrix = mat4LookAt(camPose.eye, camPose.center, camPose.up);
  // The chase still is graded as late dusk; everything else keeps the
  // peach daylight grade.
  const isLateDusk = s.shotMode === 'chase';
  R.zen = isLateDusk ? [0.15, 0.13, 0.36] : [0.42, 0.66, 0.92];
  R.mid = isLateDusk ? [0.60, 0.30, 0.24] : [0.98, 0.78, 0.58];
  R.horizon = isLateDusk ? [0.82, 0.36, 0.15] : [1.0, 0.70, 0.47];
  R.fogColor = isLateDusk ? [0.48, 0.30, 0.30] : [0.99, 0.80, 0.62];
  R.ambScale = isLateDusk ? 0.62 : 1.0;
  R.begin(viewMatrix, projection, camPose.eye);
  R.draw(CITY_MESHES.plain, WORLD_IDENTITY);
  R.draw(CITY_MESHES.road, WORLD_IDENTITY, { tex: 'road' });
  R.draw(CITY_MESHES.walk, WORLD_IDENTITY, { tex: 'walk' });
  for (let i = 0; i < 4; i++) R.draw(CITY_MESHES.tex[i], WORLD_IDENTITY, { tex: isLateDusk ? 'b4' : 'b' + i });
  R.draw(CITY_MESHES.lampDots, WORLD_IDENTITY, { emissive: true });
  for (const sign of CITY_MESHES.signs) R.box(sign.x, sign.y, sign.z, sign.ry, sign.w, sign.h, 0.18, sign.color);
  for (const light of CITY_MESHES.lights) R.box(light.x, 4.4, light.z, 0, 2.6, 0.05, 2.6, [1, 0.8, 0.45], { alpha: 0.10 });
  const zoneSet = s.city.zones;
  for (const zoneKey of ['gunshop', 'hospital', 'spray', 'contact', 'harbor']) {
    const zone = zoneSet[zoneKey];
    R.box(zone.x, 2.2, zone.z, t * 0.4, 0.5, 4.4, 0.5, zone.color, { alpha: 0.30, emissive: true });
    R.box(zone.x, 4.6, zone.z, 0, 1.6, 0.5, 1.6, zone.color, { emissive: true });
  }
  const objective = (s.mission && s.mission.target) || (s.taxi && s.taxi.target);
  if (objective) R.box(objective.x, 2.4, objective.z, t * 0.6, 0.7, 4.8, 0.7, [1, 0.9, 0.3], { alpha: 0.4, emissive: true });
  for (const pk of s.pickups) R.box(pk.x, 0.5 + Math.sin(t * 3) * 0.12, pk.z, t * 1.5, 0.55, 0.35, 0.4, [0.15, 0.9, 0.35], { emissive: true });
  for (const tg of s.targets || []) if (!tg.down) R.box(tg.x, 1.1, tg.z, 0, 0.7, 1.5, 0.25, [1, 0.25, 0.3], { emissive: true });
  if (s.boss && !s.boss.done) drawPersonFigure(s, s.boss.x, s.boss.z, Math.PI, [0.2, 0.2, 0.22], { walkPhase: 0 });
  drawSkidMarks();
  for (const c of s.cars) drawCar(s, c, t, c === p.inCar);
  for (const c of s.cops) if (c !== p.inCar) drawCar(s, c, t);
  if (s.heli) drawHeli(s, t);
  for (const c of s.cars.concat(s.cops)) {
    if (c.burning > 0) {
      spawnParticle(c.x, 1.1, c.z, (Math.random() - 0.5) * 1.4, 2.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4, 0.5, 0.75, [1, 0.5, 0.12]);
      spawnParticle(c.x, 1.3, c.z, 0, 1.8, 0, 0.8, 0.9, [0.3, 0.28, 0.3]);
    }
  }
  for (const ped of s.peds) {
    const gaitRate = ped.state === 'dead' ? 0 : (ped.state === 'flee' ? 11 : 6);
    ped._phase = (ped._phase || 0) + gaitRate * lastFrameDt * (ped.speed / 1.4);
    drawPersonFigure(s, ped.x, ped.z, ped.ry, ped.color, { walkPhase: ped._phase, dead: ped.state === 'dead', handsUp: ped.state === 'handsup' || ped.state === 'robbed', pants: ped.pants, skin: ped.skin });
  }
  drawParticles();
  if (p.inCar) drawCockpit(s, p.inCar);
  else if (s.hasGun && s.mode !== 'title') drawWeaponView(s, camPose.eye, camPose.yaw, camPose.pitch, shotMode === 'start');
  if (framesRendered % 6 === 0 && p.inCar) drawDashTexture(R.gl, R.textures.dash, Math.abs(p.inCar.speed) * 2.23694, p.inCar.rpm || 0.1);
}

// Raw input state, fed by the listeners below.
const heldKeys = {};
let mouseMoveX = 0, mouseMoveY = 0, mouseLeftHeld = false, mouseRightHeld = false;
let lookYaw = 0, lookPitch = 0, lastLookActivityAt = 0;
let wantShoot = false, wantInteract = false, wantEnter = false, wantTaxi = false, wantReload = false;

addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  heldKeys[e.code] = true;
  if (e.repeat) return;
  audioEngine.init();
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
addEventListener('keyup', (e) => { heldKeys[e.code] = false; });
canvasEl.addEventListener('click', () => {
  audioEngine.init();
  if (S.mode === 'title') { S.mode = 'play'; return; }
  if (S.mode === 'busted' || S.mode === 'wasted') { respawn(S, S.mode); return; }
  if (S.mode === 'paused') { S.mode = 'play'; return; }
  if (!shotMode && document.pointerLockElement !== canvasEl) canvasEl.requestPointerLock();
});
addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouseLeftHeld = true; wantShoot = true; }
  if (e.button === 2) mouseRightHeld = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseLeftHeld = false;
  if (e.button === 2) mouseRightHeld = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvasEl) {
    mouseMoveX += e.movementX; mouseMoveY += e.movementY;
    lastLookActivityAt = performance.now();
  }
});

function pollInput() {
  return {
    up: !!(heldKeys.KeyW || heldKeys.ArrowUp),
    down: !!(heldKeys.KeyS || heldKeys.ArrowDown),
    left: !!(heldKeys.KeyA || heldKeys.ArrowLeft),
    right: !!(heldKeys.KeyD || heldKeys.ArrowRight),
    shift: !!(heldKeys.ShiftLeft || heldKeys.ShiftRight),
    handbrake: !!heldKeys.Space, aim: mouseRightHeld, interact: wantInteract, reload: wantReload,
  };
}

function playerNearCar() {
  for (const c of S.cars.concat(S.cops)) if (dist2(c.x, c.z, S.player.x, S.player.z) < 4.5 * 4.5) return true;
  return false;
}

// Translate simulation events into sound effects, messages and particles.
function dispatchEvents(s) {
  for (const evt of drainEvents(s)) {
    switch (evt.name) {
      case 'shot': {
        audioEngine.shot();
        const p = s.player, fx = Math.sin(p.ry), fz = Math.cos(p.ry);
        spawnParticle(p.x + fx * 0.7, 1.45, p.z + fz * 0.7, fx * 2, 0.4, fz * 2, 0.12, 0.3, [1, 0.8, 0.3]);
        for (let i = 0; i < 3; i++) spawnParticle(p.x + fx * 0.8, 1.3, p.z + fz * 0.8, fx + (Math.random() - 0.5), Math.random(), fz + (Math.random() - 0.5), 0.5, 0.18, [0.7, 0.7, 0.72]);
        break;
      }
      case 'targetDown': audioEngine.beep(1200, 0.1, 'square', 0.14); s.msg = 'TARGET DOWN'; s.msgT = 1; break;
      case 'dryFire': audioEngine.beep(200, 0.05, 'square', 0.08); s.msg = 'EMPTY — R TO RELOAD'; s.msgT = 1.2; break;
      case 'hitPed': audioEngine.noiseBurst(0.15, 0.3, 500); break;
      case 'crash': case 'ram': audioEngine.crash(evt.data || 8); break;
      case 'explode': {
        audioEngine.noiseBurst(0.8, 0.7, 220);
        const blastOrigin = evt.data || s.player, blastX = blastOrigin.x, blastZ = blastOrigin.z;
        for (let i = 0; i < 30; i++) spawnParticle(blastX, 1 + Math.random(), blastZ, (Math.random() - 0.5) * 9, 2 + Math.random() * 5, (Math.random() - 0.5) * 9, 0.7 + Math.random() * 0.5, 1.1, i % 3 ? [1, 0.55, 0.15] : [0.35, 0.3, 0.3]);
        break;
      }
      case 'roadblockHit': audioEngine.crash(14); s.msg = 'ROADBLOCK SMASHED'; s.msgT = 1.6; break;
      case 'heli': s.msg = 'AIR UNIT INBOUND'; s.msgT = 2; break;
      case 'carFire': break;
      case 'cash': case 'pickup': case 'missionDone': audioEngine.cash(); break;
      case 'robDrop': s.msg = 'WALLET DROPPED — GRAB IT'; s.msgT = 2; break;
      case 'buyGun': audioEngine.cash(); s.msg = 'PISTOL PURCHASED — RIGHT MOUSE AIM, LEFT CLICK FIRE'; s.msgT = 3; break;
      case 'spray': audioEngine.beep(520, 0.3, 'sawtooth', 0.1); s.msg = "PAY 'N SPRAY — HEAT CLEARED, FRESH PAINT"; s.msgT = 2.5; break;
      case 'wanted': s.msg = evt.data > 0 ? 'WANTED ' + '★'.repeat(evt.data) : 'HEAT LOST'; s.msgT = 2; break;
      case 'busted': break;
      case 'missionFail': audioEngine.beep(160, 0.4, 'sawtooth', 0.15); break;
      case 'save': saveProfile(s); break;
      default: break;
    }
  }
}

// Staging for the deterministic screenshot mode.
function prepareShotScene(kind) {
  const stagedFx = setupShotScene(S, kind);
  if (kind === 'play') cameraRig.fovPunch = 78 * Math.PI / 180;
  lookPitch = kind === 'start' ? -0.03 : 0.02;
  for (const mark of stagedFx.skids) skidTrail.push(mark);
  for (const puff of stagedFx.puffs) spawnParticle(puff.x, puff.y, puff.z, puff.vx, puff.vy, puff.vz, puff.life, puff.size, puff.color);
  if (stagedFx.barriers) { for (const bp of stagedFx.barriers) S.city.props.push(bp); CITY_MESHES = buildCityMeshes(S); }
  document.getElementById('help').style.display = 'none';
  if (kind === 'chase') ui.vignette.style.opacity = '0.85';
}

function seedShotCarPhysics() {
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

if (shotMode) { prepareShotScene(shotMode); seedShotCarPhysics(); }

let previousTimestamp = performance.now();
let shotFrameCount = 0;

function updateRoadJolt(s, dt) {
  void dt;
  const car = s.player.inCar;
  if (!car) { s.roadJolt = 0; return; }
  let nearestRoadGap = Infinity;
  for (const c of roadCenters()) nearestRoadGap = Math.min(nearestRoadGap, Math.abs(car.x - c), Math.abs(car.z - c));
  let joltAmount = 0;
  const carSpeed = Math.abs(car.speed);
  if (carSpeed > 4) {
    if (nearestRoadGap > 6.1 && nearestRoadGap < 9.5) joltAmount += Math.sin(s.time * 43) * 0.016;
    const gridGap = Math.min(Math.abs(((car.x % 23) + 23) % 23 - 11.5), Math.abs(((car.z % 23) + 23) % 23 - 11.5));
    if (gridGap > 10.6) joltAmount += Math.sin(s.time * 34) * 0.02 * clamp(carSpeed / 14, 0, 1);
  }
  s.roadJolt = joltAmount;
}

function mainLoop(now) {
  requestAnimationFrame(mainLoop);
  const dt = Math.min(0.05, (now - previousTimestamp) / 1000 || 0.016);
  previousTimestamp = now; lastFrameDt = dt; framesRendered++;
  if (!shotMode) {
    if (mouseMoveX || mouseMoveY) {
      if (S.player.inCar) {
        lookYaw = clamp(lookYaw - mouseMoveX * 0.0022, -1.15, 1.15);
        lookPitch = clamp(lookPitch + mouseMoveY * 0.0018, -0.45, 0.55);
      } else {
        S.camYaw -= mouseMoveX * 0.003;
        lookPitch = clamp(lookPitch + mouseMoveY * 0.0022, -0.85, 0.85);
      }
      mouseMoveX = 0; mouseMoveY = 0;
    }
    if (S.player.inCar && performance.now() - lastLookActivityAt > 1400) {
      lookYaw *= Math.exp(-dt * 2.2);
      lookPitch *= Math.exp(-dt * 2.2);
    }
    if (S.mode === 'play') {
      if (wantEnter) { enterExitCar(S); wantEnter = false; }
      if (wantTaxi) { startTaxi(S); wantTaxi = false; }
      const inputState = pollInput();
      if (!S.player.inCar && (wantShoot || (mouseLeftHeld && weaponDef(S).auto))) {
        if ((S.fireCd || 0) <= 0) { shoot(S); S.fireCd = weaponDef(S).cd; }
      }
      step(S, inputState, dt);
      const drivenCar = S.player.inCar;
      if (drivenCar && drivenCar.isDrifting && Math.abs(drivenCar.speed) > 5) {
        skidTrail.push({ x: drivenCar.x, z: drivenCar.z, ry: drivenCar.ry, len: 2.2 });
        if (skidTrail.length > 240) skidTrail.shift();
        const fx = Math.sin(drivenCar.ry), fz = Math.cos(drivenCar.ry);
        for (let i = 0; i < 2; i++) spawnParticle(drivenCar.x - fx * 1.6, 0.4, drivenCar.z - fz * 1.6, (Math.random() - 0.5) * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2, 0.9, 0.8, [0.82, 0.82, 0.86]);
      }
      if (drivenCar && (drivenCar.slip || 0) > 1.1 && Math.abs(drivenCar.speed) > 5 && Math.random() < 0.6) {
        const fx = Math.sin(drivenCar.ry), fz = Math.cos(drivenCar.ry);
        spawnParticle(drivenCar.x - fx * 1.6, 0.35, drivenCar.z - fz * 1.6, 0, 1, 0, 0.7, 0.7, [0.8, 0.8, 0.84]);
      }
      dispatchEvents(S);
      updateRoadJolt(S, dt);
    }
    wantShoot = false; wantInteract = false; wantReload = false;
    audioEngine.frame(S);
  }
  stepParticles(shotMode ? 0 : dt);
  renderFrame(S, S.time);
  updateHUD(S, ui, playerNearCar);
  drawMinimap(S, minimapCtx);
  const vignetteOn = shotMode === 'chase' || S.trauma > 0.25;
  ui.vignette.style.opacity = vignetteOn ? String(Math.min(0.85, 0.35 + (S.trauma || 0) * 0.5)) : '0';
  if (shotMode) { shotFrameCount++; if (shotFrameCount > 15) window.__shotReady = true; }
}
requestAnimationFrame(mainLoop);
console.log('Vice Blocks 3D booted', shotMode ? '(shot=' + shotMode + ' seed=' + seedParam + ')' : '');
