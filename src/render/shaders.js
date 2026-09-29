// Shared GLSL used by every custom material: atmosphere, fog, lighting, wind, noise.
// All lighting is custom (no three.js lights), so one uniform set drives the whole look.
import * as THREE from 'three';

// One shared uniforms object. Every material references these same {value} slots.
export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() }, // direction to the dominant light
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uSunDirVis: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() }, // where the sun actually is
  uMoonDir: { value: new THREE.Vector3(-0.3, -0.8, -0.5).normalize() },
  uAmbUp: { value: new THREE.Color(0.4, 0.5, 0.7) },
  uAmbDown: { value: new THREE.Color(0.2, 0.2, 0.15) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uFogSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
  uFogDensity: { value: 0.0004 },
  uFogHeight: { value: 0.004 },
  uSkyZenith: { value: new THREE.Color(0.2, 0.4, 0.8) },
  uSkyHorizon: { value: new THREE.Color(0.7, 0.85, 1) },
  uSkyGlow: { value: new THREE.Color(1, 0.8, 0.5) },
  uNight: { value: 0 },
  uWind: { value: new THREE.Vector4(0.8, 0.6, 1.0, 1.0) }, // dir.xy, speed, strength
  uPlayerGlow: { value: new THREE.Vector4(0, 0, 0, 0) },
  uGlowColor: { value: new THREE.Color(1, 0.8, 0.5) },
  uWet: { value: 0 },
  uCloudCover: { value: 0.35 },
  uCloudOffset: { value: new THREE.Vector2() },
  uNoiseTex: { value: null },
  uPlayerPos: { value: new THREE.Vector3() },
  uPulse: { value: new THREE.Vector4(0, 0, 0, 0) }, // xyz center, w = radius (0 when idle)
  uMoonPhase: { value: 0.3 },
  uSkyK: { value: 4 },
  uPerch: { value: new THREE.Vector4(0, 0, 0, 0) }, // xz of the flower the player sits on, w = active
  uFinale: { value: 0 }, // 0..1 while the Heartbloom wakes: blossoms and petals glow
};

export const GLSL_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSunDirVis;
uniform vec3 uMoonDir;
uniform vec3 uAmbUp;
uniform vec3 uAmbDown;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform float uNight;
uniform vec4 uWind;
uniform vec4 uPlayerGlow;
uniform vec3 uGlowColor;
uniform float uWet;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform sampler2D uNoiseTex;
uniform vec3 uPlayerPos;
uniform vec4 uPulse;
uniform float uMoonPhase;
uniform float uSkyK;
uniform vec4 uPerch;
uniform float uFinale;
`;

export const GLSL_FUNCS = /* glsl */ `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

// tileable noise texture channels: r low, g mid, b high, a very high frequency (each 0..1)
vec4 nz(vec2 uv){ return texture2D(uNoiseTex, uv); }

float cloudDensity(vec2 xz){
  vec2 p = xz * 0.00009 + uCloudOffset;
  float a = nz(p).r * 0.62 + nz(p * 2.1 + 0.3).g * 0.28 + nz(p * 4.4 + 0.7).b * 0.10;
  float cover = uCloudCover;
  return smoothstep(0.8 - cover * 0.44, 0.8 - cover * 0.44 + 0.27, a);
}
// soft moving cloud shadows on the ground
float cloudShadow(vec3 wp){
  vec2 c = wp.xz + uSunDir.xz / max(uSunDir.y, 0.2) * (1400.0 - wp.y);
  float d = cloudDensity(c);
  return 1.0 - 0.55 * d * smoothstep(0.02, 0.25, uSunDir.y);
}

vec3 skyColor(vec3 d){
  float y = d.y;
  float t = clamp(y, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyZenith, 1.0 - exp(-t * uSkyK));
  float sd = max(dot(d, uSunDirVis), 0.0);
  float az = max(dot(normalize(d.xz + 0.0001), normalize(uSunDirVis.xz + 0.0001)), 0.0);
  float bandLow = exp(-t * 8.0);
  col += uSkyGlow * bandLow * az * az * 0.5 * (1.0 - smoothstep(0.1, 0.6, uSunDirVis.y));
  col += uSkyGlow * (pow(sd, 3.0) * 0.14 + pow(sd, 16.0) * 0.28 + pow(sd, 90.0) * 0.5);
  col = mix(col, uFogColor, smoothstep(0.0, -0.3, y));
  return col;
}

