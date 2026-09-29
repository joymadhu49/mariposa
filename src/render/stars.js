// Dew stars: floating collectibles hidden around the island. A pulse makes them shine.
import * as THREE from 'three';
import { G, GLSL_UNIFORMS } from './shaders.js';
import { mulberry32, TAU, hash2f } from '../core/util.js';
import { STAR_COUNT } from '../game/progress.js';

const VERT = /* glsl */ `
${GLSL_UNIFORMS}
attribute vec2 aCorner;
attribute vec4 iPos;  // xyz, seed
attribute vec2 iAux;  // size, alpha
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float bob = sin(uTime * 1.4 + iPos.w * 30.0) * 0.25;
  vec3 c = iPos.xyz + vec3(0.0, bob, 0.0);
  float ca = cos(uTime * 0.6 + iPos.w * 6.0), sa = sin(uTime * 0.6 + iPos.w * 6.0);
  vec2 rc = vec2(aCorner.x * ca - aCorner.y * sa, aCorner.x * sa + aCorner.y * ca);
  float d = distance(c, cameraPosition);
  float size = iAux.x * (1.0 + d * 0.0035);
  vec3 pos = c + (right * rc.x + up * rc.y) * size;
  vUv = aCorner; vAlpha = iAux.y; vSeed = iPos.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  if (iAux.y < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const FRAG = /* glsl */ `
varying vec2 vUv; varying float vAlpha; varying float vSeed;
void main(){
  float r = length(vUv);
  float halo = pow(max(1.0 - r, 0.0), 2.6);
  float cross = pow(max(1.0 - abs(vUv.x * vUv.y) * 9.0, 0.0), 3.0) * max(1.0 - r, 0.0);
  float core = pow(max(1.0 - r * 2.2, 0.0), 1.5);
  float a = (halo * 0.7 + cross * 0.9 + core * 1.4) * vAlpha;
  vec3 c = mix(vec3(1.0, 0.82, 0.32), vec3(1.0, 0.95, 0.7), fract(vSeed * 7.0));
  gl_FragColor = vec4(c * a * 2.2, a);
}
`;

export class Stars {
  constructor(world, progress, landmarks) {
    this.world = world; this.progress = progress;
    this.list = this._generate(landmarks);
    const cap = this.list.length;
    this.iPos = new Float32Array(cap * 4); this.iAux = new Float32Array(cap * 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.iPos, 4); this.aAux = new THREE.InstancedBufferAttribute(this.iAux, 2);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aAux.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iAux', this.aAux);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...G }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 28;
    this.pulseT = 0;
    this.onCollect = null;
    this.nearest = null;
  }

  _generate(landmarks) {
    const w = this.world, rnd = mulberry32(4711);
    const out = [];
    const add = (x, y, z) => out.push({ id: out.length, x, y, z, seed: rnd() });
    const ground = (x, z) => { const g = w.heightAt(x, z); const wl = w.waterLevelAt(x, z); return wl === null ? g : Math.max(g, wl); };
    for (const l of w.landmarks) {
      for (let i = 0; i < 4; i++) {
        const a = rnd() * TAU, d = 14 + rnd() * 26;
        const x = l.x + Math.cos(a) * d, z = l.z + Math.sin(a) * d;
        add(x, ground(x, z) + 2.5 + rnd() * (i === 3 ? 20 : 8), z);
      }
    }
    // high above the peaks and ridges
    for (let i = 0; i < 10; i++) {
      for (let t = 0; t < 40; t++) {
        const x = -150 + (rnd() - 0.5) * 700, z = -1050 + (rnd() - 0.5) * 700;
        const g = ground(x, z);
        if (g > 110) { add(x, g + 3 + rnd() * 30, z); break; }
      }
    }
    // coast
    for (let i = 0; i < 10; i++) {
      for (let t = 0; t < 60; t++) {
        const a = rnd() * TAU, R = w.coastRadius(a) - 15;
        const x = Math.cos(a) * R, z = -30 + Math.sin(a) * R;
        if (ground(x, z) > 0.5) { add(x, ground(x, z) + 2 + rnd() * 5, z); break; }
      }
    }
    // forests
    const bw = new Float32Array(8);
    for (let i = 0; i < 12; i++) {
      for (let t = 0; t < 200; t++) {
        const x = (rnd() - 0.5) * 3000, z = (rnd() - 0.5) * 3000;
        w.biomeWeightsAt(x, z, bw);
        if (bw[3] > 0.6 && ground(x, z) > 2) { add(x, ground(x, z) + 2.5 + rnd() * 9, z); break; }
      }
    }
    // lakes
    for (let i = 0; i < 10; i++) {
      const lk = w.lakes[i % 3 === 0 ? 0 : (i % w.lakes.length)];
      for (let t = 0; t < 30; t++) {
        const a = rnd() * TAU, d = rnd() * 0.9;
        const x = lk.x + Math.cos(a) * lk.rx * d, z = lk.z + Math.sin(a) * lk.rz * d;
        if (w.waterLevelAt(x, z) !== null) { add(x, lk.level + 1.6 + rnd() * 4, z); break; }
      }
    }
    // scattered meadow and blossom stars until we reach the target
    while (out.length < STAR_COUNT) {
      const x = (rnd() - 0.5) * 2600, z = (rnd() - 0.5) * 2600;
      const g = ground(x, z);
      if (g > 3 && w.coastAt(x, z) > 80) add(x, g + 2 + rnd() * 7, z);
    }
    return out.slice(0, STAR_COUNT);
  }

  pulse() { this.pulseT = 3.2; }

  update(dt, time, playerPos, pulseCenter) {
    this.pulseT = Math.max(0, this.pulseT - dt);
    let n = 0;
    this.nearest = null;
    let nd = 1e9;
    const set = this.progress.starSet;
    for (const s of this.list) {
      if (set.has(s.id)) continue;
      const dx = s.x - playerPos.x, dy = s.y - playerPos.y, dz = s.z - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 420 * 420) continue;
      const d = Math.sqrt(d2);
      if (d < nd) { nd = d; this.nearest = s; }
      if (d < 2.2) {
        set.add(s.id);
        this.progress.stats.stars++;
        this.progress.dirty = true;
        if (this.onCollect) this.onCollect(s);
        continue;
      }
      let alpha = 0.55 * (1 - Math.min(1, d / 420) * 0.6);
      let size = 0.55;
      if (this.pulseT > 0) { const k = Math.min(1, this.pulseT / 1.2); alpha += 1.1 * k; size += 0.8 * k; }
      alpha *= 0.85 + 0.15 * Math.sin(time * 3 + s.seed * 40);
      const o = n * 4;
      this.iPos[o] = s.x; this.iPos[o + 1] = s.y; this.iPos[o + 2] = s.z; this.iPos[o + 3] = s.seed;
      this.iAux[n * 2] = size; this.iAux[n * 2 + 1] = alpha;
      n++;
    }
    this.geo.instanceCount = n;
    this.aPos.clearUpdateRanges(); this.aAux.clearUpdateRanges();
    this.aPos.addUpdateRange(0, n * 4); this.aAux.addUpdateRange(0, n * 2);
    this.aPos.needsUpdate = this.aAux.needsUpdate = true;
    this.nearestDist = nd;
  }
}
