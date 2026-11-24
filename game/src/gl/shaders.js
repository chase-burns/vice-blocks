// GLSL sources (WO Task 1): dusk gradient sky, directional sun, exponential
// squared fog, hemisphere ambient, wet-surface specular, emissive pass.
export const VS = `
attribute vec3 aPos; attribute vec3 aNorm; attribute vec2 aUv; attribute vec3 aCol;
uniform mat4 uMvp; uniform mat4 uModel;
varying vec3 vNorm; varying vec2 vUv; varying vec3 vCol; varying float vDist; varying vec3 vWp;
void main(){
  vec4 wp = uModel * vec4(aPos,1.0);
  vWp = wp.xyz;
  vNorm = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNorm);
  vUv = aUv; vCol = aCol;
  vec4 clip = uMvp * vec4(aPos,1.0);
  vDist = length(clip.xyz);
  gl_Position = clip;
}`;
export const FS = `
precision mediump float;
varying vec3 vNorm; varying vec2 vUv; varying vec3 vCol; varying float vDist; varying vec3 vWp;
uniform sampler2D uTex; uniform float uUseTex; uniform float uEmissive; uniform float uAlpha; uniform float uSky;
uniform vec3 uSun; uniform vec3 uFogColor; uniform vec3 uHorizon; uniform vec3 uCam;
void main(){
  if (uSky > 0.5) {
    // Miami dusk: peach-orange horizon melting up into soft sky blue.
    float h = clamp(normalize(vWp - uCam).y * 1.3 + 0.34, 0.0, 1.0);
    vec3 zen = vec3(0.42, 0.66, 0.92);   // soft sky blue
    vec3 mid = vec3(0.98, 0.78, 0.58);   // peach
    vec3 nad = vec3(0.99, 0.68, 0.45);   // warm horizon glow
    vec3 col = mix(nad, mid, smoothstep(0.02, 0.42, h));
    col = mix(col, zen, smoothstep(0.45, 1.0, h));
    // golden sun glow near the sun azimuth
    vec3 dir = normalize(vWp - uCam);
    float sunAmt = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 6.0);
    col += vec3(1.0, 0.72, 0.35) * sunAmt * (1.0 - abs(dir.y)) * 0.5;
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  vec3 base = vCol;
  if (uUseTex > 0.5) base *= texture2D(uTex, vUv).rgb;
  vec3 n = normalize(vNorm);
  float diff = max(dot(n, normalize(uSun)), 0.0);
  // Hemisphere ambient: bright sky bounce, warm sand ground bounce.
  vec3 hemi = mix(vec3(0.55,0.49,0.40), vec3(0.66,0.73,0.84), n.y * 0.5 + 0.5);
  vec3 col = base * (hemi + 0.95 * diff * vec3(1.0,0.82,0.55)); // warm golden sunlight
  // Wet-surface sheen: strong low-angle specular on upward faces, tinted by base.
  vec3 v = normalize(uCam - vWp);
  vec3 hv = normalize(v + normalize(uSun));
  float spec = pow(max(dot(n, hv), 0.0), 64.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += (spec * 0.6 + fres * 0.10) * step(0.5, n.y) * mix(vec3(1.0), base + 0.35, 0.5);
  col = mix(col, base * 1.3, uEmissive);
  // Light warm haze: exponential squared fog, sigma = 0.0042, peach tones.
  float f = 1.0 - exp(-pow(vDist * 0.0042, 2.0));
  vec3 fogC = mix(uFogColor, uHorizon, clamp(1.0 - abs(normalize(vWp - uCam).y) * 2.2, 0.0, 1.0));
  col = mix(col, fogC, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, uAlpha);
}`;
