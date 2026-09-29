// Everything that persists: discoveries, species, stats, explored map, blooms and settings.
import { LANDMARKS } from '../world/biomes.js';
import { SPECIES, PLAYABLE } from '../render/butterfly.js';

const KEY = 'mariposa.save.v1';
export const FOG_N = 128;
export const STAR_COUNT = 96;

// how each butterfly is earned
export const UNLOCKS = [
  { species: 0, hint: 'Yours from the start', test: () => true },
  { species: 1, hint: 'Pollinate 8 flowers', test: (p) => p.stats.pollinations >= 8, progress: (p) => [Math.min(8, p.stats.pollinations), 8] },
  { species: 2, hint: 'Discover 4 places', test: (p) => p.discoveredCount >= 4, progress: (p) => [Math.min(4, p.discoveredCount), 4] },
  { species: 3, hint: 'Discover 8 places', test: (p) => p.discoveredCount >= 8, progress: (p) => [Math.min(8, p.discoveredCount), 8] },
  { species: 4, hint: 'Find the Moonwell', test: (p) => !!p.discovered.moonwell },
  { species: 5, hint: 'Awaken the Heartbloom', test: (p) => p.finale },
];

function defaults() {
  return {
    version: 1,
    discovered: {},
    unlocked: [0],
    species: 0,
    stats: { sips: 0, pollinations: 0, distance: 0, airTime: 0, stars: 0, playSeconds: 0 },
    tasted: {},
    fog: null,
    blooms: [],
    stars: [],
    time: { hour: 9.4, day: 0, moon: 0.42 },
    pos: null,
    finale: false,
    settings: {},
    tutorial: {},
  };
}

export class Progress {
  constructor() {
    this.data = defaults();
    this.fog = new Uint8Array(FOG_N * FOG_N);
    this.starSet = new Set();
    this.dirty = false;
    this.lastSave = 0;
    this.hasSave = false;
    this.load();
  }

  get discovered() { return this.data.discovered; }
  get discoveredCount() { return Object.keys(this.data.discovered).length; }
  get stats() { return this.data.stats; }
  get finale() { return this.data.finale; }
  get unlocked() { return this.data.unlocked; }
  get settings() { return this.data.settings; }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
      if (!isObj(d) || d.version !== 1) return;
      // validate into fresh values first so a damaged save can never leave the game half restored
      const def = defaults();
      const data = { ...def, ...d, stats: { ...def.stats, ...(isObj(d.stats) ? d.stats : {}) }, time: { ...def.time, ...(isObj(d.time) ? d.time : {}) } };
      for (const k of ['discovered', 'tasted', 'settings', 'tutorial']) if (!isObj(data[k])) data[k] = {};
      for (const k in data.stats) if (!Number.isFinite(data.stats[k])) data.stats[k] = 0;
      if (!Number.isFinite(data.time.hour)) data.time.hour = def.time.hour;
      if (!Number.isFinite(data.time.day)) data.time.day = 0;
      if (!Number.isFinite(data.time.moon)) data.time.moon = def.time.moon;
      data.unlocked = Array.from(new Set([0, ...(Array.isArray(d.unlocked) ? d.unlocked : []).filter((n) => Number.isInteger(n) && n >= 0 && n < 9)]));
      if (!data.unlocked.includes(data.species)) data.species = 0;
      data.blooms = (Array.isArray(d.blooms) ? d.blooms : []).filter((b) => isObj(b) && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z) && Number.isInteger(b.species));
      const q = data.pos;
      if (q && !(isObj(q) && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Math.abs(q.x) < 2100 && Math.abs(q.z) < 2100)) data.pos = null;
      const fog = new Uint8Array(FOG_N * FOG_N);
      if (typeof d.fog === 'string') {
        const bin = atob(d.fog);
        for (let i = 0; i < Math.min(bin.length, fog.length); i++) fog[i] = bin.charCodeAt(i);
      }
      const stars = new Set((Array.isArray(d.stars) ? d.stars : []).filter((n) => Number.isInteger(n) && n >= 0));
      this.data = data;
      this.fog = fog;
      this.starSet = stars;
      this.hasSave = true;
    } catch (e) { /* ignore corrupt or blocked storage */ }
  }

  save(extra = {}) {
    try {
      const d = this.data;
      let s = '';
      const f = this.fog;
      for (let i = 0; i < f.length; i++) s += String.fromCharCode(f[i]);
      d.fog = btoa(s);
      d.stars = Array.from(this.starSet);
      Object.assign(d, extra);
      localStorage.setItem(KEY, JSON.stringify(d));
      this.dirty = false;
      this.lastSave = performance.now();
      this.hasSave = true;
      return true;
    } catch (e) { return false; }
  }

  reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    const settings = this.data.settings;
    this.data = defaults();
    this.data.settings = settings;
    this.fog.fill(0);
    this.starSet = new Set();
    this.hasSave = false;
  }

  discover(id) {
    if (this.data.discovered[id]) return false;
    this.data.discovered[id] = Date.now();
    this.dirty = true;
    return true;
  }

  // Reveal explored area on the map fog. x,z in world metres.
  explore(x, z, radius = 90) {
    const cx = ((x + 2048) / 4096) * FOG_N, cz = ((z + 2048) / 4096) * FOG_N;
    const r = (radius / 4096) * FOG_N;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(FOG_N - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(FOG_N - 1, Math.ceil(cz + r));
    let changed = false;
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / r;
      if (d > 1) continue;
      const v = Math.round(255 * Math.min(1, (1 - d) * 2.4));
      if (v > this.fog[j * FOG_N + i]) { this.fog[j * FOG_N + i] = v; changed = true; }
    }
    if (changed) this.dirty = true;
    return changed;
  }

  exploredFraction() {
    let n = 0;
    for (let i = 0; i < this.fog.length; i++) if (this.fog[i] > 128) n++;
    return n / this.fog.length;
  }

  unlockCheck() {
    const newly = [];
    for (const u of UNLOCKS) {
      if (this.data.unlocked.includes(u.species)) continue;
      if (u.test(this)) { this.data.unlocked.push(u.species); newly.push(u.species); this.dirty = true; }
    }
    return newly;
  }

  bloomPercent() {
    const lm = Math.min(1, this.discoveredCount / LANDMARKS.length);
    const pol = Math.min(1, this.data.stats.pollinations / 40);
    const stars = Math.min(1, this.data.stats.stars / STAR_COUNT);
    return Math.round((lm * 0.5 + pol * 0.35 + stars * 0.15) * 100);
  }

  taste(speciesKey) {
    this.data.tasted[speciesKey] = (this.data.tasted[speciesKey] || 0) + 1;
    this.dirty = true;
  }
}

export function speciesName(i) { return SPECIES[i]?.name || 'Butterfly'; }
export { PLAYABLE };
