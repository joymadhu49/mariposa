// Skyreach Falls spray: soft mist that rises from the plunge pool and peels off the cascade,
// plus a rainbow that lives in the mist and only shows when you look at it with the sun behind you.
import * as THREE from 'three';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from './shaders.js';
import { mulberry32 } from '../core/util.js';

const PUFF_VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
attribute vec2 aCorner;
attribute vec4 aSeed;   // phase, speed variation, size variation, kind (0 plume, 1 cascade)
attribute vec3 aBase;
attribute vec3 aVel;
varying vec2 vUv;
varying float vA;
varying vec3 vWorld;
void main(){
  float kind = aSeed.w;
  float T = mix(6.0, 2.1, kind) * (0.8 + 0.4 * aSeed.y);
  float ph = fract(uTime / T + aSeed.x);
  vec3 p = aBase + aVel * ph * T;
  float size;
  if (kind < 0.5) {
    p.y += ph * (2.5 + 5.5 * aSeed.z);
    p.xz += windField(aBase.xz) * ph * 6.0;
    size = mix(2.4, 6.4, sqrt(ph)) * (0.7 + 0.6 * aSeed.z);
  } else {
    p.y += sin(ph * 3.14159) * 0.8;
    size = mix(1.2, 3.4, ph) * (0.7 + 0.6 * aSeed.z);
  }
  float a = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.5, 1.0, ph));
  float d = distance(p, cameraPosition);
  // never fill the screen when you fly through a puff
  a *= smoothstep(size * 0.55, size * 1.5 + 2.0, d);
  vA = a * mix(0.2, 0.14, kind) * mix(1.0, 0.6, uNight);
  vUv = aCorner;
  vWorld = p;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  gl_Position = projectionMatrix * viewMatrix * vec4(p + (right * aCorner.x + up * aCorner.y) * size, 1.0);
  if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const PUFF_FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
