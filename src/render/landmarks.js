// Twelve hand built places. Each is generated from primitives into world space geometry.
import * as THREE from 'three';
import { MeshBuilder, shapeNoise } from './meshbuilder.js';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from './shaders.js';
import { blob, trunk, branch, makeTreeMaterial } from './trees.js';
import { buildMushroom, makePropMaterial } from './props.js';
import { hexToLinear, mulberry32, TAU, clamp, smoothstep } from '../core/util.js';

const lin = (h, m = 1) => hexToLinear(h).map((v) => v * m);

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
attribute vec3 color;
attribute float aPart;
attribute float aShade;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vPart;
varying float vShade;
void main(){
  vec3 p = position;
  if (aPart > 2.5 && aPart < 3.5) { // cloth and flags flutter
    float k = aShade;
    p.x += sin(uTime * 3.1 + p.x * 0.9 + p.z * 0.7) * 0.22 * k;
    p.y += sin(uTime * 2.3 + p.z * 1.1) * 0.12 * k;
    p.z += cos(uTime * 2.7 + p.x * 0.8) * 0.2 * k;
  }
  vec4 wp4 = modelMatrix * vec4(p, 1.0);
  vWorld = wp4.xyz; vN = normalize(mat3(modelMatrix) * normal); vColor = color; vPart = aPart; vShade = aShade;
  gl_Position = projectionMatrix * viewMatrix * wp4;
}
`;
const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vPart;
varying float vShade;
uniform float uEmis;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col;
  float shadow = cloudShadow(vWorld);
  if (vPart > 0.5 && vPart < 1.5) { // emissive lantern or crystal
    col = vColor * (0.55 + 1.6 * uNight + 0.5 * uEmis) + shadeSurface(vColor, N, 0.8, vWorld, shadow) * 0.5;
  } else if (vPart > 1.5 && vPart < 2.5) { // moon well water
    vec2 p = vWorld.xz;
    float r1 = nz(p * 0.5 + uTime * 0.03).g, r2 = nz(p * 1.3 - uTime * 0.04).b;
    float glint = pow(r1 * r2, 1.5) * 3.0;
    col = vColor * (0.5 + 1.4 * uNight) + vec3(0.6, 0.8, 1.0) * glint * (0.3 + uNight);
    col += vec3(0.5, 0.7, 1.0) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.6;
  } else {
    float ao = mix(0.55, 1.0, vShade);
    col = shadeSurface(vColor, N, ao, vWorld, shadow);
    if (vPart > 2.5) col += vColor * uSunColor * pow(max(dot(-V, uSunDir), 0.0), 2.0) * 0.4;
  }
  col += vec3(0.4, 0.75, 1.0) * pulseBand(vWorld) * 0.3;
  float mx = max(col.r, max(col.g, col.b));
  col *= min(1.0, 3.0 / max(mx, 0.001));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

function landmarkMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, uniforms: { ...G, uEmis: { value: 0 } } });
}

// The sundial keeps real time: the gnomon casts a soft shadow on the dial that follows the sun in the sky.
// A quad covers the dial and the fragment shader works out where the plate's shadow falls.
const DIAL_VERT = /* glsl */ `
uniform vec3 uCenter;
varying vec3 vWorld;
void main(){
  vWorld = uCenter + vec3(position.x, 0.0, position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
const DIAL_FRAG = /* glsl */ `
${GLSL_UNIFORMS}
uniform vec3 uCenter;
varying vec3 vWorld;
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c){
  vec2 e0 = b - a, e1 = c - b, e2 = a - c;
  vec2 v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void main(){
  vec3 s = normalize(uSunDirVis);
  float up = smoothstep(0.03, 0.16, s.y);
  if (up <= 0.0) discard;
  vec2 p = vWorld.xz - uCenter.xz;
  float r = length(p);
  if (r > 2.72) discard;
  // gnomon plate: south foot, north foot and the tip that stands 2.36 above the dial
  vec2 A = vec2(0.0, 0.6), B = vec2(0.0, -2.0);
  vec2 T = B - s.xz / max(s.y, 0.04) * 2.36;
  float len = length(T - A);
  float along = clamp(dot(p - A, T - A) / max(dot(T - A, T - A), 0.001), 0.0, 1.0);
  float soft = 0.03 + 0.05 * along;
  float tri = 1.0 - smoothstep(-soft, soft, sdTri(p, A, B, T));
  float line = 1.0 - smoothstep(0.0, soft * 1.4, sdSeg(p, A, T) - mix(0.13, 0.06, along));
  float m = max(tri * 0.85, line);
  float cloud = 1.0 - 0.8 * smoothstep(0.45, 0.95, uCloudCover);
  float a = m * up * cloud * 0.5 * (1.0 - smoothstep(2.5, 2.72, r));
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.03, 0.035, 0.06, a);
}
`;

const STONE = [lin('#b8b2a6'), lin('#a29c92'), lin('#8e8a82')];
const stone = (i = 0, m = 1) => STONE[i % 3].map((v) => v * m);

export class Landmarks {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.colliders = [];
    this.anim = [];
    this.material = landmarkMaterial();
    this.discoverList = world.landmarks.map((l) => ({ id: l.id, x: l.x, z: l.z, y: l.y, r: l.radius, name: l.name }));
    this.mist = null;
    this.emitters = []; // {x,y,z,kind}
    for (const lm of world.landmarks) this._build(lm);
  }

  _addMesh(b, opts = {}) {
    const g = b.build();
    const m = new THREE.Mesh(g, opts.material || this.material);
    m.frustumCulled = false;
    m.renderOrder = opts.order || 4;
    this.group.add(m);
    return m;
  }

  _col(x, z, r, y, h) { this.colliders.push({ x, z, r, y, h }); }

  _build(lm) {
    const fn = this['_' + lm.kind];
    if (fn) fn.call(this, lm);
  }

  _giantTree(lm, kind = 1, big = 1) {
    const w = this.world;
    const K = kind === 1 ? 2.3 : 1.7;
    const b = new MeshBuilder();
    b.push().translate(lm.x, lm.y - 0.3, lm.z).scale(K);
    // textured trunk with a wide flare, buttress roots and big limbs
    trunk(b, { r0: 6.2, r1: 1.7, h: 28, seg: 10, rings: 6, moss: 0.35, vTile: 5, seed: kind * 7 + 3, taperRoots: true });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.3;
      branch(b, Math.cos(a) * 3.4, 1.1, Math.sin(a) * 3.4, -a, 1.72, 7.6, 1.5);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.5;
      branch(b, 0, 22 + (i % 3) * 1.6, 0, a, 0.7 + (i % 2) * 0.25, 9 + (i % 3) * 2.5, 0.8);
    }
    b.pop();
    const g1 = b.build();
    const trunkMesh = new THREE.Mesh(g1, makeTreeMaterial(kind, 0));
    // canopy built separately so it can use the tree shader with a large scale
    const cb = new MeshBuilder();
    cb.push().translate(lm.x, lm.y - 0.3, lm.z).scale(K);
    const rnd = mulberry32(kind * 991 + 7);
    const P = [[0, 33, 0, 12.5]];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + rnd() * 0.5; const d = 12 + rnd() * 6; P.push([Math.cos(a) * d, 26 + rnd() * 8, Math.sin(a) * d, 7 + rnd() * 3.5]); }
    for (let i = 0; i < 5; i++) { const a = rnd() * TAU; const d = rnd() * 7; P.push([Math.cos(a) * d, 40 + rnd() * 6, Math.sin(a) * d, 6 + rnd() * 3]); }
    P.forEach(([x, y, z, r], i) => blob(cb, x, y, z, r, { detail: 1, squash: kind === 1 ? 0.78 : 0.85, seed: 40 + i, mixv: (i % 5) / 5 }));
    cb.pop();
    // merge trunk and canopy into one geometry with the tree shader
    const merged = mergeGeos([g1, cb.build()]);
    const mat = makeTreeMaterial(kind, 0);
    mat.uniforms.uTreeH.value = 44 * K;
    mat.uniforms.uSway.value = 0.5;
    if (kind === 1) mat.uniforms.uBlossom.value = 1.3;
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = merged.index;
    for (const n of ['position', 'normal', 'color', 'aPart']) ig.setAttribute(n, merged.getAttribute(n));
    ig.setAttribute('iP', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, 1]), 4));
    ig.setAttribute('iQ', new THREE.InstancedBufferAttribute(new Float32Array([0, 0.5, kind === 1 ? 1 : 0, 0]), 4));
    ig.instanceCount = 1;
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 4;
    mat.uniforms.uFadeEnd.value = 9000;
    this.group.add(mesh);
    this._col(lm.x, lm.z, 6.0 * K, lm.y - 1, 26 * K);
    this.emitters.push({ x: lm.x, y: lm.y + 30 * K, z: lm.z, kind: kind === 1 ? 'blossom' : 'leaves', r: 26 * K, id: lm.id });
    if (kind === 1) this._beacon(lm.x, lm.y + 44 * K, lm.z);
  }

  // a faint pillar of light above the Heartbloom so the island always has a focal point
  _beacon(x, y, z) {
    const g = new THREE.CylinderGeometry(9, 22, 420, 20, 1, true);
    g.translate(0, 210, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...G }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vP; varying float vH; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; vH = position.y / 420.0; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uNight; varying vec3 vN; varying vec3 vP; varying float vH; void main(){ vec3 V = normalize(cameraPosition - vP); float e = pow(clamp(abs(dot(normalize(vN), V)), 0.0, 1.0), 2.2); float a = e * pow(clamp(1.0 - vH, 0.0, 1.0), 1.6) * (0.035 + 0.3 * uNight); gl_FragColor = vec4(vec3(1.0, 0.72, 0.85) * a * 2.0, a); }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false; mesh.renderOrder = 24;
    this.group.add(mesh);
  }

  _giantTreeHeart(lm) { this._giantTree(lm, 1); }
  _giantMaple(lm) { this._giantTree(lm, 4); }
  _giantTree_(lm) { this._giantTree(lm, 1); }

  _windmill(lm) {
    const b = new MeshBuilder();
    const y = lm.y;
    b.push().translate(lm.x, y - 0.2, lm.z);
    b.cylinder({ r0: 4.2, r1: 3.8, h: 1.3, seg: 12, c0: stone(2, 0.8), c1: stone(1, 0.85), part: 0, smooth: false });
    b.cylinder({ r0: 3.6, r1: 2.5, h: 9.2, y0: 1.2, seg: 12, c0: [0.86, 0.82, 0.74], c1: [0.93, 0.9, 0.82], part: 0, smooth: false });
    // wooden band and balcony
    b.cylinder({ r0: 3.05, r1: 3.05, h: 0.28, y0: 6.0, seg: 12, c0: lin('#6b4a2f'), c1: lin('#6b4a2f'), part: 0, smooth: false });
    b.cylinder({ r0: 3.4, r1: 3.4, h: 0.18, y0: 5.6, seg: 12, c0: lin('#7a5836'), c1: lin('#7a5836'), part: 0, smooth: false, capTop: true });
    // roof
    b.cone({ r: 3.1, h: 3.6, y0: 10.2, seg: 12, c0: lin('#8a3f2a'), c1: lin('#a64d34'), part: 0, smooth: false, capBottom: true });
    // door and windows
    b.push().translate(0, 1.2, 3.55).box({ w: 1.4, h: 2.4, d: 0.3, c0: lin('#4a3220'), c1: lin('#5a3f28'), part: 0 }); b.pop();
    for (const a of [0.9, 2.4, 4.2]) { b.push().translate(Math.cos(a) * 2.9, 6.9, Math.sin(a) * 2.9).rotY(-a + Math.PI / 2).box({ w: 0.7, h: 1.1, d: 0.25, c0: lin('#2a2f3a'), c1: lin('#3a4a60'), part: 1 }); b.pop(); }
    b.pop();
    this._addMesh(b);
    // blades hub on the wind-facing side (+z)
    const bb = new MeshBuilder();
    const cloth = [0.95, 0.9, 0.78], wood = lin('#6b4a2f');
    for (let i = 0; i < 4; i++) {
      bb.push().rotZ((i / 4) * TAU);
      bb.box({ w: 0.32, h: 10.6, d: 0.24, y0: 0.6, c0: wood, c1: wood, part: 0 });
      // sail cloth on one side, a lattice look with cross bars
      bb.push().translate(0.75, 0, 0.16);
      bb.box({ w: 1.3, h: 8.0, d: 0.06, y0: 2.2, c0: cloth, c1: cloth, part: 3, shade0: 0.5, shade1: 0.9 });
      for (let k = 0; k < 6; k++) bb.box({ w: 1.3, h: 0.1, d: 0.1, y0: 2.6 + k * 1.3, c0: wood, c1: wood, part: 0 });
      bb.pop();
      bb.pop();
    }
    bb.push().translate(0, 0, -0.2); bb.sphere({ r: 0.7, detail: 1, part: 0, flat: true, color: wood }); bb.pop();
    const blades = this._addMesh(bb);
    blades.position.set(lm.x, lm.y + 8.6, lm.z + 3.9);
    this.anim.push((dt, t) => { blades.rotation.z = -t * 0.55; });
    this._col(lm.x, lm.z, 4.0, lm.y - 1, 14);
    this.emitters.push({ x: lm.x, y: lm.y + 4, z: lm.z, kind: 'meadow', r: 40, id: lm.id });
  }

  _arch(lm) {
    const b = new MeshBuilder();
    const y = lm.y;
    b.push().translate(lm.x, y - 0.1, lm.z);
    // steps
    for (let i = 0; i < 3; i++) b.box({ w: 11 - i * 1.3, h: 0.36, d: 4.4 - i * 0.6, y0: i * 0.36, c0: stone(2, 0.85), c1: stone(1, 0.95), part: 0 });
    b.push().translate(0, 1.0, 0);
    for (const s of [-1, 1]) {
      b.push().translate(s * 3.7, 0, 0);
      b.box({ w: 1.7, h: 7.6, d: 1.7, c0: stone(1, 0.9), c1: stone(0, 1), part: 0 });
      b.box({ w: 2.1, h: 0.6, d: 2.1, y0: 7.6, c0: stone(0, 1.05), c1: stone(0, 1.05), part: 0 });
      b.pop();
    }
    b.push().translate(0, 7.6, 0).rotX(-Math.PI / 2);
    b.torus({ R: 3.7, r: 0.78, seg: 18, tube: 6, arc: Math.PI, color: stone(0, 1), part: 0, shade0: 0.4, shade1: 1 });
    b.pop();
    b.push().translate(0, 11.05, 0); b.box({ w: 1.5, h: 1.15, d: 1.6, c0: stone(0, 1.1), c1: stone(0, 1.1), part: 0 }); b.pop();
    // hanging lanterns along the arch
    const cols = [lin('#ff9a3c'), lin('#ff6f9a'), lin('#ffd25a'), lin('#ff8a5a')];
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (0.06 + 0.88 * (i / 10));
      const cx = Math.cos(a) * 3.7, cy = 7.6 + Math.sin(a) * 3.7 - 0.9;
      b.push().translate(cx, cy, 0.0);
      b.cylinder({ r0: 0.02, r1: 0.02, h: 0.9, y0: 0, seg: 3, c0: [0.1, 0.08, 0.06], c1: [0.1, 0.08, 0.06], part: 0, smooth: false });
      b.push().translate(0, -0.55, 0);
      b.sphere({ r: 0.34, detail: 1, part: 1, flat: true, squashY: 1.25, color: cols[i % 4], shadeBottom: 0.5, shadeTop: 1 });
      b.pop();
      b.pop();
    }
    b.pop();
    // stone lanterns either side
    for (const s of [-1, 1]) {
      b.push().translate(s * 7.4, 0, 1.5);
      b.cylinder({ r0: 0.5, r1: 0.35, h: 2.0, seg: 6, c0: stone(1), c1: stone(0), part: 0, smooth: false });
      b.box({ w: 1.5, h: 0.9, d: 1.5, y0: 2.0, c0: stone(0), c1: stone(0), part: 0 });
      b.box({ w: 0.9, h: 0.7, d: 0.9, y0: 2.1, c0: lin('#ffc46a'), c1: lin('#ffd98a'), part: 1 });
      b.cone({ r: 1.3, h: 0.9, seg: 4, y0: 2.9, c0: stone(1), c1: stone(0), part: 0, smooth: false });
      b.pop();
    }
    b.pop();
    this._addMesh(b);
    this._col(lm.x - 3.7, lm.z, 1.0, lm.y - 1, 9); this._col(lm.x + 3.7, lm.z, 1.0, lm.y - 1, 9);
    this.emitters.push({ x: lm.x, y: lm.y + 6, z: lm.z, kind: 'blossom', r: 30, id: lm.id });
  }

  _sundial(lm) {
    const b = new MeshBuilder();
    const y = lm.y;
    b.push().translate(lm.x, y - 0.1, lm.z);
    b.cylinder({ r0: 3.6, r1: 3.4, h: 0.5, seg: 16, c0: stone(1, 0.9), c1: stone(0, 1), part: 0, smooth: false, capTop: true });
    b.cylinder({ r0: 2.7, r1: 2.7, h: 0.08, y0: 0.5, seg: 16, c0: stone(0, 1.05), c1: stone(0, 1.1), part: 0, smooth: false, capTop: true });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      b.push().translate(Math.cos(a) * 2.35, 0.6, Math.sin(a) * 2.35).rotY(-a);
      b.box({ w: 0.42, h: 0.05, d: 0.14, c0: lin('#ffd98a'), c1: lin('#ffd98a'), part: 1 });
      b.pop();
    }
    // gnomon pointing north (minus z), tilted like a real dial
    b.push().translate(0, 0.55, 0.6).rotX(0);
    b.flatTri([0, 0, 0], [0, 0, -2.6], [0, 2.4, -2.6], [0.2, 0.2, 1], [stone(0, 1.1), stone(0, 1.1), stone(0, 1.1)], 0);
    b.flatTri([0.001, 0, 0], [0.001, 2.4, -2.6], [0.001, 0, -2.6], [0.2, 1, 0.2], [stone(0, 1.1), stone(0, 1.1), stone(0, 1.1)], 0);
    b.push().translate(0, 0, -1.3); // the beam sits under the plate, foot to tip
    b.box({ w: 0.24, h: 0.24, d: 2.6, y0: 0.0, c0: stone(0), c1: stone(0), part: 0 });
    b.pop();
    b.pop();
    // standing stones
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.2;
      const R = 10.5;
      const h = 3.6 + ((i * 7) % 5) * 0.4;
      b.push().translate(Math.cos(a) * R, 0, Math.sin(a) * R).rotY(-a + Math.PI / 2).rotZ(((i * 13) % 7 - 3) * 0.012);
      b.box({ w: 1.7, h, d: 0.95, c0: stone(2, 0.85), c1: stone(0, 1), part: 0, shade0: 0.5, shade1: 1 });
      b.box({ w: 1.5, h: 0.28, d: 0.85, y0: h, c0: stone(0), c1: stone(0), part: 0 });
      for (let k = 0; k < 3; k++) b.push().translate(0, h * (0.35 + k * 0.2), 0.5).box({ w: 0.9 - k * 0.2, h: 0.09, d: 0.05, c0: lin('#8fd0ff'), c1: lin('#8fd0ff'), part: 1 }).pop();
      b.pop();
      this._col(lm.x + Math.cos(a) * R, lm.z + Math.sin(a) * R, 1.0, lm.y - 1, h + 0.3);
    }
    b.pop();
    this._addMesh(b);
    // the gnomon's live shadow (dial top sits 0.48 above the landmark height)
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([-3.2, 0, -3.2, 3.2, 0, -3.2, 3.2, 0, 3.2, -3.2, 0, 3.2], 3));
    sg.setIndex([0, 2, 1, 0, 3, 2]);
    const smat = new THREE.ShaderMaterial({
      vertexShader: DIAL_VERT, fragmentShader: DIAL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { ...G, uCenter: { value: new THREE.Vector3(lm.x, lm.y + 0.485, lm.z) } },
    });
    const shadow = new THREE.Mesh(sg, smat);
    shadow.frustumCulled = false;
    shadow.renderOrder = 5;
    this.group.add(shadow);
    this.emitters.push({ x: lm.x, y: lm.y + 3, z: lm.z, kind: 'meadow', r: 35, id: lm.id });
  }

  _pavilion(lm) {
    const w = this.world;
    const dx = lm.lakeCenter.x - lm.x, dz = lm.lakeCenter.z - lm.z;
    const dl = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    const deckY = lm.baseH + 0.15;
    const b = new MeshBuilder();
    b.push().translate(lm.x, 0, lm.z).rotY(ang);
    const wood = lin('#8a6238'), wood2 = lin('#6f4c2a'), thatch = lin('#c9a25a');
    // pier along +z (toward the lake)
    const L = 17;
    for (let i = 0; i < 28; i++) {
      b.push().translate(0, deckY, -3 + (i / 27) * (L + 3));
      b.box({ w: 2.5, h: 0.14, d: 0.5, c0: i % 2 ? wood : wood2, c1: i % 2 ? wood : wood2, part: 0 });
      b.pop();
    }
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
      const z = 1 + i * 3.2;
      const ground = Math.min(w.heightAt(lm.x + Math.sin(ang) * z + Math.cos(ang) * s * 1.1, lm.z + Math.cos(ang) * z - Math.sin(ang) * s * 1.1), deckY - 0.2);
      b.push().translate(s * 1.1, ground - 0.4, z);
      b.cylinder({ r0: 0.14, r1: 0.12, h: deckY - ground + 0.6, seg: 5, c0: wood2, c1: wood, part: 0, smooth: false });
      b.pop();
    }
    // pavilion at the end
    b.push().translate(0, deckY, L);
    b.box({ w: 6.6, h: 0.18, d: 6.6, c0: wood2, c1: wood, part: 0 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.push().translate(sx * 2.9, 0.1, sz * 2.9);
      b.cylinder({ r0: 0.17, r1: 0.15, h: 3.8, seg: 6, c0: wood2, c1: wood, part: 0, smooth: false });
      b.pop();
    }
    b.push().translate(0, 3.8, 0);
    b.cone({ r: 5.6, h: 2.8, seg: 4, c0: lin('#b98b45'), c1: thatch, part: 0, smooth: false, capBottom: true });
    b.pop();
    // rails
    for (const s of [-1, 1]) { b.push().translate(s * 2.9, 0.95, 0).box({ w: 0.1, h: 0.1, d: 5.8, c0: wood, c1: wood, part: 0 }).pop(); b.push().translate(0, 0.95, s * 2.9).box({ w: 5.8, h: 0.1, d: 0.1, c0: wood, c1: wood, part: 0 }).pop(); }
    // hanging lantern
    b.push().translate(0, 3.1, 0);
    b.cylinder({ r0: 0.02, r1: 0.02, h: 0.7, y0: 0, seg: 3, c0: [0.1, 0.1, 0.1], c1: [0.1, 0.1, 0.1], part: 0 });
    b.push().translate(0, -0.3, 0); b.sphere({ r: 0.4, detail: 1, part: 1, flat: true, squashY: 1.2, color: lin('#ffc46a') }); b.pop();
    b.pop();
    b.pop();
    b.pop();
    this._addMesh(b);
    this.pavilionTip = { x: lm.x + Math.sin(ang) * L, z: lm.z + Math.cos(ang) * L, y: deckY };
    this.emitters.push({ x: lm.x + Math.sin(ang) * L, y: deckY + 3, z: lm.z + Math.cos(ang) * L, kind: 'meadow', r: 30, id: lm.id });
  }

  _mushrooms(lm) {
    const rnd = mulberry32(555);
    const geo = buildMushroom();
    const N = 22;
    const arr = new Float32Array(N * 8);
    for (let i = 0; i < N; i++) {
      const a = rnd() * TAU, d = 5 + Math.pow(rnd(), 0.8) * 34;
      const x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d;
      const y = this.world.heightAt(x, z);
      const sc = i < 3 ? 12 + rnd() * 4 : 3.5 + rnd() * 7;
      const variant = i % 3 === 0 ? 3 : i % 3 === 1 ? 4 : 3;
      const o = i * 8;
      arr[o] = x; arr[o + 1] = y - 0.1; arr[o + 2] = z; arr[o + 3] = sc; arr[o + 4] = rnd() * TAU; arr[o + 5] = rnd(); arr[o + 6] = variant; arr[o + 7] = 0;
      if (sc > 6) this._col(x, z, 0.09 * sc + 0.35, y - 1, 0.32 * sc);
    }
    const ibuf = new THREE.InstancedInterleavedBuffer(arr, 8, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = geo.index;
    for (const n of ['position', 'normal', 'color', 'aPart', 'aShade']) g.setAttribute(n, geo.getAttribute(n));
    g.setAttribute('iP', new THREE.InterleavedBufferAttribute(ibuf, 4, 0));
    g.setAttribute('iQ', new THREE.InterleavedBufferAttribute(ibuf, 4, 4));
    g.instanceCount = N;
    const mat = makePropMaterial('mushroom', { height: 0.5, wind: 0.0, trans: 0.3, glowMask: 8 + 16, fadeStart: 900, fadeEnd: 1400 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 4;
    this.group.add(mesh);
    this.emitters.push({ x: lm.x, y: lm.y + 3, z: lm.z, kind: 'glow', r: 46, id: lm.id });
  }

  _falls(lm) {
    const f = this.world.falls;
    const b = new MeshBuilder();
    const px = f.base.x + f.dir.x * 20, pz = f.base.z + f.dir.z * 20;
    // stepping stones and a small shrine of stacked cairns at the pool edge
    const rnd = mulberry32(31);
    for (let i = 0; i < 5; i++) {
      const a = rnd() * TAU, d = 30 + rnd() * 10;
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const y = this.world.heightAt(x, z);
      if (this.world.waterLevelAt(x, z) !== null) continue;
      b.push().translate(x, y - 0.2, z);
      for (let k = 0; k < 4; k++) { b.push().translate(0, k * 0.5, 0); b.sphere({ r: 0.75 - k * 0.14, detail: 1, part: 0, flat: true, squashY: 0.55, color: stone(k), shadeBottom: 0.4, shadeTop: 1, displace: (a, c, d) => 0.85 + 0.25 * shapeNoise(k + i)(a, c, d) }); b.pop(); }
      b.pop();
    }
    // dark wet boulders framing the chute and the landing
    {
      const px = -f.dir.z, pz = f.dir.x;
      const rr = mulberry32(77);
      for (let i = 0; i < 22; i++) {
        const t = 0.14 + rr() * 0.6, side = rr() < 0.5 ? -1 : 1;
        const half = f.width * (0.8 + 0.5 * t) * 0.5;
        const off = side * (half + 1.2 + rr() * 6);
        const x = f.top.x + (f.base.x - f.top.x) * t + px * off, z = f.top.z + (f.base.z - f.top.z) * t + pz * off;
        if (this.world.waterLevelAt(x, z) !== null) continue;
        const y = this.world.heightAt(x, z);
        const r = 1.1 + rr() * 2.2;
        b.push().translate(x, y - r * 0.28, z).rotY(rr() * TAU);
        b.sphere({ r, detail: 1, part: 0, flat: true, squashY: 0.68, color: stone(Math.floor(rr() * 3), 0.6), shadeBottom: 0.35, shadeTop: 1, displace: (a, c, d) => 0.82 + 0.3 * shapeNoise(i + 3)(a, c, d) });
        b.pop();
      }
    }
    this._addMesh(b);
    this.mist = { x: f.base.x + f.dir.x * 8, z: f.base.z + f.dir.z * 8, y: this.world.heightAt(f.base.x + f.dir.x * 8, f.base.z + f.dir.z * 8) + 1, r: 40 };
  }

  _shrine(lm) {
    const b = new MeshBuilder();
    b.push().translate(lm.x, lm.y - 0.2, lm.z);
    for (let i = 0; i < 3; i++) b.box({ w: 6.4 - i * 1.4, h: 0.4, d: 6.4 - i * 1.4, y0: i * 0.4, c0: stone(2, 0.9), c1: stone(1, 1), part: 0 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { b.push().translate(sx * 1.4, 1.2, sz * 1.4); b.box({ w: 0.42, h: 3.0, d: 0.42, c0: stone(1), c1: stone(0), part: 0 }); b.pop(); }
    b.push().translate(0, 4.2, 0); b.cone({ r: 2.9, h: 1.7, seg: 4, c0: lin('#5a6d8a'), c1: lin('#7d93b3'), part: 0, smooth: false, capBottom: true }); b.pop();
    b.push().translate(0, 2.4, 0); b.sphere({ r: 0.55, detail: 1, part: 1, flat: true, color: lin('#9fe8ff'), shadeBottom: 0.7, shadeTop: 1 }); b.pop();
    // pole with prayer flags
    b.push().translate(3.6, 0.8, 0); b.cylinder({ r0: 0.07, r1: 0.05, h: 5.2, seg: 4, c0: lin('#6b4a2f'), c1: lin('#6b4a2f'), part: 0, smooth: false }); b.pop();
    const fc = [lin('#5b9bff'), lin('#ffffff'), lin('#ff5a4a'), lin('#4ac96b'), lin('#ffd23a')];
    for (let i = 0; i < 5; i++) {
      const t0 = i / 5, t1 = (i + 0.9) / 5;
      const ax = 3.6 - 3.6 * t0, ay = 5.8 - 0.4 * Math.sin(t0 * Math.PI) - 4.2 * 0, bx = 3.6 - 3.6 * t1;
      b.flatQuad([ax, 5.5, 0.03], [bx, 5.5, 0.03], [bx, 4.8, 0.03], [ax, 4.8, 0.03], [0.2, 0.2, 1, 1], [fc[i], fc[i], fc[i], fc[i]], 3);
    }
    b.pop();
    this._addMesh(b);
    this._col(lm.x, lm.z, 2.6, lm.y - 1, 6);
    // crystal that bobs and spins
    const cb = new MeshBuilder();
    cb.sphere({ r: 0.55, detail: 0, part: 1, flat: true, color: lin('#9fe8ff'), squashY: 1.6, shadeBottom: 0.6, shadeTop: 1 });
    const crystal = this._addMesh(cb);
    this.anim.push((dt, t) => { crystal.position.set(lm.x, lm.y + 5.4 + Math.sin(t * 1.3) * 0.25, lm.z); crystal.rotation.y = t * 0.8; });
    this.emitters.push({ x: lm.x, y: lm.y + 5, z: lm.z, kind: 'spark', r: 40, id: lm.id });
  }

  _well(lm) {
    const b = new MeshBuilder();
    b.push().translate(lm.x, lm.y - 0.1, lm.z);
    b.cylinder({ r0: 3.0, r1: 2.7, h: 1.2, seg: 16, c0: stone(1, 0.85), c1: stone(0, 1), part: 0, smooth: false });
    b.push().translate(0, 1.15, 0); b.torus({ R: 2.55, r: 0.28, seg: 20, tube: 5, color: stone(0, 1.1), part: 0 }); b.pop();
    b.disc(2.35, 0.95, 20, lin('#a9c8ff'), true, 2, 1);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      b.push().translate(Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6);
      b.box({ w: 0.7, h: 4.6, d: 0.7, c0: stone(2, 0.9), c1: stone(0, 1), part: 0 });
      b.push().translate(0, 4.6, 0); b.sphere({ r: 0.33, detail: 1, part: 1, flat: true, color: lin('#9fd0ff') }); b.pop();
      b.pop();
      this._col(lm.x + Math.cos(a) * 3.6, lm.z + Math.sin(a) * 3.6, 0.5, lm.y - 1, 5);
    }
    b.pop();
    this._addMesh(b);
    this._col(lm.x, lm.z, 3.1, lm.y - 1, 1.4);
    const cb = new MeshBuilder();
    cb.sphere({ r: 0.7, detail: 0, part: 1, flat: true, color: lin('#cfe4ff'), squashY: 1.5, shadeBottom: 0.6, shadeTop: 1 });
    const crystal = this._addMesh(cb);
    this.anim.push((dt, t) => { crystal.position.set(lm.x, lm.y + 3.2 + Math.sin(t * 1.1) * 0.3, lm.z); crystal.rotation.y = t * 0.6; });
    this.emitters.push({ x: lm.x, y: lm.y + 3, z: lm.z, kind: 'moon', r: 40, id: lm.id });
  }

  _lighthouse(lm) {
    const b = new MeshBuilder();
    b.push().translate(lm.x, lm.y - 0.3, lm.z);
    b.cylinder({ r0: 4.6, r1: 4.2, h: 1.6, seg: 14, c0: stone(2, 0.85), c1: stone(1, 0.95), part: 0, smooth: false });
    const bands = 6, H = 19;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands, t1 = (i + 1) / bands;
      const red = i % 2 === 0;
      b.cylinder({ r0: 3.7 - 1.5 * t0, r1: 3.7 - 1.5 * t1, h: H / bands, y0: 1.5 + (H / bands) * i, seg: 14, c0: red ? lin('#c8382e') : lin('#f2eee6'), c1: red ? lin('#d9483a') : lin('#ffffff'), part: 0, smooth: false });
    }
    b.push().translate(0, 1.5 + H, 0);
    b.cylinder({ r0: 3.0, r1: 3.0, h: 0.4, seg: 14, c0: lin('#2a2f3a'), c1: lin('#3a4048'), part: 0, smooth: false, capTop: true });
    b.cylinder({ r0: 1.7, r1: 1.7, h: 2.4, y0: 0.4, seg: 10, c0: lin('#ffe8a0'), c1: lin('#fff0b8'), part: 1, smooth: false });
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; b.push().translate(Math.cos(a) * 1.75, 0.4, Math.sin(a) * 1.75); b.box({ w: 0.12, h: 2.4, d: 0.12, c0: lin('#2a2f3a'), c1: lin('#2a2f3a'), part: 0 }); b.pop(); }
    b.cone({ r: 2.3, h: 1.9, y0: 2.8, seg: 10, c0: lin('#b83a30'), c1: lin('#d9483a'), part: 0, smooth: false, capBottom: true });
    b.pop();
    b.pop();
    this._addMesh(b);
    this._col(lm.x, lm.z, 4.6, lm.y - 1, 22);
    // rotating beam
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { ...G }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uNight; varying vec2 vUv; void main(){ float along = vUv.x; float across = 1.0 - abs(vUv.y - 0.5) * 2.0; float a = pow(max(across, 0.0), 2.5) * (1.0 - clamp(along, 0.0, 1.0)) * (0.10 + 0.5 * uNight) ; gl_FragColor = vec4(vec3(1.0, 0.9, 0.62) * a * 2.0, a); }`,
    }));
    beam.frustumCulled = false; beam.renderOrder = 25;
    beam.scale.set(260, 14, 1);
    const pivot = new THREE.Group();
    pivot.position.set(lm.x, lm.y + 1.5 + 19 + 1.6, lm.z);
    beam.position.set(130, 0, 0);
    beam.rotation.x = 0;
    const flat = new THREE.Group(); flat.rotation.x = -Math.PI / 2; flat.add(beam);
    pivot.add(flat);
    // second beam opposite
    const beam2 = beam.clone(); beam2.position.set(-130, 0, 0); beam2.rotation.z = Math.PI; flat.add(beam2);
    this.group.add(pivot);
    this.anim.push((dt, t) => { pivot.rotation.y = t * 0.55; });
    this.emitters.push({ x: lm.x, y: lm.y + 10, z: lm.z, kind: 'sea', r: 60, id: lm.id });
  }

  _seaarch(lm) {
    const b = new MeshBuilder();
    const y0 = this.world.heightAt(lm.x, lm.z);
    const rockCol = [lin('#8a857c'), lin('#7a766f'), lin('#6c6862')];
    const ang = Math.atan2(lm.z + 30, lm.x); // face the open sea (away from the island centre)
    b.push().translate(lm.x, Math.max(y0, -2) - 0.6, lm.z).rotY(-ang + Math.PI / 2);
    const nA = shapeNoise(77);
    const rock = (x, y, z, r, sy = 1) => {
      b.push().translate(x, y, z);
      b.sphere({ r, detail: 1, part: 0, flat: true, squashY: sy, shadeBottom: 0.35, shadeTop: 1, displace: (a, c, d) => 0.78 + 0.5 * nA(a * 1.5 + x, c * 1.5 + y, d * 1.5 + z), colorFn: (a, c) => { const m = Math.max(0, c - 0.4); return [rockCol[0][0] * (1 - m * 0.2) * 1.0, rockCol[0][1] * (1 + m * 0.35), rockCol[0][2] * (1 - m * 0.15)]; } });
      b.pop();
    };
    rock(-6.5, 3.6, 0, 3.8, 1.5); rock(-6.6, 8.2, 0.2, 2.9, 1.1); rock(6.4, 3.4, 0.4, 3.6, 1.55); rock(6.3, 8.0, 0, 2.8, 1.1);
    // the span
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      const x = Math.cos(a) * 6.4, yy = 9.6 + Math.sin(a) * 2.6;
      rock(x, yy, 0, 2.5 + 0.3 * Math.sin(i * 2.3), 0.95);
    }
    rock(-9.5, 1.2, 2.5, 2.1, 0.8); rock(9.6, 1.0, -2.2, 2.4, 0.8); rock(0, 1.0, -3.6, 2.6, 0.7); rock(-3, 0.8, 4.5, 1.9, 0.7);
    b.pop();
    this._addMesh(b);
    const cx = Math.cos(-ang + Math.PI / 2), sx = Math.sin(-ang + Math.PI / 2);
    for (const s of [-1, 1]) this._col(lm.x + Math.cos(-ang + Math.PI / 2) * 6.5 * s, lm.z - Math.sin(-ang + Math.PI / 2) * 6.5 * s, 3.3, y0 - 2, 12);
    this.emitters.push({ x: lm.x, y: lm.y + 8, z: lm.z, kind: 'sea', r: 60, id: lm.id });
  }

  update(dt, t) { for (const f of this.anim) f(dt, t); }

  // which landmark, if any, is the player inside?
  check(pos) {
    for (const l of this.discoverList) {
      if (Math.hypot(pos.x - l.x, pos.z - l.z) < l.r && pos.y < l.y + 140) return l;
    }
    return null;
  }
}

// merge a few BufferGeometry (same attribute set) into one
export function mergeGeos(list) {
  const names = ['position', 'normal', 'color', 'aPart'];
  const out = new THREE.BufferGeometry();
  let vcount = 0, icount = 0;
  for (const g of list) { vcount += g.getAttribute('position').count; icount += g.index.count; }
  const attrs = {};
  for (const n of names) attrs[n] = new Float32Array(vcount * list[0].getAttribute(n).itemSize);
  const idx = new Uint32Array(icount);
  let vo = 0, io = 0;
  for (const g of list) {
    for (const n of names) attrs[n].set(g.getAttribute(n).array, vo * g.getAttribute(n).itemSize);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.getAttribute('position').count; io += gi.length;
  }
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(attrs[n], list[0].getAttribute(n).itemSize));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
