// Living world: ambient butterflies that drift between flowers, and distant flocks of birds.
import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, smoothstep, mulberry32, TAU, angleDiff } from '../core/util.js';
import { G, GLSL_UNIFORMS, GLSL_FUNCS } from '../render/shaders.js';
import { BIOME } from '../world/biomes.js';

// species choices by biome (indices into SPECIES): 0 monarch 1 morpho 2 swallowtail 3 glasswing 4 luna 5 aurora 6 sulphur 7 white 8 peacock
const BIOME_SPECIES = [
  [0, 0, 6, 7, 2, 8], // meadow
  [7, 6, 8, 7, 2], // blossom
  [2, 7, 8, 2, 6], // lavender
  [1, 1, 3, 8, 7], // forest
  [3, 3, 7, 6, 1], // lake
  [7, 8, 7, 8], // alpine
  [0, 0, 8, 0, 6], // autumn
  [6, 7, 6, 7], // shore
];

class Agent {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.roll = 0; this.pitch = 0;
    this.species = 0; this.scale = 0.8; this.seed = Math.random();
    this.tx = 0; this.tz = 0; this.ty = 1.5; this.tt = 0;
    this.phase = Math.random() * TAU; this.flap = 0.3; this.flapV = 0;
    this.state = 'fly'; // fly | rest
    this.restT = 0; this.perch = null;
    this.speed = 2;
    this.active = false;
  }
}

export class AmbientButterflies {
  constructor(world, scatter, count = 64) {
    this.world = world; this.scatter = scatter;
    this.agents = Array.from({ length: count }, () => new Agent());
    this.rnd = mulberry32(8088);
    this.bw = new Float32Array(8);
    this.refs = [];
    this.density = 1;
  }

  _groundY(x, z) { const g = this.world.heightAt(x, z); const wl = this.world.waterLevelAt(x, z); return wl === null ? g : Math.max(g, wl); }

  _respawn(a, center, night) {
    const w = this.world;
    for (let tries = 0; tries < 6; tries++) {
      const ang = this.rnd() * TAU, d = 12 + Math.sqrt(this.rnd()) * 85;
      const x = center.x + Math.cos(ang) * d, z = center.z + Math.sin(ang) * d;
      const fd = w.sampleMap(w.flora, x, z, 2);
      if (tries < 5 && fd < 0.06) continue;
      const g = this._groundY(x, z);
      if (g < 0.5 && tries < 5) continue;
      w.biomeWeightsAt(x, z, this.bw);
      let bi = 0, bv = -1;
      for (let b = 0; b < 8; b++) if (this.bw[b] > bv) { bv = this.bw[b]; bi = b; }
      const list = BIOME_SPECIES[bi];
      a.species = night > 0.6 ? 4 : list[Math.floor(this.rnd() * list.length)];
      a.x = x; a.z = z; a.y = g + 0.8 + this.rnd() * 2.6;
      a.vx = a.vy = a.vz = 0;
      a.yaw = this.rnd() * TAU; a.scale = 0.62 + this.rnd() * 0.35;
      a.tx = x; a.tz = z; a.tt = 0; a.state = 'fly'; a.speed = 1.3 + this.rnd() * 1.6;
      a.active = true; a.seed = this.rnd();
      return;
    }
  }

