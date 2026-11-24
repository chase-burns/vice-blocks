// renderer.js — a compact WebGL1 renderer written from scratch. It owns
// the linked shader program, the column-major matrix helpers, buffer
// uploads, and the two draw primitives everything else is built from: a
// tinted unit cube placed in the world, and a thin textured panel (the
// gauge-cluster face, the spotlight pool lying on the road).
import { VS, FS } from './shaders.js';
import { makeTextures } from './textures.js';
import { unitCubeData } from './mesh.js';

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const invRange = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * invRange; m[11] = -1;
  m[14] = 2 * far * near * invRange;
  return m;
}

export function mat4LookAt(eye, center, up) {
  const ex = eye[0], ey = eye[1], ez = eye[2];
  let backX = ex - center[0], backY = ey - center[1], backZ = ez - center[2];
  let n = Math.hypot(backX, backY, backZ) || 1;
  backX /= n; backY /= n; backZ /= n;
  let sideX = up[1] * backZ - up[2] * backY;
  let sideY = up[2] * backX - up[0] * backZ;
  let sideZ = up[0] * backY - up[1] * backX;
  n = Math.hypot(sideX, sideY, sideZ) || 1;
  sideX /= n; sideY /= n; sideZ /= n;
  const trueUpX = backY * sideZ - backZ * sideY;
  const trueUpY = backZ * sideX - backX * sideZ;
  const trueUpZ = backX * sideY - backY * sideX;
  return new Float32Array([
    sideX, trueUpX, backX, 0, sideY, trueUpY, backY, 0, sideZ, trueUpZ, backZ, 0,
    -(sideX * ex + sideY * ey + sideZ * ez),
    -(trueUpX * ex + trueUpY * ey + trueUpZ * ez),
    -(backX * ex + backY * ey + backZ * ez), 1,
  ]);
}

export function mat4Multiply(a, b) {
  const result = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
    result[col * 4 + row] = sum;
  }
  return result;
}

// Model matrix for an upright object: position, yaw, scale.
export function mat4Model(x, y, z, ry, sx, sy, sz) {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  return new Float32Array([
    cos * sx, 0, -sin * sx, 0, 0, sy, 0, 0, sin * sz, 0, cos * sz, 0, x, y, z, 1,
  ]);
}

// Posed model matrix — yaw, pitch, roll, scale — for anything that
// leans: wheels, the helicopter, weapon viewmodels.
export function mat4ModelPose(x, y, z, ry, pitch, roll, sx, sy, sz) {
  const cosYaw = Math.cos(ry), sinYaw = Math.sin(ry);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = [
    cosYaw * cr + sinYaw * sp * sr, cp * sr, -sinYaw * cr + cosYaw * sp * sr, 0,
    -cosYaw * sr + sinYaw * sp * cr, cp * cr, sinYaw * sr + cosYaw * sp * cr, 0,
    sinYaw * cp, -sp, cosYaw * cp, 0, 0, 0, 0, 1,
  ];
  const scaleByAxis = [sx, sy, sz];
  const m = new Float32Array(16);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 4; row++) {
    m[col * 4 + row] = rot[col * 4 + row] * (row < 3 ? scaleByAxis[col] : 1);
  }
  m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
}

function buildShader(gl, kind, sourceText) {
  const sh = gl.createShader(kind);
  gl.shaderSource(sh, sourceText);
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
    gl.attachShader(prog, buildShader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, buildShader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog); this.prog = prog;
    const uniformAt = (name) => gl.getUniformLocation(prog, name);
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'), norm: gl.getAttribLocation(prog, 'aNorm'),
      uv: gl.getAttribLocation(prog, 'aUv'), col: gl.getAttribLocation(prog, 'aCol'),
      mvp: uniformAt('uMvp'), model: uniformAt('uModel'), tex: uniformAt('uTex'), useTex: uniformAt('uUseTex'),
      emissive: uniformAt('uEmissive'), sun: uniformAt('uSun'), fog: uniformAt('uFogColor'), horizon: uniformAt('uHorizon'),
      zen: uniformAt('uZen'), mid: uniformAt('uMid'), amb: uniformAt('uAmb'), cam: uniformAt('uCam'), alpha: uniformAt('uAlpha'), sky: uniformAt('uSky'),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.99, 0.76, 0.56, 1.0);
    this.fogColor = [0.99, 0.80, 0.62];
    this.horizon = [1.0, 0.70, 0.47];
    this.zen = [0.42, 0.66, 0.92];
    this.mid = [0.98, 0.78, 0.58];
    this.ambScale = 1.0;
    const rawSun = [0.8, 0.25, -0.5];
    const sunNorm = Math.hypot(rawSun[0], rawSun[1], rawSun[2]);
    this.sunDir = rawSun.map((v) => v / sunNorm);
    this.textures = makeTextures(gl);
    this._tintCache = new Map();
    this._skyMesh = null; this._panelMesh = null;
    console.log('Vice Blocks renderer up');
  }

  resize() {
    const cv = this.canvas;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(cv.clientWidth * ratio), h = Math.floor(cv.clientHeight * ratio);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.gl.viewport(0, 0, w, h); }
    return [w, h];
  }

  makeMesh(data) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf: buffer, count: data.length / 11 };
  }

  bindMesh(mesh) {
    const gl = this.gl, L = this.loc, STRIDE = 44;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(L.norm); gl.vertexAttribPointer(L.norm, 3, gl.FLOAT, false, STRIDE, 12);
    gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, STRIDE, 24);
    gl.enableVertexAttribArray(L.col); gl.vertexAttribPointer(L.col, 3, gl.FLOAT, false, STRIDE, 32);
  }

  // Begin a frame: clear, upload the grade uniforms, then draw the sky
  // cube centred on the camera with depth writes off so the world can
  // paint over it.
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
    const alphaVal = o.alpha != null ? o.alpha : 1;
    gl.uniform1f(this.loc.alpha, alphaVal);
    const blending = alphaVal < 1;
    if (blending) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, o.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    if (o.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[o.tex]); }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (blending) { gl.depthMask(true); gl.disable(gl.BLEND); }
  }

  // A unit cube in a single colour. The palette is small, so cube meshes
  // are cached per colour rather than rebuilt for every object.
  box(x, y, z, ry, w, h, d, color, opts) {
    const o = opts || {};
    const cacheKey = color.join(',');
    let mesh = this._tintCache.get(cacheKey);
    if (!mesh) { mesh = this.makeMesh(unitCubeData(color)); this._tintCache.set(cacheKey, mesh); }
    const model = (o.pitch || o.roll)
      ? mat4ModelPose(x, y, z, ry, o.pitch || 0, o.roll || 0, w, h, d)
      : mat4Model(x, y, z, ry, w, h, d);
    this.draw(mesh, model, o);
  }

  // The thin textured panel used for the dash gauge face and the
  // spotlight pool.
  panel(x, y, z, ry, w, h, texKey, opts) {
    const o = opts || {};
    if (!this._panelMesh) this._panelMesh = this.makeMesh(unitCubeData([1, 1, 1]));
    const model = (o.pitch || o.roll)
      ? mat4ModelPose(x, y, z, ry, o.pitch || 0, o.roll || 0, w, h, 0.03)
      : mat4Model(x, y, z, ry, w, h, 0.03);
    this.draw(this._panelMesh, model, { tex: texKey, emissive: true, alpha: o.alpha, add: o.add });
  }
}
