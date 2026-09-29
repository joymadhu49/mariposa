// Procedural audio: generative music, layered ambience and sound effects. No sample files.
import { clamp, lerp, smoothstep, mulberry32 } from './util.js';

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// D based scales
const SCALES = {
  bright: [0, 2, 4, 7, 9], // major pentatonic
  dusk: [0, 2, 3, 7, 9], // dorian flavour
  night: [0, 3, 5, 7, 10], // minor pentatonic
};
// chord progression roots (semitones from D) with chord shapes
const PROG = [
  { root: 0, ch: [0, 7, 12, 16, 19] },   // D
  { root: 7, ch: [0, 7, 12, 14, 19] },   // A add9
  { root: -3, ch: [0, 7, 12, 15, 19] },  // Bm
  { root: 5, ch: [0, 7, 12, 16, 21] },   // G6
  { root: 0, ch: [0, 7, 12, 14, 16] },   // D add9
  { root: 2, ch: [0, 7, 12, 16, 19] },   // Em7-ish
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.vol = { master: 0.8, music: 0.7, sfx: 0.8 };
    this.rnd = mulberry32(31337);
    this.t = 0;
    this.next = { chord: 0, note: 0, bird: 0, flap: 0 };
    this.chordIdx = 0;
    this.state = { night: 0, biome: 0, rain: 0, wind: 0.3, speed: 0, alt: 0, water: 0, falls: 0, boost: 0, perched: false, grass: 0, hour: 10, lake: 0, sea: 0 };
    this.voices = 0;
    this.mood = { cutoff: 1400, melody: 1, octave: 0 };
    this.lastBiome = -1;
  }

  // Create (or reuse) the audio context. Safe to call repeatedly from user gestures.
  init(ctxOverride = null) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctxOverride && !AC) return;
    const ctx = ctxOverride || new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 3.2; comp.attack.value = 0.008; comp.release.value = 0.3;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.08;
    master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);
    this.master = master;
    this.musicBus = ctx.createGain(); this.ambBus = ctx.createGain(); this.sfxBus = ctx.createGain();
    this.musicBus.connect(master); this.ambBus.connect(master); this.sfxBus.connect(master);
    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.6, 2.4);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.55;
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.7;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.reverbOut); this.reverbOut.connect(master);
    this.noiseBuf = this._noise(4);
    this.pinkBuf = this._pink(6);
    this._buildAmbience();
    this.applyVolumes();
    this.ready = true;
    master.gain.setTargetAtTime(this.enabled ? 1 : 0, ctx.currentTime, 0.6);
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') { const p = this.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? this.vol.master : 0, t, 0.15);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.9, t, 0.2);
    this.ambBus.gain.setTargetAtTime(this.vol.sfx * 0.8, t, 0.2);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.2);
  }

  _noise(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = this.rnd() * 2 - 1; }
    return b;
  }
  _pink(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = this.rnd() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
      // seamless loop: crossfade the tail into the head
      const f = Math.floor(ctx.sampleRate * 0.25);
      for (let i = 0; i < f; i++) { const t = i / f; d[i] = d[i] * t + d[n - f + i] * (1 - t); }
    }
    return b;
  }
  _impulse(seconds, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const e = Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
        lp += ((this.rnd() * 2 - 1) - lp) * (0.35 - 0.28 * t);
        d[i] = lp * e * 1.6;
      }
    }
    return b;
  }

  // looping noise source through a filter chain, returns { gain, filters }
  _noiseLoop(buf, type, freq, q, gainNode) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.loopStart = 0.3;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); f.connect(gainNode);
    src.start(0, this.rnd() * 2);
    return { src, filter: f };
  }

  _buildAmbience() {
    const ctx = this.ctx;
    const mk = (dest, v = 0) => { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; };
    // wind: low body plus airy hiss
    this.windLow = mk(this.ambBus); this.windHi = mk(this.ambBus);
    this.windLowF = this._noiseLoop(this.pinkBuf, 'lowpass', 380, 0.5, this.windLow);
    this.windHiF = this._noiseLoop(this.noiseBuf, 'bandpass', 1900, 0.5, this.windHi);
    // water
    this.waterG = mk(this.ambBus); this.waterF = this._noiseLoop(this.pinkBuf, 'bandpass', 700, 0.4, this.waterG);
    this.seaG = mk(this.ambBus); this.seaF = this._noiseLoop(this.pinkBuf, 'lowpass', 500, 0.6, this.seaG);
    this.fallsG = mk(this.ambBus); this.fallsF = this._noiseLoop(this.noiseBuf, 'lowpass', 3200, 0.4, this.fallsG);
    this.fallsF2 = this._noiseLoop(this.pinkBuf, 'lowpass', 900, 0.3, this.fallsG);
    // rain
    this.rainG = mk(this.ambBus); this.rainF = this._noiseLoop(this.pinkBuf, 'bandpass', 2400, 0.45, this.rainG); this.rainF2 = this._noiseLoop(this.noiseBuf, 'bandpass', 3800, 0.6, this.rainG);
    // grass rustle
    this.grassG = mk(this.ambBus); this.grassF = this._noiseLoop(this.noiseBuf, 'bandpass', 3400, 0.8, this.grassG);
    // crickets: pulsed oscillators
    this.cricketG = mk(this.ambBus);
    this.crickets = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4100 + i * 230;
      const am = ctx.createGain(); am.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 26 + i * 3.7;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      const chirpLfo = ctx.createOscillator(); chirpLfo.frequency.value = 2.1 + i * 0.37; const cg = ctx.createGain(); cg.gain.value = 0.4; chirpLfo.connect(cg); cg.connect(am.gain);
      const off = ctx.createConstantSource ? ctx.createConstantSource() : null;
      if (off) { off.offset.value = 0.45; off.connect(am.gain); off.start(); }
      o.connect(am); am.connect(this.cricketG);
      o.start(); lfo.start(); chirpLfo.start();
      this.crickets.push({ o, am });
    }
    // bees
    this.beeG = mk(this.ambBus);
    const bo = ctx.createOscillator(); bo.type = 'sawtooth'; bo.frequency.value = 172;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 420; bf.Q.value = 1.4;
    const vib = ctx.createOscillator(); vib.frequency.value = 6.2; const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg); vg.connect(bo.frequency);
    bo.connect(bf); bf.connect(this.beeG); bo.start(); vib.start();
    // bass drone under the music
    this.droneG = mk(this.musicBus);
    const d1 = ctx.createOscillator(); d1.type = 'sine'; d1.frequency.value = midi(38);
    const d2 = ctx.createOscillator(); d2.type = 'triangle'; d2.frequency.value = midi(38) * 1.004;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 220;
    d1.connect(dl); d2.connect(dl); dl.connect(this.droneG);
    d1.start(); d2.start();
    this.drone = { d1, d2 };
  }

  // ---- helpers for scheduled voices --------------------------------------------------------
  _now() { return this.ctx.currentTime; }

  _voice(dur) {
    this.voices++;
    setTimeout(() => { this.voices--; }, Math.max(0, dur) * 1000 + 100);
  }

  bell(freq, when, vel = 0.5, dur = 2.6, bus = this.musicBus, send = 0.8, pan = 0) {
    if (!this.ready || this.voices > 70) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vel * 0.16, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    const parts = [[1, 1], [2.0, 0.34], [3.01, 0.16], [4.2, 0.06]];
    for (const [ratio, amp] of parts) {
      if (freq * ratio > 15000) continue; // partials above hearing comfort are dropped
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * ratio;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(g);
      o.start(when); o.stop(when + dur + 0.05);
    }
    if (p) { g.connect(p); p.connect(bus); const s = ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(this.reverbSend); }
    else { g.connect(bus); const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.reverbSend); }
    this._voice(dur);
  }

  pad(rootMidi, shape, when, dur, cutoff = 1200, vel = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.3;
    const g = ctx.createGain();
    const atk = Math.min(4.2, dur * 0.38), rel = Math.min(5, dur * 0.5);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.055 * vel, when + atk);
    g.gain.setValueAtTime(0.055 * vel, when + Math.max(atk, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + rel);
    f.connect(g);
    g.connect(this.musicBus);
    const s = ctx.createGain(); s.gain.value = 0.75; g.connect(s); s.connect(this.reverbSend);
    shape.forEach((iv, i) => {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.value = midi(rootMidi + iv); o.detune.value = det + (i - 2) * 2;
        const og = ctx.createGain(); og.gain.value = 0.32 / (1 + i * 0.25);
        o.connect(og); og.connect(f);
        o.start(when); o.stop(when + dur + rel + 0.1);
      }
    });
    this._voice(dur + rel);
  }

  noiseBurst(when, dur, type, f0, f1, vel, bus = this.sfxBus, q = 1.2, pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vel, when + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f); f.connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(bus); } else g.connect(bus);
    src.start(when, this.rnd() * 3); src.stop(when + dur + 0.05);
    this._voice(dur);
  }

  tone(freq0, freq1, when, dur, vel, type = 'sine', bus = this.sfxBus, send = 0.3, pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq0, when); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(vel, when + Math.min(0.012, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(bus); if (send > 0) { const s = ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(this.reverbSend); } }
    else g.connect(bus);
    o.start(when); o.stop(when + dur + 0.05);
    this._voice(dur);
  }

  chirp(when, pan = 0, vel = 0.05, pitch = 1) {
    if (!this.ready) return;
    const n = 2 + Math.floor(this.rnd() * 4);
    let t = when;
    const base = (2300 + this.rnd() * 1500) * pitch;
    for (let i = 0; i < n; i++) {
      const dur = 0.05 + this.rnd() * 0.07;
      this.tone(base * (0.9 + this.rnd() * 0.2), base * (1.25 + this.rnd() * 0.5), t, dur, vel * (0.7 + this.rnd() * 0.5), 'sine', this.ambBus, 0.4, pan);
      t += dur + 0.045 + this.rnd() * 0.06;
    }
  }

  // ---- sound effects ---------------------------------------------------------------------------
  sfx(name, a = {}) {
    if (!this.ready || !this.running) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const s = this.SCALE_NOTES(a.night ?? this.state.night);
    switch (name) {
      case 'ui.move': this.tone(880, 1100, t, 0.05, 0.05, 'triangle', this.sfxBus, 0.1); break;
      case 'ui.select': this.tone(660, 990, t, 0.09, 0.07, 'triangle', this.sfxBus, 0.25); this.tone(990, 1320, t + 0.07, 0.1, 0.05, 'sine', this.sfxBus, 0.3); break;
      case 'ui.back': this.tone(760, 480, t, 0.11, 0.06, 'triangle', this.sfxBus, 0.2); break;
      case 'ui.open': this.noiseBurst(t, 0.35, 'bandpass', 300, 1800, 0.05, this.sfxBus, 0.8); this.bell(midi(74), t + 0.02, 0.35, 1.6, this.sfxBus, 0.7); break;
      case 'ui.close': this.noiseBurst(t, 0.3, 'bandpass', 1800, 300, 0.045, this.sfxBus, 0.8); break;
      case 'ui.toggle': this.tone(720, 1080, t, 0.07, 0.06, 'triangle', this.sfxBus, 0.2); break;
      case 'connect': this.bell(midi(79), t, 0.6, 1.8, this.sfxBus, 0.8); this.bell(midi(83), t + 0.12, 0.5, 1.8, this.sfxBus, 0.8); break;
      case 'flap': this.noiseBurst(t, 0.07, 'bandpass', 900, 500, (a.v ?? 0.02), this.sfxBus, 0.9, a.pan || 0); break;
      case 'boost': this.noiseBurst(t, 0.55, 'bandpass', 400, 2600, 0.09, this.sfxBus, 0.7); this.tone(300, 720, t, 0.4, 0.03, 'sine', this.sfxBus, 0.4); break;
      case 'land': this.noiseBurst(t, 0.16, 'lowpass', 900, 300, 0.07, this.sfxBus, 0.6); this.bell(midi(86), t + 0.05, 0.25, 1.4, this.sfxBus, 0.8); break;
      case 'takeoff': this.noiseBurst(t, 0.22, 'bandpass', 500, 1600, 0.06, this.sfxBus, 0.8); break;
      case 'sip': for (let i = 0; i < 4; i++) this.tone(520 + i * 90, 760 + i * 130, t + i * 0.085, 0.09, 0.05, 'sine', this.sfxBus, 0.5); break;
      case 'sipDone': [0, 4, 7, 12].forEach((iv, i) => this.bell(midi(79 + iv), t + i * 0.07, 0.55, 2.2, this.sfxBus, 0.9)); break;
      case 'pollinate': {
        const notes = [0, 2, 4, 7, 9, 12, 14];
        notes.forEach((iv, i) => this.bell(midi(74 + iv), t + i * 0.075, 0.6 + i * 0.03, 2.8, this.sfxBus, 1.0, (i % 2 ? 0.3 : -0.3)));
        this.noiseBurst(t, 0.9, 'bandpass', 800, 6000, 0.06, this.sfxBus, 0.5);
        this.tone(110, 70, t, 0.4, 0.09, 'sine', this.sfxBus, 0.2);
        break;
      }
      case 'discover': {
        [0, 7, 12, 16, 19].forEach((iv, i) => this.bell(midi(62 + iv), t + i * 0.09, 0.7, 4.0, this.sfxBus, 1.1, 0));
        this.pad(50, [0, 7, 12, 16], t, 3.2, 1800, 0.9);
        break;
      }
      case 'star': this.bell(midi(88), t, 0.65, 2.2, this.sfxBus, 1.0); this.tone(1200, 3200, t, 0.35, 0.03, 'sine', this.sfxBus, 0.6); break;
      case 'pulse': this.tone(280, 940, t, 0.7, 0.05, 'sine', this.sfxBus, 0.7); this.noiseBurst(t, 0.7, 'bandpass', 500, 4200, 0.045, this.sfxBus, 0.7); this.bell(midi(91), t + 0.25, 0.3, 2.0, this.sfxBus, 1.0); break;
      case 'bump': this.tone(120, 60, t, 0.14, 0.09, 'sine', this.sfxBus, 0.1); this.noiseBurst(t, 0.09, 'lowpass', 1200, 300, 0.05, this.sfxBus, 0.6); break;
      case 'tired': this.tone(494, 392, t, 0.4, 0.05, 'sine', this.sfxBus, 0.5); this.tone(392, 330, t + 0.28, 0.5, 0.045, 'sine', this.sfxBus, 0.5); break;
      case 'shutter': this.noiseBurst(t, 0.06, 'highpass', 3000, 3000, 0.06, this.sfxBus, 0.5); this.noiseBurst(t + 0.07, 0.08, 'highpass', 2500, 2500, 0.04, this.sfxBus, 0.5); this.bell(midi(96), t + 0.1, 0.25, 1.2, this.sfxBus, 0.5); break;
      case 'unlock': [0, 2, 4, 7, 9, 12, 16].forEach((iv, i) => this.bell(midi(72 + iv), t + i * 0.11, 0.65, 3.0, this.sfxBus, 1.1)); this.pad(50, [0, 7, 12, 16, 19], t, 4.5, 2000, 1.1); break;
      case 'finale': [0, 4, 7, 12, 16, 19, 24].forEach((iv, i) => this.bell(midi(60 + iv), t + i * 0.16, 0.8, 5.5, this.sfxBus, 1.3)); this.pad(50, [0, 7, 12, 16, 19], t, 9, 2400, 1.5); this.pad(57, [0, 7, 12, 14, 19], t + 3, 9, 2400, 1.2); break;
      case 'species': this.bell(midi(84), t, 0.5, 1.6, this.sfxBus, 0.8); this.noiseBurst(t, 0.3, 'bandpass', 1200, 4000, 0.04, this.sfxBus, 0.7); break;
    }
  }

  SCALE_NOTES(night) { return night > 0.55 ? SCALES.night : night > 0.15 ? SCALES.dusk : SCALES.bright; }

  // ---- per frame ---------------------------------------------------------------------------
  // s: { night, biome, rain, wind, speed, alt, water, falls, boost, perched, grass, hour, lake, sea, bees, mood, paused }
  update(dt, s) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    Object.assign(this.state, s);
    const st = this.state;
    this.t += dt;
    const K = 0.5;
    const setG = (g, v, tc = 0.25) => g.gain.setTargetAtTime(v, now, tc);
    const calm = st.paused ? 0.35 : 1;
    // wind depends on altitude, speed and weather
    const windAmt = clamp(0.03 + st.wind * 0.05 + smoothstep(0, 220, st.alt) * 0.11 + Math.min(st.speed / 22, 1) * 0.16 + st.boost * 0.05, 0, 0.5);
    setG(this.windLow, windAmt * 0.8 * calm); setG(this.windHi, windAmt * 0.5 * calm);
    this.windHiF.filter.frequency.setTargetAtTime(1200 + st.speed * 55 + st.alt * 3, now, 0.3);
    this.windLowF.filter.frequency.setTargetAtTime(240 + st.wind * 70 + st.speed * 12, now, 0.3);
    setG(this.waterG, st.lake * 0.11 * calm); setG(this.seaG, st.sea * 0.22 * calm);
    setG(this.fallsG, st.falls * 0.34 * calm);
    setG(this.rainG, st.rain * 0.105 * calm);
    setG(this.grassG, st.grass * (0.02 + Math.min(st.speed / 14, 1) * 0.11) * calm);
    setG(this.cricketG, st.night * (st.biome === 5 || st.biome === 7 ? 0.2 : 1) * 0.034 * (1 - st.rain) * calm);
    setG(this.beeG, (st.bees || 0) * (1 - st.night) * 0.0085 * calm);
    const perch = st.perched ? 1 : 0;
    // music
    const nightMix = st.night;
    const cutoff = lerp(1500, 620, nightMix) * (1 + st.boost * 0.4) * (perch ? 0.65 : 1) * (1 - st.rain * 0.25);
    this.mood.cutoff = cutoff;
    this.droneG.gain.setTargetAtTime((0.026 + nightMix * 0.008) * calm, now, 1.0);
    if (this.t > this.next.chord) {
      const pr = PROG[this.chordIdx % PROG.length];
      this.chordIdx++;
      const dur = 13 + this.rnd() * 5;
      const rootMidi = 50 + pr.root - (nightMix > 0.5 ? 5 : 0) + (this.chordIdx % 6 === 0 ? 0 : 0);
      this.pad(rootMidi, pr.ch, now + 0.05, dur, cutoff, 1 - st.rain * 0.3);
      this.drone.d1.frequency.setTargetAtTime(midi(rootMidi - 12), now, 2.5);
      this.drone.d2.frequency.setTargetAtTime(midi(rootMidi - 12) * 1.004, now, 2.5);
      this.curRoot = rootMidi;
      this.next.chord = this.t + dur - 2.5;
    }
    if (this.t > this.next.note && this.curRoot !== undefined) {
      const scale = this.SCALE_NOTES(nightMix);
      const density = (0.55 + 0.45 * (1 - nightMix)) * (perch ? 0.55 : 1) * (1 + st.boost * 0.6) * (st.moodMelody ?? 1);
      const deg = scale[Math.floor(this.rnd() * scale.length)];
      const oct = 12 * (2 + Math.floor(this.rnd() * 2.2)) + (st.moodOct || 0);
      let note = 50 + (this.curRoot - 50 < 0 ? this.curRoot - 50 : 0) + deg + oct - (this.chordIdx % 3 === 0 ? 0 : 0);
      while (note > 96) note -= 12; // keep the top of the melody sweet, not piercing
      const vel = 0.35 + this.rnd() * 0.4;
      this.bell(midi(note), now + 0.05, vel * (nightMix > 0.5 ? 0.85 : 1), 2.2 + this.rnd() * 1.6, this.musicBus, 1.0, (this.rnd() - 0.5) * 0.9);
      let note2 = note + scale[(Math.floor(this.rnd() * scale.length) + 2) % scale.length] - deg + 12;
      while (note2 > 100) note2 -= 12;
      if (this.rnd() < 0.25 * density) this.bell(midi(note2), now + 0.28, vel * 0.6, 2.6, this.musicBus, 1.0, (this.rnd() - 0.5) * 0.9);
      this.next.note = this.t + (0.9 + this.rnd() * 2.4) / density;
    }
    // birdsong by day away from water and high places
    if (st.night < 0.35 && st.rain < 0.6 && st.birdDensity > 0) {
      if (this.t > this.next.bird) {
        this.chirp(now + 0.05 + this.rnd() * 0.2, (this.rnd() - 0.5) * 1.6, 0.032 * (0.5 + st.birdDensity * 0.9) * (1 - st.night) * calm, 0.85 + this.rnd() * 0.5);
        this.next.bird = this.t + (1.2 + this.rnd() * 5) / Math.max(0.25, st.birdDensity);
      }
    }
    // wing flaps
    if (st.flap && !st.perched && this.t > this.next.flap) {
      this.sfx('flap', { v: 0.012 + 0.014 * st.flapAmp, pan: (this.rnd() - 0.5) * 0.15 });
      this.next.flap = this.t + 0.24 / Math.max(0.6, st.flapRate || 1);
    }
  }

  // one shot with graceful failure so audio problems never break the game
  play(name, args) { try { this.sfx(name, args); } catch (e) { /* ignore */ } }
}
