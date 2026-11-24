// WebGL renderer (WO Task 1): context, shader pipeline, buffers, draw state.
// Matrices are column-major Float32Array, standard perspective/lookAt.
import { VS, FS } from './shaders.js';
import { makeTextures } from './textures.js';
import { unitCubeData } from './mesh.js';

export function mat4Identity() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
export function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
export function mat4LookAt(eye, center, up) {
  const [ex,ey,ez] = eye, [cx,cy,cz] = center;
  let zx = ex-cx, zy = ey-cy, zz = ez-cz;
  let l = Math.hypot(zx,zy,zz) || 1; zx/=l; zy/=l; zz/=l;
  let xx = up[1]*zz - up[2]*zy, xy = up[2]*zx - up[0]*zz, xz = up[0]*zy - up[1]*zx;
  l = Math.hypot(xx,xy,xz) || 1; xx/=l; xy/=l; xz/=l;
  const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx*ex+xy*ey+xz*ez), -(yx*ex+yy*ey+yz*ez), -(zx*ex+zy*ey+zz*ez), 1]);
}
export function mat4Multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k];
    o[c*4+r] = s;
  }
  return o;
}
export function mat4Model(x, y, z, ry, sx, sy, sz) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return new Float32Array([
    c*sx, 0, -s*sx, 0,
    0, sy, 0, 0,
    s*sz, 0, c*sz, 0,
    x, y, z, 1]);
}
export function mat4ModelPose(x, y, z, ry, pitch, roll, sx, sy, sz) {
  const cy = Math.cos(ry), syw = Math.sin(ry);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const m = [
    cy*cr + syw*sp*sr, cp*sr, -syw*cr + cy*sp*sr, 0,
    -cy*sr + syw*sp*cr, cp*cr, syw*sr + cy*sp*cr, 0,
    syw*cp, -sp, cy*cp, 0,
    0, 0, 0, 1];
  const o = new Float32Array(16);
  const scale = [sx, sy, sz];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 4; r++) o[c*4+r] = m[c*4+r] * (r < 3 ? scale[c] : 1);
  o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
  return o;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl; this.canvas = canvas;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    this.prog = prog;
    const U = (n) => gl.getUniformLocation(prog, n);
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'), norm: gl.getAttribLocation(prog, 'aNorm'),
      uv: gl.getAttribLocation(prog, 'aUv'), col: gl.getAttribLocation(prog, 'aCol'),
      mvp: U('uMvp'), model: U('uModel'), tex: U('uTex'), useTex: U('uUseTex'),
      emissive: U('uEmissive'), sun: U('uSun'), fog: U('uFogColor'), horizon: U('uHorizon'),
      cam: U('uCam'), alpha: U('uAlpha'), sky: U('uSky'),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.12, 0.0, 0.17, 1.0);
    this.fogColor = [0.24, 0.11, 0.28];   // #3D1B48
    this.horizon = [0.83, 0.25, 0.23];    // #D4413B
    this.sunDir = (() => { const v = [0.8, 0.25, -0.5]; const l = Math.hypot(...v); return v.map(x => x / l); })();
    this.textures = makeTextures(gl);
    console.log('WebGL Initialized: 60 FPS target');
  }
  resize() {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  begin(view, proj, camPos) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.vp = mat4Multiply(proj, view);
    gl.uniform3fv(this.loc.sun, this.sunDir);
    gl.uniform3fv(this.loc.fog, this.fogColor);
    gl.uniform3fv(this.loc.horizon, this.horizon);
    gl.uniform3fv(this.loc.cam, camPos);
    gl.uniform1i(this.loc.tex, 0);
    // sky dome first: huge inverted cube, depth write off
    if (!this._skyMesh) this._skyMesh = this.makeMesh(unitCubeData([1, 1, 1]));
    gl.depthMask(false);
    this.draw(this._skyMesh, mat4Model(camPos[0], camPos[1], camPos[2], 0, 900, 900, 900), { sky: true });
    gl.depthMask(true);
  }
  draw(mesh, model, opts = {}) {
    const gl = this.gl;
    this.bindMesh(mesh);
    const mvp = mat4Multiply(this.vp, model);
    gl.uniformMatrix4fv(this.loc.mvp, false, mvp);
    gl.uniformMatrix4fv(this.loc.model, false, model);
    gl.uniform1f(this.loc.useTex, opts.tex ? 1 : 0);
    gl.uniform1f(this.loc.emissive, opts.emissive ? 1 : 0);
    gl.uniform1f(this.loc.sky, opts.sky ? 1 : 0);
    gl.uniform1f(this.loc.alpha, opts.alpha != null ? opts.alpha : 1);
    if (opts.alpha != null && opts.alpha < 1) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    if (opts.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[opts.tex]); }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (opts.alpha != null && opts.alpha < 1) { gl.depthMask(true); gl.disable(gl.BLEND); }
  }
  box(x, y, z, ry, w, h, d, color, opts = {}) {
    const key = color.join(',');
    if (!this._tints) this._tints = new Map();
    let mesh = this._tints.get(key);
    if (!mesh) { mesh = this.makeMesh(unitCubeData(color)); this._tints.set(key, mesh); }
    const model = (opts.pitch || opts.roll)
      ? mat4ModelPose(x, y, z, ry, opts.pitch || 0, opts.roll || 0, w, h, d)
      : mat4Model(x, y, z, ry, w, h, d);
    this.draw(mesh, model, opts);
  }
  // textured quad panel (used for the cockpit dash cluster)
  panel(x, y, z, ry, w, h, texKey, opts = {}) {
    if (!this._panelMesh) this._panelMesh = this.makeMesh(unitCubeData([1, 1, 1]));
    const model = (opts.pitch || opts.roll)
      ? mat4ModelPose(x, y, z, ry, opts.pitch || 0, opts.roll || 0, w, h, 0.03)
      : mat4Model(x, y, z, ry, w, h, 0.03);
    this.draw(this._panelMesh, model, { tex: texKey, emissive: true });
  }
}