  update(dt, center, night, rain, time, playerPos, playerSpecies, bf) {
    const dens = this.density * (1 - night * 0.75) * (1 - clamp(rain * 1.3, 0, 0.9));
    const activeCount = Math.round(this.agents.length * clamp(dens, 0.12, 1));
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (i >= activeCount) { a.active = false; continue; }
      if (!a.active) { this._respawn(a, center, night); if (!a.active) continue; }
      const dx = a.x - center.x, dz = a.z - center.z;
      if (dx * dx + dz * dz > (this.attract ? 260 : 120) ** 2) { this._respawn(a, center, night); continue; }
      a.phase += dt * (a.state === 'rest' ? 0.4 : 6.5 + a.seed * 2.2);
      if (a.state === 'rest') {
        a.restT -= dt;
        const open = 0.5 + 0.5 * Math.sin(a.phase * 0.6);
        const target = lerp(1.4, 0.7, open);
        a.flapV = (target - a.flap) / Math.max(dt, 1e-4);
        a.flap += (target - a.flap) * (1 - Math.exp(-3 * dt));
        a.vx = a.vy = a.vz = 0;
        if (a.perch) {
          const p = a.perch;
          const wind = 0;
          a.x = p.x; a.y = p.y + 0.1; a.z = p.z;
        }
        if (a.restT <= 0 || night > 0.7) { a.state = 'fly'; a.perch = null; a.vy = 1.2; }
        continue;
      }
      // choose a wander target
      a.tt -= dt;
      const dxT = a.tx - a.x, dzT = a.tz - a.z;
      if (this.attract) {
        // the finale: butterflies gather in slow spirals around the Heartbloom
        const at = this.attract;
        if (a.tt <= 0 || dxT * dxT + dzT * dzT < 9) {
          a.tt = 2 + this.rnd() * 2;
          const ang = time * 0.35 + a.seed * TAU + this.rnd() * 0.8, R = 10 + a.seed * 55;
          a.tx = at.x + Math.cos(ang) * R; a.tz = at.z + Math.sin(ang) * R;
          a.ty = clamp(at.y + (a.seed - 0.5) * 60 - this._groundY(a.tx, a.tz), 3, 90);
          a.landRef = null;
        }
      } else if (a.tt <= 0 || dxT * dxT + dzT * dzT < 4) {
        a.tt = 2 + this.rnd() * 4;
        const ang = this.rnd() * TAU, d = 6 + this.rnd() * 16;
        a.tx = a.x + Math.cos(ang) * d; a.tz = a.z + Math.sin(ang) * d;
        a.ty = 0.8 + this.rnd() * 3.2;
        // sometimes head for a flower to land on
        if (this.rnd() < 0.22 && night < 0.5) {
          this.scatter.queryFlowers(a.x, a.z, 14, this.refs);
          if (this.refs.length) {
            const r = this.refs[Math.floor(this.rnd() * this.refs.length)];
            a.tx = r.x; a.tz = r.z; a.landRef = r; a.tt = 8;
          } else a.landRef = null;
        } else a.landRef = null;
      }
      const g = this._groundY(a.x, a.z);
      let ty = g + a.ty;
      let landing = false;
      if (a.landRef) {
        const r = a.landRef;
        this.scatter.headPosition(r, this._tmp || (this._tmp = new THREE.Vector3()));
        a.tx = this._tmp.x; a.tz = this._tmp.z; ty = this._tmp.y + 0.12;
        const dd = Math.hypot(a.tx - a.x, a.tz - a.z);
        landing = true;
        if (dd < 0.5 && Math.abs(a.y - ty) < 0.5) { a.state = 'rest'; a.restT = 3 + this.rnd() * 6; a.perch = { x: this._tmp.x, y: this._tmp.y, z: this._tmp.z }; a.landRef = null; continue; }
      }
      let dirx = a.tx - a.x, dirz = a.tz - a.z;
      const dl = Math.hypot(dirx, dirz) || 1;
      dirx /= dl; dirz /= dl;
      // avoid the player a little
      const px = a.x - playerPos.x, pz = a.z - playerPos.z, py = a.y - playerPos.y;
      const pd = Math.hypot(px, pz, py);
      if (pd < 5 && !landing) { dirx += (px / pd) * 0.9; dirz += (pz / pd) * 0.9; }
      const wob = Math.sin(time * 1.3 + a.seed * 20) * 0.6;
      const sp = a.speed * (landing ? 0.7 : 1) * (this.attract ? 2.6 : 1);
      const svx = (dirx + -dirz * wob * 0.5) * sp, svz = (dirz + dirx * wob * 0.5) * sp;
      a.vx += (svx - a.vx) * (1 - Math.exp(-1.8 * dt));
      a.vz += (svz - a.vz) * (1 - Math.exp(-1.8 * dt));
      const svy = clamp((ty - a.y) * 1.4, -2, 2) + Math.sin(a.phase) * 0.7;
      a.vy += (svy - a.vy) * (1 - Math.exp(-3 * dt));
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
      const gg = this._groundY(a.x, a.z);
      if (a.y < gg + 0.4) a.y = gg + 0.4;
      const hs = Math.hypot(a.vx, a.vz);
      if (hs > 0.3) a.yaw = dampAngle(a.yaw, Math.atan2(a.vx, a.vz), 3.5, dt);
      const w = Math.sin(a.phase) + 0.22 * Math.sin(2 * a.phase + 0.6);
      const prev = a.flap;
      a.flap = 0.28 + 0.78 * w;
      a.flapV = (a.flap - prev) / Math.max(dt, 1e-4);
      a.roll = damp(a.roll, clamp(-angleDiff(a.yaw, Math.atan2(a.vx, a.vz)) * 0.8, -0.5, 0.5), 4, dt);
      a.pitch = damp(a.pitch, clamp(-a.vy * 0.08, -0.4, 0.4), 4, dt);
    }
    // draw
    for (const a of this.agents) {
      if (!a.active) continue;
      bf.add(a.species, a.x, a.y, a.z, a.scale, a.yaw, a.pitch, a.roll, a.flap, a.flapV, a.seed * 50, undefined);
    }
  }
}

// ---- birds -----------------------------------------------------------------------------------------

