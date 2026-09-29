// Ocean, lakes and the waterfall. Depth, colour and shoreline foam come from the terrain height texture.
import * as THREE from 'three';
import { G, GLSL_UNIFORMS, GLSL_FUNCS, GLSL_HEIGHT } from './shaders.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const WATER_VERT = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_HEIGHT}
uniform float uLevel;
uniform float uOcean;
uniform float uWaveAmp;
varying vec3 vWorld;
void main(){
  vec3 wp = position;
  if (uOcean > 0.5) { wp.xz += cameraPosition.xz; }
  else { wp.xz += vec2(modelMatrix[3][0], modelMatrix[3][2]); }
  wp.y = uLevel;
  float depth = uLevel - terrainHeight(wp.xz);
  float damp = smoothstep(0.0, 2.5, depth);
  float t = uTime;
  float w = sin(wp.x * 0.09 + t * 0.9) * 0.5 + sin(wp.z * 0.13 - t * 0.7) * 0.35 + sin((wp.x + wp.z) * 0.21 + t * 1.3) * 0.15;
  wp.y += w * uWaveAmp * damp;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const WATER_FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_HEIGHT}
${GLSL_FUNCS}
uniform float uLevel;
uniform float uOcean;
uniform vec4 uLakeA;
uniform vec2 uLakeB;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uAbsorb;
uniform sampler2D uAlbedoTex;
varying vec3 vWorld;

float wave(vec2 p, float t){
  return nz(p * 0.03 + vec2(t * 0.006, t * 0.004)).g * 0.55 + nz(p * 0.06 - vec2(t * 0.008, -t * 0.006)).b * 0.3 + nz(p * 0.11 + vec2(t * 0.014, t * 0.011)).a * 0.15;
}

