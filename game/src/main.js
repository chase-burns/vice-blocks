// main.js — the shell around the simulation: boot, static city meshes,
// entity drawing (cars, the first-person cockpit, the gun viewmodel,
// people, the police helicopter), input, event-to-sound wiring, the
// render loop, and the deterministic screenshot harness. All game rules
// live in src/game/; everything here is presentation.
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
const minimapCtx = ui.minimap.getContext('2d');

const query = new URLSearchParams(location.search);
const shotMode = query.get('shot') || '';
const seedParam = parseInt(query.get('seed') || '7', 10) || 7;

let S = createState(seedParam, shotMode ? null : loadProfile());
S.shotMode = shotMode;
if (!shotMode && S.missionIdx > 0 && S.missionIdx < 5) startMission(S);
const rig = new CameraRig();
const audio = new AudioEngine();

// ------------------------------------------------------------ city meshes
// The static world is baked into a handful of big meshes: one untextured
// batch (markings, palms, props), one road batch, one sidewalk batch, and
// one batch per facade texture.
function buildCityMeshes(state) {
  const city = state.city;
  const plain = new Builder();
  const road = new Builder();
  const walk = new Builder();
  const facadeBatches = [new Builder(), new Builder(), new Builder(), new Builder()];

  city.buildings.forEach((b, bi) => {
    const batch = facadeBatches[b.tex];
    batch.box(b.x, 0, b.z, b.w, b.h, b.d, [1, 1, 1], Math.max(1, Math.round(b.h / 14)));
    // Architectural relief in the same texture, tinted a touch darker:
    // a parapet cap, a mid-height cornice band, and a podium base.
    batch.box(b.x, b.h, b.z, b.w + 0.8, 1.0, b.d + 0.8, [0.92, 0.90, 0.86], 1);
    batch.box(b.x, b.h * 0.55, b.z, b.w + 0.5, 0.55, b.d + 0.5, [0.94, 0.92, 0.88], 1);
    batch.box(b.x, 0, b.z, b.w + 0.6, 1.4, b.d + 0.6, [0.9, 0.88, 0.84], 1);
    if (bi % 3 !== 0) {
      const slabs = 2 + (bi % 3);
      for (let k = 0; k < slabs; k++) {
        batch.box(
          b.x + b.w / 2 + 0.45, b.h * (0.3 + 0.18 * k),
          b.z - b.d / 4 + (k % 2) * b.d / 2,
          0.9, 0.28, 2.6, [0.88, 0.86, 0.82], 1);
      }
    }
  });

  const centers = roadCenters();
  const extent = CITY_HALF + 40;
  for (const c of centers) {
    road.quad([c - ROAD / 2, 0.01, -extent], [c + ROAD / 2, 0.01, -extent],
      [c + ROAD / 2, 0.01, extent], [c - ROAD / 2, 0.01, extent],
      [0, 1, 0], [0.92, 0.90, 0.87], 30);
    road.quad([-extent, 0.01, c - ROAD / 2], [extent, 0.01, c - ROAD / 2],
      [extent, 0.01, c + ROAD / 2], [-extent, 0.01, c + ROAD / 2],
      [0, 1, 0], [0.92, 0.90, 0.87], 30);
    for (const sideSign of [-1, 1]) {
      walk.box(c + sideSign * (ROAD / 2 + 1), 0, 0, 2, 0.18, extent * 2, [1, 1, 1]);
      walk.box(0, 0, c + sideSign * (ROAD / 2 + 1), extent * 2, 0.18, 2, [1, 1, 1]);
    }
    for (let t = -CITY_HALF - 30; t < CITY_HALF + 30; t += 6) {
      plain.box(c, 0.03, t, 0.35, 0.02, 2.6, [0.95, 0.8, 0.25]);
      plain.box(t, 0.03, c, 2.6, 0.02, 0.35, [0.95, 0.8, 0.25]);
    }
    for (const c2 of centers) {
      for (let k = -3; k <= 3; k++) {
        plain.box(c + k * 1.1, 0.035, c2 - ROAD / 2 + 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
        plain.box(c + k * 1.1, 0.035, c2 + ROAD / 2 - 1.2, 0.6, 0.02, 2.2, [0.9, 0.9, 0.92]);
      }
    }
  }

  // Ground slab, then the beach strip and the ocean on the east flank.
  plain.box(0, -0.05, 0, (CITY_HALF + 42) * 2, 0.1, (CITY_HALF + 42) * 2, [0.66, 0.60, 0.50]);
  plain.box(CITY_HALF + 120, -0.4, 0, 190, 0.1, (CITY_HALF + 60) * 2, [0.13, 0.72, 0.68]);
  plain.box(CITY_HALF + 16, -0.02, 0, 26, 0.12, (CITY_HALF + 40) * 2, [0.93, 0.84, 0.62]);

  for (const palm of city.palms) {
    const sc = palm.s || 1;
    const lean = palm.lean || 0.1;
    // Trunk: three stacked segments leaning progressively, then a crown
    // of nine two-piece fronds.
    let tx = palm.x;
    let tz = palm.z;
    for (let seg = 0; seg < 3; seg++) {
      plain.box(tx, seg * 1.6 * sc, tz, 0.34 * sc, 1.7 * sc, 0.34 * sc, [0.52, 0.42, 0.30]);
      tx += lean * (seg + 1) * 0.55 * sc;
      tz += lean * 0.3 * sc;
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      plain.box(tx + dx * 1.15 * sc, 4.95 * sc + 0.3, tz + dz * 1.15 * sc,
        2.4 * sc, 0.08, 0.55 * sc, [0.18, 0.62, 0.33]);
      plain.box(tx + dx * 2.2 * sc, 4.55 * sc + 0.3, tz + dz * 2.2 * sc,
        1.3 * sc, 0.07, 0.45 * sc, [0.16, 0.56, 0.30]);
    }
  }

  for (const light of city.lights) {
    plain.box(light.x, 0, light.z, 0.18, 5.2, 0.18, [0.2, 0.2, 0.25]);
  }
  for (const prop of city.props) {
    if (prop.kind === 'bin') {
      plain.box(prop.x, 0, prop.z, 0.6, 1.0, 0.6, [0.25, 0.5, 0.35]);
    } else if (prop.kind === 'barrier') {
      plain.box(prop.x, 0, prop.z, 1.8, 0.75, 0.3, [0.92, 0.92, 0.94]);
      plain.box(prop.x, 0.42, prop.z + 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plain.box(prop.x, 0.42, prop.z - 0.16, 1.8, 0.2, 0.02, [0.85, 0.12, 0.16]);
      plain.box(prop.x, 0.75, prop.z, 0.24, 0.18, 0.24, [1, 0.55, 0.1]);
    } else if (prop.kind === 'hydrant') {
      plain.box(prop.x, 0, prop.z, 0.35, 0.7, 0.35, [0.9, 0.2, 0.2]);
    } else {
      plain.box(prop.x, 0, prop.z, 0.9, 0.9, 0.9, prop.color);
    }
  }

  // Distant skyline silhouettes ringing the city (not toward the ocean).
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    if (Math.cos(a) > 0.35) continue;
    const d = CITY_HALF + 130 + (i % 5) * 30;
    plain.box(Math.sin(a) * d, 0, Math.cos(a) * d, 34, 40 + (i * 37) % 70, 34, [0.58, 0.65, 0.72]);
  }

  const lampHeads = new Builder();
  for (const light of city.lights) {
    lampHeads.box(light.x, 5.2, light.z, 0.55, 0.3, 0.55, [1, 0.85, 0.5]);
  }

  return {
    plain: plain.build(R),
    road: road.build(R),
    walk: walk.build(R),
    tex: facadeBatches.map((b) => b.build(R)),
    lampDots: lampHeads.build(R),
    signs: city.signs,
    lights: city.lights,
  };
}
let MESH = buildCityMeshes(S);

// ------------------------------------------------------- particles & skid
const particles = [];
function spawnParticle(x, y, z, vx, vy, vz, life, size, color, grav = 0) {
  if (particles.length > 420) particles.shift();
  particles.push({ x, y, z, vx, vy, vz, life, max: life, size, color, grav });
}
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.life -= dt;
    if (q.life <= 0) { particles.splice(i, 1); continue; }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.z += q.vz * dt;
    q.vy -= q.grav * dt;
    if (q.y < 0.06) q.y = 0.06;
  }
}
function drawParticles() {
  for (const q of particles) {
    const alpha = clamp(q.life / q.max, 0, 1) * 0.55;
    R.box(q.x, q.y, q.z, q.x * 7 + q.z, q.size, q.size, q.size, q.color, { alpha });
  }
}
const skidMarks = [];
function drawSkids() {
  for (const sk of skidMarks) {
    R.box(sk.x, 0.045, sk.z, sk.ry, 0.32, 0.015, sk.len, [0.05, 0.05, 0.07], { alpha: 0.5 });
  }
}

