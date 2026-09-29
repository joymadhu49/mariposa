// Particles. Ambient fields (pollen, petals, leaves, fireflies, snow, rain) are wrapped around the camera on the GPU.
// The Effects pool is CPU driven for wing dust, sip sparkles and bloom bursts.
import * as THREE from 'three';
import { G, GLSL_UNIFORMS, GLSL_FUNCS, GLSL_HEIGHT } from './shaders.js';
import { mulberry32, clamp, TAU } from '../core/util.js';

const TYPES = {
  motes: { id: 0, count: 2600, box: [70, 12, 70], size: 0.05, add: true },
  petals: { id: 1, count: 1800, box: [46, 16, 46], size: 0.12, add: false },
  leaves: { id: 2, count: 1800, box: [46, 16, 46], size: 0.15, add: false },
  fireflies: { id: 3, count: 1300, box: [80, 10, 80], size: 0.13, add: true },
  snow: { id: 4, count: 6500, box: [50, 24, 50], size: 0.036, add: false },
  rain: { id: 5, count: 9000, box: [38, 26, 38], size: 0.017, add: false },
};

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_HEIGHT}
${GLSL_FUNCS}
attribute vec2 aCorner;
attribute vec4 aSeed;
uniform float uType;
uniform vec3 uBox;
uniform float uDensity;
uniform float uSize;
uniform vec3 uCam;
varying vec2 vUv;
varying float vFade;
varying float vBlink;
varying float vSeed;
varying vec3 vWorld;

