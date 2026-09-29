// Ground props scattered around the world: ferns, bushes, rocks, mushrooms and reeds.
import * as THREE from 'three';
import { MeshBuilder, shapeNoise } from './meshbuilder.js';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from './shaders.js';
import { hexToLinear } from '../core/util.js';

// variant colour tables (sRGB hex) per prop kind
export const PROP_VARIANTS = {
  fern: ['#2f6e34', '#3f8240', '#255c30', '#4c8f45', '#5f9a48'],
  bush: ['#3d7a36', '#4b8a3a', '#356a34', '#5a9440', '#6aa04a'],
  rock: ['#8c8d8f', '#9b958b', '#7a7d80', '#a39f96', '#6f7274'],
  mushroom: ['#d8392f', '#a86a3a', '#efe2c4', '#39d6c0', '#b97cff'],
  reed: ['#5f8f45', '#6f9c4a', '#527d3e', '#7aa650', '#4c7a44'],
};
const BERRY = ['#e0413a', '#8a3fd0', '#ffd23a', '#ff8fbd', '#ffffff'];

const srgb = (h) => hexToLinear(h);

export function buildFern() {
  const b = new MeshBuilder();
  const n = 9;
  b.setPart(1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
    const L = 0.85 + (i % 3) * 0.14;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const seg = 5;
    let prev = null;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const r = 0.05 + L * t;
      const y = 0.06 + 0.5 * Math.sin(Math.min(t, 1) * Math.PI * 0.62) * (1 - 0.35 * t) - 0.2 * t * t;
      const w = 0.19 * Math.pow(Math.sin(Math.min(t * 0.92 + 0.08, 1) * Math.PI), 0.75) * (1 + 0.3 * (1 - t));
      const shade = 0.55 + 0.45 * t;
      const c = [shade, shade, shade];
      const l = [dx * r - px * w, y - 0.03 * t, dz * r - pz * w], m = [dx * r, y + 0.015, dz * r], rr = [dx * r + px * w, y - 0.03 * t, dz * r + pz * w];
      const cur = [l, m, rr, shade];
      if (prev) {
        b.flatTri(prev[0], prev[1], cur[1], [prev[3], prev[3], cur[3]], [[prev[3], prev[3], prev[3]], [prev[3], prev[3], prev[3]], c], 1);
        b.flatTri(prev[0], cur[1], cur[0], [prev[3], cur[3], cur[3]], [[prev[3], prev[3], prev[3]], c, c], 1);
        b.flatTri(prev[1], prev[2], cur[2], [prev[3], prev[3], cur[3]], [[prev[3], prev[3], prev[3]], [prev[3], prev[3], prev[3]], c], 1);
        b.flatTri(prev[1], cur[2], cur[1], [prev[3], cur[3], cur[3]], [[prev[3], prev[3], prev[3]], c, c], 1);
      }
      prev = cur;
    }
  }
  return b.build();
}

export function buildBush() {
  const b = new MeshBuilder();
  const noise = shapeNoise(11);
  const blobs = [[0, 0.55, 0, 0.75], [0.55, 0.42, 0.15, 0.55], [-0.45, 0.4, -0.25, 0.58], [0.05, 0.4, 0.5, 0.5]];
  for (const [x, y, z, r] of blobs) {
    b.push().translate(x, y, z);
    b.sphere({ r, detail: 1, part: 1, flat: true, squashY: 0.82, shadeBottom: 0.35, shadeTop: 1, color: [1, 1, 1], displace: (a, c, d) => 0.82 + 0.36 * noise(a + x, c + y, d + z) });
    b.pop();
  }
  // berries or blossoms
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, r = 0.55 + (i % 3) * 0.12;
    b.push().translate(Math.cos(a) * r * 0.9, 0.5 + (i % 4) * 0.13, Math.sin(a) * r * 0.9);
    b.sphere({ r: 0.065, detail: 0, part: 2, flat: true, color: [1, 1, 1], shadeBottom: 0.6, shadeTop: 1 });
    b.pop();
  }
  return b.build();
}