// ------------------------------------------------------------ car drawing
// Cars are assembled from tinted boxes in car space: a part helper places
// boxes by (forward, right, height). Four body styles share the helper —
// low sport coupe, black-and-white police interceptor, sedan, and the
// sedan with a taxi checker band and roof sign.
function drawCar(s, car, t, isPlayerCar = false) {
  const { x, z } = car;
  const ry = car.ry;
  const phys = car.phys;
  const pitch = phys ? -phys.pitch : (car._dispA || 0) * 0.002;
  const roll = phys ? phys.roll : clamp(-(car.steer || 0) * 0.03, -0.04, 0.04);
  // Soft double shadow blob.
  R.box(x, 0.16, z, ry, 2.6, 0.06, 4.4, [0.03, 0.02, 0.05], { alpha: 0.3 });
  R.box(x, 0.18, z, ry, 2.3, 0.05, 4.0, [0.04, 0.03, 0.07], { alpha: 0.35 });

  const fx = Math.sin(ry), fz = Math.cos(ry);
  const rx = Math.cos(ry), rz = -Math.sin(ry);
  const style = car.kind === 'cop' ? 'police' : (car.style || 'sedan');

  if (car.kind === 'cop') {
    const phaseRed = Math.floor(t * 5 + car.id) % 2 === 0;
    R.box(x + fx * 0.5, 0.1, z + fz * 0.5, ry, 3.4, 0.04, 5.2,
      phaseRed ? [1, 0.07, 0.13] : [0.07, 0.4, 1], { alpha: 0.26 });
  }

  const bodyColor = car.kind === 'dead' ? [0.15, 0.14, 0.16] : car.color;
  const glass = [0.13, 0.18, 0.24];
  const darkTrim = [0.08, 0.08, 0.1];
  const part = (f, r, y, w, h, d, color, o = {}) =>
    R.box(x + fx * f + rx * r, y, z + fz * f + rz * r, ry, w, h, d, color,
      { pitch, roll, ...o });

  const steerVisual = car === s.player.inCar && car.phys
    ? car.phys.steerAngle : (car.steer || 0) * 0.4;
  car._spin = (car._spin || 0) + (car.speed || 0) * 0.09;
  const drawWheels = (radiusF, radiusR, width, frontOff, rearOff) => {
    const corners = [[-1, frontOff, 1], [1, frontOff, 1], [-1, -rearOff, 0], [1, -rearOff, 0]];
    for (const [sideSign, along, isFront] of corners) {
      const rr = isFront ? radiusF : radiusR;
      const wx = x + rx * sideSign * 0.92 + fx * along;
      const wz = z + rz * sideSign * 0.92 + fz * along;
      const wheelYaw = ry + (isFront ? steerVisual : 0);
      R.box(wx, rr, wz, wheelYaw, width, rr * 2, rr * 2, [0.05, 0.05, 0.07], { roll: car._spin });
      R.box(wx + rx * sideSign * 0.16, rr, wz + rz * sideSign * 0.16,
        wheelYaw, 0.05, rr * 1.15, rr * 1.15, [0.75, 0.76, 0.8], { roll: car._spin });
    }
  };
  const headlight = Math.sin(t * 47 + car.id) > 0 ? [1, 0.95, 0.75] : [0.9, 0.85, 0.6];
  const tailLight = [1, 0.15, 0.2];

  if (style === 'sport') {
    part(0, 0, 0.36, 1.95, 0.52, 4.4, bodyColor);
    part(1.62, 0, 0.60, 1.85, 0.30, 1.25, bodyColor, { pitch: pitch + 0.14 });
    if (!isPlayerCar) {
      part(-0.55, 0, 0.86, 1.62, 0.46, 1.7, glass);
      part(-0.55, 0, 1.12, 1.5, 0.07, 1.4, bodyColor);
    }
    part(-1.72, 0, 0.70, 1.85, 0.18, 0.9, bodyColor);
    part(-2.02, -0.6, 0.92, 0.08, 0.2, 0.3, darkTrim);
    part(-2.02, 0.6, 0.92, 0.08, 0.2, 0.3, darkTrim);
    part(-2.06, 0, 1.05, 1.9, 0.06, 0.42, bodyColor);
    drawWheels(0.33, 0.37, 0.30, 1.42, 1.42);
    part(2.18, -0.62, 0.48, 0.42, 0.13, 0.08, headlight, { emissive: true });
    part(2.18, 0.62, 0.48, 0.42, 0.13, 0.08, headlight, { emissive: true });
    part(-2.18, 0, 0.58, 1.7, 0.12, 0.08, tailLight, { emissive: true });
  } else if (style === 'police') {
    const white = [0.94, 0.94, 0.96];
    const black = [0.07, 0.07, 0.09];
    part(0, 0, 0.42, 1.9, 0.62, 4.3, white);
    part(0.1, 0, 0.44, 1.93, 0.42, 2.3, black);
    part(1.58, 0, 0.76, 1.8, 0.1, 1.05, white, { pitch: pitch + 0.08 });
    if (!isPlayerCar) {
      part(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glass);
      part(-0.15, 0, 1.33, 1.6, 0.08, 1.9, white);
    }
    part(2.28, 0, 0.45, 0.35, 0.5, 0.18, black);
    const phaseRed = Math.floor(t * 5 + car.id) % 2 === 0;
    const redLamp = [1, 0.07, 0.13];   // #ff1122
    const blueLamp = [0.07, 0.4, 1];   // #1166ff
    const lampOff = [0.3, 0.3, 0.35];
    part(0, -0.34, 1.46, 0.62, 0.16, 0.42, phaseRed ? redLamp : lampOff, { emissive: true });
    part(0, 0.34, 1.46, 0.62, 0.16, 0.42, phaseRed ? lampOff : blueLamp, { emissive: true });
    part(0, -0.34, 1.80, 1.15, 0.5, 0.75, redLamp, { emissive: true, alpha: phaseRed ? 0.34 : 0.05, add: true });
    part(0, 0.34, 1.80, 1.15, 0.5, 0.75, blueLamp, { emissive: true, alpha: phaseRed ? 0.05 : 0.34, add: true });
    drawWheels(0.34, 0.34, 0.28, 1.4, 1.4);
    part(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, headlight, { emissive: true });
    part(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, headlight, { emissive: true });
    part(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, tailLight, { emissive: true });
    part(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, tailLight, { emissive: true });
  } else {
    part(0, 0, 0.42, 1.9, 0.62, 4.3, bodyColor);
    part(1.58, 0, 0.76, 1.8, 0.1, 1.05, bodyColor, { pitch: pitch + 0.08 });
    part(-1.98, 0, 0.78, 1.8, 0.12, 0.45, bodyColor);
    if (!isPlayerCar) {
      part(-0.15, 0, 1.02, 1.7, 0.55, 2.1, glass);
      part(-0.15, 0, 1.33, 1.6, 0.08, 1.9, bodyColor);
    }
    part(2.14, 0, 0.32, 1.86, 0.22, 0.14, darkTrim);
    part(-2.14, 0, 0.32, 1.86, 0.22, 0.14, darkTrim);
    if (style === 'taxi') {
      part(0, 0, 0.52, 1.93, 0.13, 3.1, [0.12, 0.12, 0.14]);
      part(-0.15, 0, 1.48, 0.72, 0.2, 0.34, [1, 0.85, 0.4], { emissive: true });
    }
    drawWheels(0.34, 0.34, 0.28, 1.4, 1.4);
    part(2.16, -0.6, 0.55, 0.4, 0.2, 0.1, headlight, { emissive: true });
    part(2.16, 0.6, 0.55, 0.4, 0.2, 0.1, headlight, { emissive: true });
    part(-2.16, -0.6, 0.55, 0.4, 0.2, 0.1, tailLight, { emissive: true });
    part(-2.16, 0.6, 0.55, 0.4, 0.2, 0.1, tailLight, { emissive: true });
  }

  // Headlight spill on the road ahead.
  if ((car.speed || 0) > 1 || car === s.player.inCar) {
    R.box(x + fx * 3.4, 0.35, z + fz * 3.4, ry, 2.6, 0.5, 2.6, [1, 0.95, 0.7], { alpha: 0.08 });
  }
  if (car.smoke === 1) {
    spawnParticle(x, 1.2, z, 0, 1.6, 0, 0.8, 0.7, [0.55, 0.55, 0.6]);
  } else if (car.smoke === 2) {
    spawnParticle(x, 1.2, z, 0, 2.2, 0, 0.9, 0.9, [0.25, 0.2, 0.22]);
    if (Math.random() < 0.4) spawnParticle(x, 1.0, z, 0, 1.4, 0, 0.4, 0.6, [1, 0.45, 0.1]);
  }
}

