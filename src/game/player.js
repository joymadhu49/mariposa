// The butterfly: flight model, energy, flower perching and sipping.
import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, angleDiff, smoothstep, TAU } from '../core/util.js';
import { windField } from '../core/wind.js';
import { FLOWERS } from '../world/biomes.js';

export const FLIGHT = {
  cruise: 7.6, boostMul: 2.8, climb: 5.4, descend: 7.2,
  sipTime: 2.0, focusRange: 3.4,
};

const _tp = new THREE.Vector3();

export class Player {
  constructor(world, systems) {
    this.world = world;
    this.trees = systems.trees;
    this.scatter = systems.scatter;
    this.thermals = systems.thermals;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0; this.roll = 0;
    this.flap = 0.3; this.flapV = 0; this.flapPhase = 0; this._flapFreq = 4; this._flapAmp = 0.8; this._flapCenter = 0.28;
    this.bob = 0;
    this.speed = 0; this.hspeed = 0;
    this.boostAmt = 0; this.climbAmt = 0; this.glide = false; this.brake = false;
    this.energy = 1; this.exhausted = false;
    this.mode = 'fly'; // fly | approach | perch | takeoff
    this.modeT = 0;
    this.species = 0;
    this.pollen = null; // species index carried
    this.focus = null; this.focusDist = 99; this._focusT = 0; this._refs = [];
    this.target = null; this.sipT = 0; this.sipDone = false; this.sipEnergy = 0;
    this.lift = 0;
    this.edge = 0;
    this.tiredPulse = 0;
    this.skim = 0;
    this.altAbove = 0;
    this.events = {};
    this.stats = { distance: 0, sips: 0, airTime: 0 };
    this._yawRate = 0;
    this._lastBump = 0;
    this._prevVel = new THREE.Vector3();
    this.thermalNear = false;
    this.spinT = 0; this.spinDir = 1;
  }

  startSpin(dir) {
    if (this.mode !== 'fly' || this.spinT > 0) return false;
    this.spinT = 0.001; this.spinDir = dir;
    this.emit('spin', dir);
    return true;
  }

  emit(name, ...a) { if (this.events[name]) this.events[name](...a); }

  teleport(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.mode = 'fly'; this.modeT = 0; this.target = null;
    this.emit('perchEnd');
  }

  isOpen(ref, ctx) {
    const f = FLOWERS[ref.species];
    if (f.nocturnal) return ctx.night > 0.35;
    return ctx.night < 0.6 && ctx.rain < 0.75;
  }

