// Vice Blocks 3D — shell: input, camera, WebGL rendering, HUD, minimap, audio.
// Simulation lives in sim.js (pure); engine in gl.js; city data in city.js.
import { Renderer, Builder, mat4Perspective, mat4LookAt, mat4Multiply, mat4Model } from './gl.js';
import { createState, step, enterExitCar, shoot, respawn, drainEvents, startMission } from './sim.js';
import { roadCenters, CITY_HALF, BLOCK } from './city.js';
import { clamp } from './rng.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
const seed = parseInt(params.get('seed') || '7', 10) || 7;

const canvas = document.getElementById('gl');
const R = new Renderer(canvas);
const ui = {};
for (const id of ['hud','health','cash','stars','weapon','banner','msg','minimap','speed','bustbar','bustfill','overlay','ovTitle','ovSub','mission','timer','prompt'])
  ui[id] = document.getElementById(id);

// ---------- save ----------
let saved = null;
try { saved = JSON.parse(localStorage.getItem('viceblocks-save') || 'null'); } catch { saved = null; }
function persist(s) {
  try { localStorage.setItem('viceblocks-save', JSON.stringify({ cash: s.cash, missionIdx: s.missionIdx, hasGun: s.hasGun })); } catch {}
}

// ---------- audio (synthesised, created on first gesture) ----------
let AC = null, engineOsc = null, engineGain = null, sirenOsc = null, sirenGain = null, screechGain = null;
function audioInit() {
  if (AC || shotMode) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = AC.createOscillator(); engineOsc.type = 'sawtooth';
    engineGain = AC.createGain(); engineGain.gain.value = 0;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    engineOsc.connect(f); f.connect(engineGain); engineGain.connect(AC.destination); engineOsc.start();
    sirenOsc = AC.createOscillator(); sirenOsc.type = 'triangle';
    sirenGain = AC.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain); sirenGain.connect(AC.destination); sirenOsc.start();
    // tyre screech: looped noise through a bandpass, gain follows slip
    const len = AC.sampleRate;
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 2.5;
    screechGain = AC.createGain(); screechGain.gain.value = 0;
    src.connect(bp); bp.connect(screechGain); screechGain.connect(AC.destination); src.start();
  } catch { AC = null; }
}
function beep(freq, dur, type = 'square', vol = 0.12, slide = 0) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), AC.currentTime + dur);
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
}
function noiseBurst(dur, vol, freq) {
  if (!AC) return;
  const len = Math.floor(AC.sampleRate * dur);
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = AC.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(AC.destination); src.start();
}
function audioFrame(s) {
  if (!AC) return;
  const car = s.player.inCar;
  engineGain.gain.value = car && s.mode === 'play' ? 0.055 : 0;
  if (car) {
    // pitch follows rpm (with gear steps baked into rpm by the sim)
    engineOsc.frequency.value = 48 + (car.rpm || 0.3) * 165;
    const slip = Math.abs(car.slip || 0);
    const screech = (slip > 1.1 && Math.abs(car.speed) > 4) || (car.handbrake && Math.abs(car.speed) > 6);
    screechGain.gain.value = screech && s.mode === 'play' ? Math.min(0.14, slip * 0.03) : 0;
  } else if (screechGain) screechGain.gain.value = 0;
  const copsNear = s.cops.some(c => c.kind === 'cop');
  sirenGain.gain.value = copsNear && s.mode === 'play' ? 0.035 : 0;
  if (sirenOsc) sirenOsc.frequency.value = (Math.floor(s.time * 1.6) % 2 === 0) ? 660 : 880;
}

