// Time of day and weather to lighting, sky and fog parameters.
import * as THREE from 'three';
import { hexToLinear, lerp, smoothstep, clamp01, TAU } from '../core/util.js';

// hour, zenith, horizon, glow, fog, sun colour, sun intensity, ambient up, ambient down
const RAW = [
  [0, '#050b24', '#12245a', '#16285c', '#0e1c44', '#8fa8ff', 0, '#2f4488', '#17214a'],
  [4.5, '#0a1433', '#1e3068', '#2d3d7c', '#18275a', '#9fb4ff', 0, '#32458a', '#182250'],
  [5.5, '#2a3a78', '#ff9a86', '#ff8f7a', '#c88a9e', '#ffb08a', 1.2, '#7a86c0', '#4a3a60'],
  [6.3, '#4c7fd0', '#ffc9a2', '#ffb27a', '#f2c6a6', '#ffd0a0', 2.2, '#96b0de', '#665a4c'],
  [7.6, '#4a8fe6', '#bfe1ff', '#ffe2b8', '#cfe4f2', '#fff0d8', 2.45, '#8fb8ee', '#6b7048'],
  [10, '#3b86e6', '#a8d6ff', '#e6f0ff', '#bcd9ec', '#fff8ec', 2.55, '#93bff2', '#728050'],
  [13, '#2f7ae0', '#a0d2ff', '#e6f0ff', '#b7d6ec', '#ffffff', 2.6, '#90bcf0', '#728050'],
  [16.4, '#3f86e0', '#b3dcff', '#ffe6c0', '#c6dcea', '#fff2d8', 2.55, '#8ab4ea', '#6c6a48'],
  [18, '#4d7fc8', '#ffd6a0', '#ffbf80', '#f0cfa6', '#ffc98a', 2.6, '#a0b6e4', '#7a5f48'],
  [18.9, '#34478f', '#ff8f6a', '#ff7a5a', '#d88a86', '#ff9a60', 1.5, '#8a8ccc', '#5a4058'],
  [19.6, '#1f2858', '#b45c86', '#d0587c', '#7b5a8c', '#ff7a6a', 0.4, '#666fae', '#3a3058'],
  [20.6, '#0d1436', '#3a3878', '#4a3f85', '#28305f', '#8fa6ff', 0, '#2f4488', '#171f4a'],
  [24, '#050b24', '#12245a', '#16285c', '#0e1c44', '#8fa8ff', 0, '#2f4488', '#17214a'],
];
const KEYS = RAW.map((r) => ({
  h: r[0], zenith: hexToLinear(r[1]), horizon: hexToLinear(r[2]), glow: hexToLinear(r[3]), fog: hexToLinear(r[4]),
  sun: hexToLinear(r[5]), sunI: r[6], ambUp: hexToLinear(r[7]), ambDown: hexToLinear(r[8]),
}));
const MOON = hexToLinear('#9db4ff');
const INC = (25 * Math.PI) / 180;

const tmp = { a: [0, 0, 0], b: [0, 0, 0] };
function mix3(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
}
const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

// Sun direction (toward sun) for an hour 0..24. y is up, x east, z south.
export function sunDirection(hour, out = new THREE.Vector3()) {
  const phi = ((hour - 6) / 12) * Math.PI;
  return out.set(Math.cos(phi), Math.sin(phi) * Math.cos(INC), Math.sin(phi) * Math.sin(INC)).normalize();
}

const _sun = new THREE.Vector3();
const _moon = new THREE.Vector3();
const _c = [0, 0, 0];

// Fills the shared uniform set G and returns extra grading info.
export function applyAtmosphere(G, hour, weather, moonPhase = 0.3) {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const t = clamp01((hour - k0.h) / (k1.h - k0.h));
  const ts = t * t * (3 - 2 * t);
  const overcast = clamp01(weather.overcast);
  const rain = clamp01(weather.rain);
  const mist = clamp01(weather.mist);

  sunDirection(hour, _sun);
  _moon.copy(_sun).multiplyScalar(-1).add(new THREE.Vector3(0.12, 0.06, -0.1)).normalize();
  const elev = _sun.y;
  const dayW = smoothstep(-0.12, 0.07, elev);
  const moonUp = smoothstep(-0.1, 0.12, _moon.y);

  G.uSunDirVis.value.copy(_sun);
  G.uMoonDir.value.copy(_moon);
  G.uSunDir.value.copy(_sun).multiplyScalar(dayW).addScaledVector(_moon, 1 - dayW).normalize();

  const gray = 0.55 * overcast + 0.2 * rain;
  const setCol = (target, a, b, mulr = 1, grayAmt = gray, grayLevel = null) => {
    mix3(a, b, ts, _c);
    const l = grayLevel === null ? lum(_c) : grayLevel;
    target.setRGB(
      lerp(_c[0], l, grayAmt) * mulr,
      lerp(_c[1], l, grayAmt) * mulr,
      lerp(_c[2], l, grayAmt) * mulr,
    );
  };
  setCol(G.uSkyZenith.value, k0.zenith, k1.zenith, 1 - 0.28 * overcast - 0.25 * rain);
  setCol(G.uSkyHorizon.value, k0.horizon, k1.horizon, 1 - 0.1 * overcast - 0.15 * rain);
  setCol(G.uSkyGlow.value, k0.glow, k1.glow, 1 - 0.75 * overcast);
  setCol(G.uFogColor.value, k0.fog, k1.fog, 1 - 0.12 * overcast - 0.2 * rain);
  G.uFogSunColor.value.copy(G.uSkyGlow.value).lerp(G.uFogColor.value, 0.35);
  setCol(G.uAmbUp.value, k0.ambUp, k1.ambUp, 1 + 0.25 * overcast - 0.1 * rain);
  setCol(G.uAmbDown.value, k0.ambDown, k1.ambDown, 1);

  // main light colour: sun by day, moon by night
  mix3(k0.sun, k1.sun, ts, _c);
  const sunI = lerp(k0.sunI, k1.sunI, ts) * 0.42 * (1 - 0.72 * overcast - 0.25 * rain);
  const lc = G.uSunColor.value;
  const moonI = 0.3 * moonUp * (1 - 0.6 * overcast) * (0.55 + 0.45 * (1 - Math.abs(moonPhase - 0.5) * 2));
  lc.setRGB(
    _c[0] * sunI * dayW + MOON[0] * moonI * (1 - dayW),
    _c[1] * sunI * dayW + MOON[1] * moonI * (1 - dayW),
    _c[2] * sunI * dayW + MOON[2] * moonI * (1 - dayW),
  );
  // fog
  const nightF = 1 - smoothstep(-0.2, 0.12, elev);
  G.uNight.value = nightF;
  G.uFogDensity.value = 0.00027 * (1 + 10 * mist + 0.9 * rain + 0.4 * nightF);
  G.uFogHeight.value = 0.0042 * (1 - 0.5 * mist);
  G.uMoonPhase.value = moonPhase;
  G.uWet.value = rain;
  G.uSkyK.value = lerp(7.5, 3.6, smoothstep(0.02, 0.6, elev));
  G.uCloudCover.value = clamp01(0.5 + 0.42 * overcast + 0.12 * rain);

  // grading hints
  const low = elev > -0.05 ? 1 - smoothstep(0.05, 0.4, elev) : 0;
  return {
    elev,
    exposure: 1.0 + 0.32 * nightF + 0.08 * overcast + 0.16 * low,
    bloom: 0.34 + 0.2 * nightF + 0.06 * (1 - overcast),
    saturation: 1.05 - 0.18 * overcast - 0.1 * nightF,
    sunI,
    dayW,
  };
}
