// renderer.js — a small hand-rolled WebGL1 wrapper. It owns the two
// shader programs, the procedural textures, a unit cube and a unit
// quad, and exposes three drawing verbs: draw() for baked meshes,
// box() for one transformed unit cube (the workhorse for cars, people
// and props), and panel() for textured quads (the dash cluster, the
// spotlight pool). Matrices are plain column-major Float32Arrays.

import { SCENE_VERT, SCENE_FRAG, SKY_VERT, SKY_FRAG } from './shaders.js';
import { createTextures } from './textures.js';

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
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
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

// Compose T * Ry * Rx * Rz * S into one matrix for the box/panel verbs.
function composeModel(x, y, z, ry, pitch, roll, scx, scy, scz) {
  const cy = Math.cos(ry), syw = Math.sin(ry);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry * Rx * Rz, worked out entry by entry.
  const r00 = cy * cr + syw * sp * sr, r01 = -cy * sr + syw * sp * cr, r02 = syw * cp;
  const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
  const r20 = -syw * cr + cy * sp * sr, r21 = syw * sr + cy * sp * cr, r22 = cy * cp;
  return new Float32Array([
    r00 * scx, r10 * scx, r20 * scx, 0,
    r01 * scy, r11 * scy, r21 * scy, 0,
    r02 * scz, r12 * scz, r22 * scz, 0,
    x, y, z, 1,
  ]);
}

function compileProgram(gl, vertSrc, fragSrc) {
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
    }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  return prog;
}

// Unit cube centred on the origin, 36 vertices, faces wound outward.
function unitCubeData() {
  const faces = [
    { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { n: [1, 0, 0], c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { n: [-1, 0, 0], c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, 1, 0], c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];
  const pos = [], nor = [], tint = [], uv = [];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...f.c[i]);
      nor.push(...f.n);
      tint.push(1, 1, 1);
      uv.push(uvs[i][0], uvs[i][1]);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(tint), uvs: new Float32Array(uv), count: 36 };
}