// ---------- static city meshes ----------
function buildCityMeshes(city) {
  const plain = new Builder();
  const byTex = { b0: new Builder(), b1: new Builder(), b2: new Builder(), b3: new Builder() };
  const E = CITY_HALF + 90;
  // ground base (asphalt underlay + surrounding sand)
  plain.quad([-E,0,-E],[E,0,-E],[E,0,E],[-E,0,E],[0,1,0],[0.55,0.48,0.38]);
  // ocean to the east
  plain.quad([CITY_HALF+26,0.15,-E],[E,0.15,-E],[E,0.15,E],[CITY_HALF+26,0.15,E],[0,1,0],[0.1,0.45,0.75]);
  plain.quad([CITY_HALF+8,0.06,-E],[CITY_HALF+26,0.06,-E],[CITY_HALF+26,0.06,E],[CITY_HALF+8,0.06,E],[0,1,0],[0.93,0.82,0.6]);
  const centers = roadCenters();
  // road surfaces + sidewalks
  for (const c of centers) {
    plain.quad([c-7.5,0.04,-CITY_HALF-20],[c+7.5,0.04,-CITY_HALF-20],[c+7.5,0.04,CITY_HALF+20],[c-7.5,0.04,CITY_HALF+20],[0,1,0],[0.16,0.16,0.2]);
    plain.quad([-CITY_HALF-20,0.04,c-7.5],[-CITY_HALF-20,0.04,c+7.5],[CITY_HALF+20,0.04,c+7.5],[CITY_HALF+20,0.04,c-7.5],[0,1,0],[0.16,0.16,0.2]);
    for (const sgn of [-1, 1]) {
      plain.box(c + sgn*9.3, 0, 0, 3.4, 0.18, (CITY_HALF+20)*2, [0.62,0.6,0.58]);
      plain.box(0, 0, c + sgn*9.3, (CITY_HALF+20)*2, 0.18, 3.4, [0.62,0.6,0.58]);
    }
    // dashed centre lines
    for (let t = -CITY_HALF - 16; t < CITY_HALF + 16; t += 8) {
      plain.quad([c-0.25,0.07,t],[c+0.25,0.07,t],[c+0.25,0.07,t+3.6],[c-0.25,0.07,t+3.6],[0,1,0],[0.95,0.85,0.3]);
      plain.quad([t,0.07,c-0.25],[t,0.07,c+0.25],[t+3.6,0.07,c+0.25],[t+3.6,0.07,c-0.25],[0,1,0],[0.95,0.85,0.3]);
    }
  }
  // block infill (grass-ish lots under buildings)
  const lot = BLOCK - 15;
  for (let gx = 0; gx < 5; gx++) for (let gz = 0; gz < 5; gz++) {
    const cx = -5 * BLOCK / 2 + gx * BLOCK + BLOCK / 2;
    const cz = -5 * BLOCK / 2 + gz * BLOCK + BLOCK / 2;
    plain.box(cx, 0, cz, lot, 0.12, lot, [0.45,0.55,0.4]);
  }
  // buildings into per-texture builders
  for (const b of city.buildings) {
    const rep = Math.max(1, Math.round(b.h / 11));
    byTex['b' + b.tex].box(b.x, 0, b.z, b.w, b.h, b.d, b.color, rep);
  }
  // palms: trunk + fronds
  for (const p of city.palms) {
    plain.box(p.x, 0, p.z, 0.5, 5.2 * p.s, 0.5, [0.5,0.38,0.25]);
    const tx = p.x + p.lean * 8, tz = p.z, ty = 5.2 * p.s;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      plain.box(tx + Math.sin(a) * 1.7, ty + 0.25, tz + Math.cos(a) * 1.7, 0.5, 0.16, 3.4, [0.2,0.65,0.3]);
    }
  }
  // street lights: pole + head (heads also drawn emissive at draw time via sign mesh)
  for (const l of city.lights) plain.box(l.x, 0, l.z, 0.28, 6, 0.28, [0.3,0.3,0.35]);
  // street props: bins, barriers, hydrants, crates
  for (const pr of city.props || []) {
    if (pr.kind === 'bin') plain.box(pr.x, 0, pr.z, 0.7, 1.1, 0.7, [0.25, 0.45, 0.3]);
    else if (pr.kind === 'hydrant') { plain.box(pr.x, 0, pr.z, 0.42, 0.8, 0.42, [0.85, 0.3, 0.2]); plain.box(pr.x, 0.8, pr.z, 0.5, 0.18, 0.5, [0.9, 0.8, 0.3]); }
    else if (pr.kind === 'barrier') {
      plain.box(pr.x, 0.35, pr.z, 2.2, 0.5, 0.3, [0.92, 0.92, 0.9]);
      plain.box(pr.x, 0.52, pr.z, 2.24, 0.18, 0.32, [0.9, 0.45, 0.15]);
      plain.box(pr.x - 0.9, 0, pr.z, 0.18, 0.35, 0.3, [0.3, 0.3, 0.3]);
      plain.box(pr.x + 0.9, 0, pr.z, 0.18, 0.35, 0.3, [0.3, 0.3, 0.3]);
    } else plain.box(pr.x, 0, pr.z, 1.1, 1.1, 1.1, pr.color);
  }
  // distant skyline silhouettes on the horizon (fog fades them into the sky)
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.05;
    const d = 300 + (i % 5) * 22;
    const sx = Math.sin(a) * d, sz = Math.cos(a) * d;
    if (sx > CITY_HALF + 40 && sz > 0) continue; // keep the ocean side open
    plain.box(sx, 0, sz, 26 + (i % 4) * 9, 40 + (i % 6) * 13, 26, [0.42, 0.36, 0.48]);
  }
  const meshes = { plain: plain.build(R), tex: {} };
  for (const k of Object.keys(byTex)) meshes.tex[k] = byTex[k].build(R);
  // emissive builder: neon signs + lamp heads + zone markers glow
  const em = new Builder();
  for (const sg of city.signs) {
    const c = Math.cos(sg.ry), s = Math.sin(sg.ry);
    const hw = sg.w / 2;
    const p1 = [sg.x - c*hw, sg.y, sg.z + s*hw], p2 = [sg.x + c*hw, sg.y, sg.z - s*hw];
    em.quad(p1, p2, [p2[0], sg.y + sg.h, p2[2]], [p1[0], sg.y + sg.h, p1[2]], [s,0,-c], sg.color);
  }
  for (const l of city.lights) em.box(l.x, 5.8, l.z, 0.7, 0.35, 0.7, [1,0.9,0.55]);
  meshes.emissive = em.build(R);
  return meshes;
}

// ---------- entity drawing ----------
// Particle system (shell-side, visual only): smoke, sparks, muzzle flash.
const particles = [];
function spawnP(x, y, z, vx, vy, vz, life, size, color, opts = {}) {
  if (particles.length > 420) particles.shift();
  particles.push({ x, y, z, vx, vy, vz, life, max: life, size, color, ...opts });
}
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy += (p.grav || 0) * dt;
    if (p.grow) p.size += p.grow * dt;
  }
}
function drawParticles() {
  for (const p of particles) {
    const a = clamp(p.life / p.max, 0, 1) * (p.alpha != null ? p.alpha : 0.55);
    R.box(p.x, p.y, p.z, p.ry || 0, p.size, p.size, p.size, p.color, { alpha: a, emissive: !!p.emissive });
  }
}

