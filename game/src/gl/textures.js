// textures.js — every texture in the game is painted procedurally on
// 2D canvases at boot: five Art Deco facade variants, asphalt, sidewalk
// concrete, a radial spotlight pool, and the cockpit gauge cluster
// (which is repainted live as speed and revs change). No image files,
// no downloads.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function upload(gl, canvas) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

// One facade variant: a pastel wall, a darker plinth band, deco fins
// between window columns, and a grid of windows — many of them lit
// warm when the variant is the dusk one.
function paintFacade(ctx, w, h, palette, litRatio) {
  ctx.fillStyle = palette.wall;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = palette.plinth;
  ctx.fillRect(0, h - 14, w, 14);
  ctx.fillStyle = palette.band;
  ctx.fillRect(0, 0, w, 6);
  const cols = 6, rows = 10;
  const cw = w / cols, ch = h / rows;
  for (let cx = 0; cx < cols; cx++) {
    ctx.fillStyle = palette.fin;
    ctx.fillRect(cx * cw + cw - 3, 6, 3, h - 20);
    for (let cy = 0; cy < rows; cy++) {
      const lit = ((cx * 7 + cy * 13) % 10) / 10 < litRatio;
      ctx.fillStyle = lit ? palette.lit : palette.glass;
      ctx.fillRect(cx * cw + 4, cy * ch + 5, cw - 11, ch - 9);
    }
  }
}

const FACADES = [
  { wall: '#e8b4a0', plinth: '#b98a76', band: '#f4d8c4', fin: '#c99a84', glass: '#3d4a58', lit: '#ffd9a0' },
  { wall: '#f0d9a8', plinth: '#c2a878', band: '#f8ecc8', fin: '#d4ba8a', glass: '#42505e', lit: '#ffe2ae' },
  { wall: '#a8ccd4', plinth: '#7ea6ae', band: '#cde8ec', fin: '#8fb8c0', glass: '#36434e', lit: '#ffd9a0' },
  { wall: '#e4a8bc', plinth: '#ba8296', band: '#f6cede', fin: '#cc93a8', glass: '#3d4a58', lit: '#ffe0ae' },
  { wall: '#a08eb2', plinth: '#7d6c90', band: '#bcaed0', fin: '#9181a5', glass: '#46586a', lit: '#ffc978' },
];

function paintRoad(ctx, w, h) {
  ctx.fillStyle = '#4a4a52';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const g = 60 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${g},${g},${g + 8})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, h - 3, w, 3);
}

function paintWalk(ctx, w, h) {
  ctx.fillStyle = '#b8ab9c';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    const g = 150 + Math.floor(Math.random() * 50);
    ctx.fillStyle = `rgb(${g},${g - 8},${g - 22})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  ctx.strokeStyle = 'rgba(90,80,70,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

function paintPool(ctx, w, h) {
  const grad = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(255,250,225,0.95)');
  grad.addColorStop(0.55, 'rgba(255,244,200,0.45)');
  grad.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

export function createTextures(gl) {
  const out = {};
  FACADES.forEach((pal, i) => {
    const [c, ctx] = makeCanvas(128, 256);
    paintFacade(ctx, 128, 256, pal, i === 4 ? 0.5 : 0.14);
    out['b' + i] = upload(gl, c);
  });
  {
    const [c, ctx] = makeCanvas(128, 128);
    paintRoad(ctx, 128, 128);
    out.road = upload(gl, c);
  }
  {
    const [c, ctx] = makeCanvas(128, 128);
    paintWalk(ctx, 128, 128);
    out.walk = upload(gl, c);
  }
  {
    const [c, ctx] = makeCanvas(128, 128);
    paintPool(ctx, 128, 128);
    out.pool = upload(gl, c);
  }
  // The dash texture keeps its canvas so the gauges can be repainted.
  const [dc, dctx] = makeCanvas(256, 128);
  out.dash = { tex: upload(gl, dc), canvas: dc, ctx: dctx };
  drawDashTexture(gl, out.dash, 0, 0.1);
  return out;
}

// Repaint the gauge cluster face: a speed dial on the left (0–160 mph)
// and a rev dial on the right (0–8k, fed a 0..1 fraction), orange
// needles, red zone past 6.5k, and a small digital speed readout.
export function drawDashTexture(gl, dash, mph, rpm) {
  const ctx = dash.ctx, w = 256, h = 128;
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, w, h);
  const dial = (cx, cy, r, frac, maxLabel, redFrom) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#14171f';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3a4152';
    ctx.stroke();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      const inner = i / 10 >= redFrom ? r - 13 : r - 9;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
      ctx.strokeStyle = i / 10 >= redFrom ? '#e0483c' : '#8b93a5';
      ctx.lineWidth = i % 5 === 0 ? 3 : 1.5;
      ctx.stroke();
    }
    const na = Math.PI * 0.75 + Math.max(0, Math.min(1, frac)) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(na) * (r - 8), cy + Math.sin(na) * (r - 8));
    ctx.strokeStyle = '#ff8c3a';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#c8ccd6';
    ctx.fill();
    ctx.fillStyle = '#79808f';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(maxLabel, cx, cy + r - 8);
  };
  dial(62, 66, 46, mph / 160, 'MPH', 2);
  dial(186, 66, 46, rpm, 'RPM x1000', 0.81);
  ctx.fillStyle = '#ffb35c';
  ctx.font = 'bold 17px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(mph)), 124, 62);
  ctx.fillStyle = '#79808f';
  ctx.font = '8px monospace';
  ctx.fillText('MPH', 124, 74);
  gl.bindTexture(gl.TEXTURE_2D, dash.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dash.canvas);
}