const BIRD_VERT = /* glsl */ `
${GLSL_UNIFORMS}
attribute vec4 iPos;  // xyz scale
attribute vec4 iRot;  // yaw, phase, tone, unused
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vN;
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
void main(){
  vec3 p = position;
  float side = sign(p.x);
  float span = abs(p.x);
  float ang = sin(iRot.y) * 0.75 * smoothstep(0.05, 0.4, span);
  ang += (span > 0.9 ? 0.5 * sin(iRot.y - 0.9) : 0.0);
  float c = cos(ang), s = sin(ang);
  p = vec3(side * span * c, span * s, p.z + span * 0.15 * sin(iRot.y));
  vec3 wp = rotY(iRot.x) * (p * iPos.w) + iPos.xyz;
  vWorld = wp;
  vN = normalize(rotY(iRot.x) * vec3(0.0, 1.0, 0.0));
  float tone = iRot.z;
  vColor = mix(vec3(0.05, 0.05, 0.06), vec3(0.32, 0.28, 0.24), tone);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const BIRD_FRAG = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_FUNCS}
varying vec3 vColor; varying vec3 vWorld; varying vec3 vN;
void main(){
  vec3 col = shadeSurface(vColor, normalize(vN), 0.9, vWorld, 1.0) + vColor * 0.3;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Birds {
  constructor(world, count = 26) {
    this.world = world;
    this.count = count;
    const pos = [], idx = [];
    const v = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
    // body
    const n0 = v(0, 0, 0.55), n1 = v(-0.09, 0, -0.35), n2 = v(0.09, 0, -0.35), n3 = v(0, -0.09, -0.05), n4 = v(0, 0.04, -0.6);
    idx.push(n0, n1, n2, n0, n3, n1, n0, n2, n3, n1, n4, n2);
    // wings, two panels each side
    for (const s of [-1, 1]) {
      const a = v(s * 0.06, 0, 0.18), b = v(s * 0.55, 0, 0.0), c = v(s * 0.06, 0, -0.38), d = v(s * 1.25, 0, -0.32), e = v(s * 0.5, 0, -0.5);
      if (s > 0) idx.push(a, c, b, b, c, e, b, e, d); else idx.push(a, b, c, b, e, c, b, d, e);
      // double sided helpers
      if (s > 0) idx.push(a, b, c, b, e, c, b, d, e); else idx.push(a, c, b, b, c, e, b, e, d);
    }
    this.ip = new Float32Array(count * 4); this.ir = new Float32Array(count * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.aPos = new THREE.InstancedBufferAttribute(this.ip, 4); this.aRot = new THREE.InstancedBufferAttribute(this.ir, 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aRot.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iRot', this.aRot);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: BIRD_VERT, fragmentShader: BIRD_FRAG, uniforms: { ...G }, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
    this.flocks = [];
    const rnd = mulberry32(606);
    for (let f = 0; f < 4; f++) {
      const members = [];
      const n = 5 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) members.push({ ox: (rnd() - 0.5) * 12, oy: (rnd() - 0.5) * 4, oz: (rnd() - 0.5) * 12, ph: rnd() * TAU, tone: rnd() });
      this.flocks.push({ cx: (rnd() - 0.5) * 2600, cz: (rnd() - 0.5) * 2600, r: 280 + rnd() * 260, alt: 55 + rnd() * 90, sp: 0.045 + rnd() * 0.03, a: rnd() * TAU, members });
    }
    this.enabled = true;
  }

  update(dt, time, cam, night, rain) {
    let n = 0;
    const vis = this.enabled ? (1 - night * 0.9) * (1 - rain * 0.9) : 0;
    if (vis > 0.05) {
      for (const f of this.flocks) {
        f.a += f.sp * dt;
        const fx = f.cx + Math.cos(f.a) * f.r, fz = f.cz + Math.sin(f.a) * f.r;
        const ground = Math.max(this.world.heightAt(fx, fz), 0);
        const fy = ground + f.alt + Math.sin(f.a * 3) * 8;
        const dxc = fx - cam.x, dzc = fz - cam.z;
        if (dxc * dxc + dzc * dzc > 900 * 900) continue;
        const yaw = Math.atan2(-Math.sin(f.a), Math.cos(f.a)) * 1 + Math.PI / 2 * 0; // tangent direction
        const hx = -Math.sin(f.a), hz = Math.cos(f.a);
        const heading = Math.atan2(hx, hz);
        for (const m of f.members) {
          if (n >= this.count) break;
          const o = n * 4;
          this.ip[o] = fx + m.ox * Math.cos(heading) + m.oz * Math.sin(heading);
          this.ip[o + 1] = fy + m.oy + Math.sin(time * 0.8 + m.ph) * 0.6;
          this.ip[o + 2] = fz - m.ox * Math.sin(heading) + m.oz * Math.cos(heading);
          this.ip[o + 3] = 1.6;
          this.ir[o] = heading; this.ir[o + 1] = time * 6.5 + m.ph; this.ir[o + 2] = m.tone; this.ir[o + 3] = 0;
          n++;
        }
      }
    }
    this.geo.instanceCount = n;
    this.aPos.clearUpdateRanges(); this.aRot.clearUpdateRanges();
    this.aPos.addUpdateRange(0, n * 4); this.aRot.addUpdateRange(0, n * 4);
    this.aPos.needsUpdate = this.aRot.needsUpdate = true;
  }
}