function drawInterior(s, car) {
  const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
  const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
  const at = (f, r, y) => [car.x + fx * f + rx * r, y, car.z + fz * f + rz * r];
  // dashboard: dark slab + top pad + glowing gauge dots
  let q = at(1.02, 0, 0.80);
  R.box(q[0], q[1], q[2], car.ry, 2.05, 0.34, 0.5, [0.09, 0.09, 0.12]);
  q = at(1.06, 0, 0.99);
  R.box(q[0], q[1], q[2], car.ry, 2.05, 0.07, 0.42, [0.16, 0.15, 0.2]);
  for (const [gr, col] of [[-0.62, [0.4, 0.95, 1]], [-0.44, [1, 0.6, 0.3]], [-0.26, [0.5, 1, 0.6]]]) {
    q = at(1.24, gr, 0.88);
    R.box(q[0], q[1], q[2], car.ry, 0.09, 0.09, 0.03, col, { emissive: true });
  }
  // steering wheel: open rim built from bars (see-through centre), spins with the front wheels
  const wheelRoll = -(car.steerAngle || 0) * 4.2;
  const wc = at(0.66, -0.44, 0.86);
  const wob = (dx, dy) => {
    // offset in the wheel's rolled frame: local X = car right, local Y = world up (approx)
    const cr = Math.cos(wheelRoll), sr = Math.sin(wheelRoll);
    const lx = dx * cr - dy * sr, ly = dx * sr + dy * cr;
    return [wc[0] + rx * lx, wc[1] + ly, wc[2] + rz * lx];
  };
  let b;
  b = wob(0, 0.21); R.box(b[0], b[1], b[2], car.ry, 0.5, 0.07, 0.07, [0.07, 0.07, 0.09], { pitch: -0.32, roll: wheelRoll });
  b = wob(0, -0.21); R.box(b[0], b[1], b[2], car.ry, 0.5, 0.07, 0.07, [0.07, 0.07, 0.09], { pitch: -0.32, roll: wheelRoll });
  b = wob(-0.21, 0); R.box(b[0], b[1], b[2], car.ry, 0.07, 0.36, 0.07, [0.07, 0.07, 0.09], { pitch: -0.32, roll: wheelRoll });
  b = wob(0.21, 0); R.box(b[0], b[1], b[2], car.ry, 0.07, 0.36, 0.07, [0.07, 0.07, 0.09], { pitch: -0.32, roll: wheelRoll });
  b = wob(0, -0.1); R.box(b[0], b[1], b[2], car.ry, 0.07, 0.22, 0.08, [0.2, 0.2, 0.24], { pitch: -0.32, roll: wheelRoll });
  b = wob(0, 0); R.box(b[0], b[1], b[2], car.ry, 0.17, 0.17, 0.11, [0.12, 0.12, 0.15], { pitch: -0.32, roll: wheelRoll });
  // mirrors
  for (const sd of [-1, 1]) {
    q = at(0.92, sd * 1.04, 1.3);
    R.box(q[0], q[1], q[2], car.ry, 0.3, 0.17, 0.05, [0.08, 0.08, 0.1]);
    q = at(0.9, sd * 1.03, 1.3);
    R.box(q[0], q[1], q[2], car.ry, 0.24, 0.12, 0.02, [0.75, 0.85, 0.95], { emissive: true });
  }
  // roof brow so the top of the windscreen reads as a car, not a void
  q = at(1.12, 0, 1.66);
  R.box(q[0], q[1], q[2], car.ry, 2.05, 0.09, 0.3, [0.08, 0.08, 0.11]);
}
function drawGunView(s, eye, viewYaw, viewPitch) {
  const d = viewDir(viewYaw, viewPitch);
  const rx = Math.cos(viewYaw), rz = -Math.sin(viewYaw);
  const aim = s.player.aim;
  const rOff = aim ? 0 : 0.23, dOff = aim ? 0.42 : 0.5, yOff = aim ? -0.145 : -0.27;
  const gx = eye[0] + d[0] * dOff + rx * rOff, gy = eye[1] + d[1] * dOff + yOff, gz = eye[2] + d[2] * dOff + rz * rOff;
  R.box(gx, gy, gz, viewYaw, 0.09, 0.15, 0.46, [0.1, 0.1, 0.12], { pitch: viewPitch });
  R.box(gx + d[0] * 0.3, gy + d[1] * 0.3 + 0.02, gz + d[2] * 0.3, viewYaw, 0.05, 0.05, 0.26, [0.16, 0.16, 0.18], { pitch: viewPitch });
  // hand + forearm coming up from below
  R.box(gx - d[0] * 0.08 + rx * 0.02, gy - 0.13, gz - d[2] * 0.08 + rz * 0.02, viewYaw, 0.15, 0.11, 0.2, [0.92, 0.76, 0.6], { pitch: viewPitch });
  if (!aim) R.box(gx - d[0] * 0.22 + rx * 0.1, gy - 0.3, gz - d[2] * 0.22 + rz * 0.1, viewYaw, 0.13, 0.13, 0.42, [0.95, 0.45, 0.75], { pitch: viewPitch + 0.5 });
}