// ------------------------------------------------------- cockpit interior
// Drawn in car space around the driver's eye. Layout contract (verified
// by the cockpit QA): left-hand drive with the wheel centre near 33% of
// frame width, the gauge cluster sunk onto the driver-side dash face so
// its top edge lands in the frame's bottom quarter, a full-width two-step
// dashboard, A-pillars, a narrow roof beam, a wide rear-view mirror on a
// stalk, and a sliver of body-coloured hood over the dash line.
const DASH_DARK = [0.13, 0.14, 0.17];   // lower slab (#1a1d24 family)
const DASH_MID = [0.19, 0.21, 0.26];    // upper step (#252a34 family)

function drawInterior(s, car) {
  void s;
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
  const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const at = (f, r, y) => [car.x + fx * f + rx * r, y, car.z + fz * f + rz * r];
  const place = (f, r, y, w, h, d, color, o = {}) => {
    const q = at(f, r, y);
    R.box(q[0], q[1], q[2], car.ry, w, h, d, color, o);
  };

  // Hood sliver through the base of the windshield, in body colour.
  place(1.80, -0.2, 0.90, 2.3, 0.10, 1.15, car.color || [0.7, 0.2, 0.3]);
  // Dashboard: two stepped full-width slabs. The cluster mounts on the
  // driver-side face of the lower slab — not on the windshield side,
  // where only its top edge would float into view.
  place(1.15, -0.2, 0.79, 4.4, 0.46, 0.36, DASH_DARK);
  place(1.22, -0.2, 0.95, 4.4, 0.14, 0.24, DASH_MID);
  // Matte silver trim strip along the passenger side of the dash face.
  place(0.955, 0.45, 0.97, 0.95, 0.02, 0.012, [0.62, 0.64, 0.68]);
  // Gauge cluster: dark housing plus the live dash texture panel, tilted
  // up toward the driver.
  place(0.945, -0.02, 0.778, 0.74, 0.36, 0.07, [0.09, 0.09, 0.11]);
  {
    const q = at(0.90, -0.02, 0.778);
    R.panel(q[0], q[1], q[2], car.ry, 0.64, 0.30, 'dash', { pitch: -0.21 });
  }
  place(1.02, -0.02, 1.00, 0.86, 0.06, 0.32, DASH_DARK, { pitch: -0.38 });

  // Steering wheel: a thin 16-segment ring (outer diameter ~0.31, tube
  // ~0.03), three spokes at 9, 3 and 6 o'clock, a hub and a horn cap.
  // The whole wheel rolls with the steering input. No hands — ever.
  const wheelRoll = -(car.phys ? car.phys.steerAngle : 0) * 3.2;
  const centre = at(0.80, -0.05, 0.84);
  const onWheel = (dx, dy) => {
    const cr = Math.cos(wheelRoll);
    const sr = Math.sin(wheelRoll);
    const lx = dx * cr - dy * sr;
    const ly = dx * sr + dy * cr;
    return [centre[0] + rx * lx, centre[1] + ly, centre[2] + rz * lx];
  };
  const rimColor = [0.20, 0.20, 0.23];
  const spokeColor = [0.30, 0.30, 0.34];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const q = onWheel(Math.cos(a) * 0.14, Math.sin(a) * 0.14);
    R.box(q[0], q[1], q[2], car.ry, 0.085, 0.03, 0.032, rimColor,
      { pitch: -0.32, roll: wheelRoll + a + Math.PI / 2 });
  }
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const q = onWheel(Math.cos(a) * 0.082, Math.sin(a) * 0.082);
    R.box(q[0], q[1], q[2], car.ry, 0.115, 0.026, 0.04, spokeColor,
      { pitch: -0.32, roll: wheelRoll + a });
  }
  {
    const hub = onWheel(0, 0);
    R.box(hub[0], hub[1], hub[2], car.ry, 0.10, 0.10, 0.06, [0.22, 0.22, 0.26],
      { pitch: -0.32, roll: wheelRoll });
    const cap = onWheel(0, 0);
    R.box(cap[0], cap[1], cap[2], car.ry, 0.055, 0.055, 0.07, [0.32, 0.32, 0.37],
      { pitch: -0.32, roll: wheelRoll });
  }
  place(0.58, -0.05, 0.70, 0.08, 0.08, 0.42, [0.09, 0.09, 0.11], { pitch: -0.32 });

  // A-pillars leaning in at the frame edges, and the roof's front beam.
  place(1.16, 1.04, 1.42, 0.11, 1.30, 0.055, DASH_DARK, { pitch: -0.18, roll: 0.30 });
  place(1.16, -1.72, 1.42, 0.11, 1.30, 0.055, DASH_DARK, { pitch: -0.18, roll: -0.30 });
  place(1.24, -0.35, 2.00, 3.6, 0.10, 0.12, [0.08, 0.085, 0.10]);

  // Rear-view mirror, 3.2:1, on a stalk from the beam: thin dark frame,
  // blue-grey glass, one diagonal glint.
  place(1.24, -0.32, 1.965, 0.03, 0.075, 0.03, [0.07, 0.07, 0.09]);
  place(1.26, -0.32, 1.90, 0.34, 0.105, 0.035, [0.07, 0.07, 0.09]);
  place(1.235, -0.32, 1.90, 0.30, 0.08, 0.012, [0.15, 0.21, 0.29], { emissive: true });
  place(1.23, -0.32, 1.90, 0.13, 0.010, 0.014, [0.55, 0.65, 0.78], { emissive: true, roll: 0.45 });

  // Centre console and gear knob between the seats.
  place(0.35, 0.18, 0.42, 0.42, 0.3, 1.1, DASH_DARK);
  place(0.55, 0.18, 0.6, 0.07, 0.16, 0.07, [0.2, 0.2, 0.24]);
}

