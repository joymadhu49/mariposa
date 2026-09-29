// Weather moods that drift slowly: clear, soft cloud, mist, showers. Rainbows follow rain.
import { clamp, damp, smoothstep } from '../core/util.js';
import { mulberry32 } from '../core/util.js';

const MOODS = {
  clear: { overcast: 0.08, rain: 0, mist: 0, wind: 1.0 },
  fair: { overcast: 0.28, rain: 0, mist: 0, wind: 1.15 },
  cloudy: { overcast: 0.62, rain: 0, mist: 0.08, wind: 1.5 },
  mist: { overcast: 0.42, rain: 0, mist: 0.75, wind: 0.6 },
  shower: { overcast: 0.86, rain: 0.9, mist: 0.15, wind: 1.9 },
  drizzle: { overcast: 0.7, rain: 0.42, mist: 0.2, wind: 1.3 },
};

export class Weather {
  constructor(seed = 99) {
    this.rnd = mulberry32(seed);
    this.mood = 'clear';
    this.state = { overcast: 0.1, rain: 0, mist: 0, wind: 1 };
    this.timer = 150;
    this.rainbow = 0;
    this.prevRain = 0;
    this.locked = false;
  }

  setMood(name, instant = false) {
    this.mood = name;
    if (instant) Object.assign(this.state, MOODS[name]);
    this.timer = 180 + this.rnd() * 240;
  }

  pickNext(hour) {
    const r = this.rnd();
    const morning = hour > 4.5 && hour < 8.5;
    if (this.mood === 'shower' || this.mood === 'drizzle') return r < 0.6 ? 'fair' : 'clear';
    if (morning && r < 0.35) return 'mist';
    if (r < 0.34) return 'clear';
    if (r < 0.6) return 'fair';
    if (r < 0.78) return 'cloudy';
    if (r < 0.9) return 'drizzle';
    return 'shower';
  }

  update(dt, hour, sunElev) {
    if (!this.locked) {
      this.timer -= dt;
      if (this.timer <= 0) this.setMood(this.pickNext(hour));
    }
    const t = MOODS[this.mood];
    const s = this.state;
    const k = 0.35 * dt;
    s.overcast += (t.overcast - s.overcast) * (1 - Math.exp(-0.12 * dt * 3));
    s.rain += (t.rain - s.rain) * (1 - Math.exp(-0.18 * dt * 3));
    s.mist += (t.mist - s.mist) * (1 - Math.exp(-0.08 * dt * 3));
    s.wind += (t.wind - s.wind) * (1 - Math.exp(-0.3 * dt));
    // a rainbow blooms when a shower clears while the sun is low enough
    if (this.prevRain > 0.3 && s.rain <= 0.3 && sunElev > 0.06 && sunElev < 0.62) this.rainbowArm = 1;
    if (this.rainbowArm) { this.rainbow = Math.min(1, this.rainbow + dt * 0.12); if (s.rain > 0.2 || sunElev < 0.04 || sunElev > 0.7) this.rainbowArm = 0; }
    else this.rainbow = Math.max(0, this.rainbow - dt * 0.05);
    this.prevRain = s.rain;
  }
}