function drawCar(s, car, t, interior = false) {
  const smoke = car.smoke;
  const body = car.kind === 'dead' ? [0.15,0.15,0.15] : car.color;
  const x = car.x, z = car.z, ry = car.ry;
  // soft ground shadow: two layered translucent blobs
  R.box(x, 0.03, z, ry, 2.9, 0.05, 5.1, [0.05,0.04,0.08], { alpha: 0.28 });
  R.box(x, 0.05, z, ry, 2.35, 0.05, 4.4, [0.04,0.03,0.07], { alpha: 0.35 });
  // body pose: pitch from acceleration, roll from turn rate (smoothed)
  const accel = ((car.speed || 0) - (car._ps || 0)) * 3;
  car._ps = car.speed || 0;
  let dry = ry - (car._pry != null ? car._pry : ry);
  while (dry > Math.PI) dry -= Math.PI * 2;
  while (dry < -Math.PI) dry += Math.PI * 2;
  car._pry = ry;
  car._pitch = clamp((car._pitch || 0) + (clamp(-accel * 0.012, -0.05, 0.07) - (car._pitch || 0)) * 0.18, -0.06, 0.08);
  car._roll = clamp((car._roll || 0) + (clamp(-dry * 2.4, -0.09, 0.09) - (car._roll || 0)) * 0.2, -0.1, 0.1);
  const pitch = car._pitch, roll = car._roll;
  R.box(x, 0.35, z, ry, 2.0, 0.75, 4.2, body, { pitch, roll });
  if (!interior) R.box(x, 0.95, z, ry, 1.8, 0.62, 2.2, car.kind === 'cop' ? [0.12,0.12,0.14] : [0.15,0.2,0.28], { pitch, roll });
  if (car.kind === 'cop') {
    const flash = Math.floor(t * 3) % 2 === 0;
    R.box(x, 1.32, z, ry, 1.2, 0.22, 0.5, flash ? [1,0.15,0.2] : [0.2,0.4,1], { emissive: true });
    R.box(x, 0.36, z, ry, 2.04, 0.4, 1.1, [0.1,0.1,0.12]);
    // alternating red/blue light pool washing the ground around the car
    R.box(x, 0.06, z, ry, 7.5, 0.04, 9.5, flash ? [1,0.2,0.25] : [0.25,0.45,1], { alpha: 0.16, emissive: true });
  }
  // headlight cones (translucent) + lamp dots
  const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
  if (car.kind !== 'dead') {
    for (const sd of [-1, 1]) {
      const hx = x + rx * sd * 0.62 + fx * 2.1, hz = z + rz * sd * 0.62 + fz * 2.1;
      R.box(hx, 0.55, hz, ry, 0.34, 0.22, 0.12, [1, 0.92, 0.66], { emissive: true });
      R.box(hx + fx * 3.4, 0.34, hz + fz * 3.4, ry, 1.15, 0.5, 6.4, [1, 0.9, 0.6], { alpha: 0.10, emissive: true });
    }
  }
  // wheels: spin around their axle, front wheels visibly steer
  const spin = (car._spin || 0);
  const steerVis = clamp((car.steer || 0) * 0.5 + dry * 6, -0.55, 0.55);
  for (const [sx, sz, front] of [[-1,-1.35,0],[1,-1.35,0],[-1,1.35,1],[1,1.35,1]]) {
    const wx = x + rx * sx * 1.02 + fx * sz, wz = z + rz * sx * 1.02 + fz * sz;
    const wry = ry + (front ? steerVis : 0);
    R.box(wx, 0.38 + Math.sin(spin + sz) * 0.02, wz, wry, 0.34, 0.72, 0.72, [0.08,0.08,0.1]);
    R.box(wx, 0.38, wz, wry, 0.4, 0.3, 0.3, [0.75,0.75,0.8]);
  }
  if (smoke > 0) {
    const n = smoke === 2 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const ph = (t * 1.4 + i * 0.37 + car.id) % 1;
      R.box(x + Math.sin(car.id + i) * 0.4, 1.3 + ph * 2.6, z, 0, 0.7 + ph, 0.7 + ph, smoke === 2 && ph > 0.6 ? [1,0.45,0.1] : [0.35,0.35,0.38], smoke === 2 && ph > 0.6 ? { emissive: true } : {});
    }
  }
}
function drawPerson(s, x, z, ry, color, opts = {}) {
  R.box(x, 0.03, z, ry, 1.15, 0.05, 1.15, [0.05,0.04,0.08], { alpha: 0.3 });
  const walk = opts.walkPhase || 0;
  const legSwing = Math.sin(walk) * 0.16;
  R.box(x, 0.85, z, ry, 0.62, 0.85, 0.36, color);
  R.box(x, 1.62, z, ry, 0.42, 0.42, 0.42, [0.92,0.76,0.6]);
  const fx = Math.sin(ry), fz = Math.cos(ry), rxv = Math.cos(ry), rzv = -Math.sin(ry);
  for (const sd of [-1, 1]) {
    R.box(x + rxv * sd * 0.18 + fx * legSwing * sd, 0.4, z + rzv * sd * 0.18 + fz * legSwing * sd, ry, 0.2, 0.8, 0.24, [0.2,0.2,0.35]);
  }
  if (opts.gun) {
    R.box(x + fx * 0.55, 1.15, z + fz * 0.55, ry, 0.12, 0.12, 0.62, [0.1,0.1,0.12]);
  }
  if (opts.dead) { /* handled by caller rotation choice */ }
}
function drawMarker(x, z, color, t) {
  const bob = Math.sin(t * 2.4) * 0.5;
  R.box(x, 0, z, 0, 0.5, 9, 0.5, color, { emissive: true });
  R.box(x, 7.6 + bob, z, t * 1.5, 1.5, 1.5, 1.5, color, { emissive: true });
}

// ---------- state ----------
let S = createState(seed, shotMode ? null : saved);
let meshes = buildCityMeshes(S.city);
if (!shotMode) { /* story starts on title; missions start on play */ }