void main(){
  float vis = step(aSeed.w, uDensity);
  vec3 base = aSeed.xyz * uBox;
  float t = uTime;
  float H = uBox.y;
  vec3 origin = vec3(uCam.x - uBox.x * 0.5, 0.0, uCam.z - uBox.z * 0.5);
  vec2 w = windField(base.xz) * 1.6;
  float h; vec2 xz;
  float sway = 0.0;
  if (uType < 0.5) { // pollen motes: slow rising drift, height above ground
    xz = base.xz + vec2(sin(t * 0.21 + aSeed.x * 40.0), cos(t * 0.17 + aSeed.y * 40.0)) * 1.4 + w * t * 0.25;
    h = mod(aSeed.y * H + t * 0.12, H) + 0.25;
  } else if (uType < 1.5 || uType < 2.5) { // petals and leaves fall and flutter
    float fall = uType < 1.5 ? 0.7 : 0.95;
    xz = base.xz + w * t * 0.9 + vec2(sin(t * 1.2 + aSeed.x * 30.0), cos(t * 0.9 + aSeed.z * 30.0)) * 1.1;
    h = H - mod(aSeed.y * H + t * fall, H);
    sway = t;
  } else if (uType < 3.5) { // fireflies wander
    float ph = aSeed.x * 60.0;
    xz = base.xz + vec2(sin(t * 0.4 + ph) * 2.6 + sin(t * 0.9 + ph * 1.7) * 0.9, cos(t * 0.33 + ph * 1.3) * 2.6 + cos(t * 0.8 + ph) * 0.9);
    h = 0.4 + aSeed.y * 6.0 + sin(t * 0.5 + ph * 0.7) * 0.9;
  } else if (uType < 4.5) { // snow
    xz = base.xz + w * t * 0.6 + vec2(sin(t * 0.7 + aSeed.x * 30.0), cos(t * 0.6 + aSeed.z * 30.0)) * 0.7;
    h = H - mod(aSeed.y * H + t * 1.1, H);
  } else { // rain
    xz = base.xz + w * t * 0.25;
    h = H - mod(aSeed.y * H + t * 15.0 + aSeed.x * 3.0, H);
  }
  vec2 rel = mod(xz - origin.xz, uBox.xz);
  vec2 pxz = origin.xz + rel;
  float ground = terrainHeight(pxz);
  float wl = 0.0;
  vec3 world = vec3(pxz.x, max(ground, wl) + h, pxz.y);
  float vEdge = 1.0;
  if (uType > 3.5) {
    // snow and rain fall from the sky at any altitude: keep the slab of falling particles centred on the camera
    float y0 = uCam.y - H * 0.5;
    float yy = y0 + mod(h - y0, H);
    world.y = yy;
    float above = yy - max(ground, wl);
    float lv = (yy - y0) / H;
    vEdge = smoothstep(0.0, 0.1, lv) * (1.0 - smoothstep(0.9, 1.0, lv)) * smoothstep(0.02, uType > 4.5 ? 0.06 : 0.5, above);
  }
  // edge fade of the box and distance to camera
  vec2 e = abs(rel / uBox.xz - 0.5) * 2.0;
  float edge = (1.0 - smoothstep(0.75, 1.0, max(e.x, e.y))) * vEdge;
  float distCam = distance(world, cameraPosition);
  float nearFade = smoothstep(0.35, 1.6, distCam);
  vFade = vis * edge * nearFade;
  float blink = 1.0;
  if (uType > 2.5 && uType < 3.5) blink = 0.15 + 0.85 * pow(0.5 + 0.5 * sin(t * (1.2 + aSeed.z * 2.2) + aSeed.x * 50.0), 3.0);
  vBlink = blink;
  vSeed = aSeed.z;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float size = uSize * (0.6 + 0.8 * aSeed.z);
  // far snowflakes keep a couple of pixels so the whole box reads as falling snow
  if (uType > 3.5 && uType < 4.5) size = max(size, distCam * 0.0036);
  vec2 c = aCorner;
  vec3 pos;
  if (uType > 4.5) { // rain streak: stretched vertical quad facing the camera
    vec3 toCam = normalize(cameraPosition - world);
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    pos = world + side * c.x * size + vec3(0.0, 1.0, 0.0) * (c.y * 0.5 + 0.5) * 0.7;
  } else {
    float ang = uType > 0.5 && uType < 2.5 ? sway * (0.8 + aSeed.z) + aSeed.x * 6.28 : 0.0;
    float ca = cos(ang), sa = sin(ang);
    vec2 rc = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
    if (uType > 0.5 && uType < 2.5) rc.y *= 0.6 + 0.4 * sin(t * 3.0 + aSeed.x * 20.0);
    pos = world + (right * rc.x + up * rc.y) * size;
  }
  vUv = aCorner;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  if (vFade < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
uniform float uType;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uAlpha;
varying vec2 vUv;
varying float vFade;
varying float vBlink;
varying float vSeed;
varying vec3 vWorld;
void main(){
  float r = length(vUv);
  vec3 col; float a;
  if (uType < 0.5) { // soft round mote
    a = pow(1.0 - clamp(r, 0.0, 1.0), 2.0);
    col = mix(uColorA, uColorB, vSeed) * (1.2 + uSunColor * 0.25);
    col *= 0.6 + 0.4 * (uSunColor.r + uSunColor.g) * 0.5 + uNight * 0.3;
  } else if (uType < 2.5) { // petal or leaf: rounded leaf shape
    float d = length(vec2(vUv.x * 1.05, vUv.y * 0.72));
    a = 1.0 - smoothstep(0.82, 1.0, d);
    col = mix(uColorA, uColorB, vSeed);
    col *= 0.2 + 0.5 * (uSunColor * 0.6 + uAmbUp * 0.75);
    float vein = smoothstep(0.03, 0.0, abs(vUv.y)) * 0.15;
    col += vein;
  } else if (uType < 3.5) { // firefly glow
    a = pow(1.0 - clamp(r, 0.0, 1.0), 1.6);
    col = mix(uColorA, uColorB, vSeed) * 3.0 * vBlink;
    a *= vBlink;
  } else if (uType < 4.5) { // snow
    a = 1.0 - smoothstep(0.6, 1.0, r);
    col = vec3(1.0) * (0.4 + 0.6 * (uAmbUp + uSunColor * 0.5));
  } else { // rain streak
    a = (1.0 - smoothstep(0.4, 1.0, abs(vUv.x))) * uAlpha;
    col = (uAmbUp * 1.4 + uSunColor * 0.5) * 0.9;
  }
  a *= vFade;
  if (a < 0.01) discard;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, a * uAlpha);
}
`;

function quadGeometry(count, seedRng) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { seeds[i * 4] = seedRng(); seeds[i * 4 + 1] = seedRng(); seeds[i * 4 + 2] = seedRng(); seeds[i * 4 + 3] = seedRng(); }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  return g;
}

export class AmbientParticles {
  constructor(tex) {
    this.group = new THREE.Group();
    this.fields = {};
    const rnd = mulberry32(2024);
    const colors = {
      motes: [[1.0, 0.95, 0.7], [1.0, 1.0, 0.9]],
      petals: [[0.95, 0.55, 0.72], [1.0, 0.78, 0.86]],
      leaves: [[0.78, 0.27, 0.08], [0.88, 0.56, 0.12]],
      fireflies: [[0.75, 1.0, 0.3], [0.5, 1.0, 0.6]],
      snow: [[1, 1, 1], [1, 1, 1]],
      rain: [[0.7, 0.8, 0.95], [0.7, 0.8, 0.95]],
    };
    for (const [name, def] of Object.entries(TYPES)) {
      const geo = quadGeometry(def.count, rnd);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          ...G,
          uHeightTex: { value: tex.height },
          uType: { value: def.id }, uBox: { value: new THREE.Vector3(...def.box) }, uDensity: { value: 0 }, uSize: { value: def.size },
          uCam: { value: new THREE.Vector3() },
          uColorA: { value: new THREE.Vector3(...colors[name][0]) }, uColorB: { value: new THREE.Vector3(...colors[name][1]) },
          uAlpha: { value: name === 'rain' ? 0.26 : 1 },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: def.add ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 20;
      mesh.visible = false;
      this.group.add(mesh);
      this.fields[name] = { mesh, mat, density: 0, def };
    }
  }

  // targets: object of densities 0..1 by field name
  update(dt, cam, targets) {
    for (const [name, f] of Object.entries(this.fields)) {
      const t = targets[name] || 0;
      f.density += (t - f.density) * (1 - Math.exp(-1.6 * dt));
      f.mat.uniforms.uDensity.value = f.density;
      f.mat.uniforms.uCam.value.copy(cam);
      f.mesh.visible = f.density > 0.004;
    }
  }
}

// ---- CPU effects pool ---------------------------------------------------------------------------

const EFX_VERT = /* glsl */ `
${GLSL_UNIFORMS}
attribute vec2 aCorner;
attribute vec4 iPos;    // xyz, size
attribute vec4 iCol;    // rgb, alpha
attribute vec2 iRot;    // angle, stretch
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vWorld;
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float ca = cos(iRot.x), sa = sin(iRot.x);
  vec2 c = aCorner;
  vec2 rc = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
  rc.y *= iRot.y;
  vec3 pos = iPos.xyz + (right * rc.x + up * rc.y) * iPos.w;
  vUv = aCorner; vCol = iCol; vWorld = iPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  if (iCol.a < 0.005) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const EFX_FRAG_ADD = /* glsl */ `
varying vec2 vUv; varying vec4 vCol; varying vec3 vWorld;
void main(){
  float r = length(vUv);
  float core = pow(1.0 - clamp(r, 0.0, 1.0), 3.0);
  float glow = pow(1.0 - clamp(r, 0.0, 1.0), 1.4) * 0.35;
  float a = (core + glow) * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a);
}
`;
const EFX_FRAG_ALPHA = /* glsl */ `
varying vec2 vUv; varying vec4 vCol; varying vec3 vWorld;
void main(){
  float d = length(vec2(vUv.x * 1.05, vUv.y * 0.72));
  float a = (1.0 - smoothstep(0.8, 1.0, d)) * vCol.a;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}
`;

class Pool {
  constructor(cap, additive) {
    this.cap = cap;
    this.n = 0;
    this.p = new Float32Array(cap * 3); // position
    this.v = new Float32Array(cap * 3); // velocity
    this.life = new Float32Array(cap); this.maxLife = new Float32Array(cap);
    this.size = new Float32Array(cap); this.size1 = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);
    this.drag = new Float32Array(cap); this.grav = new Float32Array(cap);
    this.rot = new Float32Array(cap); this.spin = new Float32Array(cap);
    this.twinkle = new Float32Array(cap);
    this.iPos = new Float32Array(cap * 4); this.iCol = new Float32Array(cap * 4); this.iRot = new Float32Array(cap * 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.aPos = new THREE.InstancedBufferAttribute(this.iPos, 4); this.aCol = new THREE.InstancedBufferAttribute(this.iCol, 4); this.aRot = new THREE.InstancedBufferAttribute(this.iRot, 2);
    for (const a of [this.aPos, this.aCol, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iRot', this.aRot);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: EFX_VERT, fragmentShader: additive ? EFX_FRAG_ADD : EFX_FRAG_ALPHA,
      uniforms: { ...G }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    });
    if (!additive) this.mat.blending = THREE.NormalBlending;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.add = additive;
  }
  spawn(x, y, z, vx, vy, vz, life, size, size1, r, g, b, drag = 0.5, grav = 0, spin = 0, twinkle = 0) {
    let i;
    if (this.n < this.cap) i = this.n++; else i = Math.floor(Math.random() * this.cap);
    const j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.size1[i] = size1;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b;
    this.drag[i] = drag; this.grav[i] = grav; this.rot[i] = Math.random() * TAU; this.spin[i] = spin; this.twinkle[i] = twinkle * Math.random();
  }
  update(dt) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const j = i * 3;
      const dk = Math.exp(-this.drag[i] * dt);
      this.v[j] *= dk; this.v[j + 1] = this.v[j + 1] * dk - this.grav[i] * dt; this.v[j + 2] *= dk;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      if (w !== i) {
        const k = w * 3;
        this.p[k] = this.p[j]; this.p[k + 1] = this.p[j + 1]; this.p[k + 2] = this.p[j + 2];
        this.v[k] = this.v[j]; this.v[k + 1] = this.v[j + 1]; this.v[k + 2] = this.v[j + 2];
        this.col[k] = this.col[j]; this.col[k + 1] = this.col[j + 1]; this.col[k + 2] = this.col[j + 2];
        this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i]; this.size[w] = this.size[i]; this.size1[w] = this.size1[i];
        this.drag[w] = this.drag[i]; this.grav[w] = this.grav[i]; this.rot[w] = this.rot[i]; this.spin[w] = this.spin[i]; this.twinkle[w] = this.twinkle[i];
      }
      w++;
    }
    this.n = w;
    for (let i = 0; i < this.n; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      const j = i * 3, k = i * 4;
      this.iPos[k] = this.p[j]; this.iPos[k + 1] = this.p[j + 1]; this.iPos[k + 2] = this.p[j + 2];
      this.iPos[k + 3] = this.size[i] + (this.size1[i] - this.size[i]) * t;
      let a = Math.min(1, (1 - t) * 2.6) * Math.min(1, t * 14);
      if (this.twinkle[i] > 0) a *= 0.55 + 0.45 * Math.sin(this.twinkle[i] * 40 + t * 22);
      this.iCol[k] = this.col[j]; this.iCol[k + 1] = this.col[j + 1]; this.iCol[k + 2] = this.col[j + 2]; this.iCol[k + 3] = a;
      this.iRot[i * 2] = this.rot[i]; this.iRot[i * 2 + 1] = 1;
    }
    this.geo.instanceCount = this.n;
    for (const a of [this.aPos, this.aCol, this.aRot]) { a.clearUpdateRanges(); a.needsUpdate = true; }
  }
}