vec3 applyFog(vec3 col, vec3 wp){
  vec3 v = wp - cameraPosition;
  float d = length(v);
  vec3 vd = v / max(d, 0.0001);
  float sunAmt = pow(max(dot(vd, uSunDirVis), 0.0), 7.0);
  vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmt);
  float h = max(0.0, mix(cameraPosition.y, wp.y, 0.5));
  float amount = 1.0 - exp(-d * uFogDensity * exp(-h * uFogHeight));
  return mix(col, fogCol, clamp(amount, 0.0, 1.0));
}

// wind: returns a horizontal displacement direction*amount for a world position
vec2 windField(vec2 xz){
  vec2 dir = uWind.xy;
  float t = uTime * uWind.z;
  vec2 p = xz * 0.011 - dir * t * 0.09;
  float g = nz(p).r * 0.65 + nz(p * 3.1).g * 0.35;
  float gust = smoothstep(0.32, 0.8, g);
  float sway = sin(dot(xz, dir) * 0.6 - t * 2.3 + g * 6.0) * 0.5 + 0.5;
  return dir * uWind.w * (0.25 + 0.75 * gust) * (0.55 + 0.45 * sway);
}

vec3 shadeSurface(vec3 albedo, vec3 n, float ao, vec3 wp, float shadow){
  float ndl = dot(n, uSunDir);
  float dif = max(ndl, 0.0);
  float wrap = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  vec3 amb = mix(uAmbDown, uAmbUp, n.y * 0.5 + 0.5);
  vec3 lit = uSunColor * (dif * 0.9 + wrap * wrap * 0.14) * shadow + amb * ao;
  vec3 toP = uPlayerGlow.xyz - wp;
  float gd2 = dot(toP, toP);
  lit += uGlowColor * uPlayerGlow.w * exp(-gd2 * 0.0085) * (0.55 + 0.45 * dot(n, toP * inversesqrt(gd2 + 0.01)));
  return albedo * lit;
}

// discovery pulse ring highlight (adds a soft expanding band around uPulse.xyz)
float pulseBand(vec3 wp){
  if (uPulse.w <= 0.0) return 0.0;
  float d = distance(wp, uPulse.xyz);
  float band = smoothstep(uPulse.w - 6.0, uPulse.w, d) * (1.0 - smoothstep(uPulse.w, uPulse.w + 3.0, d));
  return band * (1.0 - smoothstep(30.0, 90.0, uPulse.w));
}
`;

// Height sampling helpers for the terrain height texture (manual bilinear on a nearest filtered float texture).
export const GLSL_HEIGHT = /* glsl */ `
uniform sampler2D uHeightTex;
const float WORLD_HALF = 2048.0;
const float WORLD_CELL = 4.0;
const int WORLD_N = 1024;
float hTexel(ivec2 p){ p = clamp(p, ivec2(0), ivec2(WORLD_N - 1)); return texelFetch(uHeightTex, p, 0).r; }
float terrainHeight(vec2 xz){
  vec2 u = (xz + WORLD_HALF) / WORLD_CELL;
  vec2 i = floor(u); vec2 f = u - i;
  ivec2 p = ivec2(i);
  float a = hTexel(p), b = hTexel(p + ivec2(1, 0)), c = hTexel(p + ivec2(0, 1)), d = hTexel(p + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec2 worldUV(vec2 xz){ return ((xz + WORLD_HALF) / WORLD_CELL + 0.5) / float(WORLD_N); }
`;

// Tileable value noise texture (256x256 RGBA, 4 frequencies) used for clouds, wind, detail, water.
export const NOISE = { data: null, size: 256 };
export function makeNoiseTexture(seed = 5) {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  NOISE.data = data;
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const periods = [8, 16, 32, 64];
  for (let ch = 0; ch < 4; ch++) {
    const P = periods[ch];
    // two octaves per channel for richer structure
    const lattices = [];
    for (let o = 0; o < 2; o++) {
      const per = P * (o + 1);
      const lat = new Float32Array(per * per);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      lattices.push({ per, lat });
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let v = 0, wsum = 0;
        for (let o = 0; o < 2; o++) {
          const { per, lat } = lattices[o];
          const fx = (x / S) * per, fy = (y / S) * per;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = fx - x0, ty = fy - y0;
          const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
          const x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
          const xx = x0 % per, yy = y0 % per;
          const a = lat[yy * per + xx], b = lat[yy * per + x1], c = lat[y1 * per + xx], d = lat[y1 * per + x1];
          const val = (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
          const w = o === 0 ? 1 : 0.5;
          v += val * w; wsum += w;
        }
        data[(y * S + x) * 4 + ch] = Math.round((v / wsum) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
