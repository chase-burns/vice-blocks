// Procedural canvas textures (WO Task 2): building facades, road, sidewalk,
// cockpit instrument cluster, soft particle sprite. No external images.
function canvasTex(gl, c, repeat) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  return tex;
}
function lcg(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

export function makeTextures(gl) {
  const out = {};
  // Building facades: pastel Art Deco walls, sparse warm-lit windows.
  const variants = [
    { wall: '#f2ede2', seed: 1234 }, { wall: '#f6cf9f', seed: 555 },
    { wall: '#bfe0cd', seed: 987 }, { wall: '#f4c3d2', seed: 313 },
  ];
  variants.forEach((v, vi) => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = v.wall; g.fillRect(0, 0, 128, 256);
    const rnd = lcg(v.seed + vi * 777);
    const litCols = ['#ffd98a', '#ffb36b', '#ffe9bb'];
    for (let y = 10; y < 246; y += 21) {
      for (let x = 10; x < 118; x += 21) {
        const r = rnd();
        g.fillStyle = r < 0.30 ? litCols[Math.floor(rnd() * litCols.length)] : '#46545e';
        g.fillRect(x, y, 11, 12);
      }
    }
    out['b' + vi] = canvasTex(gl, c, true);
  });
  // Road: warm light-gray asphalt with grain, sun-bleached.
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#5b5751'; g.fillRect(0, 0, 256, 256);
    const rnd = lcg(42);
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.16)';
      g.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
    }
    out.road = canvasTex(gl, c, true);
  }
  // Sidewalk pavers: warm sand stone.
  {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#cfc0a0'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#b3a184'; g.lineWidth = 3;
    for (let i = 0; i <= 128; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
    }
    out.walk = canvasTex(gl, c, true);
  }
  // Cockpit instrument cluster: two analog gauges with cyan needles.
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0a0e'; g.fillRect(0, 0, 256, 128);
    const gauge = (cx, label) => {
      g.strokeStyle = '#2a2f3a'; g.lineWidth = 5;
      g.beginPath(); g.arc(cx, 64, 46, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#ffb36b'; g.lineWidth = 2;
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + i * Math.PI * 1.5 / 10;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * 38, 64 + Math.sin(a) * 38);
        g.lineTo(cx + Math.cos(a) * 45, 64 + Math.sin(a) * 45);
        g.stroke();
      }
      g.fillStyle = '#ffe1b8'; g.font = 'bold 11px monospace'; g.textAlign = 'center';
      g.fillText(label, cx, 100);
    };
    gauge(64, 'MPH'); gauge(192, 'RPM');
    out.dash = canvasTex(gl, c, false);
  }
  // Soft radial particle sprite.
  {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    out.particle = canvasTex(gl, c, false);
  }
  return out;
}
// Live dash texture update: redraw needles for current speed/rpm, re-upload.
export function drawDashTexture(gl, tex, mph, rpm) {
  const c = drawDashTexture.canvas || (drawDashTexture.canvas = (() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; return cv;
  })());
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a0e'; g.fillRect(0, 0, 256, 128);
  const gauge = (cx, label, frac) => {
    g.strokeStyle = '#2a2f3a'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, 64, 46, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#ffb36b'; g.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + i * Math.PI * 1.5 / 10;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 38, 64 + Math.sin(a) * 38);
      g.lineTo(cx + Math.cos(a) * 45, 64 + Math.sin(a) * 45);
      g.stroke();
    }
    const na = Math.PI * 0.75 + Math.min(1, frac) * Math.PI * 1.5;
    g.strokeStyle = '#ff7b3c'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, 64); g.lineTo(cx + Math.cos(na) * 40, 64 + Math.sin(na) * 40); g.stroke();
    g.fillStyle = '#ffe1b8'; g.font = 'bold 11px monospace'; g.textAlign = 'center';
    g.fillText(label, cx, 100);
  };
  gauge(64, 'MPH', mph / 120); gauge(192, 'RPM', rpm);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}