  _findFocus(ctx) {
    this.scatter.queryFlowers(this.pos.x, this.pos.z, 5.0, this._refs);
    let best = null, bd = 1e9;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const r of this._refs) {
      if (r.state > 0.5) continue;
      if (!this.isOpen(r, ctx)) continue;
      this.scatter.headPosition(r, _tp);
      let d = _tp.distanceTo(this.pos);
      const dx = _tp.x - this.pos.x, dz = _tp.z - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / l < -0.25) d += 1.6; // prefer flowers ahead
      if (d < bd) { bd = d; best = r; }
    }
    this.focus = bd < FLIGHT.focusRange + 1.6 ? best : null;
    this.focusDist = bd;
  }

  startPerch() {
    if (!this.focus || this.mode !== 'fly') return false;
    this.target = this.focus;
    this.mode = 'approach'; this.modeT = 0; this.sipT = 0; this.sipDone = false; this.sipEnergy = 0;
    this.emit('perchStart', this.target);
    return true;
  }

  takeOff(force = false) {
    if (this.mode === 'fly' || this.mode === 'takeoff') return;
    const wasPerched = this.mode === 'perch';
    this.mode = 'takeoff'; this.modeT = 0;
    this.vel.set(Math.sin(this.yaw) * 2.6, 3.6, Math.cos(this.yaw) * 2.6);
    this.target = null;
    this.emit('perchEnd', wasPerched);
  }

  update(dt, input, camYaw, ctx) {
    this.modeT += dt;
    const a = input.a;
    const mv = input.move;
    const world = this.world;
    this._prevVel.copy(this.vel);
    const prevYaw = this.yaw;
    this._focusT -= dt;
    if (this.mode === 'fly' && this._focusT <= 0) { this._focusT = 0.11; this._findFocus(ctx); }
    if (this.mode !== 'fly') this.focus = null;

    const canControl = ctx.canControl !== false;
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    const inMag = canControl ? Math.min(1, Math.hypot(mv.x, mv.y)) : 0;

    if (this.mode === 'fly' || this.mode === 'takeoff') {
      // ---- intent
      let dirx = sy * mv.y - cy * mv.x, dirz = cy * mv.y + sy * mv.x;
      let magIn = inMag;
      const boostRaw = canControl ? a.boost : 0;
      const canBoost = !this.exhausted && this.energy > 0.02 && this.edge < 0.6;
      const boostIn = canBoost ? boostRaw : 0;
      if (magIn < 0.12 && boostIn > 0.1) { dirx = Math.sin(this.yaw); dirz = Math.cos(this.yaw); magIn = 0.85; }
      const dl = Math.hypot(dirx, dirz) || 1; dirx /= dl; dirz /= dl;
      this.brake = canControl && a.brake > 0.5;
      this.glide = canControl && a.glide > 0.5 && !this.brake;
      this.boostAmt = damp(this.boostAmt, boostIn, 5, dt);
      const climbIn = canControl ? a.climb : 0;
      const descIn = canControl ? a.descend : 0;
      this.climbAmt = damp(this.climbAmt, climbIn, 8, dt);

      let spd = FLIGHT.cruise * magIn * (1 + (FLIGHT.boostMul - 1) * this.boostAmt);
      if (this.brake) spd = 0;
      const wantsMove = magIn > 0.05 || this.boostAmt > 0.05;
      let kh = this.brake ? 6.5 : wantsMove ? 3.1 : 1.35;
      if (this.glide) kh = 0.9;
      if (this.glide && spd < this.hspeed) spd = this.hspeed * 0.985;

      // ---- vertical
      const above = this.altAbove;
      let vT = 0;
      vT += climbIn * FLIGHT.climb * (this.exhausted ? 0.5 : 1);
      vT -= descIn * FLIGHT.descend;
      if (this.glide) vT -= 1.0;
      if (this.exhausted && climbIn < 0.1) vT -= 0.9;
      this.lift = this.thermals ? this.thermals.liftAt(this.pos.x, this.pos.y, this.pos.z, ctx.time) : 0;
      vT += this.lift;
      // soft ceiling
      if (this.pos.y > 320) vT -= (this.pos.y - 320) * 0.08;
      // cushion near the ground
      if (vT < 0) vT *= smoothstep(0.55, 2.2, above + 0.55);

      if (this.mode === 'takeoff') { kh = 1.2; }
      const ax = 1 - Math.exp(-kh * dt);
      this.vel.x += (dirx * spd - this.vel.x) * ax;
      this.vel.z += (dirz * spd - this.vel.z) * ax;
      this.vel.y += (vT - this.vel.y) * (1 - Math.exp(-(this.mode === 'takeoff' ? 2.2 : 3.4) * dt));

      // ---- wind drift, gentler while boosting
      const w = windField(this.pos.x, this.pos.z);
      const wk = 0.9 * (1 - 0.65 * this.boostAmt) * (this.pos.y < 6 ? 0.7 : 1);
      this.pos.x += (this.vel.x + w.x * wk) * dt;
      this.pos.z += (this.vel.z + w.z * wk) * dt;
      this.pos.y += this.vel.y * dt;

      // ---- energy
      let drain = 0;
      if (this.boostAmt > 0.05) drain += 0.085 * this.boostAmt;
      if (climbIn > 0.1 && this.lift < 1.5) drain += 0.024 * climbIn;
      if (this.brake) drain += 0.007;
      let regen = 0.02;
      if (this.glide) regen += 0.05;
      if (this.lift > 1.2) regen += 0.05;
      this.energy = clamp(this.energy + (regen - drain) * dt, 0, 1);
      if (this.energy <= 0.02) this.exhausted = true;
      else if (this.exhausted && this.energy > 0.22) this.exhausted = false;
      this.tiredPulse = this.exhausted ? 1 : damp(this.tiredPulse, 0, 3, dt);

      if (this.mode === 'takeoff' && this.modeT > 0.42) this.mode = 'fly';
      this.stats.airTime += dt;
    } else if (this.mode === 'approach') {
      this.boostAmt = damp(this.boostAmt, 0, 5, dt);
      const ref = this.target;
      this.scatter.headPosition(ref, _tp);
      _tp.y += 0.1;
      const dx = _tp.x - this.pos.x, dy = _tp.y - this.pos.y, dz = _tp.z - this.pos.z;
      const d = Math.hypot(dx, dy, dz);
      const sp = Math.min(6.5, d * 3.6 + 0.6);
      const k = 1 - Math.exp(-7 * dt);
      this.vel.x += (dx / (d + 1e-4) * sp - this.vel.x) * k;
      this.vel.y += (dy / (d + 1e-4) * sp - this.vel.y) * k;
      this.vel.z += (dz / (d + 1e-4) * sp - this.vel.z) * k;
      this.pos.addScaledVector(this.vel, dt);
      if (d < 0.32 || this.modeT > 2.4) { this.mode = 'perch'; this.modeT = 0; this.vel.set(0, 0, 0); this.emit('landed', ref); }
      // cancel
      if ((inMag > 0.7 && this.modeT > 0.25) || (a.climb > 0.5 && this.modeT > 0.15)) this.takeOff();
      this.energy = clamp(this.energy + 0.01 * dt, 0, 1);
    } else if (this.mode === 'perch') {
      const ref = this.target;
      this.scatter.headPosition(ref, _tp);
      this.pos.set(_tp.x, _tp.y + 0.13, _tp.z);
      this.vel.set(0, 0, 0);
      this.boostAmt = 0;
      const holding = a.interact > 0.5;
      const open = this.isOpen(ref, ctx);
      if (holding && open && !this.sipDone) {
        this.sipT += dt;
        const nectar = FLOWERS[ref.species].nectar;
        const gain = (nectar * 1.35 / FLIGHT.sipTime) * dt;
        this.energy = clamp(this.energy + gain, 0, 1);
        this.sipEnergy += gain;
        if (this.sipT >= FLIGHT.sipTime) {
          this.sipDone = true;
          this.stats.sips++;
          this.emit('sip', ref);
        }
      }
      if (this.sipDone && this.modeT > FLIGHT.sipTime + 2.4) this.takeOff();
      if (!holding && (this.sipT > 0 || this.modeT > 0.6)) this.takeOff();
      if ((inMag > 0.75 || a.climb > 0.5) && this.modeT > 0.4) this.takeOff();
      if (this.exhausted && this.energy > 0.22) this.exhausted = false;
    }

    // ---- terrain, water, trees, world edge
    const x = this.pos.x, z = this.pos.z;
    if (this.mode !== 'perch' && this.mode !== 'approach') {
      const g = world.heightAt(x, z);
      const wl = world.waterLevelAt(x, z);
      const surface = wl === null ? g : Math.max(g, wl);
      this.altAbove = this.pos.y - surface;
      const floorY = surface + 0.55;
      this.skim = 0;
      if (this.pos.y < floorY) { this.pos.y = floorY; if (this.vel.y < 0) this.vel.y = 0; }
      if (wl !== null && this.pos.y < wl + 1.1) this.skim = 1 - clamp((this.pos.y - wl) / 1.1, 0, 1);
      this._collideTrees(dt);
    } else {
      this.altAbove = 2;
    }
    if (ctx.colliders) this._collideCylinders(ctx.colliders);
    const ex = this.pos.x - 0, ez = this.pos.z + 30;
    const ed = Math.hypot(ex, ez);
    this.edge = smoothstep(1950, 2350, ed);
    if (this.edge > 0) {
      const push = 16 * this.edge * dt;
      this.vel.x -= (ex / ed) * push; this.vel.z -= (ez / ed) * push;
      if (ed > 2450) { this.pos.x = ex / ed * 2450; this.pos.z = ez / ed * 2450 - 30; }
    }

    // ---- derived motion values
    this.hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = this.vel.length();
    if (this.mode !== 'perch' && this.mode !== 'approach' && this.hspeed > 0.9) {
      const ty = Math.atan2(this.vel.x, this.vel.z);
      this.yaw = dampAngle(this.yaw, ty, 4.5 + Math.min(this.hspeed, 12) * 0.25, dt);
    } else if (this.mode === 'approach') {
      const ref = this.target; this.scatter.headPosition(ref, _tp);
      const ty = Math.atan2(_tp.x - this.pos.x, _tp.z - this.pos.z);
      if (Math.hypot(_tp.x - this.pos.x, _tp.z - this.pos.z) > 0.2) this.yaw = dampAngle(this.yaw, ty, 6, dt);
    } else if (this.mode === 'perch') {
      // turn gently to face where the camera looks so the wings frame nicely
      this.yaw = dampAngle(this.yaw, camYaw, 0.8, dt);
    }
    this._yawRate = angleDiff(prevYaw, this.yaw) / Math.max(dt, 1e-4);
    this.stats.distance += this.hspeed * dt;

    this._animate(dt, a, canControl);
  }

  _collideTrees(dt) {
    if (!this.trees) return;
    const p = this.pos;
    this.trees.forColliders(p.x, p.z, 2.0, (tx, ty, tz, rad, height) => {
      if (p.y > ty + height + 0.5) return;
      const dx = p.x - tx, dz = p.z - tz;
      const d = Math.hypot(dx, dz);
      const min = rad + 0.42;
      if (d < min) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        p.x = tx + nx * min; p.z = tz + nz * min;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; if (vn < -3.5 && performance.now() - this._lastBump > 400) { this._lastBump = performance.now(); this.emit('bump', Math.min(1, -vn / 12)); } }
      }
    });
  }

  _collideCylinders(list) {
    const p = this.pos;
    for (const c of list) {
      if (p.y > c.y + c.h + 0.5 || p.y < c.y - 1) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.42;
      if (d < min) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        p.x = c.x + nx * min; p.z = c.z + nz * min;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; }
      }
    }
  }

  _animate(dt, a, canControl) {
    let freq, amp, center;
    const m = this.mode;
    if (m === 'perch') {
      const t = this.modeT;
      const open = 0.5 + 0.5 * Math.sin(t * (this.sipT > 0 ? 1.1 : 0.7));
      const target = lerp(1.32, 0.78, open);
      this.flapV = (target - this.flap) / Math.max(dt, 1e-4);
      this.flap = damp(this.flap, target, 4, dt);
      this.flapV = clamp(this.flapV, -3, 3);
      this.bob = damp(this.bob, 0, 6, dt);
      this.pitch = damp(this.pitch, 0.15, 5, dt);
      this.roll = damp(this.roll, 0, 5, dt);
      return;
    }
    if (this.brake) { freq = 6.3; amp = 0.5; center = 0.42; }
    else if (this.glide) { freq = 1.2; amp = 0.07; center = 0.2; }
    else if (this.boostAmt > 0.2) { freq = lerp(5.4, 7.6, this.boostAmt); amp = 0.62; center = 0.12; }
    else if (this.climbAmt > 0.3) { freq = 4.7; amp = 0.98; center = 0.38; }
    else if (a.descend > 0.3 && canControl) { freq = 2.2; amp = 0.16; center = 0.85; }
    else { freq = lerp(3.5, 4.5, clamp(this.hspeed / FLIGHT.cruise, 0, 1)); amp = 0.82; center = 0.28; }
    if (m === 'approach') { freq = 6.4; amp = 0.55; center = 0.35; }
    if (m === 'takeoff') { freq = 5.2; amp = 1.0; center = 0.4; }
    if (this.exhausted && m === 'fly') { freq = 2.9; amp = 1.0; center = 0.15; }
    this._flapFreq = damp(this._flapFreq, freq, 6, dt);
    this._flapAmp = damp(this._flapAmp, amp, 6, dt);
    this._flapCenter = damp(this._flapCenter, center, 6, dt);
    const prev = this.flap;
    this.flapPhase += TAU * this._flapFreq * dt;
    const ph = this.flapPhase;
    const w = Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.6);
    this.flap = this._flapCenter + this._flapAmp * w;
    this.flapV = clamp((this.flap - prev) / Math.max(dt, 1e-4), -40, 40);
    this.bob = damp(this.bob, -w * 0.05 * this._flapAmp, 12, dt);

    const pitchT = clamp(-this.vel.y * 0.055 + (this.hspeed / (FLIGHT.cruise * FLIGHT.boostMul)) * 0.22, -0.6, 0.55) + Math.sin(ph - 0.9) * 0.05 * (this.glide ? 0.1 : 1);
    const rollT = clamp(-this._yawRate * 0.22, -0.85, 0.85) + Math.sin(ph * 0.5 + 1.3) * 0.045;
    this.pitch = damp(this.pitch, pitchT, 7, dt);
    this.roll = damp(this.roll, rollT, 7, dt);
    if (this.spinT > 0) { this.spinT += dt; if (this.spinT > 0.95) this.spinT = 0; }
  }

  // Visual state passed to the renderer
  get visual() {
    let roll = this.roll;
    if (this.spinT > 0) { const t = Math.min(1, this.spinT / 0.9); const e = t * t * (3 - 2 * t); roll += this.spinDir * TAU * e; }
    return { x: this.pos.x, y: this.pos.y + this.bob, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, roll, flap: this.flap, flapV: this.flapV };
  }
}