// ---------------------------------------------------------- gun viewmodel
// The held weapon, built per type: the shotgun is long and thick, the
// rifle long with a box magazine, the SMG compact with a long magazine,
// the pistol short. While flashT is alive it also draws the muzzle flash
// star and a tracer streak down the aim line.
const VIEWMODEL_SHAPES = {
  shotgun: { body: 0.62, bodyW: 0.11, barrel: 0.4, barrelW: 0.07, mag: 0 },
  rifle: { body: 0.58, bodyW: 0.08, barrel: 0.38, barrelW: 0.045, mag: 0.16 },
  smg: { body: 0.42, bodyW: 0.09, barrel: 0.22, barrelW: 0.05, mag: 0.19 },
  pistol: { body: 0.46, bodyW: 0.09, barrel: 0.26, barrelW: 0.05, mag: 0 },
};

function drawGunView(s, eye, viewYaw, viewPitch, lowered = false) {
  const dir = viewDir(viewYaw, viewPitch);
  const rightX = -Math.cos(viewYaw);
  const rightZ = Math.sin(viewYaw);
  const aiming = s.player.aim && !lowered;
  const kick = (s.recoil || 0) * 0.03;
  const rightOff = aiming ? 0 : 0.23;
  const fwdOff = (aiming ? 0.62 : 0.58) - kick;
  const downOff = lowered ? -0.5 : (aiming ? -0.20 : -0.30) + kick * 0.6;
  const gx = eye[0] + dir[0] * fwdOff + rightX * rightOff;
  const gy = eye[1] + dir[1] * fwdOff + downOff;
  const gz = eye[2] + dir[2] * fwdOff + rightZ * rightOff;

  const shapeKey = s.weapon === 'shotgun' && s.hasShotgun ? 'shotgun'
    : s.weapon === 'rifle' && s.hasRifle ? 'rifle'
    : s.weapon === 'smg' && s.hasSmg ? 'smg' : 'pistol';
  const shape = VIEWMODEL_SHAPES[shapeKey];
  const gunDark = [0.1, 0.1, 0.12];
  const gunSteel = [0.16, 0.16, 0.18];
  R.box(gx, gy, gz, viewYaw, shape.bodyW, 0.15, shape.body, gunDark, { pitch: viewPitch });
  R.box(gx + dir[0] * 0.3, gy + dir[1] * 0.3 + 0.02, gz + dir[2] * 0.3,
    viewYaw, shape.barrelW, shape.barrelW, shape.barrel, gunSteel, { pitch: viewPitch });
  if (shape.mag) {
    R.box(gx + dir[0] * 0.05, gy - 0.13, gz + dir[2] * 0.05,
      viewYaw, 0.06, shape.mag, 0.09, [0.13, 0.13, 0.15], { pitch: viewPitch });
  }
  if ((s.flashT || 0) > 0) {
    const muzzleDist = 0.3 + shape.barrel * 0.5 + 0.06;
    const mx = gx + dir[0] * muzzleDist;
    const my = gy + dir[1] * muzzleDist + 0.02;
    const mz = gz + dir[2] * muzzleDist;
    const flashColor = [1, 0.8, 0.35];
    R.box(mx, my, mz, viewYaw, 0.3, 0.07, 0.07, flashColor, { pitch: viewPitch });
    R.box(mx, my, mz, viewYaw, 0.07, 0.3, 0.07, flashColor, { pitch: viewPitch });
    R.box(mx, my, mz, viewYaw, 0.12, 0.12, 0.12, [1, 0.98, 0.9], { pitch: viewPitch });
    R.box(gx + dir[0] * 6.4, gy + dir[1] * 6.4 + 0.02, gz + dir[2] * 6.4,
      viewYaw, 0.035, 0.035, 11.5, flashColor, { pitch: viewPitch, alpha: 0.75 });
  }
  // Hands: one on the grip, a forearm below when not aiming down sights.
  R.box(gx - dir[0] * 0.08 + rightX * 0.02, gy - 0.13, gz - dir[2] * 0.08 + rightZ * 0.02,
    viewYaw, 0.15, 0.11, 0.2, [0.92, 0.76, 0.6], { pitch: viewPitch });
  if (!aiming) {
    R.box(gx - dir[0] * 0.22 + rightX * 0.1, gy - 0.3, gz - dir[2] * 0.22 + rightZ * 0.1,
      viewYaw, 0.12, 0.12, 0.34, [0.97, 0.87, 0.72], { pitch: viewPitch + 0.5 });
  }
}