export function buildRock(size) {
  const b = new MeshBuilder();
  const noise = shapeNoise(size * 7 + 3);
  const det = size >= 2 ? 2 : 1;
  b.sphere({
    r: 1, detail: det, part: 1, flat: true, squashY: 0.62, shadeBottom: 0.3, shadeTop: 1.0,
    displace: (x, y, z) => 0.72 + 0.5 * noise(x * 1.3, y * 1.3, z * 1.3) + 0.12 * noise(x * 3.7, y * 3.7, z * 3.7),
    colorFn: (x, y) => { const m = Math.max(0, y - 0.35); return [1 - m * 0.3, 1 + m * 0.35, 1 - m * 0.2]; },
  });
  return b.build();
}

export function buildMushroom() {
  const b = new MeshBuilder();
  // stem (part 0) cream, cap (part 1) variant coloured, spots (part 2)
  b.setPart(0);
  b.cylinder({ r0: 0.06, r1: 0.045, h: 0.34, seg: 6, c0: [0.85, 0.8, 0.7], c1: [0.95, 0.92, 0.85], part: 0, smooth: true, shade0: 0.4, shade1: 0.9 });
  // cap: three rings dome
  const rings = [[0.24, 0.3], [0.2, 0.38], [0.11, 0.44], [0.0, 0.46]];
  const seg = 9;
  b.setPart(1);
  const rows = [];
  rows.push([[0.26, 0.3]]); // placeholder not used
  const ringVerts = [];
  const rimR = 0.27, rimY = 0.29;
  const R = [[rimR, rimY, 0.5], [0.24, 0.38, 0.8], [0.14, 0.45, 1.0]];
  for (const [r, y, sh] of R) {
    const row = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; row.push([Math.cos(a) * r, y, Math.sin(a) * r, sh]); }
    ringVerts.push(row);
  }
  const top = [0, 0.48, 0];
  for (let k = 0; k < ringVerts.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = ringVerts[k][i], c = ringVerts[k][j], d = ringVerts[k + 1][j], e = ringVerts[k + 1][i];
      b.flatQuad(a.slice(0, 3), e.slice(0, 3), d.slice(0, 3), c.slice(0, 3), [a[3], e[3], d[3], c[3]], null, 1);
    }
  }
  const last = ringVerts[ringVerts.length - 1];
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; b.flatTri(last[i].slice(0, 3), top, last[j].slice(0, 3), [1, 1, 1], null, 1); }
  // underside gills (dark)
  const under = ringVerts[0];
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; b.flatTri([0, 0.27, 0], under[j].slice(0, 3), under[i].slice(0, 3), [0.25, 0.3, 0.3], [[0.5, 0.45, 0.4], [0.5, 0.45, 0.4], [0.5, 0.45, 0.4]], 0); }
  // spots
  b.setPart(2);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.9 + 0.4, r = 0.13 + (i % 2) * 0.08, y = 0.46 - r * 0.42;
    b.push().translate(Math.cos(a) * r, y + 0.012, Math.sin(a) * r);
    b.disc(0.03, 0, 5, [1, 1, 1], true, 2, 1);
    b.pop();
  }
  return b.build();
}

