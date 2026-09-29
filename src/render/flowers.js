// Flower geometry archetypes and the shader that animates them (wind, day/night opening, nectar state).
import * as THREE from 'three';
import { MeshBuilder } from './meshbuilder.js';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from './shaders.js';
import { FLOWERS, VARIANTS, ARCH, ARCH_COUNT } from '../world/biomes.js';
import { hexToLinear } from '../core/util.js';

const GREEN = [0.16, 0.42, 0.14];

// Stem prism (part 0) and two leaves (part 1). Leaf vertices keep the stem attachment fraction in aShade.
function addStemAndLeaves(b, { leaves = true } = {}) {
  b.setPart(0);
  // 4 sided stem, radius 1 (scaled in the shader), y 0..1
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2, a1 = ((i + 1) / 4) * Math.PI * 2;
    const p = (a, y, r) => [Math.cos(a) * r, y, Math.sin(a) * r];
    b.flatQuad(p(a0, 0, 1), p(a1, 0, 1), p(a1, 1, 0.7), p(a0, 1, 0.7), [0, 0, 1, 1], [[0.55, 0.9, 0.5], [0.55, 0.9, 0.5], [1, 1, 1], [1, 1, 1]], 0);
  }
  if (!leaves) return;
  b.setPart(1);
  const leaf = (rot, attach) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = (x, y, z) => [x * c - z * s, y, x * s + z * c];
    const B = R(0.03, 0, 0), ML = R(0.42, 0.13, -0.16), MR = R(0.42, 0.13, 0.16), T = R(1.0, -0.06, 0);
    b.flatTri(B, ML, MR, [attach, attach, attach], [[0.7, 0.7, 0.7], [1, 1, 1], [1, 1, 1]], 1);
    b.flatTri(ML, T, MR, [attach, attach, attach], [[1, 1, 1], [0.85, 0.85, 0.85], [1, 1, 1]], 1);
  };
  leaf(0.3, 0.14);
  leaf(0.3 + Math.PI * 0.92, 0.3);
}

function petalFan(b, n, { r0 = 0.06, rmid = 0.3, r1 = 0.5, w = 0.16, lift = 0.05, round = false, part = 2, phase = 0, curl = 0 }) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const P = (r, side, y) => [dx * r + px * side, y, dz * r + pz * side];
    const base = P(r0, 0, 0.01);
    if (round) {
      const ml = P(rmid * 0.7, -w * 0.9, lift * 0.35), mr = P(rmid * 0.7, w * 0.9, lift * 0.35);
      const tl = P(r1 * 0.94, -w * 0.72, lift + curl), tr = P(r1 * 0.94, w * 0.72, lift + curl);
      const tip = P(r1, 0, lift * 1.1 + curl);
      b.flatTri(base, ml, tl, [0, 0.45, 1], null, part);
      b.flatTri(base, tl, tip, [0, 1, 1], null, part);
      b.flatTri(base, tip, tr, [0, 1, 1], null, part);
      b.flatTri(base, tr, mr, [0, 1, 0.45], null, part);
    } else {
      const ml = P(rmid, -w, lift * 0.4), mr = P(rmid, w, lift * 0.4);
      const tip = P(r1, 0, lift + curl);
      b.flatTri(base, ml, tip, [0, 0.6, 1], null, part);
      b.flatTri(base, tip, mr, [0, 1, 0.6], null, part);
    }
  }
}

function centerDome(b, r, h, seg = 8, part = 3) {
  b.setPart(part);
  const top = b.vertex(0, h, 0, 0, 1, 0, [1, 1, 1], part, 1);
  const ring = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    ring.push(b.vertex(Math.cos(a) * r, h * 0.2, Math.sin(a) * r, Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6, [0.85, 0.85, 0.85], part, 0.5));
  }
  for (let i = 0; i < seg; i++) b.tri(top, ring[(i + 1) % seg], ring[i]);
}