function setupShot(kind) {
  const s = S;
  s.mode = kind === 'start' ? 'title' : kind === 'end' ? 'busted' : 'play';
  const p = s.player;
  if (kind === 'play' || kind === 'chase') {
    const car = s.cars.find(c => c.kind === 'parked');
    car.kind = 'player'; car.x = BLOCK * 0.5; car.z = BLOCK * 0.5; car.ry = Math.PI / 2; car.speed = kind === 'play' ? 10 : 14;
    p.inCar = car; p.x = car.x; p.z = car.z; p.ry = car.ry;
    s.camYaw = Math.PI / 2; s.camPitch = 0.3;
    s.missionIdx = 1; s.cash = 370; s.hasGun = true;
    s.mission = { name: 'HOT PACKAGE', desc: 'Deliver the package!', type: 'deliver', pay: 250, time: 42, phase: 0, timer: 42, target: { x: BLOCK * 1.5, z: -BLOCK * 1.5, r: 6 } };
    s.banner = 'HOT PACKAGE'; s.bannerT = 99;
  }
  if (kind === 'chase') {
    s.wanted = 3; s.crimeHeat = 99; s.cash = 640;
    const spots = [[16, 3.5, Math.PI / 2], [19, -4, Math.PI / 2], [-13, 2, Math.PI / 2]];
    for (const [ox, oz, ry] of spots) {
      s.cops.push({ id: 950 + s.cops.length, kind: 'cop', x: p.x + ox, z: p.z + oz, ry, speed: 8, targetSpeed: 20, hp: 120, smoke: 0, driver: true, stopped: 0, color: [0.95,0.95,0.97] });
    }
  }
  if (kind === 'chase' || kind === 'play') {
    // frozen tyre-smoke trail behind the player's rear wheels for motion feel
    const car = p.inCar;
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry), rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    for (let i = 0; i < 16; i++) {
      const back = 2 + i * 0.85, sd = i % 2 ? 0.95 : -0.95;
      spawnP(car.x + rx * sd - fx * back, 0.35 + i * 0.05, car.z + rz * sd - fz * back,
        -fx * 0.4, 0.5, -fz * 0.4, 99, 0.8 + i * 0.12, [0.88, 0.88, 0.92], { alpha: 0.4 });
    }
    if (kind === 'chase') {
      for (let i = 0; i < 7; i++) { // sparks near the lead cop's bumper
        const c0 = s.cops[0];
        spawnP(c0.x + 1.5 - i * 0.3, 0.4 + (i % 3) * 0.22, c0.z - 2 + i * 0.2, -1, 0.8, 0.5, 99, 0.16, [1, 0.72, 0.25], { emissive: true, alpha: 0.95 });
      }
    }
  }
  if (kind === 'end') {
    p.x = BLOCK * 0.5; p.z = BLOCK * 0.5 + 5; p.ry = 0.5; p.inCar = null;
    s.camYaw = 0.4; s.camPitch = 0.3;
    s.wanted = 3; s.cash = 275; s.fine = 550; s.health = 62;
    const spots = [[-6, -5, 0.7], [7, -4, -0.6], [1, 8, 3.1]];
    for (const [ox, oz, ry] of spots) {
      s.cops.push({ id: 960 + s.cops.length, kind: 'cop', x: p.x + ox, z: p.z + oz, ry, speed: 0, targetSpeed: 20, hp: 120, smoke: 0, driver: true, stopped: 0, color: [0.95,0.95,0.97] });
    }
    s.bustTimer = 3.2;
  }
  if (kind === 'start') {
    // Title seen from the driver's seat of a parked car at an intersection.
    s.cash = 120;
    const car = s.cars.find(c => c.kind === 'parked');
    car.kind = 'player'; car.x = BLOCK * 0.5; car.z = BLOCK * 0.5; car.ry = Math.PI / 2; car.speed = 0;
    car.steerAngle = 0.22; car.steer = 1;
    p.inCar = car; p.x = car.x; p.z = car.z;
  }
  if ((kind === 'play' || kind === 'chase') && p.inCar) {
    p.inCar.steerAngle = kind === 'chase' ? 0.34 : 0.14;
    p.inCar.steer = 1;
  }
}
if (shotMode) setupShot(shotMode);

// ---------- input ----------
const keys = {};
let mouseDX = 0, mouseDY = 0, mouseDownL = false, mouseDownR = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyF' || e.code === 'KeyE') tryEnter();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'Enter') confirmOverlay();
  if (['ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => {
  audioInit();
  if (e.button === 0) { mouseDownL = true; if (S.mode === 'play' && !S.player.inCar && S.hasGun) shoot(S); }
  if (e.button === 2) mouseDownR = true;
  if (S.mode === 'play' && !shotMode) canvas.requestPointerLock?.();
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDownL = false; if (e.button === 2) mouseDownR = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) { mouseDX += e.movementX; mouseDY += e.movementY; lastLookMove = performance.now(); }
});
addEventListener('contextmenu', (e) => e.preventDefault());
ui.overlay.addEventListener('click', () => { audioInit(); confirmOverlay(); });