export function buildReed() {
  const b = new MeshBuilder();
  b.setPart(1);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + i * 0.3;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const H = 1.7 + (i % 3) * 0.35;
    const lean = 0.18 + (i % 2) * 0.12;
    const seg = 4;
    let prev = null;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const y = H * t;
      const off = lean * t * t * H * 0.55;
      const w = 0.045 * (1 - t * 0.85);
      const cx = dx * (0.06 + off), cz = dz * (0.06 + off);
      const sh = 0.5 + 0.5 * t;
      const cur = [[cx - px * w, y, cz - pz * w], [cx + px * w, y, cz + pz * w], sh];
      if (prev) {
        b.flatQuad(prev[0], prev[1], cur[1], cur[0], [prev[2], prev[2], cur[2], cur[2]], [[prev[2], prev[2], prev[2]], [prev[2], prev[2], prev[2]], [cur[2], cur[2], cur[2]], [cur[2], cur[2], cur[2]]], 1);
      }
      prev = cur;
    }
    if (i % 3 === 0) {
      // cattail head
      const off = lean * H * 0.55 * 0.8;
      b.push().translate(dx * (0.06 + off), H * 0.72, dz * (0.06 + off));
      b.cylinder({ r0: 0.038, r1: 0.032, h: 0.3, seg: 5, c0: [0.32, 0.2, 0.12], c1: [0.4, 0.26, 0.15], part: 2, smooth: true, shade0: 0.7, shade1: 1 });
      b.pop();
    }
  }
  return b.build();
}

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
attribute vec3 color;
attribute float aPart;
attribute float aShade;
attribute vec4 iP;
attribute vec4 iQ;
uniform vec3 uVar[8];
uniform vec3 uAccent[8];
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uHeight;
uniform float uWindAmt;
uniform float uGlowMask;
uniform float uTrans;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vAO;
varying float vGlow;
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c); }
void main(){
  vec3 base = iP.xyz;
  float sc = iP.w;
  float yaw = iQ.x;
  float phase = iQ.y;
  int vi = int(iQ.z + 0.5);
  float dist = distance(base, cameraPosition);
  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
  if (fade < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vN = vec3(0,1,0); vWorld = vec3(0.0); vAO = 1.0; vGlow = 0.0; return; }
  float k = sc * fade;
  vec3 lp = position * k;
  vec3 wp = rotY(lp, yaw);
  vec3 nrm = rotY(normal, yaw);
  float hf = clamp(position.y / max(uHeight, 0.01), 0.0, 1.0);
  vec2 wnd = windField(base.xz) * uWindAmt * hf * hf * (0.5 + 0.5 * k);
  vec2 fromP = base.xz - uPlayerPos.xz;
  float pushK = smoothstep(3.0, 0.3, length(fromP)) * (1.0 - smoothstep(1.2, 8.0, uPlayerPos.y - base.y));
  wnd += normalize(fromP + 0.001) * pushK * 0.5 * hf * hf * uWindAmt * 2.0;
  vec3 world = base + wp + vec3(wnd.x, -length(wnd) * 0.2, wnd.y);
  vWorld = world;
  vN = normalize(nrm);
  vec3 varCol = uVar[vi];
  vec3 col;
  float glowK = 0.0;
  if (aPart < 0.5) col = color;
  else if (aPart < 1.5) col = varCol * color;
  else col = uAccent[vi] * color;
  if (aPart > 0.5 && aPart < 1.5 && mod(floor(uGlowMask / exp2(float(vi)) + 0.001), 2.0) > 0.5) glowK = 1.0;
  if (aPart > 1.5 && mod(floor(uGlowMask / exp2(float(vi)) + 0.001), 2.0) > 0.5) glowK = 0.6;
  vColor = col * (0.9 + 0.2 * hash11(phase * 17.0));
  vAO = mix(0.5, 1.0, aShade);
  vGlow = glowK;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
uniform float uTrans;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vAO;
varying float vGlow;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float shadow = cloudShadow(vWorld);
  vec3 col = shadeSurface(vColor, N, vAO, vWorld, shadow);
  col += vColor * uSunColor * pow(max(dot(-V, uSunDir), 0.0), 2.0) * uTrans * shadow * 0.5;
  col += vColor * vGlow * (0.15 + uNight * 1.6);
  col += vec3(0.4, 0.75, 1.0) * pulseBand(vWorld) * 0.35;
  float mx = max(col.r, max(col.g, col.b));
  col *= min(1.0, 1.4 / max(mx, 0.001));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makePropMaterial(kind, { height = 1, wind = 0.3, glowMask = 0, trans = 0.3, fadeStart = 60, fadeEnd = 100 } = {}) {
  const variants = PROP_VARIANTS[kind] || PROP_VARIANTS.rock;
  const uVar = [], uAcc = [];
  for (let i = 0; i < 8; i++) {
    const c = srgb(variants[i % variants.length]);
    uVar.push(new THREE.Vector3(c[0], c[1], c[2]));
    const a = srgb(kind === 'bush' ? BERRY[i % BERRY.length] : kind === 'mushroom' ? '#fff6e8' : kind === 'reed' ? '#6a4326' : '#ffffff');
    uAcc.push(new THREE.Vector3(a[0], a[1], a[2]));
  }
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    uniforms: {
      ...G,
      uVar: { value: uVar }, uAccent: { value: uAcc },
      uFadeStart: { value: fadeStart }, uFadeEnd: { value: fadeEnd },
      uHeight: { value: height }, uWindAmt: { value: wind }, uGlowMask: { value: glowMask }, uTrans: { value: trans },
    },
  });
}
