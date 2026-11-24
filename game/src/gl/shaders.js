// shaders.js — the two GLSL programs the renderer uses, written for
// this game. The scene program shades textured or flat-coloured boxes
// with a fixed sun, distance fog and an emissive bypass. The sky
// program paints a three-stop vertical gradient (zenith, mid, horizon)
// on a fullscreen triangle behind everything else.

export const SCENE_VERT = `
attribute vec3 aPos;
attribute vec3 aNorm;
attribute vec3 aTint;
attribute vec2 aUv;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uCamPos;
varying vec3 vTint;
varying vec2 vUv;
varying vec3 vNorm;
varying float vFog;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vTint = aTint;
  vUv = aUv;
  vNorm = normalize(mat3(uModel) * aNorm);
  float dist = length(world.xyz - uCamPos);
  vFog = smoothstep(70.0, 430.0, dist);
  gl_Position = uProj * uView * world;
}
`;

export const SCENE_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uUseTex;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uEmissive;
uniform vec3 uFogColor;
uniform float uAmbScale;
varying vec3 vTint;
varying vec2 vUv;
varying vec3 vNorm;
varying float vFog;
void main() {
  vec3 base = uColor * vTint;
  if (uUseTex > 0.5) base *= texture2D(uTex, vUv).rgb;
  vec3 sunDir = normalize(vec3(0.45, 0.8, 0.35));
  float diff = max(dot(normalize(vNorm), sunDir), 0.0);
  // A generous ambient floor keeps unlit faces readable — the city is
  // pastel, and at dusk the grade (uAmbScale) dims everything evenly
  // instead of crushing the shadow side to black.
  float lit = mix((0.68 + 0.32 * diff) * (0.72 + 0.28 * uAmbScale), 1.0, uEmissive);
  vec3 shaded = base * lit;
  vec3 fogged = mix(shaded, uFogColor, vFog * (1.0 - uEmissive * 0.7));
  gl_FragColor = vec4(fogged, uAlpha);
}
`;

export const SKY_VERT = `
attribute vec2 aClip;
varying float vY;
void main() {
  vY = aClip.y;
  gl_Position = vec4(aClip, 0.9999, 1.0);
}
`;

export const SKY_FRAG = `
precision mediump float;
uniform vec3 uZen;
uniform vec3 uMid;
uniform vec3 uHor;
varying float vY;
void main() {
  float h = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uHor, uMid, smoothstep(0.46, 0.62, h));
  col = mix(col, uZen, smoothstep(0.60, 0.95, h));
  gl_FragColor = vec4(col, 1.0);
}
`;