const BUILDERS = {
  [ARCH.RADIAL5]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    petalFan(b, 5, { r0: 0.05, rmid: 0.3, r1: 0.5, w: 0.2, lift: 0.07, round: true, curl: 0.03 });
    centerDome(b, 0.09, 0.07, 6);
    return b.build();
  },
  [ARCH.RADIAL8]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    petalFan(b, 8, { r0: 0.06, rmid: 0.3, r1: 0.5, w: 0.11, lift: 0.06, curl: 0.03 });
    centerDome(b, 0.1, 0.08, 7);
    return b.build();
  },
  [ARCH.RADIAL12]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    petalFan(b, 12, { r0: 0.08, rmid: 0.28, r1: 0.5, w: 0.075, lift: 0.05, curl: 0.02 });
    petalFan(b, 12, { r0: 0.08, rmid: 0.24, r1: 0.42, w: 0.07, lift: 0.075, phase: Math.PI / 12, curl: 0.03 });
    centerDome(b, 0.12, 0.09, 8);
    return b.build();
  },
  [ARCH.CUP]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    b.setPart(2);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
      const P = (r, side, y) => [dx * r + px * side, y, dz * r + pz * side];
      const b0 = P(0.1, 0, 0), l1 = P(0.24, -0.13, 0.3), r1 = P(0.24, 0.13, 0.3), l2 = P(0.27, -0.14, 0.62), r2 = P(0.27, 0.14, 0.62);
      const tip = P(0.14, 0, 0.86);
      b.flatTri(b0, l1, r1, [0, 0.3, 0.3], null, 2);
      b.flatQuad(l1, l2, r2, r1, [0.3, 0.7, 0.7, 0.3], null, 2);
      b.flatTri(l2, tip, r2, [0.7, 1, 0.7], null, 2);
    }
    centerDome(b, 0.07, 0.3, 5, 3);
    return b.build();
  },
  [ARCH.SPIKE]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    // tall spike of florets, head origin at stem top, extends up 2.6 units
    const n = 17;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = 0.15 + t * 2.3;
      const a = i * 2.4;
      const r = 0.2 * (1 - t * 0.55);
      const cx = Math.cos(a) * 0.12 * (1 - t * 0.6), cz = Math.sin(a) * 0.12 * (1 - t * 0.6);
      const s = 0.2 * (1 - t * 0.45);
      const bl = [cx - s * 0.6, y, cz - s * 0.4], br = [cx + s * 0.6, y, cz - s * 0.2], bf = [cx, y, cz + s * 0.7];
      const tip = [cx + Math.cos(a) * r * 0.2, y + s * 1.7, cz + Math.sin(a) * r * 0.2];
      b.flatTri(bl, br, tip, [0.2, 0.2, 1], null, 2);
      b.flatTri(br, bf, tip, [0.2, 0.2, 1], null, 2);
      b.flatTri(bf, bl, tip, [0.2, 0.2, 1], null, 2);
    }
    // green core
    b.setPart(1);
    b.flatTri([0, 0.05, 0.04], [0.03, 0.05, -0.03], [0, 2.4, 0], [0.5, 0.5, 0.5], [[0.8, 1, 0.8], [0.8, 1, 0.8], [1, 1, 1]], 1);
    return b.build();
  },
  [ARCH.BELL]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    // drooping bells along a spike, head origin at stem top
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = 0.25 + t * 1.75;
      const a = i * 2.2;
      const size = 0.34 * (1 - t * 0.5);
      const dx = Math.cos(a), dz = Math.sin(a);
      const cx = dx * 0.09, cz = dz * 0.09;
      const seg = 5;
      const top = [cx, y + size * 0.55, cz];
      const ring = [], rim = [];
      for (let k = 0; k < seg; k++) {
        const ka = (k / seg) * Math.PI * 2;
        ring.push([cx + dx * size * 0.35 + Math.cos(ka) * size * 0.32, y + size * 0.18, cz + dz * size * 0.35 + Math.sin(ka) * size * 0.32]);
        rim.push([cx + dx * size * 0.62 + Math.cos(ka) * size * 0.5, y - size * 0.34, cz + dz * size * 0.62 + Math.sin(ka) * size * 0.5]);
      }
      for (let k = 0; k < seg; k++) {
        const k2 = (k + 1) % seg;
        b.flatTri(top, ring[k], ring[k2], [0.5, 0.35, 0.35], null, 2);
        b.flatQuad(ring[k], rim[k], rim[k2], ring[k2], [0.35, 1, 1, 0.35], null, 2);
      }
    }
    b.setPart(1);
    b.flatTri([0, 0.05, 0.04], [0.03, 0.05, -0.03], [0.02, 2.1, 0], [0.5, 0.5, 0.5], [[0.8, 1, 0.8], [0.8, 1, 0.8], [1, 1, 1]], 1);
    return b.build();
  },
  [ARCH.STAR]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    b.setPart(2);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.25;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
      const P = (r, side, y) => [dx * r + px * side, y, dz * r + pz * side];
      const base = P(0.04, 0, 0.02), ml = P(0.24, -0.13, 0.16), mr = P(0.24, 0.13, 0.16), tip = P(0.5, 0, 0.24);
      const mid = P(0.28, 0, 0.19);
      b.flatTri(base, ml, mid, [0, 0.6, 0.5], null, 2);
      b.flatTri(base, mid, mr, [0, 0.5, 0.6], null, 2);
      b.flatTri(ml, tip, mid, [0.6, 1, 0.5], null, 2);
      b.flatTri(mid, tip, mr, [0.5, 1, 0.6], null, 2);
    }
    // stamens (part 4)
    b.setPart(4);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      b.flatTri([dx * 0.02, 0.02, dz * 0.02], [dx * 0.02 - dz * 0.015, 0.02, dz * 0.02 + dx * 0.015], [dx * 0.2, 0.22, dz * 0.2], [0, 0, 1], null, 4);
    }
    centerDome(b, 0.05, 0.1, 5, 3);
    return b.build();
  },
  [ARCH.SUN]: () => {
    const b = new MeshBuilder(); addStemAndLeaves(b);
    petalFan(b, 18, { r0: 0.26, rmid: 0.4, r1: 0.5, w: 0.055, lift: 0.02, curl: 0.0 });
    petalFan(b, 18, { r0: 0.26, rmid: 0.38, r1: 0.47, w: 0.05, lift: 0.045, phase: Math.PI / 18, curl: 0.0 });
    b.setPart(3);
    // big domed centre with a ring
    const seg = 16;
    const top = b.vertex(0, 0.09, 0, 0, 1, 0, [1, 1, 1], 3, 1);
    const ring = [], outer = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; ring.push(b.vertex(Math.cos(a) * 0.17, 0.065, Math.sin(a) * 0.17, 0, 1, 0, [0.9, 0.9, 0.9], 3, 0.8)); }
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; outer.push(b.vertex(Math.cos(a) * 0.28, 0.02, Math.sin(a) * 0.28, 0, 1, 0, [0.7, 0.7, 0.7], 3, 0.4)); }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      b.tri(top, ring[j], ring[i]);
      b.tri(ring[i], ring[j], outer[j]); b.tri(ring[i], outer[j], outer[i]);
    }
    return b.build();
  },
  [ARCH.LOTUS]: () => {
    const b = new MeshBuilder();
    // lily pad (part 1), flat with a notch
    b.setPart(1);
    const seg = 18;
    const c = b.vertex(0, 0.02, 0, 0, 1, 0, [0.7, 0.95, 0.7], 1, 1);
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = 0.28 + (i / seg) * (Math.PI * 2 - 0.56);
      ring.push(b.vertex(Math.cos(a) * 1.2, 0.0, Math.sin(a) * 1.2, 0, 1, 0, [0.85, 1, 0.85], 1, 0.6));
    }
    for (let i = 0; i < seg; i++) b.tri(c, ring[i + 1], ring[i]);
    // outer and inner petals (part 2), lifted a little so the flower sits above the pad
    const petals = (n, r1, w, lift, y0, phase) => {
      b.setPart(2);
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
        const P = (r, side, y) => [dx * r + px * side, y0 + y, dz * r + pz * side];
        const base = P(0.06, 0, 0), ml = P(r1 * 0.55, -w, lift * 0.5), mr = P(r1 * 0.55, w, lift * 0.5), tip = P(r1, 0, lift);
        b.flatTri(base, ml, tip, [0, 0.7, 1], null, 2);
        b.flatTri(base, tip, mr, [0, 1, 0.7], null, 2);
      }
    };
    petals(8, 0.62, 0.15, 0.32, 0.04, 0);
    petals(6, 0.44, 0.13, 0.42, 0.1, 0.4);
    b.push().translate(0, 0.08, 0);
    centerDome(b, 0.1, 0.12, 6, 3);
    b.pop();
    return b.build();
  },
};