varying vec2 vUv;
varying float vA;
varying vec3 vWorld;
void main(){
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float soft = pow(1.0 - r2, 1.6);
  vec3 V = normalize(vWorld - cameraPosition);
  float fwd = pow(max(dot(V, normalize(uSunDirVis)), 0.0), 4.0) * smoothstep(-0.05, 0.2, uSunDirVis.y);
  vec3 lit = uAmbUp * 1.35 + uSunColor * (0.5 + 1.1 * fwd);
  vec3 col = vec3(0.93, 0.97, 1.0) * lit * 0.6;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, vA * soft);
}
`;

const BOW_VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BOW_FRAG = /* glsl */ `
${GLSL_UNIFORMS}
uniform vec3 uMistCenter;
uniform float uMistR;
varying vec3 vWorld;
vec3 spectrum(float x){
  vec3 c = vec3(1.0, 0.08, 0.05);
  c = mix(c, vec3(1.0, 0.55, 0.05), smoothstep(0.0, 0.2, x));
  c = mix(c, vec3(1.0, 0.95, 0.15), smoothstep(0.16, 0.36, x));
  c = mix(c, vec3(0.25, 0.9, 0.25), smoothstep(0.33, 0.52, x));
  c = mix(c, vec3(0.1, 0.85, 0.95), smoothstep(0.5, 0.66, x));
  c = mix(c, vec3(0.2, 0.35, 1.0), smoothstep(0.64, 0.82, x));
  c = mix(c, vec3(0.6, 0.2, 0.95), smoothstep(0.8, 1.0, x));
  return c;
}
void main(){
  vec3 d = normalize(vWorld - cameraPosition);
  vec3 anti = -normalize(uSunDirVis);
  float ang = acos(clamp(dot(d, anti), -1.0, 1.0)); // angle from the antisolar point
  float x = (0.733 - ang) / 0.075;                   // red rim at 42 degrees, violet just inside
  float band = smoothstep(-0.3, 0.06, x) * (1.0 - smoothstep(0.94, 1.3, x));
  // only where the line of sight passes through the mist
  vec3 toM = uMistCenter - cameraPosition;
  float t0 = dot(toM, d);
  float h = length(toM - d * t0);
  float mist = 1.0 - smoothstep(0.3 * uMistR, 0.95 * uMistR, h);
  float camD = distance(cameraPosition, uMistCenter);
  float far = smoothstep(uMistR * 0.95, uMistR * 2.2, camD) * (1.0 - smoothstep(520.0, 720.0, camD));
  float sun = smoothstep(0.02, 0.22, uSunDirVis.y) * (1.0 - smoothstep(0.55, 0.95, uCloudCover)) * (1.0 - uNight);
  float a = band * mist * far * sun * 0.7;
  if (a < 0.004) discard;
  gl_FragColor = vec4(spectrum(clamp(x, 0.0, 1.0)) * a, a);
}
`;

export class FallSpray {
  constructor(world) {
    this.group = new THREE.Group();
    this.active = false;
    const f = world.falls;
    if (!f) return;
    const P = (t) => ({ x: f.top.x + (f.base.x - f.top.x) * t, z: f.top.z + (f.base.z - f.top.z) * t });
    const H = (t) => { const p = P(t); return world.heightAt(p.x, p.z); };
    // where the water lands: the last point on the axis that still stands well above the pool
    let tImp = 0.7;
    for (let i = 160; i >= 0; i--) { if (H(i / 160) > f.poolLevel + 2.5) { tImp = i / 160; break; } }
    // where the cascade starts to steepen
    let tTop = 0.15;
    for (let i = 0; i <= 160; i++) { const t = i / 160; if ((H(t) - H(Math.min(1, t + 0.02))) / (f.len * 0.02) > 0.22) { tTop = t; break; } }
    tTop = Math.min(tTop, tImp - 0.1);
    const q = P(tImp);
    const py = f.poolLevel + 0.5;
    this.impact = { x: q.x, y: py, z: q.z };
    this.center = new THREE.Vector3(q.x + f.dir.x * 4, py + 9, q.z + f.dir.z * 4);
    const rnd = mulberry32(8127);
    const PLUME = 90, CASC = 70, n = PLUME + CASC;
    const seed = new Float32Array(n * 4), base = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < PLUME; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 8;
      base.set([q.x + f.dir.x * 3.5 + Math.cos(a) * r, py + rnd() * 0.6, q.z + f.dir.z * 3.5 + Math.sin(a) * r], i * 3);
      vel.set([f.dir.x * 0.5, 0, f.dir.z * 0.5], i * 3);
      seed.set([rnd(), rnd(), rnd(), 0], i * 4);
    }
    for (let i = 0; i < CASC; i++) {
      const t = tTop + (tImp - tTop) * rnd();
      const c = P(t), px = -f.dir.z, pz = f.dir.x;
      const w = f.width * (0.8 + 0.5 * t) * 0.5 * (rnd() * 2 - 1);
      const x = c.x + px * w, z = c.z + pz * w;
      const y = world.heightAt(x, z) + 0.9 + rnd() * 1.6;
      // downhill direction from the local height gradient
      const gx = (world.heightAt(x + 1.5, z) - world.heightAt(x - 1.5, z)) / 3, gz = (world.heightAt(x, z + 1.5) - world.heightAt(x, z - 1.5)) / 3;
      let vx = -gx, vz = -gz, vy = -(gx * gx + gz * gz);
      const vl = Math.hypot(vx, vy, vz) || 1;
      const sp = 4.2 + rnd() * 1.6;
      base.set([x, y, z], (PLUME + i) * 3);
      vel.set([(vx / vl) * sp, (vy / vl) * sp, (vz / vl) * sp], (PLUME + i) * 3);
      seed.set([rnd(), rnd(), rnd(), 1], (PLUME + i) * 4);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
    g.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: { ...G }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.puffs = new THREE.Mesh(g, mat);
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 22;
    this.group.add(this.puffs);

    // the rainbow is a big invisible sphere around the mist that paints the bow where the sky angle is right
    const R = 46;
    const bowMat = new THREE.ShaderMaterial({
      vertexShader: BOW_VERT, fragmentShader: BOW_FRAG, transparent: true, depthWrite: false, side: THREE.FrontSide,
      blending: THREE.AdditiveBlending, uniforms: { ...G, uMistCenter: { value: this.center }, uMistR: { value: R } },
    });
    this.bow = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), bowMat);
    this.bow.position.copy(this.center);
    this.bow.frustumCulled = false;
    this.bow.renderOrder = 21;
    this.group.add(this.bow);
    this.active = true;
  }

  // hide everything when the falls are far away
  update(camera) {
    if (!this.active) return;
    const d = Math.hypot(camera.position.x - this.impact.x, camera.position.z - this.impact.z);
    this.group.visible = d < 760;
    this.puffs.visible = d < 380;
  }
}
