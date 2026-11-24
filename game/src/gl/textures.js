// textures.js — every texture in the game is painted on a 2D canvas at
// boot: four pastel Art Deco facades, a late-dusk facade with many lit
// windows (swapped in for the chase scene), asphalt, sidewalk pavers, the
// spotlight pool gradient, a soft particle sprite, and the cockpit gauge
// cluster. No image files, no network.

function uploadTexture(gl, canvas, repeat) {
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

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Small deterministic LCG so facade window patterns are identical on
// every boot (Math.random would reshuffle the city between screenshots).
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const WARM_WINDOWS = ['#ffd98a', '#ffb36b', '#ffe9bb'];
const COOL_WINDOWS = ['#cfe9ff', '#9fd8ff'];

// Paint one facade: flat pastel wall, then a grid of windows where each
// cell rolls against warm/cool lit thresholds and falls back to dark glass.
function paintFacade(wallColor, seed, warmP, coolP, darkColor) {
  const c = makeCanvas(128, 256);
  const g = c.getContext('2d');
  g.fillStyle = wallColor;
  g.fillRect(0, 0, 128, 256);
  const rnd = seededRandom(seed);
  for (let y = 10; y < 246; y += 21) {
    for (let x = 10; x < 118; x += 21) {
      const roll = rnd();
      if (roll < warmP) g.fillStyle = WARM_WINDOWS[Math.floor(rnd() * WARM_WINDOWS.length)];
      else if (roll < warmP + coolP) g.fillStyle = COOL_WINDOWS[Math.floor(rnd() * COOL_WINDOWS.length)];
      else g.fillStyle = darkColor;
      g.fillRect(x, y, 11, 12);
    }
  }
  return c;
}

// Draw the two-gauge cluster face (no needle, or one needle per gauge).
// The canvas is pre-flipped vertically because texture upload here does
// not set FLIP_Y — without the flip the labels would render mirrored.
function paintCluster(g, needles) {
  g.fillStyle = '#0a0a0e';
  g.fillRect(0, 0, 256, 128);
  g.save();
  g.translate(0, 128);
  g.scale(1, -1);
  const drawGauge = (cx, label, frac) => {
    g.strokeStyle = '#2a2f3a';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, 64, 46, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#ffb36b';
    g.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i * Math.PI * 1.5) / 10;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 38, 64 + Math.sin(a) * 38);
      g.lineTo(cx + Math.cos(a) * 45, 64 + Math.sin(a) * 45);
      g.stroke();
    }
    if (frac != null) {
      const na = Math.PI * 0.75 + Math.min(1, frac) * Math.PI * 1.5;
      g.strokeStyle = '#ff7b3c';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx, 64);
      g.lineTo(cx + Math.cos(na) * 40, 64 + Math.sin(na) * 40);
      g.stroke();
    }
    g.fillStyle = '#ffe1b8';
    g.font = 'bold 11px monospace';
    g.textAlign = 'center';
    g.fillText(label, cx, 100);
  };
  drawGauge(64, 'MPH', needles ? needles[0] : null);
  drawGauge(192, 'RPM', needles ? needles[1] : null);
  g.restore();
}

export function makeTextures(gl) {
  const textures = {};

  const daylightWalls = [
    { wall: '#f2ede2', seed: 1234 },
    { wall: '#f6cf9f', seed: 555 + 777 },
    { wall: '#bfe0cd', seed: 987 + 1554 },
    { wall: '#f4c3d2', seed: 313 + 2331 },
  ];
  daylightWalls.forEach((v, i) => {
    textures['b' + i] = uploadTexture(gl, paintFacade(v.wall, v.seed, 0.30, 0, '#46545e'), true);
  });

  // Late-dusk facade: blue-grey walls, roughly half the windows lit.
  textures.b4 = uploadTexture(gl, paintFacade('#8a94ac', 4242, 0.34, 0.14, '#232a36'), true);

  // Spotlight pool: bright core falling off to black (drawn additively).
  {
    const c = makeCanvas(128, 128);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, '#fffbe8');
    grad.addColorStop(0.45, '#c9bd96');
    grad.addColorStop(1, '#000000');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    textures.pool = uploadTexture(gl, c, false);
  }

  // Asphalt: mid warm grey with thousands of grain specks.
  {
    const c = makeCanvas(256, 256);
    const g = c.getContext('2d');
    g.fillStyle = '#5b5751';
    g.fillRect(0, 0, 256, 256);
    const rnd = seededRandom(42);
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.16)';
      g.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
    }
    textures.road = uploadTexture(gl, c, true);
  }

  // Sidewalk: sand-coloured pavers on a 32 px grid.
  {
    const c = makeCanvas(128, 128);
    const g = c.getContext('2d');
    g.fillStyle = '#cfc0a0';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#b3a184';
    g.lineWidth = 3;
    for (let i = 0; i <= 128; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
    }
    textures.walk = uploadTexture(gl, c, true);
  }

  // Static cluster face (needles are redrawn live by drawDashTexture).
  {
    const c = makeCanvas(256, 128);
    paintCluster(c.getContext('2d'), null);
    textures.dash = uploadTexture(gl, c, false);
  }

  // Soft round sprite for particles.
  {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    textures.particle = uploadTexture(gl, c, false);
  }

  return textures;
}

// Repaint the cluster with live needles and re-upload it. Called a few
// times a second while driving; the scratch canvas is reused.
export function drawDashTexture(gl, tex, mph, rpm) {
  if (!drawDashTexture.scratch) {
    drawDashTexture.scratch = makeCanvas(256, 128);
  }
  const c = drawDashTexture.scratch;
  paintCluster(c.getContext('2d'), [mph / 120, rpm]);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}
