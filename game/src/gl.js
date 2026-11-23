// Hand-written WebGL engine: shaders, matrices, mesh building, canvas textures.
// No libraries. One lit+textured shader with fog and emissive support.
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
// Model with yaw + pitch (around local X) + roll (around local Z), for body pose.
export function mat4ModelPose(x, y, z, ry, pitch, roll, sx, sy, sz) {
  const cy = Math.cos(ry), syw = Math.sin(ry);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry * Rx * Rz
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

const VS = `
attribute vec3 aPos; attribute vec3 aNorm; attribute vec2 aUv; attribute vec3 aCol;
uniform mat4 uMvp; uniform mat4 uModel;
varying vec3 vNorm; varying vec2 vUv; varying vec3 vCol; varying float vFog; varying vec3 vWp;
void main(){
  vec4 wp = uModel * vec4(aPos,1.0);
  vWp = wp.xyz;
  vNorm = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNorm);
  vUv = aUv; vCol = aCol;
  vec4 clip = uMvp * vec4(aPos,1.0);
  vFog = clamp((length(clip.xyz) - 60.0) / 190.0, 0.0, 1.0);
  gl_Position = clip;
}`;
const FS = `
precision mediump float;
varying vec3 vNorm; varying vec2 vUv; varying vec3 vCol; varying float vFog; varying vec3 vWp;
uniform sampler2D uTex; uniform float uUseTex; uniform float uEmissive; uniform float uAlpha;
uniform vec3 uSun; uniform vec3 uFogColor; uniform vec3 uCam;
void main(){
  vec3 base = vCol;
  if (uUseTex > 0.5) base *= texture2D(uTex, vUv).rgb;
  vec3 n = normalize(vNorm);
  float diff = max(dot(n, normalize(uSun)), 0.0);
  // Hemisphere ambient: warm dark ground bounce vs neon sky tint.
  vec3 hemi = mix(vec3(0.30,0.20,0.30), vec3(0.45,0.52,0.62), n.y * 0.5 + 0.5);
  vec3 col = base * (hemi + 0.62 * diff * vec3(1.0,0.92,0.82));
  // Wet-surface sheen: strong low-angle specular on upward faces, tinted by base.
  vec3 v = normalize(uCam - vWp);
  vec3 hv = normalize(v + normalize(uSun));
  float spec = pow(max(dot(n, hv), 0.0), 42.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += (spec * 0.55 + fres * 0.10) * step(0.5, n.y) * mix(vec3(1.0), base + 0.35, 0.5);
  col = mix(col, base * 1.3, uEmissive);
  // Exponential distance fog toward the sky colour.
  float fogF = 1.0 - exp(-pow(vFog * 2.6, 2.0));
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, uAlpha);
}`;

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
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'), norm: gl.getAttribLocation(prog, 'aNorm'),
      uv: gl.getAttribLocation(prog, 'aUv'), col: gl.getAttribLocation(prog, 'aCol'),
      mvp: gl.getUniformLocation(prog, 'uMvp'), model: gl.getUniformLocation(prog, 'uModel'),
      tex: gl.getUniformLocation(prog, 'uTex'), useTex: gl.getUniformLocation(prog, 'uUseTex'),
      emissive: gl.getUniformLocation(prog, 'uEmissive'), sun: gl.getUniformLocation(prog, 'uSun'),
      fog: gl.getUniformLocation(prog, 'uFogColor'), cam: gl.getUniformLocation(prog, 'uCam'),
      alpha: gl.getUniformLocation(prog, 'uAlpha'),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.98, 0.62, 0.45, 1);
    this.fogColor = [0.98, 0.62, 0.45];
    this.sunDir = [-0.45, 0.8, 0.35];
    this.textures = makeTextures(gl);
    this.unitCube = this.makeMesh(unitCubeData());
  }
  resize() {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.gl.viewport(0, 0, w, h); }
    return [w, h];
  }
  makeMesh(data) {
    // data: Float32Array interleaved pos(3) norm(3) uv(2) col(3) = 11 floats
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
    gl.uniform3fv(this.loc.cam, camPos);
    gl.uniform1i(this.loc.tex, 0);
  }
  draw(mesh, model, opts = {}) {
    const gl = this.gl;
    this.bindMesh(mesh);
    const mvp = mat4Multiply(this.vp, model);
    gl.uniformMatrix4fv(this.loc.mvp, false, mvp);
    gl.uniformMatrix4fv(this.loc.model, false, model);
    gl.uniform1f(this.loc.useTex, opts.tex ? 1 : 0);
    gl.uniform1f(this.loc.emissive, opts.emissive ? 1 : 0);
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
    // unit cube scaled; colour baked via a tint mesh cache keyed by colour
    const key = color.join(',');
    if (!this._tints) this._tints = new Map();
    let mesh = this._tints.get(key);
    if (!mesh) { mesh = this.makeMesh(unitCubeData(color)); this._tints.set(key, mesh); }
    const model = (opts.pitch || opts.roll)
      ? mat4ModelPose(x, y, z, ry, opts.pitch || 0, opts.roll || 0, w, h, d)
      : mat4Model(x, y, z, ry, w, h, d);
    this.draw(mesh, model, opts);
  }
}

