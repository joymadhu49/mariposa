// Game orchestration: boots the world, owns every system, runs the frame loop and the game rules.
import * as THREE from 'three';
import { generateWorld } from '../world/worldgen.js';
import { Engine, QUALITY_PRESETS } from '../render/engine.js';
import { G, makeNoiseTexture } from '../render/shaders.js';
import { Terrain, makeWorldTextures } from '../render/terrain.js';
import { Sky } from '../render/sky.js';
import { Water } from '../render/water.js';
import { Grass } from '../render/grass.js';
import { Scatter } from '../render/scatter.js';
import { Trees } from '../render/trees.js';
import { Butterflies, SPECIES } from '../render/butterfly.js';
import { AmbientParticles, Effects } from '../render/particles.js';
import { Landmarks } from '../render/landmarks.js';
import { FallSpray } from '../render/spray.js';
import { Stars } from '../render/stars.js';
import { applyAtmosphere } from './daynight.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Thermals } from './thermals.js';
import { Weather } from './weather.js';
import { AmbientButterflies, Birds } from './fauna.js';
import { Progress, UNLOCKS, STAR_COUNT } from './progress.js';
import { UI, ICON } from '../ui/ui.js';
import { attachScreens } from '../ui/manager.js';
import { glyph } from '../ui/glyphs.js';
import { BIOMES, FLOWERS, LANDMARKS, VARIANTS } from '../world/biomes.js';
import { hexToLinear, clamp, damp, lerp, smoothstep, TAU, mulberry32 } from '../core/util.js';

