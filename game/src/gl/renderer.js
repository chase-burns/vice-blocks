// renderer.js — compact hand-rolled WebGL1 renderer. It owns the shader
// program, column-major matrix helpers, buffer upload, and the two draw
// primitives the game is built from: a tinted unit cube in the world and
// a thin textured panel for the gauge cluster and spotlight pool.
import { VS, FS } from './shaders.js';
import { makeTextures } from './textures.js';
import { unitCubeData } from './mesh.js';

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye, center, up) {
  const ex = eye[0], ey = eye[1], ez = eye[2];
  let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez), 1,
  ]);
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
    out[col * 4 + row] = sum;
  }
  return out;
}

// Model matrix for an upright object at (x,y,z), yawed and scaled.
export function mat4Model(x, y, z, ry, sx, sy, sz) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return new Float32Array([
    c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1,
  ]);
}

// Full pose matrix: yaw, then pitch, then roll, with scale — for leaning
// objects such as wheels, the helicopter and weapon viewmodels.
export function mat4ModelPose(x, y, z, ry, pitch, roll, sx, sy, sz) {
  const cy = Math.cos(ry), syaw = Math.sin(ry);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = [
    cy * cr + syaw * sp * sr, cp * sr, -syaw * cr + cy * sp * sr, 0,
    -cy * sr + syaw * sp * cr, cp * cr, syaw * sr + cy * sp * cr, 0,
    syaw * cp, -sp, cy * cp, 0, 0, 0, 0, 1,
  ];
  const scales = [sx, sy, sz];
  const out = new Float32Array(16);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 4; row++) {
    out[col * 4 + row] = rot[col * 4 + row] * (row < 3 ? scales[col] : 1);
  }
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl; this.canvas = canvas;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog); this.prog = prog;
    const U = (n) => gl.getUniformLocation(prog, n);
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'), norm: gl.getAttribLocation(prog, 'aNorm'),
      uv: gl.getAttribLocation(prog, 'aUv'), col: gl.getAttribLocation(prog, 'aCol'),
      mvp: U('uMvp'), model: U('uModel'), tex: U('uTex'), useTex: U('uUseTex'),
      emissive: U('uEmissive'), sun: U('uSun'), fog: U('uFogColor'), horizon: U('uHorizon'),
      zen: U('uZen'), mid: U('uMid'), amb: U('uAmb'), cam: U('uCam'), alpha: U('uAlpha'), sky: U('uSky'),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.99, 0.76, 0.56, 1.0);
    this.fogColor = [0.99, 0.80, 0.62];
    this.horizon = [1.0, 0.70, 0.47];
    this.zen = [0.42, 0.66, 0.92];
    this.mid = [0.98, 0.78, 0.58];
    this.ambScale = 1.0;
    const raw = [0.8, 0.25, -0.5];
    const L = Math.hypot(raw[0], raw[1], raw[2]);
    this.sunDir = raw.map((v) => v / L);
    this.textures = makeTextures(gl);
    this._tintCache = new Map();
    this._skyMesh = null; this._panelMesh = null;
    console.log('Vice Blocks renderer up');
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.gl.viewport(0, 0, w, h); }
    return [w, h];
  }

  makeMesh(data) {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf, count: data.length / 11 };
  }

  bindMesh(mesh) {
    const gl = this.gl, L = this.loc, stride = 44;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(L.norm); gl.vertexAttribPointer(L.norm, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(L.col); gl.vertexAttribPointer(L.col, 3, gl.FLOAT, false, stride, 32);
  }

  // Start a frame: clear, publish grade uniforms, draw the sky cube
  // around the camera with depth writes off so the world wins over it.
  begin(view, proj, camPos) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.vp = mat4Multiply(proj, view);
    gl.uniform3fv(this.loc.sun, this.sunDir);
    gl.uniform3fv(this.loc.fog, this.fogColor);
    gl.uniform3fv(this.loc.horizon, this.horizon);
    gl.uniform3fv(this.loc.zen, this.zen);
    gl.uniform3fv(this.loc.mid, this.mid);
    gl.uniform1f(this.loc.amb, this.ambScale);
    gl.uniform3fv(this.loc.cam, camPos);
    gl.uniform1i(this.loc.tex, 0);
    if (!this._skyMesh) this._skyMesh = this.makeMesh(unitCubeData([1, 1, 1]));
    gl.depthMask(false);
    this.draw(this._skyMesh, mat4Model(camPos[0], camPos[1], camPos[2], 0, 900, 900, 900), { sky: true });
    gl.depthMask(true);
  }

  draw(mesh, model, opts) {
    const o = opts || {}, gl = this.gl;
    this.bindMesh(mesh);
    gl.uniformMatrix4fv(this.loc.mvp, false, mat4Multiply(this.vp, model));
    gl.uniformMatrix4fv(this.loc.model, false, model);
    gl.uniform1f(this.loc.useTex, o.tex ? 1 : 0);
    gl.uniform1f(this.loc.emissive, o.emissive ? 1 : 0);
    gl.uniform1f(this.loc.sky, o.sky ? 1 : 0);
    const alpha = o.alpha != null ? o.alpha : 1;
    gl.uniform1f(this.loc.alpha, alpha);
    const blending = alpha < 1;
    if (blending) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, o.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    if (o.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[o.tex]); }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (blending) { gl.depthMask(true); gl.disable(gl.BLEND); }
  }

  // Tinted unit cube, cached per colour because the palette is small.
  box(x, y, z, ry, w, h, d, color, opts) {
    const o = opts || {};
    const key = color.join(',');
    let mesh = this._tintCache.get(key);
    if (!mesh) { mesh = this.makeMesh(unitCubeData(color)); this._tintCache.set(key, mesh); }
    const model = (o.pitch || o.roll)
      ? mat4ModelPose(x, y, z, ry, o.pitch || 0, o.roll || 0, w, h, d)
      : mat4Model(x, y, z, ry, w, h, d);
    this.draw(mesh, model, o);
  }

  // Thin textured panel used for the dash face and spotlight pool.
  panel(x, y, z, ry, w, h, texKey, opts) {
    const o = opts || {};
    if (!this._panelMesh) this._panelMesh = this.makeMesh(unitCubeData([1, 1, 1]));
    const model = (o.pitch || o.roll)
      ? mat4ModelPose(x, y, z, ry, o.pitch || 0, o.roll || 0, w, h, 0.03)
      : mat4Model(x, y, z, ry, w, h, 0.03);
    this.draw(this._panelMesh, model, { tex: texKey, emissive: true, alpha: o.alpha, add: o.add });
  }
}