function nearCar() {
  const p = S.player;
  if (p.inCar) return true;
  return [...S.cars, ...S.cops].some(c => (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < 4.5 * 4.5);
}
function tryEnter() {
  if (S.mode !== 'play' || shotMode) return;
  if (nearCar()) enterExitCar(S);
}
function togglePause() {
  if (shotMode) return;
  if (S.mode === 'play') S.mode = 'paused';
  else if (S.mode === 'paused') S.mode = 'play';
}
function confirmOverlay() {
  if (shotMode) return;
  if (S.mode === 'title') {
    S.mode = 'play';
    if (!S.mission) startMission(S);
  } else if (S.mode === 'busted') respawn(S, 'busted');
  else if (S.mode === 'wasted') respawn(S, 'wasted');
  else if (S.mode === 'paused') S.mode = 'play';
}

let lookYaw = 0, lookPitch = 0, lastLookMove = 0;
function readInput() {
  return {
    up: !!(keys.KeyW || keys.ArrowUp), down: !!(keys.KeyS || keys.ArrowDown),
    left: !!(keys.KeyA || keys.ArrowLeft), right: !!(keys.KeyD || keys.ArrowRight),
    shift: !!(keys.ShiftLeft || keys.ShiftRight),
    handbrake: !!keys.Space,
    aim: mouseDownR, interact: !!keys.KeyE && !nearCar(),
  };
}

// ---------- HUD ----------
const mm = ui.minimap.getContext('2d');
function drawMinimap(s) {
  const W = 168, H = 168, scale = W / (CITY_HALF * 2 + 40);
  const px = (x) => (x + CITY_HALF + 20) * scale, pz = (z) => (z + CITY_HALF + 20) * scale;
  mm.fillStyle = '#20303c'; mm.fillRect(0, 0, W, H);
  mm.strokeStyle = '#4a6070'; mm.lineWidth = 5;
  for (const c of roadCenters()) {
    mm.beginPath(); mm.moveTo(px(c), 0); mm.lineTo(px(c), H); mm.stroke();
    mm.beginPath(); mm.moveTo(0, pz(c)); mm.lineTo(W, pz(c)); mm.stroke();
  }
  mm.lineWidth = 1;
  const dot = (x, z, col, r) => { mm.fillStyle = col; mm.beginPath(); mm.arc(px(x), pz(z), r, 0, 7); mm.fill(); };
  for (const z of Object.values(s.city.zones)) dot(z.x, z.z, '#7fe0a0', 2.5);
  for (const c of s.cops) if (c.kind === 'cop') dot(c.x, c.z, Math.floor(s.time * 3) % 2 ? '#ff4040' : '#4080ff', 3);
  for (const c of s.cars) if (c.kind === 'traffic') dot(c.x, c.z, '#c8c8c8', 1.6);
  if (s.mission?.target) dot(s.mission.target.x, s.mission.target.z, '#ff4fd8', 4);
  const p = s.player;
  dot(p.x, p.z, '#ffffff', 3.5);
  mm.strokeStyle = '#fff'; mm.beginPath();
  mm.moveTo(px(p.x), pz(p.z));
  mm.lineTo(px(p.x) + Math.sin(p.ry) * 8, pz(p.z) + Math.cos(p.ry) * 8); mm.stroke();
}
function updateHUD(s) {
  const playing = s.mode === 'play' || s.mode === 'paused';
  ui.hud.style.display = (playing || shotMode) ? 'block' : 'none';
  ui.health.style.width = Math.max(0, s.health) + '%';
  ui.health.style.background = s.health > 30 ? '#57e389' : '#e35757';
  ui.cash.textContent = '$' + s.cash;
  ui.stars.textContent = '★★★★★'.slice(0, s.wanted) + '☆☆☆☆☆'.slice(0, 5 - s.wanted);
  ui.stars.style.color = s.wanted ? '#ffd94f' : '#666';
  ui.weapon.textContent = s.player.inCar ? 'DRIVING' : (s.hasGun ? (s.player.aim ? 'PISTOL · AIMING' : 'PISTOL') : 'UNARMED');
  ui.banner.style.display = s.bannerT > 0 ? 'block' : 'none';
  ui.banner.textContent = s.banner || '';
  ui.msg.style.display = s.msgT > 0 ? 'block' : 'none';
  ui.msg.textContent = s.msg || '';
  const m = s.mission;
  ui.mission.textContent = (playing && m) ? `${m.name} — ${m.desc}` : '';
  ui.timer.textContent = (playing && m && m.timer > 0) ? Math.ceil(m.timer) + 's' : '';
  ui.speed.textContent = s.player.inCar ? Math.round(Math.abs(s.player.inCar.speed) * 3.6) + ' km/h' : '';
  const bust = s.bustTimer > 0.15 && s.wanted > 0;
  ui.bustbar.style.display = bust ? 'block' : 'none';
  ui.bustfill.style.width = Math.min(100, s.bustTimer / 3.2 * 100) + '%';
  // contextual prompt
  let prompt = '';
  if (playing && !s.player.inCar) {
    if (nearCar()) prompt = 'F — STEAL / ENTER CAR';
    else {
      const z = s.city.zones;
      const d2 = (a) => (s.player.x - a.x) ** 2 + (s.player.z - a.z) ** 2;
      if (d2(z.gunshop) < z.gunshop.r * z.gunshop.r) prompt = s.hasGun ? 'GUN SHOP — YOU OWN A PISTOL' : 'E — BUY PISTOL $300';
      else if (d2(z.hospital) < z.hospital.r * z.hospital.r) prompt = 'HOSPITAL — HEALING…';
    }
  } else if (playing && s.player.inCar) {
    const z = s.city.zones.spray;
    if ((s.player.x - z.x) ** 2 + (s.player.z - z.z) ** 2 < z.r * z.r) prompt = "PAY 'N SPRAY — $200 CLEARS STARS";
    else prompt = 'F — EXIT CAR';
  }
  ui.prompt.textContent = prompt;
  // overlay screens
  const ov = { title: ['VICE BLOCKS', '3D OPEN-WORLD CRIME · CLICK TO PLAY'], paused: ['PAUSED', 'Click or press Enter to resume'],
    busted: ['BUSTED', ''], wasted: ['WASTED', ''] }[s.mode];
  if (ov) {
    ui.overlay.style.display = 'flex';
    ui.ovTitle.textContent = ov[0];
    ui.ovTitle.style.color = s.mode === 'busted' ? '#6ab0ff' : s.mode === 'wasted' ? '#ff5252' : '#ff4fd8';
    ui.ovSub.textContent = s.mode === 'busted' ? `Fine paid: $${s.fine || 0} · Click to continue`
      : s.mode === 'wasted' ? 'Hospital bill $150 · Click to continue' : ov[1];
  } else ui.overlay.style.display = 'none';
  drawMinimap(s);
}

// ---------- rendering (first person) ----------
let lastDt = 1 / 60;
let shakeAmp = 0;
function viewDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
}
function render(s, t) {
  const [w, h] = R.resize();
  const p = s.player;
  const car = p.inCar;
  const speedNow = car ? Math.abs(car.speed) : 0;
  // FOV: wide FP base, stretches a little with speed and throttle
  const fov = 1.24 + clamp(speedNow / 27, 0, 1) * 0.10 + (car && keys.KeyW ? (car.rpm || 0) * 0.02 : 0);
  const proj = mat4Perspective(fov, w / h, 0.05, 700);
  let eye, center, up = [0, 1, 0];
  let viewYaw = s.camYaw, viewPitch = lookPitch;
  if (car) {
    // Driver's seat: left seat offset, dash height, view = heading + look offset.
    const fx = Math.sin(car.ry), fz = Math.cos(car.ry);
    const rx = Math.cos(car.ry), rz = -Math.sin(car.ry);
    eye = [car.x - rx * 0.44 + fx * 0.15, 1.22, car.z - rz * 0.44 + fz * 0.15];
    viewYaw = car.ry + lookYaw;
    // road feel: kerb jitter + speed-bump pulses + accel/brake pitch
    const centers = roadCenters();
    let latOff = 1e9;
    for (const c of centers) latOff = Math.min(latOff, Math.abs(car.x - c), Math.abs(car.z - c));
    let jolt = 0;
    if (speedNow > 4) {
      if (latOff > 6.1 && latOff < 9.5) jolt += Math.sin(t * 43) * 0.016; // running the kerb
      const gridD = Math.min(Math.abs(((car.x % 23) + 23) % 23 - 11.5), Math.abs(((car.z % 23) + 23) % 23 - 11.5));
      if (gridD > 10.6) jolt += Math.sin(t * 34) * 0.02 * clamp(speedNow / 14, 0, 1); // bump strips
    }
    eye[1] += jolt;
    const accel = clamp(((car.speed || 0) - (car._camPs || 0)) / Math.max(lastDt, 0.001), -30, 30);
    car._camPs = car.speed || 0;
    viewPitch = lookPitch + clamp(accel * 0.0016, -0.028, 0.02); // nose-dive under braking, lift on launch
    const d = viewDir(viewYaw, viewPitch);
    center = [eye[0] + d[0] * 10, eye[1] + d[1] * 10, eye[2] + d[2] * 10];
    const roll = clamp(-(car.steerAngle || 0) * clamp(speedNow / 20, 0, 1) * 0.35, -0.06, 0.06);
    up = [-Math.cos(viewYaw) * roll, 1, Math.sin(viewYaw) * roll];
    void rx; void rz;
  } else if (shotMode === 'start') {
    eye = [-70, 52, 120]; center = [10, 0, -10];
  } else {
    // On foot: eye height, free mouse look.
    eye = [p.x, 1.62, p.z];
    viewYaw = s.camYaw; viewPitch = lookPitch;
    const d = viewDir(viewYaw, viewPitch);
    center = [eye[0] + d[0] * 10, eye[1] + d[1] * 10, eye[2] + d[2] * 10];
  }
  if (shakeAmp > 0.002) {
    eye = [eye[0] + (Math.random() - 0.5) * shakeAmp, eye[1] + (Math.random() - 0.5) * shakeAmp * 0.7, eye[2] + (Math.random() - 0.5) * shakeAmp];
  }
  const view = mat4LookAt(eye, center, up);
  R.begin(view, proj, eye);
  const I = mat4Model(0, 0, 0, 0, 1, 1, 1);
  R.draw(meshes.plain, I);
  for (const k of Object.keys(meshes.tex)) R.draw(meshes.tex[k], I, { tex: k });
  R.draw(meshes.emissive, I, { emissive: true });
  // sun + clouds
  R.box(-140, 68, -190, 0, 16, 16, 16, [1, 0.85, 0.4], { emissive: true });
  R.box(-60, 55, -120, 0, 34, 3, 12, [1, 0.95, 0.92], { emissive: true });
  R.box(80, 62, -90, 0, 44, 3.5, 14, [1, 0.95, 0.92], { emissive: true });
  // zone markers
  const zones = s.city.zones;
  drawMarker(zones.gunshop.x, zones.gunshop.z, [1, 0.6, 0.2], t);
  drawMarker(zones.hospital.x, zones.hospital.z, [1, 1, 1], t);
  drawMarker(zones.spray.x, zones.spray.z, [0.3, 1, 0.6], t);
  if (s.mission?.target) drawMarker(s.mission.target.x, s.mission.target.z, [1, 0.3, 0.85], t);
  if (s.mission?.type === 'score' && !s.mission.van.taken) {
    R.box(s.mission.van.x, 0.4, s.mission.van.z, 0.4, 2.4, 1.1, 5, [0.15, 0.6, 0.3]);
    R.box(s.mission.van.x, 1.35, s.mission.van.z, 0.4, 2.2, 0.7, 2.6, [0.1, 0.45, 0.22]);
  }
  // actors (the driven car loses its cabin/roof: the camera sits inside it)
  for (const c of s.cars) drawCar(s, c, t, c === p.inCar);
  for (const c of s.cops) if (c !== p.inCar) drawCar(s, c, t);
  for (const ped of s.peds) {
    if (ped.state === 'dead') {
      R.box(ped.x, 0.25, ped.z, ped.ry, 0.6, 0.3, 1.7, ped.color);
    } else {
      drawPerson(s, ped.x, ped.z, ped.ry, ped.color, { walkPhase: ped._phase || 0 });
      if (ped.state === 'robbed') R.box(ped.x, 2.35, ped.z, 0, 0.3, 0.3, 0.3, [1, 0.85, 0.3], { emissive: true });
    }
  }
  drawParticles();
  // first-person overlays-in-world: car interior, or the gun in your hands
  if (p.inCar) drawInterior(s, p.inCar);
  else if (s.hasGun && s.mode !== 'title') drawGunView(s, eye, viewYaw, viewPitch);
  // crosshair handled by CSS when aiming
  document.body.classList.toggle('aiming', !!p.aim && s.mode === 'play');
}