export class Effects {
  constructor() {
    this.group = new THREE.Group();
    this.glow = new Pool(2600, true);
    this.petal = new Pool(900, false);
    this.group.add(this.glow.mesh, this.petal.mesh);
    this.trailT = 0;
    this.rings = [];
  }

  // soft glowing sparks
  spark(x, y, z, vx, vy, vz, life, size, color, opts = {}) {
    this.glow.spawn(x, y, z, vx, vy, vz, life, size, opts.size1 ?? size * 0.3, color[0], color[1], color[2], opts.drag ?? 1.4, opts.grav ?? 0, 0, opts.twinkle ?? 0);
  }
  petalBit(x, y, z, vx, vy, vz, life, size, color, spin = 4) {
    this.petal.spawn(x, y, z, vx, vy, vz, life, size, size * 0.8, color[0], color[1], color[2], 1.1, 0.6, spin, 0);
  }

  burst(pos, color, n = 24, speed = 3, life = 1.1, size = 0.12, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = (Math.random() - 0.35) * 1.6;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spark(pos.x, pos.y, pos.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + (opts.up ?? 0.5), Math.sin(a) * Math.cos(e) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, { drag: 1.8, twinkle: 1, ...opts });
    }
  }

  // expanding ring of sparks in the horizontal plane
  ring(pos, color, radius = 4, n = 46, life = 1.2, size = 0.14) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const s = radius / life * 1.15;
      this.spark(pos.x, pos.y, pos.z, Math.cos(a) * s, 0.25, Math.sin(a) * s, life, size, color, { drag: 1.6, twinkle: 1 });
    }
  }

  petalBurst(pos, color, n = 16, speed = 2.6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.4 + Math.random());
      const c = [color[0] * (0.8 + 0.3 * Math.random()), color[1] * (0.8 + 0.3 * Math.random()), color[2] * (0.8 + 0.3 * Math.random())];
      this.petalBit(pos.x, pos.y + 0.2, pos.z, Math.cos(a) * s, 1.4 + Math.random() * 2.2, Math.sin(a) * s, 1.8 + Math.random() * 1.4, 0.09 + Math.random() * 0.08, c, (Math.random() - 0.5) * 8);
    }
  }

  update(dt) { this.glow.update(dt); this.petal.update(dt); }
}
