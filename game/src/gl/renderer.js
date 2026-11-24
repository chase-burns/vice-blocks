// renderer.js — a small hand-rolled WebGL1 renderer: shader program,
// column-major matrix helpers, GPU buffer uploads, and the two draw
// primitives the whole game is built from (a tinted unit cube, and a
// textured flat panel for the dash cluster / spotlight pool).
import { VS, FS } from './shaders.js';
import { makeTextures } from './textures.js';
import { unitCubeData } from './mesh.js';

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function mat4LookAt(eye, center, up) {
  const [ex, ey, ez] = eye;
  const [cx, cy, cz] = center;
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
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
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez), 1,
  ]);
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

// Yaw-only model matrix (the common case: upright props and vehicles).
export function mat4Model(x, y, z, ry, sx, sy, sz) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return new Float32Array([
    c * sx, 0, -s * sx, 0,
    0, sy, 0, 0,
    s * sz, 0, c * sz, 0,
    x, y, z, 1,
  ]);
}

// Full pose matrix: yaw, then pitch, then roll, then non-uniform scale.
// Used for anything that leans — wheels, the helicopter, gun viewmodels.
export function mat4ModelPose(x, y, z, ry, pitch, roll, sx, sy, sz) {
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = [
    cosY * cr + sinY * sp * sr, cp * sr, -sinY * cr + cosY * sp * sr, 0,
    -cosY * sr + sinY * sp * cr, cp * cr, sinY * sr + cosY * sp * cr, 0,
    sinY * cp, -sp, cosY * cp, 0,
    0, 0, 0, 1,
  ];
  const out = new Float32Array(16);
  const scale = [sx, sy, sz];
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] = rot[col * 4 + row] * (row < 3 ? scale[col] : 1);
    }
  }
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.canvas = canvas;

    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    gl.useProgram(program);
    this.prog = program;

    const uniform = (name) => gl.getUniformLocation(program, name);
    this.loc = {
      pos: gl.getAttribLocation(program, 'aPos'),
      norm: gl.getAttribLocation(program, 'aNorm'),
      uv: gl.getAttribLocation(program, 'aUv'),
      col: gl.getAttribLocation(program, 'aCol'),
      mvp: uniform('uMvp'),
      model: uniform('uModel'),
      tex: uniform('uTex'),
      useTex: uniform('uUseTex'),
      emissive: uniform('uEmissive'),
      sun: uniform('uSun'),
      fog: uniform('uFogColor'),
      horizon: uniform('uHorizon'),
      zen: uniform('uZen'),
      mid: uniform('uMid'),
      amb: uniform('uAmb'),
      cam: uniform('uCam'),
      alpha: uniform('uAlpha'),
      sky: uniform('uSky'),
    };

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.99, 0.76, 0.56, 1.0);

    // Scene grade. The render loop overwrites these per scene (the chase
    // still switches to a late-dusk grade); these are the daylight values.
    this.fogColor = [0.99, 0.80, 0.62];
    this.horizon = [1.0, 0.70, 0.47];
    this.zen = [0.42, 0.66, 0.92];
    this.mid = [0.98, 0.78, 0.58];
    this.ambScale = 1.0;
    const sunRaw = [0.8, 0.25, -0.5];
    const sunLen = Math.hypot(sunRaw[0], sunRaw[1], sunRaw[2]);
    this.sunDir = sunRaw.map((v) => v / sunLen);

    this.textures = makeTextures(gl);
    this._tintCache = new Map();
    this._skyMesh = null;
    this._panelMesh = null;
    console.log('Vice Blocks renderer up');
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(c.clientWidth * dpr);
    const h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      this.gl.viewport(0, 0, w, h);
    }
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
    const gl = this.gl;
    const L = this.loc;
    const stride = 44; // 11 floats per vertex
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    gl.enableVertexAttribArray(L.pos);
    gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(L.norm);
    gl.vertexAttribPointer(L.norm, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(L.uv);
    gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(L.col);
    gl.vertexAttribPointer(L.col, 3, gl.FLOAT, false, stride, 32);
  }

  // Start a frame: clear, publish the scene grade, draw the sky cube
  // around the camera with depth writes off so everything else wins.
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

  draw(mesh, model, opts = {}) {
    const gl = this.gl;
    this.bindMesh(mesh);
    gl.uniformMatrix4fv(this.loc.mvp, false, mat4Multiply(this.vp, model));
    gl.uniformMatrix4fv(this.loc.model, false, model);
    gl.uniform1f(this.loc.useTex, opts.tex ? 1 : 0);
    gl.uniform1f(this.loc.emissive, opts.emissive ? 1 : 0);
    gl.uniform1f(this.loc.sky, opts.sky ? 1 : 0);
    const alpha = opts.alpha != null ? opts.alpha : 1;
    gl.uniform1f(this.loc.alpha, alpha);
    const blending = alpha < 1;
    if (blending) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, opts.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    if (opts.tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[opts.tex]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (blending) {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  // Draw one tinted unit cube, scaled and posed. Tint meshes are cached —
  // the palette is small, so each colour costs one buffer, once.
  box(x, y, z, ry, w, h, d, color, opts = {}) {
    const key = color.join(',');
    let mesh = this._tintCache.get(key);
    if (!mesh) {
      mesh = this.makeMesh(unitCubeData(color));
      this._tintCache.set(key, mesh);
    }
    const posed = opts.pitch || opts.roll;
    const model = posed
      ? mat4ModelPose(x, y, z, ry, opts.pitch || 0, opts.roll || 0, w, h, d)
      : mat4Model(x, y, z, ry, w, h, d);
    this.draw(mesh, model, opts);
  }

  // Draw a thin textured panel (dash cluster, spotlight pool).
  panel(x, y, z, ry, w, h, texKey, opts = {}) {
    if (!this._panelMesh) this._panelMesh = this.makeMesh(unitCubeData([1, 1, 1]));
    const posed = opts.pitch || opts.roll;
    const model = posed
      ? mat4ModelPose(x, y, z, ry, opts.pitch || 0, opts.roll || 0, w, h, 0.03)
      : mat4Model(x, y, z, ry, w, h, 0.03);
    this.draw(this._panelMesh, model, {
      tex: texKey, emissive: true, alpha: opts.alpha, add: opts.add,
    });
  }
}