void main(){
  float terr = terrainHeight(vWorld.xz);
  float depth = uLevel - terr;
  if (depth < 0.0) discard;
  if (uOcean < 0.5) {
    vec2 d = vWorld.xz - uLakeA.xy;
    float c = cos(uLakeB.x), s = sin(uLakeB.x);
    vec2 e = vec2((d.x * c + d.y * s) / uLakeA.z, (-d.x * s + d.y * c) / uLakeA.w);
    if (length(e) > uLakeB.y) discard;
  }
  vec2 p = vWorld.xz;
  float dist = distance(cameraPosition, vWorld);
  float t = uTime;
  float k = mix(1.0, 0.25, smoothstep(40.0, 500.0, dist));
  float w0 = wave(p, t);
  float wx = wave(p + vec2(0.35, 0.0), t) - w0;
  float wz = wave(p + vec2(0.0, 0.35), t) - w0;
  vec3 N = normalize(vec3(-wx * k * 2.2, 1.0, -wz * k * 2.2));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = skyColor(vec3(R.x, max(R.y, 0.03), R.z));
  refl *= mix(vec3(1.0), vec3(0.7, 0.87, 1.0), 0.6);
  float shallowK = exp(-depth * uAbsorb);
  vec3 amb = mix(uAmbDown, uAmbUp, 0.8);
  vec3 body = mix(uDeep, uShallow, clamp(shallowK * 1.15, 0.0, 1.0)) * (amb * 1.5 + uSunColor * 0.3);
  // wave crests catch a little more light
  body += uShallow * smoothstep(0.62, 0.9, w0) * 0.18 * (amb + uSunColor * 0.4);
  float fresK = clamp(fres, 0.0, 1.0) * 0.85;
  vec3 col = mix(body, refl, fresK);
  // sun glitter
  vec3 H = normalize(V + uSunDirVis);
  float spec = pow(max(dot(N, H), 0.0), 380.0) * smoothstep(0.0, 0.08, uSunDirVis.y);
  float specSoft = pow(max(dot(N, H), 0.0), 28.0) * 0.16 * smoothstep(0.0, 0.2, uSunDirVis.y);
  vec3 sunC = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.95, 0.85), smoothstep(0.0, 0.4, uSunDirVis.y));
  col += sunC * (spec * 9.0 + specSoft) * (1.0 - uNight);
  // moon glitter
  vec3 Hm = normalize(V + uMoonDir);
  col += vec3(0.5, 0.6, 1.0) * pow(max(dot(N, Hm), 0.0), 260.0) * 2.5 * uNight * smoothstep(0.0, 0.1, uMoonDir.y);
  // caustic shimmer in shallows
  float caus = pow(nz(p * 0.07 + vec2(t * 0.02, -t * 0.015)).b * nz(p * 0.055 - vec2(t * 0.014, t * 0.017)).a, 1.4) * 2.4;
  col += uSunColor * caus * shallowK * 0.18 * smoothstep(0.0, 0.3, uSunDir.y);
  // shoreline foam
  float wobble = sin(p.x * 0.8 + t * 1.4) * 0.5 + sin(p.y * 0.7 - t * 1.1) * 0.5;
  float edge = depth + wobble * 0.12 + (nz(p * 0.1).b - 0.5) * 0.3;
  float foam = smoothstep(0.42, 0.0, edge) * (0.55 + 0.45 * nz(p * 0.16 + t * 0.01).a);
  float ph = fract(t * 0.07 + nz(p * 0.004).r * 2.0);
  float foamRing = smoothstep(0.34, 0.0, abs(edge - 0.7 - ph * 3.4)) * (1.0 - ph) * 0.62 * smoothstep(0.0, 0.5, edge) * (0.55 + 0.45 * nz(p * 0.08).a);
  vec3 foamCol = mix(vec3(0.95, 0.98, 1.0), uAmbUp * 2.0 + uSunColor * 0.4, 0.4);
  col = mix(col, foamCol, clamp(foam + foamRing, 0.0, 1.0) * 0.85);
  col += uGlowColor * uPlayerGlow.w * exp(-dot(vWorld - uPlayerGlow.xyz, vWorld - uPlayerGlow.xyz) * 0.01) * 0.4;
  col += vec3(0.5, 0.85, 1.0) * pulseBand(vWorld) * 0.5;
  col = applyFog(col, vWorld);
  float alpha = mix(0.72, 0.98, 1.0 - shallowK);
  alpha = max(alpha, clamp(fres, 0.0, 1.0) * 0.9);
  alpha = max(alpha, clamp(foam + foamRing, 0.0, 1.0));
  alpha *= smoothstep(0.0, 0.16, depth);
  gl_FragColor = vec4(col, alpha);
}
`;

const FALL_VERT = /* glsl */ `
${GLSL_UNIFORMS}
attribute vec2 aFall; // x across (-1..1), y along (0..1)
attribute float aSlope; // 0 flat .. 1 steep chute
varying vec3 vWorld;
varying vec2 vFall;
varying float vSlope;
void main(){
  vFall = aFall;
  vSlope = aSlope;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // slight swell across the width
  wp.y += sin(uTime * 4.0 + aFall.y * 20.0) * 0.06;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FALL_FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
uniform float uImpact; // along the ribbon where the water lands in the pool
varying vec3 vWorld;
varying vec2 vFall;
varying float vSlope;
void main(){
  float t = uTime;
  vec2 uv = vec2(vFall.x * 1.3, vFall.y * 5.0);
  float steep = smoothstep(0.12, 0.7, vSlope);
  float s1 = nz(vec2(uv.x * 0.22, uv.y * 0.1 - t * 0.35)).g;
  float s2 = nz(vec2(uv.x * 0.5 + 0.4, uv.y * 0.22 - t * 0.7)).b;
  float s3 = nz(vec2(uv.x * 1.0 + 0.1, uv.y * 0.45 - t * 1.2)).a;
  float s4 = nz(vec2(uv.x * 2.2 + 0.7, uv.y * 0.9 - t * 2.1)).a;
  float streak = s1 * 0.38 + s2 * 0.3 + s3 * 0.2 + s4 * 0.12;
  float edge = 1.0 - smoothstep(0.62, 1.0, abs(vFall.x));
  float body = smoothstep(0.3, 0.75, streak);
  // fast white water on the steep runs, glassy turquoise on the calmer steps
  float white = clamp(steep * (0.55 + 0.6 * body) + 0.15 * body, 0.0, 1.0);
  vec3 baseC = mix(vec3(0.36, 0.72, 0.82), vec3(1.0), white);
  vec3 lit = baseC * (uAmbUp * 1.6 + uSunColor * 0.45);
  // foam: the lip, the banks of the steep runs and the churn where the water lands
  float lip = smoothstep(0.1, 0.0, vFall.y) * 0.5;
  float bank = smoothstep(0.6, 1.0, abs(vFall.x)) * (0.3 + 0.7 * steep) * (0.55 + 0.6 * s3);
  float dI = (vFall.y - uImpact) / 0.05;
  float churn = exp(-dI * dI * 0.5) * (0.7 + 0.5 * nz(vec2(vFall.x * 1.7 + t * 0.2, vFall.y * 9.0 - t * 1.5)).b);
  float foam = clamp(lip + bank + churn, 0.0, 1.0);
  lit = mix(lit, vec3(1.0) * (uAmbUp * 1.9 + uSunColor * 0.5), foam);
  vec3 col = applyFog(lit, vWorld);
  float a = edge * mix(0.45, 0.92, steep) * (0.75 + 0.25 * body);
  a = max(a, foam * edge);
  a *= smoothstep(0.0, 0.05, vFall.y);
  // past the landing point the water spreads into the pool and dissolves
  a *= 1.0 - smoothstep(uImpact + 0.02, uImpact + 0.12, vFall.y);
  gl_FragColor = vec4(col, a);
}
`;

export class Water {
  constructor(world, tex, terrainUniforms = {}) {
    this.world = world;
    this.group = new THREE.Group();
    const base = { ...G, uHeightTex: { value: tex.height }, uAlbedoTex: { value: tex.albedo } };

    // ocean: radial mesh centred on the camera
    const rings = 64, segs = 128, R = 7000;
    const pos = [], idx = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const r = R * (0.02 * t + 0.98 * Math.pow(t, 3.2));
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = (i + 1) * segs + j, d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    og.setIndex(idx);
    this.oceanMat = this._material(base, { uLevel: 0, uOcean: 1, uWaveAmp: 0.32, uAbsorb: 0.11, uDeep: new THREE.Color('#0b5a9a'), uShallow: new THREE.Color('#3ee0cf'), uLakeA: new THREE.Vector4(), uLakeB: new THREE.Vector2() });
    this.ocean = new THREE.Mesh(og, this.oceanMat);
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = 10;
    this.group.add(this.ocean);

    // lakes
    this.lakes = [];
    for (const lk of world.lakes) {
      const size = Math.max(lk.rx, lk.rz) * 2 * (lk.maskT || 1.28) * 1.06;
      const seg = lk.pond ? 20 : 40;
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      const deep = new THREE.Color(lk.color).multiplyScalar(0.7);
      const shallow = new THREE.Color(lk.color).lerp(new THREE.Color('#7fd6c0'), 0.4);
      const m = this._material(base, {
        uLevel: lk.level, uOcean: 0, uWaveAmp: 0.045, uAbsorb: lk.pond ? 0.35 : 0.22, uDeep: deep, uShallow: shallow,
        uLakeA: new THREE.Vector4(lk.x, lk.z, lk.rx, lk.rz), uLakeB: new THREE.Vector2(lk.rot, lk.maskT || 1.28),
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(lk.x, 0, lk.z);
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      this.group.add(mesh);
      this.lakes.push({ lk, mesh });
    }

    // waterfall ribbon
    if (world.falls) this._buildFall(world, base);
  }

  _material(base, extra) {
    const uniforms = { ...base };
    for (const k in extra) uniforms[k] = { value: extra[k] };
    return new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  }

  _buildFall(world, base) {
    const f = world.falls;
    const N = 64;
    const pos = [], fall = [], slope = [], idx = [];
    const centre = (t) => ({ x: f.top.x + (f.base.x - f.top.x) * t, z: f.top.z + (f.base.z - f.top.z) * t });
    const hAt = (t) => { const c = centre(t); return world.heightAt(c.x, c.z); };
    const dl = f.len / N;
    // steepness of every row (rise over run of the bed), and where the water lands
    const sl = [];
    for (let i = 0; i <= N; i++) {
      const a = hAt(Math.max(0, i - 1) / N), c = hAt(Math.min(N, i + 1) / N);
      sl.push(clamp01(((a - c) / (dl * (Math.min(N, i + 1) - Math.max(0, i - 1)))) / 0.75));
    }
    let impact = 0.7;
    for (let i = 200; i >= 0; i--) { if (hAt(i / 200) > f.poolLevel + 2.5) { impact = i / 200; break; } }
    // the ribbon follows the carved channel, dropping from the tarn lip to the pool
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const { x: cx, z: cz } = centre(t);
      const px = -f.dir.z, pz = f.dir.x;
      const w = f.width * (0.8 + 0.5 * t);
      for (let s = -1; s <= 1; s += 0.25) {
        const x = cx + px * w * 0.5 * s, z = cz + pz * w * 0.5 * s;
        const y = world.heightAt(cx + px * w * 0.5 * s * 0.55, cz + pz * w * 0.5 * s * 0.55) + 0.55 + 0.3 * (1 - Math.abs(s));
        pos.push(x, Math.max(y, world.heightAt(x, z) + 0.4), z);
        fall.push(s, t);
        slope.push(sl[i]);
      }
    }
    const per = 9;
    for (let i = 0; i < N; i++) for (let s = 0; s < per - 1; s++) {
      const a = i * per + s, b = a + 1, c = a + per, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 2));
    g.setAttribute('aSlope', new THREE.Float32BufferAttribute(slope, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({ vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, uniforms: { ...G, uImpact: { value: impact } }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.fall = new THREE.Mesh(g, m);
    this.fall.frustumCulled = false;
    this.fall.renderOrder = 12;
    this.group.add(this.fall);
  }

  update(camera) {
    this.ocean.position.set(0, 0, 0); // vertex shader offsets by camera xz
  }
}