// Interleaved unit cube centred at origin, size 1. uv covers each face 0..1.
export function unitCubeData(color = [1, 1, 1]) {
  const F = [
    // [normal, corners] per face
    [[0,0,1], [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]]],
    [[0,0,-1], [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]]],
    [[1,0,0], [[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]]],
    [[-1,0,0], [[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]]],
    [[0,1,0], [[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]]],
    [[0,-1,0], [[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]]],
  ];
  const out = [];
  const uv = [[0,0],[1,0],[1,1],[0,1]];
  for (const [n, cs] of F) {
    const idx = [0,1,2, 0,2,3];
    for (const i of idx) out.push(...cs[i], ...n, ...uv[i], ...color);
  }
  return new Float32Array(out);
}

// Mesh builder for static geometry (positions in world space, model = identity).
export class Builder {
  constructor() { this.data = []; }
  quad(p1, p2, p3, p4, n, color, uvScale = 1) {
    const uv = [[0,0],[uvScale,0],[uvScale,uvScale],[0,uvScale]];
    const pts = [p1,p2,p3, p1,p3,p4];
    const uvs = [uv[0],uv[1],uv[2], uv[0],uv[2],uv[3]];
    for (let i = 0; i < 6; i++) this.data.push(...pts[i], ...n, ...uvs[i], ...color);
  }
  box(cx, cy, cz, w, h, d, color, uvRepeat = 0) {
    const x0 = cx-w/2, x1 = cx+w/2, y0 = cy, y1 = cy+h, z0 = cz-d/2, z1 = cz+d/2;
    const r = uvRepeat;
    this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1],color,r);
    this.quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1],color,r);
    this.quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0],color,r);
    this.quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0],color,r);
    this.quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0],color,0);
    this.quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],color,0);
  }
  build(r) { return r.makeMesh(new Float32Array(this.data)); }
}

// Canvas-generated textures: building facades with lit windows, plus a plain
// white fallback. No external images anywhere.
function makeTextures(gl) {
  const out = {};
  const variants = [
    { wall: '#8a7f96', lit: '#ffd76a', dark: '#2c3140' },
    { wall: '#7d8aa0', lit: '#9fe8ff', dark: '#232a38' },
    { wall: '#a08a7d', lit: '#ffb35c', dark: '#38302c' },
    { wall: '#6f7f8c', lit: '#ff8fd0', dark: '#26303a' },
  ];
  variants.forEach((v, vi) => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = v.wall; g.fillRect(0, 0, 128, 256);
    let s = 1234 + vi * 777;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let y = 8; y < 248; y += 16) {
      for (let x = 8; x < 120; x += 16) {
        g.fillStyle = rnd() < 0.55 ? v.lit : v.dark;
        g.fillRect(x, y, 10, 9);
      }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    out['b' + vi] = tex;
  });
  return out;
}