const GLOW = [[1, 0.72, 0.35], [0.4, 0.72, 1], [1, 0.9, 0.42], [0.8, 0.96, 1], [0.6, 1, 0.78], [1, 0.7, 0.95]];
const TRAIL = [[1, 0.7, 0.25], [0.35, 0.65, 1], [1, 0.88, 0.35], [0.85, 0.95, 1], [0.6, 1, 0.7], [1, 0.6, 0.9]];
const FILTERS = [
  { name: 'Natural', tint: [1, 1, 1], sat: 0, warm: 0, desat: 0, vig: 0.75, bloom: 1 },
  { name: 'Golden', tint: [1.08, 1.0, 0.88], sat: 0.12, warm: 1, desat: 0, vig: 0.85, bloom: 1.15 },
  { name: 'Dream', tint: [1.02, 0.98, 1.06], sat: 0.16, warm: 0.4, desat: 0, vig: 0.55, bloom: 2.0 },
  { name: 'Cool', tint: [0.9, 1.0, 1.1], sat: 0.02, warm: -0.6, desat: 0, vig: 0.8, bloom: 1 },
  { name: 'Mono', tint: [1, 1, 1], sat: 0, warm: 0, desat: 1, vig: 0.95, bloom: 0.9 },
];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.progress = new Progress();
    G.uNoiseTex.value = makeNoiseTexture(7);
    this.state = 'loading';
    this.hour = 16.9;
    this.day = 0;
    this.moonPhase = 0.42;
    this.time = 0;
    this.simTime = 0;
    this.settings = { timeScale: 2, autoCamera: true, reduceMotion: false, quality: 'auto', hints: true };
    this.ready = false;
    this.frames = 0;
    this.waypoint = null;
    this.goal = null;
    this.hintUntil = 0;
    this.currentBiome = 0;
    this._biomeT = 0;
    this.pulseCd = 0; this.pulseR = 0; this.pulseCount = 0;
    this.mapOpened = false;
    this.lookTotal = 0; this.maxClimbT = 0; this.boostT = 0;
    this.titleT = 0;
    this.filterIdx = 0;
    this.wisp = { x: 0, y: 0, z: 0, vis: 0, t: 0 };
    this.emitAcc = 0;
    this.trailAcc = 0;
    this.fin = null;
    this._capture = false;
    this.bw = new Float32Array(8);
    this.rnd = mulberry32(2718);
    this._autosave = 0;
    this._exploreT = 0;
    this._flapPrev = 0;
    this._boostPrev = 0;
    this._focusTime = 0;
    this._toastedPollen = false;
    this.ui = new UI(this, document.getElementById('ui'));
    attachScreens(this.ui);
    this._wire();
    this.applySavedSettings();
  }

  // ---- wiring ----------------------------------------------------------------------------------
  _wire() {
    const inp = this.input;
    inp.on('gesture', () => { if (!this.audio.ctx) this.audio.init(); this.audio.resume(); });
    inp.on('lockLost', () => { if (this.state === 'play') this.pause(); });
    inp.on('pad', (connected, kind) => {
      if (!this.ready) return;
      if (connected) { this.ui.toast(`${inp.padName} connected`, 'pad'); this.audio.play('connect'); setTimeout(() => inp.rumble(0.2, 0.6, 160), 150); }
      else { this.ui.toast('Controller disconnected', 'pad'); if (this.state === 'play') this.pause(); }
    });
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.save(); this.audio.suspend(); if (this.state === 'play') this.pause(); }
      else if (this.audio.ctx) this.audio.resume();
    });
    this.canvas.addEventListener('click', () => { if (this.state === 'play' && this.input.device === 'keyboard') this.input.requestPointerLock(); });
  }

  later(ms, fn) { setTimeout(fn, ms); }

  // ---- boot ------------------------------------------------------------------------------------
  async boot(onProgress = () => {}) {
    const rep = (f, l) => { onProgress(f, l); this.ui.setLoading(f, l); };
    const world = await generateWorld((f, l) => rep(f * 0.78, l));
    this.world = world;
    const eng = this.engine;
    rep(0.8, 'Growing the meadows');
    await new Promise((r) => setTimeout(r, 0));
    const tex = makeWorldTextures(world);
    this.tex = tex;
    this.terrain = new Terrain(world, tex, { range0: eng.preset.range0 });
    this.water = new Water(world, tex);
    this.grass = new Grass(tex, eng.preset);
    this.scatter = new Scatter(world, eng.preset);
    this.trees = new Trees(world, eng.preset);
    this.bf = new Butterflies(240);
    this.sky = new Sky();
    this.ambient = new AmbientParticles(tex);
    this.effects = new Effects();
    rep(0.86, 'Building the landmarks');
    await new Promise((r) => setTimeout(r, 0));
    this.landmarks = new Landmarks(world);
    this.spray = new FallSpray(world);
    this.stars = new Stars(world, this.progress, this.landmarks);
    this.stars.onCollect = (s) => this._collectStar(s);
    this.birds = new Birds(world);
    this.thermals = new Thermals(world);
    this.weather = new Weather();
    this.weather.setMood('fair', true);
    for (const o of [this.terrain.mesh, this.water.group, this.grass.group, this.scatter.group, this.trees.group, this.landmarks.group, this.spray.group, this.bf.group, this.birds.mesh, this.stars.mesh, this.ambient.group, this.effects.group, this.sky.mesh]) eng.scene.add(o);
    rep(0.92, 'Waking the butterflies');
    this.player = new Player(world, { trees: this.trees, scatter: this.scatter, thermals: this.thermals });
    this._bindPlayer();
    this.camRig = new CameraRig(eng.camera, world);
    this.fauna = new AmbientButterflies(world, this.scatter, 70);
    const s = world.spawn;
    this.spawn = { x: s.x, y: s.y + 4, z: s.z };
    this.player.species = this.progress.data.species || 0;
    this.player.teleport(s.x, s.y + 4, s.z, Math.PI);
    this.scatter.restoreBlooms(this.progress.data.blooms || []);
    this.scatter.prefill(this.player.pos);
    this.trees.force = true;
    this.setQuality(this.settings.quality, true);
    rep(1, 'Ready');
    this.ready = true;
    this.state = 'title';
    this.hour = 16.9;
    this.weather.setMood('fair', true);
    this.ui.title.open();
    this.ui.hudVisible(false);
    // one warm up frame so the first visible frame is complete
    this.update(1 / 60); this.render(1 / 60);
    this.later(350, () => this.ui.hideLoading());
  }

  _bindPlayer() {
    const p = this.player;
    p.events.sip = (ref) => this._onSip(ref);
    p.events.perchStart = () => { this.audio.play('land'); this.input.rumble(0.1, 0.3, 90); };
    p.events.landed = (ref) => { this.audio.play('land'); const h = this.scatter.headPosition(ref, new THREE.Vector3()); this.effects.burst(h, this._petalColor(ref), 10, 1.2, 0.9, 0.08); };
    p.events.perchEnd = () => { this.audio.play('takeoff'); };
    p.events.bump = (k) => { this.audio.play('bump'); this.input.rumble(0.5 * k + 0.25, 0.4, 110); };
    p.events.spin = () => { this.audio.play('species'); this.input.rumble(0.1, 0.5, 120); };
  }

  _petalColor(ref) {
    const f = FLOWERS[ref.species];
    const c = hexToLinear(f.petals[Math.min(ref.variant, f.petals.length - 1)]);
    return [Math.min(1.3, c[0] * 1.6 + 0.15), Math.min(1.3, c[1] * 1.6 + 0.15), Math.min(1.3, c[2] * 1.6 + 0.15)];
  }

  // ---- settings and quality -----------------------------------------------------------------------
  applySavedSettings() {
    const s = this.progress.settings;
    if (!s || !Object.keys(s).length) return;
    if (s.music !== undefined) this.audio.vol.music = s.music;
    if (s.sfx !== undefined) this.audio.vol.sfx = s.sfx;
    if (s.lookSpeed !== undefined) this.input.settings.lookSpeed = s.lookSpeed;
    if (s.invertY !== undefined) this.input.settings.invertY = s.invertY;
    if (s.vibration !== undefined) this.input.settings.vibration = s.vibration;
    if (s.deadzone !== undefined) this.input.settings.deadzone = s.deadzone;
    for (const k of ['autoCamera', 'reduceMotion', 'quality', 'timeScale', 'hints']) if (s[k] !== undefined) this.settings[k] = s[k];
    document.body.classList.toggle('rm', !!this.settings.reduceMotion);
    if (this.audio.ctx) this.audio.applyVolumes();
  }
  saveSettings() {
    const d = this.progress.data.settings;
    d.music = this.audio.vol.music; d.sfx = this.audio.vol.sfx; d.lookSpeed = this.input.settings.lookSpeed; d.invertY = this.input.settings.invertY;
    d.vibration = this.input.settings.vibration; d.deadzone = this.input.settings.deadzone;
    Object.assign(d, { autoCamera: this.settings.autoCamera, reduceMotion: this.settings.reduceMotion, quality: this.settings.quality, timeScale: this.settings.timeScale, hints: this.settings.hints });
    this.progress.dirty = true;
  }
  setQuality(name, silent = false) {
    this.settings.quality = name;
    const preset = name === 'auto' ? 'high' : name;
    this.engine.setQuality(preset);
    const p = this.engine.preset;
    this.terrain.setRange0(p.range0);
    this.grass.setQuality(p.grass);
    this.scatter.setQuality(p);
    this.trees.setQuality(p);
    this.engine.scale = 1;
    this.engine.resize(true);
  }

  // ---- state transitions ----------------------------------------------------------------------------
  beginPlay(cont, fresh = false) {
    if (this.state !== 'title') return;
    this.audio.init(); this.audio.resume();
    this.ui.fade(true);
    this.later(650, () => {
      const pr = this.progress;
      if (fresh) { this.scatter.blooms.forEach((b) => { b.n = 0; }); this.scatter.bloomList.length = 0; this.scatter.dirty = true; }
      const s = this.spawn;
      let x = s.x, y = s.y, z = s.z, yaw = Math.PI;
      if (cont && pr.data.pos) {
        const sp = pr.data.pos;
        const g = Math.max(this.world.heightAt(sp.x, sp.z), 0);
        x = sp.x; z = sp.z; y = Math.max(sp.y, g + 3); yaw = sp.yaw ?? Math.PI;
      }
      this.player.species = pr.data.species || 0;
      this.player.energy = 1; this.player.pollen = null;
      this.player.teleport(x, y, z, yaw);
      this.camRig.snapTo(this.player);
      this.hour = cont ? pr.data.time.hour : 9.4;
      this.day = pr.data.time.day || 0; this.moonPhase = pr.data.time.moon ?? 0.42;
      if (!cont) this.hour = 9.4;
      this.weather.setMood('fair', true);
      this.scatter.prefill(this.player.pos); this.trees.force = true;
      this.ui.title.close();
      this.state = 'play';
      this.ui.hudVisible(true);
      this.ui.fade(false);
      this.waypoint = null;
      if (!cont || !pr.discovered.windmill) this.ui.card('Welcome', 'Mariposa', 'Follow the light to discover the island.');
      this.audio.play('unlock');
    });
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.input.exitPointerLock(); this.input.stopRumble();
    this.ui.hudVisible(false);
    this.ui.open('pause');
    this.save();
  }
  openScreen(name) {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.input.exitPointerLock(); this.input.stopRumble();
    this.ui.hudVisible(false);
    if (name === 'map') this.mapOpened = true;
    this.ui.open(name);
  }
  resume() {
    this.ui.closeAll();
    if (this.state === 'pause') { this.state = 'play'; this.ui.hudVisible(true); this.audio.play('ui.close'); }
  }
  onScreensEmpty() {
    if (this.state === 'title') return;
    this.resume();
  }
  exitToTitle() {
    this.save();
    this.ui.closeAll();
    this.ui.fade(true);
    this.later(650, () => {
      this.state = 'title';
      this.hour = 16.9; this.weather.setMood('fair', true);
      this.player.mode = 'fly';
      this.ui.hudVisible(false);
      this.ui.title.open();
      this.ui.fade(false);
    });
  }
  enterPhoto() {
    if (this.state !== 'play' && this.state !== 'pause') return;
    this.ui.closeAll();
    this.state = 'photo';
    this.ui.hudVisible(false);
    this.camRig.mode = 'photo';
    this.camRig.free.dist = 5.5;
    this.engine.setPhoto(true);
    this.ui.photoScreen.open();
    this.audio.play('ui.open');
  }
  exitPhoto() {
    this.ui.photoScreen.close();
    this.engine.setPhoto(false);
    this.camRig.mode = 'follow';
    this._applyFilter(FILTERS[0]);
    this.filterIdx = 0;
    this.state = 'play';
    this.ui.hudVisible(true);
    this.audio.play('ui.close');
  }
  cycleFilter(d) {
    this.filterIdx = (this.filterIdx + d + FILTERS.length) % FILTERS.length;
    this._applyFilter(FILTERS[this.filterIdx]);
    this.ui.toast(FILTERS[this.filterIdx].name + ' filter', 'cam', 1800);
    this.audio.play('ui.toggle');
  }
  _applyFilter(f) {
    const u = this.engine.post.grade.uniforms;
    u.uTint.value.set(f.tint[0], f.tint[1], f.tint[2]);
    u.uWarmth.value = f.warm; u.uDesat.value = f.desat; u.uVignette.value = f.vig;
    this._filterSat = f.sat; this._filterBloom = f.bloom;
  }
  capturePhoto() { this._capture = true; }
  _doCapture() {
    this._capture = false;
    try {
      this.canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const d = new Date();
        a.download = `mariposa_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    } catch (e) { /* ignore */ }
    this.ui.flash();
    this.audio.play('shutter');
    this.ui.toast('Photo saved to your downloads', 'cam', 2600);
  }

  save() {
    if (!this.ready || !this.progress) return;
    const p = this.player;
    this.progress.data.species = p.species;
    this.progress.stats.distance += 0; // stats are kept live
    this.saveSettings();
    this.progress.save({
      pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw },
      time: { hour: this.hour, day: this.day, moon: this.moonPhase },
      blooms: (this.scatter.bloomList || []).slice(-700),
    });
  }

  // ---- helpers -----------------------------------------------------------------------------------
  biomeIndex(key) { return Math.max(0, BIOMES.findIndex((b) => b.key === key)); }
  timeLabel() {
    const h = this.hour;
    if (h < 4.6 || h >= 20.6) return 'Night';
    if (h < 6.6) return 'Dawn';
    if (h < 11) return 'Morning';
    if (h < 14) return 'Midday';
    if (h < 16.8) return 'Afternoon';
    if (h < 18.6) return 'Golden hour';
    return 'Dusk';
  }

  // ---- game events ---------------------------------------------------------------------------------
  _onSip(ref) {
    const p = this.player, pr = this.progress;
    const f = FLOWERS[ref.species];
    pr.taste(f.key);
    pr.stats.sips++;
    this.scatter.sip(ref, this.simTime);
    const head = this.scatter.headPosition(ref, new THREE.Vector3());
    const col = this._petalColor(ref);
    this.effects.burst(head, col, 20, 2.2, 1.2, 0.11);
    this.input.rumble(0.25, 0.5, 200);
    if (p.pollen !== null && p.pollen !== undefined && p.pollen !== ref.species) {
      // cross pollination: new flowers of both kinds bloom around this one
      pr.stats.pollinations++;
      const a = this.scatter.addBloom(ref.x, ref.y, ref.z, ref.species, 5, this.time, this.rnd);
      const b = this.scatter.addBloom(ref.x, ref.y, ref.z, p.pollen, 4, this.time, this.rnd);
      const pc = hexToLinear(FLOWERS[p.pollen].petals[0]).map((v) => Math.min(1.3, v * 1.6 + 0.15));
      this.effects.ring(head, col, 4.8, 54, 1.3, 0.16);
      this.effects.ring({ x: head.x, y: head.y + 0.4, z: head.z }, pc, 3.2, 40, 1.1, 0.13);
      this.effects.petalBurst(head, col, 16, 3);
      this.effects.petalBurst(head, pc, 12, 2.6);
      this.audio.play('pollinate');
      this.input.rumble(0.7, 0.9, 260);
      this.ui.toast(`Pollinated. ${f.name} and ${FLOWERS[p.pollen].name} bloom together`, 'bloom', 4200);
      p.energy = clamp(p.energy + 0.08, 0, 1);
      p.pollen = ref.species;
      pr.dirty = true;
    } else {
      p.pollen = ref.species;
      this.audio.play('sipDone');
      if (!this._toastedPollen) { this._toastedPollen = true; this.ui.toast('You carry pollen now. Sip a different flower to pollinate', 'bloom', 5200); }
    }
    this._unlockCheck();
  }

  _unlockCheck() {
    const pr = this.progress;
    const newly = pr.unlockCheck();
    for (const s of newly) {
      this.ui.toast(`New wings unlocked: ${SPECIES[s].name}. Wear them from the journal`, 'butterfly', 6000);
      this.audio.play('unlock');
    }
  }

  _collectStar(s) {
    const p = this.player;
    this.effects.burst(new THREE.Vector3(s.x, s.y, s.z), [1.2, 0.95, 0.4], 30, 3.2, 1.3, 0.14);
    this.effects.ring(new THREE.Vector3(s.x, s.y, s.z), [1.2, 0.9, 0.35], 3, 40, 1, 0.12);
    this.audio.play('star');
    this.input.rumble(0.15, 0.7, 140);
    p.energy = clamp(p.energy + 0.3, 0, 1);
    const n = this.progress.stats.stars;
    if (n % 12 === 0 || n === STAR_COUNT) this.ui.toast(`${n} of ${STAR_COUNT} dew stars gathered`, 'star', 3600);
    this._unlockCheck();
  }

  _discover(l) {
    const pr = this.progress;
    if (!pr.discover(l.id)) return;
    const lm = LANDMARKS.find((x) => x.id === l.id);
    this.ui.card('Discovered', lm.name, lm.blurb);
    this.audio.play('discover');
    this.input.rumble(0.3, 0.6, 320);
    this.effects.ring(new THREE.Vector3(this.player.pos.x, this.player.pos.y, this.player.pos.z), [1.2, 0.9, 0.5], 6, 60, 1.6, 0.16);
    this.effects.burst(this.player.pos, [1.2, 0.85, 0.5], 40, 3.4, 1.6, 0.14);
    if (this.waypoint && Math.hypot(this.waypoint.x - l.x, this.waypoint.z - l.z) < 120) this.waypoint = null;
    this._unlockCheck();
    if (pr.bloomPercent() >= 100 && !pr.finale) {
      this.ui.toast('The Heartbloom is ready to wake. Fly to the great tree', 'bloom', 6500);
      const h = this.world.landmark('heartbloom');
      this.waypoint = { x: h.x, z: h.z };
    }
    pr.dirty = true;
  }

  _pulse() {
    const p = this.player;
    if (this.pulseCd > 0 || p.mode !== 'fly' || p.energy < 0.04) return;
    this.pulseCd = 3.6; this.pulseR = 0.01; this.pulseCount++;
    this.pulseCenter = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    G.uPulse.value.set(p.pos.x, p.pos.y, p.pos.z, 0.01);
    p.energy = clamp(p.energy - 0.03, 0, 1);
    this.stars.pulse();
    this.hintUntil = this.time + 9;
    this.effects.ring(p.pos, [0.7, 0.95, 1.2], 30, 90, 1.7, 0.2);
    this.audio.play('pulse');
    this.input.rumble(0.3, 0.6, 260);
  }

  _startFinale() {
    const h = this.world.landmark('heartbloom');
    this.state = 'finale';
    this.fin = { t: 0, x: h.x, y: h.y + 74, z: h.z };
    this.ui.hudVisible(false);
    this.audio.play('finale');
    this.progress.data.finale = true; this.progress.dirty = true;
    this.ui.card('The Heartbloom', 'Awake', 'Every flower on the island remembers your wings.');
    this.input.rumble(0.6, 0.8, 900);
    this.fauna.attract = { x: h.x, y: h.y + 60, z: h.z, until: this.time + 60 };
    this.fauna.density = 1.6;
  }

  _updateFinale(dt) {
    const f = this.fin;
    f.t += dt;
    const t = f.t;
    // camera glides up and around the crown
    const a = 0.7 + t * 0.26, r = 175 + 75 * smoothstep(0, 10, t), y = f.y + 12 + t * 3.6;
    const cam = this.engine.camera;
    cam.position.set(f.x + Math.cos(a) * r, y, f.z + Math.sin(a) * r);
    cam.up.set(0, 1, 0);
    cam.lookAt(f.x, f.y - 6, f.z);
    if (Math.abs(cam.fov - 58) > 0.03) { cam.fov = damp(cam.fov, 58, 2, dt); cam.updateProjectionMatrix(); }
    // waves of petals and light around the crown
    this.finAcc = (this.finAcc || 0) + dt;
    while (this.finAcc > 0.04) {
      this.finAcc -= 0.04;
      const ang = this.rnd() * TAU, rr = 8 + this.rnd() * 85;
      const px = f.x + Math.cos(ang) * rr, pz = f.z + Math.sin(ang) * rr, py = f.y - 28 + this.rnd() * 60;
      this.effects.petalBit(px, py, pz, (this.rnd() - 0.5) * 3, 1.2 + this.rnd() * 1.5, (this.rnd() - 0.5) * 3, 4.5, 1.7, [1, 0.6 + this.rnd() * 0.3, 0.75 + this.rnd() * 0.2], (this.rnd() - 0.5) * 6);
      this.effects.spark(px, py, pz, (this.rnd() - 0.5) * 2, 2.2, (this.rnd() - 0.5) * 2, 3.4, 3.2, [1.2, 1.0, 0.75], { twinkle: 1 });
    }
    if (Math.floor(t * 1.2) !== Math.floor((t - dt) * 1.2) && t < 10) this.effects.ring({ x: f.x, y: f.y - 30, z: f.z }, [1.2, 0.9, 0.95], 60 + t * 9, 120, 2.6, 3.0);
    // the whole island glows
    const k = smoothstep(0, 3.5, t) * (1 - smoothstep(9, 14, t));
    this._finaleGlow = k;
    if (t > 16) {
      this.state = 'play'; this.fin = null; this._finaleGlow = 0;
      this.camRig.snapTo(this.player);
      this.ui.hudVisible(true);
      this._unlockCheck();
    }
  }

  // ---- update helpers -----------------------------------------------------------------------------------
  _playInput(dt) {
    const inp = this.input, a = inp.ap, p = this.player;
    if (a.pause) { this.pause(); return; }
    if (a.map) { this.openScreen('map'); return; }
    if (a.journal) { this.openScreen('journal'); return; }
    if (a.photo) { this.enterPhoto(); return; }
    if (a.interact && p.mode === 'fly' && p.focus) p.startPerch();
    if (a.pulse) this._pulse();
    if (a.dLeft) p.startSpin(-1);
    if (a.dRight) p.startSpin(1);
  }

  _sampleWorldAt(pos) {
    const w = this.world;
    w.biomeWeightsAt(pos.x, pos.z, this.bw);
    let best = 0, bv = -1;
    for (let b = 0; b < 8; b++) if (this.bw[b] > bv) { bv = this.bw[b]; best = b; }
    return best;
  }

  _emitters(dt, pos) {
    this.emitAcc += dt;
    if (this.emitAcc < 0.12) return;
    const n = Math.floor(this.emitAcc / 0.12);
    this.emitAcc -= n * 0.12;
    const night = G.uNight.value;
    const fx = this.effects, rnd = this.rnd;
    for (const e of this.landmarks.emitters) {
      const d = Math.hypot(e.x - pos.x, e.z - pos.z);
      if (d > e.r + 200) continue;
      const near = 1 - smoothstep(e.r * 0.6, e.r + 200, d);
      for (let k = 0; k < n; k++) {
        const ang = rnd() * TAU, rr = Math.sqrt(rnd()) * e.r * 0.6;
        const x = e.x + Math.cos(ang) * rr, z = e.z + Math.sin(ang) * rr;
        if (e.kind === 'blossom') { if (rnd() < 0.5 * near) fx.petalBit(x, e.y - rnd() * 6, z, (rnd() - 0.5), -0.3, (rnd() - 0.5), 5, 0.13, [1, 0.62 + rnd() * 0.2, 0.78], (rnd() - 0.5) * 5); }
        else if (e.kind === 'leaves') { if (rnd() < 0.5 * near) fx.petalBit(x, e.y - rnd() * 6, z, (rnd() - 0.5), -0.4, (rnd() - 0.5), 5, 0.17, [0.95, 0.4 + rnd() * 0.4, 0.12], (rnd() - 0.5) * 6); }
        else if (e.kind === 'glow') { if (rnd() < (0.35 + 0.65 * night) * near) fx.spark(x, this.world.heightAt(x, z) + 0.6, z, (rnd() - 0.5) * 0.4, 0.5 + rnd() * 0.8, (rnd() - 0.5) * 0.4, 3.5, 0.18, rnd() < 0.5 ? [0.3, 1.0, 0.9] : [0.75, 0.5, 1.2], { twinkle: 1, drag: 0.2 }); }
        else if (e.kind === 'spark') { if (rnd() < 0.5 * near) fx.spark(x, e.y - 2 + rnd() * 4, z, (rnd() - 0.5) * 0.3, 0.4, (rnd() - 0.5) * 0.3, 2.6, 0.13, [0.6, 0.95, 1.2], { twinkle: 1, drag: 0.3 }); }
        else if (e.kind === 'moon') { if (rnd() < (0.3 + 0.7 * night) * near) fx.spark(e.x + (rnd() - 0.5) * 4, e.y - 1.8 + rnd() * 0.5, e.z + (rnd() - 0.5) * 4, (rnd() - 0.5) * 0.3, 0.9 + rnd(), (rnd() - 0.5) * 0.3, 3.2, 0.14, [0.7, 0.85, 1.3], { twinkle: 1, drag: 0.25 }); }
        else if (e.kind === 'mist' && this.landmarks.mist) { const m = this.landmarks.mist; if (rnd() < 0.8 * near) fx.spark(m.x + (rnd() - 0.5) * 30, m.y + rnd() * 3, m.z + (rnd() - 0.5) * 30, (rnd() - 0.5) * 0.8, 0.9 + rnd() * 1.4, (rnd() - 0.5) * 0.8, 4.5, 2.2 + rnd() * 2, [0.42, 0.5, 0.56], { drag: 0.15, size1: 5 }); }
      }
    }
  }

  _thermalFx(dt, pos) {
    if (this.thermals.active < 0.12) return;
    this._thAcc = (this._thAcc || 0) + dt;
    if (this._thAcc < 0.09) return;
    const n = Math.floor(this._thAcc / 0.09);
    this._thAcc -= n * 0.09;
    const list = this.thermals.near(pos.x, pos.z, 190, this._thBuf || (this._thBuf = []));
    const fx = this.effects, rnd = this.rnd;
    for (const t of list) {
      const near = 1 - smoothstep(60, 190, Math.hypot(t.x - pos.x, t.z - pos.z));
      for (let k = 0; k < n * 2; k++) {
        if (rnd() > 0.35 + 0.65 * near) continue;
        const a = rnd() * TAU, r = Math.sqrt(rnd()) * t.r * 0.85;
        const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        const y = Math.max(this.world.heightAt(x, z), t.y) + 0.5 + rnd() * 6;
        fx.spark(x, y, z, (rnd() - 0.5) * 0.5, 3.0 + rnd() * 3.5, (rnd() - 0.5) * 0.5, 3.2 + rnd() * 1.4, 0.15 + rnd() * 0.1, [1.0, 0.86 + rnd() * 0.1, 0.62], { twinkle: 1, drag: 0.1, size1: 0.05 });
      }
    }
  }

  _trail(dt) {
    const p = this.player;
    if (p.mode === 'perch') return;
    const spd = p.hspeed;
    const rate = (spd > 1 ? 16 + p.boostAmt * 30 : 5) * (p.glide ? 0.5 : 1);
    this.trailAcc += dt * rate;
    const v = p.visual;
    const col = p.pollen !== null && p.pollen !== undefined ? this._petalColor({ species: p.pollen, variant: 0 }) : TRAIL[p.species] || TRAIL[0];
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    while (this.trailAcc >= 1) {
      this.trailAcc -= 1;
      const s = 0.28 * (0.6 + this.rnd() * 0.8);
      const side = (this.rnd() - 0.5) * 0.9;
      this.effects.spark(v.x - fx * 0.45 - fz * side, v.y - 0.1 + (this.rnd() - 0.5) * 0.3, v.z - fz * 0.45 + fx * side, (this.rnd() - 0.5) * 0.3, -0.05 - this.rnd() * 0.25, (this.rnd() - 0.5) * 0.3, 1.0 + this.rnd() * 0.9, 0.09 * s * 3, col, { twinkle: 1, drag: 1.2, grav: 0.05 });
    }
    if (p.skim > 0.35 && spd > 2.5) {
      this._skimAcc = (this._skimAcc || 0) + dt * 22;
      while (this._skimAcc >= 1) {
        this._skimAcc -= 1;
        const wl = this.world.waterLevelAt(p.pos.x, p.pos.z);
        if (wl !== null) this.effects.spark(p.pos.x + (this.rnd() - 0.5) * 0.8, wl + 0.05, p.pos.z + (this.rnd() - 0.5) * 0.8, (this.rnd() - 0.5) * 1.2, 1.4 + this.rnd() * 1.6, (this.rnd() - 0.5) * 1.2, 0.7, 0.09, [0.85, 0.95, 1.1], { grav: 5, drag: 0.4 });
      }
    }
  }

  _wisp(dt) {
    const w = this.wisp, p = this.player, pr = this.progress;
    // choose a goal: the player waypoint, otherwise the nearest undiscovered place
    let goal = this.waypoint ? { x: this.waypoint.x, z: this.waypoint.z } : null;
    if (!goal) {
      let best = null, bd = 1e9;
      for (const l of this.world.landmarks) {
        if (pr.discovered[l.id]) continue;
        const d = Math.hypot(l.x - p.pos.x, l.z - p.pos.z);
        if (d < bd) { bd = d; best = l; }
      }
      if (best) goal = { x: best.x, z: best.z, id: best.id };
    }
    this.goal = goal;
    const show = this.settings.hints && goal && this.state === 'play' && p.mode !== 'perch';
    if (this.waypoint && Math.hypot(this.waypoint.x - p.pos.x, this.waypoint.z - p.pos.z) < 30) { this.waypoint = null; this.ui.toast('Waypoint reached', 'pin', 2400); }
    w.vis = damp(w.vis, show ? 1 : 0, 1.6, dt);
    if (w.vis < 0.02 || !goal) return;
    w.t += dt;
    const dx = goal.x - p.pos.x, dz = goal.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const lead = Math.min(d, 22 + Math.min(p.hspeed, 20) * 0.6);
    const tx = p.pos.x + (dx / d) * lead, tz = p.pos.z + (dz / d) * lead;
    const gy = Math.max(this.world.heightAt(tx, tz), 0);
    const ty = Math.max(gy + 4.5, p.pos.y * 0.5 + gy * 0.5 + 1.5) + Math.sin(w.t * 1.7) * 0.6;
    w.x = damp(w.x || tx, tx + Math.cos(w.t * 1.3) * 1.2, 1.4, dt);
    w.z = damp(w.z || tz, tz + Math.sin(w.t * 1.1) * 1.2, 1.4, dt);
    w.y = damp(w.y || ty, ty, 1.4, dt);
    this._wispAcc = (this._wispAcc || 0) + dt * 26;
    while (this._wispAcc >= 1) {
      this._wispAcc -= 1;
      this.effects.spark(w.x + (this.rnd() - 0.5) * 0.3, w.y + (this.rnd() - 0.5) * 0.3, w.z + (this.rnd() - 0.5) * 0.3, (this.rnd() - 0.5) * 0.4, (this.rnd() - 0.5) * 0.4, (this.rnd() - 0.5) * 0.4, 1.2, 0.16 * w.vis, [0.75, 1.0, 1.15], { twinkle: 1, drag: 1 });
    }
    this.effects.spark(w.x, w.y, w.z, 0, 0, 0, 0.07, 0.34 * w.vis, [0.55, 0.85, 1.0], { size1: 0.3, drag: 1 });
  }

  _tutorial(dt) {
    const ui = this.ui, p = this.player, pr = this.progress;
    if (!this.settings.hints || this.state !== 'play') { if (this.state !== 'play') ui.clearHint(); return; }
    const tut = pr.data.tutorial;
    const steps = [
      { id: 'move', text: 'Push to fly', html: (f) => glyph('move', f), done: () => pr.stats.distance > 25 },
      { id: 'look', text: 'Look around', html: (f) => glyph('look', f), done: () => this.lookTotal > 1.5 },
      { id: 'climb', text: 'Hold to climb, or dive with the trigger', html: (f) => glyph('climb', f) + glyph('descend', f), done: () => this.maxClimbT > 1.2 },
      { id: 'boost', text: 'Hold to boost. It spends energy', html: (f) => glyph('boost', f), done: () => this.boostT > 1.2 },
      { id: 'sip', text: 'Fly close to a flower and hold to sip nectar', html: (f) => glyph('interact', f), done: () => pr.stats.sips >= 1 },
      { id: 'pulse', text: 'Send out a pulse to find dew stars', html: (f) => glyph('pulse', f), done: () => this.pulseCount >= 1 },
      { id: 'map', text: 'Open your map to see where you have been', html: (f) => glyph('map', f), done: () => this.mapOpened },
    ];
    const cur = steps.find((s) => !tut[s.id]);
    if (!cur) { ui.clearHint(); return; }
    this._tutT = (this._tutT || 0) + dt;
    if (this._tutId !== cur.id) { this._tutId = cur.id; this._tutT = 0; ui.hint(cur.html, cur.text, 60000); }
    if (cur.done() || this._tutT > 28) { tut[cur.id] = true; pr.dirty = true; ui.clearHint(); this._tutId = null; this._tutT = -1.5; }
  }

  // ---- main update ------------------------------------------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    G.uTime.value = this.time;
    const input = this.input;
    input.update(dt);
    const eng = this.engine;
    const p = this.player;
    const st = this.state;

    // screens and menus
    if (st === 'title') { if (!this.ui.current) this.ui.title.update(dt, input); else this.ui.updateScreens(dt, input); }
    else if (st === 'pause') this.ui.updateScreens(dt, input);
    else if (st === 'photo') this.ui.photoScreen.update(dt, input);
    else if (st === 'play') this._playInput(dt);

    const running = st === 'play' || st === 'title' || st === 'photo' || st === 'finale';
    const active = st === 'play' || st === 'finale' || st === 'photo';
    if (running) this.simTime += dt;

    // time of day and weather
    if (running) {
      const rate = st === 'title' ? 0 : [0, 24 / (24 * 60), 24 / (14 * 60), 24 / (6 * 60)][this.settings.timeScale] ?? 24 / (14 * 60);
      this.hour += rate * dt;
      if (this.hour >= 24) { this.hour -= 24; this.day++; this.moonPhase = (this.moonPhase + 0.125) % 1; }
      const sunElev = this.atmo ? this.atmo.elev : 0.5;
      this.weather.update(dt, this.hour, sunElev);
    }
    const ws = this.weather.state;
    const info = applyAtmosphere(G, this.hour, ws, this.moonPhase);
    this.atmo = info;
    const night = G.uNight.value;
    // wind
    const wa = 0.9 + 0.5 * Math.sin(this.time * 0.011);
    G.uWind.value.set(Math.cos(wa), Math.sin(wa), 1.0, 0.5 * ws.wind);
    if (running) { G.uCloudOffset.value.x += dt * 0.0011 * ws.wind; G.uCloudOffset.value.y += dt * 0.0006 * ws.wind; }
    this.sky.uRainbow.value = this.weather.rainbow;

    // butterfly and camera
    let camControl = st === 'play' || st === 'photo';
    if (st === 'title') {
      this.titleT += dt;
      const s = this.spawn, t = this.titleT;
      // the butterfly loops lazily in front of a low camera that looks north toward the Heartbloom
      const cx = s.x + 1, cz = s.z - 3.5;
      const ang = t * 0.30;
      const rx = 6.5, rz = 3.4;
      const x = cx + Math.cos(ang) * rx, z = cz + Math.sin(ang) * rz;
      const gy = Math.max(this.world.heightAt(x, z), 0);
      p.pos.set(x, gy + 3.1 + Math.sin(t * 0.7) * 0.7, z);
      const vx = -Math.sin(ang) * rx * 0.30, vz = Math.cos(ang) * rz * 0.30;
      p.vel.set(vx, Math.cos(t * 0.7) * 0.4, vz);
      p.yaw = Math.atan2(vx, vz);
      p.hspeed = Math.hypot(vx, vz); p.mode = 'fly'; p.boostAmt = 0; p.glide = false; p.brake = false; p.climbAmt = 0;
      p._animate(dt, { descend: 0 }, false);
      p.roll = damp(p.roll, Math.cos(ang) * -0.28, 3, dt);
      const camx = s.x + 5 * Math.sin(t * 0.11), camz = s.z + 5 + 1.5 * Math.cos(t * 0.08);
      const cgy = Math.max(this.world.heightAt(camx, camz), 0);
      const cam = this.engine.camera;
      cam.position.set(camx, cgy + 1.7 + 0.4 * Math.sin(t * 0.13), camz);
      cam.up.set(0, 1, 0);
      cam.lookAt(p.pos.x * 0.85 + cx * 0.15, p.pos.y * 0.6 + gy * 0.4 + 1.5, p.pos.z * 0.85 + cz * 0.15);
      if (Math.abs(cam.fov - 46) > 0.03) { cam.fov = damp(cam.fov, 46, 3, dt); cam.updateProjectionMatrix(); }
      this.camRig.pos.copy(cam.position);
    } else if (st === 'finale') {
      this._updateFinale(dt);
    } else if (running) {
      p.update(dt, input, this.camRig.yaw, { night, rain: ws.rain, time: this.simTime, canControl: st === 'play', colliders: this.landmarks.colliders });
      if (st === 'photo') {
        const f = this.camRig.free;
        f.dist = clamp(f.dist + (input.a.boost - input.a.descend) * dt * 5, 1.6, 22);
        this.camRig.mode = 'photo';
      }
      this.camRig.update(dt, p, input, { auto: this.settings.autoCamera && st === 'play', reduceMotion: this.settings.reduceMotion });
      this.lookTotal += Math.abs(input.lookDelta.x) + Math.abs(input.lookDelta.y);
      if (input.a.climb > 0.5) this.maxClimbT += dt;
      if (input.a.boost > 0.5) this.boostT += dt;
      p.stats.distance; // stats live in progress
      this.progress.stats.distance += p.hspeed * dt * (st === 'play' ? 1 : 0);
      this.progress.stats.playSeconds += st === 'play' ? dt : 0;
    }
    this.thermals.active = smoothstep(0.1, 0.35, info.elev) * (1 - ws.rain);

    // gameplay rules while flying
    if (st === 'play') {
      this._biomeT -= dt;
      if (this._biomeT <= 0) {
        this._biomeT = 0.4;
        const b = this._sampleWorldAt(p.pos);
        if (b !== this.currentBiome && this.bw[b] > 0.5) this.currentBiome = b;
      }
      const lm = this.landmarks.check(p.pos);
      if (lm) this._discover(lm);
      this._exploreT -= dt;
      if (this._exploreT <= 0) { this._exploreT = 0.5; this.progress.explore(p.pos.x, p.pos.z, 110); }
      this.pulseCd = Math.max(0, this.pulseCd - dt);
      this.scatter.regrow(this.simTime);
      // heartbloom awakening
      const pr = this.progress;
      if (!pr.finale && pr.bloomPercent() >= 100) {
        const h = this.world.landmark('heartbloom');
        if (Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < 110) this._startFinale();
      }
      if (p.lift > 1.6 && !this._thermalToast) { this._thermalToast = true; this.ui.toast('Warm air is lifting you. Ride it upward', 'sun', 4200); }
      this._autosave += dt;
      if (this._autosave > 25) { this._autosave = 0; this.save(); }
      this._wisp(dt);
      this._tutorial(dt);
      // haptic wing beats
      const flapPh = Math.floor(p.flapPhase / TAU);
      if (flapPh !== this._flapPrev) { this._flapPrev = flapPh; if (p.mode === 'fly' && !p.glide) input.rumble(0, 0.04 + p.boostAmt * 0.14, 55); }
      const bo = p.boostAmt > 0.5 ? 1 : 0;
      if (bo && !this._boostPrev) { this.audio.play('boost'); input.rumble(0.35, 0.3, 200); }
      this._boostPrev = bo;
      if (p.exhausted && !this._wasTired) { this.audio.play('tired'); }
      this._wasTired = p.exhausted;
    }
    if (this.pulseR > 0) {
      this.pulseR += dt * 92;
      if (this.pulseR > 160) { this.pulseR = 0; G.uPulse.value.w = 0; }
      else G.uPulse.value.w = this.pulseR;
    }

    // uniforms
    const glow = GLOW[p.species] || GLOW[0];
    G.uGlowColor.value.setRGB(glow[0], glow[1], glow[2]);
    G.uPlayerPos.value.copy(p.pos);
    G.uPlayerGlow.value.set(p.pos.x, p.pos.y, p.pos.z, night * 0.42 * (SPECIES[p.species].glow > 0.3 ? 1.3 : 1));
    G.uPerch.value.set(p.target ? p.target.x : 0, 0, p.target ? p.target.z : 0, p.mode === 'perch' ? 1 : 0);

    const grade = eng.post.grade.uniforms;
    const fin = this._finaleGlow || 0;
    G.uFinale.value = fin;
    grade.uExposure.value = info.exposure * (1 + fin * 0.35);
    grade.uSaturation.value = info.saturation + (this._filterSat || 0) + fin * 0.1;
    eng.post.bloom.strength = (info.bloom + fin * 0.6) * (this._filterBloom || 1);
    const edge = p.edge;
    grade.uFade.value = 1 - edge * 0.5;

    eng.camera.updateMatrixWorld();
    eng.camera.matrixWorldInverse.copy(eng.camera.matrixWorld).invert();
    const cam = eng.camera.position;
    this.terrain.update(eng.camera);
    this.grass.update(eng.camera);
    this.scatter.update(cam);
    this.trees.update(cam);
    this.sky.mesh.position.copy(cam);
    this.landmarks.update(dt, this.time);
    this.spray.update(this.engine.camera);

    // creatures and particles
    this.bf.begin();
    const v = p.visual;
    const sizeK = st === 'title' ? 1.35 : 1;
    this.bf.add(p.species, v.x, v.y, v.z, 1.22 * sizeK, v.yaw, v.pitch, v.roll, v.flap, v.flapV, 1.0, undefined);
    if (this.fauna.attract && this.time > this.fauna.attract.until) { this.fauna.attract = null; this.fauna.density = 1; }
    if (running) this.fauna.update(dt, p.pos, night, ws.rain, this.time, p.pos, p.species, this.bf);
    this.bf.end();
    if (running) {
      this.birds.update(dt, this.time, cam, night, ws.rain);
      if (active) { this._trail(dt); }
      this._emitters(dt, p.pos);
      this._thermalFx(dt, p.pos);
      this.stars.update(dt, this.time, p.pos, this.pulseCenter);
      this.effects.update(dt);
      // ambient particle densities from the biome under the camera
      this._sampleWorldAt(cam);
      const bw = this.bw;
      const day = 1 - night;
      const alt = cam.y - this.world.heightAt(cam.x, cam.z);
      this.ambient.update(dt, cam, {
        motes: day * (1 - ws.rain) * (0.4 * bw[0] + 0.55 * bw[1] + 0.8 * bw[2] + 0.35 * bw[3] + 0.5 * bw[4] + 0.2 * bw[5] + 0.5 * bw[6]) + 0.08 * day,
        petals: (bw[1] * 0.95 + (this.progress.finale ? 0.08 : 0)) * (1 - ws.rain * 0.6),
        leaves: bw[6] * 0.9 * (1 - ws.rain * 0.5),
        fireflies: night * (1 - ws.rain) * clamp(0.5 * bw[0] + 0.7 * bw[1] + 0.5 * bw[2] + 1.0 * bw[3] + 0.9 * bw[4] + 0.6 * bw[6] + 0.2 * bw[7], 0, 1),
        snow: bw[5] * (0.1 + 0.9 * ws.overcast) * smoothstep(90, 160, cam.y) * (1 - ws.rain),
        rain: ws.rain > 0.06 ? clamp(ws.rain, 0, 1) : 0,
      });
    }

    // interface
    this.ui.update(dt, { showHud: st === 'play', showChips: false, tired: true });

    // audio
    this._audioUpdate(dt, info, night, ws, st);
    // controller only players: some browsers do not treat a pad press as a user gesture, so sound waits for a key or click
    const ac = this.audio.ctx;
    if (ac && ac.state === 'suspended' && this.input.device === 'pad' && !document.hidden && st !== 'loading') {
      this._soundWait = (this._soundWait || 0) + dt;
      if (this._soundWait > 2.4 && !this._soundHinted) { this._soundHinted = true; this.ui.toast('Click or press a key once to switch the sound on', 'sound', 7000); }
    } else this._soundWait = 0;
    if (this.progress.dirty && !this._saveQueued && st === 'play') { /* autosave timer handles */ }
    this.frames++;
  }

  _audioUpdate(dt, info, night, ws, st) {
    const a = this.audio;
    if (!a.ready) return;
    const p = this.player, w = this.world;
    const pos = p.pos;
    let lake = 0;
    for (const lk of w.lakes) {
      const dx = pos.x - lk.x, dz = pos.z - lk.z, c = Math.cos(lk.rot), s = Math.sin(lk.rot);
      const t = Math.hypot((dx * c + dz * s) / lk.rx, (-dx * s + dz * c) / lk.rz);
      const near = 1 - smoothstep(1.0, 2.6, t);
      lake = Math.max(lake, near * (lk.level > 0.5 ? 1 : 0));
    }
    const cs = w.coastAt(pos.x, pos.z);
    const sea = 1 - smoothstep(0, 380, Math.abs(cs > 0 ? cs : cs * 0.3));
    let falls = 0;
    if (w.falls) { const d = Math.hypot(pos.x - (w.falls.top.x + w.falls.base.x) / 2, pos.z - (w.falls.top.z + w.falls.base.z) / 2); falls = 1 - smoothstep(30, 300, d); }
    const g = w.heightAt(pos.x, pos.z);
    const above = Math.max(0, pos.y - g);
    const bw = this.bw;
    w.biomeWeightsAt(pos.x, pos.z, this._abw || (this._abw = new Float32Array(8)));
    const b = this._abw;
    const grass = w.sampleMap(w.flora, pos.x, pos.z, 0) * (1 - smoothstep(0.6, 4.5, above));
    const fdens = w.sampleMap(w.flora, pos.x, pos.z, 2);
    const bees = fdens * (b[2] * 1.0 + b[0] * 0.6 + b[1] * 0.4) * (1 - smoothstep(2, 9, above));
    const birdDensity = clamp(b[3] * 1.0 + b[1] * 0.9 + b[0] * 0.7 + b[4] * 0.4 + b[6] * 0.8 + b[7] * 0.15 + b[2] * 0.5, 0, 1);
    const mood = [1, 1, 0.9, 0.7, 0.75, 0.6, 0.85, 0.85][this.currentBiome];
    a.update(dt, {
      night, biome: this.currentBiome, rain: ws.rain, wind: ws.wind, speed: p.speed, alt: pos.y, boost: p.boostAmt, perched: p.mode === 'perch',
      grass, lake: lake * (1 - smoothstep(20, 120, above)), sea: sea * (1 - smoothstep(60, 320, above)), falls, bees, birdDensity, hour: this.hour,
      flap: p.mode === 'fly' && !p.glide && st === 'play', flapAmp: p._flapAmp, flapRate: p._flapFreq / 4, paused: st === 'pause', moodMelody: mood, moodOct: this.currentBiome === 5 ? 12 : 0,
    });
  }

  render(dt) {
    this.engine.render(dt);
    if (this._capture) this._doCapture();
  }

  frame(dt) { this.update(dt); this.render(dt); }

  // Test helper: skip the title and start flying immediately at a position.
  debugPlay(x = this.spawn.x, z = this.spawn.z, alt = 4, yaw = Math.PI, hour = 10) {
    this.ui.closeAll();
    this.ui.title.close();
    this.ui.el.title.classList.add('hidden');
    this.state = 'play';
    this.ui.hudVisible(true);
    const g = Math.max(this.world.heightAt(x, z), 0);
    this.player.teleport(x, g + alt, z, yaw);
    this.camRig.snapTo(this.player);
    this.hour = hour;
    this.weather.setMood('fair', true);
    this.progress.data.tutorial = { move: 1, look: 1, climb: 1, boost: 1, sip: 1, pulse: 1, map: 1 };
    this.scatter.prefill(this.player.pos); this.trees.force = true;
    return this.debugInfo();
  }

  // Test helper: run the simulation deterministically for `seconds` at 60 Hz, rendering only the last frame.
  advance(seconds, renderLast = true) {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) { this.update(1 / 60); if (renderLast && i === n - 1) this.render(1 / 60); }
    return this.debugInfo();
  }

  debugInfo() {
    const p = this.player;
    return {
      x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(1), z: +p.pos.z.toFixed(1), hs: +p.hspeed.toFixed(2), vy: +p.vel.y.toFixed(2), mode: p.mode, energy: +p.energy.toFixed(2),
      yaw: +p.yaw.toFixed(2), camYaw: +this.camRig.yaw.toFixed(2), state: this.state, hour: +this.hour.toFixed(2), biome: BIOMES[this.currentBiome].key, dev: this.input.device, pad: this.input.padKind,
      bloom: this.progress.bloomPercent(), stars: this.progress.stats.stars, pollen: p.pollen, sips: this.progress.stats.sips,
    };
  }

  start() {
    let last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (this.ready) { this.frame(dt); this.engine.adapt(dt, this.settings.quality === 'auto'); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
