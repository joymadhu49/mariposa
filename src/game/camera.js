// Third person chase camera with orbit control, auto follow, terrain avoidance and speed FOV.
import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, smoothstep } from '../core/util.js';

const DIST_PRESETS = [2.9, 4.3, 6.6, 10.5];
const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = Math.PI;
    this.pitch = -0.2;
    this.distIdx = 1;
    this.dist = 4.3;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.idleT = 0;
    this.fov = 62;
    this.roll = 0;
    this.shake = 0;
    this.mode = 'follow';
    this.ready = false;
    this.opts = { auto: true, reduceMotion: false };
    this.free = { dist: 5, yaw: 0, pitch: 0 };
    this._shakeT = 0;
    this.lead = new THREE.Vector3();
  }

  snapTo(player) {
    this.yaw = player.yaw;
    this.pitch = -0.2;
    this.pos.set(player.pos.x - Math.sin(this.yaw) * this.dist, player.pos.y + 1.2, player.pos.z - Math.cos(this.yaw) * this.dist);
    this.ready = true;
  }

  cycleZoom(dir) {
    this.distIdx = clamp(this.distIdx + dir, 0, DIST_PRESETS.length - 1);
  }

  update(dt, player, input, opts = this.opts) {
    const look = input.lookDelta;
    const lookMag = Math.abs(look.x) + Math.abs(look.y);
    this.yaw -= look.x;
    this.pitch = clamp(this.pitch - look.y, -1.3, 1.15);
    if (lookMag > 0.0005) this.idleT = 0; else this.idleT += dt;

    const perched = player.mode === 'perch' || player.mode === 'approach';
    // auto follow keeps the butterfly's back in view while you fly
    if (opts.auto && this.idleT > 0.65 && !perched && player.hspeed > 1.4 && this.mode === 'follow') {
      const fwd = Math.max(0, input.move.y);
      const k = (0.9 + Math.min(player.hspeed, 14) * 0.11) * (0.35 + 0.65 * fwd);
      this.yaw = dampAngle(this.yaw, player.yaw, k, dt);
      const climbBias = clamp(-player.vel.y * 0.018, -0.25, 0.25);
      this.pitch = damp(this.pitch, -0.2 + climbBias, 0.9, dt);
    }
    if (input.a.recenter > 0.5 && this.mode === 'follow') {
      this.yaw = dampAngle(this.yaw, player.yaw, 9, dt);
      this.pitch = damp(this.pitch, -0.2, 8, dt);
    }
    if (perched) this.pitch = damp(this.pitch, clamp(this.pitch, -0.7, 0.05), 1.5, dt);

    // zoom presets with the d-pad or wheel
    if (input.ap.dUp) this.cycleZoom(1);
    if (input.ap.dDown) this.cycleZoom(-1);
    if (Math.abs(input.wheel) > 1) this.cycleZoom(input.wheel > 0 ? 1 : -1);

    let wantDist = DIST_PRESETS[this.distIdx] + player.boostAmt * 1.3 + (perched ? -0.6 : 0);
    if (this.mode === 'photo') wantDist = this.free.dist;
    this.dist = damp(this.dist, wantDist, 3.2, dt);

    _t.set(player.pos.x, player.pos.y + player.bob * 0.5 + 0.3, player.pos.z);
    this.lead.x = damp(this.lead.x, player.vel.x * 0.1, 3, dt);
    this.lead.y = damp(this.lead.y, player.vel.y * 0.06, 3, dt);
    this.lead.z = damp(this.lead.z, player.vel.z * 0.1, 3, dt);
    this.target.copy(_t);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _d.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    let desired = _p.copy(_t).addScaledVector(_d, -this.dist);

    // keep the boom out of the terrain
    let tHit = 1;
    for (let i = 1; i <= 6; i++) {
      const f = i / 6;
      const px = lerp(_t.x, desired.x, f), pz = lerp(_t.z, desired.z, f), py = lerp(_t.y, desired.y, f);
      const gh = this.world.heightAt(px, pz);
      if (py < gh + 0.55) { tHit = Math.max(0.16, f - 1 / 6); break; }
    }
    if (tHit < 1) desired = _p.copy(_t).lerp(desired, tHit);
    if (!this.ready) { this.pos.copy(desired); this.ready = true; }
    const lag = this.mode === 'photo' ? 30 : 13;
    const k = 1 - Math.exp(-lag * dt);
    this.pos.lerp(desired, k);
    const g = this.world.heightAt(this.pos.x, this.pos.z);
    const wl = this.world.waterLevelAt(this.pos.x, this.pos.z);
    const minY = Math.max(g, wl === null ? -1e9 : wl) + 0.75;
    if (this.pos.y < minY) this.pos.y = minY;

    // subtle speed shake
    this._shakeT += dt * 38;
    const sh = opts.reduceMotion ? 0 : player.boostAmt * 0.02 + (player.mode === 'fly' ? 0.0 : 0);
    this.camera.position.set(this.pos.x + Math.sin(this._shakeT) * sh, this.pos.y + Math.sin(this._shakeT * 1.3) * sh, this.pos.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_t.x + this.lead.x, _t.y + this.lead.y, _t.z + this.lead.z);
    this.roll = damp(this.roll, opts.reduceMotion ? 0 : player.roll * 0.18, 4, dt);
    this.camera.rotateZ(this.roll);

    const fovT = 62 + player.boostAmt * 9 + clamp(player.hspeed / 24, 0, 1) * 2 - (perched ? 7 : 0);
    this.fov = damp(this.fov, fovT, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.03) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }

  // Cinematic orbit used by the title screen
  titleShot(t, center, radius = 7, height = 2.6) {
    const a = t * 0.11 + 0.6;
    this.camera.position.set(center.x + Math.cos(a) * radius, center.y + height, center.z + Math.sin(a) * radius);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center.x, center.y + 0.6, center.z);
    this.pos.copy(this.camera.position);
    if (Math.abs(this.camera.fov - 52) > 0.03) { this.camera.fov = 52; this.camera.updateProjectionMatrix(); }
  }
}
