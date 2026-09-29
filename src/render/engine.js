// Renderer, camera, post chain and adaptive resolution.
import * as THREE from 'three';
import { Post } from './post.js';

export const QUALITY_PRESETS = {
  low: { maxPixels: 1.15e6, samples: 0, bloom: false, range0: 90, grass: 0.45, flower: 0.5, detail: 0.5 },
  medium: { maxPixels: 2.3e6, samples: 2, bloom: true, range0: 110, grass: 0.75, flower: 0.75, detail: 0.75 },
  high: { maxPixels: 3.6e6, samples: 4, bloom: true, range0: 130, grass: 1.0, flower: 1.0, detail: 1.0 },
  ultra: { maxPixels: 5.6e6, samples: 4, bloom: true, range0: 160, grass: 1.25, flower: 1.2, detail: 1.15 },
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x0b1020, 1);
    this.renderer.autoClear = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
    this.camera.position.set(0, 60, 0);
    this.quality = 'high';
    this.preset = QUALITY_PRESETS.high;
    this.scale = 1; // dynamic resolution multiplier
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.frameTimes = [];
    this._lastRes = '';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    const p = QUALITY_PRESETS[name] || QUALITY_PRESETS.high;
    this.quality = name;
    this.preset = p;
    this.post.configure({ samples: p.samples, bloom: p.bloom });
    this.resize(true);
  }

  setPhoto(on) {
    if (!!this.photo === on) return;
    this.photo = on;
    this.resize(true);
  }

  resize(force = false) {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    // cap the internal pixel count so huge retina displays stay smooth
    const wantPixels = w * h * dpr * dpr;
    let pr = dpr;
    // photo mode holds still, so spend the extra pixels on a crisper picture
    const cap = this.photo ? Math.min(QUALITY_PRESETS.ultra.maxPixels, this.preset.maxPixels * 1.6) : this.preset.maxPixels * this.scale;
    if (wantPixels > cap) pr = Math.sqrt(cap / (w * h));
    pr = Math.max(0.5, pr);
    const key = `${w}x${h}@${pr.toFixed(3)}`;
    if (key === this._lastRes && !force) return;
    this._lastRes = key;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h; this.pixelRatio = pr;
  }

  // Call once per frame with the raw frame time in seconds. Nudges resolution to hold a smooth frame rate.
  adapt(dt, enabled = true) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    this.avgFrame = avg;
    if (!enabled) return;
    let changed = false;
    if (avg > 1 / 50 && this.scale > 0.5) { this.scale = Math.max(0.5, this.scale * 0.88); changed = true; }
    else if (avg < 1 / 72 && this.scale < 1) { this.scale = Math.min(1, this.scale * 1.07); changed = true; }
    if (changed) this.resize(true);
  }

  render(dt) {
    this.post.render(dt);
  }
}
