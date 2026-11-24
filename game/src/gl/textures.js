// textures.js — no image files ship with the game. Each texture is
// painted on a 2D canvas at startup: four pastel Deco facades, a fifth
// dusk facade with many lit windows for the chase scene, asphalt,
// sidewalk pavers, a radial spotlight pool, a soft particle sprite and
// the cockpit gauge-cluster face.

function upload(gl, canvas, repeat) {
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

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Deterministic LCG so facade window patterns are identical every boot
// and screenshots stay reproducible.
function lcg(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

const WARM_TONES = ['#ffd98a', '#ffb36b', '#ffe9bb'];
const COOL_TONES = ['#cfe9ff', '#9fd8ff'];

// One facade: flat pastel wall, then a grid whose cells roll warm-lit,
// cool-lit or dark according to the supplied probabilities.
function facade(wallColor, seed, warmP, coolP, darkColor) {
  const c = newCanvas(128, 256);
  const g = c.getContext('2d');
  g.fillStyle = wallColor; g.fillRect(0, 0, 128, 256);
  const rnd = lcg(seed);
  for (let y = 10; y < 246; y += 21) for (let x = 10; x < 118; x += 21) {
    const roll = rnd();
    if (roll < warmP) g.fillStyle = WARM_TONES[Math.floor(rnd() * WARM_TONES.length)];
    else if (roll < warmP + coolP) g.fillStyle = COOL_TONES[Math.floor(rnd() * COOL_TONES.length)];
    else g.fillStyle = darkColor;
    g.fillRect(x, y, 11, 12);
  }
  return c;
}

// Gauge-cluster face. It is painted pre-flipped vertically because the
// upload path never sets FLIP_Y; otherwise labels would mirror.
function paintCluster(g, needles) {
  g.fillStyle = '#0a0a0e'; g.fillRect(0, 0, 256, 128);
  g.save(); g.translate(0, 128); g.scale(1, -1);
  const gauge = (cx, label, frac) => {
    g.strokeStyle = '#2a2f3a'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, 64, 46, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#ffb36b'; g.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i * Math.PI * 1.5) / 10;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 38, 64 + Math.sin(a) * 38);
      g.lineTo(cx + Math.cos(a) * 45, 64 + Math.sin(a) * 45);
      g.stroke();
    }
    if (frac != null) {
      const na = Math.PI * 0.75 + Math.min(1, frac) * Math.PI * 1.5;
      g.strokeStyle = '#ff7b3c'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx, 64);
      g.lineTo(cx + Math.cos(na) * 40, 64 + Math.sin(na) * 40); g.stroke();
    }
    g.fillStyle = '#ffe1b8'; g.font = 'bold 11px monospace'; g.textAlign = 'center';
    g.fillText(label, cx, 100);
  };
  gauge(64, 'MPH', needles ? needles[0] : null);
  gauge(192, 'RPM', needles ? needles[1] : null);
  g.restore();
}

export function makeTextures(gl) {
  const out = {};
  const daylight = [
    { wall: '#f2ede2', seed: 1234 },
    { wall: '#f6cf9f', seed: 555 + 777 },
    { wall: '#bfe0cd', seed: 987 + 1554 },
    { wall: '#f4c3d2', seed: 313 + 2331 },
  ];
  daylight.forEach((entry, i) => {
    out['b' + i] = upload(gl, facade(entry.wall, entry.seed, 0.30, 0, '#46545e'), true);
  });
  out.b4 = upload(gl, facade('#8a94ac', 4242, 0.34, 0.14, '#232a36'), true);
  {
    const c = newCanvas(128, 128), g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, '#fffbe8'); grad.addColorStop(0.45, '#c9bd96'); grad.addColorStop(1, '#000000');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    out.pool = upload(gl, c, false);
  }
  {
    const c = newCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#5b5751'; g.fillRect(0, 0, 256, 256);
    const rnd = lcg(42);
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.16)';
      g.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
    }
    out.road = upload(gl, c, true);
  }
  {
    const c = newCanvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#cfc0a0'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#b3a184'; g.lineWidth = 3;
    for (let i = 0; i <= 128; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
    }
    out.walk = upload(gl, c, true);
  }
  {
    const c = newCanvas(256, 128);
    paintCluster(c.getContext('2d'), null);
    out.dash = upload(gl, c, false);
  }
  {
    const c = newCanvas(64, 64), g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    out.particle = upload(gl, c, false);
  }
  return out;
}

// Repaint the cluster with live needles and re-upload; runs a few times
// per second while driving, reusing one scratch canvas.
export function drawDashTexture(gl, tex, mph, rpm) {
  if (!drawDashTexture.scratch) drawDashTexture.scratch = newCanvas(256, 128);
  const c = drawDashTexture.scratch;
  paintCluster(c.getContext('2d'), [mph / 120, rpm]);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}