export function buildFlowerGeometry(arch) {
  return BUILDERS[arch]();
}

// -------------------------------------------------------------------------------------------------

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
attribute vec3 color;
attribute float aPart;
attribute float aShade;
attribute vec4 iP;   // x y z scale
attribute vec4 iQ;   // yaw phase specVariant state
uniform vec4 uSpec[32];      // headSize stemHeight nocturnal flags(1 glow, 2 padOnly)
uniform vec3 uPetal[160];
uniform vec3 uCenterCol[32];
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uArch;
uniform float uHeadRise;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vShade;
varying float vTrans;
varying float vGlow;
varying float vPetal;

vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c); }

void main(){
  vec3 base = iP.xyz;
  float sc = iP.w;
  float yaw = iQ.x;
  float phase = iQ.y;
  float sv = iQ.z;
  float state = iQ.w;
  int spec = int(floor(sv / 5.0 + 0.001));
  vec4 sp = uSpec[spec];
  float dist = distance(base, cameraPosition);
  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
  if (fade < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vN = vec3(0,1,0); vWorld = vec3(0.0); vShade = 0.0; vTrans = 0.0; vGlow = 0.0; vPetal = 0.0; return; }
  float k = sc * fade;
  float headSize = sp.x * k;
  float stemH = sp.y * k;
  float nocturnal = sp.z;
  bool glowF = mod(sp.w, 2.0) > 0.5;
  bool padOnly = sp.w > 1.5;
  float open = mix(1.0 - uNight * 0.92, 0.05 + uNight * 0.95, nocturnal);
  open *= 1.0 - 0.3 * uWet * (1.0 - nocturnal);
  open *= 1.0 - 0.45 * state;
  open = clamp(open + 0.06 * sin(phase * 9.0 + uTime * 0.6), 0.0, 1.0);

  vec3 lp = position;
  float part = aPart;
  vec3 wp;
  vec3 nrm = normal;
  float yFrac = 1.0;
  vec3 petalCol = uPetal[int(sv + 0.5)];
  vec3 centerCol = uCenterCol[spec];
  vec3 col;
  float trans = 0.0;

  if (part < 0.5) {
    // stem
    float thick = 0.028 * k + 0.004;
    wp = vec3(lp.x * thick, lp.y * stemH, lp.z * thick);
    yFrac = lp.y;
    col = vec3(0.13, 0.36, 0.12) * color * (0.8 + 0.35 * hash11(phase * 13.0));
    if (state > 0.5) col *= 0.85;
    trans = 0.25;
  } else if (part < 1.5) {
    // leaf: aShade holds the stem attachment fraction, position is in leaf length units
    float leafLen = (uArch > 7.5 ? 0.62 : 0.42) * k;
    vec3 rl = lp;
    float droop = state * 0.25;
    wp = vec3(rl.x * leafLen, aShade * stemH + rl.y * leafLen - droop * rl.x * leafLen, rl.z * leafLen);
    yFrac = aShade;
    col = vec3(0.14, 0.4, 0.13) * color * (0.85 + 0.3 * hash11(phase * 7.0 + lp.x));
    trans = 0.5;
    if (uArch > 7.5) { // lily pad rides the water
      wp.y = 0.0;
      col = vec3(0.1, 0.36, 0.14) * color * (0.75 + 0.35 * hash11(phase * 5.0));
    }
  } else {
    // head (petals 2, centre 3, accent 4)
    vec3 h = lp;
    float rho = length(h.xz);
    float closeAmt = 1.0 - open;
    if (part < 2.5 || part > 3.5) {
      float ang = closeAmt * 1.15 * min(rho / 0.5, 1.2);
      h.y += rho * sin(ang) * (uArch == 4.0 || uArch == 5.0 ? 0.0 : 1.0);
      float rr = rho * (uArch == 4.0 || uArch == 5.0 ? (1.0 - closeAmt * 0.5) : cos(ang));
      h.xz = rho > 0.0001 ? h.xz / rho * rr : h.xz;
      if (uArch == 3.0) h.y -= closeAmt * 0.1;
    }
    float hs = headSize;
    if (padOnly) hs = 0.0001;
    if (uArch > 7.5) { hs = padOnly ? 0.0001 : sp.x * k; }
    // orientation: sunflowers turn to face the sun, others tip slightly with phase
    float tilt = (phase - 0.5) * 0.5;
    if (uArch == 7.0) {
      float az = atan(uSunDirVis.x, uSunDirVis.z + 0.0001);
      float th = 1.35 - 0.35 * step(0.0, uSunDirVis.y);
      float c = cos(th), s = sin(th);
      h = vec3(h.x, h.y * c - h.z * s, h.y * s + h.z * c);
      h = rotY(h, az);
    } else {
      float c = cos(tilt), s = sin(tilt);
      h = vec3(h.x, h.y * c - h.z * s, h.y * s + h.z * c);
    }
    wp = h * hs;
    if (uArch < 7.5) wp.y += stemH;
    else wp.y += 0.02;
    yFrac = 1.0;
    if (part < 2.5) { col = petalCol * mix(0.62, 1.12, aShade); trans = 1.0; }
    else if (part < 3.5) { col = centerCol * mix(0.7, 1.15, aShade); trans = 0.2; }
    else { col = mix(centerCol, vec3(1.0, 0.85, 0.3), 0.6) * 1.1; trans = 0.3; }
    col = mix(col, vec3(dot(col, vec3(0.33))) * 0.9, state * 0.45);
  }

  // yaw about the plant axis
  wp = rotY(wp, yaw);
  nrm = rotY(nrm, yaw);
  vec3 world = base + wp;
  // wind and player push bend the stem, tips move most
  vec2 wnd = windField(base.xz) * stemH * 0.55;
  vec2 fromP = base.xz - uPlayerPos.xz;
  float pd = length(fromP);
  float pushK = smoothstep(3.5, 0.3, pd) * (1.0 - smoothstep(1.2, 8.0, uPlayerPos.y - base.y));
  if (uPerch.w > 0.5 && distance(base.xz, uPerch.xz) < 0.6) pushK = 0.0;
  vec2 push = normalize(fromP + 0.001) * pushK * stemH * 0.5;
  float sway = sin(uTime * 1.7 + phase * 6.2831) * 0.04 * stemH;
  vec2 off = (wnd + push + vec2(sway, sway * 0.6)) * (yFrac * yFrac);
  world.xz += off;
  world.y -= length(off) * 0.28 * yFrac * yFrac;
  vWorld = world;
  vN = normalize(nrm);
  vColor = col;
  vShade = mix(0.5, 1.0, aShade);
  if (part < 1.5) vShade = mix(0.55, 1.0, lp.y * (part < 0.5 ? 1.0 : 0.0) + (part > 0.5 ? 0.6 : 0.0));
  vTrans = trans;
  vGlow = (glowF ? 1.0 : 0.0) * (part > 1.5 && part < 3.5 ? 1.0 : 0.0) * open;
  vPetal = (part > 1.5 && part < 3.5 ? 1.0 : 0.0) * open;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vShade;
varying float vTrans;
varying float vGlow;
varying float vPetal;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float shadow = cloudShadow(vWorld);
  vec3 col = shadeSurface(vColor, N, vShade, vWorld, shadow);
  float back = pow(max(dot(-V, uSunDir), 0.0), 1.8);
  col += vColor * uSunColor * back * 0.6 * vTrans * shadow;
  col += vColor * vGlow * uNight * 1.25;
  col += vColor * vPetal * uFinale * 0.28;
  float pb = pulseBand(vWorld);
  col += (vColor * 1.2 + vec3(0.3, 0.5, 0.7)) * pb * 0.8;
  float mx = max(col.r, max(col.g, col.b));
  col *= min(1.0, 1.3 / max(mx, 0.001));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

let sharedUniforms = null;
function speciesUniforms() {
  if (sharedUniforms) return sharedUniforms;
  const spec = [], petal = [], center = [];
  for (let i = 0; i < 32; i++) spec.push(new THREE.Vector4(0.5, 0.6, 0, 0));
  for (let i = 0; i < 160; i++) petal.push(new THREE.Vector3(1, 1, 1));
  for (let i = 0; i < 32; i++) center.push(new THREE.Vector3(1, 0.8, 0.2));
  FLOWERS.forEach((f, i) => {
    const size = (f.size[0] + f.size[1]) / 2, stem = (f.stem[0] + f.stem[1]) / 2;
    // spike and bell heads are modelled taller than wide
    spec[i].set(size, stem, f.nocturnal ? 1 : 0, (f.glow ? 1 : 0) + (f.padOnly ? 2 : 0));
    for (let v = 0; v < VARIANTS; v++) {
      const hex = f.petals[v % f.petals.length];
      const c = hexToLinear(hex);
      petal[i * VARIANTS + v].set(c[0], c[1], c[2]);
    }
    const cc = hexToLinear(f.center);
    center[i].set(cc[0], cc[1], cc[2]);
  });
  sharedUniforms = { uSpec: { value: spec }, uPetal: { value: petal }, uCenterCol: { value: center } };
  return sharedUniforms;
}

export function makeFlowerMaterial(arch) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      ...G,
      ...speciesUniforms(),
      uFadeStart: { value: 90 },
      uFadeEnd: { value: 135 },
      uArch: { value: arch },
    },
  });
}
