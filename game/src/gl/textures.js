// textures.js — the game ships no image assets whatsoever. Every
// texture is painted onto a 2D canvas at startup: four pastel Deco
// facades, a fifth dusk facade packed with lit windows for the chase
// scene, asphalt, sidewalk pavers, a radial spotlight pool, a soft round
// particle sprite, and the face of the cockpit gauge cluster.

function pushTexture(gl, canvas, repeat) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return tex;
}

function freshCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// A tiny deterministic LCG so the facade window patterns come out the
// same on every boot and screenshots stay reproducible.
function lcgRandom(seed) {
  let state = seed;
  return () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
}

const WARM_LIT = ['#ffd98a', '#ffb36b', '#ffe9bb'];
const COOL_LIT = ['#cfe9ff', '#9fd8ff'];

// Paint one facade: a flat pastel wall, then a grid of windows where
// each cell rolls warm-lit, cool-lit or dark per the given odds.
function facadeCanvas(wallColor, seed, warmP, coolP, darkColor) {
  const c = freshCanvas(128, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = wallColor; ctx.fillRect(0, 0, 128, 256);
  const rnd = lcgRandom(seed);
  for (let y = 10; y < 246; y += 21) for (let x = 10; x < 118; x += 21) {
    const roll = rnd();
    if (roll < warmP) ctx.fillStyle = WARM_LIT[Math.floor(rnd() * WARM_LIT.length)];
    else if (roll < warmP + coolP) ctx.fillStyle = COOL_LIT[Math.floor(rnd() * COOL_LIT.length)];
    else ctx.fillStyle = darkColor;
    ctx.fillRect(x, y, 11, 12);
  }
  return c;
}

// The gauge-cluster face. It is painted pre-flipped vertically because
// the upload path never sets FLIP_Y — painted the other way round, the
// labels would end up mirrored.
function clusterFace(ctx, needles) {
  ctx.fillStyle = '#0a0a0e'; ctx.fillRect(0, 0, 256, 128);
  ctx.save(); ctx.translate(0, 128); ctx.scale(1, -1);
  const drawDial = (cx, label, frac) => {
    ctx.strokeStyle = '#2a2f3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, 64, 46, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffb36b'; ctx.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i * Math.PI * 1.5) / 10;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 38, 64 + Math.sin(a) * 38);
      ctx.lineTo(cx + Math.cos(a) * 45, 64 + Math.sin(a) * 45);
      ctx.stroke();
    }
    if (frac != null) {
      const na = Math.PI * 0.75 + Math.min(1, frac) * Math.PI * 1.5;
      ctx.strokeStyle = '#ff7b3c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, 64);
      ctx.lineTo(cx + Math.cos(na) * 40, 64 + Math.sin(na) * 40); ctx.stroke();
    }
    ctx.fillStyle = '#ffe1b8'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, cx, 100);
  };
  drawDial(64, 'MPH', needles ? needles[0] : null);
  drawDial(192, 'RPM', needles ? needles[1] : null);
  ctx.restore();
}

export function makeTextures(gl) {
  const texSet = {};
  const facadeSpecs = [
    { wall: '#f2ede2', seed: 1234 },
    { wall: '#f6cf9f', seed: 555 + 777 },
    { wall: '#bfe0cd', seed: 987 + 1554 },
    { wall: '#f4c3d2', seed: 313 + 2331 },
  ];
  facadeSpecs.forEach((spec, i) => {
    texSet['b' + i] = pushTexture(gl, facadeCanvas(spec.wall, spec.seed, 0.30, 0, '#46545e'), true);
  });
  texSet.b4 = pushTexture(gl, facadeCanvas('#8a94ac', 4242, 0.34, 0.14, '#232a36'), true);
  {
    const c = freshCanvas(128, 128), ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, '#fffbe8'); grad.addColorStop(0.45, '#c9bd96'); grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
    texSet.pool = pushTexture(gl, c, false);
  }
  {
    const c = freshCanvas(256, 256), ctx = c.getContext('2d');
    ctx.fillStyle = '#5b5751'; ctx.fillRect(0, 0, 256, 256);
    const rnd = lcgRandom(42);
    for (let i = 0; i < 5200; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.16)';
      ctx.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
    }
    texSet.road = pushTexture(gl, c, true);
  }
  {
    const c = freshCanvas(128, 128), ctx = c.getContext('2d');
    ctx.fillStyle = '#cfc0a0'; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#b3a184'; ctx.lineWidth = 3;
    for (let i = 0; i <= 128; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
    }
    texSet.walk = pushTexture(gl, c, true);
  }
  {
    const c = freshCanvas(256, 128);
    clusterFace(c.getContext('2d'), null);
    texSet.dash = pushTexture(gl, c, false);
  }
  {
    const c = freshCanvas(64, 64), ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
    texSet.particle = pushTexture(gl, c, false);
  }
  return texSet;
}

// Repaint the cluster with the live needle positions and re-upload it.
// Runs a few times a second while driving; reuses a single scratch
// canvas rather than allocating.
export function drawDashTexture(gl, tex, mph, rpm) {
  if (!drawDashTexture.scratch) drawDashTexture.scratch = freshCanvas(256, 128);
  const c = drawDashTexture.scratch;
  clusterFace(c.getContext('2d'), [mph / 120, rpm]);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}