// ---------- event sounds ----------
function handleEvents(s) {
  for (const e of drainEvents(s)) {
    switch (e.name) {
      case 'shot': {
        noiseBurst(0.16, 0.5, 900);
        const p = S.player, fx = Math.sin(p.ry), fz = Math.cos(p.ry);
        spawnP(p.x + fx * 0.9, 1.2, p.z + fz * 0.9, fx * 3, 0.4, fz * 3, 0.09, 0.55, [1, 0.75, 0.3], { emissive: true, alpha: 0.95 });
        spawnP(p.x + fx * 0.9, 1.2, p.z + fz * 0.9, fx * 1.5, 0.2, fz * 1.5, 0.3, 0.3, [0.8, 0.8, 0.85], { grow: 1.2, alpha: 0.4 });
        break;
      }
      case 'crash': case 'ram': {
        noiseBurst(0.25, 0.4, 300);
        shakeAmp = Math.min(0.55, 0.12 + (e.data || 8) * 0.022); // impact shake scales with hit speed
        const c = S.player.inCar || S.player;
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          spawnP(c.x, 0.7, c.z, Math.sin(a) * (2 + Math.random() * 4), 1.5 + Math.random() * 3, Math.cos(a) * (2 + Math.random() * 4), 0.35 + Math.random() * 0.3, 0.14, [1, 0.72, 0.25], { emissive: true, grav: -7, alpha: 0.95 });
        }
        break;
      }
      case 'explode': noiseBurst(0.7, 0.7, 160); beep(60, 0.6, 'sawtooth', 0.2, -30); break;
      case 'cash': case 'rob': beep(880, 0.09, 'square', 0.12); setTimeout(() => beep(1320, 0.12, 'square', 0.12), 70); break;
      case 'missionDone': beep(660, 0.12, 'triangle', 0.15); setTimeout(() => beep(990, 0.2, 'triangle', 0.15), 110); break;
      case 'missionFail': beep(220, 0.3, 'sawtooth', 0.12, -80); break;
      case 'wanted': beep(440, 0.1, 'square', 0.1); break;
      case 'buyGun': beep(520, 0.1, 'square', 0.12); break;
      case 'spray': beep(740, 0.15, 'triangle', 0.12); break;
      case 'enterCar': beep(180, 0.08, 'square', 0.08); break;
      case 'hurt': beep(140, 0.12, 'sawtooth', 0.12); break;
      case 'save': persist(s); break;
      case 'banner': break;
    }
    if (e.name === 'rob') { S.msg = `ROBBED +$${e.data}`; S.msgT = 2; }
    if (e.name === 'missionDone' && e.data) { S.msg = `${e.data} COMPLETE`; S.msgT = 2.5; }
  }
}