// ------------------------------------------------------------- people
function drawPerson(s, x, z, ry, color, o = {}) {
  void s;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const rx = Math.cos(ry), rz = -Math.sin(ry);
  R.box(x, 0.02, z, ry, 0.8, 0.04, 0.8, [0.03, 0.02, 0.05], { alpha: 0.3 });
  if (o.dead) {
    R.box(x, 0.12, z, ry, 0.55, 0.25, 1.6, color);
    return;
  }
  const phase = o.walkPhase || 0;
  const swing = Math.sin(phase) * 0.3;
  const pants = o.pants || [0.22, 0.24, 0.34];
  const skin = o.skin || [0.92, 0.76, 0.6];
  R.box(x - fx * swing * 0.4 - rx * 0.11, 0.4, z - fz * swing * 0.4 - rz * 0.11,
    ry, 0.19, 0.8, 0.23, pants, { pitch: swing * 0.7 });
  R.box(x + fx * swing * 0.4 + rx * 0.11, 0.4, z + fz * swing * 0.4 + rz * 0.11,
    ry, 0.19, 0.8, 0.23, pants, { pitch: -swing * 0.7 });
  R.box(x, 1.1, z, ry, 0.55, 0.65, 0.3, color);
  const armY = o.handsUp ? 1.95 : 1.15;
  const armPitch = o.handsUp ? 0.4 : swing * 0.55;
  R.box(x - rx * 0.36 + fx * swing * 0.18, armY, z - rz * 0.36 + fz * swing * 0.18,
    ry, 0.14, 0.6, 0.16, color, { pitch: -armPitch });
  R.box(x + rx * 0.36 - fx * swing * 0.18, armY, z + rz * 0.36 - fz * swing * 0.18,
    ry, 0.14, 0.6, 0.16, color, { pitch: armPitch });
  R.box(x, 1.62, z, ry, 0.34, 0.36, 0.34, skin);
  if (o.gun) {
    R.box(x + fx * 0.4, 1.25, z + fz * 0.4, ry, 0.08, 0.12, 0.45, [0.08, 0.08, 0.1]);
  }
}