function unitQuadData() {
  const corners = [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const pos = [], nor = [], tint = [], uv = [];
  for (const i of [0, 1, 2, 0, 2, 3]) {
    pos.push(...corners[i]);
    nor.push(0, 0, 1);
    tint.push(1, 1, 1);
    uv.push(uvs[i][0], uvs[i][1]);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(tint), uvs: new Float32Array(uv), count: 6 };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.prog = compileProgram(gl, SCENE_VERT, SCENE_FRAG);
    this.skyProg = compileProgram(gl, SKY_VERT, SKY_FRAG);
    this.loc = {};
    for (const name of ['aPos', 'aNorm', 'aTint', 'aUv']) this.loc[name] = gl.getAttribLocation(this.prog, name);
    for (const name of ['uModel', 'uView', 'uProj', 'uCamPos', 'uTex', 'uUseTex', 'uColor', 'uAlpha', 'uEmissive', 'uFogColor', 'uAmbScale']) {
      this.loc[name] = gl.getUniformLocation(this.prog, name);
    }
    this.skyLoc = {
      aClip: gl.getAttribLocation(this.skyProg, 'aClip'),
      uZen: gl.getUniformLocation(this.skyProg, 'uZen'),
      uMid: gl.getUniformLocation(this.skyProg, 'uMid'),
      uHor: gl.getUniformLocation(this.skyProg, 'uHor'),
    };
    this.textures = createTextures(gl);
    // Grade uniforms, overwritten by main before every begin().
    this.zen = [0.42, 0.66, 0.92];
    this.mid = [0.98, 0.78, 0.58];
    this.horizon = [1.0, 0.70, 0.47];
    this.fogColor = [0.99, 0.80, 0.62];
    this.ambScale = 1.0;
    this.cube = this.createMesh(unitCubeData());
    this.quad = this.createMesh(unitQuadData());
    const skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.skyBuf = skyBuf;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  createMesh(data) {
    const gl = this.gl;
    const mk = (arr) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      return buf;
    };
    return { pos: mk(data.positions), nor: mk(data.normals), tint: mk(data.colors), uv: mk(data.uvs), count: data.count };
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    return [w, h];
  }

  _bindMesh(mesh) {
    const gl = this.gl, L = this.loc;
    const bind = (buf, loc, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind(mesh.pos, L.aPos, 3);
    bind(mesh.nor, L.aNorm, 3);
    bind(mesh.tint, L.aTint, 3);
    bind(mesh.uv, L.aUv, 2);
  }

  begin(view, proj, eye) {
    const gl = this.gl;
    gl.clearColor(this.fogColor[0], this.fogColor[1], this.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Sky first, with depth writes off and the LEQUAL trick at z=0.9999.
    gl.useProgram(this.skyProg);
    gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.enableVertexAttribArray(this.skyLoc.aClip);
    gl.vertexAttribPointer(this.skyLoc.aClip, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(this.skyLoc.uZen, this.zen);
    gl.uniform3fv(this.skyLoc.uMid, this.mid);
    gl.uniform3fv(this.skyLoc.uHor, this.horizon);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.uView, false, view);
    gl.uniformMatrix4fv(this.loc.uProj, false, proj);
    gl.uniform3fv(this.loc.uCamPos, eye);
    gl.uniform3fv(this.loc.uFogColor, this.fogColor);
    gl.uniform1f(this.loc.uAmbScale, this.ambScale);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.loc.uTex, 0);
  }

  _blendFor(opts) {
    const gl = this.gl;
    const alpha = opts.alpha != null ? opts.alpha : 1;
    if (alpha < 1 || opts.add) {
      gl.enable(gl.BLEND);
      if (opts.add) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    return alpha;
  }

  _blendOff() {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  draw(mesh, model, opts = {}) {
    const gl = this.gl, L = this.loc;
    const alpha = this._blendFor(opts);
    this._bindMesh(mesh);
    gl.uniformMatrix4fv(L.uModel, false, model);
    gl.uniform3fv(L.uColor, [1, 1, 1]);
    gl.uniform1f(L.uAlpha, alpha);
    gl.uniform1f(L.uEmissive, opts.emissive ? 1 : 0);
    if (opts.tex) {
      const tex = this.textures[opts.tex];
      gl.bindTexture(gl.TEXTURE_2D, tex && tex.tex ? tex.tex : tex);
      gl.uniform1f(L.uUseTex, 1);
    } else {
      gl.uniform1f(L.uUseTex, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    this._blendOff();
  }

  // One unit cube scaled to (w, h, d), centred at (x, y, z), yawed by
  // ry with optional pitch/roll, in a flat colour.
  box(x, y, z, ry, w, h, d, color, opts = {}) {
    const gl = this.gl, L = this.loc;
    const alpha = this._blendFor(opts);
    this._bindMesh(this.cube);
    gl.uniformMatrix4fv(L.uModel, false, composeModel(x, y, z, ry || 0, opts.pitch || 0, opts.roll || 0, w, h, d));
    gl.uniform3fv(L.uColor, color);
    gl.uniform1f(L.uAlpha, alpha);
    gl.uniform1f(L.uEmissive, opts.emissive ? 1 : 0);
    gl.uniform1f(L.uUseTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.cube.count);
    this._blendOff();
  }

  // One textured quad centred at (x, y, z), facing +z before yaw/pitch.
  panel(x, y, z, ry, w, h, texName, opts = {}) {
    const gl = this.gl, L = this.loc;
    const alpha = this._blendFor(opts);
    this._bindMesh(this.quad);
    gl.uniformMatrix4fv(L.uModel, false, composeModel(x, y, z, ry || 0, opts.pitch || 0, 0, w, h, 1));
    gl.uniform3fv(L.uColor, [1, 1, 1]);
    gl.uniform1f(L.uAlpha, alpha);
    gl.uniform1f(L.uEmissive, 1);
    const tex = this.textures[texName];
    gl.bindTexture(gl.TEXTURE_2D, tex && tex.tex ? tex.tex : tex);
    gl.uniform1f(L.uUseTex, 1);
    gl.drawArrays(gl.TRIANGLES, 0, this.quad.count);
    this._blendOff();
  }
}