// ---------- main loop ----------
let last = performance.now(), frames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  lastDt = dt;
  const t = now / 1000;
  if (!shotMode) {
    // mouse look: on foot = free look; in car = glance offset (mirrors / side streets)
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
      lookYaw *= Math.exp(-dt * 2.2); // glance recentres itself
      lookPitch *= Math.exp(-dt * 2.2);
    }
    shakeAmp *= Math.exp(-dt * 5.5);
    if (S.mode === 'play') {
      if (mouseDownR && !S.player.inCar) S.player.ry = S.camYaw; // aim where camera looks
      step(S, readInput(), dt);
      for (const c of [...S.cars, ...S.cops]) c._spin = (c._spin || 0) + (c.speed || 0) * dt * 2.2;
      for (const ped of S.peds) ped._phase = (ped._phase || 0) + (ped.state === 'flee' ? 4.6 : ped.speed) * dt * 3.4;
      // tyre smoke when the tyres are sliding (drift / handbrake / hard cornering)
      const pc = S.player.inCar;
      if (pc && Math.abs(pc.speed) > 5 && (pc.slip || 0) > 1.1 && Math.random() < 0.85) {
        const fx = Math.sin(pc.ry), fz = Math.cos(pc.ry), rx = Math.cos(pc.ry), rz = -Math.sin(pc.ry);
        const sd = Math.random() < 0.5 ? 0.95 : -0.95;
        spawnP(pc.x + rx * sd - fx * 1.35, 0.3, pc.z + rz * sd - fz * 1.35,
          -fx * 1.2 + (Math.random() - 0.5), 0.7, -fz * 1.2 + (Math.random() - 0.5),
          0.9 + Math.random() * 0.5, 0.7, [0.88, 0.88, 0.92], { grow: 1.6, alpha: 0.4 });
      }
      stepParticles(dt);
      handleEvents(S);
      audioFrame(S);
    }
  } else {
    // deterministic screenshot scenes: settle actors, then freeze
    if (frames < 3 && shotMode !== 'start' && shotMode !== 'end') {
      // tiny settle so wheels/props align
    }
    for (const c of [...S.cars, ...S.cops]) c._spin = (c.speed || 0) * 1.2;
    S.bannerT = 99; S.time = 2;
  }
  render(S, shotMode ? 2 : t);
  updateHUD(S);
  frames++;
  if (shotMode && frames > 12) window.__shotReady = true;
}
requestAnimationFrame(loop);