// ------------------------------------------------------------ helicopter
// Fuselage, tail boom and fin, a translucent rotor blur disc with two soft
// blade bars, red/green nav lights, and the spotlight: three additive
// cone slabs from the belly to the target point plus a radial pool panel
// and a hot core where the beam lands. Flight pose is nose-down 15
// degrees with a 10-degree bank.
function drawHelicopter(s, t) {
  const heli = s.heli;
  const player = s.player;
  const x = heli.x;
  const z = heli.z;
  const y = heli.h || 28;
  const ry = heli.ry != null ? heli.ry : Math.atan2(player.x - x, player.z - z);
  const pose = { pitch: -0.26, roll: 0.17 };
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const rx = Math.cos(ry), rz = -Math.sin(ry);
  const hull = [0.32, 0.35, 0.44];
  const darkMetal = [0.22, 0.24, 0.31];

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

  const target = s.spotTarget || player;
  const sx = x, sy = y - 1.3, sz = z;
  const dx = target.x - sx;
  const dz = target.z - sz;
  const beamLen = Math.hypot(dx, dz, sy);
  const beamYaw = Math.atan2(dx, dz);
  const beamPitch = Math.atan2(Math.hypot(dx, dz), sy);
  for (const [frac, width] of [[0.18, 1.5], [0.5, 3.6], [0.82, 6.2]]) {
    R.box(sx + dx * frac, sy * (1 - frac) + 0.3, sz + dz * frac,
      beamYaw, width, beamLen / 3.1, width, [1, 0.97, 0.82],
      { alpha: 0.15, pitch: -beamPitch, add: true });
  }
  R.panel(target.x, 0.07, target.z, 0, 11.5, 11.5, 'pool',
    { pitch: -Math.PI / 2, alpha: 0.6, add: true });
  R.box(target.x, 0.09, target.z, 0, 3.8, 0.05, 3.8, [1, 1, 0.95], { alpha: 0.30, add: true });
}

// ----------------------------------------------------------------- render
let frameCount = 0;
let lastDt = 1 / 60;

function render(s, t) {
  const [w, h] = R.resize();
  const p = s.player;
  const car = p.inCar;
  let cam;
  if (car) {
    cam = rig.cockpit(s, car, lookYaw, lookPitch, t, lastDt);
  } else if (shotMode === 'start') {
    const dir = viewDir(s.camYaw, lookPitch);
    cam = {
      eye: [p.x, 1.72, p.z],
      center: [p.x + dir[0] * 10, 1.72 + dir[1] * 10, p.z + dir[2] * 10],
      up: [0, 1, 0], fov: 75 * Math.PI / 180, yaw: s.camYaw, pitch: lookPitch,
    };
  } else {
    cam = rig.foot(s, s.camYaw, lookPitch, t);
  }
  const proj = mat4Perspective(cam.fov, w / h, 0.05, 900);
  const view = mat4LookAt(cam.eye, cam.center, cam.up);

  // The chase still is graded as late dusk: deep blue-purple zenith, dark
  // orange horizon, dimmer ambient — the police lights and the spotlight
  // carry the frame. Everything else plays in the peach daylight grade.
  const lateDusk = s.shotMode === 'chase';
  R.zen = lateDusk ? [0.15, 0.13, 0.36] : [0.42, 0.66, 0.92];
  R.mid = lateDusk ? [0.60, 0.30, 0.24] : [0.98, 0.78, 0.58];
  R.horizon = lateDusk ? [0.82, 0.36, 0.15] : [1.0, 0.70, 0.47];
  R.fogColor = lateDusk ? [0.48, 0.30, 0.30] : [0.99, 0.80, 0.62];
  R.ambScale = lateDusk ? 0.62 : 1.0;

  R.begin(view, proj, cam.eye);
  R.draw(MESH.plain, IDENTITY);
  R.draw(MESH.road, IDENTITY, { tex: 'road' });
  R.draw(MESH.walk, IDENTITY, { tex: 'walk' });
  for (let i = 0; i < 4; i++) {
    R.draw(MESH.tex[i], IDENTITY, { tex: lateDusk ? 'b4' : 'b' + i });
  }
  R.draw(MESH.lampDots, IDENTITY, { emissive: true });
  for (const sign of MESH.signs) R.box(sign.x, sign.y, sign.z, sign.ry, sign.w, sign.h, 0.18, sign.color);
  for (const light of MESH.lights) {
    R.box(light.x, 4.4, light.z, 0, 2.6, 0.05, 2.6, [1, 0.8, 0.45], { alpha: 0.10 });
  }
  const zones = s.city.zones;
  for (const key of ['gunshop', 'hospital', 'spray', 'contact', 'harbor']) {
    const zone = zones[key];
    R.box(zone.x, 2.2, zone.z, t * 0.4, 0.5, 4.4, 0.5, zone.color, { alpha: 0.30, emissive: true });
    R.box(zone.x, 4.6, zone.z, 0, 1.6, 0.5, 1.6, zone.color, { emissive: true });
  }
  const target = s.mission?.target || s.taxi?.target;
  if (target) {
    R.box(target.x, 2.4, target.z, t * 0.6, 0.7, 4.8, 0.7, [1, 0.9, 0.3], { alpha: 0.4, emissive: true });
  }
  for (const pk of s.pickups) {
    R.box(pk.x, 0.5 + Math.sin(t * 3) * 0.12, pk.z, t * 1.5, 0.55, 0.35, 0.4,
      [0.15, 0.9, 0.35], { emissive: true });
  }
  for (const tg of s.targets || []) {
    if (!tg.down) R.box(tg.x, 1.1, tg.z, 0, 0.7, 1.5, 0.25, [1, 0.25, 0.3], { emissive: true });
  }
  if (s.boss && !s.boss.done) {
    drawPerson(s, s.boss.x, s.boss.z, Math.PI, [0.2, 0.2, 0.22], { walkPhase: 0 });
  }
  drawSkids();
  for (const c of s.cars) drawCar(s, c, t, c === p.inCar);
  for (const c of s.cops) if (c !== p.inCar) drawCar(s, c, t);
  if (s.heli) drawHelicopter(s, t);
  for (const c of [...s.cars, ...s.cops]) {
    if (c.burning > 0) {
      spawnParticle(c.x, 1.1, c.z, (Math.random() - 0.5) * 1.4,
        2.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4,
        0.5, 0.75, [1, 0.5, 0.12]);
      spawnParticle(c.x, 1.3, c.z, 0, 1.8, 0, 0.8, 0.9, [0.3, 0.28, 0.3]);
    }
  }
  for (const ped of s.peds) {
    const pace = ped.state === 'dead' ? 0 : (ped.state === 'flee' ? 11 : 6);
    ped._phase = (ped._phase || 0) + pace * lastDt * (ped.speed / 1.4);
    drawPerson(s, ped.x, ped.z, ped.ry, ped.color, {
      walkPhase: ped._phase,
      dead: ped.state === 'dead',
      handsUp: ped.state === 'handsup' || ped.state === 'robbed',
      pants: ped.pants, skin: ped.skin,
    });
  }
  drawParticles();
  if (p.inCar) drawInterior(s, p.inCar);
  else if (s.hasGun && s.mode !== 'title') {
    drawGunView(s, cam.eye, cam.yaw, cam.pitch, shotMode === 'start');
  }
  if (frameCount % 6 === 0 && p.inCar) {
    drawDashTexture(R.gl, R.textures.dash, Math.abs(p.inCar.speed) * 2.23694, p.inCar.rpm || 0.1);
  }
}

