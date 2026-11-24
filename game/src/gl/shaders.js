// shaders.js — a single hand-written shader pair drives the entire
// game (WebGL1). The vertex stage transforms the point, forwards the
// normal, uv and colour, and records the world position together with a
// clip-space distance the fragment stage uses for fog. The fragment
// stage has two modes: sky mode blends a warm horizon glow through the
// mid and zenith bands and smears the sun across them; surface mode
// lights the vertex colour (or a texture sample) with a warm sun over
// hemisphere ambient, lays an up-facing sheen on top, honours emissive,
// and finishes with peach exponential fog that leans toward the horizon
// colour near eye level.

export const VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
attribute vec2 aUv;
attribute vec3 aCol;
uniform mat4 uMvp;
uniform mat4 uModel;
varying vec3 vNorm;
varying vec2 vUv;
varying vec3 vCol;
varying float vDist;
varying vec3 vWp;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWp = world.xyz;
  vNorm = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNorm);
  vUv = aUv;
  vCol = aCol;
  vec4 clip = uMvp * vec4(aPos, 1.0);
  vDist = length(clip.xyz);
  gl_Position = clip;
}`;

export const FS = `
precision mediump float;
varying vec3 vNorm;
varying vec2 vUv;
varying vec3 vCol;
varying float vDist;
varying vec3 vWp;
uniform sampler2D uTex;
uniform float uUseTex;
uniform float uEmissive;
uniform float uAlpha;
uniform float uSky;
uniform vec3 uSun;
uniform vec3 uFogColor;
uniform vec3 uHorizon;
uniform vec3 uCam;
uniform vec3 uZen;
uniform vec3 uMid;
uniform float uAmb;
void main() {
  if (uSky > 0.5) {
    vec3 dir = normalize(vWp - uCam);
    float h = clamp(dir.y * 1.3 + 0.34, 0.0, 1.0);
    vec3 glow = vec3(0.99, 0.68, 0.45);
    vec3 col = mix(glow, uMid, smoothstep(0.02, 0.42, h));
    col = mix(col, uZen, smoothstep(0.45, 1.0, h));
    vec2 flatDir = normalize(dir.xz);
    vec2 flatSun = normalize(uSun.xz);
    float sunAmt = pow(max(dot(flatDir, flatSun), 0.0), 6.0);
    col += vec3(1.0, 0.72, 0.35) * sunAmt * (1.0 - abs(dir.y)) * 0.5;
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  vec3 base = vCol;
  if (uUseTex > 0.5) base *= texture2D(uTex, vUv).rgb;
  vec3 n = normalize(vNorm);
  vec3 sunDir = normalize(uSun);
  float diffuse = max(dot(n, sunDir), 0.0);
  vec3 hemi = mix(vec3(0.55, 0.49, 0.40), vec3(0.66, 0.73, 0.84), n.y * 0.5 + 0.5) * uAmb;
  vec3 col = base * (hemi + diffuse * 0.95 * vec3(1.0, 0.82, 0.55));
  vec3 viewDir = normalize(uCam - vWp);
  vec3 halfVec = normalize(viewDir + sunDir);
  float spec = pow(max(dot(n, halfVec), 0.0), 64.0);
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  col += (spec * 0.6 + fresnel * 0.10) * step(0.5, n.y) * mix(vec3(1.0), base + 0.35, 0.5);
  col = mix(col, base * 1.3, uEmissive);
  float fogF = 1.0 - exp(-pow(vDist * 0.0042, 2.0));
  float horizonMix = clamp(1.0 - abs(normalize(vWp - uCam).y) * 2.2, 0.0, 1.0);
  vec3 fogged = mix(uFogColor, uHorizon, horizonMix);
  col = mix(col, fogged, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, uAlpha);
}`;