// ------------------------------------------------------------------ input
const keysDown = {};
let mouseDX = 0;
let mouseDY = 0;
let mouseLeft = false;
let mouseRight = false;
let lookYaw = 0;
let lookPitch = 0;
let lastLookMoveAt = 0;
let wantShoot = false;
let wantInteract = false;
let wantEnter = false;
let wantTaxi = false;
let wantReload = false;

addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
  keysDown[e.code] = true;
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
      S.msg = S.radio === 0 ? 'RADIO OFF'
        : S.radio === 1 ? 'RADIO · VICE FM' : 'RADIO · SOLMAR';
      S.msgT = 1.6;
    } else {
      wantReload = true;
    }
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
canvas.addEventListener('click', () => {
  audio.init();
  if (S.mode === 'title') { S.mode = 'play'; return; }
  if (S.mode === 'busted' || S.mode === 'wasted') { respawn(S, S.mode); return; }
  if (S.mode === 'paused') { S.mode = 'play'; return; }
  if (!shotMode && document.pointerLockElement !== canvas) canvas.requestPointerLock();
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
    mouseDX += e.movementX;
    mouseDY += e.movementY;
    lastLookMoveAt = performance.now();
  }
});

function readInput() {
  return {
    up: !!(keysDown.KeyW || keysDown.ArrowUp),
    down: !!(keysDown.KeyS || keysDown.ArrowDown),
    left: !!(keysDown.KeyA || keysDown.ArrowLeft),
    right: !!(keysDown.KeyD || keysDown.ArrowRight),
    shift: !!(keysDown.ShiftLeft || keysDown.ShiftRight),
    handbrake: !!keysDown.Space,
    aim: mouseRight,
    interact: wantInteract,
    reload: wantReload,
  };
}

function nearAnyCar() {
  for (const c of [...S.cars, ...S.cops]) {
    if (dist2(c.x, c.z, S.player.x, S.player.z) < 4.5 * 4.5) return true;
  }
  return false;
}

// ------------------------------------------------------- events to sound
function handleEvents(s) {
  for (const evt of drainEvents(s)) {
    switch (evt.name) {
      case 'shot': {
        audio.shot();
        const p = s.player;
        const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
        spawnParticle(p.x + fx * 0.7, 1.45, p.z + fz * 0.7, fx * 2, 0.4, fz * 2,
          0.12, 0.3, [1, 0.8, 0.3]);
        for (let i = 0; i < 3; i++) {
          spawnParticle(p.x + fx * 0.8, 1.3, p.z + fz * 0.8,
            fx + (Math.random() - 0.5), Math.random(), fz + (Math.random() - 0.5),
            0.5, 0.18, [0.7, 0.7, 0.72]);
        }
        break;
      }
      case 'targetDown':
        audio.beep(1200, 0.1, 'square', 0.14);
        s.msg = 'TARGET DOWN'; s.msgT = 1;
        break;
      case 'dryFire':
        audio.beep(200, 0.05, 'square', 0.08);
        s.msg = 'EMPTY — R TO RELOAD'; s.msgT = 1.2;
        break;
      case 'hitPed': audio.noiseBurst(0.15, 0.3, 500); break;
      case 'crash': case 'ram': audio.crash(evt.data || 8); break;
      case 'explode': {
        audio.noiseBurst(0.8, 0.7, 220);
        const { x, z } = evt.data || s.player;
        for (let i = 0; i < 30; i++) {
          spawnParticle(x, 1 + Math.random(), z,
            (Math.random() - 0.5) * 9, 2 + Math.random() * 5, (Math.random() - 0.5) * 9,
            0.7 + Math.random() * 0.5, 1.1,
            i % 3 ? [1, 0.55, 0.15] : [0.35, 0.3, 0.3]);
        }
        break;
      }
      case 'roadblockHit':
        audio.crash(14);
        s.msg = 'ROADBLOCK SMASHED'; s.msgT = 1.6;
        break;
      case 'heli': s.msg = 'AIR UNIT INBOUND'; s.msgT = 2; break;
      case 'carFire': break;
      case 'cash': case 'pickup': case 'missionDone': audio.cash(); break;
      case 'robDrop': s.msg = 'WALLET DROPPED — GRAB IT'; s.msgT = 2; break;
      case 'buyGun':
        audio.cash();
        s.msg = 'PISTOL PURCHASED — RIGHT MOUSE AIM, LEFT CLICK FIRE'; s.msgT = 3;
        break;
      case 'spray':
        audio.beep(520, 0.3, 'sawtooth', 0.1);
        s.msg = "PAY 'N SPRAY — HEAT CLEARED, FRESH PAINT"; s.msgT = 2.5;
        break;
      case 'wanted':
        s.msg = evt.data > 0 ? `WANTED ${'★'.repeat(evt.data)}` : 'HEAT LOST';
        s.msgT = 2;
        break;
      case 'busted': break;
      case 'missionFail': audio.beep(160, 0.4, 'sawtooth', 0.15); break;
      case 'save': saveProfile(s); break;
      default: break;
    }
  }
}

// ------------------------------------------------------- screenshot setup
function setupShot(kind) {
  const fx = setupShotScene(S, kind);
  if (kind === 'play') {
    // 78 degrees, in radians — the FOV punch the still is composed for.
    rig.fovPunch = 78 * Math.PI / 180;
  }
  lookPitch = kind === 'start' ? -0.03 : 0.02;
  for (const sk of fx.skids) skidMarks.push(sk);
  for (const pf of fx.puffs) {
    spawnParticle(pf.x, pf.y, pf.z, pf.vx, pf.vy, pf.vz, pf.life, pf.size, pf.color);
  }
  if (fx.barriers) {
    for (const bp of fx.barriers) S.city.props.push(bp);
    MESH = buildCityMeshes(S);
  }
  document.getElementById('help').style.display = 'none';
  if (kind === 'chase') ui.vignette.style.opacity = '0.85';
}

function giveShotCarsPhysics() {
  for (const car of S.cars) {
    if (car !== S.player.inCar) continue;
    car.phys = new VehiclePhysics();
    car.phys.u = shotMode === 'play' ? 38.5 : shotMode === 'chase' ? 23.2 : 0;
    car.phys.steerAngle = shotMode === 'play' ? 0.10 : shotMode === 'chase' ? 0.30 : 0;
    if (shotMode === 'chase') {
      car.phys.v = -15.7;
      car.phys.omega = 0.4;
    }
    car.speed = car.phys.u;
    car.rpm = shotMode === 'play' ? 0.92 : 0.8;
    car.gear = shotMode === 'play' ? 5 : 4;
    car.slip = shotMode === 'chase' ? 14 : 0;
    car.isDrifting = shotMode === 'chase';
  }
}

if (shotMode) {
  setupShot(shotMode);
  giveShotCarsPhysics();
}

// ------------------------------------------------------------------- loop
let lastTimestamp = performance.now();
let shotFrames = 0;

function computeRoadJolt(s, dt) {
  void dt;
  const car = s.player.inCar;
  if (!car) { s.roadJolt = 0; return; }
  // Lateral distance to the nearest road centre line: crossing kerbs and
  // the expansion joints between blocks thumps the cockpit camera.
  let lateral = Infinity;
  for (const c of roadCenters()) {
    lateral = Math.min(lateral, Math.abs(car.x - c), Math.abs(car.z - c));
  }
  let jolt = 0;
  const spd = Math.abs(car.speed);
  if (spd > 4) {
    if (lateral > 6.1 && lateral < 9.5) jolt += Math.sin(s.time * 43) * 0.016;
    const gridDist = Math.min(
      Math.abs(((car.x % 23) + 23) % 23 - 11.5),
      Math.abs(((car.z % 23) + 23) % 23 - 11.5));
    if (gridDist > 10.6) jolt += Math.sin(s.time * 34) * 0.02 * clamp(spd / 14, 0, 1);
  }
  s.roadJolt = jolt;
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTimestamp) / 1000 || 0.016);
  lastTimestamp = now;
  lastDt = dt;
  frameCount++;

  if (!shotMode) {
    if (mouseDX || mouseDY) {
      if (S.player.inCar) {
        lookYaw = clamp(lookYaw - mouseDX * 0.0022, -1.15, 1.15);
        lookPitch = clamp(lookPitch + mouseDY * 0.0018, -0.45, 0.55);
      } else {
        S.camYaw -= mouseDX * 0.003;
        lookPitch = clamp(lookPitch + mouseDY * 0.0022, -0.85, 0.85);
      }
      mouseDX = 0;
      mouseDY = 0;
    }
    if (S.player.inCar && performance.now() - lastLookMoveAt > 1400) {
      lookYaw *= Math.exp(-dt * 2.2);
      lookPitch *= Math.exp(-dt * 2.2);
    }
    if (S.mode === 'play') {
      if (wantEnter) { enterExitCar(S); wantEnter = false; }
      if (wantTaxi) { startTaxi(S); wantTaxi = false; }
      const input = readInput();
      if (!S.player.inCar && (wantShoot || (mouseLeft && weaponDef(S).auto))) {
        if ((S.fireCd || 0) <= 0) {
          shoot(S);
          S.fireCd = weaponDef(S).cd;
        }
      }
      step(S, input, dt);
      const pc = S.player.inCar;
      if (pc && pc.isDrifting && Math.abs(pc.speed) > 5) {
        skidMarks.push({ x: pc.x, z: pc.z, ry: pc.ry, len: 2.2 });
        if (skidMarks.length > 240) skidMarks.shift();
        const fx = Math.sin(pc.ry), fz = Math.cos(pc.ry);
        for (let i = 0; i < 2; i++) {
          spawnParticle(pc.x - fx * 1.6, 0.4, pc.z - fz * 1.6,
            (Math.random() - 0.5) * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2,
            0.9, 0.8, [0.82, 0.82, 0.86]);
        }
      }
      if (pc && (pc.slip || 0) > 1.1 && Math.abs(pc.speed) > 5 && Math.random() < 0.6) {
        const fx = Math.sin(pc.ry), fz = Math.cos(pc.ry);
        spawnParticle(pc.x - fx * 1.6, 0.35, pc.z - fz * 1.6, 0, 1, 0,
          0.7, 0.7, [0.8, 0.8, 0.84]);
      }
      handleEvents(S);
      computeRoadJolt(S, dt);
    }
    wantShoot = false;
    wantInteract = false;
    wantReload = false;
    audio.frame(S);
  }

  stepParticles(shotMode ? 0 : dt);
  render(S, S.time);
  updateHUD(S, ui, nearAnyCar);
  drawMinimap(S, minimapCtx);
  const showVignette = shotMode === 'chase' || S.trauma > 0.25;
  ui.vignette.style.opacity = showVignette
    ? String(Math.min(0.85, 0.35 + (S.trauma || 0) * 0.5)) : '0';

  if (shotMode) {
    shotFrames++;
    if (shotFrames > 15) window.__shotReady = true;
  }
}
requestAnimationFrame(loop);
console.log('Vice Blocks 3D booted', shotMode ? `(shot=${shotMode} seed=${seedParam})` : '');
